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
import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
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
import { getPrefetchEngine } from '../lib/prefetch-engine.mjs';
import { getConcurrencyGate } from '../lib/concurrency-gate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration & debug mode
// ---------------------------------------------------------------------------
const DEBUG = env.DEBUG === 'smart' || env.DEBUG === 'smart-mcp' || argv.includes('--debug');
const MAX_OUTPUT_SIZE = 512 * 1024;
const MAX_OUTPUT_CHARS = 200_000;
const TOOL_TIMEOUT = 30_000;

// P0 MicroCompact: auto-trigger after tool call
const MICRO_COMPACT_KEEP = 5;      // Keep last N results as-is
const MICRO_COMPACT_MIN_CALLS = 5; // Don't compact before N calls (allow build-up)

// ---------------------------------------------------------------------------
// Model size: 'large' | 'small' | 'micro'
// Controls tool manifest, output compression, emoji stripping.
// Set via --model-size CLI flag or SMART_MODEL_SIZE env var.
// The smart-small.md agent calls smart_config({set:{modelSize:'small'}})
// at session start to switch dynamically.
// ---------------------------------------------------------------------------
const MODEL_SIZE = (() => {
  const idx = argv.indexOf('--model-size');
  if (idx >= 0 && idx + 1 < argv.length) {
    const val = argv[idx + 1].toLowerCase();
    if (['small', 'micro'].includes(val)) return val;
  }
  if (env.SMART_MODEL_SIZE) {
    const val = env.SMART_MODEL_SIZE.toLowerCase();
    if (['small', 'micro'].includes(val)) return val;
  }
  return 'large'; // default: full feature set
})();

// Native tools (top-level MCP) hidden per model size.
// Hidden tools remain accessible via smart_run router.
const HIDDEN_NATIVE_TOOLS = {
  small: new Set([
    'smart_exa_search', 'smart_exa_crawl', 'smart_github_search',
    'smart_hallucination_check', 'smart_academic_search',
    'smart_academic_review', 'smart_docx_generate',
    'smart_deep_think', 'smart_security', 'smart_learn',
    'smart_codebase_index',
  ]),
  micro: new Set([
    'smart_exa_search', 'smart_exa_crawl', 'smart_github_search',
    'smart_hallucination_check', 'smart_academic_search',
    'smart_academic_review', 'smart_docx_generate',
    'smart_deep_think', 'smart_security', 'smart_learn',
    'smart_codebase_index', 'smart_lsp', 'smart_rules',
    'smart_fast_apply', 'smart_compact',
  ]),
};

/**
 * Strip or replace emoji for small/micro model output.
 * Maps diagnostic emoji to text equivalents; strips decorative ones.
 */
function formatForModelSize(text, modelSize) {
  if (modelSize === 'large') return text;

  // Replace diagnostic emoji with text equivalents
  const replacements = {
    '✅': '[OK] ', '❌': '[ERR] ', '⚠️': '[WARN] ', '🔒': '[GATE] ',
    '💡': '[TIP] ', '🧠': '', '🔍': '', '🎯': '', '🚀': '',
    '📊': '', '📄': '', '🧩': '', '🛡': '', '📋': '', '📝': '',
    '🏆': '', '🌐': '', '⚡': '', '🔵': '', '🟠': '',
    '🗺': '', '📁': '', '🖼': '', '🌲': '', '🥇': '', '🥈': '', '🥉': '',
    '📍': '', 'ℹ️': '', '➕': '', '➖': '',
    '└─': '  ', '├─': '  ', '──': '--',
  };
  let result = text;
  for (const [emoji, replacement] of Object.entries(replacements)) {
    result = result.split(emoji).join(replacement);
  }

  // Micro: additional compression — collapse multi-blank lines
  if (modelSize === 'micro') {
    result = result.replace(/\n{3,}/g, '\n\n');
  }
  return result;
}

function debugLog(...args) {
  if (DEBUG) stderr.write(`[smart-mcp] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
}

debugLog('Server starting, plugins loaded:', toolMap.size, 'tools');

// Phase 18: Initialize pre-fetch engine
const prefetchEngine = getPrefetchEngine({ toolMap });

// Phase 25: Concurrency gate — prevents resource contention
const gate = getConcurrencyGate();

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
  // Phase 4.4: Mark session as cleanly ended (for session-recovery detection)
  if (contextManager) contextManager.markSessionEnd();
  // Phase 3: Fire-and-forget session checkpoint
  saveSessionCheckpoint();
  setTimeout(() => { debugLog('Shutdown complete'); process.exit(0); }, 500).unref();
}

/**
 * Phase 3: Session Checkpoint — save current context summary as memory entry.
 * Fire-and-forget via spawn + unref, never delays shutdown.
 */
function saveSessionCheckpoint() {
  try {
    if (!existsSync(MEMORY_CLI_PATH) || !contextManager) return;
    const ctx = contextManager.get();
    if (!ctx) return;
    const projectName = basename(process.cwd());
    const toolCount = ctx.metadata?.toolCount || 0;
    if (toolCount < 3) return; // skip if basically nothing happened

    // P3: 使用 recovery context (若有 fullCompact 過) 或自行產生
    let sessionSummary;
    const recoveryCtx = contextManager.getRecoveryContext();
    if (recoveryCtx) {
      sessionSummary = {
        projectName,
        toolCount,
        sessionId: ctx.sessionId,
        timestamp: new Date().toISOString(),
        keyDecisions: (recoveryCtx.keyDecisions || []).slice(0, 3),
        findings: (recoveryCtx.findings || []).slice(0, 5),
        toolSummary: recoveryCtx.summary,
      };
    } else {
      // 從累積 findings 產生摘要
      const findings = ctx.accumulatedFindings || [];
      const highFindings = findings
        .filter(f => f.severity === 'critical' || f.severity === 'high')
        .slice(0, 5);
      sessionSummary = {
        projectName,
        toolCount,
        sessionId: ctx.sessionId,
        timestamp: new Date().toISOString(),
        findings: highFindings,
        errorCount: ctx.metadata?.errorCount || 0,
      };
    }

    const metaStr = JSON.stringify(sessionSummary).slice(0, 1000);

    const child = spawn('node', [
      MEMORY_CLI_PATH, 'store', `checkpoint:${projectName}`,
      '--resolution', `Session checkpoint for ${projectName}: ${toolCount} tools called, ${sessionSummary.errorCount || 0} errors`,
      '--tools', 'checkpoint',
      '--category', 'checkpoint',
      '--success', 'true',
      '--metadata', metaStr,
    ], { timeout: 3000, stdio: 'ignore' });
    child.unref();
    setTimeout(() => { try { child.kill(); } catch { /* ok */ } }, 2000).unref();
  } catch { /* best effort */ }
}

/**
 * P3: Cross-session memory bridge — 啟動時檢查前一 session 是否有未保存的知識。
 * 從記憶體查詢前一 session 的 checkpoint，若相關則注入 finding。
 * 非阻塞 — 快速 spawn + unref，永不延遲啟動。
 */
function crossSessionMemoryBridge() {
  try {
    if (!existsSync(MEMORY_CLI_PATH) || !contextManager) return;
    const prev = contextManager.getPreviousSession();
    if (!prev) return;

    const toolCount = prev.metadata?.toolCount || 0;
    if (toolCount < 5) return; // 太短 skip
    if (prev._sessionEnded) return; // 正常結束 skip (上一 session 已完成)

    // 中斷的 session — 注入 finding
    contextManager.addFindings([{
      source: 'cross-session-bridge',
      finding: `[Session Memory] 前一 session (${prev.sessionId.slice(0, 8)}) 有 ${toolCount} 次工具呼叫但未正常結束。最後工具: ${prev.lastResult?.tool || '?'}`,
      category: 'memory',
      severity: 'low',
    }]);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Usage stats
// ---------------------------------------------------------------------------
const stats = { startTime: Date.now(), totalCalls: 0, totalErrors: 0, totalDurationMs: 0, byTool: new Map(), memoryAutoStoreCount: 0, memoryPreCheckCount: 0, memoryPreCheckHitCount: 0, memoryPreCheckConflictCount: 0, memoryPreCheckSavedMs: 0, autoExtractCount: 0 };

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------
const contextManager = new ContextManager({ autoSave: true, extractFindings: true });
let contextInitialized = false;
let memoryInjected = false; // Phase 10.5: auto-inject once per session

const MEMORY_PATH = env.SMART_MEMORY_PATH || join(homedir(), '.smart', 'memory', 'resolutions.json');

/**
 * Phase 19: Detect current agent ID from environment.
 */
function detectAgentId() {
  if (env.SMART_AGENT_ID) return env.SMART_AGENT_ID;
  if (env.CLAUDE_CODE || env.ANTHROPIC_API_KEY) return 'claude-code';
  if (env.OPENCODE_CONFIG || env.OPENCODE_HOME) return 'opencode';
  if (env.CODEX_HOME || env.CODEX_API_KEY) return 'codex';
  if (env.COPILOT_HOME || env.GITHUB_COPILOT) return 'copilot';
  if (env.HERMES_HOME) return 'hermes';
  if (env.PI_HOME) return 'pi';
  return 'unknown';
}

/**
 * Phase 1: Auto Memory Injection.
 * Spawns CLI for project-aware BM25 SQLite search, injects single light hint (<100t).
 * Falls back to JSON with project filter if SQLite DB unavailable.
 * Fire-and-forget: called once after first context init, non-blocking.
 */
function autoInjectMemory() {
  if (memoryInjected) return;
  try {
    const projectName = basename(process.cwd());

    // Try SQLite BM25 search first (Phase 1)
    if (existsSync(MEMORY_CLI_PATH)) {
      const result = spawnSync('node', [
        MEMORY_CLI_PATH, 'search', projectName,
        '--db',
        '--format', 'json',
        '--limit', '3',
        '--threshold', '0.3',
      ], { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 10 });

      if (result.status === 0 && result.stdout) {
        const parsed = JSON.parse(result.stdout);
        if (parsed?.found && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
          const top = parsed.entries[0];
          const hint = top.resolution || top.errorMessage || '';
          if (hint.length > 5) {
            contextManager.addFindings([{
              source: 'memory',
              finding: `💡 [Memory] Rel "${projectName}": ${hint.slice(0, 100)}`,
              category: 'memory',
              severity: 'low',
            }]);
            memoryInjected = true;
            debugLog(`Auto-injected SQLite memory hint for: ${projectName}`);
            return;
          }
        }
      }
    }

    // Fallback: JSON file with project filter (backward compat)
    if (!existsSync(MEMORY_PATH)) return;
    const raw = readFileSync(MEMORY_PATH, 'utf-8');
    const memory = JSON.parse(raw);
    if (!Array.isArray(memory.entries) || memory.entries.length === 0) return;

    const currentAgent = detectAgentId();
    const now = Date.now();
    const projectLower = projectName.toLowerCase();
    const cwdLower = process.cwd().toLowerCase();

    const filtered = memory.entries.filter(e => {
      const text = ((e.query || '') + ' ' + (e.errorMessage || '') + ' ' + (e.resolution || '')).toLowerCase();
      return text.includes(projectLower) || text.includes(cwdLower);
    });
    if (filtered.length === 0) return;

    const scored = filtered.map(e => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
      const recencyScore = ts > 0 ? Math.max(0, 1 - (now - ts) / 864000000) : 0;
      const typeBonus = e.type === 'skill_patch' ? 100 : 0;
      const hitScore = (e.hitCount || 1) * 10;
      const agentBonus = (e.agent_id && e.agent_id === currentAgent) ? 50 : 0;
      return { ...e, score: typeBonus + hitScore + recencyScore * 20 + agentBonus };
    });
    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];
    const hint = top.type === 'skill_patch'
      ? (top.behaviorChange || top.errorMessage || '')
      : (top.resolution || top.errorMessage || '');
    if (hint.length > 5) {
      contextManager.addFindings([{
        source: 'memory',
        finding: `💡 [Memory] ${hint.slice(0, 100)}`,
        category: 'memory',
        severity: 'low',
      }]);
      memoryInjected = true;
      debugLog(`Auto-injected JSON memory hint for: ${projectName}`);
    }
  } catch (e) {
    debugLog('Auto memory injection:', e.message);
  }
}

function ensureContext() {
  if (!contextInitialized) {
    contextManager.init({ projectRoot: env.PWD || env.CWD || process.cwd() });
    contextInitialized = true;
    debugLog('Context initialized:', contextManager.get()?.sessionId);
    // P3: Cross-session knowledge bridge — 偵測中斷的前一 session
    crossSessionMemoryBridge();
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
      preCheckConflictCount: stats.memoryPreCheckConflictCount,
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
    prefetch: prefetchEngine.getStats(),
  };
}

function resetStats() { stats.startTime = Date.now(); stats.totalCalls = 0; stats.totalErrors = 0; stats.totalDurationMs = 0; stats.byTool.clear(); stats.memoryAutoStoreCount = 0; stats.memoryPreCheckCount = 0; stats.memoryPreCheckHitCount = 0; stats.memoryPreCheckConflictCount = 0; stats.memoryPreCheckSavedMs = 0; stats.autoExtractCount = 0; }

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------
const runtimeConfig = { debug: DEBUG, timeoutMs: TOOL_TIMEOUT, maxOutputSize: MAX_OUTPUT_SIZE, maxOutputChars: MAX_OUTPUT_CHARS, modelSize: MODEL_SIZE };

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
 * Classify error type for fix lookup (maps to ERROR_FIXES keys).
 */
function classifyErrorType(errorMsg) {
  const l = (errorMsg || '').toLowerCase();
  if (!l) return 'generic';
  if (l.includes('timeout') || l.includes('timed out')) return 'timeout';
  if (l.includes('syntax') || l.includes('unexpected token') || l.includes('parse')) return 'syntax';
  if (l.includes('required') || l.includes('missing')) return 'missing';
  if (l.includes('not found') || l.includes('unknown tool') || l.includes('unknown command')) return 'notFound';
  if (l.includes('exit') || l.includes('non-zero')) return 'exit';
  if (l.includes('cancel')) return 'cancel';
  if (l.includes('enforc')) return 'enforcement';
  return 'generic';
}

/**
 * D.1 Auto-Store: Non-blocking write of failed tool result to memory store.
 * Uses ERROR_FIXES map for meaningful resolutions instead of raw error text.
 * Fast async spawn with unref — does NOT block the response.
 */
function autoStoreToMemory(toolName, args, result, errorCategory) {
  stats.memoryAutoStoreCount++;
  try {
    if (!existsSync(MEMORY_CLI_PATH)) return;

    const errorKey = extractErrorKey(toolName, args, result);
    if (!errorKey || errorKey.length < 10) return; // skip noise

    // Use ERROR_FIXES map for a meaningful resolution
    const errorMsg = result?.error || errorKey || '';
    const errorType = classifyErrorType(errorMsg);
    const resolution = getErrorFix(toolName, errorType, errorMsg);

    const toolsUsed = toolName;
    const category = errorCategory || classifyErrorForMemory(errorKey);

    const baseArgs = [
      MEMORY_CLI_PATH, 'store', errorKey,
      '--resolution', resolution.slice(0, 500),
      '--tools', toolsUsed,
      '--category', category,
      '--success', 'false',
    ];

    // Write to JSON (legacy backward compat)
    const child = spawn('node', baseArgs, { timeout: 3000, stdio: 'ignore' });
    child.unref();
    setTimeout(() => { try { child.kill(); } catch { /* ok */ } }, 2000).unref();

    // Write to SQLite (--db) so FTS5 BM25 search can find new entries
    const childDb = spawn('node', [...baseArgs, '--db'], { timeout: 3000, stdio: 'ignore' });
    childDb.unref();
    setTimeout(() => { try { childDb.kill(); } catch { /* ok */ } }, 2000).unref();
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

    // Every 100 tool calls (with findings), run cross-session extraction
    if (!force) {
      try {
        const ctx = contextManager.get();
        const toolCount = ctx?.metadata?.toolCount || 0;
        if (toolCount > 0 && toolCount % 100 === 0) {
          const child2 = spawn('node', [
            MEMORY_CLI_PATH, 'extract',
            '--cross-session',
            '--min-frequency', '3',
            '--dry-run',
          ], { timeout: 5000, stdio: 'ignore' });
          child2.unref();
        }
      } catch { /* best effort */ }
    }
  } catch {
    // Best-effort — never throw from auto-extract
  }
}

/**
 * D.2 Pre-Check: Look up known tool errors by toolName.
 * Reads resolutions.json directly — no spawn overhead.
 * Returns { found: true, output: string } if a previous error exists for this tool.
 */
function preCheckMemory(toolName, args) {
  stats.memoryPreCheckCount++;
  try {
    if (!existsSync(MEMORY_PATH)) return null;

    const raw = readFileSync(MEMORY_PATH, 'utf-8');
    const memory = JSON.parse(raw);
    const entries = memory.entries;
    if (!Array.isArray(entries) || entries.length === 0) return null;

    // Match entries where this toolName appears in toolsUsed
    const toolEntries = entries.filter(e => {
      const toolsUsed = e.toolsUsed;
      if (!toolsUsed || !Array.isArray(toolsUsed)) return false;
      return toolsUsed.some(t => t === toolName || t === toolName.replace('smart_', ''));
    });

    if (toolEntries.length === 0) return null;

    // Only error-type entries trigger pre-check (skill_patches are behavioral hints)
    const errorEntries = toolEntries.filter(e => e.type === 'error');
    if (errorEntries.length === 0) return null;

    // Sort by hitCount descending, pick best
    errorEntries.sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0));
    const top = errorEntries[0];

    const resolution = (top.resolution || '').trim();
    if (resolution.length < 5) return null;

    stats.memoryPreCheckHitCount++;
    stats.memoryPreCheckSavedMs += 1500;

    // Fire-and-forget increment hitCount
    try {
      if (top.id) {
        const child = spawn('node', [MEMORY_CLI_PATH, 'confirm', top.id, '--auto'], { timeout: 2000, stdio: 'ignore' });
        child.unref();
      }
    } catch { /* best effort */ }

    return {
      found: true,
      id: top.id,
      resolution,
      output: `[Memory Pre-Check: Known fix for "${toolName}" (hit ${top.hitCount || 1}x)]\n\n${resolution}\n\n(Pre-check intercepted — applying known fix from memory)`,
    };
  } catch {
    return null; // best-effort
  }
}

/**
 * Phase 2: Contextual Memory Search — non-blocking BM25 for editing/thinking tools.
 * Spawns async search to inject relevant past findings for current tool context.
 * Never blocks tool execution — findings available for next tool call.
 */
const CONTEXTUAL_MEMORY_TOOLS = new Set(['smart_fast_apply', 'smart_think', 'smart_refactor_plan']);

function contextualMemorySearch(toolName, args) {
  if (!existsSync(MEMORY_CLI_PATH)) return Promise.resolve();

  // Extract query from tool args
  let query = null;
  if (args.file && typeof args.file === 'string') query = args.file;
  else if (args.symbol && typeof args.symbol === 'string') query = args.symbol;
  else if (args.search && typeof args.search === 'string') query = args.search;
  else if (args.pattern && typeof args.pattern === 'string') query = args.pattern;
  else if (args.query && typeof args.query === 'string') query = args.query;

  if (!query || query.length < 5) return Promise.resolve();

  return new Promise(resolve => {
    try {
      const child = spawn('node', [
        MEMORY_CLI_PATH, 'search', query.slice(0, 200),
        '--db',
        '--format', 'json',
        '--limit', '2',
        '--threshold', '0.3',
      ], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });

      let stdout = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.on('close', () => {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed?.found && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
            const top = parsed.entries[0];
            const hint = top.resolution || top.errorMessage || '';
            if (hint.length > 5) {
              contextManager.addFindings([{
                source: 'memory',
                finding: `💡 [Contextual Memory] ${toolName}: ${hint.slice(0, 100)}`,
                category: 'memory',
                severity: 'low',
              }]);
            }
            return resolve();
          }
        } catch { /* SQLite parse failed — fall through to JSON */ }

        // Fallback: JSON file (no --db). SQLite may be empty.
        try {
          const fallback = spawnSync('node', [
            MEMORY_CLI_PATH, 'search', query.slice(0, 200),
            '--format', 'json',
            '--limit', '2',
            '--threshold', '0.3',
          ], { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 10 });
          if (fallback.status === 0 && fallback.stdout) {
            const fbParsed = JSON.parse(fallback.stdout);
            if (fbParsed?.found && Array.isArray(fbParsed.entries) && fbParsed.entries.length > 0) {
              const top = fbParsed.entries[0];
              const hint = top.resolution || top.errorMessage || top.behaviorChange || '';
              if (hint.length > 5) {
                contextManager.addFindings([{
                  source: 'memory',
                  finding: `💡 [Contextual Memory] ${toolName}: ${hint.slice(0, 100)}`,
                  category: 'memory',
                  severity: 'low',
                }]);
              }
            }
          }
        } catch { /* best effort */ }
        resolve();
      });
      child.on('error', () => resolve());
      setTimeout(() => { try { child.kill(); } catch { /* ok */ } resolve(); }, 3000).unref();
    } catch { resolve(); }
  });
}

/**
 * Track memory misses: when a tool succeeds but preCheckMemory didn't find a match,
 * check for near-misses (0.4 ≤ similarity < 0.8) and increment their missCount.
 * Fire-and-forget via spawn + unref.
 */
function trackMemoryMiss(toolName, args, result) {
  const TRACKED_TOOLS = ['smart_error_diagnose', 'smart_debug', 'smart_test', 'smart_grep'];
  if (!TRACKED_TOOLS.includes(toolName)) return;

  let query = null;
  if (args.error && typeof args.error === 'string') query = args.error;
  else if (args.pattern && typeof args.pattern === 'string') query = args.pattern;
  else if (args.query && typeof args.query === 'string') query = args.query;
  else return;

  if (!query || query.length < 10) return;

  try {
    const searchResult = spawnSync('node', [
      MEMORY_CLI_PATH, 'search', query,
      '--threshold', '0.4', '--limit', '3', '--format', 'json',
    ], { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 10 });

    if (searchResult.status !== 0 || !searchResult.stdout) return;
    const parsed = JSON.parse(searchResult.stdout);
    if (!parsed.found || !parsed.entries || parsed.entries.length === 0) return;

    // Find near-misses: similarity between 0.4 and 0.8
    const nearMisses = parsed.entries.filter(e =>
      e.similarity >= 0.4 && e.similarity < 0.8 && e.id
    );

    for (const entry of nearMisses) {
      const child = spawn('node', [MEMORY_CLI_PATH, 'confirm', entry.id, '--miss'], {
        timeout: 2000, stdio: 'ignore',
      });
      child.unref();
    }
  } catch { /* best effort */ }
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
  '  [search]  (exa tools moved to Layer 1 — use smart_exa_search, smart_exa_crawl, smart_github_search directly)\n' +
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

  // Execute — use gated execution for CLI tools, sync for handlers
  debugLog('Router dispatch:', subTool, 'args:', JSON.stringify(subArgs));
  const result = executeToolGated(def, subArgs, timeout || null, signal, String(id));
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

  // P0 MicroCompact: auto-trigger after every tool call.
  // Keeps last 5 results as-is, replaces older ones with placeholder.
  // Skip for memory_store (noise reduction) and skip first 5 calls to allow build-up.
  const ctx = contextManager.get();
  const toolCount = ctx?.metadata?.toolCount || 0;
  if (toolCount > MICRO_COMPACT_MIN_CALLS && toolName !== 'smart_memory_store') {
    const mcResult = contextManager.microCompact({ keep: MICRO_COMPACT_KEEP });
    if (mcResult.cleared > 0 || mcResult.largeTruncated > 0) {
      debugLog(`MicroCompact: cleared ${mcResult.cleared}, truncated ${mcResult.largeTruncated}, kept ${mcResult.kept}`);
    }
  }

  // P2 FullCompact: 依據 context budget 漸進式觸發
  // level=1 (>75%): keep 5, 產生結構化摘要
  // level=2 (>85%): keep 3, 移除舊條目
  // level=3 (>95%): keep 2, 緊急壓縮
  let didCompact = false;
  if (toolCount > MICRO_COMPACT_MIN_CALLS && toolName !== 'smart_memory_store') {
    const budget = getContextBudget();
    const usedPct = budget.usedFraction;
    let compactLevel = 0;
    if (usedPct >= 0.95) compactLevel = 3;
    else if (usedPct >= 0.85) compactLevel = 2;
    else if (usedPct >= 0.75) compactLevel = 1;

    if (compactLevel > 0) {
      const fcResult = contextManager.fullCompact({ level: compactLevel });
      if (fcResult.cleared > 0) {
        debugLog(`FullCompact L${compactLevel}: cleared ${fcResult.cleared}, kept ${fcResult.kept}, budget ${(usedPct * 100).toFixed(0)}%`);
        // 同步更新 context budget
        budget.freeEntries(fcResult.cleared);
        didCompact = true;
      }
    }
  }

  // D.4 Recovery Context: after fullCompact, inject todo-aware resume hint.
  // This tells the LLM what was in progress before compaction cleared the history.
  if (didCompact) {
    const recoveryText = contextManager.formatRecoveryContext();
    if (recoveryText) {
      result._pendingRecovery = Promise.resolve(recoveryText);
      // 同步初始化 _todoFollowUp，確保 follow-up 監控在 D.4 路徑也能運作
      _todoFollowUp.pendingAt = Date.now();
      _todoFollowUp.pendingText = recoveryText;
      _todoFollowUp.toolCallsSince = 0;
      _todoFollowUp.reInjected = false;
      try {
        const pendingTodos = contextManager.listTodos().filter(t => t.status === 'pending' || t.status === 'in_progress');
        _todoFollowUp.pendingIds = pendingTodos.map(t => t.id);
      } catch { _todoFollowUp.pendingIds = []; }
    }
  }

  // D.1 Auto-Store: non-blocking write failed tool results to memory
  if (!success && toolName !== 'smart_memory_store') {
    autoStoreToMemory(toolName, args, result);
  }
  // D.3 Auto-Extract: periodic skill_patch extraction from findings
  if (success && toolName !== 'smart_memory_store') {
    autoExtractSkillPatches(false);
  }
  // Track memory misses: for successful tools, check if preCheckMemory
  // would have matched with low similarity (near-miss tracking)
  if (success && toolName !== 'smart_memory_store') {
    trackMemoryMiss(toolName, args, result);
  }
  // Phase: Auto-detect completed todo items after successful tool calls.
  // Rules-based matching: tool name + file args + output heuristics. Zero LLM cost.
  if (success && toolName !== 'smart_memory_store') {
    const todoMatch = contextManager.matchTodo(toolName, args, result);
    if (todoMatch.matched) {
      const updated = contextManager.updateTodoStatus(todoMatch.todoId, 'completed');
      if (updated.ok) {
        debugLog(`Todo auto-completed: #${todoMatch.todoId} — "${todoMatch.todoText}"`);
        // 清除 follow-up 追蹤（todo 已完成）
        if (_todoFollowUp.pendingIds.includes(todoMatch.todoId)) {
          _todoFollowUp.pendingIds = _todoFollowUp.pendingIds.filter(id => id !== todoMatch.todoId);
          if (_todoFollowUp.pendingIds.length === 0) {
            _todoFollowUp.toolCallsSince = 0;
            _todoFollowUp.reInjected = false;
            debugLog('Todo follow-up: all pending todos completed, monitoring reset');
          }
        }
      }
    }
  }

  // Phase 33b: Todo follow-up monitoring — 檢查 LLM 是否在 compact 後繼續待辦事項
  // 若超過 5 次工具呼叫仍未完成 pending todo，自動 re-inject recovery hint
  if (_todoFollowUp.pendingIds.length > 0 && !_todoFollowUp.reInjected) {
    _todoFollowUp.toolCallsSince++;
    if (_todoFollowUp.toolCallsSince > 5) {
      _todoFollowUp.reInjected = true;
      debugLog(`Todo follow-up: ${_todoFollowUp.pendingIds.length} pending after ${_todoFollowUp.toolCallsSince} calls, re-injecting recovery`);
      // 產生新的 recovery context 並注入
      try {
        contextManager.generateRecoveryContext();
        const recoveryText = contextManager.formatRecoveryContext();
        if (recoveryText) {
          result._reInjectRecovery = recoveryText;
        }
      } catch (e) {
        debugLog('Todo follow-up recovery gen error:', e.message);
      }
    }
  }
  // Phase 10.2: Impact Warning — auto-trigger code_impact for multi-file edits
  // Stores promise resolving to impact text (or empty string) so respond() can append it.
  if (success && toolName === 'smart_fast_apply' && result.output) {
    result._pendingImpact = triggerImpactWarning(args);
  }
  // Phase 1: LSP Diagnostics — auto-trigger after fast_apply to catch type errors
  if (success && toolName === 'smart_fast_apply' && result.output) {
    result._pendingLsp = triggerLspDiagnostics(args);
  }
  // Phase 6: Hallucination Detection — auto-trigger for high-risk tool outputs
  if (success && isHighRiskOutput(toolName) && result.output) {
    result._pendingHallucination = triggerHallucinationCheck(toolName, args, result);
  }
  // Phase 18: Speculative Pre-fetch — fire-and-forget after tool success
  if (success && toolName !== 'smart_memory_store') {
    prefetchEngine.triggerAfter(toolName, args, result, async (pfTool, pfArgs) => {
      // Invoke pre-fetch tool directly (skip capture to avoid polluting context)
      const pfDef = toolMap.get(pfTool);
      if (!pfDef) return null;
      try {
        return invokeTool(pfDef, pfArgs, null, null, { skipCapture: true });
      } catch {
        return null;
      }
    });
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
// Phase 1: LSP Diagnostics — post-edit type checking
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: run LSP diagnostics on files modified by smart_fast_apply.
 * Appends structured diagnostics to result output so LLM can auto-fix errors.
 */
async function triggerLspDiagnostics(args) {
  try {
    const files = extractFilesFromFastApplyArgs(args);
    if (files.length === 0) return '';

    // Only run on supported LSP file types
    const SUPPORTED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.swift', '.php'];
    const lspFiles = files.filter(f => SUPPORTED_EXTS.some(ext => f.endsWith(ext)));
    if (lspFiles.length === 0) return '';

    const { default: lspPlugin } = await import('../plugins/core/lsp.mjs');
    if (typeof lspPlugin?.handler !== 'function') return '';

    const root = args.root || process.cwd();
    const results = [];

    for (const file of lspFiles) {
      try {
        const diagOutput = await lspPlugin.handler({ operation: 'diagnostics', file, root });
        const parsed = typeof diagOutput === 'string' ? JSON.parse(diagOutput) : diagOutput;
        if (parsed?.diagnostics?.length > 0) {
          results.push({ file, diagnostics: parsed.diagnostics });
        }
      } catch {
        // Skip files where LSP fails (e.g., language server not running)
      }
    }

    if (results.length === 0) return '';

    // Format diagnostics as compact, actionable output
    const lines = ['\n\n---\n🔍 LSP 診斷 (自動驗證)'];
    for (const r of results) {
      lines.push(`\n📄 ${r.file}:`);
      for (const d of r.diagnostics.slice(0, 5)) { // Cap at 5 per file
        const severity = d.severity === 1 ? '❌' : d.severity === 2 ? '⚠️' : '💡';
        lines.push(`  ${severity} L${d.line}:${d.character} — ${d.message}`);
      }
      if (r.diagnostics.length > 5) {
        lines.push(`  ... 還有 ${r.diagnostics.length - 5} 個問題`);
      }
    }
    lines.push('\n💡 請根據以上 LSP 診斷結果修正程式碼。');
    lines.push('---');

    return lines.join('\n');
  } catch (e) {
    debugLog('LSP diagnostics error:', e.message);
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

  // Phase 2: Contextual memory search for editing/thinking tools (non-blocking)
  if (CONTEXTUAL_MEMORY_TOOLS.has(def.name)) {
    contextualMemorySearch(def.name, args);
  }

  // Phase 18: Pre-fetch cache check — before executing, check if result was pre-fetched
  const prefetchHit = prefetchEngine.checkCache(def.name, args);
  if (prefetchHit.hit) {
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    debugLog('Prefetch cache HIT for:', def.name);
    return emit(prefetchHit.result, elapsedMs);
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

  // ── Auto-Fix Layer: correct common LLM parameter mistakes before handler runs ──
  // Silent auto-correction — eliminates wasteful LLM round-trips for known mistakes.
  //
  // 1. fast_apply: oldString/newString → search/replace (from old edit tool habit)
  // 2. generic: filePath → file (schema inconsistency)
  // 3. generic: object query → stringified (avoids [[object Object]])
  if (def.name === 'smart_fast_apply' || def.name === 'smart_n') {
    if (contextArgs.oldString !== undefined && contextArgs.search === undefined) {
      contextArgs.search = contextArgs.oldString;
      delete contextArgs.oldString;
    }
    if (contextArgs.newString !== undefined && contextArgs.replace === undefined) {
      contextArgs.replace = contextArgs.newString;
      delete contextArgs.newString;
    }
  }
  if (contextArgs.filePath !== undefined && contextArgs.file === undefined) {
    contextArgs.file = contextArgs.filePath;
    delete contextArgs.filePath;
  }
  if (contextArgs.query && typeof contextArgs.query === 'object') {
    contextArgs.query = JSON.stringify(contextArgs.query);
  }

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
        // Image content — preserve structured data
        const isImage = handlerOutput && typeof handlerOutput === 'object' && handlerOutput._imageContent;
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        if (signal?.aborted) {
          return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
        }
        if (isImage) {
          // Store the full handlerOutput on emitResult so extractImageContent can find data+mimeType
          const emitResult = { ok: true, output: `[image: ${handlerOutput.mimeType}]` };
          Object.assign(emitResult, handlerOutput);
          return emit(emitResult, elapsedMs);
        }
        const output = String(handlerOutput ?? '');
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
// Phase 25: Async tool execution (spawn instead of spawnSync)
// ---------------------------------------------------------------------------

/**
 * Spawn a CLI tool asynchronously. Returns a Promise with { code, stdout, stderr }.
 * Unlike spawnSync, this does NOT block the event loop — allowing the server
 * to process other requests while the tool runs.
 */
function spawnToolAsync(cliPath, cliArgs, msTimeout, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...cliArgs], {
      timeout: msTimeout,
      env: { ...env, ...contextManager.getEnv() },
      windowsHide: true,
      signal,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      resolve({ code: code ?? null, stdout, stderr: stderr.trim() });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Async version of invokeTool for CLI tools. Uses spawn instead of spawnSync.
 * Handler-based tools (fast, in-process) still use the sync path.
 *
 * @param {import('./tool-loader.mjs').default} def
 * @param {Record<string, unknown>} args
 * @param {number|null} timeoutOverride
 * @param {AbortSignal} [signal]
 * @param {{ skipCapture?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, output?: string, error?: string, __async?: boolean }>}
 */
async function invokeToolAsync(def, args, timeoutOverride, signal, opts = {}) {
  const finalAttempt = !opts.skipCapture;
  const startTime = process.hrtime.bigint();

  const emit = (result, elapsedMs) => {
    if (!finalAttempt) return result;
    return captureAndReturn(def.name, args, result, elapsedMs, def);
  };

  // Pre-check: memory lookup (same as sync path)
  const PRECHECK_TOOLS = new Set(['smart_debug', 'smart_test', 'smart_cross_file_edit']);
  if (PRECHECK_TOOLS.has(def.name)) {
    const precheck = preCheckMemory(def.name, args);
    if (precheck) {
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      return emit({ ok: true, output: precheck.output }, elapsedMs);
    }
  }

  // Pre-fetch cache check
  const prefetchHit = prefetchEngine.checkCache(def.name, args);
  if (prefetchHit.hit) {
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    return emit(prefetchHit.result, elapsedMs);
  }

  // Quality enforcement
  const enforcement = checkHighRiskPrerequisites(def.name, args);
  if (enforcement) {
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    return emit({ ok: false, error: enforcement.message }, elapsedMs);
  }

  // Handler path — keep sync (fast, in-process)
  const contextArgs = contextManager.inject(def.name, args);
  if (typeof def.handler === 'function') {
    try {
      const handlerOutput = def.handler(contextArgs);
      if (handlerOutput instanceof Promise) {
        const resolved = await handlerOutput;
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        if (signal?.aborted) return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
        const output = String(resolved ?? '');
        if (isStructuredError(output)) return emit({ ok: false, error: output }, elapsedMs);
        return emit({ ok: true, output }, elapsedMs);
      }
      if (handlerOutput === null) {
        // Fall through to CLI path
      } else {
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        if (signal?.aborted) return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
        const output = String(handlerOutput ?? '');
        if (isStructuredError(output)) return emit({ ok: false, error: output }, elapsedMs);
        return emit({ ok: true, output }, elapsedMs);
      }
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const fix = getErrorFix(def.name, 'generic', err.message);
      return emit({ ok: false, error: `Handler error in ${def.name}: ${err.message}\nFix: ${fix}` }, elapsedMs);
    }
  }

  // CLI path — async spawn
  const cliPath = def._cliPath;
  if (!cliPath) return emit({ ok: false, error: `No CLI path or handler for ${def.name}` }, 0);

  const cliArgs = def.mapArgs(args);
  const msTimeout = (typeof timeoutOverride === 'number' && timeoutOverride > 0)
    ? timeoutOverride
    : (typeof args._timeout === 'number' && args._timeout > 0)
      ? args._timeout
      : runtimeConfig.timeoutMs;

  try {
    const { code, stdout, stderr: capturedStderr } = await spawnToolAsync(cliPath, cliArgs, msTimeout, signal);
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    if (signal?.aborted) {
      return emit({ ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
    }

    if (capturedStderr) debugLog('Stderr:', capturedStderr.slice(0, 2000));

    let output = stdout || '';
    const originalLength = output.length;
    if (originalLength > runtimeConfig.maxOutputChars) {
      output = output.slice(0, runtimeConfig.maxOutputChars) +
        `\n\n--- [TRUNCATED: ${originalLength} chars, showing first ${runtimeConfig.maxOutputChars}] ---`;
    }

    if (code !== 0 && code !== null && !output) {
      const errMsg = `Tool ${def.name} failed: exit ${code}${capturedStderr ? ': ' + capturedStderr : ''}`;
      const fix = getErrorFix(def.name.replace('smart_', ''), 'exit', errMsg);
      return emit({ ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
    }

    if (elapsedMs > 5000) output = output.trimEnd() + `\n\n[Completed in ${(elapsedMs / 1000).toFixed(1)}s]`;
    return emit({ ok: true, output }, elapsedMs);
  } catch (err) {
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    let errMsg, errorType;
    if (err.code === 'ETIMEDOUT' || err.killed) {
      errMsg = `Tool ${def.name} timed out after ${msTimeout}ms`;
      errorType = 'timeout';
    } else if (err.name === 'AbortError') {
      errMsg = `Tool ${def.name} was cancelled`;
      errorType = 'cancel';
    } else {
      errMsg = `Failed to spawn ${def.name}: ${err.message}`;
      errorType = 'generic';
    }
    const fix = getErrorFix(def.name.replace('smart_', ''), errorType, errMsg);
    return emit({ ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
  }
}

/**
 * Async version of invokeToolWithRetry. Uses invokeToolAsync + retry logic.
 * For CLI tools only — handler tools use the sync path.
 */
async function invokeToolWithRetryAsync(def, args, timeoutOverride, signal) {
  let lastResult;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    const retryTimeout = attempt > 1 && timeoutOverride
      ? Math.min(timeoutOverride * attempt, 60000)
      : timeoutOverride;
    const skipCapture = attempt > 1;
    lastResult = await invokeToolAsync(def, args, retryTimeout, signal, { skipCapture });
    if (!isTransientError(lastResult)) return lastResult;
    if (attempt < RETRY_MAX_ATTEMPTS) {
      const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS);
      debugLog(`Retry ${attempt}/${RETRY_MAX_ATTEMPTS - 1} for ${def.name} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      if (signal?.aborted) {
        return { ok: false, error: `Tool ${def.name} was cancelled during retry` };
      }
    }
  }

  // Fallback
  const fallback = FALLBACK_MAP[def.name];
  if (fallback) {
    const fbDef = toolMap.get(fallback.tool || fallback);
    if (fbDef) {
      const fbArgs = typeof fallback === 'object' && fallback.argsTransform
        ? fallback.argsTransform(args)
        : args;
      debugLog(`Fallback: ${def.name} → ${fbDef.name}`);
      const fbResult = await invokeToolAsync(fbDef, fbArgs, timeoutOverride, signal);
      if (!fbResult.ok) return lastResult;
      return {
        ...fbResult,
        output: `[Fallback after ${RETRY_MAX_ATTEMPTS}× retry — using ${fbDef.name}]\n${fbResult.output || ''}`,
      };
    }
  }

  return lastResult;
}

/**
 * Execute a tool through the concurrency gate.
 * - Handler tools (fast, in-process): execute immediately (no gate)
 * - CLI tools (spawn): go through gate, queued if overweight
 *
 * Returns a result object. For async CLI tools, returns { __async: true, promise }.
 */
function executeToolGated(def, args, timeoutOverride, signal, requestId) {
  // Handler tools — skip gate, execute immediately
  if (typeof def.handler === 'function' && !def._cliPath) {
    return invokeToolWithRetry(def, args, timeoutOverride, signal);
  }

  // CLI tools — go through gate
  const acquired = gate.tryAcquire(def.name, requestId);

  if (acquired.allowed) {
    // Got a slot immediately — execute async
    const weight = acquired.weight;
    const startTime = process.hrtime.bigint();

    const promise = invokeToolWithRetryAsync(def, args, timeoutOverride, signal)
      .finally(() => {
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        gate.release(def.name, weight, elapsedMs);
      });

    return { __async: true, promise, toolName: def.name, origArgs: args, startTime, _responsePolicy: def.responsePolicy };
  }

  // Need to wait — enqueue and execute when slot available
  const startTime = process.hrtime.bigint();

  const promise = gate.enqueue(def.name, requestId).then((weight) => {
    const execStartTime = process.hrtime.bigint();
    return invokeToolWithRetryAsync(def, args, timeoutOverride, signal)
      .finally(() => {
        const elapsedMs = Number(process.hrtime.bigint() - execStartTime) / 1_000_000;
        gate.release(def.name, weight, elapsedMs);
      });
  });

  return { __async: true, promise, toolName: def.name, origArgs: args, startTime, _responsePolicy: def.responsePolicy };
}

// ---------------------------------------------------------------------------
// MCP transport
// ---------------------------------------------------------------------------
const PROTOCOL_VERSION = '2024-11-05';

function writeMsg(msg) { stdout.write(JSON.stringify(msg) + '\n'); }

let _respondChain = Promise.resolve();

// Phase 33: Tiered auto context management (replaces fire-once _autoCleared/_autoCompacted)
let _autoState = {
  enabled: true,
  mode: 'normal',        // 'normal' | 'aggressive' | 'off'
  thresholds: { warn: 0.70, critical: 0.85, emergency: 0.95 },
  lastLevel: 0,          // last triggered tier level
  lastAction: 0,         // timestamp of last action
  cooldownMs: 60000,     // 60s cooldown between same-tier actions
};

// Todo follow-up monitoring: 追蹤 auto-compact 後 LLM 是否真正繼續待辦事項
// 若超過 5 次工具呼叫仍未完成 pending todo，自動 re-inject recovery hint
let _todoFollowUp = {
  pendingAt: 0,          // 最後一次 recovery injection 時間戳
  pendingIds: [],        // 當時的 pending todo IDs
  pendingText: '',       // pending todo 文字摘要
  toolCallsSince: 0,     // 自從 recovery 後的工具呼叫次數
  reInjected: false,     // 是否已 re-inject（避免無限重複）
};

/**
 * Extract image content from a result object if it has _imageContent flag.
 * Returns { data, mimeType } or null.
 */
function extractImageContent(obj) {
  if (obj && typeof obj === 'object' && obj._imageContent) {
    return { data: obj.data, mimeType: obj.mimeType };
  }
  return null;
}

/**
 * Build MCP content array from tool result.
 * Detects _imageContent for image responses vs text.
 */
function buildToolContent(resolvedOutput, result) {
  // Image content takes priority — check multiple sources
  const img = extractImageContent(resolvedOutput) || extractImageContent(result);
  if (img) {
    return [{ type: 'image', data: img.data, mimeType: img.mimeType }];
  }
  // Text content
  const text = resolvedOutput !== undefined
    ? String(resolvedOutput ?? '')
    : String(result?.output ?? '');
  return [{ type: 'text', text }];
}

/**
 * Phase 33: Tiered auto context management.
 * Replaces fire-once _autoCleared/_autoCompacted with a proper tiered system.
 * Tier 1 (70%): Show droppable stats suggestion
 * Tier 2 (85%): Auto-clear low-value outputs
 * Tier 3 (95%): Emergency aggressive clear
 */
function autoManageContext(budget) {
  const s = _autoState;
  if (!s.enabled || s.mode === 'off') return '';

  const used = budget.usedFraction;
  const now = Date.now();
  const inCooldown = (now - s.lastAction) < s.cooldownMs;

  // Tier 3: Emergency (95%) — always trigger, no cooldown
  if (used >= s.thresholds.emergency) {
    s.lastLevel = 3; s.lastAction = now;
    try {
      ensureContext();
      // 先產生 recovery context，保存 todo/decision/error 狀態
      contextManager.generateRecoveryContext();
      const cleared = contextManager.clearToolResults({ olderThan: 3, keepLatest: 2 });
      budget.freeEntries(cleared.removed);
      const stats = budget.getDroppableStats();
      // 取得恢復指引（含未完成 todo、近期編輯、繼續方向）
      const recoveryText = contextManager.formatRecoveryContext();
      debugLog(`AutoManage Tier3: cleared ${cleared.removed} entries (budget=${(used*100).toFixed(0)}%)`);
      let msg = `\n\n---\n🚨 Context 危急：${(used*100).toFixed(0)}%。已緊急清除 ${cleared.removed} 筆輸出。\n可丟棄: ${(stats.discardable/1024).toFixed(1)}KB, 可摘要: ${(stats.summarizable/1024).toFixed(1)}KB`;
      if (recoveryText) {
        msg += `\n\n${recoveryText}`;
      }
      // 追蹤 pending todo 供 follow-up 監控
      _todoFollowUp.pendingAt = now;
      _todoFollowUp.pendingText = recoveryText || '';
      _todoFollowUp.toolCallsSince = 0;
      _todoFollowUp.reInjected = false;
      try {
        const pendingTodos = contextManager.listTodos().filter(t => t.status === 'pending' || t.status === 'in_progress');
        _todoFollowUp.pendingIds = pendingTodos.map(t => t.id);
      } catch { _todoFollowUp.pendingIds = []; }

      // 寫入共享檔案供 OpenCode plugin 在 compaction 時讀取
      writeSharedRecoveryFile(recoveryText);
      return msg + '\n---';
    } catch (e) {
      debugLog('AutoManage Tier3 error:', e.message);
    }
    return '';
  }

  // Tier 2: Warning (85%) — cooldown-gated
  if (used >= s.thresholds.critical && (!inCooldown || s.lastLevel < 2)) {
    s.lastLevel = 2; s.lastAction = now;
    try {
      ensureContext();
      // 先產生 recovery context，保存 todo/decision/error 狀態
      contextManager.generateRecoveryContext();
      const cleared = contextManager.clearToolResults({ olderThan: 5, keepLatest: 3 });
      budget.freeEntries(cleared.removed);
      const stats = budget.getDroppableStats();
      // 取得恢復指引（含未完成 todo、近期編輯、繼續方向）
      const recoveryText = contextManager.formatRecoveryContext();
      debugLog(`AutoManage Tier2: cleared ${cleared.removed} entries (budget=${(used*100).toFixed(0)}%)`);
      if (cleared.removed > 0) {
        let msg = `\n\n---\n⚠️ Context ${(used*100).toFixed(0)}%。已自動清除 ${cleared.removed} 筆輸出（釋放約 ${(stats.discardable/1024).toFixed(1)}KB）。`;
        if (recoveryText) {
          msg += `\n\n${recoveryText}`;
        }
        // 追蹤 pending todo 供 follow-up 監控
        _todoFollowUp.pendingAt = now;
        _todoFollowUp.pendingText = recoveryText || '';
        _todoFollowUp.toolCallsSince = 0;
        _todoFollowUp.reInjected = false;
        try {
          const pendingTodos = contextManager.listTodos().filter(t => t.status === 'pending' || t.status === 'in_progress');
          _todoFollowUp.pendingIds = pendingTodos.map(t => t.id);
        } catch { _todoFollowUp.pendingIds = []; }

        // 寫入共享檔案供 OpenCode plugin 在 compaction 時讀取
        writeSharedRecoveryFile(recoveryText);
        return msg + '\n---';
      }
    } catch (e) {
      debugLog('AutoManage Tier2 error:', e.message);
    }
    return '';
  }

  // Tier 1: Reminder (70%) — cooldown-gated, suggestion only
  if (used >= s.thresholds.warn && (!inCooldown || s.lastLevel < 1)) {
    s.lastLevel = 1; s.lastAction = now;
    const stats = budget.getDroppableStats();
    const droppableKB = ((stats.discardable + stats.summarizable) / 1024).toFixed(1);
    if (stats.discardable + stats.summarizable > 2000) {
      return `\n\n---\n💡 Context ${(used*100).toFixed(0)}%。可釋放約 ${droppableKB}KB：\n  - 無匹配搜尋: ${(stats.discardable/1024).toFixed(1)}KB\n  - 可摘要輸出: ${(stats.summarizable/1024).toFixed(1)}KB\n👉 執行 smart_compact({auto:true}) 或忽略\n---`;
    }
  }

  return '';
}

/**
 * 寫入 recovery text 到共享檔案，供 OpenCode plugin (compaction-fix.js) 讀取。
 * Plugin 在 onCompacting hook 中讀取此檔案，確保 Smart MCP 的 recovery context
 * 在 OpenCode native compaction 後仍能被保留在摘要中。
 * 若 recoveryText 為空，則清除檔案（避免留過期資料）。
 */
function writeSharedRecoveryFile(recoveryText) {
  try {
    const filePath = resolve(homedir(), '.smart', 'recent-recovery.txt');
    if (recoveryText) {
      writeFileSync(filePath, recoveryText, 'utf-8');
    } else {
      // 空值 → 清除檔案
      try { existsSync(filePath) && unlinkSync(filePath); } catch {}
    }
  } catch (err) {
    debugLog('writeSharedRecoveryFile error:', err.message);
  }
}

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

    // Track output size for context budget (Phase 30: pass text for metadata exclusion)
    const finalSize = result.content[0].text.length;
    budget.track(
      result._toolName || 'unknown',
      finalSize,
      opt.meta?._optimized?.level > 0,
      originalSize,
      result.content[0].text  // Phase 30: pass full text for metadata exclusion
    );

    // Phase 14.4: Context Rot Warning — inject threshold-specific actionable advice
    const rotWarning = budget.getRotWarning();
    if (rotWarning) {
      const status = budget.getStatus();
      result.content[0].text += `\n\n---\n📊 Context Budget: ${status.usedPct} used (${status.remainingPct} remaining) — ${rotWarning}\n---`;
    }

    // Phase 33: Tiered auto context management (replaces fire-once _autoCleared/_autoCompacted)
    const autoMsg = autoManageContext(budget);
    if (autoMsg) {
      result.content[0].text += autoMsg;
    }
  } else if (result?.content?.[0]?.type === 'text' && typeof result.content[0].text === 'string') {
    // Track even non-optimized outputs (Phase 30: pass text for metadata exclusion)
    const budget = getContextBudget();
    budget.track(result._toolName || 'unknown', result.content[0].text.length, false, 0, result.content[0].text);
  }

  // Phase: Apply modelSize-specific formatting (emoji stripping for small/micro)
  // Runs after optimization — does not affect optimization metadata or budget tracking
  const curSize = runtimeConfig.modelSize;
  if (curSize !== 'large' && result?.content?.[0]?.type === 'text' && typeof result.content[0].text === 'string') {
    result.content[0].text = formatForModelSize(result.content[0].text, curSize);
  }

  // Write chain — awaits pending async work (e.g. Phase 10.2 impact warning),
  // then serializes writes to maintain MCP JSON-RPC ordering.
  // Each hook individually try/catched so one failure never blocks writeMsg.
  _respondChain = _respondChain.then(async () => {
    try {
      if (result._pendingImpact) {
        const impactText = await result._pendingImpact;
        delete result._pendingImpact;
        if (impactText && result?.content?.[0]?.type === 'text') {
          result.content[0].text += impactText;
        }
      }
    } catch (e) { debugLog('respond._pendingImpact error:', e?.message); delete result._pendingImpact; }
    try {
      if (result._pendingHallucination) {
        const hcText = await result._pendingHallucination;
        delete result._pendingHallucination;
        if (hcText && result?.content?.[0]?.type === 'text') {
          result.content[0].text += hcText;
        }
      }
    } catch (e) { debugLog('respond._pendingHallucination error:', e?.message); delete result._pendingHallucination; }
    try {
      if (result._pendingLsp) {
        const lspText = await result._pendingLsp;
        delete result._pendingLsp;
        if (lspText && result?.content?.[0]?.type === 'text') {
          result.content[0].text += lspText;
        }
      }
    } catch (e) { debugLog('respond._pendingLsp error:', e?.message); delete result._pendingLsp; }
    try {
      if (result._pendingRecovery) {
        const recoveryText = await result._pendingRecovery;
        delete result._pendingRecovery;
        if (recoveryText && result?.content?.[0]?.type === 'text') {
          result.content[0].text += '\n\n' + recoveryText;
        }
        // 同步寫入共享檔案 — fullCompact 路徑也需要 plugin 能讀到
        writeSharedRecoveryFile(recoveryText);
      }
    } catch (e) { debugLog('respond._pendingRecovery error:', e?.message); delete result._pendingRecovery; }
    try {
      // Phase 33b: Todo follow-up re-injection
      if (result._reInjectRecovery) {
        const reInjectText = result._reInjectRecovery;
        delete result._reInjectRecovery;
        if (reInjectText && result?.content?.[0]?.type === 'text') {
          result.content[0].text += '\n\n---\n🔄 [Todo Follow-up] 偵測到 pending todo 停滯，重新注入恢復指引：\n\n' + reInjectText + '\n---';
          debugLog('Todo follow-up: re-injected recovery text');
        }
      }
    } catch (e) { debugLog('respond._reInjectRecovery error:', e?.message); delete result._reInjectRecovery; }
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
        _autoState.lastLevel = 0;
        _autoState.lastAction = 0;
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

      // P4: 自動回填 — 查看/讀取/恢復 compacted 備份
      case 'compacted': {
        const backups = contextManager.listCompactedBackups();
        if (backups.length === 0) {
          result = 'No compacted backups available.';
        } else {
          result = JSON.stringify({ count: backups.length, backups }, null, 2);
        }
        break;
      }

      case 'read-compacted': {
        const idx = args.index ?? 'last';
        const entry = contextManager.readCompactedEntry(idx);
        if (!entry) {
          result = `No compacted backup found at index: ${idx}`;
        } else {
          result = JSON.stringify({ index: idx, entry }, null, 2);
        }
        break;
      }

      case 'restore-compacted': {
        const ridx = args.index ?? 'last';
        const restored = contextManager.restoreCompactedEntry(ridx);
        if (restored.ok) {
          result = `Restored ${restored.entry.tool} from compacted backup to tool history.`;
          debugLog(`restore-compacted: ${restored.entry.tool} (index ${ridx})`);
        } else {
          result = `Failed to restore: no backup at index ${ridx}`;
        }
        break;
      }

      case 'auto': {
        const mode = args.mode || 'status';
        if (mode === 'on') {
          _autoState.enabled = true;
          _autoState.mode = 'normal';
        } else if (mode === 'off') {
          _autoState.enabled = false;
        } else if (mode === 'aggressive') {
          _autoState.enabled = true;
          _autoState.mode = 'aggressive';
          _autoState.thresholds = { warn: 0.55, critical: 0.70, emergency: 0.85 };
        }
        if (args.thresholds && typeof args.thresholds === 'object') {
          if (typeof args.thresholds.warn === 'number') _autoState.thresholds.warn = args.thresholds.warn;
          if (typeof args.thresholds.critical === 'number') _autoState.thresholds.critical = args.thresholds.critical;
          if (typeof args.thresholds.emergency === 'number') _autoState.thresholds.emergency = args.thresholds.emergency;
        }
        const budget = getContextBudget();
        result = JSON.stringify({
          autoManage: { enabled: _autoState.enabled, mode: _autoState.mode, thresholds: _autoState.thresholds },
          currentBudget: budget.getStatus(),
          droppableStats: budget.getDroppableStats(),
        }, null, 2);
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
      // Filter by model size: small/micro hides certain tools from manifest
      const modelSize = runtimeConfig.modelSize;
      const hiddenSet = modelSize !== 'large' ? HIDDEN_NATIVE_TOOLS[modelSize] : null;
      const filteredTools = hiddenSet
        ? nativeTools.filter(t => !hiddenSet.has(t.name))
        : nativeTools;

      const tools = filteredTools.map(t => ({
        name: t.name,
        description: `[${t.category || 'core'}] ${t.description}`,
        inputSchema: t.inputSchema,
      }));
      // Add the router tool (always available, MCP standard)
      tools.push({
        name: 'smart_run',
        description: ROUTER_DESCRIPTION,
        inputSchema: ROUTER_SCHEMA,
      });
      // Add the context tool (always available)
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
      // Add the config tool (allows LLM to switch modelSize at runtime)
      tools.push({
        name: 'smart_config',
        description: '[config] Get or set server runtime configuration. Supports modelSize (large/small/micro), debug, timeoutMs.',
        inputSchema: {
          type: 'object',
          properties: {
            set: {
              type: 'object',
              description: 'Configuration values to set. Use {\"modelSize\":\"small\"} to switch modes.',
              properties: {
                modelSize: { type: 'string', enum: ['large', 'small', 'micro'], description: 'Switch model size mode' },
                debug: { type: 'boolean', description: 'Enable/disable debug logging' },
                timeoutMs: { type: 'number', description: 'Default tool timeout in ms' },
              },
            },
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
                // Image content — bypass text processing
                const _img1 = extractImageContent(resolvedOutput);
                if (_img1) {
                  captureAndReturn(tName, origArgs, { ok: true, output: `[image: ${_img1.mimeType}]` }, elapsedMs);
                  respond(id, { content: [{ type: 'image', data: _img1.data, mimeType: _img1.mimeType }] });
                  return;
                }
                // AUTO-FIX: normalize {ok,output} object → string (fixes [object Object] bug)
                if (typeof resolvedOutput === "object" && resolvedOutput !== null && "ok" in resolvedOutput) {
                  if (!resolvedOutput.ok) {
                    const _errMsg = resolvedOutput.error ?? "Tool returned error";
                    const _cr = captureAndReturn(tName, origArgs, { ok: false, error: _errMsg }, elapsedMs);
                    respond(id, { content: [{ type: "text", text: _cr.error }], isError: true }, { optimize: false });
                    return;
                  }
                  resolvedOutput = resolvedOutput.output ?? "";
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
                if (cr._pendingLsp) resp1._pendingLsp = cr._pendingLsp;
                if (cr._pendingHallucination) resp1._pendingHallucination = cr._pendingHallucination;
                if (cr._pendingRecovery) resp1._pendingRecovery = cr._pendingRecovery;
                if (cr._reInjectRecovery) resp1._reInjectRecovery = cr._reInjectRecovery;
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
            // Check for image content
            const _img2 = extractImageContent(result);
            if (_img2) {
              respond(id, { content: [{ type: 'image', data: _img2.data, mimeType: _img2.mimeType }] });
              return;
            }
            const resp2 = { content: [{ type: 'text', text: String(result.output ?? "") }] };
            if (result._responsePolicy) resp2._responsePolicy = result._responsePolicy;
            if (result._pendingImpact) resp2._pendingImpact = result._pendingImpact;
            if (result._pendingLsp) resp2._pendingLsp = result._pendingLsp;
            if (result._pendingHallucination) resp2._pendingHallucination = result._pendingHallucination;
            respond(id, resp2);
          } else {
            respond(id, {
              content: [{ type: 'text', text: String(result.error ?? "") }],
              isError: true,
            }, { optimize: false });
          }
        } finally { if (id != null) pendingCalls.delete(String(id)); }
        break;
      }

      // smart_config → server config (same as smart/config JSON-RPC method)
      if (toolName === 'smart_config') {
        const args4 = (params?.arguments || {});
        if (args4.set && typeof args4.set === 'object') {
          const changes = args4.set;
          const applied = {};
          const rejected = {};
          if (typeof changes.debug === 'boolean') { runtimeConfig.debug = changes.debug; applied.debug = runtimeConfig.debug; }
          if (typeof changes.timeoutMs === 'number' && changes.timeoutMs > 0) { runtimeConfig.timeoutMs = changes.timeoutMs; applied.timeoutMs = runtimeConfig.timeoutMs; }
          if (typeof changes.modelSize === 'string' && ['large', 'small', 'micro'].includes(changes.modelSize)) { runtimeConfig.modelSize = changes.modelSize; applied.modelSize = runtimeConfig.modelSize; }
          for (const key of Object.keys(changes)) { if (!(key in applied)) rejected[key] = 'Unknown or invalid'; }
          respond(id, { content: [{ type: 'text', text: JSON.stringify({ applied, rejected }) }] });
        } else {
          respond(id, { content: [{ type: 'text', text: JSON.stringify({ ...runtimeConfig }) }] });
        }
        break;
      }

      // Phase 33: Inject toolHistory for smart_compact auto mode
      if (toolName === 'smart_compact' && args.auto) {
        ensureContext();
        const ctx = contextManager.get();
        if (ctx && Array.isArray(ctx.toolHistory)) {
          args.toolHistory = ctx.toolHistory.map(h => ({
            tool: h.tool,
            ok: h.ok,
            result: h.result,
            error: h.error,
            timestamp: h.timestamp,
          }));
        }
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
        const result = executeToolGated(def, args, null, controller.signal, String(id));

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
              // Image content — bypass text processing
              const _img3 = extractImageContent(resolvedOutput);
              if (_img3) {
                captureAndReturn(tName, origArgs, { ok: true, output: `[image: ${_img3.mimeType}]` }, elapsedMs);
                respond(id, { content: [{ type: 'image', data: _img3.data, mimeType: _img3.mimeType }] });
                return;
              }
              // AUTO-FIX: normalize {ok,output} object → string (fixes [object Object] bug)
              if (typeof resolvedOutput === "object" && resolvedOutput !== null && "ok" in resolvedOutput) {
                if (!resolvedOutput.ok) {
                  const _errMsg = resolvedOutput.error ?? "Tool returned error";
                  const _cr = captureAndReturn(tName, origArgs, { ok: false, error: _errMsg }, elapsedMs);
                  respond(id, { content: [{ type: "text", text: _cr.error }], isError: true }, { optimize: false });
                  return;
                }
                resolvedOutput = resolvedOutput.output ?? "";
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
              if (cr._pendingLsp) resp3._pendingLsp = cr._pendingLsp;
              if (cr._pendingHallucination) resp3._pendingHallucination = cr._pendingHallucination;
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
          // Check for image content
          const _img4 = extractImageContent(result);
          if (_img4) {
            respond(id, { content: [{ type: 'image', data: _img4.data, mimeType: _img4.mimeType }] });
            return;
          }
          const resp4 = { content: [{ type: 'text', text: String(result.output ?? "") }] };
          if (result._responsePolicy) resp4._responsePolicy = result._responsePolicy;
          if (result._pendingImpact) resp4._pendingImpact = result._pendingImpact;
          respond(id, resp4);
        } else {
          respond(id, {
            content: [{ type: 'text', text: String(result.error ?? "") }],
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
        status: 'ok', version: '3.2.0',
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
        concurrency: gate.getStatus(),
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
        if (typeof changes.modelSize === 'string' && ['large', 'small', 'micro'].includes(changes.modelSize)) { runtimeConfig.modelSize = changes.modelSize; applied.modelSize = runtimeConfig.modelSize; }
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
