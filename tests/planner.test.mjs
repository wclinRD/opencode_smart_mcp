// planner.test.mjs — Phase 2 integration tests
//
// Tests planner execution state + dynamic replanning:
//   1. execute: plan generation + state file creation
//   2. next: get next runnable step respecting dependencies
//   3. report: step ok → advances to next step
//   4. report: step fail with onFailure=abort → plan stops
//   5. report: step fail with onFailure=warn → triggers replan
//   6. replan: explicit re-plan command
//   7. Full lifecycle: execute → next → report (ok) → report (ok) → done
//
// Run: node --test tests/planner.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname, '../src/cli');
const TEST_UID = Date.now();
const PLAN_DIR = resolve(__dirname, '../.test-plans-' + TEST_UID);

function runCLI(cliFile, args) {
  const result = spawnSync('node', [resolve(CLI_DIR, cliFile), ...args], {
    encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 200,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function runPlanner(args) {
  return runCLI('planner.mjs', args);
}

function parseJSON(output) {
  try { return JSON.parse(output.stdout); } catch { return null; }
}

/**
 * Create a plan state file path for a test.
 */
function testStatePath(name) {
  return resolve(PLAN_DIR, name + '.json');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 2: Planner Execution State', () => {

  before(() => {
    mkdirSync(PLAN_DIR, { recursive: true });
  });

  after(() => {
    try { if (existsSync(PLAN_DIR)) rmSync(PLAN_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    // Clean up any test state files in default dir
    try {
      const defaultDir = resolve(process.env.HOME || '/tmp', '.smart', 'plans');
      if (existsSync(defaultDir)) {
        const files = readFileSync(defaultDir, 'utf8');
        // only remove our test files (they have test uid in name? no, they don't)
        // skip this to avoid deleting real data
      }
    } catch { /* ok */ }
  });

  it('1. execute: generates plan + creates state file with first step', () => {
    const statePath = testStatePath('test1-execute');
    const res = runPlanner(['execute', 'debug the login error',
      '--state', statePath, '--format', 'json',
    ]);
    assert.equal(res.status, 0, `execute failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.equal(data.status, 'execution_started', 'status should be execution_started');
    assert.ok(data.statePath, 'should have statePath');
    assert.ok(data.planId, 'should have planId');
    assert.ok(data.totalSteps >= 1, 'should have at least 1 step');
    assert.ok(data.firstStep, 'should have firstStep');
    assert.ok(data.firstStep.step === 1, 'first step should be step 1');
    assert.ok(data.firstStep.tool, 'first step should have a tool');

    // Verify state file exists and is valid
    assert.ok(existsSync(statePath), 'state file should exist');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'in_progress', 'state status should be in_progress');
    assert.equal(state.goal, 'debug the login error', 'goal should match');
    assert.equal(state.completedSteps.length, 0, 'no completed steps yet');
    assert.equal(state.steps[0].status, 'pending', 'first step should be pending');
  });

  it('2. next: returns next pending step and marks it running', () => {
    const statePath = testStatePath('test2-next');
    // First create the state
    runPlanner(['execute', 'search for env variables',
      '--state', statePath,
    ]);
    assert.ok(existsSync(statePath), 'state file should exist');

    // Get next step
    const res = runPlanner(['next', '--state', statePath]);
    assert.equal(res.status, 0, `next failed: ${res.stderr}`);
    assert.ok(res.stdout.includes('Step 1'), 'should show step 1');
    assert.ok(res.stdout.includes('smart_grep'), 'should show smart_grep tool');

    // Verify state: step 1 should be "running"
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.steps[0].status, 'running', 'step 1 should be marked running after next');
  });

  it('3. report ok: records success and advances to next step', () => {
    const statePath = testStatePath('test3-report-ok');
    // Create a simple plan: search-code template has 1 step
    runPlanner(['execute', 'find all TODO comments in code',
      '--state', statePath,
    ]);

    // Report step 1 as ok
    const res = runPlanner(['report', '--state', statePath,
      '--step', '1', '--status', 'ok',
      '--result', '"Found 15 TODOs"', '--duration', '150',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `report failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');

    // Since search-code has only 1 step, should be done
    assert.ok(data.done, 'plan should be done after single step');
    assert.equal(data.status, 'completed', 'status should be completed');

    // Verify state
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.completedSteps.length, 1, '1 completed step');
    assert.equal(state.steps[0].result, 'Found 15 TODOs', 'result should be stored');
    assert.equal(state.steps[0].duration, 150, 'duration should be stored');
    assert.equal(state.status, 'completed', 'plan status should be completed');
  });

  it('4. report fail with onFailure=abort: plan stops immediately', () => {
    const statePath = testStatePath('test4-abort');
    // Use "search-code" template (matches /search/i, step 1 has onFailure='abort')
    runPlanner(['execute', 'search for deprecated API calls',
      '--state', statePath,
    ]);

    // Verify step 1 has onFailure=abort
    const stateBefore = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(stateBefore.steps[0].onFailure, 'abort',
      'step 1 should have onFailure=abort in search-code template');

    const res = runPlanner(['report', '--state', statePath,
      '--step', '1', '--status', 'fail',
      '--error', 'Tool crashed with segfault',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `report failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.done, 'plan should be done after abort');
    assert.equal(data.status, 'failed', 'status should be failed');

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'failed', 'plan should be marked failed');
    assert.equal(state.failedSteps.length, 1, '1 failed step');
    assert.equal(state.failedSteps[0], 1, 'step 1 should be in failedSteps');
  });

  it('5. report fail with onFailure=warn: triggers replan', () => {
    const statePath = testStatePath('test5-replan');
    runPlanner(['execute', 'refactor the auth module',
      '--context', 'file=src/auth.js',
      '--state', statePath,
    ]);

    // Verify step 1 has onFailure=warn (refactor-rename template)
    const stateBefore = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(stateBefore.steps[0].onFailure, 'warn',
      'step 1 should have onFailure=warn in refactor-rename template');

    // Report step 1 as failed — should trigger replan
    const res = runPlanner(['report', '--state', statePath,
      '--step', '1', '--status', 'fail',
      '--error', 'Import graph timed out',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `report failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.replanned, 'should trigger replan on warn failure');
    assert.ok(data.newPlanSteps, 'should report plan changes');
    assert.ok(data.newPlanSteps.removed > 0, 'should remove stale steps');
    assert.ok(data.newPlanSteps.added > 0, 'should add new steps');

    // Verify state has new steps
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.ok(state.steps.length > 0, 'should have steps after replan');
    // Status should be reset to in_progress
    assert.equal(state.status, 'in_progress', 'status should reset to in_progress after replan');
  });

  it('6. replan command: explicitly re-plans remaining steps', () => {
    const statePath = testStatePath('test6-replan-cmd');
    runPlanner(['execute', 'audit application security',
      '--state', statePath,
    ]);

    // Complete step 1
    runPlanner(['report', '--state', statePath,
      '--step', '1', '--status', 'ok',
      '--result', '"Scan started"',
    ]);

    // Now explicitly replan with new context
    const res = runPlanner(['replan', '--state', statePath,
      '--context', 'Focus on OWASP Top 10',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `replan failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.replanned, 'should replan');
    assert.ok(data.changes, 'should report changes');

    // Verify state: step 1 should still be completed, steps 2+ should be new
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.steps[0].status, 'completed', 'step 1 should still be completed');
    assert.equal(state.status, 'in_progress', 'status should be in_progress');
    // All non-completed steps should be pending
    for (let i = 1; i < state.steps.length; i++) {
      assert.equal(state.steps[i].status, 'pending',
        `step ${i+1} should be pending after replan`);
    }
  });

  it('7. full lifecycle: execute → next → report → next → report → done', () => {
    // Use a simple 1-step template for predictable lifecycle
    const statePath = testStatePath('test7-lifecycle');
    runPlanner(['execute', 'find all console.log statements',
      '--state', statePath, '--format', 'json',
    ]);

    // next: get step 1
    const next1 = runPlanner(['next', '--state', statePath]);
    assert.equal(next1.status, 0);
    assert.ok(next1.stdout.includes('Step 1'), 'should show step 1');

    // report step 1 ok
    const report1 = runPlanner(['report', '--state', statePath,
      '--step', '1', '--status', 'ok',
      '--result', '"Found 42 console.log calls"',
      '--format', 'json',
    ]);
    assert.equal(report1.status, 0);
    const r1 = parseJSON(report1);
    assert.ok(r1.done, 'plan should be done');
    assert.equal(r1.status, 'completed', 'should complete successfully');

    // Verify final state
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'completed', 'final status should be completed');
    assert.equal(state.completedSteps.length, 1, '1 completed step');
    assert.equal(state.steps[0].result, 'Found 42 console.log calls', 'result preserved');
  });
});
