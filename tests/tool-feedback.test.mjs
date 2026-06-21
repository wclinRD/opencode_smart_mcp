// tool-feedback.test.mjs — Tests for Phase 26 Tool Selection Feedback
//
// Covers: tool_feedback table, recordFeedback, getRecommendationStats,
//         getPatternAdjustments
//
// Run: node --test tests/tool-feedback.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { MemoryDB } from '../src/lib/memory-db.mjs';

const TMP = resolve(process.cwd(), '.test-feedback-' + Date.now());
const DB_PATH = resolve(TMP, 'test.db');

describe('Phase 26: Tool Selection Feedback', () => {
  let db;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    db = new MemoryDB(DB_PATH);
    db.open();
  });

  after(() => {
    db.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should record feedback with match', () => {
    db.recordFeedback('debug login error', 'smart_grep', 'smart_grep', 150);
    const stats = db.getRecommendationStats('smart_grep');
    assert.equal(stats.total, 1);
    assert.equal(stats.success, 1);
    assert.equal(stats.rate, 1);
  });

  it('should record feedback with mismatch', () => {
    db.recordFeedback('refactor auth', 'smart_learn', 'smart_read', 200);
    const stats = db.getRecommendationStats('smart_learn');
    assert.equal(stats.total, 1);
    assert.equal(stats.success, 0);
    assert.equal(stats.rate, 0);
  });

  it('should calculate rates correctly with mixed data', () => {
    db.recordFeedback('test login', 'smart_grep', 'smart_grep', 100);
    db.recordFeedback('fix error', 'smart_grep', 'smart_debug', 300);
    const stats = db.getRecommendationStats('smart_grep');
    assert.equal(stats.total, 3);
    assert.equal(stats.success, 2);
    assert.equal(stats.rate, 2 / 3);
  });

  it('getRecommendationStats should return 0 for unknown tool', () => {
    const stats = db.getRecommendationStats('nonexistent');
    assert.equal(stats.total, 0);
    assert.equal(stats.rate, 0);
  });

  it('getPatternAdjustments should flag high-fail-rate tools', () => {
    // Add several fails for smart_learn
    db.recordFeedback('task', 'smart_learn', 'smart_read', 100);
    db.recordFeedback('task', 'smart_learn', 'smart_grep', 150);
    db.recordFeedback('task', 'smart_learn', 'smart_debug', 200);
    db.recordFeedback('task', 'smart_learn', 'smart_grep', 120);

    const adjustments = db.getPatternAdjustments(3, 0.5);
    const learnAdj = adjustments.find(a => a.tool === 'smart_learn');
    assert.ok(learnAdj);
    assert.ok(learnAdj.failRate >= 0.5);
    // 1 from earlier test + 4 from this test
    assert.ok(learnAdj.total >= 4);
  });

  it('should handle empty database gracefully', () => {
    const emptyDb = new MemoryDB(resolve(TMP, 'empty-feedback.db'));
    emptyDb.open();
    const adjustments = emptyDb.getPatternAdjustments(3, 0.7);
    assert.ok(Array.isArray(adjustments));
    assert.equal(adjustments.length, 0);
    emptyDb.close();
  });
});
