// compose-engine.test.mjs — Tests for tool composition engine
//
// Covers: executePipeline (empty, seq, par, cond modes), executeTool
// Note: executeTool spawns CLI processes — tested via executePipeline integration
//
// Run: node --test tests/compose-engine.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executePipeline } from '../src/lib/compose-engine.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executePipeline', () => {

  it('returns error for empty pipeline', async () => {
    const r = await executePipeline([]);
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });

  it('returns error for null/undefined pipeline', async () => {
    const r = await executePipeline(null);
    assert.equal(r.ok, false);
  });

  it('handles unknown tool gracefully (seq mode)', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'seq' },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].ok, false);
    assert.ok(r.results[0].error, 'should have error message');
  });

  it('handles unknown tool gracefully (par mode)', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'par' },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.results.length, 1);
  });

  it('unknown mode defaults to seq', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'unknown_mode' },
    ]);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].mode, 'seq');
  });

  it('cond mode records condition result', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'seq' },
      {
        tool: 'smart_grep',
        args: {},
        mode: 'cond',
        condition: { onField: 'output', match: 'error', then: [], else: [] },
      },
    ]);
    // Should have 2 results: the failed seq step + the cond record
    assert.ok(r.results.length >= 2);
    const condResult = r.results.find(rr => rr.mode === 'cond');
    assert.ok(condResult, 'should have cond result');
    assert.equal(typeof condResult.conditionResult, 'boolean');
  });

  it('cond mode with then branch executes branch', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'seq' },
      {
        tool: 'smart_grep',
        args: {},
        mode: 'cond',
        condition: {
          onField: 'error',
          match: 'Resolve',
          then: [{ tool: 'nonexistent_tool', args: {}, mode: 'seq' }],
          else: [],
        },
      },
    ]);
    const condResult = r.results.find(rr => rr.mode === 'cond');
    assert.ok(condResult);
    assert.equal(condResult.conditionResult, true);
  });

  it('cond mode with else branch when no match', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'seq' },
      {
        tool: 'smart_grep',
        args: {},
        mode: 'cond',
        condition: {
          onField: 'error',
          match: 'ZZZ_NONEXISTENT_ZZZ',
          then: [],
          else: [{ tool: 'nonexistent_tool', args: {}, mode: 'seq' }],
        },
      },
    ]);
    const condResult = r.results.find(rr => rr.mode === 'cond');
    assert.ok(condResult);
    assert.equal(condResult.conditionResult, false);
  });

  it('parallel mode runs multiple tools', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'par' },
      { tool: 'nonexistent_tool2', args: {}, mode: 'par' },
    ]);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].mode, 'par');
    assert.equal(r.results[1].mode, 'par');
  });

  it('results include step index and tool name', async () => {
    const r = await executePipeline([
      { tool: 'smart_grep', args: { pattern: 'test' }, mode: 'seq' },
    ]);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].step, 0);
    assert.equal(r.results[0].tool, 'smart_grep');
  });

  it('pipeline ok is false when any step fails', async () => {
    const r = await executePipeline([
      { tool: 'nonexistent_tool', args: {}, mode: 'seq' },
    ]);
    assert.equal(r.ok, false);
  });
});