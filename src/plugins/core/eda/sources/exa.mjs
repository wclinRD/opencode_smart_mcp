/**
 * Exa Search — 語意搜尋引擎（需 EXA_API_KEY 環境變數）
 *
 * Exa 提供免費方案（1000 次/月），用於 EDA 領域深度搜尋。
 * 無 API key 時自動跳過，不影響其他來源。
 */
import { USER_AGENT } from './http.mjs';

const EXA_API = 'https://api.exa.ai';
const EXA_API_KEY = process.env.EXA_API_KEY || '';

/**
 * Exa 語意搜尋
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Array<{title, url, snippet, score}>>}
 */
export async function searchExa(query, maxResults = 5) {
  if (!EXA_API_KEY) return [];

  const body = JSON.stringify({
    query,
    numResults: Math.min(maxResults, 10),
    type: 'auto',
    contents: {
      text: { maxCharacters: 800 },
    },
  });

  try {
    const resp = await fetch(`${EXA_API}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
        'User-Agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[Exa] HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return [];
    }

    const data = await resp.json();
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.text?.slice(0, 300) || r.highlight || '',
      score: r.score || 0,
    }));
  } catch (err) {
    console.error(`[Exa] search error: ${err.message}`);
    return [];
  }
}

/**
 * Exa Contents API — 爬取指定 URL 的全文內容（取代暴力 HTML strip）
 * @param {string[]} urls
 * @param {number} maxCharsPerUrl
 * @returns {Promise<Array<{url, title, content}>>}
 */
export async function exaGetContents(urls, maxCharsPerUrl = 3000) {
  if (!EXA_API_KEY || !urls || urls.length === 0) return [];

  const body = JSON.stringify({
    urls: urls.slice(0, 5),
    text: { maxCharacters: maxCharsPerUrl },
  });

  try {
    const resp = await fetch(`${EXA_API}/contents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
        'User-Agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    return (data.results || []).map(r => ({
      url: r.url || '',
      title: r.title || '',
      content: r.text || '',
    }));
  } catch {
    return [];
  }
}

export function isExaAvailable() {
  return !!EXA_API_KEY;
}
