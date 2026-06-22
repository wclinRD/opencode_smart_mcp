// edit-chain.mjs → smart_edit_chain
//
// [chain] Compound edit tool — batch multiple edits in ONE call.
// Reduces overhead: 1 MCP call instead of N, shared file reads,
// atomic validation before apply.
//
// Format auto-detection per edit:
//   { search, replace }         → search-replace (fuzzy)
//   { symbol, content }         → block-diff (symbol-aware)
//   { sed }                     → sed expression
//   { startLine, content }      → hashline (endLine optional)
//
// Inline mode: runs in current process (no subagent).

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { extractSymbol, detectLanguage, parseDeclarations } from '../../lib/smart-read.mjs';
import {
  applyHashline, applySearchReplace, applySed,
} from '../../lib/apply-engine.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

function textBars(a, d) {
  const total = Math.max(a, d, 1);
  const add = Math.round(10 * a / total);
  const del = Math.round(10 * d / total);
  return '\x1b[32m' + '\u2588'.repeat(add) + '\x1b[31m' + '\u2588'.repeat(del) + '\x1b[0m' + '\u2591'.repeat(Math.max(0, 10 - add - del));
}

function countDiffStats(diff) {
  if (!diff || typeof diff !== 'string') return { additions: 0, deletions: 0 };
  const add = (diff.match(/^\+/gm) || []).length;
  const del = (diff.match(/^\-/gm) || []).length;
  return { additions: Math.max(0, add - 1), deletions: Math.max(0, del - 1) }; // -1 for ---/+++
}

// ── Resolve a single edit to internal format ───────────────────────────────

function resolveEdit(e, idx) {
  const root = cwd();
  const fp = resolve(root, e.file);

  if (!existsSync(fp)) return { ok: false, error: `File not found: ${e.file}`, index: idx };

  try {
    // search-replace
    if (e.search !== undefined && e.replace !== undefined) {
      return { ok: true, type: 'search-replace', index: idx, file: e.file, path: fp, search: e.search, replace: e.replace };
    }

    // block-diff
    if (e.symbol && e.content !== undefined) {
      const content = readFileSync(fp, 'utf-8');
      const lang = detectLanguage(fp);
      const sym = extractSymbol(content, lang, e.symbol);
      if (!sym) return { ok: false, error: `Symbol "${e.symbol}" not found in ${e.file}`, index: idx };

      // Braces balance check (P0: same pattern as fast-apply)
      const lines = content.split('\n');
      const body = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
      const open = (body.match(/\{/g) || []).length;
      const close = (body.match(/\}/g) || []).length;

      if (open !== close) {
        let corrected = false;
        try {
          const decls = parseDeclarations(content, lang);
          const myIdx = decls.findIndex(d => d.name === sym.name && d.lineStart === sym.lineStart);
          if (myIdx !== -1 && myIdx + 1 < decls.length) {
            const next = decls[myIdx + 1];
            if (next.lineStart > sym.lineStart) {
              const newEnd = next.lineStart - 1;
              const cb = lines.slice(sym.lineStart - 1, newEnd).join('\n');
              if ((cb.match(/\{/g) || []).length === (cb.match(/\}/g) || []).length && cb.trim().length > 0) {
                sym.lineEnd = newEnd;
                corrected = true;
              }
            }
          }
        } catch { /* fall through */ }
        if (!corrected) {
          return { ok: false, error: `Symbol "${e.symbol}" in ${e.file} has unbalanced braces (${open}/{close}). Use search-replace instead.`, index: idx };
        }
      }

      const act = e.action || 'replace';
      const actualBody = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');

      if (act === 'prepend') {
        return { ok: true, type: 'hashline', index: idx, file: e.file, path: fp,
          startLine: sym.lineStart, endLine: sym.lineStart, newContent: e.content, action: 'insert-before' };
      }
      if (act === 'append') {
        return { ok: true, type: 'hashline', index: idx, file: e.file, path: fp,
          startLine: sym.lineEnd, endLine: sym.lineEnd, newContent: e.content, action: 'insert-after' };
      }
      return { ok: true, type: 'hashline', index: idx, file: e.file, path: fp,
        startLine: sym.lineStart, endLine: sym.lineEnd, oldContent: actualBody, newContent: e.content, action: 'replace' };
    }

    // sed
    if (e.sed) {
      return { ok: true, type: 'sed', index: idx, file: e.file, path: fp, sed: e.sed, line: e.startLine, endLine: e.endLine };
    }

    // hashline
    if (e.startLine && e.content !== undefined) {
      return { ok: true, type: 'hashline', index: idx, file: e.file, path: fp,
        startLine: e.startLine, endLine: e.endLine || e.startLine, newContent: e.content, action: 'replace' };
    }

    return { ok: false, error: `Unrecognized edit format. Provide search+replace, symbol+content, sed, or startLine+content.`, index: idx };
  } catch (err) {
    return { ok: false, error: err.message, index: idx };
  }
}

// ── Render result ──────────────────────────────────────────────────────────

function renderResults(results, allOk, elapsed) {
  const out = [];
  const applied = results.filter(r => r.status === 'applied' || r.status === 'ok').length;

  // Summary line
  let totalAdd = 0, totalDel = 0;
  const perFile = results.map(r => {
    if (r.diff) {
      const s = countDiffStats(r.diff);
      totalAdd += s.additions; totalDel += s.deletions;
      return { ...r, additions: s.additions, deletions: s.deletions };
    }
    return { ...r, additions: 0, deletions: 0 };
  });

  const icon = allOk ? '\u2705' : '\u26A0\uFE0F';
  out.push(`${icon} Chain ${applied}/${results.length} \u2014 +${totalAdd}  -${totalDel}  ${textBars(totalAdd, totalDel)}`);

  for (const r of perFile) {
    const ic = r.status === 'applied' || r.status === 'ok' ? '\u2705' : r.status === 'conflict' ? '\u274C' : '\u26A0\uFE0F';
    const bar = textBars(r.additions, r.deletions);
    out.push(`${ic} ${r.file}  +${r.additions}  -${r.deletions}  ${bar}`);
    if (r.matchLevel && r.matchLevel > 2) out.push(`   \u26A1 Fuzzy match level ${r.matchLevel}`);
    if (r.error) out.push(`   ${r.error}`);
  }

  if (results.some(r => r.diff)) {
    out.push('\n--- Diffs ---');
    for (const r of results) {
      if (r.diff) out.push(`\n\`\`\`diff\n${r.diff}\n\`\`\``);
    }
  }

  if (elapsed) out.push(`\n\u23F1 ${elapsed}ms`);
  return out.join('\n');
}

// ── Plugin Definition ──────────────────────────────────────────────────────

export default {
  name: 'smart_edit_chain',
  category: 'edit',
  description: `[chain] Compound edit tool — batch multiple edits in ONE call.
Reduces overhead by sharing file reads and validating all edits before applying.

Format auto-detection per edit:
  { search, replace }         → search-replace (fuzzy)
  { symbol, content }         → block-diff (symbol-aware)
  { sed }                     → sed expression
  { startLine, content }      → hashline (endLine optional)

Key benefits:
  • 1 MCP call for N edits (vs N separate smart_fast_apply calls)
  • Shared file reads: read once per file, apply N edits
  • Atomic: all-or-nothing rollback (default: true)
  • Dry-run by default — safe to preview
  • Compact: short property names save tokens`,

  inputSchema: {
    type: 'object',
    properties: {
      chain: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Target file path (required)' },
            search: { type: 'string', description: 'Text to find — search-replace mode' },
            replace: { type: 'string', description: 'Replacement text — search-replace mode' },
            symbol: { type: 'string', description: 'Symbol name — block-diff mode (paired with content)' },
            content: { type: 'string', description: 'New content — block-diff/hashline mode' },
            sed: { type: 'string', description: 'Sed expression — sed mode' },
            startLine: { type: 'number', description: 'Start line (1-indexed) — hashline mode' },
            endLine: { type: 'number', description: 'End line (inclusive) — hashline mode (default: startLine)' },
            action: { type: 'string', enum: ['replace', 'prepend', 'append'], description: 'Block-diff action (default: replace)' },
          },
          required: ['file'],
        },
        description: 'Array of edit operations (1-20)',
      },
      apply: { type: 'boolean', description: 'Apply changes (default: false = dry-run)' },
      atomic: { type: 'boolean', description: 'All-or-nothing rollback (default: true)' },
    },
    required: ['chain'],
  },

  handler: async function editChainHandler(args) {
    const t0 = Date.now();
    const edits = args.chain || [];
    if (!Array.isArray(edits) || edits.length === 0) {
      return JSON.stringify({ ok: false, error: 'chain must be a non-empty array' });
    }
    if (edits.length > 20) {
      return JSON.stringify({ ok: false, error: 'chain limited to 20 edits per call' });
    }

    const doApply = args.apply === true;
    const doAtomic = args.atomic !== false;

    // ── Phase 1: Resolve all edits ─────────────────────────────────────
    const resolved = [];
    const errors = [];

    for (let i = 0; i < edits.length; i++) {
      const r = resolveEdit(edits[i], i);
      if (r.ok) resolved.push(r);
      else errors.push(`[${i}] ${r.error}`);
    }

    if (errors.length > 0) {
      return JSON.stringify({ ok: false, error: 'Edit chain validation failed', errors });
    }

    // ── Phase 2: Group by file, sort bottom-up ─────────────────────────
    // Bottom-up: apply edits in reverse line order so line numbers
    // don't shift for subsequent edits in the same file.
    const fileGroups = new Map();
    for (const r of resolved) {
      if (!fileGroups.has(r.file)) fileGroups.set(r.file, []);
      fileGroups.get(r.file).push(r);
    }

    for (const [, group] of fileGroups) {
      group.sort((a, b) => {
        // search-replace first (no line number), then bottom-up
        const aLine = a.startLine || 999999;
        const bLine = b.startLine || 999999;
        if (aLine !== bLine) return bLine - aLine;
        return a.index - b.index;
      });
    }

    // ── Phase 3: Dry-run preview ───────────────────────────────────────
    if (!doApply) {
      const out = [`\uD83D\uDCCB Edit Chain \u2014 ${resolved.length} operation(s)`];
      out.push(`   \uD83D\uDD0D dry-run (add apply:true to execute)\n`);

      for (const r of resolved) {
        if (r.type === 'hashline' && r.action === 'replace') {
          out.push(`   \uD83D\uDCDD ${r.file}:${r.startLine}-${r.endLine}`);
        } else if (r.type === 'hashline' && r.action === 'insert-before') {
          out.push(`   \u2795 ${r.file}:${r.startLine} (prepend)`);
        } else if (r.type === 'hashline' && r.action === 'insert-after') {
          out.push(`   \u2795 ${r.file}:${r.endLine} (append)`);
        } else if (r.type === 'search-replace') {
          out.push(`   \uD83D\uDD0D ${r.file} (search-replace)`);
        } else if (r.type === 'sed') {
          out.push(`   \u2702\uFE0F ${r.file} (sed: ${r.sed})`);
        }
      }

      out.push(`\n\u23F1 ${Date.now() - t0}ms`);
      return out.join('\n');
    }

    // ── Phase 4: Apply edits ───────────────────────────────────────────
    const results = [];
    const backups = doAtomic ? [] : null;
    let allOk = true;

    for (const [file, group] of fileGroups) {
      const fp = resolved.find(r => r.file === file).path;

      // Backup original for atomic rollback
      if (doAtomic) {
        try {
          const original = readFileSync(fp, 'utf-8');
          const bakPath = fp + '.chain.bak';
          writeFileSync(bakPath, original, 'utf-8');
          backups.push({ path: fp, backup: bakPath });
        } catch (e) {
          for (const b of backups) { try { unlinkSync(b.backup); } catch {} }
          return JSON.stringify({ ok: false, error: `Failed to backup ${file}: ${e.message}` });
        }
      }

      for (const r of group) {
        try {
          let result;
          if (r.type === 'search-replace') {
            result = applySearchReplace(fp, { search: r.search, replace: r.replace });
          } else if (r.type === 'hashline') {
            result = applyHashline(fp, r);
          } else if (r.type === 'sed') {
            result = applySed(fp, r.sed, r.line, r.endLine);
          }

          const status = result?.status || 'error';
          results.push({
            file: r.file,
            status,
            matchLevel: result?.matchLevel,
            error: result?.error,
            diff: result?.diff,
          });
          if (status !== 'applied' && status !== 'ok') allOk = false;
        } catch (e) {
          results.push({ file: r.file, status: 'error', error: e.message });
          allOk = false;
        }

        // Stop on first error if atomic
        if (!allOk && doAtomic) break;
      }

      // Rollback on error
      if (!allOk && doAtomic) {
        for (const b of backups) {
          try {
            const orig = readFileSync(b.backup, 'utf-8');
            writeFileSync(b.path, orig, 'utf-8');
            unlinkSync(b.backup);
          } catch {}
        }
        return JSON.stringify({ ok: false, error: 'Atomic chain failed \u2014 all changes rolled back', results });
      }
    }

    // Clean up backups
    if (doAtomic && backups) {
      for (const b of backups) {
        try { unlinkSync(b.backup); } catch {}
      }
    }

    return renderResults(results, allOk, Date.now() - t0);
  },
};
