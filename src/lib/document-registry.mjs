// document-registry.mjs — Cross-session document index
//
// Phase 4b: Persistently track ingested documents so knowledge survives
// between sessions. Uses Node 26+ node:sqlite (no external deps).
//
// Usage:
//   import { registry } from './document-registry.mjs';
//   registry.register('/path/to/doc.pdf', 'pdf', 'Contract v2');
//   const docs = registry.list();
//   const found = registry.search('contract');

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_DB_PATH = `${homedir()}/.smart/cache/documents.db`;

// ---------------------------------------------------------------------------
// Document Registry
// ---------------------------------------------------------------------------

class DocumentRegistry {
  #db = null;
  #dbPath = null;

  /**
   * @param {string} [dbPath] - Path to SQLite database file
   */
  constructor(dbPath) {
    this.#dbPath = dbPath || DEFAULT_DB_PATH;
    this.#ensureDb();
  }

  /** Lazily initialize DB connection + schema */
  #ensureDb() {
    if (this.#db) return;
    const dir = dirname(this.#dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.#db = new DatabaseSync(this.#dbPath);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        path      TEXT    UNIQUE NOT NULL,
        format    TEXT    NOT NULL DEFAULT '',
        title     TEXT    NOT NULL DEFAULT '',
        summary   TEXT    NOT NULL DEFAULT '',
        ingested_at TEXT  NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT  NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Register or update a document in the index.
   * If the path already exists, updates title/summary/format.
   *
   * @param {string} filePath - Absolute path to document
   * @param {string} format - File format (pdf, docx, etc.)
   * @param {string} title - Document title (basename if not provided)
   * @param {object} [opts]
   * @param {string} [opts.summary] - Optional content summary
   * @returns {{ path: string, format: string, title: string }}
   */
  register(filePath, format, title = '', opts = {}) {
    this.#ensureDb();
    const { summary = '' } = opts;
    const safePath = String(filePath);
    const safeFormat = String(format);
    const safeTitle = String(title || safePath.split('/').pop() || safePath);

    const stmt = this.#db.prepare(`
      INSERT INTO documents (path, format, title, summary, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(path) DO UPDATE SET
        format    = excluded.format,
        title     = excluded.title,
        summary   = CASE WHEN excluded.summary != '' THEN excluded.summary ELSE summary END,
        updated_at = datetime('now')
    `);
    stmt.run(safePath, safeFormat, safeTitle, summary);
    return { path: safePath, format: safeFormat, title: safeTitle };
  }

  /**
   * Update just the summary of an existing document entry.
   * @param {string} filePath
   * @param {string} summary
   */
  updateSummary(filePath, summary) {
    this.#ensureDb();
    const stmt = this.#db.prepare(`
      UPDATE documents SET summary = ?, updated_at = datetime('now')
      WHERE path = ?
    `);
    stmt.run(String(summary), String(filePath));
  }

  /**
   * List all registered documents, newest first.
   * @param {number} [limit=50]
   * @returns {Array<{id: number, path: string, format: string, title: string, summary: string, ingested_at: string, updated_at: string}>}
   */
  list(limit = 50) {
    this.#ensureDb();
    const stmt = this.#db.prepare(
      'SELECT * FROM documents ORDER BY updated_at DESC LIMIT ?'
    );
    return stmt.all(limit);
  }

  /**
   * Search documents by title or path (LIKE %query%).
   * @param {string} query
   * @param {number} [limit=20]
   * @returns {Array}
   */
  search(query, limit = 20) {
    this.#ensureDb();
    const like = `%${query}%`;
    const stmt = this.#db.prepare(`
      SELECT * FROM documents
      WHERE title LIKE ? OR path LIKE ? OR summary LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    return stmt.all(like, like, like, limit);
  }

  /**
   * Get a single document by path.
   * @param {string} filePath
   * @returns {object|null}
   */
  get(filePath) {
    this.#ensureDb();
    const stmt = this.#db.prepare('SELECT * FROM documents WHERE path = ?');
    return stmt.get(String(filePath)) || null;
  }

  /**
   * Get total count of registered documents.
   * @returns {number}
   */
  count() {
    this.#ensureDb();
    const stmt = this.#db.prepare('SELECT COUNT(*) as count FROM documents');
    const row = stmt.get();
    return row?.count || 0;
  }

  /**
   * Delete a document entry by path.
   * @param {string} filePath
   */
  delete(filePath) {
    this.#ensureDb();
    const stmt = this.#db.prepare('DELETE FROM documents WHERE path = ?');
    stmt.run(String(filePath));
  }

  /** Close the database connection */
  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Shared registry instance (connect once, reuse across plugin calls) */
let _defaultRegistry = null;

/**
 * Get or create the default shared DocumentRegistry instance.
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 * @returns {DocumentRegistry}
 */
export function getRegistry(opts = {}) {
  if (!_defaultRegistry) {
    _defaultRegistry = new DocumentRegistry(opts.dbPath);
  }
  return _defaultRegistry;
}

/** For testing: reset the singleton, optionally delete the db file */
export function resetRegistry(opts = {}) {
  if (_defaultRegistry) {
    _defaultRegistry.close();
    _defaultRegistry = null;
  }
  if (opts.deleteDb) {
    const dbPath = opts.dbPath || DEFAULT_DB_PATH;
    try { unlinkSync(dbPath); } catch { /* ok */ }
    try { unlinkSync(dbPath + '-wal'); } catch { /* ok */ }
    try { unlinkSync(dbPath + '-shm'); } catch { /* ok */ }
  }
}

export { DocumentRegistry };
