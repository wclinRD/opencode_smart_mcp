export default {
  name: 'smart_toonify',
  category: 'report',
  description: 'Use when: need to reduce token usage of JSON/CSV/YAML data by 30-65%. Commands: optimize (compress data), stats (show savings), cache (manage optimization cache). Apply to large tool outputs before sending to LLM.',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['optimize', 'stats', 'cache-stats', 'clear-cache', 'cleanup-cache', 'count'], description: 'Action' }, content: { type: 'string', description: 'Data to optimize' }, file: { type: 'string', description: 'Read from file' }, text: { type: 'string', description: 'Text to count tokens for' }, toolName: { type: 'string', description: 'Metadata tracking name' }, format: { type: 'string', enum: ['text', 'json'], description: 'Output format' } }, required: ['command'] },
  cli: 'toonify.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.command === 'optimize') { if (a.content) cli.push(String(a.content)); else if (a.file) cli.push('--file', String(a.file)); } else if (a.command === 'count' && a.text) cli.push(String(a.text)); if (a.toolName) cli.push('--tool-name', String(a.toolName)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
