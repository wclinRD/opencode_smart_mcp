export default {
  name: 'smart_py_helper',
  category: 'code',
  description: 'Use when: need to analyze Python project health — detect venv status, check dependency consistency, run mypy type checking, get modernization recommendations. Run when setting up new Python project or before migration.',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['check-env', 'check-deps', 'typecheck', 'analyze'], description: 'Analysis command' }, root: { type: 'string', description: 'Root dir (default: .)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['command'] },
  cli: 'py-helper.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.root) cli.push('--root', String(a.root)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
