// ── EDA Community Search — Cadence/Synopsys/EE Times/Reddit 社群 ─────────
import { USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';
import { searchWebDDG } from './web.mjs';
import { EDA_COMMUNITIES } from '../data/meta.mjs';

export async function searchEDACommunities(query, maxResults = 10) {
  const perCommunity = Math.max(2, Math.floor(maxResults / EDA_COMMUNITIES.length));
  const searches = EDA_COMMUNITIES.map(async (community) => {
    try {
      const siteQuery = community.queryTemplate(query);
      const results = await searchWebDDG(siteQuery, perCommunity);
      return results.map(r => ({ ...r, community: community.name }));
    } catch { return []; }
  });
  const allResults = await Promise.allSettled(searches);
  return allResults.filter(r => r.status === 'fulfilled').flatMap(r => r.value).slice(0, maxResults);
}

export async function crawlForumPages(urls, maxChars = 3000) {
  if (!urls || urls.length === 0) return [];
  const results = await Promise.allSettled(
    urls.slice(0, 3).map(async (url) => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT * 2),
        });
        if (!resp.ok) return null;
        const html = await resp.text();
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
        return { url, content: text };
      } catch { return null; }
    })
  );
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

export function formatCommunityResults(results, crawledPages = []) {
  if (!results || results.length === 0) return '💬 EDA 社群：無結果\n';
  let out = `💬 EDA 社群討論（${results.length} 筆）\n\n`;
  const crawledMap = new Map((crawledPages || []).map(p => [p.url, p.content]));
  for (const r of results) {
    const badge = r.community ? ` [${r.community}]` : '';
    out += `###${badge} [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    const crawled = crawledMap.get(r.url);
    if (crawled) {
      out += `\n📄 **討論內容摘要**：\n`;
      out += '```\n' + crawled.slice(0, 800) + '\n```\n';
    }
    out += '\n';
  }
  return out;
}
