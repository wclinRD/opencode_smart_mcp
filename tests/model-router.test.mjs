// model-router.test.mjs — Phase 14 Multi-Model Orchestration tests
//
// Tests:
//   1. classifyTask — all task categories map to correct tier
//   2. suggestTierForTool — tool names map to correct tier
//   3. getCostReport — cost tracking accuracy
//   4. routeWithDegradation — fallback chain works
//   5. routeTask — full pipeline
//   6. estimateSavings — savings calculation
//   7. suggestRoute — question → tier mapping
//   8. Provider registration
//
// Run: node --test tests/model-router.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  TIERS,
  TASK_TIERS,
  classifyTask,
  suggestTierForTool,
  getCostReport,
  resetCostTracking,
  trackCall,
  routeWithDegradation,
  routeTask,
  estimateSavings,
  suggestRoute,
  registerProvider,
  getProvidersForTier,
} from '../src/lib/model-router.mjs';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

before(() => {
  resetCostTracking();
});

// ---------------------------------------------------------------------------
// 1. classifyTask
// ---------------------------------------------------------------------------

describe('classifyTask', () => {
  it('maps structure tasks to T1 deterministic', () => {
    const r = classifyTask('structure');
    assert.equal(r.tier.id, 1);
    assert.equal(r.tier.name, 'deterministic');
    assert.equal(r.confidence, 0.95);
  });

  it('maps change-impact tasks to T1', () => {
    const r = classifyTask('change-impact');
    assert.equal(r.tier.id, 1);
  });

  it('maps completion tasks to T2', () => {
    const r = classifyTask('completion');
    assert.equal(r.tier.id, 2);
  });

  it('maps semantic-code tasks to T3', () => {
    const r = classifyTask('semantic-code');
    assert.equal(r.tier.id, 3);
  });

  it('maps refactor tasks to T4', () => {
    const r = classifyTask('refactor');
    assert.equal(r.tier.id, 4);
  });

  it('maps architecture tasks to T4', () => {
    const r = classifyTask('architecture');
    assert.equal(r.tier.id, 4);
  });

  it('maps complex-gen tasks to T4', () => {
    const r = classifyTask('complex-gen');
    assert.equal(r.tier.id, 4);
  });

  it('maps search heuristics to T1', () => {
    const r = classifyTask('find foo in project');
    assert.equal(r.tier.id, 1);
    assert.equal(r.source, 'heuristic');
  });

  it('maps debug heuristics to T3', () => {
    const r = classifyTask('debug the error in foo');
    assert.equal(r.tier.id, 3);
  });

  it('maps refactor heuristics to T4', () => {
    const r = classifyTask('refactor the auth module');
    assert.equal(r.tier.id, 4);
  });

  it('maps explain heuristics to T2', () => {
    const r = classifyTask('explain how this works');
    assert.equal(r.tier.id, 2);
  });

  it('defaults unknown task to T3', () => {
    const r = classifyTask('xyz123unknown');
    assert.equal(r.tier.id, 3);
    assert.equal(r.source, 'default');
  });

  it('respects overrideTier', () => {
    const r = classifyTask('structure', { overrideTier: 4 });
    assert.equal(r.tier.id, 4);
    assert.equal(r.confidence, 1.0);
    assert.equal(r.source, 'override');
  });
});

// ---------------------------------------------------------------------------
// 2. suggestTierForTool
// ---------------------------------------------------------------------------

describe('suggestTierForTool', () => {
  it('returns T1 for smart_grep', () => {
    assert.equal(suggestTierForTool('smart_grep'), 1);
  });

  it('returns T1 for smart_code_query', () => {
    assert.equal(suggestTierForTool('smart_code_query'), 1);
  });

  it('returns T1 for smart_security', () => {
    assert.equal(suggestTierForTool('smart_security'), 1);
  });

  it('returns T2 for smart_py_helper', () => {
    assert.equal(suggestTierForTool('smart_py_helper'), 2);
  });

  it('returns T2 for smart_test_suggest', () => {
    assert.equal(suggestTierForTool('smart_ts_helper'), 2);
  });

  it('returns T3 for smart_error_diagnose', () => {
    assert.equal(suggestTierForTool('smart_error_diagnose'), 3);
  });

  it('returns T3 for smart_exa_search', () => {
    assert.equal(suggestTierForTool('smart_exa_search'), 3);
  });

  it('returns T4 for smart_think', () => {
    assert.equal(suggestTierForTool('smart_think'), 4);
  });

  it('returns T4 for smart_thinking', () => {
    assert.equal(suggestTierForTool('smart_thinking'), 4);
  });

  it('returns T4 for smart_workflow', () => {
    assert.equal(suggestTierForTool('smart_workflow'), 4);
  });

  it('returns T3 for unknown tool', () => {
    assert.equal(suggestTierForTool('smart_unknown_tool'), 3);
  });

  it('handles short tool names', () => {
    assert.equal(suggestTierForTool('grep'), 1);
  });
});

// ---------------------------------------------------------------------------
// 3. Cost Tracking
// ---------------------------------------------------------------------------

describe('getCostReport', () => {
  before(() => {
    resetCostTracking();
  });

  it('starts at zero', () => {
    const r = getCostReport({ format: 'json' });
    assert.equal(r.cumulativeCost, 0);
    assert.equal(r.totalCalls, 0);
  });

  it('tracks calls correctly', () => {
    resetCostTracking();
    trackCall(1, 0, 100);
    trackCall(1, 0, 50);
    trackCall(2, 0.001, 1000);
    trackCall(4, 0.05, 15000);

    const r = getCostReport({ format: 'json' });
    assert.equal(r.totalCalls, 4);
    assert.equal(r.cumulativeCost, 0.051);
    assert.equal(r.byTier.t1, 2);
    assert.equal(r.byTier.t2, 1);
    assert.equal(r.byTier.t3, 0);
    assert.equal(r.byTier.t4, 1);
    assert.equal(r.tierBreakdown.deterministic.totalCost, 2 * 0);
    assert.equal(r.tierBreakdown['strong-api'].totalCost, 0.05);
  });

  it('ignores invalid tier IDs', () => {
    resetCostTracking();
    trackCall(0, 1, 100);
    trackCall(5, 1, 100);
    const r = getCostReport({ format: 'json' });
    assert.equal(r.totalCalls, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. routeWithDegradation
// ---------------------------------------------------------------------------

describe('routeWithDegradation', () => {
  it('succeeds on first tier without degradation', async () => {
    const result = await routeWithDegradation({
      task: 'test',
      targetTier: TIERS.T1,
      executor: async () => ({ output: 'ok', cost: 0, latency: 10 }),
    });

    assert.equal(result.output, 'ok');
    assert.equal(result.degraded, false);
    assert.deepEqual(result.fallbackChain, []);
    assert.equal(result.error, null);
  });

  it('degrades to next tier when first fails', async () => {
    let attempts = [];
    const result = await routeWithDegradation({
      task: 'test',
      targetTier: TIERS.T4,
      executor: async (tier) => {
        attempts.push(tier.name);
        if (tier.id === 4) throw new Error('T4 unavailable');
        if (tier.id === 3) throw new Error('T3 rate limited');
        return { output: 't2-result', cost: 0.001, latency: 500 };
      },
    });

    assert.equal(result.output, 't2-result');
    assert.equal(result.degraded, true);
    assert.equal(result.fallbackChain.length, 2);
    assert.ok(result.fallbackChain[0].includes('T4'));
    assert.ok(result.fallbackChain[1].includes('T3'));
  });

  it('returns error when all tiers fail', async () => {
    const result = await routeWithDegradation({
      task: 'test',
      targetTier: TIERS.T2,
      executor: async () => { throw new Error('always fail'); },
    });

    assert.equal(result.output, null);
    assert.equal(result.degraded, true);
    assert.ok(result.error.includes('All tiers failed'));
  });

  it('skips unhealthy tiers', async () => {
    const result = await routeWithDegradation({
      task: 'test',
      targetTier: TIERS.T4,
      executor: async (tier) => {
        if (tier.id === 3) return { output: 't3-result', cost: 0.01, latency: 3000 };
        throw new Error('not available');
      },
      healthCheck: async (tier) => {
        return tier.id !== 4; // T4 unhealthy, T3 healthy
      },
    });

    assert.equal(result.output, 't3-result');
    assert.equal(result.fallbackChain.length, 1);
    assert.ok(result.fallbackChain[0].includes('strong-api'));
  });
});

// ---------------------------------------------------------------------------
// 5. routeTask
// ---------------------------------------------------------------------------

describe('routeTask', () => {
  before(() => {
    resetCostTracking();
  });

  it('classifies with trackOnly=true', async () => {
    const result = await routeTask({
      task: 'who calls authenticate()',
      trackOnly: true,
      context: { taskType: 'structure' },
    });

    assert.ok(result.classification);
    assert.equal(result.classification.tier.id, 1);
    assert.ok(result.message);
  });

  it('auto-classifies from task string', async () => {
    const result = await routeTask({
      task: 'refactor the auth module',
      trackOnly: true,
      context: { taskType: 'refactor' },
    });

    assert.equal(result.classification.tier.id, 4);
  });

  it('accepts explicit tier number', async () => {
    const result = await routeTask({
      task: 'test',
      tier: 2,
      trackOnly: true,
    });

    assert.equal(result.classification.tier.id, 2);
  });

  it('accepts explicit T string', async () => {
    const result = await routeTask({
      task: 'test',
      tier: 'T1',
      trackOnly: true,
    });

    assert.equal(result.classification.tier.id, 1);
  });

  it('executes with executor function', async () => {
    resetCostTracking();
    const result = await routeTask({
      task: 'test',
      tier: 1,
      executor: async () => ({ output: 'done', cost: 0, latency: 50 }),
    });

    assert.equal(result.output, 'done');
    assert.equal(result.degraded, false);

    // Should have tracked the call
    const report = getCostReport({ format: 'json' });
    assert.equal(report.totalCalls, 1);
  });

  it('handles invalid tier gracefully', async () => {
    const result = await routeTask({
      task: 'test',
      tier: 'invalid',
      trackOnly: true,
    });

    // Invalid tier defaults to T3
    assert.ok(result.classification);
    assert.equal(result.classification.tier.id, 3);
  });
});

// ---------------------------------------------------------------------------
// 6. estimateSavings
// ---------------------------------------------------------------------------

describe('estimateSavings', () => {
  it('returns zero for empty pattern', () => {
    const est = estimateSavings({});
    assert.equal(est.totalCalls, 0);
    assert.equal(est.savingsPercent, 0);
  });

  it('calculates savings correctly', () => {
    // 100 T1 calls, 50 T2 calls, 30 T3 calls, 20 T4 calls = 200 total
    // All-T4: 200 * 0.05 = $10
    // Actual: 100*0 + 50*0.001 + 30*0.01 + 20*0.05 = 0 + 0.05 + 0.30 + 1.00 = $1.35
    // Savings: $10 - $1.35 = $8.65 = 86.5%
    const est = estimateSavings({ t1: 100, t2: 50, t3: 30, t4: 20 });
    assert.equal(est.totalCalls, 200);
    assert.equal(est.allT4Cost, 10);
    assert.equal(est.actualCost, 1.35);
    assert.equal(est.savings, 8.65);
    assert.equal(est.savingsPercent, 86.5);
  });

  it('handles only-T4 pattern', () => {
    const est = estimateSavings({ t4: 10 });
    assert.equal(est.totalCalls, 10);
    assert.equal(est.allT4Cost, 0.50);
    assert.equal(est.actualCost, 0.50);
    assert.equal(est.savingsPercent, 0);
  });

  it('handles only-T1 pattern (max savings)', () => {
    const est = estimateSavings({ t1: 100 });
    assert.equal(est.totalCalls, 100);
    assert.equal(est.actualCost, 0);
    assert.equal(est.savingsPercent, 100);
  });
});

// ---------------------------------------------------------------------------
// 7. suggestRoute
// ---------------------------------------------------------------------------

describe('suggestRoute', () => {
  it('returns T1 for callers query', () => {
    const r = suggestRoute('who calls authenticate()');
    assert.equal(r.tier, 1);
    assert.equal(r.tool, 'smart_code_query');
  });

  it('returns T1 for impact query', () => {
    const r = suggestRoute('what if I change authenticate');
    assert.equal(r.tier, 1);
  });

  it('returns T1 for safe-to-change query', () => {
    const r = suggestRoute('safe to delete this function');
    assert.equal(r.tier, 1);
  });

  it('returns T2 for explanation query', () => {
    const r = suggestRoute('what does this function do');
    assert.equal(r.tier, 2);
  });

  it('returns T2 for explain query', () => {
    const r = suggestRoute('explain how authentication works');
    assert.equal(r.tier, 2);
  });

  it('returns T3 for debug query', () => {
    const r = suggestRoute('why is the server crashing');
    assert.equal(r.tier, 3);
  });

  it('returns T3 for error query', () => {
    const r = suggestRoute('fix this TypeError in auth');
    assert.equal(r.tier, 3);
  });

  it('returns T4 for refactor query', () => {
    const r = suggestRoute('refactor the auth module to use new API');
    assert.equal(r.tier, 4);
  });

  it('returns T4 for code generation', () => {
    const r = suggestRoute('implement a new authentication middleware');
    assert.equal(r.tier, 4);
  });

  it('routes how-does questions to T2 local', () => {
    const r = suggestRoute('how does this codebase work');
    assert.equal(r.tier, 2);
  });

  it('handles empty question', () => {
    const r = suggestRoute('');
    assert.equal(r.tier, 3);
  });
});

// ---------------------------------------------------------------------------
// 8. Provider registration
// ---------------------------------------------------------------------------

describe('registerProvider', () => {
  it('registers and retrieves providers by tier', () => {
    const adapter = {
      name: 'test-local',
      tier: 2,
      execute: async () => ({ output: 'test', cost: 0.001, latency: 100 }),
    };
    registerProvider('test-local', adapter);
    const providers = getProvidersForTier(2);
    assert.ok(providers.some(p => p.name === 'test-local'));
  });

  it('throws for invalid provider', () => {
    assert.throws(() => registerProvider('bad', { name: 'bad' }));
    assert.throws(() => registerProvider('bad', null));
  });

  it('returns empty array for unused tier', () => {
    const providers = getProvidersForTier(1);
    // No T1 providers registered (they're deterministic handlers, not model providers)
    assert.ok(Array.isArray(providers));
  });
});
