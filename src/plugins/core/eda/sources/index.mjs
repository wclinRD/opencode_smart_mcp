// ── 多源搜尋統一入口（v2 — RRF fusion + rerank）──────────────────────
// Import 個別來源（供 multiSourceSearch 使用 + re-export）
import { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';
import { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults } from './github.mjs';
import { searchWebDDG, formatWebResults } from './web.mjs';
import { searchEDACommunities, crawlForumPages, formatCommunityResults } from './community.mjs';
import { searchOpenAlex, reconstructAbstract, formatOpenAlexResults } from './openalex.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from './semantic-scholar.mjs';
import { searchExa, exaGetContents, isExaAvailable } from './exa.mjs';
import { compressResults, compressOutput } from '../lib/caveman.mjs';
import { reciprocalRankFusion } from './fusion.mjs';
import { rerankPipeline, scoreRelevance } from './rerank.mjs';
import { classifyQuery } from '../query/classify.mjs';

export { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT, DEFAULT_TIMEOUT };
export { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults };
export { searchWebDDG, formatWebResults };
export { searchEDACommunities, crawlForumPages, formatCommunityResults };
export { searchOpenAlex, reconstructAbstract, formatOpenAlexResults };
export { searchSemanticScholar, formatSemanticScholarResults };
export { searchExa, exaGetContents, isExaAvailable };
export { reciprocalRankFusion } from './fusion.mjs';
export { rerankPipeline, adaptiveTopK, scoreRelevance } from './rerank.mjs';

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

// ── 結構化結果收集（RRF 前置作業）─────────────────────────────────────

/** 將各來源結果轉為 { source, items } 格式供 RRF 使用 */
function toSourceResult(rawItems, sourceName) {
  if (!rawItems || rawItems.length === 0) return null;
  return {
    source: sourceName,
    items: rawItems.map(item => ({
      title: item.title || item.name || '',
      url: item.url || item.html_url || '',
      snippet: item.snippet || item.tldr || (item.abstract ? item.abstract.slice(0, 200) : ''),
      abstract: item.abstract || '',
      score: item.score || item.citedBy || 0,
      year: item.year || '',
      authors: item.authors || '',
      venue: item.venue || '',
      repo: item.repo || '',
      citedBy: item.citedBy || 0,
      doi: item.doi || '',
      community: item.community || '',
      tier: item.tier || '',
    })),
  };
}

// ── 格式化融合結果 ─────────────────────────────────────────────────────

function formatFusedResults(fusedItems) {
  if (fusedItems.length === 0) return '';
  let output = `📋 **融合搜尋結果**（${fusedItems.length} 筆，RRF + EDA rerank）\n\n`;
  for (const item of fusedItems) {
    const score = item.rerankScore ?? item.rrfScore ?? item.score ?? 0;
    const scoreStr = score > 0 ? ` 🎯${score.toFixed(3)}` : '';
    const multi = (item.sourceCount || 1) > 1 ? ` 📊×${item.sourceCount}` : '';
    output += `- [${item.title}](${item.url})${scoreStr}${multi}\n`;
    if (item.snippet) output += `  > ${item.snippet.slice(0, 150)}\n`;
    if (item.rrfScore && item.ranks) {
      output += `  _sources: ${item.ranks.map(r => `${r.source}@${r.rank}`).join(', ')}_\n`;
    }
  }
  output += '\n';
  return output;
}

// ── 多源並行搜尋（auto / all 共用）────────────────────────────────────

import { enhanceQueryForEDA, generateSearchQueries } from '../query/enhance.mjs';

/**
 * v2: RRF fusion + EDA rerank pipeline
 * 1. 並行搜尋所有來源（結構化結果）
 * 2. RRF 跨來源排名融合
 * 3. EDA relevance scoring + adaptive Top-K + post-filter
 * 4. 格式化輸出
 */
export async function multiSourceSearch(searchQuery, maxResults = 10, options = {}) {
  const { depth = 'shallow', compress = 'none', fusion = true, offset = 0 } = options;
  const fetchLimit = maxResults + offset;
  const searchQueries = generateSearchQueries(searchQuery);
  const enhancedQuery = enhanceQueryForEDA(searchQuery);
  const classification = classifyQuery(searchQuery);

  // ── Step 1: 並行搜尋 ──────────────────────────────────────────────
  const scholarQuery = searchQueries.academic || enhancedQuery;
  const scholarSearch = searchSemanticScholar(scholarQuery, maxResults)
    .then(r => r.ok ? r.data : [])
    .catch(() => []);
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
  searches.push(searchExa(searchQuery, Math.min(maxResults, 5)));

  const sources = await Promise.allSettled(searches);
  const warnings = [];
  const sourceNames = ['web', 'community', 'scholar', 'scholar_fallback', 'openalex', 'github_code', 'github_eda', 'exa'];
  sources.forEach((s, i) => {
    if (s.status === 'rejected') {
      warnings.push({ source: sourceNames[i] || `source_${i}`, error: String(s.reason?.message || s.reason || 'unknown') });
    }
  });

  // ── Step 2: 收集結構化結果 ─────────────────────────────────────────
  const webResults = sources[0].status === 'fulfilled' ? sources[0].value : [];
  const communityResults = sources[1].status === 'fulfilled' ? sources[1].value : [];
  const scholarData = sources[2].status === 'fulfilled' ? sources[2].value : [];
  const scholarFallback = sources[3].status === 'fulfilled' ? sources[3].value : [];
  const finalScholar = scholarData.length > 0 ? scholarData : scholarFallback;
  const articles = sources[4].status === 'fulfilled' ? sources[4].value : [];
  const ghCode = sources[5].status === 'fulfilled' ? sources[5].value : [];
  const ghRepos = sources[6].status === 'fulfilled' ? sources[6].value : [];
  const exaData = sources[7]?.status === 'fulfilled' ? sources[7].value : [];

  // ── Step 3: RRF Fusion ─────────────────────────────────────────────
  let output = '';
  let fusedResults = [];

  if (fusion) {
    const sourceResults = [
      toSourceResult(webResults, 'web'),
      toSourceResult(communityResults, 'community'),
      toSourceResult(finalScholar, 'scholar'),
      toSourceResult(articles, 'openalex'),
      toSourceResult(ghCode, 'github'),
      toSourceResult(ghRepos, 'github'),
      toSourceResult(exaData, 'exa'),
    ].filter(Boolean);

    if (sourceResults.length > 0) {
      // RRF 融合（多取 offset 個以便分頁裁切）
      const rrfResults = reciprocalRankFusion(sourceResults, { maxResults: fetchLimit * 2 });
      // EDA rerank + adaptive Top-K + post-filter
      fusedResults = rerankPipeline(rrfResults, searchQuery, classification, { maxResults: fetchLimit });
      // 分頁裁切
      fusedResults = fusedResults.slice(offset, offset + maxResults);
      output = formatFusedResults(fusedResults);
    }
  }

  // ── Step 3b: 備用 — 保留原始格式化（fusion=false 或無結果時）───────
  if (!fusion || fusedResults.length === 0) {
    output = '';
    if (webResults.length > 0) output += formatWebResults(webResults);
    if (communityResults.length > 0) {
      const topUrls = communityResults.slice(0, 3).map(r => r.url);
      let crawledPages = [];
      try { crawledPages = await crawlForumPages(topUrls); } catch { /* ignore */ }
      output += formatCommunityResults(communityResults, crawledPages);
    }
    if (finalScholar.length > 0) output += formatSemanticScholarResults(finalScholar);
    if (articles.length > 0) output += formatOpenAlexResults(articles);
    if (ghCode.length > 0) {
      output += `💻 **GitHub 程式碼**（相關 script / tool flow）\n\n`;
      for (const r of ghCode) output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
      output += '\n';
    }
    if (ghRepos.length > 0) output += formatGitHubResults(ghRepos, 'GitHub 相關 EDA 專案');
    if (exaData.length > 0) {
      output += `🔍 **Exa 語意搜尋**（${exaData.length} 筆）\n\n`;
      for (const r of exaData) {
        output += `- [${r.title}](${r.url})\n`;
        if (r.snippet) output += `  > ${r.snippet.slice(0, 150)}\n`;
      }
      output += '\n';
    }
  }

  // ── Step 4: 深度爬取 ──────────────────────────────────────────────
  if (depth === 'deep') {
    // 優先爬 RRF 融合後的高分 URL
    const urlsToCrawl = fusedResults.length > 0
      ? fusedResults.slice(0, 4).map(r => r.url)
      : [...webResults.slice(0, 2).map(r => r.url), ...communityResults.slice(0, 2).map(r => r.url)].filter(Boolean);
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

  // ── Step 5: 壓縮 + warnings ───────────────────────────────────────
  if (compress !== 'none') {
    output = compressOutput(output, compress);
  }
  if (warnings.length > 0) {
    output += `\n⚠️ **搜尋警告**（${warnings.length} 個來源失敗）\n`;
    for (const w of warnings) output += `  • ${w.source}: ${w.error.slice(0, 80)}\n`;
  }

  return { output, warnings, fusedResults };
}