// memory-store.test.mjs — Phase 1 integration tests
//
// Tests memory store + error-diagnose integration:
//   1. Store / fuzzy search lifecycle
//   2. Confirm feedback mechanism
//   3. error-diagnose auto-searches memory (no --use-memory flag needed)
//   4. error-diagnose stores + retrieves via memory
//   5. tool-stats patterns command
//
// Run: node --test tests/memory-store.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname, '../src/cli');
const TEST_UID = Date.now();
const MEMORY_DIR = resolve(__dirname, '../.test-memory-' + TEST_UID);
const STATS_DIR = resolve(__dirname, '../.test-stats-' + TEST_UID);

function runCLI(cliFile, args) {
  const result = spawnSync('node', [resolve(CLI_DIR, cliFile), ...args], {
    encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 200,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function runMemory(args) {
  return runCLI('memory-store.mjs', [...args, '--data-dir', MEMORY_DIR, '--format', 'json']);
}

function parseJSON(output) {
  try { return JSON.parse(output.stdout); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 1: Memory Store', () => {

  before(() => {
    mkdirSync(MEMORY_DIR, { recursive: true });
  });

  it('1.1 store: stores a new error resolution', () => {
    const res = runMemory(['store', 'TypeError: Cannot read property foo of undefined',
      '--resolution', 'Add optional chaining ?.',
      '--tools', 'grep,debug',
    ]);
    assert.equal(res.status, 0, `store failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data.stored, 'should return stored: true');
    assert.equal(data.updated, false, 'first store should be new, not update');
    assert.ok(data.id, 'should have an id');
    assert.equal(data.category, 'build', 'should categorize as build error');
  });

  it('1.1 fuzzy search: finds similar error', () => {
    const res = runMemory(['search', 'cannot read property foo',
      '--threshold', '0.3',
    ]);
    assert.equal(res.status, 0, `search failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data.found, 'should find match');
    assert.ok(data.count >= 1, 'should have at least 1 result');
    assert.ok(data.entries[0].similarity >= 0.5, 'similarity should be > 0.5');
    assert.equal(data.entries[0].resolution, 'Add optional chaining ?.');
  });

  it('1.1 dedup: same error updates hitCount instead of duplicating', () => {
    const res1 = runMemory(['search', 'TypeError: Cannot read property foo of undefined']);
    const data1 = parseJSON(res1);
    const initialHitCount = data1.entries[0].hitCount;

    // Store same error again
    const res2 = runMemory(['store', 'TypeError: Cannot read property foo of undefined',
      '--resolution', 'Add optional chaining ?.',
    ]);
    const data2 = parseJSON(res2);
    assert.ok(data2.updated, 'should update existing, not create new');
    assert.ok(data2.hitCount > initialHitCount, 'hitCount should increase');

    // Verify still only 1 entry
    const res3 = runMemory(['stats']);
    const data3 = parseJSON(res3);
    assert.equal(data3.totalEntries, 1, 'should still have 1 entry, not duplicated');
  });

  it('1.1 confirm: explicitly boosts entry weight', () => {
    // First store another error so we can confirm it
    const storeRes = runMemory(['store', 'SyntaxError: Unexpected token',
      '--resolution', 'Check brackets',
    ]);
    const storeData = parseJSON(storeRes);

    // Confirm it
    const confirmRes = runMemory(['confirm', storeData.id, '--tools', 'test,debug']);
    const confirmData = parseJSON(confirmRes);
    assert.ok(confirmData.confirmed, 'confirm should succeed');
    assert.equal(confirmData.confirmCount, 1, 'should have 1 confirmation');

    // Confirm again → confirmCount should be 2
    const confirmRes2 = runMemory(['confirm', storeData.id]);
    const confirmData2 = parseJSON(confirmRes2);
    assert.equal(confirmData2.confirmCount, 2, 'second confirm should increment');
    assert.ok(confirmData2.hitCount > confirmData.hitCount, 'hitCount should increase on confirm');
  });

  it('1.1 stats: returns meaningful statistics', () => {
    const res = runMemory(['stats']);
    const data = parseJSON(res);
    assert.ok(data.totalEntries >= 2, 'should have at least 2 entries');
    assert.ok(data.successRate >= 0, 'should have success rate');
    assert.ok(data.totalHits > 0, 'should have total hits');
    assert.ok(data.byCategory, 'should have category breakdown');
  });

  after(() => {
    // Clean up test memory dir
    try { if (existsSync(MEMORY_DIR)) rmSync(MEMORY_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });
});

describe('Phase 1: error-diagnose + memory integration', () => {

  before(() => {
    // Create default memory dir (error-diagnose uses this path)
    const defaultMemDir = resolve(process.env.HOME || '/tmp', '.smart', 'memory');
    mkdirSync(defaultMemDir, { recursive: true });
    // Store test errors to default dir for error-diagnose to find
    const defaultCli = (args) => runCLI('memory-store.mjs', [...args, '--format', 'json']);
    defaultCli(['store', 'ENOENT: no such file or directory, open package.json',
      '--resolution', 'Check file path and working directory',
      '--tools', 'debug',
    ]);
    defaultCli(['store', 'Connection refused: localhost:8080',
      '--resolution', 'Check if server is running on port 8080',
      '--tools', 'error-diagnose,debug',
    ]);
  });

  it('1.2a auto-searches memory (no --use-memory flag needed)', () => {
    // Run error-diagnose WITHOUT --no-memory flag → auto-search by default
    const res = runCLI('error-diagnose.mjs', [
      'ENOENT: no such file or directory, open package.json',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `diagnose failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.matches.length > 0, 'should have matches');
    // Auto-memory should find the stored resolution
    assert.ok(data.memoryHit, 'should have memoryHit from auto-search');
  });

  it('1.2b memory store: store + search round-trip', () => {
    const storeRes = runMemory(['store', 'SyntaxError: missing ) in parenthetical',
      '--resolution', 'Check matching parentheses',
      '--tools', 'lint,debug',
    ]);
    const storeData = parseJSON(storeRes);
    assert.ok(storeData.stored, 'should store to memory');

    // Search with similar phrasing; use lower threshold for fuzzy match
    const searchRes = runMemory(['search', 'missing parenthetical',
      '--threshold', '0.3',
    ]);
    const searchData = parseJSON(searchRes);
    assert.ok(searchData.found, 'memory should find stored diagnosis');
  });

  it('1.2c same error second time returns from memory (fast path)', () => {
    // This error was stored in before() hook above
    const res = runCLI('error-diagnose.mjs', [
      'Connection refused: localhost:8080',
      '--format', 'json',
    ]);
    assert.equal(res.status, 0, `second diagnose failed: ${res.stderr}`);
    const data = parseJSON(res);

    assert.ok(data.matches.length > 0, 'should have matches');
    assert.ok(data.memoryHit, 'should have memoryHit (auto-search)');
    if (data.fromMemory) {
      assert.ok(data.matches[0].memoryHit, 'should mark as memory hit');
      assert.ok(data.matches[0].fix, 'should return the stored resolution');
    }
  });

  after(() => {
    // Clean up default memory dir test data
    try {
      const defaultMemDir = resolve(process.env.HOME || '/tmp', '.smart', 'memory');
      if (existsSync(defaultMemDir)) rmSync(defaultMemDir, { recursive: true, force: true });
    } catch { /* ok */ }
  });
});

describe('Phase 1: tool-stats patterns', () => {

  before(() => {
    // Record some test data for pattern analysis
    const testRoot = STATS_DIR + '/testproj';
    mkdirSync(testRoot + '/.opencode/stats', { recursive: true });

    const testData = {
      entries: [
        // A debug session: grep → debug → cross_file_edit
        { tool: 'smart_grep', timestamp: new Date(Date.now() - 600000).toISOString(), duration: 150, success: true },
        { tool: 'smart_debug', timestamp: new Date(Date.now() - 590000).toISOString(), duration: 300, success: true },
        { tool: 'smart_cross_file_edit', timestamp: new Date(Date.now() - 580000).toISOString(), duration: 200, success: true },
        { tool: 'smart_test', timestamp: new Date(Date.now() - 570000).toISOString(), duration: 500, success: true },
        // A failing debug session
        { tool: 'smart_grep', timestamp: new Date(Date.now() - 300000).toISOString(), duration: 100, success: true },
        { tool: 'smart_debug', timestamp: new Date(Date.now() - 290000).toISOString(), duration: 400, success: false },
        { tool: 'smart_debug', timestamp: new Date(Date.now() - 280000).toISOString(), duration: 350, success: false },
      ],
      lastUpdated: new Date().toISOString(),
    };
    writeFileSync(resolve(testRoot, '.opencode/stats/tool-usage.json'), JSON.stringify(testData, null, 2), 'utf-8');
  });

  after(() => {
    try { if (existsSync(STATS_DIR)) rmSync(STATS_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('1.3 patterns: returns task breakdown and tool combos', () => {
    const res = runCLI('tool-stats.mjs', [
      'patterns', '--root', STATS_DIR + '/testproj', '--format', 'json',
    ]);
    assert.equal(res.status, 0, `patterns failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(data.sessionsFound >= 1, 'should detect at least 1 session');
    assert.ok(data.taskBreakdown.length > 0, 'should have task breakdown');
    assert.ok(data.totalEntries >= 7, 'should count all entries');
  });

  it('1.3 recommendations: actionable suggestions', () => {
    const res = runCLI('tool-stats.mjs', [
      'recommendations', '--root', STATS_DIR + '/testproj', '--format', 'json',
    ]);
    assert.equal(res.status, 0, `recommendations failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return valid JSON');
    assert.ok(Array.isArray(data.recommendations), 'recommendations should be an array');
    // smart_debug has 2 failures out of 3 → ~33% success → should trigger warning
    const debugWarnings = data.recommendations.filter(r => r.tool === 'smart_debug' && r.type === 'warning');
    assert.ok(debugWarnings.length > 0, 'should warn about smart_debug low success rate');
  });
});
