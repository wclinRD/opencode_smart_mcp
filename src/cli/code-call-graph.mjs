#!/usr/bin/env node

// code-call-graph.mjs — CLI wrapper for smart_code_call_graph (handler-based tool)
//
// Traces call graph relationships for a symbol via LSP bridge.
//
// Usage:
//   node code-call-graph.mjs <file> <symbol> [options]
//
// Options:
//   --direction <dir>    callers or callees (default: callers)
//   --depth <n>          Recursion depth 1-3 (default: 1)
//   --format <fmt>       Output: text, json (default: text)
//   --root <path>        Project root (default: .)
//   -h, --help           Show this help

import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help') || args.length < 2) {
  console.log(`
Usage:
  node code-call-graph.mjs <file> <symbol> [options]

Options:
  --direction <dir>    callers or callees (default: callers)
  --depth <n>          Recursion depth 1-3 (default: 1)
  --format <fmt>       Output: text, json (default: text)
  --root <path>        Project root (default: .)
  -h, --help           Show this help
`);
  process.exit(0);
}

// Parse args
let file = null;
let symbol = null;
let direction = 'callers';
let depth = 1;
let format = 'text';
let root = '.';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--direction': direction = args[++i]; break;
    case '--depth':     depth = parseInt(args[++i], 10); break;
    case '--format':    format = args[++i]; break;
    case '--root':      root = args[++i]; break;
    default:
      if (!file) file = args[i];
      else if (!symbol) symbol = args[i];
  }
}

if (!file || !symbol) {
  console.error('Error: file and symbol arguments are required');
  process.exit(1);
}

// Import and call handler
import('../plugins/standard/code-call-graph.mjs').then(mod => {
  return mod.default.handler({
    file,
    symbol,
    direction,
    depth,
    format,
    root: resolve(root),
  });
}).then(result => {
  console.log(result);
}).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
