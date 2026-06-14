// scheduler.mjs — smart_schedule MCP tool
//
// Cron-like background task scheduler. Schedule recurring tasks like
// daily security scans, weekly dependency checks, etc.
// Tasks persist in SQLite and results are stored in memory.
//
// Phase 22: Scheduled Background Tasks

import { getMemoryDB } from '../../lib/memory-db.mjs';
import { resolve } from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const DEFAULT_DB_PATH = resolve(os.homedir(), '.smart', 'memory', 'memory.db');

// In-memory task registry (timers)
const _runningTasks = new Map();

// ---------------------------------------------------------------------------
// Cron parser (minimal — supports minute, hour, day of month, month, day of week)
// ---------------------------------------------------------------------------

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expr}". Expected 5 fields (min hour dom month dow).`);
  }
  return {
    minute: parts[0],
    hour: parts[1],
    dom: parts[2],
    month: parts[3],
    dow: parts[4],
  };
}

function cronMatches(cron, date = new Date()) {
  const p = typeof cron === 'string' ? parseCron(cron) : cron;
  return (
    fieldMatches(p.minute, date.getMinutes(), 0, 59) &&
    fieldMatches(p.hour, date.getHours(), 0, 23) &&
    fieldMatches(p.dom, date.getDate(), 1, 31) &&
    fieldMatches(p.month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(p.dow, date.getDay(), 0, 6)
  );
}

function fieldMatches(field, value, min, max) {
  if (field === '*') return true;

  // Step values: */5
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }

  // Ranges: 1-5
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  // Lists: 1,3,5
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }

  // Single value
  return parseInt(field, 10) === value;
}

function nextRunTime(cronExpr) {
  const cron = parseCron(cronExpr);
  const now = new Date();
  const candidate = new Date(now);

  // Start from next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search forward up to 366 days
  for (let i = 0; i < 525600; i++) { // max 1 year of minutes
    if (cronMatches(cron, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// Test cleanup: stop all scheduled tasks and clear all timers
export function __test_cleanup() {
  for (const [name] of _runningTasks) {
    stopScheduledTask(name);
  }
}

export default {
  name: 'smart_schedule',
  description: 'Schedule recurring background tasks with cron expressions. Tasks run automatically and results are stored in memory.',
  category: 'standard',
  domain: 'plan',
  safetyLevel: 'medium',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 0 },

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['add', 'list', 'remove', 'status', 'run-now'],
        description: 'Command: add (schedule), list (show all), remove (delete), status (check), run-now (execute immediately)'
      },
      name: {
        type: 'string',
        description: 'Task name (required for add/remove/run-now)'
      },
      schedule: {
        type: 'string',
        description: 'Cron expression: "min hour dom month dow" (e.g., "0 9 * * *" for daily at 9am)'
      },
      task: {
        type: 'string',
        description: 'Task description — what to do when triggered (e.g., "Run security scan")'
      },
      command_to_run: {
        type: 'string',
        description: 'Shell command to execute (e.g., "npm test")'
      },
      notify: {
        type: 'boolean',
        description: 'Store result in memory for next session (default: true)',
        default: true
      }
    },
    required: ['command']
  },

  handler: async (args, context) => {
    const { command, name, schedule, task, command_to_run, notify = true } = args;

    try {
      const db = getMemoryDB(DEFAULT_DB_PATH);

      switch (command) {
        case 'add': {
          if (!name || !schedule) {
            return errorResponse('name and schedule are required for add command');
          }

          // Validate cron expression
          try {
            parseCron(schedule);
          } catch (err) {
            return errorResponse(err.message);
          }

          const nextRun = nextRunTime(schedule);
          if (!nextRun) {
            return errorResponse(`Could not determine next run time for schedule: ${schedule}`);
          }

          // Store in DB
          db.recordADR({
            title: `[scheduled] ${name}`,
            context: `schedule: ${schedule}`,
            decision: task || command_to_run || name,
            alternatives: [],
            consequences: `Next run: ${nextRun.toISOString()}`,
            status: 'proposed'
          });

          // Start the timer
          startScheduledTask(name, schedule, task, command_to_run, notify);

          return okResponse('add', {
            name,
            schedule,
            nextRun: nextRun.toISOString(),
            message: `Task "${name}" scheduled. Next run: ${nextRun.toISOString()}`
          });
        }

        case 'list': {
          const all = db.listADR({ limit: 100 });
          const scheduled = all.filter(r => r.title?.startsWith('[scheduled]'));
          const tasks = scheduled.map(r => ({
            name: r.title.replace('[scheduled] ', ''),
            schedule: r.context?.replace('schedule: ', '') || 'unknown',
            task: r.decision,
            status: r.status,
            nextRun: r.consequences?.replace('Next run: ', '') || 'unknown',
            created: r.created_at
          }));

          return okResponse('list', {
            count: tasks.length,
            active: _runningTasks.size,
            tasks
          });
        }

        case 'remove': {
          if (!name) return errorResponse('name is required for remove command');

          // Stop the timer
          stopScheduledTask(name);

          // Remove from DB
          const all = db.listADR({ limit: 200 });
          const target = all.find(r => r.title === `[scheduled] ${name}`);
          if (target) {
            db.deleteADR(target.id);
          }

          return okResponse('remove', { name, message: `Task "${name}" removed.` });
        }

        case 'status': {
          const tasks = [];
          for (const [taskName, timer] of _runningTasks) {
            tasks.push({
              name: taskName,
              schedule: timer.schedule,
              nextRun: timer.nextRun?.toISOString() || 'unknown',
              runCount: timer.runCount || 0,
              lastRun: timer.lastRun?.toISOString() || 'never',
              lastResult: timer.lastResult || 'N/A'
            });
          }

          return okResponse('status', {
            active: tasks.length,
            tasks
          });
        }

        case 'run-now': {
          if (!name) return errorResponse('name is required for run-now command');

          const timer = _runningTasks.get(name);
          if (!timer) {
            return errorResponse(`Task "${name}" is not active. Use add first.`);
          }

          // Execute immediately
          const result = executeTask(name, timer.task, timer.command, timer.notify);
          return okResponse('run-now', { name, result });
        }

        default:
          return errorResponse(`Unknown command: ${command}`);
      }
    } catch (err) {
      return errorResponse(err.message);
    }
  }
};

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

function startScheduledTask(name, schedule, task, command_to_run, notify) {
  // Stop existing timer if any
  stopScheduledTask(name);

  const cron = parseCron(schedule);
  const timer = {
    schedule,
    task,
    command: command_to_run,
    notify,
    runCount: 0,
    lastRun: null,
    lastResult: null,
    nextRun: nextRunTime(schedule),
    interval: null
  };

  // Check every 30 seconds
  timer.interval = setInterval(() => {
    const now = new Date();
    if (cronMatches(cron, now)) {
      // Avoid running twice in the same minute
      if (timer.lastRun && (now.getTime() - timer.lastRun.getTime()) < 60000) {
        return;
      }
      const result = executeTask(name, task, command_to_run, notify);
      timer.runCount++;
      timer.lastRun = now;
      timer.lastResult = result;
      timer.nextRun = nextRunTime(schedule);
    }
  }, 30000);

  _runningTasks.set(name, timer);
}

function stopScheduledTask(name) {
  const timer = _runningTasks.get(name);
  if (timer?.interval) {
    clearInterval(timer.interval);
  }
  _runningTasks.delete(name);
}

function executeTask(name, task, command, notify) {
  try {
    let output = '';
    if (command) {
      output = execSync(command, {
        timeout: 120000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      }).slice(-2000);
    }

    const result = {
      task: name,
      description: task || command,
      status: 'completed',
      output: output || '(no output)',
      timestamp: new Date().toISOString()
    };

    // Store in memory for next session
    if (notify) {
      try {
        const db = getMemoryDB(DEFAULT_DB_PATH);
        db.recordADR({
          title: `[task-result] ${name}`,
          context: `Scheduled task result`,
          decision: JSON.stringify(result),
          status: 'accepted'
        });
      } catch {}
    }

    return result;
  } catch (err) {
    return {
      task: name,
      status: 'failed',
      error: err.message?.slice(0, 500),
      timestamp: new Date().toISOString()
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(command, data) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, command, ...data }, null, 2)
    }]
  };
}

function errorResponse(error) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }],
    isError: true
  };
}