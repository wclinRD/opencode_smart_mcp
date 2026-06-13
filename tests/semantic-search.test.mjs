// tests/semantic-search.test.mjs — Phase 2: Hybrid Semantic Search tests
//
// Tests for semantic-search.mjs, hybrid-search.mjs, embedding-cache.mjs
// and their integration into contextual-grep.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = new URL('.', import.meta.url).pathname;
const TEST_DIR = join(__dirname, '..', '.test-semantic');
const CLI = join(__dirname, '..', 'src', 'cli', 'contextual-grep.mjs');

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

function setupTestFiles() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });

  writeFileSync(join(TEST_DIR, 'auth.js'), `
function authenticateUser(username, password) {
  const user = findUser(username);
  if (!user) throw new Error('User not found');
  const isValid = verifyPassword(password, user.hash);
  if (!isValid) throw new Error('Invalid password');
  return generateToken(user);
}

class AuthService {
  constructor(db) { this.db = db; }
  async login(username, password) {
    const user = await this.db.findUser(username);
    if (!user) throw new AuthError('Invalid credentials');
    return this.createSession(user);
  }
}

function handleError(err) {
  console.error('Error occurred:', err.message);
  if (err instanceof AuthError) return { status: 401, message: 'Unauthorized' };
  return { status: 500, message: 'Internal server error' };
}

function validateToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET);
    return decoded;
  } catch (e) {
    throw new Error('Token validation failed');
  }
}
`);

  writeFileSync(join(TEST_DIR, 'utils.py'), `
def calculate_hash(data):
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()

def validate_input(value, min_len=1, max_len=100):
    if not value or len(value) < min_len:
        raise ValueError(f"Input too short: {len(value)}")
    if len(value) > max_len:
        raise ValueError(f"Input too long: {len(value)}")
    return value.strip()

class DataProcessor:
    def __init__(self, config):
        self.config = config

    def process(self, data):
        validated = validate_input(data)
        hashed = calculate_hash(validated)
        return {"hash": hashed, "length": len(validated)}
`);
}

function cleanupTestFiles() {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// semantic-search.mjs tests
// ---------------------------------------------------------------------------

describe('semantic-search.mjs', () => {
  it('chunkCode — JS functions and classes', async () => {
    const { chunkCode } = await import('../src/lib/semantic-search.mjs');
    const code = `
function foo() { return 1; }
class Bar {
  method1() { return 'a'; }
  method2() { return 'b'; }
}
function baz(x) { return x * 2; }
`;
    const chunks = chunkCode(code, 'test.js');
    assert.ok(chunks.length >= 3, `Expected >=3 chunks, got ${chunks.length}`);
    const names = chunks.map(c => c.name).filter(Boolean);
    assert.ok(names.includes('foo'), 'Should include foo');
    assert.ok(names.includes('Bar'), 'Should include Bar');
  });

  it('chunkCode — Python functions and classes', async () => {
    const { chunkCode } = await import('../src/lib/semantic-search.mjs');
    const code = `
def hello():
    return "world"

class MyClass:
    def method(self):
        pass
`;
    const chunks = chunkCode(code, 'test.py');
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
  });

  it('chunkCode — falls back to sliding window for unknown lang', async () => {
    const { chunkCode } = await import('../src/lib/semantic-search.mjs');
    const code = 'line1\nline2\nline3\n'.repeat(30);
    const chunks = chunkCode(code, 'test.xyz');
    assert.ok(chunks.length > 0, 'Should produce sliding window chunks');
    for (const c of chunks) {
      assert.equal(c.type, 'block');
    }
  });

  it('semanticSearch — ranks relevant chunks higher', async () => {
    const { chunkCode, semanticSearch } = await import('../src/lib/semantic-search.mjs');
    const code = `
function authenticateUser(username, password) {
  const user = findUser(username);
  if (!user) throw new Error('User not found');
  return generateToken(user);
}

function calculateSum(a, b) {
  return a + b;
}

function handleAuthError(err) {
  if (err instanceof AuthError) return { status: 401 };
  return { status: 500 };
}
`;
    const chunks = chunkCode(code, 'auth.js');
    const results = semanticSearch('authentication error handling', chunks, { topK: 3 });
    assert.ok(results.length > 0, 'Should return results');
    // handleAuthError or authenticateUser should be top
    const topName = results[0].name;
    assert.ok(
      topName === 'handleAuthError' || topName === 'authenticateUser',
      `Expected auth-related function top, got "${topName}"`
    );
  });

  it('semanticSearch — respects topK', async () => {
    const { chunkCode, semanticSearch } = await import('../src/lib/semantic-search.mjs');
    const code = 'function f1(){}\nfunction f2(){}\nfunction f3(){}\nfunction f4(){}\nfunction f5(){}\n';
    const chunks = chunkCode(code, 'test.js');
    const results = semanticSearch('function', chunks, { topK: 2 });
    assert.ok(results.length <= 2, `Expected <=2 results, got ${results.length}`);
  });

  it('semanticSearch — handles empty chunks', async () => {
    const { semanticSearch } = await import('../src/lib/semantic-search.mjs');
    const results = semanticSearch('query', []);
    assert.deepEqual(results, []);
  });
});

// ---------------------------------------------------------------------------
// hybrid-search.mjs tests
// ---------------------------------------------------------------------------

describe('hybrid-search.mjs', () => {
  const bm25Results = [
    { file: 'src/auth.ts', relFile: 'src/auth.ts', bm25Score: 12.5, matches: [{ line: 10 }] },
    { file: 'src/login.ts', relFile: 'src/login.ts', bm25Score: 8.2, matches: [{ line: 25 }] },
    { file: 'src/utils.ts', relFile: 'src/utils.ts', bm25Score: 5.1, matches: [{ line: 42 }] },
  ];

  const semanticResults = [
    { file: 'src/login.ts', relFile: 'src/login.ts', score: 0.85, startLine: 20 },
    { file: 'src/session.ts', relFile: 'src/session.ts', score: 0.72, startLine: 15 },
    { file: 'src/auth.ts', relFile: 'src/auth.ts', score: 0.45, startLine: 5 },
  ];

  it('rrfFusion — merges and re-ranks', async () => {
    const { rrfFusion } = await import('../src/lib/hybrid-search.mjs');
    const merged = rrfFusion(bm25Results, semanticResults);
    assert.ok(merged.length >= 4, `Expected >=4 merged results, got ${merged.length}`);
    // Items in both lists should rank higher
    const topTwo = merged.slice(0, 2).map(r => r.relFile);
    assert.ok(topTwo.includes('src/login.ts') || topTwo.includes('src/auth.ts'),
      'Top results should include items in both lists');
  });

  it('weightedFusion — NL query favors semantic', async () => {
    const { weightedFusion } = await import('../src/lib/hybrid-search.mjs');
    const merged = weightedFusion(bm25Results, semanticResults, 'natural_language');
    // session.ts (semantic-only) should rank higher than utils.ts (BM25-only)
    const sessionRank = merged.findIndex(r => r.relFile === 'src/session.ts');
    const utilsRank = merged.findIndex(r => r.relFile === 'src/utils.ts');
    assert.ok(sessionRank < utilsRank,
      `session.ts (${sessionRank}) should rank before utils.ts (${utilsRank}) for NL query`);
  });

  it('weightedFusion — symbol query favors BM25', async () => {
    const { weightedFusion } = await import('../src/lib/hybrid-search.mjs');
    const merged = weightedFusion(bm25Results, semanticResults, 'symbol');
    // utils.ts (BM25-only) should rank higher than session.ts (semantic-only)
    const utilsRank = merged.findIndex(r => r.relFile === 'src/utils.ts');
    const sessionRank = merged.findIndex(r => r.relFile === 'src/session.ts');
    assert.ok(utilsRank < sessionRank,
      `utils.ts (${utilsRank}) should rank before session.ts (${sessionRank}) for symbol query`);
  });

  it('hybridRank — handles empty semantic results', async () => {
    const { hybridRank } = await import('../src/lib/hybrid-search.mjs');
    const merged = hybridRank(bm25Results, [], 'symbol');
    assert.deepEqual(merged, bm25Results);
  });

  it('hybridRank — handles empty BM25 results', async () => {
    const { hybridRank } = await import('../src/lib/hybrid-search.mjs');
    const merged = hybridRank([], semanticResults, 'symbol');
    assert.deepEqual(merged, semanticResults);
  });

  it('hybridRank — custom semanticWeight', async () => {
    const { hybridRank } = await import('../src/lib/hybrid-search.mjs');
    const merged = hybridRank(bm25Results, semanticResults, 'symbol', { semanticWeight: 0.9 });
    // With high semantic weight, session.ts should rank high
    const sessionRank = merged.findIndex(r => r.relFile === 'src/session.ts');
    assert.ok(sessionRank <= 2, `session.ts should rank top-3 with high semantic weight, got rank ${sessionRank + 1}`);
  });
});

// ---------------------------------------------------------------------------
// embedding-cache.mjs tests
// ---------------------------------------------------------------------------

describe('embedding-cache.mjs', () => {
  it('loadCache — returns empty cache for non-existent file', async () => {
    const { loadCache } = await import('../src/lib/embedding-cache.mjs');
    const cache = loadCache('/nonexistent/path');
    assert.equal(cache.version, '1.0.0');
    assert.deepEqual(cache.entries, {});
  });

  it('getCachedOrEmbed — chunks and caches', async () => {
    const { loadCache, getCachedOrEmbed } = await import('../src/lib/embedding-cache.mjs');
    setupTestFiles();
    const cache = loadCache(TEST_DIR);
    const filePath = join(TEST_DIR, 'auth.js');
    const { statSync } = await import('node:fs');
    const st = statSync(filePath);

    // First call: should compute
    const result1 = getCachedOrEmbed(filePath, st.mtime.toISOString(), cache);
    assert.equal(result1.fromCache, false);
    assert.ok(result1.chunks.length > 0, 'Should produce chunks');

    // Second call: should hit cache
    const result2 = getCachedOrEmbed(filePath, st.mtime.toISOString(), cache);
    assert.equal(result2.fromCache, true);
    assert.deepEqual(result2.chunks, result1.chunks);

    cleanupTestFiles();
  });

  it('getCachedOrEmbed — invalidates on mtime change', async () => {
    const { loadCache, getCachedOrEmbed } = await import('../src/lib/embedding-cache.mjs');
    setupTestFiles();
    const cache = loadCache(TEST_DIR);
    const filePath = join(TEST_DIR, 'auth.js');
    const { statSync } = await import('node:fs');

    // First call
    const st1 = statSync(filePath);
    getCachedOrEmbed(filePath, st1.mtime.toISOString(), cache);

    // Different mtime should miss cache
    const result2 = getCachedOrEmbed(filePath, '2020-01-01T00:00:00.000Z', cache);
    assert.equal(result2.fromCache, false);

    cleanupTestFiles();
  });

  it('cleanStaleEntries — removes non-existent files', async () => {
    const { loadCache, cleanStaleEntries } = await import('../src/lib/embedding-cache.mjs');
    const cache = loadCache(TEST_DIR);
    cache.entries['/nonexistent/file.js'] = { mtime: '2020-01-01', contentHash: 'abc', chunkCount: 0, chunks: [] };
    const removed = cleanStaleEntries(cache);
    assert.equal(removed, 1);
    assert.equal(cache.entries['/nonexistent/file.js'], undefined);
  });

  it('getCacheStats — returns correct stats', async () => {
    const { loadCache, getCacheStats } = await import('../src/lib/embedding-cache.mjs');
    const cache = loadCache(TEST_DIR);
    cache.entries['a.js'] = { mtime: 'x', contentHash: 'a', chunkCount: 3, chunks: [{}, {}, {}] };
    cache.entries['b.js'] = { mtime: 'y', contentHash: 'b', chunkCount: 2, chunks: [{}, {}] };
    const stats = getCacheStats(cache);
    assert.equal(stats.totalEntries, 2);
    assert.equal(stats.totalChunks, 5);
  });
});

// ---------------------------------------------------------------------------
// contextual-grep.mjs integration tests
// ---------------------------------------------------------------------------

describe('contextual-grep.mjs --semantic', () => {
  it('--semantic flag works without errors', () => {
    setupTestFiles();
    const result = execSync(
      `node "${CLI}" "auth" --root "${TEST_DIR}" --semantic --format json --no-color`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const output = JSON.parse(result);
    assert.ok(output.matches >= 0, 'Should have matches count');
    assert.ok(Array.isArray(output.results), 'Should have results array');
  });

  it('--semantic-weight custom weight works', () => {
    setupTestFiles();
    const result = execSync(
      `node "${CLI}" "auth" --root "${TEST_DIR}" --semantic --semantic-weight 0.8 --format json --no-color`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const output = JSON.parse(result);
    assert.ok(output.matches >= 0, 'Should work with custom weight');
  });

  it('works without --semantic (backward compatible)', () => {
    const result = execSync(
      `node "${CLI}" "function" --root "${TEST_DIR}" --format json --no-color`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const output = JSON.parse(result);
    assert.ok(output.matches >= 0, 'Should work without semantic flag');
    assert.ok(Array.isArray(output.results), 'Should have results');
  });

  it('--semantic with --rank none still works', () => {
    const result = execSync(
      `node "${CLI}" "auth" --root "${TEST_DIR}" --semantic --rank none --format json --no-color`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const output = JSON.parse(result);
    assert.ok(output.matches >= 0, 'Should work with --rank none');
  });
});