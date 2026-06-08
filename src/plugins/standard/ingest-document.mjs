// ingest-document.mjs → smart_ingest_document
// Phase 4: Convert binary documents (PDF, DOCX, etc.) to Markdown for LLM consumption.
//
// Usage:
//   ingestDocument({ path: "/path/to/doc.pdf" })
//   ingestDocument({ path: "/path/to/large.pdf", offset: 10, limit: 20 })

import { ingestDocument, detectFormat } from '../../lib/document-ingester.mjs';
import { getRegistry } from '../../lib/document-registry.mjs';

export default {
  name: 'smart_ingest_document',
  category: 'standard',
  description: `Convert binary documents (PDF, DOCX, XLSX, HTML, RTF, PPTX, etc.) to Markdown text that the LLM can read and analyze.

Supports:
  - PDF: full text extraction with page-level pagination
  - DOCX: converts to Markdown preserving headings, lists, emphasis
  - HTML: strips markup, preserves links and structure
  - XLSX/XLS: converts sheet data to Markdown tables
  - RTF: macOS textutil-based conversion
  - PPTX: slide text extraction (requires python-pptx or pptx2md)
  - Plain text: Markdown, CSV, JSON, YAML, XML — reads directly

Auto-registers in document registry for cross-session lookup.
Use smart_list_documents to search previously ingested documents.

For large PDFs (>100 pages), use offset/limit to read in chunks.
  Example: { path: "spec.pdf" }            → first 100 pages
           { path: "spec.pdf", limit: 50 } → first 50 pages
           { path: "spec.pdf", offset: 50, limit: 50 } → pages 51-100`,

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the document file',
      },
      offset: {
        type: 'number',
        description: 'Page offset for paginated formats (default: 0, PDF only)',
      },
      limit: {
        type: 'number',
        description: 'Max pages to return (default: all, PDF only)',
      },
      summary: {
        type: 'string',
        description: 'Optional short summary of the document content (saved in registry for later search)',
      },
    },
    required: ['path'],
  },

  handler: async (args) => {
    const { path, offset, limit, summary } = args;

    if (!path) {
      return 'Error: path is required.';
    }

    try {
      const result = await ingestDocument(path, { offset, limit });

      // Auto-register in document registry (cross-session index + full-text search)
      try {
        const registry = getRegistry();
        const contentExcerpt = result.content.slice(0, 4000);
        registry.register(path, result.format, result.title, {
          summary: summary || '',
          content: contentExcerpt,
        });
      } catch (regErr) {
        // Registry failure is non-fatal — document content still returned
        console.error('Document registry error:', regErr.message);
      }

      let output = '';
      output += `📄 **${result.title}**`;
      output += `\nFormat: ${result.format.toUpperCase()}`;
      if (result.totalPages !== null) {
        output += ` | Pages: ${result.totalPages}`;
      }
      output += '\n\n' + '='.repeat(60) + '\n\n';
      output += result.content;

      // Content stats
      const charCount = result.content.length;
      const wordCount = result.content.split(/\s+/).filter(Boolean).length;
      output += `\n\n---\n*${charCount} chars, ~${wordCount} words*`;
      output += `\n*Registered in document index. Use smart_list_documents to find it later or smart_search_docs to search its content.*`;

      return output;
    } catch (err) {
      return `Error reading document: ${err.message}`;
    }
  },
};
