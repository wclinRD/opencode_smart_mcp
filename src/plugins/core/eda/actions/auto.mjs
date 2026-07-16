/**
 * auto — 自動路由：偵測查詢類型，選擇最優搜尋策略
 */
import { registerAction } from './registry.mjs';
import { EDA_TOOL_INDEX } from '../data/tools.mjs';
import { EDA_ABBREV_DICT } from '../data/abbreviations.mjs';
import { searchLocalPDK, formatPDKResults, searchLocalTools, formatToolResults } from '../format/local.mjs';
import { searchGitHubPDK, searchGitHubEDA, formatGitHubResults } from '../sources/github.mjs';
import { isToolIssueQuery } from '../query/detect.mjs';
import { searchToolFAQ } from '../lib/vendor.mjs';
import { generateVendorSearchURL } from '../lib/vendor.mjs';
import { detectConference } from '../query/enhance.mjs';
import { multiSourceSearch } from '../sources/index.mjs';
import { classifyQuery, QUERY_TYPES } from '../query/classify.mjs';

registerAction('auto', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  const q = searchQuery.toLowerCase();

  // Phase 11: 利用 EDA_ABBREV_DICT 改善工具偵測
  // 將查詢中的縮寫展開，提升匹配準確率
  const words = q.split(/\s+/);
  const expandedTerms = words.map(w => {
    const clean = w.replace(/[^a-z0-9&]/g, '');
    const match = EDA_ABBREV_DICT[clean];
    return match ? match.full.toLowerCase() : w;
  });
  const qExpanded = expandedTerms.join(' ');

  // Phase 12: Query Intelligence — 分類查詢類型
  const classification = classifyQuery(searchQuery);
  const { type: queryType, confidence } = classification;

  // EDA 工具查詢（優先：tool 問題偵測需要先判斷）
  // 使用展開後的 qExpanded 匹配，解決縮寫誤判（如 hal/diamond/netgen）
  const toolKeywords = ['tool', '工具', 'synthesis', 'synth',
    ' STA', 'timing', 'place', 'route',
    'verilat', 'iverilog', 'yosys', 'openroad',
    'klayout', 'simulation', 'formal',
    'dc ', 'design compiler', 'genus', 'innovus', 'icc2', 'ic compiler',
    'primetime', 'tempus', 'lec', 'logic equivalence', 'conformal', 'formality',
    'eco', 'engineering change', 'vivado', 'quartus', 'calibre',
    'icv', 'ic validator', 'vcs', 'xcelium', 'questa',
    'jasper', 'spyglass', 'dft', 'design for test', 'modus',
    'virtuoso', 'starrc', 'star rc', 'quantus', 'voltus',
    'primepower', 'prime power', 'redhawk', 'totem',
    'netgen', 'openroad', 'openlane', 'yosys', 'klayout'];
  const isToolQuery = toolKeywords.some(kw => q.includes(kw) || qExpanded.includes(kw));

  if (isToolQuery) {
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
  const compress = args.compress || 'none';
  const searchMaxResults = classification.weights.maxResults || maxResults;
  const { output: searchOutput } = await multiSourceSearch(searchQuery, searchMaxResults, { compress });
  let output = searchOutput;

  // 顯示分類資訊（當信心度 > 0.5 時）
  if (confidence > 0.5 && queryType !== QUERY_TYPES.GENERAL) {
    const typeLabels = {
      tool_issue: '🔧 工具問題診斷',
      pdk_lookup: '📦 PDK/Cell Library',
      academic: '📚 學術論文',
      flow_guide: '🔄 Flow 流程指引',
      tool_docs: '📖 工具文件/指令',
      general: '🔍 一般查詢',
    };
    output = `> 偵測查詢類型：**${typeLabels[queryType] || queryType}** (信心度: ${(confidence * 100).toFixed(0)}%)\n\n` + output;
  }

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
});
