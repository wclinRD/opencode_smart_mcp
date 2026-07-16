// ── 多源搜尋統一入口 ────────────────────────────────────────────────────
// Import 個別來源（供 multiSourceSearch 使用 + re-export）
import { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';
import { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults } from './github.mjs';
import { searchWebDDG, formatWebResults } from './web.mjs';
import { searchEDACommunities, crawlForumPages, formatCommunityResults } from './community.mjs';
import { searchOpenAlex, reconstructAbstract, formatOpenAlexResults } from './openalex.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from './semantic-scholar.mjs';
import { searchExa, exaGetContents, isExaAvailable } from './exa.mjs';
import { compressResults, compressOutput } from '../lib/caveman.mjs';

export { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT, DEFAULT_TIMEOUT };
export { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults };
export { searchWebDDG, formatWebResults };
export { searchEDACommunities, crawlForumPages, formatCommunityResults };
export { searchOpenAlex, reconstructAbstract, formatOpenAlexResults };
export { searchSemanticScholar, formatSemanticScholarResults };
export { searchExa, exaGetContents, isExaAvailable };

// ── 跨來源去重 ─────────────────────────────────────────────────────────

function extractDOI(url) {
  const doiMatch = url?.match(/doi\.org\/(10\..+)/i) || url?.match(/doi:(10\..+)/i);
  return doiMatch ? doiMatch[1].toLowerCase() : null;
}

function normalizeURL(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url?.toLowerCase() || '';
  }
}

export function dedupResults(allResults) {
  const seenDOIs = new Set();
  const seenURLs = new Set();
  const deduped = [];
  for (const item of allResults) {
    const doi = item.url ? extractDOI(item.url) : null;
    const normalizedURL = item.url ? normalizeURL(item.url) : '';
    if (doi) { if (seenDOIs.has(doi)) continue; seenDOIs.add(doi); }
    if (normalizedURL) { if (seenURLs.has(normalizedURL)) continue; seenURLs.add(normalizedURL); }
    deduped.push(item);
  }
  return deduped;
}

// ── 來源權重排序 ───────────────────────────────────────────────────────

const SOURCE_WEIGHTS = { exa: 10, scholar: 9, openalex: 8, github: 7, community: 6, web: 5, code: 7 };

export function sortByRelevance(items) {
  return items.sort((a, b) => {
    const wa = (SOURCE_WEIGHTS[a.source] || 5) * (a.score || 0.5);
    const wb = (SOURCE_WEIGHTS[b.source] || 5) * (b.score || 0.5);
    return wb - wa;
  });
}

// ── 多源並行搜尋（auto / all 共用）────────────────────────────────────

import { enhanceQueryForEDA, generateSearchQueries } from '../query/enhance.mjs';

export async function multiSourceSearch(searchQuery, maxResults = 10, options = {}) {
  const { depth = 'shallow', compress = 'none' } = options;
  const searchQueries = generateSearchQueries(searchQuery);
  const enhancedQuery = enhanceQueryForEDA(searchQuery);

  // Semantic Scholar with DDG fallback
  const scholarQuery = searchQueries.academic || enhancedQuery;
  const scholarSearch = searchSemanticScholar(scholarQuery, maxResults)
    .then(r => r.ok ? r.data : [])
    .catch(() => []); // 429/retry exhaustion → empty
  const scholarDDGFallback = searchWebDDG(`site:semanticscholar.org ${scholarQuery}`, Math.min(maxResults, 3))
    .then(r => r.map(item => ({ title: item.title, authors: '', year: '', venue: '', citedBy: 0, doi: '', url: item.url, tldr: item.snippet || '', abstract: '' })));

  const searches = [
    searchWebDDG(searchQueries.web, maxResults),
    searchEDACommunities(searchQuery, maxResults),
    scholarSearch,
    scholarDDGFallback,
    searchOpenAlex(searchQueries.academic || enhancedQuery, Math.min(maxResults, 5)),
    searchGitHubCode(searchQueries.github, 5),
    searchGitHubEDA(searchQuery, 5),
  ];
  if (isExaAvailable()) searches.push(searchExa(searchQuery, Math.min(maxResults, 5)));

  const sources = await Promise.allSettled(searches);
  let output = '';

  const webResults = sources[0].status === 'fulfilled' ? sources[0].value : [];
  if (webResults.length > 0) output += formatWebResults(webResults);

  const communityResults = sources[1].status === 'fulfilled' ? sources[1].value : [];
  if (communityResults.length > 0) {
    const topUrls = communityResults.slice(0, 3).map(r => r.url);
    let crawledPages = [];
    try { crawledPages = await crawlForumPages(topUrls); } catch { /* ignore */ }
    output += formatCommunityResults(communityResults, crawledPages);
  }

  // Semantic Scholar with DDG fallback
  const scholarData = sources[2].status === 'fulfilled' ? sources[2].value : [];
  const scholarFallback = sources[3].status === 'fulfilled' ? sources[3].value : [];
  const finalScholar = scholarData.length > 0 ? scholarData : scholarFallback;
  if (finalScholar.length > 0) output += formatSemanticScholarResults(finalScholar);

  const articles = sources[4].status === 'fulfilled' ? sources[4].value : [];
  if (articles.length > 0) output += formatOpenAlexResults(articles);

  const ghCode = sources[5].status === 'fulfilled' ? sources[5].value : [];
  if (ghCode.length > 0) {
    output += `💻 **GitHub 程式碼**（相關 script / tool flow）\n\n`;
    for (const r of ghCode) output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
    output += '\n';
  }

  const ghRepos = sources[6].status === 'fulfilled' ? sources[6].value : [];
  if (ghRepos.length > 0) output += formatGitHubResults(ghRepos, 'GitHub 相關 EDA 專案');

  const exaData = isExaAvailable() && sources[7]?.status === 'fulfilled' ? sources[7].value : [];
  if (exaData.length > 0) {
    output += `🔍 **Exa 語意搜尋**（${exaData.length} 筆）\n\n`;
    for (const r of exaData) {
      output += `- [${r.title}](${r.url})\n`;
      if (r.snippet) output += `  > ${r.snippet.slice(0, 150)}\n`;
    }
    output += '\n';
  }

  if (depth === 'deep' && isExaAvailable()) {
    const urlsToCrawl = [
      ...webResults.slice(0, 2).map(r => r.url),
      ...communityResults.slice(0, 2).map(r => r.url),
    ].filter(Boolean);
    if (urlsToCrawl.length > 0) {
      try {
        const contents = await exaGetContents(urlsToCrawl, 2000);
        if (contents.length > 0) {
          output += `\n📄 **深度爬取結果**（${contents.length} 篇全文）\n\n`;
          for (const c of contents) {
            output += `### ${c.title || c.url}\n`;
            output += `> ${c.content.slice(0, 500)}...\n\n`;
          }
        }
      } catch { /* ignore */ }
    }
  }

  if (compress !== 'none') {
    output = compressOutput(output, compress);
  }

  return output;
}
