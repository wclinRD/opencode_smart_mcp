// ── GitHub API — PDK / Cell Library / EDA Tool 查詢 ──────────────────────
import { httpsGet, GITHUB_API } from './http.mjs';

// GitHub Token（從環境變數讀取，提升 rate limit 從 60→5000 req/hr）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const githubHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};

export async function searchGitHubPDK(query, maxResults = 10) {
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
}

export async function searchGitHubEDA(query, maxResults = 10) {
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
}

export async function searchGitHubCode(query, maxResults = 5) {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/code?q=${q}&per_page=${maxResults}`;
  const data = await httpsGet(url, { headers: githubHeaders }).catch(() => ({ items: [] }));
  return (data.items || []).map(r => ({
    name: r.name,
    path: r.path,
    repo: r.repository.full_name,
    url: r.html_url,
    score: r.score,
  }));
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
