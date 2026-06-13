// ast-engine.mjs — Tree-sitter AST engine for code analysis & matching
//
// Provides:
//   initParser(lang)   — lazy WASM loading
//   matchByAST(...)    — AST-aware block matching (L7 fallback)
//   validateSyntax(...) — syntax validation
//   locateSymbol(...)  — AST node location by name
//
// Supported languages: javascript, typescript, python, rust, go, java,
//   c, cpp, csharp, ruby, php, swift, bash, css, html, json, yaml, markdown

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Lazy parser cache
// ---------------------------------------------------------------------------

let Parser = null;
const parserCache = new Map();
const wasmDir = resolve(__dirname, '../../node_modules/tree-sitter-wasms/out');

const LANG_MAP = {
  js: 'javascript', javascript: 'javascript', jsx: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  py: 'python', python: 'python',
  rs: 'rust', rust: 'rust',
  go: 'go', golang: 'go',
  java: 'java',
  c: 'c', cpp: 'cpp', 'c++': 'cpp',
  cs: 'c_sharp', 'c#': 'c_sharp', csharp: 'c_sharp',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  css: 'css',
  html: 'html',
  json: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
};

function detectTSLang(lang) {
  if (!lang) return null;
  const l = lang.toLowerCase().replace(/[.-].*$/, '');
  return LANG_MAP[l] || null;
}

/**
 * Initialize/load Tree-sitter parser for a language.
 * @param {string} lang — file extension or language name
 * @returns {object|null} — { parser, language } or null on failure
 */
export async function initParser(lang) {
  const tsLang = detectTSLang(lang);
  if (!tsLang) return null;
  if (parserCache.has(tsLang)) return parserCache.get(tsLang);

  try {
    if (!Parser) {
      const ParserModule = (await import('web-tree-sitter')).default;
      await ParserModule.init();
      Parser = ParserModule;
    }

    const wasmFile = resolve(wasmDir, `tree-sitter-${tsLang}.wasm`);
    const Language = await Parser.Language.load(wasmFile);
    const parser = new Parser();
    parser.setLanguage(Language);
    const entry = { parser, language: tsLang, Language };
    parserCache.set(tsLang, entry);
    return entry;
  } catch (e) {
    console.warn(`[ast-engine] Failed to init parser for ${lang}: ${e.message}`);
    return null;
  }
}

/**
 * Match by AST: find a block of code in the AST tree.
 * Returns the node range if found, null otherwise.
 * Used as L7 fallback in fuzzyMatch.
 *
 * @param {string} content — full file content
 * @param {string} lang — language name/extension
 * @param {string} search — search code to locate
 * @returns {{ startLine: number, endLine: number } | null}
 */
export async function matchByAST(content, lang, search) {
  try {
    const eng = await initParser(lang);
    if (!eng) return null;
    const tree = eng.parser.parse(content);
    if (!tree || !tree.rootNode) return null;

    const searchNorm = search.trim().replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    const searchLines = searchNorm.split('\n');

    // Walk tree, find node whose text most closely matches search
    let best = { score: 0, startLine: 0, endLine: 0 };
    const walk = (node) => {
      if (!node || !node.startPosition) return;
      const sl = node.startPosition.row + 1;
      const el = node.endPosition.row + 1;
      // Only consider non-trivial nodes
      if (el - sl < 2) { // recurse children for single-line
        for (let i = 0; i < node.childCount; i++) walk(node.child(i));
        return;
      }
      const nodeText = content.slice(node.startIndex, node.endIndex);
      const nodeNorm = nodeText.trim().replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
      const nodeLines = nodeNorm.split('\n');

      // Score: fraction of search lines that appear in node text (in order)
      let matched = 0;
      let si = 0;
      for (const nl of nodeLines) {
        if (si < searchLines.length && nl === searchLines[si]) {
          matched++; si++;
        }
      }
      const score = matched / Math.max(searchLines.length, 1);
      if (score > best.score) {
        best = { score, startLine: sl, endLine: el };
      }
      // Continue searching children for better match
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    };
    walk(tree.rootNode);

    return best.score >= 0.6 ? { startLine: best.startLine, endLine: best.endLine } : null;
  } catch {
    return null;
  }
}

/**
 * Validate syntax by parsing with Tree-sitter.
 * Returns { ok, errors } where errors is array of { row, column, message }.
 *
 * @param {string} content — file content
 * @param {string} lang — language name/extension
 * @returns {Promise<{ ok: boolean, errors: Array<{row:number, col:number, msg:string}> }>}
 */
export async function validateSyntax(content, lang) {
  try {
    const eng = await initParser(lang);
    if (!eng) return { ok: true, errors: [] }; // can't validate, assume ok
    const tree = eng.parser.parse(content);
    const errors = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'ERROR' || node.isMissing) {
        const row = node.startPosition.row + 1;
        const col = node.startPosition.column;
        errors.push({ row, col, msg: `Syntax error at ${node.startIndex}-${node.endIndex}` });
      }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    };
    walk(tree.rootNode);
    return { ok: errors.length === 0, errors };
  } catch {
    return { ok: true, errors: [] };
  }
}

/**
 * Locate a named symbol in the AST (function, class, method, variable).
 * @param {string} content — file content
 * @param {string} lang — language name/extension
 * @param {string} name — symbol name to find
 * @returns {Array<{ name, type, startLine, endLine, text }>}
 */
export async function locateSymbol(content, lang, name) {
  try {
    const eng = await initParser(lang);
    if (!eng) return [];
    const tree = eng.parser.parse(content);
    if (!tree || !tree.rootNode) return [];

    const results = [];
    const captureNames = new Set([
      'function_declaration', 'function_definition', 'method_definition',
      'class_declaration', 'class_definition',
      'arrow_function', 'generator_function',
      'variable_declaration', 'lexical_declaration',
      'export_statement',
    ]);

    const walk = (node) => {
      if (!node) return;
      const type = node.type;
      const child = node.children.find(c =>
        c && (c.type === 'name' || c.type === 'property_identifier' ||
              c.type === 'identifier') && c.text === name
      );
      if (child && captureNames.has(type)) {
        results.push({
          name,
          type,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          text: content.slice(node.startIndex, node.endIndex),
        });
      }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    };
    walk(tree.rootNode);
    return results;
  } catch {
    return [];
  }
}

export default { initParser, matchByAST, validateSyntax, locateSymbol };
