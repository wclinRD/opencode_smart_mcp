// semantic-search.mjs — Semantic code search using TF-IDF embeddings
//
// Chunks code into semantic units (functions, classes, etc.) and
// performs semantic similarity search against natural language or code queries.
//
// Uses the existing embedding.mjs for TF-IDF vectorization.
// Optionally uses @huggingface/transformers for sentence embeddings.
//
// Usage:
//   import { chunkCode, semanticSearch, initSemanticSearch } from './semantic-search.mjs';
//   const chunks = chunkCode(fileContent, filePath);
//   const results = semanticSearch("authentication error handling", chunks);

import { createVectorizer } from './embedding.mjs';
import { tryLoadSentenceModel, getSentenceEmbedding, isSentenceModelAvailable } from './embedding.mjs';

// ---------------------------------------------------------------------------
// Code chunking — split code into semantic units
// ---------------------------------------------------------------------------

/**
 * Chunk code into semantic units (functions, classes, methods).
 * Falls back to line-based chunking if no structure detected.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path (for language detection)
 * @returns {Array<{text: string, startLine: number, endLine: number, type: string, name?: string}>}
 */
export function chunkCode(content, filePath = '') {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const lines = content.split('\n');

  // Try structural chunking first
  const structuralChunks = structuralChunk(lines, ext);
  if (structuralChunks.length > 0) return structuralChunks;

  // Fallback: sliding window chunks (~20 lines each, 10 line overlap)
  return slidingWindowChunks(lines);
}

function structuralChunk(lines, ext) {
  const chunks = [];
  const lang = detectLang(ext);
  if (!lang) return chunks;

  const patterns = getPatterns(lang);
  const stack = []; // { name, type, startLine, indent }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Pop stack on dedent
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      const scope = stack.pop();
      const body = lines.slice(scope.startLine, i).join('\n').trim();
      if (body.length > 10) {
        chunks.push({
          text: body,
          startLine: scope.startLine + 1,
          endLine: i,
          type: scope.type,
          name: scope.name,
        });
      }
    }

    // Check for definition lines
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        const name = (match[1] || match[0]).replace(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?/, '').trim();
        stack.push({ name, type: pattern.type, startLine: i, indent });
        break;
      }
    }
  }

  // Flush remaining stack
  while (stack.length > 0) {
    const scope = stack.pop();
    const body = lines.slice(scope.startLine).join('\n').trim();
    if (body.length > 10) {
      chunks.push({
        text: body,
        startLine: scope.startLine + 1,
        endLine: lines.length,
        type: scope.type,
        name: scope.name,
      });
    }
  }

  return chunks;
}

function slidingWindowChunks(lines, windowSize = 20, overlap = 10) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += windowSize - overlap) {
    const end = Math.min(i + windowSize, lines.length);
    const text = lines.slice(i, end).join('\n').trim();
    if (text.length > 10) {
      chunks.push({ text, startLine: i + 1, endLine: end, type: 'block' });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Language detection & patterns
// ---------------------------------------------------------------------------

function detectLang(ext) {
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    php: 'php', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
    cs: 'csharp',
  };
  return map[ext] || null;
}

function getPatterns(lang) {
  const common = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
    { regex: /^(?:export\s+)?class\s+(\w+)/, type: 'class' },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|=>)/, type: 'function' },
    { regex: /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/, type: 'method' },
    { regex: /^\s*(?:get|set)\s+(\w+)\s*\(/, type: 'method' },
    { regex: /^\s*interface\s+(\w+)/, type: 'interface' },
    { regex: /^\s*type\s+(\w+)\s*=/, type: 'type' },
    { regex: /^(?:export\s+)?enum\s+(\w+)/, type: 'enum' },
  ];

  const python = [
    { regex: /^\s*(?:async\s+)?def\s+(\w+)/, type: 'function' },
    { regex: /^\s*class\s+(\w+)/, type: 'class' },
  ];

  const rust = [
    { regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, type: 'function' },
    { regex: /^\s*(?:pub\s+)?struct\s+(\w+)/, type: 'struct' },
    { regex: /^\s*(?:pub\s+)?impl\s+(?:\w+\s+for\s+)?(\w+)/, type: 'impl' },
    { regex: /^\s*(?:pub\s+)?trait\s+(\w+)/, type: 'trait' },
    { regex: /^\s*(?:pub\s+)?enum\s+(\w+)/, type: 'enum' },
  ];

  const goLang = [
    { regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/, type: 'function' },
    { regex: /^type\s+(\w+)\s+struct/, type: 'struct' },
    { regex: /^type\s+(\w+)\s+interface/, type: 'interface' },
  ];

  switch (lang) {
    case 'javascript':
    case 'typescript': return common;
    case 'python': return python;
    case 'rust': return rust;
    case 'go': return goLang;
    default: return common;
  }
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

/**
 * Perform semantic search over code chunks.
 *
 * @param {string} query - Natural language or code query
 * @param {Array} chunks - Array of {text, startLine, endLine, type, name?, file?} objects
 * @param {Object} [options]
 * @param {number} [options.topK=20] - Max results
 * @param {number} [options.minScore=0.05] - Minimum similarity score
 * @returns {Array} Ranked results with similarity scores
 */
export function semanticSearch(query, chunks, options = {}) {
  const { topK = 20, minScore = 0.05 } = options;

  if (!chunks || chunks.length === 0) return [];

  const corpus = chunks.map(c => c.text);
  const vec = createVectorizer(corpus);

  const queryVec = vec.getVector(query);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkVec = vec.getVector(chunk.text);
    const score = vec.cosineSimilarity(queryVec, chunkVec);

    if (score >= minScore) {
      results.push({
        ...chunk,
        score: Math.round(score * 1000) / 1000,
        index: i,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Initialize the sentence embedding model for better semantic search.
 * Call once at startup. Falls back to TF-IDF if model unavailable.
 *
 * @returns {Promise<boolean>} true if model loaded successfully
 */
export async function initSemanticSearch() {
  const model = await tryLoadSentenceModel();
  return model !== null;
}

/**
 * Get sentence embedding for a text using the loaded model.
 * Falls back to null if model not available.
 *
 * @param {string} text
 * @returns {Promise<Float32Array|null>}
 */
export async function embedText(text) {
  if (!isSentenceModelAvailable()) return null;
  return getSentenceEmbedding(text);
}

// ---------------------------------------------------------------------------
// Quick test
// ---------------------------------------------------------------------------

function main() {
  const sampleCode = `
function authenticateUser(username, password) {
  const user = findUser(username);
  if (!user) throw new Error('User not found');
  const isValid = verifyPassword(password, user.hash);
  if (!isValid) throw new Error('Invalid password');
  return generateToken(user);
}

class AuthService {
  constructor(db) { this.db = db; }
  async login(username, password) {
    const user = await this.db.findUser(username);
    if (!user) throw new AuthError('Invalid credentials');
    return this.createSession(user);
  }
}

function handleError(err) {
  console.error('Error occurred:', err.message);
  if (err instanceof AuthError) return { status: 401, message: 'Unauthorized' };
  return { status: 500, message: 'Internal server error' };
}
`;

  const chunks = chunkCode(sampleCode, 'auth.js');
  console.log(`Chunked into ${chunks.length} semantic units:`);
  for (const c of chunks) {
    console.log(`  [${c.type}] ${c.name || '(anonymous)'} L${c.startLine}-${c.endLine}`);
  }

  console.log('\nSemantic search results:');
  const results = semanticSearch('authentication error handling', chunks, { topK: 3 });
  for (const r of results) {
    console.log(`  [${r.score.toFixed(3)}] ${r.type} "${r.name || '(anonymous)'}" L${r.startLine}-${r.endLine}`);
  }
}

if (process.argv[1] && process.argv[1].includes('semantic-search.mjs')) {
  main();
}