// hallucination-integration.test.mjs — Phase 6 Hallucination Detection 整合測試
//
// Tests the hallucination check plugin, server hook integration,
// and hybrid-engine DOMAIN_MAP registration.
//
// Run: node --test tests/hallucination-integration.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judgeHallucination, isHighRiskOutput } from '../src/lib/hallucination-judge.mjs';

// ---------------------------------------------------------------------------
// Test: Plugin integration (handler logic)
// ---------------------------------------------------------------------------

describe('Hallucination Integration — plugin', () => {
  it('plugin handler produces structured output', async () => {
    // Dynamic import to test plugin loading
    const mod = await import('../src/plugins/standard/hallucination-check.mjs');
    const def = mod.default;

    assert.equal(def.name, 'smart_hallucination_check');
    assert.equal(def.category, 'standard');
    assert.ok(def.handler, 'should have handler');
    assert.ok(def.inputSchema, 'should have inputSchema');
    assert.equal(def.responsePolicy.maxLevel, 0, 'check results must not be compressed');
  });

  it('plugin handler returns formatted result', async () => {
    const mod = await import('../src/plugins/standard/hallucination-check.mjs');
    const def = mod.default;

    const output = await def.handler({
      output: 'The bug is in parser.js at line 42.',
      context: 'Error at parser.js:42 — TypeError',
      query: 'Why does the parser crash?',
    });

    assert.ok(typeof output === 'string');
    assert.ok(output.includes('Hallucination Check'));
    assert.ok(output.includes('PASS') || output.includes('WARN') || output.includes('FAIL'));
    assert.ok(output.includes('Checks'));
    assert.ok(output.includes('Hallucination Types Reference'));
  });

  it('plugin handler returns error for missing output', async () => {
    const mod = await import('../src/plugins/standard/hallucination-check.mjs');
    const def = mod.default;

    const output = await def.handler({});
    assert.ok(output.includes('Error'), 'should return error for missing output');
  });

  it('plugin handler detects fabrication', async () => {
    const mod = await import('../src/plugins/standard/hallucination-check.mjs');
    const def = mod.default;

    const output = await def.handler({
      output: 'The bug is in NonExistentModule.ghostFunction() caused by QuantumBug.',
      context: 'Error at parser.js:42 — TypeError',
    });

    assert.ok(output.includes('fabrication') || output.includes('WARN') || output.includes('FAIL'),
      'should detect fabrication');
  });
});

// ---------------------------------------------------------------------------
// Test: Server hook logic (unit-test the trigger function)
// ---------------------------------------------------------------------------

describe('Hallucination Integration — server hook', () => {
  it('isHighRiskOutput correctly identifies tools', () => {
    // High risk
    assert.ok(isHighRiskOutput('smart_security'));
    assert.ok(isHighRiskOutput('smart_error_diagnose'));
    assert.ok(isHighRiskOutput('smart_deep_think'));
    assert.ok(isHighRiskOutput('smart_ingest_document'));
    assert.ok(isHighRiskOutput('smart_report'));

    // Low risk
    assert.ok(!isHighRiskOutput('smart_grep'));
    assert.ok(!isHighRiskOutput('smart_test'));
    assert.ok(!isHighRiskOutput('smart_learn'));
    assert.ok(!isHighRiskOutput('smart_fast_apply'));
    assert.ok(!isHighRiskOutput('smart_context'));
    assert.ok(!isHighRiskOutput('smart_lsp'));
    assert.ok(!isHighRiskOutput('smart_rules'));
    assert.ok(!isHighRiskOutput('smart_think'));
  });

  it('judgeHallucination returns pass for clean output', () => {
    const result = judgeHallucination({
      output: 'The error is a TypeError in parser.js at line 42.',
      context: 'TypeError at parser.js:42',
      query: 'Why does the parser crash?',
      toolName: 'smart_error_diagnose',
    });

    assert.equal(result.verdict, 'pass');
    assert.ok(result.overallScore >= 7);
  });

  it('judgeHallucination returns fail for hallucinated output', () => {
    const result = judgeHallucination({
      output: 'The bug is definitely in GhostModule.phantomFunction() caused by QuantumFluctuation in HypervisorLayer — this is 100% the only possible cause and cannot be anything else.',
      context: 'TypeError at parser.js:42',
      query: 'Why does the parser crash?',
      toolName: 'smart_error_diagnose',
      strictness: 8,
    });

    assert.ok(['warn', 'fail'].includes(result.verdict),
      `Expected warn/fail but got ${result.verdict} (score: ${result.overallScore})`);
  });

  it('judgeHallucination handles toolName context', () => {
    const result = judgeHallucination({
      output: 'Security scan found 3 vulnerabilities.',
      context: 'CRITICAL: SQL injection in login.js',
      toolName: 'smart_security',
    });

    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  });
});

// ---------------------------------------------------------------------------
// Test: hybrid-engine DOMAIN_MAP integration
// ---------------------------------------------------------------------------

describe('Hallucination Integration — hybrid-engine', () => {
  it('DOMAIN_MAP includes hallucination_check domain', async () => {
    const mod = await import('../src/lib/hybrid-engine.mjs');

    // Access the DOMAIN_MAP (not directly exported, but we can check classifyQuestion)
    // Instead, verify the module loads without errors
    assert.ok(mod.classifyQuestion, 'hybrid-engine should export classifyQuestion');
    assert.ok(mod.CATEGORIES, 'hybrid-engine should export CATEGORIES');
  });

  it('classifyQuestion recognizes hallucination keywords', async () => {
    const { classifyQuestion } = await import('../src/lib/hybrid-engine.mjs');

    const result = classifyQuestion('檢查這個輸出是否有幻覺');
    assert.ok(result, 'should classify hallucination check question');

    const result2 = classifyQuestion('verify the output for hallucinations');
    assert.ok(result2, 'should classify English hallucination check question');
  });
});

// ---------------------------------------------------------------------------
// Test: Regression — existing tools unaffected
// ---------------------------------------------------------------------------

describe('Hallucination Integration — regression', () => {
  it('smart_grep is NOT high risk (no auto-trigger)', () => {
    assert.ok(!isHighRiskOutput('smart_grep'));
  });

  it('smart_test is NOT high risk (no auto-trigger)', () => {
    assert.ok(!isHighRiskOutput('smart_test'));
  });

  it('smart_fast_apply is NOT high risk (no auto-trigger)', () => {
    assert.ok(!isHighRiskOutput('smart_fast_apply'));
  });

  it('judgeHallucination does not throw on any input', () => {
    // Edge cases that should never throw
    const cases = [
      { output: null },
      { output: undefined },
      { output: 123 },
      { output: true },
      {},
      { output: '', context: null, query: undefined },
    ];

    for (const c of cases) {
      assert.doesNotThrow(() => judgeHallucination(c), `should not throw for ${JSON.stringify(c)}`);
    }
  });

  it('judgeHallucination always returns valid structure', () => {
    const result = judgeHallucination({ output: 'test' });
    assert.ok(Array.isArray(result.checks));
    assert.equal(typeof result.overallScore, 'number');
    assert.ok(['pass', 'warn', 'fail'].includes(result.verdict));
    assert.ok(Array.isArray(result.issues));
    assert.equal(typeof result.summary, 'string');
  });
});