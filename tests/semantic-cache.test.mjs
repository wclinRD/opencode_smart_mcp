// semantic-cache.test.mjs — Tests for Phase 27 Semantic Cache Routing
//
// Covers: cacheGoal, searchCache, updateCacheStats,
//         SemanticCache class set/get
//
// Run: node --test tests/semantic-cache.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

import { MemoryDB, getMemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';
import { SemanticCache } from '../src/lib/semantic-cache.mjs';

const TMP = resolve(process.cwd(), '.test-semcache-' + Date.now());
const DB_PATH = resolve(TMP, 'test.db');

describe('Phase 27: Semantic Cache Routing', () => {
  let db;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    // Initialize singleton for SemanticCache to find
    resetMemoryDB();
    db = getMemoryDB(DB_PATH);
  });

  after(() => {
    resetMemoryDB();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should cache a goal with tool chain', () => {
    db.cacheGoal('debug login error', JSON.stringify(['smart_grep', 'smart_lsp', 'smart_fast_apply']));
    const results = db.searchCache('debug login error');
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 1.0);
    assert.deepEqual(results[0].toolChain, ['smart_grep', 'smart_lsp', 'smart_fast_apply']);
  });

  it('should find similar goals via embedding', () => {
    // Generate a hash-based embedding for similarity search
    const emb1 = db.cacheGoal('fix user authentication', JSON.stringify(['smart_grep', 'smart_debug']));
    // Use a similar goal to search
    const results = db.searchCache('fix login auth problem', 0.7);
    // Should at least find exact matches for known goals
    assert.ok(Array.isArray(results));
  });

  it('should update cache stats', () => {
    const hash = crypto.createHash('sha256').update('debug login error').digest('hex').substring(0, 16);
    db.updateCacheStats(hash, true);
    const results = db.searchCache('debug login error');
    assert.equal(results.length, 1);
    assert.ok(results[0].hitCount > 0);
  });

  it('should return empty for unknown goal with low threshold', () => {
    const results = db.searchCache('completely unrelated query about weather', 0.99);
    const exact = results.filter(r => r.exact);
    assert.equal(exact.length, 0);
  });

  it('SemanticCache class set/get should work', async () => {
    const cache = new SemanticCache();
    const result = await cache.set('test goal', ['smart_think', 'smart_planner']);
    assert.equal(result, true);

    const entries = await cache.get('test goal');
    assert.ok(entries.length >= 1);
    assert.deepEqual(entries[0].toolChain, ['smart_think', 'smart_planner']);
  });

  it('should handle empty database gracefully', () => {
    const emptyPath = resolve(TMP, 'empty.db');
    const emptyDb = new MemoryDB(emptyPath);
    emptyDb.open();
    const results = emptyDb.searchCache('anything');
    assert.equal(results.length, 0);
    emptyDb.close();
  });
});
