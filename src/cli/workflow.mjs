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
import { spawnSync, spawn } from 'node:child_process';

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
  'refactor-safe-flow': {
    description: 'Refactor with change-impact awareness: analyze impact, trace call graph, think, apply safely, verify',
    steps: [
      { tool: 'smart_impact_flow',    args: {}, description: 'Analyze change impact via CKG call graph', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_code_call_graph', args: { depth: 2 }, description: 'Confirm impact scope with call graph', dependsOn: [0], onFailure: 'skip' },
      { tool: 'smart_thinking',       args: { template: 'refactor', topic: '$goal' }, description: 'Think about impact results & plan safe changes', dependsOn: [0, 1], onFailure: 'skip' },
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
  'git-flow': {
    description: 'Git workflow: analyze context, commit with auto-message, optionally create PR or review. Goal is the commit intent (e.g., "add login feature" or "review staged changes").',
    steps: [
      { tool: 'smart_git_context', args: { all: true, statOnly: true }, description: 'Analyze git state — staged/unstaged changes', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_git_commit',  args: { all: true, dryRun: true, message: '$goal' }, description: 'Preview commit with auto-generated message', dependsOn: [0], onFailure: 'warn' },
      { tool: 'smart_git_commit',  args: { all: true, message: '$goal' }, description: 'Execute the commit', dependsOn: [1], onFailure: 'abort' },
      { tool: 'smart_git_pr',      args: { noPublish: true }, description: 'Generate PR description from committed changes', dependsOn: [2], onFailure: 'skip' },
      { tool: 'smart_git_review',  args: { all: true, focus: 'all' }, description: 'Review all changes for issues', dependsOn: [0], onFailure: 'skip' },
    ],
  },
  // --- New in Sprint 1 (v4.0) ---

  'api-explore-flow': {
    description: 'Explore API surface: learn project, extract AST symbols, trace call graph, generate architecture diagram',
    steps: [
      { tool: 'smart_learn',           args: {}, description: 'Learn project structure & conventions', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_code_ast',        args: {}, description: 'Extract AST symbol tree from source', dependsOn: [0], onFailure: 'warn' },
      { tool: 'smart_code_call_graph', args: { depth: 2 }, description: 'Trace call graph between symbols', dependsOn: [1], onFailure: 'warn' },
      { tool: 'smart_diagram',         args: { type: 'flowchart', title: '$goal' }, description: 'Generate architecture diagram', dependsOn: [1, 2], onFailure: 'skip' },
    ],
  },
  'migration-flow': {
    description: 'Safe migration: impact analysis, call graph confirmation, structured thinking, apply changes, verify with tests',
    steps: [
      { tool: 'smart_impact_flow',    args: {}, description: 'Analyze change impact via CKG', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_code_call_graph', args: { depth: 2 }, description: 'Confirm impact scope with call graph', dependsOn: [0], onFailure: 'warn' },
      { tool: 'smart_thinking',       args: { template: 'refactor', topic: '$goal' }, description: 'Plan migration steps from impact data', dependsOn: [0, 1], onFailure: 'abort' },
      { tool: 'smart_cross_file_edit', args: {}, description: 'Apply migration changes across files', dependsOn: [2], onFailure: 'warn' },
      { tool: 'smart_test',           args: {}, description: 'Run tests after migration', dependsOn: [3], onFailure: 'warn' },
    ],
  },
  'code-review-flow': {
    description: 'Automated code review: grep patterns, extract AST, trace call graph, think, generate review report',
    steps: [
      { tool: 'smart_grep',           args: { pattern: '$goal' }, description: 'Search codebase for relevant patterns', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_code_ast',       args: {}, description: 'Extract AST symbols for context', dependsOn: [0], onFailure: 'skip' },
      { tool: 'smart_code_call_graph', args: { depth: 1 }, description: 'Trace call graph relationships', dependsOn: [0, 1], onFailure: 'skip' },
      { tool: 'smart_thinking',       args: { template: 'analyze', topic: '$goal' }, description: 'Analyze findings and identify issues', dependsOn: [0, 1, 2], onFailure: 'skip' },
      { tool: 'smart_report',         args: { type: 'custom', title: '$goal' }, description: 'Generate code review report', dependsOn: [3], onFailure: 'skip' },
    ],
  },
  'perf-diagnose-flow': {
    description: 'Performance diagnosis: find hotspots via grep, analyze patterns, deep debug, generate report with recommendations',
    steps: [
      { tool: 'smart_grep',           args: { pattern: 'O(n)|bottleneck|slow|perf|performance|optimize|leak|lazy|memoize|cache|debounce|throttle|O(1)|O(n²)|O(log)' }, description: 'Find performance-sensitive patterns', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_error_diagnose', args: { error: '$goal' }, description: 'Diagnose performance patterns from grep results', dependsOn: [0], onFailure: 'skip' },
      { tool: 'smart_debug',          args: { error: '$goal' }, description: 'Deep debug analysis of perf issues', dependsOn: [0, 1], onFailure: 'skip' },
      { tool: 'smart_report',         args: { type: 'custom', title: '$goal' }, description: 'Generate performance diagnosis report', dependsOn: [1, 2], onFailure: 'skip' },
    ],
  },
  'onboard-flow': {
    description: 'Project onboarding: learn structure, analyze imports, check conventions, generate map and onboarding report',
    steps: [
      { tool: 'smart_learn',          args: {}, description: 'Learn project language, structure, deps', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_import_graph',   args: { depth: 2 }, description: 'Analyze import dependency graph', dependsOn: [0], onFailure: 'warn' },
      { tool: 'smart_naming',         args: {}, description: 'Check naming conventions across project', dependsOn: [0], onFailure: 'skip' },
      { tool: 'smart_diagram',        args: { type: 'flowchart', title: '$goal' }, description: 'Generate project map diagram', dependsOn: [1, 2], onFailure: 'skip' },
      { tool: 'smart_report',         args: { type: 'custom', title: '$goal' }, description: 'Generate onboarding report', dependsOn: [3], onFailure: 'skip' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tool → CLI script mapping (for dispatch command)
// Maps MCP tool names to their CLI script filenames in src/cli/
// Must be kept in sync with loader.mjs plugin definitions.
// ---------------------------------------------------------------------------

const TOOL_CLI_MAP = {
  // Core tools (6)
  smart_grep: 'contextual-grep.mjs',
  smart_learn: 'learn-adapt.mjs',
  smart_security: 'security-scan.mjs',
  smart_test: 'test-runner.mjs',
  smart_thinking: 'thinking.mjs',
  // smart_think has no CLI — handler only

  // Standard tools used in templates
  smart_memory_store: 'memory-store.mjs',
  smart_error_diagnose: 'error-diagnose.mjs',
  smart_debug: 'debug-assist.mjs',
  smart_cross_file_edit: 'cross-file-edit.mjs',
  smart_import_graph: 'import-graph.mjs',
  smart_naming: 'naming-convention.mjs',
  smart_rename_safety: 'rename-safety.mjs',
  smart_exa_search: 'exa-search.mjs',
  smart_report: 'report.mjs',
  smart_planner: 'planner.mjs',

  // Git workflow tools
  smart_git_context: 'git-context.mjs',
  smart_git_commit: 'git-commit.mjs',
  smart_git_pr: 'git-pr.mjs',
  smart_git_review: 'git-review.mjs',

  // Additional standard tools (for custom workflows)
  smart_coverage: 'coverage-check.mjs',
  smart_diagram: 'diagram.mjs',
  smart_github_search: 'github-search.mjs',
  smart_test_suggest: 'test-suggest.mjs',
  smart_integrate: 'tool-integrate.mjs',
  smart_tool_stats: 'tool-stats.mjs',
  smart_toonify: 'toonify.mjs',
  smart_py_helper: 'py-helper.mjs',
  smart_ts_helper: 'ts-helper.mjs',
  smart_rs_helper: 'rs-helper.mjs',

  // Compose (Phase 6)
  smart_compose: 'compose.mjs',

  // Handler-based tools (new CLI wrappers for dispatch support, v4.0)
  smart_code_ast: 'code-ast.mjs',
  smart_code_call_graph: 'code-call-graph.mjs',
  smart_impact_flow: 'impact-flow.mjs',
};

const CLI_DIR = resolve(dirname(process.argv[1] || '.'));

/** Resolve tool name to CLI path. Throws if unmappable. */
function resolveToolCli(toolName) {
  const cliFile = TOOL_CLI_MAP[toolName];
  if (!cliFile) throw new Error(`No CLI mapping for tool: ${toolName} (cannot dispatch — may be handler-only)`);
  return resolve(CLI_DIR, cliFile);
}

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
  node workflow.mjs dispatch --state <path> [--step <N>] [--timeout <ms>] [--json]
  node workflow.mjs summary --state <path> [--json]
  node workflow.mjs list-templates

Options:
  --template <name>   Workflow template (debug-flow, refactor-flow, refactor-safe-flow, security-flow, research-flow, default-flow, git-flow, api-explore-flow, migration-flow, code-review-flow, perf-diagnose-flow, onboard-flow)
  --state <path>      Path to workflow state file (default: .workflows/<uuid>.json)
  --context <text>    Extra context (project info, constraints) for plan generation
  --step <N>          Run a specific step (for dispatch/report)
  --timeout <ms>      Per-tool timeout in ms (dispatch only, default: 30000)
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
// Tool execution (for dispatch command)
// ---------------------------------------------------------------------------

const DEFAULT_DISPATCH_TIMEOUT = 30000; // 30s per tool

/**
 * Convert step args object to CLI flags array.
 * Uses per-tool mapArgs for tools with custom positional args,
 * falls back to defaultMapArgs (--key value) for simple tools.
 *
 * The per-tool converters mirror the plugin definitions in src/plugins/.
 */
const TOOL_ARGS_CONVERTERS = {
  // grep: positional pattern
  smart_grep: (a) => { const c = []; if (a.pattern) c.push(String(a.pattern)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.context) c.push('--context', String(a.context)); if (a.withScope) c.push('--with-scope'); if (a.withImports) c.push('--with-imports'); if (a.ignoreCase) c.push('--ignore-case'); if (a.filesOnly) c.push('--files-only'); if (a.maxMatches) c.push('--max-matches', String(a.maxMatches)); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // error_diagnose: positional error
  smart_error_diagnose: (a) => { const c = []; if (a.error) c.push(String(a.error)); if (a.file) c.push('--file', String(a.file)); if (a.noMemory) c.push('--no-memory'); if (a.store) c.push('--store'); if (a.memoryResolution) c.push('--memory-resolution', String(a.memoryResolution)); if (a.memoryTools) c.push('--memory-tools', String(a.memoryTools)); if (a.memoryThreshold != null) c.push('--memory-threshold', String(a.memoryThreshold)); if (a.format) c.push('--format', String(a.format)); return c; },

  // memory_store: positional command + query
  smart_memory_store: (a) => { const c = []; if (a.command) c.push(String(a.command)); if (a.query) c.push(String(a.query)); if (a.id) c.push(String(a.id)); if (a.resolution) c.push('--resolution', String(a.resolution)); if (a.tools) c.push('--tools', String(a.tools)); if (a.files) c.push('--files', String(a.files)); if (a.category) c.push('--category', String(a.category)); if (a.success !== undefined) c.push('--success', String(a.success)); if (a.limit) c.push('--limit', String(a.limit)); if (a.threshold) c.push('--threshold', String(a.threshold)); if (a.format) c.push('--format', String(a.format)); return c; },

  // exa_search: positional command + query
  smart_exa_search: (a) => { const c = []; if (a.command) c.push(String(a.command)); if (a.command === 'crawl') { if (a.urls) { const urls = String(a.urls).split(',').map(u => u.trim()).filter(Boolean); c.push(...urls); } } else if (a.query) c.push(String(a.query)); if (a.numResults) c.push('--num-results', String(a.numResults)); if (a.maxChars) c.push('--max-chars', String(a.maxChars)); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // thinking: positional topic
  smart_thinking: (a) => { const c = []; if (a.topic) c.push(String(a.topic)); if (a.template) c.push('--template', String(a.template)); if (a.steps) c.push('--steps', String(a.steps)); if (a.format) c.push('--format', String(a.format)); if (a.plan) c.push('--plan', String(a.plan)); if (a.planStep) c.push('--plan-step', String(a.planStep)); if (a.state) c.push('--state', String(a.state)); if (a.record) c.push('--record', String(a.record)); if (a.branch) c.push('--branch', String(a.branch)); if (a.restore) c.push('--restore', String(a.restore)); if (a.iterative) c.push('--iterative'); if (a.dynamic) c.push('--dynamic'); if (a.advance) c.push('--advance'); if (a.finish) c.push('--finish'); if (a.status) c.push('--status'); if (a.cancel) c.push('--cancel'); c.push('--no-color'); return c; },

  // report: positional type
  smart_report: (a) => { const c = []; if (a.type) c.push(String(a.type)); if (a.title) c.push('--title', String(a.title)); if (a.input) c.push('--input', String(a.input)); if (a.output) c.push('--output', String(a.output)); if (a.theme) c.push('--theme', String(a.theme)); if (a.root) c.push('--root', String(a.root)); c.push('--no-color'); return c; },

  // planner: positional goal for plan/execute
  smart_planner: (a) => { const c = []; if (a.command === 'list-tasks') { c.push('list-tasks'); return c; } if (a.command === 'analyze') { c.push('analyze'); if (a.tools) c.push(String(a.tools)); if (a.format) c.push('--format', String(a.format)); return c; } if (a.command) c.push(String(a.command)); if (a.goal) c.push(String(a.goal)); if (a.context) c.push('--context', String(a.context)); if (a.steps) c.push('--steps', String(a.steps)); if (a.strict) c.push('--strict'); if (a.state) c.push('--state', String(a.state)); if (a.step !== undefined) c.push('--step', String(a.step)); if (a.stepStatus) c.push('--status', String(a.stepStatus)); if (a.result) c.push('--result', String(a.result)); if (a.error) c.push('--error', String(a.error)); if (a.duration) c.push('--duration', String(a.duration)); if (a.format) c.push('--format', String(a.format)); return c; },

  // cross_file_edit: positional file, pattern, replacement
  smart_cross_file_edit: (a) => { const c = []; if (a.file) c.push(String(a.file)); if (a.pattern) c.push(String(a.pattern)); if (a.replacement) c.push(String(a.replacement)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.signature) c.push('--signature', String(a.signature)); if (a.dryRun) c.push('--dry-run'); if (a.apply) c.push('--apply'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // rename_safety: positional name, newName
  smart_rename_safety: (a) => { const c = []; if (a.name) c.push(String(a.name)); if (a.newName) c.push(String(a.newName)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.dryRun) c.push('--dry-run'); if (a.apply) c.push('--apply'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // git_commit
  smart_git_commit: (a) => { const c = []; if (a.root) c.push('--root', String(a.root)); if (a.message) c.push('--message', String(a.message)); if (a.type) c.push('--type', String(a.type)); if (a.scope !== undefined) c.push('--scope', String(a.scope)); if (a.all) c.push('--all'); if (a.amend) c.push('--amend'); if (a.dryRun) c.push('--dry-run'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // git_pr
  smart_git_pr: (a) => { const c = []; if (a.root) c.push('--root', String(a.root)); if (a.base) c.push('--base', String(a.base)); if (a.head) c.push('--head', String(a.head)); if (a.title) c.push('--title', String(a.title)); if (a.body) c.push('--body', String(a.body)); if (a.draft) c.push('--draft'); if (a.noPublish) c.push('--no-publish'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },

  // git_review
  smart_git_review: (a) => { const c = []; if (a.root) c.push('--root', String(a.root)); if (a.commit) c.push('--commit', String(a.commit)); if (a.range) c.push('--range', String(a.range)); if (a.pr) c.push('--pr', String(a.pr)); if (a.staged) c.push('--staged'); if (a.all) c.push('--all'); if (a.focus) c.push('--focus', String(a.focus)); if (a.format) c.push('--format', String(a.format)); if (a.output) c.push('--output', String(a.output)); if (a.maxComments) c.push('--max-comments', String(a.maxComments)); c.push('--no-color'); return c; },
};

/**
 * Convert step args to CLI flags using per-tool converter or default.
 */
function argsToCLI(toolName, args) {
  const converter = TOOL_ARGS_CONVERTERS[toolName];
  if (converter) return converter(args);

  // Default: convert all args to --key value
  const cli = [];
  for (const [k, v] of Object.entries(args || {})) {
    if (k === '_timeout' || k === '_context') continue;
    if (typeof v === 'boolean') { if (v) cli.push(`--${k}`); }
    else if (v != null) cli.push(`--${k}`, String(v));
  }
  return cli;
}

/**
 * Execute a single workflow step by spawning its CLI tool.
 * @param {object} step - step definition { tool, args, ... }
 * @param {number} timeoutMs - per-tool timeout
 * @returns {{ ok: boolean, output: string, error: string|null, duration: number }}
 */
function executeTool(step, timeoutMs = DEFAULT_DISPATCH_TIMEOUT) {
  const startMs = Date.now();
  const cliPath = resolveToolCli(step.tool);
  const cliArgs = argsToCLI(step.tool, step.args);

  try {
    const result = spawnSync('node', [cliPath, ...cliArgs], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
    });
    const duration = Date.now() - startMs;

    if (result.error) {
      let errMsg;
      if (result.error.code === 'ETIMEDOUT') errMsg = `Timed out after ${timeoutMs}ms`;
      else errMsg = `Spawn failed: ${result.error.message}`;
      return { ok: false, output: '', error: errMsg, duration };
    }

    if (result.status !== 0 && result.status !== null) {
      const stderr = (result.stderr || '').trim();
      const errMsg = stderr || `Exit code ${result.status}`;
      return { ok: false, output: result.stdout || '', error: errMsg, duration };
    }

    return { ok: true, output: result.stdout || '', error: null, duration };
  } catch (err) {
    return { ok: false, output: '', error: err.message, duration: Date.now() - startMs };
  }
}

/**
 * Auto-report step result into workflow state.
 * Direct state manipulation (no intermediate stdout from cmdReport).
 */
function autoReport(statePath, stepNum, execResult) {
  const state = loadState(statePath);
  const step = state.steps[stepNum];
  if (!step) return;

  const status = execResult.ok ? 'ok' : 'fail';
  step.status = status;
  step.completedAt = nowISO();
  step.duration = execResult.duration;
  if (execResult.error) step.error = execResult.error;
  if (execResult.output) {
    const preview = execResult.output.length > 500
      ? execResult.output.slice(0, 500) + '... [truncated]'
      : execResult.output;
    step.result = JSON.stringify({ output: preview });
  }

  // Track completed/failed — same logic as cmdReport
  if (status === 'ok') {
    state.completedSteps.push(stepNum);
  } else {
    if (step.onFailure === 'abort') {
      state.failedSteps.push(stepNum);
      state.status = 'failed';
    } else if (step.onFailure === 'skip') {
      step.status = 'skip';
      state.skippedSteps.push(stepNum);
    } else {
      state.failedSteps.push(stepNum);
    }
  }

  // Update tool stats
  const toolName = step.tool;
  if (!state.toolStats[toolName]) state.toolStats[toolName] = { calls: 0, ok: 0, fail: 0, totalDuration: 0 };
  state.toolStats[toolName].calls++;
  if (status === 'ok') state.toolStats[toolName].ok++;
  else if (status === 'fail') state.toolStats[toolName].fail++;
  if (execResult.duration) state.toolStats[toolName].totalDuration += execResult.duration;

  // Advance step group
  const currentGroup = state.parallel[state.currentStepGroup];
  if (currentGroup) {
    const allDone = currentGroup.every(sn => state.steps[sn] && state.steps[sn].status !== 'pending');
    if (allDone) state.currentStepGroup++;
  }

  // Check if all done
  const totalSteps = state.steps.length;
  const doneSteps = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
  if (doneSteps >= totalSteps) state.status = 'completed';

  state.updatedAt = nowISO();
  saveState(statePath, state);
}

// ---------------------------------------------------------------------------
// Command: dispatch
// ---------------------------------------------------------------------------

/**
 * Execute workflow steps by spawning their CLI tools directly.
 * Sequential mode only for Phase 5.1 — parallel mode added in Phase 6.
 *
 * Usage:
 *   node workflow.mjs dispatch --state <path>          # run current group
 *   node workflow.mjs dispatch --state <path> --step N  # run specific step
 *
 * Options:
 *   --state <path>   Workflow state file (required)
 *   --step <N>       Run a specific step instead of the current group
 *   --timeout <ms>   Per-tool timeout (default: 30000)
 *   --json           Output in JSON format
 */
function cmdDispatch(opts) {
  const statePath = opts.state;
  if (!statePath) { console.error(`[${TOOL_NAME}] --state required for dispatch`); exit(1); }
  const state = loadState(statePath);

  if (state.status === 'completed') {
    console.error(`[${TOOL_NAME}] Workflow already completed`);
    exit(1);
  }
  if (state.status === 'failed') {
    console.error(`[${TOOL_NAME}] Workflow is in failed state. Use replan first.`);
    exit(1);
  }

  const timeout = opts.timeout || DEFAULT_DISPATCH_TIMEOUT;
  const stepTargets = [];

  if (opts.step !== undefined && opts.step !== null) {
    // Run a specific step
    const step = state.steps[opts.step];
    if (!step) { console.error(`[${TOOL_NAME}] Step ${opts.step} not found`); exit(1); }
    if (step.status !== 'pending') {
      console.error(`[${TOOL_NAME}] Step ${opts.step} is not pending (status: ${step.status})`);
      exit(1);
    }
    stepTargets.push(step);
  } else {
    // Run current step group (from parallel hints)
    const group = state.parallel[state.currentStepGroup];
    if (!group || group.length === 0) {
      console.error(`[${TOOL_NAME}] No pending step group. Workflow may be complete.`);
      exit(1);
    }
    for (const sn of group) {
      const s = state.steps[sn];
      if (s && s.status === 'pending') stepTargets.push(s);
    }
    if (stepTargets.length === 0) {
      console.error(`[${TOOL_NAME}] All steps in current group [${group}] already done`);
      exit(1);
    }
  }

  // Sequential execution (default for Phase 5.1)
  const results = [];
  for (const step of stepTargets) {
    console.error(`[${TOOL_NAME}] Dispatching step ${step.step}: ${step.tool}...`);
    const execResult = executeTool(step, timeout);
    autoReport(statePath, step.step, execResult);
    results.push({ step: step.step, tool: step.tool, ...execResult });
    console.error(`[${TOOL_NAME}] Step ${step.step} → ${execResult.ok ? 'ok' : 'fail'} (${execResult.duration}ms)`);
  }

  // Reload state for final output
  const finalState = loadState(statePath);

  if (opts.json) {
    console.log(JSON.stringify({
      workflowId: finalState.workflowId,
      status: finalState.status,
      currentStepGroup: finalState.currentStepGroup,
      completedSteps: finalState.completedSteps,
      failedSteps: finalState.failedSteps,
      skippedSteps: finalState.skippedSteps,
      results: results.map(r => ({
        step: r.step, tool: r.tool, ok: r.ok, duration: r.duration,
        error: r.error || undefined,
      })),
    }, null, 2));
  } else {
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(`[${TOOL_NAME}] Dispatch complete: ${ok} ok, ${fail} fail`);
    console.log(`  Status:         ${finalState.status}`);
    console.log(`  Completed:      ${finalState.completedSteps.length}/${finalState.steps.length}`);
    if (finalState.status !== 'completed') {
      const nextGroup = finalState.parallel[finalState.currentStepGroup];
      if (nextGroup) {
        console.log(`  Next group:     [${nextGroup.join(', ')}]`);
      }
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
    else if (a === '--timeout') opts.timeout = parseInt(args[++i], 10);
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
    case 'dispatch':
      cmdDispatch(opts);
      break;
    default:
      console.error(`[${TOOL_NAME}] Unknown command: ${command}. Use --help for usage.`);
      exit(1);
  }
}

main();
