export default {
  name: 'smart_compose',
  category: 'plan',
  description: 'Use when: need to compose multiple tool calls into a pipeline — sequential (pipe), parallel (fan-out), or conditional branching. Accepts a JSON pipeline definition and executes all steps. Avoid when: running a single tool (use the direct tool instead), or executing a workflow (use smart_workflow instead which has state persistence).',
  inputSchema: {
    type: 'object',
    properties: {
      pipeline: {
        type: 'string',
        description: 'JSON array of pipeline steps. Each step: { tool, args, mode: "seq"|"par"|"cond", condition?: { onField, match, then, else } }',
      },
      timeout: {
        type: 'number',
        description: 'Per-step timeout in ms (default: 30000)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'markdown'],
        description: 'Output format (default: text)',
      },
    },
    required: ['pipeline'],
  },
  cli: 'compose.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.pipeline) cli.push(String(a.pipeline));
    if (a.timeout) cli.push('--timeout', String(a.timeout));
    if (a.format) cli.push('--format', String(a.format));
    return cli;
  },
};
