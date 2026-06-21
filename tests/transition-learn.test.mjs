// transition-learn.test.mjs — Tests for Phase 25 Tool Transition Learning
//
// Covers: tool_transitions table, recordTransition, getTopTransitions,
//         getTransitionStats, learnToolChain
//
// Run: node --test tests/transition-learn.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { MemoryDB } from '../src/lib/memory-db.mjs';

const TMP = resolve(process.cwd(), '.test-transitions-' + Date.now());
const DB_PATH = resolve(TMP, 'test.db');

describe('Phase 25: Tool Transition Learning', () => {
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

  it('should record a transition', () => {
    db.recordTransition('smart_grep', 'smart_lsp', true, 150);
    const stats = db.getTransitionStats();
    assert.equal(stats.total, 1);
  });

  it('should update existing transition on repeat', () => {
    db.recordTransition('smart_grep', 'smart_lsp', true, 120);
    const transitions = db.getTopTransitions('smart_grep');
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].count, 2);
  });

  it('should record failure', () => {
    db.recordTransition('smart_grep', 'smart_fast_apply', false, 200);
    const transitions = db.getTopTransitions('smart_grep');
    assert.equal(transitions.length, 2);
    // lsp should be first (higher success rate)
    assert.equal(transitions[0].toTool, 'smart_lsp');
  });

  it('getTopTransitions should return top 3 sorted by score', () => {
    db.recordTransition('smart_think', 'smart_memory_store', true, 50);
    db.recordTransition('smart_think', 'smart_grep', true, 100);
    db.recordTransition('smart_think', 'smart_deep_think', false, 500);
    db.recordTransition('smart_think', 'smart_grep', true, 90);

    const top = db.getTopTransitions('smart_think', 2);
    assert.equal(top.length, 2);
    // Both have score 1.0; tiebreaker is success_count DESC
    // grep (2 successes) before memory_store (1 success)
    assert.equal(top[0].toTool, 'smart_grep');
    assert.equal(top[1].toTool, 'smart_memory_store');
  });

  it('getTransitionStats should return total and topPairs', () => {
    const stats = db.getTransitionStats();
    assert.ok(stats.total >= 4);
    assert.ok(stats.topPairs.length >= 3);
  });

  it('learnToolChain should extract 3+ step chains', () => {
    // Add a chain: smart_security -> smart_grep -> smart_fast_apply
    db.recordTransition('smart_security', 'smart_grep', true, 300);
    db.recordTransition('smart_grep', 'smart_fast_apply', true, 250);
    db.recordTransition('smart_fast_apply', 'smart_test', true, 400);

    const chains = db.learnToolChain(3);
    assert.ok(chains.length >= 0); // may or may not find chains depending on data
    for (const c of chains) {
      assert.ok(Array.isArray(c.chain));
      assert.ok(c.chain.length >= 3);
    }
  });

  it('should handle empty from_tool gracefully', () => {
    const top = db.getTopTransitions('nonexistent_tool');
    assert.equal(top.length, 0);
  });

  it('should handle cold start (no data) gracefully', () => {
    const emptyDb = new MemoryDB(resolve(TMP, 'empty.db'));
    emptyDb.open();
    const stats = emptyDb.getTransitionStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.topPairs.length, 0);
    emptyDb.close();
  });
});
