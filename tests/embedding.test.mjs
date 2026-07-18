// embedding.test.mjs — Tests for three-tier embedding engine
//
// Covers:
//   1. tokenize: stop words, punctuation, case, short tokens
//   2. createVectorizer: empty corpus, with corpus
//   3. cosineSimilarity: identical, orthogonal, zero-vector
//   4. addDocument: incremental DF update
//   5. getStats: counts correct
//   6. hybridSearch: basic, empty entries, custom options, edge cases
//   7. Sentence bridge: isSentenceModelAvailable, tryLoadSentenceModel fallback
//
// Run: node --test tests/embedding.test.mjs

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVectorizer,
  hybridSearch,
  isSentenceModelAvailable,
  tryLoadSentenceModel,
  getSentenceEmbedding,
} from '../src/lib/embedding.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tokenize (internal via vectorizer)', () => {

  it('filters stop words', () => {
    const vec = createVectorizer();
    // Use words that ARE in the STOP_WORDS set (and have length > 1 to survive tokenize)
    const v = vec.getVector('the to of an is');
    // All are stop words → empty vector
    assert.deepEqual(v, {}, 'stop words only should produce empty vector');
  });

  it('removes punctuation and lowercases', () => {
    const vec = createVectorizer();
    const tokens = vec.tokenize('TypeError: Cannot read property "foo"!!');
    // BM25 tokenizer splits camelCase: "TypeError" → "type" + "error"
    // Punctuation removed, tokens lowercased
    assert.ok(tokens.includes('type'), 'should split camelCase and lowercase');
    assert.ok(tokens.includes('error'), 'should split camelCase');
    assert.ok(tokens.includes('cannot'));
    assert.ok(tokens.includes('property'));
    assert.ok(!tokens.some(t => t.includes(':')), 'should remove colons');
    assert.ok(!tokens.some(t => t.includes('"')), 'should remove quotes');
  });

  it('filters single-character tokens', () => {
    const vec = createVectorizer();
    const tokens = vec.tokenize('a b c test');
    assert.ok(!tokens.includes('a'), 'single char filtered');
    assert.ok(!tokens.includes('b'), 'single char filtered');
    assert.ok(tokens.includes('test'), 'multi-char kept');
  });

  it('handles empty string', () => {
    const vec = createVectorizer();
    assert.deepEqual(vec.tokenize(''), [], 'empty → []');
    assert.deepEqual(vec.tokenize('   '), [], 'whitespace → []');
  });

  it('handles numbers and underscores', () => {
    const vec = createVectorizer();
    const tokens = vec.tokenize('error_404 not_found foo2');
    // BM25 tokenizer splits snake_case: "error_404" → "error" + "404"
    // "not" is a stop word and gets filtered out
    assert.ok(tokens.includes('error'), 'snake_case split: error');
    assert.ok(tokens.includes('404'), 'snake_case split: 404');
    assert.ok(!tokens.includes('not'), 'stop word "not" filtered');
    assert.ok(tokens.includes('found'), 'snake_case split: found');
    assert.ok(tokens.includes('foo2'), 'camelCase with digits kept');
  });
});

describe('createVectorizer', () => {

  it('creates vectorizer from empty corpus', () => {
    const vec = createVectorizer();
    const stats = vec.getStats();
    assert.equal(stats.docCount, 0);
    assert.equal(stats.totalTerms, 0);
    assert.equal(stats.vectorDimension, 0);
  });

  it('builds DF from corpus', () => {
    const corpus = [
      'TypeError: Cannot read property',
      'Module not found error',
      'Syntax error unexpected token',
    ];
    const vec = createVectorizer(corpus);
    const stats = vec.getStats();
    assert.equal(stats.docCount, 3);
    assert.ok(stats.totalTerms > 0, 'should have terms');
  });

  it('getVector returns weighted TF-IDF vector', () => {
    const corpus = [
      'TypeError undefined property',
      'Module not found error',
    ];
    const vec = createVectorizer(corpus);
    const v = vec.getVector('TypeError undefined');

    // Has entries for matched terms
    assert.ok(Object.keys(v).length > 0, 'vector should have entries');
    // All values should be positive
    for (const val of Object.values(v)) {
      assert.ok(val > 0, `term weight should be positive, got ${val}`);
    }
  });

  it('getVector returns {} for empty input', () => {
    const vec = createVectorizer(['some text']);
    assert.deepEqual(vec.getVector(''), {}, 'empty text → {}');
    assert.deepEqual(vec.getVector('the of an'), {}, 'stop words → {}');
  });
});

describe('cosineSimilarity', () => {

  it('identical vectors score ~1.0', () => {
    const vec = createVectorizer(['error message test']);
    const v = vec.getVector('error message test');
    const score = vec.cosineSimilarity(v, v);
    assert.ok(Math.abs(score - 1) < 1e-10, `expected ~1.0, got ${score}`);
  });

  it('orthogonal vectors score 0', () => {
    const vec = createVectorizer();
    // Manually create vectors with no overlapping terms
    const v1 = { error: 1, fail: 2 };
    const v2 = { success: 1, pass: 2 };
    assert.equal(vec.cosineSimilarity(v1, v2), 0);
  });

  it('zero vectors return 0', () => {
    const vec = createVectorizer();
    const v1 = { error: 1 };
    const v2 = {};
    assert.equal(vec.cosineSimilarity(v1, v2), 0);
    assert.equal(vec.cosineSimilarity({}, {}), 0);
  });

  it('similar text > dissimilar text', () => {
    const vec = createVectorizer([
      'file not found error',
      'TypeError undefined property',
    ]);
    const similar = vec.cosineSimilarity(
      vec.getVector('file not found'),
      vec.getVector('cannot locate file'),
    );
    const dissimilar = vec.cosineSimilarity(
      vec.getVector('file not found'),
      vec.getVector('TypeError undefined'),
    );
    assert.ok(similar > dissimilar, `similar(${similar}) should be > dissimilar(${dissimilar})`);
  });
});

describe('addDocument', () => {

  it('adds document and updates DF incrementally', () => {
    const vec = createVectorizer(['original error']);
    const before = vec.getStats().totalTerms;
    vec.addDocument('completely new term xyz123');
    const after = vec.getStats().totalTerms;
    assert.ok(after >= before, 'DF should not shrink');
    assert.ok(after > before || vec.getVector('xyz123').xyz123 > 0,
      'should incorporate new terms');
  });

  it('addDocument returns vector for the added text', () => {
    const vec = createVectorizer(['base']);
    const v = vec.addDocument('new term added');
    assert.ok(Object.keys(v).length > 0, 'should return vector');
    assert.ok(v.new, 'should include new term');
    assert.ok(v.added, 'should include added');
  });
});

describe('getStats', () => {

  it('reports correct counts', () => {
    const docs = ['foo bar', 'baz qux'];
    const vec = createVectorizer(docs);
    const stats = vec.getStats();
    assert.equal(stats.docCount, 2);
    // 4 unique terms: foo, bar, baz, qux
    assert.equal(stats.totalTerms, 4);
    assert.equal(stats.vectorDimension, 4);
  });

  it('works for empty vectorizer', () => {
    const vec = createVectorizer();
    assert.deepEqual(vec.getStats(), { totalTerms: 0, docCount: 0, vectorDimension: 0 });
  });
});

describe('hybridSearch', () => {

  const entries = [
    { errorMessage: 'TypeError: Cannot read property foo of undefined', id: 1 },
    { errorMessage: 'Module not found: Cannot find module express', id: 2 },
    { errorMessage: 'ENOENT: no such file or directory', id: 3 },
  ];

  it('finds most relevant entry', () => {
    const results = hybridSearch('Cannot read property', entries, { topK: 2 });
    assert.ok(results.length > 0, 'should return results');
    assert.equal(results[0].id, 1, 'entry 1 should rank highest');
    assert.ok(results[0].similarity >= 0, 'similarity should be >= 0');
  });

  it('returns empty array for empty entries', () => {
    const results = hybridSearch('test', [], { topK: 5 });
    assert.deepEqual(results, []);
  });

  it('respects topK limit', () => {
    // Use a query that actually matches tokens in entries
    const results = hybridSearch('TypeError', entries, { topK: 1 });
    assert.equal(results.length, 1);
  });

  it('respects minScore threshold', () => {
    const results = hybridSearch('xyznonexistent', entries, { minScore: 0.9 });
    assert.equal(results.length, 0, 'no match should clear threshold');
  });

  it('uses custom textKey', () => {
    const alt = [
      { msg: 'TypeError undefined', id: 1 },
      { msg: 'File not found', id: 2 },
    ];
    const results = hybridSearch('TypeError undefined', alt, { textKey: 'msg', topK: 2 });
    assert.ok(results.length > 0, 'should search by msg key');
    assert.equal(results[0].id, 1);
  });

  it('skips entries with empty textKey', () => {
    const withEmpty = [
      { errorMessage: 'real error', id: 1 },
      { errorMessage: '', id: 2 },
      { errorMessage: null, id: 3 },
    ];
    // null will crash on .trim in tokenize, so skip gracefully
    const results = hybridSearch('real', withEmpty);
    assert.ok(results.length > 0);
  });

  it('sorts by descending similarity', () => {
    const results = hybridSearch('TypeError', entries, { topK: 3 });
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].similarity >= results[i].similarity,
        `results[${i - 1}].similarity(${results[i - 1].similarity}) >= results[${i}].similarity(${results[i].similarity})`);
    }
  });

  it('reuses existing vectorizer', () => {
    const vec = createVectorizer(entries.map(e => e.errorMessage));
    const results = hybridSearch('TypeError', entries, { topK: 2, vectorizer: vec });
    assert.ok(results.length > 0);
    assert.equal(results[0].id, 1);
  });

  it('attaches matchType and sub-scores', () => {
    const results = hybridSearch('TypeError', entries, { topK: 1 });
    assert.ok(results[0].hasOwnProperty('_vectorScore'), 'should have vectorScore');
    assert.ok(results[0].hasOwnProperty('_fuzzyScore'), 'should have fuzzyScore');
    assert.ok(results[0].hasOwnProperty('matchType'), 'should have matchType');
  });
});

describe('sentence embedding bridge', () => {

  it('isSentenceModelAvailable returns false initially', () => {
    assert.equal(isSentenceModelAvailable(), false);
  });

  it('tryLoadSentenceModel fails gracefully when module not cached', async () => {
    // Should not throw even if @huggingface/transformers has issues
    // This tests the try/catch path
    const result = await tryLoadSentenceModel();
    // Either loads or returns null — both are acceptable
    // Key: no crash, no unhandled rejection
    assert.ok(result === null || (result && result.extractor));
  });

  it('getSentenceEmbedding returns null when model not loaded', async () => {
    // If tryLoadSentenceModel was already called above and succeeded,
    // this test may be moot. The important thing is the null path.
    // Call it only if we know model isn't loaded
    if (!isSentenceModelAvailable()) {
      const emb = await getSentenceEmbedding('test error');
      assert.equal(emb, null);
    }
  });

  it('tryLoadSentenceModel is idempotent (guard prevents double load)', async () => {
    // First call happens in previous test
    // Second call should be fast (cached or skipped)
    const start = performance.now();
    const result = await tryLoadSentenceModel();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 5000, `second call should be fast (${elapsed.toFixed(0)}ms ≤ 5s)`);
    // Result consistent with first call
    assert.ok(result === null || (result && result.extractor));
  });
});
