// ckg-engine.test.mjs — Phase 11 CKG Engine tests
//
// Tests ckg-engine.mjs constructor + schema + stats query operations.
// Full LSP-based build is tested in integration tests (slow, ~30s).
// Here we test the engine API and SQLite schema directly.
//
// Run: node --test tests/ckg-engine.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__dirname, '../.test-ckg-' + Date.now());

describe('Phase 11: CKG Engine', () => {
  let ckg;

  before(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const ckgMod = await import('../src/lib/ckg-engine.mjs');
    ckg = ckgMod.getCkgEngine(TEST_DIR);
  });

  after(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  // ── 1. Constructor ──
  it('1.1 creates CKG engine instance', () => {
    assert.ok(ckg, 'should return engine');
    assert.ok(typeof ckg.queryCallers === 'function', 'should have queryCallers');
    assert.ok(typeof ckg.queryCallees === 'function', 'should have queryCallees');
    assert.ok(typeof ckg.getStats === 'function', 'should have getStats');
    assert.ok(typeof ckg.queryDependencies === 'function', 'should have queryDependencies');
  });

  it('1.2 singleton returns same instance', async () => {
    const { getCkgEngine } = await import('../src/lib/ckg-engine.mjs');
    const ckg2 = getCkgEngine(TEST_DIR);
    assert.equal(ckg, ckg2, 'same root returns same instance');
  });

  // ── 2. SQLite schema ──
  it('2.1 getStats on empty CKG returns valid structure', () => {
    const stats = ckg.getStats();
    assert.ok(stats, 'should return stats');
    assert.equal(typeof stats.nodes, 'number', 'nodes is number');
    assert.equal(typeof stats.edges, 'number', 'edges is number');
    assert.equal(typeof stats.files, 'number', 'files is number');
    assert.ok(stats.nodes >= 0, 'nodes >= 0');
    assert.ok(stats.builtAt === null || typeof stats.builtAt === 'string', 
      'builtAt should be null or string');
  });

  it('2.2 queryCallers on empty CKG returns result with empty callers array', () => {
    const callers = ckg.queryCallers('nonexistent', 'foo.ts');
    assert.ok(callers, 'should return result');
    assert.ok(Array.isArray(callers.callers), 'callers key should be array');
    assert.equal(callers.callers.length, 0, 'should be empty');
    assert.equal(callers.totalCallers, 0, 'totalCallers should be 0');
  });

  it('2.3 queryCallees on empty CKG returns result with empty callees array', () => {
    const callees = ckg.queryCallees('nonexistent', 'foo.ts');
    assert.ok(callees, 'should return result');
    assert.ok(Array.isArray(callees.callees), 'callees key should be array');
    assert.equal(callees.callees.length, 0);
  });

  it('2.4 queryDependencies on empty CKG returns empty', () => {
    const deps = ckg.queryDependencies('nonexistent.ts');
    assert.ok(deps, 'should return result');
    assert.ok(deps.imports === undefined || Array.isArray(deps.imports));
  });

  it('2.5 queryUnusedExports on empty CKG returns empty', () => {
    const unused = ckg.queryUnusedExports();
    assert.ok(Array.isArray(unused), 'unused-exports should be an array');
    assert.equal(unused.length, 0, 'empty CKG has no unused exports');
  });

  // ── 3. Get stats on re-init ──
  it('3.1 getStats twice returns consistent data', () => {
    const stats1 = ckg.getStats();
    const stats2 = ckg.getStats();
    assert.equal(stats1.nodes, stats2.nodes, 'stats should be consistent');
    assert.equal(stats1.edges, stats2.edges, 'edges should be consistent');
  });

});
