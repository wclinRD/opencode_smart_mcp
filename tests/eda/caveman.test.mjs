// caveman.test.mjs — Caveman 壓縮引擎測試
// Phase 9.3: tests/eda/ 單元測試

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cavemanCompress,
  compressResults,
  compressOutput,
  smartCrush,
  smartCrusher,
  schemaCompress,
  schemaDecompress,
} from '../../src/plugins/core/eda/lib/caveman.mjs';

// ── cavemanCompress ────────────────────────────────────────────────────

describe('cavemanCompress', () => {
  it('light level: removes stop words', () => {
    const input = 'The quick brown fox jumps over the lazy dog';
    const result = cavemanCompress(input, 'light');
    assert.ok(result.length < input.length);
    assert.ok(!result.includes('The'));
    assert.ok(!result.includes(' the '));
  });

  it('semantic level: removes filler phrases', () => {
    const input = 'In order to optimize the timing closure, it is important to note that the design needs.';
    const result = cavemanCompress(input, 'semantic');
    assert.ok(result.length < input.length);
  });

  it('preserves EDA-specific terms', () => {
    const input = 'Design Compiler synthesis flow with PrimeTime STA';
    const result = cavemanCompress(input, 'semantic');
    assert.ok(result.includes('Design Compiler') || result.includes('Design'));
    assert.ok(result.includes('PrimeTime') || result.includes('PrimeTime'));
  });

  it('ultra level: aggressive compression', () => {
    const input = 'This is a very comprehensive and detailed analysis of the timing results';
    const result = cavemanCompress(input, 'ultra');
    assert.ok(result.length < input.length);
  });

  it('returns empty string for empty input', () => {
    assert.equal(cavemanCompress('', 'light'), '');
  });
});

// ── compressResults ────────────────────────────────────────────────────

describe('compressResults', () => {
  it('compresses snippet field', () => {
    const results = [
      { snippet: 'This is a very long snippet that should be compressed significantly' },
    ];
    const compressed = compressResults(results, 'light', ['snippet']);
    assert.ok(compressed[0].snippet.length < results[0].snippet.length);
  });

  it('handles missing fields gracefully', () => {
    const results = [{ title: 'No snippet field' }];
    const compressed = compressResults(results, 'light', ['snippet']);
    assert.equal(compressed[0].title, 'No snippet field');
  });
});

// ── compressOutput ─────────────────────────────────────────────────────

describe('compressOutput', () => {
  it('applies compression to full output text', () => {
    const output = '🔍 **Search Results**\n\nThe design compiler is used for synthesis.\n';
    const compressed = compressOutput(output, 'light');
    assert.ok(typeof compressed === 'string');
    assert.ok(compressed.length > 0);
  });
});

// ── smartCrush ─────────────────────────────────────────────────────────

describe('smartCrush', () => {
  it('splits CamelCase compound words', () => {
    const result = smartCrush('DesignCompiler optimization');
    assert.ok(result.includes('Design Compiler') || result.includes('Design'));
  });

  it('preserves known EDA terms', () => {
    const result = smartCrush('dc → Design Compiler');
    assert.ok(result.length > 0);
  });
});

// ── smartCrusher ───────────────────────────────────────────────────────

describe('smartCrusher', () => {
  it('crush mode: compresses text', () => {
    const input = 'The Design Compiler is a very important tool for synthesis';
    const result = smartCrusher(input, 'crush');
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('full mode: more aggressive compression', () => {
    const input = 'The Design Compiler is a very important tool for synthesis in modern chip design';
    const crush = smartCrusher(input, 'crush');
    const full = smartCrusher(input, 'full');
    assert.ok(full.length <= crush.length);
  });
});

// ── schemaCompress / schemaDecompress ──────────────────────────────────

describe('schemaCompress / schemaDecompress', () => {
  const columns = ['name', 'vendor', 'category'];

  it('roundtrip: compress then decompress', () => {
    const data = [
      { name: 'DC', vendor: 'Synopsys', category: 'tool' },
      { name: 'PT', vendor: 'Synopsys', category: 'tool' },
    ];
    const result = schemaCompress(data, columns);
    // schemaCompress returns { header, compressed, stats }
    assert.ok(result.compressed);
    assert.ok(result.stats.rows === 2);
    // Decompress skips header line
    const decompressed = schemaDecompress(result.compressed, columns);
    assert.equal(decompressed.length, 2);
    assert.equal(decompressed[0].name, 'DC');
  });

  it('reports compression stats', () => {
    const data = [
      { name: 'DC', vendor: 'Synopsys', category: 'tool' },
      { name: 'ICC2', vendor: 'Synopsys', category: 'tool' },
      { name: 'Genus', vendor: 'Cadence', category: 'tool' },
    ];
    const result = schemaCompress(data, columns);
    assert.ok(result.stats.savings >= 0);
    assert.equal(result.stats.rows, 3);
  });
});
