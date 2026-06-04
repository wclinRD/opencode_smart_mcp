export default {
  name: 'smart_git_review',
  category: 'git',
  description: 'Use when: you need a code review of working tree changes, a specific commit, or a remote PR. Analyzes diffs with heuristic checks (security, performance, correctness, style) and produces structured per-file comments with severity levels. Can also fetch and review PRs from GitHub.',
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Git repo root (default: .)' },
      commit: { type: 'string', description: 'Review a specific commit (e.g., HEAD, HEAD~1)' },
      range: { type: 'string', description: 'Review a commit range (e.g., HEAD~3..HEAD)' },
      pr: { type: 'string', description: 'Review an existing PR by URL (e.g., https://github.com/user/repo/pull/123)' },
      staged: { type: 'boolean', description: 'Review staged changes only' },
      all: { type: 'boolean', description: 'Review staged + unstaged changes' },
      focus: { type: 'string', enum: ['security', 'performance', 'correctness', 'style', 'all'], description: 'Review focus area (default: all)' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' },
      output: { type: 'string', description: 'Write review report to file path' },
      maxComments: { type: 'number', description: 'Max review comments per file (default: 5)' },
    },
  },
  cli: 'git-review.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.commit) cli.push('--commit', String(a.commit));
    if (a.range) cli.push('--range', String(a.range));
    if (a.pr) cli.push('--pr', String(a.pr));
    if (a.staged) cli.push('--staged');
    if (a.all) cli.push('--all');
    if (a.focus) cli.push('--focus', String(a.focus));
    if (a.format) cli.push('--format', String(a.format));
    if (a.output) cli.push('--output', String(a.output));
    if (a.maxComments) cli.push('--max-comments', String(a.maxComments));
    cli.push('--no-color');
    return cli;
  },
};
