// compose.test.mjs — Phase 6 Compose Engine tests
//
// Tests compose-engine.mjs executePipeline + executeTool:
//   1. Empty pipeline → error
//   2. Unknown tool → graceful error (not thrown)
//   3. executeTool returns structured result format
//   4. Sequential pipeline with real tools
//   5. Parallel grouping
//   6. Error propagation in pipeline
//   7. Mixed seq/par pipeline
//
// Run: node --test tests/compose.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline, executeTool } from '../src/lib/compose-engine.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 6: Compose Engine', () => {

  // ── 1. Empty pipeline ──
  it('1.1 rejects empty pipeline', async () => {
    const r = await executePipeline([]);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('Empty'));
  });

  it('1.2 rejects null pipeline', async () => {
    const r = await executePipeline(null);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('Empty'));
  });

  // ── 2. Unknown tool ──
  it('2.1 handles unknown tool gracefully', async () => {
    const r = await executePipeline([{ tool: 'smart_nonexistent', args: {}, mode: 'seq' }]);
    assert.equal(r.ok, false);
    assert.ok(r.results[0].error && r.results[0].error.includes('Resolve error'),
      `Expected resolve error, got: ${r.results[0].error}`);
  });

  // ── 3. Tool execution result format ──
  it('3.1 executeTool returns structured result', async () => {
    const r = await executeTool('smart_grep', { pattern: 'describe', include: '*.test.mjs', format: 'text', filesOnly: true, maxMatches: 2, noColor: true });
    // Should succeed or fail gracefully (both valid)
    assert.ok('ok' in r, 'should have ok');
    assert.ok('output' in r, 'should have output');
    assert.ok('duration' in r, 'should have duration');
    assert.ok('error' in r, 'should have error');
    assert.equal(typeof r.output, 'string');
    assert.equal(typeof r.duration, 'number');
  });

  it('3.2 executeTool reports duration >= 0', { timeout: 10000 }, async () => {
    const r = await executeTool('smart_grep', { pattern: 'test', include: '*.mjs', format: 'text', filesOnly: true, maxMatches: 2, noColor: true });
    assert.ok(r.duration >= 0, `duration should be >= 0, got ${r.duration}`);
  });

  // ── 4. Sequential pipeline with real tools ──
  it('4.1 executes seq pipeline with smart_grep', { timeout: 10000 }, async () => {
    const r = await executePipeline([
      { tool: 'smart_grep', args: { pattern: 'import', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 2 }, mode: 'seq' },
    ]);
    // Pipeline should succeed or fail gracefully
    assert.ok(r.results.length > 0, 'should have results');
    assert.ok('ok' in r.results[0], 'result should have ok');
    assert.ok('output' in r.results[0], 'result should have output');
  });

  // ── 5. Parallel group ──
  it('5.1 parallel group executes all steps', { timeout: 10000 }, async () => {
    const start = Date.now();
    const r = await executePipeline([
      { tool: 'smart_grep', args: { pattern: 'import', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 1 }, mode: 'par' },
      { tool: 'smart_grep', args: { pattern: 'export', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 1 }, mode: 'par' },
    ]);
    const elapsed = Date.now() - start;
    assert.equal(r.results.length, 2, 'parallel should produce 2 results');
    // Both parallel tools should report mode 'par'
    assert.equal(r.results[0].mode, 'par', 'first step should be par');
    assert.equal(r.results[1].mode, 'par', 'second step should be par');
    // Parallel should not be slower than sequential would be
    assert.ok(elapsed < 10000, `Parallel should be fast: ${elapsed}ms`);
  });

  // ── 6. Mixed seq+par pipeline ──
  it('6.1 mixed seq+par pipeline returns all results', { timeout: 15000 }, async () => {
    const r = await executePipeline([
      { tool: 'smart_grep', args: { pattern: 'import', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 1 }, mode: 'seq' },
      { tool: 'smart_grep', args: { pattern: 'export', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 1 }, mode: 'par' },
      { tool: 'smart_grep', args: { pattern: 'function', include: '*.mjs', format: 'text', filesOnly: true, noColor: true, maxMatches: 1 }, mode: 'par' },
    ]);
    assert.equal(r.results.length, 3, 'mixed pipeline should produce 3 results');
    assert.equal(r.results[0].mode, 'seq', 'step 0 should be seq');
    assert.equal(r.results[1].mode, 'par', 'step 1 should be par');
    assert.equal(r.results[2].mode, 'par', 'step 2 should be par');
  });

  // ── 7. Pipeline result structure ──
  it('7.1 pipeline result has correct structure', async () => {
    const r = await executePipeline([
      { tool: 'smart_nonexistent', args: {}, mode: 'seq' },
    ]);
    assert.equal(r.ok, false);
    assert.ok(Array.isArray(r.results), 'results should be array');
    assert.equal(r.results[0].ok, false, 'failed step should have ok=false');
  });

});
