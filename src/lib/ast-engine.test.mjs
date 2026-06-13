import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initParser, locateSymbol, validateSyntax, matchByAST } from './ast-engine.mjs';

describe('ast-engine (zero dep)', () => {
  it('initParser returns ready', async () => {
    const p = await initParser('javascript');
    assert.equal(p.ready, true);
  });

  it('locateSymbol finds function', async () => {
    const code = 'function hello() { return 1; }\nfunction world() { return 2; }';
    const found = await locateSymbol(code, 'javascript', 'hello');
    assert.ok(found);
    assert.equal(found.name, 'hello');
    assert.ok(found.lineStart >= 1);
    assert.ok(found.lineEnd >= found.lineStart);
  });

  it('locateSymbol returns null for missing', async () => {
    const found = await locateSymbol('const x = 1;', 'javascript', 'nonexist');
    assert.equal(found, null);
  });

  it('validateSyntax checks balance', async () => {
    const r = await validateSyntax('function foo() { return 1; }', 'javascript');
    assert.equal(r.ok, true);
  });

  it('validateSyntax detects unbalanced', async () => {
    const r = await validateSyntax('function foo() { return 1;', 'javascript');
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });

  it('matchByAST finds by function name', async () => {
    const content = 'function foo() { return 1; }\nfunction bar() { return 2; }';
    const found = await matchByAST(content, 'javascript', 'function bar() { return 2; }');
    assert.ok(found);
    assert.ok(found.lineStart >= 1);
    assert.ok(found.lineEnd >= found.lineStart);
  });

  it('matchByAST finds by anchor line', async () => {
    const content = 'const x = 1;\nconst y = 2;\nconsole.log(y);';
    const found = await matchByAST(content, 'javascript', '  const y = 2;  ');
    assert.ok(found);
    assert.equal(found.lineStart, 2);
  });
});
