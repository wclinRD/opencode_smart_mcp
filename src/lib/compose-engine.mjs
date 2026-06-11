// compose-engine.mjs — Tool composition primitives for Smart MCP
//
// Provides three composition modes:
//   pipe(tools)    — sequential: A → B → C (each output feeds next)
//   parallel(tools) — concurrent: A || B || C (all run simultaneously)
//   cond(condition, thenTools, elseTools) — conditional branching
//
// Each tool is specified as: { tool: 'smart_grep', args: {...} }
// Uses the same TOOL_CLI_MAP + TOOL_ARGS_CONVERTERS as workflow.mjs dispatch.
//
// Usage:
//   import { executePipeline } from './compose-engine.mjs';
//   const result = await executePipeline([
//     { tool: 'smart_grep', args: { pattern: 'error' }, mode: 'seq' },
//     { tool: 'smart_error_diagnose', args: { error: '$prev' }, mode: 'seq' },
//   ]);

import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Tool → CLI script mapping (same as workflow.mjs TOOL_CLI_MAP)
// ---------------------------------------------------------------------------

const TOOL_CLI_MAP = {
  smart_grep: 'contextual-grep.mjs',
  smart_learn: 'learn-adapt.mjs',
  smart_security: 'security-scan.mjs',
  smart_test: 'test-runner.mjs',
  smart_deep_think: 'thinking.mjs',
  smart_memory_store: 'memory-store.mjs',
  smart_error_diagnose: 'error-diagnose.mjs',
  smart_debug: 'debug-assist.mjs',
  smart_cross_file_edit: 'cross-file-edit.mjs',
  smart_import_graph: 'import-graph.mjs',
  smart_naming: 'naming-convention.mjs',
  smart_rename_safety: 'rename-safety.mjs',
  smart_exa_search: 'exa-search.mjs',
  smart_exa_crawl: 'exa-search.mjs',
  smart_research: 'research.mjs',
  smart_report: 'report.mjs',
  smart_planner: 'planner.mjs',
  smart_coverage: 'coverage-check.mjs',
  smart_diagram: 'diagram.mjs',
  smart_git_context: 'git-context.mjs',
  smart_github_search: 'github-search.mjs',
  smart_test_suggest: 'test-suggest.mjs',
  smart_integrate: 'tool-integrate.mjs',
  smart_tool_stats: 'tool-stats.mjs',

  smart_py_helper: 'py-helper.mjs',
  smart_ts_helper: 'ts-helper.mjs',
  smart_rs_helper: 'rs-helper.mjs',
};

// ---------------------------------------------------------------------------
// Per-tool arg converters (mirrors workflow.mjs TOOL_ARGS_CONVERTERS)
// ---------------------------------------------------------------------------

const TOOL_ARGS_CONVERTERS = {
  smart_grep: (a) => { const c = []; if (a.pattern) c.push(String(a.pattern)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.context) c.push('--context', String(a.context)); if (a.withScope) c.push('--with-scope'); if (a.withImports) c.push('--with-imports'); if (a.ignoreCase) c.push('--ignore-case'); if (a.filesOnly) c.push('--files-only'); if (a.maxMatches) c.push('--max-matches', String(a.maxMatches)); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },
  smart_error_diagnose: (a) => { const c = []; if (a.error) c.push(String(a.error)); if (a.file) c.push('--file', String(a.file)); if (a.noMemory) c.push('--no-memory'); if (a.store) c.push('--store'); if (a.memoryResolution) c.push('--memory-resolution', String(a.memoryResolution)); if (a.memoryTools) c.push('--memory-tools', String(a.memoryTools)); if (a.memoryThreshold != null) c.push('--memory-threshold', String(a.memoryThreshold)); if (a.format) c.push('--format', String(a.format)); return c; },
  smart_memory_store: (a) => { const c = []; if (a.command) c.push(String(a.command)); if (a.query) c.push(String(a.query)); if (a.id) c.push(String(a.id)); if (a.resolution) c.push('--resolution', String(a.resolution)); if (a.tools) c.push('--tools', String(a.tools)); if (a.files) c.push('--files', String(a.files)); if (a.category) c.push('--category', String(a.category)); if (a.success !== undefined) c.push('--success', String(a.success)); if (a.limit) c.push('--limit', String(a.limit)); if (a.threshold) c.push('--threshold', String(a.threshold)); if (a.format) c.push('--format', String(a.format)); if (a.ttl) c.push('--ttl', String(a.ttl)); if (a.keep) c.push('--keep', String(a.keep)); if (a.includeArchived) c.push('--include-archived'); return c; },
  smart_exa_search: (a) => { const c = []; if (a.command) c.push(String(a.command)); if (a.command === 'crawl') { if (a.urls) { const urls = String(a.urls).split(',').map(u => u.trim()).filter(Boolean); c.push(...urls); } } else if (a.query) c.push(String(a.query)); if (a.numResults) c.push('--num-results', String(a.numResults)); if (a.maxChars) c.push('--max-chars', String(a.maxChars)); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },
  smart_exa_crawl: (a) => { const c = ['crawl']; if (a.urls) { const urls = String(a.urls).split(',').map(u => u.trim()).filter(Boolean); c.push(...urls); } if (a.clean) c.push('--clean'); if (a.markdown) c.push('--markdown'); if (a.chunk) c.push('--chunk'); if (a.maxChunkSize) c.push('--max-chunk-size', String(a.maxChunkSize)); if (a.crawlee) c.push('--crawlee'); if (a.render) c.push('--render'); if (a.extended) c.push('--extended'); if (a.maxChars) c.push('--max-chars', String(a.maxChars)); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },
  smart_research: (a) => { const c = []; if (a.url) c.push(String(a.url)); if (a.depth) c.push('--depth', String(a.depth)); c.push('--json'); return c; },
  smart_deep_think: (a) => { const c = []; if (a.topic) c.push(String(a.topic)); if (a.template) c.push('--template', String(a.template)); if (a.steps) c.push('--steps', String(a.steps)); if (a.format) c.push('--format', String(a.format)); if (a.plan) c.push('--plan', String(a.plan)); if (a.planStep) c.push('--plan-step', String(a.planStep)); if (a.state) c.push('--state', String(a.state)); if (a.record) c.push('--record', String(a.record)); if (a.branch) c.push('--branch', String(a.branch)); if (a.restore) c.push('--restore', String(a.restore)); if (a.iterative) c.push('--iterative'); if (a.dynamic) c.push('--dynamic'); if (a.advance) c.push('--advance'); if (a.finish) c.push('--finish'); if (a.status) c.push('--status'); if (a.cancel) c.push('--cancel'); c.push('--no-color'); return c; },
  smart_report: (a) => { const c = []; if (a.type) c.push(String(a.type)); if (a.title) c.push('--title', String(a.title)); if (a.input) c.push('--input', String(a.input)); if (a.output) c.push('--output', String(a.output)); if (a.theme) c.push('--theme', String(a.theme)); if (a.root) c.push('--root', String(a.root)); c.push('--no-color'); return c; },
  smart_planner: (a) => { const c = []; if (a.command === 'list-tasks') { c.push('list-tasks'); return c; } if (a.command === 'analyze') { c.push('analyze'); if (a.tools) c.push(String(a.tools)); if (a.format) c.push('--format', String(a.format)); return c; } if (a.command) c.push(String(a.command)); if (a.goal) c.push(String(a.goal)); if (a.context) c.push('--context', String(a.context)); if (a.steps) c.push('--steps', String(a.steps)); if (a.strict) c.push('--strict'); if (a.state) c.push('--state', String(a.state)); if (a.step !== undefined) c.push('--step', String(a.step)); if (a.stepStatus) c.push('--status', String(a.stepStatus)); if (a.result) c.push('--result', String(a.result)); if (a.error) c.push('--error', String(a.error)); if (a.duration) c.push('--duration', String(a.duration)); if (a.format) c.push('--format', String(a.format)); return c; },
  smart_cross_file_edit: (a) => { const c = []; if (a.file) c.push(String(a.file)); if (a.pattern) c.push(String(a.pattern)); if (a.replacement) c.push(String(a.replacement)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.signature) c.push('--signature', String(a.signature)); if (a.dryRun) c.push('--dry-run'); if (a.apply) c.push('--apply'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },
  smart_rename_safety: (a) => { const c = []; if (a.name) c.push(String(a.name)); if (a.newName) c.push(String(a.newName)); if (a.root) c.push('--root', String(a.root)); if (a.include) c.push('--include', String(a.include)); if (a.exclude) c.push('--exclude', String(a.exclude)); if (a.dryRun) c.push('--dry-run'); if (a.apply) c.push('--apply'); if (a.format) c.push('--format', String(a.format)); c.push('--no-color'); return c; },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli');

function resolveToolCli(toolName) {
  const cliFile = TOOL_CLI_MAP[toolName];
  if (!cliFile) throw new Error(`No CLI mapping for tool: ${toolName}`);
  return resolve(CLI_DIR, cliFile);
}

function argsToCLI(toolName, args) {
  const converter = TOOL_ARGS_CONVERTERS[toolName];
  if (converter) return converter(args);
  const cli = [];
  for (const [k, v] of Object.entries(args || {})) {
    if (k === '_timeout' || k === '_context') continue;
    if (typeof v === 'boolean') { if (v) cli.push(`--${k}`); }
    else if (v != null) cli.push(`--${k}`, String(v));
  }
  return cli;
}

// ---------------------------------------------------------------------------
// Single tool execution (async spawn)
// ---------------------------------------------------------------------------

const EXEC_TIMEOUT = 30000;

/**
 * Execute a single tool via CLI spawn (async).
 * @param {string} toolName - e.g. 'smart_grep'
 * @param {object} args - tool arguments
 * @param {object} [opts] - { timeout, signal }
 * @returns {Promise<{ ok: boolean, output: string, error: string|null, duration: number }>}
 */
function executeTool(toolName, args, opts = {}) {
  return new Promise((resolve) => {
    const startMs = Date.now();
    let cliPath;
    let cliArgs;
    try {
      cliPath = resolveToolCli(toolName);
      cliArgs = argsToCLI(toolName, args);
    } catch (err) {
      resolve({ ok: false, output: '', error: `Resolve error: ${err.message}`, duration: 0 });
      return;
    }
    const timeout = opts.timeout || EXEC_TIMEOUT;

    const child = spawn('node', [cliPath, ...cliArgs], {
      encoding: 'utf-8',
      maxBuffer: 512 * 1024,
      timeout,
      windowsHide: true,
      signal: opts.signal || undefined,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      const duration = Date.now() - startMs;
      resolve({ ok: false, output: stdout, error: `Spawn error: ${err.message}`, duration });
    });

    child.on('close', (code) => {
      const duration = Date.now() - startMs;
      if (code !== 0) {
        const errMsg = (stderr || '').trim() || `Exit code ${code}`;
        resolve({ ok: false, output: stdout, error: errMsg, duration });
      } else {
        resolve({ ok: true, output: stdout, error: null, duration });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

/**
 * Execute a pipeline of tool steps.
 * Each step: { tool, args, mode: 'seq'|'par'|'cond', condition?: { onField, match, then, else } }
 *
 * @param {Array<{ tool: string, args: object, mode?: string, condition?: object }>} pipeline
 * @param {object} [opts] - { timeout, signal }
 * @returns {Promise<{ ok: boolean, results: Array, error?: string }>}
 */
async function executePipeline(pipeline, opts = {}) {
  if (!pipeline || pipeline.length === 0) {
    return { ok: false, results: [], error: 'Empty pipeline' };
  }

  const results = [];
  let i = 0;

  while (i < pipeline.length) {
    const step = pipeline[i];
    const mode = step.mode || 'seq';

    if (mode === 'seq') {
      // Sequential: execute one at a time
      const r = await executeTool(step.tool, step.args, opts);
      r.step = i;
      r.tool = step.tool;
      r.mode = 'seq';
      results.push(r);
      i++;

    } else if (mode === 'par') {
      // Parallel: collect all consecutive 'par' steps, run simultaneously
      const parSteps = [];
      while (i < pipeline.length && (pipeline[i].mode === 'par' || pipeline[i].mode === undefined)) {
        // If mode is undefined and we hit a non-par step, stop
        if (!pipeline[i].mode) break;
        parSteps.push({ index: i, ...pipeline[i] });
        i++;
      }
      // If we only found 1 par step, just run it sequentially
      if (parSteps.length <= 1 && parSteps[0]) {
        const r = await executeTool(parSteps[0].tool, parSteps[0].args, opts);
        r.step = parSteps[0].index;
        r.tool = parSteps[0].tool;
        r.mode = 'seq';
        results.push(r);
      } else {
        const parResults = await Promise.all(
          parSteps.map(s => executeTool(s.tool, s.args, opts))
        );
        for (let pi = 0; pi < parSteps.length; pi++) {
          const r = parResults[pi];
          r.step = parSteps[pi].index;
          r.tool = parSteps[pi].tool;
          r.mode = 'par';
          results.push(r);
        }
      }

    } else if (mode === 'cond') {
      // Conditional: check last result, pick then/else branch
      const lastResult = results[results.length - 1];
      const cond = step.condition || {};
      const field = cond.onField || 'output';
      const matchValue = lastResult ? (lastResult[field] || lastResult.output || '') : '';
      const matches = cond.match ? matchValue.toLowerCase().includes(cond.match.toLowerCase()) : false;

      const branchSteps = matches ? (cond.then || []) : (cond.else || []);
      if (branchSteps.length > 0) {
        const branchResults = await executePipeline(branchSteps, opts);
        for (const br of branchResults.results) {
          br.step = i;
          results.push(br);
        }
      }
      // Record the condition decision
      results.push({
        step: i,
        tool: step.tool,
        mode: 'cond',
        ok: true,
        output: matches ? `Condition met: ${cond.match}` : `Condition not met: ${cond.match || '(no pattern)'}`,
        error: null,
        duration: 0,
        conditionResult: matches,
      });
      i++;

    } else {
      // Unknown mode — treat as seq
      const r = await executeTool(step.tool, step.args, opts);
      r.step = i;
      r.tool = step.tool;
      r.mode = 'seq';
      results.push(r);
      i++;
    }
  }

  const allOk = results.every(r => r.ok !== false);
  return { ok: allOk, results };
}

export { executeTool, executePipeline };
