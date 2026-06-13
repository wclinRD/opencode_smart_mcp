export default {
  name: 'smart_grep',
  category: 'search',
  description: 'Use when: need to search codebase by regex. Returns function/class scope context + import graph for matched code. Avoid when: matching exact filename (use glob instead).',
  responsePolicy: { maxLevel: 0 }, // Small output, keep raw
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search' },
      root: { type: 'string', description: 'Root dir (default: .)' },
      include: { type: 'string', description: 'Glob include (default: **/*.{js,ts,py,...})' },
      exclude: { type: 'string', description: 'Glob exclude' },
      context: { type: 'number', description: 'Context lines (default: 3)' },
      withScope: { type: 'boolean', description: 'Show function/class scope' },
      withImports: { type: 'boolean', description: 'Show import graph' },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive' },
      filesOnly: { type: 'boolean', description: 'List files only' },
      maxMatches: { type: 'number', description: 'Max matches per file (default: 100)' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format' },
      semantic: { type: 'boolean', description: 'Enable hybrid semantic search (BM25 + TF-IDF fusion)' },
      semanticWeight: { type: 'number', description: 'Custom semantic weight 0.0-1.0 (auto-detected from query type)' },
    },
    required: ['pattern'],
  },
  cli: 'contextual-grep.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.pattern) cli.push(String(a.pattern));
    if (a.root) cli.push('--root', String(a.root));
    if (a.include) cli.push('--include', String(a.include));
    if (a.exclude) cli.push('--exclude', String(a.exclude));
    if (a.context) cli.push('--context', String(a.context));
    if (a.withScope) cli.push('--with-scope');
    if (a.withImports) cli.push('--with-imports');
    if (a.ignoreCase) cli.push('--ignore-case');
    if (a.filesOnly) cli.push('--files-only');
    if (a.maxMatches) cli.push('--max-matches', String(a.maxMatches));
    if (a.format) cli.push('--format', String(a.format));
    if (a.semantic) cli.push('--semantic');
    if (a.semanticWeight != null) cli.push('--semantic-weight', String(a.semanticWeight));
    cli.push('--no-color');
    return cli;
  },
};
