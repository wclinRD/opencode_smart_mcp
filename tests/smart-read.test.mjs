// smart-read.test.mjs — Progressive File Reading Tests (Phase 21)
//
// Tests: language detection, outline, signatures, symbol extraction,
// full read, error handling, multi-language support (JS/TS/Python/Go/Rust)

import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import {
  SmartReader,
  detectLanguage,
  parseDeclarations,
  generateOutline,
  generateSignatures,
  extractSymbol,
} from '../src/lib/smart-read.mjs';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const JS_FIXTURE = `// hello.js — test fixture
import { foo } from './foo';

const GREETING = 'Hello';

function greet(name) {
  console.log(GREETING + ', ' + name);
  return GREETING + ', ' + name;
}

class Greeter {
  constructor(prefix) {
    this.prefix = prefix;
  }

  greet(name) {
    return this.prefix + ' ' + name;
  }
}

const farewell = (name) => {
  return 'Goodbye, ' + name;
};

export function publicHello(name) {
  return 'Hello, ' + name;
}

export default class DefaultExporter {
  run() {
    return 'running';
  }
}
`;

const TS_FIXTURE = `// types.ts — test fixture for TypeScript
export interface User {
  id: number;
  name: string;
  email?: string;
}

export type Status = 'active' | 'inactive';

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export class UserService {
  private users: Map<number, User> = new Map();

  constructor() {
    console.log('UserService created');
  }

  async findUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }
}

export function createUser(name: string, email?: string): User {
  return { id: Date.now(), name, email };
}

const DEFAULT_LIMIT = 100;
`;

const PY_FIXTURE = `# hello.py — test fixture
import os
import sys

def greet(name):
    """Greet someone."""
    print(f"Hello, {name}")

class Person:
    """A person class."""
    
    def __init__(self, name):
        self.name = name
    
    def say_hello(self):
        greet(self.name)

async def async_fetch(url):
    """Async fetch example."""
    return {"status": 200}

@property
def full_name(self):
    return self.name
`;

const GO_FIXTURE = `package main

import "fmt"

func greet(name string) string {
	return "Hello, " + name
}

type Person struct {
	Name string
	Age  int
}

func (p *Person) SayHello() string {
	return greet(p.Name)
}

type Greeter interface {
	Greet(name string) string
}

func main() {
	fmt.Println(greet("World"))
}
`;

const RUST_FIXTURE = `fn greet(name: &str) -> String {
    format!("Hello, {}", name)
}

struct Person {
    name: String,
    age: u32,
}

impl Person {
    fn new(name: String, age: u32) -> Self {
        Self { name, age }
    }

    fn say_hello(&self) -> String {
        greet(&self.name)
    }
}

trait Speaker {
    fn speak(&self) -> String;
}

enum Status {
    Active,
    Inactive,
}

const MAX_RETRIES: u32 = 3;

pub fn public_api() -> String {
    "public".to_string()
}
`;

// ---------------------------------------------------------------------------
// Language Detection Tests
// ---------------------------------------------------------------------------

describe('detectLanguage', () => {
  const cases = [
    ['file.js', 'javascript'],
    ['file.jsx', 'javascript'],
    ['file.mjs', 'javascript'],
    ['file.cjs', 'javascript'],
    ['file.ts', 'typescript'],
    ['file.tsx', 'typescript'],
    ['file.mts', 'typescript'],
    ['file.py', 'python'],
    ['file.go', 'go'],
    ['file.rs', 'rust'],
    ['file.rb', 'ruby'],
    ['file.php', 'php'],
    ['file.java', 'java'],
    ['file.swift', 'swift'],
    ['file.kt', 'kotlin'],
    ['file.c', 'c'],
    ['file.cpp', 'cpp'],
    ['file.cs', 'csharp'],
    ['file.vue', 'vue'],
    ['file.unknown', 'unknown'],
    ['file', 'unknown'],
  ];

  for (const [name, expected] of cases) {
    it(`should detect ${expected} for ${name}`, () => {
      assert.equal(detectLanguage(name), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// JS Outline Tests
// ---------------------------------------------------------------------------

describe('parseDeclarations (JavaScript)', () => {
  const decls = parseDeclarations(JS_FIXTURE, 'javascript');

  it('should detect functions and classes', () => {
    assert.ok(decls.length >= 5, `Expected >=5 declarations, got ${decls.length}`);
  });

  it('should detect function greet', () => {
    const fn = decls.find(d => d.name === 'greet');
    assert.ok(fn, 'greet function not found');
    assert.equal(fn.type, 'function');
    assert.equal(fn.lineStart, 6);
  });

  it('should detect class Greeter', () => {
    const cls = decls.find(d => d.name === 'Greeter');
    assert.ok(cls, 'Greeter class not found');
    assert.equal(cls.type, 'class');
    assert.equal(cls.lineStart, 11);
  });

  it('should detect const GREETING as variable', () => {
    // This might be matched as variable or function depending on pattern
    const v = decls.find(d => d.name === 'GREETING');
    assert.ok(v, 'GREETING not found');
    assert.ok(v.type === 'variable' || v.type === 'function');
  });

  it('should detect arrow function farewell', () => {
    const f = decls.find(d => d.name === 'farewell');
    assert.ok(f, 'farewell not found');
    // Arrow functions with const are matched
    assert.ok(f.type === 'function' || f.type === 'variable', `Expected function/variable type, got ${f.type}`);
  });

  it('should detect exported function publicHello', () => {
    const fn = decls.find(d => d.name === 'publicHello');
    assert.ok(fn, 'publicHello not found');
    assert.equal(fn.lineStart, 25);
  });

  it('should detect default export class', () => {
    const cls = decls.find(d => d.name === 'DefaultExporter');
    assert.ok(cls, 'DefaultExporter not found');
    assert.equal(cls.type, 'class');
  });
});

describe('generateOutline (JavaScript)', () => {
  const outline = generateOutline(JS_FIXTURE, 'javascript');

  it('should return array of {name, type, line}', () => {
    assert.ok(Array.isArray(outline));
    assert.ok(outline.length >= 5);

    for (const entry of outline) {
      assert.ok(typeof entry.name === 'string');
      assert.ok(typeof entry.type === 'string');
      assert.ok(typeof entry.line === 'number');
    }
  });

  it('should contain greet at line 6', () => {
    const greet = outline.find(e => e.name === 'greet');
    assert.ok(greet, 'greet missing from outline');
    assert.equal(greet.line, 6);
  });
});

describe('generateSignatures (JavaScript)', () => {
  const sigs = generateSignatures(JS_FIXTURE, 'javascript');

  it('should include signature text', () => {
    assert.ok(sigs.length >= 5);
    for (const s of sigs) {
      assert.ok(typeof s.signature === 'string');
      assert.ok(typeof s.lineStart === 'number');
      assert.ok(typeof s.lineEnd === 'number');
    }
  });

  it('should have correct greeting signature', () => {
    const greet = sigs.find(s => s.name === 'greet');
    assert.ok(greet);
    assert.ok(greet.lineStart <= greet.lineEnd);
  });
});

describe('extractSymbol (JavaScript)', () => {
  it('should extract greet function body', () => {
    const sym = extractSymbol(JS_FIXTURE, 'javascript', 'greet');
    assert.ok(sym, 'greet symbol not found');
    assert.equal(sym.name, 'greet');
    assert.ok(sym.body, 'body missing');
    assert.ok(sym.body.includes('console.log'));
    assert.ok(sym.body.includes('return'));
  });

  it('should extract class Greeter', () => {
    const sym = extractSymbol(JS_FIXTURE, 'javascript', 'Greeter');
    assert.ok(sym, 'Greeter symbol not found');
    assert.equal(sym.name, 'Greeter');
    assert.equal(sym.type, 'class');
    assert.ok(sym.body.includes('constructor'));
    assert.ok(sym.body.includes('greet'));
  });

  it('should return null for non-existent symbol', () => {
    const sym = extractSymbol(JS_FIXTURE, 'javascript', 'nonExistentFunction');
    assert.equal(sym, null);
  });

  it('should fuzzy-match case insensitive', () => {
    const sym = extractSymbol(JS_FIXTURE, 'javascript', 'GREET');
    assert.ok(sym, 'fuzzy match failed');
    assert.equal(sym.name, 'greet');
  });
});

// ---------------------------------------------------------------------------
// TypeScript Tests
// ---------------------------------------------------------------------------

describe('TypeScript support', () => {
  const decls = parseDeclarations(TS_FIXTURE, 'typescript');

  it('should detect interface', () => {
    const iface = decls.find(d => d.name === 'User');
    assert.ok(iface, 'User interface not found');
    assert.equal(iface.type, 'interface');
  });

  it('should detect type alias', () => {
    const t = decls.find(d => d.name === 'Status');
    assert.ok(t, 'Status type alias not found');
    assert.equal(t.type, 'type');
  });

  it('should detect enum', () => {
    const e = decls.find(d => d.name === 'Role');
    assert.ok(e, 'Role enum not found');
    assert.equal(e.type, 'enum');
  });

  it('should detect class', () => {
    const cls = decls.find(d => d.name === 'UserService');
    assert.ok(cls, 'UserService not found');
    assert.equal(cls.type, 'class');
  });

  it('should detect exported function', () => {
    const fn = decls.find(d => d.name === 'createUser');
    assert.ok(fn, 'createUser not found');
    assert.equal(fn.type, 'function');
  });
});

describe('extractSymbol (TypeScript)', () => {
  it('should extract UserService class', () => {
    const sym = extractSymbol(TS_FIXTURE, 'typescript', 'UserService');
    assert.ok(sym, 'UserService not found');
    assert.equal(sym.type, 'class');
    assert.ok(sym.body.includes('constructor'));
    assert.ok(sym.body.includes('findUser'));
  });

  it('should extract interface User', () => {
    const sym = extractSymbol(TS_FIXTURE, 'typescript', 'User');
    assert.ok(sym, 'User interface not found');
    assert.equal(sym.type, 'interface');
    assert.ok(sym.body.includes('id'));
    assert.ok(sym.body.includes('name'));
  });
});

// ---------------------------------------------------------------------------
// Python Tests
// ---------------------------------------------------------------------------

describe('Python support', () => {
  const decls = parseDeclarations(PY_FIXTURE, 'python');

  it('should detect def greet', () => {
    const fn = decls.find(d => d.name === 'greet');
    assert.ok(fn, 'greet not found');
    assert.equal(fn.type, 'function');
  });

  it('should detect class Person', () => {
    const cls = decls.find(d => d.name === 'Person');
    assert.ok(cls, 'Person not found');
    assert.equal(cls.type, 'class');
  });

  it('should detect async def', () => {
    const fn = decls.find(d => d.name === 'async_fetch');
    assert.ok(fn, 'async_fetch not found');
    assert.equal(fn.type, 'function');
  });
});

describe('extractSymbol (Python)', () => {
  it('should extract Person class body', () => {
    const sym = extractSymbol(PY_FIXTURE, 'python', 'Person');
    assert.ok(sym, 'Person not found');
    assert.equal(sym.type, 'class');
    assert.ok(sym.body.includes('__init__'), 'body missing __init__');
    assert.ok(sym.body.includes('say_hello'), 'body missing say_hello');
  });

  it('should extract greet function', () => {
    const sym = extractSymbol(PY_FIXTURE, 'python', 'greet');
    assert.ok(sym, 'greet not found');
    assert.ok(sym.body.includes('print'), 'body missing print');
  });
});

// ---------------------------------------------------------------------------
// Go Tests
// ---------------------------------------------------------------------------

describe('Go support', () => {
  const decls = parseDeclarations(GO_FIXTURE, 'go');

  it('should detect func greet', () => {
    const fn = decls.find(d => d.name === 'greet');
    assert.ok(fn, 'greet not found');
    assert.equal(fn.type, 'function');
  });

  it('should detect type struct', () => {
    const s = decls.find(d => d.name === 'Person');
    assert.ok(s, 'Person struct not found');
    assert.ok(s.type === 'struct' || s.type === 'type');
  });

  it('should detect method SayHello', () => {
    const fn = decls.find(d => d.name === 'SayHello');
    assert.ok(fn, 'SayHello method not found');
    assert.equal(fn.type, 'function');
  });

  it('should detect interface', () => {
    const iface = decls.find(d => d.name === 'Greeter');
    assert.ok(iface, 'Greeter interface not found');
  });
});

// ---------------------------------------------------------------------------
// Rust Tests
// ---------------------------------------------------------------------------

describe('Rust support', () => {
  const decls = parseDeclarations(RUST_FIXTURE, 'rust');

  it('should detect fn greet', () => {
    const fn = decls.find(d => d.name === 'greet');
    assert.ok(fn, 'greet not found');
    assert.equal(fn.type, 'function');
  });

  it('should detect struct', () => {
    const s = decls.find(d => d.name === 'Person');
    assert.ok(s, 'Person struct not found');
    assert.equal(s.type, 'struct');
  });

  it('should detect impl', () => {
    const imp = decls.find(d => d.name === 'Person' && d.type === 'impl');
    assert.ok(imp, 'impl Person not found');
  });

  it('should detect trait', () => {
    const t = decls.find(d => d.name === 'Speaker');
    assert.ok(t, 'Speaker trait not found');
    assert.equal(t.type, 'trait');
  });

  it('should detect enum', () => {
    const e = decls.find(d => d.name === 'Status');
    assert.ok(e, 'Status enum not found');
    assert.equal(e.type, 'enum');
  });
});

// ---------------------------------------------------------------------------
// SmartReader Integration Tests
// ---------------------------------------------------------------------------

describe('SmartReader class', () => {
  // Create a temp file for testing
  const tmpDir = mkdtempSync(join(tmpdir(), 'smart-read-test-'));
  const tmpFile = join(tmpDir, 'test.js');
  writeFileSync(tmpFile, JS_FIXTURE, 'utf-8');

  const reader = new SmartReader();

  it('should outline a file', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'outline' });
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'outline');
    assert.equal(result.lang, 'javascript');
    assert.ok(Array.isArray(result.data));
    assert.ok(result.data.length >= 5);
    assert.ok(result.totalLines > 0);
  });

  it('should get signatures', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'signatures' });
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'signatures');
    assert.ok(Array.isArray(result.data));
    for (const entry of result.data) {
      assert.ok(typeof entry.signature === 'string');
    }
  });

  it('should extract symbol', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'symbol', symbol: 'Greeter' });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.name, 'Greeter');
    assert.equal(result.data.type, 'class');
    assert.ok(result.data.body.includes('constructor'));
  });

  it('should read full file', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'full' });
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'full');
    assert.ok(typeof result.data === 'string');
    assert.ok(result.data.includes('function greet'));
  });

  it('should support offset/limit in full mode', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'full', offset: 6, limit: 5 });
    assert.equal(result.status, 'ok');
    const lines = result.data.split('\n');
    assert.ok(lines.length <= 5);
    // Line 6 should be the greet function start
    assert.ok(result.data.includes('function greet'));
  });

  it('should error on file not found', async () => {
    const result = await reader.read({ filePath: '/nonexistent/file.js', mode: 'outline' });
    assert.equal(result.status, 'error');
    assert.ok(result.error);
  });

  it('should error on symbol not found', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'symbol', symbol: 'NonExistentSymbol' });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('NonExistentSymbol'));
  });

  it('should error on invalid mode', async () => {
    const result = await reader.read({ filePath: tmpFile, mode: 'invalid' });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('invalid'));
  });

  // Cleanup
  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// File doesn't exist error handling
// ---------------------------------------------------------------------------

describe('File error handling', () => {
  const reader = new SmartReader();

  it('should handle non-existent file gracefully', async () => {
    const result = await reader.read({ filePath: '/tmp/smart-read-nonexistent-12345.js' });
    assert.equal(result.status, 'error');
    assert.ok(result.error.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Multi-language fixture detection counts
// ---------------------------------------------------------------------------

describe('Multi-language detection counts', () => {
  it('should detect correct number of declarations in JS fixture', () => {
    const decls = parseDeclarations(JS_FIXTURE, 'javascript');
    // greet, Greeter (class), farewell, publicHello, DefaultExporter, const GREETING
    assert.ok(decls.length >= 5, `Expected >=5 JS decls, got ${decls.length}`);
  });

  it('should detect TypeScript specific types', () => {
    const decls = parseDeclarations(TS_FIXTURE, 'typescript');
    // User (interface), Status (type), Role (enum), UserService (class), createUser (function), DEFAULT_LIMIT (const)
    assert.ok(decls.length >= 5, `Expected >=5 TS decls, got ${decls.length}`);
    const types = decls.map(d => d.type);
    assert.ok(types.includes('interface'));
    assert.ok(types.includes('type'));
    assert.ok(types.includes('enum'));
  });

  it('should detect Python decorator functions', () => {
    const decls = parseDeclarations(PY_FIXTURE, 'python');
    // greet, Person, __init__, say_hello, async_fetch, full_name
    assert.ok(decls.length >= 4, `Expected >=4 Python decls, got ${decls.length}`);
  });
});
