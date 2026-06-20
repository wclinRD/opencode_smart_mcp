// memory-integration.mjs — Smart Agent memory auto-integration
//
// Automatically decides when to store tool results into memory-store,
// and when to query memory before executing diagnostic tools.
//
// Usage:
//   import { shouldRemember, queryWithMemory, formatMemoryResult } from 'smart-agent/memory-integration';
//   const decision = shouldRemember('smart_error_diagnose', args, result);
//   if (decision) { /* auto-store result */ }

import { getMemoryDB } from '../../../../src/lib/memory-db.mjs';

// ---------------------------------------------------------------------------
// Memory-worthy event detectors
// ---------------------------------------------------------------------------

const MEMORY_RULES = [
  // Failed error diagnosis → highly valuable to remember
  {
    test: (toolName, args, result) =>
      toolName === 'smart_error_diagnose' &&
      !result.ok &&
      (args.error || args._error),
    type: 'resolution',
    score: 0.9,
    reason: 'Failed error diagnosis: remember this error pattern to avoid repeating',
  },
  // Successful cross-file edit → valuable refactoring pattern
  {
    test: (toolName, args, result) =>
      toolName === 'smart_cross_file_edit' &&
      result.ok === true,
    type: 'refactor-success',
    score: 0.8,
    reason: 'Successful cross-file refactor: store pattern for similar future refactors',
  },
  // Failed cross-file edit → what not to do
  {
    test: (toolName, args, result) =>
      toolName === 'smart_cross_file_edit' &&
      !result.ok,
    type: 'refactor-failure',
    score: 0.7,
    reason: 'Failed cross-file edit: remember what went wrong to avoid future conflicts',
  },
  // Security finding confirmed → important to track
  {
    test: (toolName, args, result) =>
      toolName === 'smart_security' &&
      result.ok === true &&
      result.findings &&
      result.findings.length > 0,
    type: 'security-pattern',
    score: 0.75,
    reason: 'Security vulnerability found: remember the pattern for future audits',
  },
  // Successful fix via debug → valuable debugging pattern
  {
    test: (toolName, args, result) =>
      toolName === 'smart_debug' &&
      result.ok === true &&
      result.rootCause,
    type: 'debug-pattern',
    score: 0.7,
    reason: 'Root cause identified: store debugging pattern for similar issues',
  },
  // Test failure resolution
  {
    test: (toolName, args, result) =>
      toolName === 'smart_test' &&
      !result.ok &&
      args.focus === 'all',
    type: 'test-failure',
    score: 0.6,
    reason: 'Test suite failure: remember failing test patterns',
  },
  // Task completed → auto-checkpoint
  {
    test: (toolName, args, result) =>
      toolName === 'boulder_task_update' &&
      args.status === 'completed',
    type: 'boulder-checkpoint',
    score: 0.6,
    reason: 'Task completed: save checkpoint for continuation',
  },
  // Session ending with active plan → remember state
  {
    test: (toolName, args, result) =>
      toolName === 'smart_session_end' ||
      (toolName === 'smart_context' && args.command === 'reset'),
    type: 'boulder-session-end',
    score: 0.7,
    reason: 'Session ending with active plan: preserve state for resume',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine if a tool result is worth remembering.
 * @param {string} toolName - Name of the tool that was called
 * @param {object} args - Arguments passed to the tool
 * @param {object} result - Result from the tool
 * @returns {{ shouldStore: boolean, type: string, score: number, reason: string } | null}
 */
export function shouldRemember(toolName, args, result) {
  for (const rule of MEMORY_RULES) {
    if (rule.test(toolName, args, result)) {
      return {
        shouldStore: true,
        type: rule.type,
        score: rule.score,
        reason: rule.reason,
        category: inferCategory(toolName, args),
      };
    }
  }
  return null;
}

/**
 * Generate the smart_memory_store command to store a result.
 * @param {string} toolName - Tool that was executed
 * @param {object} args - Tool arguments
 * @param {object} result - Tool result
 * @param {object} memoryDecision - Output from shouldRemember()
 * @returns {{ command: string, storeArgs: object }}
 */
export function buildStoreCommand(toolName, args, result, memoryDecision) {
  const resolution = buildResolution(toolName, args, result);
  const toolsUsed = [toolName];

  const storeArgs = {
    command: 'store',
    resolution,
    tools: toolsUsed.join(','),
    category: memoryDecision.category || inferCategory(toolName, args),
    success: result.ok !== false,
  };

  return {
    command: `smart_memory_store store --resolution "${resolution.replace(/"/g, '\\"')}" --tools "${toolsUsed.join(',')}" --category "${storeArgs.category}" --success ${storeArgs.success}`,
    storeArgs,
  };
}

/**
 * Format a memory search result for display to the agent.
 * @param {object} memoryResult - Result from smart_memory_store search
 * @returns {string} Formatted string
 */
export function formatMemoryResult(memoryResult) {
  if (!memoryResult || memoryResult.ok === false) {
    return 'No relevant memories found.';
  }

  const entries = memoryResult.results || memoryResult.entries || [];
  if (entries.length === 0) {
    return 'No relevant memories found.';
  }

  let output = `**Found ${entries.length} relevant memory entr${entries.length === 1 ? 'y' : 'ies'}:**\n\n`;
  for (const entry of entries.slice(0, 5)) {
    output += `- **${entry.category || 'general'}** (confidence: ${Math.round((entry.score || entry.hitCount || 0) * 100)}%)\n`;
    output += `  Resolution: ${entry.resolution || 'N/A'}\n`;
    output += `  Tools used: ${(entry.tools || entry.toolsUsed || []).join(', ')}\n`;
    if (entry.hitCount) output += `  Previously used: ${entry.hitCount} time(s)\n`;
    output += '\n';
  }
  return output;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferCategory(toolName, args) {
  const categoryMap = {
    smart_error_diagnose: 'runtime',
    smart_cross_file_edit: 'refactor',
    smart_security: 'security',
    smart_debug: 'runtime',
    smart_test: 'test',

    smart_grep: 'search',
    smart_learn: 'build',
    smart_git_commit: 'git',
    smart_git_review: 'git',
  };
  return categoryMap[toolName] || 'unknown';
}

function buildResolution(toolName, args, result) {
  const parts = [];
  if (args.error || args._error) parts.push(`Error: ${args.error || args._error}`);
  if (result.rootCause) parts.push(`Root cause: ${result.rootCause}`);
  if (result.fix) parts.push(`Fix: ${result.fix}`);
  if (result.summary) parts.push(result.summary);
  if (args.pattern) parts.push(`Pattern: ${args.pattern}`);

  return parts.length > 0
    ? parts.join('; ')
    : `${toolName} executed with ${JSON.stringify(args)}`;
}

// ---------------------------------------------------------------------------
// Boulder integration
// ---------------------------------------------------------------------------

/**
 * 取得 core_memory 同步指令陣列。
 * 有 active plan 時回傳 [{ block, operation, content }, ...]，
 * 無 active plan 時回傳空陣列（不影響正常啟動）。
 *
 * 消費端（agent 啟動流程）應迭代執行 core_memory_update：
 *   const cmds = getBoulderSyncCommands();
 *   for (const cmd of cmds) {
 *     core_memory_update(cmd);
 *   }
 *
 * @returns {Array<{ block: string, operation: string, content: string }>}
 */
export function getBoulderSyncCommands() {
  try {
    const ctx = getBoulderContext();
    if (!ctx || !ctx.hasActivePlan) return [];

    return [
      { block: 'goal', operation: 'replace', content: ctx.goal },
      { block: 'progress', operation: 'replace', content: ctx.progress },
    ];
  } catch {
    // DB 不可用 — 跳過 Boulder
    return [];
  }
}

/**
 * Query active Boulder plan context for agent injection.
 * Returns structured data for core_memory sync.
 * @returns {{ hasActivePlan: boolean, goal: string, progress: string, currentTask: string|null, nextIntent: string|null }|null}
 */
export function getBoulderContext() {
  try {
    const db = getMemoryDB();
    const plan = db.getActivePlan();
    if (!plan) return null;

    const ctx = db.getContinuationContext(plan.id);
    if (!ctx) return null;

    return {
      hasActivePlan: true,
      goal: plan.name,
      progress: ctx.progress,
      currentTask: ctx.currentTask?.name || null,
      nextIntent: ctx.checkpoint?.next_intent || null,
      currentTaskId: ctx.currentTask?.id || null,
    };
  } catch {
    // DB not available — skip Boulder context
    return null;
  }
}
