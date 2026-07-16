
// ── Reciprocal Rank Fusion（RRF）引擎 ────────────────────────────────
// 參考：RAG-EDA (TCAD'25)、ChipMind (AAAI'26)
// 跨來源排名融合：每個來源獨立排序後，用 RRF 合併成統一排名

const DEFAULT_K = 60; // RRF 常數（原始論文建議 60）

/**
 * Reciprocal Rank Fusion — 多來源排名融合
 * @param {Array<{source: string, items: Array<{title,url,score?,...}>}>} sourceResults
 * @param {object} opts - { k?: number, maxResults?: number }
 * @returns {Array<{title,url,score,source,ranks}>} 融合後的結果
 */
export function reciprocalRankFusion(sourceResults, opts = {}) {
  const { k = DEFAULT_K, maxResults = 20 } = opts;

  // scoreMap: key = normalized URL → { item, rrfScore, ranks }
  const scoreMap = new Map();

  for (const { source, items } of sourceResults) {
    if (!items || items.length === 0) continue;
    items.forEach((item, rank) => {
      const key = normalizeKey(item.url || item.title || '');
      if (!key) return;
      const rrfScore = 1 / (k + rank + 1); // rank 從 0 開始

      if (scoreMap.has(key)) {
        const existing = scoreMap.get(key);
        existing.rrfScore += rrfScore;
        existing.ranks.push({ source, rank: rank + 1 });
        // 保留最完整的 item（有 abstract 的優先）
        if ((item.abstract?.length || 0) > (existing.item.abstract?.length || 0)) {
          existing.item = item;
        }
      } else {
        scoreMap.set(key, {
          item: { ...item },
          rrfScore,
          ranks: [{ source, rank: rank + 1 }],
        });
      }
    });
  }

  // 依 RRF score 降序排列
  const fused = [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, maxResults)
    .map(({ item, rrfScore, ranks }) => ({
      ...item,
      score: rrfScore,
      source: ranks.map(r => r.source).join('+'),
      rrfScore,
      ranks,
      sourceCount: ranks.length, // 被多少來源提及
    }));

  return fused;
}

/**
 * 從多來源搜尋結果中提取結構化資料
 * 各來源格式不同，統一轉成 { title, url, snippet, score, source, ... }
 */
export function extractStructuredResults(sourceResults) {
  const structured = [];

  for (const { source, items } of sourceResults) {
    if (!items || items.length === 0) continue;
    for (const item of items) {
      structured.push(normalizeItem(item, source));
    }
  }

  return structured;
}

// ── 內部工具 ─────────────────────────────────────────────────────────

function normalizeItem(item, source) {
  return {
    title: item.title || item.name || '',
    url: item.url || item.html_url || '',
    snippet: item.snippet || item.tldr || item.abstract?.slice(0, 200) || '',
    abstract: item.abstract || '',
    score: item.score || item.citedBy || 0,
    source,
    year: item.year || '',
    authors: item.authors || '',
    venue: item.venue || '',
    repo: item.repo || '',
    citedBy: item.citedBy || 0,
    doi: item.doi || '',
  };
}

function normalizeKey(urlOrTitle) {
  if (!urlOrTitle) return '';
  try {
    if (urlOrTitle.startsWith('http')) {
      const u = new URL(urlOrTitle);
      return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
    }
  } catch { /* not a URL */ }
  return urlOrTitle.toLowerCase().replace(/\s+/g, ' ').trim();
}
