// memory-integration.test.mjs — Tests for smart-agent memory auto-integration

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRemember,
  buildStoreCommand,
  formatMemoryResult,
} from '../src/agent/memory-integration.mjs';

describe('shouldRemember', () => {
  it('remembers failed error diagnosis', () => {
    const result = shouldRemember('smart_error_diagnose', { error: 'TypeError' }, { ok: false });
    assert.ok(result);
    assert.equal(result.type, 'resolution');
    assert.equal(result.score, 0.9);
  });

  it('remembers successful cross-file edit', () => {
    const result = shouldRemember('smart_cross_file_edit', {}, { ok: true });
    assert.ok(result);
    assert.equal(result.type, 'refactor-success');
  });

  it('remembers failed cross-file edit', () => {
    const result = shouldRemember('smart_cross_file_edit', {}, { ok: false });
    assert.ok(result);
    assert.equal(result.type, 'refactor-failure');
  });

  it('remembers security findings', () => {
    const result = shouldRemember('smart_security', {}, { ok: true, findings: ['vuln'] });
    assert.ok(result);
    assert.equal(result.type, 'security-pattern');
  });

  it('remembers debug with root cause', () => {
    const result = shouldRemember('smart_debug', {}, { ok: true, rootCause: 'null pointer' });
    assert.ok(result);
    assert.equal(result.type, 'debug-pattern');
  });

  it('does not remember grep calls', () => {
    const result = shouldRemember('smart_grep', { pattern: 'foo' }, { ok: true });
    assert.equal(result, null);
  });

  it('does not remember successful test runs', () => {
    const result = shouldRemember('smart_test', {}, { ok: true });
    assert.equal(result, null);
  });
});

describe('buildStoreCommand', () => {
  it('builds command for failed diagnosis', () => {
    const mem = shouldRemember('smart_error_diagnose', { error: 'TypeError' }, { ok: false });
    const cmd = buildStoreCommand('smart_error_diagnose', { error: 'TypeError' }, { ok: false }, mem);
    assert.ok(cmd.command.startsWith('smart_memory_store'));
    assert.ok(cmd.command.includes('TypeError'));
    assert.ok(cmd.storeArgs.success === false);
  });
});

describe('formatMemoryResult', () => {
  it('formats no results message', () => {
    const msg = formatMemoryResult({ ok: true, results: [] });
    assert.equal(msg, 'No relevant memories found.');
  });

  it('formats null as no results', () => {
    const msg = formatMemoryResult(null);
    assert.equal(msg, 'No relevant memories found.');
  });

  it('formats entries when found', () => {
    const msg = formatMemoryResult({
      ok: true,
      entries: [
        { category: 'runtime', resolution: 'Use const instead of var', hitCount: 3 },
      ],
    });
    assert.ok(msg.includes('runtime'));
    assert.ok(msg.includes('Use const instead of var'));
    assert.ok(msg.includes('3'));
  });
});
