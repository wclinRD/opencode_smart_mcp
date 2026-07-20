export default {
  name: 'smart_test',
  category: 'test',
  description: 'Use when: need to discover or run project tests. Auto-detects vitest/jest/mocha/ava/node:test. Supports watch mode, coverage, and related test discovery. Avoid when: checking test coverage (use coverage instead).',
  responsePolicy: { maxLevel: 0 }, // Keep raw for CI integration
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Project root directory (default: .)' },
      include: { type: 'string', description: 'Test file glob pattern to include' },
      watch: { type: 'boolean', description: 'Run tests in watch mode' },
      coverage: { type: 'boolean', description: 'Run with coverage report' },
      related: { type: 'string', description: 'Find tests related to a file (e.g. "src/auth.ts")' },
      grep: { type: 'string', description: 'Filter tests by name pattern' },
      failFast: { type: 'boolean', description: 'Stop on first failure' },
      verbose: { type: 'boolean', description: 'Show full per-file output (default: summary only)' },
    },
  },
  cli: 'test-runner.mjs',
  timeout: 30_000, // Must stay under MCP client timeout (~30s). CLI hard timeout handles partial results.
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.include) cli.push('--include', String(a.include));
    if (a.watch) cli.push('--watch');
    if (a.coverage) cli.push('--coverage');
    if (a.related) cli.push('--related', String(a.related));
    if (a.grep) cli.push('--grep', String(a.grep));
    if (a.failFast) cli.push('--fail-fast');
    // Default: summary mode (compact). Pass verbose:true for full output.
    if (!a.verbose) cli.push('--summary');
    cli.push('--no-color');
    return cli;
  },
};
