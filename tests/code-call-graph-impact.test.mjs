// tests/code-call-graph-impact.test.mjs — 補充 code-call-graph.mjs + code-impact.mjs 覆蓋率
//
// 測試不需要 LSP 的路徑：error paths, formatGraph, parseDiff, handler 結構

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import codeCallGraph from '../src/plugins/standard/code-call-graph.mjs';
import codeImpact from '../src/plugins/standard/code-impact.mjs';

// ---------------------------------------------------------------------------
// code-call-graph
// ---------------------------------------------------------------------------

describe('code-call-graph — structure', () => {
  it('exports valid plugin', () => {
    assert.equal(codeCallGraph.name, 'smart_code_call_graph');
    assert.equal(typeof codeCallGraph.handler, 'function');
  });

  it('has required input parameters', () => {
    const props = codeCallGraph.inputSchema.properties;
    assert.ok(props.file);
    assert.ok(props.symbol);
    assert.ok(props.direction);
    assert.ok(props.depth);
    assert.ok(props.format);
  });
});

describe('code-call-graph — handler error paths', () => {
  it('returns error for non-existent file', async () => {
    const result = await codeCallGraph.handler({
      file: '/nonexistent/path.js',
      symbol: 'foo',
      root: '/tmp',
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('not found') || result.includes('File not found'));
  });

  it('returns json format for non-existent file', async () => {
    const result = await codeCallGraph.handler({
      file: '/nonexistent/path.js',
      symbol: 'foo',
      format: 'json',
      root: '/tmp',
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('not found') || result.includes('File not found'));
  });
});

// ---------------------------------------------------------------------------
// code-impact
// ---------------------------------------------------------------------------

describe('code-impact — structure', () => {
  it('exports valid plugin', () => {
    assert.equal(codeImpact.name, 'smart_code_impact');
    assert.equal(typeof codeImpact.handler, 'function');
  });

  it('has input parameters', () => {
    const props = codeImpact.inputSchema.properties;
    assert.ok(props.files);
    assert.ok(props.symbols);
    assert.ok(props.diff);
    assert.ok(props.depth);
    assert.ok(props.format);
  });
});

describe('code-impact — handler error paths', () => {
  it('returns error when no args provided', async () => {
    const result = await codeImpact.handler({});
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Provide either'));
  });

  it('returns message for empty diff', async () => {
    const result = await codeImpact.handler({ diff: 'just some random text\nno diff here' });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('No changes detected') || result.includes('No downstream'));
  });

  it('returns no-change for truly empty diff', async () => {
    const result = await codeImpact.handler({ diff: '' });
    assert.ok(typeof result === 'string');
  });

  it('parses diff with file changes and returns analysis', async () => {
    const diff = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '@@ -10,6 +10,8 @@ export function login() {',
      '   // existing code',
      '+  const newThing = true;',
      '+  return newThing;',
      ' }',
    ].join('\n');
    const result = await codeImpact.handler({ diff, root: '/tmp' });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Impact Analysis'));
  });

  it('returns json format', async () => {
    const diff = [
      'diff --git a/src/util.ts b/src/util.ts',
      '--- a/src/util.ts',
      '+++ b/src/util.ts',
      '@@ -5,3 +5,5 @@',
      '+export function helper() {}',
    ].join('\n');
    const result = await codeImpact.handler({ diff, format: 'json', root: '/tmp' });
    assert.ok(typeof result === 'string');
    const parsed = JSON.parse(result);
    assert.ok(parsed.direct !== undefined);
    assert.ok(typeof parsed.totalFiles === 'number');
    assert.ok(typeof parsed.totalSymbols === 'number');
  });

  it('handles files array input', async () => {
    const result = await codeImpact.handler({
      files: ['src/auth.ts', 'src/util.ts'],
      root: '/tmp',
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Impact Analysis'));
  });

  it('handles files with depth > 1', async () => {
    const result = await codeImpact.handler({
      files: ['src/auth.ts'],
      depth: 2,
      root: '/tmp',
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Impact Analysis'));
  });

  it('handles files with specific symbols', async () => {
    const result = await codeImpact.handler({
      files: ['src/auth.ts'],
      symbols: ['login', 'logout'],
      root: '/tmp',
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Impact Analysis'));
  });

  it('handles diff with multiple files', async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,5 @@',
      '+export function a() {}',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,3 +1,4 @@',
      '+export function b() {}',
    ].join('\n');
    const result = await codeImpact.handler({ diff, root: '/tmp' });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Impact Analysis'));
  });

  it('handles diff with only --- line (no +++ yet)', async () => {
    const diff = [
      'diff --git a/src/c.ts b/src/c.ts',
      '--- a/src/c.ts',
    ].join('\n');
    const result = await codeImpact.handler({ diff, root: '/tmp' });
    assert.ok(typeof result === 'string');
  });

  it('returns text format with no impacts', async () => {
    const diff = [
      'diff --git a/empty.ts b/empty.ts',
      '--- a/empty.ts',
      '+++ b/empty.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const result = await codeImpact.handler({ diff, root: '/tmp' });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('No downstream') || result.includes('Impact'));
  });

  it('handles null diff gracefully', async () => {
    const result = await codeImpact.handler({ diff: null });
    assert.ok(typeof result === 'string');
  });

  it('handles diff with hunks spanning multiple lines', async () => {
    const diff = [
      'diff --git a/src/big.ts b/src/big.ts',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      '@@ -10,3 +10,10 @@',
      '+function a() {}',
      '+function b() {}',
      '+function c() {}',
      '+function d() {}',
      '+function e() {}',
      '+function f() {}',
      '+function g() {}',
    ].join('\n');
    const result = await codeImpact.handler({ diff, root: '/tmp' });
    assert.ok(typeof result === 'string');
  });
});
