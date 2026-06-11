// cache-manager.test.mjs — Tests for unified TTL cache
//
// Covers: CacheManager (memory backend): set/get/has/delete/clear/size/stats/
//         getOrSet/makeKey/shutdown/persist
//
// Run: node --test tests/cache-manager.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { CacheManager } from '../src/lib/cache-manager.mjs';

const TMP = resolve(process.cwd(), '.test-cache-' + Date.now());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CacheManager (memory backend)', () => {

  let cache;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    cache = new CacheManager({ backend: 'memory' });
  });
  after(() => {
    cache.shutdown();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('set and get a value', () => {
    cache.set('key1', 'value1');
    assert.equal(cache.get('key1'), 'value1');
  });

  it('get returns undefined for missing key', () => {
    assert.equal(cache.get('nonexistent'), undefined);
  });

  it('has returns true for existing key', () => {
    cache.set('key2', 'value2');
    assert.equal(cache.has('key2'), true);
  });

  it('has returns false for missing key', () => {
    assert.equal(cache.has('nonexistent'), false);
  });

  it('delete removes key', () => {
    cache.set('key3', 'value3');
    assert.equal(cache.delete('key3'), true);
    assert.equal(cache.get('key3'), undefined);
  });

  it('delete returns false for missing key', () => {
    assert.equal(cache.delete('nonexistent'), false);
  });

  it('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), undefined);
  });

  it('size reports correct count', () => {
    cache.clear();
    assert.equal(cache.size, 0);
    cache.set('x', 1);
    cache.set('y', 2);
    assert.equal(cache.size, 2);
  });

  it('set supports method chaining', () => {
    const c = new CacheManager({ backend: 'memory' });
    const r = c.set('chain', 'test');
    assert.equal(r, c);
    c.shutdown();
  });

  it('set with custom TTL', async () => {
    const c = new CacheManager({ backend: 'memory', ttlMs: 100 });
    c.set('short', 'lived', 50); // 50ms TTL
    assert.equal(c.get('short'), 'lived');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(c.get('short'), undefined, 'should expire after 50ms');
    c.shutdown();
  });

  it('default TTL is used when no per-key TTL', async () => {
    const c = new CacheManager({ backend: 'memory', ttlMs: 50 });
    c.set('def', 'val');
    assert.equal(c.get('def'), 'val');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(c.get('def'), undefined);
    c.shutdown();
  });

  it('stats reports hit/miss/eviction counts', () => {
    const c = new CacheManager({ backend: 'memory' });
    c.set('s1', 'v1');
    c.get('s1'); // hit
    c.get('missing'); // miss
    const s = c.stats();
    assert.equal(s.backend, 'memory');
    assert.ok(s.hits >= 1);
    assert.ok(s.misses >= 1);
    assert.ok(s.hitRate);
    assert.equal(s.ttlMs, 300000); // default 5 min
    c.shutdown();
  });

  it('getOrSet returns cached value', async () => {
    const c = new CacheManager({ backend: 'memory' });
    c.set('gs', 'cached');
    let factoryCalled = false;
    const val = await c.getOrSet('gs', async () => { factoryCalled = true; return 'new'; });
    assert.equal(val, 'cached');
    assert.equal(factoryCalled, false);
    c.shutdown();
  });

  it('getOrSet calls factory on miss', async () => {
    const c = new CacheManager({ backend: 'memory' });
    const val = await c.getOrSet('newkey', async () => 'computed');
    assert.equal(val, 'computed');
    assert.equal(c.get('newkey'), 'computed');
    c.shutdown();
  });

  it('makeKey produces deterministic keys', () => {
    const c = new CacheManager({ backend: 'memory' });
    const k1 = c.makeKey('a', 'b');
    const k2 = c.makeKey('a', 'b');
    assert.equal(k1, k2);
    assert.equal(k1.length, 16);
    c.shutdown();
  });

  it('makeKey produces different keys for different args', () => {
    const c = new CacheManager({ backend: 'memory' });
    const k1 = c.makeKey('a', 'b');
    const k2 = c.makeKey('a', 'c');
    assert.notEqual(k1, k2);
    c.shutdown();
  });

  it('makeKey normalizes object key order', () => {
    const c = new CacheManager({ backend: 'memory' });
    const k1 = c.makeKey({ b: 2, a: 1 });
    const k2 = c.makeKey({ a: 1, b: 2 });
    assert.equal(k1, k2, 'object key order should not matter');
    c.shutdown();
  });

  it('persist writes to disk and loads back', () => {
    const persistPath = resolve(TMP, 'cache.json');
    const c = new CacheManager({ backend: 'memory', persistPath });
    c.set('p1', 'v1');
    c.set('p2', 'v2');
    c.persist();
    assert.ok(existsSync(persistPath), 'persist file should exist');

    // Load into new instance
    const c2 = new CacheManager({ backend: 'memory', persistPath });
    assert.equal(c2.get('p1'), 'v1');
    assert.equal(c2.get('p2'), 'v2');
    c.shutdown();
    c2.shutdown();
  });

  it('shutdown persists if persistPath set', () => {
    const persistPath = resolve(TMP, 'shutdown-cache.json');
    const c = new CacheManager({ backend: 'memory', persistPath });
    c.set('sd', 'val');
    c.shutdown();
    assert.ok(existsSync(persistPath));
  });
});