// cache-manager.mjs — Lightweight TTL cache with optional JSON persistence
//
// Phase 1: in-memory Map + TTL expiry. JSON snapshot for restart persistence.
// Phase 2: upgrade to better-sqlite3 for LRU eviction + size limits.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { env } from 'node:process';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CLEANUP_INTERVAL = 60_000; // 1 minute

export class CacheManager {
  #store = new Map();
  #ttlMs;
  #persistPath = null;
  #cleanupTimer = null;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs] - TTL in ms (default 5 min)
   * @param {string} [opts.persistPath] - optional JSON file path for persistence
   * @param {number} [opts.cleanupInterval] - cleanup interval in ms (default 60s)
   */
  constructor(opts = {}) {
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.#persistPath = opts.persistPath || null;

    // Load persisted cache on startup
    if (this.#persistPath) {
      this.#loadFromDisk();
    }

    // Periodic cleanup
    const interval = opts.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    this.#cleanupTimer = setInterval(() => this.#evictExpired(), interval);
    this.#cleanupTimer.unref();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Get value by key. Returns undefined on miss or expiry. */
  get(key) {
    const entry = this.#store.get(key);
    if (!entry) {
      this.#misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      this.#misses++;
      this.#evictions++;
      return undefined;
    }
    this.#hits++;
    entry.lastAccess = Date.now();
    return entry.value;
  }

  /** Set value with optional per-key TTL override (ms). Returns this for chaining. */
  set(key, value, ttlMs) {
    const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : this.#ttlMs;
    this.#store.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      lastAccess: Date.now(),
    });
    return this;
  }

  /** Check if key exists and is not expired. */
  has(key) {
    const entry = this.#store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      this.#evictions++;
      return false;
    }
    return true;
  }

  /** Delete a key. Returns true if existed. */
  delete(key) {
    return this.#store.delete(key);
  }

  /** Clear all entries. */
  clear() {
    this.#store.clear();
    this.#hits = 0;
    this.#misses = 0;
    this.#evictions = 0;
  }

  /** Current number of entries (including expired, cleaned up lazily). */
  get size() {
    return this.#store.size;
  }

  /** Stats snapshot. */
  stats() {
    return {
      size: this.#store.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      hitRate: (this.#hits + this.#misses) > 0
        ? ((this.#hits / (this.#hits + this.#misses)) * 100).toFixed(1) + '%'
        : '0%',
      ttlMs: this.#ttlMs,
      persistPath: this.#persistPath || null,
    };
  }

  /** Get a value and if missing, compute + cache it. */
  async getOrSet(key, factory, ttlMs) {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Persist current cache to disk as JSON (if persistPath configured). */
  persist() {
    if (!this.#persistPath) return;
    try {
      const dir = dirname(this.#persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const snapshot = {};
      for (const [key, entry] of this.#store) {
        snapshot[key] = {
          v: entry.value,
          c: entry.createdAt,
          e: entry.expiresAt,
          l: entry.lastAccess,
        };
      }
      writeFileSync(this.#persistPath, JSON.stringify(snapshot), 'utf-8');
    } catch {
      // best-effort
    }
  }

  /** Shutdown: clear timer and optionally persist. */
  shutdown() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
    if (this.#persistPath) {
      this.persist();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Evict expired entries. */
  #evictExpired() {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.#store) {
      if (now > entry.expiresAt) {
        this.#store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.#evictions += count;
    }
  }

  /** Load persisted snapshot from disk. */
  #loadFromDisk() {
    if (!this.#persistPath || !existsSync(this.#persistPath)) return;
    try {
      const raw = readFileSync(this.#persistPath, 'utf-8');
      const snapshot = JSON.parse(raw);
      const now = Date.now();
      let loaded = 0;
      for (const [key, data] of Object.entries(snapshot)) {
        if (now < data.e) {
          this.#store.set(key, {
            value: data.v,
            createdAt: data.c,
            expiresAt: data.e,
            lastAccess: data.l,
          });
          loaded++;
        }
      }
    } catch {
      // best-effort
    }
  }
}

/** Default singleton instance. */
let _defaultInstance = null;

export function getDefaultCache(opts = {}) {
  if (!_defaultInstance) {
    const persistPath = opts.persistPath || env.SMART_CACHE_PATH
      || resolve(env.HOME || '/tmp', '.smart', 'cache.json');
    _defaultInstance = new CacheManager({
      ttlMs: opts.ttlMs || DEFAULT_TTL_MS,
      persistPath,
    });
  }
  return _defaultInstance;
}
