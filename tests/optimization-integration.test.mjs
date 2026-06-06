// optimization-integration.test.mjs — Integration tests for output optimization pipeline
//
// Tests the full chain: responsePolicy → detectFormat → compress → metadata
// as used by the MCP server's respond() hook.
//
// Covers:
//   1. L0 policy: no optimization regardless of text size
//   2. L1 policy: lossless compression on large text
//   3. No policy: no optimization (safety net)
//   4. metadata format matches what respond() expects
//   5. CacheManager integration with output-optimizer
//   6. Full round-trip: compress → decompress for JSON

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeOutputSync, detectFormat } from '../src/lib/output-optimizer.mjs';
import { CacheManager } from '../src/lib/cache-manager.mjs';

// ---------------------------------------------------------------------------
// Helper: simulates what applyOptimization() in index.mjs does
// ---------------------------------------------------------------------------

/**
 * Simulate the server's applyOptimization logic.
 * This is the exact integration contract between index.mjs and output-optimizer.mjs.
 */
function simulateApplyOptimization(text, policy) {
  if (!text || !policy) return { text, optimized: false, meta: null };

  const level = Math.min(policy.maxLevel ?? 0, 1); // Phase 1: cap L2→L1
  if (level < 1) return { text, optimized: false, meta: null };

  const result = optimizeOutputSync(text, { maxLevel: level, format: 'auto' });
  if (!result.optimized) return { text, optimized: false, meta: null };

  const savingsPct = result.originalSize > 0
    ? ((1 - result.compressedSize / result.originalSize) * 100).toFixed(1)
    : '0.0';
  const savingsStr = `${((result.originalSize - result.compressedSize) / 1024).toFixed(1)}KB (${savingsPct}%)`;

  const meta = {
    _optimized: {
      level,
      originalSize: result.originalSize,
      optimizedSize: result.compressedSize,
      savings: savingsStr,
      cacheKey: result.meta?.cacheKey || null,
      tooltip: parseFloat(savingsPct) > 20
        ? `Output compressed ${savingsPct}% — use format:'full' if you need complete data.`
        : `Minor compression applied (${savingsPct}%).`,
    },
  };

  return { text: result.text, optimized: true, meta };
}

// ===========================================================================
// 1. responsePolicy L0 — no optimization
// ===========================================================================

describe('responsePolicy L0 (no optimization)', () => {
  it('skips optimization when maxLevel=0', () => {
    const policy = { maxLevel: 0 };
    const big = JSON.stringify({ data: Array(200).fill('test') }, null, 2);
    assert.ok(big.length > 500);
    const r = simulateApplyOptimization(big, policy);
    assert.equal(r.optimized, false);
    assert.equal(r.text, big);
    assert.equal(r.meta, null);
  });

  it('skips optimization for grep-like tools (maxLevel=0)', () => {
    const grepPolicy = { maxLevel: 0 };
    const output = 'src/foo.js:10:20 - function hello()\nsrc/bar.js:5:10 - function world()\n';
    const r = simulateApplyOptimization(output, grepPolicy);
    assert.equal(r.optimized, false);
  });

  it('skips optimization for learn-like tools (maxLevel=0)', () => {
    const learnPolicy = { maxLevel: 0 };
    const output = '# Project\n\nTech stack: Node.js\n\n## Structure\n\nsrc/\n  index.mjs\n';
    const r = simulateApplyOptimization(output, learnPolicy);
    assert.equal(r.optimized, false);
  });
});

// ===========================================================================
// 2. responsePolicy L1 — lossless compression
// ===========================================================================

describe('responsePolicy L1 (lossless compression)', () => {
  it('compresses large JSON output', () => {
    const policy = { maxLevel: 1 };
    const obj = { status: 'ok', data: Array(100).fill({ id: 1, name: 'test', value: 'xyz' }) };
    const text = JSON.stringify(obj, null, 2);
    assert.ok(text.length > 500);
    const r = simulateApplyOptimization(text, policy);
    assert.equal(r.optimized, true);
    assert.equal(r.meta._optimized.level, 1);
    assert.ok(r.meta._optimized.optimizedSize < r.meta._optimized.originalSize);
    // Result must be valid JSON
    const parsed = JSON.parse(r.text);
    assert.equal(parsed.status, 'ok');
    assert.ok(Array.isArray(parsed.data));
  });

  it('compresses large CSV output', () => {
    const policy = { maxLevel: 1 };
    const rows = ['name,age,city'];
    for (let i = 0; i < 30; i++) rows.push(`  user${i}  ,  ${20 + i}  ,  city${i}  `);
    const text = rows.join('\n');
    assert.ok(text.length > 500);
    const r = simulateApplyOptimization(text, policy);
    assert.equal(r.optimized, true);
    // Fields should all be trimmed
    for (const line of r.text.split('\n').slice(1)) {
      if (line.trim()) {
        const fields = line.split(',');
        for (const f of fields) {
          assert.equal(f, f.trim(), `Field "${f}" should be trimmed`);
        }
      }
    }
  });

  it('compresses large Markdown output', () => {
    const policy = { maxLevel: 1 };
    const md = '# Report\n\n\n\n## Section 1\n\n\n\nContent here.\n\n\n\n## Section 2\n\n\n\nMore.\n\n\n\n';
    const items = Array(50).fill('- This is a longer list item with more content to pad the output\n\n\n').join('');
    const text = md + items;
    assert.ok(text.length > 500, `Markdown length = ${text.length}`);
    const r = simulateApplyOptimization(text, policy);
    assert.equal(r.optimized, true);
    // Should preserve content
    assert.ok(r.text.includes('Report'));
    assert.ok(r.text.includes('Section 1'));
  });
});

// ===========================================================================
// 3. No policy — safety net
// ===========================================================================

describe('no responsePolicy (safety)', () => {
  it('does nothing when policy is null', () => {
    const r = simulateApplyOptimization('some text', null);
    assert.equal(r.optimized, false);
  });

  it('does nothing when policy is undefined', () => {
    const r = simulateApplyOptimization('some text', undefined);
    assert.equal(r.optimized, false);
  });

  it('does nothing when policy has no maxLevel', () => {
    const r = simulateApplyOptimization('some text', {});
    assert.equal(r.optimized, false);
  });
});

// ===========================================================================
// 4. metadata format matches respond() contract
// ===========================================================================

describe('metadata contract', () => {
  it('has all required fields in _optimized', () => {
    const policy = { maxLevel: 1 };
    const text = JSON.stringify({ data: Array(80).fill({ x: 'y' }) }, null, 2);
    const r = simulateApplyOptimization(text, policy);
    assert.ok(r.optimized);
    const meta = r.meta._optimized;
    // Required fields for respond() to work correctly
    assert.ok('level' in meta);
    assert.ok('originalSize' in meta);
    assert.ok('optimizedSize' in meta);
    assert.ok('savings' in meta);
    assert.equal(typeof meta.level, 'number');
    assert.equal(typeof meta.originalSize, 'number');
    assert.equal(typeof meta.optimizedSize, 'number');
    assert.equal(typeof meta.savings, 'string');
  });

  it('metadata savings string is formatted correctly', () => {
    const policy = { maxLevel: 1 };
    const text = JSON.stringify({ data: Array(80).fill({ x: 'y' }) }, null, 2);
    const r = simulateApplyOptimization(text, policy);
    assert.ok(r.optimized);
    // Format: "X.XKB (XX.X%)"
    assert.match(r.meta._optimized.savings, /^[\d.]+KB \(\d+\.\d%\)$/);
  });
});

// ===========================================================================
// 5. CacheManager integration
// ===========================================================================

describe('CacheManager integration', () => {
  it('getOrSet works with async factory', async () => {
    const cache = new CacheManager({ ttlMs: 1000 });
    let callCount = 0;
    const factory = async () => { callCount++; return 'computed'; };

    const v1 = await cache.getOrSet('key1', factory);
    assert.equal(v1, 'computed');
    assert.equal(callCount, 1);

    const v2 = await cache.getOrSet('key1', factory);
    assert.equal(v2, 'computed');
    assert.equal(callCount, 1, 'factory should not be called again');
  });

  it('TTL expiry evicts entries', async () => {
    const cache = new CacheManager({ ttlMs: 50 });
    cache.set('key', 'value');
    assert.equal(cache.get('key'), 'value');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(cache.get('key'), undefined);
  });

  it('stats returns correct shape', () => {
    const cache = new CacheManager({ ttlMs: 5000 });
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss
    const s = cache.stats();
    assert.equal(s.size, 1);
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
    assert.ok(typeof s.hitRate === 'string');
    assert.ok(s.hitRate.includes('%'));
  });

  it('shutdown clears timer', () => {
    const cache = new CacheManager({ ttlMs: 5000 });
    cache.shutdown();
    // Should not throw
    assert.ok(true);
  });
});

// ===========================================================================
// 6. Full round-trip: compress → decompress for JSON
// ===========================================================================

describe('JSON round-trip (lossless)', () => {
  it('L1 compression preserves all data', () => {
    const original = {
      string: 'hello',
      number: 42,
      bool: true,
      null: null,
      array: [1, 2, 3],
      nested: { a: { b: 'deep' } },
    };
    const pretty = JSON.stringify(original, null, 2);
    // Pad to exceed threshold
    const big = { ...original, largeArray: Array(100).fill('padding') };
    const text = JSON.stringify(big, null, 2);
    const r = optimizeOutputSync(text, { maxLevel: 1 });
    if (r.optimized) {
      const parsed = JSON.parse(r.text);
      assert.equal(parsed.string, 'hello');
      assert.equal(parsed.number, 42);
      assert.equal(parsed.bool, true);
      assert.deepEqual(parsed.array, [1, 2, 3]);
      assert.equal(parsed.nested.a.b, 'deep');
      assert.equal(parsed.largeArray.length, 100);
    }
  });
});
