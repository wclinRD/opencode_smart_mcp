/**
 * docs — Tool 文件查詢（爬取 user guide / excerpt）
 */
import { registerAction } from './registry.mjs';
import { EDA_TOOL_INDEX } from '../data/tools.mjs';
import { VENDOR_DOCS } from '../data/docs.mjs';
import { detectDocTopic } from '../query/detect.mjs';
import { fetchDocContent } from '../lib/doc-fetch.mjs';
import { detectHdlKgraph, matchKgTool, queryKGraph, formatKgResult, getKgHint } from '../lib/hdl-kgraph.mjs';

registerAction('docs', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
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

  // Knowledge Graph 補充（design 結構查詢）
  const kgMatch = matchKgTool(searchQuery);
  if (kgMatch) {
    try {
      const kg = await detectHdlKgraph();
      if (kg.available && kg.graphDb) {
        const kgResult = await queryKGraph(kgMatch.tool, kgMatch.args, { db: kg.graphDb });
        if (kgResult.ok) {
          const kgOutput = formatKgResult(kgResult.data, kgMatch.tool);
          if (kgOutput) {
            out += '\n---\n\n## 🧠 Knowledge Graph（本地 Design）\n\n';
            out += kgOutput + '\n';
          }
        }
      } else {
        const hint = getKgHint(kg);
        if (hint) out += '\n---\n\n' + hint + '\n';
      }
    } catch { /* KG 非必要 */ }
  }

  return { ok: true, output: out };
});
