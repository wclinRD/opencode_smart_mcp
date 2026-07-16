// ── HTTP 工具函式 + API 常數 ──────────────────────────────────────────────
// 所有 HTTP 請求的統一入口，含簡易 LRU cache + 429 retry

const USER_AGENT = 'SmartMCP/2.0 (eda-search)';
const DEFAULT_TIMEOUT = 20000;

export const GITHUB_API = 'https://api.github.com';
export const OPENALEX_API = 'https://api.openalex.org';
export const SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';

// 簡易 LRU Cache（TTL 5 分鐘，最多 50 條）
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 50;

/**
 * 帶 429 retry 的 HTTPS GET（exponential backoff）
 * @param {string} url
 * @param {object} opts - { timeout, maxRetries, retryDelay }
 * @returns {Promise<object>}
 */
export async function httpsGet(url, opts = {}) {
  // Cache hit check
  const cached = _cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  if (_cache.size > CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }

  const maxRetries = opts.maxRetries ?? 2;
  const retryDelay = opts.retryDelay ?? 1000;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryDelay * Math.pow(2, attempt - 1); // 1s, 2s
      await new Promise(r => setTimeout(r, delay));
    }
    const controller = new AbortController();
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        ...opts.headers,
      };
      const resp = await fetch(url, { headers, signal: controller.signal });
      if (resp.status === 429) {
        lastError = new Error(`HTTP 429: Rate limited`);
        continue; // retry with backoff
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const data = await resp.json();
      _cache.set(url, { data, ts: Date.now() });
      return data;
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') continue; // timeout → retry
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export { USER_AGENT, DEFAULT_TIMEOUT };
