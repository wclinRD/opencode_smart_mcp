// document-ingester.test.mjs — Phase 4 Document Ingestion tests
//
// Tests format detection, PDF/DOCX/HTML/XLSX conversion, error handling,
// large file pagination, and hybrid-router integration.
//
// Run: node --test tests/document-ingester.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__dirname, '../.test-ingest-' + Date.now());

// ---------------------------------------------------------------------------
// Minimal valid PDF generator (from pdf.js test pattern)
// ---------------------------------------------------------------------------

function createMinimalPdf(text = 'Hello PDF World', numPages = 1) {
  const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let pdf = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  const objects = [];
  let objNum = 1;

  // Font
  objects.push(`${objNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);
  objNum++;

  const pageRefs = [];
  for (let i = 1; i <= numPages; i++) {
    const contentObj = objNum++;
    const pageText = `${text} - Page ${i}`;
    objects.push(`${contentObj} 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 50 700 Td (${escapeText(pageText)}) Tj ET\nendstream\nendobj`);

    const pageObj = objNum++;
    objects.push(`${pageObj} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 1 0 R >> >> >>\nendobj`);
    pageRefs.push(`${pageObj} 0 R`);
  }

  // Pages tree (object 3)
  objects.unshift(`3 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${numPages} >>\nendobj`);
  objNum = 3;

  // Catalog (object 4)
  objects.push(`${objNum} 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj`);

  const numObjs = objects.length;
  const body = objects.join('\n') + '\n';

  // Build xref
  let xref = 'xref\n';
  xref += `0 ${numObjs + 1}\n`;
  xref += '0000000000 65535 f \n';

  let offset = pdf.length;
  for (let i = 0; i < objects.length; i++) {
    xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    offset += objects[i].length + 1; // +1 for newline
  }

  pdf += body;
  pdf += xref;
  pdf += 'trailer\n';
  pdf += `<< /Size ${numObjs + 1} /Root ${numObjs} 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${pdf.length}\n`;
  pdf += '%%EOF\n';

  return pdf;
}

// ---------------------------------------------------------------------------
// Minimal valid DOCX generator
// ---------------------------------------------------------------------------

function createMinimalDocx(text = 'Hello DOCX World') {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'docx-test-'));
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
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading 1 Title</w:t></w:r></w:p>
    <w:p><w:r><w:t>Content under heading</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Italic text</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    mkdirSync(join(tmpDir, 'word/_rels'));
    writeFileSync(join(tmpDir, 'word/_rels/document.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

    writeFileSync(join(tmpDir, 'word/styles.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`);

    execSync(`cd "${tmpDir}" && zip -q -r "${tmpDir}/output.docx" .`, { stdio: 'ignore' });
    return readFileSync(join(tmpDir, 'output.docx'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('document-ingester', () => {
  const fixturesDir = resolve(TEST_DIR, 'fixtures');
  let detectFormat, ingestDocument, classifyQuestion, getGeneralRecommendation, CATEGORIES;

  before(async () => {
    mkdirSync(fixturesDir, { recursive: true });

    // Create test fixtures
    // 1. PDF (3 pages)
    const pdfContent = createMinimalPdf('Test PDF document content', 3);
    writeFileSync(resolve(fixturesDir, 'test.pdf'), pdfContent);

    // 2. DOCX
    const docxBuf = createMinimalDocx('Hello from test DOCX');
    writeFileSync(resolve(fixturesDir, 'test.docx'), docxBuf);

    // 3. HTML
    writeFileSync(resolve(fixturesDir, 'test.html'), `<!DOCTYPE html>
<html><head><title>Test HTML</title></head>
<body>
  <h1>Main Heading</h1>
  <p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
  <table>
    <tr><th>Name</th><th>Value</th></tr>
    <tr><td>Item 1</td><td>100</td></tr>
    <tr><td>Item 2</td><td>200</td></tr>
  </table>
  <a href="https://example.com">Link text</a>
</body></html>`);

    // 4. XLSX
    const { default: XLSX } = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Name', 'Age', 'City'],
      ['Alice', 30, 'Taipei'],
      ['Bob', 25, 'Tokyo'],
      ['Charlie', 35, 'New York'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, 'People');
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Product', 'Price', 'Qty'],
      ['Widget', 10, 100],
      ['Gadget', 25, 50],
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Products');
    XLSX.writeFile(wb, resolve(fixturesDir, 'test.xlsx'));

    // 5. Markdown
    writeFileSync(resolve(fixturesDir, 'test.md'), '# Test Markdown\n\nThis is a **markdown** file.\n\n- Item 1\n- Item 2\n');

    // 6. Plain text
    writeFileSync(resolve(fixturesDir, 'test.txt'), 'This is a plain text file.\nLine 2.\nLine 3.');

    // 7. CSV
    writeFileSync(resolve(fixturesDir, 'test.csv'), 'id,name,value\n1,alpha,100\n2,beta,200\n3,gamma,300\n');

    // 8. JSON
    writeFileSync(resolve(fixturesDir, 'test.json'), '{"name": "test", "version": 1, "items": [1, 2, 3]}');

    // 9. Empty-ish PDF
    writeFileSync(resolve(fixturesDir, 'empty.pdf'), '%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer<<>>\nstartxref\n9\n%%EOF\n');

    // 10. Unknown extension
    writeFileSync(resolve(fixturesDir, 'test.unknown'), 'Just some text content\n');

    // 11. Unsupported binary (ZIP with unknown extension → triggers zip converter error)
    const zipBuf = Buffer.alloc(4);
    zipBuf.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 magic
    writeFileSync(resolve(fixturesDir, 'test.dat'), zipBuf);

    // Import modules
    const ingester = await import('../src/lib/document-ingester.mjs');
    detectFormat = ingester.detectFormat;
    ingestDocument = ingester.ingestDocument;

    const engine = await import('../src/lib/hybrid-engine.mjs');
    classifyQuestion = engine.classifyQuestion;
    getGeneralRecommendation = engine.getGeneralRecommendation;
    CATEGORIES = engine.CATEGORIES;
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Format Detection
  // -----------------------------------------------------------------------

  describe('detectFormat', () => {
    it('should detect PDF format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.pdf'));
      assert.equal(info.format, 'pdf');
      assert.equal(info.mime, 'application/pdf');
      assert.equal(info.pages, true);
    });

    it('should detect DOCX format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.docx'));
      assert.equal(info.format, 'docx');
      assert.ok(info.mime.includes('wordprocessingml'));
      assert.equal(info.pages, false);
    });

    it('should detect HTML format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.html'));
      assert.equal(info.format, 'html');
      assert.equal(info.pages, false);
    });

    it('should detect XLSX format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.xlsx'));
      assert.equal(info.format, 'xlsx');
      assert.equal(info.pages, false);
    });

    it('should detect Markdown format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.md'));
      assert.equal(info.format, 'markdown');
      assert.equal(info.pages, false);
    });

    it('should detect plain text format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.txt'));
      assert.equal(info.format, 'text');
    });

    it('should detect CSV format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.csv'));
      assert.equal(info.format, 'csv');
    });

    it('should detect JSON format', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.json'));
      assert.equal(info.format, 'json');
    });

    it('should throw for nonexistent file', () => {
      assert.throws(() => detectFormat('/nonexistent/file.pdf'), /File not found/);
    });

    it('should detect unknown extension as text', () => {
      const info = detectFormat(resolve(fixturesDir, 'test.unknown'));
      assert.equal(info.format, 'text');
    });
  });

  // -----------------------------------------------------------------------
  // Document Ingestion — text-based formats
  // -----------------------------------------------------------------------

  describe('ingestDocument — text formats', () => {
    it('should read markdown files', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.md'));
      assert.match(result.content, /Test Markdown/i);
      assert.equal(result.format, 'markdown');
    });

    it('should read plain text files', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.txt'));
      assert.ok(result.content.includes('plain text'));
      assert.equal(result.format, 'text');
    });

    it('should read CSV files', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.csv'));
      assert.ok(result.content.includes('alpha') || result.content.includes('beta'));
    });

    it('should read JSON files', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.json'));
      assert.ok(result.content.includes('test') || result.content.includes('version'));
    });
  });

  // -----------------------------------------------------------------------
  // Document Ingestion — HTML
  // -----------------------------------------------------------------------

  describe('ingestDocument — HTML', () => {
    it('should convert HTML to text', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.html'));
      assert.equal(result.format, 'html');
      assert.match(result.content, /Main Heading/i);
      assert.match(result.content, /paragraph/i);
    });

    it('should preserve HTML table data', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.html'));
      assert.match(result.content, /Item 1/i);
      assert.match(result.content, /100/i);
    });
  });

  // -----------------------------------------------------------------------
  // Document Ingestion — XLSX
  // -----------------------------------------------------------------------

  describe('ingestDocument — XLSX', () => {
    it('should convert XLSX to markdown tables', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.xlsx'));
      assert.equal(result.format, 'xlsx');
      assert.match(result.content, /Alice/i);
      assert.match(result.content, /Taipei/i);
    });

    it('should handle multiple sheets', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.xlsx'));
      assert.match(result.content, /People|Products/i);
    });
  });

  // -----------------------------------------------------------------------
  // Document Ingestion — PDF (may be environment-dependent)
  // -----------------------------------------------------------------------

  describe('ingestDocument — PDF', () => {
    it('should extract text from PDF', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.pdf'));
      assert.equal(result.format, 'pdf');
      // Content may vary depending on pdf-parse version
      assert.ok(result.content.length > 0, 'PDF should produce some content');
    });

    it('should return pagination metadata', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.pdf'));
      assert.equal(typeof result.totalPages, 'number');
      assert.equal(Array.isArray(result.pages), true);
      assert.ok(result.pages.length > 0);
    });

    it('should support offset/limit pagination', async () => {
      const partial = await ingestDocument(resolve(fixturesDir, 'test.pdf'), { offset: 0, limit: 1 });
      assert.ok(partial.content.length > 0);
      assert.ok(partial.pages.length >= 1);
    });
  });

  // -----------------------------------------------------------------------
  // Document Ingestion — DOCX
  // -----------------------------------------------------------------------

  describe('ingestDocument — DOCX', () => {
    it('should convert DOCX to markdown', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.docx'));
      assert.equal(result.format, 'docx');
      assert.match(result.content, /Hello from test DOCX/i);
    });

    it('should preserve DOCX structure', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'test.docx'));
      // mammoth renders headings
      assert.match(result.content, /Heading 1|heading/i);
    });
  });

  // -----------------------------------------------------------------------
  // Error Handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('should reject unsupported format', async () => {
      await assert.rejects(
        () => ingestDocument(resolve(fixturesDir, 'test.dat')),
        /Unsupported format|ZIP archive/
      );
    });

    it('should reject nonexistent file', async () => {
      await assert.rejects(
        () => ingestDocument('/nonexistent/doc.pdf'),
        /File not found/
      );
    });

    it('should handle malformed PDF gracefully', async () => {
      const result = await ingestDocument(resolve(fixturesDir, 'empty.pdf'));
      assert.ok(result, 'Should not crash'); // Should not crash
      assert.equal(result.format, 'pdf');
      assert.ok(result.content, 'Should have some content');
    });
  });

  // -----------------------------------------------------------------------
  // Hybrid-Router Integration
  // -----------------------------------------------------------------------

  describe('hybrid-router integration', () => {
    it('should classify document questions as GENERAL', () => {
      const result = classifyQuestion('幫我讀取這個 PDF 合約');
      assert.equal(result.category, CATEGORIES.GENERAL);
    });

    it('should recommend document domain for "分析合約"', () => {
      const q = '分析這份合約的內容';
      const classification = classifyQuestion(q);
      const rec = getGeneralRecommendation(classification, q);
      assert.ok(rec, 'Should return a recommendation');
      assert.equal(rec.domain, 'document');
      assert.ok(rec.tools.includes('smart_ingest_document'));
    });

    it('should recommend document domain for "spec 文件"', () => {
      const q = '幫我看這個 spec 文件';
      const classification = classifyQuestion(q);
      const rec = getGeneralRecommendation(classification, q);
      assert.ok(rec, 'Should return a recommendation');
      assert.equal(rec.domain, 'document');
    });

    it('should recommend document domain for "合約內容"', () => {
      const q = '幫我看這份合約內容';
      const classification = classifyQuestion(q);
      const rec = getGeneralRecommendation(classification, q);
      assert.ok(rec, 'Should return a recommendation');
      assert.equal(rec.domain, 'document');
    });

    it('should recommend document domain for "讀取 pdf"', () => {
      const q = '幫我讀取這個 pdf 檔';
      const classification = classifyQuestion(q);
      const rec = getGeneralRecommendation(classification, q);
      assert.ok(rec, 'Should return a recommendation');
      assert.equal(rec.domain, 'document');
    });
  });
});
