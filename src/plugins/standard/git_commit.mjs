export default {
  name: 'smart_git_commit',
  category: 'git',
  description: 'Use when: you need to commit changes with an auto-generated conventional commit message. Analyzes staged diff, generates type (feat/fix/refactor/etc.) and scope, then optionally executes the commit. Supports --dry-run preview, --amend, --all auto-stage, and custom --type/--scope overrides.',
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Git repo root (default: .)' },
      message: { type: 'string', description: 'Use this message instead of auto-generating (e.g., "feat: add login")' },
      type: { type: 'string', enum: ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'style', 'perf'], description: 'Force conventional commit type (default: auto-detect from diff)' },
      scope: { type: 'string', description: 'Add scope to commit message (e.g., "auth"). Empty string to force no scope.' },
      all: { type: 'boolean', description: 'Auto-stage all tracked files before committing' },
      amend: { type: 'boolean', description: 'Amend the last commit instead of creating a new one' },
      dryRun: { type: 'boolean', description: 'Preview the commit without actually committing' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' },
    },
  },
  cli: 'git-commit.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.root) cli.push('--root', String(a.root));
    if (a.message) cli.push('--message', String(a.message));
    if (a.type) cli.push('--type', String(a.type));
    if (a.scope !== undefined) cli.push('--scope', String(a.scope));
    if (a.all) cli.push('--all');
    if (a.amend) cli.push('--amend');
    if (a.dryRun) cli.push('--dry-run');
    if (a.format) cli.push('--format', String(a.format));
    cli.push('--no-color');
    return cli;
  },
};
