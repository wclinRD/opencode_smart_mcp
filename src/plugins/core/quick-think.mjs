import { quickThink } from '../../cli/thinking.mjs';
import { getContextBudget } from '../../lib/context-budget.mjs';
import {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
  getDynamicThreshold,
  recordClassification,
  detectDomain,
  getSessionState,
  clearSessionState,
} from '../../lib/think-guard.mjs';

export default {
  name: 'smart_think',
  responsePolicy: { maxLevel: 0 }, // Conversational; keep raw
  description: `Conversational reasoning engine — surpasses sequential-thinking.

Default mode: mode:"cit" (BN-DP auto-branch). Only branches when uncertain — saves ~70% tokens on routine tasks.
  mode:"beam" → explore 2-3 alternative paths with confidence scoring. Use for high-risk decisions.
  mode:"forest" → multi-tree reasoning with consensus voting. Use for complex multi-angle problems.
  mode:"structured" → Grammar-Constrained CoT (GOAL/STATE/ALGO/EDGE/VERIFY — saves 50-70% thinking tokens).
    VERIFY stage includes: scope verification, complementarity vs overlap check, devil's advocate.

Core workflow:
  thought + nextThoughtNeeded=true → hypothesis → verification → repeat → nextThoughtNeeded=false

Think-Guard (3-layer defense):
  Layer 1: Task classification → auto-suggest thinking mode based on task keywords
  Layer 2: Overconfidence detection → warn when CIT under-branches on complex tasks
  Layer 3: VERIFY stage enhancement → scope/complementarity/devil's advocate checks

Phase 2 enhancements:
  2.1: Dynamic threshold — adjusts overconfidence score based on context budget
  2.2: Historical learning — tracks classification accuracy + auto-adjusts weights
  2.3: Cross-tool integration — domain-specific rules for EDA/exa/medical
  2.4: Concurrency safety — session isolation + lock mechanism

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
        enum: ['beam', 'cit', 'forest', 'structured'],
        description: 'Reasoning mode (default: "cit" — BN-DP auto-branch, only branches when uncertain). "beam" for high-risk multi-path exploration. "forest" for multi-angle consensus voting. "structured" for Grammar-Constrained CoT (GOAL/STATE/ALGO/EDGE/VERIFY — saves 50-70% thinking tokens).',
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
      // ── Structured Thinking fields (mode:"structured") ──
      goal: {
        type: 'string',
        description: 'GOAL: One-sentence objective. Used with mode:"structured".',
      },
      state: {
        type: 'string',
        description: 'STATE: Known information and context. Used with mode:"structured".',
      },
      algo: {
        type: 'string',
        description: 'ALGO: Reasoning path and method. Used with mode:"structured".',
      },
      edge: {
        type: 'string',
        description: 'EDGE: Boundary conditions and constraints. Used with mode:"structured".',
      },
      verify: {
        type: 'string',
        description: 'VERIFY: Self-verification logic. Used with mode:"structured".',
      },
      // ── Think-Guard fields ──
      classifyTask: {
        type: 'string',
        description: 'Task description to classify. Returns suggested thinking mode and reasoning. Use before starting a thinking session to choose the right mode.',
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
    // ── Think-Guard: classifyTask subcommand ──
    if (args.classifyTask) {
      const taskDesc = String(args.classifyTask);
      const classification = classifyThinkingMode(taskDesc, args.mode || null);
      let output = `┌─ Task Classification ─────────────────────\n`;
      output += `│ Task: ${taskDesc.slice(0, 80)}${taskDesc.length > 80 ? '...' : ''}\n`;
      output += `│ Suggested mode: ${classification.suggestedMode || '(none — simple task)'}`;
      if (classification.reason) {
        output += `\n│ Reason: ${classification.reason}`;
      }
      if (classification.forceBranch) {
        output += `\n│ ⚡ Force branch: This task type requires multi-path exploration`;
      }
      output += `\n└───────────────────────────────────────────\n`;
      return output;
    }

    // ── Layer 1: Task Classification ──
    // Auto-suggest mode if not specified, based on task content
    let taskSuggestion = null;
    if (!args.mode && args.thought) {
      taskSuggestion = classifyThinkingMode(String(args.thought), null);
    }

    // ── Layer 2: Overconfidence Detection ──
    // Check if CIT mode is under-branching (Phase 2.1: dynamic threshold)
    let overconfidenceWarning = null;
    if (args.mode === 'cit' && args.branchingNeeded === false) {
      // Phase 2.1: Get budget fraction for dynamic threshold
      let budgetFraction = null;
      try {
        const budget = getContextBudget();
        if (budget) budgetFraction = budget.remainingFraction;
      } catch { /* silent */ }

      const detection = detectOverconfidence(
        String(args.thought ?? ''),
        args.branchReasoning ? String(args.branchReasoning) : null,
        false,
        'cit',
        { budgetFraction }
      );
      if (detection.overconfident) {
        overconfidenceWarning = detection;
      }
    }

    // ── Layer 3: VERIFY Stage Enhancement ──
    // Enhance verify field in structured mode + domain-specific additions
    let enhancedArgs = { ...args };
    if (args.mode === 'structured' && args.verify) {
      let verifyText = enhanceVerifyStage(
        String(args.verify),
        String(args.thought ?? '')
      );
      // Phase 2.3: Add domain-specific verify questions
      const domainInfo = detectDomain(String(args.thought ?? ''));
      if (domainInfo.rules?.verifyAdditions?.length) {
        verifyText += '\n── 領域特定檢查 ──';
        for (const q of domainInfo.rules.verifyAdditions) {
          verifyText += `\n  □ ${q}`;
        }
      }
      enhancedArgs.verify = verifyText;
    }

    const result = quickThink({
      thought: String(enhancedArgs.thought ?? ''),
      nextThoughtNeeded: Boolean(enhancedArgs.nextThoughtNeeded),
      thoughtNumber: Number(enhancedArgs.thoughtNumber ?? 1),
      totalThoughts: Number(enhancedArgs.totalThoughts ?? 1),
      mode: enhancedArgs.mode || null,
      beams: Array.isArray(enhancedArgs.beams) ? enhancedArgs.beams : null,
      selectedBeam: enhancedArgs.selectedBeam ? String(enhancedArgs.selectedBeam) : null,
      branchingNeeded: enhancedArgs.branchingNeeded != null ? Boolean(enhancedArgs.branchingNeeded) : null,
      branchReasoning: enhancedArgs.branchReasoning ? String(enhancedArgs.branchReasoning) : null,
      trees: Array.isArray(enhancedArgs.trees) ? enhancedArgs.trees : null,
      consensus: enhancedArgs.consensus || null,
      hypothesis: enhancedArgs.hypothesis ? String(enhancedArgs.hypothesis) : null,
      verification: enhancedArgs.verification ? String(enhancedArgs.verification) : null,
      needsMoreThoughts: Boolean(enhancedArgs.needsMoreThoughts),
      adjustTotalThoughts: enhancedArgs.adjustTotalThoughts != null ? Number(enhancedArgs.adjustTotalThoughts) : null,
      isRevision: Boolean(enhancedArgs.isRevision),
      revisesThought: enhancedArgs.revisesThought != null ? Number(enhancedArgs.revisesThought) : null,
      branchFromThought: enhancedArgs.branchFromThought != null ? Number(enhancedArgs.branchFromThought) : null,
      branchId: enhancedArgs.branchId != null ? String(enhancedArgs.branchId) : null,
      template: enhancedArgs.template || null,
      // Structured thinking fields
      goal: enhancedArgs.goal ? String(enhancedArgs.goal) : null,
      state: enhancedArgs.state ? String(enhancedArgs.state) : null,
      algo: enhancedArgs.algo ? String(enhancedArgs.algo) : null,
      edge: enhancedArgs.edge ? String(enhancedArgs.edge) : null,
      verify: enhancedArgs.verify ? String(enhancedArgs.verify) : null,
    });

    // ── Layer 2: Overconfidence Warning Output ──
    if (overconfidenceWarning) {
      result.output += `\n\n${'─'.repeat(50)}\n⚠️ ${overconfidenceWarning.reason}\n`;
      result.output += `💡 建議改用: smart_think({mode:"beam", thought:"...", nextThoughtNeeded:true})\n`;
    }

    // ── Layer 1: Task Classification Suggestion Output ──
    if (taskSuggestion && taskSuggestion.suggestedMode && taskSuggestion.reason && !args.mode) {
      result.output += `\n\n${'─'.repeat(50)}\n📋 任務分類建議: ${taskSuggestion.suggestedMode} mode\n`;
      result.output += `   ${taskSuggestion.reason}\n`;
      if (taskSuggestion.forceBranch) {
        result.output += `   ⚡ 強制分支：此任務類型需要多路徑探索\n`;
      }
    }

    // Phase 2.2: Record classification history
    try {
      recordClassification({
        task: String(args.thought ?? ''),
        classification: taskSuggestion || classifyThinkingMode(String(args.thought ?? ''), args.mode),
        overconfidence: overconfidenceWarning,
        outcome: 'unknown',
      });
    } catch { /* silent — history recording is best-effort */ }

    // Phase 34: Budget-aware thinking hint — append when budget is low
    try {
      const budget = getContextBudget();
      if (budget && budget.remainingFraction < 0.60) {
        const rec = budget.getThinkingRecommendation({ requestedMode: args.mode });
        result.output += `\n\n${'─'.repeat(50)}\n📊 ${rec.suggestion}\n`;
        if (budget.remainingFraction < 0.30) {
          result.output += `💡 Try: smart_think({mode:"structured", goal:"...", state:"...", algo:"...", edge:"...", verify:"...", thoughtNumber:1, totalThoughts:3, nextThoughtNeeded:true})\n`;
        }
      }
    } catch { /* silent — budget hint is best-effort */ }

    return result.output;
  },
};
