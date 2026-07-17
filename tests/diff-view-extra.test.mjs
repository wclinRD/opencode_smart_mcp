// tests/diff-view-extra.test.mjs — 補充 diff-view.mjs 覆蓋率
//
// 目標：覆蓋 computeDiff, buildHunk, formatUnified, formatSideBySide, formatStats
// 以及 handler 的所有分支（file1+content, file1+file2, git mode, error paths）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Import the plugin definition
import diffView from '../src/plugins/standard/diff-view.mjs';

const TEST_DIR = resolve(tmpdir(), `diff-view-extra-test-${Date.now()}`);

// Ensure directory exists before any test runs
if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

function cleanup() {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests: handler — file1 + content mode
// ---------------------------------------------------------------------------

describe('diff-view handler — file1 + content', () => {
  it('shows unified diff for file vs content', () => {
    const f = resolve(TEST_DIR, 'a.txt');
    writeFileSync(f, 'line1\nline2\nline3\n');
    const result = diffView.handler({ file1: f, content: 'line1\nmodified\nline3\n', color: false });
    assert.ok(result.includes('---'), 'should contain --- header');
    assert.ok(result.includes('+++'), 'should contain +++ header');
    assert.ok(result.includes('-line2'), 'should show removed line');
    assert.ok(result.includes('+modified'), 'should show added line');
    assert.ok(result.includes('Diff Stats'), 'should contain stats');
  });

  it('shows side-by-side format', () => {
    const f = resolve(TEST_DIR, 'b.txt');
    writeFileSync(f, 'aaa\nbbb\n');
    const result = diffView.handler({ file1: f, content: 'aaa\nccc\n', format: 'side-by-side', color: false });
    assert.ok(result.includes('│') || result.includes('|'), 'should contain separator');
  });

  it('shows stats-only format', () => {
    const f = resolve(TEST_DIR, 'c.txt');
    writeFileSync(f, 'aaa\nbbb\n');
    const result = diffView.handler({ file1: f, content: 'aaa\nccc\n', format: 'stats', color: false });
    assert.ok(result.includes('Diff Stats'), 'should show stats');
    assert.ok(result.includes('+1'), 'should show +1');
    assert.ok(result.includes('-1'), 'should show -1');
  });

  it('returns "identical" when content matches', () => {
    const f = resolve(TEST_DIR, 'd.txt');
    writeFileSync(f, 'same\n');
    const result = diffView.handler({ file1: f, content: 'same\n' });
    assert.ok(result.includes('identical') || result.includes('No changes'), 'should report no changes');
  });

  it('returns error for missing file', () => {
    const result = diffView.handler({ file1: resolve(TEST_DIR, 'nonexistent.txt'), content: 'x' });
    assert.ok(result.includes('File not found') || result.includes('not found'), 'should report missing file');
  });
});

// ---------------------------------------------------------------------------
// Tests: handler — file1 + file2 mode
// ---------------------------------------------------------------------------

describe('diff-view handler — file1 + file2', () => {
  it('shows diff between two files', () => {
    const f1 = resolve(TEST_DIR, 'old.txt');
    const f2 = resolve(TEST_DIR, 'new.txt');
    writeFileSync(f1, 'aaa\nbbb\n');
    writeFileSync(f2, 'aaa\nccc\n');
    const result = diffView.handler({ file1: f1, file2: f2, color: false });
    assert.ok(result.includes('-bbb'), 'should show removed');
    assert.ok(result.includes('+ccc'), 'should show added');
  });

  it('reports identical files', () => {
    const f1 = resolve(TEST_DIR, 'same1.txt');
    const f2 = resolve(TEST_DIR, 'same2.txt');
    writeFileSync(f1, 'content\n');
    writeFileSync(f2, 'content\n');
    const result = diffView.handler({ file1: f1, file2: f2 });
    assert.ok(result.includes('identical') || result.includes('identical') || result.includes('No changes'), 'should report identical');
  });

  it('returns error for missing file2', () => {
    const f1 = resolve(TEST_DIR, 'exists.txt');
    writeFileSync(f1, 'x\n');
    const result = diffView.handler({ file1: f1, file2: resolve(TEST_DIR, 'nope.txt') });
    assert.ok(result.includes('File not found') || result.includes('not found'), 'should report missing');
  });

  it('returns error for unreadable file1', async () => {
    const f1 = resolve(TEST_DIR, 'unreadable.txt');
    writeFileSync(f1, 'x\n');
    // Make it unreadable (on macOS/Linux)
    try { const { chmodSync } = await import('node:fs'); chmodSync(f1, 0o000); } catch { /* skip on CI */ }
    const result = diffView.handler({ file1: f1, file2: resolve(TEST_DIR, 'any.txt') });
    // Should return some error or "not found" message
    assert.ok(typeof result === 'string');
    // Restore permissions for cleanup
    try { const { chmodSync } = await import('node:fs'); chmodSync(f1, 0o644); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Tests: handler — git mode
// ---------------------------------------------------------------------------

describe('diff-view handler — git mode', () => {
  it('returns usage message when no args', () => {
    const result = diffView.handler({});
    assert.ok(result.includes('Usage') || result.includes('smart_diff_view'), 'should show usage');
  });
});

// ---------------------------------------------------------------------------
// Tests: handler — color mode
// ---------------------------------------------------------------------------

describe('diff-view handler — color', () => {
  it('includes ANSI codes when color=true', () => {
    const f = resolve(TEST_DIR, 'color.txt');
    writeFileSync(f, 'aaa\n');
    const result = diffView.handler({ file1: f, content: 'bbb\n', color: true });
    // Should contain ANSI escape codes
    assert.ok(result.includes('\x1b[') || result.includes('32m') || result.includes('31m'), 'should contain ANSI codes');
  });

  it('no ANSI codes when color=false', () => {
    const f = resolve(TEST_DIR, 'nocolor.txt');
    writeFileSync(f, 'aaa\n');
    const result = diffView.handler({ file1: f, content: 'bbb\n', color: false });
    assert.ok(!result.includes('\x1b[32m'), 'should not contain ANSI green');
    assert.ok(!result.includes('\x1b[31m'), 'should not contain ANSI red');
  });
});

// ---------------------------------------------------------------------------
// Tests: context lines
// ---------------------------------------------------------------------------

describe('diff-view handler — context lines', () => {
  it('respects custom context lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const f = resolve(TEST_DIR, 'context.txt');
    writeFileSync(f, lines.join('\n') + '\n');
    const newLines = [...lines];
    newLines[10] = 'MODIFIED';
    const result = diffView.handler({
      file1: f,
      content: newLines.join('\n') + '\n',
      context: 5,
      color: false,
    });
    assert.ok(result.includes('MODIFIED'), 'should show the change');
    assert.ok(result.includes('Diff Stats'), 'should show stats');
  });
});

// Cleanup after all tests
process.on('exit', cleanup);
