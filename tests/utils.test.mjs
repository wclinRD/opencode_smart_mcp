// utils.test.mjs — Tests for shared utilities
//
// Covers: COLORS, useColor, globToRegex, matchGlob, findFiles,
//         readFileSafe, formatDuration
//
// Run: node --test tests/utils.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COLORS,
  useColor,
  globToRegex,
  matchGlob,
  findFiles,
  readFileSafe,
  formatDuration,
} from '../src/lib/utils.mjs';

const TMP = resolve(process.cwd(), '.test-utils-' + Date.now());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('COLORS', () => {

  it('has expected ANSI codes', () => {
    assert.equal(COLORS.reset, '\x1b[0m');
    assert.equal(COLORS.bold, '\x1b[1m');
    assert.equal(COLORS.red, '\x1b[31m');
    assert.equal(COLORS.green, '\x1b[32m');
    assert.equal(COLORS.yellow, '\x1b[33m');
    assert.equal(COLORS.blue, '\x1b[34m');
    assert.equal(COLORS.cyan, '\x1b[36m');
  });
});

describe('useColor', () => {

  it('returns true when color:true', () => {
    assert.equal(useColor({ color: true }), true);
  });

  it('returns false when color:false', () => {
    assert.equal(useColor({ color: false }), false);
  });

  it('returns isTTY when no color option', () => {
    const r = useColor({});
    // In test runner, stdout may not be TTY → returns undefined
    assert.ok(typeof r === 'boolean' || r === undefined);
  });
});

describe('globToRegex', () => {

  it('converts * to match any non-slash chars', () => {
    const re = new RegExp(globToRegex('*.js'));
    assert.equal(re.test('file.js'), true);
    assert.equal(re.test('dir/file.js'), false);
  });

  it('converts ** to match any path', () => {
    const re = new RegExp(globToRegex('**/*.js'));
    assert.equal(re.test('file.js'), true);
    assert.equal(re.test('dir/sub/file.js'), true);
  });

  it('converts ? to match single char', () => {
    const re = new RegExp(globToRegex('file?.js'));
    assert.equal(re.test('file1.js'), true);
    assert.equal(re.test('file.js'), false);
    assert.equal(re.test('file12.js'), false);
  });

  it('converts {a,b} to alternation', () => {
    const re = new RegExp(globToRegex('file.{js,ts}'));
    assert.equal(re.test('file.js'), true);
    assert.equal(re.test('file.ts'), true);
    assert.equal(re.test('file.css'), false);
  });

  it('converts [abc] character class', () => {
    const re = new RegExp(globToRegex('file[123].js'));
    assert.equal(re.test('file1.js'), true);
    assert.equal(re.test('file2.js'), true);
    assert.equal(re.test('file4.js'), false);
  });

  it('escapes regex special chars', () => {
    const re = new RegExp(globToRegex('file+.js'));
    assert.equal(re.test('file+.js'), true);
    assert.equal(re.test('filex.js'), false);
  });

  it('handles **/ pattern', () => {
    const re = new RegExp(globToRegex('**/test/**'));
    assert.equal(re.test('test/file.js'), true);
    assert.equal(re.test('a/test/b/file.js'), true);
  });
});

describe('matchGlob', () => {

  it('matches simple patterns', () => {
    assert.equal(matchGlob('*.js', 'file.js'), true);
    assert.equal(matchGlob('*.js', 'file.ts'), false);
  });

  it('matches path patterns', () => {
    assert.equal(matchGlob('src/**/*.js', 'src/lib/utils.js'), true);
    assert.equal(matchGlob('src/**/*.js', 'test/utils.js'), false);
  });

  it('returns false for invalid pattern', () => {
    assert.equal(matchGlob('[unclosed', 'test'), false);
  });
});

describe('findFiles', () => {

  before(() => {
    mkdirSync(resolve(TMP, 'src'), { recursive: true });
    mkdirSync(resolve(TMP, 'node_modules'), { recursive: true });
    writeFileSync(resolve(TMP, 'src/a.js'), '');
    writeFileSync(resolve(TMP, 'src/b.ts'), '');
    writeFileSync(resolve(TMP, 'src/c.test.js'), '');
    writeFileSync(resolve(TMP, 'node_modules/pkg.js'), '');
  });
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('finds files matching include pattern', () => {
    const files = findFiles(TMP, ['**/*.js']);
    const names = files.map(f => f.replace(TMP + '/', ''));
    assert.ok(names.includes('src/a.js'));
    assert.ok(names.includes('src/c.test.js'));
  });

  it('excludes patterns', () => {
    const files = findFiles(TMP, ['**/*.js'], ['**/*.test.js']);
    const names = files.map(f => f.replace(TMP + '/', ''));
    assert.ok(names.includes('src/a.js'));
    assert.ok(!names.includes('src/c.test.js'));
  });

  it('skips node_modules by default', () => {
    const files = findFiles(TMP, ['**/*.js']);
    const names = files.map(f => f.replace(TMP + '/', ''));
    assert.ok(!names.some(n => n.includes('node_modules')));
  });

  it('returns all files when no include pattern', () => {
    const files = findFiles(TMP, []);
    assert.ok(files.length >= 3);
  });
});

describe('readFileSafe', () => {

  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('reads existing file', () => {
    writeFileSync(resolve(TMP, 'test.txt'), 'hello');
    assert.equal(readFileSafe(resolve(TMP, 'test.txt')), 'hello');
  });

  it('returns null for non-existent file', () => {
    assert.equal(readFileSafe('/nonexistent/path'), null);
  });
});

describe('formatDuration', () => {

  it('formats ms', () => {
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(999), '999ms');
  });

  it('formats seconds', () => {
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(30000), '30.0s');
  });

  it('formats minutes', () => {
    assert.equal(formatDuration(65000), '1m 5s');
    assert.equal(formatDuration(125000), '2m 5s');
  });
});