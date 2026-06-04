// agent-recommend.mjs — Smart Agent tool recommendation
//
// Analyzes a goal description and recommends the optimal tool chain.
// Useful when the LLM model is unsure which tools to use for a given task.
// Also serves as a deterministic fallback for small/weak models.
//
// Usage:
//   smart_run(tool: "agent_recommend", args: { goal: "debug login error" })
//   smart_run(tool: "agent_recommend", args: { goal: "refactor auth", context: "used smart_grep already" })

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'smart_agent_recommend',
  category: 'meta',
  description: 'Use when: the LLM is unsure which smart-mcp tool to use for a given goal, or wants a deterministic tool recommendation. Analyzes the goal and returns the optimal tool chain. Also useful for small/weak models that benefit from code-driven tool selection. Avoid when: you already know which tool to use.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Task description to analyze (e.g. "debug login error", "refactor auth module")',
      },
      context: {
        type: 'string',
        description: 'Optional context about what has been done already (e.g. "already used smart_grep")',
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

      // Load smart-agent engine (resolve relative to this plugin file)
      const smartAgentPath = resolve(__dirname, '..', '..', '..', 'smart-agent', 'src', 'index.mjs');
      const smart = await import(`file://${smartAgentPath}`);
      const { recommendTools, explainRecommendation, buildToolChain } = smart;

      // Parse optional context
      const ctx = {};
      if (context) {
        ctx.recentTools = context.split(',').map(s => s.trim()).filter(s => s.startsWith('smart_'));
      }

      const rec = recommendTools(goal, ctx);
      const chain = buildToolChain(goal);

      if (format === 'json') {
        return JSON.stringify({
          recommendation: rec,
          toolChain: chain,
          _hint: 'Call each tool in chain order via smart_run(tool: "<tool_name>", args: {...})',
        }, null, 2);
      }

      return explainRecommendation(rec) +
        `\n\n**Chain with dependencies**:\n` +
        chain.map((s, i) => `  ${i}. \`${s.tool}\`${s.dependsOn.length > 0 ? ` (after step ${s.dependsOn.join(', ')})` : ''}`).join('\n') +
        `\n\n💡 Call each tool in order: smart_run(tool: "<tool_name>", args: {...})`;
    } catch (err) {
      return `❌ Error analyzing goal: ${err.message}`;
    }
  },
};
