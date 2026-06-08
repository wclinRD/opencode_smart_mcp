// agent-recommend.mjs — Smart Agent tool recommendation (thin wrapper)
//
// Phase 3: Now a thin wrapper around hybrid-engine.mjs classification +
// getGeneralRecommendation(). No longer depends on smart-agent/tool-strategy.
// All recommendation logic is centralized in hybrid-engine.mjs.
//
// Usage:
//   smart_run(tool: "agent_recommend", args: { goal: "debug login error" })
//   smart_run(tool: "agent_recommend", args: { goal: "refactor auth", context: "used smart_grep already" })

import { classifyQuestion, getGeneralRecommendation } from '../../lib/hybrid-engine.mjs';

export default {
  name: 'smart_agent_recommend',
  category: 'meta',
  description: 'Use when: the LLM is unsure which smart-mcp tool to use for a given goal, or wants a deterministic tool recommendation. Analyzes the goal and returns the optimal tool chain. Now powered by the same unified classifier as hybrid_router. Also useful for small/weak models that benefit from code-driven tool selection. Avoid when: you already know which tool to use.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Task description to analyze (e.g. "debug login error", "refactor auth module")',
      },
      context: {
        type: 'string',
        description: 'Optional context about what has been done already (e.g. "already used smart_grep") — appended to goal for richer matching',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
    },
    required: ['goal'],
  },
  async handler(args) {
    try {
      const { goal, context, format = 'text' } = args;
      if (!goal) return '❌ goal is required. Usage: smart_agent_recommend({ goal: "debug login error" })';

      // Enrich goal with context
      const enrichedGoal = context ? `${goal} (context: ${context})` : goal;

      // Use unified classifier (same engine as hybrid_router)
      const classification = classifyQuestion(enrichedGoal);

      if (classification.category === 'general') {
        // General task — use DOMAIN_MAP recommendation
        const rec = getGeneralRecommendation(classification, enrichedGoal);
        if (rec) {
          if (format === 'json') {
            return JSON.stringify({
              recommendation: {
                primary: rec.tools[0] || '',
                alternatives: rec.tools.slice(1),
                chain: rec.workflow,
                reason: rec.description,
                matchScore: rec.confidence,
              },
              toolChain: rec.workflow.map((step, i) => ({
                tool: step.match(/`([^`]+)`/)?.[1] || step,
                dependsOn: i > 0 ? [i - 1] : [],
                reason: `Step ${i + 1}: ${step}`,
              })),
              domain: rec.domain,
              skill: rec.skill,
              _hint: 'Call each tool in chain order via smart_run(tool: "<tool_name>", args: {...}) or load skill via skill("<name>")',
            }, null, 2);
          }

          return `**Recommended**: \`${rec.tools[0] || '(none)'}\`` +
            `\n**Domain**: ${rec.domain}` +
            (rec.skill ? `\n**Skill**: \`skill("${rec.skill}")\`` : '') +
            `\n**Alternatives**: ${rec.tools.slice(1).map(t => `\`${t}\``).join(', ') || '(none)'}` +
            `\n**Tool chain**: ${rec.workflow.map(s => `\`${s}\``).join(' → ')}` +
            `\n**Reason**: ${rec.description}` +
            `\n**Confidence**: ${rec.confidence > 0.8 ? 'High' : rec.confidence > 0.5 ? 'Medium' : 'Low'}` +
            `\n\n💡 Load skill: skill("${rec.skill}") (if available) or call each tool via smart_run(tool: "<tool_name>", args: {...})`;
        }
      }

      // Code task or unclear — use classification tools
      const tools = classification.tools || [];
      const primary = tools[0] || 'smart_think';
      const alternatives = tools.slice(1);

      if (format === 'json') {
        return JSON.stringify({
          recommendation: {
            primary,
            alternatives,
            chain: [primary, ...alternatives],
            reason: classification.description || 'Analyze task with available tools',
            matchScore: classification.confidence || 0.3,
          },
          toolChain: [primary, ...alternatives].map((t, i) => ({
            tool: t,
            dependsOn: i > 0 ? [i - 1] : [],
            reason: i === 0 ? `Start with ${t}` : `Follow up with ${t}`,
          })),
          classification: classification.category,
          confidence: classification.confidence,
          _hint: 'Call each tool in order via smart_run(tool: "<tool_name>", args: {...})',
        }, null, 2);
      }

      return `**Recommended**: \`${primary}\`` +
        `\n**Category**: ${classification.category}` +
        `\n**Alternatives**: ${alternatives.map(t => `\`${t}\``).join(', ') || '(none)'}` +
        `\n**Tool chain**: ${[primary, ...alternatives].map(t => `\`${t}\``).join(' → ')}` +
        `\n**Reason**: ${classification.description || 'Analyze task with available tools'}` +
        `\n**Confidence**: ${classification.confidence > 0.8 ? 'High' : classification.confidence > 0.5 ? 'Medium' : 'Low'}` +
        `\n\n💡 Call each tool in order via smart_run(tool: "<tool_name>", args: {...})`;
    } catch (err) {
      return `❌ Error analyzing goal: ${err.message}`;
    }
  },
};
