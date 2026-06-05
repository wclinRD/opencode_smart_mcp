// embedding.mjs — Zero-dependency TF-IDF vectorizer + cosine similarity
//
// Lightweight embedding engine for error message semantic search.
// TF-IDF works well for dev tool error messages because they share
// distinctive keywords ("not found", "undefined", "cannot read").
//
// Architecture:
//   TF-IDF Vectorizer (zero deps) ← primary, always available
//   Sentence Embedding (optional)  ← @xenova/transformers, auto-detected
//
// Usage:
//   import { createVectorizer } from './embedding.mjs';
//   const vec = createVectorizer(corpus);
//   const v = vec.getVector("Error: Cannot find module 'foo'");
//   const score = vec.cosineSimilarity(v1, v2);
//
// Hybrid search:
//   import { hybridSearch } from './embedding.mjs';
//   const results = hybridSearch(query, entries, { textKey: 'errorMessage' });

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'it', 'its', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'they', 'them', 'their',
]);

function tokenize(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s_]/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.filter(t => !STOP_WORDS.has(t) && t.length > 1);
}

// ---------------------------------------------------------------------------
// TF-IDF Vectorizer
// ---------------------------------------------------------------------------

export function createVectorizer(documents = []) {
  // docFrequency: Map<term, Set<docIndex>>
  const docFrequency = new Map();
  const docCount = documents.length;

  // Build DF from corpus
  if (docCount > 0) {
    for (let i = 0; i < documents.length; i++) {
      const tokens = tokenize(documents[i]);
      const unique = new Set(tokens);
      for (const term of unique) {
        if (!docFrequency.has(term)) docFrequency.set(term, new Set());
        docFrequency.get(term).add(i);
      }
    }
  }

  // Total unique terms for vector dimension
  const totalTerms = docFrequency.size;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  function getVector(text) {
    const tokens = tokenize(text);
    if (tokens.length === 0) return {};

    const tfMap = new Map();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    // Max TF for normalization
    let maxTf = 0;
    for (const count of tfMap.values()) maxTf = Math.max(maxTf, count);

    const vector = {};
    for (const [term, count] of tfMap) {
      const tf = 0.5 + (0.5 * count) / maxTf; // augmented frequency
      const df = docFrequency.has(term) ? docFrequency.get(term).size : 1;
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      vector[term] = tf * idf;
    }

    return vector;
  }

  function cosineSimilarity(vecA, vecB) {
    const terms = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (const term of terms) {
      const a = vecA[term] || 0;
      const b = vecB[term] || 0;
      dotProduct += a * b;
      magA += a * a;
      magB += b * b;
    }

    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  function addDocument(text) {
    // Update DF with new document (incremental)
    const tokens = tokenize(text);
    const unique = new Set(tokens);
    const newDocIndex = docCount + (documents.length - docCount > 0 ? 1 : 0);

    // We don't track per-doc index, just increment DF
    for (const term of unique) {
      if (!docFrequency.has(term)) docFrequency.set(term, new Set());
      docFrequency.get(term).add(newDocIndex);
    }
    return getVector(text);
  }

  function getStats() {
    return {
      totalTerms: docFrequency.size,
      docCount: docCount,
      vectorDimension: totalTerms,
    };
  }

  return {
    getVector,
    cosineSimilarity,
    addDocument,
    getStats,
    tokenize,
    // Expose for testing
    _docFrequency: docFrequency,
    _docCount: docCount,
  };
}

// ---------------------------------------------------------------------------
// Hybrid search (vector + fuzzy)
// ---------------------------------------------------------------------------

/**
 * Hybrid search combining TF-IDF vector similarity with keyword overlap.
 *
 * @param {string} query - Search query
 * @param {Array} entries - Array of objects to search
 * @param {Object} options
 * @param {string} options.textKey - Key for text to compare (default: 'errorMessage')
 * @param {number} options.vectorWeight - Weight for vector score (0-1), default 0.7
 * @param {number} options.topK - Max results (default: 10)
 * @param {number} options.minScore - Minimum hybrid score (default: 0.1)
 * @param {import('./embedding.mjs').Vectorizer} [options.vectorizer] - Reuse existing vectorizer
 * @returns {Array} Ranked results with similarity scores
 */
export function hybridSearch(query, entries, options = {}) {
  const {
    textKey = 'errorMessage',
    vectorWeight = 0.7,
    topK = 10,
    minScore = 0.1,
    vectorizer,
  } = options;

  if (!entries || entries.length === 0) return [];

  // Build corpus from entries if no vectorizer provided
  const corpus = entries.map(e => e[textKey] || '');
  const vec = vectorizer || createVectorizer(corpus);

  const queryVec = vec.getVector(query);
  const results = [];

  for (const entry of entries) {
    const text = entry[textKey] || '';
    if (!text) continue;

    // Vector similarity (semantic)
    const entryVec = vec.getVector(text);
    const vectorScore = vec.cosineSimilarity(queryVec, entryVec);

    // Fuzzy keyword overlap (lexical)
    const queryTokens = tokenize(query);
    const entryTokens = tokenize(text);
    const overlap = queryTokens.filter(t => entryTokens.includes(t)).length;
    const fuzzyScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

    // Hybrid score
    const hybridScore = vectorScore * vectorWeight + fuzzyScore * (1 - vectorWeight);

    if (hybridScore >= minScore) {
      results.push({
        ...entry,
        similarity: Math.round(hybridScore * 100) / 100,
        _vectorScore: Math.round(vectorScore * 100) / 100,
        _fuzzyScore: Math.round(fuzzyScore * 100) / 100,
        matchType: vectorScore > 0.8 ? 'vector' : 'hybrid',
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Sentence embedding bridge (optional, for @xenova/transformers)
// ---------------------------------------------------------------------------

let _sentenceModel = null;
let _sentenceLoadAttempted = false;

/**
 * Try to load @xenova/transformers pipeline for deep semantic search.
 * Falls back silently if not available.
 *
 * @returns {Promise<Object|null>} { extractor: pipeline } or null
 */
export async function tryLoadSentenceModel() {
  if (_sentenceModel) return _sentenceModel;
  if (_sentenceLoadAttempted) return null;

  _sentenceLoadAttempted = true;

  try {
    // Dynamic import — module may not be installed
    const { pipeline } = await import('@xenova/transformers');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    _sentenceModel = { extractor };
    return _sentenceModel;
  } catch {
    // Module not available — silently return null
    return null;
  }
}

/**
 * Get sentence embedding vector if model is loaded.
 *
 * @param {string} text
 * @returns {Promise<Float64Array|null>}
 */
export async function getSentenceEmbedding(text) {
  if (!_sentenceModel) return null;

  try {
    const output = await _sentenceModel.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return output.data;
  } catch {
    return null;
  }
}

export function isSentenceModelAvailable() {
  return _sentenceModel !== null;
}

// ---------------------------------------------------------------------------
// Quick test
// ---------------------------------------------------------------------------

// Run with: node src/lib/embedding.mjs
function main() {
  const corpus = [
    "TypeError: Cannot read property 'foo' of undefined",
    "Error: Cannot find module 'express'",
    "Module not found: Can't resolve 'react'",
    "SyntaxError: Unexpected token '}'",
    "Error: ENOENT: no such file or directory",
    "TypeError: Cannot read properties of null (reading 'bar')",
  ];

  const vec = createVectorizer(corpus);
  console.log('Vectorizer stats:', vec.getStats());

  const queries = [
    "TypeError: Cannot read property of undefined",
    "module not found error",
    "file not found ENOENT",
    "syntax error unexpected token",
  ];

  const entries = corpus.map((text, i) => ({ errorMessage: text, id: i }));

  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    const results = hybridSearch(q, entries, { topK: 3 });
    for (const r of results) {
      console.log(`  [${r.similarity.toFixed(2)}] ${r.errorMessage.slice(0, 80)}`);
    }
  }

  // Test similarity: "not found" variants should be close
  const v1 = vec.getVector("file not found");
  const v2 = vec.getVector("cannot locate file");
  console.log(`\nSemantic test: "file not found" vs "cannot locate file": ${vec.cosineSimilarity(v1, v2).toFixed(3)}`);

  const v3 = vec.getVector("TypeError undefined property");
  const v4 = vec.getVector("Cannot read property of undefined");
  console.log(`"TypeError undefined" vs "Cannot read...undefined": ${vec.cosineSimilarity(v3, v4).toFixed(3)}`);
}

if (process.argv[1] && process.argv[1].includes('embedding.mjs')) {
  main();
}
