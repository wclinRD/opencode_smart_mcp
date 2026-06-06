// output-pipeline.test.mjs — Tests for output-pipeline.mjs
//
// Covers:
//   1. Pipeline creation — default stages, custom chain
//   2. Format → compress → summarize → truncate stage execution
//   3. Semantic truncator for each format type
//   4. Cache integration (cache hit/miss)
//   5. Metadata correctness
//   6. Plugin responsePipeline custom chain

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPipeline,
  optimizeOutput,
  listStages,
  registerStage,
  checkCache,
  storeCache,
} from '../src/lib/output-pipeline.mjs';
import { detectFormat } from '../src/lib/output-optimizer.mjs';

// ===========================================================================
// 1. Pipeline creation
// ===========================================================================

describe('createPipeline', () => {
  it('creates pipeline with default stages', () => {
    const pipe = createPipeline({ maxLevel: 1 });
    assert.ok(pipe);
    assert.ok(typeof pipe.run === 'function');
  });

  it('creates pipeline with maxLevel=0 (no compression)', () => {
    const pipe = createPipeline({ maxLevel: 0 });
    const result = pipe.run(JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2));
    assert.equal(result.meta._optimized.level, 0);
    assert.equal(result.text, JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2));
  });

  it('creates pipeline with custom chain (plugin responsePipeline)', () => {
    const chain = [
      { stage: 'format' },
      { stage: 'compress' },
    ];
    // Need >500 chars to trigger L1 compression
    const large = JSON.stringify({ a: 1, b: 2, items: Array.from({ length: 30 }, (_, i) => ({ id: i, val: 'x'.repeat(20) })) }, null, 2);
    const pipe = createPipeline({ maxLevel: 1, chain });
    const result = pipe.run(large);
    assert.ok(result.meta._optimized.stages.includes('compress'));
  });

  it('listStages returns registered stage names', () => {
    const stages = listStages();
    assert.ok(stages.includes('format'));
    assert.ok(stages.includes('compress'));
    assert.ok(stages.includes('summarize'));
    assert.ok(stages.includes('truncate'));
    assert.ok(stages.includes('cache'));
  });

  it('throws for unknown stage', () => {
    assert.throws(() => {
      createPipeline({ chain: [{ stage: 'nonexistent' }] });
    }, /Unknown pipeline stage/);
  });
});

// ===========================================================================
// 2. Stage execution
// ===========================================================================

describe('pipeline stage execution', () => {
  it('format stage detects JSON', () => {
    const pipe = createPipeline({ maxLevel: 0, stages: ['format'] });
    const result = pipe.run('{"key":"value"}');
    assert.equal(result.meta._optimized.format, 'json');
  });

  it('compress stage minifies JSON', () => {
    // Need >500 chars to trigger L1 compression
    const pretty = JSON.stringify({ a: 1, b: 2, c: 'hello', items: Array.from({ length: 20 }, (_, i) => ({ id: i, val: 'x'.repeat(20) })) }, null, 2);
    assert.ok(pretty.length > 500, 'test data must be >500 chars for L1 compression');
    const pipe = createPipeline({ maxLevel: 1, stages: ['format', 'compress'] });
    const result = pipe.run(pretty);
    assert.equal(result.meta._optimized.level, 1);
    assert.ok(result.text.length < pretty.length);
  });

  it('summarize stage reduces large JSON', () => {
    // Need >10KB to trigger L2 summarization
    const large = JSON.stringify({
      name: 'test',
      version: 1,
      items: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}`, data: 'x'.repeat(200) })),
      metadata: { description: 'A'.repeat(2000), tags: Array.from({ length: 30 }, (_, i) => `tag-${i}`) },
    });
    assert.ok(large.length > 10000, `test data must be >10KB for L2, got ${(large.length/1024).toFixed(1)}KB`);
    const pipe = createPipeline({ maxLevel: 2, stages: ['format', 'compress', 'summarize'] });
    const result = pipe.run(large);
    // Should have L2 summarization
    assert.ok(result.meta._optimized.level === 2, `expected level 2, got ${result.meta._optimized.level}`);
    assert.ok(result.text.length < large.length);
  });

  it('cache stage stores and retrieves', () => {
    const pipe = createPipeline({
      maxLevel: 0,
      stages: ['cache'],
      stageOptions: { cache: { ttl: 60000 } },
    });
    const text = 'cache-test-data-' + Date.now();
    const result1 = pipe.run(text);
    assert.ok(result1.meta._optimized.stages.includes('cache(set)'));
    // Same text should hit cache
    const result2 = pipe.run(text);
    assert.ok(result2.meta._optimized.stages.includes('cache(hit)') || result2.meta._optimized.cacheHit);
  });
});

// ===========================================================================
// 3. Semantic truncator (via explicit truncate stage)
// ===========================================================================

describe('semantic truncator', () => {
  it('truncates Markdown preserving headings', () => {
    // Build markdown with clear heading structure — must be detected as 'markdown'
    const lines = ['# Heading 1'];
    for (let i = 1; i <= 10; i++) lines.push(`Paragraph ${i} with some longer content to make this text substantial enough.`);
    lines.push('## Heading 2');
    for (let i = 11; i <= 20; i++) lines.push(`Paragraph ${i} with some longer content to make this text substantial enough.`);
    lines.push('### Heading 3');
    for (let i = 21; i <= 30; i++) lines.push(`Paragraph ${i} with some longer content to make this text substantial enough.`);
    const md = lines.join('\n');
    // Verify it's detected as markdown
    assert.equal(detectFormat(md), 'markdown', 'test data must be detected as markdown');

    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 200 });
    const result = pipe.run(md);
    // Should have truncated
    assert.ok(result.text.length < md.length, `expected ${result.text.length} < ${md.length}`);
    // Should preserve headings
    assert.ok(result.text.includes('# Heading'));
    // Should have truncation marker
    assert.ok(result.text.includes('truncated'));
  });

  it('truncates JSON preserving structure', () => {
    const data = { name: 'test', items: Array.from({ length: 100 }, (_, i) => ({ id: i, val: 'x'.repeat(50) })) };
    const json = JSON.stringify(data, null, 2);
    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 500 });
    const result = pipe.run(json);
    assert.ok(result.text.length < json.length);
    assert.ok(result.text.includes('truncated'));
  });

  it('truncates HTML preserving title and headings', () => {
    const html = '<!DOCTYPE html><html><head><title>Test Page</title></head><body>'
      + '<h1>Main Title</h1>'
      + Array.from({ length: 50 }, (_, i) => `<p>Paragraph ${i} with some content here.</p>`).join('\n')
      + '</body></html>';
    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 300 });
    const result = pipe.run(html);
    assert.ok(result.text.length < html.length);
    assert.ok(result.text.includes('Test Page') || result.text.includes('Main Title'));
    assert.ok(result.text.includes('truncated'));
  });

  it('truncates CSV preserving header and first/last rows', () => {
    const header = 'id,name,value';
    const rows = Array.from({ length: 100 }, (_, i) => `${i},item-${i},${i * 10}`);
    const csv = [header, ...rows].join('\n');
    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 300 });
    const result = pipe.run(csv);
    assert.ok(result.text.length < csv.length);
    assert.ok(result.text.includes('id,name,value'));
    assert.ok(result.text.includes('truncated'));
  });

  it('truncates code preserving function signatures', () => {
    const code = `
import { foo } from './bar';

function helper1() {
  // implementation
  const x = 1;
  const y = 2;
  return x + y;
}

function helper2() {
  const a = 10;
  const b = 20;
  return a * b;
}

export class MyClass {
  method1() { return 1; }
  method2() { return 2; }
}
`.trim();
    const longCode = code + '\n' + Array.from({ length: 50 }, (_, i) => `const z${i} = ${i};`).join('\n');
    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 200 });
    const result = pipe.run(longCode);
    assert.ok(result.text.length < longCode.length);
    assert.ok(result.text.includes('function') || result.text.includes('class') || result.text.includes('import'));
    assert.ok(result.text.includes('truncated') || result.text.includes('...'));
  });

  it('truncates plain text preserving first and last portions', () => {
    const text = 'A'.repeat(100) + '\n\nMIDDLE\n\n' + 'B'.repeat(100);
    const pipe = createPipeline({ maxLevel: 0, stages: ['format', 'truncate'], maxChars: 150 });
    const result = pipe.run(text);
    assert.ok(result.text.length < text.length);
    assert.ok(result.text.includes('truncated'));
  });
});

// ===========================================================================
// 4. optimizeOutput convenience function
// ===========================================================================

describe('optimizeOutput (convenience)', () => {
  it('returns meta with _optimized', () => {
    const result = optimizeOutput(JSON.stringify({ a: 1 }, null, 2), { maxLevel: 1 });
    assert.ok(result.meta._optimized);
    assert.ok('level' in result.meta._optimized);
    assert.ok('format' in result.meta._optimized);
    assert.ok('stages' in result.meta._optimized);
    assert.ok('originalSize' in result.meta._optimized);
    assert.ok('optimizedSize' in result.meta._optimized);
  });

  it('handles empty input', () => {
    const result = optimizeOutput('', { maxLevel: 1 });
    assert.ok(result.meta);
    assert.equal(result.meta.level || result.meta._optimized?.level || 0, 0);
  });

  it('handles null/undefined input', () => {
    const result = optimizeOutput(null);
    assert.ok(result.meta);
    assert.equal(result.meta.level || result.meta._optimized?.level || 0, 0);
  });
});

// ===========================================================================
// 5. Custom plugin responsePipeline
// ===========================================================================

describe('plugin responsePipeline', () => {
  it('can override with custom chain', () => {
    const chain = [
      { stage: 'format' },
      { stage: 'compress' },
    ];
    // Need >500 chars to trigger L1 compression
    const text = JSON.stringify({ a: { b: { c: Array.from({ length: 30 }, (_, i) => ({ id: i, val: 'x'.repeat(20) })) } } }, null, 2);
    assert.ok(text.length > 500, 'test data must be >500 chars');
    const pipe = createPipeline({ maxLevel: 1, chain });
    const result = pipe.run(text);
    assert.ok(result.meta._optimized.stages.includes('compress'), `stages: ${result.meta._optimized.stages.join(',')}`);
    assert.ok(!result.meta._optimized.stages.includes('summarize'));
    assert.ok(!result.meta._optimized.stages.includes('truncate'));
    assert.ok(!result.meta._optimized.stages.includes('cache'));
  });

  it('security pipeline skips L2 for small text', () => {
    const chain = [
      { stage: 'format' },
      { stage: 'compress' },
      { stage: 'summarize', options: { securityScan: true } },
    ];
    const pipe = createPipeline({ maxLevel: 2, chain });
    const smallText = JSON.stringify({ severity: 'low', finding: 'test' });
    const result = pipe.run(smallText);
    // Small text should not trigger L2 (needs 10KB+)
    assert.ok(result.meta._optimized.level <= 1);
  });
});

// ===========================================================================
// 6. Custom stage registration
// ===========================================================================

describe('registerStage', () => {
  it('allows custom stages to be added', () => {
    registerStage('uppercase', (text) => text.toUpperCase());
    const pipe = createPipeline({
      maxLevel: 0,
      chain: [{ stage: 'uppercase' }],
    });
    const result = pipe.run('hello');
    assert.equal(result.text, 'HELLO');
  });

  it('custom stage can access context', () => {
    registerStage('annotate', (text, ctx) => {
      ctx.annotated = true;
      return `[${ctx.format}] ${text}`;
    });
    const pipe = createPipeline({
      maxLevel: 0,
      chain: [{ stage: 'format' }, { stage: 'annotate' }],
    });
    const result = pipe.run('hello world');
    assert.ok(result.text.startsWith('[plaintext]'));
  });
});
