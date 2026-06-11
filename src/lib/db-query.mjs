// db-query.mjs — Database Query Engine (Phase 17)
//
// Read-only SQL query engine with safety guards.
// Supports SQLite (built-in better-sqlite3) and PostgreSQL (optional pg).
//
// Safety: read-only, timeout, row limit, forbidden DDL/DML keywords.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Forbidden SQL patterns (DDL/DML — read-only only)
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
  /\bDROP\b/i, /\bDELETE\b/i, /\bINSERT\b/i, /\bUPDATE\b/i,
  /\bALTER\b/i, /\bCREATE\b/i, /\bTRUNCATE\b/i, /\bREPLACE\b/i,
  /\bGRANT\b/i, /\bREVOKE\b/i, /\bATTACH\b/i, /\bDETACH\b/i,
  /\bVACUUM\b/i, /\bREINDEX\b/i,
  // PRAGMA: only allow table_info, index_list, foreign_key_list (checked in prefix)
  /\bPRAGMA\s+(?!table_info|index_list|foreign_key_list)/i,
];

// ---------------------------------------------------------------------------
// SQLite Query Engine
// ---------------------------------------------------------------------------

/**
 * Check if a SQL query is safe (read-only).
 * @param {string} sql
 * @returns {{ safe: boolean, reason?: string }}
 */
export function isSafeQuery(sql) {
  const trimmed = sql.trim();
  if (!trimmed) return { safe: false, reason: 'Empty query' };

  // Must start with SELECT, EXPLAIN, DESCRIBE, SHOW, WITH, or safe PRAGMA
  const allowedPrefixes = /^(SELECT|EXPLAIN|DESCRIBE|SHOW|WITH|PRAGMA\s+table_info|PRAGMA\s+index_list|PRAGMA\s+foreign_key_list)\b/i;
  if (!allowedPrefixes.test(trimmed)) {
    return { safe: false, reason: 'Only SELECT/EXPLAIN/DESCRIBE/SHOW/WITH queries are allowed' };
  }

  // Check for forbidden DDL/DML keywords (after prefix check, so safe PRAGMA passes)
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: `Forbidden SQL keyword detected: ${pattern}` };
    }
  }

  return { safe: true };
}

/**
 * Introspect a SQLite database schema.
 * @param {string} dbPath - Path to SQLite database
 * @returns {{ ok: boolean, tables?: Array, error?: string }}
 */
export function introspectSQLite(dbPath) {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    return { ok: false, error: `Cannot open database: ${err.message}` };
  }

  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    const result = [];
    for (const t of tables) {
      const columns = db.prepare(`PRAGMA table_info('${t.name}')`).all();
      const rowCount = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get().cnt;
      result.push({
        name: t.name,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type || 'unknown',
          nullable: !c.notnull,
          primaryKey: c.pk === 1,
        })),
        rowCount,
      });
    }

    return { ok: true, tables: result, tableCount: result.length };
  } catch (err) {
    return { ok: false, error: `Introspection failed: ${err.message}` };
  } finally {
    db.close();
  }
}

/**
 * Execute a read-only SQL query on a SQLite database.
 * @param {string} dbPath - Path to SQLite database
 * @param {string} sql - SQL query (SELECT only)
 * @param {object} options
 * @param {number} [options.timeout=10000] - Query timeout in ms
 * @param {number} [options.limit=1000] - Max rows to return
 * @returns {{ ok: boolean, columns?: string[], rows?: Array, rowCount?: number, error?: string }}
 */
export function querySQLite(dbPath, sql, options = {}) {
  const { timeout = 10000, limit = 1000 } = options;

  // Safety check
  const safety = isSafeQuery(sql);
  if (!safety.safe) {
    return { ok: false, error: safety.reason };
  }

  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true, timeout });
  } catch (err) {
    return { ok: false, error: `Cannot open database: ${err.message}` };
  }

  try {
    // Add LIMIT if not present
    let finalSQL = sql.trim();
    if (!/\bLIMIT\b/i.test(finalSQL)) {
      // Remove trailing semicolon before adding LIMIT
      finalSQL = finalSQL.replace(/;\s*$/, '');
      finalSQL = `SELECT * FROM (${finalSQL}) LIMIT ${limit}`;
    }

    const stmt = db.prepare(finalSQL);
    const columns = stmt.columns().map(c => c.name);
    const rows = stmt.all();
    const totalRowCount = rows.length;

    return {
      ok: true,
      columns,
      rows,
      rowCount: totalRowCount,
      truncated: totalRowCount >= limit,
      hint: totalRowCount >= limit
        ? `Results truncated at ${limit} rows. Use a more specific query or increase limit.`
        : undefined,
    };
  } catch (err) {
    return { ok: false, error: `Query failed: ${err.message}` };
  } finally {
    db.close();
  }
}

/**
 * Introspect a PostgreSQL database schema.
 * Requires 'pg' npm package (optional dependency).
 * @param {string} connectionString - PostgreSQL connection string
 * @returns {Promise<{ ok: boolean, tables?: Array, error?: string }>}
 */
export async function introspectPostgres(connectionString) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    return { ok: false, error: 'pg npm package not installed. Run: npm install pg' };
  }

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = [];
    for (const row of result.rows) {
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [row.table_name]);

      const count = await client.query(`SELECT COUNT(*) as cnt FROM "${row.table_name}"`);

      tables.push({
        name: row.table_name,
        columns: cols.rows.map(c => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        })),
        rowCount: parseInt(count.rows[0].cnt),
      });
    }

    return { ok: true, tables, tableCount: tables.length };
  } catch (err) {
    return { ok: false, error: `PostgreSQL introspection failed: ${err.message}` };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Execute a read-only SQL query on PostgreSQL.
 * @param {string} connectionString
 * @param {string} sql
 * @param {object} options
 * @returns {Promise<{ ok: boolean, columns?: string[], rows?: Array, error?: string }>}
 */
export async function queryPostgres(connectionString, sql, options = {}) {
  const safety = isSafeQuery(sql);
  if (!safety.safe) {
    return { ok: false, error: safety.reason };
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    return { ok: false, error: 'pg npm package not installed. Run: npm install pg' };
  }

  const { limit = 1000 } = options;
  const client = new pg.Client({ connectionString, statement_timeout: options.timeout || 10000 });

  try {
    await client.connect();

    let finalSQL = sql.trim();
    if (!/\bLIMIT\b/i.test(finalSQL)) {
      finalSQL = finalSQL.replace(/;\s*$/, '');
      finalSQL = `SELECT * FROM (${finalSQL}) AS _sub LIMIT ${limit}`;
    }

    const result = await client.query(finalSQL);
    const columns = result.fields.map(f => f.name);

    return {
      ok: true,
      columns,
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length >= limit,
    };
  } catch (err) {
    return { ok: false, error: `PostgreSQL query failed: ${err.message}` };
  } finally {
    await client.end().catch(() => {});
  }
}
