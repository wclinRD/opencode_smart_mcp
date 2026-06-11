// db-query.test.mjs — Phase 17: Database Query tests
//
// Tests: isSafeQuery, introspectSQLite, querySQLite, plugin integration

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';

// Dynamic imports
const { isSafeQuery, introspectSQLite, querySQLite } = await import('../src/lib/db-query.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createTestDB() {
  const path = resolve(tmpdir(), `db-test-${randomUUID()}.db`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
    INSERT INTO users VALUES (1, 'Alice', 'alice@test.com');
    INSERT INTO users VALUES (2, 'Bob', 'bob@test.com');
    INSERT INTO orders VALUES (1, 1, 99.99);
    INSERT INTO orders VALUES (2, 1, 49.99);
    INSERT INTO orders VALUES (3, 2, 199.99);
  `);
  db.close();
  return path;
}

// ---------------------------------------------------------------------------
// isSafeQuery
// ---------------------------------------------------------------------------
describe('isSafeQuery', () => {
  it('allows SELECT', () => {
    assert.ok(isSafeQuery('SELECT * FROM users').safe);
  });

  it('allows SELECT with JOIN', () => {
    assert.ok(isSafeQuery('SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id').safe);
  });

  it('allows EXPLAIN', () => {
    assert.ok(isSafeQuery('EXPLAIN SELECT * FROM users').safe);
  });

  it('allows WITH (CTE)', () => {
    assert.ok(isSafeQuery('WITH cte AS (SELECT 1) SELECT * FROM cte').safe);
  });

  it('allows PRAGMA table_info', () => {
    assert.ok(isSafeQuery("PRAGMA table_info('users')").safe);
  });

  it('blocks DROP', () => {
    const result = isSafeQuery('DROP TABLE users');
    assert.equal(result.safe, false);
  });

  it('blocks DELETE', () => {
    assert.equal(isSafeQuery('DELETE FROM users').safe, false);
  });

  it('blocks INSERT', () => {
    assert.equal(isSafeQuery('INSERT INTO users VALUES (1)').safe, false);
  });

  it('blocks UPDATE', () => {
    assert.equal(isSafeQuery('UPDATE users SET name=1').safe, false);
  });

  it('blocks ALTER', () => {
    assert.equal(isSafeQuery('ALTER TABLE users ADD COLUMN x').safe, false);
  });

  it('blocks CREATE', () => {
    assert.equal(isSafeQuery('CREATE TABLE test (id INT)').safe, false);
  });

  it('blocks TRUNCATE', () => {
    assert.equal(isSafeQuery('TRUNCATE TABLE users').safe, false);
  });

  it('blocks non-SELECT statements', () => {
    assert.equal(isSafeQuery('BEGIN TRANSACTION').safe, false);
  });

  it('rejects empty query', () => {
    assert.equal(isSafeQuery('').safe, false);
  });
});

// ---------------------------------------------------------------------------
// introspectSQLite
// ---------------------------------------------------------------------------
describe('introspectSQLite', () => {
  let introDbPath;

  before(() => { introDbPath = createTestDB(); });
  after(() => { if (existsSync(introDbPath)) unlinkSync(introDbPath); });

  it('returns tables with columns', () => {
    const result = introspectSQLite(introDbPath);
    assert.ok(result.ok);
    assert.ok(result.tables.length >= 2);

    const users = result.tables.find(t => t.name === 'users');
    assert.ok(users);
    assert.equal(users.columns.length, 3);
    assert.equal(users.rowCount, 2);
  });

  it('returns error for missing file', () => {
    const result = introspectSQLite('/nonexistent/path.db');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });
});

// ---------------------------------------------------------------------------
// querySQLite
// ---------------------------------------------------------------------------
describe('querySQLite', () => {
  let queryDbPath;

  before(() => { queryDbPath = createTestDB(); });
  after(() => { if (existsSync(queryDbPath)) unlinkSync(queryDbPath); });

  it('executes SELECT query', () => {
    const result = querySQLite(queryDbPath, 'SELECT * FROM users');
    assert.ok(result.ok);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.columns, ['id', 'name', 'email']);
  });

  it('executes JOIN query', () => {
    const result = querySQLite(queryDbPath,
      'SELECT u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id');
    assert.ok(result.ok);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].order_count, 2);
  });

  it('blocks unsafe query', () => {
    const result = querySQLite(queryDbPath, 'DROP TABLE users');
    assert.equal(result.ok, false);
  });

  it('returns error for missing file', () => {
    const result = querySQLite('/nonexistent.db', 'SELECT 1');
    assert.equal(result.ok, false);
  });

  it('applies row limit', () => {
    const result = querySQLite(queryDbPath, 'SELECT * FROM users', { limit: 1 });
    assert.ok(result.ok);
    assert.equal(result.rows.length, 1);
    assert.ok(result.truncated);
  });

  it('returns error for SQL syntax error', () => {
    const result = querySQLite(queryDbPath, 'SELECT * FROM nonexistent_table');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Query failed'));
  });
});

// ---------------------------------------------------------------------------
// Plugin integration
// ---------------------------------------------------------------------------
describe('DB plugin integration', () => {
  let plugin, dbPath;

  before(async () => {
    const mod = await import('../src/plugins/standard/db-query.mjs');
    plugin = mod.default;
    dbPath = createTestDB();
  });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('plugin has correct name', () => {
    assert.equal(plugin.name, 'smart_db');
  });

  it('introspect via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'introspect',
      connection: dbPath,
    }));
    assert.ok(result.ok);
    assert.ok(result.tables.length >= 2);
  });

  it('query via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'query',
      connection: dbPath,
      sql: 'SELECT name FROM users ORDER BY id',
    }));
    assert.ok(result.ok);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].name, 'Alice');
  });

  it('blocks unsafe query via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'query',
      connection: dbPath,
      sql: 'DELETE FROM users',
    }));
    assert.equal(result.ok, false);
  });

  it('rejects missing sql for query', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'query',
      connection: dbPath,
    }));
    assert.equal(result.ok, false);
  });

  it('rejects unknown operation', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'invalid',
      connection: dbPath,
    }));
    assert.equal(result.ok, false);
  });
});
