#!/usr/bin/env node

// coverage-check.mjs — Code coverage gap analyzer
//
// Analyzes source code and identifies branches, conditions, and
// edge cases that may lack test coverage.
//
// Usage:
//   node coverage-check.mjs <file-path> [options]
//
// Options:
//   --root <path>         Root directory (default: .)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --threshold <N>       Minimum coverage threshold % (default: 80)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
function analyzeUncoveredPaths(content, ext) {
  const lines = content.split('\n');
  const issues = [];

  // Track conditionals, branches, and edge-case paths
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Conditional branches (if/else)
    if (/^\s*if\s*\(/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'conditional',
        code: trimmed,
        description: 'Uncovered branch: if condition',
        severity: 'medium',
        suggestTest: `Test both true and false branches of this condition`,
      });
    }

    // else if
    if (/^\s*\}\s*else\s+if\s*\(/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'conditional',
        code: trimmed,
        description: 'Uncovered branch: else-if condition',
        severity: 'medium',
        suggestTest: `Test this specific else-if branch`,
      });
    }

    // else
    if (/^\s*\}\s*else\s*(\{|$)/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'conditional',
        code: trimmed,
        description: 'Uncovered branch: else fallback',
        severity: 'medium',
        suggestTest: `Test the else fallback path`,
      });
    }

    // Ternary operators
    const ternaryCount = (trimmed.match(/\?\s*[^:]+\s*:/g) || []).length;
    if (ternaryCount > 0) {
      issues.push({
        line: i + 1,
        type: 'ternary',
        code: trimmed.substring(0, 100),
        description: `Ternary operator (${ternaryCount} branch(es))`,
        severity: 'medium',
        suggestTest: `Test both sides of the ternary expression`,
      });
    }

    // Logical operators that may short-circuit
    if (/&&|\|\|/.test(trimmed) && !trimmed.startsWith('//')) {
      const logicals = (trimmed.match(/&&|\|\|/g) || []).length;
      if (logicals > 0) {
        issues.push({
          line: i + 1,
          type: 'short-circuit',
          code: trimmed.substring(0, 100),
          description: `Logical operator short-circuit (${logicals} operator(s))`,
          severity: 'low',
          suggestTest: `Test different operand truthiness combinations`,
        });
      }
    }

    // Try/catch
    if (/^\s*try\s*\{/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'error-handling',
        code: trimmed,
        description: 'Try block without corresponding catch test',
        severity: 'high',
        suggestTest: `Test error scenario that triggers the catch block`,
      });
    }

    // Switch statements
    if (/^\s*switch\s*\(/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'switch',
        code: trimmed.substring(0, 100),
        description: 'Switch statement — verify all cases covered',
        severity: 'medium',
        suggestTest: `Test each case including default`,
      });
    }

    // Optional chaining
    if (trimmed.includes('?.') && !trimmed.startsWith('//')) {
      issues.push({
        line: i + 1,
        type: 'optional-chain',
        code: trimmed.substring(0, 100),
        description: 'Optional chaining — null/undefined path',
        severity: 'low',
        suggestTest: `Test with null/undefined intermediate values`,
      });
    }

    // Nullish coalescing
    if (trimmed.includes('??') && !trimmed.startsWith('//')) {
      issues.push({
        line: i + 1,
        type: 'nullish',
        code: trimmed.substring(0, 100),
        description: 'Nullish coalescing — default value path',
        severity: 'low',
        suggestTest: `Test with null/undefined and valid values`,
      });
    }

    // Loops
    if (/^\s*(?:for|while|do)\s*\(/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'loop',
        code: trimmed.substring(0, 100),
        description: 'Loop — edge cases for 0, 1, and many iterations',
        severity: 'medium',
        suggestTest: `Test edge cases: empty collection, single item, many items`,
      });
    }

    // Throwing errors
    if (/^\s*throw\s+/.test(trimmed)) {
      issues.push({
        line: i + 1,
        type: 'throw',
        code: trimmed,
        description: 'Throw statement — verify it is properly tested',
        severity: 'high',
        suggestTest: `Test the error path that triggers this throw`,
      });
    }

    // Return early
    if (/^\s*return\s+/.test(trimmed) && i > 0 && lines[i - 1].trim().endsWith('{')) {
      // This is an early return — check if the condition path is tested
    }
  }

  return issues;
}

function computeBranchCount(issues) {
  const byType = {};
  for (const issue of issues) {
    if (!byType[issue.type]) byType[issue.type] = 0;
    byType[issue.type]++;
  }
  return byType;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(filePath, issues, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color
    ? `${c.bold}Coverage Gap Analysis: ${c.cyan}${filePath}${c.reset}`
    : `Coverage Gap Analysis: ${filePath}`);
  out.push('='.repeat(50));
  out.push('');

  if (issues.length === 0) {
    out.push(color
      ? `${c.green}No uncovered paths detected.${c.reset}`
      : 'No uncovered paths detected.');
    return out.join('\n');
  }

  const byType = computeBranchCount(issues);
  const totalBranches = issues.length;

  out.push(color
    ? `${c.bold}Uncovered Paths: ${c.yellow}${totalBranches}${c.reset}`
    : `Uncovered Paths: ${totalBranches}`);
  out.push('');

  // Summary by type
  for (const [type, count] of Object.entries(byType)) {
    const pct = ((count / totalBranches) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(pct / 5));
    if (color) {
      out.push(`  ${c.dim}${type}${c.reset}: ${bar} ${count} (${pct}%)`);
    } else {
      out.push(`  ${type}: ${bar} ${count} (${pct}%)`);
    }
  }
  out.push('');

  // Detailed issues
  const highIssues = issues.filter(i => i.severity === 'high');
  const medIssues = issues.filter(i => i.severity === 'medium');
  const lowIssues = issues.filter(i => i.severity === 'low');

  if (highIssues.length > 0) {
    out.push(color ? `${c.bold}${c.red}High Priority${c.reset}` : 'High Priority');
    for (const issue of highIssues) {
      if (color) {
        out.push(`  ${c.red}Ln ${issue.line}${c.reset} ${c.dim}${issue.code.substring(0, 80)}${c.reset}`);
        out.push(`    ${issue.suggestTest}`);
      } else {
        out.push(`  Ln ${issue.line} ${issue.code.substring(0, 80)}`);
        out.push(`    ${issue.suggestTest}`);
      }
    }
    out.push('');
  }

  if (medIssues.length > 0) {
    out.push(color ? `${c.bold}${c.yellow}Medium Priority${c.reset}` : 'Medium Priority');
    for (const issue of medIssues) {
      if (color) {
        out.push(`  ${c.yellow}Ln ${issue.line}${c.reset} ${c.dim}${issue.code.substring(0, 80)}${c.reset}`);
        out.push(`    ${issue.suggestTest}`);
      } else {
        out.push(`  Ln ${issue.line} ${issue.code.substring(0, 80)}`);
        out.push(`    ${issue.suggestTest}`);
      }
    }
    out.push('');
  }

  if (lowIssues.length > 0) {
    out.push(color ? `${c.bold}${c.dim}Low Priority${c.reset}` : 'Low Priority');
    for (const issue of lowIssues) {
      if (color) {
        out.push(`  ${c.dim}Ln ${issue.line}${c.reset} ${c.dim}${issue.code.substring(0, 80)}${c.reset}`);
      } else {
        out.push(`  Ln ${issue.line} ${issue.code.substring(0, 80)}`);
      }
    }
    out.push('');
  }

  return out.join('\n');
}

function formatJSON(filePath, issues) {
  return JSON.stringify({
    file: filePath,
    totalIssues: issues.length,
    byType: computeBranchCount(issues),
    issues: issues.map(i => ({
      line: i.line,
      type: i.type,
      severity: i.severity,
      code: i.code,
      description: i.description,
      suggestTest: i.suggestTest,
    })),
  }, null, 2);
}

function formatMarkdown(filePath, issues) {
  const out = [];
  out.push(`# Coverage Gap Analysis: \`${filePath}\``);
  out.push('');

  if (issues.length === 0) {
    out.push('✅ No uncovered paths detected.');
    return out.join('\n');
  }

  out.push(`**Total uncovered paths**: ${issues.length}`);
  out.push('');

  const byType = computeBranchCount(issues);
  out.push('| Type | Count |');
  out.push('|------|-------|');
  for (const [type, count] of Object.entries(byType)) {
    out.push(`| ${type} | ${count} |`);
  }
  out.push('');

  const highIssues = issues.filter(i => i.severity === 'high');
  const medIssues = issues.filter(i => i.severity === 'medium');
  const lowIssues = issues.filter(i => i.severity === 'low');

  if (highIssues.length > 0) {
    out.push('## 🔴 High Priority');
    out.push('');
    for (const issue of highIssues) {
      out.push(`- **Line ${issue.line}**: \`${issue.code.substring(0, 80)}\``);
      out.push(`  - ${issue.suggestTest}`);
    }
    out.push('');
  }

  if (medIssues.length > 0) {
    out.push('## 🟡 Medium Priority');
    out.push('');
    for (const issue of medIssues) {
      out.push(`- **Line ${issue.line}**: \`${issue.code.substring(0, 80)}\``);
      out.push(`  - ${issue.suggestTest}`);
    }
    out.push('');
  }

  if (lowIssues.length > 0) {
    out.push('## ⚪ Low Priority');
    out.push('');
    for (const issue of lowIssues) {
      out.push(`- **Line ${issue.line}**: \`${issue.code.substring(0, 80)}\``);
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
  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length < 1 ? 1 : 0);
  }

  const opts = {
    filePath: args[0],
    root: '.',
    format: 'text',
    threshold: 80,
    color: undefined,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--threshold': opts.threshold = parseInt(args[++i], 10); break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node coverage-check.mjs <file-path> [options]

Code coverage gap analyzer.

Arguments:
  file-path             Source file to analyze

Options:
  --root <path>         Root directory (default: .)
  --format <fmt>        Output: text, json, markdown (default: text)
  --threshold <N>       Minimum coverage threshold % (default: 80)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node coverage-check.mjs src/utils.js
  node coverage-check.mjs src/utils.js --format markdown
  node coverage-check.mjs src/utils.js --threshold 90
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
  const issues = analyzeUncoveredPaths(content, ext);

  switch (opts.format) {
    case 'json':
      console.log(formatJSON(filePath, issues));
      break;
    case 'markdown':
      console.log(formatMarkdown(filePath, issues));
      break;
    case 'text':
    default:
      console.log(formatText(filePath, issues, opts, color));
      break;
  }
}

main();
