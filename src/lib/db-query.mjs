// db-query.mjs — Database Query Engine (Phase 17)
//
// Read-only SQL query engine with safety guards.
// Supports SQLite (built-in better-sqlite3) and PostgreSQL (optional pg).
//
// Safety: read-only, timeout, row limit, forbidden DDL/DML keywords.

import Database from 'better-sqlite3';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

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

// ===========================================================================
// WRITE OPERATIONS (SQLite only — Phase 1)
// ===========================================================================

/**
 * Validate data object has valid primitive types for SQL binding.
 */
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'data must be a non-null object' };
  }
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
      return { valid: false, error: `Invalid type for column "${key}": ${typeof val}. Only string/number/boolean/null allowed.` };
    }
  }
  return { valid: true };
}

/**
 * Validate WHERE condition is a safe, non-empty object.
 */
function validateWhere(where) {
  if (!where || typeof where !== 'object' || Array.isArray(where) || Object.keys(where).length === 0) {
    return { valid: false, error: 'where must be a non-empty object (e.g. {id: 42})' };
  }
  for (const [key, val] of Object.entries(where)) {
    if (val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
      return { valid: false, error: `Invalid type for WHERE column "${key}": ${typeof val}` };
    }
  }
  return { valid: true };
}

/**
 * Insert a row into a SQLite table.
 * Uses parameterized queries — safe from SQL injection.
 * @param {string} dbPath - Path to SQLite database
 * @param {string} table - Table name
 * @param {object} data - Column-value pairs
 * @returns {{ ok: boolean, inserted?: number, id?: number, error?: string }}
 */
export function writeSQLite(dbPath, table, data) {
  const dataCheck = validateData(data);
  if (!dataCheck.valid) return { ok: false, error: dataCheck.error };

  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');
    const cols = columns.map(c => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`;

    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    return {
      ok: true,
      inserted: result.changes,
      id: Number(result.lastInsertRowid),
    };
  } catch (err) {
    return { ok: false, error: `INSERT failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Update rows in a SQLite table.
 * Uses parameterized queries — safe from SQL injection.
 * @param {string} dbPath - Path to SQLite database
 * @param {string} table - Table name
 * @param {object} data - Column-value pairs to update
 * @param {object} where - WHERE conditions (AND)
 * @returns {{ ok: boolean, updated?: number, error?: string }}
 */
export function updateSQLite(dbPath, table, data, where) {
  const dataCheck = validateData(data);
  if (!dataCheck.valid) return { ok: false, error: dataCheck.error };

  const whereCheck = validateWhere(where);
  if (!whereCheck.valid) return { ok: false, error: whereCheck.error };

  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath);
    const setClauses = Object.keys(data).map(c => `"${c}" = ?`).join(', ');
    const whereClauses = Object.keys(where).map(c => `"${c}" = ?`).join(' AND ');
    const setValues = Object.values(data);
    const whereValues = Object.values(where);
    const sql = `UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`;

    const stmt = db.prepare(sql);
    const result = stmt.run(...setValues, ...whereValues);
    return {
      ok: true,
      updated: result.changes,
    };
  } catch (err) {
    return { ok: false, error: `UPDATE failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Delete rows from a SQLite table.
 * Uses parameterized queries — safe from SQL injection.
 * @param {string} dbPath - Path to SQLite database
 * @param {string} table - Table name
 * @param {object} where - WHERE conditions (AND). Empty {} deletes all (requires --confirm)
 * @returns {{ ok: boolean, deleted?: number, error?: string }}
 */
export function deleteSQLite(dbPath, table, where) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { ok: false, error: 'where must be an object (use {} to delete all with --confirm)' };
  }

  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath);
    const entries = Object.entries(where);

    let sql, values;
    if (entries.length === 0) {
      sql = `DELETE FROM "${table}"`;
      values = [];
    } else {
      const whereClauses = entries.map(([c]) => `"${c}" = ?`).join(' AND ');
      values = entries.map(([, v]) => v);
      sql = `DELETE FROM "${table}" WHERE ${whereClauses}`;
    }

    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    return {
      ok: true,
      deleted: result.changes,
    };
  } catch (err) {
    return { ok: false, error: `DELETE failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Dry-run: simulate a write operation without committing.
 * Returns the SQL and estimated affected rows.
 * @param {'insert'|'update'|'delete'} operation
 * @param {string} dbPath
 * @param {string} table
 * @param {object} [data]
 * @param {object} [where]
 * @returns {{ ok: boolean, sql?: string, params?: Array, estimatedRows?: number, error?: string }}
 */
export function dryRunSQLite(operation, dbPath, table, data, where) {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });

    switch (operation) {
      case 'insert': {
        if (!data) return { ok: false, error: 'data required for insert dry-run' };
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(', ');
        const cols = columns.map(c => `"${c}"`).join(', ');
        const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`;
        return { ok: true, sql, params: Object.values(data), estimatedRows: 1 };
      }

      case 'update': {
        const setClauses = Object.keys(data || {}).map(c => `"${c}" = ?`).join(', ');
        const whereClauses = Object.keys(where || {}).map(c => `"${c}" = ?`).join(' AND ');
        const sql = `UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`;
        const params = [...Object.values(data || {}), ...Object.values(where || {})];

        const countSql = `SELECT COUNT(*) as cnt FROM "${table}" WHERE ${whereClauses}`;
        const { cnt } = db.prepare(countSql).get(...Object.values(where || {}));
        return { ok: true, sql, params, estimatedRows: cnt };
      }

      case 'delete': {
        const entries = Object.entries(where || {});
        let sql, countSql;
        if (entries.length === 0) {
          sql = `DELETE FROM "${table}"`;
          countSql = `SELECT COUNT(*) as cnt FROM "${table}"`;
        } else {
          const wc = entries.map(([c]) => `"${c}" = ?`).join(' AND ');
          sql = `DELETE FROM "${table}" WHERE ${wc}`;
          countSql = `SELECT COUNT(*) as cnt FROM "${table}" WHERE ${wc}`;
        }
        const { cnt } = db.prepare(countSql).get(...(entries.map(([, v]) => v)));
        return { ok: true, sql, params: entries.map(([, v]) => v), estimatedRows: cnt };
      }

      default:
        return { ok: false, error: `Unknown operation: ${operation}` };
    }
  } catch (err) {
    return { ok: false, error: `Dry-run failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

// ===========================================================================
// MIGRATION MANAGEMENT
// ===========================================================================

const MIGRATIONS_TABLE = '_migrations';

/**
 * Ensure the _migrations tracking table exists.
 * @param {object} db - better-sqlite3 Database instance
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now')),
      checksum TEXT
    )
  `);
}

/**
 * Parse a migration SQL file into up and down statements.
 * Sections delimited by:
 *   -- up
 *   -- down
 * @param {string} content - File content
 * @returns {{ up: string[], down: string[] }}
 */
function parseMigrationContent(content) {
  const lines = content.split('\n');
  const upLines = [];
  const downLines = [];
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^--\s*up\b/i.test(trimmed)) { currentSection = 'up'; continue; }
    if (/^--\s*down\b/i.test(trimmed)) { currentSection = 'down'; continue; }
    if (trimmed.startsWith('--')) continue;

    if (currentSection === 'up') upLines.push(line);
    else if (currentSection === 'down') downLines.push(line);
  }

  return {
    up: upLines.join('\n').split(';').map(s => s.trim()).filter(s => s.length > 0),
    down: downLines.join('\n').split(';').map(s => s.trim()).filter(s => s.length > 0),
  };
}

/**
 * List migration files in the migrations directory.
 * @param {string} migrationsDir
 * @returns {{ ok: boolean, migrations?: Array<{name: string, file: string}>, error?: string }}
 */
export function listMigrationFiles(migrationsDir) {
  try {
    if (!existsSync(migrationsDir)) {
      return { ok: true, migrations: [] };
    }

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const migrations = files.map(f => ({
      name: f.replace(/\.sql$/, ''),
      file: join(migrationsDir, f),
    }));

    return { ok: true, migrations };
  } catch (err) {
    return { ok: false, error: `Failed to list migrations: ${err.message}` };
  }
}

/**
 * Get already applied migrations from the database.
 * @param {string} dbPath
 * @returns {{ ok: boolean, applied?: Array<{name: string, applied_at: string}>, error?: string }}
 */
export function getAppliedMigrations(dbPath) {
  if (!existsSync(dbPath)) {
    return { ok: true, applied: [] };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    // Attempt to ensure migrations table — fails silently in read-only mode if table doesn't exist
    try {
      ensureMigrationsTable(db);
    } catch {
      // Table doesn't exist yet, no migrations applied
      return { ok: true, applied: [] };
    }
    const rows = db.prepare(`SELECT name, applied_at FROM "${MIGRATIONS_TABLE}" ORDER BY name`).all();
    return { ok: true, applied: rows };
  } catch (err) {
    return { ok: false, error: `Failed to get applied migrations: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Apply pending migrations to a SQLite database.
 * @param {string} dbPath
 * @param {string} [migrationsDir='migrations']
 * @returns {{ ok: boolean, applied?: string[], errors?: Array<{name: string, error: string}>, error?: string }}
 */
export function migrateUpSQLite(dbPath, migrationsDir = 'migrations') {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let files;
  try {
    if (!existsSync(migrationsDir)) {
      return { ok: true, applied: [] };
    }
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    return { ok: false, error: `Failed to read migrations dir: ${err.message}` };
  }

  let db;
  try {
    db = new Database(dbPath);
    ensureMigrationsTable(db);

    const applied = new Set(
      db.prepare(`SELECT name FROM "${MIGRATIONS_TABLE}"`).all().map(r => r.name)
    );

    const appliedList = [];
    const errors = [];

    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      if (applied.has(name)) continue;

      const filePath = join(migrationsDir, file);
      let content;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (e) {
        errors.push({ name, error: `Cannot read file: ${e.message}` });
        continue;
      }

      const parsed = parseMigrationContent(content);
      if (parsed.up.length === 0) {
        errors.push({ name, error: 'No UP section found in migration file' });
        continue;
      }

      try {
        const txn = db.transaction(() => {
          for (const stmt of parsed.up) {
            db.exec(stmt);
          }
          db.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" (name, checksum) VALUES (?, ?)`).run(name, '');
        });
        txn();
        appliedList.push(name);
      } catch (err) {
        errors.push({ name, error: err.message });
        break;
      }
    }

    return {
      ok: errors.length === 0,
      applied: appliedList,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    return { ok: false, error: `Migration up failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Rollback migrations from a SQLite database.
 * @param {string} dbPath
 * @param {number} [steps=1]
 * @param {string} [migrationsDir='migrations']
 * @returns {{ ok: boolean, rolledBack?: string[], errors?: Array<{name: string, error: string}>, error?: string }}
 */
export function migrateDownSQLite(dbPath, steps = 1, migrationsDir = 'migrations') {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath);
    ensureMigrationsTable(db);

    const applied = db.prepare(`SELECT name FROM "${MIGRATIONS_TABLE}" ORDER BY name DESC`).all();
    if (applied.length === 0) return { ok: true, rolledBack: [] };

    const toRollback = applied.slice(0, steps);
    const rolledBack = [];
    const errors = [];

    for (const { name } of toRollback) {
      const filePath = join(migrationsDir, `${name}.sql`);
      if (!existsSync(filePath)) {
        errors.push({ name, error: `Migration file not found: ${filePath}` });
        continue;
      }

      let content;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (e) {
        errors.push({ name, error: `Cannot read file: ${e.message}` });
        continue;
      }

      const parsed = parseMigrationContent(content);
      if (parsed.down.length === 0) {
        errors.push({ name, error: 'No DOWN section found in migration file' });
        continue;
      }

      try {
        const txn = db.transaction(() => {
          for (const stmt of parsed.down) {
            db.exec(stmt);
          }
          db.prepare(`DELETE FROM "${MIGRATIONS_TABLE}" WHERE name = ?`).run(name);
        });
        txn();
        rolledBack.push(name);
      } catch (err) {
        errors.push({ name, error: err.message });
        break;
      }
    }

    return {
      ok: errors.length === 0,
      rolledBack,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    return { ok: false, error: `Migration down failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Generate a migration template file from current schema.
 * @param {string} dbPath
 * @param {string} name - Migration name (e.g. "add_users_table")
 * @param {string} [migrationsDir='migrations']
 * @returns {{ ok: boolean, file?: string, error?: string }}
 */
export function createMigrationSQLite(dbPath, name, migrationsDir = 'migrations') {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const fileName = `${ts}_${name}.sql`;
  const filePath = join(migrationsDir, fileName);

  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
  }

  // Introspect current schema for reference
  let schemaHint = '';
  if (existsSync(dbPath)) {
    const schema = getFullSchemaSQLite(dbPath);
    if (schema.ok && schema.schema.length > 0) {
      schemaHint = '\n-- Current tables: ' + schema.schema.map(t => t.name).join(', ');
    }
  }

  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}${schemaHint}

-- up
-- Your UP migration SQL here

-- down
-- Your DOWN migration SQL here (reverse of up)
`;

  try {
    writeFileSync(filePath, template, 'utf-8');
    return { ok: true, file: filePath };
  } catch (err) {
    return { ok: false, error: `Failed to create migration file: ${err.message}` };
  }
}

/**
 * Get migration status (applied vs pending).
 * @param {string} dbPath
 * @param {string} [migrationsDir='migrations']
 * @returns {{ ok: boolean, status?: Array<{name: string, status: string, applied_at?: string}>, error?: string }}
 */
export function migrateStatusSQLite(dbPath, migrationsDir = 'migrations') {
  const filesResult = listMigrationFiles(migrationsDir);
  if (!filesResult.ok) return filesResult;

  const appliedResult = getAppliedMigrations(dbPath);
  if (!appliedResult.ok) return appliedResult;

  const appliedSet = new Map((appliedResult.applied || []).map(m => [m.name, m]));

  const allNames = new Set([
    ...(filesResult.migrations || []).map(m => m.name),
    ...appliedSet.keys(),
  ]);

  const status = [];
  for (const name of [...allNames].sort()) {
    const applied = appliedSet.get(name);
    status.push({
      name,
      status: applied ? 'applied' : 'pending',
      applied_at: applied?.applied_at,
    });
  }

  return { ok: true, status };
}

// ===========================================================================
// SCHEMA DIFF
// ===========================================================================

/**
 * Get full schema of a SQLite database as a comparable structure.
 * @param {string} dbPath
 * @returns {{ ok: boolean, schema?: Array<{name: string, columns: Array, indexes: Array}>, error?: string }}
 */
export function getFullSchemaSQLite(dbPath) {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database not found: ${dbPath}` };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '${MIGRATIONS_TABLE}'
      ORDER BY name
    `).all();

    const schema = [];
    for (const t of tables) {
      const columns = db.prepare(`PRAGMA table_info('${t.name}')`).all();
      const indexes = db.prepare(`PRAGMA index_list('${t.name}')`).all();
      schema.push({
        name: t.name,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type || 'unknown',
          nullable: !c.notnull,
          primaryKey: c.pk === 1,
          defaultValue: c.dflt_value,
        })),
        indexes: indexes.map(i => i.name),
      });
    }

    return { ok: true, schema };
  } catch (err) {
    return { ok: false, error: `Schema introspection failed: ${err.message}` };
  } finally {
    db?.close();
  }
}

/**
 * Compare two database schemas and return the diff.
 * @param {Array} schemaA - Reference schema
 * @param {Array} schemaB - Target schema
 * @returns {{ ok: boolean, diff: Array, changeCount: number }}
 */
export function diffSchema(schemaA, schemaB) {
  const changes = [];

  const mapA = new Map(schemaA.map(t => [t.name, t]));
  const mapB = new Map(schemaB.map(t => [t.name, t]));

  // Tables in B but not A
  for (const [name, table] of mapB) {
    if (!mapA.has(name)) {
      changes.push({ type: 'added', table: name, details: `Table "${name}" added (${table.columns.length} columns)` });
    }
  }

  // Tables in A but not B
  for (const [name] of mapA) {
    if (!mapB.has(name)) {
      changes.push({ type: 'removed', table: name, details: `Table "${name}" removed` });
    }
  }

  // Compare columns in shared tables
  for (const [name, tableA] of mapA) {
    const tableB = mapB.get(name);
    if (!tableB) continue;

    const colA = new Map(tableA.columns.map(c => [c.name, c]));
    const colB = new Map(tableB.columns.map(c => [c.name, c]));

    for (const [cName, cB] of colB) {
      if (!colA.has(cName)) {
        changes.push({ type: 'added', table: name, column: cName, details: `Column "${cName}" (${cB.type}) added to "${name}"` });
      } else {
        const cA = colA.get(cName);
        if (cA.type !== cB.type) {
          changes.push({ type: 'modified', table: name, column: cName, details: `"${cName}" type: ${cA.type} → ${cB.type}` });
        }
        if (cA.nullable !== cB.nullable) {
          changes.push({ type: 'modified', table: name, column: cName, details: `"${cName}" nullable: ${cA.nullable} → ${cB.nullable}` });
        }
      }
    }

    for (const [cName] of colA) {
      if (!colB.has(cName)) {
        changes.push({ type: 'removed', table: name, column: cName, details: `Column "${cName}" removed from "${name}"` });
      }
    }
  }

  return { ok: true, diff: changes, changeCount: changes.length };
}
