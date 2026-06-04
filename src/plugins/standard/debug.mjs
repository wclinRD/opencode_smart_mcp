export default {
  name: 'smart_debug',
  category: 'debug',
  description: 'Use when: need to understand an error or stack trace — classifies error type, identifies root cause, suggests fixes. Paste the full error message. Avoid when: error is straightforward and known (use basic reasoning instead).',
  inputSchema: { type: 'object', properties: { error: { type: 'string', description: 'Error message to analyze' }, file: { type: 'string', description: 'File path with error/stacktrace' }, root: { type: 'string', description: 'Project root (default: .)' }, format: { type: 'string', enum: ['text', 'json'], description: 'Output format' } } },
  cli: 'debug-assist.mjs',
  mapArgs(a) { const cli = []; if (a.error) cli.push('--error', String(a.error)); if (a.file) cli.push('--file', String(a.file)); if (a.root) cli.push('--root', String(a.root)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
