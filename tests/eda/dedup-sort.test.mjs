// dedup-sort.test.mjs — 去重 + 排序測試
// Phase 9.3: tests/eda/ 單元測試

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { dedupResults, sortByRelevance } from '../../src/plugins/core/eda/sources/index.mjs';

// ── dedupResults ───────────────────────────────────────────────────────

describe('dedupResults', () => {
  it('removes duplicate URLs', () => {
    const items = [
      { title: 'A', url: 'https://example.com/page' },
      { title: 'B', url: 'https://example.com/page' },
    ];
    const deduped = dedupResults(items);
    assert.equal(deduped.length, 1);
  });

  it('removes duplicate DOIs', () => {
    const items = [
      { title: 'A', url: 'https://doi.org/10.1234/abc' },
      { title: 'B', url: 'https://doi.org/10.1234/abc' },
    ];
    const deduped = dedupResults(items);
    assert.equal(deduped.length, 1);
  });

  it('keeps different URLs', () => {
    const items = [
      { title: 'A', url: 'https://example.com/a' },
      { title: 'B', url: 'https://example.com/b' },
    ];
    const deduped = dedupResults(items);
    assert.equal(deduped.length, 2);
  });

  it('handles items without URLs', () => {
    const items = [
      { title: 'A' },
      { title: 'B' },
    ];
    const deduped = dedupResults(items);
    assert.equal(deduped.length, 2);
  });

  it('handles empty input', () => {
    assert.deepEqual(dedupResults([]), []);
  });
});

// ── sortByRelevance ────────────────────────────────────────────────────

describe('sortByRelevance', () => {
  it('sorts by source weight × score', () => {
    const items = [
      { title: 'web', source: 'web', score: 0.9 },
      { title: 'exa', source: 'exa', score: 0.5 },
    ];
    const sorted = sortByRelevance(items);
    // exa weight=10, web weight=5 → exa should rank higher despite lower score
    assert.equal(sorted[0].source, 'exa');
  });

  it('handles missing score (defaults to 0.5)', () => {
    const items = [
      { title: 'A', source: 'github' },
      { title: 'B', source: 'web' },
    ];
    const sorted = sortByRelevance(items);
    // github weight=7 > web weight=5
    assert.equal(sorted[0].source, 'github');
  });

  it('handles unknown source (defaults to weight 5)', () => {
    const items = [
      { title: 'A', source: 'unknown_source', score: 1.0 },
    ];
    const sorted = sortByRelevance(items);
    assert.equal(sorted.length, 1);
  });
});
