/**
 * list-tools / list-pdk / list-conferences — 列出已知 EDA 資源
 */
import { registerAction } from './registry.mjs';
import { EDA_TOOL_INDEX } from '../data/tools.mjs';
import { PDK_INDEX } from '../data/pdk.mjs';
import { EDA_CONFERENCES } from '../data/meta.mjs';

registerAction('list-tools', async () => {
  let out = `🔧 已索引 EDA 工具（${Object.keys(EDA_TOOL_INDEX).length} 筆）\n\n`;
  out += `| 類別 | 工具 | 商業替代 |\n|------|------|----------|\n`;
  for (const [key, t] of Object.entries(EDA_TOOL_INDEX)) {
    out += `| ${t.category} | **${t.name}** (\`${key}\`) | ${t.alt} |\n`;
  }
  return { ok: true, output: out };
});

registerAction('list-pdk', async () => {
  let out = `🏭 已索引 PDK（${Object.keys(PDK_INDEX).length} 筆）\n\n`;
  out += `| 名稱 | 節點 | 類型 | Foundry |\n|------|------|------|----------|\n`;
  for (const [key, p] of Object.entries(PDK_INDEX)) {
    out += `| **${p.name}** (\`${key}\`) | ${p.node} | ${p.type} | ${p.foundry} |\n`;
  }
  return { ok: true, output: out };
});

registerAction('list-conferences', async () => {
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
});
