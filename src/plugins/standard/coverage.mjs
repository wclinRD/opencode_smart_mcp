export default {
  name: 'smart_coverage',
  category: 'analyze',
  description: 'Use when: need to find untested code paths — uncovered branches, conditions, edge cases in if/else, switch, loops, ternaries. Call after writing new code to identify gaps. Avoid when: looking for test suggestions (use test_suggest instead).',
  inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Source file path (positional)' }, threshold: { type: 'number', description: 'Coverage threshold % (default: 80)' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format' } } },
  cli: 'coverage-check.mjs',
  mapArgs(a) { const cli = []; if (a.file) cli.push(String(a.file)); if (a.threshold) cli.push('--threshold', String(a.threshold)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
