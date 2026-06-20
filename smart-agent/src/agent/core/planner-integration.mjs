// planner-integration.mjs — Smart Agent planner orchestration
//
// Bridges opencode agent goals with smart-mcp's smart_planner tool.
// Generates decomposed plans with DAG dependencies and parallel hints.
// Phase 4: Boulder integration for persistent plan + task tracking.
//
// Usage:
//   import { planAndExecute, analyzePlan, createBoulderPlan, completeBoulderTask }
//     from 'smart-agent/planner-integration';
//   const plan = planAndExecute('find and fix all security vulnerabilities');

import { getMemoryDB } from '../../../../src/lib/memory-db.mjs';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the smart_planner command to decompose a complex goal.
 * @param {string} goal - Complex task description
 * @param {object} [options]
 * @param {number} [options.steps] - Max steps in the plan
 * @param {boolean} [options.strict] - Strict mode (only use explicitly matching templates)
 * @param {string} [options.state] - State file path for plan execution
 * @returns {{ command: string, planId: string, estimatedComplexity: string }}
 */
export function planAndExecute(goal, options = {}) {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const args = [`"${goal.replace(/"/g, '\\"')}"`];
  if (options.steps) args.push(`--steps ${options.steps}`);
  if (options.strict) args.push('--strict');
  if (options.state) args.push(`--state "${options.state}"`);

  const estimatedComplexity = estimateComplexity(goal);

  return {
    command: `smart_planner execute ${args.join(' ')}`,
    planId,
    estimatedComplexity,
    goal,
  };
}

/**
 * Analyze a planner output and extract useful metadata.
 * @param {object} planOutput - Parsed output from smart_planner
 * @returns {{ steps: number, parallelGroups: number, estimatedDuration: string, risks: string[] }}
 */
export function analyzePlan(planOutput) {
  const result = {
    steps: 0,
    parallelGroups: 0,
    estimatedDuration: 'unknown',
    risks: [],
  };

  if (!planOutput) return result;

  // Parse plan steps
  const steps = planOutput.steps || planOutput.plan || [];
  result.steps = Array.isArray(steps) ? steps.length : 0;

  // Count parallel groups
  if (planOutput.parallelHints || planOutput.parallelGroups) {
    const groups = planOutput.parallelHints || planOutput.parallelGroups;
    result.parallelGroups = Array.isArray(groups) ? groups.length : 0;
  } else if (Array.isArray(steps)) {
    // Infer from dependsOn
    const groups = new Set();
    for (const step of steps) {
      if (step.dependsOn && Array.isArray(step.dependsOn) && step.dependsOn.length > 0) {
        // This step has dependencies, belongs to a later group
      } else {
        groups.add('root');
      }
    }
    result.parallelGroups = groups.size;
  }

  // Estimate duration
  if (result.steps > 0) {
    const sequentialSteps = result.steps - (result.parallelGroups > 0 ? result.parallelGroups - 1 : 0);
    result.estimatedDuration = `~${sequentialSteps * 5}-${sequentialSteps * 15} seconds`;
  }

  // Identify risks
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step.onFailure === 'abort') {
        result.risks.push(`Step "${step.tool || step.name}" is critical (onFailure=abort)`);
      }
      if (step.tool === 'smart_cross_file_edit' && !step.args?.dryRun) {
        result.risks.push(`Step "${step.tool}" runs without dry-run — changes are applied directly`);
      }
    }
  }

  return result;
}

/**
 * Determine the next action after a planner step completes.
 * @param {object} planState - Current plan execution state
 * @param {number} completedStep - Index of the step that just completed
 * @param {string} status - 'ok' | 'fail' | 'skip'
 * @returns {{ action: 'continue' | 'replan' | 'abort' | 'complete', nextSteps: string[], reason: string }}
 */
export function determineNextAction(planState, completedStep, status) {
  if (!planState || !planState.steps) {
    return { action: 'abort', nextSteps: [], reason: 'Invalid plan state' };
  }

  const steps = planState.steps;
  const remaining = [];

  // Determine which steps are still pending
  for (let i = completedStep + 1; i < steps.length; i++) {
    const step = steps[i];
    const isBlocked = step.dependsOn && step.dependsOn.some(d => d <= completedStep && status === 'fail');
    if (!isBlocked) {
      remaining.push(step.tool || step.name);
    }
  }

  if (status === 'fail') {
    const failedStep = steps[completedStep];
    const onFailure = failedStep?.onFailure || 'abort';

    if (onFailure === 'abort') {
      return { action: 'abort', nextSteps: [], reason: `Critical step failed (onFailure=abort): ${failedStep.tool || failedStep.name}` };
    }
    if (onFailure === 'skip') {
      return {
        action: remaining.length > 0 ? 'continue' : 'complete',
        nextSteps: remaining,
        reason: `Step skipped (onFailure=skip), continuing with remaining ${remaining.length} step(s)`,
      };
    }
    if (onFailure === 'warn') {
      return {
        action: 'replan',
        nextSteps: remaining,
        reason: `Step failed with onFailure=warn, recommending replan for remaining ${remaining.length} step(s)`,
      };
    }
  }

  if (remaining.length === 0) {
    return { action: 'complete', nextSteps: [], reason: 'All steps completed successfully' };
  }

  return { action: 'continue', nextSteps: remaining, reason: `Continuing with ${remaining.length} remaining step(s)` };
}

/**
 * Check if a goal is complex enough to warrant planner decomposition.
 * @param {string} goal - Task description
 * @returns {boolean}
 */
export function needsPlanning(goal) {
  if (!goal) return false;

  // Heuristics: long goal, multiple conjunctive keywords, or specific patterns
  const complexityIndicators = [
    goal.split(' ').length > 15,
    /\b(and|also|then|plus|with)\b/i.test(goal),
    /(all|every|multiple|several|each)\b/i.test(goal),
    /\b(find|fix|debug|refactor|audit|implement|add|create)\b/i.test(goal),
    goal.includes(','),
  ];

  return complexityIndicators.filter(Boolean).length >= 2;
}

// ---------------------------------------------------------------------------
// Phase 4 — Boulder Integration
// ---------------------------------------------------------------------------

/**
 * Create a Boulder plan from a goal and step array.
 * Automatically creates the plan + all tasks in Boulder storage.
 *
 * Call AFTER the planner returns steps. The returned boulderPlanId
 * should be tracked for subsequent task completions.
 *
 * @param {string} goal - Plan name (the high-level goal)
 * @param {Array<string|{name:string, description?:string}>} steps - Step descriptions or objects
 * @param {object} [options]
 * @param {string} [options.description] - Optional plan description
 * @returns {{
 *   plan: object,
 *   tasks: object[],
 *   boulderPlanId: string
 * }}
 */
export function createBoulderPlan(goal, steps = [], options = {}) {
  const taskNames = steps.map(s =>
    typeof s === 'string' ? s : (s.name || s.description || String(s)),
  );

  const db = getMemoryDB();
  const plan = db.createPlan(goal, options.description || null, taskNames);
  const tasks = db.listTasks(plan.id);

  return { plan, tasks, boulderPlanId: plan.id };
}

/**
 * Complete a Boulder task with auto-checkpoint.
 *
 * Combines updateTask(status=completed) + saveCheckpoint() in one call.
 * Agents use this instead of separate task-update + checkpoint steps.
 *
 * @param {string} taskId - Boulder task ID
 * @param {object} [options]
 * @param {string} [options.result] - Summary of what was done
 * @param {string[]} [options.filesChanged] - Files modified during this task
 * @param {string[]} [options.decisions] - Key decisions made
 * @param {string} [options.nextIntent] - What to do next
 * @returns {{ task: object, checkpoint: object }}
 */
export function completeBoulderTask(taskId, options = {}) {
  const db = getMemoryDB();
  const task = db.getTask(taskId);
  if (!task) throw new Error(`Boulder task not found: ${taskId}`);

  // Update task to completed
  const updatedTask = db.updateTask(taskId, {
    status: 'completed',
    result: options.result || null,
  });

  // Auto-save checkpoint with context
  // saveCheckpoint 內部會做 JSON.stringify，傳陣列即可
  const summary = `Completed: ${task.name}` +
    (options.result ? ` — ${options.result}` : '');

  const checkpoint = db.saveCheckpoint(task.plan_id, {
    taskId,
    contextSummary: summary,
    filesChanged: options.filesChanged || null,
    decisions: options.decisions || null,
    nextIntent: options.nextIntent || null,
  });

  return { task: updatedTask, checkpoint };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function estimateComplexity(goal) {
  const wordCount = goal.split(/\s+/).length;
  if (wordCount > 20) return 'high';
  if (wordCount > 10) return 'medium';
  return 'low';
}
