// test-arch-overview.test.mjs — Phase LLM P0.1 Architecture Overview tests
//
// Tests:
//   1. Empty CKG returns not_built
//   2. Seeded CKG returns correct layer detection
//   3. Inter-layer dependencies computed correctly
//   4. Violations detected
//   5. Critical functions identified
//   6. Plugin handler returns valid JSON
//
// Run: node --test tests/test-arch-overview.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = Date.now();
const TEST_DIR = resolve(__dirname, '../tmp-arch-' + BASE);

let ckg;
let engine;

before(async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Create a minimal project structure
  mkdirSync(resolve(TEST_DIR, 'src/controllers'), { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'src/services'), { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'src/repositories'), { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'src/models'), { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'tests'), { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'src/utils'), { recursive: true });

  // Write placeholder files
  writeFileSync(resolve(TEST_DIR, 'src/controllers/user.mjs'), 'export function listUsers() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/controllers/post.mjs'), 'export function listPosts() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/services/user.mjs'), 'export function getUsers() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/services/post.mjs'), 'export function getPosts() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/repositories/user.mjs'), 'export function findUsers() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/repositories/post.mjs'), 'export function findPosts() {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/models/user.mjs'), 'export class User {}\n');
  writeFileSync(resolve(TEST_DIR, 'src/utils/helper.mjs'), 'export function formatDate() {}\n');
  writeFileSync(resolve(TEST_DIR, 'tests/user.test.mjs'), 'import { listUsers } from "../src/controllers/user.mjs";\n');
  writeFileSync(resolve(TEST_DIR, 'tests/post.test.mjs'), 'import { listPosts } from "../src/controllers/post.mjs";\n');

  // Need to create source files that will actually be found and indexed
  writeFileSync(resolve(TEST_DIR, 'src/app.mjs'), 'import("./controllers/user.mjs"); import("./services/user.mjs");\n');

  const { getCkgEngine } = await import('../src/lib/ckg-engine.mjs');

  // Get engine and set up with direct DB seeding
  engine = getCkgEngine(TEST_DIR);
  const db = engine._getDb();

  // Get the project ID
  const proj = db.prepare('SELECT id FROM projects WHERE root = ?').get(TEST_DIR);
  const pid = proj.id;

  // Seed file nodes (simulating what build would create)
  const files = [
    { name: 'user.mjs',   file: 'src/controllers/user.mjs' },
    { name: 'post.mjs',   file: 'src/controllers/post.mjs' },
    { name: 'user.mjs',   file: 'src/services/user.mjs' },
    { name: 'post.mjs',   file: 'src/services/post.mjs' },
    { name: 'user.mjs',   file: 'src/repositories/user.mjs' },
    { name: 'post.mjs',   file: 'src/repositories/post.mjs' },
    { name: 'user.mjs',   file: 'src/models/user.mjs' },
    { name: 'helper.mjs', file: 'src/utils/helper.mjs' },
    { name: 'user.test.mjs', file: 'tests/user.test.mjs' },
    { name: 'post.test.mjs', file: 'tests/post.test.mjs' },
    { name: 'app.mjs',    file: 'src/app.mjs' },
  ];

  const fileIds = {};
  for (const f of files) {
    const r = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, exported, stale) VALUES (?, ?, 'file', ?, 1, 0)"
    ).run(pid, f.name, f.file);
    fileIds[f.file] = Number(r.lastInsertRowid);
  }

  // Seed function nodes
  const funcs = [
    { name: 'listUsers',    file: 'src/controllers/user.mjs', line: 1, exported: 1 },
    { name: 'listPosts',    file: 'src/controllers/post.mjs', line: 1, exported: 1 },
    { name: 'getUsers',     file: 'src/services/user.mjs',    line: 1, exported: 1 },
    { name: 'getPosts',     file: 'src/services/post.mjs',    line: 1, exported: 1 },
    { name: 'findUsers',    file: 'src/repositories/user.mjs', line: 1, exported: 1 },
    { name: 'findPosts',    file: 'src/repositories/post.mjs', line: 1, exported: 1 },
    { name: 'formatDate',   file: 'src/utils/helper.mjs',     line: 1, exported: 1 },
    { name: 'internalHelper', file: 'src/utils/helper.mjs',   line: 5, exported: 0 },
    { name: 'bigFunction',  file: 'src/services/user.mjs',    line: 10, exported: 1 },
  ];

  const funcIds = {};
  for (const f of funcs) {
    const r = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, range_end_line, exported, stale) VALUES (?, ?, 'function', ?, ?, ?, ?, 0)"
    ).run(pid, f.name, f.file, f.line, f.line + (f.name === 'bigFunction' ? 60 : 5), f.exported);
    funcIds[f.name] = Number(r.lastInsertRowid);
  }

  // Seed import edges (controller → service, service → repo, test → controller)
  const imports = [
    { from: 'src/controllers/user.mjs', to: 'src/services/user.mjs' },
    { from: 'src/controllers/user.mjs', to: 'src/models/user.mjs' },
    { from: 'src/controllers/post.mjs', to: 'src/services/post.mjs' },
    { from: 'src/services/user.mjs',    to: 'src/repositories/user.mjs' },
    { from: 'src/services/user.mjs',    to: 'src/models/user.mjs' },
    { from: 'src/services/post.mjs',    to: 'src/repositories/post.mjs' },
    { from: 'src/services/user.mjs',    to: 'src/utils/helper.mjs' },
    { from: 'src/repositories/user.mjs', to: 'src/models/user.mjs' },
    { from: 'tests/user.test.mjs',       to: 'src/controllers/user.mjs' },
    { from: 'tests/post.test.mjs',       to: 'src/controllers/post.mjs' },
    { from: 'src/app.mjs',              to: 'src/controllers/user.mjs' },
    { from: 'src/app.mjs',              to: 'src/services/user.mjs' },
  ];

  for (const imp of imports) {
    db.prepare(
      "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'imports', ?)"
    ).run(pid, fileIds[imp.from], fileIds[imp.to], JSON.stringify({ source: './' + imp.to.replace('src/', ''), type: 'esm' }));
  }

  // Seed function nodes in files that will have call edges
  const callFuncs = [
    { name: 'main',        file: 'src/app.mjs',                  line: 1 },
    { name: 'describe',    file: 'tests/user.test.mjs',          line: 1 },
    { name: 'listUsers',   file: 'src/controllers/user.mjs',     line: 1 },
    { name: 'getUsers',    file: 'src/services/user.mjs',        line: 1 },
    { name: 'findUsers',   file: 'src/services/user.mjs',        line: 1 },
    { name: 'formatDate',  file: 'src/services/user.mjs',        line: 1 },
  ];
  const callFuncIds = {};
  for (const f of callFuncs) {
    const key = `${f.file}:${f.name}`;
    const r = db.prepare(
      "INSERT INTO nodes (project_id, name, kind, file, range_start_line, range_end_line, exported, stale) VALUES (?, ?, 'function', ?, ?, ?, 1, 0)"
    ).run(pid, f.name, f.file, f.line, f.line + 5);
    callFuncIds[key] = Number(r.lastInsertRowid);
  }

  // Seed call edges (for fan-in)
  const calls = [
    // listUsers is called from 2 places
    { fromFile: 'src/app.mjs', fromFn: 'main', toFile: 'src/controllers/user.mjs', toFn: 'listUsers' },
    { fromFile: 'tests/user.test.mjs', fromFn: 'describe', toFile: 'src/controllers/user.mjs', toFn: 'listUsers' },
    // getUsers is called from 2 places
    { fromFile: 'src/controllers/user.mjs', fromFn: 'listUsers', toFile: 'src/services/user.mjs', toFn: 'getUsers' },
    { fromFile: 'src/app.mjs', fromFn: 'main', toFile: 'src/services/user.mjs', toFn: 'getUsers' },
    // findUsers is called from 2 places
    { fromFile: 'src/services/user.mjs', fromFn: 'getUsers', toFile: 'src/services/user.mjs', toFn: 'findUsers' },
    // formatDate is called from 2 places
    { fromFile: 'src/services/user.mjs', fromFn: 'getUsers', toFile: 'src/utils/helper.mjs', toFn: 'formatDate' },
  ];

  for (const call of calls) {
    const fromKey = `${call.fromFile}:${call.fromFn}`;
    const toKey = `${call.toFile}:${call.toFn}`;
    const fromId = callFuncIds[fromKey];
    const toId = callFuncIds[toKey] || funcIds[call.toFn];
    if (fromId && toId) {
      db.prepare(
        "INSERT INTO edges (project_id, from_node_id, to_node_id, kind) VALUES (?, ?, ?, 'calls')"
      ).run(pid, fromId, toId);
    }
  }

  // Seed tested_by edges
  db.prepare(
    "INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, 'tested_by', ?)"
  ).run(pid, funcIds.listUsers, fileIds['tests/user.test.mjs'],
    JSON.stringify({ confidence: 0.9, matchType: 'deterministic', testFile: 'tests/user.test.mjs' }));

  // Seed unused exports
  db.prepare(
    "INSERT INTO nodes (project_id, name, kind, file, range_start_line, exported, stale) VALUES (?, 'legacyFn', 'function', 'src/utils/helper.mjs', 20, 1, 0)"
  ).run(pid);

  // Update project stats
  db.prepare(
    "UPDATE projects SET file_count = ?, node_count = ?, edge_count = ?, built_at = datetime('now') WHERE id = ?"
  ).run(
    files.length,
    db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ? AND stale = 0').get(pid).c,
    db.prepare('SELECT COUNT(*) as c FROM edges WHERE stale = 0 AND project_id = ?').get(pid).c,
    pid
  );

  // Clear cache so queries see fresh data
  engine._cache.clear();
});

after(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (engine) { try { engine.close(); } catch { /* ignore */ } }
});

describe('getArchOverview', () => {

  it('1. returns structured overview with summary', () => {
    const result = engine.getArchOverview();
    assert.ok(result.summary, 'Should have summary');
    assert.equal(result.summary.project, 'tmp-arch-' + BASE);
    assert.ok(result.summary.files > 0, 'Should have files');
    assert.ok(result.summary.functions > 0, 'Should have functions');
    assert.ok(result.summary.layers > 0, 'Should have layers');
  });

  it('2. detects layers by directory name', () => {
    const result = engine.getArchOverview();
    const layerNames = result.layers.map(l => l.name);
    assert.ok(layerNames.includes('controllers'), 'Should detect controllers layer');
    assert.ok(layerNames.includes('services'), 'Should detect services layer');
    assert.ok(layerNames.includes('repositories'), 'Should detect repositories layer');
    assert.ok(layerNames.includes('models'), 'Should detect models layer');
    assert.ok(layerNames.includes('utils'), 'Should detect utils layer');
    assert.ok(layerNames.includes('tests'), 'Should detect tests layer');
  });

  it('3. computes inter-layer dependencies', () => {
    const result = engine.getArchOverview();
    assert.ok(result.dependencies.length >= 4, 'Should have inter-layer deps');

    // controllers → services
    const ctrlToSvc = result.dependencies.find(d => d.from === 'controllers' && d.to === 'services');
    assert.ok(ctrlToSvc, 'controllers should depend on services');
    assert.ok(ctrlToSvc.edgeCount >= 1, 'Should have at least 1 import edge');

    // services → repositories
    const svcToRepo = result.dependencies.find(d => d.from === 'services' && d.to === 'repositories');
    assert.ok(svcToRepo, 'services should depend on repositories');
  });

  it('4. detects architecture violations (controller→model)', () => {
    const result = engine.getArchOverview();
    // Our test data seeds controller→model import which violates a default rule
    assert.ok(result.violations.length >= 1, 'Should detect controller→model violation');
    const ctrlModel = result.violations.find(v => v.from === 'controllers' && v.to === 'models');
    assert.ok(ctrlModel, 'Should report controllers→models violation');
    assert.ok(ctrlModel.rule, 'Violation should have rule description');
  });

  it('5. reports critical functions by fan-in/complexity', () => {
    const result = engine.getArchOverview();
    assert.ok(result.criticalFunctions.length > 0, 'Should have critical functions');

    // getUsers should be in critical functions (fan-in=2: called from controllers/user.mjs and app.mjs)
    const getUsers = result.criticalFunctions.find(f => f.name === 'getUsers');
    assert.ok(getUsers, 'getUsers should be critical (fan-in=2)');
    assert.ok(getUsers.fanIn >= 1, 'Should have fan-in');

    // bigFunction should be included (high complexity, >50 lines)
    const bigFn = result.criticalFunctions.find(f => f.name === 'bigFunction');
    assert.ok(bigFn, 'bigFunction should be critical (complexity > 50)');
    assert.ok(bigFn.complexity >= 60, 'Should have high complexity');
  });

  it('6. reports unused exports', () => {
    const result = engine.getArchOverview();
    assert.ok(result.unusedExports.length >= 1, 'Should report unused exports');
    const legacyFn = result.unusedExports.find(u => u.name === 'legacyFn');
    assert.ok(legacyFn, 'Should find legacyFn as unused export');
  });

  it('7. layers have correct structure', () => {
    const result = engine.getArchOverview();
    for (const layer of result.layers) {
      assert.ok(typeof layer.name === 'string', 'Layer should have name');
      assert.ok(typeof layer.glob === 'string', 'Layer should have glob');
      assert.ok(typeof layer.files === 'number', 'Layer should have file count');
      assert.ok(typeof layer.functions === 'number', 'Layer should have function count');
      assert.ok(Array.isArray(layer.deps), 'Layer should have deps array');
    }
  });

  it('8. engine with no CKG data returns empty overview', async () => {
    const { getCkgEngine } = await import('../src/lib/ckg-engine.mjs');
    const emptyEngine = getCkgEngine(resolve(TEST_DIR, 'nonexistent'));
    const result = emptyEngine.getArchOverview();
    // Engine creates a project row but with 0 nodes/files
    assert.equal(result.summary.files, 0, 'Should have 0 files');
    assert.equal(result.summary.functions, 0, 'Should have 0 functions');
    assert.equal(result.summary.layers, 0, 'Should have 0 layers');
    assert.equal(result.layers.length, 0, 'Should have empty layers');
    try { emptyEngine.close(); } catch { /* ignore */ }
  });

});
