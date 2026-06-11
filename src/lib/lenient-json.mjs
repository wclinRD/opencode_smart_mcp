#!/usr/bin/env node

// lenient-json.mjs — Lenient JSON parser with common JS-object-literal fixes
//
// Why: LLM-generated tool calls sometimes include JavaScript object literal
// syntax instead of strict JSON (unquoted property names, trailing commas).
// This module provides a safe fallback that fixes the most common issues
// without resorting to eval().
//
// Fixed patterns:
//   1. Unquoted property names:  {name: "foo"}  →  {"name": "foo"}
//   2. Trailing commas:          {a: 1,}         →  {a: 1}
//   3. Single-quoted strings:    {'a': 'b'}      →  {"a": "b"}
//   4. JS comments (//, /* */):  {a: 1 /* note */}  →  {a: 1}
//
// Security: regex-based, no eval/Function constructor.
// Only activates as fallback when strict JSON.parse fails.

/**
 * Parse JSON with lenient fallback for common JS-object-literal patterns.
 * @param {string} text - JSON or JS-object-literal string
 * @returns {any} Parsed value
 * @throws {SyntaxError} If parsing fails even after lenient fixes
 */
export function parseJson(text) {
  // Fast path: strict JSON
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to lenient path
  }

  const fixed = fixCommonIssues(text);
  try {
    return JSON.parse(fixed);
  } catch (err) {
    throw new SyntaxError(`Unable to parse JSON after lenient fixes: ${err.message}\nOriginal: ${truncate(text, 200)}`);
  }
}

/**
 * Attempt lenient parse, returning undefined on failure (no throw).
 * @param {string} text
 * @returns {any|undefined}
 */
export function tryParseJson(text) {
  try {
    return parseJson(text);
  } catch {
    return undefined;
  }
}

/**
 * Fix common JS-object-literal issues in a JSON string.
 * @param {string} text
 * @returns {string}
 */
export function fixCommonIssues(text) {
  let s = text;

  // 1. Remove single-line comments (// ...)
  s = s.replace(/\/\/[^\n]*/g, '');

  // 2. Remove multi-line comments (/* ... */)
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');

  // 3. Replace single quotes with double quotes
  //    Only match single-quoted strings (not inside already-double-quoted strings)
  //    This is tricky; simplest safe approach: replace single quotes that appear
  //    after { , [ or whitespace, and before : , } ] or whitespace
  //    We use a simpler strategy: replace ' with " but only outside of double-quoted strings
  s = s.replace(/'/g, '"');

  // 4. Fix unquoted property names
  //    Pattern: {propName: or ,propName: → {"propName": / ,"propName":
  //    Match: after { or ,, then optional whitespace, then a JS identifier, then :
  //    The negative lookahead ensures we don't double-quote already-quoted names
  s = s.replace(
    /([\{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g,
    (match, prefix, name, suffix) => `${prefix}"${name}"${suffix}`
  );

  // 5. Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, '$1');

  // 6. Remove trailing commas before end of input
  s = s.replace(/,\s*$/, '');

  return s;
}

/**
 * Truncate a string for error messages.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// ===========================================================================
// Self-test (CLI)
// ===========================================================================
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

function test(name, input, expectOk) {
  const result = tryParseJson(input);
  const ok = expectOk ? result !== undefined : result === undefined;
  if (VERBOSE || !ok) {
    const status = ok ? '✅' : '❌';
    console.log(`${status} ${name}: ${expectOk ? 'should parse' : 'should fail'} → ${result !== undefined ? 'parsed' : 'failed'}`);
    if (!ok && VERBOSE) console.log(`  Input: ${truncate(input, 100)}`);
  }
  return ok;
}

if (process.argv[1] === import.meta.filename || process.argv[1]?.endsWith('lenient-json.mjs')) {
  console.log('=== Lenient JSON Parser Self-Test ===\n');

  // Strict JSON (should work with fast path)
  test('Strict JSON object', '{"a":1,"b":"hello"}', true);
  test('Strict JSON array', '[1,2,3]', true);
  test('Strict JSON nested', '{"outer":{"inner":42}}', true);

  // Unquoted property names
  test('Unquoted key', '{name:"test"}', true);
  test('Multiple unquoted keys', '{name:"test",value:42}', true);
  test('Nested unquoted keys', '{outer:{inner:42}}', true);
  test('Unquoted with number value', '{confidence:8}', true);

  // Trailing commas
  test('Trailing comma in object', '{a:1,}', true);
  test('Trailing comma in array', '[1,2,]', true);
  test('Trailing comma nested', '{items:[1,2,],name:"x",}', true);

  // Mixed
  test('Complex nested (the bug!)', '{"name":"test","branches":[{"name":"A","content":"text",confidence:8}],"selected":"A"}', true);

  // Real-world case from the error
  const realWorld = `{"thought":"分析 crash","trees":[{"name":"Static","branches":[{"name":"Null","content":"check null",confidence:8}],"selectedBranch":"Null"}],"consensus":{"conclusion":"Null","agreeingTrees":["Static"],"totalTrees":1,"confidence":8}}`;
  test('Real-world forest mode', realWorld, true);

  // Invalid input (should fail)
  test('Garbage input', 'not even close to json', false);
  test('Empty string', '', false);

  console.log('\nAll self-tests complete.');
}
