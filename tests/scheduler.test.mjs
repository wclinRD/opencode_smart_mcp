// tests/scheduler.test.mjs — Phase 22 Scheduled Background Tasks tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { MemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';

const TEST_DIR = join(os.tmpdir(), `scheduler-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, 'test-memory.db');

function cleanup() {
  resetMemoryDB();
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Scheduled Background Tasks', () => {
  let plugin;
  let schedulerModule;

  before(async () => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
    // Initialize DB
    const db = new MemoryDB(TEST_DB);
    db.open();

    // Override DB path via env-like approach — use the test DB
    process.env.SMART_MEMORY_PATH = TEST_DB;

    schedulerModule = await import('../src/plugins/standard/scheduler.mjs');
    plugin = schedulerModule.default;
  });

  after(() => {
    // Stop all setInterval timers to prevent event loop leak
    if (schedulerModule?.__test_cleanup) schedulerModule.__test_cleanup();
    cleanup();
    delete process.env.SMART_MEMORY_PATH;
  });

  // --- Plugin Structure ---

  it('should export valid plugin definition', () => {
    assert.equal(plugin.name, 'smart_schedule');
    assert.equal(plugin.category, 'standard');
    assert.equal(plugin.safetyLevel, 'medium');
    assert.ok(plugin.inputSchema);
    assert.equal(typeof plugin.handler, 'function');
  });

  // --- Cron Parser (via add validation) ---

  it('should accept valid cron expression', async () => {
    const result = await plugin.handler({
      command: 'add',
      name: 'test-daily',
      schedule: '0 9 * * *',
      task: 'Daily test task'
    });

    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should accept valid cron');
    assert.ok(data.nextRun, 'Should have next run time');
  });

  it('should reject invalid cron expression', async () => {
    const result = await plugin.handler({
      command: 'add',
      name: 'test-bad',
      schedule: 'invalid',
      task: 'Bad schedule'
    });

    assert.ok(!result.ok, 'Should reject invalid cron');
  });

  it('should reject cron with wrong number of fields', async () => {
    const result = await plugin.handler({
      command: 'add',
      name: 'test-few',
      schedule: '* * *',
      task: 'Too few fields'
    });

    assert.ok(!result.ok, 'Should reject too few fields');
  });

  // --- List ---

  it('should list scheduled tasks', async () => {
    // Add a few tasks
    await plugin.handler({ command: 'add', name: 'task-a', schedule: '0 8 * * *', task: 'Task A' });
    await plugin.handler({ command: 'add', name: 'task-b', schedule: '30 12 * * 1-5', task: 'Task B' });

    const result = await plugin.handler({ command: 'list' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should list tasks');
    assert.ok(data.count >= 2, `Expected at least 2 tasks, got ${data.count}`);
  });

  // --- Remove ---

  it('should remove a scheduled task', async () => {
    await plugin.handler({ command: 'add', name: 'to-remove', schedule: '0 0 * * *', task: 'Remove me' });

    const result = await plugin.handler({ command: 'remove', name: 'to-remove' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should remove task');

    // Verify it's gone
    const listResult = await plugin.handler({ command: 'list' });
    const listData = JSON.parse(listResult.output);
    const removed = listData.tasks.find(t => t.name === 'to-remove');
    assert.equal(removed, undefined, 'Task should be removed from list');
  });

  // --- Status ---

  it('should show task status', async () => {
    await plugin.handler({ command: 'add', name: 'status-test', schedule: '0 10 * * *', task: 'Status check' });

    const result = await plugin.handler({ command: 'status' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should show status');
    assert.ok(data.active >= 1, 'Should have active tasks');
  });

  // --- Run Now ---

  it('should run a task immediately', async () => {
    await plugin.handler({
      command: 'add',
      name: 'immediate-test',
      schedule: '0 0 1 1 *', // Once a year — won't auto-trigger
      task: 'Immediate execution test',
      command_to_run: 'echo "hello from scheduler"'
    });

    const result = await plugin.handler({ command: 'run-now', name: 'immediate-test' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should run immediately');
    assert.equal(data.result.status, 'completed', 'Task should complete');
    assert.ok(data.result.output.includes('hello from scheduler'), 'Should capture output');
  });

  it('should error on run-now for non-existent task', async () => {
    const result = await plugin.handler({ command: 'run-now', name: 'nonexistent' });
    assert.ok(!result.ok, 'Should error');
  });

  // --- Error Handling ---

  it('should error on missing name for add', async () => {
    const result = await plugin.handler({ command: 'add', schedule: '0 0 * * *' });
    assert.ok(!result.ok, 'Should error');
  });

  it('should error on missing name for remove', async () => {
    const result = await plugin.handler({ command: 'remove' });
    assert.ok(!result.ok, 'Should error');
  });

  it('should error on unknown command', async () => {
    const result = await plugin.handler({ command: 'unknown' });
    assert.ok(!result.ok, 'Should error');
  });

  // --- Cron Matching ---

  it('should handle various cron patterns', async () => {
    const patterns = [
      { expr: '* * * * *', desc: 'every minute' },
      { expr: '0 9 * * *', desc: 'daily at 9am' },
      { expr: '0 9 * * 1-5', desc: 'weekdays at 9am' },
      { expr: '*/5 * * * *', desc: 'every 5 minutes' },
      { expr: '0 0 1 * *', desc: 'first of month' },
      { expr: '30 14 15 6 *', desc: 'June 15 at 2:30pm' },
    ];

    for (const { expr, desc } of patterns) {
      const result = await plugin.handler({
        command: 'add',
        name: `cron-${desc.replace(/\s+/g, '-')}`,
        schedule: expr,
        task: desc
      });
      const data = JSON.parse(result.output);
      assert.ok(data.ok, `Should accept: ${expr} (${desc})`);
      assert.ok(data.nextRun, `Should have next run for: ${desc}`);
    }
  });
});