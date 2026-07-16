// ── Semantic Scholar — EDA 論文 + TLDR ───────────────────────────────────
import { httpsGet, SCHOLAR_API } from './http.mjs';

/**
 * 搜尋 Semantic Scholar 學術論文
 * @param {string} query - 搜尋查詢
 * @param {number} maxResults - 最大結果數量
 * @param {number} retryCount - 重試次數（內部使用）
 * @returns {Promise<object>} 搜尋結果
 */
export async function searchSemanticScholar(query, maxResults = 10, retryCount = 0) {
  const q = encodeURIComponent(query);
  const fields = 'title,authors,year,venue,citationCount,externalIds,openAccessPdf,tldr,abstract';
  const url = `${SCHOLAR_API}/paper/search?query=${q}&limit=${maxResults}&fields=${fields}`;
  
  try {
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
  } catch (err) {
    // 處理 429 Rate Limit
    if (err.message && err.message.includes('429')) {
      const maxRetries = 2;
      if (retryCount < maxRetries) {
        // 增加延遲時間：1s, 2s, 4s
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`[Semantic Scholar] Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        return searchSemanticScholar(query, maxResults, retryCount + 1);
      }
      return { 
        ok: false, 
        message: 'Semantic Scholar：Rate limited，請稍後再試。建議：\n' +
                 '1. 等待 5-10 分鐘後重試\n' +
                 '2. 使用 OpenAlex 作為替代來源\n' +
                 '3. 減少查詢頻率'
      };
    }
    throw err;
  }
}

export function formatSemanticScholarResults(data) {
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
