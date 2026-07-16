/**
 * paper/papers — EDA 學術論文搜尋
 */
import { registerAction } from './registry.mjs';
import { enhanceQueryForEDA, detectConference, generateSearchQueries } from '../query/enhance.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from '../sources/semantic-scholar.mjs';
import { searchOpenAlex, formatOpenAlexResults } from '../sources/openalex.mjs';
import { compressOutput } from '../lib/caveman.mjs';

// EDA 領域期刊和會議的關鍵字（用於增強搜尋查詢）
const EDA_ACADEMIC_KEYWORDS = [
  'DAC', 'ICCAD', 'ISPD', 'DATE', 'ASP-DAC', 'VLSI Symposium', 'ISSCC', 'IEDM', 'TCAD',
  'IEEE Transactions on CAD', 'ACM TODAES', 'IEEE Journal of SSCC',
  'electronic design automation', 'VLSI', 'ASIC', 'FPGA',
  'synthesis', 'place and route', 'timing analysis', 'clock tree',
  'formal verification', 'logic synthesis', 'physical design',
];

/**
 * 增強查詢以提升學術論文搜尋精準度
 * @param {string} query - 原始查詢
 * @returns {string} 增強後的查詢
 */
function enhancePaperQuery(query) {
  const q = query.toLowerCase();
  
  // 檢查是否已包含 EDA 學術關鍵字
  const hasAcademicContext = EDA_ACADEMIC_KEYWORDS.some(kw => 
    q.includes(kw.toLowerCase())
  );
  
  // 如果沒有學術上下文，加入 EDA 學術期刊/會議關鍵字
  if (!hasAcademicContext) {
    // 加入主要 EDA 會議和期刊
    return `${query} (DAC OR ICCAD OR ISPD OR DATE OR "IEEE Transactions on CAD" OR ACM TODAES)`;
  }
  
  return query;
}

/**
 * 生成多個搜尋查詢變體以提升召回率
 * @param {string} query - 原始查詢
 * @returns {string[]} 查詢變體陣列
 */
function generatePaperQueries(query) {
  const queries = [];
  
  // 主查詢（增強後）
  queries.push(enhancePaperQuery(query));
  
  // 如果查詢不夠具體，加入更廣泛的搜尋
  const q = query.toLowerCase();
  if (!q.includes('survey') && !q.includes('review')) {
    queries.push(`${query} survey review`);
  }
  
  // 加入工具相關的學術查詢
  if (q.includes('tool') || q.includes('flow') || q.includes('methodology')) {
    queries.push(`${query} methodology academic research`);
  }
  
  return queries.slice(0, 3); // 最多 3 個查詢變體
}

registerAction('paper', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  let output = '';
  
  // 生成多個搜尋查詢變體
  const queries = generatePaperQueries(searchQuery);
  
  // Semantic Scholar + TLDR（使用第一個查詢）
  try {
    const scholarResult = await searchSemanticScholar(queries[0], maxResults);
    if (scholarResult.ok) {
      output += formatSemanticScholarResults(scholarResult.data) + '\n';
    } else {
      output += `⚠️ ${scholarResult.message}\n\n`;
    }
  } catch (err) {
    output += `⚠️ Semantic Scholar：${err.message}\n\n`;
  }
  
  // OpenAlex（使用第二個查詢或第一個查詢）
  const openAlexQuery = queries.length > 1 ? queries[1] : queries[0];
  try {
    const articles = await searchOpenAlex(openAlexQuery, Math.min(maxResults, 5));
    output += formatOpenAlexResults(articles);
  } catch (err) {
    output += `⚠️ OpenAlex：${err.message}\n`;
  }
  
  // 偵測是否提到特定會議，並提供額外資源
  const conf = detectConference(searchQuery);
  if (conf) {
    output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
    output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
    output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
    output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
    
    // 加入會議-specific 的學術資源
    if (['DAC', 'ICCAD', 'ISPD', 'DATE', 'ASP-DAC'].includes(conf)) {
      output += `  • [Google Scholar](https://scholar.google.com/scholar?q=${conf}+${encodeURIComponent(searchQuery)})\n`;
    }
  }
  
  // Caveman 壓縮
  const compress = args.compress || 'none';
  console.log(`[EDA] compress=${compress}, output.length=${output.length}`);
  if (compress !== 'none') {
    const before = output.length;
    output = compressOutput(output, compress);
    console.log(`[EDA] compressed: ${before} → ${output.length} chars`);
  }
  
  return { ok: true, output: output || '📚 學術論文：無結果' };
}, ['papers']);
