export default {
  name: 'smart_planner',
  category: 'plan',
  description: 'Use when: need to decompose a goal into executable steps with dependency tracking + condition branches. 9 templates + generic fallback. Use its output as input for smart_thinking plan_execute template. Avoid when: just need quick reasoning (use thinking instead).',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Natural language goal/description of what to do' },
      command: { type: 'string', enum: ['plan', 'analyze', 'list-tasks'], description: 'plan (default), analyze tool sequence, or list-tasks' },
      tools: { type: 'string', description: 'Comma-separated tool names (for analyze)' },
      context: { type: 'string', description: 'Additional context (e.g. file=src/index.js)' },
      steps: { type: 'number', description: 'Max steps in plan (default: 10)' },
      strict: { type: 'boolean', description: 'Only use tools that exist in registry' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
    },
  },
  cli: 'planner.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.command === 'list-tasks') { cli.push('list-tasks'); return cli; }
    if (a.command === 'analyze') { cli.push('analyze'); if (a.tools) cli.push(String(a.tools)); return cli; }
    // Default: plan
    if (a.goal) cli.push(String(a.goal));
    if (a.context) cli.push('--context', String(a.context));
    if (a.steps) cli.push('--steps', String(a.steps));
    if (a.strict) cli.push('--strict');
    if (a.format) cli.push('--format', String(a.format));
    return cli;
  },
};
