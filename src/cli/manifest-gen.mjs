#!/usr/bin/env node
// manifest-gen.mjs — Standalone manifest generator
//
// Usage: node src/cli/manifest-gen.mjs [--output path]
// Generates config/tools/manifest.json from all plugin definitions.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// Dynamic import loader to get toolMap
async function main() {
  const outputPath = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : resolve(PROJECT_ROOT, 'config/tools/manifest.json');

  // Import loader (which does top-level await to load all plugins)
  const { toolMap, generateManifest } = await import('../lib/manifest-loader.mjs');

  // We need the actual toolMap from loader — re-import loader
  const loader = await import('../server/loader.mjs');

  const manifest = generateManifest({
    toolMap: loader.toolMap,
    outputPath,
  });

  console.log(`✅ Manifest generated: ${manifest.tools.length} tools`);
  console.log(`   core: ${manifest.tools.filter(t => t.category === 'core').length}`);
  console.log(`   standard: ${manifest.tools.filter(t => t.category === 'standard').length}`);
  console.log(`   output: ${outputPath}`);

  // Show safety distribution
  const bySafety = {};
  for (const t of manifest.tools) {
    bySafety[t.safetyLevel] = (bySafety[t.safetyLevel] || 0) + 1;
  }
  console.log(`   safety: ${Object.entries(bySafety).map(([k,v]) => `${k}:${v}`).join(', ')}`);
}

main().catch(err => {
  console.error('❌ Manifest generation failed:', err.message);
  process.exit(1);
});