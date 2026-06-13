// prefetch.test.mjs — Phase 18 tests for prefetch-engine.mjs
//
// Tests:
//   - Pre-fetch rule triggering (5 rules)
//   - Cache hit/miss/expiry
//   - Fire-and-forget (non-blocking)
//   - Recursion guard (no recursive pre-fetch)
//   - Stats tracking
//
// Run: node --test tests/prefetch.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrefetchEngine, getPrefetchEngine, resetPrefetchEngine } from '../src/lib/prefetch-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockInvokeFn(toolName, args) {
  return Promise.resolve({ ok: true, output: `Mock result for ${toolName}` });
}

function mockInvokeFnFail(toolName, args) {
  return Promise.resolve({ ok: false, error: 'Mock error' });
}

// ---------------------------------------------------------------------------
// Tests: PrefetchEngine — Cache operations
// ---------------------------------------------------------------------------

describe('PrefetchEngine — Cache operations', () => {

  it('starts with empty cache', () => {
    const engine = new PrefetchEngine();
    const stats = engine.getStats();
    assert.equal(stats.cacheSize, 0);
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
  });

  it('checkCache returns miss for unknown tool', () => {
    const engine = new PrefetchEngine();
    const result = engine.checkCache('smart_grep', { pattern: 'test' });
    assert.equal(result.hit, false);
  });

  it('checkCache returns hit after triggerAfter + invoke', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    // Simulate: smart_learn succeeds → pre-fetch smart_import_graph
    const result = { ok: true, output: 'Learned project structure' };
    engine.triggerAfter('smart_learn', { root: '.' }, result, mockInvokeFn);

    // Wait for async pre-fetch to complete
    await new Promise(r => setTimeout(r, 100));

    // Check cache for the pre-fetched tool
    const hit = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit.hit, true);
    assert.ok(hit.result);
    assert.equal(hit.result.ok, true);
  });

  it('cache entry is consumed after hit (single-use)', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    // First hit — should succeed
    const hit1 = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit1.hit, true);

    // Second hit — should miss (entry consumed)
    const hit2 = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit2.hit, false);
  });

  it('cache entry expires after TTL', async () => {
    const engine = new PrefetchEngine({ defaultTtl: 50 }); // 50ms TTL

    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 30));

    // Should still be valid
    const hit1 = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit1.hit, true);

    // Wait for expiry
    await new Promise(r => setTimeout(r, 40));

    // Should be expired
    const hit2 = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit2.hit, false);
  });

  it('failed pre-fetch result is not cached', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFnFail);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit.hit, false);
  });
});

// ---------------------------------------------------------------------------
// Tests: PrefetchEngine — Rule triggering
// ---------------------------------------------------------------------------

describe('PrefetchEngine — Rule triggering', () => {

  it('smart_grep triggers smart_lsp hover pre-fetch', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    const grepResult = {
      ok: true,
      output: 'src/auth.ts:142: function parseToken() {',
    };
    engine.triggerAfter('smart_grep', { pattern: 'parseToken', root: 'src/' }, grepResult, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_lsp', {
      operation: 'hover',
      file: 'src/auth.ts',
      line: 142,
      character: 0,
      root: 'src/',
    });
    assert.equal(hit.hit, true);
  });

  it('smart_grep without file:line match skips pre-fetch', () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    const grepResult = {
      ok: true,
      output: 'No matches found.',
    };
    engine.triggerAfter('smart_grep', { pattern: 'nonexistent' }, grepResult, mockInvokeFn);

    const stats = engine.getStats();
    assert.equal(stats.triggered, 0);
    assert.equal(stats.skipped, 1);
  });

  it('smart_think triggers memory_store search pre-fetch', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_think', {
      thought: 'Analyzing the null pointer crash in auth module',
      mode: 'cit',
    }, { ok: true, output: '...' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_memory_store', {
      command: 'search',
      query: 'Analyzing the null pointer crash in auth module',
    });
    assert.equal(hit.hit, true);
  });

  it('smart_think with short thought skips pre-fetch', () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_think', {
      thought: 'OK',
    }, { ok: true, output: '...' }, mockInvokeFn);

    const stats = engine.getStats();
    assert.equal(stats.triggered, 0);
  });

  it('smart_security triggers smart_grep pre-fetch', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    const secResult = {
      ok: true,
      output: 'File: src/auth.ts — Credential leak found\nFile: src/config.ts — Hardcoded secret',
    };
    engine.triggerAfter('smart_security', { scan: 'all', root: '.' }, secResult, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_grep', {
      pattern: 'TODO|FIXME|HACK|XXX',
      root: '.',
    });
    assert.equal(hit.hit, true);
  });

  it('smart_learn triggers import_graph pre-fetch', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_learn', { root: 'src/' }, { ok: true, output: '...' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_import_graph', { root: 'src/' });
    assert.equal(hit.hit, true);
  });

  it('smart_error_diagnose triggers smart_lsp diagnostics pre-fetch', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    const diagResult = {
      ok: true,
      output: 'Error in src/auth.ts: null pointer at line 142',
    };
    engine.triggerAfter('smart_error_diagnose', { error: 'null pointer' }, diagResult, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const hit = engine.checkCache('smart_lsp', {
      operation: 'diagnostics',
      file: 'src/auth.ts',
    });
    assert.equal(hit.hit, true);
  });

  it('unknown tool does not trigger any pre-fetch', () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_test', { root: '.' }, { ok: true, output: '...' }, mockInvokeFn);

    const stats = engine.getStats();
    assert.equal(stats.triggered, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: PrefetchEngine — Stats tracking
// ---------------------------------------------------------------------------

describe('PrefetchEngine — Stats tracking', () => {

  it('tracks hits, misses, triggered, skipped', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    // Trigger a pre-fetch
    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    // Hit
    engine.checkCache('smart_import_graph', { root: '.' });
    // Miss (consumed)
    engine.checkCache('smart_import_graph', { root: '.' });
    // Miss (unknown)
    engine.checkCache('smart_nonexistent', {});

    const stats = engine.getStats();
    assert.equal(stats.triggered, 1);
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 2);
    assert.ok(stats.hitRate);
  });

  it('resetStats clears all counters', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));
    engine.checkCache('smart_import_graph', { root: '.' });

    engine.resetStats();
    const stats = engine.getStats();
    assert.equal(stats.triggered, 0);
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
  });

  it('clearCache removes all cached entries', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    engine.clearCache();
    const hit = engine.checkCache('smart_import_graph', { root: '.' });
    assert.equal(hit.hit, false);
  });
});

// ---------------------------------------------------------------------------
// Tests: PrefetchEngine — Recursion guard
// ---------------------------------------------------------------------------

describe('PrefetchEngine — Recursion guard', () => {

  it('pre-fetch results do not trigger further pre-fetches', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    // smart_learn triggers import_graph
    // import_graph should NOT trigger further pre-fetches (recursion guard)
    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const stats = engine.getStats();
    // Only 1 pre-fetch triggered (from smart_learn), not from import_graph
    assert.equal(stats.triggered, 1);
  });

  it('duplicate pre-fetch for same key is deduplicated', async () => {
    resetPrefetchEngine();
    const engine = getPrefetchEngine();

    // Trigger same pre-fetch twice
    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    engine.triggerAfter('smart_learn', { root: '.' }, { ok: true, output: 'x' }, mockInvokeFn);
    await new Promise(r => setTimeout(r, 100));

    const stats = engine.getStats();
    // Only 1 triggered (second was deduped)
    assert.equal(stats.triggered, 1);
  });
});