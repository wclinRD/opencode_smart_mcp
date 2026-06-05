// refactor-plan.test.mjs — Tests for CKG-based refactoring assistant
//
// Tests:
//   1. refactor-planner.mjs: generateMigrationPlan, estimateDifficulty
//   2. queryUsagePatterns on CKG (integration)
//
// Run: node --test tests/refactor-plan.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Synthetic usage results for planner tests ──

const SAMPLE_USAGE_DIRECT = {
  symbol: 'oldApi',
  file: 'src/utils.ts',
  totalUsages: 8,
  patterns: [
    { type: 'direct-call', count: 5, description: 'Direct function/method call' },
    { type: 'class-method', count: 2, description: 'Called from a class method' },
    { type: 'event-handler', count: 1, description: 'Called from event handler' },
  ],
  usages: [
    { caller: { name: 'compute', kind: 'function', file: 'src/math.ts', line: 15, signature: 'compute(x: number): number', container: null }, pattern: 'direct-call', confidence: 0.6 },
    { caller: { name: 'format', kind: 'function', file: 'src/format.ts', line: 42, signature: 'format(val: unknown): string', container: null }, pattern: 'direct-call', confidence: 0.6 },
    { caller: { name: 'validate', kind: 'function', file: 'src/validate.ts', line: 8, signature: 'validate(input: string): boolean', container: null }, pattern: 'direct-call', confidence: 0.6 },
    { caller: { name: 'render', kind: 'function', file: 'src/render.tsx', line: 23, signature: 'render(data: unknown): string', container: null }, pattern: 'direct-call', confidence: 0.6 },
    { caller: { name: 'parse', kind: 'function', file: 'src/parser.ts', line: 55, signature: 'parse(raw: string): object', container: null }, pattern: 'direct-call', confidence: 0.6 },
    { caller: { name: 'updateRow', kind: 'method', file: 'src/table.ts', line: 102, signature: 'updateRow(id: number): void', container: { name: 'TableManager', kind: 'class' } }, pattern: 'class-method', confidence: 0.8 },
    { caller: { name: 'deleteRow', kind: 'method', file: 'src/table.ts', line: 150, signature: 'deleteRow(id: number): void', container: { name: 'TableManager', kind: 'class' } }, pattern: 'class-method', confidence: 0.8 },
    { caller: { name: 'onButtonClick', kind: 'function', file: 'src/ui/events.ts', line: 34, signature: 'onButtonClick(ev: Event): void', container: null }, pattern: 'event-handler', confidence: 0.8 },
  ],
};

const SAMPLE_USAGE_EMPTY = {
  symbol: 'unusedApi',
  file: 'src/legacy.ts',
  totalUsages: 0,
  patterns: [],
  usages: [],
};

const SAMPLE_USAGE_SINGLE = {
  symbol: 'simpleFunc',
  file: 'src/helpers.ts',
  totalUsages: 1,
  patterns: [{ type: 'direct-call', count: 1, description: 'Direct function/method call' }],
  usages: [
    { caller: { name: 'run', kind: 'function', file: 'src/main.ts', line: 5, signature: 'run(): void', container: null }, pattern: 'direct-call', confidence: 0.6 },
  ],
};

describe('Phase C.1: Refactoring Assistant — Planner', () => {
  let estimateDifficulty, generateMigrationPlan;

  before(async () => {
    const mod = await import('../src/lib/refactor-planner.mjs');
    estimateDifficulty = mod.estimateDifficulty;
    generateMigrationPlan = mod.generateMigrationPlan;
  });

  // ── 1. estimateDifficulty ──
  it('1.1 estimateDifficulty returns none for empty usage', () => {
    const d = estimateDifficulty(SAMPLE_USAGE_EMPTY);
    assert.equal(d.score, 0);
    assert.equal(d.label, 'none');
  });

  it('1.2 estimateDifficulty returns low for single usage', () => {
    const d = estimateDifficulty(SAMPLE_USAGE_SINGLE);
    assert.ok(d.score >= 1 && d.score <= 4, `score should be low, got ${d.score}`);
    assert.ok(d.reason.includes('1 simple usage'));
  });

  it('1.3 estimateDifficulty scores higher for mixed patterns', () => {
    const d = estimateDifficulty(SAMPLE_USAGE_DIRECT);
    assert.ok(d.score >= 3 && d.score <= 8, `score ${d.score} should be moderate range`);
    assert.ok(d.label, 'should have label');
  });

  // ── 2. generateMigrationPlan — empty ──
  it('2.1 generateMigrationPlan returns empty for no usages', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_EMPTY);
    assert.equal(plan.steps.length, 0);
    assert.ok(plan.warnings.length > 0);
    assert.equal(plan.summary.totalUsages, 0);
  });

  // ── 3. generateMigrationPlan — single usage ──
  it('3.1 generateMigrationPlan produces minimal plan for single usage', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_SINGLE);
    assert.ok(plan.api, 'should have api');
    assert.equal(plan.api.symbol, 'simpleFunc');
    assert.ok(plan.steps.length >= 2, 'should have at least analyze + verify steps');
    assert.equal(plan.summary.totalUsages, 1);
    assert.equal(plan.summary.filesAffected, 1);
    assert.equal(plan.warnings.length, 0, 'single usage should not trigger warnings');
  });

  // ── 4. generateMigrationPlan — mixed patterns ──
  it('4.1 generateMigrationPlan classifies patterns correctly', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_DIRECT);
    assert.ok(plan.steps.length >= 5, 'should have 5+ steps for mixed patterns');
    assert.equal(plan.summary.totalUsages, 8);
    assert.equal(plan.summary.filesAffected, 7); // 7 unique files in sample

    // Should have a direct-call step
    const replaceStep = plan.steps.find(s => s.action === 'replace');
    assert.ok(replaceStep, 'should have replace step for direct calls');

    // Should have event handler step
    const handlerStep = plan.steps.find(s => s.action === 'update-handler');
    assert.ok(handlerStep, 'should have event handler step');
    assert.equal(handlerStep.risk, 'high', 'event handler should be high risk');

    // Should have class method step
    const classStep = plan.steps.find(s => s.action === 'update-class');
    assert.ok(classStep, 'should have class method step');

    // Safety gate should trigger (>5 files, threshold default 5)
    assert.ok(plan.warnings.length > 0, 'should have safety warning for 6 files');
  });

  it('4.2 generateMigrationPlan respects safetyThreshold', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_DIRECT, { safetyThreshold: 10 });
    const thresholdWarnings = plan.warnings.filter(w => w.includes('threshold'));
    assert.equal(thresholdWarnings.length, 0, 'should not warn when threshold=10 and only 6 files');
  });

  it('4.3 generateMigrationPlan with newApi includes replacement info', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_DIRECT, { newApi: 'newApi_v2' });
    assert.equal(plan.api.newApi, 'newApi_v2');
    assert.ok(plan.summary.goal.includes('Migrate usages of oldApi'));
  });

  it('4.4 generateMigrationPlan excludes specified files', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_DIRECT, { excludeFiles: ['src/math.ts', 'src/format.ts'] });
    // math.ts and format.ts should be excluded
    const allFiles = plan.steps.flatMap(s => s.affectedFiles || []);
    assert.ok(!allFiles.includes('src/math.ts'), 'should exclude math.ts');
    assert.ok(!allFiles.includes('src/format.ts'), 'should exclude format.ts');
  });

  // ── 5. Steps ordering ──
  it('5.1 steps are ordered with analyze first and verify last', () => {
    const plan = generateMigrationPlan(SAMPLE_USAGE_DIRECT);
    assert.equal(plan.steps[0].action, 'analyze', 'first step should be analyze');
    assert.equal(plan.steps[plan.steps.length - 1].action, 'verify', 'last step should be verify');
    // Steps should be sequential
    for (let i = 0; i < plan.steps.length; i++) {
      assert.equal(plan.steps[i].step, i + 1, `step ${i} should have correct number`);
    }
  });
});
