#!/usr/bin/env node

// code-ast.mjs — CLI wrapper for smart_code_ast (handler-based tool)
//
// Extracts AST symbols from a file via LSP bridge.
//
// Usage:
//   node code-ast.mjs <file> [options]
//
// Options:
//   --symbol <name>       Filter by symbol name
//   --kind <kind>         Filter by kind (function, class, interface, type, variable, method, property, enum)
//   --no-recursive        Disable recursive symbol expansion (default: recursive)
//   --format <fmt>        Output: text, json (default: text)
//   --root <path>         Project root (default: .)
//   -h, --help            Show this help

import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help') || args.length === 0 || args[0].startsWith('--')) {
  console.log(`
Usage:
  node code-ast.mjs <file> [options]

Options:
  --symbol <name>       Filter by symbol name
  --kind <kind>         Filter by kind (function, class, interface, type, variable, method, property, enum)
  --no-recursive        Disable recursive symbol expansion
  --format <fmt>        Output: text, json (default: text)
  --root <path>         Project root (default: .)
  -h, --help            Show this help
`);
  process.exit(0);
}

// Parse args
let file = null;
let symbol = null;
let kind = null;
let recursive = true;
let format = 'text';
let root = '.';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--symbol':    symbol = args[++i]; break;
    case '--kind':      kind = args[++i]; break;
    case '--no-recursive': recursive = false; break;
    case '--format':    format = args[++i]; break;
    case '--root':      root = args[++i]; break;
    default:            if (!file) file = args[i];
  }
}

if (!file) {
  console.error('Error: file argument is required');
  process.exit(1);
}

// Import and call handler
import('../plugins/standard/code-ast.mjs').then(mod => {
  const handlerArgs = { file, root: resolve(root), format };
  if (symbol) handlerArgs.symbol = symbol;
  if (kind) handlerArgs.kind = kind;
  if (!recursive) handlerArgs.recursive = false;

  return mod.default.handler(handlerArgs);
}).then(result => {
  console.log(result);
}).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
