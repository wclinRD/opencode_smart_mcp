// personality.test.mjs — Tests for config/agents/smart-mcp.md (opencode personality)
// Verifies routing rules, behavior gates, and key structural elements

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONALITY_PATH = resolve(__dirname, '..', 'config', 'agents', 'smart-mcp.md');
const personality = readFileSync(PERSONALITY_PATH, 'utf-8');

describe('smart-mcp.md personality', () => {
  it('is a non-empty file', () => {
    assert.ok(personality.length > 1000);
  });

  it('has valid YAML frontmatter', () => {
    assert.ok(personality.startsWith('---'));
    assert.ok(personality.includes('description:'));
    assert.ok(personality.includes('mode: primary'));
    assert.ok(personality.includes('permission:'));
  });

  it('contains core routing rules', () => {
    assert.ok(personality.includes('直接工具優先'));
    assert.ok(personality.includes('smart_smart_run'));
    assert.ok(personality.includes('hybrid_router'));
  });

  it('contains behavior gate section', () => {
    assert.ok(personality.includes('行為閘'));
  });

  it('contains task subagent routing rule', () => {
    assert.ok(personality.includes('task 強制'));
    assert.ok(personality.includes('subagent_type 選 general（explore/explorer 無 MCP 工具）'));
    assert.ok(personality.includes('smart_lsp > smart_read > smart_grep > raw'));
  });

  it('contains LSP priority principle', () => {
    assert.ok(personality.includes('LSP 優先'));
    assert.ok(personality.includes('smart_lsp'));
    assert.ok(personality.includes('definition'));
    assert.ok(personality.includes('references'));
  });

  it('contains reasoning quality gates', () => {
    assert.ok(personality.includes('推理品質閘'));
    assert.ok(personality.includes('強制'));
    assert.ok(personality.includes('Server 端執行'));
  });

  it('references all permission-granted tools', () => {
    // Core tools that should be mentioned
    const requiredTools = [
      'smart_smart_run',
      'smart_grep',
      'smart_learn',
      'smart_think',
      'smart_deep_think',
      'smart_security',
      'smart_test',
      'smart_lsp',
      'smart_context',
      'smart_rules',
    ];
    for (const tool of requiredTools) {
      assert.ok(personality.includes(tool), `Missing reference to ${tool}`);
    }
  });

  it('contains all direct-call tools table', () => {
    assert.ok(personality.includes('smart_grep'));
    assert.ok(personality.includes('smart_learn'));
    assert.ok(personality.includes('smart_think'));
    assert.ok(personality.includes('smart_deep_think'));
    assert.ok(personality.includes('smart_security'));
    assert.ok(personality.includes('smart_test'));
    // Note: smart_context and smart_rules may appear only in description not table
  });

  it('contains sub-tool references', () => {
    const subTools = ['fast_apply', 'edit', 'hybrid_router', 'error_diagnose', 'import_graph'];
    for (const t of subTools) {
      assert.ok(personality.includes(t), `Missing sub-tool reference: ${t}`);
    }
  });
});
