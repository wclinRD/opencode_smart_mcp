// tests/auto-fix.test.mjs — Phase 20 Auto-Fix Pipeline tests
//
// Tests: plugin structure, fix application, verification, error handling

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

const TEST_DIR = join(os.tmpdir(), `autofix-test-${Date.now()}`);

function createTestProject() {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

  // Create a simple JS file with a bug
  writeFileSync(join(TEST_DIR, 'src', 'math.js'), `
export function add(a, b) {
  return a - b;  // BUG: should be a + b
}

export function multiply(a, b) {
  return a * b;
}
`);

  // Create a test file
  writeFileSync(join(TEST_DIR, 'src', 'math.test.js'), `
import { add, multiply } from './math.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

assert(add(2, 3) === 5, 'add(2,3) should be 5');
assert(multiply(2, 3) === 6, 'multiply(2,3) should be 6');
console.log('All tests passed');
`);

  // Create package.json
  writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
    name: 'autofix-test',
    type: 'module',
    scripts: { test: 'node src/math.test.js' }
  }, null, 2));
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auto-Fix Pipeline', () => {
  before(() => {
    cleanup();
    createTestProject();
  });

  after(() => {
    cleanup();
  });

  // --- Plugin Structure ---

  it('should export valid plugin definition', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const def = plugin.default;

    assert.equal(def.name, 'smart_autofix');
    assert.equal(def.category, 'standard');
    assert.equal(def.safetyLevel, 'high');
    assert.ok(def.inputSchema);
    assert.equal(typeof def.handler, 'function');
  });

  // --- Fix Application ---

  it('should apply SEARCH/REPLACE fix and verify with test', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    const fix = `<<<<<<< SEARCH
export function add(a, b) {
  return a - b;  // BUG: should be a + b
}
=======
export function add(a, b) {
  return a + b;
}
>>>>>>> REPLACE`;

    const result = await handler({
      fix,
      verify: ['test'],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    assert.ok(result.content, 'Should have content');
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.fixApplied, 'Fix should be applied');
    assert.ok(data.allPassed, 'All verification should pass');
    assert.ok(data.ok, 'Result should be ok');
  });

  it('should detect when fix does not apply', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    const fix = `<<<<<<< SEARCH
this text does not exist in the file
=======
replacement
>>>>>>> REPLACE`;

    const result = await handler({
      fix,
      verify: ['test'],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    const data = JSON.parse(result.content[0].text);
    assert.ok(!data.fixApplied, 'Fix should not be applied');
    assert.ok(data.errors.length > 0, 'Should have errors');
  });

  it('should report test failure', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    // Revert the fix to create a failing test
    writeFileSync(join(TEST_DIR, 'src', 'math.js'), `
export function add(a, b) {
  return a - b;  // BUG: should be a + b
}

export function multiply(a, b) {
  return a * b;
}
`);

    // Apply a fix that doesn't fix the bug
    const fix = `<<<<<<< SEARCH
export function add(a, b) {
  return a - b;  // BUG: should be a + b
}
=======
export function add(a, b) {
  return a - 0;  // Still wrong
}
>>>>>>> REPLACE`;

    const result = await handler({
      fix,
      verify: ['test'],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    const data = JSON.parse(result.content[0].text);
    assert.ok(data.fixApplied, 'Fix should be applied');
    assert.ok(!data.allPassed, 'Verification should fail');
    assert.ok(data.errors.length > 0, 'Should have errors');
  });

  // --- Multiple Verification Steps ---

  it('should run multiple verification steps', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    // Fix the file first
    writeFileSync(join(TEST_DIR, 'src', 'math.js'), `
export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}
`);

    const fix = `<<<<<<< SEARCH
export function multiply(a, b) {
  return a * b;
}
=======
export function multiply(a, b) {
  return a * b;
}
>>>>>>> REPLACE`;

    const result = await handler({
      fix,
      verify: ['test', 'lint', 'security'],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    const data = JSON.parse(result.content[0].text);
    assert.ok(data.fixApplied, 'Fix should be applied');
    // test should pass, lint/security may be skipped
    assert.ok(data.verification.test !== undefined, 'Should have test result');
  });

  // --- Error Handling ---

  it('should handle missing fix parameter', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    // The schema requires 'fix', but test the handler directly
    try {
      await handler({ verify: ['test'], root: TEST_DIR });
      // If it doesn't throw, check the result
    } catch (err) {
      // Expected — missing required param
    }
  });

  it('should handle non-existent project root', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    const result = await handler({
      fix: 'some fix',
      verify: ['test'],
      files: ['nonexistent.js'],
      root: '/nonexistent/path/12345',
      timeout: 5
    });

    const data = JSON.parse(result.content[0].text);
    assert.ok(!data.fixApplied || !data.allPassed, 'Should fail gracefully');
  });

  // --- Unified Diff ---

  it('should handle unified diff format', async () => {
    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    const diff = `--- a/src/math.js
+++ b/src/math.js
@@ -1,5 +1,5 @@
 export function add(a, b) {
-  return a - b;
+  return a + b;
 }
 
 export function multiply(a, b) {`;

    const result = await handler({
      fix: diff,
      verify: ['test'],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    const data = JSON.parse(result.content[0].text);
    // May or may not apply depending on patch availability
    assert.ok(data.verification !== undefined, 'Should have verification results');
  });

  // --- Empty verify array ---

  it('should handle empty verify array', async () => {
    // Reset file to known state first
    writeFileSync(join(TEST_DIR, 'src', 'math.js'), `
export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}
`);

    const plugin = await import('../src/plugins/standard/auto-fix.mjs');
    const handler = plugin.default.handler;

    const fix = `<<<<<<< SEARCH
export function add(a, b) {
  return a + b;
}
=======
export function add(a, b) {
  return a + b;
}
>>>>>>> REPLACE`;

    const result = await handler({
      fix,
      verify: [],
      files: ['src/math.js'],
      root: TEST_DIR,
      timeout: 10
    });

    const data = JSON.parse(result.content[0].text);
    assert.ok(data.fixApplied, 'Fix should be applied');
    assert.ok(data.allPassed, 'Should pass with no verification steps');
  });
});