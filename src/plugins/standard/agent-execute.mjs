// agent-execute.mjs — Smart Agent workflow execution planner
//
// For complex multi-step tasks (5+ tools), this generates a complete
// workflow automation plan: template selection → create → dispatch → summary.
// Useful for small/weak models that can't reliably chain tools themselves.
//
// Usage:
//   smart_run(tool: "agent_execute", args: { goal: "debug login error" })
//   smart_run(tool: "agent_execute", args: { goal: "refactor auth", template: "refactor-flow" })

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'smart_agent_execute',
  category: 'meta',
  description: 'Use when: the task requires 5+ tools and you want a complete workflow automation plan. Especially useful for small/weak models. Generates the full workflow lifecycle: template selection → create command → dispatch → replan → summary. Avoid when: the task is simple (1-2 tools).',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Task description for workflow automation (e.g. "debug login error", "refactor user authentication")',
      },
      template: {
        type: 'string',
        enum: ['debug-flow', 'refactor-flow', 'security-flow', 'research-flow', 'git-flow', 'default-flow'],
        description: 'Workflow template (auto-detected if not specified)',
      },
      state: {
        type: 'string',
        description: 'Custom state file path (default: .workflow-state.json)',
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
      const { goal, template, state, format = 'text' } = args;
      if (!goal) return '❌ goal is required. Usage: smart_agent_execute({ goal: "debug login error" })';

      // Load smart-agent engine (try npm package first, fall back to monorepo)
      let smart;
      try {
        smart = await import('smart-agent');
      } catch {
        const smartAgentPath = resolve(__dirname, '..', '..', '..', 'smart-agent', 'src', 'index.mjs');
        smart = await import(`file://${smartAgentPath}`);
      }
      const { planAutoExecute, selectTemplate, getDispatchCommand, getSummaryCommand, shouldReplan, extractFindings } = smart;

      // Generate workflow plan
      const options = {};
      if (template) options.template = template;
      if (state) options.state = state;
      const plan = planAutoExecute(goal, options);

      // Build the full execution sequence
      const statePath = state || '.workflow-state.json';
      const firstDispatch = getDispatchCommand({ _stateFile: statePath, steps: [{}] }, { group: 0 });
      const summaryCmd = getSummaryCommand(statePath, true);

      if (format === 'json') {
        return JSON.stringify({
          goal: plan.goal,
          template: plan.template,
          workflowId: plan.workflowId,
          executionSequence: [
            { step: 1, action: 'create', description: 'Generate workflow plan', command: plan.command },
            { step: 2, action: 'dispatch', description: 'Execute steps in parallel group 0', command: firstDispatch.command },
            { step: 3, action: 'dispatch', description: 'Execute remaining groups (repeat if needed)', command: `smart_workflow dispatch --state "${statePath}" --group <N>` },
            { step: 4, action: 'replan (on failure)', description: 'Handle step failures', command: `smart_workflow replan --state "${statePath}" --context "<what went wrong>"` },
            { step: 5, action: 'summary', description: 'Review results', command: summaryCmd.command },
          ],
        }, null, 2);
      }

      const detectedTemplate = selectTemplate(goal);
      const templateNote = template && template !== detectedTemplate
        ? ` (overridden from auto-detected "${detectedTemplate}")`
        : template ? '' : ` (auto-detected)`;

      return [
        `## Workflow Automation Plan`,
        ``,
        `**Goal**: ${plan.goal}`,
        `**Template**: \`${plan.template}\`${templateNote}`,
        `**Workflow ID**: \`${plan.workflowId}\``,
        ``,
        `### Execution Sequence`,
        ``,
        `1️⃣ **Create workflow**:`,
        `   \`\`\``,
        `   ${plan.command}`,
        `   \`\`\``,
        `   This generates a DAG with parallel hints based on the \`${plan.template}\` template.`,
        ``,
        `2️⃣ **Dispatch step(s)**:`,
        `   \`\`\``,
        `   ${firstDispatch.command}`,
        `   \`\`\``,
        `   Executes the first batch of steps. Repeat with \`--group <N>\` for subsequent groups.`,
        ``,
        `3️⃣ **Replan on failure** (if a step fails):`,
        `   \`\`\``,
        `   smart_workflow replan --state "${statePath}" --context "<what went wrong>"`,
        `   \`\`\``,
        ``,
        `4️⃣ **Summary**:`,
        `   \`\`\``,
        `   ${summaryCmd.command}`,
        `   \`\`\``,
        ``,
        `💡 Execute each command in sequence. After create → dispatch → ... → summary.`,
      ].join('\n');
    } catch (err) {
      return `❌ Error generating workflow plan: ${err.message}`;
    }
  },
};
