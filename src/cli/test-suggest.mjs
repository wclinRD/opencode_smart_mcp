#!/usr/bin/env node

// test-suggest.mjs — Test suggestion engine
//
// Analyzes source code changes and suggests corresponding test cases.
// Can analyze a file, a diff, or compare git changes.
//
// Usage:
//   node test-suggest.mjs <file-path> [options]
//
// Options:
//   --root <path>         Root directory (default: .)
//   --diff               Analyze git diff for the file instead of full content
//   --all                Analyze all files in the project (for generating test plan)
//   --format <fmt>       Output: text, json, markdown (default: text)
//   --no-color           Disable color output
//   -h, --help           Show this help

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, extname, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Code analysis
// ---------------------------------------------------------------------------
function analyzeFunctions(content, ext) {
  const functions = [];
  const lines = content.split('\n');

  // JS/TS patterns
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\))\s*(?:=>)?\s*\{?/g,
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      functions.push({
        name: match[1],
        params: match[2] ? match[2].split(',').map(p => p.trim()).filter(Boolean) : [],
        line: lineNum,
      });
    }
  }

  return functions;
}

function findExistingTests(root, sourceFile) {
  const name = basename(sourceFile).replace(/\.[^.]+$/, '');
  const dir = dirname(sourceFile);
  const testPatterns = [
    resolve(dir, `${name}.test.*`),
    resolve(dir, `${name}.spec.*`),
    resolve(dir, `test_${name}.*`),
    resolve(dir, `__tests__/**`),
    resolve(dir, `test/**/*${name}*`),
  ];

  const found = [];
  function findMatching(pattern) {
    const globPart = pattern.split('*').join('.*');
    // Walk directory to find matching files
    try {
      const entries = readdirSync(dirname(pattern));
      for (const entry of entries) {
        if (entry.includes(name) && (entry.includes('.test.') || entry.includes('.spec.') || entry.includes('test_'))) {
          found.push(resolve(dir, entry));
        }
      }
    } catch { /* ignore */ }
  }

  // Also check common test directories
  const testDirs = [
    resolve(root, 'test'),
    resolve(root, 'tests'),
    resolve(root, '__tests__'),
    resolve(dir, '__tests__'),
  ];
  for (const td of testDirs) {
    if (existsSync(td)) {
      try {
        const entries = readdirSync(td);
        for (const entry of entries) {
          if (entry.includes(name)) found.push(resolve(td, entry));
        }
      } catch { /* ignore */ }
    }
  }

  return [...new Set(found)].filter(f => existsSync(f));
}

function suggestTestCases(functions, existingTests) {
  const suggestions = [];

  for (const fn of functions) {
    // Skip trivial functions
    if (fn.name.startsWith('_') || fn.name === 'main' || fn.name === 'handler') continue;

    const suggestion = {
      function: fn.name,
      params: fn.params,
      line: fn.line,
      hasExistingTest: existingTests.length > 0,
      testCases: [],
    };

    // Suggest basic test cases based on parameters
    if (fn.params.length === 0) {
      suggestion.testCases.push({
        type: 'basic',
        description: `Test that ${fn.name}() executes without error`,
        template: `describe('${fn.name}', () => {
  it('should execute without error', () => {
    ${fn.name}();
  });
});`,
      });
    }

    if (fn.params.length > 0) {
      suggestion.testCases.push({
        type: 'basic',
        description: `Test ${fn.name} with valid inputs`,
        template: `describe('${fn.name}', () => {
  it('should handle valid inputs', () => {
    const result = ${fn.name}(${fn.params.map(p => getSampleValue(p)).join(', ')});
    expect(result).toBeDefined();
  });

  it('should handle edge cases', () => {
    ${fn.params.map(p => `// Test with ${p} = ${getEdgeValue(p)}`).join('\n    ')}
  });
});`,
      });

      // Edge case suggestions
      suggestion.testCases.push({
        type: 'edge',
        description: `Edge cases for ${fn.name}`,
        cases: fn.params.map(p => `  - ${p}: null, undefined, empty, boundary values`),
      });
    }

    // Error handling
    if (fn.params.length > 0) {
      suggestion.testCases.push({
        type: 'error',
        description: `Error handling for ${fn.name}`,
        template: `describe('${fn.name} error handling', () => {
  it('should throw on invalid input', () => {
    ${fn.params.map((p, i) => `// Test with invalid ${p}`).join('\n    ')}
  });
});`,
      });
    }

    suggestions.push(suggestion);
  }

  return suggestions;
}

function getSampleValue(param) {
  if (param.includes('path') || param.includes('file') || param.includes('name')) return `'sample'`;
  if (param.includes('num') || param.includes('count') || param.includes('index') || param.includes('id')) return `0`;
  if (param.includes('flag') || param.includes('enable') || param.includes('is') || param.includes('has')) return `true`;
  if (param.includes('arr') || param.includes('list') || param.includes('items')) return `[]`;
  if (param.includes('obj') || param.includes('cfg') || param.includes('config') || param.includes('opts')) return `{}`;
  if (param.includes('fn') || param.includes('cb') || param.includes('callback') || param.includes('handler')) return `() => {}`;
  return `'test'`;
}

function getEdgeValue(param) {
  if (param.includes('num') || param.includes('count') || param.includes('index')) return `-1, 0, Infinity`;
  if (param.includes('str') || param.includes('name') || param.includes('path')) return `'', very long string`;
  if (param.includes('arr') || param.includes('list') || param.includes('items')) return `[], null`;
  if (param.includes('obj') || param.includes('cfg') || param.includes('config')) return `{}, null`;
  return `null, undefined`;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(suggestions, hasExistingTests, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color ? `${c.bold}Test Suggestions${c.reset}` : 'Test Suggestions');
  out.push('='.repeat(40));
  out.push('');

  if (hasExistingTests) {
    out.push(color
      ? `${c.green}✓ Existing test files found${c.reset}`
      : '✓ Existing test files found');
    out.push('');
  }

  if (suggestions.length === 0) {
    out.push('No testable functions found (or all are private/internal).');
    return out.join('\n');
  }

  for (const s of suggestions) {
    out.push(color
      ? `${c.bold}${c.blue}${s.function}${c.reset}${c.dim} (line ${s.line})${c.reset}`
      : `${s.function} (line ${s.line})`);
    if (s.params.length > 0) {
      out.push(`  params: ${s.params.join(', ')}`);
    }

    for (const tc of s.testCases) {
      if (color) {
        out.push(`  ${c.green}[${tc.type}]${c.reset} ${tc.description}`);
      } else {
        out.push(`  [${tc.type}] ${tc.description}`);
      }

      if (tc.cases) {
        for (const case_ of tc.cases) {
          out.push(`    ${case_}`);
        }
      }

      if (tc.template && opts.format === 'markdown') {
        out.push('');
        out.push('```javascript');
        out.push(tc.template);
        out.push('```');
      }
    }
    out.push('');
  }

  return out.join('\n');
}

function formatJSON(suggestions, hasExistingTests) {
  return JSON.stringify({ hasExistingTests, suggestions }, null, 2);
}

function formatMarkdown(suggestions, hasExistingTests) {
  const out = [];
  out.push('# Test Suggestions');
  out.push('');

  if (hasExistingTests) {
    out.push('> ✅ Existing test files found');
    out.push('');
  }

  if (suggestions.length === 0) {
    out.push('No testable functions found.');
    return out.join('\n');
  }

  for (const s of suggestions) {
    out.push(`## \`${s.function}\` (line ${s.line})`);
    out.push('');
    if (s.params.length > 0) {
      out.push(`**Parameters**: \`${s.params.join('`, `')}\``);
      out.push('');
    }

    for (const tc of s.testCases) {
      out.push(`### ${tc.type}: ${tc.description}`);
      out.push('');
      if (tc.cases) {
        out.push('Edge cases to consider:');
        for (const case_ of tc.cases) {
          out.push(`- ${case_}`);
        }
        out.push('');
      }
      if (tc.template) {
        out.push('```javascript');
        out.push(tc.template);
        out.push('```');
        out.push('');
      }
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function basename(p) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  return parts[parts.length - 1];
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length < 1 ? 1 : 0);
  }

  const opts = {
    filePath: args[0],
    root: '.',
    diff: false,
    all: false,
    format: 'text',
    color: undefined,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--diff': opts.diff = true; break;
      case '--all': opts.all = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node test-suggest.mjs <file-path> [options]

Test suggestion engine.

Arguments:
  file-path             Source file to analyze

Options:
  --root <path>         Root directory (default: .)
  --diff                Analyze git diff instead of full file
  --all                 Analyze all files for test plan
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node test-suggest.mjs src/utils.js
  node test-suggest.mjs src/utils.js --format markdown
  node test-suggest.mjs src/utils.js --root ./project
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  const filePath = resolve(opts.filePath);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch (e) {
    console.error(`Cannot read file: ${e.message}`);
    process.exit(1);
  }

  const ext = extname(filePath);
  const functions = analyzeFunctions(content, ext);

  // Check for existing tests
  const existingTests = findExistingTests(root, filePath);

  // Generate suggestions
  const suggestions = suggestTestCases(functions, existingTests);

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(suggestions, existingTests.length > 0));
      break;
    case 'markdown':
      console.log(formatMarkdown(suggestions, existingTests.length > 0));
      break;
    case 'text':
    default:
      console.log(formatText(suggestions, existingTests.length > 0, opts, color));
      break;
  }
}

main();
