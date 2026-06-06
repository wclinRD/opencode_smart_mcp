#!/usr/bin/env node
/**
 * CLI entry point for smart_research.
 * Called by compose-engine/workflow when chaining.
 * Usage: node research.mjs <url> [--depth quick|deep|exhaustive] [--json]
 *
 * Delegates to the actual handler in plugins/standard/research.mjs.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(a => !a.startsWith('--'));
  const depthIdx = args.indexOf('--depth');
  const depth = depthIdx >= 0 ? args[depthIdx + 1] || 'quick' : 'quick';
  const formatIdx = args.indexOf('--format');
  const isJson = (formatIdx >= 0 && args[formatIdx + 1] === 'json') || args.includes('--json');

  if (!url) {
    console.error('Usage: research.mjs <url> [--depth quick|deep|exhaustive] [--json]');
    process.exit(1);
  }

  const mod = await import(resolve(__dirname, '../plugins/standard/research.mjs'));
  const result = await mod.default.handler({ url, depth });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`URL: ${url}`);
    console.log(`Depth: ${depth} (${result.duration}ms)`);
    console.log('---');
    if (result.results) {
      for (const r of result.results) {
        console.log(r.text || '(no text)');
        console.log('');
        if (r._meta) {
          console.log(`Quality: ${r._meta.quality} | chars: ${r._meta.chars}`);
          if (r._meta._tip) console.log(r._meta._tip);
        }
      }
    } else if (result.text) {
      console.log(result.text);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
