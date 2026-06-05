export default {
  name: 'smart_git_context',
  category: 'meta',
  description: 'Use when: need to understand current git state — staged/unstaged changes, commit diffs, and their impact scope via import graph. Run before committing or generating PR descriptions.',
  inputSchema: { type: 'object', properties: { root: { type: 'string', description: 'Git repo root (default: .)' }, staged: { type: 'boolean', description: 'Staged only' }, all: { type: 'boolean', description: 'Staged + unstaged' }, commit: { type: 'string', description: 'Commit ref (e.g., HEAD~1)' }, range: { type: 'string', description: 'Commit range' }, impact: { type: 'boolean', description: 'Import-graph impact analysis' }, context: { type: 'number', description: 'Diff context lines (default: 3)' }, statOnly: { type: 'boolean', description: 'File stats only' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } } },
  cli: 'git-context.mjs',
  mapArgs(a) { const cli = []; if (a.root) cli.push('--root', String(a.root)); if (a.staged) cli.push('--staged'); if (a.all) cli.push('--all'); if (a.commit) cli.push('--commit', String(a.commit)); if (a.range) cli.push('--range', String(a.range)); if (a.impact) cli.push('--impact'); if (a.context) cli.push('--context', String(a.context)); if (a.statOnly) cli.push('--stat-only'); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
