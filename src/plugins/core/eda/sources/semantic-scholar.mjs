// ── Semantic Scholar — EDA 論文 + TLDR ───────────────────────────────────
import { httpsGet, SCHOLAR_API } from './http.mjs';

export async function searchSemanticScholar(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const fields = 'title,authors,year,venue,citationCount,externalIds,openAccessPdf,tldr,abstract';
  const url = `${SCHOLAR_API}/paper/search?query=${q}&limit=${maxResults}&fields=${fields}`;
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
