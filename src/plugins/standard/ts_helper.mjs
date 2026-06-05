export default {
  name: 'smart_ts_helper',
  category: 'code',
  description: 'Use when: need to analyze TypeScript project health — tsconfig strictness recommendations, detect unused exports, check ESM/CJS compatibility. Run after adding new TS files or before switching to strict mode.',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['check-config', 'check-unused', 'analyze'], description: 'check-config/check-unused/analyze' }, root: { type: 'string', description: 'Root dir (default: .)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['command'] },
  cli: 'ts-helper.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.root) cli.push('--root', String(a.root)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
