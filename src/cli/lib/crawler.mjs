/**
 * F.3 Crawlee Adaptive Crawler — src/cli/lib/crawler.mjs
 *
 * Layer 1: Smart Defaults — LLM doesn't need to know if a site is static or JS-heavy.
 *
 * Strategy:
 *   1. Try CheerioCrawler first (fast, ~15MB RAM, no browser needed)
 *   2. If Cheerio returns empty/incomplete content → fallback to PlaywrightCrawler
 *   3. If Playwright is not installed → return Cheerio result with warning
 *
 * Dynamic import: non-blocking, graceful fallback to native fetch.
 *
 * Usage:
 *   import { smartFetch } from './crawler.mjs';
 *   const result = await smartFetch('https://example.com', { crawlee: true });
 *   if (result) { result.html, result.engine, result.duration }
 */

import { isDeepStrictEqual } from 'node:util';

// ---------------------------------------------------------------------------
// Content completeness heuristics
// ---------------------------------------------------------------------------

/**
 * Check if fetched HTML has meaningful content (vs empty SPA shell).
 * SPAs often return: <div id="root"></div> with no visible text.
 * Strips script/style blocks first so JS-heavy shells aren't counted as content.
 */
function hasMeaningfulContent(html) {
  if (!html || html.length < 500) return false;
  // Strip script, style, comments first
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const textOnly = cleaned.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  // Must have at least 500 chars of visible text after stripping markup
  return textOnly.length >= 500;
}

// ---------------------------------------------------------------------------
// CheerioCrawler (static HTML, fast, no browser)
// ---------------------------------------------------------------------------

/**
 * Fetch a URL using Crawlee's CheerioCrawler (lightweight, no browser).
 * @returns {Promise<{html: string, engine: string}|null>}
 */
async function cheerioCrawl(url, timeout = 30000) {
  let CheerioCrawler;
  try {
    const mod = await import('crawlee');
    CheerioCrawler = mod.CheerioCrawler;
  } catch {
    return null;
  }

  let resultHtml = '';

  const crawler = new CheerioCrawler({
    async requestHandler({ body, request, log }) {
      resultHtml = body.toString('utf-8');
    },
    failedRequestHandler({ request, log }) {
      // Silently fail — caller will fall back
    },
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.ceil(timeout / 1000),
  });

  try {
    await crawler.run([url]);
  } catch {
    return null;
  }

  if (!resultHtml) return null;
  return { html: resultHtml, engine: 'cheerio' };
}

// ---------------------------------------------------------------------------
// PlaywrightCrawler (JS rendering fallback)
// ---------------------------------------------------------------------------

/**
 * Fetch using PlaywrightCrawler (full browser rendering).
 * Only called when Cheerio returns incomplete content.
 * @returns {Promise<{html: string, engine: string}|null>}
 */
async function playwrightCrawl(url, timeout = 30000) {
  let PlaywrightCrawler;
  try {
    const mod = await import('crawlee');
    PlaywrightCrawler = mod.PlaywrightCrawler;
  } catch {
    return null;
  }

  // Check if playwright is actually installed
  try {
    await import('playwright');
  } catch {
    return null; // playwright not installed, can't fallback
  }

  let resultHtml = '';

  const crawler = new PlaywrightCrawler({
    async requestHandler({ page, request, log }) {
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      resultHtml = await page.content();
    },
    failedRequestHandler({ request, log }) {
      // Silently fail
    },
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.ceil(timeout / 1000),
    headless: true,
  });

  try {
    await crawler.run([url]);
  } catch {
    return null;
  }

  if (!resultHtml) return null;
  return { html: resultHtml, engine: 'playwright' };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with Crawlee adaptive crawling.
 * Strategy: CheerioCrawler first → if content is incomplete → PlaywrightCrawler
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.crawlee] - Use Crawlee (required to enable)
 * @param {number} [opts.timeout] - Max wait in ms (default: 30000)
 * @returns {Promise<{html: string, engine: string, duration: number}|null>}
 */
export async function crawleeFetch(url, opts = {}) {
  const startTime = Date.now();
  const timeout = opts.timeout || 30000;

  // --- Step 1: CheerioCrawler (fast, no browser) ---
  const cheerioResult = await cheerioCrawl(url, timeout);
  if (cheerioResult && hasMeaningfulContent(cheerioResult.html)) {
    return {
      html: cheerioResult.html,
      engine: 'cheerio',
      duration: Date.now() - startTime,
    };
  }

  // --- Step 2: Fallback to Playwright if Cheerio gave empty/incomplete content ---
  const pwResult = await playwrightCrawl(url, timeout);
  if (pwResult) {
    return {
      html: pwResult.html,
      engine: 'playwright',
      duration: Date.now() - startTime,
    };
  }

  // --- Step 3: Return Cheerio result even if incomplete (with a warning in engine name) ---
  if (cheerioResult) {
    return {
      html: cheerioResult.html,
      engine: 'cheerio-incomplete',
      duration: Date.now() - startTime,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fallback fetch (no Crawlee)
// ---------------------------------------------------------------------------

/**
 * Fallback: simple HTTP fetch. Used when Crawlee is not installed.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout] - ms (default: 15000)
 * @returns {Promise<{html: string, engine: string, duration: number}>}
 */
export async function fallbackFetch(url, opts = {}) {
  const startTime = Date.now();
  const timeout = opts.timeout || 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Smart-MCP/1.0; +https://github.com/wclin/opencode_smart_mcp)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });
    const html = await response.text();
    const duration = Date.now() - startTime;
    return { html, engine: 'fetch', duration };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL, using Crawlee when available, falling back to native fetch.
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.crawlee] - Use Crawlee adaptive crawl
 * @param {number} [opts.timeout] - Max wait in ms
 * @returns {Promise<{html: string, engine: string, duration: number}>}
 */
export async function smartFetch(url, opts = {}) {
  // Try Crawlee if requested
  if (opts.crawlee) {
    const result = await crawleeFetch(url, opts);
    if (result) return result;
    // Fall through to fallback
  }

  // Default: native fetch (fast, zero deps)
  return fallbackFetch(url, opts);
}

export default { smartFetch, crawleeFetch, fallbackFetch };
