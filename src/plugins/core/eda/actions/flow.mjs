/**
 * flow / dft / lec / eco / fpga — Cell Flow stages 查詢
 */
import { registerAction } from './registry.mjs';
import { CELL_FLOW_STAGES } from '../data/flow.mjs';

const FLOW_STAGE_ICONS = { 'dft': '🔧', 'lec': '⚖️', 'eco': '🔧', 'fpga': '🧩' };
const STAGE_MAP = { 'dft': '1.5-dft', 'lec': '8-lec', 'eco': '9-eco', 'fpga': '10-fpga' };

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

registerAction('flow', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const q = searchQuery.toLowerCase();
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
  let out = `🔄 **Cell-based 設計流程** (${Object.keys(CELL_FLOW_STAGES).length} 個階段)\n\n`;
  out += `| Stage | 名稱 | 說明 |\n|-------|------|------|\n`;
  for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
    out += `| \`${key}\` | **${stage.name}** | ${stage.desc.slice(0, 50)}... |\n`;
  }
  out += `\n💡 用法: \`action=flow query="2-synthesis"\` 查看特定階段的工具命令\n`;
  return { ok: true, output: out };
});

// dft/lec/eco/fpga → 參數化 flow
for (const [alias, stageKey] of Object.entries(STAGE_MAP)) {
  registerAction(alias, async () => formatFlowStage(stageKey));
}
