// hybrid-search.mjs — BM25 + Semantic RRF Fusion for smart_grep
//
// Combines BM25 lexical search results with semantic (TF-IDF/sentence embedding)
// search results using Reciprocal Rank Fusion (RRF) and weighted fusion.
//
// Reference: Vera, QEX, Veles — all use RRF with k=60 for hybrid search.
//
// Usage:
//   import { rrfFusion, weightedFusion, hybridRank } from './hybrid-search.mjs';
//   const merged = rrfFusion(bm25Results, semanticResults, { k: 60 });

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

/**
 * Merge two ranked result lists using Reciprocal Rank Fusion.
 * RRF score = sum(1 / (k + rank_i)) for each list where the item appears.
 *
 * Reference: Cormack et al. 2009, used by Vera/QEX/Veles.
 *
 * @param {Array} listA - First ranked list (e.g., BM25 results)
 * @param {Array} listB - Second ranked list (e.g., semantic results)
 * @param {Object} [options]
 * @param {number} [options.k=60] - RRF constant (higher = less rank-sensitive)
 * @param {Function} [options.keyFn] - Function to extract unique key from item (default: item => item.file)
 * @param {number} [options.weightA=1] - Weight for list A
 * @param {number} [options.weightB=1] - Weight for list B
 * @returns {Array} Merged and re-ranked results
 */
export function rrfFusion(listA, listB, options = {}) {
  const { k = 60, keyFn = (item) => item.file || item.relFile, weightA = 1, weightB = 1 } = options;

  const scores = new Map(); // key -> { item, score, ranks: [] }

  // Process list A
  for (let i = 0; i < listA.length; i++) {
    const key = keyFn(listA[i]);
    const rrfScore = weightA / (k + i + 1);
    if (!scores.has(key)) {
      scores.set(key, { item: listA[i], score: 0, rankA: i + 1, rankB: null });
    }
    scores.get(key).score += rrfScore;
    scores.get(key).rankA = i + 1;
  }

  // Process list B
  for (let i = 0; i < listB.length; i++) {
    const key = keyFn(listB[i]);
    const rrfScore = weightB / (k + i + 1);
    if (!scores.has(key)) {
      scores.set(key, { item: listB[i], score: 0, rankA: null, rankB: i + 1 });
    }
    scores.get(key).score += rrfScore;
    scores.get(key).rankB = i + 1;
  }

  // Sort by RRF score descending
  const merged = [...scores.values()].sort((a, b) => b.score - a.score);

  return merged.map((entry, i) => ({
    ...entry.item,
    _rrfScore: Math.round(entry.score * 10000) / 10000,
    _rrfRank: i + 1,
    _rankA: entry.rankA,
    _rankB: entry.rankB,
  }));
}

// ---------------------------------------------------------------------------
// Weighted Fusion (query-type aware)
// ---------------------------------------------------------------------------

/**
 * Merge results using query-type-aware weighted fusion.
 * Symbol queries → BM25 70% + semantic 30%
 * NL queries → BM25 30% + semantic 70%
 * Path queries → BM25 90% + semantic 10%
 *
 * @param {Array} bm25Results - BM25 ranked results
 * @param {Array} semanticResults - Semantic ranked results
 * @param {string} queryType - 'symbol' | 'natural_language' | 'path'
 * @param {Object} [options]
 * @param {Function} [options.keyFn] - Key function
 * @param {number} [options.topK] - Max results to return
 * @returns {Array} Merged and re-ranked results
 */
export function weightedFusion(bm25Results, semanticResults, queryType, options = {}) {
  const { keyFn = (item) => item.file || item.relFile, topK } = options;

  // Determine weights based on query type
  let bm25Weight, semanticWeight;
  switch (queryType) {
    case 'symbol':
      bm25Weight = 0.7;
      semanticWeight = 0.3;
      break;
    case 'natural_language':
      bm25Weight = 0.3;
      semanticWeight = 0.7;
      break;
    case 'path':
      bm25Weight = 0.9;
      semanticWeight = 0.1;
      break;
    default:
      bm25Weight = 0.5;
      semanticWeight = 0.5;
  }

  // Normalize scores to 0-1 range
  const normBm25 = normalizeScores(bm25Results, 'bm25Score');
  const normSemantic = normalizeScores(semanticResults, 'score');

  // Build combined score map
  const scoreMap = new Map();

  for (const item of normBm25) {
    const key = keyFn(item);
    scoreMap.set(key, {
      item,
      bm25Norm: item._normScore,
      semanticNorm: 0,
    });
  }

  for (const item of normSemantic) {
    const key = keyFn(item);
    if (scoreMap.has(key)) {
      scoreMap.get(key).semanticNorm = item._normScore;
    } else {
      scoreMap.set(key, {
        item,
        bm25Norm: 0,
        semanticNorm: item._normScore,
      });
    }
  }

  // Compute weighted scores
  const merged = [];
  for (const [, entry] of scoreMap) {
    const combinedScore = entry.bm25Norm * bm25Weight + entry.semanticNorm * semanticWeight;
    merged.push({
      ...entry.item,
      _hybridScore: Math.round(combinedScore * 1000) / 1000,
      _bm25Weight: bm25Weight,
      _semanticWeight: semanticWeight,
    });
  }

  merged.sort((a, b) => b._hybridScore - a._hybridScore);

  return topK ? merged.slice(0, topK) : merged;
}

// ---------------------------------------------------------------------------
// Hybrid Rank (main entry point)
// ---------------------------------------------------------------------------

/**
 * Main hybrid ranking function. Combines BM25 and semantic results
 * using the best strategy based on query type and available data.
 *
 * @param {Array} bm25Results - BM25 ranked grep results
 * @param {Array} semanticResults - Semantic search results
 * @param {string} queryType - 'symbol' | 'natural_language' | 'path'
 * @param {Object} [options]
 * @param {string} [options.method='weighted'] - 'rrf' | 'weighted'
 * @param {number} [options.semanticWeight] - Override semantic weight (0-1)
 * @param {number} [options.topK] - Max results
 * @returns {Array} Hybrid ranked results
 */
export function hybridRank(bm25Results, semanticResults, queryType, options = {}) {
  const { method = 'weighted', semanticWeight, topK } = options;

  // If no semantic results, return BM25 as-is
  if (!semanticResults || semanticResults.length === 0) {
    return bm25Results;
  }

  // If no BM25 results, return semantic as-is
  if (!bm25Results || bm25Results.length === 0) {
    return semanticResults;
  }

  // If custom semantic weight provided, use weighted fusion with override
  if (semanticWeight !== undefined) {
    const bm25Weight = 1 - semanticWeight;
    const normBm25 = normalizeScores(bm25Results, 'bm25Score');
    const normSemantic = normalizeScores(semanticResults, 'score');

    const keyFn = (item) => item.file || item.relFile;
    const scoreMap = new Map();

    for (const item of normBm25) {
      scoreMap.set(keyFn(item), { item, bm25Norm: item._normScore, semanticNorm: 0 });
    }
    for (const item of normSemantic) {
      const key = keyFn(item);
      if (scoreMap.has(key)) {
        scoreMap.get(key).semanticNorm = item._normScore;
      } else {
        scoreMap.set(key, { item, bm25Norm: 0, semanticNorm: item._normScore });
      }
    }

    const merged = [];
    for (const [, entry] of scoreMap) {
      merged.push({
        ...entry.item,
        _hybridScore: Math.round((entry.bm25Norm * bm25Weight + entry.semanticNorm * semanticWeight) * 1000) / 1000,
      });
    }
    merged.sort((a, b) => b._hybridScore - a._hybridScore);
    return topK ? merged.slice(0, topK) : merged;
  }

  // Default: use method
  if (method === 'rrf') {
    return rrfFusion(bm25Results, semanticResults, { topK });
  }

  return weightedFusion(bm25Results, semanticResults, queryType, { topK });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeScores(results, scoreKey) {
  if (!results || results.length === 0) return [];

  const scores = results.map(r => r[scoreKey] || 0);
  const maxScore = Math.max(...scores, 0.001);
  const minScore = Math.min(...scores, 0);

  return results.map(r => ({
    ...r,
    _normScore: maxScore === minScore ? 0.5 : (r[scoreKey] || 0 - minScore) / (maxScore - minScore),
  }));
}

// ---------------------------------------------------------------------------
// Quick test
// ---------------------------------------------------------------------------

function main() {
  const bm25Results = [
    { file: 'src/auth.ts', relFile: 'src/auth.ts', bm25Score: 12.5, matches: [{ line: 10 }] },
    { file: 'src/login.ts', relFile: 'src/login.ts', bm25Score: 8.2, matches: [{ line: 25 }] },
    { file: 'src/utils.ts', relFile: 'src/utils.ts', bm25Score: 5.1, matches: [{ line: 42 }] },
    { file: 'src/app.ts', relFile: 'src/app.ts', bm25Score: 3.0, matches: [{ line: 5 }] },
  ];

  const semanticResults = [
    { file: 'src/login.ts', relFile: 'src/login.ts', score: 0.85, startLine: 20, endLine: 35 },
    { file: 'src/session.ts', relFile: 'src/session.ts', score: 0.72, startLine: 15, endLine: 30 },
    { file: 'src/auth.ts', relFile: 'src/auth.ts', score: 0.45, startLine: 5, endLine: 20 },
  ];

  console.log('=== RRF Fusion ===');
  const rrf = rrfFusion(bm25Results, semanticResults);
  for (const r of rrf) {
    console.log(`  [RRF ${r._rrfScore.toFixed(4)}] ${r.relFile} (BM25#${r._rankA}, Sem#${r._rankB})`);
  }

  console.log('\n=== Weighted Fusion (NL query) ===');
  const weighted = weightedFusion(bm25Results, semanticResults, 'natural_language');
  for (const r of weighted) {
    console.log(`  [${r._hybridScore.toFixed(3)}] ${r.relFile}`);
  }

  console.log('\n=== Hybrid Rank (symbol query, RRF) ===');
  const hybrid = hybridRank(bm25Results, semanticResults, 'symbol', { method: 'rrf' });
  for (const r of hybrid) {
    console.log(`  [${r._rrfScore?.toFixed(4) || r._hybridScore?.toFixed(3)}] ${r.relFile}`);
  }
}

if (process.argv[1] && process.argv[1].includes('hybrid-search.mjs')) {
  main();
}