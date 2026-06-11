// refactor-planner.test.mjs — Tests for CKG-based refactoring planner
//
// Covers: estimateDifficulty, generateMigrationPlan
//
// Run: node --test tests/refactor-planner.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { estimateDifficulty, generateMigrationPlan } from '../src/lib/refactor-planner.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsageResult(overrides = {}) {
  return {
    symbol: 'oldFunction',
    file: 'src/lib/old.js',
    totalUsages: overrides.totalUsages ?? 5,
    usages: overrides.usages ?? [
      { caller: { file: 'src/a.js', line: 10, name: 'foo' }, pattern: 'direct-call' },
      { caller: { file: 'src/a.js', line: 20, name: 'bar' }, pattern: 'direct-call' },
      { caller: { file: 'src/b.js', line: 5, name: 'init' }, pattern: 'module-init' },
      { caller: { file: 'src/c.js', line: 15, name: 'handleClick' }, pattern: 'event-handler' },
      { caller: { file: 'src/d.js', line: 8, name: 'createWidget' }, pattern: 'factory' },
    ],
    patterns: overrides.patterns ?? [
      { type: 'direct-call', count: 2, description: 'Direct function calls' },
      { type: 'module-init', count: 1, description: 'Module-level initialization' },
      { type: 'event-handler', count: 1, description: 'Event handler callbacks' },
      { type: 'factory', count: 1, description: 'Factory/creator functions' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimateDifficulty', () => {

  it('returns none for zero usages', () => {
    const r = estimateDifficulty({ totalUsages: 0, patterns: [] });
    assert.equal(r.score, 0);
    assert.equal(r.label, 'none');
  });

  it('returns trivial for few usages', () => {
    const r = estimateDifficulty(makeUsageResult({ totalUsages: 2, patterns: [{ type: 'direct-call', count: 2 }] }));
    assert.ok(r.score <= 3, `score ${r.score} should be <= 3 for 2 usages`);
    assert.ok(r.label);
    assert.ok(r.reason);
  });

  it('returns moderate for medium usages', () => {
    const r = estimateDifficulty(makeUsageResult({ totalUsages: 15 }));
    assert.ok(r.score >= 4, `score ${r.score} should be >= 4 for 15 usages`);
  });

  it('returns complex for many usages', () => {
    const r = estimateDifficulty(makeUsageResult({ totalUsages: 50 }));
    assert.ok(r.score >= 7, `score ${r.score} should be >= 7 for 50 usages`);
  });

  it('caps at 10', () => {
    const r = estimateDifficulty(makeUsageResult({ totalUsages: 1000 }));
    assert.equal(r.score, 10);
  });

  it('event-handler patterns increase difficulty', () => {
    const without = estimateDifficulty(makeUsageResult({
      totalUsages: 5,
      patterns: [{ type: 'direct-call', count: 5 }],
    }));
    const withEvent = estimateDifficulty(makeUsageResult({
      totalUsages: 5,
      patterns: [{ type: 'event-handler', count: 5 }],
    }));
    assert.ok(withEvent.score >= without.score, 'event handlers should not decrease difficulty');
  });

  it('class-method patterns increase difficulty', () => {
    const without = estimateDifficulty(makeUsageResult({
      totalUsages: 5,
      patterns: [{ type: 'direct-call', count: 5 }],
    }));
    const withClass = estimateDifficulty(makeUsageResult({
      totalUsages: 5,
      patterns: [{ type: 'class-method', count: 5 }],
    }));
    assert.ok(withClass.score >= without.score, 'class methods should not decrease difficulty');
  });
});

describe('generateMigrationPlan', () => {

  it('returns empty plan for zero usages', () => {
    const r = generateMigrationPlan({ symbol: 'x', file: 'x.js', totalUsages: 0, usages: [], patterns: [] });
    assert.equal(r.steps.length, 0);
    assert.equal(r.summary.totalUsages, 0);
    assert.ok(r.warnings.length > 0);
  });

  it('generates analyze step first', () => {
    const r = generateMigrationPlan(makeUsageResult());
    assert.ok(r.steps.length > 0);
    assert.equal(r.steps[0].action, 'analyze');
    assert.equal(r.steps[0].step, 1);
  });

  it('generates verify step last', () => {
    const r = generateMigrationPlan(makeUsageResult());
    const last = r.steps[r.steps.length - 1];
    assert.equal(last.action, 'verify');
  });

  it('generates replace step for direct-call patterns', () => {
    const r = generateMigrationPlan(makeUsageResult());
    const replaceStep = r.steps.find(s => s.action === 'replace');
    assert.ok(replaceStep, 'should have replace step');
    assert.ok(replaceStep.affectedFiles.length > 0);
  });

  it('generates update-handler step for event-handler patterns', () => {
    const r = generateMigrationPlan(makeUsageResult());
    const handlerStep = r.steps.find(s => s.action === 'update-handler');
    assert.ok(handlerStep, 'should have handler step');
    assert.equal(handlerStep.risk, 'high');
  });

  it('generates update-factory step for factory patterns', () => {
    const r = generateMigrationPlan(makeUsageResult());
    const factoryStep = r.steps.find(s => s.action === 'update-factory');
    assert.ok(factoryStep, 'should have factory step');
    assert.equal(factoryStep.risk, 'medium');
  });

  it('includes newApi in replace step description', () => {
    const r = generateMigrationPlan(makeUsageResult(), { newApi: 'newFunction' });
    const replaceStep = r.steps.find(s => s.action === 'replace');
    assert.ok(replaceStep.description.includes('newFunction'));
  });

  it('warns when files exceed safety threshold', () => {
    // Create 6 files with 1 usage each
    const usages = [];
    for (let i = 0; i < 6; i++) {
      usages.push({ caller: { file: `src/f${i}.js`, line: 1, name: 'f' }, pattern: 'direct-call' });
    }
    const r = generateMigrationPlan(makeUsageResult({ totalUsages: 6, usages }), { safetyThreshold: 5 });
    const safetyWarning = r.warnings.find(w => w.includes('threshold'));
    assert.ok(safetyWarning, 'should warn about exceeding threshold');
  });

  it('warns about high-risk patterns', () => {
    const r = generateMigrationPlan(makeUsageResult());
    const patternWarnings = r.warnings.filter(w => w.includes('event-handler') || w.includes('factory'));
    assert.ok(patternWarnings.length > 0, 'should warn about high-risk patterns');
  });

  it('excludes files from migration', () => {
    const r = generateMigrationPlan(makeUsageResult(), { excludeFiles: ['src/a.js'] });
    // src/a.js should be excluded from affected files
    const allAffected = r.steps.flatMap(s => s.affectedFiles || []);
    assert.ok(!allAffected.includes('src/a.js'), 'excluded file should not appear');
  });

  it('includes summary with difficulty', () => {
    const r = generateMigrationPlan(makeUsageResult());
    assert.equal(r.summary.symbol, 'oldFunction');
    assert.equal(r.summary.totalUsages, 5);
    assert.ok(r.summary.difficulty.score > 0);
  });

  it('includes api info', () => {
    const r = generateMigrationPlan(makeUsageResult(), { newApi: 'newFunc', newSignature: '(x: number)' });
    assert.equal(r.api.symbol, 'oldFunction');
    assert.equal(r.api.newApi, 'newFunc');
    assert.equal(r.api.newSignature, '(x: number)');
  });
});