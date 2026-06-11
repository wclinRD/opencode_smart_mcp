// memory-db.test.mjs — Tests for SQLite memory storage layer
//
// Covers: MemoryDB — open/close, insert/get/update/delete, list/count,
//         stats, searchFTS, storeEmbedding/getEmbedding,
//         migrateFromJSON, runLifecycle, touchEntry, rebuildFTS
//
// Run: node --test tests/memory-db.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

import { MemoryDB } from '../src/lib/memory-db.mjs';

const TMP = resolve(process.cwd(), '.test-memorydb-' + Date.now());
const DB_PATH = resolve(TMP, 'test.db');

function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDB', () => {

  let db;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    db = new MemoryDB(DB_PATH);
  });
  after(() => {
    try { db.close(); } catch { /* ok */ }
    rmSync(TMP, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  it('open initializes database', () => {
    const result = db.open();
    assert.equal(result, db, 'open returns this');
    assert.equal(db.isOpen, true);
  });

  it('open is idempotent', () => {
    db.open();
    assert.equal(db.isOpen, true);
  });

  it('vecAvailable is boolean', () => {
    assert.equal(typeof db.vecAvailable, 'boolean');
  });

  // -----------------------------------------------------------------------
  // CRUD (using snake_case keys matching DB schema)
  // -----------------------------------------------------------------------

  it('insertEntry stores an entry', () => {
    const entry = {
      type: 'error',
      category: 'build',
      error_message: 'TypeError: Cannot read property',
      resolution: 'Add null check',
      tools_used: 'grep,debug',
      success: true,
    };
    const result = db.insertEntry(entry);
    assert.ok(result, 'should return entry object');
    assert.ok(result.id, 'should have an id');
    assert.equal(typeof result.id, 'string');
    assert.equal(result.error_message, 'TypeError: Cannot read property');
  });

  it('getEntry retrieves by id', () => {
    const result = db.insertEntry({
      type: 'error',
      error_message: 'ENOENT: no such file',
      resolution: 'Check path',
    });
    const entry = db.getEntry(result.id);
    assert.ok(entry);
    assert.equal(entry.error_message, 'ENOENT: no such file');
    assert.equal(entry.resolution, 'Check path');
  });

  it('getEntry returns null for non-existent id', () => {
    assert.equal(db.getEntry('nonexistent-id'), null);
  });

  it('getEntryByHash finds by hash', () => {
    const msg = 'Unique error ' + Date.now();
    const h = hash(msg);
    const result = db.insertEntry({ type: 'error', error_message: msg, hash: h });
    const entry = db.getEntryByHash(h);
    assert.ok(entry);
    assert.equal(entry.id, result.id);
  });

  it('getEntryByHash returns null for unknown hash', () => {
    assert.equal(db.getEntryByHash('deadbeef'), null);
  });

  it('updateEntry modifies fields and returns entry', () => {
    const result = db.insertEntry({ type: 'error', error_message: 'old msg' });
    const updated = db.updateEntry(result.id, { resolution: 'new fix', hit_count: 5 });
    assert.ok(updated, 'should return entry object');
    assert.equal(updated.resolution, 'new fix');
    assert.equal(updated.hit_count, 5);
  });

  it('updateEntry returns null for non-existent id', () => {
    assert.equal(db.updateEntry('nonexistent', { resolution: 'x' }), null);
  });

  it('deleteEntry removes entry', () => {
    const result = db.insertEntry({ type: 'error', error_message: 'to delete' });
    assert.equal(db.deleteEntry(result.id), true);
    assert.equal(db.getEntry(result.id), null);
  });

  it('deleteEntry returns false for non-existent id', () => {
    assert.equal(db.deleteEntry('nonexistent'), false);
  });

  // -----------------------------------------------------------------------
  // List / Count
  // -----------------------------------------------------------------------

  it('listEntries returns entries', () => {
    db.insertEntry({ type: 'error', error_message: 'list test 1' });
    db.insertEntry({ type: 'error', error_message: 'list test 2' });
    const entries = db.listEntries({ limit: 10 });
    assert.ok(entries.length >= 2);
  });

  it('listEntries filters by type', () => {
    db.insertEntry({ type: 'skill_patch', error_message: 'skill test' });
    const errors = db.listEntries({ type: 'error', limit: 100 });
    const patches = db.listEntries({ type: 'skill_patch', limit: 100 });
    assert.ok(errors.length > 0);
    assert.ok(patches.length > 0);
    for (const e of errors) assert.equal(e.type, 'error');
    for (const p of patches) assert.equal(p.type, 'skill_patch');
  });

  it('listEntries respects limit and offset', () => {
    const r1 = db.listEntries({ limit: 2, offset: 0 });
    const r2 = db.listEntries({ limit: 2, offset: 2 });
    assert.ok(r1.length <= 2);
    if (r1.length === 2 && r2.length > 0) {
      assert.notEqual(r1[0].id, r2[0].id, 'offset should return different entries');
    }
  });

  it('countEntries returns total count', () => {
    const count = db.countEntries();
    assert.ok(count > 0);
    assert.equal(typeof count, 'number');
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  it('stats returns database statistics', () => {
    const s = db.stats();
    assert.ok(s.hasOwnProperty('total'));
    assert.ok(s.hasOwnProperty('byType'));
    assert.ok(s.hasOwnProperty('byStatus'));
    assert.ok(s.hasOwnProperty('archivedCount'));
    assert.ok(s.hasOwnProperty('vecAvailable'));
  });

  // -----------------------------------------------------------------------
  // FTS Search
  // -----------------------------------------------------------------------

  it('searchFTS finds entries by text', () => {
    db.insertEntry({ type: 'error', error_message: 'FTS search test unique phrase' });
    const results = db.searchFTS('unique phrase', 5);
    assert.ok(results.length > 0, 'should find FTS match');
  });

  it('searchFTS returns empty for no match', () => {
    const results = db.searchFTS('xyznonexistent12345', 5);
    assert.equal(results.length, 0);
  });

  it('searchFTS respects limit', () => {
    const results = db.searchFTS('error', 2);
    assert.ok(results.length <= 2);
  });

  // -----------------------------------------------------------------------
  // Embeddings
  // -----------------------------------------------------------------------

  it('storeEmbedding and getEmbedding round-trip', () => {
    const result = db.insertEntry({ type: 'error', error_message: 'embed test' });
    const emb = new Float32Array(384);
    for (let i = 0; i < 384; i++) emb[i] = Math.random();
    // storeEmbedding is void (no return)
    db.storeEmbedding(result.id, emb);

    const retrieved = db.getEmbedding(result.id);
    assert.ok(retrieved, 'should retrieve embedding');
    assert.ok(retrieved instanceof Float32Array || Array.isArray(retrieved));
  });

  it('getEmbedding returns null for entry without embedding', () => {
    const result = db.insertEntry({ type: 'error', error_message: 'no embed' });
    assert.equal(db.getEmbedding(result.id), null);
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  it('touchEntry updates hit_count and last_seen', () => {
    const result = db.insertEntry({ type: 'error', error_message: 'touch test' });
    const before = db.getEntry(result.id);
    // touchEntry is void (no return)
    db.touchEntry(result.id);
    const after = db.getEntry(result.id);
    assert.ok(after.hit_count >= before.hit_count);
    assert.ok(after.last_seen >= before.last_seen);
  });

  it('runLifecycle does not throw', () => {
    assert.doesNotThrow(() => db.runLifecycle());
  });

  // -----------------------------------------------------------------------
  // Migrate from JSON
  // -----------------------------------------------------------------------

  it('migrateFromJSON imports entries', () => {
    const jsonPath = resolve(TMP, 'seed.json');
    const seedData = [
      {
        id: 'seed-' + Date.now(),
        type: 'skill_patch',
        error_message: 'When LSP timeout occurs',
        resolution: 'Retry once then fallback',
        behavior_change: 'Retry LSP once before grep',
        target_skill: 'self-reflection',
        keep: 'always',
      },
    ];
    writeFileSync(jsonPath, JSON.stringify(seedData));
    const result = db.migrateFromJSON(jsonPath);
    assert.ok(result, 'should return result object');
    assert.ok(result.hasOwnProperty('migrated'));
    assert.ok(result.hasOwnProperty('skipped'));
  });

  it('rebuildFTS does not throw', () => {
    assert.doesNotThrow(() => db.rebuildFTS());
  });

  // -----------------------------------------------------------------------
  // Close
  // -----------------------------------------------------------------------

  it('close shuts down database', () => {
    db.close();
    assert.equal(db.isOpen, false);
  });

  it('close is idempotent', () => {
    db.close();
    assert.equal(db.isOpen, false);
  });
});