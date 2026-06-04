#!/usr/bin/env node

// error-diagnose.mjs — Error pattern diagnosis tool
//
// Matches error messages against a knowledge base of known failure patterns
// and returns possible root causes and fixes.
//
// Usage:
//   node error-diagnose.mjs <error-message>
//   node error-diagnose.mjs --file <path>
//   node error-diagnose.mjs --list    # list all known patterns
//
// Options:
//   --file <path>     Read error from file
//   --format <fmt>    Output: text, json, markdown (default: text)
//   --list            List all known error patterns
//   -h, --help        Show help

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_CLI = resolve(__dirname, 'memory-store.mjs');

const HELP = `Usage:
  node error-diagnose.mjs <error-message>
  node error-diagnose.mjs --file <path>
  node error-diagnose.mjs --list

Options:
  --file <path>         Read error from file
  --format <fmt>        Output: text, json, markdown (default: text)
  --list                List all known error patterns
  --no-memory           Skip memory store search (memory search is ON by default)
  --store               After diagnosis, store result to memory store
  --memory-resolution <text>  Resolution text (for --store, defaults to fix suggestion)
  --memory-tools <list>       Comma-separated tools used (for --store)
  --memory-threshold <N>      Memory fuzzy match threshold 0-1 (default: 0.6)
  -h, --help            Show help`;

// ── Failure Knowledge Base ────────────────────────────────────────────────
// Each pattern: { patterns: [regex...], category, title, diagnosis, fix, severity }

const KNOWLEDGE_BASE = [
  // ── Build / Compile ──
  { patterns: [/SyntaxError/i, /Unexpected token/i, /unexpected identifier/i],
    category: 'build', title: 'Syntax Error',
    diagnosis: 'JavaScript/TypeScript syntax error — missing parenthesis, bracket, quote, or comma.',
    fix: 'Check the line and column in the error message. Look for unmatched brackets/quotes or missing commas in objects/arrays.',
    severity: 'high' },

  { patterns: [/Cannot find module/i, /Module not found/i, /MODULE_NOT_FOUND/i],
    category: 'build', title: 'Module Not Found',
    diagnosis: 'Import path is incorrect, or the package is not installed.',
    fix: '1) Check the import path spelling. 2) Run npm install / pip install if a package is missing. 3) Check tsconfig.json paths/exports.',
    severity: 'high' },

  { patterns: [/TS\d+/i, /TypeScript.*error/i, /type.*not assignable/i],
    category: 'build', title: 'TypeScript Type Error',
    diagnosis: 'Type mismatch between expected and actual types.',
    fix: 'Check the type definition against the actual value. Use `as` cast only when certain. Consider updating the type definition.',
    severity: 'medium' },

  { patterns: [/ReferenceError/i, /is not defined/i],
    category: 'build', title: 'Reference Error',
    diagnosis: 'A variable or function was referenced but not declared in the current scope.',
    fix: 'Check spelling and scope. Ensure the variable is declared with const/let/var before use, or imported properly.',
    severity: 'high' },

  // ── Tool Execution ──
  { patterns: [/ETIMEDOUT/i, /timeout/i, /timed out/i],
    category: 'tool', title: 'Tool Timeout',
    diagnosis: 'The tool/command exceeded the allowed execution time.',
    fix: '1) Split the operation into smaller batches. 2) Increase the timeout value. 3) Check if the target service is responsive.',
    severity: 'medium' },

  { patterns: [/command not found/i, /not recognized/i, /is not recognized/i],
    category: 'tool', title: 'Command Not Found',
    diagnosis: 'The command/executable does not exist in PATH or is not installed.',
    fix: '1) Check if the tool is installed. 2) Verify PATH environment variable. 3) Use full path to the executable.',
    severity: 'high' },

  { patterns: [/EACCES/i, /permission denied/i, /EPERM/i],
    category: 'permission', title: 'Permission Denied',
    diagnosis: 'Insufficient permissions to access the file or resource.',
    fix: '1) Run with elevated privileges if needed. 2) Check file ownership. 3) Use an alternate location with write access.',
    severity: 'high' },

  { patterns: [/ENOENT/i, /no such file/i, /does not exist/i],
    category: 'path', title: 'File Not Found',
    diagnosis: 'The specified file or directory path does not exist.',
    fix: '1) Check the path spelling (case-sensitive on some systems). 2) Verify the working directory. 3) Create the directory if needed.',
    severity: 'high' },

  { patterns: [/ECONNREFUSED/i, /connect ECONNREFUSED/i, /connection refused/i],
    category: 'network', title: 'Connection Refused',
    diagnosis: 'The target server/service is not running or not accepting connections.',
    fix: '1) Start the required service. 2) Check the port number. 3) Verify firewall settings.',
    severity: 'high' },

  { patterns: [/fetch failed/i, /network error/i, /ENOTFOUND/i],
    category: 'network', title: 'Network Error',
    diagnosis: 'Failed to fetch resource due to network issues.',
    fix: '1) Check internet connectivity. 2) Verify proxy settings. 3) Try a different registry/mirror for package downloads.',
    severity: 'medium' },

  // ── Lint / Quality ──
  { patterns: [/no-unused-vars/i, /is defined but never used/i],
    category: 'lint', title: 'Unused Variable',
    diagnosis: 'A variable is declared but never referenced.',
    fix: 'Remove the unused variable declaration, or prefix with underscore (_) if intentionally unused.',
    severity: 'low' },

  { patterns: [/no-console/i, /Unexpected console/i],
    category: 'lint', title: 'Console Statement',
    diagnosis: 'A console.log/console.error statement is present.',
    fix: 'Remove console statement or replace with proper logging framework.',
    severity: 'low' },

  { patterns: [/prefer-const/i, /is never reassigned/i],
    category: 'lint', title: 'Prefer const',
    diagnosis: 'A variable declared with let is never reassigned.',
    fix: 'Change `let` to `const`.',
    severity: 'low' },

  { patterns: [/no-var/i, /Unexpected var/i],
    category: 'lint', title: 'No var',
    diagnosis: 'A variable uses var instead of const/let.',
    fix: 'Replace `var` with `const` or `let`.',
    severity: 'low' },

  { patterns: [/unexpected any/i, /no-explicit-any/i],
    category: 'lint', title: 'Unexpected any',
    diagnosis: 'TypeScript `any` type used where a specific type is expected.',
    fix: 'Replace `any` with the appropriate type, or use `unknown` if the type is truly uncertain.',
    severity: 'low' },

  // ── Test ──
  { patterns: [/AssertionError/i, /expected.*to equal/i, /assert.*fail/i, /expect.*received/i],
    category: 'test', title: 'Test Assertion Failed',
    diagnosis: 'A test assertion did not match the expected value.',
    fix: '1) Check the assertion line for expected vs actual values. 2) Review the test logic. 3) Verify the code under test produces correct output.',
    severity: 'medium' },

  { patterns: [/test.*timeout/i, /exceeded.*timeout/i, /async.*timeout/i],
    category: 'test', title: 'Test Timeout',
    diagnosis: 'A test exceeded the allocated time limit, likely due to an async issue.',
    fix: '1) Check for missing await statements. 2) Verify async operations complete properly. 3) Increase test timeout if operation is legitimately slow.',
    severity: 'medium' },

  // ── Git ──
  { patterns: [/merge conflict/i, /CONFLICT/i, /Automatic merge failed/i],
    category: 'git', title: 'Merge Conflict',
    diagnosis: 'Git cannot automatically resolve differences between branches.',
    fix: '1) Open conflicting files. 2) Look for <<<<<<< markers. 3) Manually resolve each conflict. 4) Stage resolved files and continue merge.',
    severity: 'medium' },

  { patterns: [/not a git repository/i, /fatal: not a git repository/i],
    category: 'git', title: 'Not a Git Repository',
    diagnosis: 'The current directory is not initialized as a git repository.',
    fix: 'Run `git init` to initialize, or verify you are in the correct directory.',
    severity: 'low' },
];

// ── Helpers ──

function formatText(results, query) {
  if (results.length === 0) {
    return `No known patterns matched the error:\n  "${query}"\n\nThis error type is not yet in the knowledge base. Consider adding it after resolving.`;
  }
  let out = `Found ${results.length} matching pattern(s):\n\n`;
  for (const r of results) {
    const sev = r.severity === 'high' ? '🔴' : r.severity === 'medium' ? '🟡' : '🟢';
    out += `${sev} [${r.category}] ${r.title}\n`;
    out += `   Diagnosis: ${r.diagnosis}\n`;
    out += `   Fix: ${r.fix}\n\n`;
  }
  return out.trim();
}

function formatJSON(results, query) {
  return JSON.stringify({ query, matches: results, count: results.length }, null, 2);
}

function formatMarkdown(results, query) {
  if (results.length === 0) {
    return `## No Matches\n\nNo known patterns matched:\n\`\`\`\n${query}\n\`\`\`\n`;
  }
  let out = `## Diagnosis Results\n\nMatched ${results.length} pattern(s) for:\n\`\`\`\n${query}\n\`\`\`\n\n`;
  for (const r of results) {
    out += `### ${r.title}\n`;
    out += `- **Category**: ${r.category}\n`;
    out += `- **Severity**: ${r.severity}\n`;
    out += `- **Diagnosis**: ${r.diagnosis}\n`;
    out += `- **Fix**: ${r.fix}\n\n`;
  }
  return out.trim();
}

function listPatterns() {
  let out = `Known Error Patterns (${KNOWLEDGE_BASE.length} total):\n\n`;
  const byCat = {};
  for (const p of KNOWLEDGE_BASE) {
    (byCat[p.category] ??= []).push(p);
  }
  for (const [cat, patterns] of Object.entries(byCat)) {
    const sev = patterns.some(p => p.severity === 'high') ? '🔴' : patterns.some(p => p.severity === 'medium') ? '🟡' : '🟢';
    out += `${sev} ${cat} (${patterns.length} patterns)\n`;
    for (const p of patterns) {
      out += `   - ${p.title}\n`;
    }
    out += '\n';
  }
  return out.trim();
}

// ── Memory Store Integration ──

/**
 * Query the memory store for past resolutions.
 * Spawns memory-store.mjs search as a child process.
 * Returns null if memory store unavailable or no matches.
 */
function queryMemory(errorMessage, threshold) {
  try {
    if (!existsSync(MEMORY_CLI)) return null;
    const result = spawnSync('node', [
      MEMORY_CLI, 'search', errorMessage,
      '--threshold', String(threshold != null ? threshold : 0.6),
      '--format', 'json',
    ], { encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 50 });

    if (result.status !== 0 || !result.stdout) return null;
    const parsed = JSON.parse(result.stdout);
    if (parsed.found && parsed.entries.length > 0) {
      return parsed.entries[0]; // best match
    }
    return null;
  } catch {
    return null; // memory store unavailable
  }
}

/**
 * Store a resolution to the memory store.
 */
function storeToMemory(errorMessage, resolution, tools, category, success) {
  try {
    if (!existsSync(MEMORY_CLI)) return false;
    const args = [
      MEMORY_CLI, 'store', errorMessage,
      '--resolution', resolution,
      '--success', String(success !== false),
    ];
    if (tools) args.push('--tools', tools);
    if (category) args.push('--category', category);

    const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 10 });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get overall category for an error message from KB matches.
 */
function getCategoryFromMatches(matches) {
  if (matches.length === 0) return 'unknown';
  // Return most severe category
  const sevOrder = { high: 0, medium: 1, low: 2 };
  return matches.reduce((a, b) => (sevOrder[a.severity] || 99) < (sevOrder[b.severity] || 99) ? a : b).category;
}

// ── Main ──

function main() {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    exit(0);
  }

  if (args.includes('--list')) {
    console.log(listPatterns());
    exit(0);
  }

  // Memory search is ON by default (Phase 1: auto-search before KB)
  // Pass --no-memory to disable
  const useMemory = !args.includes('--no-memory');
  const doStore = args.includes('--store');
  let memoryThreshold = 0.6;
  const threshIdx = args.indexOf('--memory-threshold');
  if (threshIdx !== -1 && threshIdx + 1 < args.length) {
    memoryThreshold = parseFloat(args[threshIdx + 1]);
  }

  // Extract --store options without consuming them from query
  let memoryResolution = null;
  let memoryTools = null;
  const memResIdx = args.indexOf('--memory-resolution');
  if (memResIdx !== -1 && memResIdx + 1 < args.length) memoryResolution = args[memResIdx + 1];
  const memToolIdx = args.indexOf('--memory-tools');
  if (memToolIdx !== -1 && memToolIdx + 1 < args.length) memoryTools = args[memToolIdx + 1];

  let query = '';
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && fileIdx + 1 < args.length) {
    query = readFileSync(args[fileIdx + 1], 'utf-8');
  } else {
    // Collect positional args, skipping known flags and their values
    const SKIP_FLAGS = new Set(['--file', '--format', '--list', '--no-memory', '--store',
      '--memory-resolution', '--memory-tools', '--memory-threshold']);
    const TAKES_VALUE = new Set(['--file', '--format', '--memory-resolution', '--memory-tools', '--memory-threshold']);
    const parts = [];
    for (let i = 0; i < args.length; i++) {
      if (SKIP_FLAGS.has(args[i])) {
        if (TAKES_VALUE.has(args[i])) i++; // skip flag's value too
        continue;
      }
      if (args[i].startsWith('--') || args[i].startsWith('-')) continue;
      parts.push(args[i]);
    }
    query = parts.join(' ');
  }

  if (!query.trim()) {
    console.error('Error: No error message provided. Pass it as argument or use --file.');
    console.error(HELP);
    exit(1);
  }

  const format = args.includes('--format')
    ? args[args.indexOf('--format') + 1] || 'text'
    : 'text';

  let memoryResult = null;
  let fromMemory = false;

  // Phase 1: Search memory store (if enabled)
  if (useMemory) {
    memoryResult = queryMemory(query, memoryThreshold);
  }

  // Phase 2: Match against knowledge base
  const kbResults = [];
  for (const pattern of KNOWLEDGE_BASE) {
    for (const re of pattern.patterns) {
      if (re.test(query)) {
        kbResults.push({
          category: pattern.category,
          title: pattern.title,
          diagnosis: pattern.diagnosis,
          fix: pattern.fix,
          severity: pattern.severity,
        });
        break;
      }
    }
  }

  // Combine results: if memory hit with high confidence, use it as primary
  let results;
  let sourceNote = '';

  if (memoryResult && memoryResult.similarity >= 0.8) {
    // High confidence memory match — use as primary result
    fromMemory = true;
    results = [{
      category: memoryResult.category || 'unknown',
      title: '📖 From Memory (past resolution)',
      diagnosis: `Similar past error resolved successfully (${(memoryResult.similarity * 100).toFixed(0)}% match):\n  "${(memoryResult.errorMessage || '').slice(0, 200)}"`,
      fix: memoryResult.resolution || (kbResults.length > 0 ? kbResults[0].fix : 'No previous resolution recorded'),
      severity: memoryResult.success !== false ? 'low' : 'medium',
      memoryHit: true,
      memoryId: memoryResult.id,
      memoryTools: memoryResult.toolsUsed || [],
    }];
    // Append KB matches as supplementary
    if (kbResults.length > 0) {
      sourceNote = `\n\nℹ️ KB also matched ${kbResults.length} pattern(s). See details below.`;
    }
  } else if (memoryResult && memoryResult.similarity >= 0.5) {
    // Medium confidence — show memory hint alongside KB results
    results = kbResults.length > 0 ? kbResults : [{
      category: 'unknown',
      title: 'Possible past resolution found',
      diagnosis: `A similar error was seen before (${(memoryResult.similarity * 100).toFixed(0)}% match)`,
      fix: memoryResult.resolution || 'See memory for details',
      severity: 'medium',
      memoryHit: true,
      memoryId: memoryResult.id,
    }];
    if (kbResults.length > 0) {
      sourceNote = `\n\n📖 Memory also has a similar past case (${(memoryResult.similarity * 100).toFixed(0)}% match). Use --store to add this diagnosis.`;
    }
  } else {
    // Use KB results only (or no results)
    results = kbResults;
    if (memoryResult) {
      sourceNote = `\n\nℹ️ Memory has a similar case at ${(memoryResult.similarity * 100).toFixed(0)}% similarity (below ${(memoryThreshold * 100).toFixed(0)}% threshold).`;
    }
  }

  // Phase 3: Store to memory (if enabled)
  if (doStore) {
    const resolution = memoryResolution || (results.length > 0 ? results[0].fix : 'Unknown');
    const category = getCategoryFromMatches(kbResults);
    const tools = memoryTools || 'error-diagnose';
    storeToMemory(query, resolution, tools, category, results.length > 0);
  }

  // Build output
  let output;
  switch (format) {
    case 'json': {
      const jsonResult = {
        query,
        fromMemory,
        memoryHit: memoryResult ? { similarity: memoryResult.similarity, id: memoryResult.id } : null,
        matches: results,
        count: results.length,
        source: memoryResult ? 'memory' : 'knowledge-base',
        stored: doStore,
      };
      output = JSON.stringify(jsonResult, null, 2);
      break;
    }
    case 'markdown': {
      if (results.length === 0) {
        output = `## No Matches\n\nNo known patterns matched:\n\`\`\`\n${query}\n\`\`\`\n${sourceNote}\n`;
      } else {
        let out = `## Diagnosis Results\n\nMatched ${results.length} pattern(s) for:\n\`\`\`\n${query}\n\`\`\`\n\n`;
        out += fromMemory ? `> 📖 **Loaded from memory** — this exact error was resolved before\n\n` : '';
        for (const r of results) {
          out += `### ${r.title}\n`;
          if (r.memoryHit) out += `> memory-id: \`${r.memoryId}\`\n`;
          out += `- **Category**: ${r.category}\n`;
          out += `- **Severity**: ${r.severity}\n`;
          out += `- **Diagnosis**: ${r.diagnosis}\n`;
          out += `- **Fix**: ${r.fix}\n\n`;
        }
        out += sourceNote;
        if (doStore) out += `\n\n_✅ Resolution stored to memory._`;
        output = out.trim();
      }
      break;
    }
    default: {
      output = formatText(results, query);
      if (fromMemory) {
        output = `📖 Loaded from memory (${(memoryResult.similarity * 100).toFixed(0)}% match)\n` +
          `   Past error resolved successfully. Skipping KB analysis.\n\n` + output;
      }
      output += sourceNote;
      if (doStore) output += `\n\n✅ Resolution stored to memory for future lookups.`;
      break;
    }
  }

  console.log(output);
  exit(results.length > 0 ? 0 : 1);
}

main();
