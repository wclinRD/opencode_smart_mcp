// ── smart_decompose plugin ──
// 小模型專用推理 scaffold — 強制任務分解 + 工具引導 + 循環檢測

import { decomposeHandler } from '../../cli/decompose.mjs';

let getContextBudget = null;
try {
  const ctx = await import('../../lib/context-budget.mjs');
  getContextBudget = () => ctx.getContextBudget();
} catch {
  // budget check is best-effort
}

export default {
  name: 'smart_decompose',
  responsePolicy: { maxLevel: 0 }, // keep raw format

  description: `For small models (3-5B parameters): forces structured task decomposition
with tool suggestions, progress tracking, and cycle detection.
Use when the task requires 2+ steps like debugging, refactoring, or multi-file changes.
NOT for simple Q&A or single-step tasks.

Core workflow:
  goal + subtasks + thought + nextNeeded=true → server enriches →
  progress bar + tool suggestion + cycle intervention + budget warning

Benefits for small models:
  • Prevents "lazy reasoning" (D-CORE): forces subtask decomposition
  • Prevents overthinking (D-CoT): disciplined output format
  • Suggests tools (TRICE): reduces model's tool selection burden
  • Detects loops (TrigReason): breaks reasoning deadlocks`,

  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'One-sentence task objective (required)',
      },
      subtasks: {
        type: 'array',
        description: 'Task decomposition — at least 1, max 10 items',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Unique subtask ID (1-based)' },
            desc: { type: 'string', description: 'Subtask description (10-50 chars)' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'done', 'blocked'],
              description: 'Current status',
            },
            tool: { type: 'string', description: 'Suggested MCP tool for this step (optional)' },
            toolArgs: { type: 'object', description: 'Tool arguments (optional, JSON)' },
            evidence: { type: 'string', description: 'Completion evidence summary (optional)' },
          },
          required: ['id', 'desc', 'status'],
        },
      },
      currentSubtaskId: {
        type: 'number',
        description: 'ID of the currently active subtask',
      },
      thought: {
        type: 'string',
        description: 'Reasoning content for the current subtask',
      },
      nextNeeded: {
        type: 'boolean',
        description: 'Whether more reasoning steps are needed',
      },
      strictness: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Guidance strictness (default: high). High=full scaffold, low=minimal',
      },
      contextHints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords for context retrieval (optional)',
      },
      thinkingStyle: {
        type: 'string',
        enum: ['disciplined', 'free'],
        description: 'Output style (default: disciplined). disciplined=[FACT]/[REASON]/[CONCLUSION]',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID for cross-turn cycle detection (optional, auto-generated)',
      },
    },
    required: ['goal', 'subtasks', 'currentSubtaskId', 'thought', 'nextNeeded'],
  },

  cli: null,

  handler(args) {
    const result = decomposeHandler({
      goal: String(args.goal ?? ''),
      subtasks: Array.isArray(args.subtasks) ? args.subtasks : [],
      currentSubtaskId: Number(args.currentSubtaskId ?? 0),
      thought: String(args.thought ?? ''),
      nextNeeded: Boolean(args.nextNeeded),
      strictness: args.strictness || 'high',
      contextHints: Array.isArray(args.contextHints) ? args.contextHints : [],
      thinkingStyle: args.thinkingStyle || 'disciplined',
      sessionId: args.sessionId ? String(args.sessionId) : '_auto',
      _getBudgetFn: getContextBudget, // inject for budget check
    });

    // Return formatted text output (consistent with smart_think pattern)
    return result.error
      ? `❌ smart_decompose error:\n${result.error}`
      : result.thought;
  },
};
