// ── 廠商搜尋 URL 生成 + FAQ 搜尋 ───────────────────────────────────────
import { TOOL_FAQ_INDEX } from '../data/faq.mjs';

export function generateVendorSearchURL(toolName, query) {
  const toolLower = toolName.toLowerCase();
  const searchQuery = encodeURIComponent(`${query} ${toolName}`);
  const urls = [];

  if (['design compiler', 'dc', 'vcs', 'primetime', 'pt', 'formality', 'fmod', 'icc2', 'dc explorer', 'spyglass'].some(t => toolLower.includes(t))) {
    urls.push({ vendor: 'Synopsys SolvNet', url: `https://solvnet.synopsys.com/solve/qa?search=${searchQuery}`, note: 'Synopsys 官方 Q&A 知識庫' });
  }
  if (['innovus', 'xcelium', 'conformal', 'lec', 'virtuoso', 'tempus', 'voltus', 'genus', ' JasperGold', 'Stratus'].some(t => toolLower.includes(t))) {
    urls.push({ vendor: 'Cadence Online Support', url: `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution&q=${searchQuery}`, note: 'Cadence 官方技術支援' });
  }
  if (toolLower.includes('calibre') || toolLower.includes('siemens') || toolLower.includes('icv') || toolLower.includes('mGCAR')) {
    urls.push({ vendor: 'Siemens EDA Support', url: `https://eda.com/support/calibre`, note: 'Siemens EDA (Calibre) 支援中心' });
  }
  if (toolLower.includes('vivado') || toolLower.includes('xilinx') || toolLower.includes('quartus')) {
    urls.push({ vendor: 'AMD/Xilinx Support', url: `https://support.xilinx.com/s/global-search/${searchQuery}`, note: 'AMD/Xilinx 官方支援中心' });
  }
  if (toolLower.includes('quartus') || toolLower.includes('intel') || toolLower.includes('altera')) {
    urls.push({ vendor: 'Intel Support', url: `https://www.intel.com/content/www/us/en/search.html?#q=${searchQuery}&t=All`, note: 'Intel FPGA 支援中心' });
  }
  if (urls.length === 0) {
    urls.push({ vendor: 'Google', url: `https://www.google.com/search?q=${searchQuery}+error+solution+site:solvnet.synopsys.com+OR+site:support.cadence.com`, note: '通用 EDA 問題搜尋' });
  }
  return urls;
}

export function searchToolFAQ(query, toolFilter) {
  const q = query.toLowerCase();
  const results = [];
  for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
    if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) continue;
    for (const faq of toolData.faqs) {
      if (faq.pattern.test(query)) {
        results.push({ tool: toolData.tool, error: faq.error, cause: faq.cause, solution: faq.solution, solvnet: faq.solvnet });
      }
    }
  }
  if (results.length === 0) {
    const words = q.split(/\s+/).filter(w => w.length > 2);
    for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
      if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) continue;
      for (const faq of toolData.faqs) {
        const faqText = `${faq.error} ${faq.cause} ${faq.solution}`.toLowerCase();
        const overlap = words.filter(w => faqText.includes(w));
        if (overlap.length >= Math.ceil(words.length * 0.4) || overlap.length >= 2) {
          results.push({ tool: toolData.tool, error: faq.error, cause: faq.cause, solution: faq.solution, solvnet: faq.solvnet, matchScore: overlap.length / words.length });
        }
      }
    }
    results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }
  return results.slice(0, 5);
}
