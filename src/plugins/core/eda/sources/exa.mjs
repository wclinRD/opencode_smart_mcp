/**
 * Exa Search — 語意搜尋引擎（Dual-mode）
 *
 * Mode 1: REST API（需 EXA_API_KEY 環境變數）— 直接 call api.exa.ai
 * Mode 2: MCP free tier（無需 API key）— 透過 mcp.exa.ai/mcp JSON-RPC（rate-limited）
 *
 * 無 API key 時自動降級到 MCP free tier，不影響其他來源。
 */
import { USER_AGENT } from './http.mjs';

const EXA_API_KEY = process.env.EXA_API_KEY || '';
const API_BASE = 'https://api.exa.ai';
const MCP_BASE = 'https://mcp.exa.ai/mcp?tools=web_search_exa,get_code_context_exa,web_fetch_exa';

// MCP tool mapping
const MCP_TOOLS = {
  search: 'web_search_exa',
  crawl: 'web_fetch_exa',
  code: 'get_code_context_exa',
};

// ── MCP free tier helpers ─────────────────────────────────────────────

// 並發控制：同時最多 2 個 MCP 請求，避免 429
let _inflight = 0;
const MAX_INFLIGHT = 2;

/** 等待並發槽位釋放 */
function waitForSlot() {
  if (_inflight < MAX_INFLIGHT) { _inflight++; return Promise.resolve(); }
  return new Promise(resolve => {
    const check = () => { if (_inflight < MAX_INFLIGHT) { _inflight++; resolve(); } else { setTimeout(check, 200); } };
    check();
  });
}

function releaseSlot() { _inflight = Math.max(0, _inflight - 1); }

/** Parse SSE (Server-Sent Events) response */
function parseSseResponse(text) {
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
      try { events.push(JSON.parse(currentData)); } catch { /* skip */ }
      currentData = '';
      currentEvent = null;
    }
  }
  if (currentData) {
    try { events.push(JSON.parse(currentData)); } catch { /* skip */ }
  }
  return events;
}

/** Call Exa MCP server via JSON-RPC (free tier, no API key needed)
 *  自動 retry 429（exponential backoff）+ 並發控制 */
async function mcpToolCall(tool, args) {
  const MAX_RETRIES = 2;
  const BASE_DELAY = 1500;

  await waitForSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.log(`[Exa] 429 retry ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      try {
        const resp = await fetch(MCP_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'tools/call',
            params: { name: tool, arguments: args },
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (resp.status === 429) {
          continue;
        }
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Exa MCP error (${resp.status}): ${text}`);
        }
        const contentType = resp.headers.get('content-type') || '';
        const rawText = await resp.text();
        let data;
        if (contentType.includes('text/event-stream')) {
          const events = parseSseResponse(rawText);
          data = events.find(e => e.id === '1') || events[0] || {};
        } else {
          try { data = JSON.parse(rawText); } catch {
            throw new Error(`Exa MCP error: unexpected response format.`);
          }
        }
        if (data.error) {
          throw new Error(`Exa MCP error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        const result = data.result || {};
        return (result.content || [])
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');
      } catch (e) {
        if (attempt < MAX_RETRIES && e.name === 'AbortError') continue;
        throw e;
      }
    }
    throw new Error('Exa free tier rate limit exceeded after retries.');
  } finally {
    releaseSlot();
  }
}

// ── Exa 語意搜尋 ───────────────────────────────────────────────────

/**
 * Exa 語意搜尋（Dual-mode: API key → REST, 否則 → MCP free tier）
 */
export async function searchExa(query, maxResults = 5) {
  const numResults = Math.min(maxResults, 10);

  // Mode 1: REST API（有 API key）
  if (EXA_API_KEY) {
    try {
      const resp = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EXA_API_KEY,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          query,
          numResults,
          type: 'auto',
          contents: { text: { maxCharacters: 800 } },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.text?.slice(0, 300) || r.highlight || '',
        score: r.score || 0,
      }));
    } catch (err) {
      console.error(`[Exa] REST API error: ${err.message}`);
      return [];
    }
  }

  // Mode 2: MCP free tier（無 API key）
  try {
    const text = await mcpToolCall(MCP_TOOLS.search, { query, numResults });
    // MCP 回傳 JSON 文字，需 parse
    const data = JSON.parse(text);
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.text?.slice(0, 300) || r.highlight || '',
      score: r.score || 0,
    }));
  } catch (err) {
    console.error(`[Exa] MCP free tier error: ${err.message}`);
    return [];
  }
}

// ── Exa Contents API ─────────────────────────────────────────────────

/**
 * Exa Contents API — 爬取指定 URL 的全文內容
 */
export async function exaGetContents(urls, maxCharsPerUrl = 3000) {
  if (!urls || urls.length === 0) return [];

  // Mode 1: REST API（有 API key）
  if (EXA_API_KEY) {
    try {
      const resp = await fetch(`${API_BASE}/contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EXA_API_KEY,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          urls: urls.slice(0, 5),
          text: { maxCharacters: maxCharsPerUrl },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.results || []).map(r => ({
        url: r.url || '',
        title: r.title || '',
        content: r.text || '',
      }));
    } catch { return []; }
  }

  // Mode 2: MCP free tier
  try {
    const text = await mcpToolCall(MCP_TOOLS.crawl, {
      urls: urls.slice(0, 5),
      maxCharacters: maxCharsPerUrl,
    });
    const data = JSON.parse(text);
    return (data.results || []).map(r => ({
      url: r.url || '',
      title: r.title || '',
      content: r.text || '',
    }));
  } catch { return []; }
}

// ── 可用性檢測 ───────────────────────────────────────────────────────

/**
 * Exa 是否可用（有 API key 或 MCP free tier 皆可用）
 * MCP free tier 總是可用，僅有 rate limit
 */
export function isExaAvailable() {
  return true; // MCP free tier is always available
}
