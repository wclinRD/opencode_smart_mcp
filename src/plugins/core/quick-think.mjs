import { quickThink } from '../../cli/thinking.mjs';

export default {
  name: 'smart_think',
  responsePolicy: { maxLevel: 0 }, // Conversational; keep raw
  description: `Conversational reasoning engine — surpasses sequential-thinking.

Default mode: mode:"cit" (BN-DP auto-branch). Only branches when uncertain — saves ~70% tokens on routine tasks.
  mode:"beam" → explore 2-3 alternative paths with confidence scoring. Use for high-risk decisions.
  mode:"forest" → multi-tree reasoning with consensus voting. Use for complex multi-angle problems.

Core workflow:
  thought + nextThoughtNeeded=true → hypothesis → verification → repeat → nextThoughtNeeded=false

Supports: template guidance (debug/refactor/architecture...), branchFromThought, isRevision,
needsMoreThoughts (beyond initial plan), adjustTotalThoughts (mid-stream expansion).
Returns done flag + optional updated totalThoughts.`,
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
      mode: {
        type: 'string',
        enum: ['beam', 'cit', 'forest'],
        description: 'Reasoning mode (default: "cit" — BN-DP auto-branch, only branches when uncertain). "beam" for high-risk multi-path exploration. "forest" for multi-angle consensus voting.',
      },
      beams: {
        type: 'array',
        description: 'Pre-defined beam paths for multi-path reasoning. Each beam: {name, content, confidence}. Used with mode:"beam" or mode:"cit" when branchingNeeded=true.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Path name (e.g. "Path A")' },
            content: { type: 'string', description: 'The reasoning content for this path' },
            confidence: { type: 'number', description: 'Confidence score 1-10' },
          },
        },
      },
      selectedBeam: {
        type: 'string',
        description: 'Name of the selected/correct beam path (e.g. "Path C"). Used with mode:"beam" or mode:"cit" when branchingNeeded=true.',
      },
      branchingNeeded: {
        type: 'boolean',
        description: 'CiT BN-DP assessment result. true = branching needed (explore multiple paths). false = chain mode (single path sufficient). Used with mode:"cit" only.',
      },
      branchReasoning: {
        type: 'string',
        description: 'CiT BN-DP reasoning: why branching is or is not needed at this step. Used with mode:"cit" only.',
      },
      trees: {
        type: 'array',
        description: 'Forest-of-Thought trees. Each: {name:string, branches:[{name,content,confidence}], selectedBranch:string}. Used with mode:"forest".',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tree name (e.g. "Static Analysis", "Dynamic Analysis")' },
            branches: {
              type: 'array',
              description: 'Reasoning branches within this tree',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Branch name' },
                  content: { type: 'string', description: 'Branch reasoning content' },
                  confidence: { type: 'number', description: 'Confidence score 1-10' },
                },
              },
            },
            selectedBranch: { type: 'string', description: 'Name of the best branch in this tree' },
          },
        },
      },
      consensus: {
        type: 'object',
        description: 'Forest-of-Thought consensus result — cross-tree voting. Used with mode:"forest".',
        properties: {
          conclusion: { type: 'string', description: 'Winning conclusion from across all trees' },
          agreeingTrees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tree names that agree on the conclusion',
          },
          totalTrees: { type: 'number', description: 'Total number of trees' },
          confidence: { type: 'number', description: 'Overall confidence 1-10' },
          primaryTree: { type: 'string', description: 'Tree name with strongest evidence' },
        },
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
      mode: args.mode || null,
      beams: Array.isArray(args.beams) ? args.beams : null,
      selectedBeam: args.selectedBeam ? String(args.selectedBeam) : null,
      branchingNeeded: args.branchingNeeded != null ? Boolean(args.branchingNeeded) : null,
      branchReasoning: args.branchReasoning ? String(args.branchReasoning) : null,
      trees: Array.isArray(args.trees) ? args.trees : null,
      consensus: args.consensus || null,
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
