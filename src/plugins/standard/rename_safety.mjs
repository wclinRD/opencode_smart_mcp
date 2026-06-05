export default {
  name: 'smart_rename_safety',
  category: 'edit',
  description: 'Use when: need to rename a function/variable/file across the codebase and want to detect naming conflicts, shadowing, or incomplete renames before applying. Dry-run by default — safe to use without side effects.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Old symbol name (positional)' }, newName: { type: 'string', description: 'New symbol name (positional)' }, root: { type: 'string', description: 'Root dir (default: .)' }, include: { type: 'string', description: 'Glob include' }, exclude: { type: 'string', description: 'Glob exclude' }, dryRun: { type: 'boolean', description: 'Preview only (default: true)' }, apply: { type: 'boolean', description: 'Actually apply (default: false)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['name', 'newName'] },
  cli: 'rename-safety.mjs',
  mapArgs(a) { const cli = []; if (a.name) cli.push(String(a.name)); if (a.newName) cli.push(String(a.newName)); if (a.root) cli.push('--root', String(a.root)); if (a.include) cli.push('--include', String(a.include)); if (a.exclude) cli.push('--exclude', String(a.exclude)); if (a.dryRun) cli.push('--dry-run'); if (a.apply) cli.push('--apply'); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
