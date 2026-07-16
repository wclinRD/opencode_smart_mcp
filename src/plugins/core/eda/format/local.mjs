// ── 本地搜尋 + 格式化 ───────────────────────────────────────────────────
import { PDK_INDEX } from '../data/pdk.mjs';
import { EDA_TOOL_INDEX } from '../data/tools.mjs';

export function searchLocalPDK(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, pdk] of Object.entries(PDK_INDEX)) {
    const searchable = `${key} ${pdk.name} ${pdk.node} ${pdk.foundry} ${(pdk.cells || []).join(' ')}`.toLowerCase();
    if (words.some(w => searchable.includes(w))) results.push({ key, ...pdk });
  }
  return results;
}

export function formatPDKResults(results) {
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

export function searchLocalTools(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, tool] of Object.entries(EDA_TOOL_INDEX)) {
    const searchable = `${key} ${tool.name} ${tool.category} ${tool.desc} ${tool.alt}`.toLowerCase();
    if (words.some(w => searchable.includes(w))) results.push({ key, ...tool });
  }
  return results;
}

export function formatToolResults(results) {
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
