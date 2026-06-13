// bm25.test.mjs — Tests for BM25 ranking and identifier-aware tokenization
//
// Run: node --test tests/bm25.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenize,
  bm25Score,
  buildStats,
  rankResults,
  applyRerankSignals,
} from '../src/lib/bm25.mjs';

// ---------------------------------------------------------------------------
// Tokenizer Tests
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('should split camelCase', () => {
    const tokens = tokenize('parseRequest');
    assert.deepStrictEqual(tokens, ['parse', 'request']);
  });

  it('should split PascalCase', () => {
    const tokens = tokenize('AuthManager');
    assert.deepStrictEqual(tokens, ['auth', 'manager']);
  });

  it('should split snake_case', () => {
    const tokens = tokenize('parse_request');
    assert.deepStrictEqual(tokens, ['parse', 'request']);
  });

  it('should split kebab-case', () => {
    const tokens = tokenize('parse-request');
    assert.deepStrictEqual(tokens, ['parse', 'request']);
  });

  it('should split UPPER_SNAKE_CASE', () => {
    const tokens = tokenize('MAX_RETRY_COUNT');
    assert.deepStrictEqual(tokens, ['max', 'retry', 'count']);
  });

  it('should handle mixed camelCase and snake_case', () => {
    const tokens = tokenize('getUserData_fromCache');
    assert.deepStrictEqual(tokens, ['get', 'user', 'data', 'from', 'cache']);
  });

  it('should handle acronyms in PascalCase', () => {
    const tokens = tokenize('HTTPServer');
    assert.deepStrictEqual(tokens, ['http', 'server']);
  });

  it('should handle single word', () => {
    const tokens = tokenize('hello');
    assert.deepStrictEqual(tokens, ['hello']);
  });

  it('should handle empty string', () => {
    const tokens = tokenize('');
    assert.deepStrictEqual(tokens, []);
  });

  it('should handle null/undefined', () => {
    assert.deepStrictEqual(tokenize(null), []);
    assert.deepStrictEqual(tokenize(undefined), []);
  });

  it('should handle numbers in identifiers', () => {
    const tokens = tokenize('getUser2FA');
    assert.deepStrictEqual(tokens, ['get', 'user2', 'fa']);
  });

  it('should handle spaces and punctuation', () => {
    const tokens = tokenize('find the auth handler');
    assert.deepStrictEqual(tokens, ['find', 'the', 'auth', 'handler']);
  });
});

// ---------------------------------------------------------------------------
// BM25 Score Tests
// ---------------------------------------------------------------------------

describe('bm25Score', () => {
  it('should return 0 for empty query', () => {
    const score = bm25Score([], ['hello', 'world'], { avgDocLength: 2, totalDocs: 1, docFreq: new Map() });
    assert.strictEqual(score, 0);
  });

  it('should return 0 for empty document', () => {
    const score = bm25Score(['hello'], [], { avgDocLength: 2, totalDocs: 1, docFreq: new Map() });
    assert.strictEqual(score, 0);
  });

  it('should give higher score for exact match', () => {
    const stats = { avgDocLength: 5, totalDocs: 10, docFreq: new Map([['hello', 3]]) };
    const score1 = bm25Score(['hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats);
    const score2 = bm25Score(['hello'], ['xyz', 'abc', 'def', 'ghi', 'jkl'], stats);
    assert.ok(score1 > score2, 'Exact match should score higher than no match');
  });

  it('should give higher score for more frequent term', () => {
    const stats = { avgDocLength: 5, totalDocs: 10, docFreq: new Map([['hello', 3]]) };
    const score1 = bm25Score(['hello'], ['hello', 'hello', 'hello', 'world', 'foo'], stats);
    const score2 = bm25Score(['hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats);
    assert.ok(score1 > score2, 'More frequent term should score higher');
  });

  it('should give higher score for rarer term (higher IDF)', () => {
    const stats1 = { avgDocLength: 5, totalDocs: 100, docFreq: new Map([['hello', 1]]) };
    const stats2 = { avgDocLength: 5, totalDocs: 100, docFreq: new Map([['hello', 90]]) };
    const score1 = bm25Score(['hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats1);
    const score2 = bm25Score(['hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats2);
    assert.ok(score1 > score2, 'Rarer term should have higher IDF and score');
  });

  it('should handle multi-term queries', () => {
    const stats = { avgDocLength: 6, totalDocs: 10, docFreq: new Map([['hello', 3], ['world', 5]]) };
    const score = bm25Score(['hello', 'world'], ['hello', 'world', 'foo', 'bar', 'baz', 'qux'], stats);
    assert.ok(score > 0, 'Multi-term query should produce positive score');
  });

  it('should not double-count repeated query terms', () => {
    const stats = { avgDocLength: 5, totalDocs: 10, docFreq: new Map([['hello', 3]]) };
    const score1 = bm25Score(['hello', 'hello', 'hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats);
    const score2 = bm25Score(['hello'], ['hello', 'world', 'foo', 'bar', 'baz'], stats);
    assert.strictEqual(score1, score2, 'Repeated query terms should not double-count');
  });
});

// ---------------------------------------------------------------------------
// buildStats Tests
// ---------------------------------------------------------------------------

describe('buildStats', () => {
  it('should compute correct statistics', () => {
    const docs = [
      ['hello', 'world'],
      ['hello', 'foo'],
      ['bar', 'baz', 'qux'],
    ];
    const stats = buildStats(docs);
    assert.strictEqual(stats.totalDocs, 3);
    assert.strictEqual(stats.avgDocLength, 7 / 3);
    assert.strictEqual(stats.docFreq.get('hello'), 2);
    assert.strictEqual(stats.docFreq.get('world'), 1);
    assert.strictEqual(stats.docFreq.get('bar'), 1);
  });

  it('should handle empty input', () => {
    const stats = buildStats([]);
    assert.strictEqual(stats.totalDocs, 0);
    assert.strictEqual(stats.avgDocLength, 0);
  });
});

// ---------------------------------------------------------------------------
// rankResults Tests
// ---------------------------------------------------------------------------

describe('rankResults', () => {
  it('should sort results by BM25 score', () => {
    const results = [
      {
        file: 'a.js',
        relFile: 'a.js',
        matches: [
          { lineContent: 'function hello() {', contextBefore: [], contextAfter: ['  return "world";'] },
        ],
      },
      {
        file: 'b.js',
        relFile: 'b.js',
        matches: [
          { lineContent: 'const x = hello(world);', contextBefore: [], contextAfter: [] },
        ],
      },
    ];
    const ranked = rankResults(results, 'hello');
    assert.ok(ranked[0]._bm25Score >= ranked[1]._bm25Score);
  });

  it('should handle empty results', () => {
    const ranked = rankResults([], 'hello');
    assert.deepStrictEqual(ranked, []);
  });

  it('should handle empty query', () => {
    const results = [
      { file: 'a.js', relFile: 'a.js', matches: [{ lineContent: 'hello', contextBefore: [], contextAfter: [] }] },
    ];
    const ranked = rankResults(results, '');
    assert.deepStrictEqual(ranked, results);
  });
});

// ---------------------------------------------------------------------------
// applyRerankSignals Tests
// ---------------------------------------------------------------------------

describe('applyRerankSignals', () => {
  it('should boost definition lines', () => {
    const results = [
      {
        file: 'a.js',
        relFile: 'a.js',
        _bm25Score: 1.0,
        matches: [{ lineContent: 'function hello() {', contextBefore: [], contextAfter: [] }],
      },
    ];
    const ranked = applyRerankSignals(results, 'hello');
    assert.ok(ranked[0]._signals.definition > 0);
    assert.ok(ranked[0]._finalScore > 1.0);
  });

  it('should demote test files', () => {
    const results = [
      {
        file: 'a.test.js',
        relFile: 'a.test.js',
        _bm25Score: 1.0,
        matches: [{ lineContent: 'hello world', contextBefore: [], contextAfter: [] }],
      },
    ];
    const ranked = applyRerankSignals(results, 'hello');
    assert.ok(ranked[0]._signals.testDemotion < 0);
    assert.ok(ranked[0]._finalScore < 1.0);
  });

  it('should boost files with multiple matches', () => {
    const results = [
      {
        file: 'a.js',
        relFile: 'a.js',
        _bm25Score: 1.0,
        matches: [
          { lineContent: 'hello', contextBefore: [], contextAfter: [] },
          { lineContent: 'hello again', contextBefore: [], contextAfter: [] },
          { lineContent: 'hello third', contextBefore: [], contextAfter: [] },
        ],
      },
    ];
    const ranked = applyRerankSignals(results, 'hello');
    assert.ok(ranked[0]._signals.fileCoherence > 0);
    assert.ok(ranked[0]._finalScore > 1.0);
  });

  it('should boost path match', () => {
    const results = [
      {
        file: 'src/auth/login.js',
        relFile: 'src/auth/login.js',
        _bm25Score: 1.0,
        matches: [{ lineContent: 'function handle() {', contextBefore: [], contextAfter: [] }],
      },
    ];
    const ranked = applyRerankSignals(results, 'auth');
    assert.ok(ranked[0]._signals.pathMatch > 0);
  });

  it('should boost exact symbol name match', () => {
    const results = [
      {
        file: 'a.js',
        relFile: 'a.js',
        _bm25Score: 1.0,
        structure: [{ name: 'authenticate', line: 10, kind: 'definition' }],
        matches: [{ lineContent: 'function authenticate() {', contextBefore: [], contextAfter: [] }],
      },
    ];
    const ranked = applyRerankSignals(results, 'authenticate');
    assert.ok(ranked[0]._signals.symbolName > 0);
  });

  it('should handle empty results', () => {
    const ranked = applyRerankSignals([], 'hello');
    assert.deepStrictEqual(ranked, []);
  });

  it('should apply git recency when provided', () => {
    const recency = new Map([['src/new.js', 1]]);
    const results = [
      {
        file: 'src/new.js',
        relFile: 'src/new.js',
        _bm25Score: 1.0,
        matches: [{ lineContent: 'hello', contextBefore: [], contextAfter: [] }],
      },
    ];
    const ranked = applyRerankSignals(results, 'hello', { gitRecency: recency });
    assert.ok(ranked[0]._signals.gitRecency > 0);
  });
});