// code-ast.mjs → smart_code_ast
// 給定檔案和可選符號，回傳 AST 結構定義位置。
// 使用 LSP documentSymbol 實現，後續換 Tree-sitter。

import { getLspBridge } from '../../lib/lsp-bridge.mjs';

/** Format a single symbol node as text */
function formatSymbol(sym, indent = '') {
  let out = `${indent}${sym.kind} ${sym.name}`;
  if (sym.signature && sym.signature !== sym.name) {
    out += `  (${sym.signature})`;
  }
  out += `  [L${sym.line}:${sym.col}]`;
  if (sym.children) {
    for (const child of sym.children) {
      out += '\n' + formatSymbol(child, indent + '  ');
    }
  }
  return out;
}

/** Format output as JSON */
function formatJSON(data, symbol) {
  let symbols = data.symbols;
  if (symbol) {
    symbols = symbols.filter(s => s.name === symbol);
  }
  return JSON.stringify({ file: data.file, symbol, symbols }, null, 2);
}

export default {
  name: 'smart_code_ast',
  category: 'standard',
  description: `Query code structure via AST. Use when: need to find function/class/interface/type/variable definitions, inspect file structure, or understand symbol locations WITHOUT guessing.

Supports filtering by symbol name and kind (function, class, interface, type, variable). Output includes line numbers, column positions, and recursive children.

Phase 10: LSP-based code intelligence tool.`,
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Target file path (relative to project root)' },
      symbol: { type: 'string', description: 'Optional symbol name to filter' },
      kind: { type: 'string', enum: ['function', 'class', 'interface', 'type', 'variable', 'method', 'property', 'enum'], description: 'Optional kind filter' },
      recursive: { type: 'boolean', description: 'Include child symbols recursively (default: true)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: ['file'],
  },
  handler: async (args) => {
    const root = args.root || process.cwd();
    const bridge = getLspBridge(root);

    const result = await bridge.getSymbols(args.file);
    if (result.error) return result.error;

    let symbols = result.symbols;
    if (args.symbol) {
      symbols = symbols.filter(s => s.name === args.symbol || s.signature?.includes(args.symbol));
    }
    if (args.kind) {
      symbols = symbols.filter(s => s.kind === args.kind);
    }
    if (!args.recursive && args.recursive !== undefined) {
      symbols = symbols.map(s => ({ ...s, children: undefined }));
    }

    const output = { file: args.file, symbols };

    if (args.format === 'json') {
      return JSON.stringify(output, null, 2);
    }

    // Text format
    if (symbols.length === 0) {
      return `No symbols found in ${args.file}` + (args.symbol ? ` matching "${args.symbol}"` : '');
    }

    let text = `📄 ${args.file} — ${symbols.length} symbol(s)`;
    if (args.symbol) text += ` matching "${args.symbol}"`;
    text += '\n' + '─'.repeat(50) + '\n';

    for (const sym of symbols) {
      text += formatSymbol(sym) + '\n';
    }

    return text;
  },
};
