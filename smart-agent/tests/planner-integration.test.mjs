// planner-integration.test.mjs — Tests for smart-agent planner integration

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planAndExecute,
  analyzePlan,
  determineNextAction,
  needsPlanning,
} from '../src/agent/planner-integration.mjs';

describe('planAndExecute', () => {
  it('generates execute command for a goal', () => {
    const plan = planAndExecute('find and fix all security vulnerabilities');
    assert.ok(plan.command.startsWith('smart_planner execute'));
    assert.ok(plan.command.includes('find and fix all security vulnerabilities'));
    assert.ok(plan.planId.startsWith('plan-'));
  });

  it('estimates complexity based on word count', () => {
    const simple = planAndExecute('fix bug');
    assert.equal(simple.estimatedComplexity, 'low');

    const medium = planAndExecute('find and fix all security vulnerabilities in the authentication module and related components');
    assert.equal(medium.estimatedComplexity, 'medium');

    const complex = planAndExecute('find and fix all security vulnerabilities in the authentication module and related API endpoints and ensure all tests pass well before deployment goes live');
    assert.equal(complex.estimatedComplexity, 'high');
  });

  it('respects options', () => {
    const plan = planAndExecute('refactor', { steps: 5, strict: true });
    assert.ok(plan.command.includes('--steps 5'));
    assert.ok(plan.command.includes('--strict'));
  });
});

describe('analyzePlan', () => {
  it('extracts step count and parallel groups', () => {
    const result = analyzePlan({
      steps: [
        { tool: 'smart_grep', dependsOn: [] },
        { tool: 'smart_error_diagnose', dependsOn: [0] },
        { tool: 'smart_cross_file_edit', dependsOn: [1] },
      ],
      parallelHints: [[0], [1], [2]],
    });
    assert.equal(result.steps, 3);
    assert.ok(result.estimatedDuration);
    assert.equal(result.parallelGroups, 3);
  });

  it('handles null plan output', () => {
    const result = analyzePlan(null);
    assert.equal(result.steps, 0);
  });

  it('identifies abort risks', () => {
    const result = analyzePlan({
      steps: [
        { tool: 'smart_grep', onFailure: 'abort' },
      ],
    });
    assert.ok(result.risks.length > 0);
    assert.ok(result.risks[0].includes('abort'));
  });
});

describe('determineNextAction', () => {
  it('returns continue when step succeeds with remaining steps', () => {
    const state = { steps: [{ tool: 'a' }, { tool: 'b', dependsOn: [0] }] };
    const action = determineNextAction(state, 0, 'ok');
    assert.equal(action.action, 'continue');
    assert.ok(action.nextSteps.includes('b'));
  });

  it('returns complete when no remaining steps', () => {
    const state = { steps: [{ tool: 'a' }] };
    const action = determineNextAction(state, 0, 'ok');
    assert.equal(action.action, 'complete');
  });

  it('returns abort on failure with onFailure=abort', () => {
    const state = { steps: [{ tool: 'a', onFailure: 'abort' }, { tool: 'b' }] };
    const action = determineNextAction(state, 0, 'fail');
    assert.equal(action.action, 'abort');
  });

  it('returns continue with skip on failure', () => {
    const state = { steps: [{ tool: 'a', onFailure: 'skip' }, { tool: 'b', dependsOn: [] }] };
    const action = determineNextAction(state, 0, 'fail');
    assert.equal(action.action, 'continue');
  });

  it('returns replan on failure with onFailure=warn', () => {
    const state = { steps: [{ tool: 'a', onFailure: 'warn' }, { tool: 'b' }] };
    const action = determineNextAction(state, 0, 'fail');
    assert.equal(action.action, 'replan');
  });

  it('handles invalid state gracefully', () => {
    const action = determineNextAction(null, 0, 'ok');
    assert.equal(action.action, 'abort');
  });
});

describe('needsPlanning', () => {
  it('returns true for complex multi-step goals', () => {
    assert.ok(needsPlanning('find and fix all security vulnerabilities in the authentication module'));
  });

  it('returns false for simple goals', () => {
    assert.equal(needsPlanning('fix a bug'), false);
  });

  it('returns false for null/empty goals', () => {
    assert.equal(needsPlanning(null), false);
    assert.equal(needsPlanning(''), false);
  });
});
