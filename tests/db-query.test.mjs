// db-query.test.mjs — Phase 17: Database Query tests
//
// Tests: isSafeQuery, introspectSQLite, querySQLite, plugin integration

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync, readdirSync, rmdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

// Dynamic imports
const {
  isSafeQuery, introspectSQLite, querySQLite,
  writeSQLite, updateSQLite, deleteSQLite, dryRunSQLite,
  getFullSchemaSQLite, diffSchema,
  createMigrationSQLite, migrateUpSQLite, migrateDownSQLite, migrateStatusSQLite,
} = await import('../src/lib/db-query.mjs');

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

// =========================================================================
// writeSQLite
// =========================================================================
describe('writeSQLite', () => {
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('inserts a row', () => {
    const result = writeSQLite(dbPath, 'users', { name: 'Charlie', email: 'charlie@test.com' });
    assert.ok(result.ok);
    assert.equal(result.inserted, 1);
    assert.ok(result.id > 0);

    // Verify
    const check = querySQLite(dbPath, `SELECT * FROM users WHERE id = ${result.id}`);
    assert.ok(check.ok);
    assert.equal(check.rows[0].name, 'Charlie');
  });

  it('rejects invalid data type', () => {
    const result = writeSQLite(dbPath, 'users', { name: ['array'] });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Invalid type'));
  });

  it('rejects missing file', () => {
    const result = writeSQLite('/nonexistent/test.db', 'users', { name: 'x' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });
});

// =========================================================================
// updateSQLite
// =========================================================================
describe('updateSQLite', () => {
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('updates a row', () => {
    const result = updateSQLite(dbPath, 'users', { name: 'Alice Updated' }, { id: 1 });
    assert.ok(result.ok);
    assert.equal(result.updated, 1);

    const check = querySQLite(dbPath, "SELECT name FROM users WHERE id = 1");
    assert.equal(check.rows[0].name, 'Alice Updated');
  });

  it('rejects missing where', () => {
    const result = updateSQLite(dbPath, 'users', { name: 'x' }, {});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('where'));
  });

  it('rejects invalid data', () => {
    const result = updateSQLite(dbPath, 'users', null, { id: 1 });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('data'));
  });
});

// =========================================================================
// deleteSQLite
// =========================================================================
describe('deleteSQLite', () => {
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('deletes a specific row', () => {
    const result = deleteSQLite(dbPath, 'users', { id: 2 });
    assert.ok(result.ok);
    assert.equal(result.deleted, 1);

    const check = querySQLite(dbPath, 'SELECT * FROM users');
    assert.equal(check.rows.length, 1);
    assert.equal(check.rows[0].name, 'Alice');
  });

  it('rejects null where', () => {
    const result = deleteSQLite(dbPath, 'users', null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('where'));
  });
});

// =========================================================================
// dryRunSQLite
// =========================================================================
describe('dryRunSQLite', () => {
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('dry-runs insert', () => {
    const result = dryRunSQLite('insert', dbPath, 'users', { name: 'Dry', email: 'dry@test.com' });
    assert.ok(result.ok);
    assert.equal(result.sql, 'INSERT INTO "users" ("name", "email") VALUES (?, ?)');
    assert.equal(result.estimatedRows, 1);
  });

  it('dry-runs update', () => {
    const result = dryRunSQLite('update', dbPath, 'users', { name: 'X' }, { id: 1 });
    assert.ok(result.ok);
    assert.ok(result.sql.includes('UPDATE'));
    assert.equal(result.estimatedRows, 1);
  });

  it('dry-runs delete', () => {
    const result = dryRunSQLite('delete', dbPath, 'users', {}, { id: 1 });
    assert.ok(result.ok);
    assert.ok(result.sql.includes('DELETE'));
    assert.equal(result.estimatedRows, 1);
  });

  it('dry-run does not modify DB', () => {
    const before = querySQLite(dbPath, 'SELECT * FROM users');
    dryRunSQLite('delete', dbPath, 'users', {}, {});
    const after = querySQLite(dbPath, 'SELECT * FROM users');
    assert.equal(after.rows.length, before.rows.length);
  });
});

// =========================================================================
// getFullSchemaSQLite + diffSchema
// =========================================================================
describe('getFullSchemaSQLite', () => {
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('returns full schema with columns and indexes', () => {
    const result = getFullSchemaSQLite(dbPath);
    assert.ok(result.ok);
    assert.ok(result.schema.length >= 2);

    const users = result.schema.find(t => t.name === 'users');
    assert.ok(users);
    assert.ok(users.columns.length >= 3);
    assert.ok(users.columns.some(c => c.name === 'id' && c.primaryKey));
  });

  it('returns error for missing file', () => {
    const result = getFullSchemaSQLite('/nonexistent.db');
    assert.equal(result.ok, false);
  });
});

describe('diffSchema', () => {
  it('detects added table', () => {
    const schemaA = [{ name: 'users', columns: [{ name: 'id', type: 'INTEGER' }], indexes: [] }];
    const schemaB = [
      { name: 'users', columns: [{ name: 'id', type: 'INTEGER' }], indexes: [] },
      { name: 'orders', columns: [{ name: 'id', type: 'INTEGER' }], indexes: [] },
    ];
    const result = diffSchema(schemaA, schemaB);
    assert.ok(result.ok);
    assert.equal(result.changeCount, 1);
    assert.equal(result.diff[0].type, 'added');
    assert.equal(result.diff[0].table, 'orders');
  });

  it('detects removed table', () => {
    const schemaA = [
      { name: 'users', columns: [], indexes: [] },
      { name: 'orders', columns: [], indexes: [] },
    ];
    const schemaB = [{ name: 'users', columns: [], indexes: [] }];
    const result = diffSchema(schemaA, schemaB);
    assert.ok(result.ok);
    assert.equal(result.changeCount, 1);
    assert.equal(result.diff[0].type, 'removed');
  });

  it('detects column type change', () => {
    const schemaA = [{ name: 'users', columns: [{ name: 'id', type: 'INTEGER', nullable: false, primaryKey: true }], indexes: [] }];
    const schemaB = [{ name: 'users', columns: [{ name: 'id', type: 'TEXT', nullable: false, primaryKey: true }], indexes: [] }];
    const result = diffSchema(schemaA, schemaB);
    assert.ok(result.ok);
    assert.equal(result.changeCount, 1);
    assert.equal(result.diff[0].type, 'modified');
  });
});

// =========================================================================
// Migration: createMigrationSQLite
// =========================================================================
describe('createMigrationSQLite', () => {
  const migDir = resolve(tmpdir(), `mig-test-${randomUUID()}`);
  let dbPath;

  before(() => { dbPath = createTestDB(); });
  after(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    // Cleanup migration dir
    if (existsSync(migDir)) {
      const files = readdirSync(migDir);
      for (const f of files) unlinkSync(join(migDir, f));
      rmdirSync(migDir);
    }
  });

  it('creates a migration template file', () => {
    const result = createMigrationSQLite(dbPath, 'test_migration', migDir);
    assert.ok(result.ok);
    assert.ok(result.file);
    assert.ok(existsSync(result.file));

    const content = readFileSync(result.file, 'utf-8');
    assert.ok(content.includes('-- up'));
    assert.ok(content.includes('-- down'));
    assert.ok(content.includes('test_migration'));
  });
});

// =========================================================================
// Migration: migrateUpSQLite / migrateDownSQLite / migrateStatusSQLite
// =========================================================================
describe('Migration lifecycle', () => {
  const migDir = resolve(tmpdir(), `mig-lifecycle-${randomUUID()}`);
  let dbPath;

  before(() => {
    dbPath = createTestDB();
    mkdirSync(migDir, { recursive: true });

    // Create a migration file with real SQL
    const migFile = join(migDir, '20260101_000000_add_age.sql');
    writeFileSync(migFile, `-- Migration: add_age

-- up
ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0;

-- down
ALTER TABLE users DROP COLUMN age;
`, 'utf-8');
  });

  after(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(migDir)) {
      const files = readdirSync(migDir);
      for (const f of files) unlinkSync(join(migDir, f));
      rmdirSync(migDir);
    }
  });

  it('migrate status shows pending', () => {
    const result = migrateStatusSQLite(dbPath, migDir);
    assert.ok(result.ok);
    assert.ok(result.status.some(s => s.status === 'pending'));
  });

  it('migrate up applies migration', () => {
    const result = migrateUpSQLite(dbPath, migDir);
    assert.ok(result.ok);
    assert.ok(result.applied.includes('20260101_000000_add_age'));

    // Verify column was added
    const schema = getFullSchemaSQLite(dbPath);
    const users = schema.schema.find(t => t.name === 'users');
    assert.ok(users.columns.some(c => c.name === 'age'));
  });

  it('migrate status shows applied', () => {
    const result = migrateStatusSQLite(dbPath, migDir);
    assert.ok(result.ok);
    const entry = result.status.find(s => s.name === '20260101_000000_add_age');
    assert.ok(entry);
    assert.equal(entry.status, 'applied');
  });

  it('migrate down rolls back', () => {
    const result = migrateDownSQLite(dbPath, 1, migDir);
    assert.ok(result.ok);
    assert.ok(result.rolledBack.includes('20260101_000000_add_age'));

    const schema = getFullSchemaSQLite(dbPath);
    const users = schema.schema.find(t => t.name === 'users');
    assert.equal(users.columns.some(c => c.name === 'age'), false);
  });
});

// =========================================================================
// Plugin integration — new operations
// =========================================================================
describe('DB plugin new operations', () => {
  let plugin, dbPath;

  before(async () => {
    const mod = await import('../src/plugins/standard/db-query.mjs');
    plugin = mod.default;
    dbPath = createTestDB();
  });
  after(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('write via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'write',
      connection: dbPath,
      table: 'users',
      data: { name: 'Plugin', email: 'plugin@test.com' },
    }));
    assert.ok(result.ok);
    assert.equal(result.inserted, 1);
  });

  it('update via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'update',
      connection: dbPath,
      table: 'users',
      data: { name: 'Updated' },
      where: { name: 'Plugin' },
    }));
    assert.ok(result.ok);
    assert.equal(result.updated, 1);
  });

  it('delete via plugin', async () => {
    // First insert
    await plugin.handler({
      operation: 'write',
      connection: dbPath,
      table: 'users',
      data: { name: 'DeleteMe', email: 'del@test.com' },
    });

    const result = JSON.parse(await plugin.handler({
      operation: 'delete',
      connection: dbPath,
      table: 'users',
      where: { name: 'DeleteMe' },
      confirm: true,
    }));
    assert.ok(result.ok);
    assert.equal(result.deleted, 1);
  });

  it('delete requires confirm via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'delete',
      connection: dbPath,
      table: 'users',
      where: { id: 1 },
    }));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('confirm'));
  });

  it('schema-diff via plugin', async () => {
    // Create a second DB with a different schema
    const dbPath2 = resolve(tmpdir(), `db-diff-${randomUUID()}.db`);
    const db2 = new Database(dbPath2);
    db2.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    db2.close();

    try {
      const result = JSON.parse(await plugin.handler({
        operation: 'schema-diff',
        connection: dbPath,
        connection2: dbPath2,
      }));
      assert.ok(result.ok);
      // products table is in db2 but not db1
      assert.ok(result.diff.some(d => d.type === 'added' && d.table === 'products'));
    } finally {
      if (existsSync(dbPath2)) unlinkSync(dbPath2);
    }
  });

  it('migrate status via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'migrate',
      connection: dbPath,
      command: 'status',
    }));
    assert.ok(result.ok);
    // No migrations dir, so empty status
    assert.ok(result.status.length >= 0);
  });

  it('dry-run write via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'write',
      connection: dbPath,
      table: 'users',
      data: { name: 'DryRun', email: 'dry@test.com' },
      dryRun: true,
    }));
    assert.ok(result.ok);
    assert.ok(result.sql.includes('INSERT'));
  });
});
