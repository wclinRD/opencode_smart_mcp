// eda-benchmark.test.mjs — EDA Benchmark 自動化測試
// Phase 14.9: 確認 benchmark 結構正確 + metrics 函式邏輯正確

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  recallAtK,
  precisionAtK,
  mrr,
  ndcgAtK,
  keywordHitRate,
  actionMatch,
  evaluateQuery,
  aggregateMetrics,
} from './eval/metrics.mjs';

import { runSuite, runAll } from './eval/runner.mjs';

// ── Metrics 函式測試 ─────────────────────────────────────────────────

describe('recallAtK', () => {
  it('returns 1.0 when all expected keywords are in top K', () => {
    const result = recallAtK(
      ['Design Compiler synthesis', 'Genus synthesis', 'Yosys open-source', 'other', 'other2'],
      ['Design Compiler', 'Genus'],
      5
    );
    assert.equal(result, 1.0);
  });

  it('returns partial recall when some expected keywords found', () => {
    const result = recallAtK(
      ['Design Compiler synthesis', 'other', 'other2', 'other3', 'other4'],
      ['Design Compiler', 'Genus'],
      5
    );
    assert.equal(result, 0.5);
  });

  it('returns 0 when no expected keywords found', () => {
    const result = recallAtK(
      ['completely unrelated', 'nothing relevant'],
      ['Design Compiler'],
      5
    );
    assert.equal(result, 0);
  });

  it('returns 1.0 for empty expected', () => {
    assert.equal(recallAtK(['a'], [], 5), 1.0);
  });
});

describe('precisionAtK', () => {
  it('returns 1.0 when all top K are relevant', () => {
    const result = precisionAtK(
      ['Design Compiler', 'Genus', 'Yosys'],
      ['Design Compiler', 'Genus', 'Yosys'],
      3
    );
    assert.equal(result, 1.0);
  });

  it('returns partial precision', () => {
    const result = precisionAtK(
      ['Design Compiler', 'unrelated', 'Genus'],
      ['Design Compiler', 'Genus'],
      3
    );
    assert.equal(result, 2 / 3);
  });

  it('returns 0 for K=0', () => {
    assert.equal(precisionAtK(['a'], ['a'], 0), 0);
  });
});

describe('mrr', () => {
  it('returns 1.0 when first result is relevant', () => {
    assert.equal(mrr(['Design Compiler', 'other'], ['Design Compiler']), 1.0);
  });

  it('returns 0.5 when second result is relevant', () => {
    assert.equal(mrr(['other', 'Design Compiler'], ['Design Compiler']), 0.5);
  });

  it('returns 0 when no results match', () => {
    assert.equal(mrr(['other', 'nothing'], ['Design Compiler']), 0);
  });
});

describe('ndcgAtK', () => {
  it('returns 1.0 for perfect ranking', () => {
    const result = ndcgAtK(
      ['Design Compiler', 'Genus'],
      ['Design Compiler', 'Genus'],
      2
    );
    assert.ok(Math.abs(result - 1.0) < 0.001);
  });

  it('returns < 1.0 for suboptimal ranking', () => {
    const perfect = ndcgAtK(['Design Compiler', 'Genus'], ['Design Compiler', 'Genus'], 2);
    const imperfect = ndcgAtK(['Genus', 'Design Compiler'], ['Design Compiler', 'Genus'], 2);
    assert.ok(perfect >= imperfect);
  });
});

describe('keywordHitRate', () => {
  it('returns 1.0 when all keywords found', () => {
    assert.equal(
      keywordHitRate(['Design Compiler synthesis tool'], ['Design Compiler', 'synthesis']),
      1.0
    );
  });

  it('returns partial rate', () => {
    assert.equal(
      keywordHitRate(['Design Compiler'], ['Design Compiler', 'Genus']),
      0.5
    );
  });
});

describe('actionMatch', () => {
  it('matches case-insensitive', () => {
    assert.ok(actionMatch('Tool', 'tool'));
    assert.ok(actionMatch('auto', 'Auto'));
  });

  it('rejects mismatch', () => {
    assert.ok(!actionMatch('tool', 'paper'));
  });

  it('handles null', () => {
    assert.ok(!actionMatch(null, 'tool'));
    assert.ok(!actionMatch('tool', null));
  });
});

describe('evaluateQuery', () => {
  it('returns all metric fields', () => {
    const result = evaluateQuery({
      results: ['Design Compiler synthesis', 'other'],
      expectedKeywords: ['Design Compiler'],
      predictedAction: 'tool',
      expectedAction: 'tool',
    });

    assert.ok('recallAt5' in result);
    assert.ok('precisionAt5' in result);
    assert.ok('mrr' in result);
    assert.ok('ndcgAt5' in result);
    assert.ok('keywordHitRate' in result);
    assert.ok('actionMatch' in result);
    assert.equal(result.actionMatch, true);
  });
});

describe('aggregateMetrics', () => {
  it('computes weighted averages', () => {
    const evals = [
      { recallAt5: 1.0, precisionAt5: 0.8, mrr: 1.0, ndcgAt5: 1.0, keywordHitRate: 1.0, actionMatch: true },
      { recallAt5: 0.5, precisionAt5: 0.4, mrr: 0.5, ndcgAt5: 0.5, keywordHitRate: 0.5, actionMatch: false },
    ];
    const m = aggregateMetrics(evals);
    assert.equal(m.count, 2);
    assert.equal(m.avgRecallAt5, 0.75);
    assert.equal(m.actionAccuracy, 0.5);
  });

  it('returns empty for no evaluations', () => {
    assert.deepEqual(aggregateMetrics([]), {});
  });
});

// ── Benchmark 結構驗證 ────────────────────────────────────────────────

describe('Benchmark JSON files', () => {
  it('tool-100.json has 100 queries', async () => {
    const { default: data } = await import('./benchmark/tool-100.json', { with: { type: 'json' } });
    assert.equal(data.length, 100);
    for (const q of data) {
      assert.ok(q.id, `Missing id in: ${JSON.stringify(q)}`);
      assert.ok(q.query, `Missing query in: ${JSON.stringify(q)}`);
      assert.ok(q.expectedAction, `Missing expectedAction in: ${JSON.stringify(q)}`);
      assert.ok(Array.isArray(q.expectedKeywords), `Missing expectedKeywords in: ${JSON.stringify(q)}`);
    }
  });

  it('troubleshoot-50.json has 50 queries', async () => {
    const { default: data } = await import('./benchmark/troubleshoot-50.json', { with: { type: 'json' } });
    assert.equal(data.length, 50);
    for (const q of data) {
      assert.ok(q.id && q.query && q.expectedAction);
    }
  });

  it('flow-50.json has 50 queries', async () => {
    const { default: data } = await import('./benchmark/flow-50.json', { with: { type: 'json' } });
    assert.equal(data.length, 50);
  });

  it('academic-50.json has 50 queries', async () => {
    const { default: data } = await import('./benchmark/academic-50.json', { with: { type: 'json' } });
    assert.equal(data.length, 50);
  });

  it('abbreviation-50.json has 50 queries', async () => {
    const { default: data } = await import('./benchmark/abbreviation-50.json', { with: { type: 'json' } });
    assert.equal(data.length, 50);
    for (const q of data) {
      assert.ok(q.abbrExpected, `Missing abbrExpected in abbreviation query: ${q.id}`);
    }
  });
});

// ── Runner 集成測試（Off-Mode）───────────────────────────────────────

describe('Benchmark Runner (off-line mode)', () => {
  it('runs tool suite without errors', async () => {
    const result = await runSuite('tool');
    assert.ok(result.count === 100);
    assert.ok(result.metrics.avgRecallAt5 >= 0);
    assert.ok(result.metrics.actionAccuracy >= 0);
  });

  it('runs abbreviation suite without errors', async () => {
    const result = await runSuite('abbreviation');
    assert.ok(result.count === 50);
    assert.ok(typeof result.metrics.avgKeywordHitRate === 'number');
  });

  it('runs all suites without errors', async () => {
    const results = await runAll();
    assert.equal(Object.keys(results).length, 5);
    const totalQueries = Object.values(results).reduce((a, r) => a + r.count, 0);
    assert.equal(totalQueries, 300); // 100 + 50 + 50 + 50 + 50
  });
});
