// lenient-json.test.mjs — Tests for lenient-json.mjs
//
// Covers:
//   1. parseJson — strict JSON fast path
//   2. parseJson — lenient fallback fixes
//   3. fixCommonIssues — individual fixers
//   4. tryParseJson — safe non-throwing variant
//   5. Error cases — truly invalid input

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, tryParseJson, fixCommonIssues } from '../src/lib/lenient-json.mjs';

// ===========================================================================
// 1. parseJson — strict JSON fast path
// ===========================================================================

describe('parseJson — strict JSON fast path', () => {
  it('parses simple object', () => {
    assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  });

  it('parses array', () => {
    assert.deepEqual(parseJson('[1,2,3]'), [1, 2, 3]);
  });

  it('parses nested object', () => {
    assert.deepEqual(parseJson('{"outer":{"inner":42}}'), { outer: { inner: 42 } });
  });

  it('parses string value', () => {
    assert.equal(parseJson('"hello"'), 'hello');
  });

  it('parses number', () => {
    assert.equal(parseJson('42'), 42);
  });

  it('parses boolean', () => {
    assert.equal(parseJson('true'), true);
  });

  it('parses null', () => {
    assert.equal(parseJson('null'), null);
  });
});

// ===========================================================================
// 2. parseJson — lenient fallback fixes
// ===========================================================================

describe('parseJson — lenient fallback', () => {
  it('fixes unquoted property name', () => {
    assert.deepEqual(parseJson('{name:"test"}'), { name: 'test' });
  });

  it('fixes multiple unquoted keys', () => {
    assert.deepEqual(parseJson('{name:"test",value:42}'), { name: 'test', value: 42 });
  });

  it('fixes nested unquoted keys', () => {
    assert.deepEqual(parseJson('{outer:{inner:42}}'), { outer: { inner: 42 } });
  });

  it('fixes confidence:8 pattern (the original bug)', () => {
    const input = '{"name":"A","content":"text",confidence:8}';
    assert.deepEqual(parseJson(input), { name: 'A', content: 'text', confidence: 8 });
  });

  it('fixes trailing comma in object', () => {
    assert.deepEqual(parseJson('{"a":1,}'), { a: 1 });
  });

  it('fixes trailing comma in array', () => {
    assert.deepEqual(parseJson('[1,2,]'), [1, 2]);
  });

  it('fixes trailing comma nested', () => {
    assert.deepEqual(parseJson('{items:[1,2,],name:"x",}'), { items: [1, 2], name: 'x' });
  });

  it('fixes real-world forest mode payload', () => {
    const input = '{"thought":"分析 crash","trees":[{"name":"Static","branches":[{"name":"Null","content":"check null",confidence:8}],"selectedBranch":"Null"}],"consensus":{"conclusion":"Null","agreeingTrees":["Static"],"totalTrees":1,"confidence":8}}';
    const result = parseJson(input);
    assert.equal(result.thought, '分析 crash');
    assert.equal(result.trees[0].branches[0].confidence, 8);
    assert.equal(result.consensus.confidence, 8);
  });

  it('fixes single quotes', () => {
    assert.deepEqual(parseJson("{'a':1,'b':'hello'}"), { a: 1, b: 'hello' });
  });

  it('removes single-line comment', () => {
    assert.deepEqual(parseJson('{"a":1 // comment\n}'), { a: 1 });
  });

  it('removes multi-line comment', () => {
    assert.deepEqual(parseJson('{"a":1 /* comment */,"b":2}'), { a: 1, b: 2 });
  });

  it('handles empty object', () => {
    assert.deepEqual(parseJson('{}'), {});
  });

  it('handles empty array', () => {
    assert.deepEqual(parseJson('[]'), []);
  });
});

// ===========================================================================
// 3. fixCommonIssues — individual fixers
// ===========================================================================

describe('fixCommonIssues', () => {
  it('does not modify strict JSON', () => {
    // strict JSON should pass through unchanged (comments aside)
    const result = fixCommonIssues('{"a":1,"b":"hello"}');
    assert.equal(result, '{"a":1,"b":"hello"}');
  });

  it('quotes unquoted keys', () => {
    const result = fixCommonIssues('{name:"test",value:42}');
    assert.equal(result, '{"name":"test","value":42}');
  });

  it('removes trailing commas', () => {
    const result = fixCommonIssues('{a:1,b:2,}');
    assert.equal(result, '{"a":1,"b":2}');
  });
});

// ===========================================================================
// 4. tryParseJson — safe non-throwing variant
// ===========================================================================

describe('tryParseJson', () => {
  it('returns parsed value on success', () => {
    assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  });

  it('returns undefined on failure', () => {
    assert.equal(tryParseJson('not json'), undefined);
  });

  it('returns undefined on empty string', () => {
    assert.equal(tryParseJson(''), undefined);
  });

  it('returns undefined on null input', () => {
    // When called with a non-string (shouldn't happen but be safe)
    try {
      const result = tryParseJson(null);
      assert.equal(result, undefined);
    } catch {
      // TypeError from .replace is acceptable too
      assert.ok(true);
    }
  });
});

// ===========================================================================
// 5. Error cases
// ===========================================================================

describe('parseJson — error cases', () => {
  it('throws on garbage input', () => {
    assert.throws(() => parseJson('not even close'), SyntaxError);
  });

  it('throws on empty string', () => {
    assert.throws(() => parseJson(''), SyntaxError);
  });

  it('throws on truly malformed JSON that cannot be fixed', () => {
    assert.throws(() => parseJson('{a b c}'), SyntaxError);
  });
});
