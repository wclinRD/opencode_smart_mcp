// refactor-plan.mjs → smart_refactor_plan
// CKG-based refactoring assistant.
// Analyzes API usage patterns and generates structured migration plans.
//
// Phase C.1: Uses CKG engine queryUsagePatterns() + refactor-planner.mjs
// to produce ordered migration steps with safety gates.
//
// Usage:
//   { symbol: "oldFunc", file: "src/utils.ts" }
//   → usage patterns + migration plan

import { getCkgEngine } from '../../lib/ckg-engine.mjs';
import { generateMigrationPlan, estimateDifficulty } from '../../lib/refactor-planner.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatPlan(plan) {
  const { api, steps, summary, warnings } = plan;
  let text = '';

  // Header
  text += `Refactoring plan for ${api.symbol}\n`;
  text += '='.repeat(55) + '\n';
  text += `File: ${api.file}\n`;
  if (api.newApi) text += `Target: ${api.newApi}\n`;
  text += `${summary.totalUsages} usage(s) in ${summary.filesAffected} file(s)\n`;
  text += `Difficulty: ${summary.difficulty.label} (${summary.difficulty.score}/10)\n`;
  text += `  ${summary.difficulty.reason}\n`;

  if (summary.goal) {
    text += `\nGoal: ${summary.goal}\n`;
  }

  // Warnings
  if (warnings.length > 0) {
    text += `\n⚠ Warnings:\n`;
    for (const w of warnings) {
      text += `  ⚠  ${w}\n`;
    }
  }

  if (steps.length === 0) {
    text += '\nNo migration steps needed.\n';
    return text;
  }

  // Steps
  text += `\nMigration plan (${steps.length} steps):\n`;
  text += '─'.repeat(55) + '\n';

  for (const s of steps) {
    const riskTag = s.risk
      ? ` [${s.risk === 'high' ? '!!' : '!'} ${s.risk}]`
      : '';
    text += `\nStep ${s.step}: ${s.title}${riskTag}\n`;
    text += `  Action: ${s.action}\n`;
    text += `  ${s.description}\n`;

    if (s.affectedFiles && s.affectedFiles.length > 0) {
      text += `  Files: ${s.affectedFiles.length} file(s)\n`;
      // Show first 3 files
      for (const f of s.affectedFiles.slice(0, 3)) {
        text += `    • ${f}\n`;
      }
      if (s.affectedFiles.length > 3) {
        text += `    … and ${s.affectedFiles.length - 3} more\n`;
      }
    }

    if (s.details && s.details.length > 0) {
      for (const d of s.details) {
        text += `    ${d}\n`;
      }
    }

    if (s.usages && s.usages.length > 0) {
      text += `  Usages:\n`;
      for (const u of s.usages.slice(0, 5)) {
        text += `    • ${u.file}:L${u.line}  ${u.caller}\n`;
      }
      if (s.usages.length > 5) {
        text += `    … and ${s.usages.length - 5} more\n`;
      }
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_refactor_plan',
  description: `CKG-based refactoring assistant.

Analyzes API usage patterns across the codebase and generates a structured,
ordered migration plan with safety gates.

Steps:
1. Queries CKG for all callers of the given API symbol
2. Classifies each usage into patterns (direct-call, class-method, event-handler, module-init, factory)
3. Generates an ordered migration plan grouped by file and risk level
4. Applies safety gates for high-impact migrations

Output includes:
- Usage pattern breakdown with counts
- File-by-file migration steps (ordered by dependency)
- Risk assessment per step (low/medium/high)
- Overall difficulty score (1-10)

Examples:
  { symbol: "oldApi", file: "src/utils.ts" }
  { symbol: "deprecatedFunc", file: "src/helpers.ts", newApi: "newFunc", goal: "Replace legacy helper" }
  { symbol: "OldComponent", file: "src/components/old.tsx", plan: false, format: "json" }`,
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'API symbol name to analyze' },
      file: { type: 'string', description: 'File containing the API definition' },
      newApi: { type: 'string', description: 'New API name (for migration plan)' },
      newSignature: { type: 'string', description: 'New API signature/usage pattern' },
      goal: { type: 'string', description: 'Migration goal description' },
      plan: { type: 'boolean', description: 'Generate full migration plan (default: true)' },
      safetyThreshold: { type: 'number', description: 'Warn if more than N files affected (default: 5)' },
      excludeFiles: { type: 'array', items: { type: 'string' }, description: 'Files to exclude from migration plan' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: ['symbol', 'file'],
  },
  handler: async (args) => {
    const root = args.root || process.cwd();
    const format = args.format || 'text';
    const { symbol, file } = args;

    // Validate
    if (!symbol || !file) {
      return 'symbol and file are required.';
    }

    const absFile = resolve(root, file);
    if (!existsSync(absFile)) {
      return `File not found: ${file}`;
    }

    try {
      const engine = getCkgEngine(root);

      // Query usage patterns
      const usageResult = engine.queryUsagePatterns(symbol, file);

      if (usageResult.totalUsages === 0) {
        let msg = `No usages found for "${symbol}" in ${file}.`;
        msg += `\nThe API may not be indexed or has no callers in the CKG.`;
        msg += `\nTry running "smart_code_query" with query: "build" to index the project first.`;
        return msg;
      }

      // Generate plan (or just return patterns)
      const wantPlan = args.plan !== false;

      if (!wantPlan) {
        if (format === 'json') return JSON.stringify(usageResult, null, 2);
        return formatPatternSummary(usageResult);
      }

      const plan = generateMigrationPlan(usageResult, {
        newApi: args.newApi,
        newSignature: args.newSignature,
        goal: args.goal,
        safetyThreshold: args.safetyThreshold,
        excludeFiles: args.excludeFiles,
      });

      if (format === 'json') return JSON.stringify(plan, null, 2);
      return formatPlan(plan);

    } catch (err) {
      return `refactor-plan error: ${err.message}`;
    }
  },
};

// ---------------------------------------------------------------------------
// Quick pattern summary (plan=false mode)
// ---------------------------------------------------------------------------

function formatPatternSummary(result) {
  let text = `Usage patterns for ${result.symbol} in ${result.file}\n`;
  text += '─'.repeat(45) + '\n';
  text += `${result.totalUsages} total usage(s)\n`;

  if (result.patterns.length > 0) {
    text += '\nPatterns:\n';
    for (const p of result.patterns) {
      text += `  ${p.type.padEnd(17)} ${String(p.count).padStart(3)}x  ${p.description}\n`;
    }
  }

  text += `\nFiles affected: ${new Set(result.usages.map(u => u.caller.file)).size}\n`;

  return text;
}
