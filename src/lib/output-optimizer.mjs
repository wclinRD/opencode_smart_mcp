// output-optimizer.mjs — Token-efficient output optimization pipeline
//
// Automatically detects content format and applies the best compression
// strategy for LLM consumption. Used by the MCP server respond() hook.
//
// Compression levels:
//   L0 (raw)       — passthrough, no changes
//   L1 (lossless)  — abbreviate keys, normalize whitespace, strip noise
//   L2 (smart)     — keep critical sections, compress/summarize secondary
//
// Usage:
//   import { optimizeOutput } from './output-optimizer.mjs';
//   const result = await optimizeOutput(text, { maxLevel: 1, format: 'auto' });

import { env } from 'node:process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const L1_MIN_SIZE = 500;        // Only compress if >= 500 chars
const L2_MIN_SIZE = 10_000;     // Only summarize if >= 10KB
const L2_MAX_SUMMARY_RATIO = 0.3; // Summary at most 30% of original

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Detect the format of a text string.
 * @param {string} text
 * @returns {string} 'json' | 'csv' | 'yaml' | 'markdown' | 'html' | 'code' | 'table' | 'plaintext'
 */
export function detectFormat(text) {
  if (!text || typeof text !== 'string') return 'plaintext';

  const t = text.trim();

  // Empty
  if (t.length === 0) return 'plaintext';

  // JSON (object or array)
  if ((t[0] === '{' && t.at(-1) === '}') || (t[0] === '[' && t.at(-1) === ']')) {
    try { JSON.parse(t); return 'json'; } catch { /* not valid JSON */ }
  }

  // HTML
  if (/^<(!DOCTYPE|html|head|body|div|span|table|p|a|h[1-6])\b/i.test(t) ||
      /<\/[a-z]+\s*>$/i.test(t)) {
    return 'html';
  }

  // YAML (key: value pairs at start, no commas between them)
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*:\s/.test(t) && !t.includes('{') &&
      (t.split('\n').length > 1 || t.includes(':'))) {
    const lines = t.split('\n').filter(l => l.trim());
    const yamlLines = lines.filter(l => /^[a-zA-Z_][a-zA-Z0-9_-]*:/.test(l) || /^\s+[a-zA-Z_]/.test(l) || /^\s*-/.test(l));
    if (yamlLines.length >= lines.length * 0.6) return 'yaml';
  }

  // CSV (multiple lines, same number of commas per line)
  if (t.includes(',')) {
    const lines = t.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      const commaCounts = lines.map(l => (l.match(/,/g) || []).length);
      const uniqueCounts = new Set(commaCounts);
      if (uniqueCounts.size <= 2 && commaCounts[0] > 0) {
        // Check if first line looks like header (no numbers)
        const firstLine = lines[0];
        const headers = firstLine.split(',').map(h => h.trim());
        const alphaHeaders = headers.filter(h => /^[a-zA-Z\s]+$/.test(h));
        if (alphaHeaders.length >= headers.length * 0.5) return 'csv';
      }
    }
  }

  // Table (pipe-separated: | a | b |)
  if (t.includes('|') && t.includes('---')) {
    const lines = t.split('\n').filter(l => l.trim());
    if (lines.some(l => /^\|.*\|$/.test(l.trim())) &&
        lines.some(l => /^[\|\s\-:]+$/.test(l))) {
      return 'table';
    }
  }

  // Markdown (headings, lists, code fences)
  if (/^#{1,6}\s/m.test(t) || /^[*\-+]\s/m.test(t) || /^>\s/m.test(t) ||
      /^```/m.test(t) || /^\[.+\]\(.+\)/m.test(t) ||
      /^---\s*$/m.test(t)) {
    return 'markdown';
  }

  // Markdown (links anywhere in text)
  if (/\[.+\]\(https?:\/\/.+\)/.test(t)) {
    return 'markdown';
  }

  // Code (has semicolons, braces, functions, and spans > 2 lines)
  if (/\b(function|const|let|var|import|export|class|def|fn|pub)\b/.test(t) &&
      /[;{}()]/.test(t) && t.split('\n').length > 1) {
    return 'code';
  }

  // Plain text
  return 'plaintext';
}

// ---------------------------------------------------------------------------
// Level 0: Raw passthrough
// ---------------------------------------------------------------------------

function passThrough(text) {
  return text;
}

// ---------------------------------------------------------------------------
// Level 1: Lossless compression
// ---------------------------------------------------------------------------

/**
 * Compress JSON by abbreviating common keys and removing whitespace.
 * This is intentionally simpler than full Toonify — it runs synchronously
 * and covers the common case without loading the external toonify-mcp package.
 */
function compressJSON(text) {
  try {
    const parsed = JSON.parse(text);
    const minified = JSON.stringify(parsed);
    // If original had pretty-print, minified is already smaller
    if (minified.length < text.length * 0.8) return minified;
    return text; // Already minified or small
  } catch {
    return text;
  }
}

/**
 * Compress CSV by trimming whitespace per field.
 */
function compressCSV(text) {
  const lines = text.split('\n');
  const compressed = lines.map(line => {
    const fields = line.split(',');
    return fields.map(f => f.trim()).join(',');
  });
  return compressed.join('\n');
}

/**
 * Compress YAML by trimming trailing whitespace.
 */
function compressYAML(text) {
  return text.split('\n').map(l => l.trimEnd()).join('\n');
}

/**
 * Compress Markdown by normalizing whitespace.
 * Preserves structure (headings, code blocks, lists) while collapsing
 * excessive blank lines.
 */
function compressMarkdown(text) {
  const lines = text.split('\n');
  const result = [];
  let blankCount = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code blocks
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // Collapse excessive blank lines (max 1)
    if (line.trim() === '') {
      blankCount++;
      if (blankCount <= 1) result.push('');
      continue;
    }
    blankCount = 0;

    // Trim trailing whitespace
    result.push(line.trimEnd());
  }

  return result.join('\n');
}

/**
 * Compress HTML by stripping whitespace between tags.
 */
function compressHTML(text) {
  // Remove comments
  let s = text.replace(/<!--[\s\S]*?-->/g, '');
  // Collapse whitespace between block tags
  s = s.replace(/>\s+</g, '>\n<');
  s = s.replace(/\n{3,}/g, '\n\n');
  // Trim each line
  s = s.split('\n').map(l => l.trim()).join('\n');
  return s;
}

/**
 * Compress code by normalizing indentation and removing trailing whitespace.
 */
function compressCode(text) {
  const lines = text.split('\n');
  const result = lines.map(l => l.trimEnd());
  // Collapse excessive blank lines (max 1)
  const collapsed = [];
  let blankCount = 0;
  for (const line of result) {
    if (line === '') {
      blankCount++;
      if (blankCount <= 1) collapsed.push('');
    } else {
      blankCount = 0;
      collapsed.push(line);
    }
  }
  return collapsed.join('\n');
}

/**
 * Compress plaintext by normalizing whitespace.
 */
function compressPlainText(text) {
  // Collapse multiple blank lines
  const lines = text.split('\n');
  const result = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankCount++;
      if (blankCount <= 1) result.push('');
    } else {
      blankCount = 0;
      result.push(line.trimEnd());
    }
  }
  return result.join('\n');
}

const L1_COMPRESSORS = {
  json: compressJSON,
  csv: compressCSV,
  yaml: compressYAML,
  markdown: compressMarkdown,
  html: compressHTML,
  code: compressCode,
  table: compressPlainText,
  plaintext: compressPlainText,
};

// ---------------------------------------------------------------------------
// Level 2: Smart summary (lossy — keeps critical sections)
// ---------------------------------------------------------------------------

/**
 * Smart summary for JSON: keep top-level keys, summarize arrays.
 */
function summarizeJSON(text) {
  try {
    const parsed = JSON.parse(text);
    const summary = smartSummarizeValue(parsed, 2);
    return JSON.stringify(summary);
  } catch {
    // Fallback to L1 if parse fails
    return L1_COMPRESSORS.json(text);
  }
}

function smartSummarizeValue(value, depth) {
  if (depth <= 0 || value === null || value === undefined) {
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 100) + '...';
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length <= 5) return value.map(v => smartSummarizeValue(v, depth - 1));
    // Summarize: keep first 3, last 1, show count
    const head = value.slice(0, 3).map(v => smartSummarizeValue(v, depth - 1));
    const tail = value.length > 4 ? [smartSummarizeValue(value.at(-1), depth - 1)] : [];
    return [
      ...head,
      `... (${value.length - 4} more items)`,
      ...tail,
    ];
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length <= 8) {
      const result = {};
      for (const [k, v] of entries) {
        result[k] = smartSummarizeValue(v, depth - 1);
      }
      return result;
    }
    // Keep important keys, summarize rest
    const importantKeys = ['name', 'id', 'title', 'key', 'error', 'status',
      'severity', 'type', 'file', 'path', 'url', 'message', 'finding',
      'result', 'data', 'value', 'description', 'summary'];
    const result = {};
    let keptCount = 0;
    for (const [k, v] of entries) {
      if (importantKeys.includes(k) && keptCount < 10) {
        result[k] = smartSummarizeValue(v, depth - 1);
        keptCount++;
      }
    }
    result[`_summary`] = `(${entries.length} keys total)`;
    return result;
  }

  if (typeof value === 'string' && value.length > 200) {
    return value.substring(0, 200) + '...';
  }

  return value;
}

/**
 * Smart summary for Markdown: keep headings and first paragraph under each.
 */
function summarizeMarkdown(text) {
  const lines = text.split('\n');
  const result = [];
  let inCodeBlock = false;
  let seenHeading = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        result.push(line); // Show code block header
        result.push('  ... (code block) ...');
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Keep headings
    if (/^#{1,6}\s/.test(line)) {
      seenHeading = true;
      result.push(line);
      continue;
    }

    // Keep first paragraph after heading (non-empty, non-list)
    if (seenHeading && line.trim() && !/^[*\-+\d.]/.test(line.trim())) {
      result.push(line);
      seenHeading = false; // Only keep first paragraph
      continue;
    }

    // Keep horizontal rules and blockquotes
    if (/^---+$/.test(line.trim()) || /^>\s/.test(line)) {
      result.push(line);
    }
  }

  // If summary is too short (< 3 lines), return original truncated
  if (result.length < 3 && lines.length > 10) {
    return lines.slice(0, 30).join('\n') + '\n\n... (truncated)';
  }

  return result.join('\n');
}

/**
 * Smart summary for HTML: use simple tag-based extraction.
 */
function summarizeHTML(text) {
  // Extract text from common content tags
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = text.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const pMatches = [...text.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)];

  const parts = [];
  if (titleMatch) parts.push(`# ${titleMatch[1].trim()}`);
  if (h1Match) parts.push(`## ${h1Match[1].trim()}`);
  if (pMatches.length > 0) {
    parts.push('');
    for (const m of pMatches.slice(0, 10)) {
      parts.push(m[1].trim());
    }
    if (pMatches.length > 10) {
      parts.push(`\n... (${pMatches.length - 10} more paragraphs)`);
    }
  }

  return parts.join('\n');
}

/**
 * Smart summary for security scan results: keep high/medium, summarize low.
 */
function summarizeSecurityScan(text) {
  // Detect common security scan output patterns
  const lines = text.split('\n');
  const kept = [];
  let lowCount = 0;
  let infoCount = 0;

  for (const line of lines) {
    const lowLine = /low|info|note|suggestion/i.test(line) && !/high|medium|critical|error/i.test(line);
    if (!lowLine) {
      kept.push(line);
    } else if (/^\[?(low|info|note)/i.test(line.trim())) {
      if (/low/i.test(line)) lowCount++;
      else infoCount++;
    } else {
      kept.push(line);
    }
  }

  if (lowCount > 0) kept.push(`\n[Optimized: ${lowCount} low-severity findings hidden, ${infoCount} info items hidden]`);

  return kept.join('\n');
}

const L2_SUMMARIZERS = {
  json: summarizeJSON,
  csv: (t) => `${t.split('\n').length} rows × ${(t.split('\n')[0]?.split(',')?.length || '?')} cols`,
  yaml: summarizeJSON, // Treat YAML-like JSON
  markdown: summarizeMarkdown,
  html: summarizeHTML,
  code: (t) => t.split('\n').length > 30
    ? t.split('\n').slice(0, 30).join('\n') + `\n\n... (${t.split('\n').length - 30} more lines)`
    : t,
  table: (t) => t.split('\n').length > 20
    ? t.split('\n').slice(0, 20).join('\n') + `\n\n... (${t.split('\n').length - 20} more rows)`
    : t,
  plaintext: (t) => t.length > 2000
    ? t.substring(0, 2000) + '\n\n... (truncated)'
    : t,
};

// ---------------------------------------------------------------------------
// Security scan heuristics
// ---------------------------------------------------------------------------

function isSecurityScan(text) {
  const t = text.toLowerCase();
  return /severity|high.*risk|vulnerability|credential.*found|security.*scan/i.test(t) &&
         /finding|issue|warning|error|detected/i.test(t);
}

// ---------------------------------------------------------------------------
// Main optimization function
// ---------------------------------------------------------------------------

/**
 * Optimize tool output for token efficiency.
 *
 * @param {string} text - The output text to optimize
 * @param {object} [options]
 * @param {number} [options.maxLevel=1] - Maximum compression level (0, 1, 2)
 * @param {string} [options.format='auto'] - Content format ('auto' for detection)
 * @param {boolean} [options.securityScan=false] - Force security scan heuristics
 * @returns {Promise<{text: string, optimized: boolean, level: number, format: string, originalSize: number, compressedSize: number, meta: object}>}
 */
export async function optimizeOutput(text, options = {}) {
  const {
    maxLevel = 1,
    format: formatHint = 'auto',
    securityScan = false,
  } = options;

  // Default result = no optimization
  const result = {
    text,
    optimized: false,
    level: 0,
    format: 'plaintext',
    originalSize: text ? text.length : 0,
    compressedSize: text ? text.length : 0,
    meta: {},
  };

  if (!text || typeof text !== 'string' || text.length === 0) {
    return result;
  }

  const size = text.length;
  const format = formatHint === 'auto' ? detectFormat(text) : formatHint;
  result.format = format;

  // Level 0: raw (skip if below threshold or maxLevel is 0)
  if (maxLevel < 1 || size < L1_MIN_SIZE) {
    return { ...result, format };
  }

  let optimizedText;
  let level = 0;

  // Level 1: lossless compression (always safe)
  if (maxLevel >= 1) {
    const compressor = L1_COMPRESSORS[format];
    if (compressor) {
      optimizedText = compressor(text);
      // Only accept if actually smaller
      if (optimizedText.length < text.length) {
        level = 1;
      } else {
        optimizedText = text;
      }
    }
  }

  // Level 2: smart summary (only if output is large enough and allowed)
  if (maxLevel >= 2 && size >= L2_MIN_SIZE) {
    const summarizer = format === 'json' && isSecurityScan(text)
      ? summarizeSecurityScan
      : L2_SUMMARIZERS[format];

    if (summarizer) {
      // For L2, always try the summarizer and compare with L1 result
      const currentText = optimizedText || text;
      const summary = summarizer(currentText);

      // Only use L2 if it's significantly smaller than L1
      if (summary.length < currentText.length * L2_MAX_SUMMARY_RATIO && summary.length > 100) {
        optimizedText = summary;
        level = 2;
        result.meta.summaryType = format === 'json' ? 'key-preserving' : 'structural';
      }
    }
  }

  // If nothing changed, return original
  if (!optimizedText || optimizedText === text) {
    return { ...result, format };
  }

  result.text = optimizedText;
  result.optimized = true;
  result.level = level;
  result.compressedSize = optimizedText.length;
  result.meta.cacheKey = createHash('sha256').update(text).digest('hex').substring(0, 16);

  return result;
}

// ---------------------------------------------------------------------------
// Synchronous optimization (for simple L1 cases that don't need async)
// ---------------------------------------------------------------------------

export function optimizeOutputSync(text, options = {}) {
  const { maxLevel = 1, format: formatHint = 'auto' } = options;

  const result = {
    text,
    optimized: false,
    level: 0,
    format: 'plaintext',
    originalSize: text ? text.length : 0,
    compressedSize: text ? text.length : 0,
    meta: {},
  };

  if (!text || typeof text !== 'string' || text.length === 0) return result;

  const size = text.length;
  const format = formatHint === 'auto' ? detectFormat(text) : formatHint;
  result.format = format;

  if (maxLevel < 1 || size < L1_MIN_SIZE) return { ...result, format };

  let optimizedText;

  if (maxLevel >= 1) {
    const compressor = L1_COMPRESSORS[format];
    if (compressor) {
      optimizedText = compressor(text);
      if (!optimizedText || optimizedText.length >= text.length) {
        optimizedText = text;
      }
    }
  }

  if (!optimizedText || optimizedText === text) return { ...result, format };

  result.text = optimizedText;
  result.optimized = true;
  result.level = 1;
  result.compressedSize = optimizedText.length;
  result.meta.cacheKey = createHash('sha256').update(text).digest('hex').substring(0, 16);

  return result;
}
