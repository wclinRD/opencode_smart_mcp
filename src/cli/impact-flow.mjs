#!/usr/bin/env node

// impact-flow.mjs — CLI wrapper for smart_impact_flow (handler-based tool)
//
// Analyzes change impact via CKG call graph — supports diff or file-based input.
//
// Usage:
//   node impact-flow.mjs (--diff <git-diff> | --files <file1,file2,...>) [options]
//
// Options:
//   --diff <text>         Git diff text to analyze
//   --files <csv>         Comma-separated file paths
//   --symbols <csv>       Comma-separated symbol names (used with --files)
//   --depth <n>           Impact depth 1-3 (default: 2)
//   --no-predict-tests    Disable test file prediction (default: predict)
//   --format <fmt>        Output: text, json (default: text)
//   --root <path>         Project root (default: .)
//   -h, --help            Show this help

import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help') || args.length < 2) {
  console.log(`
Usage:
  node impact-flow.mjs (--diff <git-diff> | --files <file1,file2,...>) [options]

Options:
  --diff <text>         Git diff text to analyze
  --files <csv>         Comma-separated file paths
  --symbols <csv>       Comma-separated symbol names (used with --files)
  --depth <n>           Impact depth 1-3 (default: 2)
  --no-predict-tests    Disable test file prediction
  --format <fmt>        Output: text, json (default: text)
  --root <path>         Project root (default: .)
  -h, --help            Show this help
`);
  process.exit(0);
}

// Parse args
let diff = null;
let files = null;
let symbols = null;
let depth = 2;
let predictTests = true;
let format = 'text';
let root = '.';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--diff':        diff = args[++i]; break;
    case '--files':        files = args[++i]; break;
    case '--symbols':     symbols = args[++i]; break;
    case '--depth':       depth = parseInt(args[++i], 10); break;
    case '--no-predict-tests': predictTests = false; break;
    case '--format':      format = args[++i]; break;
    case '--root':        root = args[++i]; break;
  }
}

if (!diff && !files) {
  console.error('Error: either --diff or --files is required');
  process.exit(1);
}

// Build handler args
const handlerArgs = { depth, predictTests, format, root: resolve(root) };
if (diff) handlerArgs.diff = diff;
if (files) handlerArgs.files = files.split(',').map(s => s.trim());
if (symbols) handlerArgs.symbols = symbols.split(',').map(s => s.trim());

// Import and call handler
import('../plugins/standard/impact-flow.mjs').then(mod => {
  return mod.default.handler(handlerArgs);
}).then(result => {
  console.log(result);
}).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
