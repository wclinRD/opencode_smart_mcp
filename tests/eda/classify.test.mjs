// classify.test.mjs — Query Intelligence 分類器測試
// Phase 9.3: tests/eda/ 單元測試

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyQuery, optimizeSearch, QUERY_TYPES, CATEGORY_SOURCE_WEIGHTS } from '../../src/plugins/core/eda/query/classify.mjs';

// ── classifyQuery ──────────────────────────────────────────────────────

describe('classifyQuery', () => {
  it('classifies tool issue queries', () => {
    const r = classifyQuery('DC compile error in transition');
    assert.equal(r.type, QUERY_TYPES.TOOL_ISSUE);
    assert.ok(r.confidence > 0.3);
  });

  it('classifies PDK lookup queries', () => {
    const r = classifyQuery('SKY130 standard cell library');
    assert.equal(r.type, QUERY_TYPES.PDK_LOOKUP);
  });

  it('classifies academic queries', () => {
    const r = classifyQuery('recent papers on machine learning VLSI placement');
    assert.equal(r.type, QUERY_TYPES.ACADEMIC);
  });

  it('classifies flow guide queries', () => {
    const r = classifyQuery('how to set up DFT scan chain');
    assert.equal(r.type, QUERY_TYPES.FLOW_GUIDE);
  });

  it('classifies tool docs queries', () => {
    const r = classifyQuery('Vivado constraint syntax SDC');
    assert.equal(r.type, QUERY_TYPES.TOOL_DOCS);
  });

  it('classifies general queries as general', () => {
    const r = classifyQuery('what is chip design');
    assert.equal(r.type, QUERY_TYPES.GENERAL);
  });

  it('returns GENERAL for null/empty input', () => {
    assert.equal(classifyQuery(null).type, QUERY_TYPES.GENERAL);
    assert.equal(classifyQuery('').type, QUERY_TYPES.GENERAL);
    assert.equal(classifyQuery(123).type, QUERY_TYPES.GENERAL);
  });

  it('always includes weights', () => {
    const r = classifyQuery('DC error');
    assert.ok(r.weights);
    assert.ok(typeof r.weights.maxResults === 'number');
  });

  it('Chinese queries work', () => {
    const r = classifyQuery('DC 綜合 錯誤');
    assert.ok(r.type);
  });
});

// ── optimizeSearch ─────────────────────────────────────────────────────

describe('optimizeSearch', () => {
  it('returns optimized search params for high-confidence tool issue', () => {
    const r = optimizeSearch('DC compile error failure');
    assert.ok(r.classification);
    assert.ok(r.maxResults > 0);
    assert.ok(r.sourceWeights);
  });

  it('preserves original query for low confidence', () => {
    const r = optimizeSearch('random stuff');
    assert.equal(r.query, 'random stuff');
  });
});

// ── CATEGORY_SOURCE_WEIGHTS ────────────────────────────────────────────

describe('CATEGORY_SOURCE_WEIGHTS', () => {
  it('has weights for all 6 query types', () => {
    const types = Object.values(QUERY_TYPES);
    for (const type of types) {
      assert.ok(CATEGORY_SOURCE_WEIGHTS[type], `Missing weights for ${type}`);
    }
  });

  it('academic has high scholar weight', () => {
    assert.ok(CATEGORY_SOURCE_WEIGHTS[QUERY_TYPES.ACADEMIC].scholar >= 0.8);
  });

  it('tool_issue has high community weight', () => {
    assert.ok(CATEGORY_SOURCE_WEIGHTS[QUERY_TYPES.TOOL_ISSUE].community >= 0.8);
  });
});
