// ── EDA Community Search — Cadence/Synopsys/EE Times/Reddit 社群 ─────────
import { USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';
import { searchWebDDG } from './web.mjs';
import { EDA_COMMUNITIES } from '../data/meta.mjs';
import { exaGetContents } from './exa.mjs';

/**
 * 社群搜尋 with Tier 分級 + URL 去重
 * Tier 1: 廠商官方社群（優先搜尋，always included）
 * Tier 2: 社群補充來源（maxResults > 5 時 included）
 */
export async function searchEDACommunities(query, maxResults = 10) {
  const tier1 = EDA_COMMUNITIES.filter(c => c.tier === 1);
  const tier2 = EDA_COMMUNITIES.filter(c => c.tier === 2);
  // Tier 1 always searched; Tier 2 only when maxResults > 5
  const communities = maxResults > 5 ? [...tier1, ...tier2] : tier1;
  const perCommunity = Math.max(2, Math.floor(maxResults / communities.length));

  const searches = communities.map(async (community) => {
    try {
      const siteQuery = community.queryTemplate(query);
      const results = await searchWebDDG(siteQuery, perCommunity);
      return results.map(r => ({ ...r, community: community.name, tier: community.tier }));
    } catch { return []; }
  });

  const allResults = await Promise.allSettled(searches);
  const flat = allResults.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  // URL 去重
  const seen = new Set();
  return flat.filter(r => {
    const norm = r.url?.toLowerCase().replace(/\/+$/, '');
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  }).slice(0, maxResults);
}

/**
 * 爬取論壇頁面內容
 * - Exa MCP free tier：精確全文提取
 * - Exa 失敗時：退回 HTML strip（基本文字提取）
 */
export async function crawlForumPages(urls, maxChars = 3000) {
  if (!urls || urls.length === 0) return [];

  // 嘗試用 Exa Contents API（高品質全文）
  try {
    const exaResults = await exaGetContents(urls, maxChars);
    if (exaResults.length > 0) return exaResults;
  } catch { /* fallthrough to HTML strip */ }

  // Fallback: HTML strip
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
    const tierBadge = r.tier === 1 ? ' 🏆' : '';
    out += `###${badge}${tierBadge} [${r.title}](${r.url})\n`;
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
