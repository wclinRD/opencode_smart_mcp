// safe-handler.test.mjs — Tests for plugin handler safety wrapper
//
// Covers: wrapHandler, isStructuredError
//
// Run: node --test tests/safe-handler.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { wrapHandler, isStructuredError } from '../src/lib/safe-handler.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wrapHandler', () => {

  it('returns non-function as-is', () => {
    assert.equal(wrapHandler(null, 'test'), null);
    assert.equal(wrapHandler(undefined, 'test'), undefined);
  });

  it('passes through successful handler result', async () => {
    const handler = wrapHandler(async () => 'success', 'testTool');
    const result = await handler({});
    assert.equal(result, 'success');
  });

  it('wraps thrown errors in structured format', async () => {
    const handler = wrapHandler(async () => { throw new Error('something broke'); }, 'testTool');
    const result = await handler({});
    assert.equal(typeof result, 'string');
    assert.ok(result.startsWith('{'), 'should be JSON string');
    const parsed = JSON.parse(result);
    assert.equal(parsed.error, 'something broke');
    assert.equal(parsed.tool, 'testTool');
    assert.equal(typeof parsed.retryable, 'boolean');
    assert.ok(parsed.suggested_action);
  });

  it('wraps error-looking string returns', async () => {
    const handler = wrapHandler(async () => 'Error: something went wrong', 'testTool');
    const result = await handler({});
    assert.ok(result.startsWith('{'));
    const parsed = JSON.parse(result);
    assert.equal(parsed.error, 'something went wrong');
  });

  it('wraps ❌ Error prefixed strings', async () => {
    const handler = wrapHandler(async () => '❌ Error: bad input', 'testTool');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.ok(parsed.error.includes('bad input'), `expected 'bad input' in error, got: ${parsed.error}`);
  });

  it('does NOT wrap normal strings that look like errors but are not', async () => {
    const handler = wrapHandler(async () => 'This is a normal response', 'testTool');
    const result = await handler({});
    assert.equal(result, 'This is a normal response');
  });

  it('passes args to the handler', async () => {
    const handler = wrapHandler(async (args) => `got: ${args.key}`, 'testTool');
    const result = await handler({ key: 'value' });
    assert.equal(result, 'got: value');
  });
});

describe('isStructuredError', () => {

  it('returns true for structured error JSON', () => {
    const err = JSON.stringify({ error: 'msg', retryable: false, suggested_action: 'try again', tool: 'x' });
    assert.equal(isStructuredError(err), true);
  });

  it('returns false for non-string', () => {
    assert.equal(isStructuredError(null), false);
    assert.equal(isStructuredError(123), false);
    assert.equal(isStructuredError({}), false);
  });

  it('returns false for non-JSON string', () => {
    assert.equal(isStructuredError('plain text'), false);
  });

  it('returns false for JSON without required fields', () => {
    assert.equal(isStructuredError('{"error":"msg"}'), false);
    assert.equal(isStructuredError('{"retryable":true}'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isStructuredError(''), false);
  });
});

describe('retryable detection', () => {

  it('timeout errors are retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('Connection timed out'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, true);
  });

  it('network errors are retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('ECONNREFUSED'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, true);
  });

  it('not found errors are NOT retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('File not found'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, false);
  });

  it('permission denied is NOT retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('Permission denied'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, false);
  });

  it('invalid input is NOT retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('Invalid parameter'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, false);
  });

  it('unknown errors default to non-retryable', async () => {
    const handler = wrapHandler(async () => { throw new Error('Something weird happened'); }, 'test');
    const result = await handler({});
    const parsed = JSON.parse(result);
    assert.equal(parsed.retryable, false);
  });
});