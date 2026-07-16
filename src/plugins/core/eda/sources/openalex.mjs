// ── OpenAlex — EDA 學術論文 ──────────────────────────────────────────────
import { httpsGet, OPENALEX_API } from './http.mjs';

export async function searchOpenAlex(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const url = `${OPENALEX_API}/works?search=${q}&per_page=${maxResults}&sort=cited_by_count:desc&filter=concepts.id:C119857082|C154945302|C41008148`;
  const data = await httpsGet(url);
  return (data.results || []).map(w => ({
    title: w.title || 'Untitled',
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 3).join(', ') + ((w.authorships || []).length > 3 ? ' et al.' : ''),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || '',
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : '',
    citedBy: w.cited_by_count || 0,
    isOA: w.open_access?.is_oa || false,
    url: w.open_access?.oa_url || w.doi || '',
    abstract: reconstructAbstract(w.abstract_inverted_index),
  }));
}

export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 600);
}

export function formatOpenAlexResults(articles) {
  if (!articles || articles.length === 0) return '📚 OpenAlex：無結果\n';
  let out = `📚 OpenAlex 學術論文（${articles.length} 筆）\n\n`;
  for (const a of articles) {
    out += `### 📄 ${a.title}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 作者 | ${a.authors} |\n`;
    if (a.year) out += `| 年份 | ${a.year} |\n`;
    if (a.journal) out += `| 期刊/會議 | ${a.journal} |\n`;
    if (a.doi) out += `| DOI | [${a.doi}](https://doi.org/${a.doi}) |\n`;
    if (a.citedBy) out += `| 被引用 | ${a.citedBy} |\n`;
    if (a.isOA !== undefined) out += `| Open Access | ${a.isOA ? '✅' : '❌'} |\n`;
    if (a.url) out += `| 連結 | ${a.url} |\n`;
    if (a.abstract) out += `\n**摘要**: ${a.abstract}...\n`;
    out += '\n';
  }
  return out;
}
