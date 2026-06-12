export default {
  name: 'smart_memory_store',
  category: 'plan',
  description: 'Use when: need to store or retrieve past error resolutions, patterns, and learnings across sessions. Supports fuzzy matching + vector search (TF-IDF hybrid) — use vector=true for semantic matching across similar error messages. Use search first, add if not found. Also supports type:"skill_patch" for storing reusable behavior patterns (trigger_conditions + behavior_change + target_skill).',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['store', 'search', 'list', 'get', 'confirm', 'delete', 'stats', 'export', 'extract', 'quality'], description: 'store/search/list/get/confirm/delete/stats/export/extract/quality — extract auto-generates skill_patches from findings (pipe JSON via stdin); quality shows memory health dashboard (requires --db)' },
      query: { type: 'string', description: 'Error message or trigger description to search or store (positional for store/search)' },
      type: { type: 'string', enum: ['error', 'skill_patch'], description: 'Entry type: "error" (default) for error resolutions, "skill_patch" for reusable behavior patterns' },
      targetSkill: { type: 'string', description: 'Target skill name this skill_patch applies to (for type:skill_patch)' },
      behaviorChange: { type: 'string', description: 'What to do differently — the behavior improvement (for type:skill_patch)' },
      resolution: { type: 'string', description: 'How the error was fixed (for store)' },
      tools: { type: 'string', description: 'Comma-separated tool names used (for store)' },
      files: { type: 'string', description: 'Comma-separated file paths changed (for store)' },
      category: { type: 'string', description: 'Filter by category (for list): build/runtime/test/permission/path/network/lint/git/unknown/skill_patch' },
      success: { type: 'boolean', description: 'Whether resolution was successful (default: true)' },
      id: { type: 'string', description: 'Entry ID (for get/delete)' },
      limit: { type: 'number', description: 'Max results (default: 10 for search, 50 for list)' },
      threshold: { type: 'number', description: 'Fuzzy match threshold 0-1 (default: 0.4)' },
      vector: { type: 'boolean', description: 'Enable hybrid vector search (TF-IDF + fuzzy) for better semantic matching' },
      vectorThreshold: { type: 'number', description: 'Vector match threshold 0-1 (default: 0.1)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      findingsFile: { type: 'string', description: 'Path to findings JSON file (for extract command)' },
      minFrequency: { type: 'number', description: 'Minimum occurrences to trigger skill_patch (default: 2, for extract command)' },
      dryRun: { type: 'boolean', description: 'Preview without storing (for extract command)' },
      ttl: { type: 'string', description: 'Auto-expire after duration (e.g. "7d", "30d", "1h") — for store command' },
      keep: { type: 'string', enum: ['always'], description: 'Prevent auto-cleanup for this entry — for store command' },
      includeArchived: { type: 'boolean', description: 'Include archived entries in search/list results' },
    },
    required: ['command'],
  },
  cli: 'memory-store.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.command) cli.push(String(a.command));
    if (a.query) cli.push(String(a.query));
    if (a.id) cli.push(String(a.id));
    if (a.type) cli.push('--type', String(a.type));
    if (a.targetSkill) cli.push('--target-skill', String(a.targetSkill));
    if (a.behaviorChange) cli.push('--behavior-change', String(a.behaviorChange));
    if (a.resolution) cli.push('--resolution', String(a.resolution));
    if (a.tools) cli.push('--tools', String(a.tools));
    if (a.files) cli.push('--files', String(a.files));
    if (a.category) cli.push('--category', String(a.category));
    if (a.success !== undefined) cli.push('--success', String(a.success));
    if (a.limit) cli.push('--limit', String(a.limit));
    if (a.threshold) cli.push('--threshold', String(a.threshold));
    if (a.vector) cli.push('--vector');
    if (a.vectorThreshold) cli.push('--vector-threshold', String(a.vectorThreshold));
    if (a.format) cli.push('--format', String(a.format));
    if (a.findingsFile) cli.push('--findings-file', String(a.findingsFile));
    if (a.minFrequency) cli.push('--min-frequency', String(a.minFrequency));
    if (a.dryRun) cli.push('--dry-run');
    if (a.ttl) cli.push('--ttl', String(a.ttl));
    if (a.keep) cli.push('--keep', String(a.keep));
    if (a.includeArchived) cli.push('--include-archived');
    return cli;
  },
};
