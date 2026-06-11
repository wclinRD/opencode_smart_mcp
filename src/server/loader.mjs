// tool-loader.mjs — Plugin loader for smart MCP tools
//
// Scans src/plugins/core/ and src/plugins/standard/ for .mjs files,
// imports each, builds lookup maps. Exports pre-populated
// structures via top-level await.
//
// Tool plugin contract (each .mjs in src/plugins/*/):
//   export default {
//     name: 'smart_grep',
//     description: '...',
//     inputSchema: { type: 'object', properties: {...}, required: [...] },
//     mapArgs: (args) => [...cliArgs],
//     cli: 'contextual-grep.mjs',       // relative to src/cli/
//     handler?: async (args) => string,  // optional inline handler
//     category?: 'core'|'standard',      // set by directory
//   }

import { readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrapHandler } from '../lib/safe-handler.mjs';
import { generateManifest } from '../lib/manifest-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '../plugins');
const CLI_DIR = resolve(__dirname, '../cli');
const PROJECT_ROOT = resolve(__dirname, '../..');
const MANIFEST_PATH = join(PROJECT_ROOT, 'config/tools/manifest.json');

// Exported structures (filled via top-level await below)
export const toolMap = new Map();
export const nativeTools = [];
export const routerTools = [];
export let toolManifest = null;

// ---------------------------------------------------------------------------
// Load all tool plugins
// ---------------------------------------------------------------------------
const CATEGORY_DIRS = ['core', 'standard'];

for (const cat of CATEGORY_DIRS) {
  const dirPath = join(TOOLS_DIR, cat);
  let files;
  try {
    files = readdirSync(dirPath).filter(f => f.endsWith('.mjs'));
  } catch {
    continue; // directory doesn't exist yet
  }

  for (const file of files.sort()) {
    const filePath = join(dirPath, file);
    if (statSync(filePath).isDirectory()) continue;

    try {
      const mod = await import(`file://${filePath}`);
      const def = mod.default;
      if (!def || !def.name) {
        console.error(`[smart-loader] Skipping ${file}: missing name`);
        continue;
      }

      // Set metadata
      def.category = def.category || (cat === 'core' ? 'core' : 'standard');
      def.description = def.description || '';
      def.inputSchema = def.inputSchema || { type: 'object', properties: {} };
      def.mapArgs = def.mapArgs || defaultMapArgs;
      // Auto-wrap handler with try-catch + structured error format (Phase 6: Reliability)
      if (def.handler) {
        def.handler = wrapHandler(def.handler, def.name);
      }
      // responsePolicy: default is L0 (lossless, no optimization)
      // Plugins opt into lossy compression by declaring maxLevel > 1
      def.responsePolicy = def.responsePolicy || { maxLevel: 0 };
      // responsePipeline (Phase 2): optional custom pipeline stages
      // Plugin can declare responsePipeline to override default pipeline:
      //   responsePipeline: [
      //     { stage: 'format' },
      //     { stage: 'compress' },
      //     { stage: 'summarize', options: { securityScan: true } },
      //   ],
      // When not declared, the default pipeline runs based on responsePolicy.maxLevel

      // Resolve CLI path
      if (def.cli) {
        def._cliPath = resolve(CLI_DIR, def.cli);
      }

      // Validate: tool needs either cli OR handler
      if (!def.cli && !def.handler) {
        console.error(`[smart-loader] Skipping ${file}: no cli or handler`);
        continue;
      }

      toolMap.set(def.name, def);

      if (cat === 'core') {
        nativeTools.push(def);
      } else {
        routerTools.push(def);
      }
    } catch (err) {
      console.error(`[smart-loader] Error loading ${file}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 15 P1: Generate tool manifest from loaded plugins
// ---------------------------------------------------------------------------
try {
  toolManifest = generateManifest({ toolMap, outputPath: MANIFEST_PATH });
  console.error(`[smart-loader] Manifest generated: ${toolManifest.tools.length} tools → ${MANIFEST_PATH}`);
} catch (err) {
  console.error(`[smart-loader] Manifest generation failed: ${err.message}`);
  toolManifest = { version: 1, tools: [], error: err.message };
}

// ---------------------------------------------------------------------------
// Default mapArgs — generic CLI flag converter
// ---------------------------------------------------------------------------
function defaultMapArgs(args) {
  const cli = [];
  for (const [k, v] of Object.entries(args || {})) {
    if (k === '_timeout') continue;
    if (typeof v === 'boolean') { if (v) cli.push(`--${k}`); }
    else if (v != null) cli.push(`--${k}`, String(v));
  }
  return cli;
}
