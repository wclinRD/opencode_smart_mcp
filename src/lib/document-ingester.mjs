// document-ingester.mjs — Convert binary documents to Markdown for LLM consumption
//
// Supported formats:
//   P0: PDF, DOCX, HTML, Markdown/Text
//   P1: XLSX, CSV
//   P2: RTF, PPTX
//
// Design: Node library first (zero external CLI deps), system CLI fallback.
//
// OCR: When standard PDF text extraction yields little/no content (scanned PDF),
//       auto-fallback to pdftoppm + tesseract OCR pipeline.
//       Force with: forceOcr:true, custom lang with ocrLang:'chi_tra+eng'

import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Format Detection
// ---------------------------------------------------------------------------

const MAGIC_BYTES = {
  pdf:  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },       // %PDF
  rtf:  { offset: 0, bytes: [0x7B, 0x5C, 0x72, 0x74] },       // {\rt
  docx: { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },       // PK (ZIP)
  xlsx: { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },       // PK (ZIP)
  pptx: { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },       // PK (ZIP)
  html: { offset: 0, bytes: [0x3C, 0x68, 0x74, 0x6D] },       // <htm
};

const EXT_TO_FORMAT = {
  '.pdf':  'pdf',   '.docx': 'docx', '.doc': 'docx',
  '.html': 'html',  '.htm':  'html', '.xhtml': 'html',
  '.xlsx': 'xlsx',  '.xls':  'xls',
  '.pptx': 'pptx',  '.ppt':  'ppt',
  '.rtf':  'rtf',
  '.md':   'markdown', '.markdown': 'markdown',
  '.txt':  'text',
  '.csv':  'csv',
  '.json': 'json',
  '.yaml': 'yaml',  '.yml': 'yaml',
  '.xml':  'xml',
};

/**
 * Detect file format by extension + magic byte verification
 * @param {string} filePath
 * @returns {{ format: string, mime: string, pages: boolean }}
 */
export function detectFormat(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  let format = EXT_TO_FORMAT[ext];

  if (!format) {
    // Try magic byte detection
    const buf = readFileSync(filePath).subarray(0, 8);
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) format = 'pdf';
    else if (buf[0] === 0x7B && buf[1] === 0x5C && buf[2] === 0x72 && buf[3] === 0x74) format = 'rtf';
    else if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) format = 'zip'; // unknown ZIP
    else if (buf[0] === 0x3C && (buf[1] === 0x68 || buf[1] === 0x48)) format = 'html'; // <h or <H
    else format = 'text';
  }

  // Verify with magic bytes where possible
  if (format === 'pdf') verifyMagic(filePath, 'pdf');
  if (format === 'rtf') verifyMagic(filePath, 'rtf');

  const mime = MIME_MAP[format] || 'application/octet-stream';
  const pages = format === 'pdf';

  return { format, mime, pages };
}

const MIME_MAP = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  html: 'text/html',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  rtf: 'application/rtf',
  markdown: 'text/markdown',
  text: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'text/yaml',
  xml: 'application/xml',
  zip: 'application/zip',
};

function verifyMagic(filePath, format) {
  const magic = MAGIC_BYTES[format];
  if (!magic) return;
  const buf = readFileSync(filePath).subarray(magic.offset, magic.offset + magic.bytes.length);
  const matches = magic.bytes.every((b, i) => buf[i] === b);
  if (!matches) {
    throw new Error(`File ${filePath} has extension .${format} but does not match magic bytes`);
  }
}

// ---------------------------------------------------------------------------
// OCR helpers — pdftoppm + tesseract for scanned PDFs
// ---------------------------------------------------------------------------

/**
 * Check if extracted text indicates a scanned/image-only PDF.
 * Returns true when text is empty, too short for page count, or looks like garbage.
 * @param {string} text - extracted text content
 * @param {number} [numPages] - number of pages in PDF (if known)
 * @returns {boolean}
 */
function isLikelyScanned(text, numPages) {
  const cleaned = (text || '').trim();
  if (!cleaned) return true;

  // Count "meaningful" words (length >= 3 chars)
  const words = cleaned.split(/\s+/).filter(Boolean);
  const meaningfulWords = words.filter(w => w.length >= 3).length;
  const avgWordLen = words.length > 0
    ? words.reduce((sum, w) => sum + w.length, 0) / words.length
    : 0;

  // If we know page count, expect at least some content per page
  if (numPages && numPages > 1) {
    const wordsPerPage = words.length / numPages;
    if (wordsPerPage < 3) return true; // <3 words per page → scanned
  }

  // Heuristic: meaningful words < 5 or avg word length is extreme
  if (meaningfulWords < 5) return true;
  if (avgWordLen > 50) return true; // likely binary/garbled text
  if (avgWordLen < 2 && words.length > 10) return true; // single chars → garbage

  return false;
}

/**
 * Check if a CLI tool is available on PATH.
 * @param {string} tool
 * @returns {boolean}
 */
function isToolAvailable(tool) {
  try {
    execSync(`which "${tool}" 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * OCR a PDF via pdftoppm + tesseract.
 * Converts each page to PNG at given DPI, runs OCR, returns text.
 *
 * @param {string} filePath - path to PDF
 * @param {object} [opts]
 * @param {string} [opts.lang='eng'] - tesseract language(s), e.g. 'eng', 'chi_tra+eng'
 * @param {number} [opts.dpi=300] - render DPI (higher = better OCR but slower)
 * @param {number} [opts.timeout=300000] - max total OCR time in ms
 * @returns {{ content: string, pages: string[], numPages: number, ocr: boolean, lang: string }}
 */
function ocrPdf(filePath, opts = {}) {
  const { lang = 'eng', dpi = 300, timeout = 300000 } = opts;

  if (!isToolAvailable('pdftoppm')) {
    throw new Error(
      'OCR requires pdftoppm (part of poppler). Install: brew install poppler'
    );
  }
  if (!isToolAvailable('tesseract')) {
    throw new Error(
      'OCR requires tesseract. Install: brew install tesseract'
    );
  }

  // Create temp directory for page images
  const tmpDir = mkdtempSync(join(tmpdir(), 'smart-ocr-'));
  const pagePrefix = join(tmpDir, 'page');

  try {
    // Step 1: Convert PDF pages to PNG images
    execSync(
      `pdftoppm -png -r ${dpi} "${filePath}" "${pagePrefix}" 2>/dev/null`,
      { encoding: 'utf8', timeout: Math.min(timeout, 120000) }
    );

    // Step 2: Collect page images sorted by filename
    const pageFiles = readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort();

    if (pageFiles.length === 0) {
      throw new Error('pdftoppm produced no page images. Is this a valid PDF?');
    }

    // Step 3: OCR each page with tesseract
    const pages = [];
    for (let i = 0; i < pageFiles.length; i++) {
      const imagePath = join(tmpDir, pageFiles[i]);
      try {
        const text = execSync(
          `tesseract "${imagePath}" stdout -l ${lang} --psm 6 2>/dev/null`,
          { encoding: 'utf8', timeout: 60000 }
        );
        pages.push(text.trim() || `[Page ${i + 1} — OCR returned no text]`);
      } catch (pageErr) {
        pages.push(`[Page ${i + 1} — OCR failed: ${pageErr.message}]`);
      }
    }

    return {
      content: pages.join('\n\n---\n\n'),
      pages,
      numPages: pages.length,
      ocr: true,
      lang,
    };
  } finally {
    // Cleanup temp files
    try {
      execSync(`rm -rf "${tmpDir}"`, { stdio: 'ignore' });
    } catch { /* best-effort cleanup */ }
  }
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

/**
 * @param {string} filePath
 * @param {object} [opts]
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.forceOcr] - Force OCR for PDF (skip text extraction)
 * @param {string} [opts.ocrLang='eng'] - Tesseract language(s) for OCR
 * @returns {Promise<{format: string, title: string, totalPages: number|null, content: string, pages: string[], ocr?: boolean}>}
 */
export async function ingestDocument(filePath, opts = {}) {
  const { offset = 0, limit = Infinity, forceOcr = false, ocrLang = 'eng' } = opts;
  const { format, pages: supportsPages } = detectFormat(filePath);
  const title = basename(filePath);
  const converter = CONVERTERS[format];

  if (!converter) {
    throw new Error(`Unsupported format: ${format}. Supported: ${Object.keys(CONVERTERS).join(', ')}`);
  }

  const result = await converter(filePath, { forceOcr, ocrLang });

  // Apply pagination for page-aware formats
  let content, pages, totalPages;
  if (supportsPages && result.pages) {
    totalPages = result.pages.length;
    pages = result.pages.slice(offset, offset + limit);
    content = pages.join('\n\n---\n\n');
    if (offset > 0 || (limit < totalPages)) {
      const pageInfo = `[Pages ${offset + 1}-${Math.min(offset + limit, totalPages)} of ${totalPages}]\n\n`;
      content = pageInfo + content;
    }
  } else {
    totalPages = null;
    pages = result.pages || [result.content];
    content = result.content;
  }

  // Pass through OCR metadata if present
  const ocr = result.ocr || false;
  const lang = result.lang || undefined;
  return { format, path: filePath, title, totalPages, content, pages, ocr, lang };
}

// -- Format converter registry -----------------------------------------------

const CONVERTERS = {};

// --- PDF -------------------------------------------------------------------

CONVERTERS.pdf = async function convertPdf(filePath, opts = {}) {
  const { forceOcr = false, ocrLang = 'eng' } = opts;
  const buf = readFileSync(filePath);

  // Force OCR mode — skip text extraction entirely
  if (forceOcr) {
    return ocrPdf(filePath, { lang: ocrLang });
  }

  // ----- Phase 1: Text extraction (pdftotext) -----
  let pdftotextAvailable = false;
  try {
    execSync('which pdftotext', { stdio: 'ignore' });
    pdftotextAvailable = true;
  } catch { /* not available */ }

  let textResult = null;

  if (pdftotextAvailable) {
    try {
      // Note: pdfinfo may fail on minimal/invalid PDFs — that's OK
      let numPages = 0;
      try {
        const numPagesCmd = execSync(
          `pdfinfo "${filePath}" 2>/dev/null | grep Pages | awk '{print $2}'`,
          { encoding: 'utf8', timeout: 15000 }
        ).trim();
        numPages = parseInt(numPagesCmd, 10) || 0;
      } catch { /* pdfinfo failed, continue without page count */ }

      // Run pdftotext, capture stderr for diagnostics
      let allText, stderr;
      try {
        const result = execSync(
          `pdftotext "${filePath}" - 2>/tmp/smart-pdf-err.$$`,
          { encoding: 'utf8', timeout: 30000 }
        );
        allText = result;
        stderr = '';
      } catch (execErr) {
        // Read stderr from temp file
        try { stderr = readFileSync(`/tmp/smart-pdf-err.${process.pid}`, 'utf8'); } catch {}
        // If password-protected, return clear message
        if (/incorrect password|password/i.test(stderr || execErr.stderr || execErr.message)) {
          return {
            content: `[PDF is password-protected] — 此 PDF 受密碼保護，請使用非加密版本。\n\nFile: ${filePath}\nSize: ${buf.length} bytes`,
            pages: ['[PDF is password-protected — provide a non-encrypted version]'],
          };
        }
        throw execErr; // re-throw to fall through to pdf-parse
      }

      // Split into pages (pdftotext uses form feed as page break)
      const rawPages = allText.split('\f').filter(p => p.trim());
      const pages = rawPages.length > 0 ? rawPages : [allText];

      textResult = {
        content: pages.join('\n\n---\n\n'),
        pages,
        numPages: numPages || pages.length,
      };

      // Check if extracted text looks meaningful
      if (!isLikelyScanned(textResult.content, textResult.numPages)) {
        return textResult; // ✅ Good text — return as-is
      }
      // Scanned PDF detected — fall through to OCR below
    } catch {
      // pdftotext failed — fall through to pdf-parse
    }
  }

  // ----- Phase 2: pdf-parse fallback (only if pdftotext didn't succeed) -----
  if (!textResult) {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse(new Uint8Array(buf));
      await parser.load();
      const numPages = parser.doc?._pdfInfo?.numPages || 0;
      const info = parser.getInfo();

      // Get per-page text
      const pages = [];
      for (let i = 1; i <= numPages; i++) {
        try {
          const text = parser.getPageText(i);
          pages.push(text || `[Page ${i} — no extractable text]`);
        } catch {
          pages.push(`[Page ${i} — text extraction failed]`);
        }
      }

      if (pages.length === 0) {
        const allText = parser.getText();
        pages.push(allText || '[No text content found in PDF]');
      }

      textResult = {
        content: pages.join('\n\n---\n\n'),
        pages,
        info: info || {},
        numPages,
      };

      // Check if extracted text looks meaningful
      if (!isLikelyScanned(textResult.content, textResult.numPages)) {
        return textResult; // ✅ Good text — return as-is
      }
      // Scanned PDF — fall through to OCR
    } catch (err) {
      // Both text extraction methods failed — proceed to OCR
      textResult = null;
    }
  }

  // ----- Phase 3: OCR fallback (scanned PDF or extraction failed) -----
  if (textResult && isLikelyScanned(textResult.content, textResult.numPages)) {
    // Auto-OCR: extracted text is too sparse, likely a scanned document
    try {
      const ocrResult = ocrPdf(filePath, { lang: ocrLang });
      // Prepend note about OCR being used
      ocrResult.content = `[OCR auto-detected scanned PDF — OCR applied (lang: ${ocrLang})]\n\n${ocrResult.content}`;
      return ocrResult;
    } catch (ocrErr) {
      // OCR failed too — return the original sparse text with explanation
      return {
        content: `[Scanned PDF detected but OCR failed: ${ocrErr.message}]\n\n` +
                 `Falling back to text extraction (may be empty for scanned PDFs).\n` +
                 `Install tesseract languages or try: forceOcr=true with ocrLang='eng'\n\n` +
                 textResult.content,
        pages: textResult.pages,
        numPages: textResult.numPages,
      };
    }
  }

  // Both pdftotext and pdf-parse failed entirely → try OCR as last resort
  try {
    const ocrResult = ocrPdf(filePath, { lang: ocrLang });
    ocrResult.content = `[OCR fallback — text extraction failed, OCR applied (lang: ${ocrLang})]\n\n${ocrResult.content}`;
    return ocrResult;
  } catch (ocrErr) {
    const message = `[PDF extraction and OCR both failed. Text: ${(textResult?.content || 'no output').slice(0, 200)} | OCR: ${ocrErr.message}]`;
    return { content: `${message}\n\nFile: ${filePath}\nSize: ${buf.length} bytes`, pages: [message] };
  }
};

// --- DOCX ------------------------------------------------------------------

CONVERTERS.docx = async function convertDocx(filePath) {
  const buf = readFileSync(filePath);
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToMarkdown({ buffer: buf });

  if (result.messages?.length > 0) {
    const warnings = result.messages
      .filter(m => m.type === 'warning')
      .map(m => `[mammoth: ${m.message}]`);
    result.value = warnings.join('\n') + '\n' + result.value;
  }

  return { content: result.value || '[Empty document]', pages: [result.value || '[Empty document]'] };
};

// --- HTML ------------------------------------------------------------------

CONVERTERS.html = async function convertHtml(filePath) {
  const html = readFileSync(filePath, 'utf8');
  const { htmlToText } = await import('html-to-text');
  const content = htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  });
  return { content: content || '[Empty HTML]', pages: [content || '[Empty HTML]'] };
};

// --- XLSX ------------------------------------------------------------------

CONVERTERS.xlsx = async function convertXlsx(filePath) {
  const buf = readFileSync(filePath);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buf, { type: 'buffer' });

  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (json.length === 0) continue;

    parts.push(`## Sheet: ${sheetName}\n`);
    parts.push(toMarkdownTable(json));
  }

  const content = parts.join('\n') || '[Empty workbook]';
  return { content, pages: [content] };
};

function toMarkdownTable(rows) {
  if (rows.length === 0) return '';
  const cols = rows[0].length;

  // Build header separator
  const separator = `|${' --- |'.repeat(Math.max(cols, 1))}`;

  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = [];
    for (let j = 0; j < Math.max(cols, row.length); j++) {
      const val = row[j] !== undefined && row[j] !== null ? String(row[j]) : '';
      cells.push(val.replace(/\|/g, '\\|').replace(/\n/g, ' '));
    }
    lines.push(`| ${cells.join(' | ')} |`);
    if (i === 0) lines.push(separator);
  }

  return lines.join('\n');
}

// --- XLS (older .xls) ------------------------------------------------------

CONVERTERS.xls = CONVERTERS.xlsx;

// --- Plain text / Code / Markdown / CSV / JSON / YAML / XML ----------------

const TEXT_FORMATS = ['markdown', 'text', 'csv', 'json', 'yaml', 'xml'];
for (const fmt of TEXT_FORMATS) {
  CONVERTERS[fmt] = async function convertText(filePath) {
    const content = readFileSync(filePath, 'utf8');
    return { content, pages: [content] };
  };
}

// --- RTF (macOS textutil) --------------------------------------------------

CONVERTERS.rtf = async function convertRtf(filePath) {
  try {
    execSync('which textutil', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'RTF conversion requires macOS `textutil`. ' +
      'Install: no action needed (built into macOS).'
    );
  }

  const html = execSync(
    `textutil -convert html -stdout "${filePath}" 2>/dev/null`,
    { encoding: 'utf8', timeout: 30000 }
  );

  // Convert the resulting HTML to text
  const { htmlToText } = await import('html-to-text');
  const content = htmlToText(html, { wordwrap: false });
  return { content: content || '[Empty RTF]', pages: [content || '[Empty RTF]'] };
};

// --- PPTX (optional pptx2md CLI) -------------------------------------------

CONVERTERS.pptx = async function convertPptx(filePath) {
  let pptx2mdAvailable = false;
  try {
    execSync('which pptx2md', { stdio: 'ignore' });
    pptx2mdAvailable = true;
  } catch { /* not available */ }

  if (!pptx2mdAvailable) {
    // Try python-pptx as fallback
    try {
      execSync('python3 -c "import pptx"', { stdio: 'ignore' });
      const content = execSync(
        `python3 -c "
import sys
from pptx import Presentation
prs = Presentation('${filePath.replace(/'/g, "'\\''")}')
for slide in prs.slides:
    for shape in slide.shapes:
        if hasattr(shape, 'text') and shape.text.strip():
            print(shape.text)
        if shape.has_table:
            table = shape.table
            for row in table.rows:
                print('| ' + ' | '.join(cell.text for cell in row.cells) + ' |')
    print('---')
" 2>/dev/null`,
        { encoding: 'utf8', timeout: 30000 }
      );
      return { content: content || '[Empty presentation]', pages: [content || '[Empty presentation]'] };
    } catch {
      throw new Error(
        'PPTX conversion requires either `pptx2md` (npm i -g pptx2md) or `python-pptx` (pip install python-pptx). ' +
        'Install one of: npm i -g pptx2md  |  pip install python-pptx'
      );
    }
  }

  // pptx2md path
  const mdFile = filePath + '.converted.md';
  try {
    execSync(`pptx2md "${filePath}" -o "${mdFile}" 2>/dev/null`, { timeout: 60000 });
    const content = readFileSync(mdFile, 'utf8');
    try { execSync(`rm "${mdFile}"`); } catch { /* ignore */ }
    return { content: content || '[Empty presentation]', pages: [content || '[Empty presentation]'] };
  } catch {
    try { execSync(`rm "${mdFile}"`); } catch { /* ignore */ }
    throw new Error('pptx2md conversion failed. Try: pip install python-pptx');
  }
};

// --- Zip-based formats (disambiguation) ------------------------------------

CONVERTERS.zip = async function convertZip(filePath) {
  // Try to disambiguate by re-reading with extension
  const ext = extname(filePath).toLowerCase();
  if (ext === '.docx') return CONVERTERS.docx(filePath);
  if (ext === '.xlsx' || ext === '.xls') return CONVERTERS.xlsx(filePath);
  if (ext === '.pptx') return CONVERTERS.pptx(filePath);
  throw new Error(
    `File appears to be a ZIP archive. If it's a DOCX/XLSX/PPTX, ensure the file has the correct extension.`
  );
};
