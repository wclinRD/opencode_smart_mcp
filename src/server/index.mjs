#!/usr/bin/env node

// smart-mcp.mjs — MCP server with plugin tool architecture
//
// Architecture:
//   tools/core/     → 5 native MCP tools (always visible in tools/list)
//   tools/standard/ → 18 tools behind smart_run router (on-demand)
//   tool-loader.mjs → auto-discovers and loads all tool plugins
//
// Protocol: JSON-RPC 2.0 over stdio (MCP standard transport)
//
// Usage in opencode.json:
//   "mcp": {
//     "smart": {
//       "type": "local",
//       "command": ["node", "/path/to/smart-mcp.mjs"],
//       "enabled": true
//     }
//   }
//
// Adding a new tool: create tools/standard/xxx.mjs → restart → done

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, env } from 'node:process';
import { argv } from 'node:process';
import { toolMap, nativeTools, routerTools } from './loader.mjs';
import { ContextManager } from '../lib/context-manager.mjs';
import { optimizeOutputSync } from '../lib/output-optimizer.mjs';
import { getDefaultCache } from '../lib/cache-manager.mjs';
import { createPipeline, optimizeOutput as pipelineOptimize } from '../lib/output-pipeline.mjs';
import { isStructuredError } from '../lib/safe-handler.mjs';
import { getContextBudget, resetContextBudget } from '../lib/context-budget.mjs';
import { parseJson as lenientParseJson } from '../lib/lenient-json.mjs';
import { judgeHallucination, isHighRiskOutput } from '../lib/hallucination-judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration & debug mode
// ---------------------------------------------------------------------------
const DEBUG = env.DEBUG === 'smart' || env.DEBUG === 'smart-mcp' || argv.includes('--debug');
const MAX_OUTPUT_SIZE = 512 * 1024;
const MAX_OUTPUT_CHARS = 200_000;
const TOOL_TIMEOUT = 30_000;

function debugLog(...args) {
  if (DEBUG) stderr.write(`[smart-mcp] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
}

debugLog('Server starting, plugins loaded:', toolMap.size, 'tools');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;
const pendingCalls = new Map();

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  debugLog(`Shutdown: ${signal}`);
  for (const [id, controller] of pendingCalls) { controller.abort(); pendingCalls.delete(id); }
  setTimeout(() => { debugLog('Shutdown complete'); process.exit(0); }, 500).unref();
}

// ---------------------------------------------------------------------------
// Usage stats
// ---------------------------------------------------------------------------
const stats = { startTime: Date.now(), totalCalls: 0, totalErrors: 0, totalDurationMs: 0, byTool: new Map(), memoryAutoStoreCount: 0, memoryPreCheckCount: 0, memoryPreCheckHitCount: 0, memoryPreCheckSavedMs: 0, autoExtractCount: 0 };

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------
const contextManager = new ContextManager({ autoSave: true, extractFindings: true });
let contextInitialized = false;
let memoryInjected = false; // Phase 10.5: auto-inject once per session

const MEMORY_PATH = env.SMART_MEMORY_PATH || join(homedir(), '.smart', 'memory', 'resolutions.json');

/**
 * Phase 10.5: Auto Memory Injection.
 * Reads memory store JSON directly and injects top entries (skill_patches
 * first, then by hitCount + recency) as accumulated findings.
 * Fire-and-forget: called once after first context init, non-blocking.
 */
function autoInjectMemory() {
  if (memoryInjected) return;
  try {
    if (!existsSync(MEMORY_PATH)) return;
    const raw = readFileSync(MEMORY_PATH, 'utf-8');
    const memory = JSON.parse(raw);
    if (!Array.isArray(memory.entries) || memory.entries.length === 0) return;

    // Score: skill_patches always first, then by hitCount + recency
    const now = Date.now();
    const scored = memory.entries.map(e => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
      const recencyScore = ts > 0 ? Math.max(0, 1 - (now - ts) / 864000000) : 0; // decay over 10 days
      const typeBonus = e.type === 'skill_patch' ? 100 : 0;
      const hitScore = (e.hitCount || 1) * 10;
      return { ...e, score: typeBonus + hitScore + recencyScore * 20 };
    });
    scored.sort((a, b) => b.score - a.score);

    const topEntries = scored.slice(0, 3);
    const findings = topEntries.map(e => ({
      source: 'memory',
      finding: e.type === 'skill_patch'
        ? `🧠 ${e.targetSkill || 'general'}: ${(e.behaviorChange || e.errorMessage || '').slice(0, 200)}`
        : `🧠 ${e.category}: ${(e.errorMessage || '').slice(0, 100)} → ${(e.resolution || '').slice(0, 100)}`,
      category: 'memory',
      severity: 'low',
    }));

    contextManager.addFindings(findings);
    memoryInjected = true;
    debugLog(`Auto-injected ${findings.length} memory entries`);
  } catch (e) {
    debugLog('Auto memory injection:', e.message);
  }
}

function ensureContext() {
  if (!contextInitialized) {
    contextManager.init({ projectRoot: env.PWD || env.CWD || process.cwd() });
    contextInitialized = true;
    debugLog('Context initialized:', contextManager.get()?.sessionId);
    // Phase 10.5: inject past learnings into new session
    autoInjectMemory();
  }
}

function recordStats(toolName, durationMs, success) {
  stats.totalCalls++;
  if (!success) stats.totalErrors++;
  stats.totalDurationMs += durationMs;
  let e = stats.byTool.get(toolName);
  if (!e) { e = { calls: 0, errors: 0, durationMs: 0 }; stats.byTool.set(toolName, e); }
  e.calls++;
  if (!success) e.errors++;
  e.durationMs += durationMs;
}

function getStatsSummary() {
  const byTool = {};
  for (const [name, s] of stats.byTool) {
    byTool[name] = { calls: s.calls, errors: s.errors, avgMs: s.calls > 0 ? Math.round(s.durationMs / s.calls) : 0 };
  }
  const preCheckHits = stats.memoryPreCheckHitCount;
  const preCheckTotal = stats.memoryPreCheckCount;
  const budget = getContextBudget();
  const budgetStatus = budget.getStatus();
  return {
    uptimeMs: Date.now() - stats.startTime, totalCalls: stats.totalCalls, totalErrors: stats.totalErrors,
    errorRate: stats.totalCalls > 0 ? (stats.totalErrors / stats.totalCalls * 100).toFixed(1) + '%' : '0%',
    avgDurationMs: stats.totalCalls > 0 ? Math.round(stats.totalDurationMs / stats.totalCalls) : 0,
    byTool,
    memory: {
      autoStored: stats.memoryAutoStoreCount,
      autoExtract: stats.autoExtractCount,
      preCheckLookups: preCheckTotal,
      preCheckHits,
      preCheckHitRate: preCheckTotal > 0 ? (preCheckHits / preCheckTotal * 100).toFixed(1) + '%' : '0%',
      preCheckTimeSavedMs: stats.memoryPreCheckSavedMs,
      preCheckAvgSavedMs: preCheckHits > 0 ? Math.round(stats.memoryPreCheckSavedMs / preCheckHits) : 0,
    },
    tokens: {
      estimatedTotal: budgetStatus.estimatedTokens,
      maxBudget: budgetStatus.maxTokens,
      remaining: budgetStatus.remainingTokens,
      usedPct: budgetStatus.usedPct,
      status: budgetStatus.status,
      compressedCalls: budgetStatus.compressedCount,
      savingsChars: budgetStatus.savingsChars,
      savingsPct: budgetStatus.savingsPct,
    },
  };
}

function resetStats() { stats.startTime = Date.now(); stats.totalCalls = 0; stats.totalErrors = 0; stats.totalDurationMs = 0; stats.byTool.clear(); stats.memoryAutoStoreCount = 0; stats.memoryPreCheckCount = 0; stats.memoryPreCheckHitCount = 0; stats.memoryPreCheckSavedMs = 0; stats.autoExtractCount = 0; }

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------
const runtimeConfig = { debug: DEBUG, timeoutMs: TOOL_TIMEOUT, maxOutputSize: MAX_OUTPUT_SIZE, maxOutputChars: MAX_OUTPUT_CHARS };

// ---------------------------------------------------------------------------
// Output optimization (Phase 2: pipeline-based L0/L1/L2 + semantic truncation)
// ---------------------------------------------------------------------------
const _optCache = getDefaultCache();

/**
 * Apply output optimization to tool response text, guided by responsePolicy.
 * Uses the output-pipeline framework with stage-based processing.
 * L0: no optimization (passthrough)
 * L1: lossless compression (JSON field reordering, whitespace normalization)
 * L2: lossy summarization (smart summary keeping critical sections)
 *
 * @param {string} text - original output text
 * @param {object} policy - tool's responsePolicy (or null)
 * @param {object} [opts] - additional options
 *   opts.chain - custom pipeline chain from plugin's responsePipeline
 *   opts.optimize - set false to disable
 * @returns {{ text: string, optimized: boolean, meta: object|null }}
 */
function applyOptimization(text, policy, opts = {}) {
  if (!text || !policy) return { text, optimized: false, meta: null };

  const maxLevel = policy.maxLevel ?? 0;
  if (maxLevel < 1) return { text, optimized: false, meta: null };

  // Skip if caller explicitly disables optimization
  if (opts.optimize === false) return { text, optimized: false, meta: null };

  try {
    // Build pipeline with custom chain from plugin's responsePipeline if provided
    const chain = policy.responsePipeline || null;
    const pipe = createPipeline({
      maxLevel,
      maxChars: 50000,
      chain,
    });

    const result = pipe.run(text);

    if (result.meta._optimized.level > 0) {
      return { text: result.text, optimized: true, meta: result.meta };
    }
  } catch {
    // Best-effort: never fail the response due to optimization error
  }
  return { text, optimized: false, meta: null };
}

// ---------------------------------------------------------------------------
// Harness Engineering: Mechanical Enforcement — error fix suggestions
// Every error includes a fix hint so the agent can self-correct.
// Pattern: "error message" + "Fix: actionable step" + "Try: example"
// ---------------------------------------------------------------------------

/** Per-tool error fixes: toolName → { errorType → fixString } */
const ERROR_FIXES = {
  // -- Generic fallbacks by error class --
  _timeout:    'Scope too broad or task too large. Narrow input (e.g. root="src/") or increase _timeout in args.',
  _syntax:     'Check input format and types. Some params accept limited enum values.',
  _missing:    'Required param missing. Use describe("<tool>") to see the full schema.',
  _notFound:   'Unknown tool or resource. Use help to list all available tools.',
  _exit:       'Tool exited non-zero. Check input validity; some tools need specific environment setup.',
  _cancel:     'Tool was cancelled mid-execution. Partial results may exist.',
  _enforcement:'Prerequisites not met. Follow the instructions in the error message.',

  // -- smart_grep --
  smart_grep: {
    timeout:    'Pattern too broad or root too large. Try: pattern="function\\s+\\w+" with root="src/"',
    syntax:     'Invalid regex. In JSON strings use "\\\\d" for digit, "\\\\.\\*" for dot-star. Try: pattern="function" for simple literal.',
    missing:    'pattern is required. Usage: smart_grep(pattern:"search term", root:"src/")',
  },

  // -- smart_learn --
  smart_learn: {
    missing:    'Need a project directory. Usage: smart_learn(root:"/path/to/project")',
    generic:    'Project may not exist or lacks readable structure. Verify root path.',
  },

  // -- smart_deep_think --
  smart_deep_think: {
    missing:    'topic is required for static/dynamic modes. Usage: smart_deep_think(topic:"your question", template:"analyze")',
    generic:    'Dynamic mode needs an active session. Start one with: smart_deep_think(topic:"...", dynamic:true)',
  },

  // -- smart_security --
  smart_security: {
    generic:   'Provide a valid root. Usage: smart_security(root:"src/", scan:"credentials")',
  },

  // -- smart_test --
  smart_test: {
    generic:   'Need a valid project with test files. Usage: smart_test(root:".")',
  },

  // -- Standard tools (via smart_run) --
  naming: {
    missing:   'file param is required. Usage: smart_run(tool:"naming", args:{file:"src/foo.js"})',
    generic:   'File not found or not readable. Verify path relative to project root.',
  },
  coverage: {
    generic:   'Usage: smart_run(tool:"coverage", args:{file:"src/foo.js", threshold:80})',
  },
  debug: {
    missing:   'error param is required. Usage: smart_run(tool:"debug", args:{error:"TypeError: ...", file:"src/foo.js"})',
  },
  error_diagnose: {
    missing:   'error param is required. Paste the error message. Usage: smart_run(tool:"error_diagnose", args:{error:"..."})',
  },
  test_suggest: {
    missing:   'Need file or diff. Usage: smart_run(tool:"test_suggest", args:{file:"src/foo.js"})',
  },
  git_context: {
    generic:   'Not a git repository or no git history. Run from within a git repo. Usage: smart_run(tool:"git_context")',
  },
  import_graph: {
    generic:   'Usage: smart_run(tool:"import_graph", args:{root:"src/"})',
  },
  diagram: {
    generic:   'Usage: smart_run(tool:"diagram", args:{type:"flowchart", title:"My Diagram"})',
  },
  report: {
    generic:   'Usage: smart_run(tool:"report", args:{type:"coverage", title:"Report"})',
  },
  exa_search: {
    missing:   'query is required. Usage: smart_run(tool:"exa_search", args:{query:"natural language question"})',
  },
  github_search: {
    missing:   'query is required. Usage: smart_run(tool:"github_search", args:{query:"literal code pattern"})',
  },
  planner: {
    missing:   'goal is required. Usage: smart_run(tool:"planner", args:{goal:"what to accomplish"})',
  },
  memory_store: {
    missing:   'command is required (search/add/profile/forget). Usage: smart_run(tool:"memory_store", args:{command:"search", query:"..."})',
  },
  rename_safety: {
    missing:   'name and newName are required. Usage: smart_run(tool:"rename_safety", args:{name:"oldFn", newName:"newFn"})',
  },
  cross_file_edit: {
    missing:   'file, pattern, and replacement are required. Usage: smart_run(tool:"cross_file_edit", args:{file:"src/foo.js", pattern:"old", replacement:"new"})',
  },
  tool_stats: {
    missing:   'command is required (stats/report). Usage: smart_run(tool:"tool_stats", args:{command:"stats"})',
  },
  py_helper: {
    missing:   'command is required (lint/typecheck/test). Usage: smart_run(tool:"py_helper", args:{command:"lint", file:"src/foo.py"})',
  },
  ts_helper: {
    missing:   'command is required (typecheck/lint/test). Usage: smart_run(tool:"ts_helper", args:{command:"typecheck", file:"src/foo.ts"})',
  },
  rs_helper: {
    missing:   'command is required (check/clippy/analyze/fmt). Usage: smart_run(tool:"rs_helper", args:{command:"check", root:"crates/foo"})',
  },
  integrate: {
    missing:   'command is required (list/suggest-commit/generate-pr/diagnose/mcp). Usage: smart_run(tool:"integrate", args:{command:"list"})',
  },
  compose: {
    missing:   'pipeline is required (JSON array). Usage: smart_run(tool:"compose", args:{pipeline:"[{tool:\"smart_grep\", args:{pattern:\"error\"}, mode:\"seq\"}]"})',
  },
};

/**
 * Get fix suggestion for a tool error.
 * @param {string} toolName - short tool name (no smart_ prefix for standard tools)
 * @param {string} errorType - timeout|syntax|missing|notFound|exit|cancel|generic
 * @param {string} [errorMsg] - raw error message, scanned for keywords
 * @returns {string} fix suggestion
 */
function getErrorFix(toolName, errorType, errorMsg = '') {
  // Try per-tool fix first
  const toolFixes = ERROR_FIXES[toolName];
  if (toolFixes) {
    // Exact type match
    if (toolFixes[errorType]) return toolFixes[errorType];
    // Try generic fallback for this tool
    if (toolFixes.generic) return toolFixes.generic;
  }

  // Try the tool's name as a prefix match against known patterns
  // e.g. "smart_grep" matches the first part of ERROR_FIXES.smart_grep keys
  const smartName = toolName.startsWith('smart_') ? toolName : `smart_${toolName}`;
  const smartFixes = ERROR_FIXES[smartName];
  if (smartFixes) {
    if (smartFixes[errorType]) return smartFixes[errorType];
    if (smartFixes.generic) return smartFixes.generic;
  }

  // Scan error message for keywords
  const lower = errorMsg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return ERROR_FIXES._timeout;
  if (lower.includes('syntax') || lower.includes('invalid') || lower.includes('parse')) return ERROR_FIXES._syntax;
  if (lower.includes('required') || lower.includes('missing')) return ERROR_FIXES._missing;
  if (lower.includes('found') || lower.includes('exist') || lower.includes('unknown')) return ERROR_FIXES._notFound;
  if (lower.includes('exit') || lower.includes('status') || lower.includes('non-zero')) return ERROR_FIXES._exit;
  if (lower.includes('cancel')) return ERROR_FIXES._cancel;

  // Ultimate fallback
  return `Check the error message above. Use describe("${toolName}") or help to review tool usage.`;
}

// ---------------------------------------------------------------------------
// Memory auto-store + pre-check (Phase D: Memory Automation)
// ---------------------------------------------------------------------------

const MEMORY_CLI_PATH = resolve(__dirname, '../cli/memory-store.mjs');

/**
 * Auto-classify an error message into a memory category.
 * Uses keyword matching — mirrors error KB categories.
 */
function classifyErrorForMemory(errorMsg) {
  const l = (errorMsg || '').toLowerCase();
  if (l.includes('timeout') || l.includes('timed out')) return 'runtime';
  if (l.includes('syntax') || l.includes('unexpected token') || l.includes('parse')) return 'build';
  if (l.includes('cannot find module') || l.includes('module not found')) return 'build';
  if (l.includes('referenceerror') || l.includes('is not defined')) return 'runtime';
  if (l.includes('test') && (l.includes('fail') || l.includes('assert') || l.includes('expect'))) return 'test';
  if (l.includes('eacces') || l.includes('permission denied') || l.includes('eperm')) return 'permission';
  if (l.includes('enoent') || l.includes('not found') || l.includes('does not exist')) return 'path';
  if (l.includes('econnrefused') || l.includes('connection refused') || l.includes('network')) return 'network';
  if (l.includes('format') || l.includes('lint') || l.includes('prettier') || l.includes('eslint')) return 'lint';
  if (l.includes('git') || l.includes('merge conflict') || l.includes('branch')) return 'git';
  return 'unknown';
}

/**
 * Extract a meaningful error key from tool args + error result.
 * Prioritises explicit error fields, falls back to generic patterns.
 */
function extractErrorKey(toolName, args, result) {
  // Error message from result
  if (result && result.error) return result.error.slice(0, 500);
  // Tool-specific arg patterns that contain the user's intent
  const errorCandidates = ['query', 'error', 'pattern', 'diff', 'file'];
  for (const key of errorCandidates) {
    if (args && args[key] && typeof args[key] === 'string' && args[key].length > 5) {
      return `${toolName} ${key}=${args[key].slice(0, 200)}`;
    }
  }
  return `${toolName} failed`;
}

/**
 * D.1 Auto-Store: Non-blocking write of failed tool result to memory store.
 * Fast async spawn with unref — does NOT block the response.
 */
function autoStoreToMemory(toolName, args, result, errorCategory) {
  stats.memoryAutoStoreCount++;
  try {
    if (!existsSync(MEMORY_CLI_PATH)) return;

    const errorKey = extractErrorKey(toolName, args, result);
    if (!errorKey || errorKey.length < 10) return; // skip noise

    const resolution = `Tool ${toolName} returned error. Fix: ${(result && result.error) ? result.error.split('\n')[0] : 'Check tool args and input.'}`;
    const toolsUsed = toolName;
    const category = errorCategory || classifyErrorForMemory(errorKey);

    const child = spawn('node', [
      MEMORY_CLI_PATH, 'store', errorKey,
      '--resolution', resolution.slice(0, 500),
      '--tools', toolsUsed,
      '--category', category,
      '--success', 'false',
    ], {
      timeout: 3000,
      stdio: 'ignore',
    });
    child.unref();
    setTimeout(() => { try { child.kill(); } catch { /* ok */ } }, 2000).unref();
  } catch {
    // Best-effort — never throw from auto-store
  }
}

/**
 * D.3 Auto-Extract: Non-blocking extraction of skill_patches from accumulated findings.
 * Runs periodically (every N tool calls with sufficient findings) and on session end.
 * Fire-and-forget via spawn + unref — does NOT block the response.
 */
const AUTO_EXTRACT_INTERVAL = 5;    // every N successful tool calls
const AUTO_EXTRACT_MIN_FINDINGS = 3; // minimum findings to bother extracting

function autoExtractSkillPatches(force = false) {
  stats.autoExtractCount++;
  try {
    if (!existsSync(MEMORY_CLI_PATH)) return;

    const findings = contextManager ? contextManager.getFindings() : [];
    if (!findings || findings.length < AUTO_EXTRACT_MIN_FINDINGS) return;

    // Rate-limit: only run every N calls unless forced (session end)
    if (!force && contextManager) {
      const ctx = contextManager.get();
      if (!ctx) return;
      const toolCount = ctx.metadata?.toolCount || 0;
      if (toolCount % AUTO_EXTRACT_INTERVAL !== 0) return;
    }

    // Write findings to temp file for the child process
    const tmpDir = mkdtempSync(join(tmpdir(), 'smart-extract-'));
    const tmpFile = join(tmpDir, 'findings.json');
    writeFileSync(tmpFile, JSON.stringify(findings), 'utf-8');

    const child = spawn('node', [
      MEMORY_CLI_PATH, 'extract',
      '--findings-file', tmpFile,
      '--min-frequency', '2',
    ], {
      timeout: 5000,
      stdio: 'ignore',
    });
    child.unref();
    setTimeout(() => {
      try { child.kill(); } catch { /* ok */ }
      try { import('node:fs').then(fs => fs.rmSync(tmpDir, { recursive: true, force: true })); } catch { /* ok */ }
    }, 3000).unref();
  } catch {
    // Best-effort — never throw from auto-extract
  }
}

/**
 * D.2 Pre-Check: Query memory store for known resolution before tool execution.
 * Returns { found: true, output: string } if high-confidence hit, null otherwise.
 */
function preCheckMemory(toolName, args) {
  stats.memoryPreCheckCount++;
  try {
    if (!existsSync(MEMORY_CLI_PATH)) return null;

    // Extract search query from tool args — what error is the user trying to fix?
    let query = null;
    if (args.error && typeof args.error === 'string') query = args.error;
    else if (args.pattern && typeof args.pattern === 'string') query = args.pattern;
    else if (args.query && typeof args.query === 'string') query = args.query;
    else if (args.diff && typeof args.diff === 'string') query = args.diff;

    if (!query || query.length < 10) return null;

    const result = spawnSync('node', [
      MEMORY_CLI_PATH, 'search', query,
      '--threshold', '0.4',
      '--limit', '3',
      '--format', 'json',
    ], { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 10 });

    if (result.status !== 0 || !result.stdout) return null;

    const parsed = JSON.parse(result.stdout);
    if (!parsed || !parsed.found || !parsed.entries || parsed.entries.length === 0) return null;

    // Check for high-confidence match (similarity ≥ 0.8)
    const topMatch = parsed.entries[0];
    if (topMatch.similarity >= 0.8) {
      stats.memoryPreCheckHitCount++;
      stats.memoryPreCheckSavedMs += 1500; // rough avg saved per tool execution skipped
      return {
        found: true,
        id: topMatch.id,
        score: topMatch.similarity,
        resolution: topMatch.resolution || '(no resolution stored)',
        output: `[Memory Pre-Check: Known resolution found (confidence ${(topMatch.similarity * 100).toFixed(0)}%)]\n\n${topMatch.resolution || '(no resolution stored)'}\n\n(Pre-check skipped tool execution — returned known fix from memory)`,
      };
    }

    return null;
  } catch {
    return null; // best-effort
  }
}

// ---------------------------------------------------------------------------
// Quality Enforcement: High-risk tool call prerequisites (Phase 7 ⑥)
// ---------------------------------------------------------------------------
//
// SYSTEM-LEVEL enforcement — unlike prompt-based quality gates,
// the LLM CANNOT bypass these checks. If prerequisites aren't met,
// the tool returns a structured error telling the LLM what to do first.
//
// Each entry: toolName → { check: (toolHistory) => null|blocked }

const HIGH_RISK_PREREQUISITES = {
  // ── Security fix: require beam search after security scan ──
  'smart_fast_apply': {
    check: (toolHistory) => {
      const recentScans = toolHistory.filter(h => h.tool === 'smart_security' && h.ok).slice(-3);
      if (recentScans.length === 0) return null;
      const latestScanTime = new Date(recentScans[recentScans.length - 1].timestamp).getTime();
      const hasBeamAfter = toolHistory.some(h =>
        h.tool === 'smart_think' && h.args?.mode === 'beam' && h.ok &&
        new Date(h.timestamp).getTime() > latestScanTime
      );
      if (!hasBeamAfter) {
        return { allowed: false, message: '🔒 Quality Gate: Security fix requires multi-path analysis first.\n\nsmart_security found issues this session. Before applying fixes, explore all approaches via beam search:\n\n  smart_think({mode:"beam", thought:"分析安全修復方案...", template:"debug"})\n\nThis ensures you don\'t miss edge cases.' };
      }
      return null;
    },
  },
  // ── Cross-file edit: require import_graph first ──
  'smart_cross_file_edit': {
    check: (toolHistory) => {
      const hasImportGraph = toolHistory.some(h =>
        h.tool === 'smart_import_graph' && h.ok
      );
      if (!hasImportGraph) {
        return { allowed: false, message: '🔒 Quality Gate: Cross-file edit requires import dependency analysis first.\n\nBefore modifying multiple files, understand the import graph:\n\n  ssr({tool:"import_graph", args:{root:"."}})\n\nThis ensures you don\'t miss affected modules.' };
      }
      return null;
    },
  },
};

/**
 * Check high-risk prerequisites before tool execution.
 * @returns {object|null} null = allowed, { allowed:false, message } = blocked
 */
function checkHighRiskPrerequisites(toolName, args) {
  const rule = HIGH_RISK_PREREQUISITES[toolName];
  if (!rule) return null;
  ensureContext();
  const ctx = contextManager.get();
  if (!ctx || !Array.isArray(ctx.toolHistory)) return null;
  return rule.check(ctx.toolHistory);
}

// ---------------------------------------------------------------------------
// smart_run — Router dispatcher for standard tools
// ---------------------------------------------------------------------------

// Compressed description for the router — agent can infer key args at a glance
const ROUTER_DESCRIPTION =
  'Run less-common smart tools by category:\n' +
  '  [analyze] coverage(file,threshold), debug(error), import_graph(root), naming(file)\n' +
  '  [edit]    cross_file_edit(file,pattern,replacement), rename_safety(name,newName)\n' +
  '  [search]  exa_search(query), github_search(query,language)\n' +
  '  [plan]    planner(goal), memory_store(command,query), tool_stats(command)\n' +
  '  [debug]   error_diagnose(error), test_suggest(file,diff)\n' +
  '  [report]  diagram(type,title), report(type,title)\n' +
  '  [code]    py_helper(command), ts_helper(command)\n' +
  '  [meta]    integrate(command), git_context(root)\n' +
  'Reserved: help (list all), describe(name), warmUp(tools[]).\n' +
  'Use help for full schemas, describe(name) for details on one tool.';

const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', description: 'Tool name or reserved command (help/describe/warmUp)' },
    args: { type: 'object', description: 'Tool-specific arguments' },
    timeout: { type: 'number', description: 'Override timeout (ms)' },
  },
  required: ['tool', 'args'],
};

// Build router lookup: name → toolDef
const ROUTER_MAP = new Map(routerTools.map(t => [t.name.replace('smart_', ''), t]));

/**
 * Generate usage hint for a tool (shown on arg error).
 * Extracts arg names + types/enums from schema.
 */
function toolUsage(toolName, def) {
  const parts = [];
  const props = def.inputSchema?.properties || {};
  const required = new Set(def.inputSchema?.required || []);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'format' || k === 'root') continue; // omit common optional
    const label = required.has(k) ? k : `[${k}]`;
    const typeStr = v.enum ? v.enum.join('|') : v.type || 'any';
    parts.push(`${label}:${typeStr}`);
  }
  return `${toolName}(${parts.join(', ')})`;
}

/** Handle smart_run dispatch */
function handleDevtoolRun(id, params, signal, callerArgs) {
  const args = (params?.arguments || {});
  const subTool = String(args.tool || '');
  const subArgs = (args.args || {});
  const timeout = typeof args.timeout === 'number' ? args.timeout : null;

  // Wrapper to capture context for reserved commands that bypass invokeTool
  function capture(subToolName, result) {
    recordStats(`smart_${subToolName}`, 0, result.ok === true);
    ensureContext();
    contextManager.capture(`smart_${subToolName}`, callerArgs || args, result, 0);
    return result;
  }

  // Reserved commands
  if (subTool === 'help') {
    const byCategory = {};
    for (const [name, def] of ROUTER_MAP) {
      const cat = def.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = {};
      byCategory[cat][name] = { description: def.description, schema: def.inputSchema };
    }
    return capture('help', { ok: true, output: JSON.stringify({
      categories: Object.keys(byCategory).sort(),
      tools: byCategory,
      usage: 'smart_run(tool, args, timeout)',
      hint: 'Use describe(name) for detailed schema. Use help for this overview.',
    }, null, 2) });
  }

  if (subTool === 'describe') {
    const target = String(subArgs.name || '');
    const def = ROUTER_MAP.get(target);
    if (!def) return capture('describe', { ok: false, error: `Unknown tool: ${target}. Available: ${[...ROUTER_MAP.keys()].join(', ')}` });
    return capture('describe', { ok: true, output: JSON.stringify({
      name: def.name, category: def.category, description: def.description,
      schema: def.inputSchema,
      usage: toolUsage(target, def),
    }, null, 2) });
  }

  if (subTool === 'warmUp') {
    const targets = (subArgs.tools || []);
    if (!Array.isArray(targets) || targets.length === 0) {
      return capture('warmUp', { ok: false, error: 'warmUp needs tools: string[] in args' });
    }
    const result = { loaded: [], missing: [] };
    for (const t of targets) {
      const def = ROUTER_MAP.get(t);
      if (def) result.loaded.push({ name: t, description: def.description, schema: def.inputSchema, usage: toolUsage(t, def) });
      else result.missing.push(t);
    }
    return capture('warmUp', { ok: true, output: JSON.stringify(result, null, 2) });
  }

  // Dispatch to standard tool — invokeTool handles its own capture
  const def = ROUTER_MAP.get(subTool);
  if (!def) {
    const available = [...ROUTER_MAP.keys()].join(', ');
    const fix = getErrorFix(subTool, 'notFound', `Unknown tool '${subTool}'`);
    return capture(subTool, {
      ok: false,
      error: `Unknown tool '${subTool}'. Available: ${available}. Use help to list all.\nFix: ${fix}`,
    });
  }

  // Auto-validate required args
  const required = def.inputSchema?.required || [];
  const missing = required.filter(k => !(k in (subArgs || {})) && subArgs[k] !== false);
  if (missing.length > 0) {
    const suggestion = toolUsage(subTool.replace('smart_', ''), def);
    const fix = getErrorFix(subTool, 'missing', `Missing required args: ${missing.join(', ')}`);
    return capture(subTool, {
      ok: false,
      error: `Missing required args for '${subTool}': [${missing.join(', ')}]\nUsage: ${suggestion}. Use describe('${subTool}') for full schema.\nFix: ${fix}`,
    });
  }

  // Execute — invokeToolWithRetry captures internally via captureAndReturn
  debugLog('Router dispatch:', subTool, 'args:', JSON.stringify(subArgs));
  const result = invokeToolWithRetry(def, subArgs, timeout || null, signal);
  return result;
}

// ---------------------------------------------------------------------------
// Tool invocation (CLI spawn)
// ---------------------------------------------------------------------------

/**
 * Capture context result and record stats, then return.
 * Shared helper to avoid repeating the capture/record pattern in every return path.
 * Attaches responsePolicy to the result so respond() can apply output optimization.
 */
function captureAndReturn(toolName, args, result, elapsedMs, def) {
  const success = result.ok === true;
  recordStats(toolName, elapsedMs, success);
  ensureContext();
  contextManager.capture(toolName, args, result, elapsedMs);
  // D.1 Auto-Store: non-blocking write failed tool results to memory
  if (!success && toolName !== 'smart_memory_store') {
    autoStoreToMemory(toolName, args, result);
  }
  // D.3 Auto-Extract: periodic skill_patch extraction from findings
  if (success && toolName !== 'smart_memory_store') {
    autoExtractSkillPatches(false);
  }
  // Phase 10.2: Impact Warning — auto-trigger code_impact for multi-file edits
  // Stores promise resolving to impact text (or empty string) so respond() can append it.
  if (success && toolName === 'smart_fast_apply' && result.output) {
    result._pendingImpact = triggerImpactWarning(args);
  }
  // Phase 6: Hallucination Detection — auto-trigger for high-risk tool outputs
  if (success && isHighRiskOutput(toolName) && result.output) {
    result._pendingHallucination = triggerHallucinationCheck(toolName, args, result);
  }
  // Attach responsePolicy + responsePipeline for output optimization downstream
  if (def?.responsePolicy) {
    result._responsePolicy = def.responsePolicy;
    // Include responsePipeline if plugin declared custom pipeline stages
    if (def.responsePipeline) {
      result._responsePipeline = def.responsePipeline;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 10.2: Impact Warning helpers
// ---------------------------------------------------------------------------

/**
 * Extract unique file paths from smart_fast_apply args.
 * Supports all input formats: blocks, changes (hashline), text (unified diff / SEARCH/REPLACE).
 */
function extractFilesFromFastApplyArgs(args) {
  const files = new Set();

  // blocks format (SEARCH/REPLACE, lazy, partial)
  if (Array.isArray(args.blocks)) {
    for (const b of args.blocks) {
      if (b.file) files.add(b.file);
    }
  }

  // changes format (hashline)
  if (Array.isArray(args.changes)) {
    for (const c of args.changes) {
      if (c.file) files.add(c.file);
    }
  }

  // whole-file format
  if (args.whole && args.whole.file) {
    files.add(args.whole.file);
  }

  // text format — try unified diff headers (+++ b/...)
  if (args.text && typeof args.text === 'string') {
    const diffFiles = args.text.match(/^\+\+\+ b\/(.+)$/gm);
    if (diffFiles) {
      for (const line of diffFiles) {
        const f = line.replace(/^\+\+\+ b\//, '').trim();
        if (f) files.add(f);
      }
    }
    // Try SEARCH/REPLACE text format (file: path)
    const srFiles = args.text.match(/^file:\s*(.+)$/gm);
    if (srFiles) {
      for (const line of srFiles) {
        const f = line.replace(/^file:\s*/, '').trim();
        if (f) files.add(f);
      }
    }
  }

  return [...files];
}

/**
 * Fire-and-forget: run code_impact analysis when fast_apply touches >2 files.
 * Appends structured impact warning to result output.
 */
async function triggerImpactWarning(args) {
  try {
    const files = extractFilesFromFastApplyArgs(args);
    if (files.length <= 2) return '';

    const { default: codeImpact } = await import('../plugins/standard/code-impact.mjs');
    if (typeof codeImpact?.handler !== 'function') return '';

    let root = args.root || process.cwd();
    const impactOutput = await codeImpact.handler({ files, root, format: 'text', depth: 1 });

    if (typeof impactOutput === 'string' && impactOutput.length > 0) {
      const impactLines = impactOutput.split('\n').filter(l => l.trim()).length;
      if (impactLines > 1) {
        debugLog(`Impact warning appended (${files.length} files, ${impactLines} lines)`);
        return `\n\n---\n🧩 Impact Warning: ${files.length} files changed. Auto-triggered impact analysis:\n${impactOutput}\n---`;
      }
    }
    return '';
  } catch (e) {
    debugLog('Impact warning error:', e.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Hallucination Detection — post-execution output verification
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: run hallucination check on high-risk tool outputs.
 * Appends structured warning to result output if issues found.
 */
async function triggerHallucinationCheck(toolName, args, result) {
  try {
    if (!isHighRiskOutput(toolName)) return '';

    const output = typeof result.output === 'string' ? result.output : '';
    if (!output || output.length < 50) return '';

    // Extract context from recent tool history
    let context = '';
    ensureContext();
    const ctx = contextManager.get();
    if (ctx && Array.isArray(ctx.toolHistory)) {
      const recent = ctx.toolHistory.slice(-3);
      context = recent
        .filter(h => h.ok && h.output)
        .map(h => `[${h.tool}]: ${String(h.output).slice(0, 500)}`)
        .join('\n');
    }

    const hcResult = judgeHallucination({
      output,
      context,
      query: args.query || '',
      toolName,
      strictness: 5,
    });

    if (hcResult.verdict === 'fail' || hcResult.verdict === 'warn') {
      const failedChecks = hcResult.checks.filter(c => !c.passed).map(c => c.type).join(', ');
      debugLog(`Hallucination check: ${hcResult.verdict} (${hcResult.overallScore}/10) — ${failedChecks}`);
      return `\n\n---\n🛡️ Hallucination Check: ${hcResult.verdict.toUpperCase()} (${hcResult.overallScore}/10)\n${hcResult.summary}\n---`;
    }

    debugLog(`Hallucination check: pass (${hcResult.overallScore}/10)`);
    return '';
  } catch (e) {
    debugLog('Hallucination check error:', e.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Phase 10.3: Error Recovery — Retry + Fallback
// ---------------------------------------------------------------------------

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;  // 0.5s → 1s → 2s
const RETRY_MAX_DELAY_MS = 4000;

/**
 * Transient errors that warrant a retry:
 *   - timeout / ETIMEDOUT
 *   - spawn error (process couldn't launch)
 *   - non-zero exit with empty stdout (process crashed before producing output)
 * Non-transient (won't retry):
 *   - quality enforcement block
 *   - handler error (in-process, deterministic)
 *   - pre-check memory hit (success)
 *   - non-zero exit with output (tool ran but logical failure)
 *   - user cancellation (ABORT_ERR)
 */
function isTransientError(result) {
  if (result == null || result.ok === true) return false;
  const err = result.error || '';
  if (err.includes('timed out') || err.includes('ETIMEDOUT')) return true;
  if (err.includes('Failed to spawn')) return true;
  // Non-zero exit with empty stdout → process crashed (potentially transient)
  // Pattern from invokeTool: "failed: exit <code>[: stderr]"
  if (err.includes('failed: exit ') && !err.includes('cancelled')) return true;
  return false;
}

/**
 * Fallback map: when a CLI tool exhausts retries, try an alternative tool.
 * Key = tool name, Value = { tool: fallbackToolName, argsTransform: (origArgs) => newArgs }
 *   or simple string = fallbackToolName (args passed through as-is).
 */
const FALLBACK_MAP = {
  smart_import_graph: {
    tool: 'smart_grep',
    argsTransform: (args) => ({ pattern: 'import|from|require', root: args.root || '.' }),
  },
  smart_arch_overview: {
    tool: 'smart_learn',
    argsTransform: (args) => ({ root: args.root || '.' }),
  },
};

/**
 * Retry wrapper: invoke tool → on transient error → backoff → retry (max 3)
 * → if exhausted → try fallback from FALLBACK_MAP.
 * @param {import('./tool-loader.mjs').default} def
 * @param {Record<string, unknown>} args
 * @param {number|null} timeoutOverride
 * @param {AbortSignal} [signal]
 */
function invokeToolWithRetry(def, args, timeoutOverride, signal) {
  let lastResult;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    // Increase timeout on retry (longer wait for transient issues)
    const retryTimeout = attempt > 1 && timeoutOverride
      ? Math.min(timeoutOverride * attempt, 60000)
      : timeoutOverride;
    // Skip capture on retry attempts only — first attempt always captures
    const skipCapture = attempt > 1;
    lastResult = invokeTool(def, args, retryTimeout, signal, { skipCapture });
    if (!isTransientError(lastResult)) return lastResult;
    if (attempt < RETRY_MAX_ATTEMPTS) {
      const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS);
      debugLog(`Retry ${attempt}/${RETRY_MAX_ATTEMPTS - 1} for ${def.name} in ${delay}ms`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      if (signal?.aborted) {
        return { ok: false, error: `Tool ${def.name} was cancelled during retry` };
      }
    }
  }

  // All retries exhausted — try fallback
  const fallback = FALLBACK_MAP[def.name];
  if (fallback) {
    const fbDef = toolMap.get(fallback.tool || fallback);
    if (fbDef) {
      const fbArgs = typeof fallback === 'object' && fallback.argsTransform
        ? fallback.argsTransform(args)
        : args;
      debugLog(`Fallback: ${def.name} → ${fbDef.name}`);
      const fbResult = invokeTool(fbDef, fbArgs, timeoutOverride, signal);
      // Annotate the result so LLM knows it's from fallback
      if (!fbResult.ok) {
        return lastResult; // return original error if fallback also fails
      }
      return {
        ...fbResult,
        output: `[Fallback after ${RETRY_MAX_ATTEMPTS}× retry — using ${fbDef.name}]\n${fbResult.output || ''}`,
      };
    }
  }

  return lastResult;
}

/**
 * Invoke a tool — either via direct handler (no spawn) or via `node <cli>.mjs <args>`.
 * @param {import('./tool-loader.mjs').default} def - tool definition
 * @param {Record<string, unknown>} args
 * @param {number|null} timeoutOverride
 * @param {AbortSignal} [signal]
 * @param {{ skipCapture?: boolean }} [opts] - internal options (skipCapture for retry attempts)
 */
function invokeTool(def, args, timeoutOverride, signal, opts = {}) {
  const finalAttempt = !opts.skipCapture;
  const startTime = process.hrtime.bigint();

  // Helper: on retry attempts (skipCapture=true), skip captureAndReturn
  // to avoid polluting stats/context with transient failures.
  const emit = (result, elapsedMs) => {
    if (!finalAttempt) return result;
    return captureAndReturn(def.name, args, result, elapsedMs, def);
  };

  // D.2 Pre-Check: before executing, check memory for known resolution
  // Applies to diagnostic/fix tools where user provides an error description
  const PRECHECK_TOOLS = new Set(['smart_debug', 'smart_test', 'smart_cross_file_edit']);
  if (PRECHECK_TOOLS.has(def.name)) {
    const precheck = preCheckMemory(def.name, args);
    if (precheck) {
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      return emit({ ok: true, output: precheck.output }, elapsedMs);
    }
  }

  // Phase 7 ⑥: Quality Enforcement — check high-risk tool prerequisites
  // If block returns a message, return it as error (LLM must follow instructions)
  const enforcement = checkHighRiskPrerequisites(def.name, args);
  if (enforcement) {
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    return emit({ ok: false, error: enforcement.message }, elapsedMs);
  }

  // Direct handler path — no process spawn overhead
  // Inject context summary into args for handler-based tools
  const contextArgs = contextManager.inject(def.name, args);
  if (typeof def.handler === 'function') {
    debugLog('Handler:', def.name, 'args:', JSON.stringify(contextArgs));
    try {
      const handlerOutput = def.handler(contextArgs);
      // Async handler support (handler returns Promise)
      if (handlerOutput instanceof Promise) {
        debugLog('Handler is async for:', def.name);
        return {
          __async: true,
          promise: handlerOutput,
          toolName: def.name,
          origArgs: args,
          contextArgs,
          startTime,
          _responsePolicy: def.responsePolicy,
        };
      }
      // Handler returns null to signal "fall back to CLI" (e.g. interactive mode)
      if (handlerOutput === null) {
        debugLog('Handler returned null, falling back to CLI for:', def.name);
      } else {
        const output = String(handlerOutput ?? '');
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        if (signal?.aborted) {
          return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
        }
        // Structured error from safe-handler wrapper → route through isError path
        if (isStructuredError(output)) {
          return emit({ ok: false, error: output }, elapsedMs);
        }
        return emit({ ok: true, output }, elapsedMs);
      }
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const fix = getErrorFix(def.name, 'generic', err.message);
      return emit({ ok: false, error: `Handler error in ${def.name}: ${err.message}\nFix: ${fix}` }, elapsedMs);
    }
  }

  const cliPath = def._cliPath;
  if (!cliPath) return emit({ ok: false, error: `No CLI path or handler for ${def.name}` }, 0);

  const cliArgs = def.mapArgs(args);
  const allArgs = [cliPath, ...cliArgs];

  const msTimeout = (typeof timeoutOverride === 'number' && timeoutOverride > 0)
    ? timeoutOverride
    : (typeof args._timeout === 'number' && args._timeout > 0)
      ? args._timeout
      : runtimeConfig.timeoutMs;

  debugLog('Invoke:', def.name, 'args:', JSON.stringify(allArgs));

  // Inject context into environment for CLI tools
  const contextEnv = contextManager.getEnv();
  const spawnOpts = {
    encoding: 'utf-8',
    maxBuffer: runtimeConfig.maxOutputSize,
    windowsHide: true,
    timeout: msTimeout,
    env: { ...env, ...contextEnv },
  };
  if (signal) spawnOpts.signal = signal;

  const result = spawnSync('node', allArgs, spawnOpts);
  const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

  // Check abort
  if (signal?.aborted) {
    debugLog('Cancelled:', def.name);
    return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
  }

  if (result.error) {
    let errMsg, errorType;
    if (result.error.code === 'ETIMEDOUT') { errMsg = `Tool ${def.name} timed out after ${msTimeout}ms`; errorType = 'timeout'; }
    else if (result.error.code === 'ABORT_ERR') { errMsg = `Tool ${def.name} was cancelled`; errorType = 'cancel'; }
    else { errMsg = `Failed to spawn ${def.name}: ${result.error.message}`; errorType = 'generic'; }
    const fix = getErrorFix(def.name.replace('smart_', ''), errorType, errMsg);
    debugLog('Error:', errMsg);
    return emit({ ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
  }

  const capturedStderr = (result.stderr || '').trim();
  if (capturedStderr) debugLog('Stderr:', capturedStderr.slice(0, 2000));

  let output = result.stdout || '';
  const originalLength = output.length;
  if (originalLength > runtimeConfig.maxOutputChars) {
    output = output.slice(0, runtimeConfig.maxOutputChars) +
      `\n\n--- [TRUNCATED: ${originalLength} chars, showing first ${runtimeConfig.maxOutputChars}] ---`;
  }

  if (result.status !== 0 && result.status !== null && !output) {
    const errMsg = `Tool ${def.name} failed: exit ${result.status}${capturedStderr ? ': ' + capturedStderr : ''}`;
    const fix = getErrorFix(def.name.replace('smart_', ''), 'exit', errMsg);
    debugLog('Error:', errMsg);
    return emit({ ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
  }

  if (elapsedMs > 5000) output = output.trimEnd() + `\n\n[Completed in ${(elapsedMs / 1000).toFixed(1)}s]`;
  return emit({ ok: true, output }, elapsedMs);
}

// ---------------------------------------------------------------------------
// MCP transport
// ---------------------------------------------------------------------------
const PROTOCOL_VERSION = '2024-11-05';

function writeMsg(msg) { stdout.write(JSON.stringify(msg) + '\n'); }

let _respondChain = Promise.resolve();
let _autoCleared = false; // Phase 14.1: fire-once flag for auto clear_tool_results

function respond(id, result, opts = {}) {
  // Phase 2: Apply output optimization BEFORE writing via pipeline
  // Checks result._responsePolicy + result._responsePipeline (set by captureAndReturn via invokeTool)
  const policy = result._responsePolicy;
  const pipeline = result._responsePipeline;
  delete result._responsePolicy; // strip before sending over wire
  delete result._responsePipeline;

  if (policy && opts.optimize !== false && result?.content?.[0]?.type === 'text' && typeof result.content[0].text === 'string') {
    const originalSize = result.content[0].text.length;

    // Context budget: auto-increase compression when budget is low
    const budget = getContextBudget();
    const compressionDecision = budget.decideCompression(originalSize, policy.maxLevel || 0);
    const effectivePolicy = compressionDecision.shouldCompress
      ? { ...policy, maxLevel: compressionDecision.level }
      : policy;

    const opt = applyOptimization(result.content[0].text, effectivePolicy, { ...opts, chain: pipeline });
    if (opt.meta) {
      result.content[0].text = opt.text + '\n\n---\n' + JSON.stringify(opt.meta, null, 2) + '\n---';
      debugLog(`Output opt: ${opt.meta._optimized.savings} saved (L${opt.meta._optimized.level})${compressionDecision.shouldCompress ? ' [budget: ' + compressionDecision.reason + ']' : ''}`);
    }

    // Track output size for context budget
    const finalSize = result.content[0].text.length;
    budget.track(
      result._toolName || 'unknown',
      finalSize,
      opt.meta?._optimized?.level > 0,
      originalSize
    );

    // Phase 14.4: Context Rot Warning — inject threshold-specific actionable advice
    const rotWarning = budget.getRotWarning();
    if (rotWarning) {
      const status = budget.getStatus();
      result.content[0].text += `\n\n---\n📊 Context Budget: ${status.usedPct} used (${status.remainingPct} remaining) — ${rotWarning}\n---`;
    }

    // Phase 14.1: Auto-trigger clear_tool_results at 70% budget (fire-and-forget, once per session)
    if (budget.usedFraction >= 0.7 && !_autoCleared) {
      _autoCleared = true;
      try {
        ensureContext();
        const cleared = contextManager.clearToolResults({ olderThan: 10, keepLatest: 2 });
        debugLog(`Auto clear_tool_results: removed ${cleared.removed}, kept ${cleared.kept} (budget=${(budget.usedFraction * 100).toFixed(0)}%)`);
      } catch (e) {
        debugLog('Auto clear_tool_results error:', e.message);
      }
    }
  } else if (result?.content?.[0]?.type === 'text' && typeof result.content[0].text === 'string') {
    // Track even non-optimized outputs
    const budget = getContextBudget();
    budget.track(result._toolName || 'unknown', result.content[0].text.length);
  }

  // Write chain — awaits pending async work (e.g. Phase 10.2 impact warning),
  // then serializes writes to maintain MCP JSON-RPC ordering.
  _respondChain = _respondChain.then(async () => {
    // Await any pending async post-processing before writing
    if (result._pendingImpact) {
      const impactText = await result._pendingImpact;
      delete result._pendingImpact;
      if (impactText && result?.content?.[0]?.type === 'text') {
        result.content[0].text += impactText;
      }
    }
    // Phase 6: Await hallucination check result
    if (result._pendingHallucination) {
      const hcText = await result._pendingHallucination;
      delete result._pendingHallucination;
      if (hcText && result?.content?.[0]?.type === 'text') {
        result.content[0].text += hcText;
      }
    }
    writeMsg({ jsonrpc: '2.0', id, result });
  }).catch(() => {
    writeMsg({ jsonrpc: '2.0', id, result });
  });
}
function respondError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  writeMsg({ jsonrpc: '2.0', id, error: err });
}

// ---------------------------------------------------------------------------
// smart_context — MCP tool for context query/management
// ---------------------------------------------------------------------------

const CONTEXT_TOOL_DESCRIPTION =
  'Query or manage session context. Use this to see what tools have been called, what findings accumulated, or to reset/list sessions.\n' +
  '  command: "get" (default) | "summary" | "history" | "findings" | "reset" | "sessions" | "delete" | "inject" | "workflow-stats" | "merge" | "budget" | "clear_tool_results"\n' +
  '  sessionId: optional, for resume/delete operations\n' +
  '  clear_tool_results args: olderThan (number, default 10), keepLatest (number, default 2)';

/**
 * Handle smart_context tool call.
 * @param {number|string} id - request id
 * @param {object} args - { command?, sessionId?, projectRoot? }
 */
function handleSmartContext(id, args) {
  const cmd = (args.command || 'get').toLowerCase();
  ensureContext();

  try {
    let result;
    switch (cmd) {
      case 'get': {
        const ctx = contextManager.get();
        if (!ctx) { respond(id, { content: [{ type: 'text', text: 'No active session.' }] }, { optimize: false }); return; }
        // Return a cleaned version (omit large history for readability)
        const { toolHistory, accumulatedFindings, ...rest } = ctx;
        result = JSON.stringify({
          ...rest,
          historyCount: toolHistory.length,
          findingCount: accumulatedFindings.length,
          recentCalls: toolHistory.slice(-5).map(h => ({
            tool: h.tool, ok: h.ok, duration: h.duration, timestamp: h.timestamp,
          })),
          recentFindings: accumulatedFindings.slice(-10),
        }, null, 2);
        break;
      }

      case 'summary': {
        result = contextManager.getSummary();
        if (!result) result = 'No active session.';
        break;
      }

      case 'history': {
        const ctx = contextManager.get();
        if (!ctx || ctx.toolHistory.length === 0) { result = 'No tool history.'; break; }
        result = JSON.stringify(ctx.toolHistory.map(h => ({
          tool: h.tool,
          ok: h.ok,
          duration: h.duration,
          timestamp: h.timestamp,
          resultPreview: h.result ? h.result.slice(0, 300) : null,
          errorPreview: h.error ? h.error.slice(0, 300) : null,
        })), null, 2);
        break;
      }

      case 'findings': {
        const ctx = contextManager.get();
        if (!ctx || ctx.accumulatedFindings.length === 0) { result = 'No findings yet.'; break; }
        result = JSON.stringify(ctx.accumulatedFindings, null, 2);
        break;
      }

      case 'reset': {
        contextManager.reset();
        resetContextBudget();
        _autoCleared = false;
        result = `Session reset. SessionId: ${contextManager.get()?.sessionId}\nContext budget also reset.`;
        break;
      }

      case 'sessions': {
        const sessions = contextManager.listSessionsSummary();
        if (sessions.length === 0) { result = 'No persisted sessions.'; break; }
        result = JSON.stringify(sessions, null, 2);
        break;
      }

      case 'delete': {
        const sid = args.sessionId;
        if (!sid) { result = 'sessionId required for delete.'; break; }
        const deleted = contextManager.deleteSession(sid);
        result = deleted ? `Session ${sid} deleted.` : `Session ${sid} not found.`;
        break;
      }

      case 'inject': {
        const ctx = contextManager.get();
        if (!ctx) { result = 'No active session. Use init first.'; break; }
        result = JSON.stringify({
          env: contextManager.getEnv(),
          args: `_context: ${contextManager.getSummary()}`,
          hint: 'Context is auto-injected into every tool call. No manual injection needed.',
        }, null, 2);
        break;
      }

      case 'merge': {
        const sessionIds = args.sessionIds || (args.sessionId ? [args.sessionId] : []);
        if (sessionIds.length === 0) { result = 'sessionIds (array) or sessionId required for merge.'; break; }
        const mergeResult = contextManager.mergeSessions(sessionIds);
        result = JSON.stringify(mergeResult, null, 2);
        break;
      }

      case 'workflow-stats': {
        const wfId = args.workflowId || args.id;
        if (!wfId) { result = 'workflowId required for workflow-stats.'; break; }
        const cost = contextManager.getWorkflowCost(wfId);
        if (!cost) { result = `No data found for workflow: ${wfId}. Ensure tools were called with this workflowId.`; break; }
        result = JSON.stringify(cost, null, 2);
        break;
      }

      case 'budget': {
        const budget = getContextBudget();
        result = JSON.stringify(budget.getStatus(), null, 2);
        break;
      }

      case 'clear_tool_results': {
        const olderThan = typeof args.olderThan === 'number' ? args.olderThan : 10;
        const keepLatest = typeof args.keepLatest === 'number' ? args.keepLatest : 2;
        const cleared = contextManager.clearToolResults({ olderThan, keepLatest });
        result = JSON.stringify(cleared, null, 2);
        debugLog(`clear_tool_results: removed ${cleared.removed}, kept ${cleared.kept} (olderThan=${olderThan}, keepLatest=${keepLatest})`);
        break;
      }

      default:
        result = `Unknown command: ${cmd}. Available: get, summary, history, findings, reset, sessions, delete, inject, workflow-stats, merge, budget, clear_tool_results`;
    }

    respond(id, { content: [{ type: 'text', text: result }] }, { optimize: false });
  } catch (err) {
    respond(id, {
      content: [{ type: 'text', text: `smart_context error: ${err.message}` }],
      isError: true,
    }, { optimize: false });
  }
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------
function handleRequest(req) {
  const { id, method, params } = req;
  const isNotification = typeof id === 'undefined' || id === null;

  switch (method) {
    case 'initialize': {
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'opencode-smart', version: '3.0.0' },
      });
      break;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case '$/cancelRequest': {
      if (method !== 'notifications/initialized') {
        const cancelId = params?.id ?? params?.requestId;
        if (cancelId != null) {
          const controller = pendingCalls.get(String(cancelId));
          if (controller) { controller.abort(); pendingCalls.delete(String(cancelId)); }
        }
      }
      break;
    }

    case 'tools/list': {
      // Only native tools appear in tools/list — reduces token usage by ~70%
      const tools = nativeTools.map(t => ({
        name: t.name,
        description: `[${t.category || 'core'}] ${t.description}`,
        inputSchema: t.inputSchema,
      }));
      // Add the router tool
      tools.push({
        name: 'smart_run',
        description: ROUTER_DESCRIPTION,
        inputSchema: ROUTER_SCHEMA,
      });
      // Add the context tool
      tools.push({
        name: 'smart_context',
        description: CONTEXT_TOOL_DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command: get (default), summary, history, findings, reset, sessions, delete, inject, workflow-stats, merge, budget, clear_tool_results', enum: ['get', 'summary', 'history', 'findings', 'reset', 'sessions', 'delete', 'inject', 'workflow-stats', 'merge', 'budget', 'clear_tool_results'] },
            sessionId: { type: 'string', description: 'Session ID (for resume/delete/merge)' },
            sessionIds: { type: 'array', items: { type: 'string' }, description: 'Session IDs array (for merge)' },
            workflowId: { type: 'string', description: 'Workflow ID (for workflow-stats)' },
            projectRoot: { type: 'string', description: 'Project root path' },
            olderThan: { type: 'number', description: 'Keep only the last N turns (for clear_tool_results). Default: 10' },
            keepLatest: { type: 'number', description: 'Safety floor: always keep at least N recent entries (for clear_tool_results). Default: 2' },
          },
        },
      });
      respond(id, { tools });
      break;
    }

    case 'tools/call': {
      const p = (params || {});
      const toolName = String(p.name || '');
      const args = (p.arguments || {});
      debugLog('tools/call:', toolName);

      // smart_context → context query/dispatch
      if (toolName === 'smart_context') {
        handleSmartContext(id, args);
        break;
      }

      // smart_run → router dispatch
      if (toolName === 'smart_run') {
        const controller = new AbortController();
        if (id != null) pendingCalls.set(String(id), controller);
        try {
          const result = handleDevtoolRun(id, p, controller.signal, args);

          // Async handler — resolve Promise and respond
          if (result && result.__async) {
            const { promise, toolName: tName, origArgs, startTime: st, _responsePolicy } = result;
            promise
              .then(resolvedOutput => {
                const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
                if (controller.signal.aborted) {
                  captureAndReturn(tName, origArgs, { ok: false, error: `Tool ${tName} was cancelled` }, elapsedMs);
                  respond(id, { content: [{ type: 'text', text: '' }] });
                  return;
                }
                const output = String(resolvedOutput ?? '');
                // Structured error from safe-handler wrapper → route through isError path
                if (isStructuredError(output)) {
                  const cr = captureAndReturn(tName, origArgs, { ok: false, error: output }, elapsedMs);
                  respond(id, { content: [{ type: 'text', text: cr.error }], isError: true }, { optimize: false });
                  return;
                }
                const cr = captureAndReturn(tName, origArgs, { ok: true, output }, elapsedMs);
                const resp1 = { content: [{ type: 'text', text: cr.output }] };
                const rp = cr._responsePolicy || _responsePolicy;
                if (rp) resp1._responsePolicy = rp;
                if (cr._pendingImpact) resp1._pendingImpact = cr._pendingImpact;
                respond(id, resp1);
              })
              .catch(err => {
                const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
                const cr = captureAndReturn(tName, origArgs, { ok: false, error: `Handler error in ${tName}: ${err.message}` }, elapsedMs);
                respond(id, {
                  content: [{ type: 'text', text: cr.error }],
                  isError: true,
                }, { optimize: false });
              });
          } else if (result.ok) {
            const resp2 = { content: [{ type: 'text', text: result.output }] };
            if (result._responsePolicy) resp2._responsePolicy = result._responsePolicy;
            if (result._pendingImpact) resp2._pendingImpact = result._pendingImpact;
            respond(id, resp2);
          } else {
            respond(id, {
              content: [{ type: 'text', text: result.error }],
              isError: true,
            }, { optimize: false });
          }
        } finally { if (id != null) pendingCalls.delete(String(id)); }
        break;
      }

      // Native tool
      const def = toolMap.get(toolName);
      if (!def) {
        const availableTools = Array.from(toolMap.keys()).join(', ');
        respond(id, {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}. Available: ${availableTools}` }],
          isError: true,
        }, { optimize: false });
        break;
      }

      const controller = new AbortController();
      if (id != null) pendingCalls.set(String(id), controller);
      try {
        const result = invokeToolWithRetry(def, args, null, controller.signal);

        // Async handler — resolve Promise and respond
        if (result && result.__async) {
          const { promise, toolName: tName, origArgs, startTime: st, _responsePolicy } = result;
          promise
            .then(resolvedOutput => {
              const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
              if (controller.signal.aborted) {
                captureAndReturn(tName, origArgs, { ok: false, error: `Tool ${tName} was cancelled` }, elapsedMs);
                respond(id, { content: [{ type: 'text', text: '' }] });
                return;
              }
              const output = String(resolvedOutput ?? '');
              // Structured error from safe-handler wrapper → route through isError path
              if (isStructuredError(output)) {
                const cr = captureAndReturn(tName, origArgs, { ok: false, error: output }, elapsedMs);
                respond(id, { content: [{ type: 'text', text: cr.error }], isError: true }, { optimize: false });
                return;
              }
              const cr = captureAndReturn(tName, origArgs, { ok: true, output }, elapsedMs);
              const resp3 = { content: [{ type: 'text', text: cr.output }] };
              const rp = cr._responsePolicy || _responsePolicy;
              if (rp) resp3._responsePolicy = rp;
              if (cr._pendingImpact) resp3._pendingImpact = cr._pendingImpact;
              respond(id, resp3);
            })
            .catch(err => {
              const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
              const cr = captureAndReturn(tName, origArgs, { ok: false, error: `Handler error in ${tName}: ${err.message}` }, elapsedMs);
              respond(id, {
                content: [{ type: 'text', text: cr.error }],
                isError: true,
              }, { optimize: false });
            });
          return;
        }

        if (result.ok) {
          const resp4 = { content: [{ type: 'text', text: result.output }] };
          if (result._responsePolicy) resp4._responsePolicy = result._responsePolicy;
          if (result._pendingImpact) resp4._pendingImpact = result._pendingImpact;
          respond(id, resp4);
        } else {
          respond(id, {
            content: [{ type: 'text', text: result.error }],
            isError: true,
          }, { optimize: false });
        }
      } finally { if (id != null) pendingCalls.delete(String(id)); }
      break;
    }

    case 'ping': { respond(id, {}); break; }

    case 'smart/health': {
      const ctx = contextManager.get();
      const budget = getContextBudget();
      respond(id, {
        status: 'ok', version: '3.1.0',
        toolsRegistered: toolMap.size, toolNames: Array.from(toolMap.keys()),
        nativeCount: nativeTools.length, routerCount: routerTools.length,
        debug: DEBUG, pid: process.pid, uptime: process.uptime(),
        context: ctx ? {
          sessionId: ctx.sessionId,
          toolCount: ctx.metadata.toolCount,
          errorCount: ctx.metadata.errorCount,
          findingCount: ctx.accumulatedFindings.length,
        } : null,
        budget: budget.getStatus(),
      });
      break;
    }

    case 'smart/stats': {
      const p2 = (params || {});
      if (p2.reset === true) { resetStats(); respond(id, { reset: true }); }
      else respond(id, getStatsSummary());
      break;
    }

    case 'smart/config': {
      const p3 = (params || {});
      if (p3.set && typeof p3.set === 'object') {
        const changes = p3.set;
        const applied = {};
        const rejected = {};
        if (typeof changes.debug === 'boolean') { runtimeConfig.debug = changes.debug; applied.debug = runtimeConfig.debug; }
        if (typeof changes.timeoutMs === 'number' && changes.timeoutMs > 0) { runtimeConfig.timeoutMs = changes.timeoutMs; applied.timeoutMs = runtimeConfig.timeoutMs; }
        if (typeof changes.maxOutputChars === 'number' && changes.maxOutputChars > 0) { runtimeConfig.maxOutputChars = changes.maxOutputChars; applied.maxOutputChars = runtimeConfig.maxOutputChars; }
        for (const key of Object.keys(changes)) { if (!(key in applied)) rejected[key] = 'Unknown or invalid'; }
        respond(id, { applied, rejected });
      } else {
        respond(id, { ...runtimeConfig });
      }
      break;
    }

    case 'smart/context': {
      const p4 = (params || {});
      const cmd = (p4.command || 'get').toLowerCase();
      ensureContext();

      try {
        let result;
        switch (cmd) {
          case 'get': {
            const ctx = contextManager.get();
            const { toolHistory, accumulatedFindings, ...rest } = ctx || {};
            result = rest ? { ...rest, historyCount: toolHistory?.length || 0, findingCount: accumulatedFindings?.length || 0 } : { status: 'no_session' };
            break;
          }
          case 'summary': result = { summary: contextManager.getSummary() }; break;
          case 'reset': contextManager.reset(); result = { status: 'reset', sessionId: contextManager.get()?.sessionId }; break;
          default: result = { status: 'unknown_command', available: ['get', 'summary', 'reset'] };
        }
        respond(id, result);
      } catch (err) {
        respond(id, {
          content: [{ type: 'text', text: `smart/context error: ${err.message}` }],
          isError: true,
        }, { optimize: false });
      }
      break;
    }

    // -----------------------------------------------------------------------
    // opencode startup queries — required to avoid "Unexpected server error"
    // opencode sends these to ALL MCP servers during init;
    // returning -32601 makes it treat the server as failed.
    // -----------------------------------------------------------------------
    case 'config.providers': { respond(id, { providers: [] }); break; }
    case 'provider.list':    { respond(id, { providers: [] }); break; }
    case 'app.agents':       { respond(id, { agents: [] }); break; }
    case 'config.get':       { respond(id, {}); break; }

    default: {
      if (!isNotification) {
        respondError(id, -32601, `Method not found: ${method}`, {
          availableMethods: ['initialize', 'notifications/initialized', 'notifications/cancelled',
            'tools/list', 'tools/call', 'ping', 'smart/health', 'smart/stats', 'smart/config', 'smart/context'],
        });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop — read JSON-RPC from stdin
// ---------------------------------------------------------------------------
const rl = createInterface({ input: stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = lenientParseJson(trimmed);
  } catch {
    // Fallback: try strict JSON for error response (shouldn't get here)
    try { const fb = JSON.parse(trimmed); if (fb && typeof fb.id !== 'undefined') respondError(fb.id, -32700, 'Parse error'); } catch { /* ignore */ }
    return;
  }
  if (!req || typeof req.method !== 'string') {
    if (req && typeof req.id !== 'undefined') respondError(req.id, -32600, 'Invalid Request');
    return;
  }
  handleRequest(req);
});

rl.on('close', () => {
  // D.3 Auto-Extract: final skill_patch extraction on session end
  autoExtractSkillPatches(true);
});
