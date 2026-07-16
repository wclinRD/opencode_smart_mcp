// ── GitHub API — PDK / Cell Library / EDA Tool 查詢 ──────────────────────
// 無 GITHUB_TOKEN 時自動降級到 Exa 搜尋（免 token）
import { httpsGet, GITHUB_API } from './http.mjs';
import { searchExa } from './exa.mjs';

// GitHub Token（從環境變數讀取，提升 rate limit 從 60→5000 req/hr）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const githubHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};

// ── Exa fallback helpers ─────────────────────────────────────────────

/** 用 Exa 搜尋 GitHub repo（site:github.com） */
async function exaSearchGitHubRepos(query, maxResults = 10) {
  const exaQuery = `site:github.com ${query} (PDK OR "standard cell" OR EDA OR synthesis OR "place and route")`;
  const results = await searchExa(exaQuery, maxResults);
  return results.map(r => ({
    name: r.title?.replace(/^\[.*?\]\s*/, '') || '',
    stars: 0,
    description: r.snippet || '',
    url: r.url || '',
    language: '',
    updated: '',
    topics: [],
    _source: 'exa',
  }));
}

/** 用 Exa 搜尋 GitHub code（site:github.com） */
async function exaSearchGitHubCode(query, maxResults = 5) {
  const exaQuery = `site:github.com ${query}`;
  const results = await searchExa(exaQuery, maxResults);
  return results.map(r => ({
    name: r.title?.split('/').pop() || '',
    path: r.url || '',
    repo: r.title?.replace(/^\[.*?\]\s*/, '') || '',
    url: r.url || '',
    score: r.score || 0,
    _source: 'exa',
  }));
}

// ── Fallback 建議 ──────────────────────────────────────────────────

/** 無結果時的 smart_exa_search 建議訊息 */
export function suggestExaSearch(query) {
  return `\n💡 如需更深入搜尋，可用 \`smart_exa_search\` 查詢：\n`
    + `  \`smart_exa_search({command:"search", query:"${query}", numResults:10})\`\n`;
}

// ── 主要搜尋函式（自動降級）────────────────────────────────────────

export async function searchGitHubPDK(query, maxResults = 10) {
  // 有 token → 用 GitHub API
  if (GITHUB_TOKEN) {
    try {
      const q = encodeURIComponent(`${query} PDK OR "standard cell" OR "process design kit"`);
      const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
      const data = await httpsGet(url, { headers: githubHeaders });
      return (data.items || []).map(r => ({
        name: r.full_name,
        stars: r.stargazers_count,
        description: r.description || '',
        url: r.html_url,
        language: r.language,
        updated: r.updated_at,
        topics: r.topics || [],
      }));
    } catch (err) {
      console.log(`[GitHub] API error, falling back to Exa: ${err.message}`);
    }
  }
  // 無 token 或 API 失敗 → 用 Exa
  return exaSearchGitHubRepos(query, maxResults);
}

export async function searchGitHubEDA(query, maxResults = 10) {
  // 有 token → 用 GitHub API
  if (GITHUB_TOKEN) {
    try {
      const q = encodeURIComponent(`${query} EDA OR "electronic design automation" OR synthesis OR "place and route" OR "static timing"`);
      const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
      const data = await httpsGet(url, { headers: githubHeaders });
      return (data.items || []).map(r => ({
        name: r.full_name,
        stars: r.stargazers_count,
        description: r.description || '',
        url: r.html_url,
        language: r.language,
        updated: r.updated_at,
        topics: r.topics || [],
      }));
    } catch (err) {
      console.log(`[GitHub] API error, falling back to Exa: ${err.message}`);
    }
  }
  // 無 token 或 API 失敗 → 用 Exa
  return exaSearchGitHubRepos(query, maxResults);
}

export async function searchGitHubCode(query, maxResults = 5) {
  // 有 token → 用 GitHub API
  if (GITHUB_TOKEN) {
    try {
      const q = encodeURIComponent(query);
      const url = `${GITHUB_API}/search/code?q=${q}&per_page=${maxResults}`;
      const data = await httpsGet(url, { headers: githubHeaders });
      return (data.items || []).map(r => ({
        name: r.name,
        path: r.path,
        repo: r.repository.full_name,
        url: r.html_url,
        score: r.score,
      }));
    } catch (err) {
      // 403/422 錯誤 → 降級到 Exa
      if (err.message && (err.message.includes('403') || err.message.includes('401') || err.message.includes('422'))) {
        console.log(`[GitHub Code] API error (${err.message.match(/\\d+/)?.[0]}), falling back to Exa`);
      } else {
        throw err;
      }
    }
  }
  // 無 token 或 API 失敗 → 用 Exa
  return exaSearchGitHubCode(query, maxResults);
}

export function formatGitHubResults(items, title) {
  if (!items || items.length === 0) return `🔍 ${title}：無結果\n`;
  let out = `🔍 ${title}（${items.length} 筆）\n\n`;
  for (const r of items) {
    out += `### ⭐ ${r.stars} — [${r.name}](${r.url})\n`;
    out += `> ${r.description}\n`;
    if (r.language) out += `*Language: ${r.language}*`;
    if (r.topics && r.topics.length > 0) out += ` | *Topics: ${r.topics.slice(0, 5).join(', ')}*`;
    out += '\n\n';
  }
  return out;
}
