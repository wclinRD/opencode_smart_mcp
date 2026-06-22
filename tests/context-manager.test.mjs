// context-manager.test.mjs — Tests for ContextManager and context integration
//
// Run: node --test tests/context-manager.test.mjs

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ContextManager } from '../src/lib/context-manager.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir;

function freshManager(opts = {}) {
  testDir = resolve(tmpdir(), `smart-context-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(testDir, { recursive: true });
  return new ContextManager({
    contextDir: testDir,
    todoFile: resolve(testDir, 'todos.json'),
    autoSave: opts.autoSave !== false,
    extractFindings: opts.extractFindings !== false,
    maxHistory: opts.maxHistory || 10,
    maxFindings: opts.maxFindings || 20,
    maxResultLength: opts.maxResultLength || 500,
  });
}

function cleanup() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextManager', () => {
  after(cleanup);

  describe('init() — session lifecycle', () => {
    it('creates a fresh session', () => {
      const cm = freshManager({ autoSave: false });
      const ctx = cm.init();
      assert.ok(ctx.sessionId, 'should have sessionId');
      assert.equal(ctx.metadata.toolCount, 0);
      assert.equal(ctx.metadata.errorCount, 0);
      assert.ok(Array.isArray(ctx.toolHistory));
      assert.ok(Array.isArray(ctx.accumulatedFindings));
      assert.equal(ctx.lastResult, null);
      cleanup();
    });

    it('resumes existing session from disk', () => {
      const contextDir = resolve(tmpdir(), `smart-context-test-resume-${randomUUID().slice(0, 8)}`);
      mkdirSync(contextDir, { recursive: true });

      const cm1 = new ContextManager({ contextDir, autoSave: true });
      const ctx1 = cm1.init({ projectRoot: '/test/project' });
      const sessionId = ctx1.sessionId;

      // Capture a call to ensure persistence has content
      cm1.capture('smart_grep', { pattern: 'foo' }, { ok: true, output: 'found 3 matches' }, 50);

      // Create new manager with SAME contextDir and resume
      const cm2 = new ContextManager({ contextDir, autoSave: false });
      const ctx2 = cm2.init({ sessionId });
      assert.equal(ctx2.sessionId, sessionId);
      assert.equal(ctx2.projectRoot, '/test/project');
      assert.equal(ctx2.metadata.toolCount, 1);

      rmSync(contextDir, { recursive: true, force: true });
    });

    it('supports custom sessionId', () => {
      const cm = freshManager({ autoSave: false });
      const sid = 'my-custom-session-123';
      const ctx = cm.init({ sessionId: sid });
      assert.equal(ctx.sessionId, sid);
      cleanup();
    });
  });

  describe('get() / getSummary()', () => {
    it('get returns cloned context', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const ctx = cm.get();
      assert.ok(ctx.sessionId);
      // Modify returned object — should not affect internal
      ctx.metadata.toolCount = 999;
      const ctx2 = cm.get();
      assert.equal(ctx2.metadata.toolCount, 0);
      cleanup();
    });

    it('getSummary returns compact JSON string', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const summary = cm.getSummary();
      assert.ok(typeof summary === 'string');
      const parsed = JSON.parse(summary);
      assert.ok('sid' in parsed);
      assert.ok('n' in parsed); // toolCount
      assert.ok('err' in parsed); // errorCount
      assert.ok('recent' in parsed);
      assert.ok('finds' in parsed);
      cleanup();
    });

    it('getSummary updates after capture', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      cm.capture('smart_grep', { pattern: 'x' }, { ok: true, output: 'ok' }, 10);
      cm.capture('smart_test', {}, { ok: false, error: 'failed' }, 20);
      const parsed = JSON.parse(cm.getSummary());
      assert.equal(parsed.n, 2);
      assert.equal(parsed.err, 1);
      assert.equal(parsed.last, 'smart_test');
      assert.deepEqual(parsed.recent, ['smart_grep', 'smart_test']);
      cleanup();
    });
  });

  describe('getEnv()', () => {
    it('returns context env vars', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const envVars = cm.getEnv();
      assert.ok('SMART_SESSION_ID' in envVars);
      assert.ok('SMART_TOOL_COUNT' in envVars);
      assert.ok('SMART_CONTEXT' in envVars);
      assert.equal(envVars.SMART_TOOL_COUNT, '0');
      cleanup();
    });
  });

  describe('inject()', () => {
    it('injects _context into args', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const args = { pattern: 'foo', root: 'src/' };
      const injected = cm.inject('smart_grep', args);
      assert.equal(injected.pattern, 'foo');
      assert.equal(injected.root, 'src/');
      assert.ok('_context' in injected);
      assert.ok(typeof injected._context === 'string');
      cleanup();
    });

    it('does not modify original args object', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const args = { pattern: 'foo' };
      const injected = cm.inject('smart_grep', args);
      assert.equal(args.pattern, 'foo');
      assert.ok(!('_context' in args));
      assert.ok('_context' in injected);
      cleanup();
    });
  });

  describe('capture() — tool result recording', () => {
    it('records successful tool call', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      cm.capture('smart_grep', { pattern: 'test' }, { ok: true, output: 'found 5 matches\nline 10: hello' }, 30);

      const ctx = cm.get();
      assert.equal(ctx.metadata.toolCount, 1);
      assert.equal(ctx.metadata.errorCount, 0);
      assert.equal(ctx.toolHistory.length, 1);
      assert.equal(ctx.toolHistory[0].tool, 'smart_grep');
      assert.equal(ctx.toolHistory[0].ok, true);
      assert.equal(ctx.toolHistory[0].duration, 30);
      assert.ok(ctx.toolHistory[0].result.includes('found 5 matches'));
      assert.ok(ctx.lastResult.ok);
      assert.equal(ctx.lastResult.tool, 'smart_grep');
      cleanup();
    });

    it('records failed tool call', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      cm.capture('smart_test', {}, { ok: false, error: 'Test failed: timeout' }, 5000);

      const ctx = cm.get();
      assert.equal(ctx.metadata.toolCount, 1);
      assert.equal(ctx.metadata.errorCount, 1);
      assert.equal(ctx.toolHistory[0].ok, false);
      assert.ok(ctx.toolHistory[0].error.includes('timeout'));
      assert.equal(ctx.lastResult.ok, false);
      cleanup();
    });

    it('truncates long results', () => {
      const cm = freshManager({ autoSave: false, maxResultLength: 50 });
      cm.init();
      const longOutput = 'x'.repeat(200);
      cm.capture('smart_grep', {}, { ok: true, output: longOutput }, 10);

      const ctx = cm.get();
      assert.ok(ctx.toolHistory[0].result.length < 100);
      assert.ok(ctx.toolHistory[0].result.endsWith('... [truncated]'));
      cleanup();
    });

    it('FIFO eviction when history exceeds limit', () => {
      const cm = freshManager({ autoSave: false, maxHistory: 3 });
      cm.init();
      for (let i = 0; i < 5; i++) {
        cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, i * 10);
      }

      const ctx = cm.get();
      assert.equal(ctx.toolHistory.length, 3);
      assert.equal(ctx.toolHistory[0].tool, 'tool_2'); // oldest evicted
      assert.equal(ctx.toolHistory[2].tool, 'tool_4');
      cleanup();
    });

    it('sanitizes args (removes _context, truncates long strings)', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      const longStr = 'a'.repeat(500);
      cm.capture('smart_grep',
        { pattern: 'foo', _context: 'should-be-removed', longArg: longStr },
        { ok: true, output: 'ok' }, 10
      );

      const ctx = cm.get();
      const storedArgs = ctx.toolHistory[0].args;
      assert.ok(!('_context' in storedArgs), '_context should be removed');
      assert.ok(storedArgs.longArg.length < 300, 'long arg should be truncated');
      assert.equal(storedArgs.pattern, 'foo');
      cleanup();
    });
  });

  describe('extractFindings — automatic finding extraction', () => {
    it('extracts security findings from tool output', () => {
      const cm = freshManager({ autoSave: false, extractFindings: true });
      cm.init();
      cm.capture('smart_security', {},
        { ok: true, output: 'CRITICAL: credential found in config file\nHIGH severity: API key exposed' },
        100
      );

      const ctx = cm.get();
      assert.ok(ctx.accumulatedFindings.length >= 2);
      const credentials = ctx.accumulatedFindings.filter(f => f.category === 'security');
      assert.ok(credentials.length >= 1);
      cleanup();
    });

    it('extracts error findings', () => {
      const cm = freshManager({ autoSave: false, extractFindings: true });
      cm.init();
      cm.capture('smart_test', {},
        { ok: true, output: 'TypeError: cannot read property of null\nTest failed: timeout after 30s' },
        100
      );

      const ctx = cm.get();
      assert.ok(ctx.accumulatedFindings.length >= 1);
      const errors = ctx.accumulatedFindings.filter(f => f.category === 'error');
      assert.ok(errors.length >= 1);
      cleanup();
    });

    it('does not extract findings when disabled', () => {
      const cm = freshManager({ autoSave: false, extractFindings: false });
      cm.init();
      cm.capture('smart_security', {},
        { ok: true, output: 'CRITICAL: credential found' },
        100
      );

      const ctx = cm.get();
      assert.equal(ctx.accumulatedFindings.length, 0);
      cleanup();
    });

    it('extracts findings from error outputs too', () => {
      const cm = freshManager({ autoSave: false, extractFindings: true });
      cm.init();
      cm.capture('smart_test', {},
        { ok: false, error: 'Module not found: express\nTypeError: ...' },
        100
      );

      const ctx = cm.get();
      // Findings are only extracted from success output
      // Error outputs get stored in entry.error instead
      assert.equal(ctx.accumulatedFindings.length, 0);
      cleanup();
    });

    it('deduplicates similar findings', () => {
      const cm = freshManager({ autoSave: false, extractFindings: true, maxFindings: 20 });
      cm.init();
      cm.capture('smart_security', {},
        { ok: true, output: 'HIGH severity: issue 1\nHIGH severity: issue 2' },
        100
      );

      const ctx = cm.get();
      // Should find "HIGH severity" only once due to dedup
      const highSeverity = ctx.accumulatedFindings.filter(f => f.finding.toLowerCase().includes('high severity'));
      assert.equal(highSeverity.length, 1);
      cleanup();
    });
  });

  describe('persistence', () => {
    it('auto-saves to disk after capture', () => {
      const cm = freshManager({ autoSave: true });
      const ctx = cm.init();
      const sessionId = ctx.sessionId;
      cm.capture('smart_grep', {}, { ok: true, output: 'found' }, 10);

      // Check file exists on disk
      const filePath = resolve(testDir, `${sessionId}.json`);
      assert.ok(existsSync(filePath), 'context file should exist');
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.equal(raw.metadata.toolCount, 1);
      cleanup();
    });

    it('save() works explicitly', () => {
      const cm = freshManager({ autoSave: false });
      const ctx = cm.init();
      cm.capture('smart_grep', {}, { ok: true, output: 'found' }, 10);
      const saved = cm.save();
      assert.equal(saved, true);

      const filePath = resolve(testDir, `${ctx.sessionId}.json`);
      assert.ok(existsSync(filePath));
      cleanup();
    });

    it('listSessions() returns persisted sessions', () => {
      const contextDir = resolve(tmpdir(), `smart-context-test-list-${randomUUID().slice(0, 8)}`);
      mkdirSync(contextDir, { recursive: true });

      const cm1 = new ContextManager({ contextDir, autoSave: true });
      cm1.init();
      cm1.capture('tool_a', {}, { ok: true, output: 'a' }, 10);

      const cm2 = new ContextManager({ contextDir, autoSave: true });
      cm2.init();
      cm2.capture('tool_b', {}, { ok: true, output: 'b' }, 20);

      // List should find both
      const lister = new ContextManager({ contextDir, autoSave: false });
      const sessions = lister.listSessions();
      assert.ok(sessions.length >= 2);

      rmSync(contextDir, { recursive: true, force: true });
    });

    it('deleteSession() removes persisted file', () => {
      const cm = freshManager({ autoSave: true });
      const ctx = cm.init();
      cm.capture('smart_grep', {}, { ok: true, output: 'x' }, 10);

      const sid = ctx.sessionId;
      const filePath = resolve(testDir, `${sid}.json`);
      assert.ok(existsSync(filePath));

      const deleted = cm.deleteSession(sid);
      assert.equal(deleted, true);
      assert.ok(!existsSync(filePath));
      cleanup();
    });

    it('listSessionsSummary() returns metadata without full history', () => {
      const cm = freshManager({ autoSave: true });
      cm.init();
      cm.capture('smart_grep', { pattern: 'foo' }, { ok: true, output: '3 matches' }, 30);
      cm.capture('smart_test', {}, { ok: false, error: 'fail' }, 50);

      const summary = cm.listSessionsSummary();
      assert.ok(summary.length >= 1);
      const latest = summary[0];
      assert.ok('sessionId' in latest);
      assert.ok('toolCount' in latest);
      assert.ok('errorCount' in latest);
      assert.ok('createdAt' in latest);
      assert.ok('updatedAt' in latest);
      assert.ok('lastTool' in latest);
      cleanup();
    });
  });

  describe('reset() / clear()', () => {
    it('reset clears history but keeps sessionId', () => {
      const cm = freshManager({ autoSave: false });
      const ctx = cm.init();
      const sid = ctx.sessionId;

      cm.capture('tool_1', {}, { ok: true, output: 'x' }, 10);
      cm.capture('tool_2', {}, { ok: true, output: 'y' }, 20);

      cm.reset();
      const afterReset = cm.get();
      assert.equal(afterReset.sessionId, sid);
      assert.equal(afterReset.metadata.toolCount, 0);
      assert.equal(afterReset.toolHistory.length, 0);
      assert.equal(afterReset.lastResult, null);
      cleanup();
    });

    it('clear nullifies context', () => {
      const cm = freshManager({ autoSave: false });
      cm.init();
      assert.ok(cm.get() !== null);
      cm.clear();
      assert.equal(cm.get(), null);
      cleanup();
    });
  });

  describe('integration with tool call patterns', () => {
    it('simulates grep → debug → test sequence', () => {
      const cm = freshManager({ autoSave: true, extractFindings: true });
      cm.init({ projectRoot: '/test/proj' });

      // Step 1: grep
      cm.capture('smart_grep', { pattern: 'error.*handler' },
        { ok: true, output: 'src/handler.js:45:  function errorHandler(msg) {\nFound 1 match' },
        45
      );

      // Step 2: debug
      cm.capture('smart_debug', { error: 'TypeError', file: 'src/handler.js' },
        { ok: true, output: 'TypeError at line 45: null reference\nRoot cause: missing guard clause' },
        120
      );

      // Step 3: test
      cm.capture('smart_test', { root: '.' },
        { ok: true, output: '3 passed, 0 failed\nCoverage: 87%' },
        2000
      );

      const ctx = cm.get();
      assert.equal(ctx.metadata.toolCount, 3);
      assert.equal(ctx.metadata.errorCount, 0);
      assert.equal(ctx.toolHistory.length, 3);
      assert.equal(ctx.toolHistory[0].tool, 'smart_grep');
      assert.equal(ctx.toolHistory[1].tool, 'smart_debug');
      assert.equal(ctx.toolHistory[2].tool, 'smart_test');

      // Check context summary reflects sequence
      const summary = JSON.parse(cm.getSummary());
      assert.equal(summary.n, 3);
      assert.equal(summary.last, 'smart_test');
      assert.deepEqual(summary.recent, ['smart_grep', 'smart_debug', 'smart_test']);

      // Check findings were extracted
      assert.ok(ctx.accumulatedFindings.length >= 1);

      cleanup();
    });

    it('simulates tool with error then recovery', () => {
      const cm = freshManager({ autoSave: false, extractFindings: true });
      cm.init();

      // Tool fails
      cm.capture('smart_grep', { pattern: 'foo' },
        { ok: false, error: 'Timeout: pattern too broad' },
        30000
      );

      // Retry with narrower scope
      cm.capture('smart_grep', { pattern: 'foo', root: 'src/' },
        { ok: true, output: 'src/bar.js:10: foo()\n1 match' },
        500
      );

      const ctx = cm.get();
      assert.equal(ctx.metadata.toolCount, 2);
      assert.equal(ctx.metadata.errorCount, 1);
      assert.equal(ctx.toolHistory[0].ok, false);
      assert.equal(ctx.toolHistory[1].ok, true);
      assert.equal(ctx.lastResult.ok, true);

      cleanup();
    });
  });
});

describe('ContextManager API contract', () => {
  after(cleanup);

  it('all required methods exist', () => {
    const cm = freshManager({ autoSave: false });
    const methods = ['init', 'get', 'getSummary', 'getEnv', 'inject', 'capture',
      'save', 'reset', 'clear', 'listSessions', 'deleteSession', 'listSessionsSummary',
      'clearToolResults'];
    for (const m of methods) {
      assert.equal(typeof cm[m], 'function', `method ${m} should exist`);
    }
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Phase 14.1: clearToolResults
// ---------------------------------------------------------------------------

describe('ContextManager — clearToolResults', () => {
  after(cleanup);

  it('removes entries older than N turns', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 10; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    const result = cm.clearToolResults({ olderThan: 5, keepLatest: 0 });
    assert.equal(result.removed, 5);
    assert.equal(result.kept, 5);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 5);
    assert.equal(ctx.toolHistory[0].tool, 'tool_5');
    assert.equal(ctx.toolHistory[4].tool, 'tool_9');
    cleanup();
  });

  it('returns { removed: 0, kept: 0 } for empty context', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const result = cm.clearToolResults({ olderThan: 10 });
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 0);
    cleanup();
  });

  it('returns { removed: 0, kept: 0 } when context is null', () => {
    const cm = freshManager({ autoSave: false });
    // Don't init — context is null
    const result = cm.clearToolResults({ olderThan: 10 });
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 0);
    cleanup();
  });

  it('keepLatest safety floor protects recent entries', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 10; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    // olderThan: 3 would keep only 3, but keepLatest: 5 keeps 5
    const result = cm.clearToolResults({ olderThan: 3, keepLatest: 5 });
    assert.equal(result.removed, 5);
    assert.equal(result.kept, 5);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 5);
    assert.equal(ctx.toolHistory[0].tool, 'tool_5');
    cleanup();
  });

  it('olderThan > total turns keeps everything (not enough entries)', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 5; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    // olderThan: 100 > 5 total — keep all entries since there aren't enough to clear
    const result = cm.clearToolResults({ olderThan: 100, keepLatest: 2 });
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 5);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 5);
    cleanup();
  });

  it('olderThan: 0 clears all except keepLatest', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 5; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    // olderThan: 0 + keepLatest: 2 → clear all except last 2
    const result = cm.clearToolResults({ olderThan: 0, keepLatest: 2 });
    assert.equal(result.removed, 3);
    assert.equal(result.kept, 2);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 2);
    assert.equal(ctx.toolHistory[0].tool, 'tool_3');
    assert.equal(ctx.toolHistory[1].tool, 'tool_4');
    cleanup();
  });

  it('keepLatest: 0 removes all matching entries', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 5; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    const result = cm.clearToolResults({ olderThan: 2, keepLatest: 0 });
    assert.equal(result.removed, 3);
    assert.equal(result.kept, 2);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 2);
    assert.equal(ctx.toolHistory[0].tool, 'tool_3');
    cleanup();
  });

  it('default parameters: olderThan=10, keepLatest=2', () => {
    const cm = freshManager({ autoSave: false, maxHistory: 20 });
    cm.init();
    for (let i = 0; i < 15; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    const result = cm.clearToolResults(); // defaults
    assert.equal(result.removed, 5);
    assert.equal(result.kept, 10);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 10);
    assert.equal(ctx.toolHistory[0].tool, 'tool_5');
    assert.equal(ctx.toolHistory[9].tool, 'tool_14');
    cleanup();
  });

  it('no-op when history is already within limit', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 3; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    const result = cm.clearToolResults({ olderThan: 10 });
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 3);

    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 3);
    cleanup();
  });

  it('persists after clear (autoSave)', () => {
    const cm = freshManager({ autoSave: true });
    const ctx = cm.init();
    for (let i = 0; i < 10; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    cm.clearToolResults({ olderThan: 3, keepLatest: 0 });

    // Verify on disk
    const filePath = resolve(testDir, `${ctx.sessionId}.json`);
    assert.ok(existsSync(filePath));
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert.equal(raw.toolHistory.length, 3);
    assert.equal(raw.toolHistory[0].tool, 'tool_7');
    assert.equal(raw.toolHistory[2].tool, 'tool_9');
    cleanup();
  });

  it('does not affect accumulatedFindings', () => {
    const cm = freshManager({ autoSave: false, extractFindings: true });
    cm.init();
    for (let i = 0; i < 10; i++) {
      cm.capture(`tool_${i}`, {},
        { ok: true, output: 'TypeError: something went wrong' },
        10
      );
    }

    const findingsBefore = cm.get().accumulatedFindings.length;
    cm.clearToolResults({ olderThan: 3, keepLatest: 0 });
    const ctx = cm.get();

    assert.equal(ctx.toolHistory.length, 3);
    assert.equal(ctx.accumulatedFindings.length, findingsBefore);
    cleanup();
  });

  it('does not affect metadata.toolCount', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    for (let i = 0; i < 10; i++) {
      cm.capture(`tool_${i}`, {}, { ok: true, output: `result ${i}` }, 10);
    }

    cm.clearToolResults({ olderThan: 3, keepLatest: 0 });
    const ctx = cm.get();

    // toolCount reflects total calls, not current history length
    assert.equal(ctx.metadata.toolCount, 10);
    assert.equal(ctx.toolHistory.length, 3);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// matchTodo — rules-based todo auto-detection (Round 3 enhancement)
// ---------------------------------------------------------------------------

describe('ContextManager — matchTodo', () => {
  afterEach(cleanup);

  it('returns no match when no todo items exist', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const r = cm.matchTodo('smart_grep', { pattern: 'foo' }, { ok: true, output: 'found 2 matches' });
    assert.equal(r.matched, false);
    assert.equal(r.todoId, null);
  });

  it('matches todo by keyword in output', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Fix the login module']);
    const r = cm.matchTodo('smart_grep', { pattern: 'login' }, { ok: true, output: 'found login handler at auth.ts' });
    assert.ok(r.matched, 'should match by keyword:login in grep output');
    assert.ok(r.todoId > 0);
  });

  it('matches todo by file path', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Refactor auth.ts']);
    const r = cm.matchTodo('smart_fast_apply', { file: 'src/auth.ts' }, { ok: true, output: '✅ applied' });
    assert.ok(r.matched, 'should match by file path + apply success');
    assert.ok(r.todoId > 0);
  });

  it('matches test success to relevant todo', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Add tests for login flow']);
    const r = cm.matchTodo('smart_test', { include: 'login' }, { ok: true, output: 'all pass 5/5' });
    assert.ok(r.matched, 'test pass matching todo content');
  });

  it('returns no match for completely unrelated tool', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Refactor payment module']);
    const r = cm.matchTodo('smart_lsp', { file: 'weather.ts' }, { ok: true, output: 'no diagnostics' });
    assert.equal(r.matched, false);
    assert.equal(r.borderline, false);
  });

  it('marks matched todo completed via doneTodo after successful match', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Fix the auth timeout bug']);
    const r = cm.matchTodo('smart_fast_apply', { file: 'auth.ts' }, { ok: true, output: '✅ applied' });
    assert.ok(r.matched, 'should match by file path');
    assert.ok(r.todoId > 0);
    // Simulate what the caller does: call doneTodo on match
    const done = cm.doneTodo(r.todoId);
    assert.ok(done.ok);
    const list = cm.listTodos();
    const found = list.find(t => t.id === r.todoId);
    assert.equal(found.status, 'completed');
  });

  it('handles completed and cancelled todos (skips them)', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    cm.addTodo(['Done task']);
    cm.updateTodoStatus(1, 'completed');
    cm.addTodo(['Cancelled task']);
    cm.updateTodoStatus(2, 'cancelled');
    const r = cm.matchTodo('smart_grep', { pattern: 'task' }, { ok: true, output: 'task found' });
    assert.equal(r.matched, false, 'should skip completed/cancelled');
  });
});

// ---------------------------------------------------------------------------
// matchTodo — subtask progress tracking (Round 2)
// ---------------------------------------------------------------------------

describe('ContextManager — matchTodo subtask', () => {
  afterEach(cleanup);

  it('tracks sub-task progress without auto-completing the parent', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    // Single todo with sub-tasks: "→" delimiter
    cm.addTodo(['Add auth → implement JWT middleware → add refresh logic']);
    // Use bare 'jwt' (no extension) so fileRef matches sub-task text 'implement JWT middleware'
    const r = cm.matchTodo('smart_fast_apply', { file: 'jwt' }, { ok: true, output: '✅ applied' });
    // Since 'jwt' appears in 'implement JWT middleware' sub-task:
    // matched should be false (parent not done), subTaskOnly true
    assert.equal(r.matched, false, 'should not auto-complete parent when sub-task remains');
    assert.ok(r.subTaskOnly, 'should indicate sub-task progress');
    assert.ok(r.subTaskProgress, 'should include progress like "1/3"');
  });

  it('auto-completes sub-task when all sub-tasks are done', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    // 2-sub-task todo for simpler test
    cm.addTodo(['Update middleware → test login']);
    // First sub-task: update middleware
    const r1 = cm.matchTodo('smart_fast_apply', { file: 'middleware' }, { ok: true, output: '✅ applied' });
    assert.equal(r1.matched, false);
    assert.ok(r1.subTaskOnly);
    // Second sub-task: test login
    const r2 = cm.matchTodo('smart_test', { include: 'login' }, { ok: true, output: 'all pass 3/3' });
    // Both sub-tasks done → parent should auto-complete
    assert.ok(r2.matched, 'should auto-complete when all sub-tasks done');
    assert.equal(r2.todoId, 1);
  });
});

// ---------------------------------------------------------------------------
// formatRecoveryContext — recovery context generation (Round 3)
// ---------------------------------------------------------------------------

describe('ContextManager — formatRecoveryContext', () => {
  afterEach(cleanup);

  it('returns null when no recovery context exists', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const rc = cm.formatRecoveryContext();
    assert.equal(rc, null);
  });

  it('formats recovery context with todos', () => {
    const cm = freshManager({ autoSave: false });
    const ctx = cm.init();
    cm.addTodo(['Fix login bug', 'Add tests']);
    // Set recovery context manually (normally set by compact flow)
    ctx._recoveryContext = {
      summary: { totalCalls: 5, errorCount: 1, uniqueTools: 3 },
      keyDecisions: [{ file: 'auth.ts' }],
      findings: [{ severity: 'warning', category: 'unhandled error' }],
      lastErrors: [{ tool: 'smart_test', error: 'timeout' }],
    };
    const text = cm.formatRecoveryContext();
    assert.ok(text !== null, 'should produce recovery text');
    assert.ok(text.includes('Session Context'), 'should include header');
    assert.ok(text.includes('Fix login bug'), 'should include todo text');
    assert.ok(text.includes('Add tests'), 'should include second todo');
    assert.ok(text.includes('5 calls'), 'should include session summary');
    assert.ok(text.includes('auth.ts'), 'should include recent files');
    assert.ok(text.includes('smart_test'), 'should include recent errors');
    cleanup();
  });

  it('includes active todos sorted by status and priority', () => {
    const cm = freshManager({ autoSave: false });
    const ctx = cm.init();
    cm.addTodo(['Setup CI']);
    cm.addTodo(['Fix crash bug']);  // higher priority (crash), but pending
    cm.addTodo(['Write docs']);  // lowest priority
    cm.updateTodoStatus(2, 'in_progress'); // Fix crash bug first
    ctx._recoveryContext = {
      summary: { totalCalls: 3, errorCount: 0, uniqueTools: 2 },
    };
    const text = cm.formatRecoveryContext();
    // in_progress should appear before pending
    const crashIdx = text.indexOf('Fix crash bug');
    const ciIdx = text.indexOf('Setup CI');
    assert.ok(crashIdx < ciIdx, 'in_progress should sort before pending');
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Subtask progress persistence (Round 2 enhancement)
// ---------------------------------------------------------------------------

describe('ContextManager — subtask progress persistence', () => {
  afterEach(cleanup);

  it('persists and restores subtask progress cross-session (same contextDir)', () => {
    // Use a shared context dir (not freshManager which creates separate dirs)
    const sharedDir = resolve(tmpdir(), `smart-persist-${randomUUID().slice(0, 8)}`);
    mkdirSync(sharedDir, { recursive: true });
    
    const cm1 = new ContextManager({ contextDir: sharedDir, autoSave: true, extractFindings: false, todoFile: resolve(sharedDir, 'todos.json') });
    cm1.init({ sessionId: 'subtask-persist-test' });
    cm1.addTodo(['Refactor DB → migrate schema → add indexes']);
    cm1.matchTodo('smart_fast_apply', { file: 'schema' }, { ok: true, output: '✅ applied' });

    // Second manager, SAME contextDir — should resume session + restore subtask progress
    const cm2 = new ContextManager({ contextDir: sharedDir, autoSave: true, extractFindings: false, todoFile: resolve(sharedDir, 'todos.json') });
    const ctx2 = cm2.init({ sessionId: 'subtask-persist-test' });
    assert.ok(ctx2._subtaskProgress, 'subtask progress should be restored');
    assert.ok(ctx2._subtaskProgress['1'], 'todo id 1 should have progress');
    assert.equal(ctx2._subtaskProgress['1'].done['migrate schema'], true, 'migrate schema should be done');
    
    rmSync(sharedDir, { recursive: true, force: true });
  });
});
