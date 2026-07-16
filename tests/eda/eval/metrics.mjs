/**
 * EDA Benchmark 評估指標
 * Phase 14.7: Recall@K, MRR, NDCG, Precision@K, Keyword Hit Rate
 */

/**
 * Recall@K — 前 K 個結果中，命中 expectedKeywords 的比例
 * @param {string[]} retrieved — 搜尋結果中的關鍵字
 * @param {string[]} expected — 期望的關鍵字
 * @param {number} k — 取前 K 個
 * @returns {number} 0-1
 */
export function recallAtK(retrieved, expected, k = 5) {
  if (!expected.length) return 1;
  const topK = retrieved.slice(0, k).map(s => s.toLowerCase());
  const hits = expected.filter(e => topK.some(t => t.includes(e.toLowerCase())));
  return hits.length / expected.length;
}

/**
 * Precision@K — 前 K 個結果中，相關結果的比例
 * @param {string[]} retrieved — 搜尋結果
 * @param {string[]} expected — 期望的關鍵字（作為 relevance 標準）
 * @param {number} k — 取前 K 個
 * @returns {number} 0-1
 */
export function precisionAtK(retrieved, expected, k = 5) {
  if (!k) return 0;
  const topK = retrieved.slice(0, k).map(s => s.toLowerCase());
  const hits = topK.filter(t => expected.some(e => t.includes(e.toLowerCase())));
  return hits.length / k;
}

/**
 * MRR (Mean Reciprocal Rank) — 第一個相關結果的倒數排名
 * @param {string[]} retrieved — 搜尋結果
 * @param {string[]} expected — 期望的關鍵字
 * @returns {number} 0-1
 */
export function mrr(retrieved, expected) {
  for (let i = 0; i < retrieved.length; i++) {
    const text = retrieved[i].toLowerCase();
    if (expected.some(e => text.includes(e.toLowerCase()))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * NDCG@K (Normalized Discounted Cumulative Gain)
 * @param {string[]} retrieved — 搜尋結果
 * @param {string[]} expected — 期望的關鍵字（作為 relevance 標記）
 * @param {number} k — 取前 K 個
 * @returns {number} 0-1
 */
export function ndcgAtK(retrieved, expected, k = 5) {
  const topK = retrieved.slice(0, k);
  
  // 計算 DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const text = topK[i].toLowerCase();
    const relevant = expected.some(e => text.includes(e.toLowerCase())) ? 1 : 0;
    dcg += relevant / Math.log2(i + 2); // log2(i+1) + 1
  }
  
  // 計算 IDCG（理想排序）
  const idealRelevance = Math.min(expected.length, k);
  let idcg = 0;
  for (let i = 0; i < idealRelevance; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  
  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Keyword Hit Rate — 至少命中一個 expectedKeyword 的比例
 * @param {string[]} retrieved — 搜尋結果
 * @param {string[]} expected — 期望的關鍵字
 * @returns {number} 0-1 (1 = 全部命中)
 */
export function keywordHitRate(retrieved, expected) {
  if (!expected.length) return 1;
  const allText = retrieved.join(' ').toLowerCase();
  const hits = expected.filter(e => allText.includes(e.toLowerCase()));
  return hits.length / expected.length;
}

/**
 * Action Match — 分類的 action 是否正確
 * @param {string} predicted — 實際分類結果
 * @param {string} expected — 期望的 action
 * @returns {boolean}
 */
export function actionMatch(predicted, expected) {
  if (!predicted || !expected) return false;
  return predicted.toLowerCase() === expected.toLowerCase();
}

/**
 * 計算單筆查詢的所有指標
 * @param {object} params
 * @param {string[]} params.results — 搜尋結果
 * @param {string[]} params.expectedKeywords — 期望的關鍵字
 * @param {string} params.predictedAction — 實際分類的 action
 * @param {string} params.expectedAction — 期望的 action
 * @returns {object} 各項指標
 */
export function evaluateQuery({ results = [], expectedKeywords = [], predictedAction, expectedAction }) {
  return {
    recallAt5: recallAtK(results, expectedKeywords, 5),
    precisionAt5: precisionAtK(results, expectedKeywords, 5),
    mrr: mrr(results, expectedKeywords),
    ndcgAt5: ndcgAtK(results, expectedKeywords, 5),
    keywordHitRate: keywordHitRate(results, expectedKeywords),
    actionMatch: actionMatch(predictedAction, expectedAction),
  };
}

/**
 * 匯整一組查詢的平均指標
 * @param {object[]} evaluations — evaluateQuery() 的結果陣列
 * @returns {object} 平均指標 + 通過率
 */
export function aggregateMetrics(evaluations) {
  if (!evaluations.length) return {};
  const n = evaluations.length;
  
  const sum = (fn) => evaluations.reduce((acc, e) => acc + fn(e), 0);
  
  return {
    count: n,
    avgRecallAt5: sum(e => e.recallAt5) / n,
    avgPrecisionAt5: sum(e => e.precisionAt5) / n,
    avgMRR: sum(e => e.mrr) / n,
    avgNDCGAt5: sum(e => e.ndcgAt5) / n,
    avgKeywordHitRate: sum(e => e.keywordHitRate) / n,
    actionAccuracy: sum(e => e.actionMatch ? 1 : 0) / n,
    // 門檻指標（用於 pass/fail 判定）
    recallAt5Pass: sum(e => e.recallAt5) / n >= 0.8,
    mrrPass: sum(e => e.mrr) / n >= 0.6,
    actionAccuracyPass: sum(e => e.actionMatch ? 1 : 0) / n >= 0.85,
    keywordHitRatePass: sum(e => e.keywordHitRate) / n >= 0.9,
  };
}
