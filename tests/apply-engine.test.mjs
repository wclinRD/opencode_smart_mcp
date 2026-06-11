// apply-engine.test.mjs — Critical path tests for Fast Apply Engine (1303 lines)
//
// Covers:
//   1. Parsers: parseSearchReplace, parseSearchReplaceText, parseUnifiedDiff
//   2. Fuzzy match: fuzzyMatch, detectMultiOccurrence, suggestNearest
//   3. Apply: applySearchReplace, applyHashline, applyAtomic (with temp files)
//   4. Validation: checkBalance, checkFileAccess, computeLineFingerprints
//
// Strategy: test critical paths (parsers, matching, atomic apply, validation)
// WITHOUT exhaustively testing every match level — the 6-level matcher
// is tested indirectly through applySearchReplace integration tests.
//
// Run: node --test tests/apply-engine.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseSearchReplace,
  parseSearchReplaceText,
  parseUnifiedDiff,
  fuzzyMatch,
  detectMultiOccurrence,
  applySearchReplace,
  applyHashline,
  applyAtomic,
  checkBalance,
  checkFileAccess,
  suggestNearest,
  computeLineFingerprints,
  verifyLineFingerprint,
} from '../src/lib/apply-engine.mjs';

const TMP = resolve(process.cwd(), '.test-apply-' + Date.now());

function tmpFile(name, content) {
  const p = resolve(TMP, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

function readTmp(name) {
  return readFileSync(resolve(TMP, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSearchReplace (structured blocks)', () => {

  it('accepts valid blocks', () => {
    const blocks = parseSearchReplace([
      { file: 'a.js', search: 'old', replace: 'new' },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].file, 'a.js');
  });

  it('rejects non-array input', () => {
    assert.throws(() => parseSearchReplace('not array'), /Expected array/);
  });

  it('rejects blocks missing required fields', () => {
    assert.throws(() => parseSearchReplace([{ file: 'a.js' }]), /Invalid block/);
    assert.throws(() => parseSearchReplace([{ file: 'a.js', search: 'x' }]), /Invalid block/);
  });
});

describe('parseSearchReplaceText (Aider format)', () => {

  it('parses standard SEARCH/REPLACE blocks', () => {
    const input = `src/file.js
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE

src/other.js
<<<<<<< SEARCH
const y = 3;
=======
const y = 4;
>>>>>>> REPLACE`;

    const blocks = parseSearchReplaceText(input);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].file, 'src/file.js');
    assert.equal(blocks[0].search, 'const x = 1;');
    assert.equal(blocks[0].replace, 'const x = 2;');
    assert.equal(blocks[1].file, 'src/other.js');
  });

  it('handles block with trailing newline', () => {
    const input = `f.js\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n`;
    const blocks = parseSearchReplaceText(input);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].replace, 'b');
  });

  it('returns empty array for no matches', () => {
    assert.deepEqual(parseSearchReplaceText('just some text'), []);
    assert.deepEqual(parseSearchReplaceText(''), []);
  });
});

describe('parseUnifiedDiff', () => {

  it('parses single-file diff', () => {
    const diff = `diff --git a/src/file.js b/src/file.js
--- a/src/file.js
+++ b/src/file.js
@@ -1,3 +1,4 @@
 line1
-old
+new
 line3`;

    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].file, 'src/file.js');
    assert.ok(files[0].hunks.length > 0);
  });

  it('parses multi-file diff with git header', () => {
    const diff = `diff --git a/a.js b/a.js
index abc..def 100644
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-old
+new
diff --git a/b.js b/b.js
index 123..456 100644
--- a/b.js
+++ b/b.js
@@ -1 +1 @@
-foo
+bar`;

    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 2);
    assert.equal(files[0].file, 'a.js');
    assert.equal(files[1].file, 'b.js');
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseUnifiedDiff(''), []);
    assert.deepEqual(parseUnifiedDiff('  \n  '), []);
  });

  it('handles new file diff (0,0)', () => {
    const diff = `diff --git a/new.js b/new.js
--- /dev/null
+++ b/new.js
@@ -0,0 +1 @@
+new file content`;

    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].file, 'new.js');
  });
});

describe('fuzzyMatch', () => {

  const content = `const x = 1;
function hello() {
  return x + 1;
}
const y = 2;`;

  it('returns null for empty content or search', () => {
    assert.equal(fuzzyMatch('', 'test'), null);
    assert.equal(fuzzyMatch(content, ''), null);
  });

  it('finds exact line (L1 or L2 via exact indexOf in apply)', () => {
    // fuzzyMatch itself only does fuzzy levels, but the anchor helps
    const r = fuzzyMatch(content, 'function hello() {');
    assert.ok(r !== null, 'should find function declaration');
    assert.equal(r.line, 2, 'function on line 2');
  });

  it('finds with trimmed anchor (L3+)', () => {
    const r = fuzzyMatch(content, '  return x + 1;');
    assert.ok(r !== null);
    assert.equal(r.line, 3);
  });

  it('returns level for found match', () => {
    const r = fuzzyMatch(content, 'function hello() {');
    assert.ok(r !== null);
    assert.ok(r.level >= 1, `level should be >= 1, got ${r.level}`);
  });
});

describe('detectMultiOccurrence', () => {

  const content = `const x = 1;
const y = 2;
const x = 3;
const z = 4;`;

  it('detects multiple exact occurrences', () => {
    const r = detectMultiOccurrence(content, 'const x', { level: 2 });
    assert.equal(r.multi, true);
    assert.equal(r.count, 2);
  });

  it('returns single when only one occurrence', () => {
    const r = detectMultiOccurrence(content, 'const y', { level: 2 });
    assert.equal(r.multi, false);
    assert.equal(r.count, 1);
  });

  it('returns zero for no match', () => {
    const r = detectMultiOccurrence(content, 'nonexistent', { level: 2 });
    assert.equal(r.multi, false);
    assert.equal(r.count, 0);
  });

  it('handles empty content', () => {
    assert.deepEqual(detectMultiOccurrence('', 'test'), { multi: false, count: 0 });
  });

  it('fuzzy level detects multi by anchor line', () => {
    const c = `a\nkeep\nb\nkeep\nc`;
    const r = detectMultiOccurrence(c, 'keep', { level: 3 });
    assert.equal(r.multi, true);
    assert.equal(r.count, 2);
  });
});

describe('applySearchReplace (with temp files)', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('applies exact match replacement', () => {
    const f = tmpFile('exact.js', 'const x = 1;\nconst y = 2;\n');
    const r = applySearchReplace(f, { search: 'const x = 1;', replace: 'const X = 10;' });
    assert.equal(r.status, 'applied');
    assert.equal(r.matchLevel, 2);
    assert.equal(readTmp('exact.js'), 'const X = 10;\nconst y = 2;\n');
  });

  it('returns conflict for non-existent file', () => {
    const r = applySearchReplace('/nonexistent/path.js', { search: 'x', replace: 'y' });
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Cannot read'));
  });

  it('returns conflict when search not found', () => {
    const f = tmpFile('nomatch.js', 'const x = 1;');
    const r = applySearchReplace(f, { search: 'nonexistent content', replace: 'new' });
    assert.equal(r.status, 'conflict');
  });

  it('empty search falls through to whole-file', () => {
    const f = tmpFile('empty-search.js', 'old content');
    const r = applySearchReplace(f, { search: '', replace: 'new content' });
    assert.equal(r.status, 'applied');
    assert.equal(readTmp('empty-search.js'), 'new content');
  });

  it('multi-occurrence returns conflict with context', () => {
    const f = tmpFile('multi.js', 'const x = 1;\nconst x = 1;\nconst y = 2;');
    const r = applySearchReplace(f, { search: 'const x = 1;', replace: 'const X = 1;' });
    assert.equal(r.status, 'conflict');
    assert.ok(r.error.includes('appears 2 times'), `error should mention count: ${r.error}`);
    assert.ok(r.multiOccurrence, 'should provide multi occurrence context');
  });

  it('produces diff summary on success', () => {
    const f = tmpFile('diff-check.js', 'const a = 1;\nconst b = 2;');
    const r = applySearchReplace(f, { search: 'const a = 1;', replace: 'const A = 10;' });
    assert.equal(r.status, 'applied');
    assert.ok(r.diff, 'should have diff');
    assert.ok(r.diff.includes('const A = 10;'), 'diff contains new content');
  });

  it('undo flag creates backup file', () => {
    const f = tmpFile('undo.js', 'const x = 1;');
    const r = applySearchReplace(f, { search: 'const x = 1;', replace: 'const y = 2;' }, { undo: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.backup, 'should have backup path');
    assert.ok(existsSync(r.backup), 'backup file should exist');
    // Cleanup backup
    try { rmSync(r.backup); } catch { /* */ }
  });
});

describe('applyHashline', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('applies replacement by line range', () => {
    const f = tmpFile('hashline.js', 'line1\nline2\nline3\nline4\n');
    const r = applyHashline(f, { startLine: 2, endLine: 3, oldContent: 'line2\nline3', newContent: 'NEW2\nNEW3' });
    assert.equal(r.status, 'applied');
    assert.equal(readTmp('hashline.js'), 'line1\nNEW2\nNEW3\nline4\n');
  });

  it('returns error for invalid line range', () => {
    const f = tmpFile('bad-range.js', 'a\nb\n');
    const r = applyHashline(f, { startLine: 3, endLine: 5, oldContent: 'x', newContent: 'y' });
    assert.equal(r.status, 'conflict');
    assert.ok(r.error.includes('exceeds file length'));
  });

  it('returns error for startLine > endLine', () => {
    const r = applyHashline('/tmp/x', { startLine: 5, endLine: 3, oldContent: '', newContent: '' });
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Invalid line range'));
  });

  it('detects content drift (mismatch)', () => {
    const f = tmpFile('drift.js', 'line1\noriginal\nline3\n');
    const r = applyHashline(f, { startLine: 2, endLine: 2, oldContent: 'WRONG', newContent: 'new' });
    assert.equal(r.status, 'conflict');
    assert.ok(r.error.includes('Content mismatch'), `error: ${r.error}`);
    assert.ok(r.details, 'should have details');
    assert.ok(r.details.mismatches, 'should list mismatches');
  });
});

describe('applyAtomic (multi-file rollback)', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('applies multiple changes successfully', () => {
    tmpFile('a.js', 'const a = 1;');
    tmpFile('b.js', 'const b = 2;');
    const changes = [
      { type: 'search-replace', file: resolve(TMP, 'a.js'), search: 'const a = 1;', replace: 'const A = 10;' },
      { type: 'search-replace', file: resolve(TMP, 'b.js'), search: 'const b = 2;', replace: 'const B = 20;' },
    ];
    const r = applyAtomic(changes);
    assert.equal(r.allSucceeded, true);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].status, 'applied');
    assert.equal(r.results[1].status, 'applied');
    // Verify both files changed
    assert.equal(readTmp('a.js'), 'const A = 10;');
    assert.equal(readTmp('b.js'), 'const B = 20;');
  });

  it('rolls back on partial failure', () => {
    tmpFile('rollback-a.js', 'const a = 1;');
    tmpFile('rollback-b.js', 'const b = 2;');
    const changes = [
      { type: 'search-replace', file: resolve(TMP, 'rollback-a.js'), search: 'const a = 1;', replace: 'const A = 10;' },
      { type: 'search-replace', file: resolve(TMP, 'rollback-b.js'), search: 'NONEXISTENT', replace: 'const B = 20;' },
    ];
    const r = applyAtomic(changes);
    assert.equal(r.allSucceeded, false);
    // First file should be rolled back
    assert.equal(readTmp('rollback-a.js'), 'const a = 1;', 'should rollback on failure');
  });
});

describe('checkBalance', () => {

  it('detects balanced braces', () => {
    assert.equal(checkBalance('{a: 1}').balanced, true);
    assert.equal(checkBalance('function() { return [1, 2]; }').balanced, true);
  });

  it('detects unbalanced braces', () => {
    assert.equal(checkBalance('{a: 1').balanced, false);
    assert.equal(checkBalance('{a: 1}}').balanced, false);
  });

  it('handles strings with braces inside', () => {
    assert.equal(checkBalance('"{hello}"').balanced, true);
    assert.equal(checkBalance('`template {with braces}`').balanced, true);
  });

  it('handles empty/trivial input', () => {
    assert.equal(checkBalance('').balanced, true);
    assert.equal(checkBalance('no braces').balanced, true);
  });

  it('reports unmatched count', () => {
    const r = checkBalance('{a: 1');
    assert.equal(r.balanced, false);
    assert.equal(r.open, 1, 'should report 1 unmatched open brace');
  });
});

describe('checkFileAccess', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('returns error for non-existent file', () => {
    const r = checkFileAccess('/nonexistent/path');
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });

  it('returns ok for accessible file', () => {
    const f = tmpFile('access-test.js', 'content');
    const r = checkFileAccess(f);
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });
});

describe('suggestNearest', () => {

  const content = `const x = 1;
function hello() {
  return x + 1;
}
const y = 2;`;

  it('returns array of nearest matches for near-miss', () => {
    const r = suggestNearest(content, 'function hell() {');
    assert.ok(Array.isArray(r), 'should return array');
    assert.ok(r.length > 0, 'should find at least one suggestion');
    assert.ok(r[0].line > 0, 'should have line number');
    assert.ok(r[0].score > 0, 'should have score');
  });

  it('returns empty array for empty input', () => {
    const r1 = suggestNearest('', 'test');
    assert.ok(r1 === null || r1.length === 0, 'empty content should return empty/no results');
    const r2 = suggestNearest(content, '');
    assert.equal(r2, null, 'empty search should return null');
  });

  it('produces suggestions for search not in content', () => {
    const r = suggestNearest(content, 'nonsense that does not exist');
    // Should return some suggestion
    assert.ok(r === null || r.length === 0 || r[0].line > 0,
      'non-matching search should not crash');
  });
});

describe('computeLineFingerprints / verifyLineFingerprint', () => {

  it('computes fingerprints for each line', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const fps = computeLineFingerprints(content);
    assert.equal(fps.length, 2);
    assert.ok(fps[0].fingerprint, 'each line has fingerprint');
    assert.ok(fps[1].fingerprint, 'each line has fingerprint');
  });

  it('fingerprints differ for different content', () => {
    const a = computeLineFingerprints('hello world\n');
    const b = computeLineFingerprints('goodbye world\n');
    assert.notEqual(a[0].fingerprint, b[0].fingerprint);
  });

  it('verifyLineFingerprint matches expected', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const fps = computeLineFingerprints(content);
    const r = verifyLineFingerprint(content, 2, fps[1].fingerprint);
    assert.equal(r.ok, true);
  });

  it('verifyLineFingerprint rejects mismatch', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const r = verifyLineFingerprint(content, 2, 'wrong');
    assert.equal(r.ok, false);
  });

  it('verifyLineFingerprint handles out-of-range line', () => {
    const content = 'const x = 1;';
    const r = verifyLineFingerprint(content, 99, 'anything');
    assert.equal(r.ok, false);
  });
});

describe('applySearchReplace fuzzy mode', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('fuzzy match succeeds when exact fails (indentation diff)', () => {
    const f = tmpFile('fuzzy-apply.js', 'const x = 1;\n  const y = 2;\nconst z = 3;\n');
    // Search with different indentation — normalizeWS handles this (L4+)
    const r = applySearchReplace(f, { search: 'const x = 1;\n    const y = 2;\nconst z = 3;', replace: 'const X = 1;\n  const Y = 20;\nconst Z = 3;' });
    // Should work via fuzzy matching (L4 normalizeWS matches indentation diff)
    assert.equal(r.status, 'applied', `fuzzy should work: ${JSON.stringify(r)}`);
    assert.ok(r.matchLevel >= 3, `should use fuzzy level, got ${r.matchLevel}`);
    assert.equal(readTmp('fuzzy-apply.js'), 'const X = 1;\n  const Y = 20;\nconst Z = 3;\n');
  });

  it('fuzzy=false disables fuzzy matching', () => {
    const f = tmpFile('exact-only.js', 'function foo() {\n  return 1;\n}\n');
    const r = applySearchReplace(f, { search: 'function foo(){\nreturn 1;\n}', replace: 'function foo(){\nreturn 2;\n}' }, { fuzzy: false });
    assert.equal(r.status, 'conflict', 'should fail without fuzzy');
  });
});
