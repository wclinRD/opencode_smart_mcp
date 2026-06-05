// fast-apply.mjs → smart_fast_apply
//
// Fast Apply: 讓 LLM 快速準確 apply 程式碼修改。
// 支援 3 種輸入格式:
//   1. SEARCH/REPLACE blocks (Aider 相容)
//   2. Unified diff (git diff 格式)
//   3. Whole file replacement
//
// 安全設計:
//   - dry-run 預設（只顯示變更計畫）
//   - 3+ 檔案須 `apply: true` 明確授權
//   - undo 支援（git-based 回滾）
//   - 4 層模糊匹配（精確→空白容錯）
//
// 使用流程:
//   LLM output → smart_fast_apply(dry-run) → review → smart_fast_apply(apply)
//
// 整合:
//   patch_gen → fast_apply → test

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  applySearchReplace,
  applySearchReplaceWithLazy,
  applyPartial,
  applyWholeFile,
  applyUnifiedDiff,
  applyAtomic,
  parseSearchReplace,
  parseSearchReplaceText,
  parseUnifiedDiff,
  fuzzyMatch,
  checkBalance,
  checkFileAccess,
} from '../../lib/apply-engine.mjs';

export default {
  name: 'smart_fast_apply',
  category: 'edit',
  cli: 'fast-apply.mjs',
  description: `Use when: need to apply LLM-suggested code edits faster and more accurately.
Supports 5 input formats:
  - search-replace: SEARCH/REPLACE blocks (Aider-compatible)
  - lazy: lazy marker blocks with // ... existing code ... markers (80-98% token savings)
  - partial: abbreviated SEARCH context (fewer lines, L5 matching)
  - unified-diff: git diff format
  - whole-file: full file replacement
Features: 5-level fuzzy matching (incl. partial/L5), atomic multi-file apply, undo snapshots, binary/access checks.
Dry-run by default — safe to use without side effects.`,

  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['search-replace', 'lazy', 'partial', 'unified-diff', 'whole-file'],
        description: 'Input format (default: search-replace). Use lazy for // ... markers, partial for abbreviated SEARCH.',
      },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Target file path' },
            search: { type: 'string', description: 'Text to search (multi-line). For lazy format: use // ... markers to skip unchanged code. For partial format: abbreviated context lines.' },
            replace: { type: 'string', description: 'Replacement text (multi-line)' },
          },
          required: ['file', 'search', 'replace'],
        },
        description: 'SEARCH/REPLACE blocks (for format=search-replace, lazy, or partial)',
      },
      text: {
        type: 'string',
        description: 'Raw text containing SEARCH/REPLACE blocks or unified diff (auto-parsed)',
      },
      diff: {
        type: 'string',
        description: 'Unified diff string (for format=unified-diff or auto-detect)',
      },
      whole: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          content: { type: 'string' },
        },
        description: 'Whole file replacement (for format=whole-file)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict changes to these files only',
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: .)',
      },

      // Behavior control
      fuzzy: {
        type: 'boolean',
        description: 'Enable 4-level fuzzy matching (default: true)',
      },
      validate: {
        type: 'boolean',
        description: 'Check brace/bracket balance after apply (default: false)',
      },
      undo: {
        type: 'boolean',
        description: 'Create .apply.bak snapshots for rollback (default: true)',
      },
      atomic: {
        type: 'boolean',
        description: 'Apply all changes atomically with rollback on failure (default: false)',
      },

      // Safety gates
      dryRun: {
        type: 'boolean',
        description: 'Preview only — show changes without applying (default: true)',
      },
      apply: {
        type: 'boolean',
        description: 'Actually apply changes (default: false, explicit opt-in for 3+ files)',
      },

      output: {
        type: 'string',
        enum: ['text', 'json', 'diff'],
        description: 'Output format (default: text)',
      },
    },
    // No strict required — can use blocks, text, diff, or whole
  },

  handler: async (args) => {
    const format = args.format || 'search-replace';
    const fuzzy = args.fuzzy !== false;
    const validate = args.validate === true;
    const undo = args.undo !== false;
    const atomic = args.atomic === true;
    const dryRun = args.dryRun !== false && args.apply !== true;
    const outputFormat = args.output || 'text';
    const root = args.root || process.cwd();
    const allowedFiles = args.files;

    // ---- Step 1: Parse input into normalized change list ----
    let changes = [];

    try {
      if (format === 'search-replace' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'search-replace' }));
      } else if (format === 'lazy' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'lazy' }));
      } else if (format === 'partial' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'partial' }));
      } else if (format === 'search-replace' && args.text) {
        changes = parseSearchReplaceText(args.text).map(b => ({ ...b, type: 'search-replace' }));
      } else if ((format === 'lazy' || format === 'partial') && args.text) {
        changes = parseSearchReplaceText(args.text).map(b => ({ ...b, type: format }));
      } else if (format === 'unified-diff') {
        const diffInput = args.diff || args.text || '';
        const parsed = parseUnifiedDiff(diffInput);
        changes = parsed.map(f => ({ file: f.file, type: 'diff', hunks: f.hunks }));
      } else if (format === 'whole-file' && args.whole) {
        changes = [{ ...args.whole, type: 'whole' }];
      } else if (args.text) {
        // Auto-detect: try SEARCH/REPLACE blocks first, then unified diff
        const sr = parseSearchReplaceText(args.text);
        if (sr.length > 0) {
          changes = sr.map(b => ({ ...b, type: 'search-replace' }));
        } else {
          const ud = parseUnifiedDiff(args.text);
          if (ud.length > 0) {
            changes = ud.map(f => ({ file: f.file, type: 'diff', hunks: f.hunks }));
          }
        }
      }

      if (changes.length === 0) {
        return formatOutput({
          status: 'error',
          error: 'No changes parsed from input. Provide blocks, text, diff, or whole.',
        }, outputFormat);
      }

      // Filter by allowed files
      if (allowedFiles && allowedFiles.length > 0) {
        changes = changes.filter(c => allowedFiles.some(f => c.file === f || c.file.endsWith('/' + f)));
      }

      // Resolve file paths relative to root
      for (const c of changes) {
        if (c.file && !c.file.startsWith('/')) {
          c.file = resolve(root, c.file);
        }
      }

    } catch (e) {
      return formatOutput({ status: 'error', error: `Parse error: ${e.message}` }, outputFormat);
    }

    // ---- Step 2: Validate and preview ----
    const previewResults = [];
    const multiFile = changes.length > 2;

    for (const ch of changes) {
      // File access check for all types
      if (ch.file) {
        const access = checkFileAccess(ch.file);
        if (!access.ok) {
          previewResults.push({ file: ch.file, status: 'error', error: access.errors.join('; ') });
          continue;
        }
      }

      if (ch.type === 'search-replace' || ch.type === 'lazy' || ch.type === 'partial') {
        const content = readFileSafe(ch.file);
        if (content === null) {
          previewResults.push({ file: ch.file, status: 'error', error: 'File not found' });
          continue;
        }
        const match = fuzzyMatch(content, ch.search);
        const balance = validate ? checkBalance(content) : null;

        previewResults.push({
          file: ch.file,
          status: match ? 'ready' : 'conflict',
          matchLevel: match?.level || 0,
          searchLines: ch.search.split('\n').length,
          replaceLines: ch.replace.split('\n').length,
          fileSize: content.length,
          balanced: balance ? balance.balanced : undefined,
          // In dry-run, show what WOULD change
          preview: match ? generatePreview(content, ch.search, ch.replace, match.line) : undefined,
        });
      } else if (ch.type === 'diff') {
        previewResults.push({
          file: ch.file,
          status: 'ready',
          hunks: ch.hunks.length,
          type: 'unified-diff',
        });
      } else if (ch.type === 'whole') {
        previewResults.push({
          file: ch.file,
          status: 'ready',
          type: 'whole-file',
          size: ch.content.length,
        });
      }
    }

    // Conflict count
    const conflicts = previewResults.filter(r => r.status === 'conflict');

    // ---- Step 3: If dry-run, return preview ----
    if (dryRun) {
      return formatOutput({
        status: 'preview',
        dryRun: true,
        totalChanges: changes.length,
        files: changes.map(c => c.file),
        preview: previewResults,
        conflicts: conflicts.length,
        conflictFiles: conflicts.map(c => c.file),
        multiFileWarning: multiFile ? `Multi-file change (${changes.length} files). Set apply=true to proceed.` : undefined,
        hint: multiFile
          ? 'Re-run with apply=true to apply all changes.'
          : 'Re-run with apply=true to apply changes.',
      }, outputFormat);
    }

    // ---- Step 4: Safety gate for multi-file ----
    if (multiFile && args.apply !== true) {
      return formatOutput({
        status: 'safety_gate',
        error: `Multi-file change (${changes.length} files). Set apply=true to confirm.`,
        files: changes.map(c => c.file),
      }, outputFormat);
    }

    // ---- Step 5: Apply ----
    if (atomic) {
      const atomicChanges = changes.map(c => ({
        file: c.file,
        type: c.type,
        search: c.search,
        replace: c.replace,
        content: c.content,
        hunks: c.hunks,
      }));
      const { results, allSucceeded } = applyAtomic(atomicChanges, { fuzzy, undo });

      // Clean up backup files on success
      if (allSucceeded && results.length > 0) {
        for (const r of results) {
          if (r.backup) {
            try { const { unlinkSync } = await import('node:fs'); unlinkSync(r.backup); } catch { /* */ }
          }
        }
      }

      return formatOutput({
        status: allSucceeded ? 'applied' : 'partial',
        atomic: true,
        totalChanges: changes.length,
        results: results.map(r => ({
          file: r.file,
          status: r.status,
          matchLevel: r.matchLevel,
          error: r.error,
        })),
        summary: {
          applied: results.filter(r => r.status === 'applied').length,
          failed: results.filter(r => r.status !== 'applied').length,
        },
      }, outputFormat);
    } else {
      // Sequential apply
      const appResults = [];
      for (const ch of changes) {
        let r;
        if (ch.type === 'search-replace') {
          r = applySearchReplace(ch.file, { search: ch.search, replace: ch.replace }, { fuzzy, undo });
        } else if (ch.type === 'lazy') {
          r = applySearchReplaceWithLazy(ch.file, { search: ch.search, replace: ch.replace }, { fuzzy, undo });
        } else if (ch.type === 'partial') {
          r = applyPartial(ch.file, { search: ch.search, replace: ch.replace }, { fuzzy, undo });
        } else if (ch.type === 'diff') {
          r = applyUnifiedDiff(ch.file, ch.hunks, { undo });
        } else if (ch.type === 'whole') {
          r = applyWholeFile(ch.file, ch.content, { undo });
        }
        appResults.push(r || { status: 'error', file: ch.file, error: 'Unknown type' });
      }

      return formatOutput({
        status: 'applied',
        totalChanges: changes.length,
        results: appResults.map(r => ({
          file: r.file,
          status: r.status,
          matchLevel: r.matchLevel,
          error: r.error,
          diff: r.diff,
        })),
        summary: {
          applied: appResults.filter(r => r.status === 'applied').length,
          conflicts: appResults.filter(r => r.status === 'conflict').length,
          failed: appResults.filter(r => r.status === 'error').length,
        },
      }, outputFormat);
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileSafe(filePath) {
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function generatePreview(content, search, replace, lineNum) {
  const lines = content.split('\n');
  const sl = search.split('\n');
  const start = Math.max(0, lineNum - 3);
  const end = Math.min(lines.length, lineNum + sl.length + 2);
  const ctx = [];
  for (let i = start; i < end; i++) {
    const prefix = (i >= lineNum - 1 && i < lineNum - 1 + sl.length) ? '~' : ' ';
    ctx.push(`${prefix} ${lines[i]}`);
  }
  return {
    atLine: lineNum,
    context: ctx.join('\n'),
    replaceLines: replace.split('\n').length,
  };
}

function formatOutput(data, format) {
  if (format === 'json') return data;

  if (format === 'diff') {
    if (data.results) {
      return data.results.filter(r => r.diff).map(r => r.diff).join('\n');
    }
    return JSON.stringify(data, null, 2);
  }

  // text format
  const out = [];
  if (data.status === 'error') {
    out.push(`❌ Error: ${data.error}`);
    return out.join('\n');
  }

  if (data.dryRun) {
    out.push(`🔍 DRY RUN — ${data.totalChanges} change(s) detected`);
    out.push('='.repeat(50));
    if (data.multiFileWarning) out.push(`\n⚠️  ${data.multiFileWarning}`);
    if (data.conflicts > 0) out.push(`\n⚠️  ${data.conflicts} file(s) with match conflicts:`);
    for (const cf of data.conflictFiles) out.push(`  ❌ ${cf}`);
    out.push('');
    for (const p of data.preview) {
      const icon = p.status === 'ready' ? '✅' : '❌';
      const matchInfo = p.matchLevel ? ` (fuzzy L${p.matchLevel})` : '';
      out.push(`${icon} ${p.file}${matchInfo}`);
      if (p.status === 'ready') {
        out.push(`   Search: ${p.searchLines} lines → Replace: ${p.replaceLines} lines`);
        if (p.matchLevel > 2) out.push(`   ⚡ Fuzzy match level ${p.matchLevel}`);
        if (p.balanced === false) out.push(`   ⚠️  Brace balance issue detected`);
      } else if (p.status === 'conflict') {
        out.push(`   ❌ Cannot find search block`);
      }
    }
    out.push(`\n💡 ${data.hint || 'Run with apply=true to apply.'}`);
    return out.join('\n');
  }

  if (data.status === 'applied' || data.status === 'partial') {
    out.push(`✅ Applied ${data.summary?.applied || 0}/${data.totalChanges || 0} change(s)`);
    if (data.summary?.conflicts > 0) out.push(`⚠️  ${data.summary.conflicts} conflict(s) — need manual fix`);
    if (data.summary?.failed > 0) out.push(`❌ ${data.summary.failed} error(s)`);
    out.push('');
    for (const r of (data.results || [])) {
      const icon = r.status === 'applied' ? '✅' : r.status === 'conflict' ? '❌' : '⚠️';
      out.push(`${icon} ${r.file}`);
      if (r.matchLevel && r.matchLevel > 2) out.push(`   ⚡ Fuzzy match level ${r.matchLevel}`);
      if (r.error) out.push(`   ${r.error}`);
    }
    if (data.results?.some(r => r.diff)) {
      out.push('\n--- Diffs ---');
      for (const r of data.results) {
        if (r.diff) out.push(`\n${r.diff}`);
      }
    }
    return out.join('\n');
  }

  return JSON.stringify(data, null, 2);
}
