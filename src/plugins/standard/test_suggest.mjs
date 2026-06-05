export default {
  name: 'smart_test_suggest',
  category: 'test',
  description: 'Use when: need to find missing test coverage for a file or git diff. Analyzes code to suggest edge cases, error paths, and main flows. Useful before committing new or modified code.',
  inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Source file path (positional)' }, root: { type: 'string', description: 'Root dir (default: .)' }, diff: { type: 'boolean', description: 'Analyze git diff?' }, all: { type: 'boolean', description: 'Analyze all files?' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['file'] },
  cli: 'test-suggest.mjs',
  mapArgs(a) { const cli = []; if (a.file) cli.push(String(a.file)); if (a.root) cli.push('--root', String(a.root)); if (a.diff) cli.push('--diff'); if (a.all) cli.push('--all'); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
