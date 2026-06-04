export default {
  name: 'smart_memory_store',
  category: 'plan',
  description: 'Use when: need to store or retrieve past error resolutions, patterns, and learnings across sessions. Supports fuzzy matching — works even with partial error text. Use search first, add if not found.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['store', 'search', 'list', 'get', 'confirm', 'delete', 'stats', 'export'], description: 'store/search/list/get/confirm/delete/stats/export' },
      query: { type: 'string', description: 'Error message to search or store (positional for store/search)' },
      resolution: { type: 'string', description: 'How the error was fixed (for store)' },
      tools: { type: 'string', description: 'Comma-separated tool names used (for store)' },
      files: { type: 'string', description: 'Comma-separated file paths changed (for store)' },
      category: { type: 'string', description: 'Filter by category (for list): build/runtime/test/permission/path/network/lint/git/unknown' },
      success: { type: 'boolean', description: 'Whether resolution was successful (default: true)' },
      id: { type: 'string', description: 'Entry ID (for get/delete)' },
      limit: { type: 'number', description: 'Max results (default: 10 for search, 50 for list)' },
      threshold: { type: 'number', description: 'Fuzzy match threshold 0-1 (default: 0.4)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
    },
    required: ['command'],
  },
  cli: 'memory-store.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.command) cli.push(String(a.command));
    if (a.query) cli.push(String(a.query));
    if (a.id) cli.push(String(a.id));
    if (a.resolution) cli.push('--resolution', String(a.resolution));
    if (a.tools) cli.push('--tools', String(a.tools));
    if (a.files) cli.push('--files', String(a.files));
    if (a.category) cli.push('--category', String(a.category));
    if (a.success !== undefined) cli.push('--success', String(a.success));
    if (a.limit) cli.push('--limit', String(a.limit));
    if (a.threshold) cli.push('--threshold', String(a.threshold));
    if (a.format) cli.push('--format', String(a.format));
    return cli;
  },
};
