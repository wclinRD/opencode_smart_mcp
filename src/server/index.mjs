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

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, env } from 'node:process';
import { argv } from 'node:process';
import { toolMap, nativeTools, routerTools } from './loader.mjs';
import { ContextManager } from '../lib/context-manager.mjs';

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
const stats = { startTime: Date.now(), totalCalls: 0, totalErrors: 0, totalDurationMs: 0, byTool: new Map() };

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------
const contextManager = new ContextManager({ autoSave: true, extractFindings: true });
let contextInitialized = false;

function ensureContext() {
  if (!contextInitialized) {
    contextManager.init({ projectRoot: env.PWD || env.CWD || process.cwd() });
    contextInitialized = true;
    debugLog('Context initialized:', contextManager.get()?.sessionId);
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
  return {
    uptimeMs: Date.now() - stats.startTime, totalCalls: stats.totalCalls, totalErrors: stats.totalErrors,
    errorRate: stats.totalCalls > 0 ? (stats.totalErrors / stats.totalCalls * 100).toFixed(1) + '%' : '0%',
    avgDurationMs: stats.totalCalls > 0 ? Math.round(stats.totalDurationMs / stats.totalCalls) : 0,
    byTool,
  };
}

function resetStats() { stats.startTime = Date.now(); stats.totalCalls = 0; stats.totalErrors = 0; stats.totalDurationMs = 0; stats.byTool.clear(); }

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------
const runtimeConfig = { debug: DEBUG, timeoutMs: TOOL_TIMEOUT, maxOutputSize: MAX_OUTPUT_SIZE, maxOutputChars: MAX_OUTPUT_CHARS };

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

  // -- smart_thinking --
  smart_thinking: {
    missing:    'topic is required for static/dynamic modes. Usage: smart_thinking(topic:"your question", template:"analyze")',
    generic:    'Dynamic mode needs an active session. Start one with: smart_thinking(topic:"...", dynamic:true)',
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
  toonify: {
    missing:   'command is required. Usage: smart_run(tool:"toonify", args:{command:"stats"})',
  },
  py_helper: {
    missing:   'command is required (lint/typecheck/test). Usage: smart_run(tool:"py_helper", args:{command:"lint", file:"src/foo.py"})',
  },
  ts_helper: {
    missing:   'command is required (typecheck/lint/test). Usage: smart_run(tool:"ts_helper", args:{command:"typecheck", file:"src/foo.ts"})',
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
  '  [report]  diagram(type,title), report(type,title), toonify(command,content)\n' +
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

  // Execute — invokeTool captures internally via captureAndReturn
  debugLog('Router dispatch:', subTool, 'args:', JSON.stringify(subArgs));
  const result = invokeTool(def, subArgs, timeout || null, signal);
  return result;
}

// ---------------------------------------------------------------------------
// Tool invocation (CLI spawn)
// ---------------------------------------------------------------------------

/**
 * Capture context result and record stats, then return.
 * Shared helper to avoid repeating the capture/record pattern in every return path.
 */
function captureAndReturn(toolName, args, result, elapsedMs) {
  const success = result.ok === true;
  recordStats(toolName, elapsedMs, success);
  ensureContext();
  contextManager.capture(toolName, args, result, elapsedMs);
  return result;
}

/**
 * Invoke a tool — either via direct handler (no spawn) or via `node <cli>.mjs <args>`.
 * @param {import('./tool-loader.mjs').default} def - tool definition
 * @param {Record<string, unknown>} args
 * @param {number|null} timeoutOverride
 * @param {AbortSignal} [signal]
 */
function invokeTool(def, args, timeoutOverride, signal) {
  const startTime = process.hrtime.bigint();

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
        };
      }
      // Handler returns null to signal "fall back to CLI" (e.g. interactive mode)
      if (handlerOutput === null) {
        debugLog('Handler returned null, falling back to CLI for:', def.name);
      } else {
        const output = String(handlerOutput ?? '');
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        if (signal?.aborted) {
          return captureAndReturn(def.name, args, { ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
        }
        return captureAndReturn(def.name, args, { ok: true, output }, elapsedMs);
      }
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const fix = getErrorFix(def.name, 'generic', err.message);
      return captureAndReturn(def.name, args, { ok: false, error: `Handler error in ${def.name}: ${err.message}\nFix: ${fix}` }, elapsedMs);
    }
  }

  const cliPath = def._cliPath;
  if (!cliPath) return captureAndReturn(def.name, args, { ok: false, error: `No CLI path or handler for ${def.name}` }, 0);

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
    return captureAndReturn(def.name, args, { ok: false, error: `Tool ${def.name} was cancelled` }, elapsedMs);
  }

  if (result.error) {
    let errMsg, errorType;
    if (result.error.code === 'ETIMEDOUT') { errMsg = `Tool ${def.name} timed out after ${msTimeout}ms`; errorType = 'timeout'; }
    else if (result.error.code === 'ABORT_ERR') { errMsg = `Tool ${def.name} was cancelled`; errorType = 'cancel'; }
    else { errMsg = `Failed to spawn ${def.name}: ${result.error.message}`; errorType = 'generic'; }
    const fix = getErrorFix(def.name.replace('smart_', ''), errorType, errMsg);
    debugLog('Error:', errMsg);
    return captureAndReturn(def.name, args, { ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
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
    return captureAndReturn(def.name, args, { ok: false, error: `${errMsg}\nFix: ${fix}` }, elapsedMs);
  }

  if (elapsedMs > 5000) output = output.trimEnd() + `\n\n[Completed in ${(elapsedMs / 1000).toFixed(1)}s]`;
  return captureAndReturn(def.name, args, { ok: true, output }, elapsedMs);
}

// ---------------------------------------------------------------------------
// MCP transport
// ---------------------------------------------------------------------------
const PROTOCOL_VERSION = '2024-11-05';

function writeMsg(msg) { stdout.write(JSON.stringify(msg) + '\n'); }
function respond(id, result) { writeMsg({ jsonrpc: '2.0', id, result }); }
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
  '  command: "get" (default) | "summary" | "history" | "findings" | "reset" | "sessions" | "delete" | "inject" | "workflow-stats"\n' +
  '  sessionId: optional, for resume/delete operations';

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
        if (!ctx) { respond(id, { content: [{ type: 'text', text: 'No active session.' }] }); return; }
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
        result = `Session reset. SessionId: ${contextManager.get()?.sessionId}`;
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

      case 'workflow-stats': {
        const wfId = args.workflowId || args.id;
        if (!wfId) { result = 'workflowId required for workflow-stats.'; break; }
        const cost = contextManager.getWorkflowCost(wfId);
        if (!cost) { result = `No data found for workflow: ${wfId}. Ensure tools were called with this workflowId.`; break; }
        result = JSON.stringify(cost, null, 2);
        break;
      }

      default:
        result = `Unknown command: ${cmd}. Available: get, summary, history, findings, reset, sessions, delete, inject, workflow-stats`;
    }

    respond(id, { content: [{ type: 'text', text: result }] });
  } catch (err) {
    const fix = getErrorFix('smart_context', 'generic', err.message);
    respondError(id, -32603, `smart_context error: ${err.message}`, {
      tool: 'smart_context', args: JSON.stringify(args),
      error: err.message, type: 'execution', suggestion: fix,
    });
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
            command: { type: 'string', description: 'Command: get (default), summary, history, findings, reset, sessions, delete, inject, workflow-stats', enum: ['get', 'summary', 'history', 'findings', 'reset', 'sessions', 'delete', 'inject', 'workflow-stats'] },
            sessionId: { type: 'string', description: 'Session ID (for resume/delete)' },
            workflowId: { type: 'string', description: 'Workflow ID (for workflow-stats)' },
            projectRoot: { type: 'string', description: 'Project root path' },
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
            const { promise, toolName: tName, origArgs, startTime: st } = result;
            promise
              .then(resolvedOutput => {
                const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
                if (controller.signal.aborted) {
                  captureAndReturn(tName, origArgs, { ok: false, error: `Tool ${tName} was cancelled` }, elapsedMs);
                  respond(id, { content: [{ type: 'text', text: '' }] });
                  return;
                }
                const output = String(resolvedOutput ?? '');
                const cr = captureAndReturn(tName, origArgs, { ok: true, output }, elapsedMs);
                respond(id, { content: [{ type: 'text', text: cr.output }] });
              })
              .catch(err => {
                const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
                const fix = getErrorFix(tName.replace('smart_', ''), 'generic', err.message);
                const cr = captureAndReturn(tName, origArgs, { ok: false, error: `Handler error in ${tName}: ${err.message}\nFix: ${fix}` }, elapsedMs);
                respondError(id, -32603, `smart_run error: ${cr.error}`, {
                  tool: 'smart_run', args: JSON.stringify(origArgs), error: cr.error,
                  type: 'execution',
                  suggestion: fix,
                });
              });
          } else if (result.ok) {
            respond(id, { content: [{ type: 'text', text: result.output }] });
          } else {
            // Extract fix from result.error (already has Fix: appended by handleDevtoolRun)
            const errLines = result.error.split('\n');
            const suggestion = errLines.find(l => l.startsWith('Fix:'))?.replace('Fix:', '').trim()
              || 'Check the tool name and args. Use smart_run(tool:"help", args:{}) to list all tools.';
            respondError(id, -32603, `smart_run error: ${result.error}`, {
              tool: toolName, args: JSON.stringify(args), error: result.error,
              type: 'execution',
              suggestion,
            });
          }
        } finally { if (id != null) pendingCalls.delete(String(id)); }
        break;
      }

      // Native tool
      const def = toolMap.get(toolName);
      if (!def) {
        const availableTools = Array.from(toolMap.keys()).join(', ');
        const fix = getErrorFix(toolName, 'notFound', `Unknown tool: ${toolName}`);
        respondError(id, -32602, `Unknown tool: ${toolName}. Available: ${availableTools}`, {
          availableTools: Array.from(toolMap.keys()),
          suggestion: fix,
        });
        break;
      }

      const controller = new AbortController();
      if (id != null) pendingCalls.set(String(id), controller);
      try {
        const result = invokeTool(def, args, null, controller.signal);

        // Async handler — resolve Promise and respond
        if (result && result.__async) {
          const { promise, toolName: tName, origArgs, startTime: st } = result;
          promise
            .then(resolvedOutput => {
              const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
              if (controller.signal.aborted) {
                captureAndReturn(tName, origArgs, { ok: false, error: `Tool ${tName} was cancelled` }, elapsedMs);
                respond(id, { content: [{ type: 'text', text: '' }] });
                return;
              }
              const output = String(resolvedOutput ?? '');
              const cr = captureAndReturn(tName, origArgs, { ok: true, output }, elapsedMs);
              respond(id, { content: [{ type: 'text', text: cr.output }] });
            })
            .catch(err => {
              const elapsedMs = Number(process.hrtime.bigint() - st) / 1_000_000;
              const fix = getErrorFix(tName.replace('smart_', ''), 'generic', err.message);
              const cr = captureAndReturn(tName, origArgs, { ok: false, error: `Handler error in ${tName}: ${err.message}\nFix: ${fix}` }, elapsedMs);
              respondError(id, -32603, `Tool execution failed: ${tName}`, {
                tool: tName, args: JSON.stringify(origArgs), error: cr.error,
                type: 'execution', suggestion: fix,
              });
            });
          return;
        }

        if (result.ok) {
          respond(id, { content: [{ type: 'text', text: result.output }] });
        } else {
          const isTimeout = result.error.includes('timed out');
          const isCancelled = result.error.includes('cancelled');
          const errorType = isTimeout ? 'timeout' : isCancelled ? 'cancel' : 'generic';
          const fix = getErrorFix(toolName.replace('smart_', ''), errorType, result.error);
          respondError(id, -32603, isCancelled ? `Tool ${toolName} cancelled` : `Tool execution failed: ${toolName}`, {
            tool: toolName, args: JSON.stringify(args), error: result.error,
            type: isTimeout ? 'timeout' : isCancelled ? 'cancelled' : 'execution',
            suggestion: fix,
          });
        }
      } finally { if (id != null) pendingCalls.delete(String(id)); }
      break;
    }

    case 'ping': { respond(id, {}); break; }

    case 'smart/health': {
      const ctx = contextManager.get();
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
        respondError(id, -32603, `smart/context error: ${err.message}`);
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
    req = JSON.parse(trimmed);
  } catch {
    try { const fb = JSON.parse(trimmed); if (fb && typeof fb.id !== 'undefined') respondError(fb.id, -32700, 'Parse error'); } catch { /* ignore */ }
    return;
  }
  if (!req || typeof req.method !== 'string') {
    if (req && typeof req.id !== 'undefined') respondError(req.id, -32600, 'Invalid Request');
    return;
  }
  handleRequest(req);
});

rl.on('close', () => {});
