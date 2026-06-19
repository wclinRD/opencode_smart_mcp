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

let _hookIdCounter = 0;

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
    try {
      if (hook.match(toolName, args)) {
        const ctx = { toolName, args };
        const result = hook.handler(ctx);
        if (result && result.block) {
          results.push({ hook: hook.name, block: true, message: result.message || 'Blocked by hook' });
        } else {
          results.push({ hook: hook.name, block: false });
        }
      }
    } catch (err) {
      // Hook should never crash the tool — log and continue
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
    try {
      if (hook.match(toolName, args, result)) {
        const ctx = { toolName, args, result };
        const p = Promise.resolve()
          .then(() => hook.handler(ctx))
          .catch(err => `[Hook ${hook.name} error: ${err.message}]`);
        promises.push({ hook: hook.name, promise: p });
      }
    } catch (err) {
      // Match error — shouldn't crash
      promises.push({ hook: hook.name, promise: Promise.resolve(`[Hook ${hook.name} match error: ${err.message}]`) });
    }
  }
  return promises;
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
      // Call an MCP tool via the toolMap (injected at runtime)
      // This is resolved by the server when importing
      return `[mcp_tool hook: ${actionDef.tool || 'unknown'}]`;
    };
  }
  return () => null;
}
