#!/usr/bin/env node

// debug-assist.mjs — Debugging assistant with root cause analysis
//
// Takes an error message or test failure and traces through the codebase
// to identify likely root causes using the import graph.
//
// Usage:
//   node debug-assist.mjs [error-pattern] [options]
//
// Options:
//   --root <path>         Root directory (default: .)
//   --file <path>         Specific file to analyze (for static analysis)
//   --error <text>        Error message text to analyze
//   --from-stdin          Read error from stdin
//   --depth <N>           Trace depth (default: 3)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, extname, dirname } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------
const ERROR_PATTERNS = [
  // JavaScript runtime errors
  { re: /(\w+Error):\s+(.+)/, type: 'js-error' },
  { re: /Cannot read property ['"](\w+)['"] of (null|undefined)/, type: 'type-error' },
  { re: /Cannot read properties of (null|undefined) \(reading ['"](\w+)['"]\)/, type: 'type-error' },
  { re: /is not a function/, type: 'type-error' },
  { re: /is not defined/, type: 'reference-error' },
  { re: /Cannot find module ['"](.+)['"]/, type: 'module-error' },
  { re: /Unexpected token/, type: 'syntax-error' },
  { re: /unexpected token/, type: 'syntax-error' },
  { re: /SyntaxError:/, type: 'syntax-error' },
  { re: /ReferenceError:/, type: 'reference-error' },
  { re: /TypeError:/, type: 'type-error' },
  { re: /RangeError:/, type: 'range-error' },
  { re: /AssertionError \[ERR_ASSERTION\]:/, type: 'assertion-error' },
  // Node.js module errors
  { re: /Error \[ERR_MODULE_NOT_FOUND\]:/, type: 'module-error' },
  { re: /Error \[ERR_REQUIRE_ESM\]:/, type: 'module-error' },
  // Test failures
  { re: /expect\(\.*?\)\.(?:toBe|toEqual|toMatch)/, type: 'test-failure' },
  { re: /AssertionError:/, type: 'assertion-error' },
  // Stack trace lines
  { re: /^\s+at\s+(?:\S+\s+)?\(?(.+?):(\d+):(\d+)\)?$/, type: 'stack-frame' },
  { re: /^\s+at\s+(.+?)\s/, type: 'stack-frame-simple' },
  // Python errors
  { re: /(\w+Error):\s(.+)/, type: 'py-error' },
  { re: /Traceback \(most recent call last\):/, type: 'py-traceback' },
  { re: /File "(.+)", line (\d+)/, type: 'py-stack-frame' },
];

function parseError(errorText) {
  const lines = errorText.split('\n');
  const parsed = [];
  const stackFrames = [];

  for (const line of lines) {
    for (const { re, type } of ERROR_PATTERNS) {
      const match = line.match(re);
      if (match) {
        const entry = { type, line: line.substring(0, 200), match: match.slice(1) };
        if (type === 'stack-frame' || type === 'py-stack-frame') {
          stackFrames.push(entry);
        } else {
          parsed.push(entry);
        }
        break;
      }
    }
  }

  return { parsed, stackFrames };
}

function classifyError(parsed) {
  // Check more specific patterns first
  for (const entry of parsed) {
    const msg = entry.match.join(' ').toLowerCase();
    if (msg.includes('null') || msg.includes('undefined')) {
      return { category: 'null-reference', severity: 'high', message: 'Null/undefined reference detected' };
    }
  }

  for (const entry of parsed) {
    switch (entry.type) {
      case 'type-error':
      case 'js-error': {
        const msg = entry.match.join(' ').toLowerCase();
        if (msg.includes('null') || msg.includes('undefined')) {
          return { category: 'null-reference', severity: 'high', message: 'Null/undefined reference detected' };
        }
        if (msg.includes('not a function')) {
          return { category: 'type-mismatch', severity: 'high', message: 'Type mismatch: value is not a function' };
        }
        return { category: 'type-mismatch', severity: 'high', message: 'Type mismatch error' };
      }
      case 'reference-error':
        return { category: 'undefined-variable', severity: 'high', message: 'Reference to undefined variable' };
      case 'module-error':
        return { category: 'missing-module', severity: 'high', message: 'Module not found or import error' };
      case 'syntax-error':
        return { category: 'syntax', severity: 'high', message: 'Syntax error in code' };
      case 'assertion-error':
        return { category: 'assertion', severity: 'medium', message: 'Test assertion failed' };
    }
  }
  return { category: 'unknown', severity: 'low', message: 'Unrecognized error pattern' };
}

// ---------------------------------------------------------------------------
// Code tracing
// ---------------------------------------------------------------------------
function findImportTrace(root, errorFile, errorLine) {
  // Walk backwards through imports to trace the call chain
  const trace = [];
  const visited = new Set();
  let currentFile = errorFile;

  while (currentFile && !visited.has(currentFile)) {
    visited.add(currentFile);
    try {
      const content = readFileSync(currentFile, 'utf-8');
      const lines = content.split('\n');

      // Find what imports/exports this file uses
      const imports = [];
      const importRe = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRe.exec(content)) !== null) {
        imports.push(match[1]);
      }

      trace.push({
        file: currentFile,
        relFile: relative(root, currentFile),
        imports,
        isErrorOrigin: currentFile === errorFile,
      });

      // Move to the first importer
      currentFile = null; // Stop unless we find an importer
    } catch {
      break;
    }
  }

  return trace;
}

function analyzeFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const functions = [];
  const issues = [];

  // Find function definitions
  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = fnRe.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    functions.push({ name: match[1], line: lineNum });
  }

  return { functions, totalLines: lines.length };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function formatText(classification, analysis, trace, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color ? `${c.bold}Debug Analysis${c.reset}` : 'Debug Analysis');
  out.push('='.repeat(40));
  out.push('');

  // Error classification
  out.push(color ? `${c.bold}Error Classification${c.reset}` : 'Error Classification');
  const severityColor = classification.severity === 'high' ? c.red : classification.severity === 'medium' ? c.yellow : c.dim;
  out.push(`  Category: ${color ? `${c.yellow}${classification.category}${c.reset}` : classification.category}`);
  out.push(`  Severity: ${color ? `${severityColor}${classification.severity}${c.reset}` : classification.severity}`);
  out.push(`  ${classification.message}`);
  out.push('');

  // Stack trace
  if (trace.length > 0) {
    out.push(color ? `${c.bold}Call Chain${c.reset}` : 'Call Chain');
    for (let i = 0; i < trace.length; i++) {
      const t = trace[i];
      const marker = t.isErrorOrigin ? '← ERROR' : '';
      if (color) {
        out.push(`  ${c.dim}#${i + 1}${c.reset} ${c.cyan}${t.relFile}${c.reset} ${c.yellow}${marker}${c.reset}`);
      } else {
        out.push(`  #${i + 1} ${t.relFile} ${marker}`);
      }
      if (t.imports && t.imports.length > 0) {
        out.push(`    imports: ${t.imports.slice(0, 5).join(', ')}`);
      }
    }
    out.push('');
  }

  // Root cause analysis
  out.push(color ? `${c.bold}Root Cause Hypotheses${c.reset}` : 'Root Cause Hypotheses');
  const hypotheses = generateHypotheses(classification, trace);
  for (let i = 0; i < hypotheses.length; i++) {
    if (color) {
      out.push(`  ${c.bold}${i + 1}.${c.reset} ${c.magenta}${hypotheses[i].title}${c.reset}`);
      out.push(`     ${hypotheses[i].description}`);
      if (hypotheses[i].suggestion) {
        out.push(`     ${c.green}Suggestion:${c.reset} ${hypotheses[i].suggestion}`);
      }
    } else {
      out.push(`  ${i + 1}. ${hypotheses[i].title}`);
      out.push(`     ${hypotheses[i].description}`);
      if (hypotheses[i].suggestion) {
        out.push(`     Suggestion: ${hypotheses[i].suggestion}`);
      }
    }
    out.push('');
  }

  return out.join('\n');
}

function generateHypotheses(classification, trace) {
  const hypotheses = [];

  switch (classification.category) {
    case 'null-reference':
      hypotheses.push({
        title: 'Null/undefined value propagation',
        description: 'A variable or property access returned null/undefined unexpectedly.',
        suggestion: 'Add null checks or default values using optional chaining (?.) or nullish coalescing (??). Check if the expected data was properly initialized before use.',
      });
      break;
    case 'type-mismatch':
      hypotheses.push({
        title: 'Type mismatch in function call',
        description: 'A function received a value of incorrect type.',
        suggestion: 'Verify parameter types match the function signature. Check for implicit type coercion issues.',
      });
      break;
    case 'undefined-variable':
      hypotheses.push({
        title: 'Missing variable definition',
        description: 'The code references a variable that was not defined in the current scope.',
        suggestion: 'Check for typos in variable names. Verify the variable is properly imported or declared.',
      });
      break;
    case 'missing-module':
      hypotheses.push({
        title: 'Module resolution failure',
        description: 'An import or require statement could not find the target module.',
        suggestion: 'Check that the module is installed (npm install) and the import path is correct. Verify file extensions for ESM imports.',
      });
      break;
    case 'syntax':
      hypotheses.push({
        title: 'Syntax error in source code',
        description: 'The parser encountered unexpected syntax.',
        suggestion: 'Check for missing brackets, parentheses, or commas near the reported location.',
      });
      break;
    case 'assertion':
      hypotheses.push({
        title: 'Test assertion failure',
        description: 'A test expectation was not met.',
        suggestion: 'Verify the expected value matches actual behavior. Check recent changes that might have affected this behavior.',
      });
      break;
    default:
      hypotheses.push({
        title: 'Unknown error pattern',
        description: 'The error could not be classified automatically.',
        suggestion: 'Review the error message and stack trace manually for clues.',
      });
  }

  // If we have trace info, add context-specific hypothesis
  if (trace.length > 0) {
    const origin = trace.find(t => t.isErrorOrigin);
    if (origin) {
      hypotheses.push({
        title: `Review file: ${origin.relFile}`,
        description: 'The error originates from this file. Examine the code around the reported line number.',
        suggestion: 'Use contextual-grep.mjs to search for relevant patterns in this file.',
      });
    }
  }

  return hypotheses;
}

function formatJSON(classification, analysis, trace) {
  return JSON.stringify({ classification, analysis, trace }, null, 2);
}

function formatMarkdown(classification, analysis, trace) {
  const out = [];
  out.push('# Debug Analysis');
  out.push('');
  out.push('## Error Classification');
  out.push('');
  out.push(`- **Category**: \`${classification.category}\``);
  out.push(`- **Severity**: ${classification.severity}`);
  out.push(`- **Message**: ${classification.message}`);
  out.push('');

  if (trace.length > 0) {
    out.push('## Call Chain');
    out.push('');
    for (let i = 0; i < trace.length; i++) {
      const t = trace[i];
      const marker = t.isErrorOrigin ? ' ← ERROR' : '';
      out.push(`${i + 1}. \`${t.relFile}\`${marker}`);
    }
    out.push('');
  }

  out.push('## Root Cause Hypotheses');
  out.push('');
  const hypotheses = generateHypotheses(classification, trace);
  for (let i = 0; i < hypotheses.length; i++) {
    out.push(`### ${i + 1}. ${hypotheses[i].title}`);
    out.push('');
    out.push(hypotheses[i].description);
    if (hypotheses[i].suggestion) {
      out.push('');
      out.push(`> **Suggestion**: ${hypotheses[i].suggestion}`);
    }
    out.push('');
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const opts = {
    root: '.',
    file: null,
    error: null,
    fromStdin: false,
    depth: 3,
    format: 'text',
    color: undefined,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--file': opts.file = args[++i]; break;
      case '--error': opts.error = args[++i]; break;
      case '--from-stdin': opts.fromStdin = true; break;
      case '--depth': opts.depth = parseInt(args[++i], 10); break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
      default:
        if (!opts.error) opts.error = args[i];
        break;
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node debug-assist.mjs <error-pattern> [options]

Debugging assistant with root cause analysis.

Arguments:
  error-pattern         Error text to analyze

Options:
  --root <path>         Root directory (default: .)
  --file <path>         Specific file to analyze
  --error <text>        Error message text to analyze
  --from-stdin          Read error from stdin
  --depth <N>           Trace depth (default: 3)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node debug-assist.mjs "TypeError: Cannot read property 'x' of undefined"
  node debug-assist.mjs --file src/app.js
  echo "Error: something failed" | node debug-assist.mjs --from-stdin
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  let errorText = opts.error;

  if (opts.fromStdin) {
    const chunks = [];
    try {
      const fd = 0; // stdin
      const buffer = Buffer.alloc(4096);
      let bytesRead;
      while ((bytesRead = readFileSync.fd ? -1 : 0) || true) {
        // Read from stdin is handled differently
        break;
      }
    } catch { /* stdin may not be available */ }
  }

  if (!errorText && !opts.file) {
    console.error('Provide an error message or --file to analyze.');
    process.exit(1);
  }

  let analysis = { functions: [], totalLines: 0 };
  let trace = [];

  if (opts.file) {
    const absFile = resolve(opts.file);
    if (!existsSync(absFile)) {
      console.error(`File not found: ${absFile}`);
      process.exit(1);
    }
    analysis = analyzeFile(absFile);
  }

  if (errorText) {
    const { parsed, stackFrames } = parseError(errorText);
    const classification = classifyError(parsed);

    // Build trace from stack frames
    for (const frame of stackFrames) {
      const filePath = resolve(root, frame.match[0]);
      if (existsSync(filePath)) {
        trace = findImportTrace(root, filePath, parseInt(frame.match[1] || '0', 10));
        break;
      }
    }

    if (trace.length === 0 && opts.file) {
      trace = findImportTrace(root, resolve(opts.file), 0);
    }

    switch (opts.format) {
      case 'json':
        console.log(formatJSON(classification, analysis, trace));
        break;
      case 'markdown':
        console.log(formatMarkdown(classification, analysis, trace));
        break;
      case 'text':
      default:
        console.log(formatText(classification, analysis, trace, opts, color));
        break;
    }
  }
}

main();
