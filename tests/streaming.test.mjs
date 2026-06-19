// tests/streaming.test.mjs — Phase 21 Streaming Progress tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startProgress, reportProgress, reportProgressError,
  completeProgress, getProgress, getAllProgress,
  clearProgress, cleanupProgress, withProgress
} from '../src/plugins/standard/streaming.mjs';

describe('Streaming Progress', () => {
  after(() => {
    // Clean up all progress states
    cleanupProgress(0);
  });

  // --- Basic Progress ---

  it('should start and track progress', () => {
    startProgress('task-1', 'Building index', 100);
    const state = getProgress('task-1');
    assert.ok(state, 'Should have state');
    assert.equal(state.label, 'Building index');
    assert.equal(state.total, 100);
    assert.equal(state.current, 0);
    assert.equal(state.status, 'running');
  });

  it('should report progress', () => {
    startProgress('task-2', 'Running tests', 50);
    reportProgress('task-2', 25, '25/50 tests passed');
    reportProgress('task-2', 40, '40/50 tests passed');

    const state = getProgress('task-2');
    assert.equal(state.current, 40);
    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[0].message, '25/50 tests passed');
  });

  it('should cap progress at total', () => {
    startProgress('task-3', 'Processing', 10);
    reportProgress('task-3', 15, 'Overshot');
    const state = getProgress('task-3');
    assert.equal(state.current, 10, 'Should cap at total');
  });

  it('should complete progress', () => {
    startProgress('task-4', 'Deploying', 5);
    reportProgress('task-4', 3);
    completeProgress('task-4', 'completed');

    const state = getProgress('task-4');
    assert.equal(state.status, 'completed');
    assert.equal(state.current, 5);
    assert.ok(state.completedAt, 'Should have completedAt');
  });

  // --- Errors ---

  it('should track errors without stopping', () => {
    startProgress('task-5', 'Scanning', 100);
    reportProgress('task-5', 30);
    reportProgressError('task-5', 'File not found: config.json');
    reportProgress('task-5', 60);

    const state = getProgress('task-5');
    assert.equal(state.errors.length, 1);
    assert.equal(state.current, 60, 'Should continue after error');
  });

  // --- Get All ---

  it('should list all progress states', () => {
    startProgress('task-a', 'Task A', 10);
    startProgress('task-b', 'Task B', 20);
    completeProgress('task-a');

    const all = getAllProgress();
    assert.ok(all.length >= 2, 'Should have at least 2 tasks');

    const running = all.filter(t => t.status === 'running');
    const completed = all.filter(t => t.status === 'completed');
    assert.ok(running.length >= 1, 'Should have running tasks');
    assert.ok(completed.length >= 1, 'Should have completed tasks');
  });

  // --- Clear ---

  it('should clear a specific task', () => {
    startProgress('to-clear', 'Will be cleared', 10);
    assert.ok(getProgress('to-clear'), 'Should exist before clear');
    clearProgress('to-clear');
    assert.equal(getProgress('to-clear'), null, 'Should be null after clear');
  });

  it('should cleanup completed tasks', () => {
    startProgress('old-completed', 'Old task', 10);
    completeProgress('old-completed');
    startProgress('still-running', 'Running task', 10);

    cleanupProgress(0); // Clear all completed

    assert.equal(getProgress('old-completed'), null, 'Completed should be cleaned');
    assert.ok(getProgress('still-running'), 'Running should remain');
  });

  // --- withProgress wrapper ---

  it('should wrap async function with progress', async () => {
    const result = await withProgress(
      async (report) => {
        report(25, 'Quarter done');
        report(50, 'Half done');
        report(75, 'Almost there');
        return 'done';
      },
      { taskId: 'wrapped-task', label: 'Wrapped', total: 100 }
    );

    assert.equal(result, 'done');
    const state = getProgress('wrapped-task');
    assert.equal(state.status, 'completed');
    assert.equal(state.messages.length, 3);
  });

  it('should handle errors in wrapped function', async () => {
    try {
      await withProgress(
        async (report) => {
          report(10);
          throw new Error('Something broke');
        },
        { taskId: 'error-task', label: 'Will fail', total: 100 }
      );
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.message, 'Something broke');
      const state = getProgress('error-task');
      assert.equal(state.status, 'failed');
      assert.equal(state.errors.length, 1);
    }
  });

  // --- Plugin ---

  it('should export valid plugin definition', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;
    assert.equal(plugin.name, 'smart_progress');
    assert.equal(plugin.category, 'standard');
    assert.ok(plugin.inputSchema);
    assert.equal(typeof plugin.handler, 'function');
  });

  it('should show status via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;

    startProgress('plugin-task', 'Plugin test', 100);
    reportProgress('plugin-task', 42, 'Working...');

    const result = await plugin.handler({ command: 'status', taskId: 'plugin-task' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.equal(data.task.percentage, 42);
    assert.equal(data.task.recentMessages.length, 1);
  });

  it('should list all tasks via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;

    startProgress('list-task-1', 'List test 1', 10);
    startProgress('list-task-2', 'List test 2', 20);

    const result = await plugin.handler({ command: 'all' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.ok(data.count >= 2, 'Should have tasks');
  });

  it('should clear completed tasks via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;

    startProgress('clear-test', 'Clear me', 10);
    completeProgress('clear-test');

    const result = await plugin.handler({ command: 'clear' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.equal(getProgress('clear-test'), null, 'Should be cleared');
  });

  it('should handle missing taskId for status', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;
    const result = await plugin.handler({ command: 'status' });
    assert.ok(!result.ok, 'Should error');
  });

  it('should handle unknown command', async () => {
    const plugin = (await import('../src/plugins/standard/streaming.mjs')).default;
    const result = await plugin.handler({ command: 'unknown' });
    assert.ok(!result.ok, 'Should error');
  });
});