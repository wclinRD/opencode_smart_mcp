// system-prompt.test.mjs — Tests for smart-agent system prompt fragment

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT_FRAGMENT } from '../src/agent/system-prompt.mjs';

describe('SYSTEM_PROMPT_FRAGMENT', () => {
  it('exports a non-empty string', () => {
    assert.ok(typeof SYSTEM_PROMPT_FRAGMENT === 'string');
    assert.ok(SYSTEM_PROMPT_FRAGMENT.length > 500);
  });

  it('contains tool selection guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_grep'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_deep_think'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_security'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_test'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_error_diagnose'));
  });

  it('contains workflow automation guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_workflow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('dispatch'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('replan'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('summary'));
  });

  it('contains compose guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_compose'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('seq') || SYSTEM_PROMPT_FRAGMENT.includes('sequential'));
  });

  it('contains memory integration guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_memory_store'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_tool_stats'));
  });

  it('contains context management guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_context'));
  });

  it('contains planning guidance', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('smart_planner'));
  });

  it('references workflow templates', () => {
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('debug-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('refactor-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('security-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('research-flow'));
    assert.ok(SYSTEM_PROMPT_FRAGMENT.includes('git-flow'));
  });
});
