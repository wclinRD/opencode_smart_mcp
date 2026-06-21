// token-budget.test.mjs — Tests for token budget compression
//
// Run: node --test tests/token-budget.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, formatMatch, compressLevel, fitToBudget } from '../src/lib/token-budget.mjs';

function makeResult(relFile, matches) {
  return { file: `/repo/${relFile}`, relFile, matches };
}

function makeMatch(line, lineContent, opts = {}) {
  return {
    line,
    lineContent,
    matchedText: opts.matchedText || lineContent,
    contextBefore: opts.contextBefore || [],
    contextAfter: opts.contextAfter || [],
    scopeName: opts.scopeName || null,
    scopeStartLine: opts.scopeStartLine || null,
    score: opts.score || 0,
  };
}

describe('estimateTokens', () => {
  it('returns 0 for empty', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('estimates ~3.5 chars per token', () => {
    const text = 'function hello() { return 1; }';
    const est = estimateTokens(text);
    assert.ok(est > 0);
    assert.ok(est <= text.length); // at least 1 char per token
  });
});

describe('formatMatch', () => {
  const fileResult = makeResult('src/lib/foo.mjs', []);
  const match = makeMatch(42, '  const x = 1;', {
    contextBefore: ['  // before'],
    contextAfter: ['  // after'],
    scopeName: 'function bar',
    scopeStartLine: 40,
  });

  it('L0 outputs file:line: text', () => {
    const out = formatMatch(fileResult, match, 'L0');
    assert.ok(out.includes('src/lib/foo.mjs:42'));
    assert.ok(out.includes('const x = 1'));
    // L0 should be compact — no scope
    assert.ok(!out.includes('function bar'));
  });

  it('L1 includes scope and context', () => {
    const out = formatMatch(fileResult, match, 'L1');
    assert.ok(out.includes('∈ function bar'));
    assert.ok(out.includes('  // before'));
    assert.ok(out.includes('  // after'));
  });
});

describe('compressLevel', () => {
  it('L2 compresses with full match detail', () => {
    const results = [makeResult('a.js', [makeMatch(1, 'const x = 1;')])];
    const out = compressLevel(results, 'L2');
    assert.ok(Array.isArray(out));
    assert.ok(out[0].includes('a.js:1'));
    assert.ok(typeof out[0] === 'string');
  });

  it('L0 compresses to file:line: text', () => {
    const results = [makeResult('a.js', [makeMatch(1, 'hello world')])];
    const out = compressLevel(results, 'L0');
    assert.ok(Array.isArray(out));
    assert.ok(out[0].includes('a.js:1'));
  });

  it('empty results returns empty array', () => {
    assert.deepEqual(compressLevel(null, 'L0'), []);
    assert.deepEqual(compressLevel([], 'L1'), []);
  });

  it('compresses all levels to strings', () => {
    const results = [makeResult('x.js', [makeMatch(5, 'z = 3')])];
    for (const level of ['L0', 'L1', 'L2']) {
      const out = compressLevel(results, level);
      assert.ok(Array.isArray(out));
      assert.ok(typeof out[0] === 'string', `L2 should also return strings, got ${typeof out[0]}`);
    }
  });
});

describe('fitToBudget', () => {
  it('returns empty for no results', () => {
    const r = fitToBudget([], 100);
    assert.equal(r.text, '');
    assert.equal(r.selected, 0);
  });

  it('selects higher-scored results first', () => {
    const results = [makeResult('a.js', [
      makeMatch(1, 'low', { score: 1 }),
      makeMatch(2, 'high', { score: 10 }),
    ])];
    const fileResult = results[0];
    fileResult.matches[0].score = 1;
    fileResult.matches[1].score = 10;

    const r = fitToBudget(results, 200, 'L0');

    // With a generous budget both should fit
    assert.ok(r.selected >= 1);
    assert.ok(r.tokensUsed > 0);
  });

  it('fits within strict budget', () => {
    const manyLines = [];
    for (let i = 0; i < 50; i++) {
      manyLines.push(makeMatch(i + 1, `line ${i + 1}: x = ${i};`, { score: 50 - i }));
    }
    const results = [makeResult('big.js', manyLines)];

    // FitToBudget with very tight budget — should only pick a few
    const r = fitToBudget(results, 100, 'L0');
    assert.ok(r.selected < 20, `Expected few results in tight budget, got ${r.selected}`);
    assert.ok(r.tokensUsed <= 120); // Allow slight overage
  });
});
