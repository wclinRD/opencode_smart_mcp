export default {
  name: 'smart_glob',
  category: 'search',
  description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Also supports comma-separated multiple patterns like "*.ts,*.tsx" for batch matching in one call. Returns matching file paths. Use when: need to find files by name patterns. Avoid when: doing open-ended search requiring multiple rounds of globbing and grepping (use Task tool instead).',
  responsePolicy: { maxLevel: 0 }, // Small output, keep raw
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against. Supports comma-separated multiple patterns (e.g. "*.ts,*.tsx") for batch matching.' },
      path: { type: 'string', description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.' },
      depth: { type: 'number', description: 'Max directory traversal depth (default: unlimited). 0=only root, 1=root+1 level, etc.' },
      maxFiles: { type: 'number', description: 'Max number of results to return (default: 100)' },
      exclude: { type: 'string', description: 'Glob pattern to exclude (repeatable). E.g. "**/node_modules/**"' },
      type: { type: 'string', description: 'Filter by file extension without dot. E.g. "js", "ts", "py". Multiple: "js,ts"' },
      sort: { type: 'string', enum: ['name', 'size', 'mtime'], description: 'Sort results: name (default), size, mtime' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format. text (default) = plain path list. json = structured output with path, size, mtime per file.' },
    },
    required: ['pattern'],
  },
  cli: 'smart-glob.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.pattern) cli.push(String(a.pattern));
    if (a.path) cli.push('--path', String(a.path));
    if (a.depth !== undefined) cli.push('--depth', String(a.depth));
    if (a.maxFiles !== undefined) cli.push('--max-files', String(a.maxFiles));
    if (a.exclude) cli.push('--exclude', String(a.exclude));
    if (a.type) cli.push('--type', String(a.type));
    if (a.sort) cli.push('--sort', String(a.sort));
    if (a.format) cli.push('--format', String(a.format));
    cli.push('--no-color');
    return cli;
  },
};