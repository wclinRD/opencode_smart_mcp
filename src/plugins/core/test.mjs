export default {
  name: 'smart_test',
  category: 'test',
  description: 'Use when: need to discover or run project tests. Auto-detects vitest/jest/mocha/ava/node:test. Supports watch mode for iterative development. Avoid when: checking test coverage (use coverage instead).',
  responsePolicy: { maxLevel: 0 }, // Keep raw for CI integration
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Project root directory (default: .)' },
      include: { type: 'string', description: 'Test file glob pattern to include' },
      watch: { type: 'boolean', description: 'Run tests in watch mode' },
    },
  },
  cli: 'test-runner.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.include) cli.push('--include', String(a.include));
    if (a.watch) cli.push('--watch');
    cli.push('--no-color');
    return cli;
  },
};
