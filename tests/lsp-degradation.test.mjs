// lsp-degradation.test.mjs — Phase 10 LSP startup degradation tests
//
// Tests the smart_lsp handler's ability to gracefully handle:
//   1. Unsupported file extensions → early error with grep suggestion
//   2. Missing required parameters → clear error
//   3. LSP not installed → specific install command + grep fallback
//
// Run: node --test tests/lsp-degradation.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import lspPlugin from '../src/plugins/core/lsp.mjs';

describe('Phase 10: LSP Startup Degradation', () => {

  // ── 1. Unsupported file extension ──
  it('1.1 unsupported extension returns error with supported list', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'symbols', file: 'foo.rb' }));
    assert.ok(result.error.includes('Unsupported file type'), 'should mention unsupported file');
    assert.ok(result.supported, 'should list supported extensions');
    assert.ok(result.supported.includes('.ts'), 'should include .ts');
    assert.ok(result.supported.includes('.py'), 'should include .py');
    assert.ok(result.suggestion, 'should include grep suggestion');
    assert.ok(result.suggestion.includes('smart_grep'), 'suggestion should mention smart_grep');
  });

  it('1.2 unsupported extension works for all operations', async () => {
    for (const op of ['symbols', 'references', 'hover', 'definition', 'diagnostics']) {
      const result = JSON.parse(await lspPlugin.handler({ operation: op, file: 'foo.ex' }));
      assert.ok(result.error.includes('Unsupported'), `${op} should reject unsupported extension`);
      assert.ok(result.suggestion, `${op} should include suggestion`);
    }
  });

  it('1.3 returns error for empty/no extension', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'symbols', file: 'Makefile' }));
    assert.ok(result.error.includes('Unsupported'), 'should reject files without code extension');
  });

  // ── 2. Missing required params ──
  it('2.1 missing line for references returns error', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'references', file: 'foo.ts' }));
    assert.equal(result.error, 'line parameter required for references operation');
  });

  it('2.2 missing line for hover returns error', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'hover', file: 'foo.ts' }));
    assert.equal(result.error, 'line parameter required for hover operation');
  });

  it('2.3 missing line for definition returns error', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'definition', file: 'foo.ts' }));
    assert.equal(result.error, 'line parameter required for definition operation');
  });

  // ── 3. Supported extension but file not found ──
  it('3.1 symbols on non-existent file returns graceful error', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'symbols', file: '/tmp/nonexistent_xyz.ts' }));
    // Bridge handles this gracefully before LSP start
    assert.ok(result, 'should return result');
    assert.ok(result.symbols !== undefined, 'should have symbols');
    assert.equal(result.symbols.length, 0, 'symbols should be empty');
    assert.ok(result.error, 'should have error field');
  });

  // ── 4. Error response format contains grep fallback ──
  it('4.1 error response includes suggestion field', async () => {
    const result = JSON.parse(await lspPlugin.handler({ operation: 'symbols', file: 'foo.rb' }));
    assert.ok(result.suggestion, 'should include suggestion for alternative approach');
    assert.ok(result.suggestion.includes('grep') || result.suggestion.includes('read'),
      'suggestion should mention grep or read as alternative');
  });

  // ── 5. Supported extensions are correctly accepted ──
  it('5.1 known extensions pass validation', async () => {
    // These should not return "Unsupported file type"
    // (they may fail with other errors, but not the unsupported one)
    for (const ext of ['.ts', '.js', '.py', '.rs', '.swift', '.php']) {
      const result = JSON.parse(await lspPlugin.handler({ operation: 'symbols', file: `test${ext}` }));
      assert.ok(!result.error?.includes('Unsupported'), `${ext} should be supported`);
    }
  });

});
