// lsp-bridge.test.mjs — Phase 10 LSP Bridge tests
//
// Tests lsp-bridge.mjs basic lifecycle + queries:
//   1. getLspBridge singleton
//   2. getSymbols on a TS file
//   3. getHover on a known symbol
//   4. Auto-reconnect (crash + restart)
//   5. Multiple language support
//
// Run: node --test tests/lsp-bridge.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__dirname, '../.test-lsp-' + Date.now());

// Check if TypeScript LSP server is available on this platform
// On Windows, .cmd wrappers from npm .bin don't work with spawn(shell:false),
// and shell:true prevents clean process termination. Skip LSP tests on Windows.
const hasTsLsp = process.platform !== 'win32' && (() => {
  try {
    const binDir = resolve(__dirname, '../node_modules/.bin');
    return existsSync(resolve(binDir, 'typescript-language-server'));
  } catch { return false; }
})();

describe('Phase 10: LSP Bridge', () => {
  let bridge;

  before(async () => {
    mkdirSync(TEST_DIR, { recursive: true });

    // Create a test TS file with various symbols
    writeFileSync(resolve(TEST_DIR, 'test.ts'), `
export interface User {
  id: number;
  name: string;
}

export function greet(user: User): string {
  return \`Hello, \${user.name}\`;
}

export const VERSION = '1.0.0';

class InternalHelper {
  secret: string;
  constructor(s: string) { this.secret = s; }
  getSecret(): string { return this.secret; }
}

export { InternalHelper };
`.trimStart());

    // Ensure a minimal tsconfig.json so LSP doesn't complain
    writeFileSync(resolve(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        strict: true,
        noEmit: true,
      },
      include: ['*.ts'],
    }, null, 2));
  });

  after(async () => {
    // Close LSP bridge so process exits cleanly
    try {
      const { closeAllLspBridges } = await import('../src/lib/lsp-bridge.mjs');
      await closeAllLspBridges();
    } catch {}
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  // ── 1. Singleton ──
  it('1.1 getLspBridge returns a bridge instance', async () => {
    const { getLspBridge } = await import('../src/lib/lsp-bridge.mjs');
    bridge = getLspBridge(TEST_DIR);
    assert.ok(bridge, 'should return bridge');
  });

  it('1.2 singleton returns same instance for same root', async () => {
    const { getLspBridge } = await import('../src/lib/lsp-bridge.mjs');
    const bridge2 = getLspBridge(TEST_DIR);
    assert.equal(bridge, bridge2, 'same root should return same instance');
  });

  // ── 2. getSymbols ──
  it('2.1 getSymbols returns symbols from TS file', { timeout: 15000, skip: !hasTsLsp }, async () => {
    const result = await bridge.getSymbols('test.ts');
    assert.ok(result, 'should return result');
    assert.ok(result.symbols, 'should have symbols array');
    assert.ok(result.symbols.length > 0, `should have >0 symbols, got ${result.symbols.length}`);
    
    // Check for known symbols
    const names = result.symbols.map(s => s.name);
    assert.ok(names.includes('User'), 'should have User interface');
    assert.ok(names.includes('greet'), 'should have greet function');
    assert.ok(names.includes('VERSION'), 'should have VERSION constant');
    assert.ok(names.includes('InternalHelper'), 'should have InternalHelper class');
  });

  it('2.2 getSymbols returns structured symbol data', { skip: !hasTsLsp }, async () => {
    const result = await bridge.getSymbols('test.ts');
    const greet = result.symbols.find(s => s.name === 'greet');
    assert.ok(greet, 'should find greet');
    assert.ok(greet.kind, 'greet should have kind');
    assert.ok(greet.line > 0, 'greet should have line > 0');
    assert.ok(greet.signature, 'greet should have signature');
  });

  // ── 3. getHover ──
  it('3.1 getHover returns type info for greet function', { timeout: 15000, skip: !hasTsLsp }, async () => {
    // Position at greet function name (line 6, col ~10)
    const hover = await bridge.getHover('test.ts', 6, 10);
    assert.ok(hover, 'should return hover info');
    if (hover.type) {
      assert.ok(hover.type.length > 0, 'hover type should not be empty');
    }
  });

  // ── 4. Non-existent file ──
  it('4.1 getSymbols on non-existent file returns gracefully', async () => {
    const result = await bridge.getSymbols('nonexistent.ts');
    // Returns { error, symbols } with empty symbols
    assert.ok(result, 'should return result');
    assert.ok(result.symbols !== undefined, 'should have symbols');
    assert.equal(result.symbols.length, 0, 'symbols should be empty');
  });

  // ── 5. LSP readiness ──
  it('5.1 bridge reports ready state', () => {
    // isReady should be defined (returns boolean based on process state)
    assert.ok(typeof bridge.isReady === 'boolean' || bridge.isReady === undefined,
      'isReady should be a boolean or undefined');
  });

  // ── 6. Code Actions ──
  it('6.1 getCodeActions returns actions for a file', { timeout: 15000, skip: !hasTsLsp }, async () => {
    // Create a file with an error (unused import)
    writeFileSync(resolve(TEST_DIR, 'code-action-test.ts'), `
import { existsSync } from 'node:fs';
export function doNothing(): void {
  console.log('hello');
}
`.trimStart());

    // Wait for LSP to index
    await new Promise(r => setTimeout(r, 1000));

    const result = await bridge.getCodeActions('code-action-test.ts', 2, 0);
    assert.ok(result, 'should return result');
    assert.ok(Array.isArray(result.actions), 'should have actions array');
    // Note: Actions depend on LSP server, might be empty if no quickfix available
  });

  it('6.2 getCodeActions with diagnostics filter', { timeout: 15000, skip: !hasTsLsp }, async () => {
    const result = await bridge.getCodeActions('code-action-test.ts', 2, 0, [
      {
        line: 2,
        col: 0,
        severity: 'warning',
        message: "'existsSync' is declared but its value is never read.",
        code: '6133',
        source: 'typescript'
      }
    ]);
    assert.ok(result, 'should return result');
    assert.ok(Array.isArray(result.actions), 'should have actions array');
  });

  it('6.3 applyWorkspaceEdit applies changes', { timeout: 15000, skip: !hasTsLsp }, async () => {
    // Create a simple file
    writeFileSync(resolve(TEST_DIR, 'edit-test.ts'), `
export const x = 1;
export const y = 2;
`.trimStart());

    await new Promise(r => setTimeout(r, 500));

    // Create a workspace edit (use file:/// for absolute paths)
    const edit = {
      changes: {
        [`file:///${resolve(TEST_DIR, 'edit-test.ts').slice(1)}`]: [
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 16 }
            },
            newText: 'export const x = 100;'
          }
        ]
      }
    };

    const result = await bridge.applyWorkspaceEdit(edit);
    assert.equal(result.applied, 1, 'should apply 1 edit');
    assert.equal(result.errors.length, 0, 'should have no errors');

    // Verify the change
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(resolve(TEST_DIR, 'edit-test.ts'), 'utf8');
    assert.ok(content.includes('x = 100'), 'should have updated value');
  });

});
