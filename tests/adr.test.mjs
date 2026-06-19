// tests/adr.test.mjs — Phase 24 ADR tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { MemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';

const TEST_DIR = join(os.tmpdir(), `adr-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, 'test-memory.db');

function cleanup() {
  resetMemoryDB();
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('ADR — Architecture Decision Records', () => {
  let db;

  before(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
    db = new MemoryDB(TEST_DB);
    db.open();
  });

  after(() => {
    cleanup();
  });

  // --- Record ---

  it('should record an ADR', () => {
    const result = db.recordADR({
      title: 'Use better-sqlite3 for memory storage',
      context: 'Phase 11 memory-db needs high-performance SQLite',
      decision: 'Use better-sqlite3 because synchronous API is better suited for Node.js',
      alternatives: ['node:sqlite (Node 26+)', 'sql.js (WASM)'],
      consequences: 'Requires native compile, but 3-5x faster than alternatives'
    });

    assert.ok(result.id > 0, 'Should return a valid ID');
  });

  it('should record ADR with default status', () => {
    db.recordADR({
      title: 'Test default status',
      decision: 'Testing'
    });

    const results = db.searchADR('default status');
    const adr = results.find(r => r.title === 'Test default status');
    assert.ok(adr, 'Should find the ADR');
    assert.equal(adr.status, 'accepted', 'Default status should be accepted');
  });

  // --- Search ---

  it('should search ADRs by title', () => {
    const results = db.searchADR('better-sqlite3');
    assert.ok(results.length > 0, 'Should find ADRs about better-sqlite3');
    assert.ok(results.some(r => r.title.includes('better-sqlite3')), 'Should match title');
  });

  it('should search ADRs by context', () => {
    const results = db.searchADR('high-performance');
    assert.ok(results.length > 0, 'Should find ADRs mentioning high-performance');
  });

  it('should search ADRs by decision content', () => {
    const results = db.searchADR('synchronous API');
    assert.ok(results.length > 0, 'Should find ADRs mentioning synchronous API');
  });

  it('should return empty for no-match query', () => {
    const results = db.searchADR('nonexistent-query-xyz-123');
    assert.equal(results.length, 0, 'Should return empty for no match');
  });

  // --- List ---

  it('should list all ADRs', () => {
    // Record a few more
    db.recordADR({ title: 'Decision A', decision: 'Chose A over B' });
    db.recordADR({ title: 'Decision B', decision: 'Chose B over C' });

    const results = db.listADR();
    assert.ok(results.length >= 3, `Expected at least 3 ADRs, got ${results.length}`);
  });

  it('should list ADRs filtered by status', () => {
    const results = db.listADR({ status: 'accepted' });
    assert.ok(results.length > 0, 'Should find accepted ADRs');
    assert.ok(results.every(r => r.status === 'accepted'), 'All should be accepted');
  });

  // --- Get ---

  it('should get ADR by ID', () => {
    const all = db.listADR();
    const first = all[0];
    const adr = db.getADR(first.id);
    assert.ok(adr, 'Should find ADR by ID');
    assert.equal(adr.title, first.title);
    assert.ok(Array.isArray(adr.alternatives), 'Alternatives should be an array');
  });

  it('should return null for non-existent ID', () => {
    const adr = db.getADR(99999);
    assert.equal(adr, null, 'Should return null for non-existent ID');
  });

  // --- Update ---

  it('should update ADR status', () => {
    const all = db.listADR();
    const first = all[0];

    db.updateADRStatus(first.id, 'deprecated');

    const updated = db.getADR(first.id);
    assert.equal(updated.status, 'deprecated', 'Status should be updated');
  });

  // --- Delete ---

  it('should delete an ADR', () => {
    const before = db.listADR();
    const countBefore = before.length;

    db.deleteADR(before[before.length - 1].id);

    const after = db.listADR();
    assert.equal(after.length, countBefore - 1, 'Count should decrease by 1');
  });

  // --- Plugin ---

  it('should export valid plugin definition', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;
    assert.equal(plugin.name, 'smart_adr');
    assert.equal(plugin.category, 'standard');
    assert.ok(plugin.inputSchema);
    assert.equal(typeof plugin.handler, 'function');
  });

  it('should record via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;

    const result = await plugin.handler({
      command: 'record',
      title: 'Plugin test ADR',
      decision: 'Testing plugin handler',
      alternatives: ['Option 1', 'Option 2']
    });

    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.ok(data.id > 0, 'Should have ID');
  });

  it('should search via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;

    const result = await plugin.handler({
      command: 'search',
      query: 'plugin'
    });

    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.ok(data.count > 0, 'Should find results');
  });

  it('should list via plugin handler', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;

    const result = await plugin.handler({ command: 'list' });
    const data = JSON.parse(result.output);
    assert.ok(data.ok, 'Should be ok');
    assert.ok(data.count > 0, 'Should have results');
  });

  it('should error on missing required fields', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;

    const result = await plugin.handler({ command: 'record' });
    assert.ok(!result.ok, 'Should be error');
  });

  it('should error on unknown command', async () => {
    const plugin = (await import('../src/plugins/standard/adr.mjs')).default;

    const result = await plugin.handler({ command: 'unknown' });
    assert.ok(!result.ok, 'Should be error');
  });
});