#!/usr/bin/env node

/**
 * git-commit.mjs — Smart commit with auto-generated conventional commit messages
 *
 * Analyzes staged/unstaged changes, generates a conventional commit message,
 * and optionally executes the commit.
 *
 * Usage:
 *   node git-commit.mjs [options]
 *
 * Options:
 *   --root <path>           Git repository root (default: .)
 *   --message <msg>         Use this message instead of auto-generating
 *   --type <type>           Force conventional commit type (feat, fix, refactor, etc.)
 *   --scope <scope>         Add scope to commit message (e.g., "auth", "api")
 *   --all, -a               Auto-stage all tracked files before committing
 *   --amend                 Amend the last commit instead of creating a new one
 *   --dry-run               Show what would be committed without committing
 *   --format <fmt>          Output: text, json, markdown (default: text)
 *   --no-color              Disable color output
 *   -h, --help              Show this help
 *
 * Examples:
 *   node git-commit.mjs
 *   node git-commit.mjs --dry-run
 *   node git-commit.mjs --type feat --scope api
 *   node git-commit.mjs --message "fix: resolve login timeout"
 *   node git-commit.mjs --all --amend
 */

import { execSync } from 'node:child_process';
import { extname, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';

import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(...args) {
  try {
    return execSync(`git ${args.join(' ')}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
// Diff analysis
// ---------------------------------------------------------------------------

function getStagedDiff(root, statOnly = false) {
  const args = statOnly ? '--stat' : '--stat --patch';
  try {
    return git(`-C`, root, `diff`, `--cached`, args);
  } catch { return ''; }
}

function getUnstagedDiff(root, statOnly = false) {
  const args = statOnly ? '--stat' : '--stat --patch';
  try {
    return git(`-C`, root, `diff`, args);
  } catch { return ''; }
}

function getChangedFiles(root) {
  // Staged
  let stagedFiles = [];
  try {
    const out = git(`-C`, root, `diff`, `--cached`, `--name-status`);
    stagedFiles = out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status, staged: true };
    });
  } catch { /* no staged changes */ }

  // Unstaged
  let unstagedFiles = [];
  try {
    const out = git(`-C`, root, `diff`, `--name-status`);
    unstagedFiles = out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status, staged: false };
    });
  } catch { /* no unstaged changes */ }

  // Merge: unstaged first, then staged (if both, use staged version)
  const seen = new Set();
  const result = [];
  for (const f of [...unstagedFiles, ...stagedFiles]) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      result.push(f);
    } else if (f.staged) {
      // Update existing entry to staged
      const idx = result.findIndex(e => e.path === f.path);
      if (idx >= 0) result[idx] = f;
    }
  }
  return result;
}

function getStagedStats(root) {
  try {
    const out = git(`-C`, root, `diff`, `--cached`, `--numstat`);
    let added = 0, deleted = 0;
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      added += parseInt(parts[0] || '0', 10);
      deleted += parseInt(parts[1] || '0', 10);
    }
    return { added, deleted };
  } catch { return { added: 0, deleted: 0 }; }
}

// ---------------------------------------------------------------------------
// Commit message generation (heuristic / conventional commit)
// ---------------------------------------------------------------------------

const CONVENTIONAL_TYPES = [
  { type: 'feat', description: 'A new feature', indicators: ['add', 'new', 'implement', 'create', 'introduce', 'support'] },
  { type: 'fix', description: 'A bug fix', indicators: ['fix', 'fixes', 'fixed', 'bug', 'issue', 'resolve', 'correct', 'repair', 'hotfix'] },
  { type: 'refactor', description: 'Code refactoring', indicators: ['refactor', 'restructure', 'simplify', 'clean', 'reorganize', 'rewrite'] },
  { type: 'docs', description: 'Documentation changes', indicators: ['doc', 'docs', 'readme', 'documentation', 'comment', 'api-doc'] },
  { type: 'test', description: 'Adding or updating tests', indicators: ['test', 'spec', 'assert', 'mock', 'fixture', 'coverage'] },
  { type: 'chore', description: 'Build/config/housekeeping', indicators: ['config', 'build', 'ci', 'deps', 'dependency', 'setup', 'init', 'release', 'version', 'bump'] },
  { type: 'style', description: 'Code style / formatting', indicators: ['style', 'format', 'lint', 'prettier', 'eslint', 'indent', 'whitespace'] },
  { type: 'perf', description: 'Performance improvement', indicators: ['perf', 'performance', 'optimize', 'speed', 'fast', 'cache', 'memoize', 'lazy'] },
  { type: 'fix', description: 'UI/UX fix', indicators: ['ui', 'ux', 'layout', 'style', 'css', 'responsive'] },
  { type: 'feat', description: 'API or integration', indicators: ['api', 'endpoint', 'route', 'graphql', 'rest', 'grpc'] },
];

/**
 * Detect conventional commit type from changed files + diff content.
 */
function detectType(changedFiles, diffContent) {
  const extensions = new Set(changedFiles.map(f => extname(f.path).toLowerCase()));
  const paths = changedFiles.map(f => f.path.toLowerCase());
  const combined = [...paths, diffContent.toLowerCase()].join(' ');

  // Check for test files
  if (paths.some(p => p.includes('test') || p.includes('spec') || p.endsWith('.test.') || p.endsWith('.spec.'))) {
    // If only test files changed
    if (changedFiles.every(f => f.path.toLowerCase().includes('test') || f.path.toLowerCase().includes('spec'))) {
      return 'test';
    }
  }

  // Check for docs
  if (extensions.has('.md') || extensions.has('.txt') || paths.some(p => p.includes('doc') || p.includes('readme'))) {
    if (changedFiles.every(f => {
      const ext = extname(f.path).toLowerCase();
      return ['.md', '.txt', '.rst', '.adoc'].includes(ext) || f.path.toLowerCase().includes('doc');
    })) {
      return 'docs';
    }
  }

  // Score each type
  const scores = {};
  for (const { type, indicators } of CONVENTIONAL_TYPES) {
    const score = indicators.filter(ind => combined.includes(ind)).length;
    if (!scores[type]) scores[type] = 0;
    scores[type] += score;
  }

  // Default ordering for tie-breaking
  const typeOrder = ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'style', 'perf'];
  let bestType = 'chore';
  let bestScore = 0;
  for (const type of typeOrder) {
    if ((scores[type] || 0) > bestScore) {
      bestScore = scores[type];
      bestType = type;
    }
  }

  return bestType;
}

/**
 * Detect scope from file paths.
 */
function detectScope(changedFiles) {
  // Look for common top-level directories
  const dirs = changedFiles
    .map(f => f.path.split(/[/\\]/)[0])
    .filter(Boolean);

  if (dirs.length === 0) return '';

  // Find most common directory
  const counts = {};
  for (const d of dirs) { counts[d] = (counts[d] || 0) + 1; }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // Only use scope if >50% of files are in the same directory
  if (sorted[0][1] > changedFiles.length * 0.5) {
    return sorted[0][0];
  }

  return '';
}

/**
 * Generate a short summary line from diff content.
 */
function generateSummary(changedFiles, diffContent) {
  const paths = changedFiles.map(f => f.path);
  const lowercaseDiff = diffContent.toLowerCase();

  // Try to find meaningful keywords
  const keywords = [
    { word: 'implement', template: 'implement' },
    { word: 'add', template: 'add' },
    { word: 'support', template: 'add support for' },
    { word: 'handle', template: 'handle' },
    { word: 'update', template: 'update' },
    { word: 'remove', template: 'remove' },
    { word: 'fix', template: 'fix' },
    { word: 'improve', template: 'improve' },
    { word: 'refactor', template: 'refactor' },
    { word: 'simplify', template: 'simplify' },
  ];

  // Pick the most descriptive keyword present
  let verb = 'update';
  let verbIdx = -1;
  for (const { word, template } of keywords) {
    const idx = lowercaseDiff.indexOf(word);
    if (idx >= 0 && (verbIdx < 0 || idx < verbIdx)) {
      verb = template;
      verbIdx = idx;
    }
  }

  // Extract the main subject from file names
  const fileSubjects = paths
    .map(p => {
      const base = p.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
      // Convert camelCase/snake_case to readable words
      return base
        .replace(/([A-Z])/g, ' $1')
        .replace(/[-_]/g, ' ')
        .toLowerCase()
        .trim();
    })
    .filter(Boolean);

  // Use the most generic file as subject, or combine a few
  const uniqueSubjects = [...new Set(fileSubjects)];
  let subject;
  if (uniqueSubjects.length <= 3) {
    subject = uniqueSubjects.join(', ');
  } else {
    // Pick the most meaningful ones
    const meaningful = uniqueSubjects.filter(s => s.length > 2 && !['index', 'main', 'app', 'util', 'helper', 'common'].includes(s));
    subject = meaningful.length > 0 ? meaningful.slice(0, 3).join(', ') : uniqueSubjects[0];
  }

  return `${verb} ${subject}`;
}

/**
 * Generate a complete conventional commit message.
 */
function generateCommitMessage(changedFiles, diffContent, opts = {}) {
  const type = opts.type || detectType(changedFiles, diffContent);
  const scope = opts.scope !== undefined ? opts.scope : detectScope(changedFiles);
  const summary = generateSummary(changedFiles, diffContent);

  const stats = getStagedStats(resolve(opts.root || '.'));

  const header = scope ? `${type}(${scope}): ${summary}` : `${type}: ${summary}`;

  // Body: list of changed files with status
  const bodyLines = [];
  bodyLines.push('');
  for (const f of changedFiles) {
    const statusSymbol = f.status === 'A' ? '➕' : f.status === 'D' ? '➖' : '✏️';
    bodyLines.push(`${statusSymbol} ${f.path}`);
  }

  if (stats.added > 0 || stats.deleted > 0) {
    bodyLines.push('');
    bodyLines.push(`📊 ${stats.added} additions, ${stats.deleted} deletions`);
  }

  return { header, body: bodyLines.join('\n'), full: header + bodyLines.join('\n') };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatText(result, color) {
  const c = COLORS;
  const lines = [];

  if (result.status === 'no-changes') {
    return color
      ? `${c.yellow}No changes to commit.${c.reset}`
      : 'No changes to commit.';
  }

  if (result.status === 'dry-run') {
    lines.push(color
      ? `${c.bold}${c.blue}📋 Proposed Commit${c.reset}`
      : '--- Proposed Commit ---');
    lines.push('');
    lines.push(color
      ? `${c.green}${result.message}${c.reset}`
      : result.message);
    lines.push('');

    // Files
    lines.push(color ? `${c.bold}Files:${c.reset}` : 'Files:');
    for (const f of result.files) {
      const symbol = f.status === 'A' ? '+' : f.status === 'D' ? '-' : '~';
      const fileColor = f.status === 'A' ? c.green : f.status === 'D' ? c.red : c.yellow;
      const stagedLabel = f.staged ? '' : ' (unstaged)';
      if (color) {
        lines.push(`  ${fileColor}${symbol} ${f.path}${c.reset}${c.dim}${stagedLabel}${c.reset}`);
      } else {
        lines.push(`  ${symbol} ${f.path}${stagedLabel}`);
      }
    }

    if (result.stats) {
      lines.push('');
      lines.push(color
        ? `${c.dim}${result.stats.added} additions, ${result.stats.deleted} deletions${c.reset}`
        : `${result.stats.added} additions, ${result.stats.deleted} deletions`);
    }

    lines.push('');
    lines.push(color
      ? `${c.dim}Run without --dry-run to execute this commit.${c.reset}`
      : 'Run without --dry-run to execute this commit.');
  }

  if (result.status === 'committed') {
    lines.push(color
      ? `${c.green}✓ Committed${c.reset}  ${result.hash}`
      : `✓ Committed  ${result.hash}`);
    lines.push('');
    lines.push(result.message);
  }

  if (result.status === 'amended') {
    lines.push(color
      ? `${c.green}✓ Amended${c.reset}  ${result.hash}`
      : `✓ Amended  ${result.hash}`);
    lines.push('');
    lines.push(result.message);
  }

  return lines.join('\n');
}

function formatJSON(result) {
  return JSON.stringify(result, null, 2);
}

function formatMarkdown(result) {
  const lines = [];

  if (result.status === 'no-changes') {
    return '## No changes to commit.';
  }

  if (result.status === 'dry-run') {
    lines.push('# Proposed Commit');
    lines.push('');
    lines.push('```');
    lines.push(result.message);
    lines.push('```');
    lines.push('');
    lines.push('## Files');
    lines.push('');
    for (const f of result.files) {
      const symbol = f.status === 'A' ? '➕' : f.status === 'D' ? '➖' : '✏️';
      lines.push(`- ${symbol} \`${f.path}\`${f.staged ? '' : ' (unstaged)'}`);
    }
    if (result.stats) {
      lines.push('');
      lines.push(`- **${result.stats.added}** additions, **${result.stats.deleted}** deletions`);
    }
  }

  if (result.status === 'committed' || result.status === 'amended') {
    lines.push(`# ${result.status === 'committed' ? 'Committed' : 'Amended'}`);
    lines.push('');
    lines.push(`**Hash**: \`${result.hash}\``);
    lines.push('');
    lines.push('```');
    lines.push(result.message);
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
    message: null,
    type: null,
    scope: undefined, // undefined = auto, '' = no scope, 'xxx' = explicit
    all: false,
    amend: false,
    dryRun: false,
    format: 'text',
    color: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--message': opts.message = args[++i]; break;
      case '--type': opts.type = args[++i]; break;
      case '--scope': opts.scope = args[++i]; break;
      case '--all': case '-a': opts.all = true; break;
      case '--amend': opts.amend = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node git-commit.mjs [options]

Smart commit with auto-generated conventional commit messages.

Options:
  --root <path>           Git repository root (default: .)
  --message <msg>         Use this message instead of auto-generating
  --type <type>           Force conventional commit type (feat, fix, refactor, etc.)
  --scope <scope>         Add scope to commit message (e.g., "auth", "api")
                         Use --scope "" to force no scope
  --all, -a               Auto-stage all tracked files before committing
  --amend                 Amend the last commit instead of creating a new one
  --dry-run               Show what would be committed without committing
  --format <fmt>          Output: text, json, markdown (default: text)
  --no-color              Disable color output
  -h, --help              Show this help

Examples:
  node git-commit.mjs
  node git-commit.mjs --dry-run
  node git-commit.mjs --type feat --scope api
  node git-commit.mjs --message "fix: resolve login timeout"
  node git-commit.mjs --all --amend
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

  // Check for changes
  const changedFiles = getChangedFiles(root);
  const stagedFiles = changedFiles.filter(f => f.staged);
  const unstagedModified = changedFiles.filter(f => !f.staged && f.status !== 'D');

  if (changedFiles.length === 0) {
    const result = { status: 'no-changes', message: 'No changes to commit.', files: [], stats: null };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(0);
  }

  // Auto-stage if --all is provided
  if (opts.all) {
    for (const f of unstagedModified) {
      try { git(`-C`, root, `add`, f.path); } catch { /* skip */ }
    }
    // Re-read files
    const updatedFiles = getChangedFiles(root);
    const filesToCommit = updatedFiles.filter(f => f.staged);
    if (filesToCommit.length === 0) {
      const result = { status: 'no-changes', message: 'No changes staged after --all.', files: [], stats: null };
      switch (opts.format) {
        case 'json': console.log(formatJSON(result)); break;
        case 'markdown': console.log(formatMarkdown(result)); break;
        default: console.log(formatText(result, color)); break;
      }
      process.exit(0);
    }
    // Override changedFiles with only staged ones after --all
    changedFiles.length = 0;
    changedFiles.push(...filesToCommit);
  }

  // Get diff content for analysis
  let diffContent = '';
  if (opts.dryRun || !opts.message) {
    // Get staged diff for analysis
    try {
      diffContent = git(`-C`, root, `diff`, `--cached`);
    } catch { /* fallback */ }
    // If no staged diff, get unstaged
    if (!diffContent.trim()) {
      try {
        diffContent = git(`-C`, root, `diff`);
      } catch { /* fallback */ }
    }
  }

  // Generate or use provided message
  let message;
  if (opts.message) {
    message = opts.message;
  } else {
    const generated = generateCommitMessage(changedFiles, diffContent, opts);
    message = generated.header;
  }

  // Stats
  const stats = getStagedStats(root);

  if (opts.dryRun) {
    const result = {
      status: 'dry-run',
      message,
      messageBody: '',
      files: changedFiles,
      stats,
      commitType: opts.type || detectType(changedFiles, diffContent),
      commitScope: opts.scope !== undefined ? opts.scope : detectScope(changedFiles),
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
    process.exit(0);
  }

  // Execute commit
  if (opts.amend && stagedFiles.length === 0 && unstagedModified.length === 0) {
    // Amend with no additional changes — just edit message
    try {
      git(`-C`, root, `commit`, `--amend`, `-m`, message);
      const hash = git(`-C`, root, `rev-parse`, `--short`, `HEAD`).trim();
      const result = { status: 'amended', hash, message, files: [], stats };
      switch (opts.format) {
        case 'json': console.log(formatJSON(result)); break;
        case 'markdown': console.log(formatMarkdown(result)); break;
        default: console.log(formatText(result, color)); break;
      }
    } catch (e) {
      console.error('Amend failed:', e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Count staged files
  const finalStaged = changedFiles.filter(f => f.staged);

  if (finalStaged.length === 0) {
    // Try to commit unstaged: add them first
    for (const f of changedFiles) {
      try { git(`-C`, root, `add`, f.path); } catch { /* skip */ }
    }
  }

  // Execute commit
  try {
    if (opts.amend) {
      git(`-C`, root, `commit`, `--amend`, `-m`, message);
    } else {
      git(`-C`, root, `commit`, `-m`, message);
    }
    const hash = git(`-C`, root, `rev-parse`, `--short`, `HEAD`).trim();
    const result = {
      status: opts.amend ? 'amended' : 'committed',
      hash,
      message,
      files: changedFiles,
      stats,
    };
    switch (opts.format) {
      case 'json': console.log(formatJSON(result)); break;
      case 'markdown': console.log(formatMarkdown(result)); break;
      default: console.log(formatText(result, color)); break;
    }
  } catch (e) {
    console.error('Commit failed:', e.message);
    process.exit(1);
  }
}

main();
