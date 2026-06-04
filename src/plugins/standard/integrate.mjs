export default {
  name: 'smart_integrate',
  category: 'meta',
  description: 'Use when: need meta-operations on smart itself — list available tools, suggest commit scope, generate PR descriptions, diagnose terminal errors, or manage MCP servers. Start here when unsure which tool to use (command:"list") or before committing (command:"suggest-commit").',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['list', 'suggest-commit', 'generate-pr', 'diagnose', 'mcp'], description: 'list/suggest-commit/generate-pr/diagnose/mcp' }, root: { type: 'string', description: 'Root directory (default: .)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' } }, required: ['command'] },
  cli: 'tool-integrate.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.root) cli.push('--root', String(a.root)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
