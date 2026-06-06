export default {
  name: 'smart_learn',
  category: 'analyze',
  description: 'Use when: need to understand project structure, tech stack, deps, coding style. Runs full analysis pipeline including AST parsing. Start here when entering a new codebase. Avoid when: just searching for code (use grep instead).',
  responsePolicy: { maxLevel: 0 }, // Large but critical; keep raw
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['extract'], description: 'extract = full analysis pipeline (default)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format' },
    },
  },
  cli: 'learn-adapt.mjs',
  mapArgs(a) {
    const cli = ['extract'];
    if (a.command) cli[0] = String(a.command);
    if (a.root) cli.push('--root', String(a.root));
    if (a.format) cli.push('--format', String(a.format));
    cli.push('--no-color');
    return cli;
  },
};
