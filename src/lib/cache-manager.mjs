// cache-manager.mjs — Unified TTL cache with optional SQLite persistence
//
// Phase 1: in-memory Map + TTL expiry + JSON snapshot persistence.
// Phase 2: SQLite backend (Node 26+ node:sqlite) with LRU eviction + TTL.
//   Unified with exa_crawl's src/cli/lib/cache.mjs into a single cache store.
//
// Usage:
//   import { CacheManager, getDefaultCache } from './cache-manager.mjs';
//
//   const cache = new CacheManager({ backend: 'sqlite' });
//   cache.set('key', 'value', 300_000); // 5 min TTL
//   const val = cache.get('key');

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { env } from 'node:process';

const DEFAULT_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const DEFAULT_CLEANUP_INTERVAL = 60_000;  // 1 minute
const SQLITE_MAX_ENTRIES = 2000;

// ---------------------------------------------------------------------------
// SQLite backend (Node 26+ built-in)
// ---------------------------------------------------------------------------

let _sqliteDb = null;
let _DatabaseSync = null;

// Lazy-load node:sqlite (built-in module, synchronous load via createRequire)
function ensureSQLite() {
  if (_DatabaseSync) return true;
  try {
    const req = createRequire(import.meta.url);
    _DatabaseSync = req('node:sqlite').DatabaseSync;
    return true;
  } catch {
    return false; // node:sqlite not available
  }
}

function getSQLiteDb(dbPath) {
  if (_sqliteDb) return _sqliteDb;
  if (!ensureSQLite()) return null;
  try {
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    _sqliteDb = new _DatabaseSync(dbPath);
    _sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '',
        ttl_ms     INTEGER NOT NULL DEFAULT 300000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    _sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_cache_updated ON cache(updated_at)`);
    return _sqliteDb;
  } catch {
    return null; // node:sqlite not available
  }
}

// ---------------------------------------------------------------------------
// CacheManager class
// ---------------------------------------------------------------------------

export class CacheManager {
  #store = null;        // Map for 'memory' backend
  #db = null;           // DatabaseSync for 'sqlite' backend
  #backend;
  #ttlMs;
  #persistPath = null;
  #cleanupTimer = null;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #dbPath = null;

  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs] - TTL in ms (default 5 min)
   * @param {string} [opts.backend] - 'memory' (default) or 'sqlite'
   * @param {string} [opts.persistPath] - JSON file path (memory backend only)
   * @param {string} [opts.dbPath] - SQLite db path (sqlite backend only)
   * @param {number} [opts.cleanupInterval] - cleanup interval in ms (default 60s)
   */
  constructor(opts = {}) {
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.#backend = opts.backend || 'memory';

    if (this.#backend === 'sqlite') {
      this.#dbPath = opts.dbPath || resolve(env.HOME || '/tmp', '.smart', 'cache', 'unified.db');
      this.#db = getSQLiteDb(this.#dbPath);
      if (!this.#db) {
        // Fallback to memory if SQLite unavailable
        this.#backend = 'memory';
      }
    }

    if (this.#backend === 'memory') {
      this.#store = new Map();
      this.#persistPath = opts.persistPath || null;
      if (this.#persistPath) this.#loadFromDisk();
    }

    // Periodic cleanup (only for memory backend; SQLite cleans on get)
    if (this.#backend === 'memory') {
      const interval = opts.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
      this.#cleanupTimer = setInterval(() => this.#evictExpired(), interval);
      this.#cleanupTimer.unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Get value by key. Returns undefined on miss or expiry. */
  get(key) {
    if (this.#backend === 'sqlite') return this.#sqliteGet(key);
    return this.#memoryGet(key);
  }

  /** Set value with optional per-key TTL override (ms). Returns this for chaining. */
  set(key, value, ttlMs) {
    if (this.#backend === 'sqlite') {
      this.#sqliteSet(key, value, ttlMs);
    } else {
      this.#memorySet(key, value, ttlMs);
    }
    return this;
  }

  /** Check if key exists and is not expired. */
  has(key) {
    if (this.#backend === 'sqlite') {
      const val = this.#sqliteGet(key);
      return val !== undefined;
    }
    return this.#memoryHas(key);
  }

  /** Delete a key. Returns true if existed. */
  delete(key) {
    if (this.#backend === 'sqlite') {
      return this.#sqliteDelete(key);
    }
    return this.#store.delete(key);
  }

  /** Clear all entries. */
  clear() {
    if (this.#backend === 'sqlite') {
      try { this.#db?.exec('DELETE FROM cache'); } catch { /* ok */ }
    } else {
      this.#store.clear();
    }
    this.#hits = 0;
    this.#misses = 0;
    this.#evictions = 0;
  }

  /** Current number of entries. */
  get size() {
    if (this.#backend === 'sqlite') {
      try {
        const row = this.#db?.prepare('SELECT COUNT(*) as c FROM cache').get();
        return row?.c || 0;
      } catch { return 0; }
    }
    return this.#store.size;
  }

  /** Stats snapshot. */
  stats() {
    const base = {
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      hitRate: (this.#hits + this.#misses) > 0
        ? ((this.#hits / (this.#hits + this.#misses)) * 100).toFixed(1) + '%'
        : '0%',
      ttlMs: this.#ttlMs,
      backend: this.#backend,
    };

    if (this.#backend === 'sqlite') {
      try {
        const row = this.#db?.prepare(`
          SELECT COUNT(*) as size,
                 COALESCE(MIN(created_at), '') as oldest,
                 COALESCE(MAX(created_at), '') as newest
          FROM cache
        `).get();
        return { ...base, size: row?.size || 0, oldest: row?.oldest || null, newest: row?.newest || null, dbPath: this.#dbPath };
      } catch {
        return { ...base, size: 0 };
      }
    }

    return { ...base, size: this.#store.size, persistPath: this.#persistPath || null };
  }

  /** Get or compute + cache. */
  async getOrSet(key, factory, ttlMs) {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Persist memory cache to disk (memory backend only). */
  persist() {
    if (this.#backend !== 'memory' || !this.#persistPath) return;
    try {
      const dir = dirname(this.#persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const snapshot = {};
      for (const [key, entry] of this.#store) {
        snapshot[key] = { v: entry.value, c: entry.createdAt, e: entry.expiresAt, l: entry.lastAccess };
      }
      writeFileSync(this.#persistPath, JSON.stringify(snapshot), 'utf-8');
    } catch { /* best-effort */ }
  }

  /** Shutdown: cleanup. */
  shutdown() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
    if (this.#backend === 'memory' && this.#persistPath) {
      this.persist();
    }
  }

  /** Compute a deterministic cache key from args. */
  makeKey(...args) {
    return createHash('sha256')
      .update(JSON.stringify(args.map(a => typeof a === 'object' ? Object.keys(a).sort().reduce((o, k) => { o[k] = a[k]; return o; }, {}) : a)))
      .digest('hex')
      .substring(0, 16);
  }

  // ---------------------------------------------------------------------------
  // Memory backend internals
  // ---------------------------------------------------------------------------

  #memoryGet(key) {
    const entry = this.#store.get(key);
    if (!entry) { this.#misses++; return undefined; }
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

  #memorySet(key, value, ttlMs) {
    const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : this.#ttlMs;
    this.#store.set(key, { value, createdAt: Date.now(), expiresAt: Date.now() + ttl, lastAccess: Date.now() });
  }

  #memoryHas(key) {
    const entry = this.#store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { this.#store.delete(key); this.#evictions++; return false; }
    return true;
  }

  #evictExpired() {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.#store) {
      if (now > entry.expiresAt) { this.#store.delete(key); count++; }
    }
    if (count > 0) this.#evictions += count;
  }

  #loadFromDisk() {
    if (!this.#persistPath || !existsSync(this.#persistPath)) return;
    try {
      const raw = readFileSync(this.#persistPath, 'utf-8');
      const snapshot = JSON.parse(raw);
      const now = Date.now();
      for (const [key, data] of Object.entries(snapshot)) {
        if (now < data.e) {
          this.#store.set(key, { value: data.v, createdAt: data.c, expiresAt: data.e, lastAccess: data.l });
        }
      }
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // SQLite backend internals
  // ---------------------------------------------------------------------------

  #sqliteGet(key) {
    try {
      const row = this.#db?.prepare('SELECT value, ttl_ms, created_at FROM cache WHERE key = ?').get(key);
      if (!row) { this.#misses++; return undefined; }

      // Check TTL
      const createdAt = new Date(row.created_at + 'Z').getTime();
      if (Date.now() - createdAt > row.ttl_ms) {
        this.#sqliteDelete(key);
        this.#misses++;
        this.#evictions++;
        return undefined;
      }

      // Touch
      this.#db?.prepare("UPDATE cache SET updated_at = datetime('now') WHERE key = ?").run(key);
      this.#hits++;
      return row.value;
    } catch { this.#misses++; return undefined; }
  }

  #sqliteSet(key, value, ttlMs) {
    try {
      const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : this.#ttlMs;

      // LRU eviction if at capacity
      const count = this.#db?.prepare('SELECT COUNT(*) as c FROM cache').get();
      if (count?.c >= SQLITE_MAX_ENTRIES) {
        this.#db?.prepare(`
          DELETE FROM cache WHERE key IN (
            SELECT key FROM cache ORDER BY updated_at ASC LIMIT ?
          )
        `).run(Math.max(1, Math.floor(SQLITE_MAX_ENTRIES * 0.2)));
        this.#evictions += Math.max(1, Math.floor(SQLITE_MAX_ENTRIES * 0.2));
      }

      this.#db?.prepare(`
        INSERT INTO cache (key, value, ttl_ms, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          ttl_ms = excluded.ttl_ms,
          updated_at = datetime('now')
      `).run(key, value, ttl);
    } catch { /* best-effort */ }
  }

  #sqliteDelete(key) {
    try { this.#db?.prepare('DELETE FROM cache WHERE key = ?').run(key); return true; }
    catch { return false; }
  }
}

// ---------------------------------------------------------------------------
// Default singleton (unified with exa_crawl's cache location)
// ---------------------------------------------------------------------------

let _defaultInstance = null;

/**
 * Get or create the default cache instance.
 * Phase 2: uses SQLite backend by default (fallback to memory).
 * Stores at ~/.smart/cache/unified.db — same dir as exa_crawl's cache.db.
 *
 * @param {object} [opts]
 * @param {string} [opts.backend] - 'sqlite' (default) or 'memory'
 * @param {number} [opts.ttlMs]
 */
export function getDefaultCache(opts = {}) {
  if (!_defaultInstance) {
    const cacheDir = resolve(env.HOME || '/tmp', '.smart', 'cache');
    const backend = opts.backend || 'sqlite';
    _defaultInstance = new CacheManager({
      backend,
      ttlMs: opts.ttlMs || DEFAULT_TTL_MS,
      dbPath: resolve(cacheDir, 'unified.db'),
      persistPath: resolve(cacheDir, 'cache.json'), // fallback for memory mode
    });
  }
  return _defaultInstance;
}
