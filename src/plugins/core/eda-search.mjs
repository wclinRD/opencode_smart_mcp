/**
 * smart_eda_search — EDA 領域智慧知識引擎
 *
 * 多來源 EDA/IC Design 資料查詢工具，完全免費，不需要 API 金鑰：
 *   1. GitHub API — PDK repo、cell library、EDA tool repo（免費，60 req/hr）
 *   2. OpenAlex — EDA 學術論文（免費，10 萬 req/day）
 *   3. Semantic Scholar — EDA 論文 + TLDR 摘要（免費，100 req/5min）
 *   4. OpenROAD / Yosys / OpenLane 文件 — 常用 EDA 工具文件索引
 *
 * 定位：與 MCP4EDA 等「工具執行器」互補，提供「知識查詢」能力。
 *   • MCP4EDA 們：跑合成、模擬、P&R（需安裝工具 + Docker）
 *   • smart_eda_search：查 PDK cell、找論文、找工具用法（免安裝）
 */

// ── 資料索引（從 eda/data/ 匯入）──────────────────────────────────────────────
import { EDA_TOOL_INDEX } from './eda/data/tools.mjs';
import { TOOL_FAQ_INDEX } from './eda/data/faq.mjs';
import { VENDOR_DOCS } from './eda/data/docs.mjs';
import { PDK_INDEX } from './eda/data/pdk.mjs';
import { EDA_CONFERENCES, EDA_COMMUNITIES, EDA_FORMATS, TOOL_ISSUE_PATTERNS } from './eda/data/meta.mjs';
import { CELL_FLOW_STAGES, EDA_CMD_INDEX } from './eda/data/flow.mjs';
import { EDA_ABBREVIATIONS, PATTERN_RULES } from './eda/data/abbreviations.mjs';

const USER_AGENT = 'SmartMCP/2.0 (eda-search)';
const DEFAULT_TIMEOUT = 20000;

// ── GitHub API ───────────────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

// ── OpenAlex ─────────────────────────────────────────────────────────────────
const OPENALEX_API = 'https://api.openalex.org';

// ── Semantic Scholar ─────────────────────────────────────────────────────────
const SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP 工具函式
// ═══════════════════════════════════════════════════════════════════════════════

async function httpsGet(url, opts = {}) {
  const controller = new AbortController();
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      ...opts.headers,
    };
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GitHub API — PDK / Cell Library / EDA Tool 查詢
// ═══════════════════════════════════════════════════════════════════════════════

async function searchGitHubPDK(query, maxResults = 10) {
  const q = encodeURIComponent(`${query} PDK OR "standard cell" OR "process design kit"`);
  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
  const data = await httpsGet(url);
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

async function searchGitHubEDA(query, maxResults = 10) {
  const q = encodeURIComponent(`${query} EDA OR "electronic design automation" OR synthesis OR "place and route" OR "static timing"`);
  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
  const data = await httpsGet(url);
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

// ── 文件爬取（開源工具 GitHub raw）─────────────────────────────────────────────
async function fetchDocContent(toolKey, topic) {
  const docInfo = VENDOR_DOCS[toolKey];
  if (!docInfo) return null;

  // 開源工具：從 GitHub raw URL 爬取
  if (docInfo.type === 'open-source') {
    const doc = docInfo.docs.find(d => d.topic === topic) || docInfo.docs[0];
    if (!doc || !doc.url) return null;
    try {
      // 用 text fetch（非 JSON）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(doc.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const content = await resp.text();
      // 截取前 3000 字元（避免太長）
      const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n\n... (內容已截斷)' : content;
      return {
        tool: docInfo.name,
        topic: doc.topic,
        source: doc.url,
        type: 'fetched',
        content: truncated,
      };
    } catch (err) {
      return { tool: docInfo.name, topic, source: doc.url, type: 'error', error: err.message };
    }
  }

  // 商業工具：返回索引的 excerpt
  if (docInfo.type === 'commercial') {
    const docs = topic
      ? docInfo.docs.filter(d => d.topic === topic || d.topic === 'overview')
      : docInfo.docs.slice(0, 3); // 預設返回前 3 個 topic
    if (docs.length === 0) return null;
    return {
      tool: docInfo.name,
      topic: topic || 'overview',
      type: 'indexed',
      vendor: docInfo.vendor,
      excerpts: docs.map(d => ({ topic: d.topic, content: d.excerpt })),
      solvnet: docInfo.vendor === 'synopsys'
        ? `https://solvnet.synopsys.com/solve/qa?search=${encodeURIComponent(docInfo.name + ' ' + (topic || ''))}`
        : docInfo.vendor === 'cadence'
        ? `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution`
        : null,
    };
  }

  return null;
}

// 偵測 query 中的 topic 關鍵字
function detectDocTopic(query) {
  const q = query.toLowerCase();
  const topicMap = [
    ['overview', /overview|introduction|what is|介紹|概觀|概述/i],
    ['analyze', /analyze|analysis|分析/i],
    ['elaborate', /elaborate|展開/i],
    ['compile', /compile|synthesis|合成|編譯/i],
    ['link', /link|連結|連接/i],
    ['timing', /timing|時序|時脈|STA|setup|hold/i],
    ['area', /area|面積/i],
    ['power', /power|功耗|漏電/i],
    ['constraints', /constraint|SDC|constraint|set_clock|set_input|set_output/i],
    ['output', /output|write|write_sdc|write_sdf|輸出/i],
    ['placement', /place|placement|配置/i],
    ['cts', /cts|clock tree|時脈樹/i],
    ['route', /route|routing|繞線/i],
    ['opt', /opt|optimize|優化/i],
    ['drc', /DRC|design rule/i],
    ['lvs', /LVS|layout vs schematic/i],
    ['pex', /PEX|parasitic extraction|寄生/i],
    ['setup', /setup|initial|init|初始化/i],
    ['simulate', /simulate|simulation|模擬/i],
    ['debug', /debug|除錯|調試/i],
    ['coverage', /coverage|覆蓋率/i],
    ['lint', /lint|語法/i],
    ['cdc', /CDC|clock domain crossing/i],
    ['verify', /verify|verification| equivalence|等價/i],
    ['scan', /scan chain|scan insertion/i],
    ['ocv', /OCV|on-chip variation/i],
    ['clock', /clock|skew|latency/i],
    ['extraction', /extraction|提取/i],
  ];
  for (const [topic, pattern] of topicMap) {
    if (pattern.test(q)) return topic;
  }
  return null;
}

// ── 廠商 Q&A 搜尋 ─────────────────────────────────────────────────────────
// 偵測 tool 問題時，自動生成 SolvNet / Cadence Support 搜尋 URL
function generateVendorSearchURL(toolName, query) {
  const toolLower = toolName.toLowerCase();
  const searchQuery = encodeURIComponent(`${query} ${toolName}`);
  const urls = [];

  // Synopsys 工具 → SolvNet
  if (['design compiler', 'dc', 'vcs', 'primetime', 'pt', 'formality', 'fmod', 'icc2', 'dc explorer', 'spyglass'].some(t => toolLower.includes(t))) {
    urls.push({
      vendor: 'Synopsys SolvNet',
      url: `https://solvnet.synopsys.com/solve/qa?search=${searchQuery}`,
      note: 'Synopsys 官方 Q&A 知識庫',
    });
  }

  // Cadence 工具 → Cadence Support
  if (['innovus', 'xcelium', 'conformal', 'lec', 'virtuoso', 'tempus', 'voltus', 'genus', ' JasperGold', 'Stratus'].some(t => toolLower.includes(t))) {
    urls.push({
      vendor: 'Cadence Online Support',
      url: `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution&q=${searchQuery}`,
      note: 'Cadence 官方技術支援',
    });
  }

  // Siemens (Calibre) → Siemens EDA Support
  if (toolLower.includes('calibre') || toolLower.includes('siemens') || toolLower.includes('icv') || toolLower.includes('mGCAR')) {
    urls.push({
      vendor: 'Siemens EDA Support',
      url: `https://eda.com/support/calibre`,
      note: 'Siemens EDA (Calibre) 支援中心',
    });
  }

  // Xilinx/AMD → Xilinx Support
  if (toolLower.includes('vivado') || toolLower.includes('xilinx') || toolLower.includes('quartus')) {
    urls.push({
      vendor: 'AMD/Xilinx Support',
      url: `https://support.xilinx.com/s/global-search/${searchQuery}`,
      note: 'AMD/Xilinx 官方支援中心',
    });
  }

  // Intel → Intel Support
  if (toolLower.includes('quartus') || toolLower.includes('intel') || toolLower.includes('altera')) {
    urls.push({
      vendor: 'Intel Support',
      url: `https://www.intel.com/content/www/us/en/search.html?#q=${searchQuery}&t=All`,
      note: 'Intel FPGA 支援中心',
    });
  }

  // 通用搜尋 fallback
  if (urls.length === 0) {
    urls.push({
      vendor: 'Google',
      url: `https://www.google.com/search?q=${searchQuery}+error+solution+site:solvnet.synopsys.com+OR+site:support.cadence.com`,
      note: '通用 EDA 問題搜尋',
    });
  }

  return urls;
}

// 從 TOOL_FAQ_INDEX 搜尋匹配的 FAQ
function searchToolFAQ(query, toolFilter) {
  const q = query.toLowerCase();
  const results = [];

  for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
    // 如果有 tool filter，只搜尋指定工具
    if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) {
      continue;
    }

    for (const faq of toolData.faqs) {
      // 用 regex pattern 匹配錯誤訊息
      if (faq.pattern.test(query)) {
        results.push({
          tool: toolData.tool,
          error: faq.error,
          cause: faq.cause,
          solution: faq.solution,
          solvnet: faq.solvnet,
        });
      }
    }
  }

  // 如果 regex 沒匹配，用 word overlap 做 fuzzy 搜尋
  if (results.length === 0) {
    const words = q.split(/\s+/).filter(w => w.length > 2);
    for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
      if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) {
        continue;
      }

      for (const faq of toolData.faqs) {
        const faqText = `${faq.error} ${faq.cause} ${faq.solution}`.toLowerCase();
        const overlap = words.filter(w => faqText.includes(w));
        if (overlap.length >= Math.ceil(words.length * 0.4) || overlap.length >= 2) {
          results.push({
            tool: toolData.tool,
            error: faq.error,
            cause: faq.cause,
            solution: faq.solution,
            solvnet: faq.solvnet,
            matchScore: overlap.length / words.length,
          });
        }
      }
    }
    // 按 matchScore 排序
    results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }

  return results.slice(0, 5);
}

function isToolIssueQuery(query) {
  return TOOL_ISSUE_PATTERNS.some(p => p.test(query));
}

async function searchGitHubCode(query, maxResults = 5) {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/code?q=${q}&per_page=${maxResults}`;
  const data = await httpsGet(url).catch(() => ({ items: [] }));
  return (data.items || []).map(r => ({
    name: r.name,
    path: r.path,
    repo: r.repository.full_name,
    url: r.html_url,
    score: r.score,
  }));
}

function formatGitHubResults(items, title) {
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1b. DuckDuckGo Web Search — 廣域網路搜尋（免 API key）
// ═══════════════════════════════════════════════════════════════════════════════

async function searchWebDDG(query, maxResults = 8) {
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
    // Parse lite HTML — each result is in a <td class="result-link"> block
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

function formatWebResults(results, title = '🌐 網路搜尋') {
  if (!results || results.length === 0) return `${title}：無結果\n`;
  let out = `${title}（${results.length} 筆）\n\n`;
  for (const r of results) {
    out += `### [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1c. EDA Community Search — Cadence/Synopsys/EE Times/Reddit 社群
// ═══════════════════════════════════════════════════════════════════════════════

async function searchEDACommunities(query, maxResults = 10) {
  // 為每個社群做 site-specific 搜尋（並行，限制每個社群 2-3 筆）
  const perCommunity = Math.max(2, Math.floor(maxResults / EDA_COMMUNITIES.length));
  
  const searches = EDA_COMMUNITIES.map(async (community) => {
    try {
      const siteQuery = community.queryTemplate(query);
      const results = await searchWebDDG(siteQuery, perCommunity);
      return results.map(r => ({ ...r, community: community.name }));
    } catch {
      return [];
    }
  });
  
  const allResults = await Promise.allSettled(searches);
  const merged = allResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .slice(0, maxResults);
  
  return merged;
}

// 爬取論壇頁面提取討論內容（可選，用於深入分析）
async function crawlForumPages(urls, maxChars = 3000) {
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
        // 簡易提取：移除 script/style，取 body 文字
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxChars);
        return { url, content: text };
      } catch {
        return null;
      }
    })
  );
  
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

function formatCommunityResults(results, crawledPages = []) {
  if (!results || results.length === 0) return '💬 EDA 社群：無結果\n';
  let out = `💬 EDA 社群討論（${results.length} 筆）\n\n`;
  
  // 建立 URL → content 映射
  const crawledMap = new Map((crawledPages || []).map(p => [p.url, p.content]));
  
  for (const r of results) {
    const badge = r.community ? ` [${r.community}]` : '';
    out += `###${badge} [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    
    // 如果有爬取內容，顯示摘要
    const crawled = crawledMap.get(r.url);
    if (crawled) {
      out += `\n📄 **討論內容摘要**：\n`;
      out += '```\n' + crawled.slice(0, 800) + '\n```\n';
    }
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. OpenAlex — EDA 學術論文
// ═══════════════════════════════════════════════════════════════════════════════

async function searchOpenAlex(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const url = `${OPENALEX_API}/works?search=${q}&per_page=${maxResults}&sort=cited_by_count:desc&filter=concepts.id:C119857082|C154945302|C41008148`; // Electronics, Electrical Engineering, Computer Science
  const data = await httpsGet(url);
  return (data.results || []).map(w => ({
    title: w.title || 'Untitled',
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 3).join(', ') + ((w.authorships || []).length > 3 ? ' et al.' : ''),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || '',
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : '',
    citedBy: w.cited_by_count || 0,
    isOA: w.open_access?.is_oa || false,
    url: w.open_access?.oa_url || w.doi || '',
    abstract: reconstructAbstract(w.abstract_inverted_index),
  }));
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 600);
}

function formatOpenAlexResults(articles) {
  if (!articles || articles.length === 0) return '📚 OpenAlex：無結果\n';
  let out = `📚 OpenAlex 學術論文（${articles.length} 筆）\n\n`;
  for (const a of articles) {
    out += `### 📄 ${a.title}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 作者 | ${a.authors} |\n`;
    if (a.year) out += `| 年份 | ${a.year} |\n`;
    if (a.journal) out += `| 期刊/會議 | ${a.journal} |\n`;
    if (a.doi) out += `| DOI | [${a.doi}](https://doi.org/${a.doi}) |\n`;
    if (a.citedBy) out += `| 被引用 | ${a.citedBy} |\n`;
    if (a.isOA !== undefined) out += `| Open Access | ${a.isOA ? '✅' : '❌'} |\n`;
    if (a.url) out += `| 連結 | ${a.url} |\n`;
    if (a.abstract) out += `\n**摘要**: ${a.abstract}...\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Semantic Scholar — EDA 論文 + TLDR
// ═══════════════════════════════════════════════════════════════════════════════

async function searchSemanticScholar(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const fields = 'title,authors,year,venue,citationCount,externalIds,openAccessPdf,tldr,abstract';
  const url = `${SCHOLAR_API}/paper/search?query=${q}&limit=${maxResults}&fields=${fields}`;
  const data = await httpsGet(url);
  if (!data.data || data.data.length === 0) {
    return { ok: false, message: 'Semantic Scholar：無結果' };
  }
  return {
    ok: true,
    data: data.data.map(p => ({
      title: p.title || 'Untitled',
      authors: (p.authors || []).map(a => a.name).slice(0, 3).join(', ') + ((p.authors || []).length > 3 ? ' et al.' : ''),
      year: p.year,
      venue: p.venue || '',
      citedBy: p.citationCount || 0,
      doi: p.externalIds?.DOI || '',
      url: p.openAccessPdf?.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ''),
      tldr: p.tldr?.text || '',
      abstract: (p.abstract || '').slice(0, 500),
    })),
  };
}

function formatSemanticScholarResults(data) {
  if (!data || data.length === 0) return '📚 Semantic Scholar：無結果\n';
  let out = `📚 Semantic Scholar 論文（${data.length} 筆）\n\n`;
  for (const p of data) {
    out += `### 📄 ${p.title}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 作者 | ${p.authors} |\n`;
    if (p.year) out += `| 年份 | ${p.year} |\n`;
    if (p.venue) out += `| 會議/期刊 | ${p.venue} |\n`;
    if (p.citedBy) out += `| 被引用 | ${p.citedBy} |\n`;
    if (p.doi) out += `| DOI | [${p.doi}](https://doi.org/${p.doi}) |\n`;
    if (p.url) out += `| 連結 | ${p.url} |\n`;
    if (p.tldr) out += `\n> 💡 **TLDR**: ${p.tldr}\n`;
    if (p.abstract && !p.tldr) out += `\n**摘要**: ${p.abstract}...\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PDK 快速查詢（本地索引 + GitHub API 補充）
// ═══════════════════════════════════════════════════════════════════════════════

function searchLocalPDK(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, pdk] of Object.entries(PDK_INDEX)) {
    const searchable = `${key} ${pdk.name} ${pdk.node} ${pdk.foundry} ${(pdk.cells || []).join(' ')}`.toLowerCase();
    // OR logic: any word matches = hit
    if (words.some(w => searchable.includes(w))) {
      results.push({ key, ...pdk });
    }
  }
  return results;
}

function formatPDKResults(results) {
  if (!results || results.length === 0) return '🏭 PDK：無符合結果\n';
  let out = `🏭 PDK / Cell Library 查詢結果（${results.length} 筆）\n\n`;
  for (const p of results) {
    out += `### 🔬 ${p.name} (${p.node})\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| Foundry | ${p.foundry} |\n`;
    out += `| 類型 | ${p.type} |\n`;
    out += `| GitHub | [${p.repo}](https://github.com/${p.repo}) |\n`;
    if (p.pythonPkg) out += `| Python Package | \`pip install ${p.pythonPkg}\` |\n`;
    if (p.cells && p.cells.length > 0) out += `| Cell Libraries | ${p.cells.join(', ')} |\n`;
    out += `| 說明 | ${p.desc} |\n\n`;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. EDA Tool 快速查詢（本地索引）
// ═══════════════════════════════════════════════════════════════════════════════

function searchLocalTools(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, tool] of Object.entries(EDA_TOOL_INDEX)) {
    const searchable = `${key} ${tool.name} ${tool.category} ${tool.desc} ${tool.alt}`.toLowerCase();
    // OR logic: any word matches = hit
    if (words.some(w => searchable.includes(w))) {
      results.push({ key, ...tool });
    }
  }
  return results;
}

function formatToolResults(results) {
  if (!results || results.length === 0) return '🔧 EDA Tool：無符合結果\n';
  let out = `🔧 EDA 工具查詢結果（${results.length} 筆）\n\n`;
  for (const t of results) {
    out += `### ⚙️ ${t.name}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 分類 | ${t.category} |\n`;
    out += `| GitHub | [${t.repo}](https://github.com/${t.repo}) |\n`;
    out += `| 文件 | ${t.docs} |\n`;
    out += `| 說明 | ${t.desc} |\n`;
    if (t.alt) out += `| 商業替代 | ${t.alt} |\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. EDA 論文特殊查詢（會議/主題）
// ═══════════════════════════════════════════════════════════════════════════════

function detectConference(query) {
  const q = query.toUpperCase();
  for (const conf of EDA_CONFERENCES) {
    if (q.includes(conf.toUpperCase())) return conf;
  }
  return null;
}

function enhanceQueryForEDA(query) {
  // 如果查詢已包含 EDA 關鍵詞，直接用
  const edaKeywords = ['synthesis', 'placement', 'routing', 'timing', 'clock tree', 'floorplan',
    'P&R', 'STA', 'DRC', 'LVS', 'PDK', 'standard cell', 'RTL', 'GDSII', 'netlist',
    'EDA', 'VLSI', 'ASIC', 'FPGA', 'FinFET', 'CMOS', 'liberty', '.lib', 'characterize',
    'clock mux', 'CDC', 'metastability', 'synchronizer', 'UPF', 'power domain',
    'multi-cycle', 'false path', 'clock gating', 'OCV', 'AOCV', 'POCV'];
  const hasEDAKeyword = edaKeywords.some(k => query.toLowerCase().includes(k.toLowerCase()));
  if (hasEDAKeyword) return query;
  // 否則加上 EDA 背景
  return `${query} VLSI EDA IC design`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 查詢展開：模式規則 + 縮寫展開 + 多變體生成
// ═══════════════════════════════════════════════════════════════════════════════

// 為查詢生成多個搜尋變體
function generateQueryVariants(originalQuery, maxVariants = 3) {
  const variants = [originalQuery]; // 原始查詢 always 第一個
  const q = originalQuery.toLowerCase();
  
  // 1. 縮寫展開
  const words = q.split(/\s+/);
  const expandedWords = words.map(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '');
    return EDA_ABBREVIATIONS[clean] || w;
  });
  const expanded = expandedWords.join(' ');
  if (expanded !== q) variants.push(originalQuery.replace(new RegExp(words.join('|'), 'gi'), (m) => EDA_ABBREVIATIONS[m.toLowerCase()] || m));
  
  // 2. 模式規則展開
  let patternExpanded = originalQuery;
  let hasPattern = false;
  for (const rule of PATTERN_RULES) {
    if (rule.pattern.test(patternExpanded)) {
      patternExpanded = patternExpanded.replace(rule.pattern, rule.expand);
      hasPattern = true;
      rule.pattern.lastIndex = 0; // reset regex
    }
  }
  if (hasPattern && patternExpanded !== originalQuery) {
    variants.push(patternExpanded);
  }
  
  // 3. 常見相關詞（根據查詢內容自動判斷）
  if (q.includes('mux') || q.includes('clock')) {
    variants.push(`${originalQuery} glitch-free`);
  }
  if (q.includes('setup') || q.includes('hold')) {
    variants.push(`${originalQuery} timing violation`);
  }
  if (q.includes('liberty') || q.includes('.lib')) {
    variants.push(`${originalQuery} characterization NLDM`);
  }
  
  return [...new Set(variants)].slice(0, maxVariants);
}

// 為不同搜尋來源生成最佳化查詢（增強版）
function generateSearchQueries(originalQuery, context = 'general') {
  const q = originalQuery.toLowerCase();
  const queries = { web: '', community: '', academic: '', github: '' };
  
  // 基礎查詢
  const base = originalQuery;
  
  // Web 搜尋：根據問題類型加入 troubleshooting/methodology
  if (q.includes('error') || q.includes('fail') || q.includes('問題') || q.includes('fix')
    || q.includes('violation') || q.includes('warning')) {
    queries.web = `${base} EDA solution fix troubleshooting`;
  } else if (q.includes('how to') || q.includes('怎么') || q.includes('如何') || q.includes('方法')) {
    queries.web = `${base} EDA methodology best practice`;
  } else if (q.includes('what is') || q.includes('是什麼') || q.includes('概念')) {
    queries.web = `${base} EDA explanation tutorial`;
  } else {
    queries.web = `${base} EDA ASIC IC design`;
  }
  
  // Community 搜尋：用 site-specific（由 searchEDACommunities 處理）
  queries.community = base;
  
  // Academic 搜尋：加入 paper/survey/analysis
  if (q.includes('theory') || q.includes('原理') || q.includes('algorithm')) {
    queries.academic = `${base} VLSI ASIC theoretical analysis`;
  } else if (q.includes('compare') || q.includes('比較') || q.includes('vs')) {
    queries.academic = `${base} VLSI ASIC comparison survey`;
  } else {
    queries.academic = `${base} VLSI ASIC survey analysis`;
  }
  
  // GitHub 搜尋：根據查詢類型調整
  if (q.includes('script') || q.includes('flow') || q.includes('script')) {
    queries.github = `${base} script automation`;
  } else if (q.includes('liberty') || q.includes('.lib') || q.includes('timing')) {
    queries.github = `${base} liberty characterization script`;
  } else {
    queries.github = `${base} tool flow example`;
  }
  
  return queries;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主要處理函式
// ═══════════════════════════════════════════════════════════════════════════════

async function edaSearch(args = {}) {
  const action = String(args.action || 'auto').toLowerCase();
  const question = String(args.question || '').trim();
  const query = String(args.query || '').trim();
  const searchQuery = question || query;
  const maxResults = args.maxResults || 10;

  if (!searchQuery && !['list-tools', 'list-pdk', 'list-conferences', 'flow', 'dft', 'lec', 'eco', 'fpga'].includes(action)) {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    switch (action) {

      // ── 自動模式：智能判斷查詢類型 ──
      case 'auto': {
        const q = searchQuery.toLowerCase();

        // EDA 工具查詢（優先：tool 問題偵測需要先判斷）
        if (q.includes('tool') || q.includes('工具') || q.includes('synthesis') || q.includes('synth')
          || q.includes(' STA') || q.includes('timing') || q.includes('place') || q.includes('route')
          || q.includes('verilat') || q.includes('iverilog') || q.includes('yosys') || q.includes('openroad')
          || q.includes('klayout') || q.includes('simulation') || q.includes('formal')
          || q.includes('dc ') || q.includes('genus') || q.includes('innovus') || q.includes('icc2')
          || q.includes('primetime') || q.includes('tempus') || q.includes('lec') || q.includes('formality')
          || q.includes('eco') || q.includes('vivado') || q.includes('quartus') || q.includes('calibre')
          || q.includes('icv') || q.includes('vcs') || q.includes('xcelium') || q.includes('questa')
          || q.includes('jasper') || q.includes('spyglass') || q.includes('dft') || q.includes('modus')
          || q.includes('virtuoso') || q.includes('starrc') || q.includes('quantus') || q.includes('voltus')
          || q.includes('primepower') || q.includes('redhawk') || q.includes('totem') || q.includes('hal')
          || q.includes('diamond') || q.includes('synplify') || q.includes('netgen')) {
          const localTools = searchLocalTools(searchQuery);
          let output = '';
          if (localTools.length > 0) {
            output += formatToolResults(localTools) + '\n';
          }
          try {
            const ghResults = await searchGitHubEDA(searchQuery, 5);
            output += formatGitHubResults(ghResults, 'GitHub 相關 EDA 工具');
          } catch { /* ignore */ }

          // 偵測 tool 問題 → 自動補充 FAQ + 廠商 URL
          if (isToolIssueQuery(searchQuery)) {
            // 找出 query 中明確提到的 tool（取最精確匹配）
            const toolKeys = Object.keys(EDA_TOOL_INDEX).filter(k => q.includes(k));
            const detectedTool = toolKeys.length > 0 ? toolKeys[0] : null;
            const faqResults = searchToolFAQ(searchQuery, detectedTool);
            console.log('[DEBUG auto-faq] q:', q, 'toolKeys:', toolKeys, 'detectedTool:', detectedTool, 'faqCount:', faqResults.length);
            if (faqResults.length > 0) {
              output += `\n## 🔧 偵測到 Tool 問題，自動補充 FAQ：\n\n`;
              for (const faq of faqResults.slice(0, 3)) {
                output += `### 🔴 ${faq.error}\n`;
                output += `**原因**：${faq.cause}\n\n`;
                output += `**解決方案**：\n\n${faq.solution}\n\n`;
                if (faq.solvnet) output += `📎 [廠商 Q&A](${faq.solvnet})\n\n`;
              }
              const toolName = detectedTool ? EDA_TOOL_INDEX[detectedTool]?.name : searchQuery;
              const vendorURLs = generateVendorSearchURL(toolName, searchQuery);
              if (vendorURLs.length > 0) {
                output += `## 🔗 廠商支援資源\n\n`;
                for (const vu of vendorURLs) {
                  output += `- [${vu.vendor}](${vu.url}) — ${vu.note}\n`;
                }
              }
            }
          }

          return { ok: true, output: output || '🔍 自動搜尋：未找到 EDA 工具相關結果' };
        }

        // PDK 相關查詢
        if (q.includes('pdk') || q.includes('sky') || q.includes('asap') || q.includes('cell lib')
          || q.includes('130nm') || q.includes('7nm') || q.includes('45nm') || q.includes('180nm')
          || q.includes('finfet') || q.includes('gf180') || q.includes('nangate')) {
          const localPDK = searchLocalPDK(searchQuery);
          let output = '';
          if (localPDK.length > 0) {
            output += formatPDKResults(localPDK) + '\n';
          }
          try {
            const ghResults = await searchGitHubPDK(searchQuery, 5);
            output += formatGitHubResults(ghResults, 'GitHub 相關 PDK 專案');
          } catch { /* ignore */ }
          return { ok: true, output: output || '🔍 自動搜尋：未找到 PDK 相關結果' };
        }

        // ── 多源並行廣搜（使用多維度查詢）──
        const searchQueries = generateSearchQueries(searchQuery);
        const enhancedQuery = enhanceQueryForEDA(searchQuery);
        const sources = await Promise.allSettled([
          // 1. 網路搜尋（DuckDuckGo）— 廣域覆蓋，使用優化查詢
          searchWebDDG(searchQueries.web, maxResults),
          // 2. EDA 社群搜尋（Cadence/Synopsys/Reddit/EE Times）— 使用社群查詢
          searchEDACommunities(searchQuery, maxResults),
          // 3. Semantic Scholar 學術論文 — 使用學術查詢
          searchSemanticScholar(searchQueries.academic || enhancedQuery, maxResults).then(r => r.ok ? r.data : []),
          // 4. OpenAlex 學術論文
          searchOpenAlex(searchQueries.academic || enhancedQuery, Math.min(maxResults, 5)),
          // 5. GitHub code search — 使用 GitHub 查詢
          searchGitHubCode(searchQueries.github, 5),
          // 6. GitHub repo search — 找相關 EDA 專案
          searchGitHubEDA(searchQuery, 5),
        ]);

        let output = '';

        // 網路搜尋結果（最廣覆蓋）
        const webResults = sources[0].status === 'fulfilled' ? sources[0].value : [];
        if (webResults.length > 0) output += formatWebResults(webResults);

        // EDA 社群結果（含爬取論壇內容）
        const communityResults = sources[1].status === 'fulfilled' ? sources[1].value : [];
        if (communityResults.length > 0) {
          // 爬取前 3 個社群頁面提取討論內容
          const topUrls = communityResults.slice(0, 3).map(r => r.url);
          let crawledPages = [];
          try {
            crawledPages = await crawlForumPages(topUrls);
          } catch { /* ignore crawl errors */ }
          output += formatCommunityResults(communityResults, crawledPages);
        }

        // Semantic Scholar
        const scholarData = sources[2].status === 'fulfilled' ? sources[2].value : [];
        if (scholarData.length > 0) output += formatSemanticScholarResults(scholarData);

        // OpenAlex
        const articles = sources[3].status === 'fulfilled' ? sources[3].value : [];
        if (articles.length > 0) output += formatOpenAlexResults(articles);

        // GitHub code — 實際 script / flow
        const ghCode = sources[4].status === 'fulfilled' ? sources[4].value : [];
        if (ghCode.length > 0) {
          output += `💻 **GitHub 程式碼**（相關 script / tool flow）\n\n`;
          for (const r of ghCode) {
            output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
          }
          output += '\n';
        }

        // GitHub repo
        const ghRepos = sources[5].status === 'fulfilled' ? sources[5].value : [];
        if (ghRepos.length > 0) output += formatGitHubResults(ghRepos, 'GitHub 相關 EDA 專案');

        // 偵測是否提到特定會議
        const conf = detectConference(searchQuery);
        if (conf) {
          output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
          output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
          output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
          output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
        }

        // 提示：如需更深入搜尋可用 smart_exa_search
        if (!output || output.length < 100) {
          output += `\n💡 如需更深入搜尋，可用 \`smart_exa_search\` 查詢：\n`;
          output += `  \`smart_exa_search({command:"search", query:"${searchQuery}", numResults:10})\`\n`;
        }

        return { ok: true, output: output || '🔍 自動搜尋：無結果' };
      }

      // ── PDK / Cell Library 查詢 ──
      case 'pdk': {
        const localPDK = searchLocalPDK(searchQuery);
        let output = formatPDKResults(localPDK);
        // 補充 GitHub
        try {
          const ghResults = await searchGitHubPDK(searchQuery, maxResults);
          output += '\n' + formatGitHubResults(ghResults, 'GitHub PDK 相關專案');
        } catch { /* ignore */ }
        return { ok: true, output };
      }

      // ── EDA 學術論文搜尋 ──
      case 'paper':
      case 'papers': {
        let output = '';
        const enhancedQuery = enhanceQueryForEDA(searchQuery);

        // Semantic Scholar + TLDR
        try {
          const scholarResult = await searchSemanticScholar(enhancedQuery, maxResults);
          if (scholarResult.ok) {
            output += formatSemanticScholarResults(scholarResult.data) + '\n';
          } else {
            output += `⚠️ ${scholarResult.message}\n\n`;
          }
        } catch (err) {
          output += `⚠️ Semantic Scholar：${err.message}\n\n`;
        }

        // OpenAlex
        try {
          const articles = await searchOpenAlex(enhancedQuery, Math.min(maxResults, 5));
          output += formatOpenAlexResults(articles);
        } catch (err) {
          output += `⚠️ OpenAlex：${err.message}\n`;
        }

        // 偵測是否提到特定會議
        const conf = detectConference(searchQuery);
        if (conf) {
          output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
          output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
          output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
          output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
        }

        return { ok: true, output: output || '📚 學術論文：無結果' };
      }

      // ── EDA 工具文件搜尋 ──
      case 'tool':
      case 'tools': {
        const localTools = searchLocalTools(searchQuery);
        let output = formatToolResults(localTools);

        // GitHub 搜尋更多工具
        try {
          const ghResults = await searchGitHubEDA(searchQuery, maxResults);
          output += '\n' + formatGitHubResults(ghResults, 'GitHub EDA 工具');
        } catch { /* ignore */ }

        return { ok: true, output };
      }

      // ── GitHub EDA 專案搜尋 ──
      case 'github': {
        const results = await searchGitHubEDA(searchQuery, maxResults);
        return { ok: true, output: formatGitHubResults(results, 'GitHub EDA 專案') };
      }

      // ── GitHub 程式碼搜尋 ──
      case 'code': {
        const results = await searchGitHubCode(searchQuery, Math.min(maxResults, 5));
        if (!results || results.length === 0) {
          return { ok: true, output: '🔍 GitHub 程式碼：無結果\n' };
        }
        let out = `🔍 GitHub 程式碼搜尋（${results.length} 筆）\n\n`;
        for (const r of results) {
          out += `### 📄 [${r.name}](${r.url})\n`;
          out += `*Repo: ${r.repo} | Path: ${r.path}*\n\n`;
        }
        return { ok: true, output: out };
      }

      // ── PDK + Tool + Paper + Web + Community 綜合搜尋 ──
      case 'all':
      case 'comprehensive': {
        let output = '';

        // PDK
        const localPDK = searchLocalPDK(searchQuery);
        if (localPDK.length > 0) output += formatPDKResults(localPDK);

        // Tools
        const localTools = searchLocalTools(searchQuery);
        if (localTools.length > 0) output += formatToolResults(localTools);

        // 多源並行搜尋（使用多維度查詢）
        const allSearchQueries = generateSearchQueries(searchQuery);
        const allEnhancedQuery = enhanceQueryForEDA(searchQuery);
        const allSources = await Promise.allSettled([
          searchWebDDG(allSearchQueries.web, maxResults),
          searchEDACommunities(searchQuery, maxResults),
          searchSemanticScholar(allSearchQueries.academic || allEnhancedQuery, 5).then(r => r.ok ? r.data : []),
          searchOpenAlex(allSearchQueries.academic || allEnhancedQuery, 5),
          searchGitHubEDA(searchQuery, 5),
          searchGitHubCode(allSearchQueries.github, 5),
        ]);

        const allWeb = allSources[0].status === 'fulfilled' ? allSources[0].value : [];
        if (allWeb.length > 0) output += formatWebResults(allWeb);

        const allCommunity = allSources[1].status === 'fulfilled' ? allSources[1].value : [];
        if (allCommunity.length > 0) {
          const allTopUrls = allCommunity.slice(0, 3).map(r => r.url);
          let allCrawledPages = [];
          try {
            allCrawledPages = await crawlForumPages(allTopUrls);
          } catch { /* ignore */ }
          output += formatCommunityResults(allCommunity, allCrawledPages);
        }

        const allScholar = allSources[2].status === 'fulfilled' ? allSources[2].value : [];
        if (allScholar.length > 0) output += formatSemanticScholarResults(allScholar);

        const allArticles = allSources[3].status === 'fulfilled' ? allSources[3].value : [];
        if (allArticles.length > 0) output += formatOpenAlexResults(allArticles);

        const allGH = allSources[4].status === 'fulfilled' ? allSources[4].value : [];
        if (allGH.length > 0) output += formatGitHubResults(allGH, 'GitHub 相關專案');

        const allGHCode = allSources[5].status === 'fulfilled' ? allSources[5].value : [];
        if (allGHCode.length > 0) {
          output += `💻 **GitHub 程式碼**\n\n`;
          for (const r of allGHCode) output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
          output += '\n';
        }

        return { ok: true, output: output || '🔍 綜合搜尋：未找到結果' };
      }

      // ── 列出已知 EDA 工具 ──
      case 'list-tools': {
        let out = `🔧 已索引 EDA 工具（${Object.keys(EDA_TOOL_INDEX).length} 筆）\n\n`;
        out += `| 類別 | 工具 | 商業替代 |\n|------|------|----------|\n`;
        for (const [key, t] of Object.entries(EDA_TOOL_INDEX)) {
          out += `| ${t.category} | **${t.name}** (\`${key}\`) | ${t.alt} |\n`;
        }
        return { ok: true, output: out };
      }

      // ── 列出已知 PDK ──
      case 'list-pdk': {
        let out = `🏭 已索引 PDK（${Object.keys(PDK_INDEX).length} 筆）\n\n`;
        out += `| 名稱 | 節點 | 類型 | Foundry |\n|------|------|------|----------|\n`;
        for (const [key, p] of Object.entries(PDK_INDEX)) {
          out += `| **${p.name}** (\`${key}\`) | ${p.node} | ${p.type} | ${p.foundry} |\n`;
        }
        return { ok: true, output: out };
      }

      // ── 列出 EDA 關鍵會議 ──
      case 'list-conferences': {
        let out = `🎓 EDA 關鍵會議\n\n`;
        const confDetails = {
          'DAC': { full: 'Design Automation Conference', url: 'https://www.dac.com/', freq: '每年 6 月' },
          'ICCAD': { full: 'International Conference on Computer-Aided Design', url: 'https://www.iccad.com/', freq: '每年 11 月' },
          'ISPD': { full: 'International Symposium on Physical Design', url: 'https://www.ispd.cc/', freq: '每年 4 月' },
          'DATE': { full: 'Design, Automation & Test in Europe', url: 'https://www.date-conference.com/', freq: '每年 3 月' },
          'ASP-DAC': { full: 'Asia and South Pacific Design Automation Conference', url: 'https://www.aspdac.com/', freq: '每年 1 月' },
          'VLSI Symposium': { full: 'IEEE Symposium on VLSI Technology and Circuits', url: 'https://www.vlsisymposium.org/', freq: '每年 6 月' },
          'ISSCC': { full: 'International Solid-State Circuits Conference', url: 'https://www.isscc.org/', freq: '每年 2 月' },
          'IEDM': { full: 'International Electron Devices Meeting', url: 'https://www.iedm.org/', freq: '每年 12 月' },
          'TCAD': { full: 'IEEE Trans. on Computer-Aided Design', url: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=43', freq: '月刊' },
        };
        for (const [abbr, detail] of Object.entries(confDetails)) {
          out += `### ${abbr}\n`;
          out += `* **全名**: ${detail.full}\n`;
          out += `* **頻率**: ${detail.freq}\n`;
          out += `* **官網**: ${detail.url}\n\n`;
        }
        return { ok: true, output: out };
      }

      // ── Cell Flow stages 查詢 ──
      case 'flow': {
        const q = (searchQuery || '').toLowerCase();
        let matchedStage = null;
        for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
          const searchStr = `${key} ${stage.name} ${stage.desc}`.toLowerCase();
          if (q && (q.includes(key) || q.includes(stage.name.toLowerCase()) || searchStr.includes(q))) {
            matchedStage = { key, ...stage };
            break;
          }
        }
        if (matchedStage) {
          let out = `🔄 **${matchedStage.name}** (${matchedStage.key})\n\n`;
          out += `${matchedStage.desc}\n\n`;
          out += `**Inputs**: ${matchedStage.inputs.join(', ')}\n`;
          out += `**Outputs**: ${matchedStage.outputs.join(', ')}\n\n`;
          out += `**可用工具**:\n\n`;
          for (const [toolName, toolData] of Object.entries(matchedStage.tools)) {
            out += `### ${toolName}\n`;
            for (const c of toolData.commands) {
              out += `- \`${c.cmd}\` — ${c.desc}\n`;
            }
            out += '\n';
          }
          return { ok: true, output: out };
        }
        // 沒有指定 query → 列出所有 stages
        let out = `🔄 **Cell-based 設計流程** (\${Object.keys(CELL_FLOW_STAGES).length} 個階段)\n\n`;
        out += `| Stage | 名稱 | 說明 |\n|-------|------|------|\n`;
        for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
          out += `| \`${key}\` | **${stage.name}** | ${stage.desc.slice(0, 50)}... |\n`;
        }
        out += `\n💡 用法: \`action=flow query=\"2-synthesis\"\` 查看特定階段的工具命令\n`;
        return { ok: true, output: out };
      }

      // ── DFT 流程查詢 ──
      case 'dft': {
        const stage = CELL_FLOW_STAGES['1.5-dft'];
        if (!stage) return { ok: false, error: 'DFT stage not found' };
        let out = `🔧 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── LEC 流程查詢 ──
      case 'lec': {
        const stage = CELL_FLOW_STAGES['8-lec'];
        if (!stage) return { ok: false, error: 'LEC stage not found' };
        let out = `⚖️ **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── ECO 流程查詢 ──
      case 'eco': {
        const stage = CELL_FLOW_STAGES['9-eco'];
        if (!stage) return { ok: false, error: 'ECO stage not found' };
        let out = `🔧 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── FPGA 流程查詢 ──
      case 'fpga': {
        const stage = CELL_FLOW_STAGES['10-fpga'];
        if (!stage) return { ok: false, error: 'FPGA stage not found' };
        let out = `🧩 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── Tool Troubleshooting（FAQ + 廠商搜尋 URL）──
      case 'troubleshoot': {
        let output = `🔧 **EDA Tool Troubleshooting**\n\n`;
        const qLower = searchQuery.toLowerCase();

        // 1. 偵測提到的工具名稱
        const toolNames = Object.keys(EDA_TOOL_INDEX).filter(k => qLower.includes(k));
        const detectedTool = toolNames.length > 0 ? toolNames[0] : null;

        // 2. 從 FAQ 索引搜尋
        const faqResults = searchToolFAQ(searchQuery, detectedTool);
        if (faqResults.length > 0) {
          output += `## 📋 常見問題解答（FAQ）\n\n`;
          for (const faq of faqResults) {
            output += `### 🔴 ${faq.error}\n`;
            output += `**工具**：${faq.tool}\n\n`;
            output += `**原因**：${faq.cause}\n\n`;
            output += `**解決方案**：\n\n${faq.solution}\n\n`;
            if (faq.solvnet) output += `📎 [廠商 Q&A](${faq.solvnet})\n\n`;
          }
        }

        // 3. 廠商搜尋 URL
        const toolName = detectedTool ? EDA_TOOL_INDEX[detectedTool]?.name : searchQuery;
        const vendorURLs = generateVendorSearchURL(toolName, searchQuery);
        if (vendorURLs.length > 0) {
          output += `## 🔗 廠商支援資源\n\n`;
          for (const vu of vendorURLs) {
            output += `- [${vu.vendor}](${vu.url}) — ${vu.note}\n`;
          }
          output += '\n';
        }

        // 4. 補充建議
        if (faqResults.length === 0 && vendorURLs.length === 0) {
          output += `⚠️ 未找到本地 FAQ 匹配。建議\n`;
          output += `1. 用 \`action=troubleshoot\` 加上具體錯誤訊息\n`;
          output += `2. 用 \`action=paper\` 搜尋相關學術論文\n`;
          output += `3. 用 \`action=github\` 搜尋 GitHub 上的討論\n`;
        }

        return { ok: true, output: output || '🔍 Troubleshooting：請提供具體錯誤訊息' };
      }

      // ── Tool 文件查詢（爬取 user guide / excerpt）──
      case 'docs': {
        const qLower = searchQuery.toLowerCase();
        // 偵測提到的工具
        const docToolKeys = Object.keys(VENDOR_DOCS).filter(k => qLower.includes(k));
        if (docToolKeys.length === 0) {
          // 嘗試用 EDA_TOOL_INDEX 找
          const toolKeys = Object.keys(EDA_TOOL_INDEX).filter(k => qLower.includes(k));
          if (toolKeys.length > 0 && VENDOR_DOCS[toolKeys[0]]) {
            docToolKeys.push(toolKeys[0]);
          }
        }
        if (docToolKeys.length === 0) {
          let out = `📖 **EDA Tool 文件**\n\n`;
          out += `⚠️ 未找到工具。請指定工具名稱，例如：\n`;
          out += `- \`action=docs question="DC synthesis 範例"\`\n`;
          out += `- \`action=docs question="Innovus placement 指令"\`\n`;
          out += `- \`action=docs question="Yosys overview"\`\n`;
          out += `\n可用工具：${Object.keys(VENDOR_DOCS).join(', ')}\n`;
          return { ok: true, output: out };
        }

        const toolKey = docToolKeys[0];
        const topic = detectDocTopic(searchQuery);
        const result = await fetchDocContent(toolKey, topic);

        if (!result) {
          return { ok: true, output: `📖 未找到 ${toolKey} 的相關文件` };
        }

        let out = `📖 **${result.tool}** 文件`;
        if (topic) out += `（${topic}）`;
        out += '\n\n';

        if (result.type === 'fetched') {
          out += `📄 **來源**：[${result.source}](${result.source})\n\n`;
          out += '```\n' + result.content + '\n```\n';
        } else if (result.type === 'indexed') {
          out += `🏢 **廠商**：${result.vendor}\n\n`;
          for (const ex of result.excerpts) {
            out += `### ${ex.topic}\n`;
            out += ex.content + '\n\n';
          }
          if (result.solvnet) {
            out += `📎 [更多文件](${result.solvnet})\n`;
          }
        } else if (result.type === 'error') {
          out += `⚠️ 爬取失敗：${result.error}\n`;
          out += `📎 [原始文件](${result.source})\n`;
        }

        return { ok: true, output: out };
      }

      default:
        return { ok: false, error: `未知 action: ${action}. 可用: auto, pdk, paper, tool, github, code, all, list-tools, list-pdk, list-conferences, flow, dft, lec, eco, fpga, troubleshoot, docs` };
    }
  } catch (err) {
    return { ok: false, error: `EDA 搜尋錯誤: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin Export
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: 'smart_eda_search',
  description:
    '[search] EDA 領域智慧知識引擎。查詢 IC design、cell-based flow、EDA tool、PDK、學術論文。'
    + '完全免費，不需要 API 金鑰。'
    + '支援 18 種 action：auto（自動判斷）、pdk（PDK/cell library）、paper（學術論文）、tool（EDA 工具）、github（GitHub 專案）、code（程式碼搜尋）、all（綜合）、list-tools、list-pdk、list-conferences、flow、dft、lec、eco、fpga、troubleshoot（Tool 問題診斷含 FAQ+廠商 Q&A）。'
    + '資料來源：GitHub API + OpenAlex + Semantic Scholar。'
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
