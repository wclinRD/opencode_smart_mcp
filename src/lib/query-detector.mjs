// query-detector.mjs — Query type detection for smart_grep
//
// Detects whether a search query is:
//   - "symbol"      — exact identifier lookup (camelCase, PascalCase, snake_case)
//   - "natural_language" — conceptual / semantic query (full sentences, questions)
//   - "path"        — file path pattern (contains / or .ext)
//
// The detected type influences:
//   - Ranking strategy (BM25 vs semantic weight)
//   - Tokenization approach
//   - Reranking signal weights
//
// References:
//   - Veles query-type detection
//   - search-semantically QueryType (Identifier / NaturalLanguage / PathLike)

// ---------------------------------------------------------------------------
// Heuristic Rules
// ---------------------------------------------------------------------------

/**
 * Detect the type of a search query.
 *
 * @param {string} query - raw query string
 * @returns {{ type: 'symbol'|'natural_language'|'path', confidence: number, signals: string[] }}
 */
export function detectQueryType(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { type: 'natural_language', confidence: 0.5, signals: ['empty_query'] };
  }

  const trimmed = query.trim();
  const signals = [];

  // --- Path detection ---
  // Contains path separators or file extensions
  const pathScore = scorePath(trimmed);
  if (pathScore >= 0.6) {
    signals.push('path_separator', 'file_extension');
    return { type: 'path', confidence: pathScore, signals };
  }

  // --- Special case: bare filename with extension → path ---
  // e.g., "config.json", "app.ts", "utils.py"
  if (/^[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,6}$/.test(trimmed) && !trimmed.includes('/')) {
    signals.push('bare_filename');
    return { type: 'path', confidence: 0.7, signals };
  }

  // --- Symbol detection ---
  const symbolScore = scoreSymbol(trimmed);
  const nlScore = scoreNaturalLanguage(trimmed);

  if (symbolScore >= 0.64 && symbolScore > nlScore) {
    signals.push('identifier_pattern');
    return { type: 'symbol', confidence: symbolScore, signals };
  }

  if (nlScore >= 0.6) {
    signals.push('natural_language_pattern');
    return { type: 'natural_language', confidence: nlScore, signals };
  }

  // Default: if it looks like a single word with mixed case, treat as symbol
  if (symbolScore > nlScore) {
    signals.push('default_symbol');
    return { type: 'symbol', confidence: symbolScore, signals };
  }

  signals.push('default_nl');
  return { type: 'natural_language', confidence: nlScore, signals };
}

/**
 * Score how likely the query is a file path.
 * @param {string} query
 * @returns {number} 0-1
 */
function scorePath(query) {
  let score = 0;

  // Contains forward slash (path separator)
  if (query.includes('/')) score += 0.4;

  // Contains backslash (Windows path)
  if (query.includes('\\')) score += 0.3;

  // Ends with a known file extension — strong path signal
  const hasExtension = /\.[a-zA-Z]{1,6}$/.test(query);
  if (hasExtension) score += 0.5;

  // Looks like a relative path pattern
  if (/^(?:\.\/|\.\.\/|~\/)/.test(query)) score += 0.3;

  // Contains glob characters
  if (/[*?\[\]{}]/.test(query)) score += 0.2;

  return Math.min(1, score);
}

/**
 * Score how likely the query is a code symbol/identifier.
 * @param {string} query
 * @returns {number} 0-1
 */
function scoreSymbol(query) {
  let score = 0;

  // Single word (no spaces)
  const words = query.split(/\s+/);
  if (words.length === 1) score += 0.35;

  // camelCase pattern
  if (/[a-z][A-Z]/.test(query)) score += 0.35;

  // PascalCase pattern (starts with uppercase)
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(query)) score += 0.35;

  // snake_case pattern
  if (/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+$/.test(query)) score += 0.30;

  // UPPER_SNAKE_CASE (constants)
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/.test(query)) score += 0.30;

  // kebab-case
  if (/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/.test(query)) score += 0.2;

  // Contains $ (JS variable), @ (decorator), # (private), _ (private)
  if (/^[$@#_]/.test(query)) score += 0.15;

  // Looks like a function call: word(
  if (/^\w+\(\)?$/.test(query)) score += 0.2;

  // Contains dots (method chain or module path): foo.bar.baz
  if (/^\w+(?:\.\w+)+$/.test(query)) score += 0.2;

  // Regex pattern detection: if query has backslash-escaped sequences, it's a regex symbol search
  if (/\\[swdSWD]/.test(query)) score += 0.35;
  // Other regex metacharacters slightly reduce symbol confidence
  if (/[\^$.*+?()[\]{}|]/.test(query) && !/[\\][swdSWD]/.test(query)) score -= 0.15;

  return Math.max(0, Math.min(1, score));
}

/**
 * Score how likely the query is natural language.
 * @param {string} query
 * @returns {number} 0-1
 */
function scoreNaturalLanguage(query) {
  let score = 0;

  // Multiple words
  const words = query.split(/\s+/);
  if (words.length >= 3) score += 0.4;
  else if (words.length === 2) score += 0.2;

  // Contains common English stop words
  const stopWords = /\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|shall|should|may|might|must|can|could|in|on|at|to|for|of|with|by|from|as|into|through|during|before|after|above|below|between|and|but|or|nor|not|so|yet|if|then|else|when|where|why|how|all|each|every|both|few|more|most|other|some|such|no|only|own|same|than|too|very|just|about|also|that|this|these|those|which|who|whom|what)\b/i;
  if (stopWords.test(query)) score += 0.3;

  // Ends with question mark
  if (query.endsWith('?')) score += 0.2;

  // Contains natural language patterns
  if (/\b(how|what|where|when|why|who|find|search|look|get|show|list|explain|describe)\b/i.test(query)) {
    score += 0.25;
  }

  // All lowercase with spaces (typical NL query)
  if (/^[a-z\s]+$/.test(query) && query.includes(' ')) score += 0.2;

  // Very long (>40 chars) likely NL
  if (query.length > 40) score += 0.15;

  return Math.min(1, score);
}

/**
 * Convert a natural language query to a regex pattern for broad matching.
 *
 * Strategy:
 *   1. Remove stop words and filler phrases
 *   2. Extract meaningful keywords (code-relevant terms)
 *   3. Build a regex that matches keywords in any order
 *
 * @param {string} nlQuery - natural language query
 * @returns {{ regex: string, keywords: string[], intent: string }}
 */
export function nlToRegex(nlQuery) {
  if (!nlQuery || typeof nlQuery !== 'string') {
    return { regex: '.*', keywords: [], intent: 'unknown' };
  }

  const trimmed = nlQuery.trim();

  // --- Intent detection ---
  let intent = 'search';
  if (/\b(find|search|look|get|show|list|locate)\b/i.test(trimmed)) intent = 'search';
  if (/\b(define|definition|declare|implement)\b/i.test(trimmed)) intent = 'definition';
  if (/\b(import|require|include|use|depend)\b/i.test(trimmed)) intent = 'import';
  if (/\b(test|spec|assert|verify|check)\b/i.test(trimmed)) intent = 'test';
  if (/\b(error|bug|fix|issue|fail|crash)\b/i.test(trimmed)) intent = 'error';
  if (/\b(todo|fixme|hack|xxx|note)\b/i.test(trimmed)) intent = 'comment';

  // --- Stop words (common English + filler) ---
  const stopWords = new Set([
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
    'he', 'she', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
    // Filler words
    'find', 'search', 'look', 'get', 'show', 'list', 'locate',
    'define', 'definition', 'declare', 'implement',
    'import', 'require', 'include', 'use', 'depend',
    'all', 'any', 'every', 'each', 'some',
    'the', 'that', 'this', 'these', 'those',
  ]);

  // --- Extract keywords ---
  const words = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));

  // Deduplicate
  const keywords = [...new Set(words)];

  if (keywords.length === 0) {
    return { regex: trimmed, keywords: [], intent };
  }

  // --- Build regex ---
  // For intent=definition: prefix with common definition patterns
  // For others: match keywords in any order (word boundary aware)
  let pattern;

  if (intent === 'definition') {
    // Match: function/class/const/def/module + keyword
    const kw = keywords.map(k => escapeRegex(k)).join('|');
    pattern = `(?:function|class|const|let|var|def|module|interface|type|enum)\\s+\\w*(?:${kw})\\w*`;
  } else if (intent === 'import') {
    // Match: import/require/include + keyword
    const kw = keywords.map(k => escapeRegex(k)).join('|');
    pattern = `(?:import|require|include|use)\\s+.*(?:${kw})`;
  } else if (intent === 'error') {
    // Match: error/throw/catch/throw + keyword
    const kw = keywords.map(k => escapeRegex(k)).join('|');
    pattern = `(?:error|throw|catch|reject|fail|exception|panic)\\s*(?:\\([^)]*\\))?\\s*(?:.*(?:${kw})|.*)`;
  } else if (intent === 'comment') {
    // Match: comment markers + keyword
    const kw = keywords.map(k => escapeRegex(k)).join('|');
    pattern = `(?:\/\/|\/\*|#|<!--|TODO|FIXME|HACK|XXX)\\s*(?:.*(?:${kw})|.*)`;
  } else if (intent === 'test') {
    // Match: test/it/describe + keyword
    const kw = keywords.map(k => escapeRegex(k)).join('|');
    pattern = `(?:describe|it|test|spec)\\s*\(\s*['"\`](?:.*(?:${kw})|.*)`;
  } else {
    // Generic: match all keywords in any order (lookahead)
    const lookaheads = keywords.map(k => `(?=.*\\b${escapeRegex(k)}\\b)`);
    pattern = lookaheads.join('') + '.*';
  }

  return { regex: pattern, keywords, intent };
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get recommended BM25/semantic weight split based on query type.
 *
 * @param {'symbol'|'natural_language'|'path'} type
 * @returns {{ bm25Weight: number, semanticWeight: number }}
 */
export function getQueryWeights(type) {
  switch (type) {
    case 'symbol':
      return { bm25Weight: 0.7, semanticWeight: 0.3 };
    case 'path':
      return { bm25Weight: 0.8, semanticWeight: 0.2 };
    case 'natural_language':
      return { bm25Weight: 0.3, semanticWeight: 0.7 };
    default:
      return { bm25Weight: 0.5, semanticWeight: 0.5 };
  }
}

export default { detectQueryType, getQueryWeights, nlToRegex };