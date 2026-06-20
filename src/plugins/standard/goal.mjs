// goal.mjs → smart_goal
//
// Persistent goal tracking for Smart MCP.
// Similar to Claude Code's /goal: set a completion condition,
// auto-check after each turn, keep working until condition is met.
//
// Integration:
//   - Post-tool hook auto-checks active goal after each tool call
//   - Context manager injects active goal into recovery context
//   - Agent prompt tells LLM to check goal status before each turn
//
// Data: ~/.smart/goals.json
// Schema:
//   {
//     id: "uuid",
//     description: "Human-readable goal summary",
//     condition: "Completion condition (what constitutes 'done')",
//     checkHints: ["hint1", "hint2"],  // how to verify
//     autoCheck: true,
//     status: "active" | "completed" | "failed" | "cancelled",
//     createdAt: "ISO",
//     updatedAt: "ISO",
//     completedAt: null,
//     checkCount: 0,
//     lastCheckResult: null,   // "met" | "unmet" | null
//     lastCheckSummary: null,  // brief note from last check
//     turnCount: 0,            // how many turns spent on this goal
//     sessionId: null,         // which session created it
//   }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = resolve(homedir(), '.smart');
const DATA_FILE = resolve(DATA_DIR, 'goals.json');
const MAX_HISTORY = 50;        // keep last 50 goals in history
const LIST_MAX = 20;           // max goals to show in list

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadGoals() {
  try {
    if (!existsSync(DATA_FILE)) return [];
    const raw = readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

function saveGoals(goals) {
  try {
    ensureDir(DATA_DIR);
    writeFileSync(DATA_FILE, JSON.stringify(goals, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[goal] Save failed: ${err.message}`);
  }
}

function getActiveGoal(goals) {
  return goals.find(g => g.status === 'active') || null;
}

function formatGoal(g, verbose = false) {
  const icon = g.status === 'active' ? '🎯'
    : g.status === 'completed' ? '✅'
    : g.status === 'failed' ? '❌'
    : '🚫';
  const lines = [
    `${icon} Goal #${g.id}: ${g.description}`,
    `   Condition: ${g.condition}`,
    `   Status: ${g.status}`,
    `   Checks: ${g.checkCount} | Turns: ${g.turnCount}`,
  ];
  if (g.lastCheckResult) {
    lines.push(`   Last check: ${g.lastCheckResult === 'met' ? '✅ MET' : '⏳ UNMET'} — ${g.lastCheckSummary || ''}`);
  }
  if (g.completedAt) {
    lines.push(`   Completed: ${g.completedAt}`);
  }
  if (verbose && g.checkHints && g.checkHints.length > 0) {
    lines.push(`   Verification hints: ${g.checkHints.join(', ')}`);
  }
  return lines.join('\n');
}

function formatGoalList(goals) {
  if (goals.length === 0) {
    return '🎯 No goals. Use `ssr({tool:"goal", args:{command:"set", description:"...", condition:"..."}})` to set one.';
  }
  const lines = ['📋 Goal History:'];
  const display = goals.slice(-LIST_MAX);
  for (const g of display) {
    lines.push(`  ${formatGoal(g, false)}`);
  }
  if (goals.length > LIST_MAX) {
    lines.push(`  ... and ${goals.length - LIST_MAX} more older goals (use ids to reference)`);
  }
  return lines.join('\n');
}

export default {
  name: 'smart_goal',
  category: 'standard',
  responsePolicy: { maxLevel: 1 },
  description: 'Persistent goal tracking. Set a completion condition and auto-check progress across turns. Commands: set (new goal), check (verify condition), status (show active), clear (complete/cancel), list (history), retry (reactivate failed).',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['set', 'check', 'status', 'clear', 'list', 'retry'],
        description: 'Command: set (new goal), check (verify condition met), status (show active), clear (complete or cancel), list (history), retry (reset failed to active)',
      },
      description: {
        type: 'string',
        description: 'Goal description (required for command=set)',
      },
      condition: {
        type: 'string',
        description: 'Completion condition — what constitutes "done" (required for command=set)',
      },
      checkHints: {
        type: 'array',
        items: { type: 'string' },
        description: 'How to verify the goal (optional, for command=set)',
      },
      autoCheck: {
        type: 'boolean',
        description: 'Auto-check after each tool call (default: true)',
      },
      id: {
        type: 'number',
        description: 'Goal id (required for clear/retry)',
      },
      status: {
        type: 'string',
        enum: ['completed', 'cancelled', 'failed'],
        description: 'Status to set on clear (default: completed)',
      },
      checkResult: {
        type: 'string',
        enum: ['met', 'unmet'],
        description: 'Check result (internal, used by hook)',
      },
      checkSummary: {
        type: 'string',
        description: 'Brief note about check outcome (internal, used by hook)',
      },
    },
    required: ['command'],
  },

  handler(args) {
    const { command, description, condition, checkHints, autoCheck, id, status, checkResult, checkSummary } = args;
    let goals = loadGoals();
    const now = new Date().toISOString();

    switch (command) {
      // ── Set a new goal ──
      case 'set': {
        if (!description || !condition) {
          return 'Error: command=set requires both description and condition.\n'
            + 'Usage: smart_goal({command:"set", description:"Refactor auth", condition:"All tests pass"})';
        }
        // Mark any existing active goal as cancelled (can only have one active)
        for (const g of goals) {
          if (g.status === 'active') {
            g.status = 'cancelled';
            g.updatedAt = new Date().toISOString();
          }
        }
        const goal = {
          id: goals.length > 0 ? Math.max(...goals.map(g => g.id)) + 1 : 1,
          description: description.slice(0, 200),
          condition: condition.slice(0, 500),
          checkHints: Array.isArray(checkHints) ? checkHints.slice(0, 5) : [],
          autoCheck: autoCheck !== false, // default true
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
          checkCount: 0,
          lastCheckResult: null,
          lastCheckSummary: null,
          turnCount: 0,
          sessionId: null,
        };
        goals.push(goal);
        // Trim history
        if (goals.length > MAX_HISTORY) {
          goals = goals.slice(-MAX_HISTORY);
        }
        saveGoals(goals);
        return `🎯 Goal #${goal.id} set!\n${formatGoal(goal, true)}\n\n`
          + `I'll keep working until: "${condition}". `
          + (autoCheck !== false ? 'Auto-check is ON — I\'ll verify after each step.' : '');
      }

          // ── Record a check result ──
      case 'check': {
        const active = getActiveGoal(goals);
        if (!active) {
          return '🎯 No active goal. Set one with `ssr({tool:"goal", args:{command:"set", description:"...", condition:"..."}})`.';
        }
        // Store check result when provided
        if (checkResult === 'met' || checkResult === 'unmet') {
          active.checkCount = (active.checkCount || 0) + 1;
          active.lastCheckResult = checkResult;
          active.lastCheckSummary = checkSummary || (checkResult === 'met' ? 'Condition met' : 'Condition not yet met');
          active.updatedAt = now;
          saveGoals(goals);
          if (checkResult === 'met') {
            active.status = 'completed';
            active.completedAt = now;
            saveGoals(goals);
            return `✅ Goal #${active.id} "${active.description}" COMPLETED!\n${formatGoal(active, true)}`;
          }
          return `⏳ Goal #${active.id} check recorded (unmet, ${active.checkCount} total).\n${formatGoal(active, true)}`;
        }
        // No result provided → show check prompt
        return `🎯 Goal #${active.id} check:\n${formatGoal(active, true)}\n\n`
          + `Condition: ${active.condition}\n`
          + (active.checkHints.length > 0 ? `Hints: ${active.checkHints.join(', ')}\n\n` : '\n')
          + `Record result: ssr({tool:"goal", args:{command:"check", checkResult:"met"|"unmet", checkSummary:"..."}})`;
      }

      // ── Show active goal status ──
      case 'status': {
        const active = getActiveGoal(goals);
        if (!active) {
          const recent = goals.filter(g => g.status === 'completed').slice(-3);
          if (recent.length > 0) {
            return '🎯 No active goal. Recently completed:\n' + recent.map(g => formatGoal(g)).join('\n');
          }
          return '🎯 No active goal. Use `ssr({tool:"goal", args:{command:"set", description:"...", condition:"..."}})`.';
        }
        return formatGoal(active, true);
      }

      // ── Clear (complete/cancel/fail) a goal ──
      case 'clear': {
        const targetId = id;
        if (targetId === undefined || targetId === null) {
          const active = getActiveGoal(goals);
          if (!active) return '🎯 No active goal to clear.';
          active.status = status || 'completed';
          active.completedAt = now;
          active.updatedAt = now;
          saveGoals(goals);
          return `✅ Goal #${active.id} "${active.description}" marked ${active.status}.`;
        }
        const found = goals.find(g => g.id === targetId);
        if (!found) return `Error: goal #${targetId} not found.`;
        found.status = status || 'completed';
        found.completedAt = now;
        found.updatedAt = now;
        saveGoals(goals);
        return `✅ Goal #${found.id} "${found.description}" marked ${found.status}.`;
      }

      // ── List goal history ──
      case 'list': {
        return formatGoalList(goals);
      }

      // ── Retry a failed/cancelled goal ──
      case 'retry': {
        if (id === undefined || id === null) {
          const last = [...goals].reverse().find(g => g.status !== 'active');
          if (!last) return 'Error: no previous goal to retry.';
          last.status = 'active';
          last.updatedAt = now;
          last.lastCheckResult = null;
          last.lastCheckSummary = null;
          last.checkCount = 0;
          last.turnCount = 0;
          last.sessionId = null;
          saveGoals(goals);
          return `🔄 Goal #${last.id} "${last.description}" reactivated.\n${formatGoal(last, true)}`;
        }
        const found = goals.find(g => g.id === id);
        if (!found) return `Error: goal #${id} not found.`;
        found.status = 'active';
        found.updatedAt = now;
        found.lastCheckResult = null;
        found.lastCheckSummary = null;
        found.checkCount = 0;
        found.turnCount = 0;
        found.sessionId = null;
        saveGoals(goals);
        return `🔄 Goal #${found.id} "${found.description}" reactivated.\n${formatGoal(found, true)}`;
      }

      default:
        return 'Error: unknown command. Available: set, check, status, clear, list, retry.';
    }
  },
};
