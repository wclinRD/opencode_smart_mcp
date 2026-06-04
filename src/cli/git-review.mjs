#!/usr/bin/env node

/**
 * git-review.mjs — Smart code review for working tree changes or PRs
 *
 * Analyzes a diff (working tree, commit range, or existing PR URL)
 * and generates a structured code review report with file-level comments,
 * categorized issues, and actionable suggestions.
 *
 * Usage:
 *   node git-review.mjs [options]
 *
 * Options:
 *   --root <path>           Git repository root (default: .)
 *   --commit <ref>          Review a specific commit (e.g., HEAD, HEAD~1)
 *   --range <range>         Review a commit range (e.g., HEAD~3..HEAD)
 *   --pr <url>              Review an existing PR (fetches diff from GitHub)
 *   --staged                Review staged changes only
 *   --all                   Review staged + unstaged changes
 *   --focus <type>          Focus review on: security, performance, correctness, style, all (default: all)
 *   --format <fmt>          Output: text, json, markdown (default: text)
 *   --output <file>         Write review report to file
 *   --max-comments <N>      Max review comments per file (default: 5)
 *   --no-color              Disable color output
 *   -h, --help              Show this help
 *
 * Examples:
 *   node git-review.mjs
 *   node git-review.mjs --staged --focus security
 *   node git-review.mjs --commit HEAD
 *   node git-review.mjs --pr https://github.com/user/repo/pull/123
 *   node git-review.mjs --all --format markdown --output review.md
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';

import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(root, ...args) {
  try {
    return execSync(`git -C "${root}" ${args.join(' ')}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
// Diff fetching
// ---------------------------------------------------------------------------

function getFullDiff(root, opts) {
  if (opts.commit) {
    return git(root, 'show', opts.commit, '--format=""', '--no-color');
  }
  if (opts.range) {
    return git(root, 'diff', opts.range, '--no-color');
  }
  if (opts.staged && !opts.all) {
    return git(root, 'diff', '--cached', '--no-color');
  }
  // Default: unstaged
  return git(root, 'diff', '--no-color');
}

function getFileDiffs(root, opts) {
  const fullDiff = getFullDiff(root, opts);
  return splitDiffByFile(fullDiff);
}

function getChangedFilesList(root, opts) {
  if (opts.commit) {
    const out = git(root, 'diff-tree', '--no-commit-id', '-r', '--name-status', opts.commit);
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status };
    });
  }
  if (opts.range) {
    const out = git(root, 'diff', opts.range, '--name-status');
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status };
    });
  }
  let result = [];
  if (opts.staged || opts.all) {
    const out = git(root, 'diff', '--cached', '--name-status');
    result = result.concat(out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status, staged: true };
    }));
  }
  if (!opts.staged || opts.all) {
    const out = git(root, 'diff', '--name-status');
    const unstaged = out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { path: pathParts.join('\t'), status, staged: false };
    });
    // Merge, preferring staged
    const seen = new Set(result.map(f => f.path));
    for (const f of unstaged) {
      if (!seen.has(f.path)) {
        result.push(f);
        seen.add(f.path);
      }
    }
  }
  return result;
}

/**
 * Split a unified diff into per-file diffs.
 */
function splitDiffByFile(diffText) {
  const files = [];
  const lines = diffText.split('\n');
  let currentFile = null;
  let currentLines = [];

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      if (currentFile) {
        currentFile.diff = currentLines.join('\n');
        files.push(currentFile);
      }
      currentFile = { oldPath: fileMatch[1], newPath: fileMatch[2], diff: '', hunks: [] };
      currentLines = [line];
    } else if (currentFile) {
      currentLines.push(line);
    }
  }
  if (currentFile) {
    currentFile.diff = currentLines.join('\n');
    files.push(currentFile);
  }

  return files;
}

/**
 * Parse hunks from a file's diff.
 */
function parseHunks(diffText) {
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
// PR review (fetch from GitHub)
// ---------------------------------------------------------------------------

async function fetchPRDiff(prUrl) {
  try {
    // Normalize URL to get the diff endpoint
    let url = prUrl.replace(/\/$/, '');
    if (!url.endsWith('.diff')) url += '.diff';
    // Use gh CLI if available
    const prMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (prMatch && isGhAvailable()) {
      const result = execSync(`gh pr view ${prMatch[1]} --json body,title,headRefName,baseRefName,additions,deletions,files`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const prInfo = JSON.parse(result);
      const diffResult = execSync(`gh pr diff ${prMatch[1]}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { diff: diffResult, info: prInfo };
    }
    // Fallback: fetch .diff from URL
    if (!url.startsWith('http')) url = `https://github.com/${url}`;
    const https = await import('node:https');
    return new Promise((resolvePromise, reject) => {
      https.get(url, { headers: { 'User-Agent': 'smart-git-review/1.0' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolvePromise({ diff: data, info: null }));
      }).on('error', reject);
    });
  } catch (e) {
    return { diff: '', info: null, error: e.message };
  }
}

function isGhAvailable() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Review analysis
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Run heuristic-based review checks on a file diff.
 */
function reviewFileDiff(fileDiff, focus = 'all') {
  const comments = [];
  const path = fileDiff.newPath || fileDiff.oldPath;
  const ext = extname(path).toLowerCase();
  const hunks = parseHunks(fileDiff.diff);
  const addedLines = [];
  const removedLines = [];

  // Collect all added/removed lines with positions
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        addedLines.push({ content: line.slice(1), line: newLine, hunk });
        newLine++;
      } else if (line.startsWith('-')) {
        removedLines.push({ content: line.slice(1), line: oldLine, hunk });
        oldLine++;
      } else if (line.startsWith(' ')) {
        oldLine++;
        newLine++;
      } else if (line.startsWith('\\')) {
        // no newline at end of file — skip
      }
    }
  }

  if (addedLines.length === 0 && removedLines.length === 0) return comments;

  // --- Security checks ---
  if (focus === 'all' || focus === 'security') {
    for (const { content, line } of addedLines) {
      // SQL injection
      if (/\b(raw_query|rawSql|execute\s*\(|\$\{.*\}.*(query|find))/i.test(content) &&
          !/(?:bind_param|parameterized|escape|sanitize|validate)/i.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'Possible SQL injection: consider using parameterized queries instead of string interpolation.' });
      }
      // Command injection
      if (/\b(exec\s*\(|spawn\s*\(|child_process|shell\s*:\s*true)/i.test(content) &&
          !/(?:escape|sanitize|validate)/i.test(content)) {
        comments.push({ file: path, line, severity: 'critical', category: 'security', message: 'Command execution detected: ensure input is validated and shell injection is prevented.' });
      }
      // Hardcoded secrets
      if (/['"][A-Za-z0-9_-]{20,}['"]/.test(content) &&
          /(password|secret|token|api[_-]?key|private[_-]?key)/i.test(content)) {
        comments.push({ file: path, line, severity: 'critical', category: 'security', message: 'Possible hardcoded secret: use environment variables or a secrets manager.' });
      }
      // eval / Function() constructor
      if (/\b(eval|Function\s*\(|setTimeout\s*\(\s*['"])/.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'eval-like expression detected: this can lead to code injection attacks.' });
      }
      // XSS: innerHTML / dangerouslySetInnerHTML
      if (/\binnerHTML\s*=/.test(content) && !/(?:textContent|escape|sanitize|DOMPurify)/i.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'Direct innerHTML assignment detected: use textContent or sanitize input to prevent XSS.' });
      }
      // XSS: document.write
      if (/\bdocument\.write\s*\(/.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'document.write can introduce XSS: consider safer DOM manipulation methods.' });
      }
      // Prototype pollution via merge/assign with user input
      if (/Object\.(assign|merge)\s*\(/.test(content) &&
          /(req\.|body|params|query|input|userInput|payload)/i.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'security', message: 'Object merge with user-controlled input: risk of prototype pollution — use a safe merge utility or Object.hasOwn check.' });
      }
      // Path traversal: user input in fs operations
      if (/('|")(\.\.\/|\.\\|[\\/]etc[\\/]|[\\/]tmp[\\/])('|")/.test(content) &&
          /(readFile|writeFile|readFileSync|writeFileSync|createReadStream|existsSync|unlink|rm)/i.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'Hardcoded path with traversal pattern: use path.join and validate against allowed base paths.' });
      }
      // postMessage without origin check
      if (/\bpostMessage\s*\(/.test(content) &&
          !/\*(origin|targetOrigin)/i.test(content) &&
          !/location\.origin/.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'postMessage should specify targetOrigin instead of "*" to prevent data leaks.' });
      }
      // Math.random for security-sensitive contexts
      if (/\bMath\.random\b/.test(content) &&
          /(password|token|secret|key|jwt|session|csrf)/i.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'security', message: 'Math.random is not cryptographically secure: use crypto.randomBytes or Web Crypto API instead.' });
      }
      // Insecure crypto: MD5/SHA1 for security
      if (/\b(md5|sha1)\b/i.test(content) &&
          /(password|hash|encrypt|sign|hmac)/i.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'security', message: 'MD5/SHA1 are not cryptographically secure: use SHA-256 or bcrypt for security-sensitive hashing.' });
      }
      // Open redirect
      if (/\bwindow\.location\s*=/.test(content) &&
          /(params|query|redirect|next|url|href|search)/i.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'security', message: 'Open redirect via window.location: validate the target URL against an allowlist to prevent phishing.' });
      }
    }
  }

  // --- Performance checks ---
  if (focus === 'all' || focus === 'performance') {
    for (const { content, line } of addedLines) {
      // N+1 queries in loops
      if (/\b(for|while)\b/.test(content) && /\.(find|findOne|findAll|query|get)\s*\(/.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'performance', message: 'Possible N+1 query inside loop: consider batching or eager loading.' });
      }
      // Large array loops
      if (/\b(forEach|map|filter|reduce)\b/.test(content) && /\.(concat|push|unshift)/.test(content)) {
        // mild
        comments.push({ file: path, line, severity: 'low', category: 'performance', message: 'Array method inside loop: consider whether this can be optimized.' });
      }
      // console.log in production
      if (/\bconsole\.(log|debug|info|warn)\b/.test(content) && !content.trim().startsWith('//') && !content.trim().startsWith('#')) {
        comments.push({ file: path, line, severity: 'low', category: 'performance', message: 'Debug logging left in code: consider removing or using a proper logger with log levels.' });
      }
      // JSON parse/stringify in loops
      if (/\b(JSON\.parse|JSON\.stringify)\b/.test(content) &&
          /(for|while|forEach|map|filter|reduce)\b/.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'performance', message: 'JSON serialization/parsing inside a loop: hoist outside the loop to avoid repeated overhead.' });
      }
      // Regex in hot path (`.match()` or `RegExp` inside loops)
      if (/\.(match|exec|test)\s*\(/.test(content) &&
          /(for|while|forEach|map|filter|reduce)\b/.test(content)) {
        comments.push({ file: path, line, severity: 'low', category: 'performance', message: 'Regex operation inside a loop: compile the RegExp once outside the loop for better performance.' });
      }
      // Synchronous filesystem in potentially async code
      if (/\b(readFileSync|writeFileSync|existsSync|readdirSync)\b/.test(content) &&
          /(await|async|Promise|\.then\s*\()/.test(content)) {
        comments.push({ file: path, line, severity: 'low', category: 'performance', message: 'Synchronous fs call in async context: use the async variant to avoid blocking the event loop.' });
      }
    }
  }

  // --- Correctness checks ---
  if (focus === 'all' || focus === 'correctness') {
    for (const { content, line } of addedLines) {
      // Empty catch blocks
      if (/^\s*catch\s*\([^)]+\)\s*\{\s*\}\s*$/.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'Empty catch block: errors are silently swallowed — at minimum log the error.' });
      }
      // TODO/FIXME/HACK
      const todoMatch = content.match(/\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b/);
      if (todoMatch) {
        comments.push({ file: path, line, severity: 'low', category: 'correctness', message: `${todoMatch[1]} left in code: address this before merging.` });
      }
      // == vs ===
      if (/\b(\d+|true|false|null|undefined)\s*==\s*/.test(content) && !content.includes('===') && !content.includes('!==')) {
        comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'Use === instead of == to avoid type coercion.' });
      }
      // Potential undefined access
      if (/\.\s*\w+\s*\.\s*\w+\s*\.\s*\w+/.test(content) && !/optional|chain|\?\./.test(content)) {
        // Only flag if accessing deep properties without optional chaining
        const dots = content.match(/\./g);
        if (dots && dots.length > 2 && !content.includes('?.')) {
          comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'Deep property access without optional chaining: could throw if intermediate value is null/undefined.' });
        }
      }
      // parseInt without radix
      if (/\bparseInt\s*\(/.test(content) && !/,\s*\d+\s*\)/.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'parseInt without radix (second argument): always specify the base, e.g., parseInt(str, 10).' });
      }
      // Assignment in condition (likely typo)
      if (/if\s*\(\s*[^=!<>]+\s*=\s*[^\s=]/.test(content) && !/===|!==|==/.test(content)) {
        comments.push({ file: path, line, severity: 'high', category: 'correctness', message: 'Assignment in condition: use == or === for comparison, or add double parentheses if intentional (if ((x = fn()))).' });
      }
      // await in forEach callback
      if (/\b(forEach|map|filter|reduce)\s*\(\s*async\b/.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'async callback inside forEach/map/filter: these don\'t await promises properly — use a for...of loop instead.' });
      }
      // Floating point comparison
      if (/===?\s*[\d.]+\s*[\+\-]\s*[\d.]+/.test(content) ||
          /[\d.]+\s*[\+\-]\s*[\d.]+/.test(content) && /===/.test(content)) {
        // Too many false positives, check more carefully
        if (/\b\d+\.\d+\b/.test(content) && /===?\s*/.test(content) && /[\+\-*/%]/.test(content)) {
          comments.push({ file: path, line, severity: 'low', category: 'correctness', message: 'Floating point arithmetic compared with ===: precision errors can cause unexpected results — use an epsilon comparison.' });
        }
      }
      // new Array(n).map won't work
      if (/new\s+Array\s*\([^)]+\)\s*\.\s*map\s*\(/.test(content)) {
        comments.push({ file: path, line, severity: 'medium', category: 'correctness', message: 'new Array(n).map() does not iterate over empty slots — use Array.from({ length: n }, mapFn) instead.' });
      }
    }
  }

  // --- Style checks ---
  if (focus === 'all' || focus === 'style') {
    for (const { content, line } of addedLines) {
      if (content.length > 120 && !['.md', '.txt'].includes(ext)) {
        comments.push({ file: path, line, severity: 'info', category: 'style', message: `Line is ${content.length} characters long: consider breaking it up for readability.` });
      }
      // Magic numbers
      if (/\b\d{4,}\b/.test(content) && !/(?:const|let|var)\s/.test(content) && !/(?:version|port|count|index|limit|timeout|size|max|min)/i.test(content)) {
        comments.push({ file: path, line, severity: 'info', category: 'style', message: 'Magic number: consider naming this as a constant.' });
      }
      // var usage
      if (/\bvar\s+\w+/.test(content) && !/(?:polyfill|\/\*|\*\/)/.test(content)) {
        comments.push({ file: path, line, severity: 'info', category: 'style', message: 'Using var instead of const/let: prefer block-scoped declarations.' });
      }
      // Function with too many parameters (>3)
      if (/(?:function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:\(|function))/i.test(content) &&
          !/\.(on|addEventListener|subscribe|map|filter|reduce|forEach|then|catch)/.test(content)) {
        const params = content.match(/\(([^)]*)\)/);
        if (params) {
          const paramCount = params[1].split(',').filter(p => p.trim().length > 0 && !p.includes('{')).length;
          if (paramCount > 3) {
            comments.push({ file: path, line, severity: 'info', category: 'style', message: `Function has ${paramCount} parameters: consider using a single options object instead.` });
          }
        }
      }
      // Bare boolean literals as function arguments
      if (/,\s*(true|false)\s*\)/.test(content) && /\.\w+\s*\(/.test(content)) {
        comments.push({ file: path, line, severity: 'info', category: 'style', message: 'Boolean literal as argument: consider using a named options object or a constant for clarity.' });
      }
      // Long regex literal
      if (/\/[^/]+\/[gimsu]*/.test(content) && content.length > 80) {
        const regexMatch = content.match(/\/([^/]+)\//);
        if (regexMatch && regexMatch[1].length > 30) {
          comments.push({ file: path, line, severity: 'info', category: 'style', message: `Long regex pattern (${regexMatch[1].length} chars): consider breaking into named parts or adding a comment explaining the pattern.` });
        }
      }
    }
  }

  return comments;
}

/**
 * Generate overall review summary.
 */
function generateOverview(changedFiles, fileDiffs, allComments, focus) {
  const filesByStatus = { A: [], M: [], D: [] };
  for (const f of changedFiles) {
    if (filesByStatus[f.status]) filesByStatus[f.status].push(f.path);
  }

  const commentsBySeverity = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const c of allComments) {
    if (commentsBySeverity[c.severity]) commentsBySeverity[c.severity].push(c);
  }

  const filesWithIssues = new Set(allComments.map(c => c.file));
  const fileReviewCount = fileDiffs.filter(f => (f.newPath || f.oldPath) &&
    changedFiles.some(cf => cf.path === (f.newPath || f.oldPath))).length;

  return {
    summary: {
      totalFiles: changedFiles.length,
      added: filesByStatus.A.length,
      modified: filesByStatus.M.length,
      deleted: filesByStatus.D.length,
      filesReviewed: fileReviewCount,
      filesWithIssues: filesWithIssues.size,
    },
    issues: {
      total: allComments.length,
      bySeverity: {
        critical: commentsBySeverity.critical.length,
        high: commentsBySeverity.high.length,
        medium: commentsBySeverity.medium.length,
        low: commentsBySeverity.low.length,
        info: commentsBySeverity.info.length,
      },
      byCategory: groupByCategory(allComments),
    },
    focus,
  };
}

function groupByCategory(comments) {
  const groups = {};
  for (const c of comments) {
    groups[c.category] = (groups[c.category] || 0) + 1;
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatText(report, color) {
  const c = COLORS;
  const lines = [];

  // Header
  lines.push(color
    ? `${c.bold}${c.blue}📋 Code Review Report${c.reset}`
    : '--- Code Review Report ---');
  lines.push('');

  // Summary
  const s = report.summary;
  lines.push(color ? `${c.bold}Summary${c.reset}` : 'Summary');
  lines.push(`  Files:      ${s.totalFiles} (${s.added ? `+${s.added} ` : ''}${s.modified ? `~${s.modified} ` : ''}${s.deleted ? `-${s.deleted}` : ''})`);
  lines.push(`  Reviewed:   ${s.filesReviewed} files`);
  lines.push(`  Issues:     ${report.issues.total} (${s.filesWithIssues}/${s.filesReviewed} files have issues)`);
  lines.push('');

  // Issue severity breakdown
  const sev = report.issues.bySeverity;
  const totalIssues = report.issues.total;
  if (totalIssues > 0) {
    lines.push(color ? `${c.bold}Issue Breakdown${c.reset}` : 'Issue Breakdown');
    if (sev.critical > 0) lines.push(color ? `  ${c.bgRed}${c.white} CRITICAL ${c.reset} ${sev.critical}` : `  CRITICAL: ${sev.critical}`);
    if (sev.high > 0) lines.push(color ? `  ${c.red}HIGH     ${c.reset} ${sev.high}` : `  HIGH: ${sev.high}`);
    if (sev.medium > 0) lines.push(color ? `  ${c.yellow}MEDIUM   ${c.reset} ${sev.medium}` : `  MEDIUM: ${sev.medium}`);
    if (sev.low > 0) lines.push(color ? `  ${c.blue}LOW      ${c.reset} ${sev.low}` : `  LOW: ${sev.low}`);
    if (sev.info > 0) lines.push(color ? `  ${c.dim}INFO     ${c.reset} ${sev.info}` : `  INFO: ${sev.info}`);
    lines.push('');

    // By category
    const cats = report.issues.byCategory;
    lines.push(color ? `${c.bold}By Category${c.reset}` : 'By Category');
    for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${cat}: ${count}`);
    }
    lines.push('');
  }

  // Per-file comments
  if (report.comments && report.comments.length > 0) {
    // Group by file
    const fileComments = {};
    for (const cmt of report.comments) {
      if (!fileComments[cmt.file]) fileComments[cmt.file] = [];
      fileComments[cmt.file].push(cmt);
    }

    lines.push(color ? `${c.bold}File Reviews${c.reset}` : 'File Reviews');
    lines.push('');

    for (const [file, comments] of Object.entries(fileComments)) {
      const fileSeverity = Math.min(...comments.map(c => SEVERITY_ORDER[c.severity] || 4));
      const fileLabel = Object.keys(SEVERITY_ORDER).find(k => SEVERITY_ORDER[k] === fileSeverity) || 'info';
      const fileColor = fileLabel === 'critical' ? c.bgRed + c.white : fileLabel === 'high' ? c.red : fileLabel === 'medium' ? c.yellow : fileLabel === 'low' ? c.blue : c.dim;

      lines.push(color
        ? `  ${fileColor}${fileLabel.toUpperCase()}${c.reset} ${file}`
        : `  [${fileLabel.toUpperCase()}] ${file}`);

      comments.sort((a, b) => (SEVERITY_ORDER[a.severity] || 4) - (SEVERITY_ORDER[b.severity] || 4));
      for (const cmt of comments.slice(0, 5)) { // max 5 per file
        const sevColor = cmt.severity === 'critical' ? c.bgRed + c.white : cmt.severity === 'high' ? c.red : cmt.severity === 'medium' ? c.yellow : cmt.severity === 'low' ? c.blue : c.dim;
        lines.push(color
          ? `    L${cmt.line} [${sevColor}${cmt.severity}${c.reset}][${c.dim}${cmt.category}${c.reset}] ${cmt.message}`
          : `    L${cmt.line} [${cmt.severity}][${cmt.category}] ${cmt.message}`);
      }
      if (comments.length > 5) {
        lines.push(color
          ? `    ${c.dim}... and ${comments.length - 5} more comments${c.reset}`
          : `    ... and ${comments.length - 5} more comments`);
      }
      lines.push('');
    }
  } else {
    lines.push(color
      ? `  ${c.green}No issues found. ✨${c.reset}`
      : '  No issues found.');
    lines.push('');
  }

  return lines.join('\n');
}

function formatJSON(report) {
  return JSON.stringify(report, null, 2);
}

function formatMarkdown(report) {
  const lines = [];
  const s = report.summary;

  lines.push('# Code Review Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Files**: ${s.totalFiles} (${s.added ? `+${s.added} ` : ''}${s.modified ? `~${s.modified} ` : ''}${s.deleted ? `-${s.deleted}` : ''})`);
  lines.push(`- **Reviewed**: ${s.filesReviewed} files`);
  lines.push(`- **Issues Found**: ${report.issues.total} (${report.issues.filesWithIssues}/${s.filesReviewed} files have issues)`);
  lines.push(`- **Focus**: ${report.focus}`);
  lines.push('');

  if (report.issues.total > 0) {
    const sev = report.issues.bySeverity;
    lines.push('## Issue Breakdown');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    for (const [sevName, count] of Object.entries(sev)) {
      if (count > 0) lines.push(`| ${sevName} | ${count} |`);
    }
    lines.push('');

    lines.push('### By Category');
    lines.push('');
    for (const [cat, count] of Object.entries(report.issues.byCategory).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${cat}**: ${count}`);
    }
    lines.push('');

    // Per-file comments
    const fileComments = {};
    for (const cmt of report.comments) {
      if (!fileComments[cmt.file]) fileComments[cmt.file] = [];
      fileComments[cmt.file].push(cmt);
    }

    lines.push('## Per-File Review');
    lines.push('');
    for (const [file, comments] of Object.entries(fileComments)) {
      lines.push(`### \`${file}\``);
      lines.push('');
      comments.sort((a, b) => (SEVERITY_ORDER[a.severity] || 4) - (SEVERITY_ORDER[b.severity] || 4));
      for (const cmt of comments) {
        lines.push(`- **L${cmt.line}** [${cmt.severity}] [${cmt.category}]: ${cmt.message}`);
      }
      lines.push('');
    }
  } else {
    lines.push('✨ **No issues found.**');
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by smart_git_review (focus: ${report.focus})*`);

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
    commit: null,
    range: null,
    pr: null,
    staged: false,
    all: false,
    focus: 'all',
    format: 'text',
    output: null,
    maxComments: 5,
    color: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--commit': opts.commit = args[++i]; break;
      case '--range': opts.range = args[++i]; break;
      case '--pr': opts.pr = args[++i]; break;
      case '--staged': opts.staged = true; break;
      case '--all': opts.all = true; break;
      case '--focus': opts.focus = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--max-comments': opts.maxComments = parseInt(args[++i], 10); break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node git-review.mjs [options]

Smart code review for working tree changes or PRs.

Options:
  --root <path>           Git repository root (default: .)
  --commit <ref>          Review a specific commit (e.g., HEAD, HEAD~1)
  --range <range>         Review a commit range (e.g., HEAD~3..HEAD)
  --pr <url>              Review an existing PR (fetches diff from GitHub)
  --staged                Review staged changes only
  --all                   Review staged + unstaged changes
  --focus <type>          Focus on: security, performance, correctness, style, all (default: all)
  --format <fmt>          Output: text, json, markdown (default: text)
  --output <file>         Write review report to file
  --max-comments <N>      Max review comments per file (default: 5)
  --no-color              Disable color output
  -h, --help              Show this help

Examples:
  node git-review.mjs
  node git-review.mjs --staged --focus security
  node git-review.mjs --commit HEAD
  node git-review.mjs --pr https://github.com/user/repo/pull/123
  node git-review.mjs --all --format markdown --output review.md
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  let allComments = [];
  let changedFiles = [];
  let fileDiffs = [];
  let prInfo = null;

  if (opts.pr) {
    // Fetch PR diff from GitHub
    if (!isGitRepo(root) && !opts.root) {
      console.error('A git repository is required for PR review (or for fetching context).');
      process.exit(1);
    }
    const result = await fetchPRDiff(opts.pr);
    if (result.error) {
      const report = { summary: { totalFiles: 0 }, issues: { total: 0, bySeverity: {}, byCategory: {} }, comments: [], focus: opts.focus, error: result.error };
      switch (opts.format) {
        case 'json': console.log(formatJSON(report)); break;
        case 'markdown': console.log(formatMarkdown(report)); break;
        default: console.error(`Error fetching PR: ${result.error}`); break;
      }
      process.exit(1);
    }
    // Parse diff
    fileDiffs = splitDiffByFile(result.diff);
    changedFiles = fileDiffs.map(f => ({
      path: f.newPath || f.oldPath,
      status: f.newPath === '/dev/null' ? 'D' : f.oldPath === '/dev/null' ? 'A' : 'M',
    }));
    prInfo = result.info;
  } else {
    // Local diff
    if (!isGitRepo(root)) {
      console.error('Not a git repository:', root);
      process.exit(1);
    }
    changedFiles = getChangedFilesList(root, opts);
    fileDiffs = getFileDiffs(root, opts);
  }

  // Run review on each file
  for (const fd of fileDiffs) {
    const path = fd.newPath || fd.oldPath;
    // Skip if file is not in our changed list (could be context diff)
    if (!changedFiles.some(cf => cf.path === path)) continue;
    const fileComments = reviewFileDiff(fd, opts.focus);
    allComments.push(...fileComments);
  }

  // Limit comments per file
  const fileCommentMap = {};
  for (const cmt of allComments) {
    if (!fileCommentMap[cmt.file]) fileCommentMap[cmt.file] = [];
    fileCommentMap[cmt.file].push(cmt);
  }
  // Sort each file's comments by severity, then truncate
  for (const file of Object.keys(fileCommentMap)) {
    fileCommentMap[file].sort((a, b) => (SEVERITY_ORDER[a.severity] || 4) - (SEVERITY_ORDER[b.severity] || 4));
    fileCommentMap[file] = fileCommentMap[file].slice(0, opts.maxComments);
  }
  allComments = Object.values(fileCommentMap).flat();

  // Build report
  const overview = generateOverview(changedFiles, fileDiffs, allComments, opts.focus);
  const report = {
    ...overview,
    comments: allComments,
    prInfo,
  };

  // Format output
  let output;
  switch (opts.format) {
    case 'json':
      output = formatJSON(report);
      break;
    case 'markdown':
      output = formatMarkdown(report);
      break;
    default:
      output = formatText(report, color);
      break;
  }

  // Write to file or stdout
  if (opts.output) {
    writeFileSync(resolve(opts.output), output, 'utf-8');
    console.log(`Review report written to: ${opts.output}`);
  } else {
    console.log(output);
  }
}

main().catch(e => {
  console.error('Review failed:', e.message);
  process.exit(1);
});
