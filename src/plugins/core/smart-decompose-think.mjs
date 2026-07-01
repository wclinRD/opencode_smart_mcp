// ── smart_decompose_think plugin ──
// Qwen3.5-4B 專用推理工具 — 主動 think↔tool 循環 orchestration

import { decomposeThinkHandler } from '../../cli/decompose-think.mjs';

export default {
  name: 'smart_decompose_think',
  responsePolicy: { maxLevel: 0 }, // keep raw format

  description: `For Qwen3.5-4B and similar thinking models: active think↔tool loop orchestration.
Goes beyond smart_decompose by actively suggesting tools based on thought analysis,
tracking tool call cycles, and providing task-specific templates.

Core workflow:
  goal + subtasks + thought + toolCalls + nextNeeded → server enriches →
  active tool suggestion + tool result guidance + cycle detection

Key differences from smart_decompose:
  • Active tool suggestion (not just reading subtask.tool field)
  • Tool call cycle tracking (suggested → called → result → next)
  • Thought uncertainty/confidence parsing
  • Task templates (debug/refactor/search/generic)
  • First-call and boundary handling`,

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
            id: { type: 'number' },
            desc: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'done', 'blocked'],
            },
            tool: { type: 'string', description: 'Suggested MCP tool (optional)' },
            toolArgs: { type: 'object', description: 'Tool arguments (optional)' },
            evidence: { type: 'string', description: 'Completion evidence (optional)' },
          },
          required: ['id', 'desc', 'status'],
        },
      },
      currentSubtaskId: { type: 'number' },
      thought: { type: 'string', description: 'Reasoning content for current subtask' },
      nextNeeded: { type: 'boolean' },
      toolCalls: {
        type: 'array',
        description: 'History of tool calls per subtask',
        items: {
          type: 'object',
          properties: {
            subtaskId: { type: 'number' },
            tool: { type: 'string' },
            args: { type: 'object' },
            result: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'done', 'error'],
            },
          },
        },
      },
      roundType: {
        type: 'string',
        enum: ['think', 'tool_result'],
        description: 'Current round type (auto-corrected if wrong)',
      },
      template: {
        type: 'string',
        enum: ['debug', 'refactor', 'search', 'generic', 'fr-cot'],
        description: 'Task template (default: generic)',
      },
      strictness: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Guidance strictness (default: high)',
      },
      thinkingStyle: {
        type: 'string',
        enum: ['disciplined', 'free'],
        description: 'Output style (default: disciplined)',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID for cross-turn cycle detection',
      },
      _prevToolCalls: {
        type: 'array',
        description: 'Previous round toolCalls (for tracking diff)',
      },
      _prevSuggestion: {
        type: 'object',
        description: 'Previous round tool suggestion (for skip detection)',
      },
    },
    required: ['goal', 'subtasks', 'currentSubtaskId', 'thought', 'nextNeeded'],
  },

  cli: null,

  handler(args) {
    const result = decomposeThinkHandler({
      goal: String(args.goal ?? ''),
      subtasks: Array.isArray(args.subtasks) ? args.subtasks : [],
      currentSubtaskId: Number(args.currentSubtaskId ?? 0),
      thought: String(args.thought ?? ''),
      nextNeeded: Boolean(args.nextNeeded),
      toolCalls: Array.isArray(args.toolCalls) ? args.toolCalls : [],
      roundType: args.roundType || 'think',
      template: args.template || 'generic',
      strictness: args.strictness || 'high',
      thinkingStyle: args.thinkingStyle || 'disciplined',
      sessionId: args.sessionId ? String(args.sessionId) : '_auto',
      _prevToolCalls: Array.isArray(args._prevToolCalls) ? args._prevToolCalls : [],
      _prevSuggestion: args._prevSuggestion || null,
    });

    return result.error
      ? `❌ smart_decompose_think error:\n${result.error}`
      : result.thought;
  },
};
