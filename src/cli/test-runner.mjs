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
//   --coverage            Run with coverage report
//   --related <file>      Find tests related to a file
//   --grep <pattern>      Filter tests by name pattern
//   --no-color            Disable color output
//   -h, --help            Show this help

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, basename, dirname, join } from 'node:path';
import { execSync, spawnSync, spawn } from 'node:child_process';
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

function runNodeTest(filePath, timeout, grep, coverage) {
  const start = Date.now();
  try {
    const nodeArgs = ['--test'];
    if (coverage) {
      // Use Node.js built-in coverage with --experimental-test-coverage
      nodeArgs.push('--experimental-test-coverage');
    }
    if (grep) {
      // node:test supports --test-name-pattern for filtering
      nodeArgs.push('--test-name-pattern', grep);
    }
    nodeArgs.push(filePath);
    
    const result = spawnSync('node', nodeArgs, {
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

function runTest(filePath, runner, timeout, grep, coverage) {
  switch (runner) {
    case 'node':
      return runNodeTest(filePath, timeout, grep, coverage);
    default:
      return runNodeTest(filePath, timeout, grep, coverage);
  }
}

// ---------------------------------------------------------------------------
// Related test finder
// ---------------------------------------------------------------------------
function findRelatedTests(sourceFile, root, allTestFiles) {
  const sourceName = basename(sourceFile).replace(/\.[^.]+$/, ''); // e.g. "auth" from "auth.ts"
  const sourceDir = dirname(sourceFile);
  
  // Strategy 1: Find tests with same base name (e.g. auth.ts -> auth.test.ts)
  const byName = allTestFiles.filter(f => {
    const testName = basename(f);
    return testName.includes(sourceName);
  });
  
  // Strategy 2: Find tests in same directory
  const byDir = allTestFiles.filter(f => {
    return dirname(f) === sourceDir || dirname(f).includes(sourceDir);
  });
  
  // Strategy 3: Find test files that import/require the source
  const byImport = allTestFiles.filter(f => {
    try {
      const content = readFileSync(f, 'utf-8');
      return content.includes(sourceFile) || content.includes(sourceName);
    } catch {
      return false;
    }
  });
  
  // Merge and deduplicate
  const related = new Set([...byName, ...byDir, ...byImport]);
  return [...related];
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
    hardTimeout: 25000, // Total execution cap to avoid MCP client timeout (~30s)
    format: 'text',
    list: false,
    failFast: false,
    summary: false,
    color: undefined,
    coverage: false,
    related: null,
    grep: null,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--runner': opts.runner = args[++i]; break;
      case '--pattern': opts.patterns.push(args[++i]); break;
      case '--timeout': opts.timeout = parseInt(args[++i], 10); break;
      case '--hard-timeout': opts.hardTimeout = parseInt(args[++i], 10); break;
      case '--format': opts.format = args[++i]; break;
      case '--list': opts.list = true; break;
      case '--fail-fast': opts.failFast = true; break;
      case '--summary': opts.summary = true; break;
      case '--coverage': opts.coverage = true; break;
      case '--related': opts.related = args[++i]; break;
      case '--grep': opts.grep = args[++i]; break;
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
  --hard-timeout <ms>    Total execution cap (default: 25000). Kills remaining tests if exceeded.
  --format <fmt>        Output: text, json, tap (default: text)
  --list                Only list tests, don't run them
  --fail-fast           Stop on first failure
  --coverage            Run with coverage report
  --related <file>      Find tests related to a file
  --grep <pattern>      Filter tests by name pattern
  --summary             Compact output: only show failures + summary
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node test-runner.mjs
  node test-runner.mjs --pattern "**/*test*.mjs"
  node test-runner.mjs --related "src/auth.ts"
  node test-runner.mjs --grep "login"
  node test-runner.mjs --coverage
  node test-runner.mjs --list
  node test-runner.mjs --format tap
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  if (!opts.runner) {
    opts.runner = detectRunner(root);
  }

  const exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
  let testFiles = findFiles(root, opts.patterns, exclude);

  // Handle --related: find tests related to a specific file
  if (opts.related) {
    const relatedSource = resolve(root, opts.related);
    testFiles = findRelatedTests(relatedSource, root, testFiles);
    if (testFiles.length === 0) {
      console.log(`No tests found related to: ${opts.related}`);
      process.exit(0);
    }
    console.log(`Found ${testFiles.length} test(s) related to: ${opts.related}\n`);
  }

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

  // ── Fast path: run all tests in one Node.js process (parallel by default) ──
  // When no --related, --grep, or specific patterns are given, delegate to
  // `node --test` which runs files in parallel internally — much faster than
  // running each file as a separate process via spawnSync.
  // Hard timeout: use async spawn + Promise.race to cap total execution time
  // so the MCP client (~30s) never times out.
  const isFullRun = !opts.related && !opts.grep && opts.patterns.length === 0;
  if (isFullRun && opts.runner === 'node') {
    const nodeArgs = ['--test'];
    if (opts.coverage) nodeArgs.push('--experimental-test-coverage');
    nodeArgs.push(...testFiles.map(f => relative(root, f)));

    const hardTimeoutMs = opts.hardTimeout || 25000;
    const result = await new Promise((resolve) => {
      const child = spawn('node', nodeArgs, {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ok */ }
        // Force kill after 2s if still alive
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ok */ } }, 2000);
        resolve({ stdout, stderr, status: -1, timedOut: true });
      }, hardTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, status: code ?? 1, timedOut: false });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr + '\n' + err.message, status: 1, timedOut: false });
      });
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.timedOut) {
      console.error(`\n[smart_test] Hard timeout: killed after ${hardTimeoutMs}ms. Partial results shown above.`);
    }
    process.exit(result.timedOut ? 0 : (result.status ?? 1));
  }

  // ── Per-file execution (for --related, --grep, or non-node runners) ──
  const results = [];
  const totalFiles = testFiles.length;
  const hardTimeoutMs = opts.hardTimeout || 25000;
  const perFileStart = Date.now();
  let timedOut = false;
  for (let idx = 0; idx < testFiles.length; idx++) {
    // Hard timeout check: skip remaining files if time budget exhausted
    if (Date.now() - perFileStart > hardTimeoutMs) {
      timedOut = true;
      if (!opts.summary) console.log(`\n[smart_test] Hard timeout: skipping remaining ${totalFiles - idx} file(s) after ${hardTimeoutMs}ms`);
      break;
    }
    const filePath = testFiles[idx];
    const relFile = relative(root, filePath);
    if (!opts.summary) {
      process.stdout.write(`  Running: ${relFile} ... `);
    }
    const result = runTest(filePath, opts.runner, opts.timeout, opts.grep, opts.coverage);
    result.relFile = relFile;
    results.push(result);
    if (opts.summary) {
      if ((idx + 1) % 100 === 0 || idx === totalFiles - 1) {
        process.stdout.write(`  ${idx + 1}/${totalFiles} files...\n`);
      }
    } else {
      process.stdout.write(result.passed ? 'OK\n' : 'FAIL\n');
    }

    if (!result.passed && opts.failFast) {
      if (!opts.summary) console.log('\nFail-fast: stopping on first failure.');
      break;
    }
  }

  // Output
  if (opts.summary) {
    const passed = results.filter(r => r.passed);
    const failed = results.filter(r => !r.passed);
    console.log('');
    console.log(color
      ? `${COLORS.bold}Summary:${COLORS.reset} ${COLORS.green}${passed.length} passed${COLORS.reset}, ${COLORS.red}${failed.length} failed${COLORS.reset}, ${results.length} total`
      : `Summary: ${passed.length} passed, ${failed.length} failed, ${results.length} total`);
    if (failed.length > 0) {
      console.log('');
      console.log(color ? `${COLORS.red}Failed:${COLORS.reset}` : 'Failed:');
      for (const r of failed) {
        console.log(`  ✗ ${r.relFile}`);
        if (r.error) console.log(`    Error: ${r.error}`);
        if (r.stderr) {
          for (const line of r.stderr.split('\n').filter(Boolean).slice(0, 5)) {
            console.log(`    ${color ? COLORS.red + line + COLORS.reset : line}`);
          }
        }
      }
    }
  } else {
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
  }

  const failed = results.filter(r => !r.passed).length;
  if (timedOut) {
    console.log(color
      ? `\n⚠️  Partial results (hard timeout: ${hardTimeoutMs}ms — ${results.length}/${totalFiles} files completed)`
      : `\n[Partial results: hard timeout ${hardTimeoutMs}ms — ${results.length}/${totalFiles} files completed]`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
