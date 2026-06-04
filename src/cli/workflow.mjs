#!/usr/bin/env node

// workflow.mjs — Workflow lifecycle management for Smart MCP
//
// Orchestrates multi-tool workflows using plan templates.
// Delegates plan generation to planner.mjs (via spawn) and
// manages workflow state as a JSON file on disk.
//
// Commands:
//   create   — create a new workflow (plan from template or goal)
//   report   — record step execution result
//   replan   — re-plan remaining steps after failure
//   summary  — show workflow state as JSON or text
//
// Usage:
//   node workflow.mjs create <goal> [--template <name>] [--state <path>] [--json]
//   node workflow.mjs report --state <path> --step <N> --status <ok|fail|skip> [--result <json>] [--error <str>]
//   node workflow.mjs replan --state <path> [--context <text>]
//   node workflow.mjs summary --state <path> [--json]
//   node workflow.mjs --help

import { argv, exit } from 'node:process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKFLOW_DIR = resolve(dirname(process.argv[1] || '.'), '.workflows');
const TOOL_NAME = 'smart_workflow';

const WORKFLOW_TEMPLATES = {
  'debug-flow': {
    description: 'Debug an error: search memory, grep code, diagnose, fix, then verify with tests',
    steps: [
      { tool: 'smart_memory_store',   args: { command: 'search', query: '$goal' }, description: 'Search memory for similar past errors', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_grep',           args: { pattern: 'error|Error|ERROR|exception|throw|failed' }, description: 'Search code for error-related patterns', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_error_diagnose', args: { error: '$goal' }, description: 'Diagnose error against KB + memory', dependsOn: [0, 1], onFailure: 'skip' },
      { tool: 'smart_debug',          args: { error: '$goal' }, description: 'Deep debug analysis of root cause', dependsOn: [0, 1], onFailure: 'skip' },
      { tool: 'smart_cross_file_edit', args: {}, description: 'Apply fix changes across files', dependsOn: [2, 3], onFailure: 'warn' },
      { tool: 'smart_test',           args: {}, description: 'Run tests to verify the fix', dependsOn: [4], onFailure: 'warn' },
    ],
  },
  'refactor-flow': {
    description: 'Safely refactor code: analyze deps, check naming, safety check, apply changes, test',
    steps: [
      { tool: 'smart_import_graph',   args: { depth: 2 }, description: 'Analyze import dependencies', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_naming',         args: {}, description: 'Check naming conventions in scope', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_rename_safety',  args: {}, description: 'Check rename safety & detect conflicts', dependsOn: [0], onFailure: 'abort' },
      { tool: 'smart_cross_file_edit', args: {}, description: 'Apply refactor changes across files', dependsOn: [2], onFailure: 'warn' },
      { tool: 'smart_test',           args: {}, description: 'Run tests to verify refactor', dependsOn: [3], onFailure: 'warn' },
    ],
  },
  'security-flow': {
    description: 'Audit and fix security issues: scan creds, scan injections, grep high-risk patterns, fix, verify',
    steps: [
      { tool: 'smart_security',       args: { scan: 'credentials' }, description: 'Scan for leaked credentials & secrets', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_security',       args: { scan: 'injection' }, description: 'Scan for injection flaws (XSS/SQL/command)', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_grep',           args: { pattern: 'eval|exec|spawn|shell|child_process' }, description: 'Find high-risk API usage patterns', dependsOn: [0, 1], onFailure: 'skip' },
      { tool: 'smart_cross_file_edit', args: {}, description: 'Fix identified security issues', dependsOn: [2], onFailure: 'warn' },
      { tool: 'smart_test',           args: {}, description: 'Run tests to verify security fixes', dependsOn: [3], onFailure: 'warn' },
    ],
  },
  'research-flow': {
    description: 'Research a topic: search the web, synthesize findings with thinking, generate report',
    steps: [
      { tool: 'smart_exa_search',     args: { query: '$goal' }, description: 'Search the web for relevant information', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_thinking',       args: { template: 'research', topic: '$goal' }, description: 'Synthesize research findings into insights', dependsOn: [0], onFailure: 'warn' },
      { tool: 'smart_report',         args: { type: 'custom', title: '$goal' }, description: 'Generate structured research report', dependsOn: [1], onFailure: 'skip' },
    ],
  },
  'default-flow': {
    description: 'Generic: plan with smart_planner, execute, verify with tests',
    steps: [
      { tool: 'smart_planner', args: { goal: '$goal', command: 'execute' }, description: 'Generate execution plan from goal', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_test',    args: {}, description: 'Run tests to establish baseline', dependsOn: [0], onFailure: 'skip' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO() {
  return new Date().toISOString();
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function printHelp() {
  console.log(`
Usage:
  node workflow.mjs create <goal> [options]
  node workflow.mjs report --state <path> --step <N> --status <ok|fail|skip> [--result <json>] [--error <str>]
  node workflow.mjs replan --state <path> [--context <text>]
  node workflow.mjs summary --state <path> [--json]
  node workflow.mjs list-templates

Options:
  --template <name>   Workflow template (debug-flow, refactor-flow, security-flow, research-flow, default-flow)
  --state <path>      Path to workflow state file (default: .workflows/<uuid>.json)
  --context <text>    Extra context (project info, constraints) for plan generation
  --json              Output in JSON format
  -h, --help          Show this help

Templates:
${Object.entries(WORKFLOW_TEMPLATES).map(([k, v]) => `  ${k.padEnd(20)} ${v.description}`).join('\n')}
`);
}

function loadState(statePath) {
  if (!existsSync(statePath)) {
    console.error(`[${TOOL_NAME}] State file not found: ${statePath}`);
    exit(1);
  }
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

function saveState(statePath, state) {
  ensureDir(dirname(statePath));
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function computeParallelHints(steps) {
  if (!steps || steps.length === 0) return [];
  const stepGroups = {};
  const ungrouped = new Set(steps.map(s => s.step));
  let group = 0;

  while (ungrouped.size > 0) {
    const currentGroup = [];
    for (const stepNum of ungrouped) {
      const step = steps.find(s => s.step === stepNum);
      if (!step) continue;
      const deps = step.dependsOn || [];
      const allDepsResolved = deps.length === 0 || deps.every(d => stepGroups[d] !== undefined && stepGroups[d] < group);
      if (allDepsResolved) { currentGroup.push(stepNum); }
    }
    if (currentGroup.length === 0) break;
    currentGroup.sort((a, b) => a - b);
    for (const sn of currentGroup) { stepGroups[sn] = group; ungrouped.delete(sn); }
    group++;
  }

  const result = [];
  for (let g = 0; g < group; g++) {
    const grp = Object.entries(stepGroups)
      .filter(([, grp]) => grp === g)
      .map(([s]) => parseInt(s, 10))
      .sort((a, b) => a - b);
    if (grp.length > 0) result.push(grp);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Command: create
// ---------------------------------------------------------------------------

function cmdCreate(goal, opts) {
  const templateName = opts.template || 'default-flow';
  const template = WORKFLOW_TEMPLATES[templateName];

  if (!template) {
    console.error(`[${TOOL_NAME}] Unknown template: ${templateName}. Use list-templates to see available.`);
    exit(1);
  }

  // Resolve $goal placeholders
  const steps = template.steps.map((s, i) => {
    const resolvedArgs = {};
    for (const [k, v] of Object.entries(s.args)) {
      resolvedArgs[k] = typeof v === 'string' ? v.replace(/\$goal/g, goal) : v;
    }
    return {
      step: i,
      tool: s.tool,
      args: resolvedArgs,
      description: s.description,
      dependsOn: s.dependsOn || [],
      onFailure: s.onFailure || 'abort',
      status: 'pending', // pending | running | ok | fail | skip
      result: null,
      error: null,
      duration: null,
    };
  });

  // Compute parallel hints
  const parallel = computeParallelHints(steps);

  const workflowId = randomUUID();
  const statePath = opts.state || resolve(WORKFLOW_DIR, `${workflowId}.json`);

  const state = {
    workflowId,
    goal,
    template: templateName,
    status: 'active',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    statePath,
    steps,
    currentStepGroup: 0,
    parallel,
    completedSteps: [],
    failedSteps: [],
    skippedSteps: [],
    accumulatedContext: opts.context || '',
    findings: [],
    toolStats: {},
  };

  ensureDir(dirname(statePath));
  saveState(statePath, state);

  if (opts.json) {
    console.log(JSON.stringify({ workflowId, statePath, steps, parallel, status: 'active' }, null, 2));
  } else {
    console.log(`[${TOOL_NAME}] Created workflow: ${workflowId}`);
    console.log(`  Template:   ${templateName}`);
    console.log(`  Goal:       ${goal}`);
    console.log(`  State:      ${statePath}`);
    console.log(`  Steps:      ${steps.length}`);
    console.log(`  Parallel:   ${parallel.map(g => `[${g.join(', ')}]`).join(' → ')}`);
    console.log(`  Status:     active`);
    console.log(`\nNext: run workflow report to start executing steps.`);
  }
}

// ---------------------------------------------------------------------------
// Command: report
// ---------------------------------------------------------------------------

function cmdReport(opts) {
  const statePath = opts.state;
  if (!statePath) { console.error(`[${TOOL_NAME}] --state required for report`); exit(1); }
  const state = loadState(statePath);

  const stepNum = opts.step;
  if (stepNum === undefined || stepNum === null) { console.error(`[${TOOL_NAME}] --step required for report`); exit(1); }

  const step = state.steps[stepNum];
  if (!step) { console.error(`[${TOOL_NAME}] Step ${stepNum} not found`); exit(1); }

  const status = opts.status || 'ok';
  step.status = status;
  if (opts.result) step.result = opts.result;
  if (opts.error) step.error = opts.error;
  if (opts.duration) step.duration = opts.duration;
  step.completedAt = nowISO();

  // Track completed/failed/skipped — respect onFailure strategy
  if (status === 'ok') {
    state.completedSteps.push(stepNum);
    if (opts.result) {
      try {
        const parsed = typeof opts.result === 'string' ? JSON.parse(opts.result) : opts.result;
        if (parsed.findings) state.findings.push(...parsed.findings);
        if (parsed.context) state.accumulatedContext += `\n${parsed.context}`;
      } catch { /* ignore parse errors */ }
    }
  } else if (status === 'fail') {
    if (step.onFailure === 'abort') {
      state.failedSteps.push(stepNum);
      state.status = 'failed';
    } else if (step.onFailure === 'skip') {
      // Convert fail to skip per step's onFailure strategy
      step.status = 'skip';
      state.skippedSteps.push(stepNum);
    } else {
      // onFailure === 'warn' — keep active, record as failed
      state.failedSteps.push(stepNum);
    }
  } else if (status === 'skip') {
    state.skippedSteps.push(stepNum);
  }

  // Update tool stats
  const toolName = step.tool;
  if (!state.toolStats[toolName]) state.toolStats[toolName] = { calls: 0, ok: 0, fail: 0, totalDuration: 0 };
  state.toolStats[toolName].calls++;
  if (status === 'ok') state.toolStats[toolName].ok++;
  else if (status === 'fail') state.toolStats[toolName].fail++;
  if (opts.duration) state.toolStats[toolName].totalDuration += opts.duration;

  // Advance step group if current group completed
  // Determine next group: all steps in current group must have non-pending status
  const currentGroup = state.parallel[state.currentStepGroup];
  if (currentGroup) {
    const allDone = currentGroup.every(sn => state.steps[sn] && state.steps[sn].status !== 'pending');
    if (allDone) {
      state.currentStepGroup++;
    }
  }

  // Check if all steps done
  const totalSteps = state.steps.length;
  const doneSteps = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
  if (doneSteps >= totalSteps) {
    state.status = 'completed';
  }

  state.updatedAt = nowISO();
  saveState(statePath, state);

  if (opts.json) {
    console.log(JSON.stringify({ workflowId: state.workflowId, status: state.status, currentStepGroup: state.currentStepGroup, completedSteps: state.completedSteps, failedSteps: state.failedSteps, skippedSteps: state.skippedSteps }, null, 2));
  } else {
    console.log(`[${TOOL_NAME}] Step ${stepNum} (${step.tool}) → ${status}`);
    console.log(`  Status:         ${state.status}`);
    console.log(`  Completed:      ${state.completedSteps.length}/${totalSteps}`);
    console.log(`  Next group:     ${state.currentStepGroup}${state.status !== 'completed' ? ` → [${(state.parallel[state.currentStepGroup] || []).join(', ')}]` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Command: replan
// ---------------------------------------------------------------------------

function cmdReplan(opts) {
  const statePath = opts.state;
  if (!statePath) { console.error(`[${TOOL_NAME}] --state required for replan`); exit(1); }
  const state = loadState(statePath);

  if (state.status === 'completed') {
    console.error(`[${TOOL_NAME}] Cannot replan a completed workflow`);
    exit(1);
  }

  // Mark remaining pending steps as cancelled
  for (const step of state.steps) {
    if (step.status === 'pending') {
      step.status = 'skip';
      step.error = 'cancelled by replan';
      state.skippedSteps.push(step.step);
    }
  }

  // Find failed steps for context
  const failContext = state.failedSteps.map(sn => {
    const s = state.steps[sn];
    return `Step ${sn} (${s.tool}): ${s.error || 'failed'}`;
  }).join('\n');

  // Re-execute planner for remaining goal + context
  const contextParts = [state.goal, state.accumulatedContext, failContext, opts.context || ''].filter(Boolean);
  const replanGoal = `Continue: ${state.goal} (context: ${contextParts.join(' | ')})`;

  const plannerPath = resolve(dirname(process.argv[1]), 'planner.mjs');
  if (!existsSync(plannerPath)) {
    console.error(`[${TOOL_NAME}] planner.mjs not found at ${plannerPath}`);
    exit(1);
  }

  const result = spawnSync('node', [plannerPath, replanGoal, '--format', 'json', '--context', contextParts.join(' | ')], {
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    console.error(`[${TOOL_NAME}] Planner failed: ${result.stderr || result.error || 'unknown error'}`);
    exit(1);
  }

  const newPlan = JSON.parse(result.stdout);
  if (!newPlan || !newPlan.steps) {
    console.error(`[${TOOL_NAME}] Planner returned invalid plan`);
    exit(1);
  }

  // Append replan steps (with step numbers offset)
  const offset = state.steps.length;
  const replanSteps = newPlan.steps.map((s, i) => ({
    step: offset + i,
    tool: s.tool,
    args: s.args || {},
    description: s.description || s.task || s.tool,
    dependsOn: (s.dependsOn || []).map(d => d + offset),
    onFailure: s.onFailure || 'abort',
    status: 'pending',
    result: null,
    error: null,
    duration: null,
    isReplan: true,
  }));

  state.steps.push(...replanSteps);
  state.parallel = computeParallelHints(state.steps);
  state.currentStepGroup = state.parallel.findIndex(g => g.includes(offset));
  state.status = 'active';
  state.updatedAt = nowISO();

  saveState(statePath, state);

  if (opts.json) {
    console.log(JSON.stringify({ workflowId: state.workflowId, status: state.status, newSteps: replanSteps.length, totalSteps: state.steps.length, parallel: state.parallel }, null, 2));
  } else {
    console.log(`[${TOOL_NAME}] Replanned workflow: ${state.workflowId}`);
    console.log(`  New steps:  ${replanSteps.length} (total: ${state.steps.length})`);
    console.log(`  Status:     ${state.status}`);
    console.log(`  Next group: [${(state.parallel[state.currentStepGroup] || []).join(', ')}]`);
  }
}

// ---------------------------------------------------------------------------
// Command: summary
// ---------------------------------------------------------------------------

function cmdSummary(opts) {
  const statePath = opts.state;
  if (!statePath) { console.error(`[${TOOL_NAME}] --state required for summary`); exit(1); }
  const state = loadState(statePath);

  if (opts.json) {
    console.log(JSON.stringify({
      workflowId: state.workflowId,
      goal: state.goal,
      template: state.template,
      status: state.status,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      totalSteps: state.steps.length,
      completedSteps: state.completedSteps,
      failedSteps: state.failedSteps,
      skippedSteps: state.skippedSteps,
      currentStepGroup: state.currentStepGroup,
      parallel: state.parallel,
      findings: state.findings.length,
      toolStats: state.toolStats,
      steps: state.steps.map(s => ({
        step: s.step,
        tool: s.tool,
        status: s.status,
        onFailure: s.onFailure,
        dependsOn: s.dependsOn,
        isReplan: s.isReplan || false,
      })),
    }, null, 2));
  } else {
    const pct = state.steps.length > 0 ? Math.round((state.completedSteps.length / state.steps.length) * 100) : 0;
    console.log(`[${TOOL_NAME}] Workflow: ${state.workflowId}`);
    console.log(`  Template:   ${state.template}`);
    console.log(`  Goal:       ${state.goal}`);
    console.log(`  Status:     ${state.status}`);
    console.log(`  Progress:   ${state.completedSteps.length}/${state.steps.length} (${pct}%)`);
    console.log(`  Failed:     ${state.failedSteps.length}`);
    console.log(`  Skipped:    ${state.skippedSteps.length}`);
    console.log(`  Parallel:   ${state.parallel.map(g => `[${g.join(', ')}]`).join(' → ')}`);
    console.log(`  Current:    ${state.currentStepGroup}/${state.parallel.length}`);
    console.log(`  Findings:   ${state.findings.length}`);

    if (state.toolStats && Object.keys(state.toolStats).length > 0) {
      console.log(`  Tool Usage:`);
      for (const [tool, stats] of Object.entries(state.toolStats)) {
        console.log(`    ${tool}: ${stats.calls} calls (${stats.ok} ok, ${stats.fail} fail)`);
      }
    }

    if (state.steps.length > 0) {
      console.log(`  Steps:`);
      for (const s of state.steps) {
        const icon = s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : s.status === 'skip' ? '−' : '·';
        const deps = s.dependsOn.length > 0 ? ` [deps: ${s.dependsOn.join(',')}]` : '';
        const note = s.isReplan ? ' [replan]' : '';
        console.log(`    ${icon} #${s.step} ${s.tool}${deps}${note}`);
        if (s.description) console.log(`        ${s.description}`);
        if (s.error) console.log(`        error: ${s.error}`);
      }
    }

    // Show next actionable steps
    const nextGroup = state.parallel[state.currentStepGroup];
    if (nextGroup && state.status !== 'completed') {
      console.log(`\n  Next steps: ${nextGroup.map(sn => `#${sn} (${state.steps[sn].tool})`).join(', ')}`);
    } else if (state.status === 'completed') {
      console.log(`\n  Workflow complete.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command: list-templates
// ---------------------------------------------------------------------------

function cmdListTemplates(opts) {
  if (opts.json) {
    console.log(JSON.stringify(WORKFLOW_TEMPLATES, null, 2));
  } else {
    console.log(`Available workflow templates:\n`);
    for (const [name, tmpl] of Object.entries(WORKFLOW_TEMPLATES)) {
      console.log(`  ${name}`);
      console.log(`    ${tmpl.description}`);
      console.log(`    Steps: ${tmpl.steps.map(s => s.tool).join(' → ')}`);
      console.log();
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    exit(0);
  }

  const command = args.shift();
  const opts = {};

  // Parse options
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--template') opts.template = args[++i];
    else if (a === '--state') opts.state = resolve(process.cwd(), args[++i]);
    else if (a === '--context') opts.context = args[++i];
    else if (a === '--step') opts.step = parseInt(args[++i], 10);
    else if (a === '--status') opts.status = args[++i];
    else if (a === '--result') opts.result = args[++i];
    else if (a === '--error') opts.error = args[++i];
    else if (a === '--duration') opts.duration = parseInt(args[++i], 10);
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) { /* skip unknown */ }
    else positional.push(a);
  }

  switch (command) {
    case 'create':
      if (positional.length === 0) { console.error(`[${TOOL_NAME}] Goal required for create`); exit(1); }
      cmdCreate(positional.join(' '), opts);
      break;
    case 'report':
      cmdReport(opts);
      break;
    case 'replan':
      cmdReplan(opts);
      break;
    case 'summary':
      cmdSummary(opts);
      break;
    case 'list-templates':
      cmdListTemplates(opts);
      break;
    default:
      console.error(`[${TOOL_NAME}] Unknown command: ${command}. Use --help for usage.`);
      exit(1);
  }
}

main();
