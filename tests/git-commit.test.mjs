// git-commit.test.mjs — Tests for smart_git_commit tool
//
// Tests commit message generation and CLI behavior:
//   1. Single file change → correct file-based summary
//   2. New files dominate → 'add' verb + filenames
//   3. Type override works
//   4. Custom message works
//   5. --help flag works
//   6. JSON format works
//   7. Scope detection (common ancestor path)
//   8. Type auto-detection (docs-only, test-only, config-only)
//
// Run: node --test tests/git-commit.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname, '../src/cli');
const TEST_ROOT = resolve(__dirname, '../.test-git-' + Date.now());

function runCLI(cliFile, args) {
  const result = spawnSync('node', [resolve(CLI_DIR, cliFile), ...args], {
    encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 200,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function runCommit(args) {
  return runCLI('git-commit.mjs', args);
}

function runReview(args) {
  return runCLI('git-review.mjs', args);
}

function runPR(args) {
  return runCLI('git-pr.mjs', args);
}

function parseJSON(output) {
  try { return JSON.parse(output.stdout); } catch { return null; }
}

function git(root, ...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf-8', timeout: 5000 });
  return r.stdout.trim();
}

function mkTempRepo() {
  const dir = TEST_ROOT + '-' + Math.random().toString(36).slice(2, 6);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  // Rename default branch (master) to main for consistent testing
  git(dir, 'branch', '-m', 'main');
  writeFileSync(resolve(dir, 'README.md'), '# Test\n', 'utf-8');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

/**
 * Make a file in repoDir, ensuring parent directories exist.
 */
function makeFile(repoDir, filePath, content) {
  const fullPath = resolve(repoDir, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function rmTempRepo(dir) {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('smart_git_commit — CLI and heuristic engine', () => {

  // 1. --help flag
  it('1. --help prints usage', () => {
    const res = runCommit(['--help']);
    assert.equal(res.status, 0, `--help failed: ${res.stderr}`);
    assert.ok(res.stdout.includes('Usage:'), 'should show usage');
    assert.ok(res.stdout.includes('--type'), 'should mention --type');
    assert.ok(res.stdout.includes('--dry-run'), 'should mention --dry-run');
  });

  // 2. Not a git repo
  it('2. fails gracefully outside git repo', () => {
    const res = runCommit(['--root', TEST_ROOT, '--dry-run']);
    assert.notEqual(res.status, 0, 'should fail outside git repo');
    assert.ok(res.stderr.includes('Not a git repository') || res.stderr.includes('fatal'), 'should show git error');
  });
});

describe('smart_git_commit — message generation in a real repo', () => {
  let repoDir;

  before(() => {
    repoDir = mkTempRepo();
  });

  after(() => {
    rmTempRepo(repoDir);
  });

  // 3. Single new file → "add" verb + filename
  it('3. new file generates "add <filename>"', () => {
    writeFileSync(resolve(repoDir, 'login.js'), 'function login() {}\nexport default login;\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--format', 'json']);
    assert.equal(res.status, 0, `dry-run failed: ${res.stderr}`);
    const data = parseJSON(res);
    assert.ok(data, 'should return JSON');
    assert.equal(data.status, 'dry-run');
    assert.ok(data.message.startsWith('feat'), 'type should be feat for new file');
    assert.ok(data.message.toLowerCase().includes('login'), 'message should mention "login"');
    // Commit to keep staged area clean for next test
    git(repoDir, 'commit', '-m', 'tmp: login');
  });

  // 4. Single modified file → "update" verb + filename
  it('4. modified file generates "update <filename>"', () => {
    writeFileSync(resolve(repoDir, 'login.js'), 'function login(user) { return user; }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data, 'should return JSON');
    assert.ok(data.message.includes('login'), 'message should mention login');
    git(repoDir, 'commit', '-m', 'tmp: update login');
  });

  // 5. Type override works
  it('5. --type override changes commit type', () => {
    writeFileSync(resolve(repoDir, 'style.css'), 'body { color: red; }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--type', 'style', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data.message.startsWith('style'), 'should use overridden type');
    git(repoDir, 'commit', '-m', 'tmp: style');
  });

  // 6. Custom --message works
  it('6. --message bypasses generation', () => {
    writeFileSync(resolve(repoDir, 'custom.txt'), 'hello\n', 'utf-8');
    git(repoDir, 'add', '.');
    const customMsg = 'custom: test message';
    const res = runCommit(['--root', repoDir, '--dry-run', '--message', customMsg, '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.equal(data.message, customMsg, 'should use provided message');
    git(repoDir, 'commit', '-m', 'tmp: custom');
  });

  // 7. Docs-only → auto-detect type "docs"
  it('7. docs-only changes detect type "docs"', () => {
    writeFileSync(resolve(repoDir, 'CHANGELOG.md'), '# v2.0\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data.message.startsWith('docs'), 'docs-only should detect type "docs"');
    git(repoDir, 'commit', '-m', 'tmp: changelog');
  });

  // 8. Scope detection
  it('8. --scope override and detection', () => {
    makeFile(repoDir, 'src/api/handler.js', 'export function get() {}\n');
    makeFile(repoDir, 'src/api/route.js', 'export function route() {}\n');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--type', 'feat', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    // Both files under src/api/ → scope should be "src/api"
    assert.ok(data.message.includes('handler') || data.message.includes('route'), 'message should mention files');
    assert.equal(data.commitScope, 'src/api', 'scope should be "src/api" for common ancestor');
    git(repoDir, 'commit', '-m', 'tmp: scope test');
  });

  // 9. JSON format is valid
  it('9. JSON output is valid', () => {
    writeFileSync(resolve(repoDir, 'dummy.txt'), 'x\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runCommit(['--root', repoDir, '--dry-run', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data, 'should be valid JSON');
    assert.ok(typeof data.message === 'string', 'message should be string');
    assert.ok(Array.isArray(data.files), 'files should be array');
  });
});

// ---------------------------------------------------------------------------
// git-review tests
// ---------------------------------------------------------------------------

describe('smart_git_review — CLI', () => {

  it('1. --help prints usage', () => {
    const res = runReview(['--help']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Usage:'), 'should show usage');
    assert.ok(res.stdout.includes('--focus'), 'should mention --focus');
    assert.ok(res.stdout.includes('--pr'), 'should mention --pr');
  });

  it('2. outside git repo fails gracefully', () => {
    const res = runReview(['--root', TEST_ROOT]);
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.toLowerCase().includes('not a git') || res.stderr.includes('fatal'), 'should show git error');
  });
});

describe('smart_git_review — in a real repo', () => {
  let repoDir;

  before(() => {
    repoDir = mkTempRepo();
  });

  after(() => {
    rmTempRepo(repoDir);
  });

  it('3. reviews a simple diff', () => {
    writeFileSync(resolve(repoDir, 'app.js'),
      'const x = 10;\nif (x == "10") { console.log("hello"); }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--no-color']);
    assert.equal(res.status, 0);
    // Should find the == vs === issue
    assert.ok(res.stdout.includes('===') || res.stdout.includes('code'), 'should find something');
  });

  it('4. JSON format is valid', () => {
    const res = runReview(['--root', repoDir, '--staged', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data, 'should be valid JSON');
    assert.ok(data.hasOwnProperty('summary'), 'should have summary');
    assert.ok(data.hasOwnProperty('issues'), 'should have issues');
    assert.ok(data.hasOwnProperty('comments'), 'should have comments');
  });

  it('5. focus=security works', () => {
    writeFileSync(resolve(repoDir, 'danger.js'),
      'const { exec } = require("child_process");\nexec("rm -rf /");\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'security', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('critical') || res.stdout.includes('high'), 'security focus should find critical issues');
  });

  it('6. markdown format works', () => {
    const res = runReview(['--root', repoDir, '--staged', '--format', 'markdown']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('# ') || res.stdout.includes('##'), 'markdown should have headers');
  });

  it('7. detects innerHTML XSS risk', () => {
    writeFileSync(resolve(repoDir, 'xss.js'),
      'const el = document.getElementById("main");\nel.innerHTML = userInput;\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'security', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('innerHTML'), 'should flag innerHTML assignment');
    git(repoDir, 'commit', '-m', 'tmp: xss test');
  });

  it('8. detects postMessage without origin', () => {
    writeFileSync(resolve(repoDir, 'iframe.js'),
      'window.parent.postMessage(data, "*");\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'security', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('postMessage'), 'should flag postMessage without origin');
    git(repoDir, 'commit', '-m', 'tmp: postmessage test');
  });

  it('9. detects parseInt without radix', () => {
    writeFileSync(resolve(repoDir, 'parse.js'),
      'const n = parseInt(inputValue);\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'correctness', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('parseInt'), 'should flag parseInt without radix');
    git(repoDir, 'commit', '-m', 'tmp: parseint test');
  });

  it('10. detects assignment in condition', () => {
    writeFileSync(resolve(repoDir, 'cond.js'),
      'if (result = findUser(id)) { console.log(result); }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'correctness', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Assignment'), 'should flag assignment in condition');
    git(repoDir, 'commit', '-m', 'tmp: assign cond');
  });

  it('11. detects async callback in forEach', () => {
    writeFileSync(resolve(repoDir, 'foreach.js'),
      'items.forEach(async (item) => {\n  await process(item);\n});\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'correctness', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('forEach') && res.stdout.includes('async'), 'should flag async callback in forEach');
    git(repoDir, 'commit', '-m', 'tmp: await foreach');
  });

  it('12. detects var usage', () => {
    writeFileSync(resolve(repoDir, 'style.js'),
      'var x = 10;\nvar y = 20;\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'style', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('var'), 'should flag var usage');
    git(repoDir, 'commit', '-m', 'tmp: var test');
  });

  it('13. detects JSON parse in loop', () => {
    writeFileSync(resolve(repoDir, 'jsonloop.js'),
      'for (const item of items) { const data = JSON.parse(item); }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'performance', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('JSON'), 'should flag JSON.parse in loop');
    git(repoDir, 'commit', '-m', 'tmp: json loop');
  });

  it('14. detects sync fs in async context', () => {
    writeFileSync(resolve(repoDir, 'async-fs.js'),
      'async function load() { const data = readFileSync("file.txt", "utf8"); }\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'performance', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Sync') || res.stdout.includes('synchronous'), 'should flag sync fs in async context');
    git(repoDir, 'commit', '-m', 'tmp: sync fs');
  });

  it('15. detects new Array(n).map issue', () => {
    writeFileSync(resolve(repoDir, 'arraymap.js'),
      'const result = new Array(10).map((_, i) => i * 2);\n', 'utf-8');
    git(repoDir, 'add', '.');
    const res = runReview(['--root', repoDir, '--staged', '--focus', 'correctness', '--no-color']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Array') && res.stdout.includes('map'), 'should flag new Array(n).map');
    git(repoDir, 'commit', '-m', 'tmp: array map');
  });
});

// ---------------------------------------------------------------------------
// git-pr tests
// ---------------------------------------------------------------------------

describe('smart_git_pr — CLI', () => {

  it('1. --help prints usage', () => {
    const res = runPR(['--help']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Usage:'), 'should show usage');
    assert.ok(res.stdout.includes('--base'), 'should mention --base');
    assert.ok(res.stdout.includes('--no-publish'), 'should mention --no-publish');
  });

  it('2. outside git repo fails gracefully', () => {
    const res = runPR(['--root', TEST_ROOT, '--no-publish']);
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.toLowerCase().includes('not a git'), 'should show git error');
  });
});

describe('smart_git_pr — in a real repo', () => {
  let repoDir;

  before(() => {
    repoDir = mkTempRepo();
    // Create a second branch with commits
    git(repoDir, 'checkout', '-b', 'feature-branch');
    writeFileSync(resolve(repoDir, 'new-feature.js'), 'export function feature() { return 42; }\n', 'utf-8');
    git(repoDir, 'add', '.');
    git(repoDir, 'commit', '-m', 'feat: add new feature');
    writeFileSync(resolve(repoDir, 'new-feature.js'), 'export function feature(x) { return x * 2; }\n', 'utf-8');
    git(repoDir, 'add', '.');
    git(repoDir, 'commit', '-m', 'fix: handle input parameter');
    git(repoDir, 'checkout', 'main');
  });

  after(() => {
    rmTempRepo(repoDir);
  });

  it('3. preview generates PR description', () => {
    const res = runPR(['--root', repoDir, '--no-publish', '--format', 'json', '--head', 'feature-branch']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.ok(data, 'should return JSON');
    assert.equal(data.status, 'preview');
    assert.ok(data.title.length > 0, 'should have title');
    assert.ok(data.body.length > 0, 'should have body');
    assert.ok(data.commits.length > 0, 'should have commits');
    assert.ok(data.files.length > 0, 'should have files');
    assert.equal(data.headBranch, 'feature-branch');
  });

  it('4. same branch returns no-commits', () => {
    const res = runPR(['--root', repoDir, '--no-publish', '--head', 'main', '--format', 'json']);
    assert.equal(res.status, 0);
    const data = parseJSON(res);
    assert.equal(data.status, 'no-commits');
  });

  it('5. markdown format works', () => {
    const res = runPR(['--root', repoDir, '--no-publish', '--head', 'feature-branch', '--format', 'markdown']);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('# ') || res.stdout.includes('##'), 'markdown should have headers');
  });
});
