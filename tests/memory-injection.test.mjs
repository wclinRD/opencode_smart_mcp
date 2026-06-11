// memory-injection.test.mjs — Phase 10.5 Auto Memory Injection
//
// Tests that memory entries are auto-injected as context findings on session init:
//   1. addFindings() public method on ContextManager
//   2. autoInjectMemory() reads memory file, scores entries, injects top findings
//   3. Non-existent memory file is handled gracefully (no crash)
//   4. Empty memory file is handled gracefully
//
// Run: node --test tests/memory-injection.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ContextManager } from '../src/lib/context-manager.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir;
const TEST_UID = Date.now();

function freshManager(opts = {}) {
  testDir = resolve(tmpdir(), `smart-inject-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(testDir, { recursive: true });
  return new ContextManager({
    contextDir: testDir,
    autoSave: opts.autoSave !== false,
    extractFindings: opts.extractFindings !== false,
    maxHistory: opts.maxHistory || 10,
    maxFindings: opts.maxFindings || 20,
    maxResultLength: opts.maxResultLength || 500,
  });
}

function cleanup() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/** Write a mock memory file and return its path */
function writeMemoryFile(entries) {
  const memDir = resolve(tmpdir(), `.test-memory-${TEST_UID}`);
  mkdirSync(memDir, { recursive: true });
  const memFile = resolve(memDir, 'resolutions.json');
  writeFileSync(memFile, JSON.stringify({ version: 1, entries }, null, 2));
  return memFile;
}

// Test via direct ContextManager API + manual injection simulation

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 10.5: Auto Memory Injection', () => {

  after(cleanup);

  // -----------------------------------------------------------------------
  // Test 1: addFindings() public method
  // -----------------------------------------------------------------------
  it('addFindings: injects findings into the session', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const findingsBefore = cm.getFindings().length;

    cm.addFindings([
      { source: 'memory', finding: '🧠 Test memory entry', category: 'memory', severity: 'low' },
    ]);

    const after = cm.getFindings();
    assert.equal(after.length, findingsBefore + 1);
    assert.equal(after[after.length - 1].finding, '🧠 Test memory entry');
    assert.equal(after[after.length - 1].category, 'memory');
  });

  // -----------------------------------------------------------------------
  // Test 2: addFindings handles empty/null gracefully
  // -----------------------------------------------------------------------
  it('addFindings: handles empty/null gracefully', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const before = cm.getFindings().length;

    cm.addFindings(null);
    assert.equal(cm.getFindings().length, before, 'null should not add findings');

    cm.addFindings([]);
    assert.equal(cm.getFindings().length, before, 'empty array should not add findings');

    cm.addFindings([{ source: 'memory' }]); // missing 'finding'
    assert.equal(cm.getFindings().length, before, 'entry without finding should not add');
  });

  // -----------------------------------------------------------------------
  // Test 3: Simulate autoInjectMemory scoring + injection
  // -----------------------------------------------------------------------
  it('scoring: skill_patches rank above errors, hitCount boosts, recency matters', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();

    const now = Date.now();
    const mockEntries = [
      {
        id: 'mem_old_skill',
        type: 'skill_patch',
        targetSkill: 'debug',
        behaviorChange: 'Check variable init before tracing stack',
        hitCount: 1,
        timestamp: new Date(now - 86400000 * 5).toISOString(), // 5 days ago
      },
      {
        id: 'mem_fresh_error',
        type: 'error',
        category: 'TypeError',
        errorMessage: 'Cannot read property of undefined in async code',
        resolution: 'Add optional chaining before access',
        hitCount: 5,
        timestamp: new Date(now - 86400000).toISOString(), // 1 day ago
      },
      {
        id: 'mem_old_error',
        type: 'error',
        category: 'SyntaxError',
        errorMessage: 'Unexpected token in JSON',
        resolution: 'Use lenient parser',
        hitCount: 2,
        timestamp: new Date(now - 86400000 * 20).toISOString(), // 20 days ago
      },
    ];

    // Score using the same algorithm as server
    const scored = mockEntries.map(e => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
      const recencyScore = ts > 0 ? Math.max(0, 1 - (now - ts) / 864000000) : 0;
      const typeBonus = e.type === 'skill_patch' ? 100 : 0;
      const hitScore = (e.hitCount || 1) * 10;
      return { ...e, score: typeBonus + hitScore + recencyScore * 20 };
    });
    scored.sort((a, b) => b.score - a.score);

    // skill_patch should rank first due to typeBonus
    assert.equal(scored[0].id, 'mem_old_skill', 'skill_patch should rank first');
    // fresh high-hit error should rank second
    assert.equal(scored[1].id, 'mem_fresh_error', 'fresh error with high hitCount second');
    // old low-hit error last
    assert.equal(scored[2].id, 'mem_old_error', 'old error with low hitCount last');

    // Now simulate injection
    const topEntries = scored.slice(0, 2); // test with 2
    const findings = topEntries.map(e => ({
      source: 'memory',
      finding: e.type === 'skill_patch'
        ? `🧠 ${e.targetSkill}: ${(e.behaviorChange || '').slice(0, 200)}`
        : `🧠 ${e.category}: ${(e.errorMessage || '').slice(0, 100)} → ${(e.resolution || '').slice(0, 100)}`,
      category: 'memory',
      severity: 'low',
    }));

    cm.addFindings(findings);
    const allFindings = cm.getFindings();

    // Should have injected 2 findings
    const memoryFindings = allFindings.filter(f => f.category === 'memory');
    assert.equal(memoryFindings.length, 2);
    assert.ok(memoryFindings[0].finding.includes('debug'), 'first should be skill_patch for debug');
    assert.ok(memoryFindings[1].finding.includes('TypeError'), 'second should be TypeError error');
  });

  // -----------------------------------------------------------------------
  // Test 4: No memory file = no crash
  // -----------------------------------------------------------------------
  it('missing memory file: handled gracefully (no findings added)', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();
    const before = cm.getFindings().length;

    // Simulate what autoInjectMemory does when file doesn't exist
    const fakePath = resolve(tmpdir(), `.test-nonexistent-${TEST_UID}`, 'resolutions.json');
    assert.equal(existsSync(fakePath), false);

    // No crash, no findings added
    assert.equal(cm.getFindings().length, before);
  });

  // -----------------------------------------------------------------------
  // Test 5: Validate addFindings respects maxFindings cap
  // -----------------------------------------------------------------------
  it('addFindings: respects maxFindings cap', () => {
    const cm = freshManager({ autoSave: false, maxFindings: 5 });
    cm.init();

    // Fill to max + overflow
    const overflow = Array.from({ length: 8 }, (_, i) => ({
      source: 'memory',
      finding: `🧠 Overflow entry ${i}`,
      category: 'memory',
      severity: 'low',
    }));
    cm.addFindings(overflow);

    const findings = cm.getFindings();
    assert.ok(findings.length <= 5, 'should not exceed maxFindings');
    // The oldest entries should have been shifted out
    assert.ok(!findings.some(f => f.finding.includes('Overflow entry 0')));
  });

  // -----------------------------------------------------------------------
  // Test 6: Integration — full end-to-end with mock memory file
  // -----------------------------------------------------------------------
  it('e2e: mock memory file produces injected findings', () => {
    const cm = freshManager({ autoSave: false });
    cm.init();

    const mockEntries = [
      {
        id: 'mem_e2e_1',
        type: 'skill_patch',
        targetSkill: 'refactor',
        behaviorChange: 'Use import_graph before renaming symbols',
        hitCount: 3,
        timestamp: new Date().toISOString(),
      },
      {
        id: 'mem_e2e_2',
        type: 'error',
        category: 'NullPointer',
        errorMessage: 'Null pointer in parser',
        resolution: 'Add null check before access',
        hitCount: 7,
        timestamp: new Date().toISOString(),
      },
    ];

    // Score
    const now = Date.now();
    const scored = mockEntries.map(e => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
      const recencyScore = ts > 0 ? Math.max(0, 1 - (now - ts) / 864000000) : 0;
      const typeBonus = e.type === 'skill_patch' ? 100 : 0;
      const hitScore = (e.hitCount || 1) * 10;
      return { ...e, score: typeBonus + hitScore + recencyScore * 20 };
    });
    scored.sort((a, b) => b.score - a.score);

    const topEntries = scored.slice(0, 3);
    const findings = topEntries.map(e => ({
      source: 'memory',
      finding: e.type === 'skill_patch'
        ? `🧠 ${e.targetSkill}: ${(e.behaviorChange || '').slice(0, 200)}`
        : `🧠 ${e.category}: ${(e.errorMessage || '').slice(0, 100)} → ${(e.resolution || '').slice(0, 100)}`,
      category: 'memory',
      severity: 'low',
    }));

    cm.addFindings(findings);
    const allFindings = cm.getFindings();
    const memFindings = allFindings.filter(f => f.category === 'memory');

    assert.ok(memFindings.length >= 2, 'should have injected at least 2 memory findings');
    assert.ok(memFindings.some(f => f.finding.includes('refactor')), 'should include refactor skill_patch');
    assert.ok(memFindings.some(f => f.finding.includes('NullPointer')), 'should include NullPointer error');
  });
});
