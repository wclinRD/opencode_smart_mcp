// system-prompt.test.mjs — Tests for smart-agent system prompt fragment

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT_FRAGMENT } from '../src/agent/system-prompt.mjs';

describe('SYSTEM_PROMPT_FRAGMENT', () => {
  it('exports a non-empty string', () => {
    assert.ok(typeof SYSTEM_PROMPT_FRAGMENT === 'string');
    assert.ok(SYSTEM_PROMPT_FRAGMENT.length > 500);
  });

  it('contains tool selection guidance with correct opencode tool names', () => {
    // Native tools (smart_smart_* prefix)
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_learn'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_security'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_test'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_deep_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_context'));
  });

  it('contains router tool guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_run'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('error_diagnose'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('cross_file_edit'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('import_graph'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('memory_store'));
  });

  it('contains workflow automation guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_run'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('"workflow"'));
  });

  it('contains compose guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('"compose"'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('pipeline'));
  });

  it('contains memory integration guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('memory_store'));
  });

  it('contains context management guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_context'));
  });

  it('contains planning guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('"planner"'));
  });

  it('contains Smart MCP First rule', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Smart MCP First'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('check Smart MCP equivalent first'));
  });

  it('contains Task Subagent Routing rule', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('Task Subagent Routing'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('subagent has NO Smart MCP routing rules'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('injected by parent'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_lsp > smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('hybrid_router'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_smart_rules'));
  });
});
