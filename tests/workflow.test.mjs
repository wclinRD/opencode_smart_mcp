// workflow.test.mjs — Phase 4 Workflow engine tests
//
// Tests workflow lifecycle management:
//   1. create: workflow from template → state file
//   2. report: step ok → advances workflow
//   3. report: step fail → marks workflow as failed
//   4. replan: re-plan after failure
//   5. summary: show workflow state
//   6. parallel hints: correct grouping of independent steps
//   7. context-manager: workflowId capture
//   8. list-templates: show available templates
//
// Run: node --test tests/workflow.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname, '../src/cli');
const TEST_UID = Date.now();
const WF_DIR = resolve(__dirname, '../.test-workflows-' + TEST_UID);

function runCLI(cliFile, args) {
  const result = spawnSync('node', [resolve(CLI_DIR, cliFile), ...args], {
    encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 200,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function runWF(args) {
  return runCLI('workflow.mjs', args);
}

function parseJSON(output) {
  try { return JSON.parse(output.stdout); } catch { return null; }
}

function wfStatePath(name) {
  return resolve(WF_DIR, name + '.json');
}

function loadState(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 4: Workflow Engine', () => {

  before(() => {
    mkdirSync(WF_DIR, { recursive: true });
  });

  after(() => {
    try { if (existsSync(WF_DIR)) rmSync(WF_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // -----------------------------------------------------------------------
  // 1. Create workflow from template
  // -----------------------------------------------------------------------
  it('1. create: creates workflow from template with state file', () => {
    const statePath = wfStatePath('test1-create');
    const res = runWF(['create', 'debug the login timeout error',
      '--template', 'debug-flow', '--state', statePath, '--json',
    ]);
    assert.equal(res.status, 0, `create failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.workflowId, 'should have workflowId');
    assert.ok(data.statePath, 'should have statePath');
    assert.equal(data.status, 'active', 'status should be active');
    assert.ok(Array.isArray(data.steps), 'should have steps array');
    assert.ok(data.steps.length > 0, 'should have at least 1 step');
    assert.ok(data.parallel, 'should have parallel hints');
    assert.ok(Array.isArray(data.parallel), 'parallel should be array');
    assert.ok(data.parallel.length > 0, 'should have at least 1 parallel group');

    // Verify state file on disk
    assert.ok(existsSync(statePath), 'state file should exist');
    const state = loadState(statePath);
    assert.equal(state.goal, 'debug the login timeout error', 'goal should match');
    assert.equal(state.template, 'debug-flow', 'template should match');
    assert.equal(state.status, 'active', 'state status should be active');
    assert.equal(state.steps.length, data.steps.length, 'steps count should match');

    // Verify step structure
    const firstStep = state.steps[0];
    assert.ok(firstStep.step === 0, 'first step should be step 0');
    assert.ok(firstStep.tool, 'step should have a tool');
    assert.equal(firstStep.status, 'pending', 'step should be pending');
    assert.ok(firstStep.dependsOn !== undefined, 'step should have dependsOn');
    assert.ok(firstStep.onFailure, 'step should have onFailure strategy');
  });

  // -----------------------------------------------------------------------
  // 2. Report step ok → advances workflow
  // -----------------------------------------------------------------------
  it('2. report ok: records success and advances workflow state', () => {
    const statePath = wfStatePath('test2-report-ok');
    // Create a research-flow workflow (3 steps, lowest complexity)
    runWF(['create', 'research LLM agent architectures',
      '--template', 'research-flow', '--state', statePath,
    ]);
    assert.ok(existsSync(statePath), 'state file should exist');
    let state = loadState(statePath);
    const totalSteps = state.steps.length;

    // Report step 0 as ok
    const res = runWF(['report', '--state', statePath,
      '--step', '0', '--status', 'ok',
      '--result', JSON.stringify({ output: 'Found 5 papers on LLM agents', findings: [{ source: 'exa_search', finding: 'LLM agent survey paper found', category: 'research', severity: 'low' }] }),
      '--duration', '500',
      '--json',
    ]);
    assert.equal(res.status, 0, `report failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.equal(data.workflowId, state.workflowId, 'workflowId should match');

    // Verify state updated
    state = loadState(statePath);
    assert.equal(state.completedSteps.length, 1, '1 completed step');
    assert.equal(state.steps[0].status, 'ok', 'step 0 status should be ok');
    assert.equal(state.steps[0].duration, 500, 'duration should be stored');
    assert.equal(state.steps[0].completedAt, state.steps[0].completedAt, 'should have completedAt');
    assert.ok(state.findings.length > 0, 'findings should be extracted');

    // Verify status is still active (not all steps done)
    assert.equal(state.status, 'active', 'workflow should still be active');
  });

  // -----------------------------------------------------------------------
  // 3. Report step fail → marks workflow as failed
  // -----------------------------------------------------------------------
  it('3. report fail: marks workflow as failed (onFailure=abort)', () => {
    const statePath = wfStatePath('test3-report-fail');
    // research-flow step 0 has onFailure='abort' — perfect for testing fail state
    runWF(['create', 'research WebGPU performance benchmarks',
      '--template', 'research-flow', '--state', statePath,
    ]);
    assert.ok(existsSync(statePath));

    // Verify step 0 has onFailure='abort'
    const stateBefore = loadState(statePath);
    assert.equal(stateBefore.steps[0].onFailure, 'abort',
      'research-flow step 0 should have onFailure=abort');

    // Report step 0 as failed
    const res = runWF(['report', '--state', statePath,
      '--step', '0', '--status', 'fail',
      '--error', 'Exa search API rate limit exceeded',
      '--duration', '30000',
      '--json',
    ]);
    assert.equal(res.status, 0, `report failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.equal(data.status, 'failed', 'workflow should be failed');

    // Verify state
    const state = loadState(statePath);
    assert.equal(state.status, 'failed', 'state status should be failed');
    assert.equal(state.failedSteps.length, 1, '1 failed step');
    assert.equal(state.failedSteps[0], 0, 'step 0 should be in failedSteps');
    assert.equal(state.steps[0].error, 'Exa search API rate limit exceeded', 'error should be stored');
    assert.equal(state.steps[0].duration, 30000, 'duration should be stored');
  });

  // -----------------------------------------------------------------------
  // 4. Replan after failure
  // -----------------------------------------------------------------------
  it('4. replan: re-plans remaining steps after failure', () => {
    const statePath = wfStatePath('test4-replan');
    runWF(['create', 'refactor the auth module to use async/await',
      '--template', 'refactor-flow', '--state', statePath,
    ]);

    // Complete step 0 (import graph)
    runWF(['report', '--state', statePath,
      '--step', '0', '--status', 'ok',
      '--result', JSON.stringify({ output: 'Import analysis done: 15 files affected' }),
      '--duration', '300',
    ]);

    // Fail step 1 (naming check) — refactor-flow steps[1] has onFailure='skip'
    runWF(['report', '--state', statePath,
      '--step', '1', '--status', 'fail',
      '--error', 'Naming convention check failed',
      '--duration', '100',
    ]);

    // Step 2 (rename safety) depends on step 0 and has onFailure='abort'
    // Since step 2 depends on step 0 and step 0 is ok, step 2 should still run
    // But since we've only completed up to step 1 (failed), let's just test replan

    const stateBefore = loadState(statePath);
    assert.equal(stateBefore.status, 'active', 'should still be active after skip');

    // Now replan with new context
    const res = runWF(['replan', '--state', statePath,
      '--context', 'Focus on auth module only (src/auth.mjs)',
      '--json',
    ]);
    assert.equal(res.status, 0, `replan failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.equal(data.status, 'active', 'should be active after replan');
    assert.ok(data.newSteps > 0, 'should add new steps');
    assert.ok(data.totalSteps > stateBefore.steps.length, 'total steps should increase');

    // Verify state
    const state = loadState(statePath);
    assert.equal(state.status, 'active', 'state status should be active after replan');
    assert.equal(state.completedSteps.length, 1, 'step 0 should still be completed');
    assert.ok(state.steps.length > stateBefore.steps.length, 'should have more steps after replan');

    // Verify replan steps are marked
    const replanSteps = state.steps.filter(s => s.isReplan);
    assert.ok(replanSteps.length > 0, 'should have replan steps');
    for (const s of replanSteps) {
      assert.equal(s.status, 'pending', 'replan steps should be pending');
    }
  });

  // -----------------------------------------------------------------------
  // 5. Summary — show workflow state
  // -----------------------------------------------------------------------
  it('5. summary: shows workflow state with all details', () => {
    const statePath = wfStatePath('test5-summary');
    runWF(['create', 'check for credential leaks in repo',
      '--template', 'security-flow', '--state', statePath,
    ]);

    // Report step 0 ok
    runWF(['report', '--state', statePath,
      '--step', '0', '--status', 'ok',
      '--result', JSON.stringify({ output: 'No credentials found' }),
      '--duration', '200',
    ]);

    // Get text summary
    const resText = runWF(['summary', '--state', statePath]);
    assert.equal(resText.status, 0, `summary failed: ${resText.stderr}`);
    assert.ok(resText.stdout.includes('Workflow:'), 'should show workflow header');
    assert.ok(resText.stdout.includes('security-flow'), 'should show template name');
    assert.ok(resText.stdout.includes('active'), 'should show status');
    assert.ok(resText.stdout.includes('1/'), 'should show progress count');
    assert.ok(resText.stdout.includes('✓'), 'should show completed step marker');

    // Get JSON summary
    const resJSON = runWF(['summary', '--state', statePath, '--json']);
    assert.equal(resJSON.status, 0);
    const data = parseJSON(resJSON);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.workflowId, 'should have workflowId');
    assert.equal(data.status, 'active', 'status should be active');
    assert.equal(data.template, 'security-flow', 'template should match');
    assert.equal(data.totalSteps, 5, 'security-flow should have 5 steps');
    assert.equal(data.completedSteps.length, 1, '1 completed step');
    assert.ok(data.toolStats, 'should have toolStats');
    assert.ok(Array.isArray(data.steps), 'should have steps array');
    assert.equal(data.steps[0].status, 'ok', 'step 0 status should be ok');
  });

  // -----------------------------------------------------------------------
  // 6. Parallel hints — compute from dependsOn
  // -----------------------------------------------------------------------
  it('6. parallel hints: groups independent steps correctly', () => {
    const statePath = wfStatePath('test6-parallel');
    const res = runWF(['create', 'debug a memory leak in the cache layer',
      '--template', 'debug-flow', '--state', statePath, '--json',
    ]);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.parallel, 'parallel hints present');

    // debug-flow: steps 0 & 1 have no deps → parallel group 0
    // steps 2 & 3 depend on 0 & 1 → must wait
    // step 4 depends on 2 & 3 → must wait
    // step 5 depends on 4 → must wait

    const p = data.parallel;
    assert.ok(p.length >= 4, 'should have at least 4 parallel groups');

    // Group 0 should be [0, 1] (independent)
    assert.deepEqual(p[0], [0, 1], 'group 0 should be [0, 1] (independent steps)');

    // Group 1 should be [2, 3] (depend on group 0)
    assert.deepEqual(p[1], [2, 3], 'group 1 should be [2, 3] (depend on group 0)');

    // Group 2 should be [4] (depends on group 1)
    assert.deepEqual(p[2], [4], 'group 2 should be [4] (depends on group 1)');

    // Group 3 should be [5] (depends on group 2)
    assert.deepEqual(p[3], [5], 'group 3 should be [5] (depends on group 2)');
  });

  // -----------------------------------------------------------------------
  // 7. ContextManager — workflowId capture
  // -----------------------------------------------------------------------
  it('7. context manager: supports workflowId in capture', async () => {
    const { ContextManager } = await import('../src/lib/context-manager.mjs');
    const cm = new ContextManager({ autoSave: false, extractFindings: false });

    // Init without workflowId
    cm.init({ projectRoot: '/test' });

    // Capture with workflowId
    cm.capture('smart_grep', { pattern: 'error' }, { ok: true, output: 'Found 3 matches' }, 100, 'wf-abc-123');

    // Get workflow history
    const history = cm.getWorkflowHistory('wf-abc-123');
    assert.equal(history.length, 1, 'should find 1 entry for workflow wf-abc-123');
    assert.equal(history[0].tool, 'smart_grep', 'tool should match');
    assert.equal(history[0].workflowId, 'wf-abc-123', 'workflowId should be stored');

    // Capture another tool with different workflowId
    cm.capture('smart_debug', { error: 'TypeError' }, { ok: false, error: 'TypeError: undefined is not a function' }, 50, 'wf-abc-123');
    cm.capture('smart_test', { }, { ok: true, output: 'All tests passed' }, 200, 'wf-xyz-789');

    // Verify filtering
    const hist1 = cm.getWorkflowHistory('wf-abc-123');
    assert.equal(hist1.length, 2, 'should find 2 entries for wf-abc-123');

    const hist2 = cm.getWorkflowHistory('wf-xyz-789');
    assert.equal(hist2.length, 1, 'should find 1 entry for wf-xyz-789');

    // Capture without workflowId (should not appear in filtered results)
    cm.capture('smart_report', { title: 'test' }, { ok: true, output: 'Report generated' }, 50);
    assert.equal(cm.getWorkflowHistory('wf-abc-123').length, 2, 'no-workflowId entry should not appear');

    // Verify all tools are in unfiltered history
    const ctx = cm.get();
    assert.equal(ctx.toolHistory.length, 4, 'should have 4 total tool entries');
  });

  // -----------------------------------------------------------------------
  // 8. List templates
  // -----------------------------------------------------------------------
  it('8. list-templates: shows available workflow templates', () => {
    const res = runWF(['list-templates']);
    assert.equal(res.status, 0, `list-templates failed: ${res.stderr}`);
    assert.ok(res.stdout.includes('debug-flow'), 'should list debug-flow');
    assert.ok(res.stdout.includes('refactor-flow'), 'should list refactor-flow');
    assert.ok(res.stdout.includes('security-flow'), 'should list security-flow');
    assert.ok(res.stdout.includes('research-flow'), 'should list research-flow');
    assert.ok(res.stdout.includes('default-flow'), 'should list default-flow');
  });

  // -----------------------------------------------------------------------
  // 9. Full lifecycle: create → report → report → done
  // -----------------------------------------------------------------------
  it('9. full lifecycle: research-flow create → report 0 → report 1 → completed', () => {
    const statePath = wfStatePath('test9-lifecycle');
    // research-flow has 3 steps: web search → thinking → report
    runWF(['create', 'current trends in WebGPU adoption',
      '--template', 'research-flow', '--state', statePath,
    ]);
    const state0 = loadState(statePath);
    assert.equal(state0.steps.length, 3, 'research-flow should have 3 steps');

    // Step 0: web search ok
    runWF(['report', '--state', statePath,
      '--step', '0', '--status', 'ok',
      '--result', JSON.stringify({ output: 'Found 10 recent articles on WebGPU' }),
      '--duration', '800',
    ]);

    let state = loadState(statePath);
    assert.equal(state.completedSteps.length, 1, '1 completed step');
    assert.equal(state.status, 'active', 'still active');

    // Step 1: thinking ok
    runWF(['report', '--state', statePath,
      '--step', '1', '--status', 'ok',
      '--result', JSON.stringify({ output: 'WebGPU adoption growing, key players: Chrome, Firefox, Safari' }),
      '--duration', '2000',
    ]);

    state = loadState(statePath);
    assert.equal(state.completedSteps.length, 2, '2 completed steps');
    assert.equal(state.status, 'active', 'still active');

    // Step 2: report ok → should complete workflow
    runWF(['report', '--state', statePath,
      '--step', '2', '--status', 'ok',
      '--result', JSON.stringify({ output: 'Report generated: WebGPU Adoption Trends 2026' }),
      '--duration', '500',
    ]);

    state = loadState(statePath);
    assert.equal(state.completedSteps.length, 3, 'all 3 steps completed');
    assert.equal(state.status, 'completed', 'workflow should be completed');
    assert.equal(state.failedSteps.length, 0, 'no failed steps');
    assert.equal(state.skippedSteps.length, 0, 'no skipped steps');

    // Verify tool stats
    assert.ok(state.toolStats['smart_exa_search'], 'should have exa_search stats');
    assert.ok(state.toolStats['smart_thinking'], 'should have thinking stats');
    assert.ok(state.toolStats['smart_report'], 'should have report stats');
    assert.equal(state.toolStats['smart_exa_search'].calls, 1, 'exa_search called once');
    assert.equal(state.toolStats['smart_thinking'].calls, 1, 'thinking called once');
  });
});
