#!/usr/bin/env node

// test-runner.mjs — Enhanced test runner with reporting
//
// Discovers and runs tests across the project, reporting results
// with detailed pass/fail/error breakdown.
//
// Usage:
//   node test-runner.mjs [options] [<test-glob>...]
//
// Options:
//   --root <path>         Root directory (default: .)
//   --runner <type>       Test runner: node, mocha, jest, ava (default: auto)
//   --pattern <glob>      Test file pattern (repeatable, default: **/*.test.*)
//   --timeout <ms>        Per-test timeout (default: 30000)
//   --format <fmt>        Output: text, json, tap (default: text)
//   --list                Only list tests, don't run them
//   --fail-fast           Stop on first failure
//   --no-color            Disable color output
//   -h, --help            Show this help

import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Test runners
// ---------------------------------------------------------------------------
function detectRunner(root) {
  if (existsSync(resolve(root, 'node_modules/.bin/jest'))) return 'jest';
  if (existsSync(resolve(root, 'node_modules/.bin/mocha'))) return 'mocha';
  if (existsSync(resolve(root, 'node_modules/.bin/ava'))) return 'ava';
  return 'node';
}

function runNodeTest(filePath, timeout) {
  const start = Date.now();
  try {
    const result = spawnSync('node', ['--test', filePath], {
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const elapsed = Date.now() - start;
    return {
      passed: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      elapsed,
      error: result.error ? result.error.message : null,
    };
  } catch (e) {
    return { passed: false, status: -1, stdout: '', stderr: '', elapsed: Date.now() - start, error: e.message };
  }
}

function runTest(filePath, runner, timeout) {
  switch (runner) {
    case 'node':
      return runNodeTest(filePath, timeout);
    default:
      return runNodeTest(filePath, timeout);
  }
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(results, opts, color) {
  const c = COLORS;
  const out = [];
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  out.push(color
    ? `${c.bold}Test Results${c.reset}`
    : 'Test Results');
  out.push('='.repeat(40));
  out.push('');

  out.push(color
    ? `${c.bold}Summary:${c.reset} ${c.green}${passed.length} passed${c.reset}, ${c.red}${failed.length} failed${c.reset}, ${results.length} total`
    : `Summary: ${passed.length} passed, ${failed.length} failed, ${results.length} total`);
  out.push('');

  for (const result of results) {
    const label = result.passed
      ? (color ? `${c.green}✓${c.reset}` : '✓')
      : (color ? `${c.red}✗${c.reset}` : '✗');
    const elapsed = `${result.elapsed}ms`;

    out.push(`${label} ${result.relFile} ${color ? c.dim + elapsed + c.reset : elapsed}`);

    if (!result.passed) {
      if (result.error) {
        out.push(`  Error: ${result.error}`);
      }
      if (result.stderr) {
        const lines = result.stderr.split('\n').filter(Boolean).slice(0, 5);
        for (const line of lines) {
          out.push(`  ${color ? c.red + line + c.reset : line}`);
        }
      }
      if (result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean).slice(0, 10);
        for (const line of lines) {
          out.push(`  ${line}`);
        }
      }
    }
    out.push('');
  }

  return out.join('\n');
}

function formatJSON(results) {
  return JSON.stringify({
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results: results.map(r => ({
      file: r.relFile,
      passed: r.passed,
      elapsed: r.elapsed,
      error: r.error,
    })),
  }, null, 2);
}

function formatTAP(results) {
  const out = [];
  out.push(`1..${results.length}`);
  results.forEach((r, i) => {
    const status = r.passed ? 'ok' : 'not ok';
    out.push(`${status} ${i + 1} - ${r.relFile}`);
    if (!r.passed && r.error) {
      out.push(`  # ${r.error}`);
    }
  });
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
    runner: null,
    patterns: [],
    timeout: 30000,
    format: 'text',
    list: false,
    failFast: false,
    color: undefined,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--runner': opts.runner = args[++i]; break;
      case '--pattern': opts.patterns.push(args[++i]); break;
      case '--timeout': opts.timeout = parseInt(args[++i], 10); break;
      case '--format': opts.format = args[++i]; break;
      case '--list': opts.list = true; break;
      case '--fail-fast': opts.failFast = true; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
      default:
        if (!args[i].startsWith('--')) {
          opts.patterns.push(args[i]);
        }
        break;
    }
    i++;
  }

  if (opts.patterns.length === 0) {
    opts.patterns = ['**/*.test.{js,mjs}', '**/*.spec.{js,mjs}', '**/test_*.mjs'];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node test-runner.mjs [options] [<test-glob>...]

Enhanced test runner with reporting.

Options:
  --root <path>         Root directory (default: .)
  --runner <type>       Test runner: node, mocha, jest, ava (default: auto)
  --pattern <glob>      Test file pattern (repeatable)
  --timeout <ms>        Per-test timeout (default: 30000)
  --format <fmt>        Output: text, json, tap (default: text)
  --list                Only list tests, don't run them
  --fail-fast           Stop on first failure
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node test-runner.mjs
  node test-runner.mjs --pattern "**/*test*.mjs"
  node test-runner.mjs --list
  node test-runner.mjs --format tap
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  if (!opts.runner) {
    opts.runner = detectRunner(root);
  }

  const exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
  const testFiles = findFiles(root, opts.patterns, exclude);

  if (testFiles.length === 0) {
    console.log('No test files found.');
    return;
  }

  if (opts.list) {
    console.log('Test files:');
    for (const f of testFiles) {
      console.log(`  ${relative(root, f)}`);
    }
    console.log(`\nTotal: ${testFiles.length} file(s)`);
    return;
  }

  const results = [];
  for (const filePath of testFiles) {
    const relFile = relative(root, filePath);
    process.stdout.write(`  Running: ${relFile} ... `);
    const result = runTest(filePath, opts.runner, opts.timeout);
    result.relFile = relFile;
    results.push(result);
    process.stdout.write(result.passed ? 'OK\n' : 'FAIL\n');

    if (!result.passed && opts.failFast) {
      console.log('\nFail-fast: stopping on first failure.');
      break;
    }
  }

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(results));
      break;
    case 'tap':
      console.log(formatTAP(results));
      break;
    case 'text':
    default:
      console.log(formatText(results, opts, color));
      break;
  }

  const failed = results.filter(r => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main();
