export default {
  name: 'smart_glob',
  category: 'search',
  description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths. Use when: need to find files by name patterns. Avoid when: doing open-ended search requiring multiple rounds of globbing and grepping (use Task tool instead).',
  responsePolicy: { maxLevel: 0 }, // Small output, keep raw
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against' },
      path: { type: 'string', description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.' },
    },
    required: ['pattern'],
  },
  cli: 'smart-glob.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.pattern) cli.push(String(a.pattern));
    if (a.path) cli.push('--path', String(a.path));
    cli.push('--no-color');
    return cli;
  },
};