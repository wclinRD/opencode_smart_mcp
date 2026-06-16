#!/usr/bin/env node

// boulder.mjs — Boulder 狀態持久化 CLI
//
// 管理計畫、任務、檢查點，支援續命。
//
// Usage:
//   node boulder.mjs plan create <name> [--desc "..."] [--tasks "t1,t2,t3"]
//   node boulder.mjs plan list [--status active|completed|paused]
//   node boulder.mjs plan show <id|name>
//   node boulder.mjs plan update <id> [--name "..."] [--status completed|cancelled]
//   node boulder.mjs task list <planId>
//   node boulder.mjs task update <taskId> [--status in_progress|completed|skipped|failed] [--result "..."]
//   node boulder.mjs checkpoint <planId> [--context "..."] [--task <id>] [--files "..."] [--decisions "..."] [--next "..."]
//   node boulder.mjs status [--plan <id>]
//   node boulder.mjs resume <planId>
//   node boulder.mjs --help
//   node boulder.mjs --json

import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { getMemoryDB } from '../lib/memory-db.mjs';
import { ContextManager } from '../lib/context-manager.mjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_PATH = process.env.SMART_MEMORY_PATH || resolve(homedir(), '.smart/memory/memory.db');

function getDB() {
  return getMemoryDB(DB_PATH);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `
Boulder — 狀態持久化 CLI

Usage:
  boulder plan create <name>     Create a new plan
    [--desc "..."]               Plan description
    [--tasks "t1,t2,t3"]         Comma-separated task names

  boulder plan list              List plans
    [--status active|completed|paused|cancelled]

  boulder plan show <id|name>    Show plan details + tasks

  boulder plan update <id>       Update a plan
    [--name "..."] [--status completed|cancelled|paused]
    [--desc "..."]

  boulder task list <planId>     List tasks for a plan
    [--status pending|in_progress|completed|skipped|failed]

  boulder task update <taskId>   Update a task
    [--status in_progress|completed|skipped|failed]
    [--result "..."]
    [--error "..."]

  boulder checkpoint <planId>    Save a checkpoint
    [--context "..."] [--task <id>]
    [--files "f1,f2"] [--decisions "d1;d2"] [--next "..."]

  boulder plan pause <id>        Pause a plan (stop-continuation)
    [--name "..."]               Optionally rename while pausing

  boulder plan resume <id>       Resume a paused plan

  boulder status                 Show current active plan status
    [--plan <id>]                Show specific plan status

  boulder resume <planId>        Output continuation directive

  boulder recovery [<planId>]    Check for session interruption recovery
                                 Detects if previous session was interrupted
                                 and provides synthetic context for recovery

  --json                         JSON output
  --help                         Show this help
`.trim();

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

let JSON_MODE = false;

function out(data) {
  if (JSON_MODE) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function outJSON(data) {
  console.log(JSON.stringify(data, null, 2));
}

function formatTable(rows, headers) {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const values = rows.map(r => String(r[i] || ''));
    return Math.max(h.length, ...values.map(v => v.length));
  });

  const sep = headers.map((w, i) =>
    '─'.repeat(w + 2)
  ).join('┬');

  const headerLine = ' ' + headers.map((h, i) =>
    h.padEnd(colWidths[i])
  ).join(' │ ');

  const sepLine = '─' + sep + '─';

  const rows_ = rows.map(row =>
    ' ' + row.map((v, i) =>
      String(v || '').padEnd(colWidths[i])
    ).join(' │ ')
  );

  return [sepLine, headerLine, sepLine.replace(/┬/g, '┼'), ...rows_, sepLine.replace(/┬/g, '┴')].join('\n');
}

function progressBar(done, total, width = 20) {
  if (total === 0) return '[' + '░'.repeat(width) + ']';
  const filled = Math.round((done / total) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ---------------------------------------------------------------------------
// Plan commands
// ---------------------------------------------------------------------------

function cmdPlanCreate(args) {
  const db = getDB();
  const name = args._[0];
  if (!name) throw new Error('Plan name required');

  const description = args.desc || args.description || null;
  const tasksStr = args.tasks || null;
  const tasks = tasksStr ? tasksStr.split(',').map(t => t.trim()).filter(Boolean) : [];

  const plan = db.createPlan(name, description, tasks);
  return {
    ok: true,
    action: 'plan-created',
    plan: {
      id: plan.id,
      name: plan.name,
      total_tasks: plan.total_tasks,
    },
  };
}

function cmdPlanList(args) {
  const db = getDB();
  const status = args.status || null;
  const plans = db.listPlans(status);

  return {
    ok: true,
    count: plans.length,
    plans: plans.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      tasks: `${p.completed_tasks || 0}/${p.total_tasks || 0}`,
      updated: p.updated_at,
    })),
  };
}

function cmdPlanShow(args) {
  const db = getDB();
  const idOrName = args._[0];
  if (!idOrName) throw new Error('Plan ID or name required');

  // Try by ID first, then by name
  let plan = db.getPlan(idOrName);
  if (!plan) {
    const plans = db.listPlans();
    plan = plans.find(p => p.name === idOrName);
  }
  if (!plan) throw new Error(`Plan not found: ${idOrName}`);

  const tasks = db.listTasks(plan.id);

  return {
    ok: true,
    plan: {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      agent_id: plan.agent_id,
      tasks: `${plan.completed_tasks || 0}/${plan.total_tasks || 0}`,
      started: plan.started_at,
      updated: plan.updated_at,
      completed: plan.completed_at,
    },
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      sort_order: t.sort_order,
      result: t.result || null,
      started: t.started_at || null,
      completed: t.completed_at || null,
    })),
  };
}

function cmdPlanUpdate(args) {
  const db = getDB();
  const id = args._[0];
  if (!id) throw new Error('Plan ID required');

  const updates = {};
  if (args.name) updates.name = args.name;
  if (args.status) updates.status = args.status;
  if (args.desc) updates.description = args.desc;

  const plan = db.updatePlan(id, updates);
  if (!plan) throw new Error(`Plan not found: ${id}`);

  return {
    ok: true,
    action: 'plan-updated',
    plan: {
      id: plan.id,
      name: plan.name,
      status: plan.status,
    },
  };
}

function cmdPlanPause(args) {
  const db = getDB();
  const id = args._[0];
  if (!id) throw new Error('Plan ID required');

  const updates = { status: 'paused' };
  if (args.name) updates.name = args.name;

  const plan = db.updatePlan(id, updates);
  if (!plan) throw new Error(`Plan not found: ${id}`);

  return {
    ok: true,
    action: 'plan-paused',
    plan: { id: plan.id, name: plan.name, status: 'paused' },
  };
}

function cmdPlanResume(args) {
  const db = getDB();
  const id = args._[0];
  if (!id) throw new Error('Plan ID required');

  const plan = db.updatePlan(id, { status: 'active' });
  if (!plan) throw new Error(`Plan not found: ${id}`);

  return {
    ok: true,
    action: 'plan-resumed',
    plan: { id: plan.id, name: plan.name, status: 'active' },
  };
}

// ---------------------------------------------------------------------------
// Task commands
// ---------------------------------------------------------------------------

function cmdTaskList(args) {
  const db = getDB();
  const planId = args._[0];
  if (!planId) throw new Error('Plan ID required');

  const status = args.status || null;
  const tasks = db.listTasks(planId, status);

  return {
    ok: true,
    plan_id: planId,
    count: tasks.length,
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      sort_order: t.sort_order,
      result: t.result || null,
      started: t.started_at || null,
      completed: t.completed_at || null,
    })),
  };
}

function cmdTaskUpdate(args) {
  const db = getDB();
  const taskId = args._[0];
  if (!taskId) throw new Error('Task ID required');

  const updates = {};
  if (args.status) updates.status = args.status;
  if (args.result) updates.result = args.result;
  if (args.error) updates.error = args.error;

  const task = db.updateTask(taskId, updates);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  return {
    ok: true,
    action: 'task-updated',
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      result: task.result || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Checkpoint command
// ---------------------------------------------------------------------------

function cmdCheckpoint(args) {
  const db = getDB();
  const planId = args._[0];
  if (!planId) throw new Error('Plan ID required');

  // Parse files string → array
  let filesChanged = null;
  if (args.files) {
    filesChanged = args.files.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Parse decisions string → array
  let decisions = null;
  if (args.decisions) {
    decisions = args.decisions.split(';').map(s => s.trim()).filter(Boolean);
  }

  const ckpt = db.saveCheckpoint(planId, {
    sessionId: args.session || null,
    contextSummary: args.context || args.summary || null,
    taskId: args.task || null,
    filesChanged,
    decisions,
    nextIntent: args.next || args['next-intent'] || null,
  });

  return {
    ok: true,
    action: 'checkpoint-saved',
    checkpoint: {
      id: ckpt.id,
      plan_id: ckpt.plan_id,
      created_at: ckpt.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

function cmdStatus(args) {
  const db = getDB();
  let plan = null;
  let tasks = [];
  let checkpoint = null;

  if (args.plan) {
    plan = db.getPlan(args.plan);
    if (!plan) throw new Error(`Plan not found: ${args.plan}`);
  } else {
    plan = db.getActivePlan();
    if (!plan) return { ok: true, active: false, message: 'No active plan.' };
  }

  tasks = db.listTasks(plan.id);
  checkpoint = db.getLatestCheckpoint(plan.id);
  const ctx = db.getContinuationContext(plan.id);

  const done = plan.completed_tasks || 0;
  const total = plan.total_tasks || 0;

  // Estimate elapsed time
  let elapsed = '';
  if (plan.started_at) {
    const start = new Date(plan.started_at + 'Z').getTime();
    const now = Date.now();
    const ms = now - start;
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    elapsed = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  return {
    ok: true,
    active: plan.status === 'active',
    plan: {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      description: plan.description,
      progress: `${done}/${total}`,
      progressBar: progressBar(done, total),
      elapsed,
      total_tasks: total,
      completed_tasks: done,
      started: plan.started_at,
      updated: plan.updated_at,
    },
    currentTask: ctx?.currentTask ? {
      id: ctx.currentTask.id,
      name: ctx.currentTask.name,
      status: ctx.currentTask.status,
    } : null,
    checkpoint: checkpoint ? {
      id: checkpoint.id,
      context_summary: checkpoint.context_summary,
      task_id: checkpoint.task_id,
      created_at: checkpoint.created_at,
    } : null,
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      sort_order: t.sort_order,
    })),
  };
}

// ---------------------------------------------------------------------------
// Resume command
// ---------------------------------------------------------------------------

function cmdResume(args) {
  const db = getDB();
  const planId = args._[0];
  if (!planId) throw new Error('Plan ID required');

  const ctx = db.getContinuationContext(planId);
  if (!ctx) throw new Error(`Plan not found: ${planId}`);

  const { plan, currentTask, checkpoint, progress } = ctx;

  // Phase 4.4: Check for session recovery context
  let recovery = null;
  try {
    const cm = new ContextManager();
    cm.init(); // load or create current session
    recovery = cm.detectAbnormalEnd();
  } catch {
    // Best-effort — recovery check is non-critical
  }

  const directiveParts = [
    '[SYSTEM DIRECTIVE - BOULDER CONTINUATION]',
    `Plan: ${plan.name} (${progress})`,
    currentTask ? `Current task: ${currentTask.name} [${currentTask.status}]` : 'No active task',
    checkpoint?.next_intent ? `Next intent: ${checkpoint.next_intent}` : null,
    checkpoint?.context_summary ? `Context: ${checkpoint.context_summary}` : null,
    `Started: ${plan.started_at}`,
    '',
  ];

  if (recovery) {
    directiveParts.push('[RECOVERY: Previous session interrupted]');
    directiveParts.push(`Last session had ${recovery.toolCount} tool calls and ended abnormally.`);
    if (recovery.lastTool) {
      directiveParts.push(`Last tool called: ${recovery.lastTool} (${recovery.lastOk ? 'completed' : 'failed'})`);
    }
    if (recovery.lastError) {
      directiveParts.push(`Last error: ${recovery.lastError.slice(0, 200)}`);
    }
    if (recovery.lastToolResult) {
      directiveParts.push(`Last output: ${recovery.lastToolResult}`);
    }
    directiveParts.push('');
  }

  directiveParts.push('Resume from last checkpoint. Continue working on the current task.');

  return {
    ok: true,
    recovered: recovery ? true : false,
    directive: directiveParts.filter(Boolean).join('\n'),
    plan: {
      id: plan.id,
      name: plan.name,
      progress,
    },
    currentTask: currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      status: currentTask.status,
    } : null,
    checkpoint: checkpoint ? {
      context_summary: checkpoint.context_summary,
      next_intent: checkpoint.next_intent,
    } : null,
    recovery: recovery ? {
      interrupted: true,
      toolCount: recovery.toolCount,
      lastTool: recovery.lastTool,
      lastOk: recovery.lastOk,
      lastError: recovery.lastError ? recovery.lastError.slice(0, 200) : null,
      lastToolResult: recovery.lastToolResult,
    } : null,
  };
}

function cmdRecovery(args) {
  const cm = new ContextManager();
  cm.init();
  const recovery = cm.detectAbnormalEnd();

  const result = {
    ok: true,
    recoveryDetected: recovery ? true : false,
    recovery,
  };

  // If planId given, also check Boulder plan state
  const planId = args._[0];
  if (planId) {
    try {
      const db = getDB();
      const plan = db.getPlan(planId);
      if (plan) {
        const tasks = db.listTasks(planId);
        const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
        result.plan = {
          id: plan.id,
          name: plan.name,
          status: plan.status,
          inProgressTasks: inProgressTasks.length,
        };
      }
    } catch {
      // Best-effort
    }
  }

  // If recovery detected and plan has in-progress tasks, suggest synthetic context
  if (recovery && result.plan?.inProgressTasks > 0) {
    result.syntheticContext = (
      `[SYNTHETIC TOOL_RESULT — Session Recovery]\n` +
      `Previous session was interrupted during execution.\n` +
      `Last tool: ${recovery.lastTool || 'unknown'}\n` +
      `Result: tool execution did not complete — treat as cancelled.\n` +
      `Continue from Boulder checkpoint.`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Format output (text mode)
// ---------------------------------------------------------------------------

function formatOutput(cmd, result) {
  const lines = [];

  switch (cmd) {
    case 'plan-create': {
      lines.push(`✅ Plan created: ${result.plan.name}`);
      lines.push(`   ID:    ${result.plan.id}`);
      lines.push(`   Tasks: ${result.plan.total_tasks}`);
      break;
    }
    case 'plan-list': {
      if (result.count === 0) {
        lines.push('No plans found.');
        break;
      }
      const rows = result.plans.map(p => [p.id.slice(0, 8) + '…', p.name, p.status, p.tasks, (p.updated || '').slice(0, 10)]);
      lines.push(formatTable(rows, ['ID', 'Name', 'Status', 'Tasks', 'Updated']));
      lines.push(`\n${result.count} plan(s) total`);
      break;
    }
    case 'plan-show': {
      const p = result.plan;
      lines.push(`Plan: ${p.name} [${p.status}]`);
      lines.push(`  ID:          ${p.id}`);
      if (p.description) lines.push(`  Description: ${p.description}`);
      lines.push(`  Tasks:       ${p.tasks}`);
      lines.push(`  Started:     ${p.started}`);
      lines.push(`  Updated:     ${p.updated}`);
      if (p.completed) lines.push(`  Completed:   ${p.completed}`);
      lines.push('');
      if (result.tasks.length > 0) {
        const tRows = result.tasks.map(t => [
          t.sort_order,
          t.name,
          t.status,
          (t.result || '').slice(0, 40),
        ]);
        lines.push(formatTable(tRows, ['#', 'Task', 'Status', 'Result']));
      } else {
        lines.push('No tasks.');
      }
      break;
    }
    case 'plan-update': {
      lines.push(`✅ Plan updated: ${result.plan.name} → ${result.plan.status}`);
      break;
    }
    case 'plan-pause': {
      lines.push(`⏸ Plan paused: ${result.plan.name}`);
      lines.push(`   Continuation directive will NOT be injected.`);
      lines.push(`   Resume with: boulder plan resume ${result.plan.id}`);
      break;
    }
    case 'plan-resume': {
      lines.push(`▶ Plan resumed: ${result.plan.name}`);
      lines.push(`   Continuation directive will be injected on next session start.`);
      break;
    }
    case 'task-list': {
      if (result.count === 0) {
        lines.push('No tasks found.');
        break;
      }
      const rows = result.tasks.map(t => [
        t.sort_order,
        t.name,
        t.status,
        (t.id).slice(0, 8) + '…',
      ]);
      lines.push(formatTable(rows, ['#', 'Task', 'Status', 'ID']));
      lines.push(`\n${result.count} task(s) total`);
      break;
    }
    case 'task-update': {
      lines.push(`✅ Task updated: ${result.task.name} → ${result.task.status}`);
      if (result.task.result) lines.push(`   Result: ${result.task.result}`);
      break;
    }
    case 'checkpoint': {
      lines.push(`✅ Checkpoint saved: ${result.checkpoint.id}`);
      lines.push(`   Plan: ${result.checkpoint.plan_id}`);
      break;
    }
    case 'status': {
      if (!result.active) {
        lines.push('No active plan.');
        break;
      }
      const p = result.plan;
      lines.push(`📋 ${p.name}  [${p.status}]`);
      lines.push(`   ${p.progressBar}  ${p.progress} tasks  (${p.elapsed})`);
      if (result.currentTask) {
        lines.push(`   ▶ Current: ${result.currentTask.name} [${result.currentTask.status}]`);
      }
      if (result.checkpoint) {
        lines.push(`   📍 Last checkpoint: ${(result.checkpoint.created_at || '').slice(0, 19)}`);
        if (result.checkpoint.context_summary) {
          lines.push(`      ${result.checkpoint.context_summary.slice(0, 80)}`);
        }
      }
      lines.push('');
      // Show task list
      if (result.tasks.length > 0) {
        const tRows = result.tasks.map(t => {
          const icons = { pending: '○', in_progress: '▶', completed: '✓', skipped: '–', failed: '✗' };
          return [icons[t.status] || '○', t.name, t.status];
        });
        lines.push(formatTable(tRows, ['', 'Task', 'Status']));
      }
      break;
    }
    case 'resume': {
      lines.push(result.directive);
      break;
    }
    case 'recovery': {
      if (!result.recoveryDetected) {
        lines.push('✅ No session interruption detected. Previous session ended cleanly.');
        break;
      }
      const r = result.recovery;
      lines.push('⚠️  Previous session was interrupted!');
      lines.push(`   Session had ${r.toolCount} tool calls and ended abnormally.`);
      if (r.lastTool) {
        lines.push(`   Last tool: ${r.lastTool} (${r.lastOk ? 'completed' : '⚠️ failed'})`);
      }
      if (r.lastError) {
        lines.push(`   Last error: ${r.lastError.slice(0, 120)}`);
      }
      if (result.plan) {
        lines.push(`   Boulder plan: ${result.plan.name} [${result.plan.status}]`);
        lines.push(`   In-progress tasks: ${result.plan.inProgressTasks}`);
      }
      if (result.syntheticContext) {
        lines.push('');
        lines.push('   ── Synthetic Context ──');
        lines.push(result.syntheticContext);
      }
      lines.push('');
      lines.push(`   To resume: boulder resume <planId>`);
      break;
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const args = { _: [] };
  let i = 2; // skip node + script

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') { i++; break; }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        args[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // Check if next arg is a value (not a flag)
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          args[key] = argv[i + 1];
          i++;
        } else {
          args[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
    i++;
  }

  // Collect remaining args after --
  while (i < argv.length) {
    args._.push(argv[i]);
    i++;
  }

  return args;
}

function main() {
  const args = parseArgv(process.argv);

  if (args.help || args.h || args._.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  JSON_MODE = !!args.json;

  const cmd = args._[0];
  const subcmd = args._[1];

  try {
    let result;

    switch (cmd) {
      case 'plan': {
        switch (subcmd) {
          case 'create': {
            args._.splice(0, 2); // remove 'plan' 'create'
            result = cmdPlanCreate(args);
            out(JSON_MODE ? result : formatOutput('plan-create', result));
            break;
          }
          case 'list': {
            result = cmdPlanList(args);
            out(JSON_MODE ? result : formatOutput('plan-list', result));
            break;
          }
          case 'show': {
            args._.splice(0, 2);
            result = cmdPlanShow(args);
            out(JSON_MODE ? result : formatOutput('plan-show', result));
            break;
          }
          case 'update': {
            args._.splice(0, 2);
            result = cmdPlanUpdate(args);
            out(JSON_MODE ? result : formatOutput('plan-update', result));
            break;
          }
          case 'pause': {
            args._.splice(0, 2);
            result = cmdPlanPause(args);
            out(JSON_MODE ? result : formatOutput('plan-pause', result));
            break;
          }
          case 'resume': {
            args._.splice(0, 2);
            result = cmdPlanResume(args);
            out(JSON_MODE ? result : formatOutput('plan-resume', result));
            break;
          }
          default:
            throw new Error(`Unknown subcommand: plan ${subcmd}. See --help`);
        }
        break;
      }
      case 'task': {
        switch (subcmd) {
          case 'list': {
            args._.splice(0, 2);
            result = cmdTaskList(args);
            out(JSON_MODE ? result : formatOutput('task-list', result));
            break;
          }
          case 'update': {
            args._.splice(0, 2);
            result = cmdTaskUpdate(args);
            out(JSON_MODE ? result : formatOutput('task-update', result));
            break;
          }
          default:
            throw new Error(`Unknown subcommand: task ${subcmd}. See --help`);
        }
        break;
      }
      case 'checkpoint': {
        args._.splice(0, 1);
        result = cmdCheckpoint(args);
        out(JSON_MODE ? result : formatOutput('checkpoint', result));
        break;
      }
      case 'status': {
        result = cmdStatus(args);
        out(JSON_MODE ? result : formatOutput('status', result));
        break;
      }
      case 'resume': {
        args._.splice(0, 1);
        result = cmdResume(args);
        out(JSON_MODE ? result : formatOutput('resume', result));
        break;
      }
      case 'recovery': {
        args._.splice(0, 1);
        result = cmdRecovery(args);
        out(JSON_MODE ? result : formatOutput('recovery', result));
        break;
      }
      case '--help':
      case 'help': {
        console.log(HELP);
        break;
      }
      default:
        throw new Error(`Unknown command: ${cmd}. See --help`);
    }
  } catch (err) {
    if (JSON_MODE) {
      outJSON({ ok: false, error: err.message });
    } else {
      console.error(`❌ ${err.message}`);
    }
    process.exit(1);
  }
}

main();
