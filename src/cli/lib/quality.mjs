/**
 * F.10 Output Quality Feedback — quality.mjs
 *
 * Standalone module for analyzing content quality and generating
 * actionable LLM-facing feedback tips.
 *
 * Wraps analyzeContent() from chunker.mjs (the canonical implementation)
 * and provides convenience helpers for integration.
 *
 * Usage:
 *   import { analyzeContent, analyzeResults, generateTip } from './quality.mjs';
 *
 *   // Single result
 *   const meta = analyzeContent(text, { engine: 'fetch' });
 *   console.log(meta.quality, meta._tip);
 *
 *   // Batch results (for multi-result search/crawl)
 *   const summaries = analyzeResults(results, opts);
 */

import { analyzeContent as chunkerAnalyze } from './chunker.mjs';

// Re-export for convenience
export { analyzeContent } from './chunker.mjs';

/**
 * Analyze multiple crawl/search results and attach _meta to each.
 * @param {Array<{text?: string, url?: string}>} results
 * @param {object} opts - Options passed to analyzeContent
 * @param {string} [opts.engine='fetch']
 * @param {boolean} [opts.clean]
 * @param {boolean} [opts.markdown]
 * @param {number} [opts.maxChars]
 * @returns {Array<object>} Same array with _meta attached
 */
export function analyzeResults(results, opts = {}) {
  if (!Array.isArray(results)) return results;
  for (const r of results) {
    if (r.text) {
      r._meta = chunkerAnalyze(r.text, {
        engine: opts.engine || r._meta?.engine || 'fetch',
        clean: opts.clean,
        markdown: opts.markdown,
        maxChars: opts.maxChars,
      });
    }
  }
  return results;
}

/**
 * Generate a human-readable quality summary for a batch of results.
 * @param {Array<{_meta?: object}>} results
 * @returns {string} Summary string
 */
export function summarizeQuality(results) {
  if (!Array.isArray(results) || results.length === 0) return '';
  const lines = [];
  let high = 0, medium = 0, low = 0;
  for (const r of results) {
    if (r._meta?.quality === 'high') high++;
    else if (r._meta?.quality === 'medium') medium++;
    else low++;
  }
  lines.push(`Quality: ${high} high, ${medium} medium, ${low} low (${results.length} total)`);

  // Collect unique tips
  const tips = new Set();
  for (const r of results) {
    if (r._meta?._tip) tips.add(r._meta._tip);
  }
  if (tips.size > 0) {
    lines.push('Tips:');
    for (const t of tips) lines.push(`  ${t}`);
  }
  return lines.join('\n');
}

export default { analyzeContent: chunkerAnalyze, analyzeResults, summarizeQuality };
