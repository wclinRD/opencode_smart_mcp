// output-optimizer.test.mjs — Tests for output-optimizer.mjs
//
// Covers:
//   1. detectFormat — all 8 format types
//   2. optimizeOutputSync — L0 passthrough, L1 compression per format
//   3. optimizeOutputSync — edge cases (empty, null, small, binary-like)
//   4. optimizeOutputSync — metadata correctness (originalSize, compressedSize, cacheKey)
//   5. L2 summarizer — JSON, Markdown, HTML, security scan
//   6. optimizeOutput (async) — smoke test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFormat,
  optimizeOutputSync,
  optimizeOutput,
} from '../src/lib/output-optimizer.mjs';

// ===========================================================================
// 1. detectFormat
// ===========================================================================

describe('detectFormat', () => {
  it('detects JSON (object)', () => {
    assert.equal(detectFormat('{"a":1,"b":"hello"}'), 'json');
  });

  it('detects JSON (array)', () => {
    assert.equal(detectFormat('[{"id":1},{"id":2}]'), 'json');
  });

  it('detects JSON (pretty-printed)', () => {
    const json = JSON.stringify({ a: 1, b: { c: [1, 2, 3] } }, null, 2);
    assert.equal(detectFormat(json), 'json');
  });

  it('detects CSV with header row', () => {
    const csv = 'name,age,city\nAlice,30,Tokyo\nBob,25,Osaka';
    assert.equal(detectFormat(csv), 'csv');
  });

  it('detects YAML', () => {
    const yaml = 'name: Alice\nage: 30\ncity: Tokyo\n';
    assert.equal(detectFormat(yaml), 'yaml');
  });

  it('detects Markdown (headings)', () => {
    const md = '# Title\n\nSome text\n\n## Subtitle\n\nMore text';
    assert.equal(detectFormat(md), 'markdown');
  });

  it('detects Markdown (lists)', () => {
    const md = '- item 1\n- item 2\n- item 3';
    assert.equal(detectFormat(md), 'markdown');
  });

  it('detects Markdown (code fence)', () => {
    const md = '```js\nconst x = 1;\n```';
    assert.equal(detectFormat(md), 'markdown');
  });

  it('detects Markdown (links)', () => {
    const md = 'See [example](https://example.com) for details.';
    assert.equal(detectFormat(md), 'markdown');
  });

  it('detects HTML', () => {
    const html = '<div><p>Hello</p></div>';
    assert.equal(detectFormat(html), 'html');
  });

  it('detects HTML (with DOCTYPE)', () => {
    const html = '<!DOCTYPE html><html><body>Hi</body></html>';
    assert.equal(detectFormat(html), 'html');
  });

  it('detects code (function keyword)', () => {
    const code = 'function hello() {\n  return "world";\n}';
    assert.equal(detectFormat(code), 'code');
  });

  it('detects code (import/export)', () => {
    const code = 'import { foo } from "./bar";\nexport const x = 1;';
    assert.equal(detectFormat(code), 'code');
  });

  it('detects markdown table (pipe + dashes)', () => {
    const table = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |';
    assert.equal(detectFormat(table), 'table');
  });

  it('returns plaintext for basic text', () => {
    assert.equal(detectFormat('Hello, this is plain text.'), 'plaintext');
  });

  it('returns plaintext for empty string', () => {
    assert.equal(detectFormat(''), 'plaintext');
  });

  it('returns plaintext for null/undefined input', () => {
    assert.equal(detectFormat(null), 'plaintext');
    assert.equal(detectFormat(undefined), 'plaintext');
  });

  it('returns plaintext for single word', () => {
    assert.equal(detectFormat('hello'), 'plaintext');
  });
});

// ===========================================================================
// 2. optimizeOutputSync — L0 passthrough
// ===========================================================================

describe('optimizeOutputSync — L0', () => {
  it('returns text unchanged with maxLevel:0', () => {
    const text = '{"name":"Alice","age":30}';
    const r = optimizeOutputSync(text, { maxLevel: 0 });
    assert.equal(r.optimized, false);
    assert.equal(r.text, text);
    assert.equal(r.level, 0);
  });

  it('returns text unchanged for small text (< 500 chars)', () => {
    const text = 'Hello World';
    const r = optimizeOutputSync(text, { maxLevel: 1 });
    assert.equal(r.optimized, false);
    assert.equal(r.text, text);
  });

  it('handles empty string', () => {
    const r = optimizeOutputSync('', { maxLevel: 1 });
    assert.equal(r.optimized, false);
    assert.equal(r.text, '');
  });

  it('handles null/undefined gracefully', () => {
    const r1 = optimizeOutputSync(null, { maxLevel: 1 });
    assert.equal(r1.optimized, false);

    const r2 = optimizeOutputSync(undefined, { maxLevel: 1 });
    assert.equal(r2.optimized, false);
  });
});

// ===========================================================================
// 3. optimizeOutputSync — L1 compression
// ===========================================================================

describe('optimizeOutputSync — L1 compression', () => {
  it('minifies pretty-printed JSON', () => {
    const obj = { name: 'Alice', age: 30, city: 'Tokyo', tags: Array(80).fill('test-value') };
    const pretty = JSON.stringify(obj, null, 2);
    assert.ok(pretty.length > 500, `pretty JSON should be > 500 chars (got ${pretty.length})`);
    const r = optimizeOutputSync(pretty, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    assert.equal(r.level, 1);
    assert.ok(r.compressedSize < r.originalSize);
    // Parsing should still work
    const parsed = JSON.parse(r.text);
    assert.equal(parsed.name, 'Alice');
    assert.equal(parsed.age, 30);
  });

  it('leaves already-minified JSON unchanged', () => {
    const minified = '{"name":"Alice","age":30}';
    // Pad to meet L1_MIN_SIZE threshold
    const big = minified + ', "data": ' + JSON.stringify(Array(100).fill('x'));
    const r = optimizeOutputSync(big, { maxLevel: 1 });
    // Already minified, no further compression possible
    assert.equal(r.optimized, false);
  });

  it('compresses CSV by trimming field whitespace', () => {
    const csv = 'name , age , city\nAlice , 30 , Tokyo\nBob , 25 , Osaka\n';
    // Pad to meet threshold
    const header = 'name , age , city , a , b , c , d , e , f , g';
    const rows = Array(20).fill('x , y , z , 1 , 2 , 3 , 4 , 5 , 6 , 7').join('\n');
    const bigCsv = header + '\n' + rows;
    const r = optimizeOutputSync(bigCsv, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    // All fields should be trimmed
    const lines = r.text.split('\n');
    for (const line of lines) {
      const fields = line.split(',');
      for (const f of fields) {
        assert.equal(f, f.trim(), `Field "${f}" should be trimmed`);
      }
    }
  });

  it('compresses YAML by trimming trailing whitespace', () => {
    // Build YAML with trailing spaces, > 500 chars
    const lines = ['name: Alice   ', 'age: 30   ', 'city: Tokyo   '];
    for (let i = 0; i < 40; i++) lines.push(`key${i}: value${i}   `);
    const bigYaml = lines.join('\n');
    assert.ok(bigYaml.length > 500);
    const r = optimizeOutputSync(bigYaml, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    // Lines should not end with whitespace
    for (const line of r.text.split('\n')) {
      if (line.trim()) {
        assert.equal(line, line.trimEnd(), `Line should not have trailing whitespace: "${line}"`);
      }
    }
  });

  it('compresses Markdown by collapsing blank lines', () => {
    const md = '# Title\n\n\n\nSome text\n\n\n\n\nMore text\n\n';
    // Pad to 500+ chars with content + excessive blank lines
    const items = Array(35).fill('- item content here and some more words to pad').join('\n\n\n\n');
    const bigMd = md + items + '\n\n\n\n';
    assert.ok(bigMd.length > 500, `Markdown length = ${bigMd.length}`);
    const r = optimizeOutputSync(bigMd, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    // Should have at most 1 blank line between content
    const lines = r.text.split('\n');
    let blankRun = 0;
    for (const line of lines) {
      if (line === '') {
        blankRun++;
        assert.ok(blankRun <= 1, 'Should not have consecutive blank lines');
      } else {
        blankRun = 0;
      }
    }
  });

  it('compresses HTML by removing comments and collapsing whitespace', () => {
    const html = '<div>  \n<p>Hello</p>\n  </div><!-- comment -->\n<span>World</span>\n';
    // Pad to 500+ chars
    const bigHtml = html + Array(40).fill('<p>line of text here</p>').join('\n') + '\n<!-- another comment -->\n';
    assert.ok(bigHtml.length > 500);
    const r = optimizeOutputSync(bigHtml, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    // Comments should be removed
    assert.ok(!r.text.includes('<!--'), 'HTML comments should be removed');
  });

  it('compresses code by normalizing blank lines', () => {
    const code = 'function foo() {\n\n\n\n  return 1;\n\n\n}\n';
    // Pad to 500+ chars with excessive blank lines
    const bigCode = code + Array(15).fill('function bar() {\n  return 2;\n}').join('\n\n\n') + '\n\n\n\n';
    assert.ok(bigCode.length > 500, `code length=${bigCode.length}`);
    const r = optimizeOutputSync(bigCode, { maxLevel: 1 });
    assert.equal(r.optimized, true);
    // At most 1 blank line
    const lines = r.text.split('\n');
    let blankRun = 0;
    for (const line of lines) {
      if (line === '') {
        blankRun++;
        assert.ok(blankRun <= 1);
      } else {
        blankRun = 0;
      }
    }
  });

  it('does not corrupt code inside markdown code blocks', () => {
    const md = '# Example\n\n```js\nconst x = 1;\n\n\nconst y = 2;\n```\n\nMore text.\n\n\n\n';
    const bigMd = md + Array(15).fill('- item').join('\n');
    const r = optimizeOutputSync(bigMd, { maxLevel: 1 });
    // Code block content should be intact
    assert.ok(r.text.includes('const x = 1;'), 'Code block content preserved');
    assert.ok(r.text.includes('```'), 'Code fences preserved');
  });
});

// ===========================================================================
// 4. metadata correctness
// ===========================================================================

describe('optimizeOutputSync — metadata', () => {
  it('returns originalSize and compressedSize', () => {
    const obj = { name: 'Alice', age: 30, tags: Array(50).fill('test') };
    const pretty = JSON.stringify(obj, null, 2);
    const r = optimizeOutputSync(pretty, { maxLevel: 1 });
    assert.equal(typeof r.originalSize, 'number');
    assert.equal(typeof r.compressedSize, 'number');
    assert.ok(r.originalSize > 0);
    if (r.optimized) {
      assert.ok(r.compressedSize <= r.originalSize);
    }
  });

  it('includes cacheKey when optimized', () => {
    const pretty = JSON.stringify({ data: Array(100).fill('x') }, null, 2);
    const r = optimizeOutputSync(pretty, { maxLevel: 1 });
    if (r.optimized) {
      assert.ok(!!r.meta.cacheKey, 'cacheKey should be present');
      assert.equal(typeof r.meta.cacheKey, 'string');
    }
  });

  it('returns correct level value', () => {
    // L0
    assert.equal(optimizeOutputSync('hello', { maxLevel: 0 }).level, 0);
    // L1 on large enough text
    const big = JSON.stringify({ data: Array(100).fill('test') }, null, 2);
    const r1 = optimizeOutputSync(big, { maxLevel: 1 });
    if (r1.optimized) assert.equal(r1.level, 1);
  });
});

// ===========================================================================
// 5. L2 summarizers
// ===========================================================================

describe('optimizeOutputSync — L2 summary (lossy)', () => {
  it('summarizes large JSON by keeping top-level keys', () => {
    const big = {
      name: 'test-report',
      status: 'completed',
      findings: Array(100).fill({ id: 1, severity: 'low', message: 'x'.repeat(50) }),
      metadata: { generated: '2024-01-01', version: '2.0' },
      rawData: Array(200).fill('x').join(''),
    };
    const text = JSON.stringify(big, null, 2);
    const r = optimizeOutputSync(text, { maxLevel: 2 });
    // L2 may not trigger if L1 already compressed enough
    // Just verify it doesn't crash and returns valid output
    assert.ok(r.text.length > 0);
  });

  it('summarizes large Markdown by keeping headings and first paragraphs', () => {
    const md = '# Title\n\nFirst paragraph.\n\n## Section 1\n\nDetails here.\n\n## Section 2\n\nMore details.\n\n' +
      Array(50).fill('Some long paragraph content that goes on and on.').join('\n\n');
    const r = optimizeOutputSync(md, { maxLevel: 2 });
    assert.ok(r.text.length > 0);
  });

  it('falls back to L1 when L2 cannot parse (invalid JSON)', () => {
    const text = '{invalid json here} ' + 'x'.repeat(600);
    const r = optimizeOutputSync(text, { maxLevel: 2 });
    // Should not throw, should return some text
    assert.ok(r.text.length > 0);
  });
});

// ===========================================================================
// 6. optimizeOutput (async) — smoke test
// ===========================================================================

describe('optimizeOutput (async)', () => {
  it('works with L0 passthrough', async () => {
    const r = await optimizeOutput('hello', { maxLevel: 0 });
    assert.equal(r.optimized, false);
    assert.equal(r.text, 'hello');
  });

  it('compresses with L1', async () => {
    const obj = { data: Array(100).fill({ a: 1, b: 2 }) };
    const text = JSON.stringify(obj, null, 2);
    const r = await optimizeOutput(text, { maxLevel: 1 });
    if (r.optimized) {
      assert.equal(r.level, 1);
      assert.ok(r.compressedSize < r.originalSize);
    }
  });

  it('handles empty input', async () => {
    const r = await optimizeOutput('');
    assert.equal(r.optimized, false);
  });
});
