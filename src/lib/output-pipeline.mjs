// output-pipeline.mjs — Composable output processing pipeline framework
//
// Phase 2 of the Token Optimization Plan.
// Provides a stage-based pipeline: format → compress → summarize → truncate → cache
// Plugin can declare responsePipeline to override defaults.
//
// Usage:
//   import { createPipeline } from './output-pipeline.mjs';
//   const pipe = createPipeline({ maxLevel: 2, maxChars: 30000 });
//   const result = await pipe.run(text);
//   // → { text, meta: { level, format, stages, savings, cacheKey } }
//
// Plugin responsePipeline override:
//   export default {
//     responsePolicy: { maxLevel: 2 },
//     responsePipeline: [
//       { stage: 'format' },
//       { stage: 'compress' },
//       { stage: 'summarize', options: { securityScan: true } },
//     ],
//   };

import { createHash } from 'node:crypto';
import { detectFormat, optimizeOutputSync } from './output-optimizer.mjs';
import { getDefaultCache } from './cache-manager.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_MAX_CHARS = 50000;
const TRUNCATE_HEAD_ROOM = 0.8; // Truncate at 80% of max to leave metadata room

// ---------------------------------------------------------------------------
// Pipeline context
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PipelineContext
 * @property {string} format - detected content format
 * @property {number} maxLevel - max compression level (0|1|2)
 * @property {number} maxChars - max characters before truncation
 * @property {string[]} stages - names of stages that ran
 * @property {object} [cacheKey] - cache key if cached
 * @property {number} originalSize - original text size
 * @property {number} compressedSize - final text size
 * @property {object} [options] - per-stage options
 */

// ---------------------------------------------------------------------------
// Stage registry
// ---------------------------------------------------------------------------

const STAGES = new Map();

/**
 * Register a pipeline stage.
 * @param {string} name
 * @param {Function} fn - (text, ctx, options) => string
 */
export function registerStage(name, fn) {
  STAGES.set(name, fn);
}

// ===========================================================================
// Built-in stages
// ===========================================================================

// --- format: detect content format ---
registerStage('format', (text, ctx) => {
  ctx.format = detectFormat(text);
  return text;
});

// --- compress: L1 lossless compression ---
registerStage('compress', (text, ctx, opts = {}) => {
  if (ctx.maxLevel < 1) return text;
  const result = optimizeOutputSync(text, {
    maxLevel: 1,
    format: opts.format || 'auto',
  });
  if (result.optimized) {
    ctx.stages.push('compress');
    return result.text;
  }
  return text;
});

// --- summarize: L2 smart summary (lossy) ---
registerStage('summarize', (text, ctx, opts = {}) => {
  if (ctx.maxLevel < 2) return text;
  // Use the output-optimizer's L2 summarizer
  const result = optimizeOutputSync(text, {
    maxLevel: 2,
    format: opts.format || 'auto',
    securityScan: opts.securityScan === true,
  });
  if (result.optimized && result.level >= 2) {
    ctx.stages.push('summarize');
    return result.text;
  }
  return text;
});

// --- truncate: semantic truncation preserving structure ---
registerStage('truncate', (text, ctx, opts = {}) => {
  const maxChars = opts.maxChars || ctx.maxChars || DEFAULT_MAX_CHARS;
  const effectiveMax = Math.floor(maxChars * TRUNCATE_HEAD_ROOM);
  if (text.length <= effectiveMax) return text;

  const truncated = semanticTruncate(text, effectiveMax, ctx.format);
  ctx.stages.push('truncate');
  return truncated;
});

// --- cache: check/store from unified cache ---
registerStage('cache', (text, ctx, opts = {}) => {
  const cache = getDefaultCache();
  if (!cache) return text;

  const cacheKey = createHash('sha256')
    .update(text)
    .digest('hex')
    .substring(0, 16);

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    ctx.cacheHit = true;
    ctx.cacheKey = cacheKey;
    ctx.stages.push('cache(hit)');
    return cached;
  }

  // Store in cache with configured TTL
  const ttl = opts.ttl || 5 * 60 * 1000;
  cache.set(cacheKey, text, ttl);
  ctx.cacheKey = cacheKey;
  ctx.stages.push('cache(set)');
  return text;
});

// ===========================================================================
// Semantic truncator
// ===========================================================================

/**
 * Truncate text preserving structure (headings, first/last paragraphs, key data).
 * Works format-aware.
 *
 * @param {string} text - text to truncate
 * @param {number} maxChars - maximum characters
 * @param {string} format - content format
 * @returns {string}
 */
function semanticTruncate(text, maxChars, format) {
  switch (format) {
    case 'markdown':
      return truncateMarkdown(text, maxChars);
    case 'json':
      return truncateJSON(text, maxChars);
    case 'html':
      return truncateHTML(text, maxChars);
    case 'code':
      return truncateCode(text, maxChars);
    case 'csv':
    case 'table':
      return truncateTabular(text, maxChars);
    default:
      return truncatePlain(text, maxChars);
  }
}

/**
 * Truncate Markdown preserving headings and first content under each.
 */
function truncateMarkdown(text, maxChars) {
  const lines = text.split('\n');
  const result = [];
  let charCount = 0;
  let inCodeBlock = false;
  let headingDepth = 0;

  for (const line of lines) {
    const isCodeFence = /^```/.test(line.trim());
    if (isCodeFence) {
      inCodeBlock = !inCodeBlock;
    }

    // Headings always kept
    if (/^#{1,6}\s/.test(line) && !inCodeBlock) {
      headingDepth = line.match(/^#+/)[0].length;
      result.push(line);
      charCount += line.length + 1;
      continue;
    }

    // Within budget: keep everything
    if (charCount < maxChars) {
      result.push(line);
      charCount += line.length + 1;
      continue;
    }

    // Over budget:
    // For deep headings (###+), skip if we already have enough
    if (headingDepth >= 3 && !inCodeBlock) {
      continue;
    }

    // For top-level headings, always include
    if (headingDepth <= 2 && !inCodeBlock) {
      result.push(line);
      charCount += line.length + 1;
      continue;
    }

    // Collapse blank lines over budget
    if (line.trim() === '') continue;

    // For code blocks over budget, show [...]
    if (inCodeBlock) {
      if (result.at(-1) !== '  ...') {
        result.push('  ...');
      }
      continue;
    }
  }

  // Add truncation marker
  if (charCount > maxChars) {
    result.push('');
    result.push(`_... (truncated: showed ${charCount} of ${text.length} chars)_`);
  }

  return result.join('\n');
}

/**
 * Truncate JSON preserving top-level keys and array structure.
 */
function truncateJSON(text, maxChars) {
  try {
    const parsed = JSON.parse(text);
    const stringified = JSON.stringify(parsed);
    if (stringified.length <= maxChars) return text;

    // Try pretty-print with depth limit
    const limited = limitedJSONStringify(parsed, maxChars);
    if (limited.length < stringified.length) {
      return limited + `\n\n_... (truncated: JSON too large)_`;
    }
  } catch {
    // Fall through
  }
  return text.substring(0, maxChars) + `\n\n_... (truncated)_`;
}

function limitedJSONStringify(value, maxChars, depth = 0) {
  if (depth > 4) return Array.isArray(value) ? `[Array(${value.length})]` : `{Object}`;
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(String(value).substring(0, 200));
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.slice(0, 5).map(v => limitedJSONStringify(v, maxChars, depth + 1));
    const tail = value.length > 5 ? `, ...(+${value.length - 5})` : '';
    return `[\n${items.map(i => '  ' + i).join(',\n')}${tail}\n]`;
  }
  const entries = Object.entries(value).slice(0, 10);
  const pairs = entries.map(([k, v]) => `  "${k}": ${limitedJSONStringify(v, maxChars, depth + 1)}`);
  return `{\n${pairs.join(',\n')}\n}`;
}

/**
 * Truncate HTML preserving title and headings.
 */
function truncateHTML(text, maxChars) {
  if (text.length <= maxChars) return text;
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const hMatches = [...text.matchAll(/<h([1-6])[^>]*>([^<]+)<\/h\1>/gi)];
  const pMatches = [...text.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)];

  const parts = [];
  let charCount = 0;

  if (titleMatch) {
    const t = `# ${titleMatch[1].trim()}`;
    parts.push(t);
    charCount += t.length;
  }

  for (const m of hMatches) {
    if (charCount >= maxChars) break;
    const t = `${'#'.repeat(Number(m[1]))} ${m[2].trim()}`;
    parts.push(t);
    charCount += t.length;
  }

  for (const m of pMatches) {
    if (charCount >= maxChars) break;
    const t = m[1].trim();
    parts.push(t);
    charCount += t.length;
  }

  if (charCount < maxChars) {
    const remaining = text.substring(0, maxChars);
    parts.push('');
    parts.push(remaining);
  }

  parts.push('');
  parts.push(`_... (truncated HTML: extracted ${parts.length} structural elements)_`);
  return parts.join('\n');
}

/**
 * Truncate code preserving function/class signatures and top structure.
 */
function truncateCode(text, maxChars) {
  const lines = text.split('\n');
  const result = [];
  let charCount = 0;
  let skippedBlock = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Always keep: function/class signatures, imports, exports
    const isSignature = /^\s*(export\s+)?(function|class|const\s+\w+\s*=\s*\(|async\s+function|def\s+\w+|fn\s+\w+|pub\s+fn)/.test(line);
    const isImport = /^\s*(import|from|require|use\s)/.test(line);

    if (isSignature || isImport) {
      result.push(line);
      charCount += line.length + 1;
      skippedBlock = false;
      continue;
    }

    if (charCount < maxChars) {
      result.push(line);
      charCount += line.length + 1;
      continue;
    }

    // Over budget: skip implementation details
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    if (!skippedBlock) {
      result.push('  // ...');
      skippedBlock = true;
    }
  }

  if (charCount > maxChars) {
    result.push('');
    result.push(`_... (truncated: ${charCount} of ${text.length} chars)_`);
  }

  return result.join('\n');
}

/**
 * Truncate CSV/table preserving header and first N rows + last row.
 */
function truncateTabular(text, maxChars) {
  if (text.length <= maxChars) return text;

  const lines = text.split('\n');
  const header = lines[0];
  const separator = lines[1]?.includes('---') ? lines[1] : null;
  const dataStart = separator ? 2 : 1;
  const dataLines = lines.slice(dataStart);

  // Estimate chars per data row
  const avgRowLen = dataLines.length > 0
    ? dataLines.reduce((s, l) => s + l.length + 1, 0) / dataLines.length
    : 100;

  const maxRows = Math.max(1, Math.floor((maxChars - header.length) / avgRowLen) - 2);

  const result = [header];
  if (separator) result.push(separator);

  // First N rows
  const head = dataLines.slice(0, Math.min(maxRows, dataLines.length));
  result.push(...head);

  if (dataLines.length > maxRows) {
    result.push(`... (${dataLines.length - maxRows} more rows)`);
    // Last row for context
    result.push(dataLines.at(-1));
  }

  result.push('');
  result.push(`_... (truncated: showed ${Math.min(maxRows, dataLines.length)} of ${dataLines.length} rows)_`);
  return result.join('\n');
}

/**
 * Truncate plain text preserving first and last portions.
 */
function truncatePlain(text, maxChars) {
  if (text.length <= maxChars) return text;

  const headLen = Math.floor(maxChars * 0.6);
  const tailLen = maxChars - headLen - 50;

  const head = text.substring(0, headLen);
  const tail = text.substring(text.length - tailLen);

  return `${head}\n\n... (truncated: ${text.length - maxChars} chars removed) ...\n\n${tail}`;
}

// ===========================================================================
// Pipeline builder
// ===========================================================================

const DEFAULT_STAGES = ['format', 'compress', 'summarize', 'truncate', 'cache'];

/**
 * Create an output processing pipeline.
 *
 * @param {object} [options]
 * @param {number} [options.maxLevel=1] - Max compression level (0|1|2)
 * @param {number} [options.maxChars=50000] - Max characters before truncation
 * @param {string[]} [options.stages] - Stage names (default: all)
 * @param {object} [options.stageOptions] - Per-stage options { stageName: {...} }
 * @param {Array<{stage:string, options?:object}>} [options.chain] - Custom stage chain (from plugin responsePipeline)
 * @returns {Pipeline}
 */
export function createPipeline(options = {}) {
  const {
    maxLevel = 1,
    maxChars = DEFAULT_MAX_CHARS,
    stages: stageNames = DEFAULT_STAGES,
    stageOptions = {},
    chain = null,
  } = options;

  // Use custom chain if provided (from plugin responsePipeline)
  const resolvedStages = chain
    ? chain.map(c => ({ name: c.stage, options: c.options || {} }))
    : stageNames.map(name => ({ name, options: stageOptions[name] || {} }));

  // Validate stages
  for (const { name } of resolvedStages) {
    if (!STAGES.has(name)) {
      throw new Error(`Unknown pipeline stage: "${name}". Available: ${[...STAGES.keys()].join(', ')}`);
    }
  }

  return new Pipeline(resolvedStages, maxLevel, maxChars);
}

/**
 * @class Pipeline
 */
class Pipeline {
  /** @param {Array<{name:string, options:object}>} stages */
  constructor(stages, maxLevel, maxChars) {
    this._stages = stages;
    this._maxLevel = maxLevel;
    this._maxChars = maxChars;
  }

  /**
   * Run the pipeline on text.
   * @param {string} text
   * @returns {{ text: string, meta: object }}
   */
  run(text) {
    if (!text || typeof text !== 'string' || text.length === 0) {
      return { text, meta: { level: 0, format: 'plaintext', stages: [], originalSize: text?.length || 0, compressedSize: text?.length || 0 } };
    }

    const ctx = {
      format: 'plaintext',
      maxLevel: this._maxLevel,
      maxChars: this._maxChars,
      stages: [],
      originalSize: text.length,
      compressedSize: text.length,
      cacheHit: false,
      cacheKey: null,
    };

    let current = text;

    for (const { name, options } of this._stages) {
      const stageFn = STAGES.get(name);
      if (!stageFn) continue;

      try {
        current = stageFn(current, ctx, options);
        if (typeof current !== 'string') {
          // Stage returned non-string (e.g., undefined) — revert
          current = text;
        }
      } catch {
        // Stage error — continue with current text (best-effort)
      }
    }

    ctx.compressedSize = current.length;

    // Build metadata
    const meta = buildMeta(ctx);

    return { text: current, meta };
  }
}

// ===========================================================================
// Metadata builder
// ===========================================================================

function buildMeta(ctx) {
  const { format, stages, originalSize, compressedSize, cacheKey, cacheHit } = ctx;

  const savings = originalSize - compressedSize;
  const savingsPct = originalSize > 0 ? ((1 - compressedSize / originalSize) * 100).toFixed(1) : '0.0';
  const savingsStr = `${(savings / 1024).toFixed(1)}KB (${savingsPct}%)`;

  // Determine overall level
  let level = 0;
  if (stages.includes('compress')) level = 1;
  if (stages.includes('summarize')) level = 2;
  if (stages.includes('truncate')) level = Math.max(level, 1); // truncation alone = lossy but not summarization

  const meta = {
    _optimized: {
      level,
      format,
      stages: [...new Set(stages)], // deduplicate
      originalSize,
      optimizedSize: compressedSize,
      savings: savingsStr,
      cacheKey: cacheKey || null,
      cacheHit: cacheHit || false,
    },
  };

  // Add tooltip for agent guidance
  if (level >= 2) {
    meta._optimized.tooltip = `Output compressed ${savingsPct}% (L2 summary) — use format:'full' if you need complete data.`;
  } else if (level === 1 && parseFloat(savingsPct) > 10) {
    meta._optimized.tooltip = `Output compressed ${savingsPct}% — lossless.`;
  }

  return meta;
}

// ===========================================================================
// Convenience: one-shot pipeline
// ===========================================================================

/**
 * Run output through the default pipeline in one call.
 * @param {string} text
 * @param {object} [options]
 * @returns {{ text: string, meta: object }}
 */
export function optimizeOutput(text, options = {}) {
  const pipe = createPipeline(options);
  return pipe.run(text);
}

// ===========================================================================
// Cache integration utilities
// ===========================================================================

/**
 * Check if a result is in cache (for tools that bypass the pipeline).
 * @param {string} cacheKey
 * @returns {string|undefined}
 */
export function checkCache(cacheKey) {
  const cache = getDefaultCache();
  return cache ? cache.get(cacheKey) : undefined;
}

/**
 * Store a result in cache.
 * @param {string} cacheKey
 * @param {string} text
 * @param {number} [ttlMs]
 */
export function storeCache(cacheKey, text, ttlMs) {
  const cache = getDefaultCache();
  if (cache) cache.set(cacheKey, text, ttlMs);
}

// ===========================================================================
// Debug: list available stages
// ===========================================================================

export function listStages() {
  return [...STAGES.keys()];
}
