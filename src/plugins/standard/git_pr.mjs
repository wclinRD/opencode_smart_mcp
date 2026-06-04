export default {
  name: 'smart_git_pr',
  category: 'git',
  description: 'Use when: you need to create a Pull Request with an auto-generated description. Analyzes commits between head and base branches, generates a structured PR title and body, then optionally creates the PR via gh CLI. Supports --draft, --no-publish preview, and manual --title/--body overrides.',
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Git repo root (default: .)' },
      base: { type: 'string', description: 'Base branch (default: auto-detect: main/master/develop)' },
      head: { type: 'string', description: 'Head branch (default: current branch)' },
      title: { type: 'string', description: 'PR title (default: auto-generated from commits)' },
      body: { type: 'string', description: 'PR body text (default: auto-generated with commit list + file list)' },
      draft: { type: 'boolean', description: 'Create as a draft PR' },
      noPublish: { type: 'boolean', description: 'Don\'t create the PR, just show the preview' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' },
    },
  },
  cli: 'git-pr.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.base) cli.push('--base', String(a.base));
    if (a.head) cli.push('--head', String(a.head));
    if (a.title) cli.push('--title', String(a.title));
    if (a.body) cli.push('--body', String(a.body));
    if (a.draft) cli.push('--draft');
    if (a.noPublish) cli.push('--no-publish');
    if (a.format) cli.push('--format', String(a.format));
    cli.push('--no-color');
    return cli;
  },
};
