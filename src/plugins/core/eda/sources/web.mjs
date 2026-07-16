// ── DuckDuckGo Web Search — 廣域網路搜尋（免 API key）────────────────────
import { USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';

export async function searchWebDDG(query, maxResults = 8) {
  try {
    const params = new URLSearchParams({ q: query, t: 'h_', ia: 'web' });
    const resp = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: params.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results = [];
    const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>\s*([^<]+)\s*<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const links = [];
    const snippets = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) links.push({ url: m[1].trim(), title: m[2].trim() });
    while ((m = snippetRegex.exec(html)) !== null) snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    for (let i = 0; i < Math.min(links.length, maxResults, snippets.length); i++) {
      if (links[i].url.startsWith('http')) {
        results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || '' });
      }
    }
    return results;
  } catch { return []; }
}

export function formatWebResults(results, title = '🌐 網路搜尋') {
  if (!results || results.length === 0) return `${title}：無結果\n`;
  let out = `${title}（${results.length} 筆）\n\n`;
  for (const r of results) {
    out += `### [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    out += '\n';
  }
  return out;
}
