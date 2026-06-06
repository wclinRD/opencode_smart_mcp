#!/usr/bin/env node

// chunker.mjs — Semantic content chunking engine
//
// Splits long text content into heading-bounded chunks suitable for LLM context.
// Pipeline position (last step): fetch → clean (Readability) → markdown (Turndown) → chunk
//
// Usage (CLI):
//   node chunker.mjs --text "..." --max-chunk-size 2000 --chunk-overlap 200
//   node chunker.mjs --file ./article.txt --format json
//
// Library usage:
//   import { chunkContent, validateChunks, analyzeContent } from './chunker.mjs';
//   const chunks = chunkContent(longText, { maxChunkSize: 2000 });
//   const quality = analyzeContent(longText, { clean: true, markdown: true });

import { readFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Regex for Markdown and HTML headings
const HEADING_RE = /^(#{1,3})\s+(.+)$|^<h([1-3])(?:\s[^>]*)?>(.+?)<\/h[1-3]>/gm;

// Regex for paragraph boundaries (double newline or single newline with indent)
const PARAGRAPH_RE = /\n\n+|\n(?=\s{2,}|\t|[*-] )/;

// Default options
const DEFAULTS = {
  maxChunkSize: 2000,
  chunkOverlap: 200,    // chars of overlap between chunks
  minChunkSize: 300,    // don't create chunks smaller than this
};

// ---------------------------------------------------------------------------
// Content analysis (for F.10 Output quality feedback)
// ---------------------------------------------------------------------------

/**
 * Analyze content quality and produce metadata + usage tips.
 * @param {string} text - The crawled/processed text
 * @param {object} [opts] - Processing options used
 * @param {boolean} [opts.clean] - Whether Readability was applied
 * @param {boolean} [opts.markdown] - Whether Turndown was applied
 * @param {boolean} [opts.chunked] - Whether content was already chunked
 * @param {number} [opts.maxChars] - Max chars limit used
 * @returns {{ engine: string, chars: number, truncated: boolean, clean: boolean, markdown: boolean, chunks: number, quality: string, _tip: string|null }}
 */
function analyzeContent(text, opts = {}) {
  const chars = text ? text.length : 0;
  const truncated = opts.maxChars ? chars >= opts.maxChars : false;

  // Detect HTML tag remnants (angle brackets with tag-like content)
  const htmlTagRemnants = /<[a-z][^>]*>|<\/[a-z]+>/i.test(text);

  // Detect common nav/sidebar patterns
  const navPatterns = /\b(navigation|sidebar|footer|cookie|menu|breadcrumb)\b/i;
  const hasNav = !opts.clean && navPatterns.test(text);

  // Count heading-like structures in plain text
  const headingLines = text ? text.split('\n').filter(l => /^#{1,3}\s/.test(l) || /^[A-Z][^.]{2,80}$/.test(l.trim())).length : 0;

  // Quality rating
  let quality = 'high';
  const issues = [];

  if (truncated) { quality = 'medium'; issues.push('truncated'); }
  if (hasNav) { quality = 'medium'; issues.push('nav-detected'); }
  if (htmlTagRemnants) { quality = 'medium'; issues.push('html-remnants'); }
  if (chars < 100) { quality = 'low'; issues.push('too-short'); }

  const chunks = opts.chunked || 0;

  // Generate usage tip (priority order: truncated > html remnants > nav > length > heading count)
  let tip = null;
  if (truncated) {
    tip = `💡 內容已被截斷（maxChars: ${opts.maxChars}），建議加 --extended 取得完整內容`;
  } else if (htmlTagRemnants && !opts.markdown) {
    tip = `💡 內容含 HTML tag 殘留，建議加 --markdown 轉換為乾淨 Markdown`;
  } else if (hasNav && !opts.clean) {
    tip = `💡 內容可能含導航列/側邊欄，建議加 --clean 萃取文章主體`;
  } else if (chars > 15000 && !opts.chunked) {
    tip = `💡 此內容非常長（${chars.toLocaleString()} 字元），強烈建議加 --chunk 分塊處理`;
  } else if (chars > 5000 && !opts.chunked) {
    tip = `💡 此內容超過 5000 字元（共 ${chars.toLocaleString()} 字元），建議加 --chunk 按標題分塊以節省 LLM token`;
  } else if (chars > 3000 && headingLines >= 3 && !opts.chunked) {
    tip = `💡 此內容有 ${headingLines} 個章節標題，建議加 --chunk 分塊以便讀取特定章節`;
  }

  return {
    engine: opts.engine || 'unknown',
    chars,
    truncated,
    clean: !!opts.clean,
    markdown: !!opts.markdown,
    chunks: chunks || (opts.chunked ? 1 : 0),
    quality,
    _issues: issues.length > 0 ? issues : undefined,
    _tip: tip,
  };
}

// ---------------------------------------------------------------------------
// Chunk validation
// ---------------------------------------------------------------------------

/**
 * Validate chunk array integrity.
 * Checks for: missing content, overlapping/duplicate text, boundary continuity.
 * @param {{ heading: string|null, content: string, startLine: number, endLine: number, size: number }[]} chunks
 * @returns {{ valid: boolean, totalChars: number, totalGap: number, warnings: string[] }}
 */
function validateChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { valid: false, totalChars: 0, totalGap: 0, warnings: ['No chunks provided'] };
  }

  const warnings = [];
  let totalChars = 0;
  let totalGap = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];

    // Check content exists
    if (!c.content || c.content.trim().length === 0) {
      warnings.push(`Chunk ${i}: empty content`);
    }

    // Check size matches actual
    const actualSize = c.content ? c.content.length : 0;
    if (Math.abs(actualSize - c.size) > 10) {
      warnings.push(`Chunk ${i}: declared size ${c.size} != actual ${actualSize}`);
    }

    totalChars += actualSize;

    // Check boundary continuity between chunks
    if (i > 0) {
      const prev = chunks[i - 1];
      if (c.startLine < prev.endLine) {
        warnings.push(`Chunks ${i - 1}-${i}: overlapping lines (${prev.endLine} > ${c.startLine})`);
      } else if (c.startLine > prev.endLine + 1) {
        const gap = c.startLine - prev.endLine - 1;
        totalGap += gap;
        if (gap > 2) {
          warnings.push(`Chunks ${i - 1}-${i}: possible gap of ${gap} lines`);
        }
      }
    }
  }

  return {
    valid: warnings.length === 0,
    totalChars,
    totalGap,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Heading-based splitting
// ---------------------------------------------------------------------------

/**
 * Split text into sections based on Markdown/HTML headings.
 * Returns array of { heading, content, startLine, endLine } objects.
 * @param {string} text
 * @returns {{ heading: string|null, level: number, content: string, startLine: number, endLine: number }[]}
 */
function splitByHeadings(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentHeading = null;
  let currentLevel = 0;
  let currentStart = 0;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentLines.length > 0 || currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentLines.join('\n'),
          startLine: currentStart + 1, // 1-indexed
          endLine: i, // 1-indexed
        });
      }

      // Start new section
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentStart = i;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Last section
  if (currentLines.length > 0 || currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join('\n'),
      startLine: currentStart + 1,
      endLine: lines.length,
    });
  }

  // If no heading was found, treat whole text as one section
  if (sections.length === 0) {
    sections.push({
      heading: null,
      level: 0,
      content: text,
      startLine: 1,
      endLine: lines.length,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Paragraph-based splitting (fallback)
// ---------------------------------------------------------------------------

/**
 * Split text into chunks based on paragraph boundaries.
 * Used when no headings are detected.
 * @param {string} text
 * @param {number} maxSize
 * @param {number} overlap
 * @returns {{ heading: null, content: string, startLine: number, endLine: number, size: number }[]}
 */
function splitByParagraphs(text, maxSize, overlap) {
  // Split into paragraphs
  const paragraphs = text.split(PARAGRAPH_RE).filter(p => p.trim().length > 0);

  if (paragraphs.length === 0) {
    // Single block: split by maxSize
    return splitByCharCount(text, maxSize, overlap);
  }

  const lines = text.split('\n');
  const charCounts = paragraphs.map(p => p.length);
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  let startLineIdx = 0;
  let accumulatedChars = 0;  // to track line positions

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraSize = para.length;

    if (currentSize + paraSize > maxSize && currentChunk.length > 0) {
      // Finish current chunk
      const content = currentChunk.join('\n\n');
      const startLine = findLineNumber(lines, accumulatedChars - currentSize) + 1;
      const endLine = findLineNumber(lines, accumulatedChars) + 1;

      chunks.push({
        heading: null,
        content,
        startLine,
        endLine,
        size: content.length,
      });

      // Start new chunk with overlap
      // Keep last paragraphs that fit within overlap
      const overlapChars = [];
      let overlapSize = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const p = currentChunk[j];
        if (overlapSize + p.length <= overlap) {
          overlapChars.unshift(p);
          overlapSize += p.length;
        } else {
          break;
        }
      }

      currentChunk = [...overlapChars, para];
      currentSize = overlapSize + paraSize;

      // Find start line for new chunk (approximate)
      const before = overlapChars.join('\n\n').length;
      accumulatedChars += before + 2; // approximate
    } else {
      currentChunk.push(para);
      currentSize += paraSize;
    }

    accumulatedChars += paraSize + 2; // +2 for \n\n separator
  }

  // Last chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join('\n\n');
    const startLine = findLineNumber(lines, accumulatedChars - currentSize) + 1;

    chunks.push({
      heading: null,
      content,
      startLine,
      endLine: lines.length,
      size: content.length,
    });
  }

  return chunks;
}

/**
 * Fallback: split by character count when even paragraphs aren't detectable.
 */
function splitByCharCount(text, maxSize, overlap) {
  const chunks = [];
  const totalChars = text.length;

  for (let pos = 0; pos < totalChars; pos += maxSize - overlap) {
    const end = Math.min(pos + maxSize, totalChars);
    const content = text.slice(pos, end);

    // Try to break at word boundary
    let breakPos = end;
    if (end < totalChars) {
      const nextSpace = text.indexOf(' ', end - 20);
      const nextNewline = text.indexOf('\n', end - 20);
      if (nextSpace > 0 && nextSpace < end + 20) breakPos = nextSpace + 1;
      if (nextNewline > 0 && nextNewline < end + 20) breakPos = nextNewline + 1;
    }

    const actualContent = text.slice(pos, breakPos);
    chunks.push({
      heading: null,
      content: actualContent.trim(),
      startLine: 1,
      endLine: 1,
      size: actualContent.length,
    });

    if (breakPos >= totalChars) break;
    pos = breakPos - overlap;
  }

  return chunks;
}

/**
 * Find line number for a character position in a text.
 */
function findLineNumber(lines, charPos) {
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    pos += lines[i].length + 1; // +1 for the \n
    if (pos > charPos) return i;
  }
  return lines.length - 1;
}

// ---------------------------------------------------------------------------
// Main chunking function
// ---------------------------------------------------------------------------

/**
 * Chunk text content by heading boundaries.
 * 
 * Pipeline position: LAST step.
 *   fetch → clean (Readability) → markdown (Turndown) → chunk
 * 
 * @param {string} text - The text content to chunk
 * @param {object} [options]
 * @param {number} [options.maxChunkSize=2000] - Maximum chars per chunk
 * @param {number} [options.chunkOverlap=200] - Overlap chars between chunks
 * @param {number} [options.minChunkSize=300] - Minimum chars per chunk
 * @returns {{ heading: string|null, content: string, startLine: number, endLine: number, size: number }[]}
 */
function chunkContent(text, options = {}) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const opts = { ...DEFAULTS, ...options };
  const { maxChunkSize, chunkOverlap } = opts;

  // Step 1: Split by headings
  const sections = splitByHeadings(text);

  // Step 2: If no heading structure, use paragraph-based fallback
  const hasHeadings = sections.some(s => s.heading !== null);
  if (!hasHeadings) {
    return splitByParagraphs(text, maxChunkSize, chunkOverlap);
  }

  // Step 3: Merge small sections and split large ones
  const chunks = [];
  let buffer = [];
  let bufferSize = 0;
  let bufferHeading = null;
  let bufferStartLine = 1;

  for (const section of sections) {
    const sectionSize = section.content.length;

    // If the section itself is larger than maxChunkSize, split it
    if (sectionSize > maxChunkSize) {
      // Flush buffer first
      if (buffer.length > 0) {
        flushBuffer(chunks, buffer, bufferHeading, bufferStartLine, section.startLine - 1);
        buffer = [];
        bufferSize = 0;
      }

      // Split the large section further by paragraphs
      const subChunks = splitByParagraphs(section.content, maxChunkSize, chunkOverlap);
      for (const sc of subChunks) {
        chunks.push({
          heading: section.heading || bufferHeading,
          content: sc.content,
          startLine: section.startLine,
          endLine: section.endLine,
          size: sc.content.length,
        });
      }
      bufferStartLine = section.endLine + 1;
      continue;
    }

    // If adding this section would exceed maxChunkSize, flush buffer
    if (bufferSize + sectionSize > maxChunkSize && buffer.length > 0) {
      flushBuffer(chunks, buffer, bufferHeading, bufferStartLine, section.startLine - 1);
      buffer = [];
      bufferSize = 0;
      bufferStartLine = section.startLine;

      // Add section content to new buffer (without heading text)
      buffer.push(section.content);
      bufferSize += sectionSize;
      bufferHeading = section.heading;
    } else {
      // Add to buffer
      if (buffer.length === 0) {
        bufferHeading = section.heading;
        bufferStartLine = section.startLine;
      }
      buffer.push(section.content);
      bufferSize += sectionSize;
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    flushBuffer(chunks, buffer, bufferHeading, bufferStartLine, sections[sections.length - 1]?.endLine || 0);
  }

  return chunks;
}

/**
 * Helper: flush accumulated sections into a single chunk.
 */
function flushBuffer(chunks, buffer, heading, startLine, endLine) {
  if (buffer.length === 0) return;
  const content = buffer.join('\n\n');
  const size = content.length;

  // Skip chunks that are too small (unless it's the only chunk)
  if (size < DEFAULTS.minChunkSize && chunks.length > 0) {
    // Merge into previous chunk
    const prev = chunks[chunks.length - 1];
    prev.content = prev.content + '\n\n' + content;
    prev.size = prev.content.length;
    prev.endLine = endLine;
    return;
  }

  chunks.push({
    heading,
    content,
    startLine,
    endLine,
    size,
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    text: '',
    file: '',
    maxChunkSize: DEFAULTS.maxChunkSize,
    chunkOverlap: DEFAULTS.chunkOverlap,
    format: 'text', // text | json
    analyze: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--text':
        opts.text = args[++i];
        break;
      case '--file':
        opts.file = args[++i];
        break;
      case '--max-chunk-size':
        opts.maxChunkSize = parseInt(args[++i], 10);
        break;
      case '--chunk-overlap':
        opts.chunkOverlap = parseInt(args[++i], 10);
        break;
      case '--format':
        opts.format = args[++i];
        break;
      case '--analyze':
        opts.analyze = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node chunker.mjs [options]

Options:
  --text <text>             Text content to chunk
  --file <path>             Read text content from file
  --max-chunk-size <n>      Max chars per chunk (default: 2000)
  --chunk-overlap <n>       Overlap between chunks (default: 200)
  --format <text|json>      Output format (default: text)
  --analyze                 Show content analysis only (no chunking)
  -h, --help                Show this help

Examples:
  node chunker.mjs --text "## Section 1\\ncontent..." --format json
  node chunker.mjs --file article.txt --max-chunk-size 1000
  node chunker.mjs --text "..." --analyze
`);
}

async function main() {
  const opts = parseArgs();

  let text = opts.text;
  if (opts.file) {
    if (!existsSync(opts.file)) {
      console.error(`Error: File not found: ${opts.file}`);
      process.exit(1);
    }
    text = readFileSync(opts.file, 'utf-8');
  }

  if (!text) {
    console.error('Error: Provide --text or --file');
    process.exit(1);
  }

  if (opts.analyze) {
    const quality = analyzeContent(text, { clean: true, markdown: true, maxChars: opts.maxChunkSize });
    console.log(JSON.stringify(quality, null, 2));
    return;
  }

  const chunks = chunkContent(text, {
    maxChunkSize: opts.maxChunkSize,
    chunkOverlap: opts.chunkOverlap,
  });

  const validation = validateChunks(chunks);

  if (opts.format === 'json') {
    const output = {
      chunks,
      validation,
      _meta: analyzeContent(text, { chunked: chunks.length, maxChars: opts.maxChunkSize }),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      console.log(`--- Chunk ${i + 1}/${chunks.length}${c.heading ? `: ${c.heading}` : ''} (${c.size} chars) ---`);
      console.log(c.content);
      console.log('');
    }
    console.log(`--- Summary: ${chunks.length} chunks, ${validation.totalChars} total chars ---`);
    if (validation.warnings.length > 0) {
      console.log(`--- Warnings: ${validation.warnings.join('; ')} ---`);
    }
  }
}

// Run CLI if executed directly
// Must check exact basename to avoid false positive from test files (test-chunker.mjs)
const IS_CLI = process.argv[1] && (process.argv[1].endsWith('/chunker.mjs') || process.argv[1].endsWith('/chunker'));
if (IS_CLI) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export {
  chunkContent,
  validateChunks,
  analyzeContent,
  splitByHeadings,
  splitByParagraphs,
};
