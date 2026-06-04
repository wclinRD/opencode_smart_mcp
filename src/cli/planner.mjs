#!/usr/bin/env node

// planner.mjs — Lightweight plan generator for smart tools
//
// Takes a goal description, decomposes it into steps,
// maps each step to the optimal smart tool, and outputs
// an executable plan with dependency tracking.
//
// Features:
//   - Template-based plan generation (9 task templates)
//   - Generic keyword-based fallback
//   - Condition branches: steps can define conditional continuation paths
//   - Tool sequence analysis
//
// Condition Branching:
//   Steps can define `conditions` and `branches` for dynamic execution paths.
//   A condition is a boolean expression checked after a step completes.
//   Based on the outcome, different continuation steps are taken.
//   Example:
//     Step 1: grep for error patterns → condition: found errors?
//       true branch → diagnose errors
//       false branch → search for TODOs instead
//
// Usage:
//   node planner.mjs <goal-description> [options]
//   node planner.mjs analyze <tool-sequence>
//   node planner.mjs list-tasks
//
// Options:
//   --format <fmt>    Output: text, json (default: json)
//   --context <text>  Additional context (project type, constraints)
//   --steps <N>       Max steps in plan (default: 10)
//   --strict          Only use tools that exist (default: false)
//   -h, --help        Show help

import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Available tools registry
// ---------------------------------------------------------------------------

const AVAILABLE_TOOLS = {
  // Code analysis
  smart_grep:              { task: 'search',    description: 'Semantic code search with scope context' },
  smart_learn:             { task: 'analysis',  description: 'Project structure & convention analysis' },
  smart_import_graph:      { task: 'analysis',  description: 'Cross-file dependency analysis' },
  smart_naming:            { task: 'analysis',  description: 'Naming convention analysis' },

  // Debug & errors
  smart_debug:             { task: 'debug',     description: 'Error message analysis & classification' },
  smart_error_diagnose:    { task: 'debug',     description: 'Error diagnosis against KB + memory store' },
  smart_memory_store:      { task: 'memory',    description: 'Store/search past error resolutions' },

  // Testing
  smart_test:              { task: 'test',      description: 'Auto-discover & run tests' },
  smart_test_suggest:      { task: 'test',      description: 'Suggest test cases from code' },
  smart_coverage:          { task: 'test',      description: 'Analyze untested branches' },

  // Refactoring
  smart_cross_file_edit:   { task: 'refactor',  description: 'Safe cross-file edits via import graph' },
  smart_rename_safety:     { task: 'refactor',  description: 'Detect rename conflicts & shadowing' },

  // Security
  smart_security:          { task: 'security',  description: 'Scan for credentials, injection, vulns' },

  // Git
  smart_git_context:       { task: 'git',       description: 'Git diff/commit/impact analysis' },

  // Visualization
  smart_diagram:           { task: 'docs',      description: 'Generate Mermaid diagrams' },
  smart_report:            { task: 'docs',      description: 'Generate HTML reports' },

  // Language helpers
  smart_py_helper:         { task: 'lang',      description: 'Python project analysis' },
  smart_ts_helper:         { task: 'lang',      description: 'TypeScript project analysis' },

  // Meta
  smart_tool_stats:        { task: 'meta',      description: 'Tool usage statistics & patterns' },
  smart_thinking:          { task: 'meta',      description: 'Structured reasoning templates' },
  smart_integrate:         { task: 'meta',      description: 'Multi-tool orchestration' },
};

// ---------------------------------------------------------------------------
// Task templates — goal pattern → plan decomposition
// ---------------------------------------------------------------------------

const TASK_TEMPLATES = [
  {
    name: 'debug-error',
    patterns: [/debug/i, /error/i, /bug/i, /fix/i, /crash/i, /exception/i, /fail/i, /broken/i],
    description: 'Debug an error: find root cause and fix',
    steps: [
      { tool: 'smart_memory_store',   args: { command: 'search', query: '$goal' }, description: 'Search memory for similar past errors', dependsOn: [], onFailure: 'skip' },
      {
        tool: 'smart_grep',
        args: { pattern: 'error|Error|ERROR|exception|throw' },
        description: 'Search code for error-related patterns',
        dependsOn: [],
        onFailure: 'abort',
        // Condition branch: if grep finds matches → diagnose; else → search for TODOs/FIXMEs
        conditions: [{ id: 'foundErrors', expression: 'step_1.count > 0', description: 'Error patterns found in code?' }],
        branches: {
          true: [
            { tool: 'smart_error_diagnose', args: { error: '$goal', useMemory: true }, description: 'Diagnose error against KB + memory', dependsOn: [0, 1], onFailure: 'skip' },
            { tool: 'smart_debug',          args: { error: '$goal' }, description: 'Deep debug analysis', dependsOn: [0, 1], onFailure: 'skip' },
          ],
          false: [
            { tool: 'smart_grep',           args: { pattern: 'TODO|FIXME|HACK|XXX' }, description: 'Search for unfinished code instead', dependsOn: [], onFailure: 'skip' },
          ],
        },
      },
      { tool: 'smart_test',           args: {}, description: 'Run tests to verify', dependsOn: [], onFailure: 'warn' },
    ],
  },
  {
    name: 'search-code',
    patterns: [/search/i, /find/i, /where/i, /locate/i, /grep/i, /look/i, /show me/i, /find all/i],
    description: 'Search codebase for patterns or definitions',
    steps: [
      { tool: 'smart_grep',           args: { pattern: '$goal' }, description: 'Semantic code search', dependsOn: [], onFailure: 'abort' },
    ],
  },
  {
    name: 'refactor-rename',
    patterns: [/rename/i, /refactor/i, /extract/i, /move/i, /restructure/i, /change.*name/i],
    description: 'Safely rename or refactor code across files',
    steps: [
      { tool: 'smart_import_graph',   args: { focus: '$contextFile', depth: 2 }, description: 'Analyze import dependencies', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_naming',         args: {}, description: 'Check naming conventions', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_rename_safety',  args: { name: '$symbol', newName: '$newSymbol' }, description: 'Check rename safety', dependsOn: [0], onFailure: 'abort' },
      { tool: 'smart_test',           args: {}, description: 'Run tests to verify refactor', dependsOn: [], onFailure: 'warn' },
    ],
  },
  {
    name: 'run-tests',
    patterns: [/test/i, /spec/i, /verify/i, /check/, /validate/i, /ci/i],
    description: 'Discover and run project tests',
    steps: [
      { tool: 'smart_test',           args: {}, description: 'Run all tests', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_coverage',       args: {}, description: 'Analyze test coverage', dependsOn: [0], onFailure: 'skip' },
    ],
  },
  {
    name: 'security-audit',
    patterns: [/security/i, /audit/i, /vuln/i, /scan/i, /cve/i, /leak/i, /credential/i],
    description: 'Audit codebase for security issues',
    steps: [
      { tool: 'smart_security',       args: { scan: 'credentials' }, description: 'Scan for credential leaks', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_security',       args: { scan: 'injection' }, description: 'Scan for injection flaws', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_security',       args: { scan: 'dependencies' }, description: 'Check dependency vulnerabilities', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_report',         args: { type: 'security', title: 'Security Audit' }, description: 'Generate security report', dependsOn: [0, 1, 2], onFailure: 'skip' },
    ],
  },
  {
    name: 'analyze-project',
    patterns: [/understand/i, /learn/i, /analyze/i, /explore/i, /overview/i, /structure/i, /architecture/i],
    description: 'Learn about a project structure and conventions',
    steps: [
      { tool: 'smart_learn',          args: { command: 'extract' }, description: 'Extract project conventions', dependsOn: [], onFailure: 'abort' },
      { tool: 'smart_import_graph',   args: { depth: 1 }, description: 'Analyze top-level imports', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_naming',         args: {}, description: 'Analyze naming conventions', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_diagram',        args: { type: 'flowchart', title: 'Project Architecture', fromImportGraph: true }, description: 'Generate architecture diagram', dependsOn: [1], onFailure: 'skip' },
    ],
  },
  {
    name: 'git-review',
    patterns: [/git/i, /commit/i, /pr/i, /diff/i, /changes/i, /review/i, /pull request/i],
    description: 'Review git changes before commit',
    steps: [
      { tool: 'smart_git_context',    args: { all: true, impact: true }, description: 'Analyze all changes with impact', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_security',       args: { scan: 'credentials' }, description: 'Check for committed secrets', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_test',           args: {}, description: 'Run tests on changed code', dependsOn: [], onFailure: 'warn' },
    ],
  },
  {
    name: 'document',
    patterns: [/document/i, /diagram/i, /report/i, /chart/i, /visual/i, /graph/i, /export/i],
    description: 'Generate documentation, diagrams, or reports',
    steps: [
      { tool: 'smart_import_graph',   args: { depth: 2, format: 'json' }, description: 'Get dependency data', dependsOn: [], onFailure: 'warn' },
      { tool: 'smart_diagram',        args: { type: 'flowchart', title: '$goal', fromImportGraph: true }, description: 'Generate architecture diagram', dependsOn: [0], onFailure: 'skip' },
      { tool: 'smart_report',         args: { type: 'custom', title: '$goal' }, description: 'Generate report', dependsOn: [], onFailure: 'skip' },
    ],
  },
  {
    name: 'tool-insights',
    patterns: [/stats/i, /usage/i, /pattern/i, /insight/i, /trend/i, /recommend/i, /analytics/i],
    description: 'Analyze smart usage patterns and get recommendations',
    steps: [
      { tool: 'smart_tool_stats',     args: { command: 'patterns' }, description: 'Analyze tool usage patterns', dependsOn: [], onFailure: 'skip' },
      { tool: 'smart_tool_stats',     args: { command: 'recommendations' }, description: 'Get recommendations', dependsOn: [], onFailure: 'skip' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

/**
 * Match goal against task templates.
 */
function matchTemplate(goal) {
  const goalLower = goal.toLowerCase();
  for (const tmpl of TASK_TEMPLATES) {
    for (const re of tmpl.patterns) {
      if (re.test(goalLower)) {
        return tmpl;
      }
    }
  }
  return null;
}

/**
 * Substitute $variables in args with actual values.
 */
function substituteArgs(args, variables) {
  const result = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      let resolved = value;
      // Replace $goal with the goal text
      if (resolved.includes('$goal') && variables.goal) {
        // For search queries, use the goal directly; for others, derive a short description
        resolved = resolved.replace(/\$goal/g, variables.goal);
      }
      if (resolved.includes('$contextFile') && variables.contextFile) {
        resolved = resolved.replace(/\$contextFile/g, variables.contextFile);
      }
      if (resolved.includes('$symbol') && variables.symbol) {
        resolved = resolved.replace(/\$symbol/g, variables.symbol);
      }
      if (resolved.includes('$newSymbol') && variables.newSymbol) {
        resolved = resolved.replace(/\$newSymbol/g, variables.newSymbol);
      }
      result[key] = resolved;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Check if a tool name is available in our registry.
 */
function isToolAvailable(toolName) {
  return toolName in AVAILABLE_TOOLS;
}

/**
 * Generate a plan from a goal.
 */
function generatePlan(goal, options = {}) {
  const { context, steps: maxSteps, strict } = options;
  const maxStepsLimit = maxSteps || 10;

  // Extract variables from context
  const variables = { goal };
  if (context) {
    // Try to extract common patterns from context
    const ctxLower = context.toLowerCase();
    const fileMatch = context.match(/file[=:]?\s*["']?([^"'\s,]+)/i);
    if (fileMatch) variables.contextFile = fileMatch[1];
    const symbolMatch = context.match(/symbol[=:]?\s*["']?(\w+)/i);
    if (symbolMatch) variables.symbol = symbolMatch[1];
    const newSymbolMatch = context.match(/newName[=:]?\s*["']?(\w+)/i);
    if (newSymbolMatch) variables.newSymbol = newSymbolMatch[1];
  }

  // Try to match a template
  const template = matchTemplate(goal);

  if (template) {
    // Build plan from template — includes condition branch support
    //
    // Branch strategy: process template steps linearly. When a step with
    // conditions+branches is encountered, insert the true-branch steps
    // immediately after it (as default path). Subsequent template steps
    // continue after the branch. The false-branch steps are stored as
    // metadata-only alternatives.
    const planSteps = [];
    const allBranchSteps = { true: [], false: [] }; // collected from all branches
    const conditionMetadata = [];
    const warnings = [];

    for (let i = 0; i < template.steps.length; i++) {
      const s = template.steps[i];
      if (planSteps.length >= maxStepsLimit) break;

      // Handle condition + branch steps
      if (s.conditions && s.branches) {
        if (strict && !isToolAvailable(s.tool)) {
          warnings.push(`Tool ${s.tool} not available. Branch step "${s.description}" will be skipped.`);
          // If the check tool isn't available, we can't evaluate the condition.
          // Insert true branch as fallback (conservative: assume condition is true).
          const trueBranch = s.branches.true || [];
          for (let tb = 0; tb < trueBranch.length && planSteps.length < maxStepsLimit; tb++) {
            const ba = trueBranch[tb];
            const baDeps = (ba.dependsOn || [])
              .filter(depIdx => depIdx < i)
              .map(depIdx => {
                const newIdx = planSteps.findIndex(ps => ps.originalStep === depIdx);
                return newIdx >= 0 ? newIdx : null;
              })
              .filter(idx => idx !== null);
            planSteps.push({
              step: planSteps.length + 1,
              tool: ba.tool,
              args: substituteArgs(ba.args, variables || {}),
              description: ba.description,
              dependsOn: baDeps,
              onFailure: ba.onFailure || 'warn',
            });
          }
          continue;
        }

        // Resolve deps for the decision step itself
        const resolvedDeps = s.dependsOn
          .filter(depIdx => depIdx < i)
          .map(depIdx => {
            const newIdx = planSteps.findIndex(ps => ps.originalStep === depIdx);
            return newIdx >= 0 ? newIdx : null;
          })
          .filter(idx => idx !== null);

        const branchStepIdx = planSteps.length;
        planSteps.push({
          id: i,
          step: branchStepIdx + 1,
          tool: s.tool,
          args: substituteArgs(s.args, variables),
          description: s.description,
          dependsOn: resolvedDeps,
          onFailure: s.onFailure || 'abort',
          conditions: s.conditions.map(c => ({ ...c, stepRef: branchStepIdx })),
          branchOn: s.conditions[0]?.id || null,
          originalStep: i,
        });

        // Collect all branch steps
        for (const [outcome, branchActions] of Object.entries(s.branches)) {
          for (let b = 0; b < branchActions.length; b++) {
            const ba = branchActions[b];
            const baDeps = (ba.dependsOn || [])
              .map(depIdx => {
                if (depIdx === i) return branchStepIdx; // reference to the decision step
                const newIdx = planSteps.findIndex(ps => ps.originalStep === depIdx);
                return newIdx >= 0 ? newIdx : null;
              })
              .filter(idx => idx !== null);

            allBranchSteps[outcome].push({
              id: `${i}.${outcome}.${b}`,
              tool: ba.tool,
              args: substituteArgs(ba.args, variables),
              description: ba.description,
              dependsOn: baDeps,
              onFailure: ba.onFailure || 'warn',
              originalStep: i,
              branchOutcome: outcome,
              branchParent: branchStepIdx,
            });
          }
        }

        // Insert true-branch steps immediately after the decision step
        for (const bs of allBranchSteps.true) {
          if (planSteps.length >= maxStepsLimit) break;
          const { branchOutcome, branchParent, originalStep, ...cleanBs } = bs;
          planSteps.push({
            ...cleanBs,
            step: planSteps.length + 1,
          });
        }

        conditionMetadata.push({
          stepRef: branchStepIdx,
          stepDescription: s.description,
          conditions: s.conditions,
          branchCount: { true: allBranchSteps.true.length, false: allBranchSteps.false.length },
        });
        continue;
      }

      // Regular step (no branch)
      if (strict && !isToolAvailable(s.tool)) {
        warnings.push(`Tool ${s.tool} not available. Step "${s.description}" will be skipped.`);
        continue;
      }

      // Resolve dependencies
      const resolvedDeps = s.dependsOn
        .filter(depIdx => depIdx < i)
        .map(depIdx => {
          const originalStep = template.steps[depIdx];
          const newIdx = planSteps.findIndex(ps => ps.originalStep === depIdx);
          return newIdx >= 0 ? newIdx : null;
        })
        .filter(idx => idx !== null);

      planSteps.push({
        id: i,
        step: planSteps.length + 1,
        tool: s.tool,
        args: substituteArgs(s.args, variables),
        description: s.description,
        dependsOn: resolvedDeps,
        onFailure: s.onFailure || 'abort',
        originalStep: i,
      });
    }

    // Clean internal tracking fields
    const cleanSteps = planSteps.map(({ originalStep, branchOutcome, branchParent, ...rest }) => rest);

    return {
      type: 'plan',
      goal,
      matchedTemplate: template.name,
      templateDescription: template.description,
      totalSteps: cleanSteps.length,
      steps: cleanSteps,
      conditions: conditionMetadata.length > 0 ? conditionMetadata : undefined,
      branches: (allBranchSteps.true.length > 0 || allBranchSteps.false.length > 0) ? {
        true: allBranchSteps.true.map(({ branchOutcome, branchParent, originalStep, ...rest }) => rest),
        false: allBranchSteps.false.map(({ branchOutcome, branchParent, originalStep, ...rest }) => rest),
      } : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      summary: `Matched "${template.name}" template. ${cleanSteps.length} steps planned (${conditionMetadata.length} condition branch(es)).`,
    };
  }

  // No template matched — generate generic plan from keywords
  const genericSteps = [];
  const goalWords = goal.toLowerCase().split(/\s+/);

  // Detect relevant tools based on keywords
  const keywordActions = [
    { words: ['search', 'find', 'grep', 'where', 'locate', 'show'], tool: 'smart_grep', args: { pattern: goal }, desc: 'Search codebase' },
    { words: ['test', 'verify', 'check'], tool: 'smart_test', args: {}, desc: 'Run tests' },
    { words: ['error', 'bug', 'fix', 'crash', 'fail'], tool: 'smart_error_diagnose', args: { error: goal }, desc: 'Diagnose error' },
    { words: ['learn', 'understand', 'structure', 'overview'], tool: 'smart_learn', args: { command: 'extract' }, desc: 'Analyze project' },
    { words: ['security', 'audit', 'vuln'], tool: 'smart_security', args: {}, desc: 'Security scan' },
    { words: ['diagram', 'chart', 'visual'], tool: 'smart_diagram', args: { type: 'flowchart', title: goal }, desc: 'Generate diagram' },
    { words: ['stats', 'usage', 'pattern', 'insight'], tool: 'smart_tool_stats', args: { command: 'patterns' }, desc: 'Tool usage analysis' },
    { words: ['refactor', 'rename', 'restructure'], tool: 'smart_import_graph', args: {}, desc: 'Dependency analysis' },
    { words: ['commit', 'git', 'review', 'pr', 'diff'], tool: 'smart_git_context', args: {}, desc: 'Git context analysis' },
  ];

  for (const action of keywordActions) {
    if (genericSteps.length >= maxStepsLimit) break;
    const matches = action.words.some(w => goalWords.includes(w));
    if (matches) {
      if (strict && !isToolAvailable(action.tool)) continue;
      genericSteps.push({
        step: genericSteps.length + 1,
        tool: action.tool,
        args: action.args,
        description: action.desc,
        dependsOn: [],
        onFailure: 'warn',
      });
    }
  }

  // If no generic steps found, add a fallback
  if (genericSteps.length === 0) {
    // Just use grep as a reasonable default
    genericSteps.push({
      step: 1,
      tool: 'smart_grep',
      args: { pattern: goal },
      description: 'Search codebase for goal-related patterns',
      dependsOn: [],
      onFailure: 'warn',
    });
  }

  return {
    type: 'plan',
    goal,
    matchedTemplate: null,
    templateDescription: 'Generic keyword-based plan (no template matched)',
    totalSteps: genericSteps.length,
    steps: genericSteps,
    summary: `No template matched. Generated ${genericSteps.length} step(s) from keywords.`,
  };
}

/**
 * Compute parallel execution hints from plan steps.
 * Groups steps into batches where all steps in a batch can run in parallel.
 * Returns array of step-number arrays: [[1,2], [3], [4,5]]
 */
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
      if (allDepsResolved) {
        currentGroup.push(stepNum);
      }
    }
    if (currentGroup.length === 0) break;
    currentGroup.sort((a, b) => a - b);
    for (const sn of currentGroup) {
      stepGroups[sn] = group;
      ungrouped.delete(sn);
    }
    group++;
  }

  const result = [];
  for (let g = 0; g < group; g++) {
    const grpSteps = Object.entries(stepGroups)
      .filter(([, grp]) => grp === g)
      .map(([step]) => parseInt(step, 10))
      .sort((a, b) => a - b);
    if (grpSteps.length > 0) result.push(grpSteps);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Workflow templates — composite multi-tool workflows
// ---------------------------------------------------------------------------

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
};

/**
 * Analyze a sequence of tool calls and return insight.
 */
function analyzeToolSequence(tools) {
  const provided = tools.split(',').map(s => s.trim()).filter(Boolean);
  const recognized = [];
  const unknown = [];

  for (const t of provided) {
    const info = AVAILABLE_TOOLS[t];
    if (info) {
      recognized.push({ name: t, task: info.task, description: info.description });
    } else {
      unknown.push(t);
    }
  }

  // Check if this sequence matches a template
  const recognizedNames = new Set(recognized.map(r => r.name));
  let matchingTemplates = [];

  for (const tmpl of TASK_TEMPLATES) {
    const tmplTools = new Set(tmpl.steps.map(s => s.tool));
    const intersection = [...recognizedNames].filter(t => tmplTools.has(t));
    if (intersection.length >= Math.min(tmplTools.size, recognized.length)) {
      matchingTemplates.push(tmpl.name);
    }
  }

  return {
    type: 'analysis',
    recognized,
    unknown,
    matchingTemplates,
    totalRecognized: recognized.length,
    totalUnknown: unknown.length,
    taskBreakdown: [...new Set(recognized.map(r => r.task))],
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatPlan(plan) {
  const lines = [];
  lines.push(`Plan: ${plan.goal}`);
  if (plan.matchedTemplate) {
    lines.push(`   Template: ${plan.matchedTemplate} — ${plan.templateDescription}`);
  } else {
    lines.push(`   ${plan.templateDescription}`);
  }
  lines.push(`   Steps: ${plan.totalSteps}`);
  lines.push('');

  for (const step of plan.steps) {
    const deps = step.dependsOn.length > 0 ? ` (after step ${step.dependsOn.map(d => d + 1).join(', ')})` : '';
    const failIcon = step.onFailure === 'abort' ? '!' : step.onFailure === 'warn' ? '?' : '-';
    lines.push(`  Step ${step.step}: ${step.tool}${deps}`);
    lines.push(`       ${step.description}`);

    // Show condition info if this step has a branch
    if (step.conditions && step.conditions.length > 0) {
      lines.push(`       [branch: ${step.conditions.map(c => c.description || c.expression).join('; ')}]`);
    }
    if (step.branchOutcome) {
      lines.push(`       [branch outcome: ${step.branchOutcome}]`);
    }

    const args = Object.entries(step.args)
      .filter(([k]) => !['format', 'root'].includes(k))
      .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`)
      .join('');
    if (args) lines.push(`       args:${args}`);
    lines.push(`       onFail: ${failIcon} ${step.onFailure}`);
    lines.push('');
  }

  if (plan.conditions) {
    lines.push('Condition Branches:');
    for (const c of plan.conditions) {
      lines.push(`  - Step ${c.stepRef + 1}: "${c.stepDescription}"`);
      for (const cond of c.conditions) {
        lines.push(`    if ${cond.expression}: ${cond.description || ''}`);
      }
      lines.push(`    branches: ${c.branchCount.true} true, ${c.branchCount.false} false`);
    }
    lines.push('');
  }

  if (plan.warnings) {
    lines.push('Warnings:');
    for (const w of plan.warnings) lines.push(`  - ${w}`);
    lines.push('');
  }

  lines.push(`Summary: ${plan.summary}`);
  return lines.join('\n');
}

function formatAnalysis(analysis) {
  const lines = [];
  lines.push(`📊 Tool Sequence Analysis`);
  lines.push(`   Recognized: ${analysis.totalRecognized} tools`);
  if (analysis.totalUnknown > 0) lines.push(`   Unknown: ${analysis.totalUnknown} tools`);
  lines.push('');

  if (analysis.recognized.length > 0) {
    lines.push('  Recognized Tools:');
    for (const r of analysis.recognized) {
      lines.push(`    ✅ ${r.name} (${r.task}) — ${r.description}`);
    }
  }
  if (analysis.unknown.length > 0) {
    lines.push('  Unknown Tools:');
    for (const u of analysis.unknown) lines.push(`    ❓ ${u}`);
  }
  if (analysis.matchingTemplates.length > 0) {
    lines.push('');
    lines.push('  Matching Templates:');
    for (const t of analysis.matchingTemplates) lines.push(`    📋 ${t}`);
  }
  if (analysis.taskBreakdown.length > 0) {
    lines.push('');
    lines.push(`  Task Types: ${analysis.taskBreakdown.join(', ')}`);
  }
  return lines.join('\n');
}

function formatToolList() {
  const lines = [];
  lines.push('Available Tools:');
  lines.push('');
  const byTask = {};
  for (const [name, info] of Object.entries(AVAILABLE_TOOLS)) {
    (byTask[info.task] ??= []).push({ name, desc: info.description });
  }
  for (const [task, tools] of Object.entries(byTask)) {
    lines.push(`  ${task}:`);
    for (const t of tools) {
      lines.push(`    ${t.name.padEnd(30)} ${t.desc}`);
    }
    lines.push('');
  }
  lines.push('Task Templates:');
  for (const tmpl of TASK_TEMPLATES) {
    lines.push(`  📋 ${tmpl.name.padEnd(20)} ${tmpl.description}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plan Execution State — runtime tracking & dynamic replanning
// ---------------------------------------------------------------------------
//
// State file format (~/.smart/plans/<id>.json):
//   {
//     planId, goal, matchedTemplate, createdAt, updatedAt,
//     status: 'in_progress'|'completed'|'failed'|'cancelled',
//     steps: [{ step, tool, args, description, dependsOn, onFailure,
//               status: 'pending'|'completed'|'failed'|'skipped',
//               result, error, duration, completedAt }],
//     completedSteps, failedSteps, skippedSteps,
//     accumulatedContext
//   }
//
// Commands:
//   execute <goal>         Generate plan + start execution session
//   next --state <path>    Get next runnable step
//   report --state <path> --step <N> --status <ok|fail> [--result <json>] [--error <text>]
//                          Report step result, auto-replan on failure
//   replan --state <path>  Force re-plan remaining steps
// ---------------------------------------------------------------------------

import { resolve, dirname } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const PLAN_STATE_DIR = resolve(process.env.HOME || '/tmp', '.smart', 'plans');

function ensurePlanDir() {
  if (!existsSync(PLAN_STATE_DIR)) {
    try { mkdirSync(PLAN_STATE_DIR, { recursive: true }); } catch { /* ignore */ }
  }
  return PLAN_STATE_DIR;
}

function generatePlanId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * Create a plan execution state file from a generated plan.
 */
function createPlanState(goal, plan, statePath) {
  const stepsWithStatus = plan.steps.map(s => ({
    step: s.step,
    tool: s.tool,
    args: s.args || {},
    description: s.description || '',
    dependsOn: s.dependsOn || [],
    onFailure: s.onFailure || 'warn',
    conditions: s.conditions || undefined,
    branchOn: s.branchOn || null,
    // Runtime state
    status: 'pending',
    result: null,
    error: null,
    duration: null,
    completedAt: null,
  }));

  const state = {
    planId: generatePlanId(),
    goal,
    matchedTemplate: plan.matchedTemplate,
    templateDescription: plan.templateDescription,
    totalSteps: plan.totalSteps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'in_progress',
    steps: stepsWithStatus,
    conditions: plan.conditions || [],
    branches: plan.branches || null,
    warnings: plan.warnings || [],
    completedSteps: [],
    failedSteps: [],
    skippedSteps: [],
    accumulatedContext: '',
  };

  writePlanState(statePath, state);
  return state;
}

function readPlanState(statePath) {
  try {
    const raw = readFileSync(statePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Cannot read plan state: ${statePath} — ${e.message}`);
  }
}

function writePlanState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function updatePlanContext(state) {
  const parts = [];
  for (const step of state.steps) {
    if (step.status === 'completed') {
      parts.push(`Step ${step.step} (${step.tool}): completed — ${JSON.stringify(step.result)}`);
    } else if (step.status === 'failed') {
      parts.push(`Step ${step.step} (${step.tool}): FAILED — ${step.error}`);
    } else if (step.status === 'skipped') {
      parts.push(`Step ${step.step} (${step.tool}): skipped`);
    }
  }
  state.accumulatedContext = parts.join('\n');
}

/**
 * Find next runnable step respecting dependency order.
 * Returns the step object or null if none available.
 */
function getNextRunnableStep(state) {
  for (const step of state.steps) {
    if (step.status !== 'pending') continue;

    const deps = step.dependsOn || [];
    if (deps.length === 0) return step;

    const allReady = deps.every(d => {
      const ds = state.steps.find(s => s.step === d);
      return ds && (ds.status === 'completed' || ds.status === 'skipped');
    });

    const depFailed = deps.some(d => {
      const ds = state.steps.find(s => s.step === d);
      return ds && ds.status === 'failed';
    });

    if (allReady && !depFailed) return step;
  }
  return null;
}

/**
 * Check if all steps are done (no pending steps).
 */
function isPlanComplete(state) {
  return state.steps.every(s => s.status !== 'pending');
}

/**
 * Format a single step for display.
 */
function formatStepOutput(step, state) {
  const lines = [];
  const deps = (step.dependsOn || []).length > 0
    ? ` (after step ${step.dependsOn.join(', ')})` : '';
  const failIcon = step.onFailure === 'abort' ? '!' : step.onFailure === 'warn' ? '?' : '-';

  lines.push(`Step ${step.step}/${state.totalSteps}: ${step.tool}${deps}`);
  lines.push(`  ${step.description}`);
  if (step.conditions && step.conditions.length > 0) {
    lines.push(`  [branch: ${step.conditions.map(c => c.description || c.expression).join('; ')}]`);
  }
  const argStr = Object.entries(step.args || {})
    .filter(([k]) => !['format', 'root'].includes(k))
    .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`)
    .join('');
  if (argStr) lines.push(`  args:${argStr}`);
  lines.push(`  onFail: ${failIcon} ${step.onFailure}`);
  return lines.join('\n');
}

/**
 * Format execution summary.
 */
function formatExecutionSummary(state) {
  const lines = [];
  const total = state.steps.length;
  const completed = state.completedSteps.length;
  const failed = state.failedSteps.length;
  const skipped = state.skippedSteps.length;

  lines.push(`Plan: ${state.goal}`);
  if (state.matchedTemplate) lines.push(`  Template: ${state.matchedTemplate}`);
  lines.push(`  Status: ${state.status}`);
  lines.push(`  Progress: ${completed}/${total} steps`);

  if (failed > 0) {
    lines.push('  Failed steps:');
    for (const fn of state.failedSteps) {
      const s = state.steps.find(st => st.step === fn);
      if (s) lines.push(`    ${fn}: ${s.tool} — ${s.error || 'unknown error'}`);
    }
  }
  if (skipped > 0) {
    lines.push(`  Skipped: ${skipped} steps`);
  }

  if (state.accumulatedContext) {
    lines.push('');
    lines.push('Context:');
    lines.push(state.accumulatedContext);
  }

  return lines.join('\n');
}

/**
 * Record step result and determine next action.
 * Returns: { nextStep, done, status, replanned, summary, error }
 */
function recordStepResult(state, statePath, stepNumber, opts) {
  const { status, result, error, duration } = opts;
  const step = state.steps.find(s => s.step === stepNumber);
  if (!step) return { error: `Step ${stepNumber} not found` };

  // Record result
  step.status = status;
  step.result = result || null;
  step.error = error || null;
  step.duration = duration || null;
  step.completedAt = new Date().toISOString();

  if (status === 'completed') state.completedSteps.push(stepNumber);
  else if (status === 'failed') state.failedSteps.push(stepNumber);
  else if (status === 'skipped') state.skippedSteps.push(stepNumber);

  updatePlanContext(state);

  // Check if all done
  if (isPlanComplete(state)) {
    state.status = state.failedSteps.length > 0 ? 'failed' : 'completed';
    writePlanState(statePath, state);
    return { done: true, status: state.status, summary: formatExecutionSummary(state) };
  }

  // Handle failure — onFailure strategies
  if (status === 'failed') {
    switch (step.onFailure) {
      case 'abort':
        state.status = 'failed';
        writePlanState(statePath, state);
        return { done: true, status: 'failed',
          reason: `Step ${stepNumber} failed with onFailure=abort`,
          summary: formatExecutionSummary(state) };
      case 'skip':
        // Mark dependent pending steps as blocked too
        for (const s of state.steps) {
          if (s.status !== 'pending') continue;
          if ((s.dependsOn || []).includes(stepNumber)) {
            s.status = 'skipped';
            s.result = '[Dependency failed]';
            s.completedAt = new Date().toISOString();
            state.skippedSteps.push(s.step);
          }
        }
        updatePlanContext(state);
        break;
      case 'warn':
      default:
        // Continue but warn — try replan
        break;
    }

    // Try replan for non-abort failures
    if (step.onFailure !== 'abort') {
      const replanResult = replanRemainingSteps(state);
      if (replanResult.replanned) {
        writePlanState(statePath, state);
        const next = getNextRunnableStep(state);
        return {
          replanned: true,
          newPlanSteps: replanResult.changes,
          nextStep: next || null,
          summary: formatExecutionSummary(state),
        };
      }
    }
  }

  // Normal: advance to next step
  writePlanState(statePath, state);
  const next = getNextRunnableStep(state);

  if (!next) {
    // All remaining pending steps have unmet dependencies or nothing left
    if (isPlanComplete(state)) {
      state.status = state.failedSteps.length > 0 ? 'failed' : 'completed';
      writePlanState(statePath, state);
      return { done: true, status: state.status, summary: formatExecutionSummary(state) };
    }
    // Steps are blocked
    return { done: true, status: 'blocked', summary: formatExecutionSummary(state) };
  }

  return { nextStep: next.step, summary: formatStepOutput(next, state) };
}

/**
 * Replan remaining steps by generating a fresh plan with failure context.
 * Replaces all pending/failed steps with new plan steps.
 */
function replanRemainingSteps(state, additionalContext) {
  const completedIds = new Set(state.completedSteps);
  const completedSteps = state.steps.filter(s => completedIds.has(s.step));

  // Build enriched context from what's happened so far
  const contextParts = [];
  if (state.accumulatedContext) contextParts.push(state.accumulatedContext);
  if (additionalContext) contextParts.push(additionalContext);
  contextParts.push(`Original goal: ${state.goal}`);

  // Count remaining capacity
  const remainingSlots = Math.max(1, state.totalSteps - completedSteps.length);

  // Generate a fresh plan for the remaining work
  const freshPlan = generatePlan(state.goal, {
    context: contextParts.join('\n'),
    steps: remainingSlots + 2, // allow some flexibility
  });

  if (!freshPlan.steps || freshPlan.steps.length === 0) {
    return { replanned: false, reason: 'Fresh plan generation produced no steps' };
  }

  // Find the first completed step index to know where to splice
  const lastCompleted = completedSteps.length > 0
    ? Math.max(...completedSteps.map(s => s.step))
    : 0;

  // Identify steps to replace: those not completed (pending, failed, skipped)
  const stepsToRemove = state.steps.filter(s => s.status !== 'completed').map(s => s.step);

  // Build new steps from fresh plan, preserving step numbering
  let newStepNum = lastCompleted + 1;
  const newSteps = freshPlan.steps.slice(0, remainingSlots + 2).map((fs, i) => ({
    step: newStepNum + i,
    tool: fs.tool,
    args: fs.args || {},
    description: fs.description || '',
    dependsOn: (fs.dependsOn || []).map(d => d + lastCompleted), // remap
    onFailure: fs.onFailure || 'warn',
    conditions: fs.conditions || undefined,
    branchOn: fs.branchOn || null,
    status: 'pending',
    result: null,
    error: null,
    duration: null,
    completedAt: null,
  }));

  // Filter out removed steps, keep completed, add new steps
  const keptSteps = state.steps.filter(s => s.status === 'completed');
  state.steps = [...keptSteps, ...newSteps];

  // Re-number everything sequentially
  state.steps.forEach((s, i) => { s.step = i + 1; });
  state.totalSteps = state.steps.length;

  // Clear runtime tracking (will re-populate as execution continues)
  state.failedSteps = [];
  state.skippedSteps = [];
  state.status = 'in_progress';
  updatePlanContext(state);

  // Count changes
  const changes = {
    removed: stepsToRemove.length,
    added: newSteps.length,
    totalNow: state.steps.length,
  };

  return {
    replanned: true,
    changes,
    summary: `Replanned: removed ${stepsToRemove.length} stale steps, added ${newSteps.length} fresh steps. Total: ${state.steps.length}.`,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node planner.mjs <goal> [options]
       node planner.mjs analyze <tool1,tool2,...>
       node planner.mjs list-tasks
       node planner.mjs execute <goal> [options]
       node planner.mjs next --state <path>
       node planner.mjs report --state <path> --step <N> --status <ok|fail> [options]
       node planner.mjs replan --state <path> [--context <text>]

Generate execution plans with runtime state tracking & dynamic replanning.

Commands:
  <goal>                  Generate a plan for a goal (default)
  analyze <tools>        Analyze a tool sequence
  list-tasks             List all task templates
  execute <goal>         Generate plan + create execution state file
  next --state <path>    Get next runnable step from execution state
  report ...             Report step result, auto-replan on failure
  replan --state <path>  Force re-plan remaining steps

Plan Generation Options:
  --format <fmt>          Output: text, json (default: text)
  --context <text>        Additional context (e.g., "file=src/index.js")
  --steps <N>             Max steps in plan (default: 10)
  --strict                Only use tools that exist in registry

Execution State Options:
  --state <path>          Plan state file path
  --step <N>              Step number being reported
  --status <ok|fail|skip> Step execution status
  --result <json>         Step result (JSON string)
  --error <text>          Error message if failed
  --duration <ms>         Step execution duration

Examples:
  node planner.mjs "debug the TypeError in login.js"
  node planner.mjs execute "refactor utils module" --context "file=src/utils.js"
  node planner.mjs next --state ~/.smart/plans/abc123.json
  node planner.mjs report --state ~/.smart/plans/abc123.json --step 1 --status ok --result '"Found 3 errors"'
  node planner.mjs report --state ~/.smart/plans/abc123.json --step 2 --status fail --error "Tool timed out"
  node planner.mjs replan --state ~/.smart/plans/abc123.json --context "Try different approach"
`);
}

function parseStatePath(args) {
  const idx = args.indexOf('--state');
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function getArg(args, name, defaultVal) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function main() {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    exit(0);
  }

  const cmd = args[0];

  // ---- list-tasks ----
  if (cmd === 'list-tasks') {
    console.log(formatToolList());
    exit(0);
  }

  // ---- analyze ----
  if (cmd === 'analyze') {
    const tools = args[1];
    if (!tools) {
      console.error('Usage: planner.mjs analyze <tool1,tool2,...>');
      exit(1);
    }
    const analysis = analyzeToolSequence(tools);
    if (hasFlag(args, '--format') && getArg(args, '--format') === 'json') {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatAnalysis(analysis));
    }
    exit(0);
  }

  // ---- execute: generate plan + create state file ----
  if (cmd === 'execute') {
    const goalParts = [];
    let context = '';
    let maxSteps = 10;
    let strict = false;
    let statePath = null;
    let format = 'text';

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--context') { context = args[++i] || ''; }
      else if (args[i] === '--steps') { maxSteps = parseInt(args[++i], 10) || 10; }
      else if (args[i] === '--strict') { strict = true; }
      else if (args[i] === '--state') { statePath = args[++i]; }
      else if (args[i] === '--format') { format = args[++i] || 'text'; }
      else if (!args[i].startsWith('--')) { goalParts.push(args[i]); }
    }

    const goal = goalParts.join(' ');
    if (!goal) {
      console.error('Error: execute requires a goal description.');
      exit(1);
    }

    // Generate plan
    const plan = generatePlan(goal, { context, steps: maxSteps, strict });

    // Create state file
    if (!statePath) {
      ensurePlanDir();
      statePath = resolve(PLAN_STATE_DIR, generatePlanId() + '.json');
    }
    const state = createPlanState(goal, plan, statePath);

    // Get first step
    const firstStep = getNextRunnableStep(state);
    const output = {
      status: 'execution_started',
      statePath,
      planId: state.planId,
      totalSteps: plan.totalSteps,
      matchedTemplate: plan.matchedTemplate,
      summary: plan.summary,
      firstStep: firstStep ? {
        step: firstStep.step,
        tool: firstStep.tool,
        description: firstStep.description,
        dependsOn: firstStep.dependsOn,
        onFailure: firstStep.onFailure,
        args: firstStep.args,
      } : null,
      steps: format === 'json' ? undefined : plan.steps.map(s => formatStepOutput(s, state)).join('\n\n'),
    };

    if (format === 'json') {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Plan execution started: ${statePath}`);
      console.log(`Plan ID: ${state.planId}`);
      console.log(`Goal: ${goal}`);
      console.log(`Total steps: ${plan.totalSteps}`);
      if (plan.matchedTemplate) console.log(`Template: ${plan.matchedTemplate}`);
      console.log('');
      if (firstStep) {
        console.log('First step to execute:');
        console.log(formatStepOutput(firstStep, state));
      }
      if (plan.warnings && plan.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of plan.warnings) console.log(`  - ${w}`);
      }
      console.log(`\nUse: planner.mjs next --state ${statePath}`);
      console.log(`     planner.mjs report --state ${statePath} --step <N> --status <ok|fail> [--result <json>]`);
    }
    exit(0);
  }

  // ---- next: get next runnable step ----
  if (cmd === 'next') {
    const statePath = parseStatePath(args);
    if (!statePath) {
      console.error('Error: --state <path> is required for next command.');
      exit(1);
    }
    if (!existsSync(statePath)) {
      console.error(`Error: State file not found: ${statePath}`);
      exit(1);
    }

    const state = readPlanState(statePath);

    if (state.status === 'completed' || state.status === 'failed') {
      console.log(`Plan already ${state.status}.`);
      console.log(formatExecutionSummary(state));
      exit(0);
    }

    const next = getNextRunnableStep(state);
    if (!next) {
      if (isPlanComplete(state)) {
        state.status = state.failedSteps.length > 0 ? 'failed' : 'completed';
        writePlanState(statePath, state);
        console.log(`Plan ${state.status}.`);
        console.log(formatExecutionSummary(state));
      } else {
        console.log('No runnable step: all remaining steps are blocked by failed dependencies.');
        console.log('Use replan to re-plan remaining steps.');
      }
      exit(0);
    }

    // Mark step as running
    next.status = 'running';
    writePlanState(statePath, state);

    console.log(formatStepOutput(next, state));
    exit(0);
  }

  // ---- report: record step result ----
  if (cmd === 'report') {
    const statePath = parseStatePath(args);
    if (!statePath) {
      console.error('Error: --state <path> is required for report command.');
      exit(1);
    }
    if (!existsSync(statePath)) {
      console.error(`Error: State file not found: ${statePath}`);
      exit(1);
    }

    const state = readPlanState(statePath);
    const stepNumber = parseInt(getArg(args, '--step'), 10);
    if (!stepNumber || stepNumber < 1) {
      console.error('Error: --step <N> is required (positive integer).');
      exit(1);
    }

    const statusStr = getArg(args, '--status', 'ok');
    const resultStr = getArg(args, '--result', null);
    const errorStr = getArg(args, '--error', null);
    const durationStr = getArg(args, '--duration', null);

    const status = statusStr === 'fail' ? 'failed' : statusStr === 'skip' ? 'skipped' : 'completed';

    // Parse result JSON if provided
    let result = resultStr;
    if (resultStr && resultStr.startsWith('"') || resultStr === 'true' || resultStr === 'false' || resultStr === 'null') {
      try { result = JSON.parse(resultStr); } catch { /* keep as string */ }
    }

    const duration = durationStr ? parseInt(durationStr, 10) || null : null;

    const outcome = recordStepResult(state, statePath, stepNumber, {
      status,
      result,
      error: errorStr,
      duration,
    });

    if (outcome.error) {
      console.error(`Error: ${outcome.error}`);
      exit(1);
    }

    const fmt = getArg(args, '--format', 'text');

    if (fmt === 'json') {
      console.log(JSON.stringify(outcome, null, 2));
    } else {
      console.log(`Step ${stepNumber}: ${status}`);
      if (outcome.replanned) {
        console.log(`↻ Replanned: ${outcome.summary}`);
        if (outcome.nextStep) {
          console.log('');
          console.log('Next step:');
          const ns = state.steps.find(s => s.step === outcome.nextStep);
          if (ns) console.log(formatStepOutput(ns, state));
        }
      } else if (outcome.done) {
        console.log('');
        console.log(outcome.summary);
      } else if (outcome.nextStep) {
        console.log('');
        console.log('Next step:');
        const ns = state.steps.find(s => s.step === outcome.nextStep);
        if (ns) console.log(formatStepOutput(ns, state));
      }
    }
    exit(0);
  }

  // ---- replan: force re-plan remaining steps ----
  if (cmd === 'replan') {
    const statePath = parseStatePath(args);
    if (!statePath) {
      console.error('Error: --state <path> is required for replan command.');
      exit(1);
    }
    if (!existsSync(statePath)) {
      console.error(`Error: State file not found: ${statePath}`);
      exit(1);
    }

    const state = readPlanState(statePath);
    const additionalContext = getArg(args, '--context', '');
    const fmt = getArg(args, '--format', 'text');

    const result = replanRemainingSteps(state, additionalContext);

    if (!result.replanned) {
      console.error(`Replan failed: ${result.reason || 'unknown'}`);
      exit(1);
    }

    writePlanState(statePath, state);

    if (fmt === 'json') {
      console.log(JSON.stringify({ replanned: true, ...result, statePath }, null, 2));
    } else {
      console.log(`↻ Replanned (${statePath})`);
      console.log(`  Removed ${result.changes.removed} stale steps`);
      console.log(`  Added ${result.changes.added} new steps`);
      console.log(`  Total: ${result.changes.totalNow} steps`);
      console.log('');
      console.log('Updated plan:');
      for (const s of state.steps) {
        if (s.status === 'completed') {
          console.log(`  ✓ Step ${s.step}: ${s.tool} [done]`);
        } else {
          console.log('');
          console.log(formatStepOutput(s, state));
        }
      }
      console.log(`\nUse: planner.mjs next --state ${statePath}`);
      console.log(`     planner.mjs report --state ${statePath} --step <N> --status <ok|fail>`);
    }
    exit(0);
  }

  // ---- Default: generate plan only (no state) ----
  const goalParts = [];
  let format = 'text';
  let context = '';
  let maxSteps = 10;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format') { format = args[++i] || 'text'; }
    else if (args[i] === '--context') { context = args[++i] || ''; }
    else if (args[i] === '--steps') { maxSteps = parseInt(args[++i], 10) || 10; }
    else if (args[i] === '--strict') { strict = true; }
    else if (!args[i].startsWith('--')) { goalParts.push(args[i]); }
  }

  const goal = goalParts.join(' ');
  if (!goal) {
    console.error('Error: No goal provided.');
    printHelp();
    exit(1);
  }

  const plan = generatePlan(goal, { context, steps: maxSteps, strict });

  if (format === 'json') {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(formatPlan(plan));
  }
}

// Run only when executed directly (not on import)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main();
}

export {
  generatePlan,
  computeParallelHints,
  WORKFLOW_TEMPLATES,
  analyzeToolSequence,
};
