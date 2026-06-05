// code-call-graph.mjs → smart_code_call_graph
// 給定函式名稱 + 檔案，追蹤 caller/callee 鏈。
// 使用 LSP textDocument/references 為基礎，遞迴追蹤跨檔案呼叫關係。

import { getLspBridge } from '../../lib/lsp-bridge.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Recursively build call graph for a symbol */
async function buildGraph(bridge, file, symbol, direction, depth, maxDepth, visited, rootDir) {
  if (depth > maxDepth) return [];
  const key = `${file}:${symbol}:${direction}:${depth}`;
  if (visited.has(key)) return [];
  visited.add(key);

  // First, find the symbol position in the file
  const symResult = await bridge.getSymbols(file);
  const match = symResult.symbols?.find(s =>
    s.name === symbol || s.signature?.includes(symbol)
  );
  if (!match) return [{ file, symbol, line: 0, note: 'symbol not found in file' }];

  const line = match.line;
  const col = match.col || 0;

  // Get references (callers if direction=callers, or just get all refs)
  const refResult = await bridge.getReferences(file, line, col);
  const refs = refResult.references || [];

  // For callers: refs are all places that reference this symbol
  if (direction === 'callers') {
    const results = [];
    for (const ref of refs) {
      const entry = { file: ref.file, symbol: null, line: ref.line, col: ref.col };
      results.push(entry);

      if (depth < maxDepth) {
        // Try to find the function name containing this reference
        const refSymResult = await bridge.getSymbols(ref.file);
        const containing = refSymResult.symbols?.find(s =>
          s.line <= ref.line && (s.line + 10) >= ref.line && s.kind === 'function'
        );
        if (containing && !visited.has(`${ref.file}:${containing.name}:callers:${depth + 1}`)) {
          entry.symbol = containing.name;
          const deeper = await buildGraph(
            bridge, ref.file, containing.name, 'callers',
            depth + 1, maxDepth, visited, rootDir
          );
          entry.callers = deeper.length > 0 ? deeper : undefined;
        }
      }
    }
    return results;
  }

  // For callees: this is harder with just references (would need AST)
  // For now, we return references as potential callee hints
  return refs.map(ref => ({
    file: ref.file,
    symbol: null,
    line: ref.line,
    col: ref.col,
    note: direction === 'callees' ? 'potential usage - callee tracking requires AST' : undefined
  }));
}

/** Format call graph as text */
function formatGraph(root, results, direction, depth) {
  const indent = '  '.repeat(depth);
  let text = '';
  for (const r of results) {
    const sym = r.symbol ? ` ${r.symbol}()` : '';
    text += `${indent}← ${r.file}:L${r.line}${sym}\n`;
    if (r.callers && depth < 3) {
      text += formatGraph(root, r.callers, direction, depth + 1);
    }
  }
  return text;
}

export default {
  name: 'smart_code_call_graph',
  category: 'standard',
  description: `Trace function call relationships across your codebase. Use when: need to understand who calls a function (callers) or what a function calls (callees), before refactoring or debugging.

Supports configurable depth (1-3 levels) and cross-file tracking. Cannot determine callees precisely without AST parsing (Phase 10/Tree-sitter upgrade planned).`,
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'File containing the target symbol' },
      symbol: { type: 'string', description: 'Function/class name to trace' },
      direction: { type: 'string', enum: ['callers', 'callees'], description: 'Trace direction: callers (who calls it) or callees (what it calls). Default: callers' },
      depth: { type: 'number', description: 'Recursion depth (1-3, default: 1)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: ['file', 'symbol'],
  },
  handler: async (args) => {
    const root = args.root || process.cwd();
    const absPath = resolve(root, args.file);
    if (!existsSync(absPath)) {
      return `File not found: ${args.file} (resolved: ${absPath})`;
    }

    const bridge = getLspBridge(root);
    const direction = args.direction || 'callers';
    const depth = Math.min(args.depth || 1, 3);
    const visited = new Set();

    const callers = await buildGraph(
      bridge, args.file, args.symbol, direction,
      1, depth, visited, root
    );

    const output = {
      root: { file: args.file, symbol: args.symbol },
      direction,
      depth,
      [direction]: callers,
    };

    if (args.format === 'json') {
      return JSON.stringify(output, null, 2);
    }

    // Text format
    let text = `Call Graph: ${args.symbol}() in ${args.file}\n`;
    text += `Direction: ${direction}  Depth: ${depth}\n`;
    text += '─'.repeat(50) + '\n';

    if (callers.length === 0) {
      text += `No ${direction} found.`;
      return text;
    }

    text += `${direction === 'callers' ? 'Called by:' : 'Calls:'}\n`;
    text += formatGraph(null, callers, direction, 0);

    return text;
  },
};
