import { quickThink } from '../../cli/thinking.mjs';

export default {
  name: 'smart_think',
  responsePolicy: { maxLevel: 0 }, // Conversational; keep raw
  description: `Advanced conversational reasoning engine — surpasses sequential-thinking.

Supports full hypothesis → verify → repeat cycle with structured output. Use for multi-step reasoning, debugging, decision analysis, and research exploration.

Core workflow:
  1. Start reasoning: thought + nextThoughtNeeded=true
  2. Each step: add hypothesis to test, or verification to confirm/reject
  3. Continue: set nextThoughtNeeded=true to keep going
  4. Adjust plan mid-stream: set needsMoreThoughts=true + adjustTotalThoughts
  5. Complete: set nextThoughtNeeded=false

Key features:
  - Hypothesis generation + verification with auto-verdict detection
  - Dynamic total adjustment mid-stream (adjustTotalThoughts)
  - needsMoreThoughts flag for beyond-initial-plan exploration
  - Revision with explicit cross-reference (isRevision + revisesThought)
  - Branching with named paths (branchFromThought + branchId)
  - Optional template guidance (debug/refactor/feature/research/decision/analyze/plan_execute/retrospect/architecture)
  - Returns done flag + optional updated totalThoughts`,
  inputSchema: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Current thinking step content',
      },
      nextThoughtNeeded: {
        type: 'boolean',
        description: 'Whether more reasoning steps are needed',
      },
      thoughtNumber: {
        type: 'number',
        description: 'Current thought number in sequence (default: 1)',
      },
      totalThoughts: {
        type: 'number',
        description: 'Total estimated thoughts needed (default: 1)',
      },
      hypothesis: {
        type: 'string',
        description: 'Generate a testable hypothesis. Triggers structured hypothesis output section.',
      },
      verification: {
        type: 'string',
        description: 'Verify a previous hypothesis. Auto-detects pass/fail from content (confirm/reject). Triggers structured verification output section with verdict icon.',
      },
      needsMoreThoughts: {
        type: 'boolean',
        description: 'Signal that more reasoning steps are needed beyond initial totalThoughts plan. Shows adjusted total in output.',
      },
      adjustTotalThoughts: {
        type: 'number',
        description: 'Adjust totalThoughts upward mid-stream (e.g. when new sub-problems discovered). Overrides totalThoughts for display.',
      },
      isRevision: {
        type: 'boolean',
        description: 'Whether this revises previous thinking',
      },
      revisesThought: {
        type: 'number',
        description: 'Which thought number is being revised',
      },
      branchFromThought: {
        type: 'number',
        description: 'Branching point thought number',
      },
      branchId: {
        type: 'string',
        description: 'Branch identifier name',
      },
      template: {
        type: 'string',
        enum: ['debug', 'refactor', 'feature', 'research', 'decision', 'analyze', 'plan_execute', 'retrospect', 'architecture'],
        description: 'Optional template for structured reasoning guidance',
      },
    },
    required: ['thought', 'nextThoughtNeeded'],
  },
  cli: null, // No CLI equivalent — handler only
  mapArgs() {
    return [];
  },
  /** Direct handler — no process spawn overhead */
  handler(args) {
    const result = quickThink({
      thought: String(args.thought ?? ''),
      nextThoughtNeeded: Boolean(args.nextThoughtNeeded),
      thoughtNumber: Number(args.thoughtNumber ?? 1),
      totalThoughts: Number(args.totalThoughts ?? 1),
      hypothesis: args.hypothesis ? String(args.hypothesis) : null,
      verification: args.verification ? String(args.verification) : null,
      needsMoreThoughts: Boolean(args.needsMoreThoughts),
      adjustTotalThoughts: args.adjustTotalThoughts != null ? Number(args.adjustTotalThoughts) : null,
      isRevision: Boolean(args.isRevision),
      revisesThought: args.revisesThought != null ? Number(args.revisesThought) : null,
      branchFromThought: args.branchFromThought != null ? Number(args.branchFromThought) : null,
      branchId: args.branchId != null ? String(args.branchId) : null,
      template: args.template || null,
    });
    return result.output;
  },
};
