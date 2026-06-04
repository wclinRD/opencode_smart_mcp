export default {
  name: 'smart_naming',
  category: 'analyze',
  description: 'Use when: need to audit naming conventions across the codebase (kebab-case, camelCase, PascalCase, UPPER_CASE). Run to detect violations before code review or to enforce team naming standards.',
  inputSchema: {
    type: 'object', properties: {
      root: { type: 'string', description: 'Root dir (default: .)' },
      include: { type: 'string', description: 'Glob include' },
      exclude: { type: 'string', description: 'Glob exclude' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format' },
    },
  },
  cli: 'naming-convention.mjs',
  mapArgs(a) { const cli = []; if (a.root) cli.push('--root', a.root); if (a.include) cli.push('--include', a.include); if (a.exclude) cli.push('--exclude', a.exclude); if (a.format) cli.push('--format', a.format); cli.push('--no-color'); return cli; },
};
