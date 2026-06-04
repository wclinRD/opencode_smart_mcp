#!/usr/bin/env node
// compose.mjs — CLI entry point for smart_compose tool
// Usage: node compose.mjs '<pipeline JSON>' [--timeout N] [--format text|json|markdown]

import { executePipeline } from '../lib/compose-engine.mjs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  options: {
    timeout: { type: 'string', short: 't', default: '30000' },
    format: { type: 'string', short: 'f', default: 'text' },
  },
  allowPositionals: true,
});

if (positionals.length < 1) {
  console.error('Usage: compose.mjs "<pipeline JSON>" [--timeout N] [--format text|json|markdown]');
  process.exit(1);
}

const timeout = parseInt(values.timeout, 10) || 30000;

let pipeline;
try {
  pipeline = JSON.parse(positionals[0]);
} catch (e) {
  console.error(`Invalid pipeline JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(pipeline)) {
  console.error('Pipeline must be a JSON array of steps');
  process.exit(1);
}

const result = await executePipeline(pipeline, { timeout });
const format = values.format || 'text';

if (format === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else if (format === 'markdown') {
  console.log(`# Compose Pipeline Results\n`);
  for (const r of result.results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`## ${icon} Step ${r.step} — ${r.tool} (${r.mode})`);
    console.log(`- Duration: ${r.duration}ms`);
    if (r.error) console.log(`- Error: ${r.error}`);
    console.log(`\`\`\`\n${(r.output || '').slice(0, 2000)}\n\`\`\``);
    console.log();
  }
  if (!result.ok) console.log(`**Pipeline failed** — ${result.results.filter(r => !r.ok).length} step(s) with errors`);
} else {
  // text mode
  for (const r of result.results) {
    const status = r.ok ? 'OK' : 'FAIL';
    const output = (r.output || '').trim().slice(0, 500);
    console.log(`[${status}] Step ${r.step}:${r.tool} (${r.mode}) — ${r.duration}ms`);
    if (output) console.log(`  ${output.split('\n').join('\n  ')}`);
    if (r.error) console.log(`  Error: ${r.error}`);
  }
  if (!result.ok) {
    process.exit(1);
  }
}
