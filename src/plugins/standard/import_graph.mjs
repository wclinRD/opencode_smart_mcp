export default {
  name: 'smart_import_graph',
  category: 'analyze',
  description: 'Use when: need to understand cross-file import dependencies before refactoring. Supports JS/TS, Python, Ruby, Rust, Go. Configure depth for shallow or deep analysis. Use focus to zoom in on specific files.',
  inputSchema: { type: 'object', properties: { root: { type: 'string', description: 'Root dir (default: .)' }, include: { type: 'string', description: 'Glob include' }, exclude: { type: 'string', description: 'Glob exclude' }, depth: { type: 'number', description: 'Max depth (unlimited by default)' }, focus: { type: 'string', description: 'Focus on one file' }, noExternals: { type: 'boolean', description: 'Skip external deps' }, reverse: { type: 'boolean', description: 'Reverse deps (who imports)' }, format: { type: 'string', enum: ['text', 'json', 'dot', 'markdown'], description: 'Output format (default: text)' } } },
  cli: 'import-graph.mjs',
  mapArgs(a) { const cli = []; if (a.root) cli.push('--root', String(a.root)); if (a.include) cli.push('--include', String(a.include)); if (a.exclude) cli.push('--exclude', String(a.exclude)); if (a.depth) cli.push('--depth', String(a.depth)); if (a.focus) cli.push('--focus', String(a.focus)); if (a.noExternals) cli.push('--no-externals'); if (a.reverse) cli.push('--reverse'); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
