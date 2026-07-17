// tests/thinking-handler-extra.test.mjs — 補充 thinking.mjs plugin handler 覆蓋率
//
// 測試 handler 的所有分支：restore, cancel, advance, branch, finish,
// iterative, dynamic, budget-aware steps, plan parsing, mapArgs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import thinkingPlugin from '../src/plugins/core/thinking.mjs';

const TEST_DIR = resolve(tmpdir(), `thinking-handler-extra-${Date.now()}`);
const STATE_FILE = resolve(TEST_DIR, 'state.json');

before(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
});

after(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Plugin structure
// ---------------------------------------------------------------------------

describe('thinking plugin — structure', () => {
  it('exports valid plugin', () => {
    assert.equal(thinkingPlugin.name, 'smart_deep_think');
    assert.equal(typeof thinkingPlugin.handler, 'function');
    assert.equal(typeof thinkingPlugin.mapArgs, 'function');
  });

  it('mapArgs builds correct CLI args', () => {
    const args = thinkingPlugin.mapArgs({
      topic: 'test topic',
      template: 'debug',
      steps: 3,
      format: 'json',
      iterative: true,
      dynamic: true,
      plan: '{"goal":"x"}',
      planStep: 2,
      state: '/tmp/state.json',
      record: '1:ok',
      advance: true,
      branch: 'path-a',
      finish: true,
      status: true,
      cancel: true,
      restore: '/tmp/state.json',
    });
    assert.ok(args.includes('test topic'));
    assert.ok(args.includes('--template'));
    assert.ok(args.includes('debug'));
    assert.ok(args.includes('--steps'));
    assert.ok(args.includes('3'));
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--iterative'));
    assert.ok(args.includes('--dynamic'));
    assert.ok(args.includes('--plan'));
    assert.ok(args.includes('--plan-step'));
    assert.ok(args.includes('--state'));
    assert.ok(args.includes('--record'));
    assert.ok(args.includes('--advance'));
    assert.ok(args.includes('--branch'));
    assert.ok(args.includes('--finish'));
    assert.ok(args.includes('--status'));
    assert.ok(args.includes('--cancel'));
    assert.ok(args.includes('--restore'));
    assert.ok(args.includes('--no-color'));
  });
});

// ---------------------------------------------------------------------------
// Handler: --dynamic
// ---------------------------------------------------------------------------

describe('thinking handler — dynamic', () => {
  it('starts a dynamic session', () => {
    const statePath = resolve(TEST_DIR, 'dyn-state.json');
    const result = thinkingPlugin.handler({
      dynamic: true,
      topic: 'test topic',
      state: statePath,
    });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    // Cleanup
    try { unlinkSync(statePath); } catch { /* ignore */ }
  });

  it('throws when --dynamic without topic', () => {
    assert.throws(() => {
      thinkingPlugin.handler({ dynamic: true });
    }, /topic/);
  });
});

// ---------------------------------------------------------------------------
// Handler: --status (no session)
// ---------------------------------------------------------------------------

describe('thinking handler — status', () => {
  it('returns no-session message when state file missing', () => {
    const result = thinkingPlugin.handler({
      status: true,
      state: resolve(TEST_DIR, 'nonexistent-state.json'),
    });
    assert.ok(result.includes('No active thinking session') || result.includes('No active'));
  });
});

// ---------------------------------------------------------------------------
// Handler: --restore
// ---------------------------------------------------------------------------

describe('thinking handler — restore', () => {
  it('throws for non-existent state file (mocks process.exit)', () => {
    // readState calls process.exit(1) on missing file — mock it to prevent test runner crash
    const origExit = process.exit;
    let exitCalled = false;
    process.exit = (code) => { exitCalled = true; throw new Error(`process.exit(${code})`); };
    try {
      assert.throws(() => {
        thinkingPlugin.handler({ restore: '/tmp/nonexistent-restore-state.json' });
      }, /process\.exit/);
      assert.ok(exitCalled, 'process.exit should have been called');
    } finally {
      process.exit = origExit;
    }
  });
});

// ---------------------------------------------------------------------------
// Handler: iterative mode
// ---------------------------------------------------------------------------

describe('thinking handler — iterative', () => {
  it('returns null for iterative mode (falls through to CLI)', () => {
    const result = thinkingPlugin.handler({ iterative: true });
    assert.equal(result, null, 'iterative should return null for CLI fallback');
  });
});

// ---------------------------------------------------------------------------
// Handler: static analysis (default path)
// ---------------------------------------------------------------------------

describe('thinking handler — static analysis', () => {
  it('returns analysis for topic with default template', () => {
    const result = thinkingPlugin.handler({ topic: 'how does authentication work?' });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('returns analysis with json format', () => {
    const result = thinkingPlugin.handler({ topic: 'debug issue', format: 'json' });
    assert.ok(typeof result === 'string');
  });

  it('returns analysis with markdown format', () => {
    const result = thinkingPlugin.handler({ topic: 'plan feature', format: 'markdown' });
    assert.ok(typeof result === 'string');
  });

  it('uses plan goal as topic when no topic given', () => {
    const plan = JSON.stringify({ goal: 'implement auth' });
    const result = thinkingPlugin.handler({ plan });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('handles plan with no goal', () => {
    const plan = JSON.stringify({ steps: ['a', 'b'] });
    const result = thinkingPlugin.handler({ plan });
    assert.ok(typeof result === 'string');
  });

  it('handles invalid plan JSON gracefully', () => {
    const result = thinkingPlugin.handler({ topic: 'test', plan: 'not-json' });
    assert.ok(typeof result === 'string');
  });

  it('supports all templates', () => {
    const templates = ['debug', 'refactor', 'feature', 'research', 'decision', 'analyze', 'plan_execute', 'retrospect', 'architecture', 'peer_review'];
    for (const t of templates) {
      const result = thinkingPlugin.handler({ topic: 'test', template: t });
      assert.ok(typeof result === 'string', `template ${t} should return string`);
    }
  });
});

// ---------------------------------------------------------------------------
// Handler: --record with state
// ---------------------------------------------------------------------------

describe('thinking handler — record', () => {
  it('throws when state file missing', () => {
    assert.throws(() => {
      thinkingPlugin.handler({
        record: '1:result',
        state: resolve(TEST_DIR, 'no-record-state.json'),
      });
    }, /No active thinking session|state/);
  });

  it('throws when state file missing for --advance alone', () => {
    assert.throws(() => {
      thinkingPlugin.handler({
        advance: true,
        state: resolve(TEST_DIR, 'no-advance-state.json'),
      });
    }, /No active thinking session|state/);
  });

  it('throws when state file missing for --branch', () => {
    assert.throws(() => {
      thinkingPlugin.handler({
        branch: 'path-a',
        state: resolve(TEST_DIR, 'no-branch-state.json'),
      });
    }, /No active thinking session|state/);
  });

  it('throws when state file missing for --finish', () => {
    assert.throws(() => {
      thinkingPlugin.handler({
        finish: true,
        state: resolve(TEST_DIR, 'no-finish-state.json'),
      });
    }, /No active thinking session|state/);
  });

  it('throws when state file missing for --cancel', () => {
    assert.throws(() => {
      thinkingPlugin.handler({
        cancel: true,
        state: resolve(TEST_DIR, 'no-cancel-state.json'),
      });
    }, /No active thinking session|state/);
  });
});
