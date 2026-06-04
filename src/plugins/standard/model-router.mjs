// model-router.mjs → smart_model_router
// Phase 14: Multi-Model Orchestration — MCP tool entry point.
//
// Routes tasks to optimal tier based on type, cost, and availability.
// Supports cost tracking, degradation fallback, and savings estimation.
//
// Features:
// - Tier classification: structure→T1, qna→T2, debug→T3, refactor→T4
// - Cost tracking: cumulative session cost + per-tier breakdown
// - Degradation: auto-fallback T4→T3→T2→T1 when provider unavailable
// - Route suggestion: from natural language question → tier + tool
//
// Examples:
//   { command: "route", task: "who calls foo()", tier: "auto" }
//     → { tier: "deterministic", cost: 0, tool: "smart_code_query" }
//
//   { command: "report" }
//     → { cumulativeCost: 0.12, totalCalls: 42, byTier: {t1: 30, t2: 8, t3: 3, t4: 1} }
//
//   { command: "suggest", question: "what if I rename authenticate()" }
//     → { tier: 1, tool: "smart_code_impact", estimatedCost: 0 }

import {
  TIERS,
  TASK_TIERS,
  classifyTask,
  suggestTierForTool,
  getCostReport,
  resetCostTracking,
  routeTask,
  estimateSavings,
  suggestRoute,
  registerProvider,
} from '../../lib/model-router.mjs';

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_model_router',
  category: 'standard',
  description: `Multi-Model Orchestration — routes tasks to optimal cost/tier.

Phase 14: Dynamic tier selection for token efficiency and cost optimization.
Classifies tasks into 4 tiers and routes accordingly:

  Tier 1 (deterministic, $0)    — CKG, LSP, grep: "who calls foo()"
  Tier 2 (local small, $0.001)  — Local model: "what does this do?"
  Tier 3 (medium API, $0.01)    — Medium model: "debug this error"
  Tier 4 (strong API, $0.05)    — Strongest model: "refactor this module"

Commands:
  route   → classify a task and estimate cost
  report  → show cost tracking report
  suggest → suggest optimal tier + tool from a natural language question
  savings → estimate savings vs all-T4 baseline
  tool    → suggest tier for a specific tool name
  tiers   → list all defined tiers
  reset   → reset cost tracking counters`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['route', 'report', 'suggest', 'savings', 'tool', 'tiers', 'reset'],
        description: 'Command: route (classify), report (cost), suggest (question→tier), savings (estimate), tool (tier for tool), tiers (list), reset (counters)',
      },
      task: {
        type: 'string',
        description: 'Task description or type (for "route" command)',
      },
      tier: {
        type: 'string',
        description: 'Target tier: "auto" (default), "T1"-"T4", or tier ID 1-4 (for "route" command)',
      },
      question: {
        type: 'string',
        description: 'Natural language question (for "suggest" command)',
      },
      tool: {
        type: 'string',
        description: 'Tool name to suggest tier for (for "tool" command, e.g. "smart_grep")',
      },
      callPattern: {
        type: 'object',
        description: 'Call pattern for savings estimation (for "savings" command, e.g. {"t1": 100, "t2": 50, "t3": 20, "t4": 5})',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
    },
    required: ['command'],
  },
  handler: async (args) => {
    const command = args.command;
    const format = args.format || 'text';

    switch (command) {
      // -----------------------------------------------------------------------
      // Route: classify a task to optimal tier
      // -----------------------------------------------------------------------
      case 'route': {
        const task = args.task || '';
        const tier = args.tier || 'auto';

        // Parse tier argument
        let tierArg = 'auto';
        if (tier === '1' || tier === 1) tierArg = 1;
        else if (tier === '2' || tier === 2) tierArg = 2;
        else if (tier === '3' || tier === 3) tierArg = 3;
        else if (tier === '4' || tier === 4) tierArg = 4;
        else if (tier === 'T1' || tier === 'T1') tierArg = 1;
        else if (tier === 'T2') tierArg = 2;
        else if (tier === 'T3') tierArg = 3;
        else if (tier === 'T4') tierArg = 4;

        const result = await routeTask({
          task,
          tier: tierArg,
          trackOnly: true,
          context: { taskType: task },
        });

        if (format === 'json') {
          return JSON.stringify({
            task,
            ...result,
            _tierInfo: result.classification?.tier,
          }, null, 2);
        }

        const c = result.classification;
        if (!c) return `Error: ${result.error || 'classification failed'}`;

        let text = `🎯 Route Result\n${'─'.repeat(40)}\n`;
        text += `Task:         ${task.slice(0, 80)}\n`;
        text += `Tier:         ${c.tier.name} (T${c.tier.id})\n`;
        text += `Confidence:   ${Math.round(c.confidence * 100)}%\n`;
        text += `Source:       ${c.source}\n`;
        text += `Est. Cost:    $${c.tier.costPerCall.toFixed(3)}/call\n`;
        text += `Est. Latency: ${c.tier.latency}\n`;
        text += `Description:  ${c.tier.description}\n`;

        if (c.tier.id > 1) {
          const chain = [c.tier.name, ...(c.tier.id > 2 ? [] : [])];
          text += `\nDegradation chain: ${['T4', 'T3', 'T2', 'T1'].slice(4 - c.tier.id).join(' → ')}\n`;
        }

        return text;
      }

      // -----------------------------------------------------------------------
      // Report: show cost tracking
      // -----------------------------------------------------------------------
      case 'report': {
        return getCostReport({ format });
      }

      // -----------------------------------------------------------------------
      // Suggest: natural language → tier + tool
      // -----------------------------------------------------------------------
      case 'suggest': {
        const q = args.question || '';
        const suggestion = suggestRoute(q);

        if (format === 'json') {
          return JSON.stringify(suggestion, null, 2);
        }

        let text = `💡 Route Suggestion\n${'─'.repeat(40)}\n`;
        text += `Question:     ${q.slice(0, 80)}\n`;
        text += `Tier:         T${suggestion.tier} (${suggestion.tierName})\n`;
        text += `Est. Cost:    $${suggestion.estimatedCost.toFixed(3)}\n`;
        text += `Tool:         ${suggestion.tool}\n`;
        text += `Reasoning:    ${suggestion.reasoning}\n`;

        // Cost comparison
        if (suggestion.tier < 4) {
          const saved = ((0.05 - suggestion.estimatedCost) / 0.05 * 100).toFixed(0);
          text += `\nSavings:      ${saved}% vs default T4 routing\n`;
        }

        return text;
      }

      // -----------------------------------------------------------------------
      // Tool: suggest tier for a tool name
      // -----------------------------------------------------------------------
      case 'tool': {
        const toolName = args.tool || '';
        const tierId = suggestTierForTool(toolName);
        const tierInfo = Object.values(TIERS).find(t => t.id === tierId);

        if (format === 'json') {
          return JSON.stringify({ tool: toolName, tier: tierId, tierName: tierInfo?.name, cost: tierInfo?.costPerCall });
        }

        let text = `🔧 Tool Tier Suggestion\n${'─'.repeat(40)}\n`;
        text += `Tool:         ${toolName}\n`;
        text += `Tier:         T${tierId} (${tierInfo?.name || 'unknown'})\n`;
        text += `Est. Cost:    $${(tierInfo?.costPerCall || 0).toFixed(3)}\n`;
        return text;
      }

      // -----------------------------------------------------------------------
      // Tiers: list all tiers
      // -----------------------------------------------------------------------
      case 'tiers': {
        const tierList = Object.values(TIERS).map(t => ({
          id: t.id,
          name: t.name,
          costPerCall: t.costPerCall,
          latency: t.latency,
          description: t.description,
        }));

        if (format === 'json') {
          return JSON.stringify({ tiers: tierList, taskMapping: Object.entries(TASK_TIERS).map(([task, tier]) => ({ task, tier: tier.name })) });
        }

        let text = `📋 Tier Definitions\n${'─'.repeat(40)}\n`;
        for (const t of tierList) {
          text += `\nT${t.id} ${t.name.padEnd(16)} $${t.costPerCall.toFixed(3)}  ${t.latency.padEnd(12)} ${t.description}`;
        }
        text += `\n\n${'─'.repeat(40)}\nTask → Tier Mappings:\n`;
        for (const [task, tier] of Object.entries(TASK_TIERS)) {
          text += `  ${task.padEnd(20)} → T${tier.id} (${tier.name})\n`;
        }
        return text;
      }

      // -----------------------------------------------------------------------
      // Savings: estimate vs all-T4
      // -----------------------------------------------------------------------
      case 'savings': {
        const pattern = args.callPattern || {};
        const est = estimateSavings(pattern);

        if (format === 'json') {
          return JSON.stringify(est, null, 2);
        }

        let text = `💰 Savings Estimate\n${'─'.repeat(40)}\n`;
        text += `Total Calls:  ${est.totalCalls}\n`;
        text += `All-T4 Cost:  $${est.allT4Cost.toFixed(4)}\n`;
        text += `Actual Cost:  $${est.actualCost.toFixed(4)}\n`;
        text += `Savings:      $${est.savings.toFixed(4)} (${est.savingsPercent}%)\n`;
        return text;
      }

      // -----------------------------------------------------------------------
      // Reset: clear cost counters
      // -----------------------------------------------------------------------
      case 'reset': {
        resetCostTracking();
        return '✅ Cost tracking counters reset.';
      }

      default:
        return `Unknown command: ${command}. Available: route, report, suggest, savings, tool, tiers, reset.`;
    }
  },
};
