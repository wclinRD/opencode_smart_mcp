// prefetch-engine.mjs — Speculative Tool Pre-fetch (Phase 18)
//
// When the LLM calls a tool, the server speculatively pre-executes the tool
// that is most likely to be called next. If the LLM does call that tool,
// the cached result is returned instantly (0ms round-trip).
//
// Architecture:
//   - Rule-based: zero LLM cost, pure pattern matching
//   - In-memory cache: Map<tool+argsHash, { result, expiresAt }>
//   - TTL: 5 seconds (pre-fetch results expire quickly)
//   - Fire-and-forget: pre-fetch never blocks the main response
//   - Recursion guard: pre-fetch results never trigger further pre-fetches
//
// Usage:
//   import { PrefetchEngine } from './prefetch-engine.mjs';
//   const engine = new PrefetchEngine({ toolMap });

import { getMemoryDB } from './memory-db.mjs';
//   engine.triggerAfter(toolName, args, result);  // after tool success
//   const hit = engine.checkCache(toolName, args); // before tool execution

// ---------------------------------------------------------------------------
// Pre-fetch Rules
// ---------------------------------------------------------------------------

// Phase 25: Minimum transitions count before switching to dynamic mode
const MIN_TRANSITIONS_FOR_DYNAMIC = 5;

/**
 * Each rule: { trigger, prefetch, ttl, contextExtractor }
 *
 * trigger: tool name that triggers the pre-fetch
 * prefetch: tool name to pre-fetch
 * ttl: cache TTL in ms (default: 5000)
 * contextExtractor: (triggerArgs, triggerResult) => prefetchArgs | null
 *   Returns null if pre-fetch is not applicable for this specific call.
 */
const PREFETCH_RULES = [
  {
    trigger: 'smart_grep',
    prefetch: 'smart_lsp',
    ttl: 5000,
    contextExtractor(args, result) {
      // Extract first symbol from grep result for LSP hover
      if (!result || !result.output) return null;
      const output = String(result.output);
      // Try to find a file:line pattern in the output
      const match = output.match(/(\S+\.(?:js|ts|py|rs|swift|php)):(\d+)/);
      if (!match) return null;
      const file = match[1];
      const line = parseInt(match[2], 10);
      // Find the root from grep args
      const root = args.root || '.';
      return {
        operation: 'hover',
        file,
        line,
        character: 0,
        root,
      };
    },
  },
  {
    trigger: 'smart_think',
    prefetch: 'smart_memory_store',
    ttl: 5000,
    contextExtractor(args) {
      // Search memory for the think topic
      const topic = args.thought || args.topic || '';
      if (!topic || topic.length < 10) return null;
      return {
        command: 'search',
        query: topic.slice(0, 200),
      };
    },
  },
  {
    trigger: 'smart_security',
    prefetch: 'smart_grep',
    ttl: 5000,
    contextExtractor(args, result) {
      // Grep for TODO/FIXME in files flagged by security scan
      if (!result || !result.output) return null;
      const output = String(result.output);
      // Extract file paths from security output
      const files = output.match(/File:\s*(\S+)/g);
      if (!files || files.length === 0) return null;
      const root = args.root || '.';
      return {
        pattern: 'TODO|FIXME|HACK|XXX',
        root,
      };
    },
  },
  {
    trigger: 'smart_learn',
    prefetch: 'smart_import_graph',
    ttl: 5000,
    contextExtractor(args) {
      const root = args.root || '.';
      return { root };
    },
  },
  {
    trigger: 'smart_error_diagnose',
    prefetch: 'smart_lsp',
    ttl: 5000,
    contextExtractor(args, result) {
      // Run LSP diagnostics on the file mentioned in the error
      if (!result || !result.output) return null;
      const output = String(result.output);
      const match = output.match(/(\S+\.(?:js|ts|py|rs|swift|php))/);
      if (!match) return null;
      return {
        operation: 'diagnostics',
        file: match[1],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// PrefetchEngine class
// ---------------------------------------------------------------------------

export class PrefetchEngine {
  /**
   * @param {object} opts
   * @param {Map} opts.toolMap - Map of toolName → toolDef (for invoking pre-fetch tools)
   * @param {number} [opts.defaultTtl=5000] - default cache TTL in ms
   */
  constructor(opts = {}) {
    this._toolMap = opts.toolMap || new Map();
    this._defaultTtl = opts.defaultTtl || 5000;
    this._cache = new Map(); // key → { result, expiresAt }
    this._pending = new Set(); // keys currently being pre-fetched (dedup)
    this._useDynamic = false;
    this._lastTransitionCheck = 0;
    this._stats = {
      triggered: 0,
      hits: 0,
      misses: 0,
      expired: 0,
      skipped: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Cache key generation
  // -----------------------------------------------------------------------

  /**
   * Generate a cache key from tool name + args.
   * Uses sorted JSON of args for deterministic keys.
   */
  _cacheKey(toolName, args) {
    const sorted = args ? JSON.stringify(args, Object.keys(args || {}).sort()) : '{}';
    return `${toolName}:${sorted}`;
  }

  // -----------------------------------------------------------------------
  // Cache operations
  // -----------------------------------------------------------------------

  /**
   * Check if a pre-fetched result exists in cache for the given tool+args.
   * @param {string} toolName
   * @param {object} args
   * @returns {{ hit: boolean, result?: object }} cached result or null
   */
  checkCache(toolName, args) {
    const key = this._cacheKey(toolName, args);
    const entry = this._cache.get(key);

    if (!entry) {
      this._stats.misses++;
      return { hit: false };
    }

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      this._stats.expired++;
      return { hit: false };
    }

    // Cache hit!
    this._cache.delete(key); // consume the entry
    this._stats.hits++;
    return { hit: true, result: entry.result };
  }

  /**
   * Store a pre-fetched result in cache.
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   * @param {number} [ttl] - TTL in ms
   */
  _storeCache(toolName, args, result, ttl) {
    const key = this._cacheKey(toolName, args);
    this._cache.set(key, {
      result,
      expiresAt: Date.now() + (ttl || this._defaultTtl),
    });
    // Cleanup: remove expired entries periodically
    if (this._cache.size > 50) {
      this._cleanup();
    }
  }

  /**
   * Remove expired entries from cache.
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._cache) {
      if (now > entry.expiresAt) {
        this._cache.delete(key);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Pre-fetch trigger
  // -----------------------------------------------------------------------

  /**
   * Trigger pre-fetch after a tool succeeds.
   * Fire-and-forget: does NOT block the response.
   *
   * @param {string} toolName - the tool that just completed
   * @param {object} args - args used for the completed tool
   * @param {object} result - result from the completed tool
   * @param {function} [invokeFn] - function to invoke the pre-fetch tool (toolName, args) => result
   */
  triggerAfter(toolName, args, result, invokeFn) {
    // Find matching rules
    const rules = PREFETCH_RULES.filter(r => r.trigger === toolName);
    if (rules.length === 0) return;

    for (const rule of rules) {
      try {
        // Extract context for pre-fetch
        const prefetchArgs = rule.contextExtractor(args, result);
        if (!prefetchArgs) {
          this._stats.skipped++;
          continue;
        }

        // Dedup: skip if already pending for same key
        const key = this._cacheKey(rule.prefetch, prefetchArgs);
        if (this._pending.has(key)) continue;

        this._stats.triggered++;
        this._pending.add(key);

        // Fire-and-forget: execute pre-fetch asynchronously
        this._executePrefetch(rule.prefetch, prefetchArgs, rule.ttl, key, invokeFn);
      } catch {
        // Best-effort: never throw from pre-fetch trigger
      }
    }
  }

  /**
   * Execute a pre-fetch asynchronously (fire-and-forget).
   */
  async _executePrefetch(toolName, args, ttl, key, invokeFn) {
    try {
      if (!invokeFn) {
        this._pending.delete(key);
        return;
      }

      const result = await invokeFn(toolName, args);
      if (result && result.ok !== false) {
        this._storeCache(toolName, args, result, ttl);
      }
    } catch {
      // Best-effort
    } finally {
      this._pending.delete(key);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 25: Dynamic (learned) prefetch from transitions
  // -----------------------------------------------------------------------

  /**
   * Check if dynamic (learned) transitions should be used.
   * Switches to dynamic mode when enough transitions have been recorded.
   */
  _checkDynamicMode() {
    if (this._useDynamic) return true;
    // Only check every 30s to avoid DB hammering
    if (Date.now() - this._lastTransitionCheck < 30000) return false;
    this._lastTransitionCheck = Date.now();
    try {
      const db = getMemoryDB();
      const stats = db.getTransitionStats();
      if (stats.total >= MIN_TRANSITIONS_FOR_DYNAMIC) {
        this._useDynamic = true;
        return true;
      }
    } catch {
      // Memory DB not available — stay in static mode
    }
    return false;
  }

  /**
   * Get prefetch candidates from learned transitions.
   * Falls back to static rules if not enough data yet.
   * @param {string} toolName
   * @returns {Array<{tool: string, args: object}>}
   */
  prefetchFromTransitions(toolName) {
    if (!this._checkDynamicMode()) return [];

    try {
      const db = getMemoryDB();
      const transitions = db.getTopTransitions(toolName, 3);
      if (transitions.length === 0) return [];

      return transitions.map(t => ({
        tool: t.toTool,
        score: t.score,
        args: this._guessArgsForTool(t.toTool, toolName),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Guess reasonable args for a prefetched tool (best-effort).
   * @private
   */
  _guessArgsForTool(toTool, fromTool) {
    // Provide minimal args — the cache key will be generic but acceptable
    if (toTool === 'smart_lsp') return { operation: 'hover', file: '', line: 0, character: 0 };
    if (toTool === 'smart_memory_store') return { command: 'search', query: '' };
    if (toTool === 'smart_grep') return { pattern: '' };
    if (toTool === 'smart_read') return { file: '' };
    return {};
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Get pre-fetch statistics.
   */
  getStats() {
    const total = this._stats.hits + this._stats.misses;
    return {
      ...this._stats,
      cacheSize: this._cache.size,
      pendingCount: this._pending.size,
      hitRate: total > 0 ? (this._stats.hits / total * 100).toFixed(1) + '%' : '0%',
    };
  }

  /**
   * Reset statistics.
   */
  resetStats() {
    this._stats = { triggered: 0, hits: 0, misses: 0, expired: 0, skipped: 0 };
  }

  /**
   * Clear cache.
   */
  clearCache() {
    this._cache.clear();
    this._pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

export function getPrefetchEngine(opts) {
  if (!_instance) {
    _instance = new PrefetchEngine(opts);
  }
  return _instance;
}

export function resetPrefetchEngine() {
  if (_instance) {
    _instance.clearCache();
    _instance.resetStats();
  }
}