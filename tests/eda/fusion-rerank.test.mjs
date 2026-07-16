// fusion-rerank.test.mjs — RRF Fusion + Rerank Pipeline 測試
// Phase 13: Hybrid Retrieval RAG

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { reciprocalRankFusion } from '../../src/plugins/core/eda/sources/fusion.mjs';
import {
  scoreRelevance, adaptiveTopK, postRetrievalFilter,
  rerankPipeline, estimateQueryComplexity,
} from '../../src/plugins/core/eda/sources/rerank.mjs';
import { classifyQuery, QUERY_TYPES } from '../../src/plugins/core/eda/query/classify.mjs';

// ── reciprocalRankFusion ──────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  it('fuses results from multiple sources by RRF score', () => {
    const sourceResults = [
      { source: 'web', items: [
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
        { title: 'C', url: 'https://c.com' },
      ]},
      { source: 'scholar', items: [
        { title: 'B', url: 'https://b.com' },
        { title: 'A', url: 'https://a.com' },
        { title: 'D', url: 'https://d.com' },
      ]},
    ];
    const fused = reciprocalRankFusion(sourceResults, { maxResults: 10 });

    // B and A appear in both sources → should rank higher
    assert.ok(fused.length >= 3);
    const bItem = fused.find(f => f.title === 'B');
    assert.ok(bItem, 'B should exist');
    assert.equal(bItem.sourceCount, 2, 'B should be in 2 sources');
    assert.ok(bItem.rrfScore > 0, 'B should have positive RRF score');
  });

  it('handles empty sources', () => {
    const fused = reciprocalRankFusion([], { maxResults: 10 });
    assert.equal(fused.length, 0);
  });

  it('respects maxResults', () => {
    const sourceResults = [
      { source: 'web', items: Array.from({ length: 20 }, (_, i) => ({
        title: `Item ${i}`, url: `https://example.com/${i}`,
      }))},
    ];
    const fused = reciprocalRankFusion(sourceResults, { maxResults: 5 });
    assert.ok(fused.length <= 5);
  });

  it('normalizes URLs for dedup', () => {
    const sourceResults = [
      { source: 'web', items: [
        { title: 'A', url: 'https://example.com/page/' },
      ]},
      { source: 'scholar', items: [
        { title: 'A2', url: 'https://example.com/page' },
      ]},
    ];
    const fused = reciprocalRankFusion(sourceResults, { maxResults: 10 });
    // Both should merge (trailing slash normalized)
    assert.equal(fused.length, 1);
    assert.equal(fused[0].sourceCount, 2);
  });
});

// ── scoreRelevance ────────────────────────────────────────────────────

describe('scoreRelevance', () => {
  it('gives higher score to EDA-relevant content', () => {
    const edaItem = {
      title: 'Synopsys Design Compiler synthesis flow',
      snippet: 'STA timing analysis with PrimeTime',
      rrfScore: 0.01,
      sourceCount: 2,
    };
    const genericItem = {
      title: 'How to cook pasta',
      snippet: 'Italian recipe for dinner',
      rrfScore: 0.01,
      sourceCount: 1,
    };
    const q = 'Design Compiler synthesis';
    const edaScore = scoreRelevance(edaItem, q);
    const genericScore = scoreRelevance(genericItem, q);
    assert.ok(edaScore > genericScore, `EDA ${edaScore} should > generic ${genericScore}`);
  });

  it('boosts multi-source items', () => {
    const single = { title: 'A', snippet: 'B', rrfScore: 0.01, sourceCount: 1 };
    const multi = { title: 'A', snippet: 'B', rrfScore: 0.01, sourceCount: 3 };
    const q = 'test';
    assert.ok(scoreRelevance(multi, q) > scoreRelevance(single, q));
  });
});

// ── adaptiveTopK ──────────────────────────────────────────────────────

describe('adaptiveTopK', () => {
  it('simple query returns fewer results', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Item ${i}`, rrfScore: 0.1 - i * 0.01,
    }));
    const result = adaptiveTopK('DC compile', { type: 'general', confidence: 0.5 }, items);
    assert.ok(result.length <= 3, `simple query should return ≤3, got ${result.length}`);
  });

  it('complex query returns more results', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `Item ${i}`, rrfScore: 0.1 - i * 0.01,
    }));
    const result = adaptiveTopK(
      'compare Design Compiler vs Genus synthesis results for timing violations',
      { type: 'tool_issue', confidence: 0.8 },
      items,
    );
    assert.ok(result.length >= 6, `complex query should return ≥6, got ${result.length}`);
  });
});

// ── postRetrievalFilter ───────────────────────────────────────────────

describe('postRetrievalFilter', () => {
  it('filters low-score items', () => {
    const items = [
      { title: 'A', rerankScore: 0.5 },
      { title: 'B', rerankScore: 0.05 },
      { title: 'C', rerankScore: 0.3 },
    ];
    const filtered = postRetrievalFilter(items, { minScore: 0.15 });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every(f => f.rerankScore >= 0.15));
  });

  it('deduplicates by title', () => {
    const items = [
      { title: 'Design Compiler Guide', abstract: 'short', rerankScore: 0.5 },
      { title: 'Design Compiler Guide', abstract: 'much longer abstract text here', rerankScore: 0.4 },
    ];
    const filtered = postRetrievalFilter(items, { minScore: 0.1 });
    assert.equal(filtered.length, 1);
    assert.ok(filtered[0].abstract.length > 5, 'should keep the one with longer abstract');
  });
});

// ── rerankPipeline ────────────────────────────────────────────────────

describe('rerankPipeline', () => {
  it('returns scored and filtered results', () => {
    const candidates = [
      { title: 'DC synthesis', url: 'https://dc.com', snippet: 'Design Compiler synthesis flow', rrfScore: 0.02, sourceCount: 2 },
      { title: 'Random page', url: 'https://random.com', snippet: 'nothing relevant', rrfScore: 0.01, sourceCount: 1 },
      { title: 'STA timing', url: 'https://sta.com', snippet: 'Static Timing Analysis PrimeTime', rrfScore: 0.015, sourceCount: 1 },
    ];
    const classification = classifyQuery('Design Compiler synthesis');
    const result = rerankPipeline(candidates, 'Design Compiler synthesis', classification, { maxResults: 5 });
    assert.ok(result.length >= 1, 'should return at least 1 result');
    assert.ok(result[0].rerankScore !== undefined, 'should have rerankScore');
  });
});
