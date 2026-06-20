// goal.test.mjs — Integration tests for smart_goal plugin
//
// Tests all 6 commands: set, check, status, clear, list, retry
// Tests edge cases: missing args, invalid status, no active goal
//
// Run: node --test tests/goal.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Import the goal plugin directly
const goalPlugin = await import('../src/plugins/standard/goal.mjs');
const handler = goalPlugin.default.handler;

const GOAL_FILE = resolve(homedir(), '.smart', 'goals.json');
let backup = null;

function run(args) {
  return handler(args);
}

function hasGoalFile() {
  return existsSync(GOAL_FILE);
}

function readGoals() {
  if (!hasGoalFile()) return [];
  return JSON.parse(readFileSync(GOAL_FILE, 'utf-8'));
}

describe('smart_goal plugin', () => {

  // Backup goals.json before tests, restore after
  before(() => {
    if (hasGoalFile()) {
      backup = readFileSync(GOAL_FILE, 'utf-8');
    }
    // Ensure .smart dir exists
    const dir = resolve(homedir(), '.smart');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Start clean
    writeFileSync(GOAL_FILE, '[]', 'utf-8');
  });

  after(() => {
    if (backup !== null) {
      writeFileSync(GOAL_FILE, backup, 'utf-8');
    } else if (hasGoalFile()) {
      writeFileSync(GOAL_FILE, '[]', 'utf-8');
    }
  });

  // ── command:set ──
  describe('command:set', () => {
    it('creates a new active goal', () => {
      const result = run({ command: 'set', description: 'Test goal', condition: 'All tests pass' });
      assert.match(result, /Goal #1 set/);
      assert.match(result, /Test goal/);
      assert.match(result, /Auto-check is ON/);
    });

    it('auto-cancels previous active goal', () => {
      const result = run({ command: 'set', description: 'Second goal', condition: 'Tests pass again' });
      assert.match(result, /Goal #2 set/);
      const goals = readGoals();
      assert.equal(goals.find(g => g.id === 1).status, 'cancelled');
      assert.equal(goals.find(g => g.id === 2).status, 'active');
    });

    it('rejects missing description', () => {
      const result = run({ command: 'set', condition: 'test' });
      assert.match(result, /Error/);
    });

    it('rejects missing condition', () => {
      const result = run({ command: 'set', description: 'test' });
      assert.match(result, /Error/);
    });

    it('stores checkHints when provided', () => {
      run({ command: 'set', description: 'Goal with hints', condition: 'All done', checkHints: ['Run tests', 'Check output'] });
      const goals = readGoals();
      const g = goals.find(g => g.description === 'Goal with hints');
      assert.deepEqual(g.checkHints, ['Run tests', 'Check output']);
    });
  });

  // ── command:status ──
  describe('command:status', () => {
    it('shows active goal', () => {
      run({ command: 'set', description: 'Status test', condition: 'Everything works' });
      const result = run({ command: 'status' });
      assert.match(result, /Status test/);
      assert.match(result, /active/);
    });
  });

  // ── command:check ──
  describe('command:check', () => {
    it('records unmet result', () => {
      const result = run({ command: 'check', checkResult: 'unmet', checkSummary: 'Still working' });
      assert.match(result, /unmet/);
      const goals = readGoals();
      const active = goals.find(g => g.status === 'active');
      assert.equal(active.lastCheckResult, 'unmet');
      assert.equal(active.checkCount, 1);
    });

    it('completes goal on met result', () => {
      run({ command: 'set', description: 'Completable goal', condition: 'Easy' });
      const result = run({ command: 'check', checkResult: 'met', checkSummary: 'Done!' });
      assert.match(result, /自動完成/);
      const goals = readGoals();
      const g = goals.find(g => g.description === 'Completable goal');
      assert.equal(g.status, 'completed');
      assert.equal(g.lastCheckResult, 'met');
    });
  });

  // ── command:clear ──
  describe('command:clear', () => {
    it('clears active goal without id', () => {
      run({ command: 'set', description: 'To be cleared', condition: 'N/A' });
      const result = run({ command: 'clear' });
      assert.match(result, /marked completed/);
    });

    it('clears goal by id', () => {
      run({ command: 'set', description: 'Clear by id', condition: 'N/A' });
      const goals = readGoals();
      const g = goals.find(g => g.description === 'Clear by id');
      const result = run({ command: 'clear', id: g.id, status: 'cancelled' });
      assert.match(result, /marked cancelled/);
    });

    it('returns error for non-existent id', () => {
      const result = run({ command: 'clear', id: 999, status: 'completed' });
      assert.match(result, /not found/);
    });
  });

  // ── command:list ──
  describe('command:list', () => {
    it('shows goal history', () => {
      const result = run({ command: 'list' });
      assert.match(result, /Goal History/);
    });
  });

  // ── command:retry ──
  describe('command:retry', () => {
    it('reactivates last non-active goal without id', () => {
      // Ensure we have at least one non-active goal (completed/cancelled)
      run({ command: 'set', description: 'Retry target', condition: 'Do it' });
      run({ command: 'clear' });
      const result = run({ command: 'retry' });
      assert.match(result, /reactivated/);
      const goals = readGoals();
      const g = goals.find(g => g.description === 'Retry target');
      assert.equal(g.status, 'active');
      assert.equal(g.checkCount, 0);
    });

    it('reactivates goal by id', () => {
      run({ command: 'set', description: 'Retry by id', condition: 'Do it' });
      const goals = readGoals();
      const g = goals.find(g => g.description === 'Retry by id');
      run({ command: 'clear', id: g.id });
      const result = run({ command: 'retry', id: g.id });
      assert.match(result, /reactivated/);
    });
  });

  // ── Edge cases ──
  describe('edge cases', () => {
    it('status with no active goal shows recent completed', () => {
      // Clear all
      let active = readGoals().find(g => g.status === 'active');
      while (active) {
        run({ command: 'clear', id: active.id });
        active = readGoals().find(g => g.status === 'active');
      }
      const result = run({ command: 'status' });
      assert.match(result, /No active goal/);
    });

    it('check with no active goal returns error', () => {
      const result = run({ command: 'check', checkResult: 'met' });
      assert.match(result, /No active goal/);
    });

    it('unknown command returns error', () => {
      const result = run({ command: 'unknown' });
      assert.match(result, /unknown command/);
    });
  });
});
