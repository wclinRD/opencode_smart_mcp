#!/usr/bin/env node

// cache.mjs — SQLite-based caching for search/crawl results
//
// Uses Node.js built-in node:sqlite (DatabaseSync) — zero dependencies.
// Requires Node >= 26 (node:sqlite added in Node 26).
//
// Store: ~/.smart/cache/cache.db
// Schema:
//   cache(key TEXT PRIMARY KEY, value TEXT, ttl INTEGER, created_at TEXT)
//
// Key = SHA256(JSON.stringify({ url|query, command, opts }))
// TTL defaults to 300s (5 min), configurable per entry

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CACHE_DIR = resolve(homedir(), '.smart', 'cache');
const DB_PATH   = resolve(CACHE_DIR, 'cache.db');
const MAX_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// DB Initialization
// ---------------------------------------------------------------------------

let _db = null;

function getDb() {
  if (_db) return _db;

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      ttl        INTEGER NOT NULL DEFAULT 300,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Index for cleanup queries
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cache_created
    ON cache(created_at)
  `);

  return _db;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic cache key from command arguments.
 * @param {string} command - 'search' | 'crawl' | 'code'
 * @param {string|string[]} input - query string or URL(s)
 * @param {object} [opts] - options affecting the result (maxChars, render, etc.)
 * @returns {string} hex digest
 */
function makeKey(command, input, opts = {}) {
  const normalized = {
    command,
    input: Array.isArray(input) ? [...input].sort() : input,
    maxChars: opts.maxChars || null,
    render: !!opts.render,
    extended: !!opts.extended,
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Get a cached value.
 * Returns null if: miss, expired, or error.
 * @param {string} key
 * @returns {string|null}
 */
function get(key) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value, ttl, created_at FROM cache WHERE key = ?').get(key);
    if (!row) return null;

    // Check TTL
    const createdAt = new Date(row.created_at + 'Z').getTime(); // SQLite datetime → UTC
    const now = Date.now();
    if (now - createdAt > row.ttl * 1000) {
      // Expired — remove and return null
      del(key);
      return null;
    }

    // Update hit count (touch the row)
    db.prepare('UPDATE cache SET created_at = datetime(\'now\') WHERE key = ?').run(key);
    return row.value;
  } catch {
    // Fail open: cache error should not break the caller
    return null;
  }
}

/**
 * Set a cached value.
 * @param {string} key
 * @param {string} value
 * @param {number} [ttl=300] - seconds
 */
function set(key, value, ttl = 300) {
  try {
    const db = getDb();

    // LRU eviction if at capacity
    const count = db.prepare('SELECT COUNT(*) as c FROM cache').get();
    if (count.c >= MAX_ENTRIES) {
      db.prepare(`
        DELETE FROM cache WHERE key IN (
          SELECT key FROM cache ORDER BY created_at ASC LIMIT MAX(1, ? - ${MAX_ENTRIES})
        )
      `).run(MAX_ENTRIES);
    }

    db.prepare(`
      INSERT INTO cache (key, value, ttl, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        ttl = excluded.ttl,
        created_at = datetime('now')
    `).run(key, value, ttl);
  } catch {
    // Fail open
  }
}

/**
 * Delete a specific key.
 * @param {string} key
 */
function del(key) {
  try {
    getDb().prepare('DELETE FROM cache WHERE key = ?').run(key);
  } catch {
    // Fail open
  }
}

/**
 * Clear all cached entries.
 */
function clear() {
  try {
    getDb().exec('DELETE FROM cache');
  } catch {
    // Fail open
  }
}

/**
 * Remove all expired entries.
 * @returns {number} number of removed entries
 */
function cleanExpired() {
  try {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM cache WHERE (unixepoch() - unixepoch(created_at)) > ttl
    `).run();
    return result.changes;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get cache statistics.
 * @returns {{ hits: number, misses: number, size: number, oldest: string|null }}
 *
 * Note: hits are approximate (tracked via get() returning non-null).
 * A precise hit counter would require an extra column; this is good enough.
 */
function stats() {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*)                                         AS size,
        COALESCE(MIN(created_at), '')                    AS oldest,
        COALESCE(MAX(created_at), '')                    AS newest
      FROM cache
    `).get();
    return {
      size: row.size,
      oldest: row.oldest || null,
      newest: row.newest || null,
    };
  } catch {
    return { size: 0, oldest: null, newest: null };
  }
}

// ---------------------------------------------------------------------------
// CLI entry (direct invocation for debugging)
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'stats':
      console.log(JSON.stringify(stats(), null, 2));
      break;
    case 'clear':
      clear();
      console.log('Cache cleared.');
      break;
    case 'clean':
      console.log(`Removed ${cleanExpired()} expired entries.`);
      break;
    case 'get': {
      const key = args[1];
      if (!key) { console.error('Usage: node cache.mjs get <key>'); process.exit(1); }
      console.log(get(key) || '(not found)');
      break;
    }
    case 'key': {
      const command = args[1];
      const input = args.slice(2);
      if (!command || !input.length) {
        console.error('Usage: node cache.mjs key <command> <input...>');
        process.exit(1);
      }
      console.log(makeKey(command, input.length === 1 ? input[0] : input));
      break;
    }
    default:
      console.log(`
Usage: node cache.mjs <command> [args]

Commands:
  stats                 Show cache statistics
  clear                 Clear all cached entries
  clean                 Remove expired entries
  get <key>             Get a value by key
  key <cmd> <input...>  Compute a cache key for a command+input
      `);
  }
}

export { get, set, del, clear, stats, makeKey, cleanExpired };

// Run as CLI
if (process.argv[1]?.endsWith('cache.mjs')) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
