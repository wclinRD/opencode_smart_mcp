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

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'node:fs';
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
/**
 * Level 6: Gap-tolerant subsequence matching — handles lines added/removed
 * between search lines. Uses line fingerprints (normalized whitespace).
 * Allows up to 50% gap ratio (gaps between matched lines / total search lines).
 * @returns 1-indexed line or -1
 */
function matchL6(contentLines, searchLines) {
  if (searchLines.length === 0) return -1;

  // Compute fingerprints: trimmed, whitespace-normalized, non-empty meaningful lines
  const searchSig = searchLines
    .map(l => normalizeWS(l))
    .filter(s => s.length > 0);
  if (searchSig.length === 0) return -1;

  const contentSig = contentLines.map(l => normalizeWS(l));

  // Lenient match: a search line matches a content line if:
  //   1. Exact fingerprint match, OR
  //   2. One is a substring of the other (handles trailing `{`, missing semicolons, etc.)
  function linesMatch(searchFp, contentFp) {
    if (searchFp === contentFp) return true;
    if (!searchFp || !contentFp) return false;
    // Substring match in either direction (for lenient comparison)
    if (searchFp.length >= 5 && contentFp.includes(searchFp)) return true;
    if (contentFp.length >= 5 && searchFp.includes(contentFp)) return true;
    return false;
  }

  // Find longest subsequence match using greedy sliding window
  const gapRatio = 0.5;
  const maxAllowedGap = Math.max(1, Math.floor(searchSig.length * gapRatio));

  let bestStart = -1;
  let bestGap = Infinity;

  for (let ci = 0; ci < contentSig.length; ci++) {
    if (!linesMatch(searchSig[0], contentSig[ci])) continue;

    let si = 0;
    let cj = ci;
    let matched = 0;
    let gap = 0;

    while (si < searchSig.length && cj < contentSig.length) {
      if (linesMatch(searchSig[si], contentSig[cj])) {
        si++;
        matched++;
      } else {
        gap++;
        if (gap > maxAllowedGap) break;
      }
      cj++;
    }

    if (matched === searchSig.length && gap < bestGap) {
      bestStart = ci;
      bestGap = gap;
    }
  }

  if (bestStart === -1) return -1;

  // Verify: at least 2 meaningful lines matched
  if (searchSig.length <= 2) return bestStart + 1;
  if (bestGap <= maxAllowedGap) return bestStart + 1;

  return -1;
}

/**
 * Compute line-level fingerprints for a file content.
 * Returns array of { lineNum, fingerprint, raw } for each line.
 * Fingerprint = trimmed + whitespace-collapsed content.
 * Useful for hashline-based addressing (line number + content verification).
 *
 * @param {string} content - file content
 * @param {object} [opts]
 * @param {boolean} [opts.includeRaw=false] - include raw line text in result
 * @returns {Array<{lineNum:number, fingerprint:string, raw?:string}>}
 */
export function computeLineFingerprints(content, opts = {}) {
  if (!content) return [];
  const lines = content.split('\n');
  return lines.map((raw, i) => ({
    lineNum: i + 1,
    fingerprint: normalizeWS(raw),
    ...(opts.includeRaw ? { raw } : {}),
  }));
}

/**
 * Verify a line's content by fingerprint at a specific line number.
 * Used for hashline-based addressing: "edit line 42 if content hash matches".
 * Returns strict match first, then fuzzy if strict fails.
 *
 * @param {string} content - full file content
 * @param {number} lineNum - 1-indexed line number
 * @param {string} expectedContent - expected line content (trimmed comparison)
 * @returns {{ ok: boolean, actual: string, fuzzy: boolean }}
 */
export function verifyLineFingerprint(content, lineNum, expectedContent) {
  if (!content || !lineNum || !expectedContent) {
    return { ok: false, actual: '', fuzzy: false };
  }
  const lines = content.split('\n');
  if (lineNum < 1 || lineNum > lines.length) {
    return { ok: false, actual: '', fuzzy: false };
  }
  const actual = lines[lineNum - 1];
  const expectedNorm = normalizeWS(expectedContent);
  const actualNorm = normalizeWS(actual);

  if (actualNorm === expectedNorm) {
    return { ok: true, actual, fuzzy: false };
  }

  // Fuzzy fallback: check if content is "close enough" (substring)
  if (expectedNorm && actualNorm &&
      (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm))) {
    return { ok: true, actual, fuzzy: true };
  }

  return { ok: false, actual, fuzzy: false };
}

/**
 * Apply a hashline edit: replace lines at a specific line number range
 * with content verification via fingerprint.
 *
 * Format:
 *   { file, startLine, endLine, oldContent, newContent }
 *   - startLine: 1-indexed start line
 *   - endLine: 1-indexed end line (inclusive, can be same as startLine)
 *   - oldContent: expected content of the range (for verification)
 *   - newContent: replacement content
 *
 * @param {string} filePath
 * @param {{ startLine: number, endLine: number, oldContent: string, newContent: string }} change
 * @param {{ undo?: boolean }} [opts]
 * @returns {{ status: 'applied'|'conflict'|'error', file: string, ... }}
 */
export function applyHashline(filePath, change, opts = {}) {
  const { startLine, endLine, oldContent, newContent, action = 'replace' } = change;
  const { undo = false } = opts;

  // For insert-before/insert-after, endLine can equal startLine
  if (!startLine || ((action === 'replace' || action === 'delete') && (!endLine || startLine > endLine))) {
    return { status: 'error', file: filePath, error: `Invalid line range: ${startLine}-${endLine}` };
  }

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot read: ${e.message}` };
  }

  const lines = content.split('\n');
  const eLine = action === 'replace' || action === 'delete' ? endLine : startLine;
  if (eLine > lines.length) {
    return {
      status: 'conflict', file: filePath,
      error: `Line ${eLine} exceeds file length (${lines.length} lines)`,
    };
  }

  // oldContent verification only for replace/delete
  if ((action === 'replace' || action === 'delete') && oldContent) {
    const actualRange = lines.slice(startLine - 1, endLine).join('\n');
    const oldNorm = normalizeWS(oldContent || '');
    const actualNorm = normalizeWS(actualRange);

    if (oldNorm !== actualNorm) {
      const fpOld = computeLineFingerprints(oldContent || '', { includeRaw: true });
      const fpActual = computeLineFingerprints(actualRange, { includeRaw: true });

      const mismatches = [];
      for (let i = 0; i < Math.max(fpOld.length, fpActual.length); i++) {
        const o = fpOld[i];
        const a = fpActual[i];
        if (!o || !a || o.fingerprint !== a.fingerprint) {
          mismatches.push({
            line: startLine + i,
            expected: o?.raw || '(missing)',
            actual: a?.raw || '(missing)',
          });
        }
      }

      return {
        status: 'conflict', file: filePath,
        error: `Content mismatch at line ${startLine}. File has changed since LLM read it.`,
        details: {
          expected: oldContent,
          actual: actualRange,
          mismatches: mismatches.slice(0, 5),
          hint: 'The file has drifted — re-read the file and generate a new edit.',
        },
      };
    }
  }

  // Create undo snapshot
  if (undo) {
    try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* */ }
  }

  let newContent_full;

  switch (action) {
    case 'insert-before':
      {
        const beforeIns = lines.slice(0, startLine - 1).join('\n');
        const afterIns = lines.slice(startLine - 1).join('\n');
        newContent_full = (beforeIns ? beforeIns + '\n' : '') + newContent + (afterIns ? '\n' + afterIns : '');
        break;
      }
    case 'insert-after':
      {
        const bef = lines.slice(0, startLine).join('\n');
        const aft = lines.slice(startLine).join('\n');
        newContent_full = (bef ? bef + '\n' : '') + newContent + (aft ? '\n' + aft : '');
        break;
      }
    case 'delete':
      {
        const beforeDel = lines.slice(0, startLine - 1).join('\n');
        const afterDel = lines.slice(endLine).join('\n');
        newContent_full = beforeDel + (beforeDel && afterDel ? '\n' : '') + afterDel;
        break;
      }
    case 'replace':
    default:
      {
        const beforeRep = lines.slice(0, startLine - 1).join('\n');
        const afterRep = lines.slice(endLine).join('\n');
        const prefix = beforeRep ? beforeRep + '\n' : '';
        const suffix = afterRep ? '\n' + afterRep : '';
        newContent_full = prefix + newContent + suffix;
        break;
      }
  }

  try {
    writeFileSync(filePath, newContent_full, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
  }

  const diff = generateDiffSummary(content, newContent_full, filePath);
  return { status: 'applied', file: filePath, matchLevel: 6, diff, backup: undo ? (filePath + '.apply.bak') : undefined };
}

/**
 * Level 5: Partial/lenient matching for abbreviated context.
 * Matches meaningful lines independently — allows gaps.
 * Returns 1-indexed line of best anchor match.
 */
function matchL5(contentLines, searchLines) {
  const meaningful = searchLines.map(l => l.trim()).filter(l => l && !/^[{}\s]*$/.test(l));
  if (meaningful.length === 0) return -1;

  const fileMeaningful = contentLines.map(l => l.trim());

  // Find first anchor line in file
  const anchor = meaningful[0];
  for (let i = 0; i < fileMeaningful.length; i++) {
    if (fileMeaningful[i] === anchor) {
      // Verify remaining meaningful lines appear after this point in order
      let searchIdx = 1;
      let fileIdx = i + 1;
      while (searchIdx < meaningful.length && fileIdx < fileMeaningful.length) {
        if (fileMeaningful[fileIdx] === meaningful[searchIdx]) {
          searchIdx++;
        }
        fileIdx++;
      }
      if (searchIdx >= meaningful.length) {
        return i + 1;
      }
    }
  }
  return -1;
}

export function fuzzyMatch(content, search, opts = {}) {
  if (!content || !search) return null;
  const sl = search.split('\n');
  const cl = content.split('\n');

  let r;
  r = matchL1(cl, sl, opts.startLine); if (r !== -1) return { line: r, level: 1 };
  r = matchL2(cl, search);            if (r !== -1) return { line: r, level: 2 };
  r = matchL3(cl, sl);                if (r !== -1) return { line: r, level: 3 };
  r = matchL4(cl, sl);                if (r !== -1) return { line: r, level: 4 };
  r = matchL5(cl, sl);                if (r !== -1) return { line: r, level: 5 };
  r = matchL6(cl, sl);                if (r !== -1) return { line: r, level: 6 };

  return null;
}

// ---------------------------------------------------------------------------
// Multi-occurrence detection
// ---------------------------------------------------------------------------

/**
 * Detect if a search fragment appears multiple times in file content.
 *
 * For exact string matches (level 2), counts all indexOf occurrences.
 * For fuzzy matches (level 3+), checks trimmed anchor line uniqueness.
 *
 * @param {string} content — full file content
 * @param {string} search — search text
 * @param {{ level?: number }} [opts]
 * @returns {{ multi: boolean, count: number, lines?: number[], contexts?: Array<{line:number, context:string}> }}
 */
export function detectMultiOccurrence(content, search, opts = {}) {
  const { level = 2 } = opts;
  if (!content || !search) return { multi: false, count: 0 };

  if (level <= 2) {
    // Exact string matching: count all indexOf occurrences
    let count = 0;
    let idx = -1;
    const offsets = [];
    while ((idx = content.indexOf(search, idx + 1)) !== -1) {
      count++;
      offsets.push(idx);
    }

    if (count > 1) {
      const lines = offsets.map(o => content.substring(0, o).split('\n').length);
      const contexts = offsets.map(o => {
        const lineNum = content.substring(0, o).split('\n').length;
        const allLines = content.split('\n');
        const start = Math.max(0, lineNum - 2);
        const end = Math.min(allLines.length, lineNum + 2);
        return {
          line: lineNum,
          context: allLines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n'),
        };
      });
      return { multi: true, count, lines, contexts };
    }

    return { multi: false, count };
  }

  // Fuzzy levels (L3, L4): check anchor line uniqueness
  const sl = search.split('\n');
  const cl = content.split('\n');
  const anchorLines = sl.filter(l => l.trim() && !/^[{}\s]*$/.test(l.trim()));

  if (anchorLines.length === 0) return { multi: false, count: 0 };

  // Pick first non-trivial line as anchor
  const anchor = anchorLines[0].trim();
  const matchLineNums = [];
  for (let i = 0; i < cl.length; i++) {
    if (cl[i].trim() === anchor) {
      matchLineNums.push(i + 1);
    }
  }

  if (matchLineNums.length > 1) {
    return { multi: true, count: matchLineNums.length, lines: matchLineNums };
  }

  return { multi: false, count: matchLineNums.length };
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
    // Check multi-occurrence: if search appears multiple times, report clearly
    const multiCheck = detectMultiOccurrence(content, search, { level: 2 });
    if (multiCheck.multi) {
      return {
        status: 'conflict',
        file: filePath,
        error: `Search block appears ${multiCheck.count} times in ${filePath}. Be more specific — add surrounding context lines.`,
        multiOccurrence: multiCheck.contexts,
      };
    }
    const lineNum = content.substring(0, exactIdx).split('\n').length;
    match = { line: lineNum, level: 2 };
  } else if (fuzzy) {
    match = fuzzyMatch(content, search);
  }

  if (!match) {
    const nearest = suggestNearest(content, search);
    const detailMsg = nearest ? nearest.map(n =>
      n.diffHint || `Line ${n.line}: "${n.text}"`
    ).join('; ') : '';
    return {
      status: 'conflict',
      file: filePath,
      error: `Cannot find search block in ${filePath}${detailMsg ? `. Nearest: ${detailMsg}` : ''}`,
      details: nearest,
    };
  }

  // For fuzzy matches (L3+), check if anchor line occurs in multiple places
  if (match.level >= 3) {
    const multiCheck = detectMultiOccurrence(content, search, { level: match.level });
    if (multiCheck.multi) {
      return {
        status: 'conflict',
        file: filePath,
        error: `Fuzzy search anchor "${search.split('\n').filter(l => l.trim() && !/^[{}\s]*$/.test(l.trim()))[0]?.trim() || ''}" appears ${multiCheck.count} times in ${filePath} (lines ${multiCheck.lines?.join(', ')}). Add more unique context lines.`,
        multiOccurrence: multiCheck,
      };
    }
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
 * Apply a partial-context SEARCH/REPLACE block.
 *
 * Designed for LLMs that output fewer surrounding context lines.
 * Uses same 4-level + L5 matching, but with stricter multi-occurrence
 * detection since abbreviated context increases collision risk.
 *
 * @param {string} filePath
 * @param {{ search: string, replace: string }} block — search can be abbreviated
 * @param {{ fuzzy?: boolean, undo?: boolean }} [opts]
 * @returns {object} same shape as applySearchReplace
 */
export function applyPartial(filePath, block, opts = {}) {
  const { fuzzy = true, undo = false } = opts;
  const { search: partial, replace } = block;

  if (!partial) {
    return { status: 'error', file: filePath, error: 'Empty partial search' };
  }

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot read: ${e.message}` };
  }

  // 1. Try exact match
  const exactIdx = content.indexOf(partial);
  if (exactIdx !== -1) {
    // Stricter multi-occurrence check: level 2 even for partial
    const multiCheck = detectMultiOccurrence(content, partial, { level: 2 });
    if (multiCheck.multi) {
      return {
        status: 'conflict',
        file: filePath,
        error: `Partial search appears ${multiCheck.count} times in ${filePath}. Need more context.`,
        multiOccurrence: multiCheck.contexts,
      };
    }
    const lineNum = content.substring(0, exactIdx).split('\n').length;
    const before = content.substring(0, exactIdx);
    const after = content.substring(exactIdx + partial.length);
    const newContent = before + replace + after;
    if (undo) { try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* */ } }
    try { writeFileSync(filePath, newContent, 'utf-8'); } catch (e) {
      return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
    }
    const diff = generateDiffSummary(content, newContent, filePath);
    return { status: 'applied', file: filePath, matchLevel: 2, diff, backup: undo ? (filePath + '.apply.bak') : undefined };
  }

  // 2. Try fuzzy match through all levels (L1-L4 + L5)
  if (fuzzy) {
    const fm = fuzzyMatch(content, partial);
    if (fm) {
      // Stricter multi-occurrence check: for partial (< 5 lines) require L4+ only
      const partialLines = partial.split('\n').filter(l => l.trim()).length;
      if (partialLines < 5) {
        const multiCheck = detectMultiOccurrence(content, partial, { level: Math.min(fm.level, 3) });
        if (multiCheck.multi) {
          return {
            status: 'conflict',
            file: filePath,
            error: `Partial context (${partialLines} lines) matches ${multiCheck.count} times. Add more context lines.`,
            multiOccurrence: multiCheck,
          };
        }
      }

      // Apply replacement at fuzzy match location — same approach as applySearchReplace
      const sl = partial.split('\n');
      const cl = content.split('\n');
      const beforeOffset = cl.slice(0, fm.line - 1);
      const actualStart = beforeOffset.length > 0 ? beforeOffset.join('\n').length + 1 : 0;
      const matchedRegion = cl.slice(fm.line - 1, fm.line - 1 + sl.length).join('\n');
      const actualNewContent = content.substring(0, actualStart) + replace + content.substring(actualStart + matchedRegion.length);

      if (undo) { try { copyFileSync(filePath, filePath + '.apply.bak'); } catch { /* */ } }
      try { writeFileSync(filePath, actualNewContent, 'utf-8'); } catch (e) {
        return { status: 'error', file: filePath, error: `Cannot write: ${e.message}` };
      }
      const diff = generateDiffSummary(content, actualNewContent, filePath);
      return { status: 'applied', file: filePath, matchLevel: fm.level, diff, backup: undo ? (filePath + '.apply.bak') : undefined };
    }
  }

  // 3. Not found — report with nearest suggestions
  const nearest = suggestNearest(content, partial);
  const detailMsg = nearest ? nearest.map(n =>
    n.diffHint || `Line ${n.line}: "${n.text}"`
  ).join('; ') : '';
  return {
    status: 'conflict',
    file: filePath,
    error: `Cannot find partial search block in ${filePath}${detailMsg ? `. Nearest: ${detailMsg}` : ''}`,
    details: nearest,
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
      if (l.startsWith('+') || l.startsWith(' ')) addLines.push(l.substring(1));
      // '-' lines are removed
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
 * @param {Array<{file:string, type:'search-replace'|'lazy'|'partial'|'whole'|'diff', search?:string, replace?:string, content?:string, hunks?:Array}>} changes
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
    } else if (ch.type === 'lazy') {
      r = applySearchReplaceWithLazy(ch.file, { search: ch.search, replace: ch.replace }, { ...opts, undo: true });
    } else if (ch.type === 'partial') {
      r = applyPartial(ch.file, { search: ch.search, replace: ch.replace }, { ...opts, undo: true });
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

// ---------------------------------------------------------------------------
// File access validation
// ---------------------------------------------------------------------------

const BINARY_CHECK_CHUNK = 8192;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Validate file accessibility before apply operations.
 * Checks: existence, readability, writability, binary content, file size.
 *
 * @param {string} filePath
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function checkFileAccess(filePath) {
  const errors = [];
  const warnings = [];

  // Check existence
  if (!existsSync(filePath)) {
    errors.push(`File does not exist: ${filePath}`);
    return { ok: false, errors, warnings };
  }

  // Check size
  let stat;
  try {
    stat = statSync(filePath);
  } catch (e) {
    errors.push(`Cannot stat file: ${e.message}`);
    return { ok: false, errors, warnings };
  }

  if (stat.size > MAX_FILE_SIZE) {
    warnings.push(`File is very large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Apply may be slow.`);
  }

  // Check readability with a small read
  let startBytes;
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(BINARY_CHECK_CHUNK);
    const bytesRead = readSync(fd, buf, 0, BINARY_CHECK_CHUNK, 0);
    closeSync(fd);
    startBytes = buf.slice(0, bytesRead);
  } catch (e) {
    errors.push(`File not readable: ${e.message}`);
    return { ok: false, errors, warnings };
  }

  // Check writability by opening for append (doesn't modify content)
  try {
    const fd = openSync(filePath, 'a');
    closeSync(fd);
  } catch (e) {
    errors.push(`File not writable: ${e.message}`);
    return { ok: false, errors, warnings };
  }

  // Detect binary: check for null bytes in first 8KB
  if (startBytes.includes(0)) {
    errors.push(`File appears to be binary (contains null bytes): ${filePath}`);
    return { ok: false, errors, warnings };
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Suggest nearest match when exact search fails.
 * Returns top 3 closest line matches with context + diff hints.
 * Scores by: exact line match > substring match > word-level match
 * @returns {Array<{line:number, score:number, text:string, diffHint?:string}>|null}
 */
export function suggestNearest(content, search) {
  const searchLines = search.trim().split('\n');
  const contentLines = content.split('\n');
  const searchUnique = searchLines.filter(l => l.trim() && !/^[{}\s]*$/.test(l.trim()));

  if (searchUnique.length === 0) return null;

  // Extract individual words from search for fuzzy word-level matching
  const searchWords = [...new Set(
    searchUnique.flatMap(l => l.trim().split(/[^a-zA-Z0-9_$]+/).filter(w => w.length > 1))
  )];
  if (searchWords.length === 0) return null;

  // Score each content line: exact substring match (weight 3) + word match (weight 1)
  const scores = [];
  for (let i = 0; i < contentLines.length; i++) {
    const lineText = contentLines[i];
    let score = 0;

    // Substring match (high weight)
    for (const sl of searchUnique) {
      if (lineText.includes(sl.trim())) score += 3;
    }

    // Word-level match (low weight for partial similarity)
    for (const w of searchWords) {
      if (lineText.toLowerCase().includes(w.toLowerCase())) score += 1;
    }

    if (score > 0) scores.push({ line: i + 1, score, text: lineText.trim().substring(0, 80) });
  }

  const top = scores.sort((a, b) => b.score - a.score).slice(0, 3);

  // Add diff hints for best match
  if (top.length > 0 && searchLines.length > 0) {
    for (let i = 0; i < Math.min(searchLines.length, 3); i++) {
      const expected = searchLines[i].trim();
      const matchLine = top[0].line - 1 + i;
      if (matchLine < contentLines.length) {
        const actual = contentLines[matchLine]?.trim() || '';
        if (expected && actual && expected !== actual) {
          top[i] = {
            ...top[i] || top[0],
            diffHint: `Line ${matchLine + 1}: expected "${expected.substring(0, 50)}" but found "${actual.substring(0, 50)}"`,
          };
        }
      }
    }
  }

  return top;
}

// ---------------------------------------------------------------------------
// Lazy edit markers
// ---------------------------------------------------------------------------

// Regex for lazy marker lines across comment syntaxes.
// Matches comment-prefix + optional "... existing code ..." variants.
// Examples matched: "// ... existing code ...", "# ...", "<!-- ... -->", "/* ... */"
// Key: must contain "..." somewhere after the comment prefix.
const LAZY_MARKER_RE = /^\s*(\/\/|#|--|;|%|<!--|\/\*)\s*(\.\.\.\s*)?(existing\s+code\s*)?(\.\.\.\s*)?(\*\/|-->)?\s*$/i;

/**
 * Parse lines into alternating marker/real segments.
 * @param {string[]} lines
 * @returns {Array<{type:'marker'|'real', texts?:string[]}>}
 */
function parseIntoSegments(lines) {
  const segs = [];
  let i = 0;
  while (i < lines.length) {
    if (LAZY_MARKER_RE.test(lines[i])) {
      const texts = [];
      while (i < lines.length && LAZY_MARKER_RE.test(lines[i])) { texts.push(lines[i]); i++; }
      segs.push({ type: 'marker', texts });
    } else {
      const texts = [];
      while (i < lines.length && !LAZY_MARKER_RE.test(lines[i])) { texts.push(lines[i]); i++; }
      segs.push({ type: 'real', texts });
    }
  }
  return segs;
}

/**
 * Expand lazy markers in a SEARCH/REPLACE block.
 *
 * Lazy markers (e.g. `// ... existing code ...`) let LLMs omit unchanged code
 * from SEARCH/REPLACE blocks, saving 80-98% tokens.
 *
 * HOW IT WORKS:
 *   1. Parse SEARCH into alternating [marker, real, marker, real, ...] segments
 *   2. Strip markers → effective search text (all real segments concatenated)
 *   3. Sequentially match each real segment against file content via fuzzyMatch
 *   4. Build expanded SEARCH: file content at matched ranges (no tokens saved in engine, only in LLM output)
 *   5. Build expanded REPLACE:
 *      - Marker segments → expand with file content at corresponding positions
 *      - Real segments → use replacement text as-is
 *
 * @param {string} fileContent — full file content
 * @param {{search:string, replace:string}} block — SEARCH/REPLACE block
 * @returns {{search:string, replace:string}|null} — expanded block, or null if no markers
 * @throws {Error} if search content cannot be found in file
 */
export function expandLazyMarkers(fileContent, block) {
  if (!block.search || !block.replace) return null;

  const sl = block.search.split('\n');
  const rl = block.replace.split('\n');

  const searchHasMarker = sl.some(l => LAZY_MARKER_RE.test(l));
  const replaceHasMarker = rl.some(l => LAZY_MARKER_RE.test(l));
  if (!searchHasMarker && !replaceHasMarker) return null;

  // Parse both into segments
  const searchSegs = parseIntoSegments(sl);
  const replaceSegs = parseIntoSegments(rl);

  const searchReal = searchSegs.filter(s => s.type === 'real');
  if (searchReal.length === 0) {
    throw new Error('SEARCH block has only lazy markers — no real content to match');
  }

  // ---- Step 1: Sequentially match each real SEARCH segment against file ----
  const contentLines = fileContent.split('\n');
  const matches = []; // { line: 1-indexed, level, len }

  // Match each real segment sequentially starting from searchFromLine
  let searchFromLine = 1; // 1-indexed
  for (const seg of searchReal) {
    const segText = seg.texts.join('\n');
    // Strip leading \n from segText for matching.
    // When a SEARCH real segment starts with an empty line (e.g. blank line
    // between lazy marker and real code), segText starts with \n. This causes
    // matchL2 to return the line BEFORE the \n, making the gap boundary
    // exclude the preceding file content. Stripping \n fixes the off-by-one.
    const leadingMatch = segText.match(/^\n+/);
    const leadingNewlines = leadingMatch ? leadingMatch[0].length : 0;
    const adjustedSegText = leadingNewlines > 0 ? segText.slice(leadingNewlines) : segText;

    // fuzzyMatch against file content starting from searchFromLine
    const subContent = contentLines.slice(searchFromLine - 1).join('\n');
    const match = fuzzyMatch(subContent, adjustedSegText);
    if (!match) {
      throw new Error(
        `Cannot find SEARCH content in file (near "${seg.texts[0]?.substring(0, 60).trim()}")`
      );
    }
    // Leading blank lines in segText are separators between markers and real
    // content. The match lands on the real content already — no adjustment needed.
    const absoluteLine = searchFromLine + match.line - 1;
    // Effective len excludes leading blank lines (they are separators, not content)
    const effectiveLen = seg.texts.length - leadingNewlines;
    matches.push({ line: absoluteLine, level: match.level, len: effectiveLen });
    searchFromLine = absoluteLine + effectiveLen;
  }

  // ---- Step 3: Build expanded SEARCH ----
  // The region in the file: from first real match start to last real match end
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  const regionStart = firstMatch.line - 1;         // 0-indexed
  const regionEnd = lastMatch.line - 1 + lastMatch.len;
  const expandedSearch = contentLines.slice(regionStart, regionEnd).join('\n');

  // ---- Step 4: Build expanded REPLACE ----
  // Rules for REPLACE expansion within the region:
  //   - Leading marker (before first real) → skipped (outside region)
  //   - Between marker (between reals)    → expanded with file content from gap
  //   - Trailing marker (after last real) → skipped (outside region)
  //   - Real segment                      → replacement text

  // Compute gaps: file content between consecutive real matches (0-indexed)
  const gaps = [];
  for (let i = 0; i < matches.length - 1; i++) {
    const curEnd = matches[i].line - 1 + matches[i].len;
    const nextStart = matches[i + 1].line - 1;
    if (curEnd < nextStart) {
      gaps.push({ start: curEnd, end: nextStart });
    }
  }

  // Walk REPLACE segments, keeping track of which match/gap we're on
  const expandedReplaceLines = [];
  let matchConsumed = false; // true after first real segment passed
  let gapIdx = 0;

  for (const seg of replaceSegs) {
    if (seg.type === 'real') {
      expandedReplaceLines.push(...seg.texts);
      matchConsumed = true;
    } else {
      // Marker: expand only if it's a "between" marker (past first real, gaps remain)
      if (matchConsumed && gapIdx < gaps.length) {
        const g = gaps[gapIdx];
        expandedReplaceLines.push(...contentLines.slice(g.start, g.end));
        gapIdx++;
      }
      // Leading/trailing markers → skip (outside region)
    }
  }

  return {
    search: expandedSearch,
    replace: expandedReplaceLines.join('\n'),
  };
}

/**
 * Apply a SEARCH/REPLACE block with lazy marker support.
 * Expands markers, then applies as normal. Falls back to plain apply if no markers.
 */
export function applySearchReplaceWithLazy(filePath, block, opts = {}) {
  let content;
  try { content = readFileSync(filePath, 'utf-8'); } catch (e) {
    return { status: 'error', file: filePath, error: `Cannot read: ${e.message}` };
  }

  const expanded = expandLazyMarkers(content, block);
  if (expanded) {
    return applySearchReplace(filePath, expanded, opts);
  }
  return applySearchReplace(filePath, block, opts);
}
