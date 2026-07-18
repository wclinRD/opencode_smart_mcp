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

import { readFileSync, unlinkSync } from 'node:fs';
import { relative, resolve, extname } from 'node:path';
import { extractSymbol, detectLanguage, parseDeclarations } from '../../lib/smart-read.mjs';
import {
  applySearchReplace,
  applySearchReplaceWithLazy,
  applyPartial,
  applyWholeFile,
  applyUnifiedDiff,
  applyAtomic,
  applyHashline,
  applySed,
  applyMultiHunk,
  applyBatch,
  parseSearchReplace,
  parseSearchReplaceText,
  parseUnifiedDiff,
  fuzzyMatch,
  checkBalance,
  checkFileAccess,
  expandLazyMarkers,
  computeLineFingerprints,
  verifyLineFingerprint,
  suggestFormat,
} from '../../lib/apply-engine.mjs';
import { getLspBridge } from '../../lib/lsp-bridge.mjs';
import { extractFunctionAST, isTreeSitterAvailable, isTreeSitterLang } from '../../lib/tree-sitter-edit.mjs';
import { recordEdit, getEditStats, clearTelemetry } from '../../lib/edit-telemetry.mjs';

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
        enum: ['search-replace', 'lazy', 'partial', 'unified-diff', 'whole-file', 'hashline', 'block-diff', 'sed', 'multi-hunk', 'batch'],
        description: 'Input format (default: search-replace). Token efficiency: unified-diff (best, +/- only) > lazy > hashline > partial > search-replace > whole-file. Use hashline for large files (>400 lines) where SEARCH/REPLACE matching is unreliable. sed: single sed expression. multi-hunk: multiple sed/search-replace in one file. batch: glob+sed across multiple files.',
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
      extractFunction: {
        type: 'object',
        description: 'Extract selected lines into a new function (tree-sitter AST-aware). Only works when tree-sitter is available.',
        properties: {
          file: { type: 'string', description: 'Target file path' },
          funcName: { type: 'string', description: 'Name for the extracted function' },
          startLine: { type: 'number', description: 'First line to extract (1-indexed)' },
          endLine: { type: 'number', description: 'Last line to extract (1-indexed, inclusive)' },
          params: { type: 'string', description: 'Function parameters (e.g. "a, b")' },
          insertAt: { type: 'string', enum: ['after', 'before', 'end'], description: 'Where to insert the function definition (default: after enclosing scope)' },
        },
        required: ['file', 'funcName', 'startLine', 'endLine'],
      },
      suggestFormat: {
        type: 'object',
        description: 'Get model-adaptive format recommendation. Returns optimal format + reason + token estimate. No edits performed.',
        properties: {
          file: { type: 'string', description: 'Target file path (optional, improves recommendation)' },
          modelSize: { type: 'string', enum: ['large', 'small', 'micro'], description: 'Model size (default: large)' },
          editLines: { type: 'number', description: 'Number of lines being edited (default: 10)' },
          budget: { type: 'string', enum: ['tight', 'normal', 'generous'], description: 'Context budget (default: normal)' },
        },
      },
      telemetry: {
        type: 'object',
        description: 'Query or manage edit telemetry. command: "stats" (default) or "clear".',
        properties: {
          command: { type: 'string', enum: ['stats', 'clear'], description: 'Telemetry command (default: stats)' },
          format: { type: 'string', description: 'Filter stats by format' },
          lang: { type: 'string', description: 'Filter stats by language' },
          since: { type: 'number', description: 'Filter entries after this timestamp' },
        },
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
      // ── Sed / Multi-hunk / Batch formats ──
      sed: {
        type: 'string',
        description: 'Sed expression (required for format=sed or format=batch). E.g. "s/foo/bar/g", "/pattern/d".',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern (required for format=batch). E.g. "src/**/*.ts".',
      },
      hunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sed: { type: 'string', description: 'Sed expression for this hunk' },
            search: { type: 'string', description: 'Text to search within hunk range' },
            replace: { type: 'string', description: 'Replacement text' },
            line: { type: 'number', description: 'Target line number (1-indexed)' },
            endLine: { type: 'number', description: 'End line (inclusive, 1-indexed)' },
          },
        },
        description: 'Hunks array for format=multi-hunk. Each hunk can have sed or search+replace, optionally restricted to line range.',
      },
      line: {
        type: 'number',
        description: 'Line number (1-indexed). For format=sed: restrict sed to this line (or line+endLine range).',
      },
      endLine: {
        type: 'number',
        description: 'End line (inclusive, 1-indexed). Pair with line for sed range restriction.',
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
        type: 'string',
        description: 'Post-apply validation: undefined=none, "balance"=check braces, "full"=balance+LSP diagnostics (auto-rollback on errors)',
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
      // ⚠️ DEFAULT BEHAVIOR (no dryRun, no apply):
      //   Single-file + no conflicts → auto-apply (saves 1 LLM round-trip)
      //   Multi-file (3+ files)     → preview + requires apply:true
      //   Has conflicts             → preview + requires fix
      // To force preview: pass dryRun:true
      // To explicitly confirm: pass apply:true
      dryRun: {
        type: 'boolean',
        description: 'Preview only — show changes without applying. Without this flag or apply:true, safe single-file edits auto-apply immediately.',
      },
      apply: {
        type: 'boolean',
        description: 'Actually apply changes (required for 3+ files). Without this flag or dryRun:true, safe single-file edits auto-apply immediately.',
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
    // validateLevel replaces old validate boolean — see line 253
    const undo = args.undo !== false;
    const atomic = args.atomic === true;
    const explicitlyDryRun = args.dryRun === true;
    const explicitlyApply = args.apply === true;
    const isDefaultMode = !explicitlyDryRun && !explicitlyApply;
    const outputFormat = args.output || 'text';
    const root = args.root || process.cwd();
    const allowedFiles = args.files;
    const validateLevel = args.validate || 'none';
    // ---- Step 1: Parse input into normalized change list ----
    let changes = [];

    try {
      // ── P4-3: telemetry action ──
      if (args.telemetry) {
        const cmd = args.telemetry.command || 'stats';
        if (cmd === 'stats') {
          const stats = getEditStats(args.telemetry);
          return JSON.stringify({ ok: true, ...stats }, null, 2);
        }
        if (cmd === 'clear') {
          clearTelemetry();
          return JSON.stringify({ ok: true, message: 'Telemetry cleared.' });
        }
        return JSON.stringify({ ok: false, error: `Unknown telemetry command: ${cmd}` });
      }

      // ── P4-2: suggestFormat action (model-adaptive format recommendation) ──
      if (args.suggestFormat) {
        const sf = args.suggestFormat;
        const fp = sf.file ? resolve(root, sf.file) : null;
        let fileLines = 100;
        let lang = '';
        if (fp && existsSync(fp)) {
          const content = readFileSync(fp, 'utf-8');
          fileLines = content.split('\n').length;
          lang = detectLanguage(fp);
        }
        const tsAvail = isTreeSitterAvailable();
        const recommendation = suggestFormat({
          modelSize: sf.modelSize || 'large',
          fileLines,
          editLines: sf.editLines || 10,
          lang,
          treeSitterAvailable: tsAvail,
          budget: sf.budget || 'normal',
        });
        return JSON.stringify({ ok: true, ...recommendation }, null, 2);
      }

      // ── Format auto-detect: infer format from args when not explicitly set ──
      let effectiveFormat = format;

      // ── P4-1: extractFunction action (tree-sitter code action) ──
      if (args.extractFunction) {
        const ef = args.extractFunction;
        const fp = resolve(root, ef.file);
        if (!existsSync(fp)) {
          return JSON.stringify({ ok: false, error: `File not found: ${ef.file}` });
        }
        if (!isTreeSitterAvailable()) {
          return JSON.stringify({ ok: false, error: 'tree-sitter not available. extractFunction requires tree-sitter.' });
        }
        const lang = detectLanguage(fp);
        if (!isTreeSitterLang(lang)) {
          return JSON.stringify({ ok: false, error: `tree-sitter not supported for language: ${lang}` });
        }
        const content = readFileSync(fp, 'utf-8');
        const result = extractFunctionAST(content, lang, ef.startLine, ef.endLine, ef.funcName, {
          params: ef.params,
          insertAt: ef.insertAt,
        });
        if (!result) {
          return JSON.stringify({ ok: false, error: 'extractFunction failed — tree-sitter could not parse the file or line range is invalid.' });
        }
        if (explicitlyDryRun) {
          return JSON.stringify({
            ok: true,
            action: 'extract-function',
            file: ef.file,
            funcName: ef.funcName,
            callLine: result.callLine,
            defLine: result.defLine,
            preview: result.newContent,
          }, null, 2);
        }
        // Apply the change
        try {
          const backupPath = fp + '.apply.bak';
          if (undo) { try { require('node:fs').copyFileSync(fp, backupPath); } catch {} }
          const stagingPath = fp + '.apply.staging';
          require('node:fs').writeFileSync(stagingPath, result.newContent, 'utf-8');
          require('node:fs').renameSync(stagingPath, fp);
          const diff = generateDiffSummary(content, result.newContent, fp);
          return JSON.stringify({
            ok: true,
            status: 'applied',
            action: 'extract-function',
            file: ef.file,
            funcName: ef.funcName,
            callLine: result.callLine,
            defLine: result.defLine,
            diff,
            backup: undo ? backupPath : undefined,
          }, null, 2);
        } catch (e) {
          return JSON.stringify({ ok: false, error: `Write failed: ${e.message}` });
        }
      }

      if (!args.format) {
        // No explicit format → infer from arg shape
        if (args.blocks) {
          // blocks array present → detect block format
          const b0 = args.blocks[0] || {};
          if (b0.symbol && b0.newContent !== undefined) effectiveFormat = 'block-diff';
          else if (b0.search !== undefined && b0.replace !== undefined) effectiveFormat = 'search-replace';
        } else if (args.file && args.symbol && args.newContent !== undefined && !args.search) {
          // Flat symbol-edit: {file, symbol, newContent} without search/replace
          effectiveFormat = '__flat_symbol';
        } else if (args.diff || (args.text && /^@@/.test(args.text))) {
          effectiveFormat = 'unified-diff';
        } else if (args.changes) {
          effectiveFormat = 'hashline';
        } else if (args.whole) {
          effectiveFormat = 'whole-file';
        } else if (args.sed && (args.file || args.glob)) {
          effectiveFormat = args.glob ? 'batch' : 'sed';
        }
      }

      if (effectiveFormat === 'block-diff' && args.blocks) {
        changes = parseBlockDiff(args.blocks, root);
      } else if (effectiveFormat === '__flat_symbol' || (effectiveFormat === 'block-diff' && !args.blocks && args.file && args.symbol)) {
        // Auto-route to flat symbol-edit path (skip block-diff parsing)
        // This handles: {file, symbol, newContent} without explicit format
        // Also handles: format=block-diff but no blocks array (symbol is on flat args)
      } else if (effectiveFormat === 'search-replace' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'search-replace' }));
      } else if (effectiveFormat === 'lazy' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'lazy' }));
      } else if (effectiveFormat === 'partial' && args.blocks) {
        changes = parseSearchReplace(args.blocks).map(b => ({ ...b, type: 'partial' }));
      } else if (effectiveFormat === 'search-replace' && args.text) {
        changes = parseSearchReplaceText(args.text).map(b => ({ ...b, type: 'search-replace' }));
      } else if ((effectiveFormat === 'lazy' || effectiveFormat === 'partial') && args.text) {
        changes = parseSearchReplaceText(args.text).map(b => ({ ...b, type: effectiveFormat }));
      } else if (effectiveFormat === 'unified-diff') {
        const diffInput = args.diff || args.text || '';
        const parsed = parseUnifiedDiff(diffInput);
        changes = parsed.map(f => ({ file: f.file, type: 'diff', hunks: f.hunks }));
      } else if (effectiveFormat === 'hashline' && args.changes) {
        changes = args.changes.map(c => ({ ...c, type: 'hashline' }));
      } else if (effectiveFormat === 'whole-file' && args.whole) {
        changes = [{ ...args.whole, type: 'whole' }];
      } else if (effectiveFormat === 'sed' && args.file && args.sed) {
        changes = [{ file: args.file, sed: args.sed, line: args.line, endLine: args.endLine, type: 'sed' }];
      } else if (effectiveFormat === 'multi-hunk') {
        changes = [{ file: args.file, hunks: args.hunks, type: 'multi-hunk' }];
      } else if (effectiveFormat === 'batch') {
        changes = [{ glob: args.glob, sed: args.sed, line: args.line, endLine: args.endLine, root, type: 'batch' }];
      } else if (args.text) {
        // Auto-detect: try SEARCH/REPLACE blocks first, then unified diff
        const sr = parseSearchReplaceText(args.text);
        if (sr.length > 0) {
          // Check if any block uses lazy markers (// ... existing code ...)
          const lazyRe = /^\s*(\/\/|#|--|;|%|<!--|\/\*)\s*(\.\.\.\s*)?(existing\s+code\s*)?(\.\.\.\s*)?(\*\/|-->)?\s*$/im;
          const hasLazy = sr.some(b => lazyRe.test(b.search) || lazyRe.test(b.replace));
          changes = sr.map(b => ({ ...b, type: hasLazy ? 'lazy' : 'search-replace' }));
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
          // Uses shared validateSymbolBody for braces balance + size guard
          const filePath = resolve(root, args.file);
          const symContent = readFileSafe(filePath);
          if (symContent === null) {
            return formatOutput({ status: 'error', error: `File not found: ${args.file}` }, outputFormat);
          }
          const lang = detectLanguage(filePath);
          const sym = extractSymbol(symContent, lang, args.symbol);
          if (!sym) {
            const suggestions = suggestSimilarSymbols(symContent, lang, args.symbol);
            return formatOutput({ status: 'error', error: `Symbol "${args.symbol}" not found in ${args.file}.${suggestions}` }, outputFormat);
          }
          // 🛡️ Apply same validation as parseBlockDiff (braces balance + size guard)
          let warning;
          try {
            validateSymbolBody(sym, symContent, lang, args.symbol, false);
          } catch (e) {
            return formatOutput({ status: 'error', error: e.message }, outputFormat);
          }
          const act = args.action || 'replace';
          const nc = args.newContent || '';
          if (act === 'prepend') {
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineStart, newContent: nc, action: 'insert-before' }];
          } else if (act === 'append') {
            // Ensure trailing newline so appended content doesn't merge with last line
            const safeNc = nc && !nc.endsWith('\n') ? nc + '\n' : nc;
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineEnd, endLine: sym.lineEnd, newContent: safeNc, action: 'insert-after' }];
          } else {
            // replace: replace entire symbol body (with oldContent for verification)
            const lines = symContent.split('\n');
            const actualBody = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
            changes = [{ file: args.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineEnd, oldContent: actualBody, newContent: nc, action: 'replace' }];
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
      // Add format-specific hints to help LLM self-correct
      const hints = [];
      if (effectiveFormat === 'block-diff' || effectiveFormat === '__flat_symbol') {
        // block-diff failed — often because target is not a top-level declaration
        // (e.g. object property method, getter/setter, nested function)
        const isNotSymbol = e.message && (e.message.includes('not found') || e.message.includes('unbalanced'));
        if (isNotSymbol) {
          hints.push('Target is not a top-level symbol. Use search-replace or hashline format instead:\n  search-replace: {file:"path", search:"existing code block", replace:"new code"}\n  hashline: {file:"path", startLine:N, endLine:N, newContent:"code"}');
        } else {
          hints.push('block-diff format: {file:"path", symbol:"name", newContent:"code"}');
        }
      } else if (effectiveFormat === 'search-replace' || effectiveFormat === 'lazy' || effectiveFormat === 'partial') {
        hints.push('search-replace format: {file:"path", search:"old code", replace:"new code"}');
      } else if (effectiveFormat === 'hashline') {
        hints.push('hashline format: {file:"path", startLine:N, endLine:N, newContent:"code"}');
      } else if (effectiveFormat === 'unified-diff') {
        hints.push('unified-diff: use ---/+++ file headers with @@ hunk markers');
      }
      // Only add generic hint if error doesn't already have 💡 guidance
      const alreadyHasGuidance = e.message && e.message.includes('💡');
      const hintStr = (hints.length > 0 && !alreadyHasGuidance) ? `\n  Hint: ${hints[0]}` : '';
      return formatOutput({ status: 'error', error: `Parse error: ${e.message}${hintStr}` }, outputFormat);
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
        const balance = (validateLevel === 'balance' || validateLevel === 'full') ? checkBalance(content) : null;

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
          ...(ch.warning ? { warning: ch.warning } : {}),
          error: !rangeOk
            ? `Line range ${ch.startLine}-${ch.endLine} exceeds file (${lines.length} lines)`
            : (!verified && ch.oldContent ? `Content mismatch at line ${ch.startLine} — file has drifted` : undefined),
        });
      }
    }

    // Conflict count
    const conflicts = previewResults.filter(r => r.status === 'conflict');

    // ---- Step 3: Conditionally auto-apply when safe (saves ~1 LLM round-trip) ----
    // In default mode (no explicit dryRun/apply flags), safe single-file edits
    // are applied immediately without a preview round-trip.
    if (!explicitlyApply) {
      // Auto-apply when:
      //   ✅ Default mode (no explicit dryRun:true or apply:true)
      //   ✅ No conflicts (all matches found)
      //   ✅ Single file (or 2 files)
      const safeForAutoApply = isDefaultMode && conflicts.length === 0 && !multiFile;

      if (safeForAutoApply) {
        // ⚡ Auto-apply: skip preview, go directly to apply
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
            try { unlinkSync(r.backup); } catch { /* */ }
          }
        }
      }
      // ── P0-2: Post-apply LSP diagnostics validation ──
      if (validateLevel === 'full' && allSucceeded) {
        const diagResult = await validatePostApply(results.filter(r => r.status === 'applied'), root);
        if (diagResult.error) return formatOutput({ status: 'error', ...diagResult }, outputFormat);
      }

      // ── P4-3: Record telemetry for atomic apply ──
      const _telemStart = Date.now();
      for (const ch of changes) {
        recordEdit({
          format: ch.type || format,
          lang: detectLanguage(resolve(root, ch.file || '')),
          fileLines: 0,
          editLines: (ch.search || ch.newContent || '').split('\n').length,
          success: allSucceeded,
          retries: 0,
          durationMs: Date.now() - _telemStart,
        });
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
        } else if (ch.type === 'sed') {
          r = applySed(ch.file, ch.sed, { undo });
        } else if (ch.type === 'multi-hunk') {
          r = applyMultiHunk(ch.file, ch.hunks, { undo });
        } else if (ch.type === 'batch') {
          r = applyBatch(ch.glob, ch.sed, { root: ch.root, undo });
        }
        appResults.push(r || { status: 'error', file: ch.file, error: 'Unknown type' });

        // 🛡️ Auto-retry on conflict
        if (r && r.status === 'conflict' && !r._retried) {
          const retryR = retryApply(ch, r, { undo });
          if (retryR && retryR.status === 'applied') {
            appResults[appResults.length - 1] = { ...retryR, _retried: true, _originalError: r.error };
          }
        }
      }
      // ── P0-2: Post-apply LSP diagnostics validation ──
      if (validateLevel === 'full') {
        const diagResult = await validatePostApply(appResults.filter(r => r.status === 'applied'), root);
        if (diagResult.error) return formatOutput({ status: 'error', ...diagResult }, outputFormat);
      }

      // ── P4-3: Record telemetry for sequential apply ──
      for (const r of appResults) {
        recordEdit({
          format: r.type || format,
          lang: detectLanguage(resolve(root, r.file || '')),
          fileLines: 0,
          editLines: (r.search || r.newContent || '').split('\n').length,
          success: r.status === 'applied',
          retries: r.retries || 0,
          durationMs: r.durationMs || 0,
        });
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

// ── P0-2: Post-apply LSP diagnostics validation + auto-rollback + auto-fix ──
// For each applied file, query LSP diagnostics. If errors found:
//   1. Try auto-fix via LSP code_action (max 3 rounds)
//   2. If still errors after fix attempts → rollback from .apply.bak
export async function validatePostApply(appliedResults, root, opts = {}) {
  const maxFixRounds = opts.maxFixRounds ?? 3;
  const extMap = { '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.php': 'php' };
  let bridge = null;
  try {
    bridge = getLspBridge(root);
  } catch { return { ok: true }; } // LSP not available — skip

  for (const r of appliedResults) {
    if (!r.file || !extMap[r.file.match(/\.[^.]+$/)?.[0]]) continue;

    // ── Phase 1: Auto-fix loop ──
    let fixed = false;
    for (let round = 0; round < maxFixRounds; round++) {
      let diags;
      try {
        diags = await bridge.getDiagnostics(r.file);
      } catch { break; } // LSP query failed
      const errors = (diags?.diagnostics || []).filter(d => d.severity === 1);
      if (errors.length === 0) { fixed = true; break; } // All errors resolved


      // Try to get code actions for the first error
      const errDiag = errors[0];
      // Convert LSP range format → normalized format for getCodeActions
      const normDiag = {
        line: (errDiag.range?.start?.line ?? 0) + 1,
        col: errDiag.range?.start?.character ?? 0,
        endLine: (errDiag.range?.end?.line ?? errDiag.range?.start?.line ?? 0) + 1,
        endCol: errDiag.range?.end?.character ?? (errDiag.range?.start?.character ?? 0) + 1,
        message: errDiag.message || '',
        severity: 'error',
        source: errDiag.source,
        code: errDiag.code,
      };
      let actions;
      try {
        actions = await bridge.getCodeActions(
          r.file,
          normDiag.line,
          normDiag.col,
          [normDiag]
        );
      } catch { break; } // codeAction not supported
      if (!actions?.actions?.length) break; // No quick fixes available

      // Prefer isPreferred quick fixes
      const quickFix = actions.actions.find(a => a.isPreferred) || actions.actions[0];
      if (!quickFix) break;

      // Execute the code action
      let execResult;
      try {
        execResult = await bridge.executeCodeAction(quickFix);
      } catch { break; }

      if (execResult?.error) break;

      // Apply workspace edit if present
      if (execResult?.edit) {
        try {
          await bridge.applyWorkspaceEdit(execResult.edit);
        } catch { break; }
      }
    }

    // ── Phase 2: Final diagnostics check ──
    let finalDiags;
    try {
      finalDiags = await bridge.getDiagnostics(r.file);
    } catch { continue; }
    const remainingErrors = (finalDiags?.diagnostics || []).filter(d => d.severity === 1);
    if (remainingErrors.length > 0) {
      // Still errors after fix attempts — rollback
      const bakPath = r.file + '.apply.bak';
      try {
        const { renameSync } = await import('node:fs');
        renameSync(bakPath, r.file);
      } catch { /* backup not found — skip rollback */ }
      const errMsg = remainingErrors.map(e => `  Line ${e.range?.start?.line ?? '?'}: ${e.message}`).join('\n');
      return {
        ok: false,
        error: `LSP diagnostics found ${remainingErrors.length} error(s) after apply (auto-fix attempted ${maxFixRounds} rounds) — auto-rolled back:\n${errMsg}`,
        diagnostics: remainingErrors,
        file: r.file,
      };
    }
  }
  return { ok: true };
}


function readFileSafe(filePath) {
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

/**
 * 🛡️ Auto-retry: when an apply format returns conflict, try an alternative
 * strategy before giving up.
 *
 * Hasline conflicts (oldContent mismatch / file shifted):
 *   Re-read file, search for oldContent textually, recalculate line range.
 *
 * Search-replace conflicts (fuzzy match failed):
 *   Try hashline with direct content search (more precise).
 */
function retryApply(ch, originalResult, opts) {
  const { undo } = opts;

  // Retry hashline: oldContent may have shifted due to earlier batch edits
  if (ch.type === 'hashline' && ch.oldContent && ch.startLine && ch.endLine) {
    try {
      const fc = readFileSync(ch.file, 'utf-8');
      const lines = fc.split('\n');
      const oldLines = ch.oldContent.split('\n');

      // Only retry if oldContent is reasonable (<50% of file).
      // Larger suggests extractSymbol returned wrong lineEnd.
      if (oldLines.length > lines.length * 0.5 || lines.length < 50) return null;

      // Find oldContent in current file content
      const idx = fc.indexOf(ch.oldContent);
      if (idx !== -1) {
        const foundStart = fc.substring(0, idx).split('\n').length;
        const foundEnd = foundStart + oldLines.length - 1;

        // Verify: startLine shouldn't shift >20 lines
        if (Math.abs(foundStart - ch.startLine) > 20) return null;

        const newR = applyHashline(ch.file, {
          startLine: foundStart, endLine: foundEnd,
          oldContent: ch.oldContent,
          newContent: ch.newContent,
          action: ch.action || 'replace',
        }, { undo });
        if (newR.status === 'applied') return newR;
      }
    } catch { /* fall through */ }
  }

  // Retry search-replace/partial/lazy: try hashline with direct content match
  if (['search-replace', 'partial', 'lazy'].includes(ch.type) && ch.search && ch.replace) {
    try {
      const fc = readFileSync(ch.file, 'utf-8');
      const idx = fc.indexOf(ch.search);
      if (idx !== -1) {
        const lineNum = fc.substring(0, idx).split('\n').length;
        const endLine = lineNum + ch.search.split('\n').length - 1;
        const newR = applyHashline(ch.file, {
          startLine: lineNum, endLine,
          oldContent: ch.search,
          newContent: ch.replace,
          action: 'replace',
        }, { undo });
        if (newR.status === 'applied') return newR;
      }
    } catch { /* fall through */ }
  }

  return null;
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
const ANSI_RED      = '\x1b[31m';
const ANSI_GREEN    = '\x1b[32m';
const ANSI_CYAN     = '\x1b[36m';
const ANSI_BOLD     = '\x1b[1m';
const ANSI_DIM      = '\x1b[2m';
const ANSI_RESET    = '\x1b[0m';
const ANSI_BLACK    = '\x1b[30m';
const ANSI_BG_RED   = '\x1b[41m';
const ANSI_BG_GREEN = '\x1b[42m';

/**
 * Colorize unified diff text with enhanced ANSI escape codes.
 *   ---/+++ file headers → bold red/green
 *   + lines → green
 *   - lines → red
 *   @@ lines → bold cyan
 *   context (space-prefixed) → dim
 */
function ansiColorizeDiff(diffText) {
  if (!diffText) return '';
  return diffText.split('\n').map(line => {
    if (line.startsWith('--- ')) return ANSI_BOLD + ANSI_RED + line + ANSI_RESET;
    if (line.startsWith('+++ ')) return ANSI_BOLD + ANSI_GREEN + line + ANSI_RESET;
    if (line.startsWith('@@'))   return ANSI_BOLD + ANSI_CYAN + line + ANSI_RESET;
    if (line.startsWith('+') && !line.startsWith('+++ ')) return ANSI_GREEN + line + ANSI_RESET;
    if (line.startsWith('-') && !line.startsWith('--- ')) return ANSI_RED + line + ANSI_RESET;
    if (line.startsWith(' '))    return ANSI_DIM + line + ANSI_RESET;
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
/**
 * Suggest similar symbol names when exact match fails.
 * Returns a formatted string of available symbols or empty string if none.
 */
function suggestSimilarSymbols(content, lang, name) {
  const decls = parseDeclarations(content, lang);
  if (decls.length === 0) return '';
  const names = decls.map(d => d.name);
  const lower = name.toLowerCase();

  // First: try similar name matching
  const candidates = names.filter(n => {
    const nl = n.toLowerCase();
    return nl.startsWith(lower) || lower.startsWith(nl) ||
           nl.includes(lower) || lower.includes(nl);
  });
  if (candidates.length > 0) {
    const display = candidates.slice(0, 8).join(', ');
    const extra = candidates.length > 8 ? ` ... (${names.length} total)` : '';
    return `\n  Did you mean: ${display}${extra}`;
  }

  // Fallback: no similar names — list all + suggest alternative formats
  const display = names.slice(0, 12).join(', ');
  const extra = names.length > 12 ? ` ... (${names.length} total)` : '';
  // Detect if name looks like a comment (contains spaces, common header patterns)
  const looksLikeComment = name.includes(' ') || /^(?:section|header|part|region|area)/i.test(name);
  const formatHint = looksLikeComment
    ? `\n  \uD83D\uDCA1 "${name}" looks like a section header, not a code symbol.\n     To replace a comment section, use search-replace:\n       search: "// ${name}"  (or the actual comment text)\n       replace: <your new code>`
    : `\n  \uD83D\uDCA1 block-diff only accepts code symbols (function/class/const/let/var).\n     To insert new code, use search-replace or hashline format.`;
  return `${formatHint}\n  Available symbols: ${display}${extra}`;
}

// ── Shared: validate symbol body range (braces balance + size guard) ──
// Used by both parseBlockDiff and flat shortcut path.
// Returns { ok, actualBody, sym (mutated), warning? } or throws on unrecoverable error.
function validateSymbolBody(sym, fc, lang, symbolName, symbolAutoResolved) {
  const lines = fc.split('\n');
  const totalLines = lines.length;
  let actualBody = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
  let warning = symbolAutoResolved ? `Symbol "${symbolName}" auto-resolved to "${sym.name}"` : undefined;

  // Phase 1: Braces balance check (skip strings/comments for accuracy)
  const balance = checkBalance(actualBody);

  if (!balance.balanced) {
    // Braces unbalanced — extractSymbol returned wrong lineEnd.
    // Multi-strategy correction to find the actual closing brace.
    let corrected = false;

    // Strategy 0: Walk backwards from lineEnd to find where braces actually close.
    // Handles: arrow functions inside class, callbacks, nested expressions.
    for (let tryEnd = sym.lineEnd - 1; tryEnd >= sym.lineStart && tryEnd >= sym.lineEnd - 30; tryEnd--) {
      const tryBody = lines.slice(sym.lineStart - 1, tryEnd).join('\n');
      const tryBalance = checkBalance(tryBody);
      if (tryBalance.balanced && tryBody.trimEnd().length > 0) {
        sym.lineEnd = tryEnd;
        sym.body = tryBody;
        actualBody = tryBody;
        corrected = true;
        break;
      }
    }

    // Strategy 1: Walk forwards from lineEnd to find where braces close.
    // Handles: extractSymbol under-estimated the end (e.g. multi-line return).
    if (!corrected) {
      for (let tryEnd = sym.lineEnd + 1; tryEnd <= Math.min(lines.length, sym.lineEnd + 50); tryEnd++) {
        const tryBody = lines.slice(sym.lineStart - 1, tryEnd).join('\n');
        const tryBalance = checkBalance(tryBody);
        if (tryBalance.balanced && tryBody.trimEnd().length > 0) {
          sym.lineEnd = tryEnd;
          sym.body = tryBody;
          actualBody = tryBody;
          corrected = true;
          break;
        }
      }
    }

    // Strategy 2: Next declaration boundary (existing logic).
    if (!corrected) {
      try {
        const allDecls = parseDeclarations(fc, lang);
        const myIdx = allDecls.findIndex(d => d.name === sym.name && d.lineStart === sym.lineStart);
        if (myIdx !== -1 && myIdx + 1 < allDecls.length) {
          const next = allDecls[myIdx + 1];
          if (next.lineStart > sym.lineStart) {
            sym.lineEnd = next.lineStart - 1;
            const correctedBody = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
            const correctedBalance = checkBalance(correctedBody);
            if (correctedBalance.balanced && correctedBody.trimEnd().length > 0) {
              sym.body = correctedBody;
              actualBody = correctedBody;
              corrected = true;
            }
          }
        }
      } catch { /* fall through to error */ }
    }

    if (!corrected) {
      throw new Error(
        `Symbol "${symbolName}" has unbalanced braces ` +
        `(expected "${balance.expected || '?'}" but found "${balance.found || '?'}" at position ${balance.position ?? '?'}). ` +
        `Use search-replace or hashline format instead.`
      );
    }
  }

  // Phase 2: Size guard — if body covers >50% of file, try next-declaration cap.
  if (sym.lineEnd - sym.lineStart > Math.max(5, totalLines * 0.5)) {
    try {
      const allDecls = parseDeclarations(fc, lang);
      const myIdx = allDecls.findIndex(d => d.name === sym.name && d.lineStart === sym.lineStart);
      if (myIdx !== -1 && myIdx + 1 < allDecls.length) {
        const next = allDecls[myIdx + 1];
        const safeEnd = Math.min(sym.lineEnd, next.lineStart - 1);
        if (safeEnd > sym.lineStart) {
          const cappedBody = lines.slice(sym.lineStart - 1, safeEnd).join('\n');
          const cappedBalance = checkBalance(cappedBody);
          if (cappedBalance.balanced && cappedBody.trimEnd().length > 0) {
            sym.lineEnd = safeEnd;
            sym.body = cappedBody;
            actualBody = cappedBody;
          }
        }
      }
    } catch { /* size guard failed — applyHashline oldContent check is last resort */ }
  }

  return { ok: true, actualBody, sym, warning };
}

export function parseBlockDiff(blocks, root) {
  const changes = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // ── Field validation ──
    const missing = [];
    if (!b.file) missing.push('file');
    if (!b.symbol) missing.push('symbol');
    if (b.newContent === undefined) missing.push('newContent');
    if (missing.length > 0) {
      throw new Error(
        `Block[${i}]: missing required fields: ${missing.join(', ')}. ` +
        `block-diff format needs {file, symbol, newContent}. ` +
        `Received: {file:${b.file ? `"${b.file}"` : 'undefined'}, ` +
        `symbol:${b.symbol ? `"${b.symbol}"` : 'undefined'}, ` +
        `newContent:${b.newContent === undefined ? 'undefined' : `${typeof b.newContent}(${String(b.newContent).length} chars)`}}`
      );
    }

    const filePath = resolve(root, b.file);
    const fc = readFileSafe(filePath);
    if (fc === null) throw new Error(`File not found: ${b.file}`);
    const lang = detectLanguage(filePath);
    let sym = extractSymbol(fc, lang, b.symbol);
    let symbolAutoResolved = false;
    if (!sym) {
      // Auto fuzzy-resolve: try to match similar symbol name
      const decls = parseDeclarations(fc, lang);
      const lower = b.symbol.toLowerCase();
      let bestMatch = null;
      let bestScore = 0;
      for (const d of decls) {
        const nl = d.name.toLowerCase();
        // Score: exact > startsWith > includes > subsequence
        let score = 0;
        if (nl === lower) score = 100;
        else if (nl.startsWith(lower) || lower.startsWith(nl)) score = 80;
        else if (nl.includes(lower) || lower.includes(nl)) score = 60;
        else {
          // subsequence match
          let si = 0;
          for (let ci = 0; ci < nl.length && si < lower.length; ci++) {
            if (nl[ci] === lower[si]) si++;
          }
          score = si === lower.length ? 30 + (si / nl.length) * 20 : 0;
        }
        // Prefer higher score, then shorter name (more precise match)
        if (score > bestScore || (score === bestScore && bestMatch && d.name.length < bestMatch.name.length)) {
          bestScore = score; bestMatch = d;
        }
      }
      // Threshold 80: requires startsWith/includes match (not just subsequence)
      if (bestMatch && bestScore >= 80) {
        sym = extractSymbol(fc, lang, bestMatch.name);
        if (sym) symbolAutoResolved = true;
      }
      if (!sym) {
        const suggestions = suggestSimilarSymbols(fc, lang, b.symbol);
        // Provide actionable guidance based on what was attempted
        const hint = suggestions.includes('search-replace')
          ? ''  // already has format suggestion
          : `\n  💡 Use search-replace or hashline format for non-symbol edits.`;
        throw new Error(`Symbol "${b.symbol}" not found in ${b.file}.${suggestions}${hint}`);
      }
    }

    // 🛡️ Shared body range validation (braces balance + size guard)
    const { actualBody, warning } = validateSymbolBody(sym, fc, lang, b.symbol, symbolAutoResolved);

    const act = b.action || 'replace';
    const nc = b.newContent;
    const warn = warning ? { warning } : {};
    if (act === 'prepend') {
      changes.push({ ...warn, file: b.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineStart, newContent: nc, action: 'insert-before' });
    } else if (act === 'append') {
      // Ensure trailing newline so appended content doesn't merge with last line
      const safeNc = nc && !nc.endsWith('\n') ? nc + '\n' : nc;
      changes.push({ ...warn, file: b.file, type: 'hashline', startLine: sym.lineEnd, endLine: sym.lineEnd, newContent: safeNc, action: 'insert-after' });
    } else {
      // ⚠️ NOTE: oldContent verification in applyHashline does NOT catch
      // wrong lineEnd here because oldContent was sliced from the SAME
      // (potentially wrong) range. Braces balance validation above is
      // the real protection.
      changes.push({ ...warn, file: b.file, type: 'hashline', startLine: sym.lineStart, endLine: sym.lineEnd, oldContent: actualBody, newContent: nc, action: 'replace' });
    }
  }
  return changes;
}

/**
 * Render diff as pure ANSI-colored plain text (no code block).
 * Use with output: "ansi" for headless/bare-terminal contexts.
 */
function formatAnsiDiff(diffText) {
  return ansiColorizeDiffBg(diffText);
}

/**
 * Colorize diff with background colors instead of text colors.
 *   + lines → green background
 *   - lines → red background
 *   @@ headers → bold cyan
 *   context → dim
 */
function ansiColorizeDiffBg(diffText) {
  if (!diffText) return '';
  return diffText.split('\n').map(line => {
    if (line.startsWith('--- ')) return ANSI_BOLD + ANSI_RED + line + ANSI_RESET;
    if (line.startsWith('+++ ')) return ANSI_BOLD + ANSI_GREEN + line + ANSI_RESET;
    if (line.startsWith('@@'))   return ANSI_BOLD + ANSI_CYAN + line + ANSI_RESET;
    if (line.startsWith('+') && !line.startsWith('+++ ')) return ANSI_BG_GREEN + ANSI_BLACK + line + ANSI_RESET;
    if (line.startsWith('-') && !line.startsWith('--- ')) return ANSI_BG_RED + ANSI_BLACK + line + ANSI_RESET;
    if (line.startsWith(' '))    return ANSI_DIM + line + ANSI_RESET;
    return line;
  }).join('\n');
}

/**
 * Count additions (+ lines) and deletions (- lines) from unified diff text.
 * Ignores ---/+++ file headers.
 */
function countDiffStats(diffText) {
  if (!diffText) return { additions: 0, deletions: 0 };
  let additions = 0, deletions = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++ ')) additions++;
    else if (line.startsWith('-') && !line.startsWith('--- ')) deletions++;
  }
  return { additions, deletions };
}

/**
 * Render a 5-block visual bar showing additions vs deletions ratio.
 * Green blocks = additions, red blocks = deletions.
 * Mirrors opencode TUI's DiffChanges bars variant.
 * Works in any terminal (uses ANSI colors only).
 */
function textBars(additions, deletions) {
  const total = additions + deletions;
  if (total === 0) return '';
  const a = Math.round((additions / total) * 5);
  const d = 5 - a;
  return '[' +
    ANSI_GREEN + '█'.repeat(Math.max(0, a)) + ANSI_RESET +
    ANSI_RED + '█'.repeat(Math.max(0, d)) + ANSI_RESET +
  ']';
}

function formatOutput(data, format) {
  if (format === 'json') return data;

  // ── ANSI output: pure colored diff, minimal status ──
  if (format === 'ansi') {
    if (data.results) {
      // Post-apply: colored diffs with summary
      let totalAdd = 0, totalDel = 0;
      const diffs = data.results.filter(r => r.diff).map(r => {
        const s = countDiffStats(r.diff);
        totalAdd += s.additions;
        totalDel += s.deletions;
        return formatAnsiDiff(r.diff);
      });
      const summaryBar = textBars(totalAdd, totalDel);
      const summary = ANSI_BOLD + `Applied ${data.summary?.applied || 0}/${data.totalChanges || 0} \u2014 +${totalAdd}  -${totalDel}  ` + summaryBar + ANSI_RESET;
      return summary + '\n' + diffs.join('\n\n');
    }
    if (data.dryRun) {
      // Dry-run: colored summary (no markdown, just ANSI)
      const out = [];
      const header = ANSI_BOLD + '🔍 DRY RUN' + ANSI_RESET;
      out.push(header + ' \u2014 ' + data.totalChanges + ' change(s)');
      if (data.conflicts > 0) {
        out.push(ANSI_RED + '\u26A0 ' + data.conflicts + ' file(s) with match conflicts:' + ANSI_RESET);
        for (const cf of data.conflictFiles) out.push(ANSI_RED + '  \u274C ' + cf + ANSI_RESET);
      }
      for (const p of data.preview) {
        if (p.status === 'ready') {
          const sl = p.searchLines || 0;
          const rl = p.replaceLines || 0;
          const netAdd = Math.max(0, rl - sl);
          const netDel = Math.max(0, sl - rl);
          const bar = textBars(netAdd, netDel);
          out.push(ANSI_GREEN + '\u2705' + ANSI_RESET + ' ' + p.file + '  ' +
            ANSI_GREEN + '+' + netAdd + ANSI_RESET + ' ' +
            ANSI_RED + '-' + netDel + ANSI_RESET + ' ' + bar);
          if (p.type === 'hashline') {
            out.push(ANSI_DIM + '  Lines ' + p.startLine + '-' + p.endLine + ANSI_RESET);
          } else {
            out.push(ANSI_DIM + '  ~' + sl + ' \u2192 ~' + rl + ' lines' + ANSI_RESET);
          }
        } else {
          out.push(ANSI_RED + '\u274C ' + p.file + ANSI_RESET);
          out.push(ANSI_RED + '  Cannot find search block' + ANSI_RESET);
        }
      }
      out.push(ANSI_DIM + (data.hint || 'Run with apply=true to apply.') + ANSI_RESET);
      return out.join('\n');
    }
    if (data.status === 'safety_gate') return ANSI_BOLD + '\u26A0\uFE0F Safety Gate: ' + data.error + ANSI_RESET;
    if (data.status === 'error') return ANSI_RED + '\u274C Error: ' + data.error + ANSI_RESET;
    return JSON.stringify(data, null, 2);
  }

  // ── Diff output: raw unified diff text (no ANSI, no markdown) ──
  if (format === 'diff') {
    if (data.results) {
      return data.results.filter(r => r.diff).map(r => r.diff).join('\n');
    }
    if (data.dryRun) {
      const out = [];
      out.push('# DRY RUN \u2014 ' + data.totalChanges + ' change(s)');
      for (const p of data.preview) {
        const status = p.status === 'ready' ? 'ready' : 'CONFLICT';
        out.push('# ' + status + ': ' + p.file);
        if (p.type === 'hashline') {
          out.push('#   Lines ' + p.startLine + '-' + p.endLine);
        } else if (p.searchLines !== undefined) {
          out.push('#   ~' + p.searchLines + ' \u2192 ~' + p.replaceLines + ' lines');
        }
      }
      out.push('# ' + (data.hint || 'Run with apply=true to apply.'));
      return out.join('\n');
    }
    if (data.status === 'error') return '# Error: ' + data.error;
    if (data.status === 'safety_gate') return '# ⚠ Safety Gate: ' + data.error;
    return JSON.stringify(data, null, 2);
  }

  // ── Text output: rich status with markdown-wrapped colored diffs ──
  const out = [];
  if (data.status === 'error') {
    out.push(`\u274C Error: ${data.error}`);
    return out.join('\n');
  }

  if (data.dryRun) {
    // Compute summary stats
    let totalAdd = 0, totalDel = 0;
    for (const p of data.preview) {
      if (p.status === 'ready') {
        const sl = p.searchLines || 0;
        const rl = p.replaceLines || 0;
        totalAdd += Math.max(0, rl - sl);
        totalDel += Math.max(0, sl - rl);
      }
    }
    const summaryBar = textBars(totalAdd, totalDel);
    out.push(`\uD83D\uDD0D DRY RUN \u2014 ${data.totalChanges} file(s) changed, +${totalAdd}  -${totalDel}  ${summaryBar}`);
    out.push('='.repeat(50));
    if (data.multiFileWarning) out.push(`\n\u26A0\uFE0F  ${data.multiFileWarning}`);
    if (data.conflicts > 0) out.push(`\n\u26A0\uFE0F  ${data.conflicts} file(s) with match conflicts:`);
    for (const cf of data.conflictFiles) out.push(`  \u274C ${cf}`);
    out.push('');
    for (const p of data.preview) {
      const icon = p.status === 'ready' ? '\u2705' : '\u274C';
      const matchInfo = p.matchLevel ? ` (fuzzy L${p.matchLevel})` : '';

      if (p.status === 'ready') {
        const sl = p.searchLines || 0;
        const rl = p.replaceLines || 0;
        const netAdd = Math.max(0, rl - sl);
        const netDel = Math.max(0, sl - rl);
        const bar = textBars(netAdd, netDel);
        out.push(`${icon} ${p.file}${matchInfo}  +${netAdd}  -${netDel}  ${bar}`);

        if (p.type === 'hashline') {
          out.push(`   Lines ${p.startLine}-${p.endLine} (file: ${p.fileLines} lines)`);
          if (p.contentVerified && p.fingerprintMatch) out.push(`   \u2705 Content verified (fuzzy fingerprint match)`);
          else if (p.contentVerified) out.push(`   \u2705 Content verified (exact match)`);
          else if (!p.oldContent) out.push(`   \u26A1 Line range mode (no oldContent verification)`);
        } else {
          out.push(`   ~${sl} \u2192 ~${rl} lines`);
        }
        if (p.matchLevel > 2) out.push(`   \u26A1 Fuzzy match level ${p.matchLevel}`);
        if (p.balanced === false) out.push(`   \u26A0\uFE0F  Brace balance issue detected`);
        if (p.warning) out.push(`   \u2139\uFE0F  ${p.warning}`);
      } else if (p.status === 'conflict') {
        out.push(`${icon} ${p.file}${matchInfo}`);
        out.push(`   \u274C Cannot find search block`);
      }
    }
    out.push(`\n\uD83D\uDCA1 ${data.hint || 'Run with apply=true to apply.'}`);
    return out.join('\n');
  }

  if (data.status === 'safety_gate') {
    out.push(`\u26A0\uFE0F Safety Gate: ${data.error}`);
    return out.join('\n');
  }

  if (data.status === 'applied' || data.status === 'partial') {
    // Compute summary from actual diffs
    let totalAdd = 0, totalDel = 0;
    const perFile = (data.results || []).map(r => {
      if (r.diff) {
        const s = countDiffStats(r.diff);
        totalAdd += s.additions;
        totalDel += s.deletions;
        return { file: r.file, status: r.status, matchLevel: r.matchLevel, error: r.error, additions: s.additions, deletions: s.deletions, diff: r.diff };
      }
      return { file: r.file, status: r.status, matchLevel: r.matchLevel, error: r.error, additions: 0, deletions: 0, diff: r.diff };
    });
    const summaryBar = textBars(totalAdd, totalDel);
    out.push(`\u2705 Applied ${data.summary?.applied || 0}/${data.totalChanges || 0} \u2014 +${totalAdd}  -${totalDel}  ${summaryBar}`);
    if (data.summary?.conflicts > 0) out.push(`\u26A0\uFE0F  ${data.summary.conflicts} conflict(s) \u2014 need manual fix`);
    if (data.summary?.failed > 0) out.push(`\u274C ${data.summary.failed} error(s)`);
    out.push('');
    for (const r of perFile) {
      const icon = r.status === 'applied' ? '\u2705' : r.status === 'conflict' ? '\u274C' : '\u26A0\uFE0F';
      const bar = textBars(r.additions, r.deletions);
      out.push(`${icon} ${r.file}  +${r.additions}  -${r.deletions}  ${bar}`);
      if (r.matchLevel && r.matchLevel > 2) out.push(`   \u26A1 Fuzzy match level ${r.matchLevel}`);
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
