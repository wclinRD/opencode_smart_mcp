// ast-engine.mjs — AST-free code analysis for fast-apply
//
// Zero external dependencies. Uses:
//   - extractSymbol() from smart-read.mjs for symbol location
//   - Regex-based language detection
//   - Brace/balance checking for syntax validation
//
// Integrates with fuzzyMatch L7 fallback in apply-engine.mjs.
// When L1-L6 all fail, L7 hint triggers retry through this engine.

import { extractSymbol, detectLanguage } from './smart-read.mjs';
import { checkBalance } from './apply-engine.mjs';

/**
 * Initialize — no-op (no WASM needed).
 * Returns object matching web-tree-sitter API shape for compatibility.
 */
export async function initParser(lang) {
  return { lang, ready: true };
}

/**
 * Find a symbol (function/class/struct/etc.) by name.
 * Wraps existing extractSymbol() with normalized output.
 * @param {string} content — file source code
 * @param {string} lang — language name
 * @param {string} name — symbol name
 * @returns {{name: string, lineStart: number, lineEnd: number, body: string, type: string}|null}
 */
export async function locateSymbol(content, lang, name) {
  const sym = extractSymbol(content, lang, name);
  if (!sym) return null;
  return {
    name: sym.name,
    lineStart: sym.lineStart,
    lineEnd: sym.lineEnd,
    body: sym.body || content.split('\n').slice(sym.lineStart - 1, sym.lineEnd).join('\n'),
    type: sym.type || 'unknown',
  };
}

/**
 * Match a search block within file content.
 * Strategy:
 *   1. If search matches a complete symbol body → return its line range
 *   2. If search is a subset of a symbol → return that symbol's range
 *   3. Fallback: trim-based text search
 * @param {string} content — full file content
 * @param {string} lang — language name
 * @param {string} searchBlock — the code to find
 * @returns {{lineStart: number, lineEnd: number, confidence: number}|null}
 */
export function matchByAST(content, lang, searchBlock) {
  if (!content || !searchBlock) return null;

  // Strategy 1: Check if searchBlock is an entire function/class
  const lines = content.split('\n');
  const searchLines = searchBlock.split('\n');
  const firstLine = searchLines[0]?.trim();
  const nameMatch = firstLine?.match(/(?:function|class|struct|def|func|fn)\s+(\w+)/);
  if (nameMatch) {
    const sym = extractSymbol(content, lang, nameMatch[1]);
    if (sym && sym.body === searchBlock) {
      return { lineStart: sym.lineStart, lineEnd: sym.lineEnd, confidence: 10 };
    }
    if (sym) {
      return { lineStart: sym.lineStart, lineEnd: sym.lineEnd, confidence: 8 };
    }
  }

  // Strategy 2: Text-based search with normalization
  const normSearch = searchBlock.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < lines.length; i++) {
    const block = lines.slice(i, i + searchLines.length).join('\n');
    if (block.replace(/\s+/g, ' ').trim() === normSearch) {
      return { lineStart: i + 1, lineEnd: i + searchLines.length, confidence: 7 };
    }
  }

  // Strategy 3: Find by trimmed anchor line
  const anchor = searchLines.find(l => l.trim().length > 10);
  if (anchor) {
    const anchorTrimmed = anchor.trim();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === anchorTrimmed) {
        return { lineStart: i + 1, lineEnd: Math.min(i + searchLines.length, lines.length), confidence: 5 };
      }
    }
  }

  return null;
}

/**
 * Validate syntax using balance checking + known error patterns.
 * Falls back to checkBalance() for brace/bracket validation.
 * @param {string} content — source code
 * @param {string} lang — language name (unused, for API compat)
 * @returns {{ok: boolean, errors: Array<{row: number, col: number, message: string}>}}
 */
export async function validateSyntax(content, lang) {
  const errors = [];

  // Check brace/bracket balance
  const balance = checkBalance(content);
  if (!balance.balanced) {
    errors.push({
      row: 1, col: 1,
      message: `Unmatched delimiters: ${balance.unmatched?.join(', ') || 'unknown'}`,
    });
  }

  // Check for common JS/TS syntax errors via eval-style heuristics
  if (lang === 'javascript' || lang === 'typescript' || lang === 'js' || lang === 'ts') {
    if (content.includes('const ') && !content.includes('=')) {
      errors.push({ row: 1, col: 1, message: 'const without assignment' });
    }
  }

  return { ok: errors.length === 0, errors };
}

export default { initParser, locateSymbol, matchByAST, validateSyntax };
