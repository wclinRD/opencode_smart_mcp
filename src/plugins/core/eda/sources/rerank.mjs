
// ── Rerank + Adaptive Top-K + Post-retrieval Filter ──────────────────
// 參考：ChipMind (AAAI'26) MIG-based Adaptive Top-K
//       EDA-Copilot (TODAES'25) mixed indexing + post-retrieval

import { classifyQuery, QUERY_TYPES } from '../query/classify.mjs';

// ── EDA 領域關鍵字（用於 relevance scoring）──────────────────────────

const EDA_KEYWORDS = new Set([
  // EDA 工具
  'designcompiler', 'synopsys', 'cadence', 'innovus', 'icc2', 'iccompiler',
  'primetime', 'vcs', 'xcelium', 'calibre', 'vivado', 'quartus', 'dc',
  'genus', 'tempus', 'quantus', 'starrc', 'hspice', 'spectre',
  // Flow
  'synthesis', 'place', 'route', 'pnr', 'sta', 'timing', 'floorplan',
  'power', 'dft', 'lec', 'eco', 'drc', 'lvs', 'pex', ' Extraction',
  'rtl', 'gatelevel', 'netlist', 'verilog', 'vhdl', 'systemverilog',
  // Concept
  'clock', 'congestion', 'slack', 'setup', 'hold', 'violations',
  'multi', 'voltage', 'mv', 'ddrc', 'sdc', 'upf', ' cpf',
]);

// ── 查詢複雜度估算（ChipMind MIG-based）──────────────────────────────

/**
 * 估算查詢複雜度 → 決定 Top-K
 * @param {string} query
 * @param {{ type: string, confidence: number }} classification
 * @returns {'simple'|'moderate'|'complex'}
 */
export function estimateQueryComplexity(query, classification) {
  const q = query.toLowerCase();
  const type = classification?.type || QUERY_TYPES.GENERAL;

  // 複雜度指標
  let complexity = 0;

  // 查詢類型加分
  if (type === QUERY_TYPES.TOOL_ISSUE) complexity += 2; // 問題診斷需要更多上下文
  if (type === QUERY_TYPES.ACADEMIC) complexity += 1;
  if (type === QUERY_TYPES.FLOW_GUIDE) complexity += 1;

  // 查詢長度加分（多個關鍵字 = 更複雜）
  const words = q.split(/\s+/).length;
  if (words > 6) complexity += 2;
  else if (words > 3) complexity += 1;

  // 含比較/多工具 = 複雜
  if (/\b(v|vs|versus|compare|比較)\b/.test(q)) complexity += 2;
  if (/\b(how|why|when|怎麼|為什麼|什麼時候)\b/.test(q)) complexity += 1;

  if (complexity >= 4) return 'complex';
  if (complexity >= 2) return 'moderate';
  return 'simple';
}

/**
 * 根據複雜度決定 Top-K（ChipMind MIG-based adaptive）
 */
export function adaptiveTopK(query, classification, candidates) {
  const complexity = estimateQueryComplexity(query, classification);
  const k = complexity === 'simple' ? 3 : complexity === 'moderate' ? 6 : 10;

  // 按 rrfScore 降序取前 k 筆
  const sorted = [...candidates].sort((a, b) => (b.rrfScore || b.score || 0) - (a.rrfScore || a.score || 0));
  return sorted.slice(0, k);
}

// ── EDA Relevance Scoring ────────────────────────────────────────────

/**
 * 計算 EDA 領域相關性分數（0-1）
 * 結合 RRF 分數 + 關鍵字匹配 + 多來源加分
 */
export function scoreRelevance(item, query) {
  let score = item.rrfScore || item.score || 0;
  const text = `${item.title || ''} ${item.snippet || ''} ${item.abstract || ''}`.toLowerCase();
  const q = query.toLowerCase();

  // 1. EDA 關鍵字匹配
  let keywordHits = 0;
  for (const kw of EDA_KEYWORDS) {
    if (text.includes(kw)) keywordHits++;
  }
  score += Math.min(keywordHits * 0.05, 0.3); // 最多 +0.3

  // 2. 查詢字串匹配
  const queryWords = q.split(/\s+/).filter(w => w.length > 2);
  let queryHits = 0;
  for (const w of queryWords) {
    if (text.includes(w)) queryHits++;
  }
  if (queryWords.length > 0) {
    score += (queryHits / queryWords.length) * 0.2; // 最多 +0.2
  }

  // 3. 多來源交叉驗證加分（被 2+ 來源提及 = 高相關）
  if (item.sourceCount >= 3) score += 0.15;
  else if (item.sourceCount >= 2) score += 0.1;

  // 4. 學術引用加分
  if (item.citedBy > 100) score += 0.1;
  else if (item.citedBy > 10) score += 0.05;

  return Math.min(score, 1.0);
}

// ── Post-retrieval Filter ────────────────────────────────────────────

/**
 * 後處理過濾：score threshold + 去重 + 品質控制
 * 參考：EDA-Copilot mixed indexing (score < 0.3 過濾)
 */
export function postRetrievalFilter(items, opts = {}) {
  const { minScore = 0.15, maxDuplicateRatio = 0.3 } = opts;

  // 1. Score threshold 過濾
  const filtered = items.filter(item => {
    const s = item.rerankScore ?? item.rrfScore ?? item.score ?? 0;
    return s >= minScore;
  });

  // 2. 標題去重（相似標題保留較完整的一筆）
  const seenTitles = new Map();
  const deduped = [];
  for (const item of filtered) {
    const titleKey = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (!titleKey) { deduped.push(item); continue; }

    if (seenTitles.has(titleKey)) {
      const existing = seenTitles.get(titleKey);
      // 保留 abstract 較長的
      if ((item.abstract?.length || 0) > (existing.abstract?.length || 0)) {
        const idx = deduped.indexOf(existing);
        if (idx !== -1) deduped[idx] = item;
        seenTitles.set(titleKey, item);
      }
    } else {
      seenTitles.set(titleKey, item);
      deduped.push(item);
    }
  }

  return deduped;
}

// ── 完整 Rerank Pipeline ─────────────────────────────────────────────

/**
 * 完整 rerank 管線：score → adaptive top-K → post-filter
 * @param {Array} candidates - RRF 融合後的結果
 * @param {string} query - 原始查詢
 * @param {{ type, confidence }} classification - 查詢分類
 * @param {object} opts - { maxResults, minScore }
 * @returns {Array} rerank 後的結果
 */
export function rerankPipeline(candidates, query, classification, opts = {}) {
  const { maxResults = 10, minScore = 0.15 } = opts;

  // Step 1: EDA relevance scoring
  const scored = candidates.map(item => ({
    ...item,
    rerankScore: scoreRelevance(item, query),
  }));

  // Step 2: Adaptive Top-K
  const adaptiveItems = adaptiveTopK(query, classification, scored);

  // Step 3: Post-retrieval filter
  const filtered = postRetrievalFilter(adaptiveItems, { minScore });

  return filtered.slice(0, maxResults);
}
