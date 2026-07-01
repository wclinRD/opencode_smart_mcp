// ── P2.2 Atomic DAG + ADAPT + Budget + 信心評分 測試 ──
// 測試策略：單元測試每個 export function，含正常/邊界/錯誤路徑

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── DAG ──
import {
  dagSort,
  dagGetReadyNodes,
  dagValidate,
  subtasksToDAG,
  formatDAG,
  dagCreateSubNodes,
} from '../src/lib/decompose-dag.mjs';

// ── ADAPT ──
import {
  adaptCheckTrigger,
  adaptMaxDepthCheck,
  adaptStepCount,
  adaptChooseStrategy,
  adaptGenerateSubSteps,
  adaptBuildContext,
  adaptSessionSummary,
} from '../src/lib/decompose-adapt.mjs';

// ── Budget ──
import {
  autoDetectBudget,
  formatBudgetIndicator,
  getQwen3Params,
  getThinkingTokenBudget,
  budgetDecision,
  contextPressure,
} from '../src/lib/decompose-budget.mjs';

// ── 信心評分 ──
import {
  calcConfidenceScore,
  validateNode,
  formatConfidenceBar,
  validateCycle,
  generateFixSuggestions,
} from '../src/lib/decompose-confidence.mjs';

// ═══════════════════════════════════════════
// F: DAG
// ═══════════════════════════════════════════

describe('dagSort (F1)', () => {
  it('null/empty → empty sorted', () => {
    assert.deepEqual(dagSort(null), { sorted: [], circular: false, circularPath: [] });
    assert.deepEqual(dagSort([]), { sorted: [], circular: false, circularPath: [] });
  });

  it('no deps → returns all in any order', () => {
    const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const r = dagSort(nodes);
    assert.equal(r.circular, false);
    assert.equal(r.sorted.length, 3);
  });

  it('linear chain → topologically sorted', () => {
    const nodes = [
      { id: 1, deps: [] },
      { id: 2, deps: [1] },
      { id: 3, deps: [2] },
    ];
    const r = dagSort(nodes);
    assert.equal(r.circular, false);
    assert.deepEqual(r.sorted, [1, 2, 3]);
  });

  it('detects circular dependency', () => {
    const nodes = [
      { id: 1, deps: [2] },
      { id: 2, deps: [3] },
      { id: 3, deps: [1] },
    ];
    const r = dagSort(nodes);
    assert.equal(r.circular, true);
    assert.ok(r.circularPath.length > 0);
  });

  it('diamond DAG → correct topological order', () => {
    const nodes = [
      { id: 1, deps: [] },
      { id: 2, deps: [1] },
      { id: 3, deps: [1] },
      { id: 4, deps: [2, 3] },
    ];
    const r = dagSort(nodes);
    assert.equal(r.circular, false);
    assert.equal(r.sorted[0], 1);
    assert.equal(r.sorted[3], 4);
  });
});

describe('dagGetReadyNodes (F2)', () => {
  it('no ready nodes without done deps', () => {
    const nodes = [
      { id: 1, deps: [] },
      { id: 2, deps: [1] },
    ];
    const r = dagGetReadyNodes(nodes, []);
    assert.equal(r.ready.length, 1);
    assert.equal(r.blocked.length, 1);
  });

  it('returns ready when deps are done', () => {
    const nodes = [
      { id: 1, deps: [] },
      { id: 2, deps: [1] },
    ];
    const r = dagGetReadyNodes(nodes, [1]);
    assert.equal(r.ready.length, 1);
    assert.equal(r.ready[0].id, 2);
  });

  it('all done → ready empty', () => {
    const nodes = [
      { id: 1, deps: [], status: 'done' },
      { id: 2, deps: [1], status: 'done' },
    ];
    const r = dagGetReadyNodes(nodes, [1, 2]);
    assert.equal(r.done.length, 2);
    assert.equal(r.ready.length, 0);
  });

  it('null/undefined → empty', () => {
    assert.deepEqual(dagGetReadyNodes(null), { ready: [], blocked: [], done: [] });
    assert.deepEqual(dagGetReadyNodes(undefined), { ready: [], blocked: [], done: [] });
  });
});

describe('dagValidate (F3)', () => {
  it('empty → error', () => {
    const r = dagValidate([]);
    assert.ok(r.errors.length > 0);
  });

  it('valid nodes → no errors', () => {
    const nodes = [
      { id: 1, desc: 'step 1', deps: [] },
      { id: 2, desc: 'step 2', deps: [1] },
    ];
    const r = dagValidate(nodes);
    assert.equal(r.errors.length, 0);
  });

  it('missing desc → error', () => {
    const r = dagValidate([{ id: 1 }]);
    assert.ok(r.errors.some(e => e.includes('missing desc')));
  });

  it('invalid status → error', () => {
    const r = dagValidate([{ id: 1, desc: 'test', status: 'invalid' }]);
    assert.ok(r.errors.some(e => e.includes('invalid status')));
  });

  it('self-dependency → error', () => {
    const r = dagValidate([{ id: 1, desc: 'self', deps: [1] }]);
    assert.ok(r.errors.some(e => e.includes('self-dependency')));
  });

  it('atomic node with deps → warning', () => {
    const r = dagValidate([{ id: 1, desc: 'test', atomic: true, deps: [2] }, { id: 2, desc: 'dep' }]);
    assert.ok(r.warnings.some(w => w.includes('atomic')));
  });
});

describe('subtasksToDAG', () => {
  it('converts subtasks to dag format', () => {
    const subs = [{ id: 1, desc: 'step1', status: 'done', deps: [], tool: 'smart_grep' }];
    const r = subtasksToDAG(subs);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 1);
    assert.equal(r[0].tool, 'smart_grep');
    assert.equal(r[0].atomic, false);
  });

  it('null → []', () => {
    assert.deepEqual(subtasksToDAG(null), []);
  });
});

describe('formatDAG (F4)', () => {
  it('returns formatted ASCII tree', () => {
    const nodes = [
      { id: 1, desc: 'root', deps: [] },
      { id: 2, desc: 'child', deps: [1] },
    ];
    const r = formatDAG(nodes, [1]);
    assert.ok(r.includes('DAG'));
    assert.ok(r.includes('root'));
    assert.ok(r.includes('child'));
  });

  it('empty → empty string', () => {
    assert.equal(formatDAG([]), '');
  });
});

describe('dagCreateSubNodes (F5)', () => {
  it('creates sub-nodes with correct deps', () => {
    const existing = [{ id: 1, desc: 'parent', deps: [0] }];
    const subSteps = ['sub1', 'sub2'];
    const r = dagCreateSubNodes(existing, 1, subSteps);
    assert.equal(r.length, 2);
    assert.equal(r[0].desc, 'sub1');
    assert.equal(r[1].desc, 'sub2');
    assert.deepEqual(r[0].deps, [0]);
    assert.deepEqual(r[1].deps, [r[0].id]);
    assert.equal(r[0].atomic, true);
  });

  it('empty subSteps → []', () => {
    assert.deepEqual(dagCreateSubNodes([{ id: 1 }], 1, []), []);
    assert.deepEqual(dagCreateSubNodes([{ id: 1 }], 1, null), []);
  });
});

// ═══════════════════════════════════════════
// G: ADAPT
// ═══════════════════════════════════════════

describe('adaptCheckTrigger (G1)', () => {
  it('no trigger → shouldDecompose=false', () => {
    const r = adaptCheckTrigger({
      thoughtLength: 100, confidence: 7, hasResult: true,
      roundCount: 1, currentTask: 'simple task',
    });
    assert.equal(r.shouldDecompose, false);
  });

  it('low confidence → trigger', () => {
    const r = adaptCheckTrigger({ confidence: 2 });
    assert.equal(r.shouldDecompose, true);
    assert.equal(r.priority, 9);
  });

  it('short thought → trigger', () => {
    const r = adaptCheckTrigger({ thoughtLength: 10, roundCount: 1 });
    assert.equal(r.shouldDecompose, true);
  });

  it('long thought → trigger', () => {
    const r = adaptCheckTrigger({ thoughtLength: 400 });
    assert.equal(r.shouldDecompose, true);
  });

  it('max depth exceeded → no decompose', () => {
    const r = adaptCheckTrigger({ roundCount: 5, maxDepth: 3 });
    assert.equal(r.shouldDecompose, false);
    assert.equal(r.reason, '超過最大深度');
  });

  it('multi-part task → trigger', () => {
    const r = adaptCheckTrigger({ currentTask: 'fix and test and deploy' });
    assert.equal(r.shouldDecompose, true);
  });

  it('no result after 2 rounds → trigger', () => {
    const r = adaptCheckTrigger({ hasResult: false, roundCount: 2 });
    assert.equal(r.shouldDecompose, true);
  });
});

describe('adaptMaxDepthCheck (G2)', () => {
  it('within depth → true', () => { assert.equal(adaptMaxDepthCheck(1, 3), true); });
  it('at max depth → false', () => { assert.equal(adaptMaxDepthCheck(3, 3), false); });
  it('default maxDepth = 3', () => {
    assert.equal(adaptMaxDepthCheck(2), true);
    assert.equal(adaptMaxDepthCheck(3), false);
  });
});

describe('adaptStepCount', () => {
  it('returns step count based on thought length', () => {
    assert.equal(adaptStepCount(20), 2);
    assert.equal(adaptStepCount(80), 3);
    assert.equal(adaptStepCount(200), 4);
    assert.equal(adaptStepCount(400), 5);
    assert.equal(adaptStepCount(600), 6);
  });
});

describe('adaptChooseStrategy (G3)', () => {
  it('task type maps to strategy', () => {
    assert.equal(adaptChooseStrategy({ taskType: 'debug' }), 'trace-backward');
    assert.equal(adaptChooseStrategy({ taskType: 'refactor' }), 'modularize');
    assert.equal(adaptChooseStrategy({ taskType: 'research' }), 'breadth-first');
    assert.equal(adaptChooseStrategy({ taskType: 'decision' }), 'compare-contrast');
    assert.equal(adaptChooseStrategy({ taskType: 'feature' }), 'top-down');
  });

  it('low confidence → breadth-first', () => {
    assert.equal(adaptChooseStrategy({ taskType: 'general', confidence: 2 }), 'breadth-first');
  });

  it('default → top-down', () => { assert.equal(adaptChooseStrategy({}), 'top-down'); });
});

describe('adaptGenerateSubSteps', () => {
  it('returns steps for each strategy', () => {
    const steps = adaptGenerateSubSteps('trace-backward', 'test task');
    assert.ok(Array.isArray(steps));
    assert.ok(steps.length >= 3);
    assert.ok(steps[0].includes('test task'));
  });

  it('fallback to top-down for unknown strategy', () => {
    const steps = adaptGenerateSubSteps('nonexistent', 'task');
    assert.ok(steps.length > 0);
  });
});

describe('adaptBuildContext (G4)', () => {
  it('builds context string', () => {
    const ctx = adaptBuildContext({ task: 'fix bug', strategy: 'trace-backward', confidence: 7 });
    assert.ok(ctx.includes('fix bug'));
    assert.ok(ctx.includes('trace-backward'));
    assert.ok(ctx.includes('7/10'));
  });

  it('includes optional hints', () => {
    const ctx = adaptBuildContext({ task: 'test', errorHint: 'something wrong' });
    assert.ok(ctx.includes('something wrong'));
  });
});

describe('adaptSessionSummary', () => {
  it('formats summary with box drawing', () => {
    const s = adaptSessionSummary(1, 'top-down', ['step1', 'step2'], 8);
    assert.ok(s.includes('ADAPT'));
    assert.ok(s.includes('step1'));
    assert.ok(s.includes('top-down'));
  });
});

// ═══════════════════════════════════════════
// H: Budget
// ═══════════════════════════════════════════

describe('autoDetectBudget (H1)', () => {
  it('simple question → quick', () => {
    const r = autoDetectBudget('what is the capital of France');
    assert.equal(r.budget, 'quick');
  });

  it('debug/fix → deep', () => {
    const r = autoDetectBudget('debug the auth module');
    assert.equal(r.budget, 'deep');
  });

  it('research → research', () => {
    const r = autoDetectBudget('research transformer architectures');
    assert.equal(r.budget, 'research');
  });

  it('with low confidence → upgrades', () => {
    const r = autoDetectBudget('what is X', { confidence: 2 });
    assert.equal(r.budget, 'deep');
  });

  it('long thought + multiple rounds → upgrades', () => {
    const r = autoDetectBudget('explain Y', { thoughtLength: 400, roundCount: 3 });
    assert.equal(r.budget, 'deep');
  });
});

describe('formatBudgetIndicator', () => {
  it('formats bar with used/max', () => {
    const r = formatBudgetIndicator('normal', 2);
    assert.ok(r.includes('Normal'));
    assert.ok(r.includes('2/5'));
  });

  it('unknown budget → normal', () => {
    const r = formatBudgetIndicator('nonexistent');
    assert.ok(r.includes('Normal'));
  });
});

describe('getQwen3Params', () => {
  it('returns params for each level', () => {
    assert.equal(getQwen3Params('quick').maxTokens, 512);
    assert.equal(getQwen3Params('deep').maxTokens, 2048);
    assert.equal(getQwen3Params('research').maxTokens, 4096);
  });

  it('unknown → normal', () => {
    assert.equal(getQwen3Params('unknown').maxTokens, 1024);
  });
});

describe('getThinkingTokenBudget (H2)', () => {
  it('returns scaled budget', () => {
    const r = getThinkingTokenBudget('deep', 'short task');
    assert.ok(r.recommendTokens >= 200);
    assert.ok(r.maxTokens >= r.recommendTokens);
  });

  it('longer task → higher budget', () => {
    const short = getThinkingTokenBudget('normal', 'short');
    const long = getThinkingTokenBudget('normal', 'a'.repeat(400));
    assert.ok(long.recommendTokens >= short.recommendTokens);
  });
});

describe('budgetDecision (H3)', () => {
  it('returns complete decision object', () => {
    const r = budgetDecision({ task: 'debug crash', confidence: 3 });
    assert.ok(r.budget);
    assert.ok(r.params);
    assert.ok(r.indicator);
    assert.ok(r.tokenBudget);
    assert.ok(r.strategy);
  });

  it('default strategy for research', () => {
    const r = budgetDecision({ task: 'research topic' });
    assert.equal(r.strategy, 'breadth-first');
  });
});

describe('contextPressure (H4)', () => {
  it('low pressure', () => {
    const r = contextPressure(2000, 8192);
    assert.equal(r.level, 'low');
    assert.equal(r.pressure, 24);
  });

  it('critical pressure', () => {
    const r = contextPressure(7500, 8192);
    assert.equal(r.level, 'critical');
    assert.ok(r.recommendAction.includes('立即壓縮'));
  });
});

// ═══════════════════════════════════════════
// I: 信心評分
// ═══════════════════════════════════════════

describe('calcConfidenceScore (I1)', () => {
  it('all good signals → high score', () => {
    const r = calcConfidenceScore({
      thoughtLength: 200, roundCount: 3, hasResult: true,
      resultConsistency: 8, toolSuccessRate: 9, crossValidation: 7,
    });
    assert.ok(r.score > 5);
  });

  it('bad signals → low score', () => {
    const r = calcConfidenceScore({
      thoughtLength: 0, roundCount: 0, hasResult: false,
      resultConsistency: 2, toolSuccessRate: 1, crossValidation: 0,
    });
    assert.ok(r.score < 5);
  });

  it('returns factors array', () => {
    const r = calcConfidenceScore({});
    assert.ok(Array.isArray(r.factors));
    assert.equal(r.factors.length, 6);
  });

  it('score clamped 0-10', () => {
    const rHigh = calcConfidenceScore({
      thoughtLength: 200, roundCount: 3, hasResult: true,
      resultConsistency: 10, toolSuccessRate: 10, crossValidation: 10,
    });
    assert.ok(rHigh.score <= 10);
    const rLow = calcConfidenceScore({
      thoughtLength: 0, roundCount: 0, hasResult: false,
      resultConsistency: 0, toolSuccessRate: 0, crossValidation: 0,
    });
    assert.ok(rLow.score >= 0);
  });
});

describe('validateNode (I2)', () => {
  it('complete node → verified', () => {
    const r = validateNode(
      { id: 1, desc: 'implement login', evidence: 'added auth.ts' },
      { thought: 'I fixed it', doneIds: [1] }
    );
    assert.equal(r.verified, true);
  });

  it('missing evidence → issue but <=1 threshold still verified', () => {
    const r = validateNode(
      { id: 1, desc: 'fix bug', evidence: '' },
      {}
    );
    assert.ok(r.issues.some(i => i.includes('缺少 evidence')));
    assert.equal(r.verified, true);
    assert.ok(r.score < 10);
  });

  it('vague description → issue', () => {
    const r = validateNode(
      { id: 1, desc: '研究了解check fix bug', evidence: 'done' },
      {}
    );
    assert.ok(r.issues.some(i => i.includes('模糊')));
  });

  it('uncertainty in thought → issue', () => {
    const r = validateNode(
      { id: 1, desc: 'find bug', evidence: 'partial' },
      { thought: 'maybe the issue is in auth' }
    );
    assert.ok(r.issues.some(i => i.includes('不確定性')));
  });

  it('missing deps → issue', () => {
    const r = validateNode(
      { id: 2, desc: 'step 2', evidence: 'done', deps: [1] },
      { thought: 'ok', doneIds: [] }
    );
    assert.ok(r.issues.some(i => i.includes('尚未完成')));
  });

  it('unused tool → issue', () => {
    const r = validateNode(
      { id: 1, desc: 'step', evidence: 'done', tool: 'smart_grep' },
      { thought: 'ok', doneIds: [1], toolResults: [] }
    );
    assert.ok(r.issues.some(i => i.includes('尚未執行')));
  });
});

describe('formatConfidenceBar (I3)', () => {
  it('green for high score', () => { assert.ok(formatConfidenceBar(9).includes('🟢')); });
  it('yellow for medium score', () => { assert.ok(formatConfidenceBar(6).includes('🟡')); });
  it('red for low score', () => { assert.ok(formatConfidenceBar(3).includes('🔴')); });
  it('clamps out of range', () => {
    assert.ok(formatConfidenceBar(-1).includes('🔴'));
    assert.ok(formatConfidenceBar(15).includes('🟢'));
  });
});

describe('validateCycle (I4)', () => {
  it('no nodes → empty result', () => {
    const r = validateCycle([], {});
    assert.equal(r.results.length, 0);
    assert.equal(r.summary, null);
  });

  it('validates active nodes', () => {
    const nodes = [{ id: 1, desc: 'step 1', evidence: 'done', deps: [] }];
    const r = validateCycle(nodes, { doneIds: [1] });
    assert.equal(r.results.length, 1);
    assert.ok(r.summary.overallScore > 0);
  });
});

describe('generateFixSuggestions (I5)', () => {
  it('generates suggestions for issues', () => {
    const results = [
      { nodeId: 1, verified: false, issues: ['缺少 evidence'] },
      { nodeId: 2, verified: true, issues: [] },
    ];
    const suggestions = generateFixSuggestions(results);
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions[0].includes('evidence'));
  });

  it('verified nodes produce no suggestions', () => {
    const results = [{ nodeId: 1, verified: true, issues: [] }];
    assert.deepEqual(generateFixSuggestions(results), []);
  });

  it('null → []', () => {
    assert.deepEqual(generateFixSuggestions(null), []);
  });
});
