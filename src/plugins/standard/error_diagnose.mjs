export default {
  name: 'smart_error_diagnose',
  category: 'debug',
  description: 'Use when: getting an error and need root cause analysis. Cross-references against known error KB + memory store. Covers build/runtime/test/permission/path/network. Supports auto-store successful diagnoses for future reuse.',
  inputSchema: {
    type: 'object',
    properties: {
      error: { type: 'string', description: 'Error msg to analyze (positional)' },
      file: { type: 'string', description: 'File with error/stacktrace' },
      list: { type: 'boolean', description: 'List all known patterns' },
      useMemory: { type: 'boolean', description: 'Search memory store before KB (recommended)' },
      store: { type: 'boolean', description: 'Store diagnosis result to memory' },
      memoryResolution: { type: 'string', description: 'Resolution text for store (defaults to KB fix)' },
      memoryTools: { type: 'string', description: 'Comma-separated tools used (for store)' },
      memoryThreshold: { type: 'number', description: 'Fuzzy match threshold 0-1 (default: 0.6)' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' },
    },
  },
  cli: 'error-diagnose.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.list) cli.push('--list');
    else if (a.error) cli.push(String(a.error));
    else if (a.file) cli.push('--file', String(a.file));
    if (a.useMemory) cli.push('--use-memory');
    if (a.store) cli.push('--store');
    if (a.memoryResolution) cli.push('--memory-resolution', String(a.memoryResolution));
    if (a.memoryTools) cli.push('--memory-tools', String(a.memoryTools));
    if (a.memoryThreshold != null) cli.push('--memory-threshold', String(a.memoryThreshold));
    if (a.format) cli.push('--format', String(a.format));
    return cli;
  },
};
