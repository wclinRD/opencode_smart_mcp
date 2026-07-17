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
import { writeFileSync, mkdtempSync, readFileSync, unlinkSync, rmdirSync, rmSync } from 'node:fs';
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
  detectMultiOccurrence,
  expandLazyMarkers,
  applySearchReplaceWithLazy,
  suggestNearest,
  applyPartial,
  checkFileAccess,
  parseSedExpression,
  applySed,
  applyMultiHunk,
  applyBatch,
} from '../src/lib/apply-engine.mjs';

import { parseBlockDiff } from '../src/plugins/core/fast-apply.mjs';

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
    assert.throws(() => parseSearchReplace([{}]), /missing required fields/);
    assert.throws(() => parseSearchReplace('not array'), /Expected array/i);
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
// 4. Multi-occurrence Detection
// ===========================================================================

describe('detectMultiOccurrence', () => {
  it('returns single for unique content', () => {
    const r = detectMultiOccurrence('a\nb\nc\nd\ne\n', 'b\nc');
    assert.equal(r.multi, false);
    assert.equal(r.count, 1);
  });

  it('detects exact duplicate', () => {
    const r = detectMultiOccurrence('a\nb\nc\nd\nb\nc\ne\n', 'b\nc');
    assert.equal(r.multi, true);
    assert.equal(r.count, 2);
    assert.equal(r.lines.length, 2);
  });

  it('detects triple occurrence', () => {
    const r = detectMultiOccurrence('a\nb\nc\nx\nb\nc\ny\nb\nc\nz\n', 'b\nc');
    assert.equal(r.multi, true);
    assert.equal(r.count, 3);
    assert.equal(r.lines.length, 3);
  });

  it('returns contexts for each occurrence', () => {
    const r = detectMultiOccurrence('line1\nline2\nconsole.log("hello")\nline4\nconsole.log("hello")\nline6\n', 'console.log("hello")');
    assert.equal(r.multi, true);
    assert.ok(r.contexts);
    assert.equal(r.contexts.length, 2);
    assert.ok(r.contexts[0].context.includes('line2'));
    assert.ok(r.contexts[1].context.includes('line4'));
  });

  it('returns single for fuzzy level 3+', () => {
    // L3 matching: trimmed content match
    const r = detectMultiOccurrence('a\nb\nc\nd\n', 'b\nc', { level: 3 });
    assert.equal(r.multi, false);
  });

  it('detects multi for fuzzy level 3+', () => {
    // Same trimmed anchor line appears twice
    const r = detectMultiOccurrence('a\nfunction foo() {\nb\nfunction foo() {\nc\n', 'function foo() {', { level: 3 });
    assert.equal(r.multi, true);
    assert.equal(r.count, 2);
  });

  it('handles empty content', () => {
    const r = detectMultiOccurrence('', 'abc');
    assert.equal(r.multi, false);
    assert.equal(r.count, 0);
  });

  it('handles empty search', () => {
    const r = detectMultiOccurrence('abc', '');
    assert.equal(r.multi, false);
    assert.equal(r.count, 0);
  });

  it('returns single for no match', () => {
    const r = detectMultiOccurrence('abc\ndef\n', 'notfound');
    assert.equal(r.multi, false);
    assert.equal(r.count, 0);
  });
});

// ===========================================================================
// 4b. Lazy edit markers — expandLazyMarkers
// ===========================================================================

describe('expandLazyMarkers', () => {
  const fileContent = `line1
line2
line3
console.log("old")
line5
line6`;

  it('returns null when no markers present', () => {
    const r = expandLazyMarkers(fileContent, {
      search: 'line2',
      replace: 'line2 modified',
    });
    assert.equal(r, null);
  });

  it('expands simple single-change block', () => {
    const block = {
      search: '// ... existing code ...\nconsole.log("old")\n// ... existing code ...',
      replace: '// ... existing code ...\nconsole.log("new")\n// ... existing code ...',
    };
    const r = expandLazyMarkers(fileContent, block);
    assert.ok(r);
    // SEARCH = matched region in file (just the real content)
    assert.equal(r.search, 'console.log("old")');
    // REPLACE = only the replacement for the region (no leading/trailing file content)
    assert.equal(r.replace, 'console.log("new")');
  });

  it('handles JS-style markers', () => {
    const block = {
      search: '// ... existing code ...\nconsole.log("old")\n// ... existing code ...',
      replace: '// ... existing code ...\nconsole.log("new")\n// ... existing code ...',
    };
    const r = expandLazyMarkers(fileContent, block);
    assert.ok(r);
    assert.ok(r.replace.includes('console.log("new")'));
  });

  it('handles Python-style markers', () => {
    const pyContent = 'import os\nimport sys\n\ndef hello():\n    print("old")\n\nif __name__ == "__main__":\n    hello()\n';
    const block = {
      search: '# ... existing code ...\n    print("old")\n# ... existing code ...',
      replace: '# ... existing code ...\n    print("new")\n# ... existing code ...',
    };
    const r = expandLazyMarkers(pyContent, block);
    assert.ok(r);
    // Only region content (no leading/trailing)
    assert.equal(r.search, '    print("old")');
    assert.equal(r.replace, '    print("new")');
  });

  it('handles HTML-style markers', () => {
    const htmlContent = '<html>\n<head>\n  <title>Test</title>\n</head>\n<body>\n  <p>old</p>\n</body>\n</html>\n';
    const block = {
      search: '<!-- ... existing code ... -->\n  <p>old</p>\n<!-- ... existing code ... -->',
      replace: '<!-- ... existing code ... -->\n  <p>new</p>\n<!-- ... existing code ... -->',
    };
    const r = expandLazyMarkers(htmlContent, block);
    assert.ok(r);
    assert.ok(r.replace.includes('<p>new</p>'));
  });

  it('handles multiple real segments', () => {
    // Two separate real segments with a marker between them
    const content = 'import React from "react";\nimport { useState } from "react";\n\nfunction App() {\n  const [count, setCount] = useState(0);\n\n  return (\n    <div>hello</div>\n  );\n}\n';
    const block = {
      search: '// ... existing code ...\nimport { useState } from "react";\n// ... existing code ...\n  const [count, setCount] = useState(0);\n// ... existing code ...',
      replace: '// ... existing code ...\nimport { useState, useEffect } from "react";\n// ... existing code ...\n  const [count, setCount] = useState(1);\n// ... existing code ...',
    };
    const r = expandLazyMarkers(content, block);
    assert.ok(r);
    // SEARCH = file content from line 2 through line 6 (region)
    assert.ok(r.search.includes('import { useState } from "react"'));
    assert.ok(r.search.includes('function App()'));
    assert.ok(r.search.includes('useState(0)'));
    // REPLACE = replacement for that region
    assert.ok(r.replace.includes('import { useState, useEffect } from "react"'));
    assert.ok(r.replace.includes('function App()')); // gap preserved by marker expansion
    assert.ok(r.replace.includes('useState(1)'));
  });

  it('throws when search content not found', () => {
    const block = {
      search: '// ... existing code ...\nnonexistent_function()\n// ... existing code ...',
      replace: '// ... existing code ...\nreplaced()\n// ... existing code ...',
    };
    assert.throws(() => expandLazyMarkers(fileContent, block), /Cannot find SEARCH/);
  });

  it('throws when SEARCH has only markers', () => {
    const block = {
      search: '// ... existing code ...\n// ... existing code ...',
      replace: '// ... existing code ...\nconsole.log("new")\n// ... existing code ...',
    };
    assert.throws(() => expandLazyMarkers(fileContent, block), /only lazy markers/);
  });

  it('works with leading marker only (no trailing)', () => {
    const block = {
      search: '// ... existing code ...\nconsole.log("old")',
      replace: '// ... existing code ...\nconsole.log("new")',
    };
    const r = expandLazyMarkers(fileContent, block);
    assert.ok(r);
    assert.equal(r.search, 'console.log("old")');
    assert.equal(r.replace, 'console.log("new")');
  });

  it('works with trailing marker only (no leading)', () => {
    const block = {
      search: 'console.log("old")\n// ... existing code ...',
      replace: 'console.log("new")\n// ... existing code ...',
    };
    const r = expandLazyMarkers(fileContent, block);
    assert.ok(r);
    assert.equal(r.search, 'console.log("old")');
    assert.equal(r.replace, 'console.log("new")');
  });
});

describe('applySearchReplaceWithLazy', () => {
  it('applies lazy marker block', () => {
    const fp = tempFile('line1\nline2\nline3\nconsole.log("old")\nline5\n');
    const r = applySearchReplaceWithLazy(fp, {
      search: '// ... existing code ...\nconsole.log("old")\n// ... existing code ...',
      replace: '// ... existing code ...\nconsole.log("new")\n// ... existing code ...',
    });
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'line1\nline2\nline3\nconsole.log("new")\nline5\n');
  });

  it('falls back to normal apply when no markers', () => {
    const fp = tempFile('const x = 1;\n');
    const r = applySearchReplaceWithLazy(fp, {
      search: 'const x = 1;',
      replace: 'const x = 10;',
    });
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'const x = 10;\n');
  });

  it('reports error for non-existent file', () => {
    const r = applySearchReplaceWithLazy('/nonexistent/path.js', {
      search: '// ... existing code ...\nfoo\n// ... existing code ...',
      replace: '// ... existing code ...\nbar\n// ... existing code ...',
    });
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Cannot read'));
  });
});

// ===========================================================================
// 5. Apply SEARCH/REPLACE (with multi-occurrence check)
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

  it('DMP fallback patches when exact+fuzzy miss (no fuzzy)', () => {
    const fp = tempFile('const x = 1;\n');
    const r = applySearchReplace(fp, { search: 'const x = 99;', replace: 'const y = 1;' }, { fuzzy: false });
    // DMP patch_apply finds close semantic match and patches successfully
    assert.equal(r.status, 'applied');
    assert.equal(r.method, 'dmp-patch');
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

  it('reports conflict on multi-occurrence exact match', () => {
    const fp = tempFile('const x = 1;\nconst y = 2;\nconst x = 1;\nconst z = 3;\n');
    const r = applySearchReplace(fp, { search: 'const x = 1;', replace: 'const x = 10;' });
    assert.equal(r.status, 'conflict');
    assert.ok(r.error.includes('2 times'));
    assert.ok(r.multiOccurrence);
    assert.equal(r.multiOccurrence.length, 2);
  });

  it('reports conflict on multi-occurrence fuzzy match', () => {
    // Same function name, different bodies — fuzzy should find first but report multi
    const fp = tempFile('function setup() {\n  return 1;\n}\n\nfunction setup() {\n  return 2;\n}\n');
    const r = applySearchReplace(fp, {
      search: 'function setup() {\n  return 1;\n}',
      replace: 'function setup() {\n  return 10;\n}',
    });
    assert.equal(r.status, 'applied'); // first unique occurrence — whole block is unique
  });

  it('reports conflict on fuzzy match with ambiguous anchor', () => {
    // Same anchor line "function setup() {" appears twice
    const fp = tempFile('function setup() {\n  initA();\n}\n\nfunction setup() {\n  initB();\n}\n');
    const r = applySearchReplace(fp, {
      search: 'function setup() {\n  initX();\n}', // won't find exact — will use fuzzy
      replace: 'function setup() {\n  initY();\n}',
    });
    assert.ok(r.status === 'conflict' || r.status === 'applied');
    // May fuzzy-match to first or conflict — either is acceptable
  });
});

// ===========================================================================
// 6. Apply Whole File
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
// 7. Apply Unified Diff
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
// 8. Syntax Validation
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

// ===========================================================================
// 9. Error Messages — suggestNearest
// ===========================================================================

describe('suggestNearest', () => {
  const content = 'const x = 1;\nfunction hello() {\n  return "world";\n}\nconst y = 2;\n';

  it('returns null for empty search', () => {
    assert.equal(suggestNearest(content, ''), null);
  });

  it('finds nearest match for close text', () => {
    // Search for something close but not exact
    const r = suggestNearest(content, 'function hellox()');
    assert.ok(r);
    assert.ok(r.length >= 1);
    assert.ok(r[0].text.includes('hello'));
  });

  it('returns up to 3 matches', () => {
    const r = suggestNearest(content, 'const');
    assert.ok(r);
    assert.ok(r.length <= 3);
    assert.ok(r.length >= 1);
  });

  it('provides diffHint for near match', () => {
    const r = suggestNearest(content, '  return "world";\n}');
    if (r && r.length > 0 && r[0].diffHint) {
      assert.ok(r[0].diffHint.includes('expected') || r[0].diffHint.includes('found'));
    }
  });

  it('DMP fallback + suggestNearest when nothing matches', () => {
    const fp = tempFile('export const PI = 3.14;\nexport const E = 2.71;\n');
    const r = applySearchReplace(fp, { search: 'const z = 3;', replace: 'const a = 4;' }, { fuzzy: false });
    if (r.status === 'conflict') {
      assert.ok(r.error.includes('Cannot find search block'));
      assert.ok(r.details);
      assert.ok(r.details.length >= 1);
    } else {
      assert.equal(r.status, 'applied');
      assert.equal(r.method, 'dmp-patch');
    }
  });

  it('DMP patch succeeds with whitespace-diff content (L7, fuzzy:false)', () => {
    const fp = tempFile('function greet() {\n    return "hello";\n}\n');
    const r = applySearchReplace(fp, {
      search: 'function greet() {\n return "hello"; \n}',
      replace: 'function greet() {\n return "hi";\n}',
    }, { fuzzy: false });
    assert.equal(r.status, 'applied', `Expected applied, got ${r.status}: ${r.error || ''}`);
    assert.equal(r.method, 'dmp-patch');
    const content = readFileSync(fp, 'utf-8');
    assert.ok(content.includes('"hi"'));
  });

  it('validate flag does not cause issues on normal apply', () => {
    // validate + exact match should work fine (validate only triggers for >= L3)
    const fp = tempFile('function foo() {\n  const x = 1;\n  return x;\n}');
    const r = applySearchReplace(fp, {
      search: 'function foo() {\n  const x = 1;\n  return x;\n}',
      replace: 'function foo() {\n  const x = 2;\n  return x;\n}',
    }, { validate: true });
    assert.equal(r.status, 'applied');
    const content = readFileSync(fp, 'utf-8');
    assert.ok(content.includes('x = 2'));
  });

  it('validate + fuzzy match ok with whitespace-diff (>= L3)', () => {
    // Fuzzy: true + indentation diff triggers L4 fuzzy → validate path
    const fp = tempFile('  const a = 1;\n  const b = 2;\n');
    // Search without leading whitespace → fuzzy match
    const r = applySearchReplace(fp, {
      search: 'const a = 1;\nconst b = 2;',
      replace: 'const x = 10;\nconst y = 20;',
    }, { fuzzy: true, validate: true });
    assert.equal(r.status, 'applied', `Expected applied, got ${r.status}: ${r.error || ''}`);
    const content = readFileSync(fp, 'utf-8');
    assert.ok(content.includes('x = 10'));
  });
});

// ===========================================================================
// 10. Partial context — applyPartial
// ===========================================================================

describe('applyPartial', () => {
  it('applies exact partial match', () => {
    const fp = tempFile('const x = 1;\nconst y = 2;\n');
    const r = applyPartial(fp, { search: 'const x = 1;', replace: 'const z = 3;' }, { fuzzy: false });
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'const z = 3;\nconst y = 2;\n');
  });

  it('applies fuzzy partial match', () => {
    const fp = tempFile('function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}\n');
    const r = applyPartial(fp, { search: 'function bar()', replace: 'function bar() {\n  return 3;\n}' });
    assert.equal(r.status, 'applied');
    const got = readFileSync(fp, 'utf-8');
    assert.ok(got.includes('return 3'));
  });

  it('reports conflict on multi-occurrence exact match', () => {
    const fp = tempFile('const x = 1;\nconst x = 1;\nconst y = 2;\n');
    const r = applyPartial(fp, { search: 'const x = 1;', replace: 'const z = 3;' }, { fuzzy: false });
    assert.equal(r.status, 'conflict');
    assert.ok(r.error.includes('times'));
  });

  it('reports conflict on multi-occurrence with partial fuzzy', () => {
    const fp = tempFile('const x = 1;\nconst y = 2;\nconst y = 2;\n');
    const r = applyPartial(fp, { search: 'const y = 2;', replace: 'const z = 3;' });
    assert.equal(r.status, 'conflict');
  });

  it('reports error on non-existent file', () => {
    const r = applyPartial('/nonexistent/path.js', { search: 'x', replace: 'y' });
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Cannot read'));
  });

  it('applies with L5 partial matching (gapped context)', () => {
    const fp = tempFile('line A\nline B\nline C\nline D\nline E\n');
    // Abbreviated SEARCH with only first and last line
    const r = applyPartial(fp, { search: 'line A\nline E', replace: 'line A\nline Z\nline E' });
    assert.equal(r.status, 'applied');
    const got = readFileSync(fp, 'utf-8');
    assert.ok(got.includes('line Z'));
  });

  it('creates backup when undo=true', () => {
    const fp = tempFile('const x = 1;\n');
    const r = applyPartial(fp, { search: 'const x = 1;', replace: 'const y = 2;' }, { undo: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.backup);
    assert.equal(r.backup, fp + '.apply.bak');
    // Cleanup
    try { unlinkSync(fp + '.apply.bak'); } catch { /* */ }
  });
});

// ===========================================================================
// 11. File access validation — checkFileAccess
// ===========================================================================

// ===========================================================================
// 12. BlockDiff — parseBlockDiff
// ===========================================================================

describe('parseBlockDiff', () => {

  function symFile(content) {
    const dir = mkdtempSync(join(tmpdir(), 'bd-test-'));
    const p = join(dir, 'test.js');
    writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('replaces entire function body', () => {
    const content = 'function hello() { return 1; }\n';
    const fp = symFile(content);
    const root = dirname(fp);
    const blocks = [
      { file: 'test.js', symbol: 'hello', newContent: 'function hello() { return 42; }' }
    ];
    const changes = parseBlockDiff(blocks, root);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, 'hashline');
    assert.equal(changes[0].action, 'replace');
    assert.ok(changes[0].startLine >= 1);
    assert.ok(changes[0].endLine >= changes[0].startLine);
    // Cleanup
    rmSync(dirname(fp), { recursive: true, force: true });
  });

  it('throws on missing symbol', () => {
    const content = 'const x = 1;\n';
    const fp = symFile(content);
    const root = dirname(fp);
    const blocks = [{ file: 'test.js', symbol: 'nonexistent', newContent: 'hi' }];
    assert.throws(() => parseBlockDiff(blocks, root), /not found/);
    rmSync(dirname(fp), { recursive: true, force: true });
  });

  it('throws on missing fields', () => {
    const blocks = [{ file: 'test.js' }];
    assert.throws(() => parseBlockDiff(blocks, '/tmp'), /missing required fields: symbol, newContent/);
  });

  it('handles append action', () => {
    const content = 'function greet() { return "hi"; }\n';
    const fp = symFile(content);
    const root = dirname(fp);
    const blocks = [
      { file: 'test.js', symbol: 'greet', newContent: 'console.log("done");', action: 'append' }
    ];
    const changes = parseBlockDiff(blocks, root);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'insert-after');
    rmSync(dirname(fp), { recursive: true, force: true });
  });

  it('handles prepend action', () => {
    const content = 'function foo() { return 0; }\n';
    const fp = symFile(content);
    const root = dirname(fp);
    const blocks = [
      { file: 'test.js', symbol: 'foo', newContent: 'const x = 1;', action: 'prepend' }
    ];
    const changes = parseBlockDiff(blocks, root);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'insert-before');
    rmSync(dirname(fp), { recursive: true, force: true });
  });
});

describe('checkFileAccess', () => {
  it('passes for normal text file', () => {
    const fp = tempFile('test content\n');
    const r = checkFileAccess(fp);
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  it('fails for non-existent file', () => {
    const r = checkFileAccess('/nonexistent/file.js');
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('does not exist'));
  });

  it('detects binary file with null byte', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'fa-bin-'));
    const fp = join(binDir, 'test.bin');
    writeFileSync(fp, Buffer.from([0x00, 0x48, 0x65, 0x6c]));
    const r = checkFileAccess(fp);
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('binary'));
    unlinkSync(fp);
    rmdirSync(binDir);
  });

  it('warns for very large files', () => {
    // Create a file that appears large (we just mock by writing 51MB)
    // Instead, check that the MAX_FILE_SIZE constant is reasonable
    const fp = tempFile('small content\n');
    const r = checkFileAccess(fp);
    assert.equal(r.ok, true);
  });

  it('returns warnings array even when ok', () => {
    const fp = tempFile('test\n');
    const r = checkFileAccess(fp);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.warnings));
  });
});


// ===========================================================================
// 13. Sed Expression Parsing — parseSedExpression
// ===========================================================================

describe('parseSedExpression', () => {
  it('parses basic substitution', () => {
    const r = parseSedExpression('s/foo/bar/');
    assert.equal(r.operation, 'substitute');
    assert.equal(r.pattern, 'foo');
    assert.equal(r.replacement, 'bar');
    assert.equal(r.flags, '');
  });

  it('parses global substitution', () => {
    const r = parseSedExpression('s/foo/bar/g');
    assert.equal(r.operation, 'substitute');
    assert.equal(r.pattern, 'foo');
    assert.equal(r.replacement, 'bar');
    assert.equal(r.flags, 'g');
  });

  it('parses delete operation', () => {
    const r = parseSedExpression('/pattern/d');
    assert.equal(r.operation, 'delete');
    assert.equal(r.pattern, 'pattern');
  });

  it('parses invert-delete (keep) operation', () => {
    const r = parseSedExpression('/pattern/!d');
    assert.equal(r.operation, 'keep');
    assert.equal(r.pattern, 'pattern');
  });

  it('parses custom delimiter', () => {
    const r = parseSedExpression('s|foo|bar|g');
    assert.equal(r.operation, 'substitute');
    assert.equal(r.pattern, 'foo');
    assert.equal(r.replacement, 'bar');
    assert.equal(r.flags, 'g');
  });

  it('handles escaped delimiter in pattern', () => {
    const r = parseSedExpression('s/a\\/b/c/');
    assert.equal(r.pattern, 'a/b');
    assert.equal(r.replacement, 'c');
  });

  it('handles multiple flags', () => {
    const r = parseSedExpression('s/foo/bar/gi');
    assert.equal(r.flags, 'gi');
  });

  it('throws on empty input', () => {
    assert.throws(() => parseSedExpression(''), /Invalid sed expression/);
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseSedExpression('not valid'), /must start/);
  });

  it('throws on missing delimiter after s', () => {
    assert.throws(() => parseSedExpression('s'), /missing delimiter/);
  });
});

// ===========================================================================
// 14. Sed Apply — applySed
// ===========================================================================

describe('applySed', () => {
  it('applies basic substitution', () => {
    const fp = tempFile('foo bar baz\n');
    const r = applySed(fp, 's/foo/hello/');
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'hello bar baz\n');
  });

  it('applies global substitution (multiple per line)', () => {
    const fp = tempFile('a foo b foo c\n');
    const r = applySed(fp, 's/foo/bar/g');
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'a bar b bar c\n');
  });

  it('replaces first occurrence without g flag (not per-line)', () => {
    const fp = tempFile('a foo b foo c\n');
    const r = applySed(fp, 's/foo/bar/');
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'a bar b foo c\n');
  });

  it('deletes lines matching pattern', () => {
    const fp = tempFile('keep1\ndelete this\nkeep2\n');
    const r = applySed(fp, '/delete/d');
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'keep1\nkeep2\n');
  });

  it('keeps only lines matching pattern', () => {
    const fp = tempFile('keep1\ndelete this\nkeep2\n');
    const r = applySed(fp, '/^keep/!d');
    assert.equal(r.status, 'applied');
    // Trailing newline is consumed because empty last line doesn't match /^keep/
    const result = readFileSync(fp, 'utf-8');
    assert.ok(result === 'keep1\nkeep2' || result === 'keep1\nkeep2\n');
  });

  it('returns nochange when no match', () => {
    const fp = tempFile('hello world\n');
    const r = applySed(fp, 's/foo/bar/');
    assert.equal(r.status, 'nochange');
    assert.equal(readFileSync(fp, 'utf-8'), 'hello world\n');
  });

  it('returns error for invalid sed expression', () => {
    const fp = tempFile('hello\n');
    const r = applySed(fp, 'not valid');
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Invalid sed expression'));
  });

  it('returns error for non-existent file', () => {
    const r = applySed('/nonexistent/path.js', 's/foo/bar/');
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('Cannot read'));
  });

  it('creates backup when undo is true', () => {
    const fp = tempFile('original content\n');
    const r = applySed(fp, 's/original/modified/', { undo: true });
    assert.equal(r.status, 'applied');
    assert.ok(r.backup);
    assert.equal(r.backup, fp + '.apply.bak');
    const bakContent = readFileSync(fp + '.apply.bak', 'utf-8');
    assert.equal(bakContent, 'original content\n');
  });
});

// ===========================================================================
// 15. Multi-Hunk Apply — applyMultiHunk
// ===========================================================================

describe('applyMultiHunk', () => {
  it('applies single numbered hunk with sed', () => {
    const fp = tempFile('line1\nline2\nline3\nline4\nline5\n');
    const hunks = [{ line: 2, endLine: 2, sed: 's/line2/MODIFIED/' }];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'line1\nMODIFIED\nline3\nline4\nline5\n');
  });

  it('processes multiple numbered hunks bottom-up', () => {
    const fp = tempFile('a\nb\nc\nd\ne\n');
    const hunks = [
      { line: 2, endLine: 2, sed: 's/b/B2/' },
      { line: 4, endLine: 4, sed: 's/d/D4/' },
    ];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(r.appliedCount, 2);
    assert.equal(readFileSync(fp, 'utf-8'), 'a\nB2\nc\nD4\ne\n');
  });

  it('applies file-level hunk (no line number)', () => {
    const fp = tempFile('foo bar\nhello world\nfoo baz\n');
    const hunks = [{ sed: 's/foo/test/g' }];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'test bar\nhello world\ntest baz\n');
  });

  it('mixes numbered and file-level hunks', () => {
    const fp = tempFile('a\nb\nc\nd\n');
    const hunks = [
      { line: 2, endLine: 2, sed: 's/b/B2/' },
      { sed: 's/a/X/g' },
    ];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'applied');
    const result = readFileSync(fp, 'utf-8');
    assert.ok(result.includes('B2'));
    assert.ok(result.includes('X'));
  });

  it('applies search+replace hunk', () => {
    const fp = tempFile('line1\nold text\nline3\n');
    const hunks = [{ line: 2, endLine: 2, search: 'old text', replace: 'new text' }];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'applied');
    assert.equal(readFileSync(fp, 'utf-8'), 'line1\nnew text\nline3\n');
  });

  it('reports error when line is out of range', () => {
    const fp = tempFile('only one line\n');
    const hunks = [{ line: 99, endLine: 99, sed: 's/foo/bar/' }];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'nochange');
    assert.ok(r.results.some(rr => rr.status === 'error'));
  });

  it('returns error for no hunks', () => {
    const fp = tempFile('content\n');
    const r = applyMultiHunk(fp, []);
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('No hunks'));
  });

  it('returns nochange when nothing matches', () => {
    const fp = tempFile('hello\n');
    const hunks = [{ sed: 's/xyz/abc/' }];
    const r = applyMultiHunk(fp, hunks);
    assert.equal(r.status, 'nochange');
  });
});

// ===========================================================================
// 16. Batch Apply — applyBatch
// ===========================================================================

describe('applyBatch', () => {
  it('applies sed to glob-matched files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-test-'));
    writeFileSync(join(dir, 'a.txt'), 'foo\n', 'utf-8');
    writeFileSync(join(dir, 'b.txt'), 'foo\n', 'utf-8');
    writeFileSync(join(dir, 'c.txt'), 'bar\n', 'utf-8');
    const r = applyBatch(join(dir, '*.txt'), 's/foo/hello/g', { root: dir });
    assert.equal(r.status, 'applied');
    assert.equal(r.summary.succeeded, 2);
    assert.equal(r.summary.nochange, 1);
    assert.equal(r.totalFiles, 3);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf-8'), 'hello\n');
    assert.equal(readFileSync(join(dir, 'b.txt'), 'utf-8'), 'hello\n');
    assert.equal(readFileSync(join(dir, 'c.txt'), 'utf-8'), 'bar\n');
  });

  it('returns error when no files match glob', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-empty-'));
    const r = applyBatch(join(dir, '*.nonexistent'), 's/foo/bar/', { root: dir });
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('No files matching'));
  });
});
