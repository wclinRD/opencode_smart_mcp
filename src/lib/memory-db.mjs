// memory-db.mjs — SQLite storage layer for memory_store
//
// Triple-index: entries (row data) + entries_fts (FTS5 BM25) + entries_vec (sqlite-vec ANN)
// Search: BM25 + Vector → RRF(k=60) fusion
// Degradation: sqlite-vec unavailable → app-level cosine; FTS5 unavailable → LIKE
//
// Phase 16: Knowledge Graph — kg_entities + kg_relations tables for structured memory

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    hash TEXT UNIQUE,
    type TEXT NOT NULL DEFAULT 'error',
    category TEXT,
    status TEXT DEFAULT 'active',
    error_message TEXT,
    resolution TEXT,
    behavior_change TEXT,
    target_skill TEXT,
    tools_used TEXT,
    files_changed TEXT,
    success INTEGER DEFAULT 1,
    hit_count INTEGER DEFAULT 1,
    keep TEXT,
    expires_at TEXT,
    confirmed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    embedding BLOB
  );

  CREATE INDEX IF NOT EXISTS idx_entries_hash ON entries(hash);
  CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_last_seen ON entries(last_seen);

  -- FTS5 external content: data lives in entries, FTS5 indexes it
  -- Synced manually in application code (not triggers — FTS5 delete has
  -- compatibility issues with certain SQLite builds)
  CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    error_message, resolution, behavior_change,
    content='entries', content_rowid='rowid',
    tokenize='porter unicode61'
  );
`;

// ---------------------------------------------------------------------------
// vec0 table (created separately because sqlite-vec may not be available)
// ---------------------------------------------------------------------------

const VEC0_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS entries_vec USING vec0(
    embedding float[384] distance_metric=cosine
  )
`;

// ---------------------------------------------------------------------------
// Phase 16: Knowledge Graph schema
// ---------------------------------------------------------------------------

const KG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS kg_entities (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'unknown',
    observations TEXT NOT NULL DEFAULT '[]',
    embedding BLOB,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type);

  CREATE TABLE IF NOT EXISTS kg_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_entity, to_entity, relation_type),
    FOREIGN KEY(from_entity) REFERENCES kg_entities(name) ON DELETE CASCADE,
    FOREIGN KEY(to_entity) REFERENCES kg_entities(name) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_kg_relations_from ON kg_relations(from_entity);
  CREATE INDEX IF NOT EXISTS idx_kg_relations_to ON kg_relations(to_entity);
`;

// ---------------------------------------------------------------------------
// MemoryDB class
// ---------------------------------------------------------------------------

export class MemoryDB {
  #db = null;
  #vecAvailable = false;
  #path = null;

  /**
   * @param {string} dbPath - Path to SQLite database file
   */
  constructor(dbPath) {
    this.#path = resolve(dbPath);
    const dir = dirname(this.#path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Open database and initialize schema.
   * Safe to call multiple times — reuses existing connection.
   */
  open() {
    if (this.#db) return this;

    this.#db = new Database(this.#path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');

    // Initialize schema
    this.#db.exec(SCHEMA_SQL);

    // Phase 16: Knowledge Graph schema
    this.#db.exec(KG_SCHEMA_SQL);

    // Rebuild FTS5 index on startup (handles any out-of-sync state)
    this.rebuildFTS();

    // Try loading sqlite-vec
    try {
      sqliteVec.load(this.#db);
      this.#db.exec(VEC0_SQL);
      this.#vecAvailable = true;
    } catch {
      // sqlite-vec not available — use app-level cosine fallback
      this.#vecAvailable = false;
    }

    return this;
  }

  /**
   * Close database connection.
   */
  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }

  /**
   * Check if connection is open.
   */
  get isOpen() {
    return this.#db !== null;
  }

  /**
   * Check if sqlite-vec is available for ANN vector search.
   */
  get vecAvailable() {
    return this.#vecAvailable;
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /**
   * Insert a new entry.
   * Returns the inserted entry.
   */
  insertEntry(entry) {
    this.#ensureOpen();
    const stmt = this.#db.prepare(`
      INSERT OR REPLACE INTO entries
        (id, hash, type, category, status, error_message, resolution,
         behavior_change, target_skill, tools_used, files_changed,
         success, hit_count, keep, expires_at, confirmed_at,
         created_at, last_seen, embedding)
      VALUES
        (@id, @hash, @type, @category, @status, @error_message, @resolution,
         @behavior_change, @target_skill, @tools_used, @files_changed,
         @success, @hit_count, @keep, @expires_at, @confirmed_at,
         COALESCE(@created_at, datetime('now')),
         COALESCE(@last_seen, datetime('now')),
         @embedding)
    `);

    const params = {
      id: entry.id || crypto.randomUUID(),
      hash: entry.hash || null,
      type: entry.type || 'error',
      category: entry.category || null,
      status: entry.status || 'active',
      error_message: entry.error_message || null,
      resolution: entry.resolution || null,
      behavior_change: entry.behavior_change || null,
      target_skill: entry.target_skill || null,
      tools_used: entry.tools_used || null,
      files_changed: entry.files_changed || null,
      success: entry.success !== undefined ? (entry.success ? 1 : 0) : 1,
      hit_count: entry.hit_count || 1,
      keep: entry.keep || null,
      expires_at: entry.expires_at || null,
      confirmed_at: entry.confirmed_at || null,
      created_at: entry.created_at || null,
      last_seen: entry.last_seen || null,
      embedding: entry.embedding || null,
    };

    const result = stmt.run(params);
    // Sync FTS5 index
    this.#syncFTS5(result.lastInsertRowid, params.error_message, params.resolution, params.behavior_change);
    return this.getEntry(params.id);
  }

  /**
   * Get entry by id.
   */
  getEntry(id) {
    this.#ensureOpen();
    const row = this.#db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    return row ? this.#rowToEntry(row) : null;
  }

  /**
   * Get entry by hash.
   */
  getEntryByHash(hash) {
    this.#ensureOpen();
    const row = this.#db.prepare('SELECT * FROM entries WHERE hash = ?').get(hash);
    return row ? this.#rowToEntry(row) : null;
  }

  /**
   * Update an entry.
   */
  updateEntry(id, updates) {
    this.#ensureOpen();
    const allowed = new Set([
      'type', 'category', 'status', 'error_message', 'resolution',
      'behavior_change', 'target_skill', 'tools_used', 'files_changed',
      'success', 'hit_count', 'keep', 'expires_at', 'confirmed_at',
      'last_seen', 'embedding',
    ]);

    const setClauses = [];
    const params = { id };

    for (const [key, value] of Object.entries(updates)) {
      if (allowed.has(key)) {
        setClauses.push(`${key} = @${key}`);
        params[key] = value;
      }
    }

    if (setClauses.length === 0) return this.getEntry(id);

    setClauses.push("last_seen = datetime('now')");
    const sql = `UPDATE entries SET ${setClauses.join(', ')} WHERE id = @id`;
    this.#db.prepare(sql).run(params);
    return this.getEntry(id);
  }

  /**
   * Delete an entry by id.
   */
  deleteEntry(id) {
    this.#ensureOpen();
    const info = this.#db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    // Rebuild FTS5 index after delete (external content — FTS5 delete
    // command has compatibility issues with certain SQLite builds)
    if (info.changes > 0) this.rebuildFTS();
    return info.changes > 0;
  }

  /**
   * List entries with optional filters.
   */
  listEntries({ type, category, status, limit = 100, offset = 0, includeArchived = false } = {}) {
    this.#ensureOpen();
    const where = [];
    const params = {};

    if (type) { where.push('type = @type'); params.type = type; }
    if (category) { where.push('category = @category'); params.category = category; }
    if (!includeArchived) {
      where.push("(status IS NULL OR status != 'archived')");
    } else if (status) {
      where.push('status = @status');
      params.status = status;
    }

    const sql = `SELECT * FROM entries${where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY last_seen DESC LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    return this.#db.prepare(sql).all(params).map(r => this.#rowToEntry(r));
  }

  /**
   * Get total entry count.
   */
  countEntries() {
    this.#ensureOpen();
    return this.#db.prepare('SELECT COUNT(*) as c FROM entries').get().c;
  }

  /**
   * Get stats about the database.
   */
  stats() {
    this.#ensureOpen();
    const total = this.countEntries();
    const byType = this.#db.prepare('SELECT type, COUNT(*) as c FROM entries GROUP BY type').all();
    const byStatus = this.#db.prepare('SELECT COALESCE(status, \'active\') as status, COUNT(*) as c FROM entries GROUP BY status').all();
    const archivedCount = this.#db.prepare("SELECT COUNT(*) as c FROM entries WHERE status = 'archived'").get().c;
    const tempCount = this.#db.prepare('SELECT COUNT(*) as c FROM entries WHERE expires_at IS NOT NULL').get().c;

    return { total, byType, byStatus, archivedCount, temporaryCount: tempCount, vecAvailable: this.#vecAvailable };
  }

  // -----------------------------------------------------------------------
  // Search: BM25 (FTS5)
  // -----------------------------------------------------------------------

  /**
   * BM25 full-text search using FTS5.
   * Returns array of { rowid, rank, ...entry fields }.
   */
  searchFTS(query, limit = 10) {
    this.#ensureOpen();
    if (!query || query.trim().length === 0) return [];

    try {
      // Sanitize FTS5 query: escape special chars, convert to prefix match
      const ftsQuery = query.trim()
        .replace(/['"]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w + '*') // prefix match
        .join(' AND ');

      const rows = this.#db.prepare(`
        SELECT e.*, rank
        FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit);

      return rows.map(r => this.#rowToEntry(r));
    } catch {
      // FTS5 query error (invalid syntax) — fallback to LIKE
      return this.#searchLike(query, limit);
    }
  }

  /**
   * LIKE-based fallback search.
   */
  #searchLike(query, limit = 10) {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const conditions = terms.map(t => '(error_message LIKE ? OR resolution LIKE ? OR behavior_change LIKE ?)');
    const params = terms.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);

    const rows = this.#db.prepare(`
      SELECT * FROM entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(r => this.#rowToEntry(r));
  }

  // -----------------------------------------------------------------------
  // Search: Vector (ANN + app-level fallback)
  // -----------------------------------------------------------------------

  /**
   * Vector similarity search.
   * Uses sqlite-vec ANN if available, otherwise app-level cosine.
   * @param {Float32Array|number[]} embedding - 384-dim vector
   * @param {number} limit
   * @returns {Array} [{ ...entry, _distance }]
   */
  searchVector(embedding, limit = 10) {
    this.#ensureOpen();
    if (!embedding || embedding.length !== 384) return [];

    if (this.#vecAvailable) {
      return this.#searchVectorANN(embedding, limit);
    }
    return this.#searchVectorCosine(embedding, limit);
  }

  /**
   * ANN vector search via sqlite-vec.
   */
  #searchVectorANN(embedding, limit) {
    try {
      const blob = Buffer.from(new Float32Array(embedding).buffer);
      const rows = this.#db.prepare(`
        SELECT e.*, distance
        FROM entries_vec
        JOIN entries e ON e.rowid = entries_vec.rowid
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      `).all(blob, limit);

      return rows.map(r => ({
        ...this.#rowToEntry(r),
        _distance: r.distance,
      }));
    } catch (e) {
      // vec0 query failed — fallback to cosine
      return this.#searchVectorCosine(embedding, limit);
    }
  }

  /**
   * App-level cosine similarity (fallback when sqlite-vec unavailable).
   * Loads all entries with BLOB embeddings and scans O(n).
   */
  #searchVectorCosine(embedding, limit) {
    const queryVec = new Float32Array(embedding);
    const rows = this.#db.prepare(
      'SELECT id, embedding FROM entries WHERE embedding IS NOT NULL'
    ).all();

    const scored = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const entryVec = new Float32Array(row.embedding);
        const dist = 1 - this.#cosineSimilarity(queryVec, entryVec);
        scored.push({ id: row.id, distance: dist });
      } catch {
        // skip malformed embedding
      }
    }

    scored.sort((a, b) => a.distance - b.distance);
    const topIds = scored.slice(0, limit).map(s => s.id);

    if (topIds.length === 0) return [];

    const placeholders = topIds.map(() => '?').join(',');
    const entries = this.#db.prepare(
      `SELECT * FROM entries WHERE id IN (${placeholders})`
    ).all(...topIds);

    // Preserve sort order
    const entryMap = new Map(entries.map(e => [e.id, e]));
    const distanceMap = new Map(scored.slice(0, limit).map(s => [s.id, s.distance]));

    return topIds
      .map(id => {
        const row = entryMap.get(id);
        return row ? { ...this.#rowToEntry(row), _distance: distanceMap.get(id) } : null;
      })
      .filter(Boolean);
  }

  // -----------------------------------------------------------------------
  // Search: Hybrid (BM25 + Vector → RRF)
  // -----------------------------------------------------------------------

  /**
   * Hybrid search using RRF (Reciprocal Rank Fusion).
   * Combines BM25 (FTS5) and vector (ANN or cosine) rankings.
   *
   * @param {string} query - Text query for BM25
   * @param {Float32Array|null} embedding - Vector embedding (null to skip vector)
   * @param {Object} options
   * @param {number} options.k - RRF constant (default: 60)
   * @param {number} options.limit - Max results (default: 10)
   * @param {number} options.streamLimit - Results per stream (default: limit * 3)
   * @returns {Array} [{ ...entry, _rrfScore, _ranks }]
   */
  searchHybrid(query, embedding, options = {}) {
    const { k = 60, limit = 10, streamLimit = limit * 3 } = options;

    // Collect results from each stream
    const ranks = {}; // id → { rank_bm25, rank_vec }

    // Stream 1: BM25
    const bm25Results = this.searchFTS(query, streamLimit);
    bm25Results.forEach((r, i) => {
      if (!ranks[r.id]) ranks[r.id] = {};
      ranks[r.id].rank_bm25 = i + 1;
    });

    // Stream 2: Vector (if embedding provided)
    if (embedding) {
      const vecResults = this.searchVector(embedding, streamLimit);
      vecResults.forEach((r, i) => {
        if (!ranks[r.id]) ranks[r.id] = {};
        ranks[r.id].rank_vec = i + 1;
      });
    }

    // RRF scoring
    const scored = [];
    for (const [id, rankData] of Object.entries(ranks)) {
      let score = 0;
      if (rankData.rank_bm25) score += 1 / (k + rankData.rank_bm25);
      if (rankData.rank_vec) score += 1 / (k + rankData.rank_vec);
      scored.push({ id, score, ranks: rankData });
    }

    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit);

    if (topIds.length === 0) return [];

    // Fetch full entries
    const placeholders = topIds.map(() => '?').join(',');
    const entries = this.#db.prepare(
      `SELECT * FROM entries WHERE id IN (${placeholders})`
    ).all(...topIds.map(s => s.id));

    const entryMap = new Map(entries.map(e => [e.id, e]));

    return topIds
      .map(s => {
        const row = entryMap.get(s.id);
        return row ? {
          ...this.#rowToEntry(row),
          _rrfScore: Math.round(s.score * 1000) / 1000,
          _ranks: s.ranks,
        } : null;
      })
      .filter(Boolean);
  }

  // -----------------------------------------------------------------------
  // Vector embedding storage helpers
  // -----------------------------------------------------------------------

  /**
   * Store embedding vector for an entry.
   * Stores in both vec0 (if available) and entries.embedding BLOB.
   */
  storeEmbedding(entryId, embedding) {
    this.#ensureOpen();
    const blob = Buffer.from(new Float32Array(embedding).buffer);

    // Update entries table BLOB (always — for app-level fallback)
    this.#db.prepare('UPDATE entries SET embedding = ? WHERE id = ?').run(blob, entryId);

    // Update vec0 table (if available)
    // Note: sqlite-vec v0.1.9 requires BigInt for rowid (Number binds as REAL, rejected)
    if (this.#vecAvailable) {
      const row = this.#db.prepare('SELECT rowid FROM entries WHERE id = ?').get(entryId);
      if (row) {
        this.#db.prepare(
          'INSERT OR REPLACE INTO entries_vec(rowid, embedding) VALUES (?, ?)'
        ).run(BigInt(row.rowid), blob);
      }
    }
  }

  /**
   * Get embedding for an entry (as Float32Array).
   */
  getEmbedding(entryId) {
    this.#ensureOpen();
    const row = this.#db.prepare('SELECT embedding FROM entries WHERE id = ?').get(entryId);
    if (!row || !row.embedding) return null;
    return new Float32Array(row.embedding);
  }

  // -----------------------------------------------------------------------
  // Migration from JSON
  // -----------------------------------------------------------------------

  /**
   * Migrate entries from a JSON file into SQLite.
   * Skips duplicates based on hash.
   * @param {string} jsonPath - Path to resolutions.json
   * @returns {{ migrated: number, skipped: number }}
   */
  migrateFromJSON(jsonPath) {
    this.#ensureOpen();
    if (!existsSync(jsonPath)) return { migrated: 0, skipped: 0 };

    const raw = readFileSync(jsonPath, 'utf-8');
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch {
      return { migrated: 0, skipped: 0 };
    }

    if (!Array.isArray(entries)) entries = [entries];

    let migrated = 0;
    let skipped = 0;

    const insertStmt = this.#db.prepare(`
      INSERT OR IGNORE INTO entries
        (id, hash, type, category, status, error_message, resolution,
         behavior_change, target_skill, tools_used, files_changed,
         success, hit_count, keep, expires_at, confirmed_at,
         created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = this.#db.transaction(() => {
      for (const e of entries) {
        // Check by hash
        const existing = e.hash ? this.getEntryByHash(e.hash) : null;
        if (existing) { skipped++; continue; }

        const result = insertStmt.run(
          e.id || crypto.randomUUID(),
          e.hash || '',
          e.type || 'error',
          e.category || null,
          e.status || 'active',
          e.error_message || null,
          e.resolution || null,
          e.behavior_change || null,
          e.target_skill || null,
          Array.isArray(e.tools_used) ? e.tools_used.join(',') : (e.tools_used || null),
          Array.isArray(e.files_changed) ? e.files_changed.join(',') : (e.files_changed || null),
          e.success !== undefined ? (e.success ? 1 : 0) : 1,
          e.hit_count || 1,
          e.keep || null,
          e.expires_at || null,
          e.confirmed_at || null,
          e.created_at || null,
          e.last_seen || null,
        );
        if (result.changes > 0) migrated++;
        else skipped++;
      }
    });

    txn();
    return { migrated, skipped };
  }

  // -----------------------------------------------------------------------
  // FTS5 sync (external content — manual sync, no triggers)
  // -----------------------------------------------------------------------

  /**
   * Sync an entry to FTS5 by rowid.
   */
  #syncFTS5(rowid, error_message, resolution, behavior_change) {
    try {
      this.#db.prepare(
        'INSERT INTO entries_fts(rowid, error_message, resolution, behavior_change) VALUES (?, ?, ?, ?)'
      ).run(rowid, error_message || '', resolution || '', behavior_change || '');
    } catch {
      // FTS5 sync failure is non-fatal — rebuild on next search
    }
  }

  /**
   * Rebuild the entire FTS5 index from entries table.
   * Call after bulk operations or if index becomes out of sync.
   */
  rebuildFTS() {
    this.#ensureOpen();
    try {
      this.#db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");
    } catch {
      // Rebuild failure — FTS5 may be unavailable, use LIKE fallback
    }
  }

  /**
   * Sync entry to FTS5 (internal).
   */
  #syncEntryToFTS(entry, rowid) {
    if (!rowid) {
      const r = this.#db.prepare('SELECT rowid FROM entries WHERE id = ?').get(entry.id);
      if (!r) return;
      rowid = r.rowid;
    }
    this.#syncFTS5(rowid, entry.error_message, entry.resolution, entry.behavior_change);
  }

  // -----------------------------------------------------------------------
  // Lifecycle helpers (delegated from memory-store.mjs CLI)
  // -----------------------------------------------------------------------

  /**
   * Run lifecycle: clean stale entries, archive decayed, expire TTL.
   * Returns summary of actions taken.
   */
  runLifecycle() {
    this.#ensureOpen();
    const actions = { cleaned: 0, archived: 0, expired: 0 };

    // Layer 1: Clean stale bug fixes (files_changed all mtime > created_at)
    // Note: mtime check done in CLI, here we just clean expired TTL
    const now = new Date().toISOString();

    // Layer 3: Expire TTL entries
    const expired = this.#db.prepare(
      "DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at < ? AND (keep IS NULL OR keep != 'always')"
    ).run(now);
    actions.expired = expired.changes;

    // Layer 2: Auto-archive decayed entries
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const archived = this.#db.prepare(`
      UPDATE entries SET status = 'archived'
      WHERE status IS NULL OR status = 'active'
        AND hit_count < 1
        AND last_seen < ?
        AND (keep IS NULL OR keep != 'always')
    `).run(ninetyDaysAgo);
    actions.archived = archived.changes;

    this.#db.pragma('wal_checkpoint(TRUNCATE)');
    return actions;
  }

  /**
   * Increment hit_count and update last_seen for an entry.
   */
  touchEntry(id) {
    this.#ensureOpen();
    this.#db.prepare(`
      UPDATE entries SET hit_count = hit_count + 1, last_seen = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  #ensureOpen() {
    if (!this.#db) throw new Error('MemoryDB not opened. Call .open() first.');
  }

  /**
   * Convert SQLite row to entry object (convert blob, normalize types).
   */
  #rowToEntry(row) {
    if (!row) return null;
    const entry = { ...row };
    // Remove internal fields
    delete entry.embedding;
    delete entry.rowid;
    // Normalize boolean fields
    if (entry.success !== undefined) entry.success = entry.success === 1;
    return entry;
  }

  /**
   * Cosine similarity between two Float32Arrays.
   */
  #cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  // -----------------------------------------------------------------------
  // Phase 16: Knowledge Graph
  // -----------------------------------------------------------------------

  /**
   * Create multiple entities. Skips entities with existing names.
   * @param {Array<{name:string, type:string, observations:string[]}>} entities
   * @returns {{ created: number, skipped: number }}
   */
  createEntities(entities) {
    this.#ensureOpen();
    let created = 0, skipped = 0;
    const stmt = this.#db.prepare(`
      INSERT OR IGNORE INTO kg_entities (name, type, observations)
      VALUES (?, ?, ?)
    `);
    const insertMany = this.#db.transaction((items) => {
      for (const e of items) {
        const obs = JSON.stringify(e.observations || []);
        const result = stmt.run(e.name, e.type || 'unknown', obs);
        if (result.changes > 0) created++;
        else skipped++;
      }
    });
    insertMany(entities);
    return { created, skipped };
  }

  /**
   * Create multiple relations. Skips duplicate relations.
   * @param {Array<{from:string, to:string, relationType:string}>} relations
   * @returns {{ created: number, skipped: number }}
   */
  createRelations(relations) {
    this.#ensureOpen();
    let created = 0, skipped = 0;
    const stmt = this.#db.prepare(`
      INSERT OR IGNORE INTO kg_relations (from_entity, to_entity, relation_type)
      VALUES (?, ?, ?)
    `);
    const insertMany = this.#db.transaction((items) => {
      for (const r of items) {
        const result = stmt.run(r.from, r.to, r.relationType);
        if (result.changes > 0) created++;
        else skipped++;
      }
    });
    insertMany(relations);
    return { created, skipped };
  }

  /**
   * Search nodes by query across name, type, and observations.
   * @param {string} query
   * @param {number} [limit=20]
   * @returns {Array<{name, type, observations, relations}>}
   */
  searchNodes(query, limit = 20) {
    this.#ensureOpen();
    const likeQuery = `%${query}%`;
    const rows = this.#db.prepare(`
      SELECT DISTINCT e.name, e.type, e.observations, e.created_at
      FROM kg_entities e
      WHERE e.name LIKE ? OR e.type LIKE ? OR e.observations LIKE ?
      ORDER BY e.last_seen DESC
      LIMIT ?
    `).all(likeQuery, likeQuery, likeQuery, limit);

    return rows.map(r => ({
      name: r.name,
      type: r.type,
      observations: JSON.parse(r.observations || '[]'),
      relations: this.#getRelationsFor(r.name),
    }));
  }

  /**
   * Open specific nodes by name and return them with their inter-relations.
   * @param {string[]} names
   * @returns {{ entities: Array, relations: Array }}
   */
  openNodes(names) {
    this.#ensureOpen();
    if (!names || names.length === 0) return { entities: [], relations: [] };

    const placeholders = names.map(() => '?').join(',');
    const entities = this.#db.prepare(`
      SELECT name, type, observations, created_at
      FROM kg_entities
      WHERE name IN (${placeholders})
    `).all(...names).map(r => ({
      name: r.name,
      type: r.type,
      observations: JSON.parse(r.observations || '[]'),
    }));

    const relations = this.#db.prepare(`
      SELECT from_entity, to_entity, relation_type
      FROM kg_relations
      WHERE from_entity IN (${placeholders}) AND to_entity IN (${placeholders})
    `).all(...names.concat(names)).map(r => ({
      from: r.from_entity,
      to: r.to_entity,
      relationType: r.relation_type,
    }));

    return { entities, relations };
  }

  /**
   * Read the entire knowledge graph.
   * @returns {{ entities: Array, relations: Array }}
   */
  readGraph() {
    this.#ensureOpen();
    const entities = this.#db.prepare(`
      SELECT name, type, observations, created_at
      FROM kg_entities ORDER BY last_seen DESC
    `).all().map(r => ({
      name: r.name,
      type: r.type,
      observations: JSON.parse(r.observations || '[]'),
    }));

    const relations = this.#db.prepare(`
      SELECT from_entity, to_entity, relation_type
      FROM kg_relations ORDER BY created_at DESC
    `).all().map(r => ({
      from: r.from_entity,
      to: r.to_entity,
      relationType: r.relation_type,
    }));

    return { entities, relations };
  }

  /**
   * Delete entities and their relations (cascade).
   * @param {string[]} names
   * @returns {{ deleted: number }}
   */
  deleteEntities(names) {
    this.#ensureOpen();
    if (!names || names.length === 0) return { deleted: 0 };
    const placeholders = names.map(() => '?').join(',');
    const result = this.#db.prepare(`
      DELETE FROM kg_entities WHERE name IN (${placeholders})
    `).run(...names);
    return { deleted: result.changes };
  }

  /**
   * Delete specific observations from an entity.
   * @param {string} entityName
   * @param {string[]} observations
   * @returns {{ removed: number }}
   */
  deleteObservations(entityName, observations) {
    this.#ensureOpen();
    const entity = this.#db.prepare('SELECT observations FROM kg_entities WHERE name = ?').get(entityName);
    if (!entity) return { removed: 0 };

    const current = JSON.parse(entity.observations || '[]');
    const toRemove = new Set(observations);
    const filtered = current.filter(o => !toRemove.has(o));
    const removed = current.length - filtered.length;

    this.#db.prepare('UPDATE kg_entities SET observations = ?, last_seen = datetime(\'now\') WHERE name = ?')
      .run(JSON.stringify(filtered), entityName);

    return { removed };
  }

  /**
   * Add observations to an existing entity.
   * @param {string} entityName
   * @param {string[]} observations
   * @returns {{ added: number }}
   */
  addObservations(entityName, observations) {
    this.#ensureOpen();
    const entity = this.#db.prepare('SELECT observations FROM kg_entities WHERE name = ?').get(entityName);
    if (!entity) return { added: 0 };

    const current = JSON.parse(entity.observations || '[]');
    const existing = new Set(current);
    let added = 0;
    for (const o of observations) {
      if (!existing.has(o)) {
        current.push(o);
        existing.add(o);
        added++;
      }
    }

    this.#db.prepare('UPDATE kg_entities SET observations = ?, last_seen = datetime(\'now\') WHERE name = ?')
      .run(JSON.stringify(current), entityName);

    return { added };
  }

  /**
   * Delete specific relations.
   * @param {Array<{from:string, to:string, relationType:string}>} relations
   * @returns {{ deleted: number }}
   */
  deleteRelations(relations) {
    this.#ensureOpen();
    let deleted = 0;
    const stmt = this.#db.prepare(`
      DELETE FROM kg_relations
      WHERE from_entity = ? AND to_entity = ? AND relation_type = ?
    `);
    const deleteMany = this.#db.transaction((items) => {
      for (const r of items) {
        const result = stmt.run(r.from, r.to, r.relationType);
        deleted += result.changes;
      }
    });
    deleteMany(relations);
    return { deleted };
  }

  /**
   * Get entity count in KG.
   * @returns {number}
   */
  countEntities() {
    this.#ensureOpen();
    return this.#db.prepare('SELECT COUNT(*) as cnt FROM kg_entities').get().cnt;
  }

  /**
   * Get relation count in KG.
   * @returns {number}
   */
  countRelations() {
    this.#ensureOpen();
    return this.#db.prepare('SELECT COUNT(*) as cnt FROM kg_relations').get().cnt;
  }

  /**
   * Get all relations for a specific entity.
   * @private
   */
  #getRelationsFor(entityName) {
    return this.#db.prepare(`
      SELECT from_entity, to_entity, relation_type
      FROM kg_relations
      WHERE from_entity = ? OR to_entity = ?
    `).all(entityName, entityName).map(r => ({
      from: r.from_entity,
      to: r.to_entity,
      relationType: r.relation_type,
    }));
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Get or create the global MemoryDB singleton.
 * @param {string} [dbPath] - Required on first call
 * @returns {MemoryDB}
 */
export function getMemoryDB(dbPath) {
  if (!_instance) {
    if (!dbPath) throw new Error('dbPath required on first call to getMemoryDB()');
    _instance = new MemoryDB(dbPath);
    _instance.open();
  }
  return _instance;
}

/**
 * Reset singleton (for testing).
 */
export function resetMemoryDB() {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}
