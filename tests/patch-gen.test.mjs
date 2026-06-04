// patch-gen.test.mjs — Phase 8 patch generation tests
//
// Tests smart_patch_gen handler:
//   1. error_diagnose input → extracts file + line + fix
//   2. Suggestion list → extracts multiple files
//   3. Explicit params → uses provided file/pattern/replacement
//   4. Empty content → returns "no changes" message
//   5. No-match content → returns helpful tip
//   6. JSON format → returns structured output
//   7. Multi-file safety gate
//   8. Diff format
//   9. Apply mode generates instructions
//
// Run: node --test tests/patch-gen.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const pluginPath = new URL('../src/plugins/standard/patch-gen.mjs', import.meta.url).href;

async function callHandler(args) {
  const mod = await import(pluginPath);
  return mod.default.handler(args);
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 8: Patch Generation', () => {

  // ── 1. error_diagnose input ──
  it('1.1 extracts file, line, fix from error_diagnose output', async () => {
    const r = await callHandler({
      content: 'Error in src/auth.js:42 — Cannot find module helper\nFix: update import path to ./utils/helper',
      source: 'error_diagnose',
    });
    assert.ok(r.includes('src/auth.js'), 'should mention file');
    assert.ok(r.includes('42'), 'should mention line');
    assert.ok(r.includes('update import path'), 'should include fix description');
    assert.ok(r.includes('Patch Plan'), 'should show plan header');
  });

  it('1.2 returns json structured output for error_diagnose', async () => {
    const r = await callHandler({
      content: 'Error in src/auth.js:42 — Cannot find module helper\nFix: update import path to ./utils/helper',
      source: 'error_diagnose',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data, 'should parse as JSON');
    assert.equal(data.totalChanges, 1);
    assert.equal(data.totalFiles, 1);
    assert.equal(data.changes[0].file, 'src/auth.js');
    assert.equal(data.changes[0].line, 42);
    assert.equal(data.multiFile, false);
    assert.equal(data.safeToApply, true);
  });

  // ── 2. Suggestion list ──
  it('2.1 extracts multiple files from suggestion list', async () => {
    const r = await callHandler({
      content: '- src/app.js:15: rename processData to transformData\n- src/lib/util.js: replace oldHelper with newHelper',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data);
    assert.equal(data.totalChanges, 2, 'should find 2 changes');
    assert.equal(data.totalFiles, 2, 'should involve 2 files');
    assert.equal(data.changes[0].file, 'src/app.js');
    assert.equal(data.changes[0].line, 15);
    assert.equal(data.changes[1].file, 'src/lib/util.js');
    assert.equal(data.multiFile, false, '2 files is not multi (threshold is 3+)');
  });

  it('2.2 suggestion list text format', async () => {
    const r = await callHandler({
      content: '- src/app.js:15: rename processData to transformData',
      format: 'text',
    });
    assert.ok(r.includes('src/app.js'), 'should show file');
    assert.ok(r.includes('L15'), 'should show line');
    assert.ok(r.includes('rename processData'), 'should show description');
  });

  // ── 3. Explicit params ──
  it('3.1 uses explicit file/pattern/replacement when provided', async () => {
    const r = await callHandler({
      content: 'Need to fix auth bug',
      file: 'src/auth.js',
      pattern: 'oldToken',
      replacement: 'newToken',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data);
    assert.equal(data.totalChanges, 1);
    assert.equal(data.changes[0].file, 'src/auth.js');
  });

  it('3.2 explicit params override auto-extracted content', async () => {
    const r = await callHandler({
      content: 'Some vague text without file info',
      file: 'src/main.ts',
      pattern: 'foo',
      replacement: 'bar',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data);
    assert.equal(data.totalChanges, 1);
    assert.equal(data.changes[0].file, 'src/main.ts');
  });

  // ── 4. Empty content ──
  it('4.1 empty content returns helpful message', async () => {
    const r = await callHandler({ content: '' });
    assert.ok(r.includes('No changes extracted'));
    assert.ok(r.includes('Tip'));
  });

  it('4.2 null content returns helpful message', async () => {
    const r = await callHandler({});
    assert.ok(r.includes('No changes extracted'));
  });

  // ── 5. No-match content ──
  it('5.1 content without file info returns tip', async () => {
    const r = await callHandler({ content: 'Everything looks good, no issues found.' });
    assert.ok(r.includes('No changes extracted'));
    assert.ok(r.includes('Tip'));
  });

  // ── 6. JSON format ──
  it('6.1 json format returns valid structured output', async () => {
    const r = await callHandler({
      content: '- src/app.js: fix typo',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data);
    assert.ok(Array.isArray(data.changes));
    assert.equal(typeof data.totalChanges, 'number');
    assert.equal(typeof data.totalFiles, 'number');
    assert.equal(typeof data.multiFile, 'boolean');
    assert.equal(typeof data.safeToApply, 'boolean');
    assert.ok(data.generated);
  });

  // ── 7. Multi-file safety gate ──
  it('7.1 3+ files triggers multi-file warning', async () => {
    const r = await callHandler({
      content: '- src/a.js: fix A\n- src/b.js: fix B\n- src/c.js: fix C',
      format: 'json',
    });
    const data = parseJSON(r);
    assert.ok(data);
    assert.equal(data.totalFiles, 3);
    assert.equal(data.multiFile, true, '3 files is multi');
    assert.equal(data.safeToApply, false, 'not safe to auto-apply');
  });

  // ── 8. Diff format ──
  it('8.1 diff format returns structured patch text', async () => {
    const r = await callHandler({
      content: '- src/login.js: replace basicAuth with OAuth',
      format: 'diff',
    });
    assert.ok(r.includes('Patch'), 'should show patch header');
    assert.ok(r.includes('src/login.js'), 'should include file');
    assert.ok(r.includes('replace basicAuth'), 'should include change');
  });

  // ── 9. Apply mode ──
  it('9.1 apply mode generates cross_file_edit instructions', async () => {
    const r = await callHandler({
      content: 'Change foo to bar in src/app.js',
      file: 'src/app.js',
      pattern: 'foo',
      replacement: 'bar',
      preview: false,
      apply: true,
    });
    assert.ok(r.includes('cross_file_edit'), 'should mention cross_file_edit');
    assert.ok(r.includes('src/app.js'), 'should include file');
  });

  // ── 10. Handler contract ──
  it('10.1 exports valid plugin structure', async () => {
    const mod = await import(pluginPath);
    const def = mod.default;
    assert.ok(def, 'should have default export');
    assert.equal(def.name, 'smart_patch_gen');
    assert.ok(def.handler, 'should have handler');
    assert.ok(def.inputSchema, 'should have inputSchema');
    assert.ok(def.inputSchema.properties.content, 'should require content');
  });

});
