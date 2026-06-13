// bm25.mjs — BM25 ranking with identifier-aware tokenization
//
// Implements Okapi BM25 for code search relevance ranking.
// Features:
//   - Identifier-aware tokenization (camelCase/PascalCase/snake_case/kebab-case)
//   - BM25 scoring with configurable k1 and b parameters
//   - Document frequency tracking for IDF computation
//   - Rank fusion with external signals
//
// References:
//   - Zoekt BM25Scoring (Sourcegraph)
//   - ColGREP IdentifierAware tokenizer
//   - codixing BM25+PageRank
//   - semble_rs ranking signals

// ---------------------------------------------------------------------------
// Tokenizer — identifier-aware splitting
// ---------------------------------------------------------------------------

/**
 * Split text into tokens with identifier-aware boundaries.
 *
 * Handles:
 *   camelCase  → [camel, case]
 *   PascalCase → [pascal, case]
 *   snake_case → [snake, case]
 *   kebab-case → [kebab, case]
 *   UPPER_CASE → [upper, case]
 *   mixedCamel_SNAKE → [mixed, camel, snake]
 *
 * @param {string} text
 * @returns {string[]} lowercase tokens
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  // Step 1: Split on non-alphanumeric boundaries (spaces, punctuation, etc.)
  // But preserve internal case boundaries
  const segments = text.split(/[^a-zA-Z0-9_$]+/).filter(Boolean);

  const tokens = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;

    // Step 2: Split snake_case and kebab-case
    const subSegments = segment.split(/[_-]+/).filter(Boolean);

    for (const sub of subSegments) {
      if (sub.length === 0) continue;

      // Step 3: Split camelCase / PascalCase
      // Strategy: split at lowercase→uppercase boundaries
      // e.g., "parseRequest" → ["parse", "Request"]
      // e.g., "HTTPServer" → ["HTTP", "Server"]
      const camelTokens = splitCamelCase(sub);
      for (const ct of camelTokens) {
        const lower = ct.toLowerCase();
        if (lower.length > 0) tokens.push(lower);
      }
    }
  }

  return tokens;
}

/**
 * Split a camelCase / PascalCase word into sub-tokens.
 * @param {string} word
 * @returns {string[]}
 */
function splitCamelCase(word) {
  if (word.length === 0) return [];
  if (word === word.toUpperCase()) return [word]; // All caps, don't split

  const result = [];
  let current = word[0];
  let prevUpper = word[0] === word[0].toUpperCase();

  for (let i = 1; i < word.length; i++) {
    const ch = word[i];
    const isUpper = ch === ch.toUpperCase();
    const isDigit = ch >= '0' && ch <= '9';

    if (isDigit) {
      current += ch;
      continue;
    }

    if (isUpper && !prevUpper) {
      // lowercase → Uppercase: split
      result.push(current);
      current = ch;
    } else if (!isUpper && prevUpper && current.length > 1) {
      // Uppercase... → lowercase: split before the last uppercase
      // e.g., "HTTPServer" → "HTTP" + "Server"
      const lastUpper = current.length - 1;
      result.push(current.substring(0, lastUpper));
      current = current.substring(lastUpper) + ch;
    } else {
      current += ch;
    }
    prevUpper = isUpper;
  }

  if (current.length > 0) result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// BM25 Implementation
// ---------------------------------------------------------------------------

/**
 * Default BM25 parameters.
 * k1=1.2: term frequency saturation (standard Okapi)
 * b=0.75: document length normalization (standard Okapi)
 */
const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

/**
 * Compute BM25 score for a query against a document.
 *
 * BM25(q, d) = Σ IDF(qi) * (tf(qi,d) * (k1 + 1)) / (tf(qi,d) + k1 * (1 - b + b * |d|/avgdl))
 *
 * @param {string[]} queryTokens - tokenized query
 * @param {string[]} docTokens - tokenized document
 * @param {Object} stats - collection statistics
 * @param {number} stats.avgDocLength - average document length in tokens
 * @param {number} stats.totalDocs - total number of documents
 * @param {Map<string, number>} stats.docFreq - document frequency per term
 * @param {number} [k1=1.2] - term frequency saturation
 * @param {number} [b=0.75] - length normalization
 * @returns {number} BM25 score
 */
export function bm25Score(queryTokens, docTokens, stats, k1 = DEFAULT_K1, b = DEFAULT_B) {
  if (!queryTokens.length || !docTokens.length) return 0;

  const docLength = docTokens.length;
  const avgdl = stats.avgDocLength || Math.max(docLength, 1);
  const N = stats.totalDocs || 1;

  // Build term frequency map for the document
  const tf = new Map();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  let score = 0;
  const seenQueryTerms = new Set();

  for (const qt of queryTokens) {
    if (seenQueryTerms.has(qt)) continue; // Don't double-count repeated query terms
    seenQueryTerms.add(qt);

    const f = tf.get(qt) || 0;
    if (f === 0) continue;

    // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    const df = stats.docFreq?.get(qt) || 0;
    const idf = Math.log((N - df + 0.5) / (Math.max(df, 0) + 0.5) + 1);

    // TF saturation
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * (docLength / avgdl));
    const tfComponent = numerator / denominator;

    score += idf * tfComponent;
  }

  return score;
}

/**
 * Build collection statistics from a set of documents.
 *
 * @param {string[][]} allDocTokens - array of tokenized documents
 * @returns {{ avgDocLength: number, totalDocs: number, docFreq: Map<string, number> }}
 */
export function buildStats(allDocTokens) {
  const totalDocs = allDocTokens.length;
  if (totalDocs === 0) {
    return { avgDocLength: 0, totalDocs: 0, docFreq: new Map() };
  }

  let totalLength = 0;
  const docFreq = new Map();

  for (const docTokens of allDocTokens) {
    totalLength += docTokens.length;
    const seen = new Set();
    for (const t of docTokens) {
      if (!seen.has(t)) {
        seen.add(t);
        docFreq.set(t, (docFreq.get(t) || 0) + 1);
      }
    }
  }

  return {
    avgDocLength: totalLength / totalDocs,
    totalDocs,
    docFreq,
  };
}

/**
 * Rank search results by BM25 relevance score.
 *
 * @param {Array} results - search results from searchFiles()
 * @param {string} query - original query string
 * @param {Object} [options]
 * @param {number} [options.k1=1.2] - BM25 k1 parameter
 * @param {number} [options.b=0.75] - BM25 b parameter
 * @returns {Array} results sorted by BM25 score (descending), each with _bm25Score
 */
export function rankResults(results, query, options = {}) {
  if (!results || results.length === 0) return results;

  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return results;

  // Build document tokens from results
  // Each "document" is the concatenation of all matched lines + context
  const docTokensList = results.map(r => {
    const text = r.matches.map(m => {
      const parts = [];
      if (m.contextBefore) parts.push(...m.contextBefore);
      parts.push(m.lineContent);
      if (m.contextAfter) parts.push(...m.contextAfter);
      return parts.join(' ');
    }).join(' ');
    return tokenize(text);
  });

  const stats = buildStats(docTokensList);

  // Score each result
  for (let i = 0; i < results.length; i++) {
    results[i]._bm25Score = bm25Score(queryTokens, docTokensList[i], stats, k1, b);
  }

  // Sort by score descending
  results.sort((a, b) => (b._bm25Score || 0) - (a._bm25Score || 0));

  return results;
}

// ---------------------------------------------------------------------------
// Reranking Signals
// ---------------------------------------------------------------------------

/**
 * Apply code-aware reranking signals to BM25-scored results.
 *
 * Signals:
 *   1. Definition boost: +0.25 for matches on symbol definition lines
 *   2. Test demotion: -0.30 for test/spec files
 *   3. File-coherence boost: +0.20 for files with multiple matches
 *   4. Git recency boost: +0.15 for recently modified files
 *   5. Path match boost: +0.20 when query matches file path
 *   6. Symbol name boost: +0.30 for exact symbol name matches
 *
 * @param {Array} results - results with _bm25Score
 * @param {string} query - original query string
 * @param {Object} [options]
 * @param {Map<string, number>} [options.gitRecency] - filePath → days since last commit
 * @returns {Array} results with _finalScore and _signals
 */
export function applyRerankSignals(results, query, options = {}) {
  if (!results || results.length === 0) return results;

  const queryLower = query.toLowerCase();
  const queryTokens = new Set(tokenize(query));

  for (const r of results) {
    const baseScore = r._bm25Score || 0;
    const signals = {};
    let bonus = 0;

    // Signal 1: Definition boost — check if any match is on a definition line
    const hasDefinition = r.matches?.some(m => {
      const line = m.lineContent?.trim() || '';
      return /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|def|interface|type|enum)\s/.test(line);
    });
    if (hasDefinition) {
      signals.definition = 0.25;
      bonus += 0.25;
    }

    // Signal 2: Test demotion
    const filePath = r.relFile || r.file || '';
    const isTestFile = /(?:^|[\\/])(?:test|spec|__tests__|tests?)[\\/.]/i.test(filePath) ||
      /\.(?:test|spec)\.\w+$/.test(filePath);
    if (isTestFile) {
      signals.testDemotion = -0.30;
      bonus -= 0.30;
    }

    // Signal 3: File-coherence boost — multiple matches in same file
    const matchCount = r.matches?.length || 0;
    if (matchCount >= 3) {
      signals.fileCoherence = 0.20;
      bonus += 0.20;
    }

    // Signal 4: Git recency boost
    if (options.gitRecency) {
      const days = options.gitRecency.get(filePath);
      if (days !== undefined && days <= 30) {
        // Linear decay: 0.15 for today, 0 for 30+ days
        const recencyScore = 0.15 * (1 - days / 30);
        signals.gitRecency = Math.round(recencyScore * 100) / 100;
        bonus += recencyScore;
      }
    }

    // Signal 5: Path match boost
    const pathLower = filePath.toLowerCase();
    if (queryTokens.size > 0) {
      let pathMatchCount = 0;
      for (const qt of queryTokens) {
        if (pathLower.includes(qt)) pathMatchCount++;
      }
      if (pathMatchCount > 0) {
        const pathScore = Math.min(0.20, pathMatchCount * 0.10);
        signals.pathMatch = Math.round(pathScore * 100) / 100;
        bonus += pathScore;
      }
    }

    // Signal 6: Symbol name exact match boost
    if (r.structure && Array.isArray(r.structure)) {
      const symbolNames = r.structure.map(s => s.name?.toLowerCase()).filter(Boolean);
      const exactMatch = symbolNames.some(name =>
        name === queryLower || queryTokens.has(name)
      );
      if (exactMatch) {
        signals.symbolName = 0.30;
        bonus += 0.30;
      }
    }

    r._signals = signals;
    r._finalScore = Math.max(0, baseScore + bonus);
  }

  // Re-sort by final score
  results.sort((a, b) => (b._finalScore || 0) - (a._finalScore || 0));

  return results;
}

export default { tokenize, bm25Score, buildStats, rankResults, applyRerankSignals };