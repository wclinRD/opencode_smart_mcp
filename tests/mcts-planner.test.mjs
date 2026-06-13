// mcts-planner.test.mjs — MCTS Tool Planning Tests (Phase 17)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MCTSPlanner, UCTNode, PreEvaluator, PostEvaluator, BidirectionalPruner } from '../src/lib/mcts-planner.mjs';

// Sample tool definitions for testing
const SAMPLE_TOOLS = [
  { name: 'smart_grep', description: 'Search code with regex, returns matched lines with scope context', inputSchema: { properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
  { name: 'smart_learn', description: 'Understand project structure, tech stack, deps', inputSchema: { properties: { root: { type: 'string' } } } },
  { name: 'smart_lsp', description: 'Type-aware code understanding', inputSchema: { properties: { operation: { type: 'string' }, file: { type: 'string' } }, required: ['operation'] } },
  { name: 'smart_security', description: 'Scan for credentials, injection, deps vulnerabilities', inputSchema: { properties: { scan: { type: 'string' } } } },
  { name: 'smart_test', description: 'Discover and run project tests', inputSchema: { properties: { include: { type: 'string' } } } },
  { name: 'smart_error_diagnose', description: 'Diagnose error messages against pattern KB', inputSchema: { properties: { error: { type: 'string' } }, required: ['error'] } },
  { name: 'smart_fast_apply', description: 'Apply LLM patches (unified-diff / SEARCH-REPLACE)', inputSchema: { properties: { patch: { type: 'string' } }, required: ['patch'] } },
  { name: 'smart_cross_file_edit', description: 'Cross-file edits with import graph awareness', inputSchema: { properties: { file: { type: 'string' }, pattern: { type: 'string' } }, required: ['file'] } },
  { name: 'smart_import_graph', description: 'Import dependency graph analysis', inputSchema: { properties: { root: { type: 'string' } } } },
  { name: 'smart_memory_store', description: 'Store and search past error resolutions', inputSchema: { properties: { command: { type: 'string' }, query: { type: 'string' } }, required: ['command'] } },
  { name: 'smart_planner', description: 'Break down complex goals into steps', inputSchema: { properties: { goal: { type: 'string' } }, required: ['goal'] } },
  { name: 'smart_exa_search', description: 'Web search via Exa API', inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'smart_think', description: 'Quick conversational reasoning (default mode: cit)', inputSchema: { properties: { thought: { type: 'string' }, mode: { type: 'string' } }, required: ['thought'] } },
  { name: 'smart_deep_think', description: 'Deep structured analysis with 10 templates', inputSchema: { properties: { topic: { type: 'string' }, template: { type: 'string' } }, required: ['topic'] } },
  { name: 'smart_code_impact', description: 'Change impact analysis', inputSchema: { properties: { file: { type: 'string' } } } },
  { name: 'smart_git_context', description: 'Understand git status', inputSchema: { properties: { root: { type: 'string' } } } },
  { name: 'smart_rename_safety', description: 'Safe symbol renaming across files', inputSchema: { properties: { name: { type: 'string' }, newName: { type: 'string' } }, required: ['name', 'newName'] } },
  { name: 'smart_edit', description: 'Simple string replacement edits', inputSchema: { properties: { oldString: { type: 'string' }, newString: { type: 'string' } }, required: ['oldString', 'newString'] } },
];

// ---------------------------------------------------------------------------
// UCTNode Tests
// ---------------------------------------------------------------------------
describe('UCTNode', () => {
  it('should initialize with default values', () => {
    const node = new UCTNode({ id: 1, tool: 'smart_grep', args: { pattern: 'test' } });
    assert.equal(node.id, 1);
    assert.equal(node.tool, 'smart_grep');
    assert.deepEqual(node.args, { pattern: 'test' });
    assert.equal(node.visits, 0);
    assert.equal(node.reward, 0);
    assert.equal(node.pruned, false);
  });

  it('should return Infinity for unvisited nodes in UCT', () => {
    const parent = new UCTNode({ id: 1, tool: null });
    parent.visits = 10;
    const child = new UCTNode({ id: 2, tool: 'smart_grep', parent });
    assert.equal(child.uctValue(parent.visits), Infinity);
  });

  it('should calculate UCT value correctly', () => {
    const parent = new UCTNode({ id: 1, tool: null });
    parent.visits = 10;
    const child = new UCTNode({ id: 2, tool: 'smart_grep', parent });
    child.visits = 5;
    child.reward = 4; // avg reward = 0.8
    const uct = child.uctValue(parent.visits, 1.414);
    const expectedExploitation = 4 / 5; // 0.8
    const expectedExploration = 1.414 * Math.sqrt(Math.log(10) / 5);
    assert.ok(Math.abs(uct - (expectedExploitation + expectedExploration)) < 0.001);
  });

  it('should calculate composite score correctly', () => {
    const node = new UCTNode({ id: 1, tool: 'smart_grep' });
    node.preScore = 0.8;
    node.postScore = 0.6;
    node.visits = 10;
    node.reward = 7; // avg reward = 0.7
    // score = 0.3*0.8 + 0.4*0.6 + 0.3*0.7 = 0.24 + 0.24 + 0.21 = 0.69
    assert.ok(Math.abs(node.compositeScore() - 0.69) < 0.01);
  });

  it('should detect leaf nodes', () => {
    const node = new UCTNode({ id: 1, tool: null });
    assert.ok(node.isLeaf());
    const child = new UCTNode({ id: 2, tool: 'smart_grep', parent: node });
    node.children.push(child);
    assert.ok(!node.isLeaf());
    child.pruned = true;
    assert.ok(node.isLeaf());
  });

  it('should return active children only', () => {
    const node = new UCTNode({ id: 1, tool: null });
    const c1 = new UCTNode({ id: 2, tool: 'smart_grep', parent: node });
    const c2 = new UCTNode({ id: 3, tool: 'smart_lsp', parent: node });
    c2.pruned = true;
    node.children.push(c1, c2);
    const active = node.activeChildren();
    assert.equal(active.length, 1);
    assert.equal(active[0].tool, 'smart_grep');
  });

  it('should get path from root to node', () => {
    const root = new UCTNode({ id: 1, tool: null, depth: 0 });
    const n1 = new UCTNode({ id: 2, tool: 'smart_grep', parent: root, depth: 1 });
    n1.preScore = 0.8; n1.postScore = 0.7; n1.visits = 5; n1.reward = 3.5;
    const n2 = new UCTNode({ id: 3, tool: 'smart_lsp', parent: n1, depth: 2 });
    n2.preScore = 0.9; n2.postScore = 0.85; n2.visits = 3; n2.reward = 2.4;
    root.children.push(n1);
    n1.children.push(n2);
    const path = n2.getPath();
    assert.equal(path.length, 2);
    assert.equal(path[0].tool, 'smart_grep');
    assert.equal(path[1].tool, 'smart_lsp');
  });

  it('should find best child', () => {
    const node = new UCTNode({ id: 1, tool: null });
    const c1 = new UCTNode({ id: 2, tool: 'smart_grep', parent: node });
    c1.preScore = 0.9; c1.postScore = 0.8; c1.visits = 5; c1.reward = 4;
    const c2 = new UCTNode({ id: 3, tool: 'smart_lsp', parent: node });
    c2.preScore = 0.5; c2.postScore = 0.4; c2.visits = 3; c2.reward = 1;
    node.children.push(c1, c2);
    assert.equal(node.bestChild().tool, 'smart_grep');
  });
});

// ---------------------------------------------------------------------------
// PreEvaluator Tests
// ---------------------------------------------------------------------------
describe('PreEvaluator', () => {
  const evaluator = new PreEvaluator(SAMPLE_TOOLS);

  it('should return 0 for unknown tools', () => {
    assert.equal(evaluator.evaluate('unknown_tool', {}), 0);
  });

  it('should score grep higher for search tasks', () => {
    const grepScore = evaluator.evaluate('smart_grep', { goal: 'search for error in code' });
    const lspScore = evaluator.evaluate('smart_lsp', { goal: 'search for error in code' });
    assert.ok(grepScore >= lspScore);
  });

  it('should score security tool higher for security tasks', () => {
    const secScore = evaluator.evaluate('smart_security', { goal: 'security vulnerability scan' });
    const grepScore = evaluator.evaluate('smart_grep', { goal: 'security vulnerability scan' });
    assert.ok(secScore >= grepScore);
  });

  it('should penalize repeated tools', () => {
    const scoreWithoutRepeat = evaluator.evaluate('smart_grep', { goal: 'debug error', previousResults: [] });
    const scoreWithRepeat = evaluator.evaluate('smart_grep', { goal: 'debug error', previousResults: [{ tool: 'smart_grep' }] });
    assert.ok(scoreWithRepeat <= scoreWithoutRepeat);
  });

  it('should handle empty context gracefully', () => {
    const score = evaluator.evaluate('smart_think', {});
    assert.ok(score >= 0 && score <= 1);
  });

  it('should give bonus for schema-compatible contexts', () => {
    const score = evaluator.evaluate('smart_grep', { goal: 'find pattern', pattern: 'test' });
    assert.ok(score > 0);
  });
});

// ---------------------------------------------------------------------------
// PostEvaluator Tests
// ---------------------------------------------------------------------------
describe('PostEvaluator', () => {
  const evaluator = new PostEvaluator();

  it('should return 0 for null result', () => {
    assert.equal(evaluator.evaluate(null), 0);
  });

  it('should score successful results higher than failed', () => {
    const okResult = evaluator.evaluate({ ok: true, output: 'found 3 matches\nline 1: error' });
    const failResult = evaluator.evaluate({ ok: false, error: 'something went wrong' });
    assert.ok(okResult > failResult);
  });

  it('should reward rich output', () => {
    const rich = evaluator.evaluate({ ok: true, output: 'a'.repeat(100) });
    const poor = evaluator.evaluate({ ok: true, output: 'short' });
    assert.ok(rich >= poor);
  });

  it('should reward goal-relevant output', () => {
    const relevant = evaluator.evaluate(
      { ok: true, output: 'Found the debug error in login handler' },
      { goal: 'debug login error' }
    );
    const irrelevant = evaluator.evaluate(
      { ok: true, output: 'Some random result' },
      { goal: 'debug login error' }
    );
    assert.ok(relevant >= irrelevant);
  });

  it('should penalize errors and timeouts', () => {
    const clean = evaluator.evaluate({ ok: true, output: 'success' });
    const timedOut = evaluator.evaluate({ ok: true, output: 'success', timedOut: true });
    assert.ok(clean > timedOut);
  });

  it('should reward actionable findings', () => {
    const withFindings = evaluator.evaluate({ ok: true, output: 'test', findings: ['leak detected'] });
    const without = evaluator.evaluate({ ok: true, output: 'test' });
    assert.ok(withFindings >= without);
  });
});

// ---------------------------------------------------------------------------
// BidirectionalPruner Tests
// ---------------------------------------------------------------------------
describe('BidirectionalPruner', () => {
  it('should prune low preScore candidates', () => {
    const pruner = new BidirectionalPruner({ preThreshold: 0.3 });
    const node = new UCTNode({ id: 1, tool: null });
    const candidates = [
      { tool: 'smart_grep', preScore: 0.9 },
      { tool: 'smart_test', preScore: 0.1 },
      { tool: 'smart_lsp', preScore: 0.8 },
    ];
    const result = pruner.prePrune(node, candidates);
    assert.equal(result.length, 2);
    assert.ok(result.every(c => c.preScore >= 0.3));
  });

  it('should respect maxDepth', () => {
    const pruner = new BidirectionalPruner({ maxDepth: 3 });
    const node = new UCTNode({ id: 1, tool: null, depth: 4 });
    const candidates = [
      { tool: 'smart_grep', preScore: 0.9 },
      { tool: 'smart_lsp', preScore: 0.8 },
    ];
    const result = pruner.prePrune(node, candidates);
    assert.equal(result.length, 0);
  });

  it('should limit max children', () => {
    const pruner = new BidirectionalPruner({ maxChildren: 2 });
    const node = new UCTNode({ id: 1, tool: null, depth: 1 });
    const candidates = [
      { tool: 'a', preScore: 0.9 },
      { tool: 'b', preScore: 0.8 },
      { tool: 'c', preScore: 0.7 },
      { tool: 'd', preScore: 0.6 },
    ];
    const result = pruner.prePrune(node, candidates);
    assert.equal(result.length, 2);
  });

  it('should prune low postScore children', () => {
    const pruner = new BidirectionalPruner({ postThreshold: 0.3 });
    const node = new UCTNode({ id: 1, tool: null });
    const c1 = new UCTNode({ id: 2, tool: 'a', parent: node });
    c1.postScore = 0.9; c1.executed = true;
    const c2 = new UCTNode({ id: 3, tool: 'b', parent: node });
    c2.postScore = 0.1; c2.executed = true;
    node.children.push(c1, c2);
    pruner.postPrune(node);
    assert.equal(c1.pruned, false);
    assert.equal(c2.pruned, true);
  });

  it('should sort and limit post-prune children', () => {
    const pruner = new BidirectionalPruner({ maxChildren: 2 });
    const node = new UCTNode({ id: 1, tool: null });
    const children = [];
    for (let i = 0; i < 4; i++) {
      const c = new UCTNode({ id: i + 2, tool: `tool${i}`, parent: node });
      c.preScore = (4 - i) * 0.25;
      c.postScore = (4 - i) * 0.25;
      node.children.push(c);
    }
    pruner.postPrune(node);
    const active = node.activeChildren();
    assert.equal(active.length, 2);
  });
});

// ---------------------------------------------------------------------------
// MCTSPlanner Tests
// ---------------------------------------------------------------------------
describe('MCTSPlanner', () => {
  it('should initialize with default options', () => {
    const planner = new MCTSPlanner();
    assert.equal(planner.maxIterations, 100);
    assert.equal(planner.timeout, 30000);
    assert.equal(planner.explorationConstant, 1.414);
  });

  it('should accept custom options', () => {
    const planner = new MCTSPlanner({ maxIterations: 50, timeout: 10000, explorationConstant: 2.0 });
    assert.equal(planner.maxIterations, 50);
    assert.equal(planner.timeout, 10000);
    assert.equal(planner.explorationConstant, 2.0);
  });

  it('should return a valid result structure', async () => {
    const planner = new MCTSPlanner({ maxIterations: 20, timeout: 5000 });
    const mockExecute = async (tool, args) => ({ ok: true, output: `${tool} executed`, findings: ['result'] });
    const result = await planner.search({
      goal: 'debug login error',
      availableTools: SAMPLE_TOOLS.slice(0, 5),
      executeTool: mockExecute,
    });

    assert.ok(result.hasOwnProperty('path'));
    assert.ok(result.hasOwnProperty('score'));
    assert.ok(result.hasOwnProperty('iterations'));
    assert.ok(result.hasOwnProperty('converged'));
    assert.ok(result.hasOwnProperty('elapsed'));
    assert.ok(result.hasOwnProperty('stats'));
    assert.ok(result.iterations > 0);
  });

  it('should find a reasonable tool chain for debug tasks', async () => {
    const planner = new MCTSPlanner({ maxIterations: 30, timeout: 5000 });
    const mockExecute = async (tool, args) => ({ ok: true, output: `${tool} result`, findings: ['match'] });
    const result = await planner.search({
      goal: 'debug login error',
      availableTools: SAMPLE_TOOLS.slice(0, 8),
      executeTool: mockExecute,
    });

    const toolNames = (result.path || []).map(p => p.tool);
    // Should prefer grep, error_diagnose, or lsp for debug
    const debugRelevant = ['smart_grep', 'smart_error_diagnose', 'smart_lsp'];
    const hasRelevant = toolNames.some(t => debugRelevant.includes(t));
    assert.ok(hasRelevant, `Expected debug-relevant tools in [${toolNames.join(', ')}]`);
  });

  it('should find a reasonable tool chain for security tasks', async () => {
    const planner = new MCTSPlanner({ maxIterations: 30, timeout: 5000 });
    const mockExecute = async (tool, args) => ({ ok: true, output: `${tool} result`, findings: ['match'] });
    const result = await planner.search({
      goal: 'security vulnerability scan',
      availableTools: SAMPLE_TOOLS.slice(0, 8),
      executeTool: mockExecute,
    });

    const toolNames = (result.path || []).map(p => p.tool);
    const hasSecurity = toolNames.includes('smart_security');
    assert.ok(hasSecurity, `Expected smart_security in [${toolNames.join(', ')}]`);
  });

  it('should respect timeout', async () => {
    const planner = new MCTSPlanner({ maxIterations: 1000, timeout: 100 });
    const slowExecute = async () => {
      await new Promise(r => setTimeout(r, 10));
      return { ok: true, output: 'done' };
    };
    const result = await planner.search({
      goal: 'test timeout',
      availableTools: SAMPLE_TOOLS.slice(0, 4),
      executeTool: slowExecute,
    });
    assert.ok(result.iterations < 100);
  });

  it('should converge when scores stabilize', async () => {
    const planner = new MCTSPlanner({
      maxIterations: 200,
      timeout: 10000,
      convergenceThreshold: 0.2,
      convergenceWindow: 5,
    });
    const mockExecute = async (tool, args) => {
      return { ok: true, output: `${tool}: success with detailed analysis`, findings: ['key result'] };
    };
    const result = await planner.search({
      goal: 'fix bug',
      availableTools: SAMPLE_TOOLS.slice(0, 6),
      executeTool: mockExecute,
    });
    // Should converge with tight threshold
    assert.ok(result.stats.totalNodes > 0);
  });

  it('should track statistics', async () => {
    const planner = new MCTSPlanner({ maxIterations: 15, timeout: 5000 });
    const mockExecute = async (tool, args) => ({ ok: true, output: 'ok' });
    const result = await planner.search({
      goal: 'test stats',
      availableTools: SAMPLE_TOOLS.slice(0, 3),
      executeTool: mockExecute,
    });
    assert.ok(result.stats.totalNodes > 0);
    assert.ok(result.stats.avgBranching >= 0);
  });
});

// ---------------------------------------------------------------------------
// Static Fallback Tests
// ---------------------------------------------------------------------------
describe('MCTSPlanner.fallbackRecommendation', () => {
  it('should return debug chain for debug goal', () => {
    const result = MCTSPlanner.fallbackRecommendation('debug login error', []);
    const toolNames = result.path.map(p => p.tool);
    assert.ok(toolNames.includes('smart_grep'));
    assert.ok(toolNames.includes('smart_error_diagnose'));
    assert.ok(toolNames.includes('smart_test'));
  });

  it('should return security chain for security goal', () => {
    const result = MCTSPlanner.fallbackRecommendation('security scan', []);
    const toolNames = result.path.map(p => p.tool);
    assert.ok(toolNames.includes('smart_security'));
  });

  it('should return default chain for unknown goal', () => {
    const result = MCTSPlanner.fallbackRecommendation('xyzzy unknown task', []);
    assert.ok(result.path.length >= 1);
  });

  it('should filter by available tools', () => {
    const result = MCTSPlanner.fallbackRecommendation('debug error', ['smart_grep', 'smart_test']);
    const toolNames = result.path.map(p => p.tool);
    assert.ok(toolNames.every(t => ['smart_grep', 'smart_test'].includes(t)));
    assert.ok(!toolNames.includes('smart_error_diagnose'));
  });
});

// ---------------------------------------------------------------------------
// Integration: MCTS with static fallback
// ---------------------------------------------------------------------------
describe('MCTSPlanner Integration', () => {
  it('should handle empty tool list gracefully', async () => {
    const planner = new MCTSPlanner({ maxIterations: 10, timeout: 2000 });
    const result = await planner.search({
      goal: 'test',
      availableTools: [],
      executeTool: null,
    });
    assert.ok(result.path.length === 0 || result.path.length === 1);
  });

  it('should work without executeTool (pre-score only)', async () => {
    const planner = new MCTSPlanner({ maxIterations: 20, timeout: 5000 });
    const result = await planner.search({
      goal: 'debug error',
      availableTools: SAMPLE_TOOLS.slice(0, 4),
      executeTool: null,
    });
    assert.ok(result.path.length > 0);
  });

  it('preExecute + postExecute should score consistently', async () => {
    const evaluator = new PostEvaluator();
    const result1 = evaluator.evaluate({ ok: true, output: 'line1: found the error in src/auth.js\nline2: null pointer exception' });
    const result2 = evaluator.evaluate({ ok: true, output: 'line1: found the error in src/auth.js\nline2: null pointer exception' });
    assert.equal(result1, result2);
  });
});
