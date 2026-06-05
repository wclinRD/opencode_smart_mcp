// apply-engine.mjs — Fast Apply Engine for LLM code edits
//
// Supports 3 input formats:
//   1. SEARCH/REPLACE blocks (Aider-compatible)
//   2. Unified diff (git diff format)
//   3. Whole file replacement
//
// Key features:
//   - 4-level fuzzy matching
//   - Atomic multi-file apply
//   - Git-based undo snapshots
//
// Usage:
//   import { applySearchReplace, parseUnifiedDiff, fuzzyMatch } from './apply-engine.mjs';
//   const r = applySearchReplace('file.js', { search: 'old', replace: 'new' });
//   if (r.status === 'applied') console.log('OK');

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Parser: SEARCH/REPLACE blocks
// ---------------------------------------------------------------------------

/**
 * Validate SEARCH/REPLACE blocks from structured input.
 * Each block: { file: string, search: string, replace: string }
 */
export function parseSearchReplace(blocks) {
  if (!Array.isArray(blocks)) throw new Error('Expected array of { file, search, replace }');
  for (const b of blocks) {
    if (!b.file || typeof b.search !== 'string' || typeof b.replace !== 'string') {
      throw new Error(`Invalid block for ${b.file || 'unknown'}`);
    }
  }
  return blocks;
}

/**
 * Parse SEARCH/REPLACE blocks from raw text (Aider output format).
 *
 * Input format:
 *   path/to/file.js
 *   <<<<<<< SEARCH
 *   old code here
 *   =======
 *   new code here
 *   >>>>>>> REPLACE
 */
export function parseSearchReplaceText(text) {
  const blocks = [];
  const re = /(.+?)\n<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE\n?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({
      file: m[1].trim(),
      search: m[2].replace(/\n$/, ''),
      replace: m[3].replace(/\n$/, ''),
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Parser: Unified diff
// ---------------------------------------------------------------------------

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse unified diff string into per-file change objects.
 * Handles git diff format: diff --git, ---/+++, @@ hunk headers.
 * @returns {Array<{file:string, hunks:Array}>}
 */
export function parseUnifiedDiff(diff) {
  const files = [];
  let current = null;
  let currentHunk = null;
  const lines = diff.split('\n');

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        if (currentHunk) { current.hunks.push(currentHunk); currentHunk = null; }
        files.push(current);
      }
      const parts = line.split(' ');
      // diff --git a/path b/path → take the b/ side
      const rawPath = parts[parts.length - 1].replace(/^b\//, '');
      current = { file: rawPath, hunks: [] };
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // skip — we use diff --git for path
    } else if (current && HUNK_RE.test(line)) {
      if (currentHunk) current.hunks.push(currentHunk);
      const h = HUNK_RE.exec(line);
      currentHunk = {
        oldStart: parseInt(h[1], 10),
        oldLines: parseInt(h[2] || '1', 10),
        newStart: parseInt(h[3], 10),
        newLines: parseInt(h[4] || '1', 10),
        header: h[5].trim(),
        lines: [],
      };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  if (current) {
    if (currentHunk) current.hunks.push(currentHunk);
    files.push(current);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Fuzzy Matching — 4 levels
// ---------------------------------------------------------------------------

/** Normalize whitespace (CRLF→LF, collapse spaces, trim) */
function normalizeWS(s) {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

/** Count frequency of each unique trimmed non-blank line */
function lineFreq(lines) {
  const f = {};
  for (const l of lines) {
    const t = l.trim();
    if (!t || /^[{}\s]*$/.test(t)) continue;
    f[t] = (f[t] || 0) + 1;
  }
  return f;
}

/**
 * Level 1: Exact line match at a specific starting line.
 */
function matchL1(contentLines, searchLines, startLine) {
  if (!startLine || startLine < 1 || startLine > contentLines.length) return -1;
  for (let i = 0; i < searchLines.length; i++) {
    if (contentLines[startLine - 1 + i] !== searchLines[i]) return -1;
  }
  return startLine;
}

/**
 * Level 2: Find search block as exact substring.
 * Returns 1-indexed line number.
 */
function matchL2(contentLines, searchStr) {
  const full = contentLines.join('\n');
  const idx = full.indexOf(searchStr);
  if (idx === -1) return -1;
  return full.substring(0, idx).split('\n').length;
}

/**
 * Level 3: Find via unique content line + context verification.
 */
function matchL3(contentLines, searchLines) {
  if (searchLines.length === 0) return -1;

  // Find most unique line in search block (lowest frequency)
  const freq = lineFreq(searchLines);
  let bestIdx = -1;
  let bestScore = Infinity;
  for (let i = 0; i < searchLines.length; i++) {
    const t = searchLines[i].trim();
    if (!t || /^[{}\s]*$/.test(t)) continue;
    const s = freq[t] || 1;
    if (s < bestScore) { bestScore = s; bestIdx = i; }
  }
  if (bestIdx === -1) return -1;

  const anchor = searchLines[bestIdx].trim();
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== anchor) continue;
    const offset = i - bestIdx;
    if (offset < 0 || offset + searchLines.length > contentLines.length) continue;
    let ok = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[offset + j].trim() !== searchLines[j].trim()) { ok = false; break; }
    }
    if (ok) return offset + 1;
  }
  return -1;
}

/**
 * Level 4: Line-by-line with whitespace tolerance.
 */
function matchL4(contentLines, searchLines) {
  if (searchLines.length === 0) return -1;
  const sn = searchLines.map(normalizeWS);
  const cn = contentLines.map(normalizeWS);
  for (let i = 0; i <= cn.length - sn.length; i++) {
    let ok = true;
    for (let j = 0; j < sn.length; j++) {
      if (cn[i + j] !== sn[j]) { ok = false; break; }
    }
    if (ok) return i + 1;
  }
  return -1;
}

/**
 * 4-level fuzzy match: find search block in content.
 * @param {string} content — full file content
 * @param {string} search — search block text
 * @param {{ startLine?: number }} [opts]
 * @returns {{ line: number, level: number } | null}
 */
export function fuzzyMatch(content, search, opts = {}) {
  if (!content || !search) return null;
  const sl = search.split('\n');
  const cl = content.split('\n');

  let r;
  r = matchL1(cl, sl, opts.startLine); if (r !== -1) return { line: r, level: 1 };
  r = matchL2(cl, search);            if (r !== -1) return { line: r, level: 2 };
  r = matchL3(cl, sl);                if (r !== -1) return { line: r, level: 3 };
  r = matchL4(cl, sl);                if (r !== -1) return { line: r, level: 4 };

  return null;
}

// ---------------------------------------------------------------------------
// Apply: SEARCH/REPLACE
// ---------------------------------------------------------------------------

/**
 * Apply a SEARCH/REPLACE block to a single file.
 *
 * @param {string} filePath
 * @param {{ search: string, replace: string }} block
 * @param {{ fuzzy?: boolean, validate?: boolean, undo?: boolean }} [opts]
 * @returns {{ status: 'applied'|'conflict'|'error', file: string, matchLevel?: number, diff?: string, backup?: string, error?: string }}
 */
export function applySearchReplace(filePath, block, opts = {}) {
  const { fuzzy = true, undo = false } = opts;

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot read: ${e.message}` };
  }

  const { search, replace } = block;
  if (!search) {
    // Empty search → prepend or append based on replace content
    // Treat as whole-file replacement
    return applyWholeFile(filePath, replace, opts);
  }

  // Find match position
  let match = null;

  // Try exact match first
  const exactIdx = content.indexOf(search);
  if (exactIdx !== -1) {
    const lineNum = content.substring(0, exactIdx).split('\n').length;
    match = { line: lineNum, level: 2 };
  } else if (fuzzy) {
    match = fuzzyMatch(content, search);
  }

  if (!match) {
    return {
      status: 'conflict',
      file: filePath,
      error: `Cannot find search block in ${filePath}`,
      details: suggestNearest(content, search),
    };
  }

  // Calculate actual position in content
  const searchLines = search.split('\n');
  let actualStart;
  if (exactIdx !== -1) {
    actualStart = exactIdx;
  } else {
    // Fuzzy match: reconstruct byte offset from line number
    const cl = content.split('\n');
    const before = cl.slice(0, match.line - 1);
    actualStart = before.length > 0 ? before.join('\n').length + 1 : 0;
  }

  // For fuzzy matches, find actual matched text length
  let actualSearchLen;
  if (exactIdx !== -1) {
    actualSearchLen = search.length;
  } else {
    const cl = content.split('\n');
    const matched = cl.slice(match.line - 1, match.line - 1 + searchLines.length).join('\n');
    actualSearchLen = matched.length;
  }

  // Perform replacement
  const before = content.substring(0, actualStart);
  const after = content.substring(actualStart + actualSearchLen);
  const newContent = before + replace + after;

  // Create undo snapshot
  if (undo) {
    try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* best effort */ }
  }

  // Write
  try {
    writeFileSync(filePath, newContent, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
  }

  // Generate diff summary
  const diff = generateDiffSummary(content, newContent, filePath);

  return {
    status: 'applied',
    file: filePath,
    matchLevel: match.level,
    diff,
    backup: undo ? (filePath + '.apply.bak') : undefined,
  };
}

/**
 * Apply whole file replacement.
 */
export function applyWholeFile(filePath, content, opts = {}) {
  const { undo = false } = opts;
  let original;
  try { original = readFileSync(filePath, 'utf-8'); } catch { original = ''; }

  if (undo) {
    try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* */ }
  }

  try {
    writeFileSync(filePath, content, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
  }

  const diff = generateDiffSummary(original, content, filePath);
  return { status: 'applied', file: filePath, matchLevel: 0, diff, backup: undo ? (filePath + '.apply.bak') : undefined };
}

// ---------------------------------------------------------------------------
// Apply: Unified diff
// ---------------------------------------------------------------------------

/**
 * Apply unified diff hunks to a file.
 * @param {string} filePath
 * @param {Array} hunks — from parseUnifiedDiff
 * @param {{ undo?: boolean }} [opts]
 */
export function applyUnifiedDiff(filePath, hunks, opts = {}) {
  const { undo = false } = opts;

  let content;
  try { content = readFileSync(filePath, 'utf-8'); } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot read: ${e.message}` };
  }

  if (undo) {
    try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* */ }
  }

  const lines = content.split('\n');
  let offset = 0; // tracks line number shift from previous hunks

  for (const hunk of hunks) {
    const start = hunk.oldStart - 1 + offset; // 0-indexed
    const removeCount = hunk.oldLines;
    const addLines = [];

    for (const l of hunk.lines) {
      if (l.startsWith('+')) addLines.push(l.substring(1));
      // '-' lines are removed, ' ' lines are context (kept)
    }

    // Remove old lines and insert new
    lines.splice(start, removeCount, ...addLines);
    offset += addLines.length - removeCount;
  }

  const newContent = lines.join('\n');
  try { writeFileSync(filePath, newContent, 'utf-8'); } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
  }

  const diff = generateDiffSummary(content, newContent, filePath);
  return { status: 'applied', file: filePath, matchLevel: 0, diff, backup: undo ? (filePath + '.apply.bak') : undefined };
}

// ---------------------------------------------------------------------------
// Atomic multi-file apply
// ---------------------------------------------------------------------------

/**
 * Apply multiple changes atomically (all-or-nothing rollback).
 * @param {Array<{file:string, type:'search-replace'|'whole'|'diff', search?:string, replace?:string, content?:string, hunks?:Array}>} changes
 * @param {{ fuzzy?: boolean, undo?: boolean }} [opts]
 */
export function applyAtomic(changes, opts = {}) {
  const results = [];
  const backups = [];
  let allOk = true;

  for (const ch of changes) {
    let r;
    if (ch.type === 'search-replace') {
      r = applySearchReplace(ch.file, { search: ch.search, replace: ch.replace }, { ...opts, undo: true });
    } else if (ch.type === 'whole') {
      r = applyWholeFile(ch.file, ch.content, { ...opts, undo: true });
    } else if (ch.type === 'diff' && ch.hunks) {
      r = applyUnifiedDiff(ch.file, ch.hunks, { ...opts, undo: true });
    } else {
      r = { status: 'error', file: ch.file, error: 'Unknown change type' };
    }

    results.push(r);
    if (r.status === 'applied' && r.backup) backups.push(r.backup);

    if (r.status !== 'applied') {
      allOk = false;
      break;
    }
  }

  // Rollback on failure
  if (!allOk && opts.undo !== false) {
    for (const bak of backups.reverse()) {
      try {
        const orig = bak.replace(/\.apply\.bak$/, '');
        copyFileSync(bak, orig);
        unlinkSync(bak);
      } catch { /* best effort */ }
    }
  }

  return { results, allSucceeded: allOk };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unified-diff-style summary of changes.
 */
function generateDiffSummary(oldContent, newContent, filePath) {
  const rel = relative(process.cwd(), filePath);
  const ol = oldContent.split('\n');
  const nl = newContent.split('\n');
  const added = [], removed = [];
  const max = Math.max(ol.length, nl.length);

  // Simple line-by-line diff (not a real Myers diff, but sufficient for reporting)
  let firstDiff = -1, lastDiff = -1;
  for (let i = 0; i < max; i++) {
    if (ol[i] !== nl[i]) {
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
      if (i < ol.length) removed.push({ line: i + 1, text: ol[i] });
      if (i < nl.length) added.push({ line: i + 1, text: nl[i] });
    }
  }

  // Build unified diff
  const out = [];
  out.push(`--- a/${rel}`);
  out.push(`+++ b/${rel}`);
  if (firstDiff !== -1) {
    const ctxStart = Math.max(0, firstDiff - 2);
    const ctxEnd = Math.min(max, lastDiff + 3);
    out.push(`@@ -${firstDiff + 1},${lastDiff - firstDiff + 1} +${firstDiff + 1},${lastDiff - firstDiff + 1} @@`);
    for (let i = ctxStart; i < firstDiff; i++) out.push(` ${ol[i] || ''}`);
    for (let i = firstDiff; i <= lastDiff; i++) {
      if (i < ol.length && i < nl.length && ol[i] !== nl[i]) {
        out.push(`-${ol[i]}`);
        out.push(`+${nl[i]}`);
      } else if (i >= ol.length || i >= nl.length) {
        if (i < ol.length) out.push(`-${ol[i]}`);
        if (i < nl.length) out.push(`+${nl[i]}`);
      }
    }
    for (let i = lastDiff + 1; i < ctxEnd && i < max; i++) out.push(` ${ol[i] || ''}`);
  }

  return out.join('\n');
}

/**
 * Quick brace/bracket balance check — basic syntax validation.
 */
export function checkBalance(content) {
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const stack = [];
  let inStr = false, strChar = null;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    // Toggle string tracking
    if ((ch === '"' || ch === "'" || ch === '`') && (i === 0 || content[i - 1] !== '\\')) {
      if (inStr && strChar === ch) { inStr = false; strChar = null; }
      else if (!inStr) { inStr = true; strChar = ch; }
      continue;
    }
    if (inStr) continue;

    // Skip comments
    if (ch === '/' && i + 1 < content.length) {
      if (content[i + 1] === '/') { i++; while (i < content.length && content[i] !== '\n') i++; continue; }
      if (content[i + 1] === '*') {
        i += 2;
        while (i < content.length) {
          if (content[i] === '*' && i + 1 < content.length && content[i + 1] === '/') { i += 2; break; }
          i++;
        }
        continue;
      }
    }

    if (ch in pairs) stack.push(ch);
    else if (Object.values(pairs).includes(ch)) {
      const last = stack.pop();
      if (!last || pairs[last] !== ch) return { balanced: false, expected: last ? pairs[last] : undefined, found: ch, position: i };
    }
  }

  if (stack.length > 0) return { balanced: false, expected: pairs[stack[stack.length - 1]], open: stack.length };

  return { balanced: true };
}

/**
 * Suggest nearest match when exact search fails.
 * Returns the top 3 closest line matches.
 */
function suggestNearest(content, search) {
  const searchLines = search.trim().split('\n');
  const contentLines = content.split('\n');
  const searchUnique = searchLines.filter(l => l.trim() && !/^[{}\s]*$/.test(l.trim()));

  if (searchUnique.length === 0) return null;

  // Score each content line by how many search lines it contains (as substring)
  const scores = [];
  for (let i = 0; i < contentLines.length; i++) {
    let score = 0;
    for (const sl of searchUnique) {
      if (contentLines[i].includes(sl.trim())) score++;
    }
    if (score > 0) scores.push({ line: i + 1, score, text: contentLines[i].trim().substring(0, 80) });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, 3);
}
