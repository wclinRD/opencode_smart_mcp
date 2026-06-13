// smart-edit-ast.test.mjs — AST-aware Editing Tests (Phase 22)
//
// Tests: content-match, block-boundary, symbol-edit modes, dry-run, apply

import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import plugin from '../src/plugins/standard/smart-edit-ast.mjs';

const hasPlugin = !!(plugin && plugin.handler);

const JS_FIXTURE = `// test.js — editing fixture
function greet(name) {
  console.log('Hello, ' + name);
}

class Greeter {
  constructor(prefix) {
    this.prefix = prefix;
  }

  greet(name) {
    return this.prefix + ' ' + name;
  }
}

const farewell = (name) => {
  return 'Goodbye, ' + name;
};
`;

// ---------------------------------------------------------------------------
// Content-match mode
// ---------------------------------------------------------------------------

describe('smart_edit_ast (content-match)', { skip: !hasPlugin }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'edit-ast-test-'));
  const tmpFile = join(tmpDir, 'test.js');
  writeFileSync(tmpFile, JS_FIXTURE, 'utf-8');

  it('should find and replace exact content', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'content-match',
      match: 'console.log',
      replace: 'console.warn',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'content-match');
    assert.ok(result.modified, 'should be modified');
  });

  it('should find content with flexible whitespace matching', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'content-match',
      match: '  console.log',
      replace: '  console.warn',
      root: tmpDir,
      format: 'json',
    }));
    // This might be exact match too, but should work
    assert.equal(result.status, 'ok');
  });

  it('should report error for content not found', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'content-match',
      match: 'thisDoesNotExistAnywhere',
      replace: 'nothing',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('not found'));
  });

  it('should show context in result', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'content-match',
      match: 'console.log',
      replace: 'console.warn',
      root: tmpDir,
      format: 'json',
    }));
    assert.ok(result.context, 'context should exist');
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Block-boundary mode
// ---------------------------------------------------------------------------

describe('smart_edit_ast (block-boundary)', { skip: !hasPlugin }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'edit-ast-block-'));
  const tmpFile = join(tmpDir, 'test.js');
  writeFileSync(tmpFile, JS_FIXTURE, 'utf-8');

  it('should replace a line range', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'replace',
      startLine: 2,
      endLine: 4,
      text: '  console.log("replaced");',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'block-boundary');
    assert.equal(result.action, 'replace');
    assert.ok(result.modified);
  });

  it('should delete a line range', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'delete',
      startLine: 6,  // class Greeter
      endLine: 16,   // end of Greeter
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.action, 'delete');
    assert.ok(result.modified);
  });

  it('should insert before a line', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'insert-before',
      startLine: 1,
      text: '// inserted before',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.action, 'insert-before');
    assert.ok(result.modified);
  });

  it('should insert after a line', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'insert-after',
      startLine: 1,
      text: '// inserted after',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.action, 'insert-after');
    assert.ok(result.modified);
  });

  it('should error on invalid line range', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'replace',
      startLine: 999,
      endLine: 1000,
      text: 'nope',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'error');
  });

  it('should show diff in dry-run', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'block-boundary',
      action: 'replace',
      startLine: 1,
      endLine: 1,
      text: '// changed',
      root: tmpDir,
      format: 'json',
    }));
    assert.ok(result.diff, 'diff should exist');
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Symbol-edit mode
// ---------------------------------------------------------------------------

describe('smart_edit_ast (symbol-edit)', { skip: !hasPlugin }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'edit-ast-symbol-'));
  const tmpFile = join(tmpDir, 'test.js');
  writeFileSync(tmpFile, JS_FIXTURE, 'utf-8');

  it('should append to a function body', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'symbol-edit',
      symbol: 'greet',
      action: 'append',
      text: '  console.log("done");',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.symbol, 'greet');
    assert.ok(result.modified);
  });

  it('should prepend to a class body', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'symbol-edit',
      symbol: 'Greeter',
      action: 'prepend',
      text: '  // new method placeholder',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.symbol, 'Greeter');
    assert.ok(result.modified);
  });

  it('should replace-body of a function', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'symbol-edit',
      symbol: 'farewell',
      action: 'replace-body',
      text: '  return "See ya, " + name;',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.symbol, 'farewell');
    assert.ok(result.modified);
  });

  it('should delete a symbol', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'symbol-edit',
      symbol: 'farewell',
      action: 'delete',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.action, 'delete');
    assert.ok(result.modified);
  });

  it('should error on symbol not found', async () => {
    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'symbol-edit',
      symbol: 'NonExistentSymbol',
      action: 'append',
      text: 'whatever',
      root: tmpDir,
      format: 'json',
    }));
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('not found'));
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Apply mode
// ---------------------------------------------------------------------------

describe('smart_edit_ast (apply mode)', { skip: !hasPlugin }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'edit-ast-apply-'));
  const tmpFile = join(tmpDir, 'test.js');
  writeFileSync(tmpFile, JS_FIXTURE, 'utf-8');

  it('should actually write changes when apply:true', async () => {
    const before = readFileSync(tmpFile, 'utf-8');
    assert.ok(before.includes('Goodbye'));

    const result = JSON.parse(await plugin.handler({
      file: tmpFile,
      mode: 'content-match',
      match: 'Goodbye',
      replace: 'Ciao',
      root: tmpDir,
      apply: true,
      format: 'json',
    }));
    assert.equal(result.status, 'applied');

    const after = readFileSync(tmpFile, 'utf-8');
    assert.ok(after.includes('Ciao'));
    assert.ok(!after.includes('Goodbye'));
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('smart_edit_ast (error handling)', { skip: !hasPlugin }, () => {
  it('should error on file not found', async () => {
    const result = JSON.parse(await plugin.handler({
      file: '/nonexistent/path/file.js',
      mode: 'content-match',
      match: 'test',
      replace: 'test2',
      format: 'json',
    }));
    assert.equal(result.status, 'error');
  });

  it('should error on invalid mode', async () => {
    const result = JSON.parse(await plugin.handler({
      file: '/tmp',
      mode: 'invalid-mode',
      format: 'json',
    }));
    assert.equal(result.status, 'error');
  });
});
