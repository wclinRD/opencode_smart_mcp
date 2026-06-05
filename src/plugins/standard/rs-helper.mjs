export default {
  name: 'smart_rs_helper',
  category: 'code',
  description: 'Use when: need to analyze Rust project health — run cargo check for compilation errors, cargo clippy for lint warnings, analyze Cargo.toml dependencies, check formatting. Run after modifying Rust code or before committing.',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['check', 'clippy', 'analyze', 'fmt'], description: 'check (cargo check), clippy (cargo clippy), analyze (project analysis), fmt (format check)' }, root: { type: 'string', description: 'Root dir (default: .)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['command'] },
  cli: 'rs-helper.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.root) cli.push('--root', String(a.root)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
