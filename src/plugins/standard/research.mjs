/**
 * F.9 Pipeline meta-tool: smart_research
 *
 * LLM-friendly research pipeline. LLM only needs to pick depth:
 *   smart_research({ url: "https://...", depth: "quick" })
 *
 * Layer 4 of the 5-layer design:
 *   1. Smart defaults (Crawlee auto-detection)
 *   2. Plugin split (smart_exa_crawl separate)
 *   3. Description guidance (decision tree in plugin desc)
 *   4. ✅ Pipeline meta-tool (this)
 *   5. Output quality feedback (quality.mjs)
 *
 * depth=quick:      fetch → clean → markdown
 * depth=deep:       fetch → clean → markdown → quality analysis
 * depth=exhaustive: fetch → clean → markdown → chunk → quality analysis
 *
 * All paths are fully offline (no API key required).
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname, '../../cli');

/**
 * Execute the crawl pipeline with given depth.
 * @param {object} args
 * @param {string} args.url - URL to research
 * @param {string} [args.depth='quick'] - quick | deep | exhaustive
 * @returns {Promise<object>} Research result
 */
async function research(args = {}) {
  const url = String(args.url || '').trim();
  if (!url) {
    return { ok: false, error: 'url is required' };
  }

  const depth = (args.depth || 'quick').toLowerCase();
  if (!['quick', 'deep', 'exhaustive'].includes(depth)) {
    return { ok: false, error: `depth must be quick, deep, or exhaustive (got: ${depth})` };
  }

  // Build pipeline based on depth
  const cliArgs = ['crawl', url, '--no-color', '--format', 'json'];

  // Smart defaults: all depths get clean + markdown (offline, zero cost)
  cliArgs.push('--clean', '--markdown');

  // Fetch-only is default (no --fetch-only needed, it's the default when no --render)

  if (depth === 'exhaustive') {
    cliArgs.push('--chunk');
  }

  // Run the crawl + pipeline
  const startTime = Date.now();
  const exaSearchPath = resolve(CLI_DIR, 'exa-search.mjs');

  const result = spawnSync(process.execPath, [exaSearchPath, ...cliArgs], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: 60000, // 60s max
  });

  const duration = Date.now() - startTime;

  if (result.error) {
    return { ok: false, error: result.error.message, duration };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || '').trim() || `Exit code ${result.status}`,
      stdout: result.stdout,
      duration,
    };
  }

  // Parse JSON output
  try {
    const output = JSON.parse(result.stdout);
    return {
      ok: true,
      output: JSON.stringify({
        depth,
        duration,
        results: output.results,
        _meta: output._meta,
      }, null, 2),
    };
  } catch {
    // Fallback: return raw text if JSON parsing fails
    return {
      ok: true,
      output: JSON.stringify({
        depth,
        duration,
        text: result.stdout,
      }, null, 2),
    };
  }
}

export default {
  name: 'smart_research',
  category: 'standard',
  description: 'Research a URL end-to-end. No need to worry about crawl parameters — just pick depth.\n\n'
    + '  depth=quick:      Fetch + clean + markdown (~2s, most pages)\n'
    + '  depth=deep:       Same + quality analysis with tips (~3s)\n'
    + '  depth=exhaustive: Same + chunk by heading (~5s, long articles)\n\n'
    + 'Do NOT use for: searching (use smart_exa_search). Crawling without processing (use smart_exa_crawl).',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to research (required)',
      },
      depth: {
        type: 'string',
        enum: ['quick', 'deep', 'exhaustive'],
        description: 'Research depth. quick: basic fetch (~2s). deep: fetch + quality analysis (~3s). exhaustive: fetch + chunk for long articles (~5s).',
      },
    },
    required: ['url'],
  },
  handler: research,
};
