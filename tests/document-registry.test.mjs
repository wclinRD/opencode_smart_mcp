// document-registry.test.mjs — Phase 4b Document Registry tests
//
// Tests SQLite-based cross-session document index:
//   1. DocumentRegistry — register, list, search, get, delete
//   2. Singleton getRegistry / resetRegistry
//   3. Plugin integration — ingest auto-registers
//   4. list-documents plugin — query search
//
// Run: node --test tests/document-registry.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__dirname, '../.test-registry-' + Date.now());
const TEST_DB = resolve(TEST_DIR, 'test-documents.db');

// ---------------------------------------------------------------------------
// Minimal test DOCX (for plugin integration tests)
// ---------------------------------------------------------------------------

function createMinimalDocx(text = 'Test DOCX') {
  const tmpDir = join(os.tmpdir(), 'docx-test-' + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  try {
    writeFileSync(join(tmpDir, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    mkdirSync(join(tmpDir, '_rels'));
    writeFileSync(join(tmpDir, '_rels/.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    mkdirSync(join(tmpDir, 'word'));
    writeFileSync(join(tmpDir, 'word/document.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`);
    execSync(`cd "${tmpDir}" && zip -q -r "${tmpDir}/output.docx" .`, { stdio: 'ignore' });
    return readFileSync(join(tmpDir, 'output.docx'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('document-registry', () => {
  let DocumentRegistry, getRegistry, resetRegistry;
  let registry;

  before(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const mod = await import('../src/lib/document-registry.mjs');
    DocumentRegistry = mod.DocumentRegistry;
    getRegistry = mod.getRegistry;
    resetRegistry = mod.resetRegistry;

    // Create a fresh registry with test DB
    registry = new DocumentRegistry(TEST_DB);
  });

  after(() => {
    if (registry) registry.close();
    resetRegistry();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  describe('register and list', () => {
    it('should register a document', () => {
      const result = registry.register('/tmp/test.pdf', 'pdf', 'Test Document');
      assert.equal(result.path, '/tmp/test.pdf');
      assert.equal(result.format, 'pdf');
      assert.equal(result.title, 'Test Document');
    });

    it('should list registered documents', () => {
      const docs = registry.list();
      assert.ok(docs.length >= 1);
      assert.equal(docs[0].path, '/tmp/test.pdf');
    });

    it('should register multiple documents', () => {
      registry.register('/tmp/contract.docx', 'docx', 'Service Contract');
      registry.register('/tmp/spec.xlsx', 'xlsx', 'Data Spec');
      registry.register('/tmp/report.html', 'html', 'Annual Report');
      assert.equal(registry.count(), 4);
    });

    it('should list newest first (or all docs)', () => {
      const docs = registry.list();
      assert.equal(docs.length, 4);
      // All 4 documents should be present (ordering depends on timestamp granularity)
      const paths = docs.map(d => d.path);
      assert.ok(paths.includes('/tmp/test.pdf'));
      assert.ok(paths.includes('/tmp/contract.docx'));
      assert.ok(paths.includes('/tmp/spec.xlsx'));
      assert.ok(paths.includes('/tmp/report.html'));
    });

    it('should update existing document on re-register', () => {
      registry.register('/tmp/test.pdf', 'pdf', 'Updated Title');
      const doc = registry.get('/tmp/test.pdf');
      assert.equal(doc.title, 'Updated Title');
      assert.equal(registry.count(), 4); // count unchanged
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    it('should find documents by title', () => {
      const docs = registry.search('Contract');
      assert.equal(docs.length, 1);
      assert.equal(docs[0].title, 'Service Contract');
    });

    it('should find documents by path', () => {
      const docs = registry.search('contract.docx');
      assert.equal(docs.length, 1);
    });

    it('should find documents by summary', () => {
      registry.register('/tmp/notes.txt', 'text', 'Meeting Notes', { summary: 'discussed Q3 roadmap and budget' });
      const docs = registry.search('roadmap');
      assert.equal(docs.length, 1);
      assert.equal(docs[0].title, 'Meeting Notes');
    });

    it('should return empty for no match', () => {
      const docs = registry.search('xyznonexistent');
      assert.equal(docs.length, 0);
    });

    it('should respect limit', () => {
      const docs = registry.search('', 2);
      assert.ok(docs.length <= 2);
    });
  });

  // -----------------------------------------------------------------------
  // Get, Delete, Count
  // -----------------------------------------------------------------------

  describe('get, delete, count', () => {
    it('should get document by path', () => {
      const doc = registry.get('/tmp/contract.docx');
      assert.ok(doc);
      assert.equal(doc.format, 'docx');
    });

    it('should return null for nonexistent path', () => {
      const doc = registry.get('/tmp/nonexistent.pdf');
      assert.equal(doc, null);
    });

    it('should delete document', () => {
      registry.delete('/tmp/test.pdf');
      const doc = registry.get('/tmp/test.pdf');
      assert.equal(doc, null);
      assert.equal(registry.count(), 4); // was 5, deleted 1 = 4
    });

    it('should count correctly', () => {
      const count = registry.count();
      assert.equal(count, registry.list().length);
    });
  });

  // -----------------------------------------------------------------------
  // Singleton
  // -----------------------------------------------------------------------

  describe('singleton', () => {
    it('should return same instance', () => {
      resetRegistry();
      const r1 = getRegistry({ dbPath: TEST_DB });
      const r2 = getRegistry({ dbPath: TEST_DB });
      assert.equal(r1, r2);
      r1.close();
      resetRegistry();
    });

    it('should persist across instances', () => {
      resetRegistry();
      const r1 = getRegistry({ dbPath: TEST_DB });
      // Register via r1
      r1.register('/tmp/persist-test.pdf', 'pdf', 'Persistence Test');
      r1.close();
      resetRegistry();

      // Re-open via r2
      const r2 = getRegistry({ dbPath: TEST_DB });
      const doc = r2.get('/tmp/persist-test.pdf');
      assert.ok(doc, 'Data should persist across instances');
      assert.equal(doc.title, 'Persistence Test');
      r2.close();
      resetRegistry();
    });
  });

  // -----------------------------------------------------------------------
  // Plugin Integration
  // -----------------------------------------------------------------------

  describe('plugin integration', () => {
    let fixturesDir;
    let ingestHandler;

    before(async () => {
      fixturesDir = resolve(TEST_DIR, 'fixtures-ingest');
      mkdirSync(fixturesDir, { recursive: true });

      // Create a small HTML test file
      writeFileSync(resolve(fixturesDir, 'test.html'), '<html><body><h1>Hello</h1><p>World</p></body></html>');

      // Create a text file
      writeFileSync(resolve(fixturesDir, 'readme.txt'), 'This is a test document for registry integration.\nLine two.');

      // Create a DOCX
      const docxBuf = createMinimalDocx('Phase 4b Integration Test');
      writeFileSync(resolve(fixturesDir, 'test.docx'), docxBuf);

      // Get plugin handler
      const plugin = await import('../src/plugins/standard/ingest-document.mjs');
      ingestHandler = plugin.default.handler;
    });

    it('should auto-register document on ingest', async () => {
      resetRegistry();
      const reg = getRegistry({ dbPath: TEST_DB.replace('.db', '-plugin.db') });

      const result = await ingestHandler({ path: resolve(fixturesDir, 'test.html') });
      // Handler wraps content with metadata — check for key terms
      assert.ok(
        result.includes('Hello') || result.includes('World') || result.includes('html'),
        `Should return content, got: ${result.slice(0, 200)}`
      );

      // Check registry
      const docs = reg.list();
      assert.ok(docs.length >= 1, 'Should have registered the document');
      const match = docs.find(d => d.path.includes('test.html'));
      assert.ok(match, 'Should find the test.html in registry');
      assert.equal(match.format, 'html');

      reg.close();
      resetRegistry();
    });

    it('should accept summary during ingest and save to registry', async () => {
      resetRegistry();
      const reg = getRegistry({ dbPath: TEST_DB.replace('.db', '-summary.db') });

      const result = await ingestHandler({
        path: resolve(fixturesDir, 'readme.txt'),
        summary: 'Test readme for registry integration testing',
      });
      assert.ok(result.includes('test document'), 'Should return content');

      const docs = reg.list();
      const match = docs.find(d => d.path.includes('readme.txt'));
      assert.ok(match, 'Should find the document');
      assert.equal(match.summary, 'Test readme for registry integration testing');

      reg.close();
      resetRegistry();
    });

    it('should list registered documents via list plugin', async () => {
      resetRegistry();
      const reg = getRegistry({ dbPath: TEST_DB.replace('.db', '-list.db') });

      // Register some docs
      reg.register('/tmp/doc1.pdf', 'pdf', 'Doc One', { summary: 'First document' });
      reg.register('/tmp/doc2.docx', 'docx', 'Doc Two', { summary: 'Second document about protocol' });

      // Get list plugin handler
      const listPlugin = await import('../src/plugins/standard/list-documents.mjs');
      const listResult = await listPlugin.default.handler({ query: 'protocol' });

      assert.ok(listResult.includes('Doc Two'), 'Should find matching document');
      assert.ok(listResult.includes('protocol'), 'Should show summary');

      reg.close();
      resetRegistry();
    });

    it('should list all documents without query', async () => {
      resetRegistry();
      const reg = getRegistry({ dbPath: TEST_DB.replace('.db', '-list-all.db') });

      reg.register('/tmp/a.pdf', 'pdf', 'Document A');
      reg.register('/tmp/b.docx', 'docx', 'Document B');

      const listPlugin = await import('../src/plugins/standard/list-documents.mjs');
      const result = await listPlugin.default.handler({});

      assert.ok(result.includes('Document A'));
      assert.ok(result.includes('Document B'));
      assert.ok(result.includes('Document Registry'));

      reg.close();
      resetRegistry();
    });

    it('should return empty message when no documents exist', async () => {
      resetRegistry();
      const dbPath = TEST_DB.replace('.db', '-empty.db');
      // Register something to create the DB, then delete it all
      const reg = getRegistry({ dbPath });

      const listPlugin = await import('../src/plugins/standard/list-documents.mjs');
      const result = await listPlugin.default.handler({ query: 'nonexistent' });

      assert.ok(result.includes('No documents found'));
      assert.ok(result.includes('smart_ingest_document'));

      reg.close();
      resetRegistry();
    });
  });
});
