// ── HTTP 工具函式 + API 常數 ──────────────────────────────────────────────
// 所有 HTTP 請求的統一入口，含簡易 LRU cache

const USER_AGENT = 'SmartMCP/2.0 (eda-search)';
const DEFAULT_TIMEOUT = 20000;

export const GITHUB_API = 'https://api.github.com';
export const OPENALEX_API = 'https://api.openalex.org';
export const SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';

// 簡易 LRU Cache（TTL 5 分鐘，最多 50 條）
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 50;

export async function httpsGet(url, opts = {}) {
  // Cache hit check
  const cached = _cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  if (_cache.size > CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
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
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    _cache.set(url, { data, ts: Date.now() });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export { USER_AGENT, DEFAULT_TIMEOUT };
