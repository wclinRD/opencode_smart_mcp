/**
 * tree-sitter-edit.mjs — Tree-sitter AST-aware symbol editing
 *
 * Provides precise, structure-aware symbol finding and replacement
 * using web-tree-sitter + WASM grammars. Falls back gracefully when
 * tree-sitter is unavailable or language is unsupported.
 *
 * Public API:
 *   initTreeSitter()          — lazy-init (called automatically)
 *   findSymbolAST(content, lang, name) → { name, type, lineStart, lineEnd, body, node }
 *   replaceSymbolAST(content, lang, name, newBody) → { newContent, lineStart, lineEnd }
 *   isTreeSitterAvailable()   → boolean
 *   isTreeSitterLang(lang)    → boolean
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Singleton state ──────────────────────────────────────────────────────────
let Parser = null;
let Language = null;
let parserInstance = null;
let initialized = false;
let initError = null;
const languageCache = new Map(); // lang → Language object

// ── Language → WASM mapping ──────────────────────────────────────────────────
// tree-sitter-wasms ships WASM files for many languages.
const LANG_WASM_MAP = {
  javascript:   'tree-sitter-javascript.wasm',
  typescript:   'tree-sitter-tsx.wasm',   // tsx can parse TS
  tsx:          'tree-sitter-tsx.wasm',
  jsx:          'tree-sitter-javascript.wasm',
  python:       'tree-sitter-python.wasm',
  go:           'tree-sitter-go.wasm',
  rust:         'tree-sitter-rust.wasm',
  java:         'tree-sitter-java.wasm',
  csharp:       'tree-sitter-c_sharp.wasm',
  php:          'tree-sitter-php.wasm',
  ruby:         'tree-sitter-ruby.wasm',
  swift:        'tree-sitter-swift.wasm',
  kotlin:       'tree-sitter-kotlin.wasm',
  scala:        'tree-sitter-scala.wasm',
  c:            'tree-sitter-c.wasm',
  cpp:          'tree-sitter-cpp.wasm',
  html:         'tree-sitter-html.wasm',
  css:          'tree-sitter-css.wasm',
  json:         'tree-sitter-json.wasm',
};

// ── Node type patterns per language ──────────────────────────────────────────
// tree-sitter node types for top-level declarations.
// Each entry: { nodeTypes: string[], getName: (node) => string|null }
const DECL_PATTERNS = {
  javascript: [
    { nodeTypes: ['function_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['lexical_declaration', 'variable_declaration'], getName: n => {
      // const foo = ... / const foo = () => {} / var foo = ...
      // tree-sitter: lexical_declaration → child(1) is variable_declarator → child(0) is identifier
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.type === 'variable_declarator') {
          const id = c.childForFieldName('name') || c.namedChildren?.[0];
          return id?.text || null;
        }
      }
      return null;
    }},
    { nodeTypes: ['export_statement'], getName: n => {
      // Recurse into the exported declaration
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c.isNamed) continue;
        if (['function_declaration','class_declaration','lexical_declaration','variable_declaration'].includes(c.type)) {
          const inner = DECL_PATTERNS.javascript.find(p => p.nodeTypes.includes(c.type));
          if (inner) return inner.getName(c);
        }
      }
      return null;
    }},
  ],
  typescript: [
    // TS patterns — mostly same as JS, plus interfaces/types/enums
    { nodeTypes: ['function_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['interface_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['type_alias_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['lexical_declaration', 'variable_declaration'], getName: n => {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.type === 'variable_declarator') {
          const id = c.childForFieldName('name') || c.namedChildren?.[0];
          return id?.text || null;
        }
      }
      return null;
    }},
    { nodeTypes: ['export_statement'], getName: n => {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c.isNamed) continue;
        if (['function_declaration','class_declaration','interface_declaration',
             'type_alias_declaration','enum_declaration',
             'lexical_declaration','variable_declaration'].includes(c.type)) {
          const inner = DECL_PATTERNS.typescript.find(p => p.nodeTypes.includes(c.type));
          if (inner) return inner.getName(c);
        }
      }
      return null;
    }},
  ],
  python: [
    { nodeTypes: ['function_definition'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['class_definition'], getName: n => n.childForFieldName('name')?.text },
  ],
  go: [
    { nodeTypes: ['function_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['type_declaration'], getName: n => {
      // type Foo struct { ... } / type Foo interface { ... }
      const typeDef = n.namedChildren?.[0];
      return typeDef?.childForFieldName('name')?.text || null;
    }},
  ],
  rust: [
    { nodeTypes: ['function_item'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['struct_item'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['impl_item'], getName: n => {
      // impl Foo { ... } — name is the type being implemented
      const ty = n.childForFieldName('name') || n.namedChildren?.[0];
      return ty?.text?.split('<')[0] || null; // strip generics
    }},
    { nodeTypes: ['trait_item'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_item'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['type_item'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['const_item'], getName: n => n.childForFieldName('name')?.text },
  ],
  java: [
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['interface_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['method_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['constructor_declaration'], getName: n => {
      // Use class name for constructor
      const parent = n.parent;
      return parent?.childForFieldName('name')?.text || null;
    }},
  ],
  csharp: [
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['interface_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['struct_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['method_declaration'], getName: n => n.childForFieldName('name')?.text },
  ],
  php: [
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['interface_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['trait_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['function_definition'], getName: n => n.childForFieldName('name')?.text },
  ],
  ruby: [
    { nodeTypes: ['class'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['module'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['method'], getName: n => n.childForFieldName('name')?.text },
  ],
  swift: [
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['struct_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['protocol_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['function_declaration'], getName: n => n.childForFieldName('name')?.text },
  ],
  kotlin: [
    { nodeTypes: ['class_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['interface_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['object_declaration'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['function_declaration'], getName: n => n.childForFieldName('name')?.text },
  ],
  scala: [
    { nodeTypes: ['class_definition'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['trait_definition'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['object_definition'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['function_definition'], getName: n => n.childForFieldName('name')?.text },
  ],
  c: [
    { nodeTypes: ['function_declarator'], getName: n => {
      // Find the identifier inside the declarator
      let cur = n;
      while (cur && cur.type !== 'identifier') {
        cur = cur.namedChildren?.[0];
      }
      return cur?.text || null;
    }},
    { nodeTypes: ['struct_specifier'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['enum_specifier'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['type_definition'], getName: n => n.childForFieldName('name')?.text },
  ],
  cpp: [
    { nodeTypes: ['function_definition'], getName: n => {
      // declarator → name
      const decl = n.childForFieldName('declarator');
      if (!decl) return null;
      let cur = decl;
      while (cur && !['identifier', 'field_identifier', 'destructor_name'].includes(cur.type)) {
        cur = cur.namedChildren?.[0];
      }
      return cur?.text?.replace(/^~/, '') || null;
    }},
    { nodeTypes: ['class_specifier'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['struct_specifier'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['namespace_definition'], getName: n => n.childForFieldName('name')?.text },
    { nodeTypes: ['template_declaration'], getName: n => {
      // template<class T> class Foo → find inner declaration
      const inner = n.namedChildren?.[n.namedChildren.length - 1];
      if (!inner) return null;
      const innerPattern = DECL_PATTERNS.cpp.find(p => p.nodeTypes.includes(inner.type));
      return innerPattern ? innerPattern.getName(inner) : null;
    }},
  ],
};

// Copy JS patterns to JSX
DECL_PATTERNS.jsx = DECL_PATTERNS.javascript;
// Copy TS patterns to TSX
DECL_PATTERNS.tsx = DECL_PATTERNS.typescript;

// ── Initialization ───────────────────────────────────────────────────────────

let wasmPaths = null;

function getWasmDir() {
  if (wasmPaths) return wasmPaths;
  try {
    const require = createRequire(import.meta.url);
    const wasmsPkg = require.resolve('tree-sitter-wasms/package.json');
    wasmPaths = join(dirname(wasmsPkg), 'out');
  } catch {
    // Fallback: try relative path
    wasmPaths = join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out');
  }
  return wasmPaths;
}

/**
 * Lazy-initialize web-tree-sitter parser.
 * Safe to call multiple times — only initializes once.
 */
export async function initTreeSitter() {
  if (initialized) return { ok: !initError, error: initError };

  try {
    const mod = await import('web-tree-sitter');
    Parser = mod.Parser;
    Language = mod.Language;
    await Parser.init();
    parserInstance = new Parser();

    // Preload all available WASM languages (async load)
    const wasmDir = getWasmDir();
    const loadPromises = [];
    for (const [lang, wasmFile] of Object.entries(LANG_WASM_MAP)) {
      if (languageCache.has(lang)) continue;
      const wasmPath = join(wasmDir, wasmFile);
      loadPromises.push(
        Language.load(wasmPath).then(langObj => {
          languageCache.set(lang, langObj);
        }).catch(() => { /* skip unsupported */ })
      );
    }
    await Promise.all(loadPromises);

    initialized = true;
    return { ok: true, languagesLoaded: languageCache.size };
  } catch (e) {
    initError = e.message;
    initialized = true; // prevent retry
    return { ok: false, error: e.message };
  }
}

/** Check if tree-sitter is available */
export function isTreeSitterAvailable() {
  return initialized && !initError && parserInstance !== null;
}

/** Check if a language is supported by tree-sitter */
export function isTreeSitterLang(lang) {
  return lang in LANG_WASM_MAP && lang in DECL_PATTERNS;
}

/**
 * Quick syntax check using tree-sitter parse.
 * Returns { ok: true } if parse succeeds, or { ok: false, error: string } if ERROR nodes found.
 * Falls back gracefully if tree-sitter is not available.
 *
 * @param {string} content — source code to parse
 * @param {string} lang — language name
 * @returns {{ ok: boolean, error?: string }}
 */
export function parseCheck(content, lang) {
  if (!isTreeSitterAvailable() || !isTreeSitterLang(lang)) {
    return { ok: true }; // no tree-sitter = assume valid (graceful degradation)
  }

  const langModule = languageCache.get(lang);
  if (!langModule) return { ok: true };

  try {
    parserInstance.setLanguage(langModule);
    const tree = parserInstance.parse(content);

    // Check for ERROR nodes in the tree
    const errors = [];
    const walk = tree.rootNode.walk();
    let cursor = walk;
    let dominated = false;
    while (!dominated) {
      if (cursor.nodeType === 'ERROR' || cursor.nodeType === 'MISSING') {
        const startLine = cursor.startPosition.row + 1;
        const text = content.split('\n')[startLine - 1]?.trim()?.substring(0, 80) || '';
        errors.push(`Line ${startLine}: ${cursor.nodeType} near "${text}"`);
      }
      if (cursor.gotoNextSibling()) {
        continue;
      }
      // Walk up to find unvisited parent sibling
      while (cursor.gotoParent()) {
        if (cursor.gotoNextSibling()) break;
      }
      dominated = !cursor.gotoParent() || cursor.nodeId === 0;
      // Root check: if we're back at root and root has no next sibling
      if (cursor.nodeId === tree.rootNode.id) {
        break;
      }
    }

    if (errors.length > 0) {
      return { ok: false, error: `Syntax errors: ${errors.slice(0, 3).join('; ')}` };
    }
    return { ok: true };
  } catch (e) {
    // Parse crash = assume valid (graceful degradation)
    return { ok: true };
  }
}

// ── Core: findSymbolAST ──────────────────────────────────────────────────────

// Type mapping: tree-sitter node type → our unified type name
const NODE_TYPE_MAP = {
  function_declaration: 'function',
  function_definition: 'function',
  function_item: 'function',
  method_declaration: 'function',
  method: 'function',
  function_definition_php: 'function',
  lexical_declaration: 'variable',
  variable_declaration: 'variable',
  class_declaration: 'class',
  class_definition: 'class',
  class: 'class',
  class_specifier: 'class',
  struct_item: 'struct',
  struct_specifier: 'struct',
  struct_declaration: 'struct',
  interface_declaration: 'interface',
  interface: 'interface',
  trait_item: 'trait',
  trait_declaration: 'trait',
  enum_item: 'enum',
  enum_declaration: 'enum',
  type_alias_declaration: 'type',
  type_item: 'type',
  type_definition: 'type',
  export_statement: 'export',
};

/**
 * Find a symbol by name using tree-sitter AST parsing.
 *
 * @param {string} content — file content
 * @param {string} lang — language name (e.g. 'javascript', 'python')
 * @param {string} symbolName — symbol name to find
 * @returns {{ name: string, type: string, lineStart: number, lineEnd: number, body: string, node: object } | null}
 */
export function findSymbolAST(content, lang, symbolName) {
  if (!isTreeSitterAvailable() || !isTreeSitterLang(lang)) return null;

  const langModule = languageCache.get(lang);
  if (!langModule) return null; // language not loaded — fall back to regex

  try {
    parserInstance.setLanguage(langModule);
  } catch (e) {
    return null;
  }

  try {
    const tree = parserInstance.parse(content);
    const patterns = DECL_PATTERNS[lang] || DECL_PATTERNS.javascript;

    // Walk top-level nodes
    const rootNode = tree.rootNode;
    const candidates = [];

    function walkChildren(node) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        // Skip non-named nodes (whitespace, comments, etc.)
        if (!child.isNamed) continue;

        for (const pattern of patterns) {
          if (child.type === pattern.nodeTypes[0] ||
              pattern.nodeTypes.includes(child.type)) {
            const name = pattern.getName(child);
            if (name) {
              candidates.push({
                name,
                type: NODE_TYPE_MAP[child.type] || 'unknown',
                node: child,
              });
            }
          }
        }
      }
    }

    // Walk program body
    walkChildren(rootNode);

    // Also walk into export_statement children (for re-exports)
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (child.type === 'export_statement') {
        for (let j = 0; j < child.childCount; j++) {
          const inner = child.child(j);
          if (!inner.isNamed) continue;
          for (const pattern of patterns) {
            if (inner.type === pattern.nodeTypes[0] ||
                pattern.nodeTypes.includes(inner.type)) {
              const name = pattern.getName(inner);
              if (name && !candidates.some(c => c.name === name)) {
                candidates.push({
                  name,
                  type: NODE_TYPE_MAP[inner.type] || 'unknown',
                  node: inner,
                });
              }
            }
          }
        }
      }
    }

    // Exact match
    let match = candidates.find(c => c.name === symbolName);
    if (!match) {
      // Case-insensitive match
      match = candidates.find(c => c.name.toLowerCase() === symbolName.toLowerCase());
    }
    if (!match) {
      // Prefix/includes match (for partial names like "handleClick" matching "useHandleClick")
      const lower = symbolName.toLowerCase();
      match = candidates.find(c => {
        const nl = c.name.toLowerCase();
        return nl.startsWith(lower) || lower.startsWith(nl) ||
               nl.includes(lower) || lower.includes(nl);
      });
    }

    if (!match) return null;

    // Extract line range and body from the matched node
    const lineStart = match.node.startPosition.row + 1; // 1-indexed
    const lineEnd = match.node.endPosition.row + 1;     // 1-indexed
    const body = content.split('\n').slice(lineStart - 1, lineEnd).join('\n');

    return {
      name: match.name,
      type: match.type,
      lineStart,
      lineEnd,
      body,
      node: match.node,
      _source: 'tree-sitter',
    };
  } catch {
    return null;
  }
}

// ── Core: replaceSymbolAST ───────────────────────────────────────────────────

/**
 * Replace a symbol's body in file content using tree-sitter.
 *
 * @param {string} content — file content
 * @param {string} lang — language name
 * @param {string} symbolName — symbol name to replace
 * @param {string} newBody — new full symbol body (including declaration line)
 * @returns {{ newContent: string, lineStart: number, lineEnd: number, name: string } | null}
 */
export function replaceSymbolAST(content, lang, symbolName, newBody) {
  const sym = findSymbolAST(content, lang, symbolName);
  if (!sym) return null;

  const lines = content.split('\n');
  // lineStart/lineEnd are 1-indexed, slice uses 0-indexed
  const before = lines.slice(0, sym.lineStart - 1).join('\n');
  const after = lines.slice(sym.lineEnd).join('\n');

  // Ensure proper newline joining
  const prefix = before ? before + '\n' : '';
  const suffix = after ? '\n' + after : '';
  const newContent = prefix + newBody + suffix;

  return {
    newContent,
    lineStart: sym.lineStart,
    lineEnd: sym.lineEnd,
    name: sym.name,
    oldBody: sym.body,
    _source: 'tree-sitter',
  };
}

/**
 * Insert a symbol at a specific position (before/after another symbol).
 *
 * @param {string} content — file content
 * @param {string} lang — language name
 * @param {string} anchorName — symbol to insert relative to
 * @param {string} newCode — code to insert
 * @param {'before'|'after'} position — where to insert
 * @returns {{ newContent: string, line: number } | null}
 */
export function insertNearSymbolAST(content, lang, anchorName, newCode, position = 'after') {
  const sym = findSymbolAST(content, lang, anchorName);
  if (!sym) return null;

  const lines = content.split('\n');
  const insertLine = position === 'after' ? sym.lineEnd : sym.lineStart - 1;

  const before = lines.slice(0, insertLine).join('\n');
  const after = lines.slice(insertLine).join('\n');

  const prefix = before ? before + '\n' : '';
  const suffix = after ? '\n' + after : '';
  const newContent = prefix + newCode + suffix;

  return {
    newContent,
    line: insertLine + 1, // 1-indexed
    _source: 'tree-sitter',
  };
}

/**
 * Extract selected lines into a new function (tree-sitter AST-aware).
 *
 * @param {string} content — full file content
 * @param {string} lang — language identifier
 * @param {number} startLine — first line to extract (1-indexed)
 * @param {number} endLine — last line to extract (1-indexed, inclusive)
 * @param {string} funcName — name for the extracted function
 * @param {{ params?: string, insertAt?: 'after'|'before'|'end' }} [opts]
 * @returns {{ newContent: string, callLine: number, defLine: number } | null}
 */
export function extractFunctionAST(content, lang, startLine, endLine, funcName, opts = {}) {
  if (!isTreeSitterAvailable() || !isTreeSitterLang(lang)) return null;

  const lines = content.split('\n');
  if (startLine < 1 || endLine > lines.length || startLine > endLine) return null;

  // Extract the code block
  const extractedLines = lines.slice(startLine - 1, endLine);
  const extractedCode = extractedLines.join('\n');

  // Detect indentation from first non-empty line
  const firstNonEmpty = extractedLines.find(l => l.trim().length > 0) || '';
  const indent = firstNonEmpty.match(/^(\s*)/)?.[1] || '';
  const bodyIndent = indent + '  ';

  // Build the function definition
  const params = opts.params || '';
  const defLines = [
    `${indent}function ${funcName}(${params}) {`,
    ...extractedLines.map(l => {
      // Re-indent: remove common indent, add body indent
      const trimmed = l.trimStart();
      return trimmed.length > 0 ? bodyIndent + trimmed : '';
    }),
    `${indent}}`,
  ];

  // Build the function call
  const callLine = `${indent}${funcName}(${params});`;

  // Determine where to insert the definition
  let insertAt = opts.insertAt || 'after';

  // Try to find enclosing scope using tree-sitter
  let defInsertLine = -1;
  try {
    const parser = getParser(lang);
    if (parser) {
      const tree = parser.parse(content);
      // Find the function/class containing startLine
      const enclosing = findEnclosingScope(tree.rootNode, startLine);
      if (enclosing) {
        if (insertAt === 'after') {
          defInsertLine = enclosing.endLine; // 1-indexed, insert after
        } else if (insertAt === 'before') {
          defInsertLine = enclosing.startLine - 1; // 1-indexed, insert before
        }
      }
    }
  } catch { /* fallback to end of file */ }

  // Fallback: insert at end of file
  if (defInsertLine < 0) {
    if (insertAt === 'end' || insertAt === 'after') {
      defInsertLine = lines.length;
    } else {
      defInsertLine = 0;
    }
  }

  // Apply: 1) Insert definition, 2) Replace extracted lines with call
  // Work bottom-up to preserve line numbers
  let newLines = [...lines];

  // Insert definition at defInsertLine
  const defContent = defLines.join('\n');
  if (defInsertLine >= newLines.length) {
    // Append at end
    newLines.push('', ...defLines);
  } else {
    newLines.splice(defInsertLine, 0, ...defLines, '');
  }

  // Replace extracted lines with call (startLine is 1-indexed, now shifted by def insertion)
  const callInsertLine = startLine - 1; // original start line (0-indexed)
  newLines.splice(callInsertLine, endLine - startLine + 1, callLine);

  const newContent = newLines.join('\n');

  return {
    newContent,
    callLine: startLine, // where the call was inserted (1-indexed, before shift)
    defLine: defInsertLine + 1, // where the definition was inserted (1-indexed)
    _source: 'tree-sitter',
    _action: 'extract-function',
  };
}

/**
 * Find the enclosing scope (function/class) for a given line number.
 */
function findEnclosingScope(node, targetLine) {
  if (!node) return null;

  const startLine = node.startPosition.row + 1; // 1-indexed
  const endLine = node.endPosition.row + 1;

  if (targetLine < startLine || targetLine > endLine) return null;

  // Check children (prioritize innermost scope)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const childResult = findEnclosingScope(child, targetLine);
    if (childResult) return childResult;
  }

  // This node contains the target — check if it's a scope-creating node
  const scopeTypes = new Set([
    'function_declaration', 'function',
    'class_declaration', 'class',
    'arrow_function',
    'method_definition',
    'export_statement',
    'program',
  ]);

  if (scopeTypes.has(node.type)) {
    return {
      type: node.type,
      startLine,
      endLine,
      name: node.childForFieldName?.('name')?.text || node.type,
    };
  }

  return null;
}

/**
 * Get a parser instance for the given language.
 */
function getParser(lang) {
  if (!Parser || !Language) return null;
  const cached = languageCache.get(lang);
  if (!cached) return null;
  const parser = new Parser();
  parser.setLanguage(cached);
  return parser;
}

