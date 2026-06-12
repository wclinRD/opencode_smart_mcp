// tests/codebase-index.test.mjs — Phase 19 Codebase Index tests
//
// Tests: build, update, query, map, stats, import graph, call graph

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { CodebaseIndex, getCodebaseIndex, resetCodebaseIndex } from '../src/lib/codebase-index.mjs';

const TEST_DIR = join(os.tmpdir(), `codebase-index-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, 'test-index.db');

function createTestProject() {
  // Create a mini test project
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'src', 'utils'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'src', 'models'), { recursive: true });

  // Main file with class and functions
  writeFileSync(join(TEST_DIR, 'src', 'main.js'), `
import { helper } from './utils/helper.js';
import { User } from './models/user.js';

export class App {
  constructor(name) {
    this.name = name;
  }

  async start() {
    const result = helper(this.name);
    return result;
  }

  stop() {
    console.log('stopping');
  }
}

export function createApp(name) {
  return new App(name);
}

const DEFAULT_NAME = 'myapp';
export default App;
`);

  // Helper with exported function
  writeFileSync(join(TEST_DIR, 'src', 'utils', 'helper.js'), `
export function helper(name) {
  return \`Hello, \${name}!\`;
}

export function formatString(str) {
  return str.trim().toLowerCase();
}

function internalHelper(x) {
  return x * 2;
}
`);

  // Model with class
  writeFileSync(join(TEST_DIR, 'src', 'models', 'user.js'), `
export class User {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  greet() {
    return \`Hi, I'm \${this.name}\`;
  }

  static create(id, name) {
    return new User(id, name);
  }
}

export function findUser(id) {
  return new User(id, 'test');
}
`);

  // Python file
  writeFileSync(join(TEST_DIR, 'src', 'config.py'), `
class Config:
    def __init__(self, path):
        self.path = path

    def load(self):
        with open(self.path) as f:
            return f.read()

def get_config(path):
    return Config(path)

DEFAULT_CONFIG = "/etc/app.conf"
`);

  // TypeScript file with interface and type
  writeFileSync(join(TEST_DIR, 'src', 'types.ts'), `
export interface UserData {
  id: number;
  name: string;
  email?: string;
}

export type UserRole = 'admin' | 'user' | 'guest';

export enum Status {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending'
}

export function validateUser(data: UserData): boolean {
  return data.id > 0 && data.name.length > 0;
}
`);
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  resetCodebaseIndex();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodebaseIndex', () => {
  before(() => {
    cleanup();
    createTestProject();
  });

  after(() => {
    cleanup();
  });

  // --- Build ---

  it('should build index from project files', () => {
    const index = new CodebaseIndex(TEST_DB);
    const result = index.buildIndex(TEST_DIR);

    assert.ok(result.files >= 4, `Expected at least 4 files, got ${result.files}`);
    assert.ok(result.symbols > 10, `Expected >10 symbols, got ${result.symbols}`);
    assert.ok(result.imports > 0, `Expected imports, got ${result.imports}`);
    assert.ok(result.elapsedMs >= 0, 'elapsedMs should be non-negative');
    index.close();
  });

  it('should detect languages correctly', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR);

    const stats = index.getStats();
    const languages = stats.byLanguage.map(l => l.language);
    assert.ok(languages.includes('javascript'), 'Should detect JavaScript');
    assert.ok(languages.includes('python'), 'Should detect Python');
    assert.ok(languages.includes('typescript'), 'Should detect TypeScript');
    index.close();
  });

  // --- Query ---

  it('should query symbols by name', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const results = index.querySymbol('App');
    assert.ok(results.length > 0, 'Should find App symbols');
    assert.ok(results.some(r => r.name === 'App' && r.kind === 'class'), 'Should find App class');
    index.close();
  });

  it('should query symbols with kind filter', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const classes = index.querySymbol('', { kind: 'class' });
    assert.ok(classes.length >= 2, `Expected at least 2 classes, got ${classes.length}`);
    assert.ok(classes.every(r => r.kind === 'class'), 'All results should be classes');
    index.close();
  });

  it('should find exported symbols', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const results = index.querySymbol('helper');
    const exported = results.filter(r => r.exported);
    assert.ok(exported.length > 0, 'Should find exported helper');
    index.close();
  });

  it('should find Python symbols', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const results = index.querySymbol('Config');
    const pyConfig = results.filter(r => r.language === 'python');
    assert.ok(pyConfig.length > 0, 'Should find Python Config class');
    index.close();
  });

  it('should find TypeScript interfaces and types', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const interfaces = index.querySymbol('', { kind: 'interface' });
    assert.ok(interfaces.length >= 1, 'Should find TypeScript interfaces');

    const types = index.querySymbol('', { kind: 'type' });
    assert.ok(types.length >= 1, 'Should find TypeScript types');

    const enums = index.querySymbol('', { kind: 'enum' });
    assert.ok(enums.length >= 1, 'Should find TypeScript enums');
    index.close();
  });

  // --- Import Graph ---

  it('should generate import graph', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const graph = index.getImportGraph();
    assert.ok(typeof graph === 'object', 'Import graph should be an object');
    // main.js should have imports
    const mainImports = Object.keys(graph).filter(k => k.includes('main.js'));
    assert.ok(mainImports.length > 0, 'main.js should have imports');
    index.close();
  });

  // --- Repo Map ---

  it('should generate repo map', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const map = index.generateRepoMap();
    assert.ok(map.includes('Repository Map'), 'Map should have title');
    assert.ok(map.includes('main.js'), 'Map should include main.js');
    assert.ok(map.includes('helper.js'), 'Map should include helper.js');
    assert.ok(map.includes('user.js'), 'Map should include user.js');
    assert.ok(map.includes('App'), 'Map should include App symbol');
    assert.ok(map.includes('📤'), 'Map should mark exported symbols');
    index.close();
  });

  // --- Stats ---

  it('should return index stats', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const stats = index.getStats();
    assert.ok(stats.files > 0, 'Should have files');
    assert.ok(stats.symbols > 0, 'Should have symbols');
    assert.ok(stats.imports > 0, 'Should have imports');
    assert.ok(Array.isArray(stats.byLanguage), 'byLanguage should be array');
    assert.ok(Array.isArray(stats.byKind), 'byKind should be array');
    index.close();
  });

  // --- Update (incremental) ---

  it('should update index incrementally (no changes)', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const result = index.updateIndex(TEST_DIR, {});
    assert.equal(result.added, 0, 'No files should be added');
    assert.equal(result.updated, 0, 'No files should be updated');
    assert.equal(result.removed, 0, 'No files should be removed');
    index.close();
  });

  it('should detect new files on update', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    // Add a new file
    writeFileSync(join(TEST_DIR, 'src', 'newfile.js'), `
export function newFunction() {
  return 'new';
}
`);

    const result = index.updateIndex(TEST_DIR, {});
    assert.equal(result.added, 1, 'One file should be added');
    index.close();
  });

  it('should detect modified files on update', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    // Modify an existing file
    const helperPath = join(TEST_DIR, 'src', 'utils', 'helper.js');
    const original = readFileSync(helperPath, 'utf-8');
    writeFileSync(helperPath, original + '\nexport function newHelper() { return "modified"; }\n');

    const result = index.updateIndex(TEST_DIR, {});
    assert.equal(result.updated, 1, 'One file should be updated');
    index.close();
  });

  it('should detect deleted files on update', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    // Delete a file
    rmSync(join(TEST_DIR, 'src', 'newfile.js'));

    const result = index.updateIndex(TEST_DIR, {});
    assert.equal(result.removed, 1, 'One file should be removed');
    index.close();
  });

  // --- Call Graph ---

  it('should generate call graph', () => {
    const index = new CodebaseIndex(TEST_DB);
    index.buildIndex(TEST_DIR, {});

    const callGraph = index.getCallGraph('start');
    // start() calls helper()
    assert.ok(Array.isArray(callGraph), 'Call graph should be an array');
    index.close();
  });

  // --- Singleton ---

  it('should use singleton pattern', () => {
    resetCodebaseIndex();
    const idx1 = getCodebaseIndex(TEST_DB);
    const idx2 = getCodebaseIndex(TEST_DB);
    assert.strictEqual(idx1, idx2, 'Should return same instance');
    idx1.close();
    resetCodebaseIndex();
  });

  // --- Empty project ---

  it('should handle empty project gracefully', () => {
    const emptyDir = join(TEST_DIR, 'empty');
    mkdirSync(emptyDir, { recursive: true });

    const index = new CodebaseIndex(join(TEST_DIR, 'empty-index.db'));
    const result = index.buildIndex(emptyDir);
    assert.equal(result.files, 0, 'Empty project should have 0 files');
    assert.equal(result.symbols, 0, 'Empty project should have 0 symbols');
    index.close();
  });

  // --- Non-existent directory ---

  it('should handle non-existent directory gracefully', () => {
    const index = new CodebaseIndex(join(TEST_DIR, 'nonexistent-index.db'));
    const result = index.buildIndex('/nonexistent/path/12345');
    assert.equal(result.files, 0, 'Non-existent dir should have 0 files');
    index.close();
  });
});