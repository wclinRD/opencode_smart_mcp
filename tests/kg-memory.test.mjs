// kg-memory.test.mjs — Phase 16: Knowledge Graph Memory tests
//
// Tests: createEntities, createRelations, searchNodes, openNodes, readGraph,
//   deleteEntities, deleteObservations, deleteRelations, addObservations,
//   plugin integration, migration

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

// Dynamic imports
const { MemoryDB, resetMemoryDB } = await import('../src/lib/memory-db.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tmpDBPath() {
  return resolve(tmpdir(), `kg-test-${randomUUID()}.db`);
}

function createTestDB() {
  const path = tmpDBPath();
  const db = new MemoryDB(path);
  db.open();
  return { db, path };
}

// ---------------------------------------------------------------------------
// Core KG CRUD
// ---------------------------------------------------------------------------
describe('KG: createEntities', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; path = t.path;
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('creates entities', () => {
    const result = db.createEntities([
      { name: 'auth_module', type: 'module', observations: ['handles login', 'uses JWT'] },
      { name: 'db_module', type: 'module', observations: ['PostgreSQL', 'connection pool'] },
    ]);
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 0);
  });

  it('skips duplicate entities', () => {
    const result = db.createEntities([
      { name: 'auth_module', type: 'module', observations: ['different'] },
    ]);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
  });

  it('counts entities correctly', () => {
    assert.equal(db.countEntities(), 2);
  });
});

describe('KG: createRelations', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module' },
      { name: 'db_module', type: 'module' },
      { name: 'cache_module', type: 'module' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('creates relations', () => {
    const result = db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
      { from: 'auth_module', to: 'cache_module', relationType: 'uses' },
    ]);
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 0);
  });

  it('skips duplicate relations', () => {
    const result = db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
    ]);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
  });

  it('counts relations correctly', () => {
    assert.equal(db.countRelations(), 2);
  });
});

describe('KG: searchNodes', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module', observations: ['handles login', 'JWT tokens'] },
      { name: 'db_module', type: 'module', observations: ['PostgreSQL 15'] },
      { name: 'John_Smith', type: 'person', observations: ['backend developer', 'works on auth'] },
    ]);
    db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
      { from: 'John_Smith', to: 'auth_module', relationType: 'maintains' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('searches by name', () => {
    const nodes = db.searchNodes('auth_module');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'auth_module');
  });

  it('searches by type', () => {
    const nodes = db.searchNodes('person');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'John_Smith');
  });

  it('searches by observation', () => {
    const nodes = db.searchNodes('PostgreSQL');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'db_module');
  });

  it('returns relations with search results', () => {
    const nodes = db.searchNodes('auth_module');
    assert.ok(nodes[0].relations.length >= 2);
  });

  it('respects limit', () => {
    const nodes = db.searchNodes('module', 1);
    assert.equal(nodes.length, 1);
  });

  it('returns empty for no match', () => {
    const nodes = db.searchNodes('nonexistent_xyz');
    assert.equal(nodes.length, 0);
  });
});

describe('KG: openNodes', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module' },
      { name: 'db_module', type: 'module' },
      { name: 'cache_module', type: 'module' },
    ]);
    db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
      { from: 'auth_module', to: 'cache_module', relationType: 'uses' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('opens specific nodes', () => {
    const result = db.openNodes(['auth_module', 'db_module']);
    assert.equal(result.entities.length, 2);
    assert.ok(result.relations.length >= 1);
  });

  it('returns inter-relations only', () => {
    const result = db.openNodes(['auth_module', 'db_module']);
    for (const r of result.relations) {
      assert.ok(['auth_module', 'db_module'].includes(r.from));
      assert.ok(['auth_module', 'db_module'].includes(r.to));
    }
  });

  it('handles empty names', () => {
    const result = db.openNodes([]);
    assert.equal(result.entities.length, 0);
    assert.equal(result.relations.length, 0);
  });

  it('silently skips non-existent nodes', () => {
    const result = db.openNodes(['auth_module', 'nonexistent']);
    assert.equal(result.entities.length, 1);
  });
});

describe('KG: readGraph', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module' },
      { name: 'db_module', type: 'module' },
    ]);
    db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('reads entire graph', () => {
    const result = db.readGraph();
    assert.equal(result.entities.length, 2);
    assert.equal(result.relations.length, 1);
  });
});

describe('KG: deleteEntities', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module' },
      { name: 'db_module', type: 'module' },
    ]);
    db.createRelations([
      { from: 'auth_module', to: 'db_module', relationType: 'depends_on' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('deletes entities and cascades relations', () => {
    const result = db.deleteEntities(['auth_module']);
    assert.equal(result.deleted, 1);
    assert.equal(db.countEntities(), 1);
    assert.equal(db.countRelations(), 0); // cascade
  });

  it('handles empty names', () => {
    const result = db.deleteEntities([]);
    assert.equal(result.deleted, 0);
  });
});

describe('KG: observations management', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'auth_module', type: 'module', observations: ['handles login', 'uses JWT', 'rate limited'] },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('deletes specific observations', () => {
    const result = db.deleteObservations('auth_module', ['uses JWT']);
    assert.equal(result.removed, 1);

    const nodes = db.searchNodes('auth_module');
    assert.ok(!nodes[0].observations.includes('uses JWT'));
    assert.ok(nodes[0].observations.includes('handles login'));
  });

  it('adds observations', () => {
    const result = db.addObservations('auth_module', ['supports OAuth2', 'handles login']);
    assert.equal(result.added, 1); // 'handles login' already exists

    const nodes = db.searchNodes('auth_module');
    assert.ok(nodes[0].observations.includes('supports OAuth2'));
  });

  it('returns 0 for non-existent entity', () => {
    assert.equal(db.deleteObservations('nonexistent', ['test']).removed, 0);
    assert.equal(db.addObservations('nonexistent', ['test']).added, 0);
  });
});

describe('KG: deleteRelations', () => {
  let db, path;

  before(() => {
    const t = createTestDB();
    db = t.db; t.path = path;
    db.createEntities([
      { name: 'A', type: 'test' },
      { name: 'B', type: 'test' },
    ]);
    db.createRelations([
      { from: 'A', to: 'B', relationType: 'connects_to' },
    ]);
  });
  after(() => {
    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('deletes specific relations', () => {
    const result = db.deleteRelations([
      { from: 'A', to: 'B', relationType: 'connects_to' },
    ]);
    assert.equal(result.deleted, 1);
    assert.equal(db.countRelations(), 0);
  });
});

// ---------------------------------------------------------------------------
// Plugin integration
// ---------------------------------------------------------------------------
describe('KG: plugin integration', () => {
  let plugin, db, path;

  before(async () => {
    const mod = await import('../src/plugins/standard/kg.mjs');
    plugin = mod.default;
    const t = createTestDB();
    db = t.db; path = t.path;
    // Close the test DB so plugin can open its own singleton
    db.close();
    resetMemoryDB();
  });
  after(() => {
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });

  it('plugin has correct name', () => {
    assert.equal(plugin.name, 'smart_kg');
  });

  it('plugin has handler', () => {
    assert.equal(typeof plugin.handler, 'function');
  });

  it('create_entities via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'create_entities',
      _dbPath: path,
      entities: [
        { name: 'test_module', type: 'module', observations: ['test obs'] },
      ],
    }));
    assert.ok(result.ok);
    assert.equal(result.created, 1);
  });

  it('search_nodes via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'search_nodes',
      _dbPath: path,
      query: 'test_module',
    }));
    assert.ok(result.ok);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].name, 'test_module');
  });

  it('read_graph via plugin', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'read_graph',
      _dbPath: path,
    }));
    assert.ok(result.ok);
    assert.ok(result.entityCount >= 1);
  });

  it('rejects unknown operation', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'invalid_op',
      _dbPath: path,
    }));
    assert.equal(result.ok, false);
  });

  it('rejects missing required params', async () => {
    const result = JSON.parse(await plugin.handler({
      operation: 'create_entities',
      _dbPath: path,
    }));
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Migration: existing DB gets KG tables
// ---------------------------------------------------------------------------
describe('KG: schema migration', () => {
  it('adds KG tables to existing DB on open', () => {
    const path = tmpDBPath();
    const db = new MemoryDB(path);
    db.open();

    // KG tables should exist after open()
    const entities = db.countEntities();
    assert.equal(entities, 0); // empty but table exists

    // Should be able to create entities
    db.createEntities([{ name: 'test', type: 'test' }]);
    assert.equal(db.countEntities(), 1);

    db.close();
    resetMemoryDB();
    if (existsSync(path)) unlinkSync(path);
  });
});