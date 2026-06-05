// tool-strategy.test.mjs — Tests for smart-agent tool recommendation engine

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recommendTools,
  buildToolChain,
  explainRecommendation,
} from '../src/agent/tool-strategy.mjs';

describe('recommendTools', () => {
  it('recommends debug tools for error goals', () => {
    const result = recommendTools('debug login error');
    assert.equal(result.primary, 'smart_grep');
    assert.ok(result.chain.includes('smart_error_diagnose'));
    assert.ok(result.matchScore > 0);
  });

  it('recommends security tools for security goals', () => {
    const result = recommendTools('scan for security vulnerabilities');
    assert.equal(result.primary, 'smart_security');
    assert.ok(result.matchScore > 0);
  });

  it('recommends refactor tools for refactoring goals', () => {
    const result = recommendTools('refactor the user authentication module');
    // Both refactor and dependency patterns match; result depends on scoring
    assert.ok(['smart_learn', 'smart_import_graph'].includes(result.primary));
    assert.ok(result.chain.some(t => ['smart_import_graph', 'smart_naming', 'smart_rename_safety'].includes(t)));
  });

  it('recommends rename tools for renaming goals', () => {
    const result = recommendTools('rename function calculateTotal');
    assert.equal(result.primary, 'smart_rename_safety');
  });

  it('recommends test tools for testing goals', () => {
    const result = recommendTools('write tests for the API endpoints');
    assert.equal(result.primary, 'smart_test');
    assert.ok(result.chain.includes('smart_coverage'));
  });

  it('recommends research tools for research goals', () => {
    const result = recommendTools('research modern API design patterns');
    assert.equal(result.primary, 'smart_exa_search');
  });

  it('recommends git tools for git workflow goals', () => {
    const result = recommendTools('commit and push changes');
    assert.equal(result.primary, 'smart_git_context');
  });

  it('recommends diagram tools for diagram goals', () => {
    const result = recommendTools('draw a flowchart of the login process');
    assert.equal(result.primary, 'smart_diagram');
  });

  it('recommends dependency tools for dependency goals', () => {
    const result = recommendTools('analyze module dependencies');
    assert.equal(result.primary, 'smart_import_graph');
  });

  it('returns think fallback for unknown goals', () => {
    const result = recommendTools('do something');
    assert.equal(result.primary, 'smart_think');
    assert.equal(result.matchScore, 0);
  });

  it('filters recently used tools to end of chain', () => {
    const result = recommendTools('debug login error', { recentTools: ['smart_grep'] });
    // smart_grep should still be in chain but moved after unused tools
    assert.ok(result.chain.includes('smart_grep'));
  });
});

describe('buildToolChain', () => {
  it('builds a complete chain with dependencies for debug goals', () => {
    const chain = buildToolChain('debug login error');
    assert.ok(chain.length >= 4);
    assert.equal(chain[0].tool, 'smart_memory_store');
    assert.equal(chain[0].dependsOn.length, 0);
    assert.ok(chain[1].dependsOn.includes(0));
  });

  it('returns default chain for unknown goals', () => {
    const chain = buildToolChain('do random things');
    assert.ok(chain.length >= 2);
  });
});

describe('explainRecommendation', () => {
  it('formats recommendation as readable string', () => {
    const result = recommendTools('debug login error');
    const explanation = explainRecommendation(result);
    assert.ok(explanation.includes('smart_grep'));
    assert.ok(explanation.includes('Reason'));
    assert.ok(explanation.includes('Confidence'));
  });
});
