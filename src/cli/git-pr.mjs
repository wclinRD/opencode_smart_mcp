#!/usr/bin/env node

/**
 * git-pr.mjs — Smart PR creator with auto-generated descriptions
 *
 * Analyzes branch commits vs base branch, generates a PR title and
 * description, and optionally creates the PR via `gh` CLI.
 *
 * Usage:
 *   node git-pr.mjs [options]
 *
 * Options:
 *   --root <path>           Git repository root (default: .)
 *   --base <branch>         Base branch (default: auto-detect: main or master)
 *   --head <branch>         Head branch (default: current branch)
 *   --title <str>           PR title (default: auto-generated)
 *   --body <str>            PR body text (default: auto-generated)
 *   --draft                 Create as a draft PR
 *   --no-publish            Don't actually create PR, just output description
 *   --format <fmt>          Output: text, json, markdown (default: text)
 *   --github-token <token>  GitHub token (default: GITHUB_TOKEN env var)
 *   --no-color              Disable color output
 *   -h, --help              Show this help
 *
 * Examples:
 *   node git-pr.mjs
 *   node git-pr.mjs --base develop --draft
 *   node git-pr.mjs --no-publish --format markdown
 *   node git-pr.mjs --title "feat: add user auth" --body "Implements login flow"
 */

import { execSync, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { shell: false, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`git ${args[0]} failed: ${e.stderr ? e.stderr.toString().trim() : e.message}`);
  }
}

function isGitRepo(root) {
  try {
    execSync('git rev-parse --git-dir', { cwd: root, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Branch analysis
// ---------------------------------------------------------------------------

function getCurrentBranch(root) {
  try {
    return git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  } catch { return 'HEAD'; }
}

function detectBaseBranch(root) {
  const candidates = ['main', 'master', 'develop', 'trunk'];
  for (const branch of candidates) {
    try {
      git(root, 'rev-parse', '--verify', branch);
      return branch;
    } catch { /* not found */ }
  }
  return 'main'; // fallback
}

function getMergeBase(root, base, head) {
  try {
    return git(root, 'merge-base', base, head).trim();
  } catch { return ''; }
}

function getCommitLogBetween(root, fromRef, toRef) {
  try {
    const log = git(root, 'log', `${fromRef}..${toRef}`, '--oneline', '--no-decorate');
    return log.trim().split('\n').filter(Boolean).map(line => {
      const [hash, ...msg] = line.split(' ');
      return { hash, message: msg.join(' ') };
    });
  } catch { return []; }
}

function getDiffStat(root, fromRef, toRef) {
  try {
    const out = git(root, 'diff', `${fromRef}..${toRef}`, '--stat');
    return out.trim();
  } catch { return ''; }
}

function getChangedFilesBetween(root, fromRef, toRef) {
  try {
    const out = git(root, 'diff', `${fromRef}..${toRef}`, '--name-status');
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status };
    });
  } catch { return []; }
}

function getCommitMessagesBetween(root, fromRef, toRef) {
  try {
    const log = git(root, 'log', `${fromRef}..${toRef}`, '--format=%s');
    return log.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// PR description generation
// ---------------------------------------------------------------------------

/**
 * Generate a PR title from commit messages and changed files.
 */
function generateTitle(commits, changedFiles) {
  if (commits.length === 0) return 'Update';

  // Try to find a good conventional commit summary
  // If there's only one commit, use its message
  if (commits.length === 1) {
    return commits[0].message;
  }

  // Multiple commits: look for the most common conventional commit type
  const types = [];
  for (const c of commits) {
    const match = c.message.match(/^(feat|fix|refactor|docs|test|chore|style|perf)(\([^)]+\))?:/);
    if (match) types.push(match[1]);
  }

  const counts = {};
  let maxCount = 0;
  let dominantType = '';
  for (const t of types) {
    counts[t] = (counts[t] || 0) + 1;
    if (counts[t] > maxCount) {
      maxCount = counts[t];
      dominantType = t;
    }
  }

  // Determine primary change area from files
  const dirs = changedFiles
    .map(f => f.path.split(/[/\\]/)[0])
    .filter(d => d);
  const dirCounts = {};
  for (const d of dirs) dirCounts[d] = (dirCounts[d] || 0) + 1;
  const primaryDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const scope = primaryDir || '';
  const summary = `${commits[0].message} (+${commits.length - 1} more)`;

  return scope ? `${dominantType || 'feat'}(${scope}): ${summary}` : `${dominantType || 'feat'}: ${summary}`;
}

/**
 * Generate PR body/description from commits and changed files.
 */
function generateBody(commits, changedFiles, diffStat) {
  const parts = [];

  // Summary
  const added = changedFiles.filter(f => f.status === 'A').length;
  const modified = changedFiles.filter(f => f.status === 'M').length;
  const deleted = changedFiles.filter(f => f.status === 'D').length;
  parts.push(`## Summary`);
  parts.push('');
  parts.push(`This PR includes **${changedFiles.length}** changed files:`);
  parts.push(`- **${added}** added`);
  parts.push(`- **${modified}** modified`);
  parts.push(`- **${deleted}** deleted`);
  parts.push('');

  // Commits
  if (commits.length > 0) {
    parts.push(`## Commits`);
    parts.push('');
    parts.push(`| Hash | Message |`);
    parts.push(`|------|---------|`);
    for (const c of commits) {
      parts.push(`| \`${c.hash}\` | ${c.message} |`);
    }
    parts.push('');
  }

  // Changed files
  if (changedFiles.length > 0) {
    parts.push(`## Changed Files`);
    parts.push('');
    for (const f of changedFiles) {
      const icon = f.status === 'A' ? '➕' : f.status === 'D' ? '➖' : '✏️';
      parts.push(`- ${icon} \`${f.path}\``);
    }
    parts.push('');
  }

  // Diff stats
  if (diffStat) {
    parts.push('---');
    parts.push('');
    parts.push('```');
    parts.push(diffStat);
    parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Check if `gh` CLI is available.
 */
function isGhAvailable() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatText(result, color) {
  const c = COLORS;
  const lines = [];

  if (result.status === 'no-commits') {
    return color
      ? `${c.yellow}No commits to create a PR for.${c.reset}`
      : 'No commits to create a PR for.';
  }

  if (result.status === 'preview') {
    lines.push(color
      ? `${c.bold}${c.blue}📋 Proposed PR${c.reset}`
      : '--- Proposed PR ---');
    lines.push('');

    // Title
    lines.push(color ? `${c.bold}Title:${c.reset}` : 'Title:');
    lines.push(color ? `  ${c.green}${result.title}${c.reset}` : `  ${result.title}`);
    lines.push('');

    // Base → Head
    lines.push(color
      ? `${c.dim}${result.baseBranch} ← ${result.headBranch}${c.reset}`
      : `${result.baseBranch} ← ${result.headBranch}`);
    lines.push('');

    // Commits
    if (result.commits && result.commits.length > 0) {
      lines.push(color ? `${c.bold}Commits (${result.commits.length}):${c.reset}` : `Commits (${result.commits.length}):`);
      for (const commit of result.commits) {
        lines.push(color
          ? `  ${c.dim}${commit.hash}${c.reset} ${commit.message}`
          : `  ${commit.hash} ${commit.message}`);
      }
      lines.push('');
    }

    // Changed files
    if (result.files && result.files.length > 0) {
      lines.push(color ? `${c.bold}Files:${c.reset}` : 'Files:');
      for (const f of result.files) {
        const symbol = f.status === 'A' ? '+' : f.status === 'D' ? '-' : '~';
        const fileColor = f.status === 'A' ? c.green : f.status === 'D' ? c.red : c.yellow;
        if (color) {
          lines.push(`  ${fileColor}${symbol} ${f.path}${c.reset}`);
        } else {
          lines.push(`  ${symbol} ${f.path}`);
        }
      }
      lines.push('');
    }

    // Body preview (first 20 lines)
    if (result.body) {
      const bodyLines = result.body.split('\n');
      const preview = bodyLines.slice(0, 20);
      if (color) {
        lines.push(`${c.dim}--- Description (${bodyLines.length} lines) ---${c.reset}`);
      } else {
        lines.push('--- Description ---');
      }
      lines.push(preview.join('\n'));
      if (bodyLines.length > 20) {
        lines.push(color ? `${c.dim}... (${bodyLines.length - 20} more lines)${c.reset}` : `... (${bodyLines.length - 20} more lines)`);
      }
    }
    lines.push('');
    lines.push(color
      ? `${c.dim}Run without --no-publish to create this PR on GitHub.${c.reset}`
      : 'Run without --no-publish to create this PR on GitHub.');
  }

  if (result.status === 'created') {
    lines.push(color
      ? `${c.green}✓ PR Created${c.reset}  ${result.url}`
      : `✓ PR Created  ${result.url}`);
    if (result.number) {
      lines.push(color
        ? `${c.dim}PR #${result.number}${c.reset}`
        : `PR #${result.number}`);
    }
    lines.push('');
    lines.push(color ? `${c.bold}Title:${c.reset} ${result.title}` : `Title: ${result.title}`);
    lines.push(color
      ? `${c.dim}${result.baseBranch} ← ${result.headBranch}${c.reset}`
      : `${result.baseBranch} ← ${result.headBranch}`);
  }

  if (result.status === 'error') {
    lines.push(color
      ? `${c.red}✗ Error: ${result.error}${c.reset}`
      : `✗ Error: ${result.error}`);
  }

  return lines.join('\n');
}

function formatJSON(result) {
  return JSON.stringify(result, null, 2);
}

function formatMarkdown(result) {
  const lines = [];

  if (result.status === 'no-commits') {
    return '## No commits to create a PR for.';
  }

  if (result.status === 'preview') {
    lines.push('# Proposed Pull Request');
    lines.push('');
    lines.push(`**${result.baseBranch}** ← **${result.headBranch}**`);
    lines.push('');
    lines.push(`## Title`);
    lines.push('');
    lines.push(`> ${result.title}`);
    lines.push('');
    if (result.body) {
      lines.push(result.body);
    }
  }

  if (result.status === 'created') {
    lines.push('# Pull Request Created');
    lines.push('');
    lines.push(`- **URL**: [${result.url}](${result.url})`);
    if (result.number) lines.push(`- **Number**: #${result.number}`);
    lines.push(`- **Title**: ${result.title}`);
    lines.push(`- **Base**: ${result.baseBranch}`);
    lines.push(`- **Head**: ${result.headBranch}`);
    lines.push('');
    lines.push('```');
    lines.push(result.title);
    lines.push('```');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const opts = {
    root: '.',
    base: null,
    head: null,
    title: null,
    body: null,
    draft: false,
    noPublish: false,
    format: 'text',
    color: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--base': opts.base = args[++i]; break;
      case '--head': opts.head = args[++i]; break;
      case '--title': opts.title = args[++i]; break;
      case '--body': opts.body = args[++i]; break;
      case '--draft': opts.draft = true; break;
      case '--no-publish': opts.noPublish = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node git-pr.mjs [options]

Smart PR creator with auto-generated descriptions.

Options:
  --root <path>           Git repository root (default: .)
  --base <branch>         Base branch (default: auto-detect: main/master/develop)
  --head <branch>         Head branch (default: current branch)
  --title <str>           PR title (default: auto-generated from commits)
  --body <str>            PR body text (default: auto-generated)
  --draft                 Create as a draft PR
  --no-publish            Don't actually create PR, just output description
  --format <fmt>          Output: text, json, markdown (default: text)
  --no-color              Disable color output
  -h, --help              Show this help

Examples:
  node git-pr.mjs
  node git-pr.mjs --base develop --draft
  node git-pr.mjs --no-publish --format markdown
  node git-pr.mjs --title "feat: add user auth" --body "Implements login flow"
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  if (!isGitRepo(root)) {
    console.error('Not a git repository:', root);
    process.exit(1);
  }

  const head = opts.head || getCurrentBranch(root);
  const base = opts.base || detectBaseBranch(root);

  if (head === base) {
    const result = { status: 'no-commits', message: `Current branch (${head}) is the same as base (${base}).`, title: '', body: '', headBranch: head, baseBranch: base };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(0);
  }

  // Get merge-base
  const mergeBase = getMergeBase(root, base, head);
  if (!mergeBase) {
    const result = { status: 'error', error: `Cannot find merge base between ${base} and ${head}`, title: '', body: '', headBranch: head, baseBranch: base };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(1);
  }

  // Get commits
  const commits = getCommitLogBetween(root, base, head);
  if (commits.length === 0) {
    const result = { status: 'no-commits', message: `No commits found between ${base} and ${head}.`, title: '', body: '', headBranch: head, baseBranch: base };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(0);
  }

  const changedFiles = getChangedFilesBetween(root, base, head);
  const diffStat = getDiffStat(root, base, head);

  // Generate title & body
  const title = opts.title || generateTitle(commits, changedFiles);
  const body = opts.body || generateBody(commits, changedFiles, diffStat);

  if (opts.noPublish) {
    const result = {
      status: 'preview',
      title,
      body,
      headBranch: head,
      baseBranch: base,
      commits,
      files: changedFiles,
      diffStat,
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(0);
  }

  // Check for gh CLI
  if (!isGhAvailable()) {
    const result = {
      status: 'error',
      error: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ or use --no-publish to preview.',
      title,
      body,
      headBranch: head,
      baseBranch: base,
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(1);
  }

  // Create PR
  try {
    const ghArgs = [
      'pr', 'create',
      '--base', base,
      '--head', head,
      '--title', title,
      '--body', body,
    ];
    if (opts.draft) ghArgs.push('--draft');

    const result = execFileSync('gh', ghArgs, {
      cwd: root,
      shell: false,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const url = result.trim();

    // Get PR number from URL
    const numberMatch = url.match(/\/pull\/(\d+)$/);
    const number = numberMatch ? parseInt(numberMatch[1], 10) : null;

    const output = {
      status: 'created',
      url,
      number,
      title,
      body,
      headBranch: head,
      baseBranch: base,
      commits,
      files: changedFiles,
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(output)); break;
      case 'markdown': console.log(formatMarkdown(output)); break;
      default: console.log(formatText(output, color)); break;
    }
  } catch (e) {
    const result = {
      status: 'error',
      error: e.stderr ? e.stderr.toString().trim() : e.message,
      title,
      body,
      headBranch: head,
      baseBranch: base,
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(1);
  }
}

main();
