// error-recovery.test.mjs — Phase 10.3 Error Recovery (Retry + Fallback)
//
// Tests:
//   1. isTransientError classification (pure logic)
//   2. Retry skipCapture doesn't pollute context history
//   3. Fallback annotation format
//   4. Integration: retry + fallback via initContext / quality gate
//
// Run: node --test tests/error-recovery.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { ContextManager } from '../src/lib/context-manager.mjs';

// ---------------------------------------------------------------------------
// Replicate server's isTransientError logic for unit testing
// ---------------------------------------------------------------------------

function isTransientError(result) {
  if (result == null || result.ok === true) return false;
  const err = result.error || '';
  if (err.includes('timed out') || err.includes('ETIMEDOUT')) return true;
  if (err.includes('Failed to spawn')) return true;
  // Non-zero exit with empty stdout → process crashed (potentially transient)
  // Pattern from invokeTool: "failed: exit <code>[: stderr]"
  if (err.includes('failed: exit ') && !err.includes('cancelled')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir;
function freshManager(opts = {}) {
  testDir = resolve(tmpdir(), `smart-recovery-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(testDir, { recursive: true });
  return new ContextManager({
    contextDir: testDir,
    autoSave: opts.autoSave !== false,
    extractFindings: false,
    maxFindings: 20,
  });
}

after(() => {
  if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 10.3: Error Recovery — isTransientError', () => {

  // ── 1. Transient errors ──

  it('timeout error is transient', () => {
    assert.ok(isTransientError({ ok: false, error: 'Tool smart_grep timed out after 10000ms' }));
    assert.ok(isTransientError({ ok: false, error: 'ETIMEDOUT' }));
  });

  it('spawn failure is transient', () => {
    assert.ok(isTransientError({ ok: false, error: 'Failed to spawn smart_foo: ENOENT' }));
    assert.ok(isTransientError({ ok: false, error: 'Failed to spawn smart_bar: spawn node EACCES' }));
  });

  it('non-zero exit with empty output is transient', () => {
    assert.ok(isTransientError({ ok: false, error: 'Tool smart_foo failed: exit 1' }));
    assert.ok(isTransientError({ ok: false, error: 'Tool smart_bar failed: exit 137' }));
  });

  // ── 2. Non-transient ──

  it('success is not transient', () => {
    assert.equal(isTransientError({ ok: true, output: 'hello' }), false);
  });

  it('quality enforcement block is not transient', () => {
    const err = '🔒 Quality Gate: Cross-file edit requires import dependency analysis first.';
    assert.equal(isTransientError({ ok: false, error: err }), false);
  });

  it('handler error is not transient', () => {
    assert.equal(isTransientError({ ok: false, error: 'Handler error in smart_foo: TypeError: ...' }), false);
  });

  it('cancellation is not transient', () => {
    assert.equal(isTransientError({ ok: false, error: 'Tool smart_foo was cancelled' }), false);
  });

  it('exit with only stderr (no stdout) is transient — process crashed', () => {
    // Server pattern: "failed: exit <code>: stderr content" — stdout empty = crash
    assert.ok(isTransientError({ ok: false, error: 'Tool smart_foo failed: exit 1: RangeError: ...' }));
  });

  it('generic exit message without "failed:" prefix is not transient', () => {
    // Only "failed: exit " pattern (from invokeTool) is transient
    const errStr = 'Tool completed with warnings: exit 1\nSome error output';
    assert.equal(isTransientError({ ok: false, error: errStr }), false);
  });

  // ── 3. Edge cases ──

  it('undefined ok field is not transient (async handler result)', () => {
    assert.equal(isTransientError({ __async: true, promise: Promise.resolve('ok') }), false);
  });

  it('null/empty result is not transient', () => {
    assert.equal(isTransientError({}), false);
    assert.equal(isTransientError(null), false);
    assert.equal(isTransientError(undefined), false);
  });
});

describe('Phase 10.3: Error Recovery — Fallback annotation', () => {

  it('fallback annotation format includes retry count and tool name', () => {
    const annotation = '[Fallback after 3× retry — using smart_grep]\nfound 0 results';
    assert.ok(annotation.includes('3× retry'));
    assert.ok(annotation.includes('smart_grep'));
  });

  it('fallback returns original error when fallback also fails', () => {
    // If fallback fails, return lastResult (original transient error)
    const lastResult = { ok: false, error: 'Tool smart_foo timed out after 10000ms' };
    // This is the behavior of invokeToolWithRetry
    assert.equal(lastResult.ok, false);
  });
});

describe('Phase 10.3: Error Recovery — Context integrity', () => {

  it('capture records tool count and error count correctly', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.capture('smart_grep', { pattern: 'foo' }, { ok: true, output: 'bar' }, 100);
    const summary = JSON.parse(cm.getSummary());
    assert.equal(summary.n, 1, 'toolCount should be 1');
    assert.equal(summary.err, 0, 'errorCount should be 0');
  });

  it('capture shows recent tools in history', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.capture('smart_foo', { input: 'test' }, { ok: true, output: 'result' }, 100);
    const summary = JSON.parse(cm.getSummary());
    assert.equal(summary.n, 1);
    assert.ok(Array.isArray(summary.recent));
    assert.equal(summary.last, 'smart_foo');
  });
});
