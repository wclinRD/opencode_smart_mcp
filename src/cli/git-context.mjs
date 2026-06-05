#!/usr/bin/env node

/**
 * git-context.mjs — Git diff context analyzer with impact analysis
 *
 * Analyzes git changes and enriches them with import-graph context,
 * showing what other files are affected by each change.
 *
 * Usage:
 *   node git-context.mjs [options]
 *
 * Options:
 *   --root <path>         Git repository root (default: .)
 *   --staged              Include staged changes (default: only unstaged)
 *   --all                 Include both staged and unstaged
 *   --commit <ref>        Analyze a specific commit (instead of working tree)
 *   --range <range>       Analyze a commit range (e.g., HEAD~3..HEAD)
 *   --impact              Show impact analysis using import graph
 *   --format <fmt>        Output format: text, json, markdown (default: text)
 *   --context <N>         Lines of diff context (default: 3)
 *   --stat-only           Only show file stats, not diffs
 *   --no-color            Disable color output
 *   -h, --help            Show this help
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, extname, dirname } from 'node:path';

import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Git operations
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

function getChangedFiles(root, opts) {
  const cwd = root;
  const files = new Map(); // file -> { status, staged, added, deleted, modified }

  // Unstaged changes
  if (!opts.staged || opts.all) {
    const diff = git('diff', '--name-status', '--diff-filter=ADM', '--no-renames');
    for (const line of diff.trim().split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      const absPath = resolve(root, filePath);
      files.set(filePath, {
        path: filePath,
        absPath,
        status,
        staged: false,
        added: status === 'A' ? getFullDiff(root, filePath, 'unstaged') : null,
        deleted: status === 'D' ? getFullDiff(root, filePath, 'unstaged') : null,
      });
    }
  }

  // Staged changes
  if ((opts.staged || opts.all) && !opts.commit && !opts.range) {
    const diff = git('diff', '--cached', '--name-status', '--diff-filter=ADM', '--no-renames');
    for (const line of diff.trim().split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      const existing = files.get(filePath);
      if (existing) {
        existing.staged = true;
        existing.status = status;
      } else {
        const absPath = resolve(root, filePath);
        files.set(filePath, {
          path: filePath,
          absPath,
          status,
          staged: true,
          added: status === 'A' ? getFullDiff(root, filePath, 'staged') : null,
          deleted: status === 'D' ? getFullDiff(root, filePath, 'staged') : null,
        });
      }
    }
  }

  return [...files.values()];
}

function getFullDiff(root, filePath, type) {
  try {
    if (type === 'staged') {
      return git('diff', '--cached', '--', filePath);
    } else {
      return git('diff', '--', filePath);
    }
  } catch { return ''; }
}

function getCommitDiff(root, commit) {
  try {
    return git('show', commit, '--format=""', '--no-color');
  } catch { return ''; }
}

function getCommitFiles(root, commit) {
  try {
    const diff = git('diff-tree', '--no-commit-id', '-r', '--name-status', '--diff-filter=ADM', commit);
    const files = [];
    for (const line of diff.trim().split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t');
      files.push({ path: pathParts.join('\t'), absPath: resolve(root, pathParts.join('\t')), status });
    }
    return files;
  } catch { return []; }
}

function getRangeDiff(root, range) {
  try {
    const diff = git('diff', range, '--name-status', '--diff-filter=ADM', '--no-renames');
    const files = [];
    for (const line of diff.trim().split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t');
      files.push({ path: pathParts.join('\t'), absPath: resolve(root, pathParts.join('\t')), status });
    }
    return files;
  } catch { return []; }
}

function getCommitLog(root, count = 10) {
  try {
    const log = git('log', `--oneline`, `-${count}`);
    return log.trim().split('\n').filter(Boolean).map(line => {
      const [hash, ...msg] = line.split(' ');
      return { hash, message: msg.join(' ') };
    });
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Import graph integration (lightweight, file-level)
// ---------------------------------------------------------------------------
const IMPORT_PATTERNS = [
  /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function extractImports(filePath) {
  if (!existsSync(filePath)) return [];
  const ext = extname(filePath).toLowerCase();
  if (!['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports = [];
    for (const re of IMPORT_PATTERNS) {
      let match;
      while ((match = re.exec(content)) !== null) {
        const raw = match[1].trim();
        if (raw && (raw.startsWith('.') || raw.startsWith('..'))) {
          imports.push(raw);
        }
      }
    }
    return imports;
  } catch { return []; }
}

function buildImportGraph(root, files) {
  const graph = new Map(); // absPath -> { imports: [absPath], importedBy: [absPath] }

  for (const f of files) {
    if (!graph.has(f)) graph.set(f, { imports: [], importedBy: [] });
    const relImports = extractImports(f);
    for (const imp of relImports) {
      const importerDir = dirname(f);
      const resolved = resolve(importerDir, imp);
      // Try extensions
      const exts = ['.js', '.mjs', '.ts', '.jsx', '.tsx'];
      let resolvedPath = null;
      for (const ext of exts) {
        const candidate = resolved + ext;
        if (existsSync(candidate)) { resolvedPath = candidate; break; }
      }
      if (!resolvedPath) {
        for (const ext of exts) {
          const candidate = resolve(resolved, `index${ext}`);
          if (existsSync(candidate)) { resolvedPath = candidate; break; }
        }
      }
      if (resolvedPath) {
        graph.get(f).imports.push(resolvedPath);
        if (!graph.has(resolvedPath)) graph.set(resolvedPath, { imports: [], importedBy: [] });
        graph.get(resolvedPath).importedBy.push(f);
      }
    }
  }

  return graph;
}

function analyzeImpact(root, changedFiles) {
  const allProjectFiles = getAllProjectFiles(root);
  const graph = buildImportGraph(root, allProjectFiles);
  const impact = new Map(); // absPath -> { directly: bool, chain: [] }

  const changedAbsPaths = new Set(changedFiles.map(f => f.absPath));

  // Find files directly affected
  for (const [file, deps] of graph) {
    for (const imp of deps.imports) {
      if (changedAbsPaths.has(imp)) {
        if (!impact.has(file)) impact.set(file, { directly: false, chain: [] });
        impact.get(file).chain.push(imp);
      }
    }
    if (changedAbsPaths.has(file)) {
      if (!impact.has(file)) impact.set(file, { directly: true, chain: [] });
      else impact.get(file).directly = true;
    }
  }

  return [...impact.entries()]
    .filter(([, v]) => v.directly || v.chain.length > 0)
    .map(([file, info]) => ({
      file: relative(root, file),
      absPath: file,
      directlyChanged: info.directly,
      affectedBy: [...new Set(info.chain)].map(f => relative(root, f)),
    }))
    .sort((a, b) => {
      if (a.directlyChanged !== b.directlyChanged) return a.directlyChanged ? -1 : 1;
      return a.file.localeCompare(b.file);
    });
}

function getAllProjectFiles(root) {
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = require('fs').readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) {
        const ext = extname(fullPath).toLowerCase();
        if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  walk(root);
  return files;
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------
function parseDiff(diffText) {
  const hunks = [];
  const lines = diffText.split('\n');
  let currentHunk = null;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] || '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] || '1', 10),
        section: hunkMatch[5].trim(),
        lines: [],
      };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(changes, opts, color) {
  const c = COLORS;
  const lines = [];

  if (changes.length === 0) {
    return color
      ? `${c.green}No changes detected.${c.reset}`
      : 'No changes detected.';
  }

  // Summary
  const added = changes.filter(f => f.status === 'A').length;
  const modified = changes.filter(f => f.status === 'M').length;
  const deleted = changes.filter(f => f.status === 'D').length;
  lines.push(color
    ? `${c.bold}${c.blue}Changes:${c.reset} ${c.green}+${added}${c.reset} ${c.yellow}~${modified}${c.reset} ${c.red}-${deleted}${c.reset}`
    : `Changes: +${added} ~${modified} -${deleted}`);
  lines.push('');

  for (const change of changes) {
    const statusSymbol = change.status === 'A' ? '+' : change.status === 'D' ? '-' : '~';
    const statusColor = change.status === 'A' ? c.green : change.status === 'D' ? c.red : c.yellow;
    const stagedLabel = change.staged ? ' (staged)' : '';

    if (color) {
      lines.push(`${c.bold}${statusColor}${statusSymbol} ${change.path}${c.reset}${c.dim}${stagedLabel}${c.reset}`);
    } else {
      lines.push(`${statusSymbol} ${change.path}${stagedLabel}`);
    }

    // Show impact if available
    if (change.impact && change.impact.length > 0) {
      const directlyChanged = change.impact.filter(i => i.directlyChanged);
      const affected = change.impact.filter(i => !i.directlyChanged);
      if (directlyChanged.length > 0 && color) {
        lines.push(`  ${c.dim}→ ${directlyChanged.length} file(s) directly affected${c.reset}`);
      } else if (directlyChanged.length > 0) {
        lines.push(`  → ${directlyChanged.length} file(s) directly affected`);
      }
      if (affected.length > 0) {
        const shown = affected.slice(0, 5);
        const more = affected.length > 5 ? ` ... and ${affected.length - 5} more` : '';
        if (color) {
          lines.push(`  ${c.dim}↳ may affect: ${shown.map(i => i.file).join(', ')}${more}${c.reset}`);
        } else {
          lines.push(`  ↳ may affect: ${shown.map(i => i.file).join(', ')}${more}`);
        }
      }
    }

    // Show diff content (not in stat-only mode)
    if (!opts.statOnly && change.status !== 'D') {
      const diffContent = change.staged
        ? getFullDiff(opts.root, change.path, 'staged')
        : getFullDiff(opts.root, change.path, 'unstaged');
      if (diffContent) {
        const hunks = parseDiff(diffContent);
        for (const hunk of hunks) {
          if (color) {
            lines.push(`  ${c.dim}@@ ${hunk.section ? '-... +... @@ ' + hunk.section : ''}${c.reset}`);
          } else {
            lines.push(`  @@ ${hunk.section || ''}`);
          }
          const contextLines = opts.context || 3;
          let shownLines = 0;
          let skipped = false;
          for (const diffLine of hunk.lines) {
            if (diffLine.startsWith('\\')) continue; // no newline at end of file
            if (diffLine.startsWith(' ')) {
              shownLines++;
              if (shownLines > contextLines * 2 && shownLines < hunk.lines.length - contextLines) {
                if (!skipped) {
                  lines.push(color ? `  ${c.dim}...${c.reset}` : '  ...');
                  skipped = true;
                }
                continue;
              }
              skipped = false;
              if (color) {
                lines.push(`  ${c.dim} ${diffLine}${c.reset}`);
              } else {
                lines.push(`  ${diffLine}`);
              }
            } else if (diffLine.startsWith('+')) {
              skipped = false;
              lines.push(color ? `  ${c.green}+${diffLine.slice(1)}${c.reset}` : `  ${diffLine}`);
            } else if (diffLine.startsWith('-')) {
              skipped = false;
              lines.push(color ? `  ${c.red}-${diffLine.slice(1)}${c.reset}` : `  ${diffLine}`);
            }
          }
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatJSON(changes, opts) {
  return JSON.stringify({
    root: opts.root,
    changes: changes.map(c => ({
      path: c.path,
      status: c.status,
      staged: c.staged,
      impact: c.impact || [],
    })),
  }, null, 2);
}

function formatMarkdown(changes, opts) {
  const lines = [];
  lines.push('# Git Changes Analysis');
  lines.push('');

  const added = changes.filter(f => f.status === 'A').length;
  const modified = changes.filter(f => f.status === 'M').length;
  const deleted = changes.filter(f => f.status === 'D').length;
  lines.push(`- **Added**: ${added}`);
  lines.push(`- **Modified**: ${modified}`);
  lines.push(`- **Deleted**: ${deleted}`);
  lines.push('');

  for (const change of changes) {
    lines.push(`## \`${change.path}\``);
    lines.push('');
    lines.push(`- **Status**: ${change.status === 'A' ? 'Added' : change.status === 'D' ? 'Deleted' : 'Modified'}`);
    if (change.staged) lines.push('- **Staged**: yes');
    if (change.impact && change.impact.length > 0) {
      const directlyChanged = change.impact.filter(i => i.directlyChanged);
      if (directlyChanged.length > 0) {
        lines.push(`- **Directly affected**: ${directlyChanged.length} file(s)`);
      }
      const affected = change.impact.filter(i => !i.directlyChanged);
      if (affected.length > 0) {
        lines.push(`- **May affect**: ${affected.map(i => `\`${i.file}\``).join(', ')}`);
      }
    }
    lines.push('');
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
    staged: false,
    all: false,
    commit: null,
    range: null,
    impact: false,
    format: 'text',
    context: 3,
    statOnly: false,
    color: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--staged': opts.staged = true; break;
      case '--all': opts.all = true; break;
      case '--commit': opts.commit = args[++i]; break;
      case '--range': opts.range = args[++i]; break;
      case '--impact': opts.impact = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--context': opts.context = parseInt(args[++i], 10); break;
      case '--stat-only': opts.statOnly = true; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node git-context.mjs [options]

Git diff context analyzer with impact analysis.

Options:
  --root <path>         Git repository root (default: .)
  --staged              Include staged changes
  --all                 Include both staged and unstaged
  --commit <ref>        Analyze a specific commit
  --range <range>       Analyze a commit range (e.g., HEAD~3..HEAD)
  --impact              Show impact analysis using import graph
  --format <fmt>        Output: text, json, markdown (default: text)
  --context <N>         Lines of diff context (default: 3)
  --stat-only           Only show file stats, not diffs
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node git-context.mjs
  node git-context.mjs --all --impact
  node git-context.mjs --commit HEAD
  node git-context.mjs --range HEAD~3..HEAD --format markdown
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);
  opts.root = root;

  if (!isGitRepo(root)) {
    console.error('Not a git repository:', root);
    process.exit(1);
  }

  let changes;

  if (opts.commit) {
    changes = getCommitFiles(root, opts.commit);
  } else if (opts.range) {
    changes = getRangeDiff(root, opts.range);
  } else {
    changes = getChangedFiles(root, opts);
  }

  // Enrich with impact analysis
  if (opts.impact && changes.length > 0) {
    const impact = analyzeImpact(root, changes);
    for (const change of changes) {
      change.impact = impact.filter(i =>
        i.file === change.path ||
        i.affectedBy.includes(change.path)
      );
    }
  }

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(changes, opts));
      break;
    case 'markdown':
      console.log(formatMarkdown(changes, opts));
      break;
    case 'text':
    default:
      console.log(formatText(changes, opts, color));
      break;
  }
}

main();
