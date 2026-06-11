// context-budget.test.mjs — Phase 10.4 Context Budget 主動管理
//
// Tests that the ContextBudget class correctly tracks cumulative output,
// escalates compression at threshold boundaries, and surfaces status.
//
// Run: node --test tests/context-budget.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ContextBudget, getContextBudget, resetContextBudget } from '../src/lib/context-budget.mjs';

// ---------------------------------------------------------------------------
// Test: Core tracking
// ---------------------------------------------------------------------------

describe('ContextBudget — tracking', () => {
  it('starts empty', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    assert.equal(b.totalChars, 0);
    assert.equal(b._callCount, 0);
    assert.equal(b.remaining, 10000);
    assert.equal(b.usedFraction, 0);
    assert.equal(b.remainingFraction, 1);
  });

  it('track() accumulates output size', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('smart_grep', 1000);
    b.track('smart_learn', 2000);
    assert.equal(b.totalChars, 3000);
    assert.equal(b._callCount, 2);
    assert.equal(b.remaining, 7000);
    assert.equal(b.usedFraction, 0.3);
  });

  it('track() records compression stats', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('smart_grep', 500, true, 2000);  // compressed: 2000→500
    assert.equal(b._compressedCount, 1);
    assert.equal(b._savingsChars, 1500);
  });

  it('track() bounds history to 100 entries', () => {
    const b = new ContextBudget({ maxChars: 100000 });
    for (let i = 0; i < 110; i++) {
      b.track('tool', 100);
    }
    assert.equal(b._callCount, 110);
    // Internally _history should be sliced to last 100
    assert.equal(b.getStatus().callCount, 110);
  });

  it('reset() clears all state', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('smart_grep', 5000);
    b.reset();
    assert.equal(b.totalChars, 0);
    assert.equal(b._callCount, 0);
    assert.equal(b._compressedCount, 0);
    assert.equal(b._savingsChars, 0);
  });
});

// ---------------------------------------------------------------------------
// Test: Threshold-based compression decisions
// ---------------------------------------------------------------------------

describe('ContextBudget — compression decisions', () => {
  it('returns no compression when budget is ok', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 1000);  // 10% used → ok
    const d = b.decideCompression(500, 0);
    assert.equal(d.shouldCompress, false);
    assert.equal(d.level, 0);
    assert.equal(d.reason, 'Budget ok');
  });

  it('forces L1 compression when budget is low (<= 50%)', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 6000);  // 60% used → below low threshold (50%), so remaining 40% which is < 50%
    // remaining = 4000/10000 = 0.4 → isLow → true (since 0.4 <= 0.5)
    const d = b.decideCompression(3000, 0);
    assert.equal(d.shouldCompress, true);
    assert.equal(d.level, 1);
    assert.ok(d.reason.includes('low'));
  });

  it('forces L2 compression when budget is critical (<= 20%)', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 9000);  // 90% used → remaining 10% → critical
    const d = b.decideCompression(3000, 0);
    assert.equal(d.shouldCompress, true);
    assert.equal(d.level, 2);
    assert.ok(d.reason.includes('critical'));
  });

  it('critical threshold forces L2 even for small outputs (>500 chars)', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 9500);
    const d = b.decideCompression(600, 0);
    assert.equal(d.shouldCompress, true);
    assert.equal(d.level, 2);
  });

  it('respects tool maxLevel cap (does not exceed tool declared max)', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 6000);  // low budget
    // Tool declares maxLevel: 1, but budget wants L2 → should stay at 1
    const d = b.decideCompression(3000, 1);
    assert.equal(d.shouldCompress, true);
    assert.equal(d.level, 1);  // capped by max(0, 1) = 1
  });

  it('does not compress tiny outputs when not critical', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 6000);  // 60% used, 40% remaining → low (0.4 <= 0.5)
    // Low threshold: only compress if outputSize > 2000
    const d = b.decideCompression(100, 0);
    assert.equal(d.shouldCompress, false);
    assert.equal(d.reason, 'Budget ok');  // falls through to ok because output is small
  });
});

// ---------------------------------------------------------------------------
// Test: Status reporting
// ---------------------------------------------------------------------------

describe('ContextBudget — status reporting', () => {
  it('getStatus() returns ok status when healthy', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 1000);
    const s = b.getStatus();
    assert.equal(s.status, 'ok');
    assert.ok(s.totalChars === 1000);
    assert.ok(s.usedPct.includes('10'));
    assert.ok(s.recommendation.includes('healthy'));
  });

  it('getStatus() returns low when budget is low', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 7000);  // 30% remaining → low
    const s = b.getStatus();
    assert.equal(s.status, 'low');
    assert.ok(s.recommendation.includes('low'));
  });

  it('getStatus() returns critical when budget is critical', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('tool', 9000);  // 10% remaining → critical
    const s = b.getStatus();
    assert.equal(s.status, 'critical');
    assert.ok(s.recommendation.includes('critical'));
  });

  it('getStatus() includes per-tool breakdown', () => {
    const b = new ContextBudget({ maxChars: 10000 });
    b.track('smart_grep', 1000);
    b.track('smart_learn', 2000, true, 5000);
    const s = b.getStatus();
    assert.ok(s.toolBreakdown['smart_grep']);
    assert.equal(s.toolBreakdown['smart_grep'].calls, 1);
    assert.equal(s.toolBreakdown['smart_grep'].totalChars, 1000);
    assert.ok(s.toolBreakdown['smart_learn']);
    assert.equal(s.toolBreakdown['smart_learn'].compressed, 1);
  });
});

// ---------------------------------------------------------------------------
// Test: Integration helpers
// ---------------------------------------------------------------------------

describe('ContextBudget — singleton', () => {
  after(() => resetContextBudget());

  it('getContextBudget() returns same instance', () => {
    const a = getContextBudget();
    const b = getContextBudget();
    assert.equal(a, b);
  });

  it('resetContextBudget() resets singleton state', () => {
    const b = getContextBudget();
    b.track('smart_grep', 5000);
    assert.ok(b.totalChars > 0);
    resetContextBudget();
    assert.equal(b.totalChars, 0);
  });
});
