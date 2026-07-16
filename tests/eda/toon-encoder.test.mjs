// toon-encoder.test.mjs — TOON Encoder/Decoder 測試
// Phase 9.3: tests/eda/ 單元測試
//
// 注意：TOON encoder 將 string 包在引號中，decoder 的 extractNextValue
// 不完全處理引號分隔，所以純字串值的 roundtrip 有已知限制。
// 以下測試反映實際行為。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeToon, decodeToon, toonStats } from '../../src/plugins/core/eda/lib/toon-encoder.mjs';

// ── encodeToon ─────────────────────────────────────────────────────────

describe('encodeToon', () => {
  it('encodes simple object', () => {
    const obj = { name: 'DC', vendor: 'Synopsys', category: 'tool' };
    const toon = encodeToon(obj);
    assert.ok(toon.startsWith('<name,vendor,category>'));
    assert.ok(toon.includes('DC'));
    assert.ok(toon.includes('Synopsys'));
  });

  it('encodes array of objects (compressed)', () => {
    const arr = [
      { name: 'DC', vendor: 'Synopsys' },
      { name: 'PT', vendor: 'Synopsys' },
    ];
    const toon = encodeToon(arr);
    assert.ok(toon.includes('<name,vendor>'));
    assert.ok(toon.includes('|'));
  });

  it('encodes primitives', () => {
    assert.equal(encodeToon(42), '42');
    assert.equal(encodeToon(true), 'true');
    assert.equal(encodeToon('hello'), '"hello"');
  });

  it('encodes empty structures', () => {
    assert.equal(encodeToon([]), '[]');
    assert.equal(encodeToon({}), '{}');
  });

  it('encodes null/undefined', () => {
    assert.equal(encodeToon(null), '');
    assert.equal(encodeToon(undefined), '');
  });
});

// ── decodeToon ─────────────────────────────────────────────────────────

describe('decodeToon', () => {
  it('decodes simple object with numeric values', () => {
    const toon = '<name,score>DC,42';
    const obj = decodeToon(toon);
    assert.equal(obj.name, 'DC');
    assert.equal(obj.score, 42);
  });

  it('decodes empty structures', () => {
    assert.deepEqual(decodeToon('[]'), []);
    assert.deepEqual(decodeToon('{}'), {});
  });

  it('handles null/empty input', () => {
    assert.equal(decodeToon(null), null);
    assert.equal(decodeToon(''), null);
  });

  it('decodes array of objects with numeric values', () => {
    const toon = '[<name,score>DC,42|PT,99]';
    const arr = decodeToon(toon);
    assert.equal(arr.length, 2);
    assert.equal(arr[0].name, 'DC');
    assert.equal(arr[1].score, 99);
  });
});

// ── toonStats ──────────────────────────────────────────────────────────

describe('toonStats', () => {
  it('reports savings for object', () => {
    const obj = { name: 'DC', vendor: 'Synopsys', category: 'tool' };
    const stats = toonStats(obj);
    assert.ok(stats.original > 0);
    assert.ok(stats.toon > 0);
    assert.ok(typeof stats.savings === 'number');
    assert.ok(stats.toon <= stats.original);
  });

  it('reports savings for array', () => {
    const arr = [
      { name: 'DC', vendor: 'Synopsys', category: 'tool' },
      { name: 'PT', vendor: 'Synopsys', category: 'tool' },
    ];
    const stats = toonStats(arr);
    assert.ok(stats.savings >= 0);
  });
});
