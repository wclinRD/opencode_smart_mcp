export default {
  name: 'smart_security',
  category: 'security',
  description: 'Use when: need to scan project for credentials leaks, injection flaws, path traversal, or dependency vulnerabilities. Run before committing or before CI. Avoid when: looking for general code quality issues (use lint instead).',
  responsePolicy: { maxLevel: 2 },
  responsePipeline: [
    { stage: 'format' },
    { stage: 'compress' },
    { stage: 'summarize', options: { securityScan: true } },
    { stage: 'truncate', options: { maxChars: 80000 } },
  ],
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Root dir (default: .)' },
      scan: { type: 'string', enum: ['credentials', 'injection', 'dependencies', 'all'], description: 'Scan type (default: all)' },
      include: { type: 'string', description: 'Glob include' },
      exclude: { type: 'string', description: 'Glob exclude' },
      failOn: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Fail if finding at severity >= this' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format' },
    },
  },
  cli: 'security-scan.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.include) cli.push('--include', String(a.include));
    if (a.exclude) cli.push('--exclude', String(a.exclude));
    if (a.scan) cli.push('--scan', String(a.scan));
    if (a.failOn) cli.push('--fail-on', String(a.failOn));
    if (a.format) cli.push('--format', String(a.format));
    cli.push('--no-color');
    return cli;
  },
};
