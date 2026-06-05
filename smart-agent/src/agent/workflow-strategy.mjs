// workflow-strategy.mjs — Smart Agent workflow automation layer
//
// Wraps smart-mcp workflow tools into a cohesive auto-execution API.
// Handles the full lifecycle: create → dispatch steps → replan on failure → summary.
//
// NOTE: This module produces instructions for the opencode agent to execute.
// It does NOT directly call MCP tools (those calls happen through the agent loop).
// Instead, it generates the execution plan and status tracking logic.
//
// Usage:
//   import { planAutoExecute, getNextStep } from 'smart-agent/workflow-strategy';
//   const plan = planAutoExecute('debug login error', { template: 'debug-flow' });
//   // Returns: { workflowId, steps, parallelHints, totalSteps }
//   const next = getNextStep(plan, results);
//   // Returns: { step, tool, args } or { done: true, summary }

// ---------------------------------------------------------------------------
// Template selection based on goal analysis
// ---------------------------------------------------------------------------

const TEMPLATE_MATCHERS = [
  { pattern: /debug|error|exception|fail|crash|panic|trace|stack/i, template: 'debug-flow' },
  { pattern: /refactor|restructur|reorganize|clean|simplify|dedup/i, template: 'refactor-flow' },
  { pattern: /security|vulnerability|credential|secret|xss|injection/i, template: 'security-flow' },
  { pattern: /research|search.*web|investigate|find.*(library|api)/i, template: 'research-flow' },
  { pattern: /git|commit|pr|pull.request|review|staged/i, template: 'git-flow' },
];

const DEFAULT_TEMPLATE = 'default-flow';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the best workflow template for a goal.
 * @param {string} goal - Task description
 * @returns {string} Template name
 */
export function selectTemplate(goal) {
  for (const matcher of TEMPLATE_MATCHERS) {
    if (matcher.pattern.test(goal)) {
      return matcher.template;
    }
  }
  return DEFAULT_TEMPLATE;
}

/**
 * Generate the smart_workflow create command for a goal.
 * @param {string} goal - Task description
 * @param {object} [options]
 * @param {string} [options.template] - Workflow template (auto-detected if not specified)
 * @param {string} [options.state] - Custom state file path
 * @param {boolean} [options.json] - JSON output format
 * @returns {{ command: string, workflowId: string, template: string }}
 */
export function planAutoExecute(goal, options = {}) {
  const template = options.template || selectTemplate(goal);
  const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const args = [`"${goal.replace(/"/g, '\\"')}"`];
  args.push(`--template ${template}`);
  if (options.state) args.push(`--state "${options.state}"`);
  if (options.json !== false) args.push('--json');

  return {
    command: `smart_workflow create ${args.join(' ')}`,
    workflowId,
    template,
    goal,
  };
}

/**
 * Generate the command to dispatch the next pending step(s) in a workflow.
 * @param {object} workflowState - Current workflow state
 * @param {object} [options]
 * @param {number} [options.group] - Specific parallel group to dispatch
 * @param {number} [options.timeout] - Per-step timeout in ms
 * @returns {{ command: string, stepCount: number, parallel: boolean }}
 */
export function getDispatchCommand(workflowState, options = {}) {
  const statePath = workflowState._stateFile || '.workflow-state.json';
  const args = [`--state "${statePath}"`];
  if (options.group !== undefined) args.push(`--group ${options.group}`);
  if (options.timeout) args.push(`--timeout ${options.timeout}`);

  return {
    command: `smart_workflow dispatch ${args.join(' ')}`,
    stepCount: workflowState.steps ? workflowState.steps.length : 0,
    parallel: options.group !== undefined,
  };
}

/**
 * Generate the replan command when a step fails.
 * @param {string} workflowId - Workflow identifier
 * @param {string} statePath - Path to workflow state file
 * @param {string} failureContext - Description of what went wrong
 * @returns {{ command: string }}
 */
export function getReplanCommand(workflowId, statePath, failureContext) {
  return {
    command: `smart_workflow replan --state "${statePath}" --context "${failureContext.replace(/"/g, '\\"')}"`,
  };
}

/**
 * Generate the summary command for a completed workflow.
 * @param {string} statePath - Path to workflow state file
 * @param {boolean} [json=true] - JSON output
 * @returns {{ command: string }}
 */
export function getSummaryCommand(statePath, json = true) {
  const args = [`--state "${statePath}"`];
  if (json) args.push('--json');
  return {
    command: `smart_workflow summary ${args.join(' ')}`,
  };
}

/**
 * Determine if a step result indicates the workflow should replan.
 * @param {object} stepResult - Result from a workflow step
 * @returns {boolean}
 */
export function shouldReplan(stepResult) {
  if (!stepResult) return false;
  // Check for failure indicators
  const content = JSON.stringify(stepResult).toLowerCase();
  return (
    stepResult.status === 'fail' ||
    stepResult.status === 'failed' ||
    content.includes('"ok":false') ||
    content.includes('error') ||
    content.includes('timeout')
  );
}

/**
 * Extract actionable findings from a workflow summary.
 * @param {object} summary - Workflow summary result
 * @returns {Array<{ type: string, message: string, severity: string }>}
 */
export function extractFindings(summary) {
  const findings = [];

  if (!summary) return findings;

  // Parse steps
  if (summary.steps) {
    for (const step of summary.steps) {
      if (step.status === 'fail' || step.status === 'failed') {
        findings.push({
          type: 'failure',
          message: `Step "${step.tool}" failed: ${step.error || 'Unknown error'}`,
          severity: 'high',
        });
      }
    }
  }

  // Parse toolStats
  if (summary.toolStats) {
    for (const [tool, stats] of Object.entries(summary.toolStats)) {
      if (stats.failures > 0) {
        findings.push({
          type: 'tool-failure',
          message: `${tool} had ${stats.failures} failure(s) in this workflow`,
          severity: stats.failures > 1 ? 'high' : 'medium',
        });
      }
    }
  }

  return findings;
}
