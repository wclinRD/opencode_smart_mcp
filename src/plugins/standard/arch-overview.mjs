// arch-overview.mjs → smart_arch_overview (via smart_smart_run router)
// Architecture overview — structured JSON map for LLM to understand project architecture.
//
// 使用情境：
//   LLM 進入新專案時，一次 query 取得完整架構圖，不用讀 20 個檔案。
//
// 輸出結構：
//   { summary, layers, dependencies, violations, criticalFunctions, unusedExports }

import { getCkgEngine } from '../../lib/ckg-engine.mjs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';

export default {
  name: 'smart_arch_overview',
  category: 'analyze',
  description: 'Use when: need to understand project architecture in one shot. Returns structured JSON with layers, dependencies, violations, critical functions, and unused exports. LLM should call this first when entering a new codebase.',
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Project root directory (default: current dir)' },
      build: { type: 'boolean', description: 'Force CKG build if not built yet (default: true)' },
      format: { type: 'string', enum: ['json', 'text'], description: 'Output format (default: json — LLM-friendly)' },
    },
  },
  handler: async (args) => {
    try {
      const root = resolve(args.root || cwd());
      const format = args.format || 'json';
      const engine = getCkgEngine(root);

      // Check if CKG is built; build if needed
      const stats = engine.getStats();
      if (stats.status === 'not_built') {
        if (args.build !== false) {
          try {
            await engine.build({ force: false, onProgress: undefined });
          } catch (buildErr) {
            return JSON.stringify({
              status: 'build_failed',
              error: `CKG build failed: ${buildErr.message}. Try running smart_code_query({query:"build"}) first.`,
            }, null, 2);
          }
        } else {
          return JSON.stringify({
            status: 'not_built',
            error: 'CKG not built. Set build:true or run smart_code_query({query:"build"}) first.',
          }, null, 2);
        }
      }

      const overview = engine.getArchOverview();

      if (format === 'text') {
        return formatArchOverviewText(overview);
      }

      // JSON output — LLM-friendly structured data
      return JSON.stringify(overview, null, 2);
    } catch (err) {
      return `arch_overview error: ${err.message}`;
    }
  },
};

/**
 * Format architecture overview as human-readable text (fallback).
 * @param {object} overview
 * @returns {string}
 */
function formatArchOverviewText(overview) {
  if (overview.status) return `CKG status: ${overview.status}`;

  const { summary, layers, dependencies, violations, criticalFunctions, unusedExports } = overview;
  let text = `Project: ${summary.project}\n`;
  text += '─'.repeat(50) + '\n';
  text += `${summary.files} files, ${summary.functions} functions, ${summary.layers} layers, ${summary.dependencies} inter-layer deps\n`;
  if (summary.violations > 0) text += `⚠ ${summary.violations} architecture violations\n`;
  if (summary.unusedExports > 0) text += `⚠ ${summary.unusedExports} unused exports\n`;
  text += `Built: ${summary.builtAt || 'N/A'}\n\n`;

  text += 'Layers:\n';
  for (const layer of layers) {
    text += `  ${layer.name}: ${layer.files} files, ${layer.functions} functions`;
    if (layer.deps.length > 0) text += ` → ${layer.deps.join(', ')}`;
    text += '\n';
  }

  if (dependencies.length > 0) {
    text += '\nKey dependencies:\n';
    for (const dep of dependencies.slice(0, 10)) {
      text += `  ${dep.from} → ${dep.to} (${dep.edgeCount} edges)\n`;
    }
  }

  if (violations.length > 0) {
    text += '\n⚠ Architecture violations:\n';
    for (const v of violations) {
      text += `  ${v.from} → ${v.to}: ${v.rule}\n`;
    }
  }

  if (criticalFunctions.length > 0) {
    text += '\nCritical functions:\n';
    for (const f of criticalFunctions) {
      const tested = f.tested ? '✓' : '✗';
      text += `  ${tested} ${f.name} (${f.file}) — fanIn:${f.fanIn} complexity:${f.complexity}\n`;
    }
  }

  if (unusedExports.length > 0) {
    text += '\nUnused exports:\n';
    for (const u of unusedExports) {
      text += `  ${u.name} (${u.file})\n`;
    }
  }

  return text;
}
