#!/usr/bin/env node

// exa-search.mjs — Exa Web Search & Crawl CLI
//
// Dual-mode: REST API (with EXA_API_KEY) or MCP free tier (no key required)
// - With key: calls https://api.exa.ai directly (full speed, no rate limit)
// - Without key: calls https://mcp.exa.ai/mcp via JSON-RPC (free tier, rate-limited)
//
// Usages:
//   node exa-search.mjs search <query> [options]
//   node exa-search.mjs crawl <url> [url...]
//   node exa-search.mjs code <query> [options]
//
// Options:
//   --num-results <n>     Number of results (default: 10)
//   --max-chars <n>       Max characters per result (default: 3000)
//   --format <fmt>        Output: text, json (default: text)
//   --no-color            Disable color output
//   --fetch-only          Force native HTTP fetch (skip Exa, no API key needed)
//   --no-cache            Bypass cache
//   --caveman             Apply Caveman compression (strip grammar, keep facts)
//   --caveman auto        Auto mode: auto-upgrade compression + auto-increase maxChars
//   --caveman-level <lvl> Compression level: light, semantic, aggressive (default: semantic)
//   -h, --help            Show this help

const EXA_API_KEY = process.env.EXA_API_KEY || '';
const hasApiKey = !!EXA_API_KEY;

// Caching layer (zero-dependency, node:sqlite)
import { get as cacheGet, set as cacheSet, makeKey as cacheKey } from './lib/cache.mjs';

// Semantic chunking (zero-dependency, pure code)
import { chunkContent, validateChunks, analyzeContent } from './lib/chunker.mjs';

// Adaptive crawler (optional, dynamic import — Crawlee needed for --crawlee mode)
import { smartFetch } from './lib/crawler.mjs';

// Stealth fetch (TLS impersonation + browser stealth — optional dep: impers)
import { stealthFetch } from './lib/stealth.mjs';

// Caveman semantic compression (zero-dependency, pure code)
import { compress as cavemanCompress } from './lib/caveman.mjs';

const API_BASE = 'https://api.exa.ai';
// Include ?tools= to enable non-default tools (get_code_context_exa, etc.)
const MCP_TOOLS_PARAM = 'web_search_advanced_exa,web_search_exa,get_code_context_exa,web_fetch_exa';
const MCP_BASE = `https://mcp.exa.ai/mcp?tools=${MCP_TOOLS_PARAM}`;

// MCP tool mapping for free tier fallback
const MCP_TOOLS = {
  search: 'web_search_advanced_exa',
  crawl:  'web_fetch_exa',
  code:   'get_code_context_exa',
};

// ---------------------------------------------------------------------------
// Helpers — REST API mode
// ---------------------------------------------------------------------------

function getKey() {
  if (!EXA_API_KEY) {
    console.error('Error: EXA_API_KEY environment variable is not set.');
    console.error('Set it with: export EXA_API_KEY=your_key_here');
    console.error('Fallback: using free MCP tier (rate-limited).');
    process.exit(1);
  }
  return EXA_API_KEY;
}

async function exaFetch(endpoint, body) {
  const key = getKey();
  const url = `${API_BASE}${endpoint}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Exa API error (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Helpers — MCP free tier mode
// ---------------------------------------------------------------------------

/**
 * Parse SSE (Server-Sent Events) response and extract JSON-RPC messages
 * Exa MCP uses Streamable HTTP transport → returns SSE responses
 */
function parseSseResponse(text) {
  // SSE format: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n');
  const events = [];
  let currentEvent = null;
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData += line.slice(6);
    } else if (line === '' && currentData) {
      // End of event
      try {
        events.push(JSON.parse(currentData));
      } catch { /* skip malformed */ }
      currentData = '';
      currentEvent = null;
    }
  }
  // Handle trailing data
  if (currentData) {
    try { events.push(JSON.parse(currentData)); } catch { /* skip */ }
  }
  return events;
}

/**
 * Call Exa MCP server via JSON-RPC (free tier, no API key needed)
 * Handles both JSON and SSE (Streamable HTTP) responses.
 */
async function mcpToolCall(tool, args) {
  const resp = await fetch(MCP_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) {
      throw new Error('Exa free tier rate limit exceeded. Try again later or set EXA_API_KEY for higher limits.');
    }
    throw new Error(`Exa MCP error (${resp.status}): ${text}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const rawText = await resp.text();

  let data;
  if (contentType.includes('text/event-stream')) {
    // SSE response — parse events, find the result event
    const events = parseSseResponse(rawText);
    data = events.find(e => e.id === '1') || events[0] || {};
  } else {
    // JSON response
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Exa MCP error: unexpected response format.\n${rawText.slice(0, 500)}`);
    }
  }

  if (data.error) {
    throw new Error(`Exa MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  // Extract text content from MCP response
  const result = data.result || {};
  const text = (result.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
  return text;
}

/**
 * Unified dispatch for MCP free tier mode
 * Maps CLI commands → MCP tool calls
 */
async function callMcp(command, cmdArgs, opts) {
  const tool = MCP_TOOLS[command];
  if (!tool) throw new Error(`Unknown command: ${command}`);

  let mcpArgs = {};

  switch (command) {
    case 'search':
    case 'code': {
      if (cmdArgs.length === 0) throw new Error(`${command} requires a query`);
      const query = cmdArgs.join(' ');
      mcpArgs = {
        query,
        numResults: opts.numResults || (command === 'code' ? 8 : 10),
        maxCharacters: opts.maxChars || 5000,
      };
      // Advanced search options (MCP free tier supported)
      if (command === 'search') {
        if (opts.searchType) mcpArgs.type = opts.searchType;
        if (opts.category) mcpArgs.category = opts.category;
        if (opts.highlights) {
          mcpArgs.enableHighlights = true;
          mcpArgs.highlightsMaxCharacters = opts.maxChars || 500;
        }
        if (opts.includeDomains) mcpArgs.includeDomains = opts.includeDomains;
        if (opts.excludeDomains) mcpArgs.excludeDomains = opts.excludeDomains;
        if (opts.startDate) mcpArgs.startPublishedDate = opts.startDate;
        if (opts.endDate) mcpArgs.endPublishedDate = opts.endDate;
      }
      break;
    }
    case 'crawl': {
      if (cmdArgs.length === 0) throw new Error('crawl requires at least one URL');
      const urls = cmdArgs.filter(u => u && !u.startsWith('--'));
      if (urls.length === 0) throw new Error('crawl requires at least one URL');
      // web_fetch_exa accepts array of URLs; pass as JSON string for safety
      mcpArgs = {
        urls,
        maxCharacters: opts.maxChars || 3000,
      };
      break;
    }
  }

  const text = await mcpToolCall(tool, mcpArgs);

  // Apply caveman compression if enabled (MCP free tier path)
  const compressed = applyCaveman(text, opts);

  if (opts.format === 'json') {
    return JSON.stringify({ mode: 'free', tool, args: mcpArgs, results: compressed }, null, 2);
  }
  return compressed;
}

// ---------------------------------------------------------------------------
// Playwright Rendering (optional — lazy load, not a hard dependency)
// ---------------------------------------------------------------------------

/**
 * Render a JS-heavy page with Playwright and extract text content.
 * Uses dynamic import so playwright is NOT a hard dependency.
 * @param {string} url - The URL to render
 * @returns {Promise<string>} - Rendered text content
 */
async function renderWithPlaywright(url) {
  let playwright;
  try {
    // Dynamic import — fails gracefully if playwright not installed
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'Playwright is required for --render mode.\n' +
      'Install it with: npm install playwright\n' +
      'Or use without --render for static HTML content.'
    );
  }

  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Use 'domcontentloaded' (not 'networkidle') — works for streaming/SPA sites
    // that keep making requests (ads, analytics, video). Then wait for JS to settle.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Give JS-rendered content time to appear
    await page.waitForTimeout(3000);
    // Extract all visible text
    const text = await page.evaluate(() => document.body.innerText);
    return text;
  } finally {
    await browser.close();
  }
}

/**
 * Check if content appears to be truncated (ends mid-sentence).
 * @param {string} text
 * @returns {boolean}
 */
function isContentTruncated(text) {
  if (!text || text.length < 100) return false;
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  // Check the last non-empty line
  const lastLine = trimmed.split('\n').filter(l => l.trim()).pop() || '';
  // Content likely truncated if it ends mid-sentence
  // (no sentence-ending punctuation and no newline after it)
  const endsProperly = /[.!?)\n]\s*$/.test(lastLine);
  return !endsProperly;
}

/**
 * Truncate text to maxChars, preserving semantic boundaries (paragraph > sentence > word).
 * Smart truncation attempts to break at natural boundaries to maintain meaning.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateTo(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  
  const truncated = text.slice(0, maxChars);
  
  // 1. Try paragraph boundary (double newline) — best for preserving topics
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxChars * 0.7) {
    return truncated.slice(0, lastParagraph) + '\n\n[Content truncated at paragraph boundary]';
  }
  
  // 2. Try sentence boundary (period/question/exclamation followed by space)
  // Support both Western (.!?) and CJK (。！？) punctuation
  const sentenceEndRegex = /[.!?。！？]\s*$/;
  const lastSentence = truncated.search(sentenceEndRegex);
  if (lastSentence > maxChars * 0.6) {
    return truncated.slice(0, lastSentence + 1) + '\n\n[Content truncated at sentence boundary]';
  }
  
  // 3. Fallback: word boundary (existing behavior)
  return truncated.replace(/\s+\S*$/, '') + '\n\n[Content truncated at word boundary]';
}

/**
 * Analyze content volume of search results to determine optimal compression and snippet length.
 * Auto-detects content density and adjusts settings accordingly.
 * @param {Array} results - Search results array
 * @param {object} opts - Options parameters
 * @returns {object} { compressionLevel, snippetLength, avgCharsPerResult, totalChars }
 */
function analyzeContentVolume(results, opts) {
  const numResults = results.length || 1;
  const maxChars = opts.maxChars || 8000;
  
  // Calculate total content volume
  let totalChars = 0;
  for (const r of results) {
    if (r.text) {
      totalChars += r.text.replace(/\s+/g, ' ').trim().length;
    }
  }
  
  // Calculate average content per result
  const avgCharsPerResult = totalChars / numResults;
  
  // Determine compression level based on content density
  let compressionLevel = opts.cavemanLevel || 'semantic';
  if (opts.caveman === 'auto' || opts.caveman) {
    if (avgCharsPerResult > 3000) {
      compressionLevel = 'aggressive';  // High density: heavy compression
    } else if (avgCharsPerResult > 1500) {
      compressionLevel = 'semantic';    // Medium density: medium compression
    } else {
      compressionLevel = 'light';       // Low density: light compression
    }
  }
  
  // Snippet length: each result gets up to maxChars (API already limits per-result)
  let snippetLength = maxChars;
  
  // Adjust based on content density (how much raw content Exa returned)
  if (avgCharsPerResult > 3000) {
    // Rich content: show full maxChars
    snippetLength = maxChars;
  } else if (avgCharsPerResult > 1500) {
    // Medium: show 80% of maxChars
    snippetLength = Math.floor(maxChars * 0.8);
  } else {
    // Sparse: show 60% of maxChars
    snippetLength = Math.floor(maxChars * 0.6);
  }
  
  // Apply bounds (500-10000 chars per result)
  snippetLength = Math.max(500, Math.min(10000, snippetLength));
  
  return {
    compressionLevel,
    snippetLength,
    avgCharsPerResult,
    totalChars,
    numResults,
  };
}

/**
 * Apply Caveman compression to text output if enabled.
 * Supports auto mode: detects content length and auto-upgrades compression level.
 * @param {string} text - The text to potentially compress
 * @param {object} opts - Options with caveman/cavemanLevel/maxChars
 * @returns {string} - Compressed or original text
 */
function applyCaveman(text, opts) {
  if (!text) return text;
  
  // Auto mode: detect content length and upgrade compression if needed
  if (opts.caveman === 'auto') {
    const maxChars = opts.maxChars || 8000;  // Updated default
    const ratio = text.length / maxChars;
    
    // Dynamically adjust compression level based on ratio
    let targetLevel = opts.cavemanLevel || 'semantic';
    
    if (ratio > 1.2) {
      // Content exceeds maxChars by 120%: use ultra compression
      targetLevel = 'ultra';
    } else if (ratio > 0.8) {
      // Content exceeds maxChars by 80%: upgrade one level
      const levels = ['light', 'semantic', 'aggressive', 'ultra'];
      const currentIdx = levels.indexOf(targetLevel);
      if (currentIdx < levels.length - 1) {
        targetLevel = levels[currentIdx + 1];
      }
    } else if (ratio < 0.5) {
      // Content is less than 50% of maxChars: downgrade one level (save tokens)
      const levels = ['light', 'semantic', 'aggressive', 'ultra'];
      const currentIdx = levels.indexOf(targetLevel);
      if (currentIdx > 0) {
        targetLevel = levels[currentIdx - 1];
      }
    }
    
    const result = cavemanCompress(text, targetLevel);
    return result.text;
  }
  
  // Manual mode: apply specified level (or default semantic)
  if (!opts.caveman) return text;
  const level = opts.cavemanLevel || 'semantic';
  const result = cavemanCompress(text, level);
  return result.text;
}

// ---------------------------------------------------------------------------
// Content cleanup pipeline (Readability + Turndown)
// Both use dynamic import — not hard dependencies.
// ---------------------------------------------------------------------------

/**
 * Extract clean article content from HTML using Mozilla Readability.
 * @param {string} html - Raw HTML string
 * @param {string} [url] - Optional URL for base resolution
 * @returns {Promise<{title: string|null, content: string|null, textContent: string|null}>}
 */
async function cleanHtml(html, url) {
  let linkedom;
  try {
    linkedom = await import('linkedom');
  } catch {
    throw new Error(
      'linkedom is required for --clean mode.\n' +
      'Install it with: npm install linkedom\n' +
      'Or use without --clean for raw content.'
    );
  }

  let Readability;
  try {
    Readability = (await import('@mozilla/readability')).Readability;
  } catch {
    throw new Error(
      '@mozilla/readability is required for --clean mode.\n' +
      'Install it with: npm install @mozilla/readability\n' +
      'Then also: npm install linkedom\n' +
      'Or use without --clean for raw content.'
    );
  }

  const { document } = linkedom.parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    // Readability couldn't extract an article; return stripped text instead
    return {
      title: null,
      content: null,
      textContent: html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  return {
    title: article.title || null,
    content: article.content || null,    // HTML format
    textContent: article.textContent || null,  // Plain text format
  };
}

/**
 * Convert HTML to Markdown using Turndown.
 * @param {string} html - HTML string
 * @returns {Promise<string>} - Markdown string
 */
async function htmlToMarkdown(html) {
  let turndown;
  try {
    turndown = (await import('turndown')).default;
  } catch {
    throw new Error(
      'turndown is required for --markdown mode.\n' +
      'Install it with: npm install turndown\n' +
      'Or use without --markdown for raw content.'
    );
  }

  const service = new turndown({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
  });

  return service.turndown(html);
}

// ---------------------------------------------------------------------------
// Curl-like advanced fetch helpers
// ---------------------------------------------------------------------------

/**
 * Status codes eligible for automatic retry (server errors / rate limit).
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Build fetch headers from opts (merges curl-like options into defaults).
 * @param {object} opts
 * @returns {object} headers object
 */
function buildCustomHeaders(opts = {}) {
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  // User-Agent: custom > default
  headers['User-Agent'] = opts.userAgent
    || 'Mozilla/5.0 (compatible; Smart-MCP/1.0; +https://github.com/wclin/smart-mcp)';
  // Cookie
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  // Referer
  if (opts.referer) headers['Referer'] = opts.referer;
  // Basic Auth
  if (opts.auth) {
    const b64 = Buffer.from(opts.auth).toString('base64');
    headers['Authorization'] = `Basic ${b64}`;
  }
  // Custom headers (merged last, can override defaults)
  if (opts.headers && typeof opts.headers === 'object') {
    Object.assign(headers, opts.headers);
  }
  return headers;
}

/**
 * Build fetch options for a single attempt.
 * Handles: timeout, connectTimeout, followRedirects, maxRedirects, proxy, method, body, insecure, resolve.
 * @param {string} url
 * @param {object} opts
 * @returns {object} fetch options
 */
function buildFetchOpts(url, opts = {}) {
  const headers = buildCustomHeaders(opts);
  const method = opts.method || 'GET';

  const fetchOpts = {
    method,
    headers,
    redirect: opts.followRedirects === false ? 'manual' : 'follow',
  };

  // Timeout: prefer connectTimeout for connection phase, timeout for overall
  const timeoutMs = opts.timeout || 15000;
  const connectMs = opts.connectTimeout || 5000;
  // Use the shorter of the two for the signal (simplified; real connect-timeout needs a different approach)
  fetchOpts.signal = AbortSignal.timeout(Math.min(timeoutMs, connectMs > 0 ? connectMs + timeoutMs : timeoutMs));

  // Body (for POST/PUT/PATCH)
  if (opts.body && method !== 'GET' && method !== 'HEAD') {
    fetchOpts.body = opts.body;
    // Auto-set Content-Type if not already in headers
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  // Proxy support via undici (dynamic import)
  if (opts.proxy) {
    fetchOpts._proxy = opts.proxy; // Used by proxyFetch wrapper
  }

  // DNS resolve override
  if (opts.resolve) {
    fetchOpts._resolve = opts.resolve; // Used by resolveFetch wrapper
  }

  // TLS insecure mode
  if (opts.insecure) {
    fetchOpts._insecure = true; // Used by proxyFetch wrapper
  }

  return fetchOpts;
}

/**
 * Execute a fetch with proxy/resolve/insecure support via undici (dynamic import).
 * Falls back to native fetch if undici is not available or not needed.
 * @param {string} url
 * @param {object} fetchOpts - options from buildFetchOpts
 * @returns {Promise<Response>}
 */
async function smartFetchWithProxy(url, fetchOpts) {
  const needsUndici = fetchOpts._proxy || fetchOpts._resolve || fetchOpts._insecure;

  if (!needsUndici) {
    // Native fetch — zero deps
    return fetch(url, fetchOpts);
  }

  // Dynamic import undici (not a hard dependency)
  let undici;
  try {
    undici = await import('undici');
  } catch {
    throw new Error(
      'undici is required for --proxy / --resolve / --insecure modes.\n' +
      'Install it with: npm install undici\n' +
      'Or remove --proxy / --resolve / --insecure to use native fetch.'
    );
  }

  const undiciOpts = {
    method: fetchOpts.method,
    headers: fetchOpts.headers,
    body: fetchOpts.body,
    maxRedirections: fetchOpts.maxRedirects ?? 10,
  };

  // Proxy dispatcher
  if (fetchOpts._proxy) {
    const { ProxyAgent } = undici;
    undiciOpts.dispatcher = new ProxyAgent(fetchOpts._proxy);
  }

  // TLS insecure via dispatcher options
  if (fetchOpts._insecure) {
    undiciOpts.dispatcher = undiciOpts.dispatcher || new undici.Agent({
      connect: { rejectUnauthorized: false },
    });
    if (undiciOpts.dispatcher instanceof undici.Agent) {
      undiciOpts.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
    }
  }

  const resp = await undici.fetch(url, undiciOpts);
  return resp;
}

/**
 * Execute fetch with automatic retry (exponential backoff).
 * Retries on network errors + HTTP 429/502/503/504.
 * @param {string} url
 * @param {object} opts - all fetch options
 * @returns {Promise<{response: Response, attempts: number}>}
 */
async function fetchWithRetry(url, opts = {}) {
  const maxRetries = opts.retry || 0;
  const baseDelay = opts.retryDelay || 1000;
  const fetchOpts = buildFetchOpts(url, opts);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await smartFetchWithProxy(url, fetchOpts);
      // Check retryable status codes
      if (RETRYABLE_STATUS.has(resp.status) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return { response: resp, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      // AbortError / TimeoutError are retryable
      const isRetryable = err.name === 'AbortError'
        || err.name === 'TimeoutError'
        || err.message?.includes('ECONNRESET')
        || err.message?.includes('ECONNREFUSED')
        || err.message?.includes('fetch failed');
      if (isRetryable && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Native fetch crawl (zero deps, no API key needed)
// ---------------------------------------------------------------------------

/**
 * Crawl a URL using native Node.js fetch with curl-like advanced options.
 * No API key required. Supports Readability + turndown via --clean / --markdown.
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.maxChars
 * @param {object} [opts.headers] - Custom HTTP headers
 * @param {string} [opts.cookie] - Cookie string
 * @param {string} [opts.referer] - Referer header
 * @param {string} [opts.userAgent] - Custom User-Agent
 * @param {number} [opts.retry] - Max retries (0 = no retry)
 * @param {number} [opts.retryDelay] - Retry delay in ms (default: 1000)
 * @param {number} [opts.timeout] - Transfer timeout in ms
 * @param {number} [opts.connectTimeout] - Connection timeout in ms
 * @param {boolean} [opts.followRedirects] - Follow redirects
 * @param {number} [opts.maxRedirects] - Max redirect hops
 * @param {string} [opts.proxy] - HTTP/SOCKS5 proxy URL
 * @param {string} [opts.method] - HTTP method
 * @param {string} [opts.body] - Request body
 * @param {string} [opts.auth] - Basic auth "user:pass"
 * @param {string} [opts.resolve] - DNS override "domain:port:ip"
 * @param {boolean} [opts.headersOnly] - Only fetch response headers
 * @param {boolean} [opts.insecure] - Skip TLS verification
 * @returns {Promise<{text: string, isHtml: boolean, engine?: string, responseHeaders?: object, attempts?: number}>}
 */
async function fetchCrawl(url, opts = {}) {
  // --crawlee mode: use Crawlee AdaptivePlaywrightCrawler
  if (opts.crawlee) {
    const result = await smartFetch(url, { crawlee: true, timeout: opts.maxChars ? 60000 : 30000 });
    if (result) {
      const contentType = result.html.includes('<html') || result.html.includes('<div') || result.html.includes('<body')
        ? 'text/html' : 'text/plain';
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
      const maxChars = opts.maxChars || 8000;
      return { text: result.html.substring(0, maxChars), isHtml, engine: result.engine };
    }
    // Fall through to native fetch
  }

  // Execute fetch with retry support
  const { response: resp, attempts } = await fetchWithRetry(url, opts);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}${resp.statusText ? ': ' + resp.statusText : ''}`);
  }

  // --headers-only mode: return response headers only
  if (opts.headersOnly) {
    const respHeaders = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    return {
      text: JSON.stringify({ status: resp.status, headers: respHeaders }, null, 2),
      isHtml: false,
      responseHeaders: respHeaders,
      attempts,
    };
  }

  const contentType = resp.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
  const rawText = await resp.text();
  const maxChars = opts.maxChars || 8000;

  // Collect response headers for JSON output
  const respHeaders = {};
  resp.headers.forEach((v, k) => { respHeaders[k] = v; });

  return { text: rawText, isHtml, responseHeaders: respHeaders, attempts };
}

/**
 * Fetch raw HTML from a URL (used by --clean pipeline).
 * @param {string} url
 * @returns {Promise<string>} raw HTML text
 */
async function fetchHtml(url) {
  const { text } = await fetchCrawl(url);
  return text;
}

/**
 * Process fetched content through the cleanup pipeline:
 * Raw HTML → [--clean: Readability] → [--markdown: turndown] → final text
 * @param {string} rawHtml - Raw HTML from fetch
 * @param {boolean} isHtml - Whether the content is HTML
 * @param {object} opts
 * @param {boolean} opts.clean - Apply Readability extraction
 * @param {boolean} opts.markdown - Convert to Markdown
 * @param {string} [opts.url] - Original URL for Readability
 * @param {number} opts.maxChars - Max chars
 * @returns {Promise<string>} - Processed text content
 */
async function processContent(rawHtml, isHtml, opts = {}) {
  const maxChars = opts.maxChars || 8000;

  // --- Not HTML: just truncate and return ---
  if (!isHtml) {
    return truncateTo(rawHtml, maxChars);
  }

  // --- Clean pipeline: Readability extraction ---
  if (opts.clean) {
    const article = await cleanHtml(rawHtml, opts.url);
    const textContent = article.textContent || '';
    const title = article.title || '';

    if (opts.markdown && article.content) {
      // Clean + Markdown: Readability HTML → turndown → final text
      const md = await htmlToMarkdown(article.content);
      const header = title ? `# ${title}\n\n` : '';
      return truncateTo(header + md, maxChars);
    }

    if (opts.markdown && !article.content) {
      // Readability couldn't extract, but user wants markdown: convert stripped HTML
      const md = await htmlToMarkdown(`<p>${article.textContent}</p>`);
      return truncateTo(md, maxChars);
    }

    // Clean only: return plain text from Readability
    const text = title ? `${title}\n\n${textContent}` : textContent;
    return truncateTo(text, maxChars);
  }

  // --- Markdown only (no clean) ---
  if (opts.markdown) {
    const md = await htmlToMarkdown(rawHtml);
    return truncateTo(md, maxChars);
  }

  // --- No cleaning, no markdown: strip basic tags ---
  const stripped = rawHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateTo(stripped, maxChars);
}

/**
 * Check if a URL is fetchable (non-binary content).
 */
function isFetchableUrl(url) {
  const binaryExts = /\.(pdf|zip|gz|tar|bz2|png|jpg|jpeg|gif|webp|ico|mp4|mp3|avi|mov|exe|dmg|bin)$/i;
  return !binaryExts.test(url);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Web search
 */
async function cmdSearch(query, opts) {
  // Auto-adjust maxChars: when caveman compression is enabled, request more content
  let effectiveMaxChars = opts.maxChars || 8000;  // Increased default
  
  if (opts.caveman && !opts.maxChars) {
    // Caveman enabled + no explicit maxChars → increase by 100% to get more raw content
    effectiveMaxChars = Math.min(effectiveMaxChars * 2.0, 20000);
  }
  
  const body = {
    query,
    numResults: opts.numResults || 10,
    type: opts.searchType || 'auto',
    contents: {
      text: { maxCharacters: effectiveMaxChars },
    },
  };
  if (opts.category) body.category = opts.category;
  if (opts.includeDomains) body.includeDomains = opts.includeDomains;
  if (opts.excludeDomains) body.excludeDomains = opts.excludeDomains;
  if (opts.startDate) body.startPublishedDate = opts.startDate;
  if (opts.endDate) body.endPublishedDate = opts.endDate;
  if (opts.highlights) {
    body.contents.highlights = { maxCharacters: opts.maxChars || 500 };
  }

  const data = await exaFetch('/search', body);
  const results = data.results || [];

  if (opts.format === 'json') {
    return JSON.stringify({ query, results }, null, 2);
  }

  // Auto-detect content volume to determine optimal compression and snippet length
  const contentAnalysis = analyzeContentVolume(results, opts);
  
  // Update opts cavemanLevel based on content analysis
  const adjustedOpts = {
    ...opts,
    cavemanLevel: contentAnalysis.compressionLevel,
  };

  const lines = [];
  lines.push(`Search results for: "${query}"`);
  lines.push('='.repeat(60));
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title || 'Untitled'}`);
    lines.push(`   URL: ${r.url}`);
    if (r.author) lines.push(`   Author: ${r.author}`);
    if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
    if (r.text) {
      // Use dynamic snippet length (auto-adjusted based on content volume)
      const snippet = truncateTo(r.text.replace(/\s+/g, ' ').trim(), contentAnalysis.snippetLength);
      lines.push(`   ${snippet}`);
    }
    lines.push('');
  }
  
  // Add content analysis debug info if requested
  if (opts.debug) {
    lines.push('');
    lines.push('--- Content Analysis ---');
    lines.push(`Total chars: ${contentAnalysis.totalChars}`);
    lines.push(`Avg chars/result: ${Math.round(contentAnalysis.avgCharsPerResult)}`);
    lines.push(`Compression level: ${contentAnalysis.compressionLevel}`);
    lines.push(`Snippet length: ${contentAnalysis.snippetLength}`);
  }
  
  lines.push(`Total: ${results.length} result(s)`);
  return applyCaveman(lines.join('\n'), adjustedOpts);
}

/**
 * Crawl URLs using native HTTP fetch (zero deps, no API key).
 * Supports --no-cache to bypass cache, --extended for more content,
 * --clean for Readability extraction, --markdown for MD output.
 */
async function cmdCrawlFetch(urls, opts) {
  if (!urls || urls.length === 0) {
    return 'Error: At least one URL is required.\nUsage: node exa-search.mjs crawl <url> [url...]';
  }

  const results = [];

  for (const url of urls) {
    // --- Check cache first ---
    const cKey = cacheKey('crawl', url, opts);
    if (!opts.noCache) {
      const cached = cacheGet(cKey);
      if (cached) {
        results.push({ url, text: cached, cached: true });
        continue;
      }
    }

    try {
      if (!isFetchableUrl(url)) {
        throw new Error(`Skipped: URL appears to be a binary file (${url.match(/\.\w+$/)?.[0] || 'unknown'})`);
      }

      // Fetch raw HTML
      const { text: rawHtml, isHtml, engine: rEngine, responseHeaders, attempts } = await fetchCrawl(url, opts);

      // Process through cleanup pipeline (--clean, --markdown, or basic stripping)
      const text = await processContent(rawHtml, isHtml, { ...opts, url });

      // --- Step 3: Chunk (pipeline last step: clean → markdown → chunk) ---
      let chunks = null;
      let chunkMeta = null;
      if (opts.chunk && text) {
        chunks = chunkContent(text, { maxChunkSize: opts.maxChunkSize || 2000 });
        const validation = validateChunks(chunks);
        chunkMeta = { count: chunks.length, valid: validation.valid, totalChars: validation.totalChars };
      }

      // --- Store in cache ---
      if (!opts.noCache) {
        cacheSet(cKey, text, 300);
      }

      results.push({ url, text, cached: false, chunks, chunkMeta, responseHeaders, attempts, ...(rEngine ? { crawleeEngine: rEngine } : {}) });
    } catch (err) {
      results.push({ url, error: err.message });
    }
  }

  // --- JSON output ---
  if (opts.format === 'json') {
    const output = { mode: 'fetch', results };
      // Attach quality metadata for each result
      if (opts.chunk) {
        output._meta = results.filter(r => !r.error).map(r => ({
          url: r.url,
          chunks: r.chunkMeta?.count || 0,
          chars: r.text?.length || 0,
          clean: !!opts.clean,
          markdown: !!opts.markdown,
          chunked: true,
          ...(r.crawleeEngine ? { crawleeEngine: r.crawleeEngine } : {}),
        }));
      } else {
        // Generate _meta for non-chunked results (F.10 quality feedback)
        for (const r of results) {
          if (!r.error && r.text) {
            r._meta = analyzeContent(r.text, {
              engine: r.crawleeEngine || 'fetch',
              clean: !!opts.clean,
              markdown: !!opts.markdown,
              maxChars: opts.maxChars,
            });
          }
        }
      }
    return JSON.stringify(output, null, 2);
  }

  // --- Text output ---
  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`URL: ${r.url}`);
      lines.push('-'.repeat(60));
      lines.push(`(Fetch failed: ${r.error})`);
    } else {
      const modeTag = opts.clean
        ? (opts.markdown ? ', cleaned + markdown' : ', cleaned')
        : (opts.markdown ? ', markdown' : '');
      const chunkTag = opts.chunk ? `, ${r.chunkMeta?.count || 0} chunks` : '';
      const engineTag = r.crawleeEngine ? `, ${r.crawleeEngine}` : '';
      lines.push(`URL: ${r.url}${r.cached ? ' (cached)' : ` (fetch${modeTag}${chunkTag}${engineTag})`}`);
      lines.push('-'.repeat(60));

      if (opts.chunk && r.chunks && r.chunks.length > 0) {
        // Chunked output
        for (let i = 0; i < r.chunks.length; i++) {
          const c = r.chunks[i];
          const heading = c.heading ? `: ${c.heading}` : '';
          lines.push(`--- Chunk ${i + 1}/${r.chunks.length}${heading} (${c.size} chars) ---`);
          lines.push(c.content);
          lines.push('');
        }
        // Quality tip
        if (r.chunkMeta) {
          const meta = analyzeContent(r.text, {
            engine: 'fetch',
            clean: !!opts.clean,
            markdown: !!opts.markdown,
            chunked: r.chunkMeta.count,
          });
          if (meta._tip) lines.push(meta._tip);
        }
      } else {
        // Normal output
        lines.push(r.text);
        if (isContentTruncated(r.text)) {
          lines.push('');
          lines.push('(Content may be truncated; use --extended for more)');
        }
        // Quality tip for non-chunked content (F.10)
        if (!opts.chunk && r.text) {
          const meta = analyzeContent(r.text, {
            engine: 'fetch',
            clean: !!opts.clean,
            markdown: !!opts.markdown,
            maxChars: opts.maxChars,
          });
          if (meta._tip) {
            lines.push('');
            lines.push(meta._tip);
          }
        }
      }
    }
    lines.push('');
    lines.push('');
  }

  return applyCaveman(lines.join('\n'), opts);
}

/**
 * Crawl URLs with stealth anti-bot evasion mode.
 *
 * Uses two-layer stealth system (stealth.mjs):
 *   Layer 1: TLS impersonation via impers (curl-impersonate + BoringSSL)
 *   Layer 2: Stealth Playwright render (stealth JS injected)
 *
 * Supports the same --clean / --markdown / --chunk pipeline as cmdCrawlFetch.
 */
async function cmdCrawlStealth(urls, opts) {
  const results = [];

  for (const url of urls) {
    try {
      if (!isFetchableUrl(url)) {
        throw new Error(`Skipped: binary file (${url.match(/\.\w+$/)?.[0] || 'unknown'})`);
      }

      // Stealth fetch (TLS impersonation first, stealth Playwright fallback)
      const fetchResult = await stealthFetch(url, { stealth: true, timeout: opts.maxChars > 8000 ? 60000 : 30000 });

      if (!fetchResult) {
        throw new Error('Stealth fetch failed (install npm install impers for TLS impersonation)');
      }

      const rawHtml = fetchResult.html;
      const isHtml = true;
      const rEngine = fetchResult.engine;

      // Process through cleanup pipeline (--clean, --markdown, or basic stripping)
      const text = await processContent(rawHtml, isHtml, { ...opts, url });

      // Chunk (pipeline last step: clean → markdown → chunk)
      let chunks = null;
      let chunkMeta = null;
      if (opts.chunk && text) {
        chunks = chunkContent(text, { maxChunkSize: opts.maxChunkSize || 2000 });
        const validation = validateChunks(chunks);
        chunkMeta = { count: chunks.length, valid: validation.valid, totalChars: validation.totalChars };
      }

      results.push({ url, text, cached: false, chunks, chunkMeta, crawleeEngine: rEngine });
    } catch (err) {
      results.push({ url, error: err.message });
    }
  }

  // --- JSON output ---
  if (opts.format === 'json') {
    const output = { mode: 'stealth', results };
    if (opts.chunk) {
      output._meta = results.filter(r => !r.error).map(r => ({
        url: r.url,
        chunks: r.chunkMeta?.count || 0,
        chars: r.text?.length || 0,
        clean: !!opts.clean,
        markdown: !!opts.markdown,
        chunked: true,
        engine: r.crawleeEngine,
      }));
    } else {
      for (const r of results) {
        if (!r.error && r.text) {
          r._meta = analyzeContent(r.text, {
            engine: r.crawleeEngine || 'stealth',
            clean: !!opts.clean,
            markdown: !!opts.markdown,
            maxChars: opts.maxChars,
          });
        }
      }
    }
    return JSON.stringify(output, null, 2);
  }

  // --- Text output ---
  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`URL: ${r.url}`);
      lines.push('-'.repeat(60));
      lines.push(`(Stealth fetch failed: ${r.error})`);
    } else {
      const modeTag = opts.clean
        ? (opts.markdown ? ', cleaned + markdown' : ', cleaned')
        : (opts.markdown ? ', markdown' : '');
      const chunkTag = opts.chunk ? `, ${r.chunkMeta?.count || 0} chunks` : '';
      const engineTag = r.crawleeEngine ? `, ${r.crawleeEngine}` : '';
      lines.push(`URL: ${r.url} (stealth${modeTag}${chunkTag}${engineTag})`);
      lines.push('-'.repeat(60));

      if (opts.chunk && r.chunks && r.chunks.length > 0) {
        for (let i = 0; i < r.chunks.length; i++) {
          const c = r.chunks[i];
          const heading = c.heading ? `: ${c.heading}` : '';
          lines.push(`--- Chunk ${i + 1}/${r.chunks.length}${heading} (${c.size} chars) ---`);
          lines.push(c.content);
          lines.push('');
        }
        if (r.chunkMeta) {
          const meta = analyzeContent(r.text, {
            engine: 'stealth',
            clean: !!opts.clean,
            markdown: !!opts.markdown,
            chunked: r.chunkMeta.count,
          });
          if (meta._tip) lines.push(meta._tip);
        }
      } else {
        lines.push(r.text);
        if (isContentTruncated(r.text)) {
          lines.push('');
          lines.push('(Content may be truncated; use --extended for more)');
        }
        if (!opts.chunk && r.text) {
          const meta = analyzeContent(r.text, {
            engine: 'stealth',
            clean: !!opts.clean,
            markdown: !!opts.markdown,
            maxChars: opts.maxChars,
          });
          if (meta._tip) {
            lines.push('');
            lines.push(meta._tip);
          }
        }
      }
    }
    lines.push('');
    lines.push('');
  }

  return applyCaveman(lines.join('\n'), opts);
}

/**
 * Crawl / read URLs
 */
async function cmdCrawl(urls, opts) {
  if (!urls || urls.length === 0) {
    return 'Error: At least one URL is required.\nUsage: node exa-search.mjs crawl <url> [url...]';
  }

  // --- Render mode: use Playwright instead of Exa crawl ---
  if (opts.render) {
    const lines = [];
    for (const url of urls) {
      try {
        const text = await renderWithPlaywright(url);
        lines.push(`URL: ${url} (rendered)`);
        lines.push('-'.repeat(60));
        lines.push(text);
        if (isContentTruncated(text)) {
          lines.push('');
          lines.push('(Content may be truncated; use --extended for more)');
        }
      } catch (err) {
        lines.push(`URL: ${url}`);
        lines.push('-'.repeat(60));
        lines.push(`(Rendering failed: ${err.message})`);
      }
      lines.push('');
      lines.push('');
    }
    return applyCaveman(lines.join('\n'), opts);
  }

  // --- Standard Exa crawl ---
  // Auto-adjust maxChars: when caveman compression is enabled, request more content
  let effectiveMaxChars = opts.maxChars || 3000;
  if (opts.caveman && !opts.maxChars) {
    effectiveMaxChars = Math.min(effectiveMaxChars * 1.5, 12000);
  }
  const body = {
    urls: urls.map(u => ({ url: u, text: { maxCharacters: effectiveMaxChars } })),
  };

  const data = await exaFetch('/contents', body);
  const rawResults = data.results || [];

  // Process results (with optional chunking)
  const results = rawResults.map(r => {
    const entry = { url: r.url };
    if (r.text) {
      entry.text = r.text;
      // Chunk if requested (pipeline: Exa crawl → chunk)
      if (opts.chunk) {
        entry.chunks = chunkContent(r.text, { maxChunkSize: opts.maxChunkSize || 2000 });
        const validation = validateChunks(entry.chunks);
        entry.chunkMeta = { count: entry.chunks.length, valid: validation.valid, totalChars: validation.totalChars };
      }
    } else {
      entry.text = '(No content retrieved)';
    }
    return entry;
  });

  if (opts.format === 'json') {
    const output = { urls, results };
    // Quality metadata
    if (!opts.chunk) {
      for (const r of results) {
        if (r.text) {
          r._meta = analyzeContent(r.text, {
            engine: 'exa',
            clean: false,
            markdown: false,
            maxChars: opts.maxChars,
          });
        }
      }
    }
    return JSON.stringify(output, null, 2);
  }

  const lines = [];
  for (const r of results) {
    lines.push(`URL: ${r.url}`);
    lines.push('-'.repeat(60));
    if (opts.chunk && r.chunks && r.chunks.length > 0) {
      for (let i = 0; i < r.chunks.length; i++) {
        const c = r.chunks[i];
        const heading = c.heading ? `: ${c.heading}` : '';
        lines.push(`--- Chunk ${i + 1}/${r.chunks.length}${heading} (${c.size} chars) ---`);
        lines.push(c.content);
        lines.push('');
      }
      // Quality tip
      const meta = analyzeContent(r.text, { engine: 'exa', chunked: r.chunkMeta?.count });
      if (meta._tip) lines.push(meta._tip);
    } else if (r.text) {
      lines.push(r.text);
      if (isContentTruncated(r.text)) {
        lines.push('');
        lines.push('(Content may be truncated; use --extended for full content)');
      }
      // Quality tip
      const meta = analyzeContent(r.text, { engine: 'exa', maxChars: opts.maxChars });
      if (meta._tip) {
        lines.push('');
        lines.push(meta._tip);
      }
    } else {
      lines.push('(No content retrieved)');
    }
    lines.push('');
    lines.push('');
  }
  return applyCaveman(lines.join('\n'), opts);
}

/**
 * Crawl URLs using Playwright rendering (shared by REST API and MCP modes)
 */
async function cmdCrawlRendered(urls, opts) {
  if (!urls || urls.length === 0) {
    return 'Error: At least one URL is required.\nUsage: node exa-search.mjs crawl <url> [url...]';
  }

  const lines = [];
  for (const url of urls) {
    try {
      const text = await renderWithPlaywright(url);
      lines.push(`URL: ${url} (rendered)`);
      lines.push('-'.repeat(60));
      lines.push(text);
      if (isContentTruncated(text)) {
        lines.push('');
        lines.push('(Content may be truncated; use --extended for more)');
      }
    } catch (err) {
      lines.push(`URL: ${url}`);
      lines.push('-'.repeat(60));
      lines.push(`(Rendering failed: ${err.message})`);
    }
    lines.push('');
    lines.push('');
  }
  return applyCaveman(lines.join('\n'), opts);
}

/**
 * Code search
 */
async function cmdCode(query, opts) {
  // Auto-adjust maxChars: when caveman compression is enabled, request more content
  let effectiveMaxChars = opts.maxChars || 3000;
  if (opts.caveman && !opts.maxChars) {
    effectiveMaxChars = Math.min(effectiveMaxChars * 1.5, 10000);
  }
  
  const body = {
    query,
    numResults: opts.numResults || 8,
    type: opts.searchType || 'auto',
    category: 'code',
    contents: {
      text: { maxCharacters: effectiveMaxChars },
    },
  };

  const data = await exaFetch('/search', body);
  const results = data.results || [];

  if (opts.format === 'json') {
    return JSON.stringify({ query, results }, null, 2);
  }

  const lines = [];
  lines.push(`Code search results for: "${query}"`);
  lines.push('='.repeat(60));
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title || 'Untitled'}`);
    lines.push(`   URL: ${r.url}`);
    if (r.text) {
      const snippet = r.text.replace(/\s+/g, ' ').trim().substring(0, 300);
      lines.push(`   ${snippet}${snippet.length >= 300 ? '...' : ''}`);
    }
    lines.push('');
  }
  lines.push(`Total: ${results.length} result(s)`);
  return applyCaveman(lines.join('\n'), opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const cmdArgs = [];
  const opts = {
    numResults: 10,
    maxChars: 5000,
    format: 'text',
    render: false,
    extended: false,
    fetchOnly: false,
    noCache: false,
    clean: false,
    markdown: false,
    chunk: false,
    maxChunkSize: 2000,
    stealth: false,
    caveman: false,
    cavemanLevel: 'semantic',
    // Curl-like advanced options
    headers: {},
    cookie: undefined,
    referer: undefined,
    userAgent: undefined,
    retry: 0,
    retryDelay: 1000,
    timeout: 15000,
    connectTimeout: 5000,
    followRedirects: true,
    maxRedirects: 10,
    proxy: undefined,
    method: undefined,
    body: undefined,
    auth: undefined,
    resolve: undefined,
    headersOnly: false,
    insecure: false,
    // Advanced search options
    searchType: undefined,
    category: undefined,
    highlights: false,
    includeDomains: undefined,
    excludeDomains: undefined,
    startDate: undefined,
    endDate: undefined,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--num-results':
        opts.numResults = parseInt(args[++i], 10);
        break;
      case '--max-chars':
        opts.maxChars = parseInt(args[++i], 10);
        break;
      case '--render':
        opts.render = true;
        break;
      case '--extended':
        opts.extended = true;
        break;
      case '--fetch-only':
        opts.fetchOnly = true;
        break;
      case '--no-cache':
        opts.noCache = true;
        break;
      case '--clean':
        opts.clean = true;
        break;
      case '--markdown':
        opts.markdown = true;
        break;
      case '--chunk':
        opts.chunk = true;
        break;
      case '--crawlee':
        opts.crawlee = true;
        break;
      case '--stealth':
        opts.stealth = true;
        break;
      case '--caveman':
        // Check if next arg is 'auto' (positional)
        if (args[i + 1] === 'auto') {
          opts.caveman = 'auto';
          i++;  // skip 'auto'
        } else {
          opts.caveman = true;
        }
        break;
      case '--caveman-level':
        opts.cavemanLevel = args[++i];
        break;
      case '--max-chunk-size':
        opts.maxChunkSize = parseInt(args[++i], 10);
        break;
      case '--format':
        opts.format = args[++i];
        break;
      // Advanced search options
      case '--search-type':
        opts.searchType = args[++i];
        break;
      case '--category':
        opts.category = args[++i];
        break;
      case '--highlights':
        opts.highlights = true;
        break;
      case '--include-domains':
        opts.includeDomains = JSON.parse(args[++i]);
        break;
      case '--exclude-domains':
        opts.excludeDomains = JSON.parse(args[++i]);
        break;
      case '--start-date':
        opts.startDate = args[++i];
        break;
      case '--end-date':
        opts.endDate = args[++i];
        break;
      // Curl-like advanced options
      case '--header': {
        const hdr = args[++i];
        const colonIdx = hdr.indexOf(':');
        if (colonIdx > 0) {
          const key = hdr.slice(0, colonIdx).trim();
          const val = hdr.slice(colonIdx + 1).trim();
          opts.headers[key] = val;
        }
        break;
      }
      case '--cookie':
        opts.cookie = args[++i];
        break;
      case '--referer':
        opts.referer = args[++i];
        break;
      case '--user-agent':
        opts.userAgent = args[++i];
        break;
      case '--retry':
        opts.retry = parseInt(args[++i], 10);
        break;
      case '--retry-delay':
        opts.retryDelay = parseInt(args[++i], 10);
        break;
      case '--max-time':
        opts.timeout = parseInt(args[++i], 10);
        break;
      case '--connect-timeout':
        opts.connectTimeout = parseInt(args[++i], 10);
        break;
      case '--no-follow':
        opts.followRedirects = false;
        break;
      case '--max-redirs':
        opts.maxRedirects = parseInt(args[++i], 10);
        break;
      case '--proxy':
        opts.proxy = args[++i];
        break;
      case '--method':
        opts.method = args[++i];
        break;
      case '--body':
        opts.body = args[++i];
        break;
      case '--auth':
        opts.auth = args[++i];
        break;
      case '--resolve':
        opts.resolve = args[++i];
        break;
      case '--headers-only':
        opts.headersOnly = true;
        break;
      case '--insecure':
        opts.insecure = true;
        break;
      case '--no-color':
        // no-op, kept for interface parity
        break;
      default:
        if (!args[i].startsWith('--')) {
          cmdArgs.push(args[i]);
        }
        break;
    }
    i++;
  }

  return { command, args: cmdArgs, opts };
}

function printHelp() {
  const mode = hasApiKey ? 'REST API (full speed)' : 'MCP free tier (rate-limited)';
  console.log(`
Usage: node exa-search.mjs <command> [options]

Exa Web Search & Crawl Tool
Mode: ${mode}
${!hasApiKey ? 'Set EXA_API_KEY for full speed, no rate limits.' : ''}

Commands:
  search <query>        Web search
  crawl <url> [url...]  Read webpage content
  code <query>          Code/documentation search

Options:
  --num-results <n>     Number of results (default: 10)
  --max-chars <n>       Max characters per result
                        (crawl default: 8000, search/code: 3000)
  --extended            Extended mode — up to 30,000 chars per result
  --render              Render JS-heavy pages with Playwright (crawl only)
  --crawlee             Adaptive crawl via Crawlee (auto-detect static/JS, crawl only)
  --stealth             Anti-bot stealth mode: TLS impersonation + stealth browser
                        (bypasses Cloudflare/Akamai, optional dep: npm install impers)
  --fetch-only          Force native fetch (skip Exa, no API key, crawl only)
  --clean               Extract article body via Readability (crawl, removes nav/ads/footer)
  --markdown            Convert HTML to Markdown (crawl, LLM-friendly format)
  --chunk               Split long content by heading (crawl, saves LLM tokens)
  --max-chunk-size <n>  Max chars per chunk (default: 2000, with --chunk)
  --no-cache            Bypass cache
  --format <fmt>        Output: text, json (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Advanced Search (MCP free tier supported):
  --search-type <type>  Search type: auto (default), fast, instant
  --category <cat>      Category filter: company, people, research paper,
                        news, personal site, financial report, pdf, github
  --highlights          Enable highlights — 10x token efficient excerpts
  --include-domains [d] JSON array of domains to include (e.g. '["github.com"]')
  --exclude-domains [d] JSON array of domains to exclude
  --start-date <date>   Only results published after (YYYY-MM-DD)
  --end-date <date>     Only results published before (YYYY-MM-DD)

Caveman Compression (token savings):
  --caveman             Apply Caveman compression (strip grammar, keep facts)
  --caveman auto        Auto mode: auto-upgrade compression + auto-increase maxChars
  --caveman-level <lvl> Compression level: light, semantic, aggressive, ultra (default: semantic)

Curl-like Advanced Options (HTTP control):
  --header "K: V"      Custom HTTP header (curl -H), repeatable
  --cookie <str>       Cookie string (curl -b): "session=abc; token=xyz"
  --referer <url>      Referer header (curl -e): bypass hotlink protection
  --user-agent <str>   Custom User-Agent (curl -A), overrides default
  --retry <n>          Max retry on 429/502/503/504 (curl --retry), default: 0
  --retry-delay <ms>   Delay between retries (curl --retry-delay), default: 1000
  --max-time <ms>      Transfer timeout (curl --max-time), default: 15000
  --connect-timeout <ms> Connection timeout (curl --connect-timeout), default: 5000
  --no-follow          Don't follow redirects (curl --no-location)
  --max-redirs <n>     Max redirect hops (curl --max-redirs), default: 10
  --proxy <url>        HTTP/SOCKS5 proxy (curl -x), requires: npm install undici
  --method <method>    HTTP method (curl -X): GET, POST, HEAD, PUT, DELETE, PATCH
  --body <str>         Request body (curl -d) for POST/PUT/PATCH
  --auth <user:pass>   Basic auth (curl -u)
  --resolve <spec>     DNS override (curl --resolve): "domain:port:ip"
  --headers-only       Only fetch response headers (curl -I)
  --insecure           Skip TLS verification (curl -k)

Combinations:
  --clean --markdown    Best combo: Readability article → Markdown output
  --fetch-only --clean --markdown  Full offline: fetch + clean + MD (no API key)
  --clean --markdown --chunk  Full pipeline: article → Markdown → chunks
  --crawlee --clean --markdown  Adaptive crawl + article + MD (auto JS/static detection)

Examples:
  node exa-search.mjs search "React Server Components"
  node exa-search.mjs search "NVIDIA" --category company --highlights
  node exa-search.mjs search "MCP" --search-type fast --num-results 5
  node exa-search.mjs search "AI" --start-date 2025-01-01 --end-date 2025-12-31
  node exa-search.mjs search "Exa" --include-domains '["github.com"]'
  node exa-search.mjs crawl https://example.com/docs
  node exa-search.mjs code "Python fastapi middleware"
  node exa-search.mjs crawl https://example.com --clean --markdown
`);
}

async function main() {
  const { command, args: cmdArgs, opts } = parseArgs();

  // --- Per-command default adjustments ---
  if (opts.extended) {
    opts.maxChars = 30000;
  } else if (command === 'crawl' && opts.maxChars === 3000) {
    // crawl default: 8000 (vs search/code which stay at 3000)
    opts.maxChars = 8000;
  }

  try {
    let output;

    // --- Render mode for crawl (works in both REST API and MCP mode) ---
    if (command === 'crawl' && opts.render) {
      output = await cmdCrawlRendered(cmdArgs, opts);
      console.log(output);
      return;
    }

    // --- Stealth mode: TLS impersonation + stealth browser (bypasses Cloudflare) ---
    if (command === 'crawl' && opts.stealth) {
      output = await cmdCrawlStealth(cmdArgs, opts);
      console.log(output);
      return;
    }

    // --- Fetch-only mode: native HTTP fetch, no Exa, no API key needed ---
    if (command === 'crawl' && opts.fetchOnly) {
      output = await cmdCrawlFetch(cmdArgs, opts);
      console.log(output);
      return;
    }

    // --- Auto-fallback to native fetch when no API key and command is crawl ---
    // Native fetch is faster than MCP free tier (no rate limit, no JSON-RPC overhead)
    if (command === 'crawl' && !hasApiKey) {
      output = await cmdCrawlFetch(cmdArgs, opts);
      console.log(output);
      return;
    }

    if (hasApiKey) {
      // REST API mode (requires EXA_API_KEY)
      switch (command) {
        case 'search':
          if (cmdArgs.length === 0) {
            console.error('Error: search requires a query.');
            process.exit(1);
          }
          output = await cmdSearch(cmdArgs.join(' '), opts);
          break;
        case 'crawl':
          output = await cmdCrawl(cmdArgs, opts);
          break;
        case 'code':
          if (cmdArgs.length === 0) {
            console.error('Error: code search requires a query.');
            process.exit(1);
          }
          output = await cmdCode(cmdArgs.join(' '), opts);
          break;
        default:
          console.error(`Unknown command: ${command}`);
          printHelp();
          process.exit(1);
      }
    } else {
      // Free tier MCP mode (no key needed, IP rate-limited)
      // Note: crawl is handled above (auto-fallback to native fetch), so here
      // only search/code go through MCP
      output = await callMcp(command, cmdArgs, opts);
    }

    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
