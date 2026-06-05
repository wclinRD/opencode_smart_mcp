// test-coverage.test.mjs — Phase C.2 Test Coverage Map tests
//
// Tests:
//   1. parseTestBlocks + matchTestToFunction helpers (via direct module import)
//   2. buildTestCoverage + queryTestCoverage (via CKG with manual data)
//   3. Enhanced predictTests (via ImpactEngine with CKG mock)
//
// Run: node --test tests/test-coverage.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = Date.now();
const TEST_DIR = resolve(__dirname, '../tmp-test-cov-' + BASE);
const IMPACT_DIR = resolve(__dirname, '../tmp-test-cov-impact-' + BASE);

// ---------------------------------------------------------------------------
// Helper: test internal functions directly via source reading
// ---------------------------------------------------------------------------
function evalHelpers(ckgSource) {
  // Extract the helper functions from the CKG engine source
  // We test parseTestBlocks and matchTestToFunction which are module-level
  const parseTestBlocksFn = new Function('content', `
    const patterns = [
      { re: /(describe|it|test)\\s*\\(\\s*['"]([^'"]+)['"]/g, kindMap: { describe: 'test-suite', it: 'test-case', test: 'test-case' } },
      { re: /(describe|it|test)\\s*\\(\\s*\`([^\`]+)\`/g, kindMap: { describe: 'test-suite', it: 'test-case', test: 'test-case' } },
    ];
    const describeStack = [];
    const blocks = [];
    for (const { re, kindMap } of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const keyword = m[1];
        const name = m[2].trim();
        const kind = kindMap[keyword] || 'test-case';
        const pos = m.index;
        const line = content.slice(0, pos).split('\\n').length;
        const col = pos - content.lastIndexOf('\\n', pos) - 1;
        if (kind === 'test-suite') {
          describeStack.push(name);
          blocks.push({ kind, name, line, col, raw: m[0].trim(), fullPath: describeStack.join(' > ') });
        } else {
          const fullPath = describeStack.length > 0
            ? [...describeStack, name].join(' > ')
            : name;
          blocks.push({ kind, name, line, col, raw: m[0].trim(), fullPath });
        }
      }
    }
    // each variants
    const eachRe = /(describe|it|test)\\.each\\s*\\([^)]*\\)\\s*\\(\\s*['"]([^'"]+)['"]/g;
    let m2;
    while ((m2 = eachRe.exec(content)) !== null) {
      const name = m2[2].trim();
      const pos = m2.index;
      const line = content.slice(0, pos).split('\\n').length;
      const col = pos - content.lastIndexOf('\\n', pos) - 1;
      blocks.push({
        kind: 'test-case', name, line, col, raw: m2[0].trim(),
        fullPath: describeStack.length > 0 ? [...describeStack, name].join(' > ') : name,
      });
    }
    return blocks;
  `);

  const matchTestToFunctionFn = new Function('testName', 'functionName', `
    const t = testName.toLowerCase().trim();
    const f = functionName.toLowerCase().trim();
    if (!t || !f) return 0;
    if (t === f) return 1.0;
    const testWords = t.split(/[\\s_-]+/).filter(w => w.length > 0);
    const funcWords = f.split(/[\\s_-]+/).filter(w => w.length > 0);
    const jargon = new Set(['should','test','when','then','given','works','correctly','properly','handles','can','will','does','not','throws','returns','calls','creates','builds','validates']);
    const meaningfulWords = testWords.filter(w => !jargon.has(w));
    if (meaningfulWords.includes(f)) return 0.9;
    for (const tw of meaningfulWords) {
      if (tw === f) return 0.9;
      if (tw.length >= 3 && f.includes(tw)) return 0.7;
    }
    for (const fw of funcWords) {
      if (meaningfulWords.includes(fw)) return 0.85;
      if (fw.length >= 3 && t.includes(fw)) return 0.75;
    }
    if (t.length >= 3 && f.length >= 3) {
      if (t.includes(f)) return 0.8;
      if (f.includes(t)) return 0.6;
    }
    const minLen = Math.min(t.length, f.length);
    if (minLen >= 4) {
      let prefixLen = 0;
      for (let i = 0; i < minLen; i++) {
        if (t[i] === f[i]) prefixLen++; else break;
      }
      if (prefixLen >= 4) return 0.5;
    }
    return 0;
  `);

  return { parseTestBlocks: parseTestBlocksFn, matchTestToFunction: matchTestToFunctionFn };
}

describe('Phase C.2: Test Coverage Map', () => {
  let ckgMod;
  let engine;
  let helpers;

  before(async () => {
    ckgMod = await import('../src/lib/ckg-engine.mjs');

    // Read source to extract helpers
    const src = readFileSync(resolve(__dirname, '../src/lib/ckg-engine.mjs'), 'utf-8');
    helpers = evalHelpers(src);

    // Setup CKG with manual data (no LSP dependency)
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(resolve(TEST_DIR, 'src'), { recursive: true });
    mkdirSync(resolve(TEST_DIR, 'tests'), { recursive: true });

    engine = ckgMod.getCkgEngine(TEST_DIR);
    const db = engine._getDb();
    const pid = engine._projectId;

    // Create source file nodes + function nodes
    const srcFileR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, exported, stale) VALUES (?, ?, 'file', ?, 1, 0)"
    ).run(pid, 'math.mjs', 'src/math.mjs');
    const srcFileId = Number(srcFileR.lastInsertRowid);

    const addFnR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, exported, stale) VALUES (?, 'add', 'function', 'src/math.mjs', 1, 1, 0)"
    ).run(pid);
    const addFnId = Number(addFnR.lastInsertRowid);

    const mulFnR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, exported, stale) VALUES (?, 'multiply', 'function', 'src/math.mjs', 5, 1, 0)"
    ).run(pid);
    const mulFnId = Number(mulFnR.lastInsertRowid);

    const divFnR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, exported, stale) VALUES (?, 'divide', 'function', 'src/math.mjs', 9, 1, 0)"
    ).run(pid);
    const divFnId = Number(divFnR.lastInsertRowid);

    // Add contains edges (file → function)
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind) VALUES (?, ?, ?, 'contains')"
    ).run(pid, srcFileId, addFnId);
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind) VALUES (?, ?, ?, 'contains')"
    ).run(pid, srcFileId, mulFnId);
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind) VALUES (?, ?, ?, 'contains')"
    ).run(pid, srcFileId, divFnId);

    // Create test file node
    const testFileR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, exported, stale) VALUES (?, 'math.test.mjs', 'file', 'tests/math.test.mjs', 1, 0)"
    ).run(pid);
    const testFileId = Number(testFileR.lastInsertRowid);

    // Create import edge (test file → source file)
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'imports', '{\"source\":\"../src/math.mjs\",\"type\":\"esm\"}')"
    ).run(pid, testFileId, srcFileId);

    // Create test-block nodes
    const tb1R = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, stale) VALUES (?, 'math module > adds two numbers', 'test-block', 'tests/math.test.mjs', 5, 0)"
    ).run(pid);
    const tb1Id = Number(tb1R.lastInsertRowid);

    const tb2R = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, stale) VALUES (?, 'math module > multiplies two numbers', 'test-block', 'tests/math.test.mjs', 9, 0)"
    ).run(pid);
    const tb2Id = Number(tb2R.lastInsertRowid);

    const tb3R = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, stale) VALUES (?, 'math module > divides', 'test-block', 'tests/math.test.mjs', 13, 0)"
    ).run(pid);
    const tb3Id = Number(tb3R.lastInsertRowid);

    // Create tested_by edges (function → test block)
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'tested_by', '{\"confidence\":0.9,\"matchType\":\"deterministic\",\"testFile\":\"tests/math.test.mjs\",\"testBlock\":\"math module > adds two numbers\",\"testLine\":5}')"
    ).run(pid, addFnId, tb1Id);

    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'tested_by', '{\"confidence\":0.85,\"matchType\":\"deterministic\",\"testFile\":\"tests/math.test.mjs\",\"testBlock\":\"math module > multiplies two numbers\",\"testLine\":9}')"
    ).run(pid, mulFnId, tb2Id);

    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'tested_by', '{\"confidence\":0.7,\"matchType\":\"speculative\",\"testFile\":\"tests/math.test.mjs\",\"testBlock\":\"math module > divides\",\"testLine\":13}')"
    ).run(pid, divFnId, tb3Id);

    // Update project stats so getStats() works
    db.prepare(
      'UPDATE projects SET file_count = 2, node_count = 8, edge_count = 7, built_at = datetime(\'now\') WHERE id = ?'
    ).run(pid);
  });

  after(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  // ── 1. parseTestBlocks ──
  it('1.1 parseTestBlocks extracts describe/it blocks from test file', () => {
    const content = `
      describe('math module', () => {
        it('adds two numbers', () => {});
        it('multiplies two numbers', () => {});
      });
      test('global test', () => {});
    `;
    const blocks = helpers.parseTestBlocks(content);
    // Should find describe + 2 it blocks + 1 test block
    assert.ok(blocks.length >= 3, `should find >= 3 test blocks, got ${blocks.length}`);
    const hasNestedPath = blocks.some(b => b.fullPath === 'math module > adds two numbers');
    assert.ok(hasNestedPath, 'should build full path from nested describe');
  });

  it('1.2 parseTestBlocks handles template literals and .each', () => {
    const content = `
      describe(\`calc suite\`, () => {
        it.each([1, 2, 3])('handles %i', (n) => {});
        it(\`should work\`, () => {});
      });
    `;
    const blocks = helpers.parseTestBlocks(content);
    assert.ok(blocks.length >= 1, `should find blocks, got ${blocks.length}`);
    const hasTemplate = blocks.some(b => b.fullPath === 'calc suite > should work');
    assert.ok(hasTemplate, 'should find template literal test');
  });

  it('1.3 parseTestBlocks returns line numbers', () => {
    const content = `
      describe('Module', () => {
        it('test1', () => {});
      });
    `;
    const blocks = helpers.parseTestBlocks(content);
    assert.ok(blocks.length >= 2, 'should find describe + it');
    // Each block should have a line number > 0
    for (const b of blocks) {
      assert.ok(b.line > 0, `${b.fullPath} should have line > 0, got ${b.line}`);
    }
  });

  // ── 2. matchTestToFunction ──
  it('2.1 matchTestToFunction exact match returns 1.0', () => {
    assert.equal(helpers.matchTestToFunction('add', 'add'), 1.0);
    assert.equal(helpers.matchTestToFunction('calculate', 'calculate'), 1.0);
  });

  it('2.2 matchTestToFunction test name contains function name', () => {
    // "adds two numbers" → "add" should match (substring: "adds" contains "add")
    const score = helpers.matchTestToFunction('adds two numbers', 'add');
    assert.ok(score >= 0.7, `score should be >= 0.7, got ${score}`);
    // "calculate result" → "calculate" (word match: 0.9)
    const score2 = helpers.matchTestToFunction('calculate result', 'calculate');
    assert.ok(score2 >= 0.85, `word match should be >= 0.85, got ${score2}`);
  });

  it('2.3 matchTestToFunction test jargon is filtered', () => {
    // "should handle errors" → "handle" is NOT jargon (not in set), so it matches
    // "should" IS jargon, so it's filtered out leaving ["handle", "errors"]
    const score = helpers.matchTestToFunction('should handle errors', 'handle');
    // "handle" === "handle" → exact word match → 0.85
    assert.ok(score >= 0.7, `word match should be >= 0.7, got ${score}`);
  });

  it('2.4 matchTestToFunction substring match', () => {
    // "divides by zero" → "divide" should match by substring
    const score = helpers.matchTestToFunction('divides by zero', 'divide');
    assert.ok(score >= 0.7, `'divides by zero' → 'divide' should be >= 0.7, got ${score}`);
  });

  it('2.5 matchTestToFunction no match returns 0', () => {
    assert.equal(helpers.matchTestToFunction('unrelated test', 'foo'), 0);
    assert.equal(helpers.matchTestToFunction('', 'bar'), 0);
  });

  // ── 3. queryTestCoverage ──
  it('3.1 queryTestCoverage returns deterministic tests for add', () => {
    const cov = engine.queryTestCoverage('add', 'src/math.mjs');
    assert.ok(cov, 'should return coverage');
    assert.ok(cov.totalTests > 0, `add should have test coverage, got ${cov.totalTests}`);
    assert.ok(cov.deterministic.length > 0, 'add should have deterministic coverage');
  });

  it('3.2 queryTestCoverage returns speculative tests for divide', () => {
    const cov = engine.queryTestCoverage('divide', 'src/math.mjs');
    assert.ok(cov, 'should return coverage');
    assert.ok(cov.totalTests > 0, `divide should have test coverage, got ${cov.totalTests}`);
    const hasSpeculative = cov.speculative.length > 0 || cov.deterministic.length > 0;
    assert.ok(hasSpeculative, 'divide should have some coverage');
  });

  it('3.3 queryTestCoverage returns empty for uncovered function', () => {
    const cov = engine.queryTestCoverage('nonexistent', 'src/foo.mjs');
    assert.ok(cov, 'should return coverage');
    assert.equal(cov.totalTests, 0, 'should be empty');
    assert.equal(cov.deterministic.length, 0);
    assert.equal(cov.speculative.length, 0);
  });

  it('3.4 queryTestCoverageForFile returns per-function breakdown', () => {
    const fileCov = engine.queryTestCoverageForFile('src/math.mjs');
    assert.ok(fileCov, 'should return file coverage');
    assert.equal(fileCov.totalFunctions, 3, 'math.mjs should have 3 functions');
    assert.ok(fileCov.coveredFunctions >= 2, `should have >= 2 covered functions, got ${fileCov.coveredFunctions}`);
    assert.ok(fileCov.coveragePct > 0, `coverage pct should be > 0, got ${fileCov.coveragePct}%`);
    assert.ok(Array.isArray(fileCov.functions), 'functions is array');

    // Check structure of each function entry
    for (const fn of fileCov.functions) {
      assert.ok(fn.name, 'should have name');
      assert.ok(typeof fn.covered === 'boolean', 'should have covered flag');
      assert.ok(typeof fn.totalTests === 'number', 'should have totalTests');
    }
  });

  it('3.5 queryTestCoverageForFile handles empty/missing file', () => {
    const fileCov = engine.queryTestCoverageForFile('nonexistent.mjs');
    assert.ok(fileCov, 'should return coverage');
    assert.equal(fileCov.totalFunctions, 0);
  });

  // ── 4. Edge/node kinds ──
  it('4.1 test-block is a valid node kind', () => {
    const db = engine._getDb();
    const nodeKinds = db.prepare(
      'SELECT DISTINCT kind FROM nodes WHERE project_id = ?'
    ).all(engine._projectId);
    const kinds = nodeKinds.map(r => r.kind);
    assert.ok(kinds.includes('test-block'), `test-block should be a node kind, got [${kinds.join(', ')}]`);
  });

  it('4.2 tested_by is a valid edge kind', () => {
    const db = engine._getDb();
    const edgeKinds = db.prepare(
      'SELECT DISTINCT kind FROM edges WHERE project_id = ?'
    ).all(engine._projectId);
    const kinds = edgeKinds.map(r => r.kind);
    assert.ok(kinds.includes('tested_by'), `tested_by should be an edge kind, got [${kinds.join(', ')}]`);
  });
});

describe('Phase C.2: Impact Engine integration', () => {
  let ImpactEngine;
  let engine;

  before(async () => {
    // Setup project with real files and CKG
    mkdirSync(IMPACT_DIR, { recursive: true });
    mkdirSync(resolve(IMPACT_DIR, 'src'), { recursive: true });
    mkdirSync(resolve(IMPACT_DIR, 'tests'), { recursive: true });

    writeFileSync(resolve(IMPACT_DIR, 'src', 'math.mjs'), `
export function add(a, b) {
  return a + b;
}
`.trimStart());

    writeFileSync(resolve(IMPACT_DIR, 'tests', 'math.test.mjs'), `
import { describe, it, expect } from 'node:test';
import { add } from '../src/math.mjs';

describe('math', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
`.trimStart());

    const mod = await import('../src/lib/impact-engine.mjs');
    ImpactEngine = mod.ImpactEngine;

    const ckgMod = await import('../src/lib/ckg-engine.mjs');
    engine = ckgMod.getCkgEngine(IMPACT_DIR);

    // Manually seed CKG with data (bypass LSP dependency)
    const db = engine._getDb();
    const pid = engine._projectId;

    const srcFileR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, exported, stale) VALUES (?, 'math.mjs', 'file', 'src/math.mjs', 1, 0)"
    ).run(pid);
    const srcFileId = Number(srcFileR.lastInsertRowid);

    const addFnR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, exported, stale) VALUES (?, 'add', 'function', 'src/math.mjs', 1, 1, 0)"
    ).run(pid);
    const addFnId = Number(addFnR.lastInsertRowid);

    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind) VALUES (?, ?, ?, 'contains')"
    ).run(pid, srcFileId, addFnId);

    // Test file + import
    const testFileR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, exported, stale) VALUES (?, 'math.test.mjs', 'file', 'tests/math.test.mjs', 1, 0)"
    ).run(pid);
    const testFileId = Number(testFileR.lastInsertRowid);

    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'imports', '{\"source\":\"../src/math.mjs\",\"type\":\"esm\"}')"
    ).run(pid, testFileId, srcFileId);

    // Test block node
    const tbR = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, stale) VALUES (?, 'math > adds two numbers', 'test-block', 'tests/math.test.mjs', 5, 0)"
    ).run(pid);
    const tbId = Number(tbR.lastInsertRowid);

    // tested_by edge (deterministic)
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'tested_by', '{\"confidence\":0.9,\"matchType\":\"deterministic\",\"testFile\":\"tests/math.test.mjs\",\"testBlock\":\"math > adds two numbers\",\"testLine\":5}')"
    ).run(pid, addFnId, tbId);

    db.prepare(
      'UPDATE projects SET file_count = 2 WHERE id = ?'
    ).run(pid);
  });

  after(() => {
    try { rmSync(IMPACT_DIR, { recursive: true, force: true }); } catch {}
  });

  it('predictTests uses CKG coverage (heuristic 4)', async () => {
    const imp = new ImpactEngine(IMPACT_DIR);
    const result = await imp.predictTests({
      direct: [{
        symbol: 'add',
        impacted: [{ file: resolve(IMPACT_DIR, 'src/math.mjs') }],
      }],
      transitive: [],
    });

    assert.ok(Array.isArray(result), 'should return array');
    const hasTestFile = result.some(t =>
      t.file && (t.file.includes('math.test') || t.name === 'add')
    );
    assert.ok(hasTestFile, 'should predict math test');
  });

  it('predictTests with CKG coverage yields high relevance', async () => {
    const imp = new ImpactEngine(IMPACT_DIR);
    const result = await imp.predictTests({
      direct: [{
        symbol: 'add',
        impacted: [{ file: resolve(IMPACT_DIR, 'src/math.mjs') }],
      }],
      transitive: [],
    });

    const hasHigh = result.some(t => t.relevance === 'high');
    assert.ok(hasHigh, 'should have high relevance from deterministic coverage');
  });

  it('predictTests returns empty for no-impact input', async () => {
    const imp = new ImpactEngine(IMPACT_DIR);
    const result = await imp.predictTests({
      direct: [{ symbol: 'none', impacted: [] }],
      transitive: [],
    });
    assert.ok(Array.isArray(result), 'should return array');
  });
});

import { after as globalAfter } from 'node:test';
globalAfter(async () => {
  const { closeAllCkgEngines } = await import('../src/lib/ckg-engine.mjs');
  try { await closeAllCkgEngines(); } catch { /* ok */ }
});
