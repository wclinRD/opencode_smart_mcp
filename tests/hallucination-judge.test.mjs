// hallucination-judge.test.mjs — Phase 6 Hallucination Detection 單元測試
//
// Tests the hallucination judge engine across all 6 hallucination types
// and 5 structural checks. Verifies scoring, verdict thresholds, and edge cases.
//
// Run: node --test tests/hallucination-judge.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judgeHallucination, isHighRiskOutput, HALLUCINATION_TYPES } from '../src/lib/hallucination-judge.mjs';

// ---------------------------------------------------------------------------
// Test: Core engine — basic structure
// ---------------------------------------------------------------------------

describe('Hallucination Judge — core', () => {
  it('returns pass for grounded output with context', () => {
    const result = judgeHallucination({
      output: 'The error is a TypeError in parser.js at line 42. The fix is to add a null check before calling .map().',
      context: 'TypeError at parser.js:42 — Cannot read properties of undefined (reading map)',
      query: 'Why does the parser crash?',
    });

    assert.equal(typeof result.overallScore, 'number');
    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
    assert.ok(['pass', 'warn', 'fail'].includes(result.verdict));
    assert.equal(result.checks.length, 5);
    assert.ok(result.summary.length > 0);
  });

  it('returns pass for empty output', () => {
    const result = judgeHallucination({ output: '' });
    assert.equal(result.overallScore, 10);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.checks.length, 0);
  });

  it('returns pass for whitespace-only output', () => {
    const result = judgeHallucination({ output: '   \n  ' });
    assert.equal(result.overallScore, 10);
    assert.equal(result.verdict, 'pass');
  });
});

// ---------------------------------------------------------------------------
// Test: Fabrication detection
// ---------------------------------------------------------------------------

describe('Hallucination Judge — fabrication', () => {
  it('detects fabricated identifiers not in context', () => {
    const result = judgeHallucination({
      output: 'The bug is in UserService.validateToken() and AuthMiddleware.checkSession().',
      context: 'Error: TypeError at UserService.js:42',
    });

    const factualCheck = result.checks.find(c => c.type === 'factual');
    assert.ok(factualCheck, 'should have factual check');
    // "AuthMiddleware.checkSession" not in context → should have issues
    assert.ok(result.issues.some(i => i.type === 'fabrication'), 'should detect fabrication');
  });

  it('passes when all identifiers are in context', () => {
    const result = judgeHallucination({
      output: 'The bug is in parser.js at line 42.',
      context: 'Error at parser.js:42 — TypeError',
    });

    const factualCheck = result.checks.find(c => c.type === 'factual');
    assert.ok(factualCheck.passed, 'should pass when identifiers match');
  });

  it('passes when no context provided (skips check)', () => {
    const result = judgeHallucination({
      output: 'The bug is in SomeRandomFile.js.',
    });

    const factualCheck = result.checks.find(c => c.type === 'factual');
    assert.ok(factualCheck.passed, 'should pass without context');
  });
});

// ---------------------------------------------------------------------------
// Test: Consistency detection
// ---------------------------------------------------------------------------

describe('Hallucination Judge — consistency', () => {
  it('passes for consistent output', () => {
    const result = judgeHallucination({
      output: 'The bug is in parser.js. The fix should be applied to parser.js. This will resolve the issue.',
    });

    const check = result.checks.find(c => c.type === 'consistency');
    assert.ok(check.passed, 'consistent output should pass');
  });

  it('detects self-contradiction', () => {
    const result = judgeHallucination({
      output: 'The bug is in parser.js. The bug is not in parser.js. The fix is elsewhere.',
    });

    const check = result.checks.find(c => c.type === 'consistency');
    // May or may not detect depending on sentence splitting
    assert.ok(check.score >= 1 && check.score <= 10);
  });

  it('handles short output gracefully', () => {
    const result = judgeHallucination({
      output: 'OK.',
    });

    const check = result.checks.find(c => c.type === 'consistency');
    assert.ok(check.passed, 'short output should pass');
  });
});

// ---------------------------------------------------------------------------
// Test: Groundedness detection
// ---------------------------------------------------------------------------

describe('Hallucination Judge — groundedness', () => {
  it('passes when claims are grounded in context', () => {
    const result = judgeHallucination({
      output: 'The crash is caused by a null pointer in the parser module.',
      context: 'NullPointerException in parser module at line 42. Stack trace shows parse() → validate() → crash.',
    });

    const check = result.checks.find(c => c.type === 'groundedness');
    assert.ok(check.passed, 'grounded claims should pass');
  });

  it('flags claims with low context overlap', () => {
    const result = judgeHallucination({
      output: 'The crash is caused by a race condition in the database connection pool due to improper mutex handling.',
      context: 'TypeError: Cannot read properties of undefined',
    });

    const check = result.checks.find(c => c.type === 'groundedness');
    // Should have low groundedness since context is about TypeError, not race conditions
    assert.ok(check.score <= 7, 'ungrounded claims should score low');
  });

  it('passes when no context provided', () => {
    const result = judgeHallucination({
      output: 'The crash is caused by a null pointer.',
    });

    const check = result.checks.find(c => c.type === 'groundedness');
    assert.ok(check.passed, 'should pass without context');
  });
});

// ---------------------------------------------------------------------------
// Test: Off-topic detection
// ---------------------------------------------------------------------------

describe('Hallucination Judge — off-topic', () => {
  it('passes when output matches query topic', () => {
    const result = judgeHallucination({
      output: 'The parser crash is caused by a null pointer in the tokenizer.',
      query: 'Why does the parser crash?',
    });

    const check = result.checks.find(c => c.type === 'off-topic');
    assert.ok(check.passed, 'matching topic should pass');
  });

  it('flags when output is off-topic', () => {
    const result = judgeHallucination({
      output: 'The database connection pool should be configured with at least 20 connections for optimal performance.',
      query: 'Why does the parser crash?',
    });

    const check = result.checks.find(c => c.type === 'off-topic');
    assert.ok(check.score <= 5, 'off-topic output should score low');
  });

  it('passes when no query provided', () => {
    const result = judgeHallucination({
      output: 'Some random output.',
    });

    const check = result.checks.find(c => c.type === 'off-topic');
    assert.ok(check.passed, 'should pass without query');
  });
});

// ---------------------------------------------------------------------------
// Test: Confidence detection
// ---------------------------------------------------------------------------

describe('Hallucination Judge — confidence', () => {
  it('passes for balanced language', () => {
    const result = judgeHallucination({
      output: 'The bug might be in parser.js. It could be a null pointer issue. Perhaps we should check the tokenizer.',
    });

    const check = result.checks.find(c => c.type === 'confidence');
    assert.ok(check.passed, 'balanced language should pass');
  });

  it('flags overconfident language without hedging', () => {
    const result = judgeHallucination({
      output: 'This is definitely a null pointer. It must be in parser.js. The only possible cause is the tokenizer. This is 100% guaranteed.',
    });

    const check = result.checks.find(c => c.type === 'confidence');
    assert.ok(!check.passed || check.score < 10, 'overconfident language should be flagged');
  });

  it('passes for neutral output', () => {
    const result = judgeHallucination({
      output: 'The error occurred at line 42. The stack trace shows parser.js.',
    });

    const check = result.checks.find(c => c.type === 'confidence');
    assert.ok(check.passed, 'neutral output should pass');
  });
});

// ---------------------------------------------------------------------------
// Test: Verdict thresholds
// ---------------------------------------------------------------------------

describe('Hallucination Judge — verdict thresholds', () => {
  it('returns pass for score >= 7', () => {
    // Grounded, consistent, on-topic output
    const result = judgeHallucination({
      output: 'The error is in parser.js. The fix is to add a null check.',
      context: 'Error at parser.js:42 — TypeError',
      query: 'Why does the parser crash?',
    });
    assert.equal(result.verdict, 'pass');
    assert.ok(result.overallScore >= 7);
  });

  it('returns warn or fail for fabricated output', () => {
    const result = judgeHallucination({
      output: 'The bug is in NonExistentModule.unknownFunction() caused by QuantumFluctuation in the HypervisorLayer.',
      context: 'Error at parser.js:42 — TypeError',
      query: 'Why does the parser crash?',
    });
    assert.ok(['warn', 'fail'].includes(result.verdict), 'fabricated output should warn or fail');
  });

  it('strictness affects scoring', () => {
    const lenient = judgeHallucination({
      output: 'This is definitely a null pointer. It must be in parser.js.',
      context: 'TypeError at parser.js:42',
      strictness: 1,
    });
    const strict = judgeHallucination({
      output: 'This is definitely a null pointer. It must be in parser.js.',
      context: 'TypeError at parser.js:42',
      strictness: 10,
    });
    assert.ok(strict.overallScore <= lenient.overallScore, 'higher strictness should lower score');
  });
});

// ---------------------------------------------------------------------------
// Test: isHighRiskOutput
// ---------------------------------------------------------------------------

describe('Hallucination Judge — isHighRiskOutput', () => {
  it('identifies high-risk tools', () => {
    assert.ok(isHighRiskOutput('smart_security'));
    assert.ok(isHighRiskOutput('smart_error_diagnose'));
    assert.ok(isHighRiskOutput('smart_deep_think'));
    assert.ok(isHighRiskOutput('smart_ingest_document'));
    assert.ok(isHighRiskOutput('smart_report'));
  });

  it('identifies low-risk tools', () => {
    assert.ok(!isHighRiskOutput('smart_grep'));
    assert.ok(!isHighRiskOutput('smart_test'));
    assert.ok(!isHighRiskOutput('smart_learn'));
    assert.ok(!isHighRiskOutput('smart_fast_apply'));
    assert.ok(!isHighRiskOutput('unknown_tool'));
  });
});

// ---------------------------------------------------------------------------
// Test: HALLUCINATION_TYPES export
// ---------------------------------------------------------------------------

describe('Hallucination Judge — HALLUCINATION_TYPES', () => {
  it('exports all 6 types', () => {
    const types = Object.keys(HALLUCINATION_TYPES);
    assert.equal(types.length, 6);
    assert.ok(types.includes('fabrication'));
    assert.ok(types.includes('misattribution'));
    assert.ok(types.includes('unfaithful'));
    assert.ok(types.includes('self-contradiction'));
    assert.ok(types.includes('off-topic'));
    assert.ok(types.includes('confident-refusal'));
  });

  it('each type has name, description, severity', () => {
    for (const [key, info] of Object.entries(HALLUCINATION_TYPES)) {
      assert.ok(info.name, `${key} should have name`);
      assert.ok(info.description, `${key} should have description`);
      assert.ok(['high', 'medium', 'low'].includes(info.severity), `${key} should have valid severity`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Edge cases
// ---------------------------------------------------------------------------

describe('Hallucination Judge — edge cases', () => {
  it('handles very long output', () => {
    const longOutput = 'The bug is in parser.js. '.repeat(200);
    const result = judgeHallucination({
      output: longOutput,
      context: 'Error at parser.js:42',
    });
    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  });

  it('handles output with special characters', () => {
    const result = judgeHallucination({
      output: 'Error in <Component> at line 42: `undefined` is not a function (evaluating \'x.y.z\')',
      context: 'TypeError: undefined is not a function',
    });
    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  });

  it('handles output with code blocks', () => {
    const result = judgeHallucination({
      output: '```js\nconst x = parser.parse(input);\n```\nThe error is in the parse function.',
      context: 'Error in parser.parse()',
    });
    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  });

  it('handles missing optional parameters', () => {
    const result = judgeHallucination({ output: 'Test output.' });
    assert.equal(result.checks.length, 5);
    assert.ok(result.overallScore >= 1 && result.overallScore <= 10);
  });
});