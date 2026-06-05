// fast-apply.test.mjs — Tests for apply-engine.mjs
//
// Covers:
//   1. parseSearchReplaceText — SEARCH/REPLACE block parsing
//   2. parseUnifiedDiff — unified diff parsing
//   3. fuzzyMatch — 4-level fuzzy matching
//   4. applySearchReplace — exact and fuzzy apply
//   5. applyWholeFile — whole file replacement
//   6. applyUnifiedDiff — unified diff apply
//   7. checkBalance — brace/bracket validation
//   8. suggestNearest — conflict suggestion

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  parseSearchReplace,
  parseSearchReplaceText,
  parseUnifiedDiff,
  fuzzyMatch,
  applySearchReplace,
  applyWholeFile,
  applyUnifiedDiff,
  checkBalance,
} from '../src/lib/apply-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp file with content, returns path */
function tempFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-test-'));
  const p = join(dir, 'test.js');
  writeFileSync(p, content, 'utf-8');
  return p;
}

// ===========================================================================
// 1. SEARCH/REPLACE Parsing
// ===========================================================================

describe('parseSearchReplace', () => {
  it('validates blocks', () => {
    const blocks = [
      { file: 'a.js', search: 'old', replace: 'new' },
      { file: 'b.js', search: 'foo', replace: 'bar' },
    ];
    assert.deepEqual(parseSearchReplace(blocks), blocks);
  });

  it('rejects invalid blocks', () => {
    assert.throws(() => parseSearchReplace([{}]), /Invalid block/);
    assert.throws(() => parseSearchReplace('not array'), /expected array/i);
  });
});

describe('parseSearchReplaceText', () => {
  it('parses Aider-style SEARCH/REPLACE blocks', () => {
    const text = `src/a.js
<<<<<<< SEARCH
function old() {
  return 1;
}
=======
function new() {
  return 2;
}
>>>>>>> REPLACE

src/b.js
<<<<<<< SEARCH
var x = 1;
=======
let x = 2;
>>>>>>> REPLACE
`;
    const blocks = parseSearchReplaceText(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].file, 'src/a.js');
    assert.equal(blocks[0].search, 'function old() {\n  return 1;\n}');
    assert.equal(blocks[0].replace, 'function new() {\n  return 2;\n}');
    assert.equal(blocks[1].file, 'src/b.js');
    assert.equal(blocks[1].search, 'var x = 1;');
    assert.equal(blocks[1].replace, 'let x = 2;');
  });

  it('returns empty array for no blocks', () => {
    assert.deepEqual(parseSearchReplaceText('no blocks here'), []);
  });
});

// ===========================================================================
// 2. Unified Diff Parsing
// ===========================================================================

describe('parseUnifiedDiff', () => {
  it('parses git diff with multiple hunks', () => {
    const diff = `diff --git a/src/a.js b/src/a.js
index abc..def 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,5 +1,6 @@
 line1
-line2
+line2 modified
 line3
+line4 new
 line5
@@ -10,3 +11,4 @@
 context1
 context2
-context3
+context3 modified
+context4 new
`;
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].file, 'src/a.js');
    assert.equal(files[0].hunks.length, 2);
    assert.equal(files[0].hunks[0].oldStart, 1);
    assert.equal(files[0].hunks[0].newStart, 1);
    assert.equal(files[0].hunks[0].oldLines, 5);
    assert.equal(files[0].hunks[0].newLines, 6);
  });

  it('handles new file diff', () => {
    const diff = `diff --git a/new.js b/new.js
new file mode 100644
--- /dev/null
+++ b/new.js
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].file, 'new.js');
  });

  it('returns empty for no diff', () => {
    assert.deepEqual(parseUnifiedDiff(''), []);
  });
});

// ===========================================================================
// 3. Fuzzy Matching (4 levels)
// ===========================================================================

describe('fuzzyMatch', () => {
  const content = `line1
line2
function hello() {
  console.log("world");
}
line5
line6`;

  it('L1: exact line match', () => {
    const r = fuzzyMatch(content, 'function hello() {', { startLine: 3 });
    assert.equal(r.line, 3);
    assert.equal(r.level, 1);
  });

  it('L2: exact string search', () => {
    const r = fuzzyMatch(content, 'function hello() {');
    assert.equal(r.line, 3);
    assert.equal(r.level, 2);
  });

  it('L2: multi-line exact match', () => {
    const search = 'function hello() {\n  console.log("world");\n}';
    const r = fuzzyMatch(content, search);
    assert.equal(r.line, 3);
    assert.equal(r.level, 2);
  });

  it('L3: unique line match with context', () => {
    // Use content with slightly different indentation for L3
    const content2 = 'aaa\nbbb\nfunction hello() {\nconsole.log("world");\n}\nccc';
    const search = '  console.log("world");'; // different WS
    const r = fuzzyMatch(content2, search);
    assert.equal(r.line, 4);
    assert.equal(r.level, 3);
  });

  it('L3: handles braces-only lines correctly', () => {
    // Search appears literally, so L2 matches (L3 not needed)
    const content2 = 'a\nb\nfunction foo() {\n  return 1;\n}\nc';
    const search = '  return 1;';
    const r = fuzzyMatch(content2, search);
    assert.equal(r.line, 4);
    assert.equal(r.level, 2); // exact string match, not fuzzy
  });

  it('L3: fuzzy match when line differs', () => {
    // Use a tab instead of spaces to force L3
    const content2 = 'a\nb\nfunction foo() {\n\treturn 1;\n}\nc';
    const search = '  return 1;'; // spaces, not tab
    const r = fuzzyMatch(content2, search);
    assert.equal(r.line, 4);
    assert.equal(r.level, 3); // unique content line match
  });

  it('L4: whitespace tolerant matching', () => {
    // L3 won't match (different trimmed content), L4 handles WS tolerance
    const content2 = 'a\nb\nc\n  spaced  text\nd';
    const search = ' spaced text'; // different spacing
    const r = fuzzyMatch(content2, search);
    assert.equal(r.line, 4);
    assert.equal(r.level, 4);
  });

  it('L4: matches despite different indentation and spacing', () => {
    // L2: 'spaced out' not found as substring of '  spaced  out'
    // L3: trimmed content differs
    // L4: after WS normalization, they match
    const content2 = 'a\n  spaced  out\nc';
    const search = 'spaced out'; // single space
    const r = fuzzyMatch(content2, search);
    assert.equal(r.line, 2);
    assert.equal(r.level, 4);
  });

  it('returns null for no match', () => {
    const r = fuzzyMatch(content, 'nonexistent code here');
    assert.equal(r, null);
  });

  it('handles empty search', () => {
    assert.equal(fuzzyMatch('abc', ''), null);
  });

  it('handles empty content', () => {
    assert.equal(fuzzyMatch('', 'abc'), null);
  });
});

// ===========================================================================
// 4. Apply SEARCH/REPLACE
// ===========================================================================

describe('applySearchReplace', () => {
  it('applies exact match', () => {
    const fp = tempFile('const x = 1;\nconst y = 2;\n');
    const r = applySearchReplace(fp, { search: 'const x = 1;', replace: 'const x = 10;' });
    assert.equal(r.status, 'applied');
    assert.equal(r.matchLevel, 2);
    assert.equal(readFileSync(fp, 'utf-8'), 'const x = 10;\nconst y = 2;\n');
  });

  it('applies multi-line replacement', () => {
    const fp = tempFile('function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n');
    const r = applySearchReplace(fp, {
      search: 'function a() {\n  return 1;\n}',
      replace: 'function a() {\n  return 10;\n}',
    });
    assert.equal(r.status, 'applied');
    const result = readFileSync(fp, 'utf-8');
    assert.ok(result.includes('return 10;'));
    assert.ok(result.includes('function b()'));
  });

  it('returns conflict when search not found (no fuzzy)', () => {
    const fp = tempFile('const x = 1;\n');
    const r = applySearchReplace(fp, { search: 'const x = 99;', replace: 'const y = 1;' }, { fuzzy: false });
    assert.equal(r.status, 'conflict');
  });

  it('fuzzy match applies when exact fails', () => {
    const fp = tempFile('const  x  =  1;\nconst y = 2;\n');
    const r = applySearchReplace(fp, { search: 'const x = 1;', replace: 'const x = 10;' }, { fuzzy: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.matchLevel >= 3);
  });

  it('creates backup when undo=true', () => {
    const fp = tempFile('const x = 1;\n');
    const r = applySearchReplace(fp, { search: 'const x = 1;', replace: 'const x = 10;' }, { undo: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.backup);
    // Verify backup exists (clean up after)
    const bak = r.backup;
    if (bak) {
      const bakContent = readFileSync(bak, 'utf-8');
      assert.equal(bakContent, 'const x = 1;\n');
      // Clean up
      try { unlinkSync(bak); } catch { /* */ }
      try { unlinkSync(fp); } catch { /* */ }
      try { rmdirSync(dirname(fp)); } catch { /* */ }
    }
  });

  it('handles empty search (whole file replacement)', () => {
    const fp = tempFile('old content\n');
    const r = applySearchReplace(fp, { search: '', replace: 'new content\n' });
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'new content\n');
  });
});

// ===========================================================================
// 5. Apply Whole File
// ===========================================================================

describe('applyWholeFile', () => {
  it('replaces entire file', () => {
    const fp = tempFile('old content\n');
    const r = applyWholeFile(fp, 'brand new content\n');
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'brand new content\n');
  });

  it('creates backup on undo', () => {
    const fp = tempFile('original\n');
    const r = applyWholeFile(fp, 'new\n', { undo: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.backup);
    const bak = r.backup;
    if (bak) {
      assert.equal(readFileSync(bak, 'utf-8'), 'original\n');
    }
  });
});

// ===========================================================================
// 6. Apply Unified Diff
// ===========================================================================

describe('applyUnifiedDiff', () => {
  it('applies hunks to file', () => {
    const fp = tempFile('line1\nline2\nline3\nline4\nline5\n');
    const hunks = [
      {
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        header: '',
        lines: ['-line2', '+line2 modified'],
      },
    ];
    const r = applyUnifiedDiff(fp, hunks);
    assert.equal(r.status, 'applied');
    const result = readFileSync(fp, 'utf-8');
    assert.ok(result.includes('line2 modified'));
    assert.ok(result.includes('line1'));
    assert.ok(result.includes('line3'));
  });

  it('handles addition hunks', () => {
    const fp = tempFile('a\nb\nc\n');
    const hunks = [
      {
        oldStart: 2,
        oldLines: 0,
        newStart: 2,
        newLines: 1,
        header: '',
        lines: ['+a2 inserted'],
      },
    ];
    const r = applyUnifiedDiff(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'a\na2 inserted\nb\nc\n');
  });

  it('handles deletion hunks', () => {
    const fp = tempFile('a\nb\nc\n');
    const hunks = [
      {
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 0,
        header: '',
        lines: ['-b'],
      },
    ];
    const r = applyUnifiedDiff(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'a\nc\n');
  });
});

// ===========================================================================
// 7. Syntax Validation
// ===========================================================================

describe('checkBalance', () => {
  it('validates balanced braces', () => {
    assert.ok(checkBalance('{hello}').balanced);
    assert.ok(checkBalance('function() { if (x) { return 1; } }').balanced);
  });

  it('detects unbalanced braces', () => {
    assert.equal(checkBalance('{hello').balanced, false);
    assert.equal(checkBalance('hello}').balanced, false);
  });

  it('ignores strings', () => {
    assert.ok(checkBalance('"{"').balanced);
    assert.ok(checkBalance("'{'").balanced);
  });

  it('ignores comments', () => {
    // '}' is NOT in comment → unmatched (correct behavior)
    assert.equal(checkBalance('/* { */ }').balanced, false);
    // single-line comment means everything after // is ignored
    assert.ok(checkBalance('// { ').balanced);
    // Both in block comment → balanced
    assert.ok(checkBalance('/* { } */').balanced);
  });

  it('detects mixed bracket types', () => {
    const r = checkBalance('(}');
    assert.equal(r.balanced, false);
    assert.equal(r.found, '}');
  });

  it('tracks multiple open brackets', () => {
    const r = checkBalance('({[');
    assert.equal(r.balanced, false);
    assert.equal(r.open, 3);
  });

  it('handles empty string', () => {
    assert.ok(checkBalance('').balanced);
  });
});
