// workflow-strategy.test.mjs — Tests for smart-agent workflow automation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectTemplate,
  planAutoExecute,
  getDispatchCommand,
  getReplanCommand,
  getSummaryCommand,
  shouldReplan,
  extractFindings,
} from '../src/agent/workflow-strategy.mjs';

describe('selectTemplate', () => {
  it('selects debug-flow for error goals', () => {
    assert.equal(selectTemplate('debug the login crash'), 'debug-flow');
  });

  it('selects refactor-flow for refactor goals', () => {
    assert.equal(selectTemplate('refactor the user module'), 'refactor-flow');
  });

  it('selects security-flow for security goals', () => {
    assert.equal(selectTemplate('fix security vulnerability'), 'security-flow');
  });

  it('selects research-flow for research goals', () => {
    assert.equal(selectTemplate('research API design patterns'), 'research-flow');
  });

  it('selects git-flow for git goals', () => {
    assert.equal(selectTemplate('commit the staged changes'), 'git-flow');
  });

  it('defaults to default-flow for unknown goals', () => {
    assert.equal(selectTemplate('do something random'), 'default-flow');
  });
});

describe('planAutoExecute', () => {
  it('generates create command for a goal', () => {
    const plan = planAutoExecute('debug login error');
    assert.ok(plan.command.startsWith('smart_workflow create'));
    assert.ok(plan.command.includes('debug login error'));
    assert.equal(plan.template, 'debug-flow');
    assert.ok(plan.workflowId.startsWith('wf-'));
  });

  it('respects custom template option', () => {
    const plan = planAutoExecute('debug login error', { template: 'research-flow' });
    assert.equal(plan.template, 'research-flow');
  });
});

describe('getDispatchCommand', () => {
  it('generates dispatch command with state file', () => {
    const state = { _stateFile: '/tmp/wf.json', steps: [{ tool: 'smart_grep' }] };
    const cmd = getDispatchCommand(state);
    assert.ok(cmd.command.includes('dispatch'));
    assert.ok(cmd.command.includes('/tmp/wf.json'));
    assert.equal(cmd.stepCount, 1);
  });
});

describe('getReplanCommand', () => {
  it('generates replan command with context', () => {
    const cmd = getReplanCommand('wf-1', 'state.json', 'grep timed out');
    assert.ok(cmd.command.includes('replan'));
    assert.ok(cmd.command.includes('state.json'));
    assert.ok(cmd.command.includes('grep timed out'));
  });
});

describe('getSummaryCommand', () => {
  it('generates summary command with JSON flag', () => {
    const cmd = getSummaryCommand('state.json');
    assert.ok(cmd.command.includes('summary'));
    assert.ok(cmd.command.includes('--json'));
  });
});

describe('shouldReplan', () => {
  it('returns true for failed step', () => {
    assert.ok(shouldReplan({ status: 'fail' }));
  });

  it('returns true for step with error', () => {
    assert.ok(shouldReplan({ result: 'error: something went wrong' }));
  });

  it('returns false for successful step', () => {
    assert.equal(shouldReplan({ status: 'ok' }), false);
  });

  it('returns false for null input', () => {
    assert.equal(shouldReplan(null), false);
  });
});

describe('extractFindings', () => {
  it('extracts failure findings from steps', () => {
    const summary = {
      steps: [
        { tool: 'smart_grep', status: 'ok' },
        { tool: 'smart_error_diagnose', status: 'fail', error: 'no match found' },
      ],
    };
    const findings = extractFindings(summary);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, 'failure');
    assert.ok(findings[0].message.includes('smart_error_diagnose'));
  });

  it('returns empty array for null summary', () => {
    assert.equal(extractFindings(null).length, 0);
  });
});
