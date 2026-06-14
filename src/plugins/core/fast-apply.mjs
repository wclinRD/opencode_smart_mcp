// fast-apply.mjs → smart_fast_apply
//
// Fast Apply: 讓 LLM 快速準確 apply 程式碼修改。
// 支援 7 種輸入格式:
//   1. block-diff: symbol-aware 區塊取代（新，最省 token）
//   2. unified-diff: git diff 格式（高效）
//   3. lazy: SEARCH/REPLACE with // ... markers
//   4. hashline: 行號 + content-hash（最穩健）
//   5. partial: 縮寫 SEARCH context
//   6. search-replace: 標準 SEARCH/REPLACE（Aider 相容）
//   7. whole-file: 完整檔案取代
//
// 安全設計:
//   - dry-run 預設（只顯示變更計畫）
//   - 3+ 檔案須 `apply: true` 明確授權
//   - undo 支援（git-based 回滾）
//   - 6+1 層模糊匹配（L1-L6 文字 + L7 AST 感知）
//
// 使用流程:
//   LLM output → smart_fast_apply(dry-run) → review → smart_fast_apply(apply)
//
// 整合:
//   patch_gen → fast_apply → test

import { readFileSync } from 'node:fs';
import { relative, resolve, extname } from 'node:path';
import { extractSymbol, detectLanguage } from '../../lib/smart-read.mjs';
import {
  applySearchReplace,
  applySearchReplaceWithLazy,
  applyPartial,
  applyWholeFile,
  applyUnifiedDiff,
  applyAtomic,
  applyHashline,
  parseSearchReplace,
  parseSearchReplaceText,
  parseUnifiedDiff,
  fuzzyMatch,
  checkBalance,
  checkFileAccess,
  expandLazyMarkers,
  computeLineFingerprints,
  verifyLineFingerprint,
} from '../../lib/apply-engine.mjs';

export default {
  name: 'smart_fast_apply',
  category: 'edit',
  cli: 'fast-apply.mjs',
  description: `Unified editing tool — replaces write + edit + edit_ast.
Supports 7 input formats (ordered by token efficiency):
  - block-diff: symbol-aware block editing (NEW, most reliable). Specify {file, symbol, newContent, action?}. No fuzzy matching needed.
  - unified-diff: git diff format — MOST token-efficient (40-60% savings). Use +/- lines only, no unchanged lines needed.
  - lazy: SEARCH/REPLACE with // ... existing code ... markers (80-98% savings for large files)
  - hashline: line-number + content-hash addressing — MOST ROBUST for large files (>400 lines). Specify line range directly. No fuzzy match ambiguity.
  - partial: abbreviated SEARCH context (fewer lines, L5 fuzzy matching)
  - search-replace: standard SEARCH/REPLACE blocks (Aider-compatible)
  - whole-file: full file replacement (most tokens)
💡 Tip: block-diff for symbol-level edits, unified-diff for small edits, hashline for >400 line files, lazy for large files with few changes.
Features: 6-level fuzzy matching (L6 = gap-tolerant subsequence), hashline addressing with content verification, atomic multi-file apply, undo snapshots, binary/access checks.
Dry-run by default — safe to use without side effects.`,

  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['search-replace', 'lazy', 'partial', 'unified-diff', 'whole-file', 'hashline', 'block-diff'],
        description: 'Input format (default: search-replace). Token efficiency: unified-diff (best, +/- only) > lazy > hashline > partial > search-replace > whole-file. Use hashline for large files (>400 lines) where SEARCH/REPLACE matching is unreliable.',
      },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Target file path' },
            search: { type: 'string', description: 'Text to search (multi-line). For lazy format: use // ... markers to skip unchanged code. For partial format: abbreviated context lines.' },
            replace: { type: 'string', description: 'Replacement text (multi-line)' },
            // BlockDiff fields (required when format=block-diff)
            symbol: { type: 'string', description: 'Symbol name (function/class) for block-diff format' },
            newContent: { type: 'string', description: 'Replacement content for block-diff format (paired with symbol)' },
            action: { type: 'string', enum: ['replace', 'prepend', 'append'], description: 'Block-diff action (default: replace)' },
          },
          required: ['file', 'search', 'replace'],
        },
        description: 'Edit blocks. For search-replace/lazy/partial: {file,search,replace}. For block-diff: {file,symbol,newContent,action?}.',
      },
      text: {
        type: 'string',
        description: 'Raw text containing SEARCH/REPLACE blocks or unified diff (auto-parsed)',
      },
      diff: {
        type: 'string',
        description: 'Unified diff string (format=unified-diff). Token-efficient: only +/- lines needed, omit unchanged context.',
      },
      whole: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          content: { type: 'string' },
        },
        description: 'Whole file replacement (for format=whole-file)',
      },
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Target file path' },
            startLine: { type: 'number', description: 'Start line (1-indexed)' },
            endLine: { type: 'number', description: 'End line (1-indexed, inclusive)' },
            oldContent: { type: 'string', description: 'Expected content of the line range (for verification)' },
            newContent: { type: 'string', description: 'Replacement content' },
          },
          required: ['file', 'startLine', 'endLine', 'newContent'],
        },
        description: 'Hashline edit changes (for format=hashline). Specify line range directly with content verification — most robust for large files.',
      },
      // ── Flat shortcut syntax (替代原生 write/edit，LLM 不需選工具) ──
      file: {
        type: 'string',
        description: 'Target file path (flat syntax). Combine with content to create file, or with search+replace to edit.',
      },
      search: {
        type: 'string',
        description: 'Text to find (flat syntax, paired with replace and file)',
      },
      replace: {
        type: 'string',
        description: 'Replacement text (flat syntax, paired with search and file)',
      },
      content: {
        type: 'string',
        description: 'New file content (flat syntax, paired with file — creates or overwrites entire file)',
      },
      // ── Symbol-aware editing (取代 edit_ast) ──
      symbol: {
        type: 'string',
        description: 'Symbol name (function/class) for symbol-aware editing. Combines with action+newContent to edit a specific symbol body.',
      },
      newContent: {
        type: 'string',
        description: 'Content for symbol-aware editing (paired with symbol+action) or block-boundary action (paired with action+startLine)',
      },
      action: {
        type: 'string',
        enum: ['append', 'prepend', 'replace', 'insert-before', 'insert-after', 'delete'],
        description: 'Edit action. With symbol: append/prepend/replace. With startLine: insert-before/insert-after/delete.',
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
        enum: ['text', 'json', 'diff', 'ansi'],
        description: 'Output format (default: text). Use "ansi" for terminal-colored diff output (works in iTerm2 headless mode).',
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
      if (format === 'block-diff' && args.blocks) {
        changes = parseBlockDiff(args.blocks, root);
      } else if (format === 'search-replace' && args.blocks) {
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
      } else if (format === 'hashline' && args.changes) {
        changes = args.changes.map(c => ({ ...c, type: 'hashline' }));
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

      // ── Flat shortcut syntax ──
      if (changes.length === 0 && args.file) {
        if (args.content !== undefined) {
          // file+content → whole-file create/write
          changes = [{ file: args.file, content: args.content, type: 'whole' }];
        } else if (args.search !== undefined && args.replace !== undefined) {
          // file+search+replace → search-replace edit
          changes = [{ file: args.file, search: args.search, replace: args.replace, type: 'search-replace' }];
        } else if (args.symbol) {
          // file+symbol+action+newContent → symbol-edit (取代 edit_ast)
          const filePath = resolve(root, args.file);
          const symContent = readFileSafe(filePath);
          if (symContent === null) {
            return formatOutput({ status: 'error', error: `File not found: ${args.file}` }, outputFormat);
          }
          const lang = detectLanguage(filePath);
          const sym = extractSymbol(symContent, lang, args.symbol);
          if (!sym) {
            return formatOutput({ status: 'error', error: `Symbol "${args.symbol}" not found in ${args.file}` }, outputFormat);
          }
          const act = args.action || 'replace';
          const nc = args.newContent || '';
          if (act === 'prepend') {
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineStart, newContent: nc, action: 'insert-before' }];
          } else if (act === 'append') {
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineEnd, endLine: sym.lineEnd, newContent: nc, action: 'insert-after' }];
          } else {
            // replace: replace entire symbol body
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineEnd, newContent: nc, action: 'replace' }];
          }
        } else if (args.action && ['insert-before','insert-after','delete'].includes(args.action)) {
          // file+action+startLine+newContent → block-boundary action
          changes = [{ file: args.file, type: 'hashline', startLine: args.startLine, endLine: args.endLine || args.startLine, newContent: args.newContent || '', action: args.action }];
        }
      }

      if (changes.length === 0) {
        return formatOutput({
          status: 'error',
          error: 'No changes parsed from input. Provide blocks, text, diff, whole, or flat syntax (file+content / file+search+replace).',
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
      // File access check for all types (skip whole-file — creates new files)
      if (ch.file && ch.type !== 'whole') {
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
        // Expand lazy markers for preview matching
        const previewSearch = ch.type === 'lazy'
          ? (expandLazyMarkers(content, { search: ch.search, replace: ch.replace })?.search || ch.search)
          : ch.search;
        const match = fuzzyMatch(content, previewSearch);
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
      } else if (ch.type === 'hashline') {
        const content = readFileSafe(ch.file);
        if (content === null) {
          previewResults.push({ file: ch.file, status: 'error', error: 'File not found' });
          continue;
        }
        const lines = content.split('\n');
        const rangeOk = ch.startLine >= 1 && ch.endLine <= lines.length;
        let verified = false;
        let fpMatch = false;
        if (rangeOk && ch.oldContent) {
          const v = verifyLineFingerprint(
            lines.slice(ch.startLine - 1, ch.endLine).join('\n'),
            1, // relative line 1 within the range
            ch.oldContent.split('\n')[0] // verify first line of oldContent
          );
          verified = v.ok;
          fpMatch = v.fuzzy;
        } else if (rangeOk && !ch.oldContent) {
          verified = true; // no oldContent to verify, trust line numbers
        }
        previewResults.push({
          file: ch.file,
          status: rangeOk ? (verified ? 'ready' : 'conflict') : 'error',
          type: 'hashline',
          startLine: ch.startLine,
          endLine: ch.endLine,
          fileLines: lines.length,
          contentVerified: verified,
          fingerprintMatch: fpMatch,
          error: !rangeOk
            ? `Line range ${ch.startLine}-${ch.endLine} exceeds file (${lines.length} lines)`
            : (!verified && ch.oldContent ? `Content mismatch at line ${ch.startLine} — file has drifted` : undefined),
        });
      }
    }

    // Conflict count
    const conflicts = previewResults.filter(r => r.status === 'conflict');

    // ---- Step 3: If dry-run, conditionally auto-apply when safe ----
    if (dryRun) {
      // Auto-apply when:
      //   ✅ No conflicts (match found)
      //   ✅ Single file (or 2 files, all ready)
      //   ✅ NOT explicitly set to dryRun: true (user wants preview)
      // This eliminates the wasteful LLM round-trip (re-call with apply=true)
      const safeForAutoApply = conflicts.length === 0 && !multiFile && args.dryRun !== true;

      if (safeForAutoApply) {
        // ⚡ Auto-apply: skip dry-run, go directly to apply
        // (falls through to Step 5 below — saves ~1 LLM round-trip)
      } else {
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
            : conflicts.length > 0
              ? 'Fix match conflicts first, then re-run.'
              : 'Re-run with apply=true to apply changes.',
        }, outputFormat);
      }
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
        } else if (ch.type === 'hashline') {
          r = applyHashline(ch.file, { startLine: ch.startLine, endLine: ch.endLine, oldContent: ch.oldContent || '', newContent: ch.newContent, action: ch.action }, { undo });
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

// ── Diff rendering ──
//
// ANSI color codes for terminal diff display
const ANSI_RED    = '\x1b[31m';
const ANSI_GREEN  = '\x1b[32m';
const ANSI_CYAN   = '\x1b[36m';
const ANSI_RESET  = '\x1b[0m';

/**
 * Colorize unified diff text with ANSI escape codes.
 *   + lines → green
 *   - lines → red
 *   @@ lines → cyan
 */
function ansiColorizeDiff(diffText) {
  if (!diffText) return '';
  return diffText.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++ ')) return ANSI_GREEN + line + ANSI_RESET;
    if (line.startsWith('-') && !line.startsWith('--- ')) return ANSI_RED + line + ANSI_RESET;
    if (line.startsWith('@@')) return ANSI_CYAN + line + ANSI_RESET;
    return line;
  }).join('\n');
}

/**
 * Map file extension to chroma-compatible code block language tag.
 */
function codeBlockLang(filePath) {
  if (!filePath) return 'diff';
  const map = {
    '.js':'javascript','.jsx':'javascript','.mjs':'javascript','.cjs':'javascript',
    '.ts':'typescript','.tsx':'typescript','.mts':'typescript','.cts':'typescript',
    '.py':'python','.rb':'ruby','.go':'go','.rs':'rust',
    '.java':'java','.swift':'swift','.kt':'kotlin',
    '.c':'c','.cpp':'cpp','.h':'c','.hpp':'cpp',
    '.cs':'csharp','.php':'php','.sh':'bash','.bash':'bash',
    '.yaml':'yaml','.yml':'yaml','.json':'json','.xml':'xml',
    '.md':'markdown','.css':'css','.scss':'scss','.html':'html','.vue':'vue',
    '.svelte':'svelte','.sql':'sql','.r':'r','.pl':'perl',
    '.lua':'lua','.dart':'dart','.zig':'zig',
  };
  return map[extname(filePath).toLowerCase()] || 'diff';
}

/**
 * Wrap diff text for optimal rendering in opencode:
 *
 *   - Uses the file's actual language as code block tag → chroma in TUI highlights the code
 *   - Adds ANSI escape codes for +/−/@@ lines → works when output goes to terminal
 *   - Falls back to 'diff' language tag for shiki (web/desktop view)
 *
 * In opencode TUI: chroma syntax-highlights the code portion (language-based)
 * In opencode run --format default: markdown rendered, language tag helps shiki
 * In raw terminal (opencode run, export, copy-paste): ANSI codes color the diff markers
 */
function wrapDiffBlock(diffText, filePath) {
  const lang = codeBlockLang(filePath);
  const colored = ansiColorizeDiff(diffText);
  return "```" + lang + "\n" + colored + "```";
}

/**
 * Parse block-diff format blocks into normalized hashline changes.
 * BlockDiff: { file, symbol, newContent, action? } — no fuzzy matching needed,
 * uses extractSymbol() for precise AST-aware targeting.
 */
export function parseBlockDiff(blocks, root) {
  const changes = [];
  for (const b of blocks) {
    if (!b.file || !b.symbol || b.newContent === undefined) {
      throw new Error(`Invalid block-diff block for ${b.file || 'unknown'}: need file, symbol, newContent`);
    }
    const filePath = resolve(root, b.file);
    const fc = readFileSafe(filePath);
    if (fc === null) throw new Error(`File not found: ${b.file}`);
    const lang = detectLanguage(filePath);
    const sym = extractSymbol(fc, lang, b.symbol);
    if (!sym) throw new Error(`Symbol "${b.symbol}" not found in ${b.file}`);
    const act = b.action || 'replace';
    const nc = b.newContent;
    if (act === 'prepend') {
      changes.push({ file: b.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineStart, newContent: nc, action: 'insert-before' });
    } else if (act === 'append') {
      changes.push({ file: b.file, type: 'hashline', startLine: sym.lineEnd, endLine: sym.lineEnd, newContent: nc, action: 'insert-after' });
    } else {
      changes.push({ file: b.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineEnd, newContent: nc, action: 'replace' });
    }
  }
  return changes;
}

/**
 * Render diff as pure ANSI-colored plain text (no code block).
 * Use with output: "ansi" for headless/bare-terminal contexts.
 */
function formatAnsiDiff(diffText) {
  return ansiColorizeDiff(diffText);
}

function formatOutput(data, format) {
  if (format === 'json') return data;

  if (format === 'ansi') {
    // Pure ANSI-colored diff (no markdown code blocks, no status text)
    // Works great with opencode run or direct terminal output
    if (data.results) {
      return data.results.filter(r => r.diff).map(r => formatAnsiDiff(r.diff)).join('\n\n');
    }
    return JSON.stringify(data, null, 2);
  }

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
        if (p.type === 'hashline') {
          out.push(`   Lines ${p.startLine}-${p.endLine} (file: ${p.fileLines} lines)`);
          if (p.contentVerified && p.fingerprintMatch) out.push(`   ✅ Content verified (fuzzy fingerprint match)`);
          else if (p.contentVerified) out.push(`   ✅ Content verified (exact match)`);
          else if (!p.oldContent) out.push(`   ⚡ Line range mode (no oldContent verification)`);
        } else {
          out.push(`   Search: ${p.searchLines} lines → Replace: ${p.replaceLines} lines`);
        }
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
        if (r.diff) out.push(`\n${wrapDiffBlock(r.diff, r.file)}`);
      }
    }
    return out.join('\n');
  }

  return JSON.stringify(data, null, 2);
}
