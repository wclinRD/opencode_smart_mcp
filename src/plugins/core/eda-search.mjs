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

// ── 搜尋來源（從 eda/sources/ 匯入）──────────────────────────────────────
import { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT } from './eda/sources/http.mjs';
import { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults } from './eda/sources/github.mjs';
import { searchWebDDG, formatWebResults } from './eda/sources/web.mjs';
import { searchEDACommunities, crawlForumPages, formatCommunityResults } from './eda/sources/community.mjs';
import { searchOpenAlex, reconstructAbstract, formatOpenAlexResults } from './eda/sources/openalex.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from './eda/sources/semantic-scholar.mjs';

// ── 查詢處理（從 eda/query/ 匯入）────────────────────────────────────────
import { enhanceQueryForEDA, generateSearchQueries, generateQueryVariants, detectConference } from './eda/query/enhance.mjs';
import { detectDocTopic, isToolIssueQuery } from './eda/query/detect.mjs';
// ── 工具函式（從 eda/lib/ 匯入）──────────────────────────────────────────
import { generateVendorSearchURL, searchToolFAQ } from './eda/lib/vendor.mjs';
import { fetchDocContent } from './eda/lib/doc-fetch.mjs';
// ── 格式化（從 eda/format/ 匯入）────────────────────────────────────────
import { searchLocalPDK, formatPDKResults, searchLocalTools, formatToolResults } from './eda/format/local.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// ── 多源並行搜尋統一入口 ────────────────────────────────────────────────
async function multiSourceSearch(searchQuery, maxResults = 10) {
  const searchQueries = generateSearchQueries(searchQuery);
  const enhancedQuery = enhanceQueryForEDA(searchQuery);
  const sources = await Promise.allSettled([
    searchWebDDG(searchQueries.web, maxResults),
    searchEDACommunities(searchQuery, maxResults),
    searchSemanticScholar(searchQueries.academic || enhancedQuery, maxResults).then(r => r.ok ? r.data : []),
    searchOpenAlex(searchQueries.academic || enhancedQuery, Math.min(maxResults, 5)),
    searchGitHubCode(searchQueries.github, 5),
    searchGitHubEDA(searchQuery, 5),
  ]);

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

  return output;
}

// ── Cell Flow Stage 格式化 ──────────────────────────────────────────────
const FLOW_STAGE_ICONS = { 'dft': '🔧', 'lec': '⚖️', 'eco': '🔧', 'fpga': '🧩' };

function formatFlowStage(stageKey) {
  const stage = CELL_FLOW_STAGES[stageKey];
  if (!stage) return { ok: false, error: `${stageKey} stage not found` };
  const icon = FLOW_STAGE_ICONS[stageKey.split('-').pop()] || '🔄';
  let out = `${icon} **${stage.name}**\n\n`;
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

        // 多源並行廣搜（使用統一入口）
        let output = await multiSourceSearch(searchQuery, maxResults);

        // 偵測是否提到特定會議
        const conf = detectConference(searchQuery);
        if (conf) {
          output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
          output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
          output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
          output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
        }

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
        // 先搜本地索引
        const localPDK = searchLocalPDK(searchQuery);
        if (localPDK.length > 0) output += formatPDKResults(localPDK);
        const localTools = searchLocalTools(searchQuery);
        if (localTools.length > 0) output += formatToolResults(localTools);
        // 多源並行搜尋（使用統一入口）
        output += await multiSourceSearch(searchQuery, maxResults);
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

      case 'dft': return formatFlowStage('1.5-dft');
      case 'lec': return formatFlowStage('8-lec');
      case 'eco': return formatFlowStage('9-eco');
      case 'fpga': return formatFlowStage('10-fpga');

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
