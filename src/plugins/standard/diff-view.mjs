// diff-view.mjs → smart_diff_view
//
// Terminal-friendly unified diff viewer. Generates visual diffs
// for LLM consumption — solves the "no visual diff" weakness.
//
// Supports:
//   - File-vs-file comparison
//   - File-vs-content comparison (preview proposed changes)
//   - Git diff (compare working tree vs HEAD)
//   - Side-by-side and unified formats
//   - ANSI color output for terminal readability

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Core diff engine (simple line-by-line, no external deps)
// ---------------------------------------------------------------------------

function computeDiff(oldLines, newLines, contextLines = 3) {
  // Simple LCS-based diff
  const m = oldLines.length, n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const hunks = [];
  let i = m, j = n;
  const edits = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      edits.unshift({ type: 'keep', oldLine: i, newLine: j, text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.unshift({ type: 'add', oldLine: i, newLine: j, text: newLines[j - 1] });
      j--;
    } else {
      edits.unshift({ type: 'remove', oldLine: i, newLine: j, text: oldLines[i - 1] });
      i--;
    }
  }

  // Group into hunks with context
  const diffEdits = edits.filter(e => e.type !== 'keep');
  if (diffEdits.length === 0) return [];

  // Find change regions
  const changeIndices = new Set();
  for (const e of diffEdits) {
    const idx = edits.indexOf(e);
    for (let k = Math.max(0, idx - contextLines); k <= Math.min(edits.length - 1, idx + contextLines); k++) {
      changeIndices.add(k);
    }
  }

  // Build hunks
  const sortedIndices = [...changeIndices].sort((a, b) => a - b);
  const hunks_out = [];
  let hunkStart = -1;
  let hunkEdits = [];

  for (const idx of sortedIndices) {
    if (hunkStart === -1 || idx > (hunkStart + hunkEdits.length + contextLines * 2)) {
      if (hunkEdits.length > 0) {
        hunks_out.push(buildHunk(edits, hunkStart, hunkEdits));
      }
      hunkStart = idx;
      hunkEdits = [edits[idx]];
    } else {
      hunkEdits.push(edits[idx]);
    }
  }
  if (hunkEdits.length > 0) {
    hunks_out.push(buildHunk(edits, hunkStart, hunkEdits));
  }

  return hunks_out;
}

function buildHunk(allEdits, startIdx, hunkEdits) {
  const oldStart = hunkEdits[0].oldLine || (hunkEdits.find(e => e.oldLine)?.oldLine || 1);
  const newStart = hunkEdits[0].newLine || (hunkEdits.find(e => e.newLine)?.newLine || 1);
  const oldCount = hunkEdits.filter(e => e.type !== 'add').length;
  const newCount = hunkEdits.filter(e => e.type !== 'remove').length;

  return {
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    lines: hunkEdits.map(e => ({
      type: e.type,
      oldLine: e.oldLine,
      newLine: e.newLine,
      text: e.text || '',
    })),
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatUnified(hunks, oldFile, newFile, useColor) {
  const out = [];
  out.push(`--- a/${oldFile}`);
  out.push(`+++ b/${newFile}`);

  for (const hunk of hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      const text = useColor
        ? line.type === 'add' ? `\x1b[32m${prefix}${line.text}\x1b[0m`
        : line.type === 'remove' ? `\x1b[31m${prefix}${line.text}\x1b[0m`
        : `${prefix}${line.text}`
        : `${prefix}${line.text}`;
      out.push(text);
    }
  }

  return out.join('\n');
}

function formatSideBySide(hunks, oldFile, newFile, useColor, width = 80) {
  const halfWidth = Math.floor((width - 3) / 2);
  const out = [];
  out.push(`${oldFile.padEnd(halfWidth)} | ${newFile}`);
  out.push('─'.repeat(width));

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const text = line.text.slice(0, halfWidth - 1);
      if (line.type === 'remove') {
        const left = useColor ? `\x1b[31m- ${text}\x1b[0m`.padEnd(halfWidth + 11) : `- ${text}`.padEnd(halfWidth);
        out.push(`${left} |`);
      } else if (line.type === 'add') {
        const right = useColor ? `\x1b[32m+ ${text}\x1b[0m` : `+ ${text}`;
        out.push(`${''.padEnd(halfWidth)} | ${right}`);
      } else {
        out.push(`${`  ${text}`.padEnd(halfWidth)} |   ${text}`);
      }
    }
  }

  return out.join('\n');
}

function formatStats(oldLines, newLines, hunks) {
  const added = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'add').length, 0);
  const removed = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'remove').length, 0);
  const changed = hunks.length;

  return [
    `📊 Diff Stats:`,
    `  Files: 1`,
    `  Hunks: ${changed}`,
    `  +${added} -${removed}`,
    `  ${oldLines.length} → ${newLines.length} lines`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_diff_view',
  category: 'report',
  responsePolicy: { maxLevel: 0 },
  description: 'Use when: need to visually compare files or preview changes before applying. Generates terminal-friendly unified or side-by-side diffs. Solves the "no visual diff" weakness — use before fast_apply to verify changes.',
  inputSchema: {
    type: 'object',
    properties: {
      file1: { type: 'string', description: 'First file path (or base file)' },
      file2: { type: 'string', description: 'Second file path (optional — compare file1 vs file2)' },
      content: { type: 'string', description: 'New content to compare against file1 (for previewing proposed changes)' },
      git: { type: 'boolean', description: 'Show git diff (working tree vs HEAD) for file1' },
      staged: { type: 'boolean', description: 'Show staged git diff (with --git, shows staged changes)' },
      format: { type: 'string', enum: ['unified', 'side-by-side', 'stats'], description: 'Output format (default: unified)' },
      color: { type: 'boolean', description: 'Use ANSI color codes (default: true for terminal)' },
      context: { type: 'number', description: 'Context lines around changes (default: 3)' },
      root: { type: 'string', description: 'Project root (default: cwd)' },
    },
  },

  handler(args) {
    const root = args.root || process.cwd();
    const format = args.format || 'unified';
    const useColor = args.color !== false;
    const contextLines = args.context || 3;

    // Git diff mode
    if (args.git && args.file1) {
      try {
        const filePath = resolve(root, args.file1);
        const staged = args.staged ? '--staged' : '';
        const cmd = `git -C "${root}" diff ${staged} -- "${filePath}"`;
        const diff = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        if (!diff.trim()) return 'No changes (working tree matches HEAD).';
        return diff;
      } catch (e) {
        return `Git diff error: ${e.message}`;
      }
    }

    // File vs content mode
    if (args.file1 && args.content !== undefined) {
      const filePath = resolve(root, args.file1);
      if (!existsSync(filePath)) return `File not found: ${args.file1}`;

      let oldContent;
      try { oldContent = readFileSync(filePath, 'utf-8'); } catch (e) {
        return `Cannot read ${args.file1}: ${e.message}`;
      }

      const oldLines = oldContent.split('\n');
      const newLines = args.content.split('\n');
      const hunks = computeDiff(oldLines, newLines, contextLines);

      if (hunks.length === 0) return 'No changes detected — content is identical.';

      const relPath = relative(root, filePath);
      const out = [];

      if (format === 'stats') {
        out.push(formatStats(oldLines, newLines, hunks));
      } else if (format === 'side-by-side') {
        out.push(formatSideBySide(hunks, relPath, `${relPath} (proposed)`, useColor));
      } else {
        out.push(formatUnified(hunks, relPath, `${relPath} (proposed)`, useColor));
      }

      out.push('');
      out.push(formatStats(oldLines, newLines, hunks));
      out.push('\n💡 Review the diff above. Use fast_apply to apply these changes.');

      return out.join('\n');
    }

    // File vs file mode
    if (args.file1 && args.file2) {
      const fp1 = resolve(root, args.file1);
      const fp2 = resolve(root, args.file2);

      if (!existsSync(fp1)) return `File not found: ${args.file1}`;
      if (!existsSync(fp2)) return `File not found: ${args.file2}`;

      let c1, c2;
      try { c1 = readFileSync(fp1, 'utf-8'); } catch (e) { return `Cannot read ${args.file1}: ${e.message}`; }
      try { c2 = readFileSync(fp2, 'utf-8'); } catch (e) { return `Cannot read ${args.file2}: ${e.message}`; }

      const oldLines = c1.split('\n');
      const newLines = c2.split('\n');
      const hunks = computeDiff(oldLines, newLines, contextLines);

      if (hunks.length === 0) return 'Files are identical.';

      const rel1 = relative(root, fp1);
      const rel2 = relative(root, fp2);
      const out = [];

      if (format === 'stats') {
        out.push(formatStats(oldLines, newLines, hunks));
      } else if (format === 'side-by-side') {
        out.push(formatSideBySide(hunks, rel1, rel2, useColor));
      } else {
        out.push(formatUnified(hunks, rel1, rel2, useColor));
      }

      out.push('');
      out.push(formatStats(oldLines, newLines, hunks));

      return out.join('\n');
    }

    return 'Usage: smart_diff_view({file1:"path", content:"new content"}) to preview changes, or smart_diff_view({file1:"path", git:true}) for git diff.';
  },
};
