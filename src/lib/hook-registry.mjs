// hook-registry.mjs — Unified hook system for Smart MCP
//
// Architecture:
//   Pre-hooks:  run BEFORE tool execution (can block)
//   Post-hooks: run AFTER tool execution (fire-and-forget, non-blocking)
//
// Built-in hooks (migrated from ad-hoc fire-and-forget in server/index.mjs):
//   - lsp-diagnostics:    after smart_fast_apply → LSP diagnostics
//   - impact-warning:     after multi-file edit → code impact analysis
//   - hallucination-check: after high-risk tool output → hallucination verification
//   - prefetch-engine:    speculative pre-fetch for likely next tool
//
// User hooks (phase B):
//   - bash: run shell command, supports {file} template
//   - mcp_tool: call existing MCP tool

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HOOKS = {
  preTool: [],   // { id, name, match, handler, enabled }
  postTool: [],  // { id, name, match, handler, enabled }
};

// Production constraints (Sprint 1C)
const MAX_HOOKS_PER_TYPE = 10;
const MAX_POST_HOOK_CONCURRENCY = 3;
const POST_HOOK_TIMEOUT_MS = 10000;

let _hookIdCounter = 0;

// Execution log (Sprint 1C)
let _executionLog = [];
let _activePostHooks = 0;
let _postHookQueue = [];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Register a pre-tool hook. Runs synchronously before tool execution.
 * If handler returns { block: true, message }, execution is blocked.
 * @param {object} hook
 * @param {string} hook.name - unique hook name
 * @param {string} hook.description - human-readable description
 * @param {function} hook.match - (toolName, args) => bool
 * @param {function} hook.handler - (ctx) => { block?: bool, message?: string } | null
 * @param {'bash'|'mcp_tool'|null} hook.type - user hook type (phase B)
 * @param {string|null} hook.command - shell command (type: bash)
 * @returns {string} hook id
 */
export function registerPreHook(hook) {
  if (HOOKS.preTool.length >= MAX_HOOKS_PER_TYPE) {
    throw new Error(`Max ${MAX_HOOKS_PER_TYPE} pre-tool hooks reached`);
  }
  const id = `pre-${++_hookIdCounter}`;
  HOOKS.preTool.push({
    id,
    name: hook.name || id,
    description: hook.description || '',
    match: hook.match || (() => false),
    handler: hook.handler || (() => null),
    type: hook.type || null,
    command: hook.command || null,
    enabled: hook.enabled !== false,
  });
  return id;
}

/**
 * Register a post-tool hook. Runs asynchronously after tool execution.
 * Return value is attached to result._pendingHooks for respond() chain.
 * @param {object} hook
 * @param {string} hook.name - unique hook name
 * @param {string} hook.description - human-readable description
 * @param {function} hook.match - (toolName, args, result) => bool
 * @param {function} hook.handler - (ctx) => Promise<string> | string
 * @returns {string} hook id
 */
export function registerPostHook(hook) {
  if (HOOKS.postTool.length >= MAX_HOOKS_PER_TYPE) {
    throw new Error(`Max ${MAX_HOOKS_PER_TYPE} post-tool hooks reached`);
  }
  const id = `post-${++_hookIdCounter}`;
  HOOKS.postTool.push({
    id,
    name: hook.name || id,
    description: hook.description || '',
    match: hook.match || (() => false),
    handler: hook.handler || (() => ''),
    type: hook.type || null,
    command: hook.command || null,
    enabled: hook.enabled !== false,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute all matching pre-hooks for a tool call.
 * @param {string} toolName
 * @param {object} args
 * @returns {Array<{hook: string, block?: boolean, message?: string}>}
 */
export function executePreHooks(toolName, args) {
  const results = [];
  for (const hook of HOOKS.preTool) {
    if (!hook.enabled) continue;
    const start = Date.now();
    try {
      if (hook.match(toolName, args)) {
        const ctx = { toolName, args };
        const result = hook.handler(ctx);
        const duration = Date.now() - start;
        if (result && result.block) {
          results.push({ hook: hook.name, block: true, message: result.message || 'Blocked by hook' });
          _executionLog.push({ type: 'pre', hook: hook.name, duration, status: 'blocked', tool: toolName });
        } else if (result && result.defer) {
          results.push({ hook: hook.name, defer: true, message: result.message || '' });
          _executionLog.push({ type: 'pre', hook: hook.name, duration, status: 'deferred', tool: toolName });
        } else {
          results.push({ hook: hook.name, block: false });
          _executionLog.push({ type: 'pre', hook: hook.name, duration, status: 'ok', tool: toolName });
        }
      }
    } catch (err) {
      const duration = Date.now() - start;
      _executionLog.push({ type: 'pre', hook: hook.name, duration, status: 'error', error: err.message, tool: toolName });
      results.push({ hook: hook.name, block: false, error: err.message });
    }
  }
  return results;
}

/**
 * Execute all matching post-hooks for a tool call.
 * Returns promises for the respond() chain.
 * @param {string} toolName
 * @param {object} args
 * @param {object} result - tool result { ok, output }
 * @returns {Array<{hook: string, promise: Promise<string>}>}
 */
export function executePostHooks(toolName, args, result) {
  const promises = [];
  for (const hook of HOOKS.postTool) {
    if (!hook.enabled) continue;
    const start = Date.now();
    try {
      if (hook.match(toolName, args, result)) {
        const ctx = { toolName, args, result };
        const p = executePostHookWithGate(hook, ctx, start);
        promises.push({ hook: hook.name, promise: p });
      }
    } catch (err) {
      _executionLog.push({ type: 'post', hook: hook.name, duration: Date.now() - start, status: 'match_error', error: err.message, tool: toolName });
      promises.push({ hook: hook.name, promise: Promise.resolve(`[Hook ${hook.name} match error: ${err.message}]`) });
    }
  }
  return promises;
}

/**
 * Execute a post-hook with concurrency gating and timeout.
 * Max MAX_POST_HOOK_CONCURRENCY simultaneous post-hooks.
 * Post-hooks exceeding the limit are queued and run when a slot frees.
 */
async function executePostHookWithGate(hook, ctx, start) {
  // Concurrency gate: wait if at capacity
  if (_activePostHooks >= MAX_POST_HOOK_CONCURRENCY) {
    await new Promise(resolve => { _postHookQueue.push(resolve); });
  }
  _activePostHooks++;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => hook.handler(ctx)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hook timeout')), POST_HOOK_TIMEOUT_MS)),
    ]);
    const duration = Date.now() - start;
    const output = typeof result === 'string' ? result : `[Hook ${hook.name}: ok]`;
    _executionLog.push({ type: 'post', hook: hook.name, duration, status: 'ok', tool: ctx.toolName });
    return output;
  } catch (err) {
    const duration = Date.now() - start;
    _executionLog.push({ type: 'post', hook: hook.name, duration, status: 'error', error: err.message, tool: ctx.toolName });
    return `[Hook ${hook.name} error: ${err.message}]`;
  } finally {
    _activePostHooks--;
    // Resolve next queued hook (if any)
    if (_postHookQueue.length > 0) {
      const next = _postHookQueue.shift();
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

/**
 * List all registered hooks.
 */
export function listHooks() {
  return {
    preTool: HOOKS.preTool.map(h => ({ id: h.id, name: h.name, description: h.description, enabled: h.enabled, type: h.type })),
    postTool: HOOKS.postTool.map(h => ({ id: h.id, name: h.name, description: h.description, enabled: h.enabled, type: h.type })),
  };
}

/**
 * Enable or disable a hook by id.
 */
export function setHookEnabled(id, enabled) {
  for (const list of [HOOKS.preTool, HOOKS.postTool]) {
    const hook = list.find(h => h.id === id);
    if (hook) {
      hook.enabled = enabled;
      return true;
    }
  }
  return false;
}

/**
 * Enable or disable a hook by name.
 */
export function setHookEnabledByName(name, enabled) {
  let found = false;
  for (const list of [HOOKS.preTool, HOOKS.postTool]) {
    const hook = list.find(h => h.name === name);
    if (hook) {
      hook.enabled = enabled;
      found = true;
    }
  }
  return found;
}

/**
 * Remove a hook by id.
 */
export function removeHook(id) {
  for (const list of [HOOKS.preTool, HOOKS.postTool]) {
    const idx = list.findIndex(h => h.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// User hook persistence (phase B)
// ---------------------------------------------------------------------------

const USER_HOOKS_PATH = join(homedir(), '.smart', 'hooks.json');

/**
 * Load user-defined hooks from ~/.smart/hooks.json.
 */
export function loadUserHooks() {
  try {
    if (!existsSync(USER_HOOKS_PATH)) return [];
    const data = readFileSync(USER_HOOKS_PATH, 'utf-8');
    const hooks = JSON.parse(data);
    if (!Array.isArray(hooks)) return [];
    for (const h of hooks) {
      if (h.event === 'preTool') {
        registerPreHook({
          name: h.name,
          description: h.description,
          match: buildUserMatch(h.match),
          handler: buildUserHandler(h.action),
          type: h.action.type,
          command: h.action.type === 'bash' ? h.action.command : null,
          enabled: h.enabled !== false,
        });
      } else if (h.event === 'postTool') {
        registerPostHook({
          name: h.name,
          description: h.description,
          match: buildUserMatch(h.match),
          handler: buildUserHandler(h.action),
          type: h.action.type,
          command: h.action.type === 'bash' ? h.action.command : null,
          enabled: h.enabled !== false,
        });
      }
    }
    return hooks;
  } catch { return []; }
}

/**
 * Persist a user hook to ~/.smart/hooks.json.
 */
export function saveUserHook(hookDef) {
  try {
    const dir = join(homedir(), '.smart');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let hooks = [];
    if (existsSync(USER_HOOKS_PATH)) {
      hooks = JSON.parse(readFileSync(USER_HOOKS_PATH, 'utf-8'));
      if (!Array.isArray(hooks)) hooks = [];
    }
    hooks.push({ ...hookDef, createdAt: new Date().toISOString() });
    writeFileSync(USER_HOOKS_PATH, JSON.stringify(hooks, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

/**
 * Remove a user hook from ~/.smart/hooks.json by name.
 */
export function removeUserHook(name) {
  try {
    if (!existsSync(USER_HOOKS_PATH)) return false;
    let hooks = JSON.parse(readFileSync(USER_HOOKS_PATH, 'utf-8'));
    if (!Array.isArray(hooks)) return false;
    const before = hooks.length;
    hooks = hooks.filter(h => h.name !== name);
    if (hooks.length === before) return false;
    writeFileSync(USER_HOOKS_PATH, JSON.stringify(hooks, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}


// ---------------------------------------------------------------------------
// Helpers for smart_hook tool
// ---------------------------------------------------------------------------

/**
 * Remove a hook by name (across both pre and post lists).
 * @param {string} name
 * @returns {boolean} whether a hook was removed
 */
export function removeHookByName(name) {
  let found = false;
  for (const list of [HOOKS.preTool, HOOKS.postTool]) {
    const idx = list.findIndex(h => h.name === name);
    if (idx >= 0) {
      list.splice(idx, 1);
      found = true;
    }
  }
  return found;
}

/**
 * Clear all user-registered hooks (not built-in ones) and reload from file.
 */
export function reloadUserHooks() {
  // Remove all user-type hooks first
  HOOKS.preTool = HOOKS.preTool.filter(h => h.type === null);
  HOOKS.postTool = HOOKS.postTool.filter(h => h.type === null);
  // Reload from file
  loadUserHooks();
}

/**
 * Load user hooks from file without registering (for tool preview).
 */
export function loadUserHooksFromFile() {
  try {
    if (!existsSync(USER_HOOKS_PATH)) return [];
    const data = readFileSync(USER_HOOKS_PATH, 'utf-8');
    const hooks = JSON.parse(data);
    return Array.isArray(hooks) ? hooks : [];
  } catch { return []; }
}

/**
 * Save full hooks array to file (replaces contents).
 */
export function saveUserHooksToFile(hooks) {
  try {
    const dir = join(homedir(), '.smart');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(USER_HOOKS_PATH, JSON.stringify(hooks, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Execution log (Sprint 1C)
// ---------------------------------------------------------------------------

/**
 * Get the hook execution log (most recent first).
 * @param {number} [limit=50] - max entries to return
 * @returns {Array}
 */
export function getHookLog(limit = 50) {
  return _executionLog.slice(-limit).reverse();
}

/**
 * Get hook execution statistics.
 * @returns {{ total: number, ok: number, error: number, blocked: number, deferred: number, activePostHooks: number, queuedPostHooks: number }}
 */
export function getHookStats() {
  const stats = { total: 0, ok: 0, error: 0, blocked: 0, deferred: 0 };
  for (const entry of _executionLog) {
    stats.total++;
    if (entry.status === 'ok') stats.ok++;
    else if (entry.status === 'error' || entry.status === 'match_error') stats.error++;
    else if (entry.status === 'blocked') stats.blocked++;
    else if (entry.status === 'deferred') stats.deferred++;
  }
  return {
    ...stats,
    activePostHooks: _activePostHooks,
    queuedPostHooks: _postHookQueue.length,
    preToolCount: HOOKS.preTool.length,
    postToolCount: HOOKS.postTool.length,
  };
}

/**
 * Reset the hook execution log.
 */
export function resetHookLog() {
  _executionLog = [];
}

// ---------------------------------------------------------------------------
// MCP tool invoker (injected by server at startup)
// ---------------------------------------------------------------------------
let _mcpToolInvoker = null;

/**
 * Set the MCP tool invoker function.
 * Called by server/index.mjs to inject toolMap-based tool calling.
 * @param {function} fn - async (toolName, args) => string
 */
export function setMcpToolInvoker(fn) {
  _mcpToolInvoker = fn;
}

function buildUserMatch(matchDef) {
  if (!matchDef) return () => false;
  if (matchDef.tool) {
    const tools = Array.isArray(matchDef.tool) ? matchDef.tool : [matchDef.tool];
    return (toolName) => tools.some(t => {
      if (t.endsWith('*')) return toolName.startsWith(t.slice(0, -1));
      return toolName === t || toolName === `smart_${t}`;
    });
  }
  if (matchDef.category) {
    return (toolName, args, result) => {
      // category matching requires classification — falls back to tool prefix
      if (matchDef.category === 'read') return toolName.startsWith('smart_read') || toolName.startsWith('smart_grep') || toolName.startsWith('smart_glob') || toolName === 'smart_lsp' || toolName === 'smart_context';
      if (matchDef.category === 'write') return toolName === 'smart_fast_apply';
      return true;
    };
  }
  return () => true;
}

function buildUserHandler(actionDef) {
  if (!actionDef) return () => null;
  if (actionDef.type === 'bash') {
    return async (ctx) => {
      const { spawnSync } = await import('node:child_process');
      let cmd = actionDef.command || '';
      // Template variables
      if (ctx.args && ctx.args.file) cmd = cmd.replace(/\{file\}/g, ctx.args.file);
      if (ctx.args && ctx.args.files) cmd = cmd.replace(/\{files\}/g, ctx.args.files.join(' '));
      if (ctx.toolName) cmd = cmd.replace(/\{tool\}/g, ctx.toolName);
      const result = spawnSync('sh', ['-c', cmd], { timeout: 10000, encoding: 'utf-8' });
      return result.stdout || result.stderr || '';
    };
  }
  if (actionDef.type === 'mcp_tool') {
    return async (ctx) => {
      const toolName = actionDef.tool || '';
      const callArgs = actionDef.args || ctx.args || {};
      if (!_mcpToolInvoker) return `[mcp_tool hook: no invoker registered for "${toolName}"]`;
      return await _mcpToolInvoker(toolName, callArgs);
    };
  }
  return () => null;
}
