// tests/task-dispatch.test.mjs — Task Dispatch Plugin tests
//
// Tests: plugin structure, output formats, routing injection, stats tracking

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STATS_PATH = join(homedir(), '.smart', 'task-dispatch-stats.json');

let plugin;

before(async () => {
  // Import the plugin
  plugin = (await import('../src/plugins/standard/task-dispatch.mjs')).default;
  // Clean up stats file before tests
  try { unlinkSync(STATS_PATH); } catch { /* ok */ }
});

after(() => {
  // Clean up
  try { unlinkSync(STATS_PATH); } catch { /* ok */ }
});

describe('smart_task_dispatch plugin structure', () => {
  it('should export a plugin object with required fields', () => {
    assert.ok(plugin, 'plugin should be defined');
    assert.strictEqual(plugin.name, 'smart_task_dispatch');
    assert.ok(plugin.description, 'should have description');
    assert.ok(plugin.inputSchema, 'should have inputSchema');
    assert.strictEqual(plugin.inputSchema.type, 'object');
    assert.ok(plugin.handler, 'should have async handler');
    assert.strictEqual(typeof plugin.handler, 'function');
  });

  it('should require "task" parameter', () => {
    assert.ok(plugin.inputSchema.required.includes('task'));
  });

  it('should define "type" enum with valid subagent types', () => {
    const typeProp = plugin.inputSchema.properties.type;
    assert.ok(typeProp, 'should have type property');
    assert.deepStrictEqual(typeProp.enum, ['mcp-agent', 'general', 'explore', 'explorer']);
  });

  it('should define format options', () => {
    const formatProp = plugin.inputSchema.properties.format;
    assert.ok(formatProp);
    assert.deepStrictEqual(formatProp.enum, ['text', 'json', 'call']);
  });
});

describe('smart_task_dispatch handler — text format (default)', () => {
  it('should return text with task description and routing', async () => {
    const result = await plugin.handler({
      task: '研究 src/auth 的登入流程',
    });

    assert.ok(result.includes('Task Dispatch'));
    assert.ok(result.includes('研究 src/auth'));
    assert.ok(result.includes('mcp-agent'));
    assert.ok(result.includes('task({'));
    assert.ok(result.includes('subagent_type: "mcp-agent"'));
    assert.ok(result.includes('Smart MCP Routing'));
  });

  it('should respect "type" parameter', async () => {
    const result = await plugin.handler({
      task: '快速搜尋 TODO',
      type: 'explore',
    });

    assert.ok(result.includes('explore'));
    assert.ok(result.includes('6 個原生工具'));
  });

  it('should include context when provided', async () => {
    const result = await plugin.handler({
      task: '修復 auth bug',
      type: 'mcp-agent',
      context: '已經用 smart_grep 找到相關位置',
    });

    assert.ok(result.includes('Context'));
  });

  it('should include verification instructions when provided', async () => {
    const result = await plugin.handler({
      task: '重構 API 路由',
      verify: 'run npm test',
    });

    assert.ok(result.includes('Verification'));
  });
});

describe('smart_task_dispatch handler — json format', () => {
  it('should return valid JSON with proper structure', async () => {
    const result = await plugin.handler({
      task: 'refactor auth module',
      type: 'general',
      format: 'json',
    });

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.subagentType, 'general');
    assert.ok(parsed.taskCall);
    assert.ok(parsed.stats);
    assert.ok(parsed.taskCall.includes('Smart MCP Routing'));
    assert.ok(parsed.taskCall.includes('subagent_type: "general"'));
  });
});

describe('smart_task_dispatch handler — call format', () => {
  it('should return only the task() call string', async () => {
    const result = await plugin.handler({
      task: 'fix login validation',
      format: 'call',
    });

    assert.ok(result.startsWith('task({'));
    assert.ok(result.includes('subagent_type:'));
    assert.ok(result.includes('Smart MCP Routing'));
    // Should NOT have markdown formatting
    assert.ok(!result.includes('##'));
    assert.ok(!result.includes('**'));
  });
});

describe('smart_task_dispatch — stats tracking', () => {
  it('should track dispatch counts per type', async () => {
    // First call already happened in previous tests
    const result1 = await plugin.handler({
      task: 'test stats 1',
      type: 'mcp-agent',
      format: 'json',
    });

    const data1 = JSON.parse(result1);
    assert.ok(data1.stats.totalDispatches >= 1);
    assert.ok(data1.stats.byType['mcp-agent'] >= 1);

    // Second call with different type
    const result2 = await plugin.handler({
      task: 'test stats 2',
      type: 'explore',
      format: 'json',
    });

    const data2 = JSON.parse(result2);
    assert.ok(data2.stats.totalDispatches >= data1.stats.totalDispatches + 1);
    assert.ok(data2.stats.byType['explore'] >= 1);
  });
});

describe('smart_task_dispatch — error handling', () => {
  it('should reject unknown subagent types', async () => {
    const result = await plugin.handler({
      task: 'test',
      type: 'nonexistent',
    });

    assert.ok(result.includes('Unknown'));
  });

  it('should handle empty task gracefully', async () => {
    const result = await plugin.handler({
      task: '',
    });

    assert.ok(result);
  });
});

describe('smart_task_dispatch — routing injection content', () => {
  it('should inject correct routing for mcp-agent', async () => {
    const result = await plugin.handler({
      task: 'test routing',
      type: 'mcp-agent',
      format: 'json',
    });

    const parsed = JSON.parse(result);
    assert.ok(parsed.taskCall.includes('smart_smart_read'));
    assert.ok(parsed.taskCall.includes('smart_smart_fast_apply'));
    assert.ok(parsed.taskCall.includes('hybrid_router'));
  });

  it('should inject correct routing for general', async () => {
    const result = await plugin.handler({
      task: 'test routing',
      type: 'general',
      format: 'json',
    });

    const parsed = JSON.parse(result);
    assert.ok(parsed.taskCall.includes('smart_smart_read'));
    assert.ok(parsed.taskCall.includes('smart_smart_fast_apply'));
    // general should mention beam mode
    assert.ok(parsed.taskCall.includes('beam'));
  });

  it('should inject correct routing for explore', async () => {
    const result = await plugin.handler({
      task: 'test routing',
      type: 'explore',
      format: 'json',
    });

    const parsed = JSON.parse(result);
    assert.ok(parsed.taskCall.includes('基礎工具'));
  });
});
