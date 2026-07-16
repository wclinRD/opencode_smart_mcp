/**
 * troubleshoot — Tool 問題診斷（FAQ + 廠商搜尋 URL）
 */
import { registerAction } from './registry.mjs';
import { EDA_TOOL_INDEX } from '../data/tools.mjs';
import { searchToolFAQ, generateVendorSearchURL } from '../lib/vendor.mjs';
import { compressOutput } from '../lib/caveman.mjs';
import { detectHdlKgraph, matchKgTool, queryKGraph, formatKgResult } from '../lib/hdl-kgraph.mjs';

registerAction('troubleshoot', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
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

  // 4. Knowledge Graph 查詢（若有本地 design）
  try {
    const kg = await detectHdlKgraph();
    if (kg.available && kg.graphDb) {
      const kgMatch = matchKgTool(searchQuery);
      if (kgMatch) {
        const kgResult = await queryKGraph(kgMatch.tool, kgMatch.args, { db: kg.graphDb });
        if (kgResult.ok) {
          const kgOutput = formatKgResult(kgResult.data, kgMatch.tool);
          if (kgOutput) {
            output += `## 🧠 Knowledge Graph（本地 Design）\n\n`;
            output += kgOutput + '\n';
          }
        }
      }
    }
  } catch { /* KG 非必要，忽略錯誤 */ }

  // 5. 補充建議
  if (faqResults.length === 0 && vendorURLs.length === 0) {
    output += `⚠️ 未找到本地 FAQ 匹配。建議\n`;
    output += `1. 用 \`action=troubleshoot\` 加上具體錯誤訊息\n`;
    output += `2. 用 \`action=paper\` 搜尋相關學術論文\n`;
    output += `3. 用 \`action=github\` 搜尋 GitHub 上的討論\n`;
  }

  // Caveman 壓縮
  const compress = args.compress || 'none';
  if (compress !== 'none') {
    output = compressOutput(output, compress);
  }

  return { ok: true, output: output || '🔍 Troubleshooting：請提供具體錯誤訊息' };
});
