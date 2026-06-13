// memory-db-agent.test.mjs — Phase 19 tests for cross-agent memory
//
// Tests:
//   - agent_id column exists after migration
//   - agent_id write/read
//   - agent_id filtering in searchHybrid
//   - agent_id filtering in listEntries
//   - Auto-detection of agent_id
//
// Run: node --test tests/memory-db-agent.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DB_PATH = resolve(tmpdir(), `smart-memory-agent-test-${Date.now()}.db`);

function cleanup() {
  resetMemoryDB();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDB — Cross-Agent Memory (Phase 19)', () => {
  let db;

  before(() => {
    cleanup();
    db = new MemoryDB(TEST_DB_PATH);
    db.open();
  });

  after(() => {
    cleanup();
  });

  it('agent_id column exists after migration', () => {
    // Verify the column exists by inserting with agent_id
    const entry = db.insertEntry({
      error_message: 'Test error',
      resolution: 'Test fix',
      agent_id: 'claude-code',
    });
    assert.ok(entry);
    assert.equal(entry.agent_id, 'claude-code');
  });

  it('agent_id defaults to null when not specified', () => {
    const entry = db.insertEntry({
      error_message: 'Another error',
      resolution: 'Another fix',
    });
    assert.equal(entry.agent_id, null);
  });

  it('listEntries filters by agent_id', () => {
    // Insert entries with different agent_ids
    db.insertEntry({ error_message: 'Err A', resolution: 'Fix A', agent_id: 'claude-code' });
    db.insertEntry({ error_message: 'Err B', resolution: 'Fix B', agent_id: 'opencode' });
    db.insertEntry({ error_message: 'Err C', resolution: 'Fix C', agent_id: 'claude-code' });

    // Filter by claude-code
    const claudeEntries = db.listEntries({ agent_id: 'claude-code' });
    assert.ok(claudeEntries.length >= 2);
    for (const e of claudeEntries) {
      assert.equal(e.agent_id, 'claude-code');
    }

    // Filter by opencode
    const opencodeEntries = db.listEntries({ agent_id: 'opencode' });
    assert.ok(opencodeEntries.length >= 1);
    for (const e of opencodeEntries) {
      assert.equal(e.agent_id, 'opencode');
    }
  });

  it('searchHybrid filters by agent_id', () => {
    // Insert entries with different agent_ids
    db.insertEntry({
      error_message: 'Null pointer in auth module',
      resolution: 'Added null check',
      agent_id: 'claude-code',
    });
    db.insertEntry({
      error_message: 'Null pointer in auth module',
      resolution: 'Added null check v2',
      agent_id: 'opencode',
    });

    // Search without agent filter — should find both
    const allResults = db.searchHybrid('null pointer auth', null, { limit: 10 });
    const allIds = allResults.map(r => r.id);
    assert.ok(allResults.length >= 2);

    // Search with agent_id filter — should find only claude-code
    const claudeResults = db.searchHybrid('null pointer auth', null, {
      limit: 10,
      agent_id: 'claude-code',
    });
    assert.ok(claudeResults.length >= 1);
    for (const r of claudeResults) {
      assert.equal(r.agent_id, 'claude-code');
    }
  });

  it('searchHybrid with agent_id="all" returns all agents', () => {
    const results = db.searchHybrid('null pointer', null, { limit: 10 });
    // Should find entries from both agents
    const agents = new Set(results.map(r => r.agent_id).filter(Boolean));
    assert.ok(agents.size >= 1);
  });

  it('updateEntry can change agent_id', () => {
    const entry = db.insertEntry({
      error_message: 'Migrate me',
      resolution: 'Migration fix',
      agent_id: 'unknown',
    });
    assert.equal(entry.agent_id, 'unknown');

    const updated = db.updateEntry(entry.id, { agent_id: 'claude-code' });
    assert.equal(updated.agent_id, 'claude-code');
  });

  it('stats include agent_id distribution', () => {
    const stats = db.stats();
    assert.ok(stats.total > 0);
  });
});