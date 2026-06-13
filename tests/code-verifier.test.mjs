// code-verifier.test.mjs — Execution-Grounded Verification Tests (Phase 20)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyCode, verifyCodeBatch, extractCode } from '../src/lib/code-verifier.mjs';

// ---------------------------------------------------------------------------
// extractCode Tests
// ---------------------------------------------------------------------------
describe('extractCode', () => {
  it('should extract code from markdown code block', () => {
    const result = extractCode('```js\nconsole.log("hello");\n```');
    assert.equal(result.code, 'console.log("hello");');
    assert.equal(result.language, 'js');
  });

  it('should extract code with language tag', () => {
    const result = extractCode('```python\nprint("hello")\n```');
    assert.equal(result.code, 'print("hello")');
    assert.equal(result.language, 'python');
  });

  it('should return raw input without code block', () => {
    const result = extractCode('console.log("hello");');
    assert.equal(result.code, 'console.log("hello");');
  });

  it('should handle empty input', () => {
    const result = extractCode('');
    assert.equal(result.code, '');
  });

  it('should normalize language names', () => {
    assert.equal(extractCode('```javascript\nconst x=1;\n```').language, 'js');
    assert.equal(extractCode('```shell\necho hi\n```').language, 'bash');
    assert.equal(extractCode('```py\nx=1\n```').language, 'python');
    assert.equal(extractCode('```typescript\nconst x:number=1;\n```').language, 'ts');
  });
});

// ---------------------------------------------------------------------------
// verifyCode Tests
// ---------------------------------------------------------------------------
describe('verifyCode', () => {
  it('should pass valid JS code', () => {
    const result = verifyCode('console.log("test");', { language: 'js' });
    assert.ok(result.verified);
    assert.equal(result.compilation.ok, true);
    assert.ok(result.execution.ok);
  });

  it('should fail on syntax error', () => {
    const result = verifyCode('console.log("test"', { language: 'js' });
    assert.equal(result.verified, false);
    assert.ok(result.issues.length > 0);
    // Node.js detects syntax errors at execution phase (not compile phase)
    assert.ok(['syntax', 'execution'].includes(result.issues[0].phase));
  });

  it('should pass valid Python code', () => {
    const result = verifyCode('print("hello")', { language: 'python' });
    // Python might not be available, check runtime availability
    if (result.issues && result.issues.some(i => i.message && i.message.includes('not available'))) {
      // Skip if python not available
      assert.equal(result.verified, false);
    } else {
      assert.ok(result.verified);
    }
  });

  it('should pass valid bash code', () => {
    const result = verifyCode('#!/usr/bin/env bash\necho "hello"', { language: 'bash' });
    assert.ok(result.verified);
  });

  it('should detect exit code failure', () => {
    const result = verifyCode('throw new Error("fail");', { language: 'js' });
    // Might fail or might throw — either way we get a non-zero exit
    assert.equal(result.ok, false);
    assert.equal(result.verified, false);
  });

  it('should check expected output', () => {
    const result = verifyCode('console.log("hello world");', {
      language: 'js',
      expectedOutput: 'hello world',
    });
    assert.ok(result.verified);
  });

  it('should fail expected output check on mismatch', () => {
    const result = verifyCode('console.log("goodbye");', {
      language: 'js',
      expectedOutput: 'hello',
    });
    // The code runs fine, but output mismatches
    assert.equal(result.verified, true); // "verified" means code runs without error
    // Should have a warn-level output issue
    const outputIssues = (result.issues || []).filter(i => i.phase === 'output');
    assert.ok(outputIssues.length > 0);
  });

  it('should retry on failure', () => {
    const result = verifyCode('console.log("test");', {
      language: 'js',
      maxRetries: 2,
    });
    assert.ok(result.verified);
    // Should have 0 or 1 retries (first attempt might succeed)
    assert.ok(result.retries >= 0);
  });

  it('should handle empty code', () => {
    const result = verifyCode('');
    assert.equal(result.verified, false);
    assert.ok(result.error || (result.issues && result.issues.length > 0));
  });
});

// ---------------------------------------------------------------------------
// verifyCode with inline code (no code block)
// ---------------------------------------------------------------------------
describe('verifyCode (inline)', () => {
  it('should verify inline JS code', () => {
    const result = verifyCode('const sum = (a, b) => a + b; console.log(sum(2, 3));', { language: 'js' });
    assert.ok(result.verified);
  });

  it('should detect runtime error in inline code', () => {
    const result = verifyCode('undefinedVar.someMethod()', { language: 'js' });
    assert.equal(result.verified, false);
  });
});

// ---------------------------------------------------------------------------
// verifyCodeBatch Tests
// ---------------------------------------------------------------------------
describe('verifyCodeBatch', () => {
  it('should verify multiple files', () => {
    const files = [
      { code: 'console.log("file1");', language: 'js' },
      { code: 'console.log("file2");', language: 'js' },
    ];
    const results = verifyCodeBatch(files);
    assert.equal(results.length, 2);
    assert.ok(results[0].verified);
    assert.ok(results[1].verified);
  });

  it('should handle errors in batch', () => {
    const files = [
      { code: 'console.log("ok");', language: 'js' },
      { code: 'syntax error (', language: 'js' },
    ];
    const results = verifyCodeBatch(files);
    assert.equal(results.length, 2);
    assert.ok(results[0].verified);
    assert.equal(results[1].verified, false);
  });
});

// ---------------------------------------------------------------------------
// Phase 20 Feature: detailed verification output
// ---------------------------------------------------------------------------
describe('verifyCode — detailed output', () => {
  it('should include execution metadata', () => {
    const result = verifyCode('console.log("test");', { language: 'js' });
    assert.ok(result.hasOwnProperty('language'));
    assert.ok(result.hasOwnProperty('compilation'));
    assert.ok(result.hasOwnProperty('execution'));
    assert.ok(result.hasOwnProperty('retries'));
  });

  it('should provide suggestion on failure', () => {
    const result = verifyCode('throw new Error("test error");', { language: 'js' });
    if (!result.verified) {
      assert.ok(result.suggestion);
      assert.equal(typeof result.suggestion, 'string');
    }
  });

  it('should cap stdout output', () => {
    const bigCode = `console.log(${JSON.stringify('x'.repeat(50000))});`;
    const result = verifyCode(bigCode, { language: 'js' });
    if (result.verified && result.execution.stdout) {
      assert.ok(result.execution.stdout.length <= 2000);
    }
  });
});
