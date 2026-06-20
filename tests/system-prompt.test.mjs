// system-prompt.test.mjs — Tests for smart-agent system prompt fragment

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT_FRAGMENT } from '../src/agent/system-prompt.mjs';

describe('SYSTEM_PROMPT_FRAGMENT', () => {
  it('exports a non-empty string', () => {
    assert.ok(typeof SYSTEM_PROMPT_FRAGMENT === 'string');
    assert.ok(SYSTEM_PROMPT_FRAGMENT.length > 500);
  });

  it('contains native tool guidance with correct opencode tool names', () => {
    // Native tools (smart_smart_* prefix)
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_learn'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_deep_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_security'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_test'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_context'));
  });

  it('contains router tool guidance via smart_smart_run', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_run'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('error_diagnose'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('cross_file_edit'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('import_graph'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('memory_store'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('fast_apply'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('hybrid_router'));
  });

  it('contains workflow automation guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_run'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('"workflow"'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('dispatch'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('replan'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('summary'));
  });

  it('contains compose/pipeline guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('compose'));
  });

  it('contains memory integration guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('memory_store'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('search'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('store'));
  });

  it('contains context management guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_context'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('summary'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('findings'));
  });

  it('contains planning guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('planner'));
  });

  it('references workflow templates', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('debug-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('refactor-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('security-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('research-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('git-flow'));
  });

  it('contains Smart MCP First rule', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Smart MCP'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('check Smart MCP equivalent first') || SYSTEM_PROMPT_FRAGMENT.includes('No smart tool'));
  });

  it('contains Decision Flow routing logic', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Decision Flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Native tool'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Router tool'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('hybrid_router'));
  });

  it('contains Task Subagent Routing & Isolation (路由規則 + Context防爆) rule', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Task Subagent Routing'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('可用 Subagent 類型'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('mcp-agent'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('11 個工具'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('general'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('explore'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('injected by parent'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_lsp > smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('hybrid_router'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_rules'));
  });
});
