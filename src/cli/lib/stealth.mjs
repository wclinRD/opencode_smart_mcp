/**
 * Stealth Fetch — TLS impersonation + Browser stealth
 *
 * Two-layer anti-bot evasion system for Cloudflare/ Akamai / DataDome:
 *
 *   Layer 1 (HTTP): TLS impersonation via impers (curl-impersonate + BoringSSL)
 *     - 偽造 JA3/JA4 TLS 指紋，模仿真實 Chrome/Safari/Firefox
 *     - 偽造 HTTP/2 SETTINGS/WINDOW_UPDATE/PRIORITY frame 順序
 *     - 不需要瀏覽器，輕量快速 (~500ms-2s)
 *     - 繞過基於 TLS 指紋的 bot 檢測（Cloudflare 第一道防線）
 *
 *   Layer 2 (Browser): Stealth Playwright render
 *     - 注入 stealth JS 修補 navigator.webdriver / plugins / chrome / WebGL
 *     - 修改 viewport / userAgent / 語言環境
 *     - 移除 headless 瀏覽器特徵
 *
 * Dynamic imports: impers, playwright 都是選裝套件
 *
 * Usage:
 *   import { stealthFetch } from './stealth.mjs';
 *   const result = await stealthFetch('https://m.iyf.tv');
 *   // { html, engine: 'impers'|'browser', duration }
 */

// ---------------------------------------------------------------------------
// Cloudflare challenge detection heuristics
// ---------------------------------------------------------------------------

/** Known Cloudflare challenge markers in HTML */
const CF_CHALLENGE_PATTERNS = [
  'Checking your browser',
  'Performing security verification',
  'Just a moment',
  'Ray ID:',
  'cloudflare',
  'cf-browser-verification',
  'cf-challenge',
  'id="cf-please-wait"',
];

/**
 * Check if HTML contains a Cloudflare challenge page.
 */
function isCloudflareChallenge(html) {
  if (!html || html.length < 200) return false;
  const lower = html.toLowerCase();
  // Must have both Cloudflare signature AND challenge indicators
  const hasSignature = lower.includes('cloudflare') || lower.includes('ray id:');
  const hasChallenge = lower.includes('checking your browser')
    || lower.includes('performing security')
    || lower.includes('just a moment')
    || lower.includes('cf-browser-verification');
  return hasSignature && hasChallenge;
}

/**
 * Check if HTML is a bot block page (generic).
 */
function isBlockedPage(html) {
  if (!html || html.length < 100) return false;
  const lower = html.toLowerCase();
  // Too short + block keywords
  if (html.length < 1000) {
    return lower.includes('block') || lower.includes('denied') || lower.includes('forbidden');
  }
  return false;
}

/**
 * Check if content is complete and meaningful.
 * Strips script/style blocks before checking text length
 * so SPA shells with lots of JS are correctly identified as empty.
 */
function hasMeaningfulContent(html) {
  if (!html || html.length < 500) return false;
  // Strip script, style, SVG, comments first — they inflate text-only length
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const textOnly = cleaned.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  // Must have at least 500 chars of visible text after stripping markup
  return textOnly.length >= 500;
}

// ---------------------------------------------------------------------------
// Layer 1: TLS impersonation via impers (curl-impersonate)
// ---------------------------------------------------------------------------

/** Browser impersonation targets to try in order (most recent first) */
const IMPERSONATE_TARGETS = [
  'chrome142',
  'chrome136',
  'chrome133a',
  'chrome131',
  'chrome124',
  'safari260',
  'safari180',
  'firefox144',
];

/**
 * Fetch a URL with TLS fingerprint impersonation.
 *
 * Uses impers (Node.js binding for libcurl-impersonate) to mimic
 * real browser TLS/HTTP2 fingerprints at the network level.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.impersonate] - Browser target (default: 'chrome142')
 * @param {number} [opts.timeout] - Timeout in seconds (default: 30)
 * @returns {Promise<{html: string, engine: string, duration: number, target: string}|null>}
 */
async function tlsImpersonateFetch(url, opts = {}) {
  let impers;
  try {
    impers = await import('impers');
  } catch {
    return null; // impers not installed
  }

  const target = opts.impersonate || 'chrome142';
  const timeout = opts.timeout || 30;
  const startTime = Date.now();

  try {
      // Merge custom headers (curl-like options override defaults)
      const baseHeaders = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      };
      if (opts.userAgent) baseHeaders['User-Agent'] = opts.userAgent;
      if (opts.cookie) baseHeaders['Cookie'] = opts.cookie;
      if (opts.referer) baseHeaders['Referer'] = opts.referer;
      if (opts.auth) {
        baseHeaders['Authorization'] = 'Basic ' + Buffer.from(opts.auth).toString('base64');
      }
      if (opts.headers && typeof opts.headers === 'object') {
        Object.assign(baseHeaders, opts.headers);
      }

      const response = await impers.get(url, {
        impersonate: target,
        timeout,
        followRedirects: opts.followRedirects !== false,
        maxRedirects: opts.maxRedirects ?? 5,
        headers: baseHeaders,
      });

    const html = response.text || '';
    const duration = Date.now() - startTime;
    return { html, engine: 'impers', duration, target };
  } catch (err) {
    // Connection errors usually mean TLS fingerprint mismatch or network issue
    return null;
  }
}

/**
 * Try TLS impersonation with fallback targets.
 * If the primary target fails (blocked), try older Chrome versions.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Per-attempt timeout in seconds (default: 15)
 * @returns {Promise<{html: string, engine: string, duration: number, target: string}|null>}
 */
async function tlsImpersonateWithFallback(url, opts = {}) {
  const timeout = opts.timeout || 15;
  const maxRetries = 3;
  const attempts = [];

  for (let i = 0; i < Math.min(maxRetries, IMPERSONATE_TARGETS.length); i++) {
    const target = IMPERSONATE_TARGETS[i];
    const result = await tlsImpersonateFetch(url, { ...opts, impersonate: target, timeout });

    if (!result) {
      attempts.push({ target, error: 'connection-failed' });
      continue;
    }

    if (isCloudflareChallenge(result.html) || isBlockedPage(result.html)) {
      attempts.push({ target, error: 'blocked' });
      continue;
    }

    if (!hasMeaningfulContent(result.html)) {
      attempts.push({ target, error: 'empty-content' });
      continue;
    }

    // Success!
    return result;
  }

  // All attempts failed — return the best attempt if any
  for (const r of attempts) {
    if (r.html) {
      return { html: r.html, engine: 'impers', duration: r.duration, target: r.target };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: Stealth browser render (enhanced Playwright)
// ---------------------------------------------------------------------------

/**
 * Stealth JS patches injected into the page before content loads.
 * These patches hide headless browser fingerprints that Cloudflare etc.
 * detect beyond the TLS layer.
 */
const STEALTH_JS = `
// --- Patch 1: Hide webdriver flag ---
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// --- Patch 2: Spoof plugins array ---
Object.defineProperty(navigator, 'plugins', {
  get: () => [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
    { name: 'Native Client', filename: 'internal-nacl-plugin' },
  ],
  configurable: true,
});

// --- Patch 3: Spoof languages ---
Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW', 'zh', 'en-US', 'en'] });

// --- Patch 4: Add chrome.runtime object ---
if (!window.chrome) { window.chrome = {}; }
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: () => null,
    sendMessage: () => null,
    onMessage: { addListener: () => {} },
    onConnect: { addListener: () => {} },
  };
}

// --- Patch 5: Spoof hardwareConcurrency ---
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

// --- Patch 6: Spoof deviceMemory ---
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// --- Patch 7: Spoof permissions (optional) ---
if (navigator.permissions && navigator.permissions.query) {
  const origQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (desc) => {
    if (desc.name === 'notifications') return Promise.resolve({ state: 'prompt' });
    return origQuery(desc);
  };
}

// --- Patch 8: Add WebGL vendor/renderer spoofing ---
const getParameterProxyHandler = {
  apply: function(target, thisArg, args) {
    const param = args[0];
    // Spoof renderer to avoid headless detection
    if (param === 37445) return 'Intel Inc.';          // UNMASKED_VENDOR_WEBGL
    if (param === 37446) return 'Intel Iris OpenGL Engine';  // UNMASKED_RENDERER_WEBGL
    return Reflect.apply(target, thisArg, args);
  }
};

// Patch WebGLRenderingContext
const webglProto = WebGLRenderingContext.prototype;
if (webglProto.getParameter) {
  webglProto.getParameter = new Proxy(webglProto.getParameter, getParameterProxyHandler);
}

// Also patch WebGL2
const webgl2Proto = WebGL2RenderingContext.prototype;
if (webgl2Proto && webgl2Proto.getParameter) {
  webgl2Proto.getParameter = new Proxy(webgl2Proto.getParameter, getParameterProxyHandler);
}
`;

/**
 * Fetch a URL using headless Playwright with stealth patches injected.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Page load timeout in ms (default: 30000)
 * @returns {Promise<{html: string, engine: string, duration: number}|null>}
 */
async function stealthPlaywrightRender(url, opts = {}) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return null;
  }

  const timeout = opts.timeout || 30000;
  const startTime = Date.now();

  try {
    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: opts.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      // Spoof permissions
      permissions: [],
      // Use realistic color scheme
      colorScheme: 'light',
      // Reduce detectable differences
      reducedMotion: 'no-preference',
      forcedColors: 'none',
    });

    const page = await context.newPage();

    // Set cookies if provided
    if (opts.cookie) {
      const cookies = opts.cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => {
        const [name, ...rest] = c.split('=');
        return {
          name: name.trim(),
          value: rest.join('='),
          domain: new URL(url).hostname,
          path: '/',
        };
      }).filter(c => c.name);
      if (cookies.length > 0) await context.addCookies(cookies);
    }

    // Set referer via extra HTTP headers
    const extraHeaders = {};
    if (opts.referer) extraHeaders['Referer'] = opts.referer;
    if (opts.headers && typeof opts.headers === 'object') {
      Object.assign(extraHeaders, opts.headers);
    }
    if (Object.keys(extraHeaders).length > 0) {
      await page.setExtraHTTPHeaders(extraHeaders);
    }

    // Inject stealth JS before any page navigation
    await page.addInitScript(STEALTH_JS);

    // Navigate with domcontentloaded (not networkidle — avoids streaming-site hangs)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Give JS time to render
    await page.waitForTimeout(3000);

    const html = await page.content();
    const duration = Date.now() - startTime;

    await browser.close();

    return { html, engine: 'browser-stealth', duration };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with full anti-bot evasion.
 *
 * Strategy:
 *   1. TLS impersonation via impers (fast, no browser, bypasses TLS fingerprinting)
 *   2. If blocked/incomplete → stealth Playwright render (JS execution + stealth patches)
 *   3. If stealth Playwright unavailable → null
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.stealth] - Enable stealth mode (required)
 * @param {boolean} [opts.noBrowser] - Skip Playwright fallback (TLS impersonation only)
 * @param {number} [opts.timeout] - Timeout in ms (default: 30000)
 * @returns {Promise<{html: string, engine: string, duration: number, target?: string}|null>}
 */
export async function stealthFetch(url, opts = {}) {
  const startTime = Date.now();
  const timeout = opts.timeout || 30000;
  const perAttemptTimeout = Math.ceil(timeout / 2000); // seconds per attempt

  // --- Layer 1: TLS impersonation ---
  const tlsResult = await tlsImpersonateWithFallback(url, { ...opts, timeout: perAttemptTimeout });

  if (tlsResult && hasMeaningfulContent(tlsResult.html)) {
    return {
      html: tlsResult.html,
      engine: tlsResult.engine,
      duration: Date.now() - startTime,
      target: tlsResult.target,
    };
  }

  // TLS result was empty, blocked, or SPA shell — fall through to browser

  // --- Layer 2: Stealth Playwright (skip if --no-browser) ---
  if (opts.noBrowser) {
    return null;
  }

  const browserResult = await stealthPlaywrightRender(url, { timeout, headers: opts.headers, cookie: opts.cookie, referer: opts.referer, userAgent: opts.userAgent });

  if (browserResult) {
    return {
      html: browserResult.html,
      engine: browserResult.engine,
      duration: Date.now() - startTime,
    };
  }

  return null;
}

/**
 * Quick check if stealth mode is available (impers installed).
 */
export async function isStealthAvailable() {
  try {
    await import('impers');
    return true;
  } catch {
    return false;
  }
}

export default { stealthFetch, isStealthAvailable, isCloudflareChallenge, hasMeaningfulContent };
