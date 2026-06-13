// query-detector.test.mjs — Tests for query type detection
//
// Run: node --test tests/query-detector.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectQueryType, getQueryWeights } from '../src/lib/query-detector.mjs';

// ---------------------------------------------------------------------------
// Symbol Detection Tests
// ---------------------------------------------------------------------------

describe('detectQueryType — symbol', () => {
  it('should detect camelCase as symbol', () => {
    const result = detectQueryType('parseRequest');
    assert.strictEqual(result.type, 'symbol');
    assert.ok(result.confidence >= 0.7);
  });

  it('should detect PascalCase as symbol', () => {
    const result = detectQueryType('AuthManager');
    assert.strictEqual(result.type, 'symbol');
    assert.ok(result.confidence >= 0.7);
  });

  it('should detect snake_case as symbol', () => {
    const result = detectQueryType('parse_request');
    assert.strictEqual(result.type, 'symbol');
    assert.ok(result.confidence >= 0.64);
  });

  it('should detect UPPER_SNAKE_CASE as symbol', () => {
    const result = detectQueryType('MAX_RETRY_COUNT');
    assert.strictEqual(result.type, 'symbol');
  });

  it('should detect kebab-case as symbol', () => {
    const result = detectQueryType('parse-request');
    assert.strictEqual(result.type, 'symbol');
  });

  it('should detect single word as symbol', () => {
    const result = detectQueryType('authenticate');
    assert.strictEqual(result.type, 'symbol');
  });

  it('should detect function call pattern as symbol', () => {
    const result = detectQueryType('authenticate()');
    assert.strictEqual(result.type, 'symbol');
  });

  it('should detect method chain as symbol', () => {
    const result = detectQueryType('user.authenticate');
    assert.strictEqual(result.type, 'symbol');
  });
});

// ---------------------------------------------------------------------------
// Natural Language Detection Tests
// ---------------------------------------------------------------------------

describe('detectQueryType — natural_language', () => {
  it('should detect multi-word query as NL', () => {
    const result = detectQueryType('find the authentication handler');
    assert.strictEqual(result.type, 'natural_language');
  });

  it('should detect question as NL', () => {
    const result = detectQueryType('where is the auth handler?');
    assert.strictEqual(result.type, 'natural_language');
  });

  it('should detect query with stop words as NL', () => {
    const result = detectQueryType('how to parse the request');
    assert.strictEqual(result.type, 'natural_language');
  });

  it('should detect long query as NL', () => {
    const result = detectQueryType('find all functions that handle user authentication and authorization');
    assert.strictEqual(result.type, 'natural_language');
  });

  it('should detect "find" query as NL', () => {
    const result = detectQueryType('find authentication code');
    assert.strictEqual(result.type, 'natural_language');
  });
});

// ---------------------------------------------------------------------------
// Path Detection Tests
// ---------------------------------------------------------------------------

describe('detectQueryType — path', () => {
  it('should detect path with slash as path', () => {
    const result = detectQueryType('src/auth/login.js');
    assert.strictEqual(result.type, 'path');
  });

  it('should detect relative path as path', () => {
    const result = detectQueryType('./src/auth');
    assert.strictEqual(result.type, 'path');
  });

  it('should detect file extension as path', () => {
    const result = detectQueryType('config.json');
    assert.strictEqual(result.type, 'path');
  });

  it('should detect glob pattern as path', () => {
    const result = detectQueryType('src/**/*.ts');
    assert.strictEqual(result.type, 'path');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('detectQueryType — edge cases', () => {
  it('should handle empty string', () => {
    const result = detectQueryType('');
    assert.strictEqual(result.type, 'natural_language');
    assert.strictEqual(result.confidence, 0.5);
  });

  it('should handle null', () => {
    const result = detectQueryType(null);
    assert.strictEqual(result.type, 'natural_language');
  });

  it('should handle regex pattern as symbol (not NL)', () => {
    // Backslash-escaped sequences (\\s, \\w) are strong symbol signals
    const result = detectQueryType('function\\s+\\w+');
    assert.strictEqual(result.type, 'symbol');
  });
});

// ---------------------------------------------------------------------------
// getQueryWeights Tests
// ---------------------------------------------------------------------------

describe('getQueryWeights', () => {
  it('should return BM25-heavy weights for symbol', () => {
    const weights = getQueryWeights('symbol');
    assert.ok(weights.bm25Weight > weights.semanticWeight);
    assert.strictEqual(weights.bm25Weight, 0.7);
    assert.strictEqual(weights.semanticWeight, 0.3);
  });

  it('should return semantic-heavy weights for NL', () => {
    const weights = getQueryWeights('natural_language');
    assert.ok(weights.semanticWeight > weights.bm25Weight);
    assert.strictEqual(weights.bm25Weight, 0.3);
    assert.strictEqual(weights.semanticWeight, 0.7);
  });

  it('should return BM25-heavy weights for path', () => {
    const weights = getQueryWeights('path');
    assert.ok(weights.bm25Weight > weights.semanticWeight);
    assert.strictEqual(weights.bm25Weight, 0.8);
  });

  it('should return balanced weights for unknown type', () => {
    const weights = getQueryWeights('unknown');
    assert.strictEqual(weights.bm25Weight, 0.5);
    assert.strictEqual(weights.semanticWeight, 0.5);
  });
});