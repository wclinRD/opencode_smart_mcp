// ── Registry + Actions（side-effect 自動註冊）────────────────────────────
import { dispatch } from './eda/actions/registry.mjs';
import './eda/actions/index.mjs';

// ── 搜尋來源（multiSourceSearch 被 auto/all action 引用）───────────────
import { searchWebDDG, formatWebResults } from './eda/sources/web.mjs';
import { searchEDACommunities, crawlForumPages, formatCommunityResults } from './eda/sources/community.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from './eda/sources/semantic-scholar.mjs';
import { searchOpenAlex, formatOpenAlexResults } from './eda/sources/openalex.mjs';
import { searchGitHubCode, searchGitHubEDA, formatGitHubResults } from './eda/sources/github.mjs';
import { searchExa, exaGetContents, isExaAvailable } from './eda/sources/exa.mjs';
import { enhanceQueryForEDA, generateSearchQueries } from './eda/query/enhance.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// ── 跨來源去重 ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 從 URL 提取 DOI（學術論文去重用）
 */
function extractDOI(url) {
  const doiMatch = url?.match(/doi\.org\/(10\..+)/i) || url?.match(/doi:(10\..+)/i);
  return doiMatch ? doiMatch[1].toLowerCase() : null;
}

/**
 * 正規化 URL 用於去重（移除 trailing slash、protocol 差異）
 */
function normalizeURL(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url?.toLowerCase() || '';
  }
}

/**
 * 跨來源去重：DOI 去重學術論文，URL 去重網頁
 */
function dedupResults(allResults) {
  const seenDOIs = new Set();
  const seenURLs = new Set();
  const deduped = [];

  for (const item of allResults) {
    const doi = item.url ? extractDOI(item.url) : null;
    const normalizedURL = item.url ? normalizeURL(item.url) : '';

    if (doi) {
      if (seenDOIs.has(doi)) continue;
      seenDOIs.add(doi);
    }
    if (normalizedURL) {
      if (seenURLs.has(normalizedURL)) continue;
      seenURLs.add(normalizedURL);
    }
    deduped.push(item);
  }
  return deduped;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 來源權重排序 ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const SOURCE_WEIGHTS = {
  'exa': 10,        // 語意搜尋，最相關
  'scholar': 9,     // 學術論文，高可信度
  'openalex': 8,    // 學術論文
  'github': 7,      // 開源專案
  'community': 6,   // 社群討論
  'web': 5,         // 一般網頁
  'code': 7,        // 程式碼
};

function sortByRelevance(items) {
  return items.sort((a, b) => {
    const wa = (SOURCE_WEIGHTS[a.source] || 5) * (a.score || 0.5);
    const wb = (SOURCE_WEIGHTS[b.source] || 5) * (b.score || 0.5);
    return wb - wa;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 多源並行搜尋統一入口（auto / all 共用）───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export async function multiSourceSearch(searchQuery, maxResults = 10, options = {}) {
  const { depth = 'shallow' } = options;
  const searchQueries = generateSearchQueries(searchQuery);
  const enhancedQuery = enhanceQueryForEDA(searchQuery);

  // 基礎 6 來源 + Exa（可選第 7 來源）
  const searches = [
    searchWebDDG(searchQueries.web, maxResults),
    searchEDACommunities(searchQuery, maxResults),
    searchSemanticScholar(searchQueries.academic || enhancedQuery, maxResults).then(r => r.ok ? r.data : []),
    searchOpenAlex(searchQueries.academic || enhancedQuery, Math.min(maxResults, 5)),
    searchGitHubCode(searchQueries.github, 5),
    searchGitHubEDA(searchQuery, 5),
  ];

  // Exa 語意搜尋（第 7 來源，需 API key）
  if (isExaAvailable()) {
    searches.push(searchExa(searchQuery, Math.min(maxResults, 5)));
  }

  const sources = await Promise.allSettled(searches);

  // ── 整理各來源結果 ──────────────────────────────────────────────────
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

  const scholarData = sources[2].status === 'fulfilled' ? sources[2].value : [];
  if (scholarData.length > 0) output += formatSemanticScholarResults(scholarData);

  const articles = sources[3].status === 'fulfilled' ? sources[3].value : [];
  if (articles.length > 0) output += formatOpenAlexResults(articles);

  const ghCode = sources[4].status === 'fulfilled' ? sources[4].value : [];
  if (ghCode.length > 0) {
    output += `💻 **GitHub 程式碼**（相關 script / tool flow）\n\n`;
    for (const r of ghCode) output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
    output += '\n';
  }

  const ghRepos = sources[5].status === 'fulfilled' ? sources[5].value : [];
  if (ghRepos.length > 0) output += formatGitHubResults(ghRepos, 'GitHub 相關 EDA 專案');

  // Exa 結果（第 7 來源）
  const exaData = isExaAvailable() && sources[6]?.status === 'fulfilled' ? sources[6].value : [];
  if (exaData.length > 0) {
    output += `🔍 **Exa 語意搜尋**（${exaData.length} 筆）\n\n`;
    for (const r of exaData) {
      output += `- [${r.title}](${r.url})\n`;
      if (r.snippet) output += `  > ${r.snippet.slice(0, 150)}\n`;
    }
    output += '\n';
  }

  // ── deep 模式：爬取 top 結果全文 ──────────────────────────────────
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

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 主要處理函式（預驗證 + dispatch）────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ACTIONS_NO_QUERY = ['list-tools', 'list-pdk', 'list-conferences', 'flow', 'dft', 'lec', 'eco', 'fpga'];

async function edaSearch(args = {}) {
  const action = String(args.action || 'auto').toLowerCase();
  const searchQuery = String(args.question || args.query || '').trim();

  // 預驗證：部分 action 不需要 query
  if (!searchQuery && !ACTIONS_NO_QUERY.includes(action)) {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    return await dispatch(action, args);
  } catch (err) {
    return { ok: false, error: `EDA 搜尋錯誤: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin Export（向後相容：name/description/inputSchema/handler 不變）
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: 'smart_eda_search',
  description:
    '[search] EDA 領域智慧知識引擎。查詢 IC design、cell-based flow、EDA tool、PDK、學術論文。'
    + '完全免費，不需要 API 金鑰。'
    + '支援 18 種 action：auto（自動判斷）、pdk（PDK/cell library）、paper（學術論文）、tool（EDA 工具）、github（GitHub 專案）、code（程式碼搜尋）、all（綜合）、list-tools、list-pdk、list-conferences、flow、dft、lec、eco、fpga、troubleshoot（Tool 問題診斷含 FAQ+廠商 Q&A）。'
    + '資料來源：GitHub API + OpenAlex + Semantic Scholar + Exa（可選）。'
    + '內建 55+ EDA 工具索引（含 30+ 商業工具）、10+ PDK 索引、11 個 cell flow stages、10 個 tool FAQ 索引（DC/Innovus/PrimeTime/Calibre/Vivado/VCS/Xcelium/LEC/Formality）、9 大 EDA 會議。',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'auto', 'pdk', 'paper', 'papers',
          'tool', 'tools', 'github', 'code',
          'all', 'comprehensive',
          'list-tools', 'list-pdk', 'list-conferences',
          'flow', 'dft', 'lec', 'eco', 'fpga',
          'troubleshoot', 'docs',
        ],
        description: '查詢動作。auto=自動判斷類型，pdk=PDK/cell library，paper=學術論文，tool=EDA工具，github=GitHub專案，code=程式碼搜尋，all=綜合，list-tools=列出已知工具，list-pdk=列出已知PDK，list-conferences=列出EDA會議，flow=cell flow stages，dft=Design-for-Test，lec=Logic Equivalence Check，eco=Engineering Change Order，fpga=FPGA Design Flow，troubleshoot=Tool 問題診斷（FAQ+廠商Q&A），docs=爬取工具 user guide / 文件',
      },
      question: {
        type: 'string',
        description: 'EDA 相關問題或查詢（例如："SKY130 standard cell library 有哪些？"）',
      },
      query: {
        type: 'string',
        description: '查詢字串（question 的別名，兩者擇一提供）',
      },
      maxResults: {
        type: 'number',
        description: '最大結果數量（預設 10）',
      },
    },
  },
  handler: edaSearch,
};
