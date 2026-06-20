// tests/workflow-templates.test.mjs — Phase 23 Workflow Templates tests

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('Workflow Templates', () => {
  let plugin;

  before(async () => {
    plugin = (await import('../src/plugins/standard/workflow-templates.mjs')).default;
  });

  // --- Plugin Structure ---

  it('should export valid plugin definition', () => {
    assert.equal(plugin.name, 'smart_workflow');
    assert.equal(plugin.category, 'standard');
    assert.equal(plugin.safetyLevel, 'low');
    assert.ok(plugin.inputSchema);
    assert.equal(typeof plugin.handler, 'function');
  });

  // --- List ---

  it('should list all workflow templates', async () => {
    const result = await plugin.handler({ command: 'list' });
    assert.ok(result.ok, 'Should have content');
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.ok(data.workflows.length >= 7, `Expected at least 7 workflows, got ${data.workflows.length}`);

    // Check all expected workflows exist
    const names = data.workflows.map(w => w.name);
    assert.ok(names.includes('bug-fix'), 'Should include bug-fix');
    assert.ok(names.includes('refactor'), 'Should include refactor');
    assert.ok(names.includes('security-fix'), 'Should include security-fix');
    assert.ok(names.includes('pr-review'), 'Should include pr-review');
    assert.ok(names.includes('new-feature'), 'Should include new-feature');
    assert.ok(names.includes('onboard'), 'Should include onboard');
    assert.ok(names.includes('doc-analysis'), 'Should include doc-analysis');
  });

  it('should include steps and descriptions in list', async () => {
    const result = await plugin.handler({ command: 'list' });
    const data = JSON.parse(result.output);

    const bugFix = data.workflows.find(w => w.name === 'bug-fix');
    assert.ok(bugFix, 'Should find bug-fix workflow');
    assert.ok(bugFix.steps.length >= 4, 'bug-fix should have at least 4 steps');
    assert.ok(bugFix.description, 'Should have description');
  });

  // --- Run ---

  it('should run a workflow by name', async () => {
    const result = await plugin.handler({
      command: 'run',
      name: 'bug-fix',
      context: { error: 'TypeError: Cannot read property of undefined' }
    });

    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.equal(data.workflow, 'bug-fix');
    assert.ok(data.steps.length >= 4, 'Should have steps');
    assert.ok(data.instruction, 'Should have instruction');

    // First step should be error_diagnose
    assert.equal(data.steps[0].tool, 'smart_error_diagnose');
    assert.ok(data.steps[0].description, 'Each step should have description');
  });

  it('should pass context to workflow steps', async () => {
    const result = await plugin.handler({
      command: 'run',
      name: 'doc-analysis',
      context: { path: '/tmp/test.pdf', topic: 'machine learning' }
    });

    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');

    // First step should have the path from context
    const ingestStep = data.steps[0];
    assert.equal(ingestStep.tool, 'smart_ingest_document');
    assert.equal(ingestStep.args.path, '/tmp/test.pdf');
  });

  it('should error on unknown workflow name', async () => {
    const result = await plugin.handler({
      command: 'run',
      name: 'nonexistent-workflow'
    });

    assert.ok(!result.ok, 'Should be error');
    assert.ok(result.error.includes('Unknown workflow'), 'Should mention unknown workflow');
  });

  it('should error on missing name for run command', async () => {
    const result = await plugin.handler({ command: 'run' });
    assert.ok(!result.ok, 'Should be error');
    assert.ok(result.error.includes('name parameter is required'), 'Should mention missing name');
  });

  // --- All workflows have valid structure ---

  it('should have valid structure for all workflows', async () => {
    const result = await plugin.handler({ command: 'list' });
    const data = JSON.parse(result.output);

    for (const wf of data.workflows) {
      assert.ok(wf.name, `Workflow ${wf.name} should have name`);
      assert.ok(wf.description, `Workflow ${wf.name} should have description`);
      assert.ok(wf.steps.length > 0, `Workflow ${wf.name} should have steps`);
      assert.ok(wf.estimatedTools > 0, `Workflow ${wf.name} should have estimatedTools`);
    }
  });

  // --- Unknown command ---

  it('should error on unknown command', async () => {
    const result = await plugin.handler({ command: 'unknown' });
    assert.ok(!result.ok, 'Should be error');
  });

  // --- Each workflow can be run ---

  const workflowNames = ['bug-fix', 'refactor', 'security-fix', 'pr-review', 'new-feature', 'onboard', 'doc-analysis', 'brainstorm-flow', 'tdd-flow'];

  for (const name of workflowNames) {
    it(`should run workflow: ${name}`, async () => {
      const result = await plugin.handler({
        command: 'run',
        name,
        context: { error: 'test error', goal: 'test goal', path: '/tmp/test.pdf', files: ['src/test.js'] }
      });

      const data = JSON.parse(result.output);
      assert.ok(data.ok, `${name} should be ok`);
      assert.equal(data.workflow, name);
      assert.ok(data.steps.length > 0, `${name} should have steps`);
      assert.ok(data.instruction, `${name} should have instruction`);
    });
  }
});