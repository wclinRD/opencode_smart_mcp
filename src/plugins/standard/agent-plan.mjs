// agent-plan.mjs — Smart Agent planner orchestration
//
// Decomposes complex goals into sub-steps with DAG dependencies.
// Useful when a goal is ambiguous, large, or requires careful sequencing.
// For small/weak models that can't reliably decompose tasks themselves.
//
// Usage:
//   smart_run(tool: "agent_plan", args: { goal: "find and fix all security vulnerabilities" })
//   smart_run(tool: "agent_plan", args: { goal: "implement user auth", steps: 5 })

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'smart_agent_plan',
  category: 'meta',
  description: 'Use when: the goal is complex, ambiguous, or requires 5+ steps — delegate decomposition to the planner engine. Especially useful for small/weak models. Returns a structured plan with DAG dependencies and parallel hints. Avoid when: the goal is simple and already clear.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Complex task description to decompose (e.g. "find and fix all security vulnerabilities")',
      },
      steps: {
        type: 'number',
        description: 'Maximum steps in the plan (default: auto)',
      },
      strict: {
        type: 'boolean',
        description: 'Strict mode — only use explicitly matching templates (default: false)',
      },
      state: {
        type: 'string',
        description: 'State file path for tracking plan execution',
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
      const { goal, steps, strict, state, format = 'text' } = args;
      if (!goal) return '❌ goal is required. Usage: smart_agent_plan({ goal: "find all security vulnerabilities" })';

      // Load smart-agent engine
      const smartAgentPath = resolve(__dirname, '..', '..', '..', 'smart-agent', 'src', 'index.mjs');
      const smart = await import(`file://${smartAgentPath}`);
      const { planAndExecute, analyzePlan, needsPlanning, determineNextAction } = smart;

      // Check if planning is needed
      const needsPlan = needsPlanning(goal);

      // Generate planner command
      const options = {};
      if (steps) options.steps = steps;
      if (strict) options.strict = strict;
      if (state) options.state = state;
      const plan = planAndExecute(goal, options);

      // Synthesize analysis
      const analysis = analyzePlan({
        steps: Array.from({ length: steps || 5 }, (_, i) => ({ tool: `step_${i + 1}`, dependsOn: i > 0 ? [i - 1] : [] })),
        parallelHints: [],
      });

      if (format === 'json') {
        return JSON.stringify({
          goal: plan.goal,
          planId: plan.planId,
          estimatedComplexity: plan.estimatedComplexity,
          needsPlanning: needsPlan,
          command: plan.command,
          _hint: 'Execute the command above, then use smart_run(tool: "planner", args: { command: "next", state: "<path>" }) to get next steps',
        }, null, 2);
      }

      return [
        `## Plan Decomposition`,
        ``,
        `**Goal**: ${plan.goal}`,
        `**Complexity**: ${plan.estimatedComplexity}`,
        `**Needs planning**: ${needsPlan ? '✅ Yes' : '⚠️  May be simple enough for direct execution'}`,
        ``,
        `### Estimated Plan`,
        `- Steps: ~${analysis.steps}`,
        `- Parallel groups: ~${analysis.parallelGroups}`,
        `- Est. duration: ${analysis.estimatedDuration}`,
        ``,
        `### Command`,
        `\`\`\``,
        `  ${plan.command}`,
        `\`\`\``,
        ``,
        `### After Execution`,
        `1. Run the command above to get the full DAG plan.`,
        `2. Track progress: \`smart_planner next --state "${state || '.plan-state.json'}"\``,
        `3. Report step results: \`smart_planner report --state <path> --step <N> --status ok/fail\``,
        ``,
        analysis.risks.length > 0 ? [
          `### ⚠️  Risks`,
          ...analysis.risks.map(r => `- ${r}`),
        ].join('\n') : '',
        ``,
        `💡 The planner will handle dependency ordering and parallel execution.`,
      ].filter(Boolean).join('\n');
    } catch (err) {
      return `❌ Error generating plan: ${err.message}`;
    }
  },
};
