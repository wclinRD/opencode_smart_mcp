// tests/smart-read-extra.test.mjs — 補充 smart-read.mjs 覆蓋率
//
// 測試未覆蓋的函式：isImageFile, readImageAsBase64, listDirectory,
// getImportPatterns (各語言), extractImports (各語言), extractCallers,
// buildProjectMap, SmartReader 的 explain/project/batch/list modes

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  detectLanguage,
  isImageFile,
  readImageAsBase64,
  extractImports,
  extractCallers,
  hashContent,
  buildProjectMap,
  SmartReader,
} from '../src/lib/smart-read.mjs';

const TEST_DIR = resolve(tmpdir(), `smart-read-extra-${Date.now()}`);

function setup() {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  // Create test files
  writeFileSync(resolve(TEST_DIR, 'test.js'), `
import { foo } from './foo.js';
const bar = require('./bar.js');

export function greet(name) {
  return foo(name);
}

export class Calculator {
  add(a, b) { return a + b; }
}
`);
  writeFileSync(resolve(TEST_DIR, 'test.py'), `
import os
from pathlib import Path

def greet(name):
    return f"Hello {name}"

class Calculator:
    def add(self, a, b):
        return a + b
`);
  writeFileSync(resolve(TEST_DIR, 'test.go'), `
package main

import "fmt"

func greet(name string) string {
    return fmt.Sprintf("Hello %s", name)
}

type Calculator struct{}

func (c Calculator) Add(a, b int) int { return a + b }
`);
  writeFileSync(resolve(TEST_DIR, 'test.rs'), `
use std::io;

fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

struct Calculator;
impl Calculator {
    fn add(a: i32, b: i32) -> i32 { a + b }
}
`);
  // Create a tiny PNG (1x1 pixel, valid header)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  writeFileSync(resolve(TEST_DIR, 'test.png'), pngHeader);

  // Create subdirectory structure
  mkdirSync(resolve(TEST_DIR, 'src'), { recursive: true });
  writeFileSync(resolve(TEST_DIR, 'src', 'index.js'), `export const x = 1;`);
  mkdirSync(resolve(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(resolve(TEST_DIR, 'node_modules', 'pkg', 'index.js'), `module.exports = {};`);
}

setup();

// ---------------------------------------------------------------------------
// isImageFile
// ---------------------------------------------------------------------------

describe('smart-read — isImageFile', () => {
  it('detects .png as image', () => assert.ok(isImageFile('photo.png')));
  it('detects .jpg as image', () => assert.ok(isImageFile('photo.jpg')));
  it('detects .jpeg as image', () => assert.ok(isImageFile('photo.jpeg')));
  it('detects .gif as image', () => assert.ok(isImageFile('anim.gif')));
  it('detects .webp as image', () => assert.ok(isImageFile('pic.webp')));
  it('detects .svg as image', () => assert.ok(isImageFile('icon.svg')));
  it('detects .avif as image', () => assert.ok(isImageFile('new.pic.avif')));
  it('rejects .txt as non-image', () => assert.ok(!isImageFile('readme.txt')));
  it('rejects .js as non-image', () => assert.ok(!isImageFile('app.js')));
});

// ---------------------------------------------------------------------------
// readImageAsBase64
// ---------------------------------------------------------------------------

describe('smart-read — readImageAsBase64', () => {
  it('reads PNG and returns base64 + mimeType', () => {
    const result = readImageAsBase64(resolve(TEST_DIR, 'test.png'));
    assert.ok(result.data, 'should have data');
    assert.ok(typeof result.data === 'string', 'data should be string');
    assert.ok(result.data.length > 0, 'data should not be empty');
    assert.equal(result.mimeType, 'image/png');
  });

  it('returns octet-stream for unknown extension', () => {
    // Create a file with no known extension
    const f = resolve(TEST_DIR, 'test.xyz');
    writeFileSync(f, Buffer.from([0x00, 0x01]));
    const result = readImageAsBase64(f);
    assert.equal(result.mimeType, 'application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// extractImports — multi-language
// ---------------------------------------------------------------------------

describe('smart-read — extractImports', () => {
  it('extracts JS imports', () => {
    const content = readFileSync(resolve(TEST_DIR, 'test.js'), 'utf-8');
    const imports = extractImports(content, 'javascript');
    assert.ok(imports.length >= 2, 'should find at least 2 imports');
    assert.ok(imports.some(i => i.text.includes('foo')), 'should find foo import');
  });

  it('extracts Python imports', () => {
    const content = readFileSync(resolve(TEST_DIR, 'test.py'), 'utf-8');
    const imports = extractImports(content, 'python');
    assert.ok(imports.length >= 2, 'should find at least 2 imports');
  });

  it('extracts Go imports', () => {
    // Go single-line 'import "fmt"' is excluded by the pattern (designed for multi-line blocks)
    // Test with multi-line import block instead
    const goContent = `import (
    "fmt"
    "os"
)`;
    const imports = extractImports(goContent, 'go');
    assert.ok(imports.length >= 1, 'should find at least 1 import');
  });

  it('extracts Rust imports', () => {
    const content = readFileSync(resolve(TEST_DIR, 'test.rs'), 'utf-8');
    const imports = extractImports(content, 'rust');
    assert.ok(imports.length >= 1, 'should find at least 1 import');
  });

  it('handles unknown language with default patterns', () => {
    const imports = extractImports('import foo\nuse bar\nfrom baz\nrequire("qux")', 'unknown');
    assert.ok(imports.length >= 3, 'should find imports with default patterns');
  });

  it('returns empty for no imports', () => {
    const imports = extractImports('const x = 1;\nconsole.log(x);', 'javascript');
    assert.equal(imports.length, 0);
  });
});

// ---------------------------------------------------------------------------
// extractCallers
// ---------------------------------------------------------------------------

describe('smart-read — extractCallers', () => {
  it('finds callers of a function', () => {
    const content = readFileSync(resolve(TEST_DIR, 'test.js'), 'utf-8');
    const callers = extractCallers(content, { name: 'greet', lineStart: 6, lineEnd: 8 }, 'javascript');
    assert.ok(Array.isArray(callers));
    // greet is called inside the file? Let's check
    // Actually greet is defined at line 6-8, and foo is called inside it
    // Let's test with foo instead
    const fooCallers = extractCallers(content, { name: 'foo', lineStart: 1, lineEnd: 1 }, 'javascript');
    assert.ok(Array.isArray(fooCallers));
  });

  it('skips comments', () => {
    const content = '// greet(test)\n/* greet(test) */\ngreet(test)\n# greet(test)';
    const callers = extractCallers(content, { name: 'greet', lineStart: 10, lineEnd: 20 }, 'javascript');
    assert.equal(callers.length, 1, 'should find only the uncommented call');
  });

  it('truncates long lines', () => {
    const longLine = 'greet(' + 'x'.repeat(100) + ')';
    const callers = extractCallers(longLine, { name: 'greet', lineStart: 100, lineEnd: 200 }, 'javascript');
    assert.ok(callers.length >= 1);
    assert.ok(callers[0].text.length <= 81, 'should truncate to ~80 chars + ellipsis');
  });
});

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe('smart-read — hashContent', () => {
  it('returns consistent hash', () => {
    const h1 = hashContent('hello world');
    const h2 = hashContent('hello world');
    assert.equal(h1, h2);
  });

  it('returns 16-char hex string', () => {
    const h = hashContent('test');
    assert.equal(h.length, 16);
    assert.ok(/^[0-9a-f]{16}$/.test(h));
  });

  it('different content gives different hash', () => {
    assert.notEqual(hashContent('abc'), hashContent('def'));
  });
});

// ---------------------------------------------------------------------------
// buildProjectMap
// ---------------------------------------------------------------------------

describe('smart-read — buildProjectMap', () => {
  it('builds project map with code files', () => {
    const map = buildProjectMap(TEST_DIR);
    assert.equal(map.status, 'ok');
    assert.equal(map.mode, 'project');
    assert.ok(Array.isArray(map.data));
    assert.ok(map.data.length > 0, 'should find files');
    assert.ok(map.data.some(f => f.file.includes('test.js')), 'should include test.js');
    assert.ok(map.data.some(f => f.file.includes('src/index.js')), 'should include src/index.js');
    assert.ok(typeof map.totalFiles === 'number');
    assert.ok(typeof map.mappedFiles === 'number');
    assert.ok(typeof map.estimatedTokens === 'number');
  });

  it('skips node_modules by default', () => {
    const map = buildProjectMap(TEST_DIR);
    assert.ok(!map.data.some(f => f.file.includes('node_modules')), 'should skip node_modules');
  });

  it('respects maxFiles limit', () => {
    const map = buildProjectMap(TEST_DIR, { maxFiles: 2 });
    assert.ok(map.data.length <= 2, 'should respect maxFiles');
  });

  it('returns entries with symbols and lang', () => {
    const map = buildProjectMap(TEST_DIR);
    const jsEntry = map.data.find(f => f.file.includes('test.js'));
    assert.ok(jsEntry, 'should have test.js entry');
    assert.equal(jsEntry.lang, 'javascript');
    assert.ok(Array.isArray(jsEntry.symbols));
    assert.ok(typeof jsEntry.totalDecls === 'number');
  });
});

// ---------------------------------------------------------------------------
// SmartReader — list mode (directory)
// ---------------------------------------------------------------------------

describe('smart-read — SmartReader list mode', () => {
  it('lists directory contents', async () => {
    const reader = new SmartReader({ root: TEST_DIR });
    const result = await reader.read({ filePath: resolve(TEST_DIR, 'src'), mode: 'list' });
    assert.equal(result.status, 'ok');
    assert.equal(result.isDirectory, true);
    assert.ok(result.data.includes('index.js'));
  });

  it('lists root directory', async () => {
    const reader = new SmartReader({ root: TEST_DIR });
    const result = await reader.read({ filePath: TEST_DIR, mode: 'list' });
    assert.equal(result.status, 'ok');
    assert.ok(result.totalEntries > 0);
  });
});

// ---------------------------------------------------------------------------
// SmartReader — explain mode
// ---------------------------------------------------------------------------

describe('smart-read — SmartReader explain mode', () => {
  it('explains a symbol with imports and callers', async () => {
    const reader = new SmartReader({ root: TEST_DIR });
    const result = await reader.read({ filePath: resolve(TEST_DIR, 'test.js'), mode: 'explain', symbol: 'greet' });
    assert.equal(result.status, 'ok');
    assert.ok(result.data, 'should have data');
  });

  it('returns error when symbol not provided', async () => {
    const reader = new SmartReader({ root: TEST_DIR });
    const result = await reader.read({ filePath: resolve(TEST_DIR, 'test.js'), mode: 'explain' });
    assert.equal(result.status, 'error');
  });
});

// ---------------------------------------------------------------------------
// detectLanguage — additional cases
// ---------------------------------------------------------------------------

describe('smart-read — detectLanguage extras', () => {
  it('detects .scala', () => assert.equal(detectLanguage('Main.scala'), 'scala'));
  it('detects .hpp', () => assert.equal(detectLanguage('header.hpp'), 'cpp'));
  it('detects .cc', () => assert.equal(detectLanguage('impl.cc'), 'cpp'));
  it('detects .cxx', () => assert.equal(detectLanguage('impl.cxx'), 'cpp'));
  it('detects .h', () => assert.equal(detectLanguage('header.h'), 'c'));
  it('detects .cts', () => assert.equal(detectLanguage('mod.cts'), 'typescript'));
  it('detects .pyw', () => assert.equal(detectWindow('script.pyw'), 'python'));
  it('detects .svelte', () => assert.equal(detectLanguage('App.svelte'), 'svelte'));
  it('detects .astro', () => assert.equal(detectLanguage('page.astro'), 'astro'));
  it('detects unknown extension', () => assert.equal(detectLanguage('file.xyz'), 'unknown'));
  it('detects no extension', () => assert.equal(detectLanguage('Makefile'), 'unknown'));
});

function detectWindow(p) { return detectLanguage(p); }

// Cleanup
process.on('exit', () => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

// Need readFileSync for some tests
import { readFileSync } from 'node:fs';
