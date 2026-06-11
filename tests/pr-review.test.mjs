// pr-review.test.mjs — Phase 18: Automated PR Review tests
//
// Tests: plugin structure, git diff integration, file classification, review sections

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/plugins/standard/pr-review.mjs');
const plugin = mod.default;

// ---------------------------------------------------------------------------
// Plugin structure
// ---------------------------------------------------------------------------
describe('plugin structure', () => {
  it('has correct name', () => {
    assert.equal(plugin.name, 'smart_pr_review');
  });

  it('has handler', () => {
    assert.equal(typeof plugin.handler, 'function');
  });

  it('has inputSchema', () => {
    assert.ok(plugin.inputSchema);
    assert.ok(plugin.inputSchema.properties.base);
    assert.ok(plugin.inputSchema.properties.head);
  });
});

// ---------------------------------------------------------------------------
// Handler: basic execution
// ---------------------------------------------------------------------------
describe('handler: basic execution', () => {
  it('runs review on current repo', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.ok);
    assert.ok(result.meta);
    assert.ok(result.meta.filesChanged >= 0);
    assert.ok(result.commits);
    assert.ok(result.sections);
  });

  it('includes all sections by default', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.sections.summary);
  });

  it('returns error for invalid base', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'nonexistent-branch-xyz',
      head: 'HEAD',
    }));
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Handler: section filtering
// ---------------------------------------------------------------------------
describe('handler: section filtering', () => {
  it('returns only requested sections', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
      sections: ['summary'],
    }));
    assert.ok(result.ok);
    assert.ok(result.sections.summary);
    assert.equal(result.sections.security, undefined);
    assert.equal(result.sections.impact, undefined);
  });

  it('all includes all sections', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
      sections: ['all'],
    }));
    assert.ok(result.ok);
    assert.ok(result.sections.summary);
  });
});

// ---------------------------------------------------------------------------
// Handler: meta information
// ---------------------------------------------------------------------------
describe('handler: meta information', () => {
  it('includes file counts by category', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.meta.sourceFiles !== undefined);
    assert.ok(result.meta.testFiles !== undefined);
    assert.ok(result.meta.configFiles !== undefined);
    assert.ok(result.meta.docFiles !== undefined);
  });

  it('includes commit list', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(Array.isArray(result.commits));
    assert.ok(result.commits.length >= 1);
  });

  it('includes files by category', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.filesByCategory);
    assert.ok(Array.isArray(result.filesByCategory.source));
  });
});

// ---------------------------------------------------------------------------
// Handler: summary section
// ---------------------------------------------------------------------------
describe('handler: summary section', () => {
  it('includes risk level', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.sections.summary);
    assert.ok(result.sections.summary.riskLevel);
  });

  it('includes next steps', async () => {
    const result = JSON.parse(await plugin.handler({
      base: 'HEAD~1',
      head: 'HEAD',
    }));
    assert.ok(result.sections.summary.nextSteps);
    assert.ok(result.sections.summary.nextSteps.length >= 3);
  });
});
