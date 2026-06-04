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

// ---------------------------------------------------------------------------
// Diff content analysis helpers
// ---------------------------------------------------------------------------

/**
 * Extract the "meat" of the diff — added/removed code lines (not context).
 */
function extractCodeChanges(diffContent) {
  const added = [];
  const removed = [];
  for (const line of diffContent.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++ ')) added.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('--- ')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * Parse diff to extract per-file changes: what functions/classes are touched.
 */
function parseDiffStructure(diffContent) {
  const files = [];
  let current = null;

  for (const line of diffContent.split('\n')) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      if (current) files.push(current);
      current = { oldPath: fileMatch[1], newPath: fileMatch[2], hunks: [], addedLines: [], removedLines: [] };
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+,\d+ \+(\d+),\d+ @@\s*(.*)/);
    if (hunkMatch && current) {
      current.hunks.push({ start: parseInt(hunkMatch[1], 10), section: hunkMatch[2].trim() });
      continue;
    }
    if (current) {
      if (line.startsWith('+') && !line.startsWith('+++ ')) current.addedLines.push(line.slice(1));
      else if (line.startsWith('-') && !line.startsWith('--- ')) current.removedLines.push(line.slice(1));
    }
  }
  if (current) files.push(current);
  return files;
}

/**
 * Extract meaningful identifiers from added code lines.
 */
function extractIdentifiers(lines) {
  const ids = new Set();
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)/g,
    /(?:export\s+)?class\s+(\w+)/g,
    /(?:export\s+)?interface\s+(\w+)/g,
    /(?:export\s+)?type\s+(\w+)/g,
    /(?:export\s+)?enum\s+(\w+)/g,
    /(?:import\s+)(?:(\w+)|{[\s\S]*?})\s+from/g,
    /module\.exports\s*=\s*(\w+)/g,
    /def\s+(\w+)\s*\(/g,
    /class\s+(\w+)/g,
    /(\w+)\s*=\s*(?:class|function)\s*\(/g,
    /\.(\w+)\s*=\s*(?:function|\(|async)/g,
    /(?:it|test|describe)\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const line of lines) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (m[1] && m[1].length > 1) ids.add(m[1]);
      }
    }
  }
  return [...ids];
}

/**
 * Detect conventional commit type from changed files + diff content.
 */
function detectType(changedFiles, diffContent) {
  const extensions = new Set(changedFiles.map(f => extname(f.path).toLowerCase()));
  const paths = changedFiles.map(f => f.path.toLowerCase());
  const { added, removed } = extractCodeChanges(diffContent);
  const combinedCode = [...added, ...removed].join(' ');
  const combinedPaths = paths.join(' ');

  // Special-case detection (high precision)

  // 1. Only test files changed → test
  if (changedFiles.every(f =>
    /test|spec|__tests__|__mocks__|fixture/.test(f.path.toLowerCase()) ||
    /\.(test|spec)\./.test(f.path.toLowerCase())
  )) return 'test';

  // 2. Only docs files changed → docs
  if (changedFiles.every(f => {
    const ext = extname(f.path).toLowerCase();
    return ['.md', '.txt', '.rst', '.adoc', '.mdx'].includes(ext);
  })) return 'docs';

  // 3. Only config/CI files → chore
  if (changedFiles.every(f =>
    /(config|\.json|\.yaml|\.yml|\.toml|dockerfile|ci|\.gitignore)/i.test(f.path) &&
    !/src|lib|app/.test(f.path)
  )) return 'chore';

  // 4. Only style files → style
  if (changedFiles.every(f =>
    /\.(css|scss|less|styl)/i.test(extname(f.path))
  )) return 'style';

  // Heuristic scoring — primarily based on ADDED code
  const codeLower = combinedCode.toLowerCase();
  const addedCodeLower = added.join(' ').toLowerCase();
  const scores = { feat: 0, fix: 0, refactor: 0, chore: 0 };

  // Count changed lines
  const totalChangeLines = added.length + removed.length;
  if (totalChangeLines === 0) return 'chore';

  // Added lines with new identifiers → feat (weighted by proportion)
  const identifiers = extractIdentifiers(added);
  const newFunctionRatio = identifiers.length / Math.max(added.length, 1);

  if (newFunctionRatio > 0.15) scores.feat += 3;
  else if (newFunctionRatio > 0.05) scores.feat += 1;

  // Significant removal proportion → refactor
  if (removed.length > added.length * 0.5) scores.refactor += 2;
  else if (removed.length > added.length * 0.2) scores.refactor += 1;

  // Keywords in ADDED code only (not removed!)
  if (/fix|bug|issue|error|exception|null|undefined|crash|fail/.test(addedCodeLower)) scores.fix += 2;
  if (/add|implement|create|new|support|feature/.test(addedCodeLower)) scores.feat += 2;
  if (/refactor|restructur|clean|simplif|extract|reorgan/.test(addedCodeLower)) scores.refactor += 2;
  if (/deprecat|remov|drop|delete/.test(addedCodeLower)) {
    scores.chore += 1;
  }

  // Perf keywords — only score, don't short-circuit (avoid false positives from code that
  // mentions 'perf' as a type string or regex pattern)
  if (added.some(l => /optimize|performance|slow|latency|throughput|bottleneck/i.test(l))) scores.perf = 2;

  // File addition ratio
  const addedFiles = changedFiles.filter(f => f.status === 'A').length;
  const totalFiles = changedFiles.length;
  if (addedFiles / totalFiles > 0.5) scores.feat += 1;

  // Config-only changes → chore
  if (combinedPaths.includes('config') || combinedPaths.includes('.json') || combinedPaths.includes('.yaml')) {
    if (identifiers.length === 0) scores.chore += 1;
  }

  const typeOrder = ['feat', 'fix', 'refactor', 'perf', 'chore'];
  let bestType = 'chore';
  let bestScore = -1;
  for (const t of typeOrder) {
    if ((scores[t] || 0) > bestScore) {
      bestScore = scores[t];
      bestType = t;
    }
  }

  // Tie-break: when scores are equal, prefer more meaningful type
  if (bestScore === 0) return 'chore';

  return bestType;
}

/**
 * Detect scope from file paths — finds the deepest common ancestor directory.
 */
function detectScope(changedFiles) {
  if (changedFiles.length === 0) return '';

  const paths = changedFiles.map(f => f.path.split(/[/\\]/).filter(Boolean));

  // Single file: use second-to-last segment (parent dir), or empty for root files
  if (paths.length === 1) {
    const parts = paths[0];
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }

  // Multiple files: find common ancestor path
  const minLen = Math.min(...paths.map(p => p.length));
  let commonLen = 0;
  for (let i = 0; i < minLen; i++) {
    const first = paths[0][i];
    if (paths.every(p => p[i] === first)) {
      commonLen = i + 1;
    } else break;
  }

  if (commonLen <= 1) {
    // No deep common ancestor — use most frequent top-level directory
    const tops = paths.map(p => p[0]).filter(Boolean);
    const counts = {};
    let maxCount = 0;
    let topDir = '';
    for (const d of tops) {
      counts[d] = (counts[d] || 0) + 1;
      if (counts[d] > maxCount) { maxCount = counts[d]; topDir = d; }
    }
    return maxCount > changedFiles.length * 0.4 ? topDir : '';
  }

  // Use common ancestor, but strip too-generic top levels
  const ancestor = paths[0].slice(0, commonLen);
  const ancestorStr = ancestor.join('/');

  // Avoid overly broad scopes like just "src"
  if (commonLen === 1 && (ancestorStr === 'src' || ancestorStr === 'lib' || ancestorStr === 'app')) {
    return '';
  }

  return ancestorStr;
}

/**
 * Generate a concise, meaningful summary from diff content.
 */
function generateSummary(changedFiles, diffContent) {
  const paths = changedFiles.map(f => f.path);
  const diffFiles = parseDiffStructure(diffContent);
  const { added } = extractCodeChanges(diffContent);

  // Extract identifiers from added code
  const identifiers = extractIdentifiers(added);

  // Determine verb based on change patterns
  const addedFiles = changedFiles.filter(f => f.status === 'A').length;
  const deletedFiles = changedFiles.filter(f => f.status === 'D').length;
  const modifiedFiles = changedFiles.filter(f => f.status === 'M' || (f.status !== 'A' && f.status !== 'D')).length;

  let verb;
  if (addedFiles > 0 && modifiedFiles === 0 && deletedFiles === 0 && changedFiles.length === addedFiles) {
    verb = 'add';
  } else if (deletedFiles > 0 && addedFiles === 0 && modifiedFiles === 0) {
    verb = 'remove';
  } else if (identifiers.some(id => /implement|creat|init/i.test(id))) {
    verb = 'implement';
  } else if (addedFiles >= modifiedFiles) {
    verb = 'add';
  } else if (modifiedFiles > addedFiles && identifiers.some(id => /(?:refactor|simplif|clean|extract|restruct)/i.test(id))) {
    verb = 'refactor';
  } else {
    verb = 'update';
  }



  // Convert all filenames to readable subjects (used as fallback)
  const uniqueFileSubjects = [...new Set(
    paths.map(p => {
      const base = p.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
      return base
        .replace(/([A-Z])/g, ' $1')
        .replace(/[-_]/g, ' ')
        .toLowerCase()
        .trim();
    })
  )].filter(Boolean);

  // === Determine subject ===
  // Strategy 1: single file → use its readable name
  if (changedFiles.length === 1) {
    return `${verb} ${uniqueFileSubjects[0]}`;
  }

  // Strategy 2: new files dominate → use new filenames
  const newFileSubjects = changedFiles
    .filter(f => f.status === 'A')
    .map(f => {
      const base = f.path.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
      return base.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').toLowerCase().trim();
    })
    .filter(Boolean);
  if (newFileSubjects.length > 0 && newFileSubjects.length >= changedFiles.length * 0.5) {
    const subject = [...new Set(newFileSubjects)].slice(0, 3).join(' & ');
    return `${verb} ${subject.replace(/^./, c => c.toUpperCase())}`;
  }

  // Strategy 3: look for high-level identifiers (classes, interfaces, exports)
  // Filter out low-level implementation functions
  const highLevelIds = identifiers.filter(id =>
    id.length > 3 &&
    /^[A-Z]/.test(id) && // PascalCase = class/interface/type
    !id.endsWith('Error') && !id.endsWith('Exception')
  );
  if (highLevelIds.length > 0) {
    const subjects = [...new Set(highLevelIds.map(id =>
      id.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').toLowerCase().trim()
    ))];
    return `${verb} ${subjects.slice(0, 2).join(' & ').replace(/^./, c => c.toUpperCase())}`;
  }

  // Strategy 4: use filenames (grouped by concept)
  const filteredSubjects = uniqueFileSubjects.filter(s =>
    s.length > 2 && !['index', 'main', 'app', 'util', 'helper', 'common',
                       'utils', 'types', 'config', 'setup', 'styles'].includes(s)
  );
  const finalSubjects = filteredSubjects.length > 0 ? filteredSubjects : uniqueFileSubjects;
  const subject = finalSubjects.slice(0, 3).join(' & ');
  return `${verb} ${subject.replace(/^./, c => c.toUpperCase())}`;
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
