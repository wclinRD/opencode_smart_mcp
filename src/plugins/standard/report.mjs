export default {
  name: 'smart_report',
  category: 'report',
  description: 'Use when: need to generate a self-contained HTML report from test results, security scan data, or coverage analysis. Best for sharing results with team or archiving. Call after running smart_test, smart_security, or coverage.',
  inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['test', 'security', 'coverage', 'custom'], description: 'Report type' }, title: { type: 'string', description: 'Report title' }, input: { type: 'string', description: 'Input JSON file path' }, output: { type: 'string', description: 'Output HTML path' }, theme: { type: 'string', enum: ['light', 'dark'], description: 'Light/dark (default: light)' }, root: { type: 'string', description: 'Root dir (default: .)' } }, required: ['type'] },
  cli: 'report.mjs',
  mapArgs(a) { const cli = []; if (a.type) cli.push(String(a.type)); if (a.title) cli.push('--title', String(a.title)); if (a.input) cli.push('--input', String(a.input)); if (a.output) cli.push('--output', String(a.output)); if (a.theme) cli.push('--theme', String(a.theme)); if (a.root) cli.push('--root', String(a.root)); cli.push('--no-color'); return cli; },
};
