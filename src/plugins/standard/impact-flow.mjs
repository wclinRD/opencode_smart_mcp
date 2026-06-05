// impact-flow.mjs → smart_impact_flow
// Change-Impact Pipeline: git diff → CKG call graph → test prediction
//
// Builds on ImpactEngine (lib/impact-engine.mjs) for full pipeline analysis.
// Provides structured output consumable by workflow engine and agent loops.
//
// Compared to smart_code_impact (LSP-only):
// - Uses CKG for fast, persistent graph traversal (side-steps cold LSP)
// - Predicts affected test files
// - Provides structured JSON for workflow consumption
// - Supports refactor-safe-flow workflow template

import { ImpactEngine } from '../../lib/impact-engine.mjs';
import { closeAllLspBridges } from '../../lib/lsp-bridge.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default {
  name: 'smart_impact_flow',
  category: 'standard',
  description: `Full change-impact analysis pipeline. Use when: planning a refactor, reviewing a PR diff, need to know what depends on your changes, or want to predict which tests might break. Builds on CKG + LSP call graph + test file heuristics.

Three input modes:
  1. diff (git diff text) → auto-detect changed symbols → CKG propagation → test prediction
  2. files + symbols → skip diff parsing, directly trace symbols through call graph
  3. files only → auto-detect symbols in files → propagate → test prediction

Output: structured JSON with direct/transitive impacts, affected test files, confidence score, human-readable summary.`,
  inputSchema: {
    type: 'object',
    properties: {
      diff: { type: 'string', description: 'git diff text to analyze (alternative to files+symbols)' },
      files: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to analyze (alternative to diff)' },
      symbols: { type: 'array', items: { type: 'string' }, description: 'Specific symbol names to trace (used with files)' },
      depth: { type: 'number', description: 'Impact propagation depth (1-3, default: 2). depth=1=direct only, depth=2=direct+transitive' },
      predictTests: { type: 'boolean', description: 'Whether to predict affected test files (default: true)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: [],
  },
  handler: async (args) => {
    try {
      const root = args.root || process.cwd();
      const depth = args.depth ?? 2;
      const doPredictTests = args.predictTests !== false;
      const format = args.format || 'text';

      const engine = new ImpactEngine(root);

      // Determine input mode
      let result;

      if (args.diff) {
        result = await engine.analyzeImpact({
          diff: args.diff,
          depth,
          predictTests: doPredictTests,
        });
      } else if (args.files && args.files.length > 0) {
        result = await engine.analyzeImpact({
          files: args.files,
          symbols: args.symbols,
          depth,
          predictTests: doPredictTests,
        });
      } else {
        return 'Provide either "diff" (git diff text) or "files" (array of file paths).';
      }

      if (format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      // Text format — use the engine's built-in summary
      let text = result.summary;

      // If no impact, summarize empty result
      if (result.impact.stats.totalImpactedFiles === 0 && !result.summary.includes('No changes')) {
        text = 'No downstream impact detected. Safe to modify.';
      }

      // Append engine metadata
      text += `\n\nEngine: impact-flow (depth=${depth}, predictTests=${doPredictTests})`;
      text += `\nImpact source: ${result.impact.stats.source}`;

      // Append full detail for JSON-level data
      if (result.impact.direct.length > 0 && depth > 1) {
        // Only show full detail for non-trivial results
        const totalDirect = result.impact.stats.totalDirectSymbols;
        const totalTransitive = result.impact.stats.totalTransitiveSymbols;
        text += `\nTotal: ${totalDirect} direct + ${totalTransitive} transitive calls across ${result.impact.stats.totalImpactedFiles} files`;
      }

      return text;
    } finally {
      await closeAllLspBridges();
    }
  },
};
