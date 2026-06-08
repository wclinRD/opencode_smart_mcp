// list-documents.mjs → smart_list_documents
// Phase 4b: Cross-session document index — search and list previously ingested docs.
//
// Usage:
//   smart_list_documents()                         → list all, newest first
//   smart_list_documents({ query: "contract" })    → search by title/path/summary

import { getRegistry } from '../../lib/document-registry.mjs';

export default {
  name: 'smart_list_documents',
  category: 'standard',
  description: `Search and list previously ingested documents (cross-session persistent index).

Documents are auto-registered when read via smart_ingest_document.
The index persists across sessions at ~/.smart/cache/documents.db.

Use cases:
  - "What documents did I read last time?"
  - "Find that contract I read yesterday"
  - "Show me all PDFs I've analyzed"
  - "Search documents about protocol specs"`,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional search term — matches title, path, and summary (case-insensitive)',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 20)',
      },
      format: {
        type: 'string',
        description: 'Filter by format (pdf, docx, xlsx, html, etc.)',
      },
    },
  },

  handler: async (args) => {
    const { query, limit, format } = args || {};

    try {
      const registry = getRegistry();
      let docs;

      if (query) {
        docs = registry.search(query, limit || 20);
      } else {
        docs = registry.list(limit || 50);
      }

      // Apply format filter if specified
      if (format) {
        docs = docs.filter(d => d.format === format.toLowerCase());
      }

      if (docs.length === 0) {
        if (query) {
          return `No documents found matching "${query}".\n\nUse smart_ingest_document({path: "..."}) to ingest a document first.`;
        }
        return 'No documents in registry yet.\n\nUse smart_ingest_document({path: "..."}) to ingest a document first.';
      }

      let output = '';
      output += `📚 **Document Registry** — ${docs.length} document(s)`;
      if (query) output += ` matching "${query}"`;
      output += '\n\n';

      for (const doc of docs) {
        const date = doc.updated_at || doc.ingested_at || '';
        const dateStr = date.slice(0, 10);
        output += `**${doc.title}**`;
        output += `  (${doc.format.toUpperCase()})`;
        output += `  [${dateStr}]`;
        output += '\n';
        if (doc.summary) {
          output += `  > ${doc.summary.slice(0, 200)}`;
          if (doc.summary.length > 200) output += '...';
          output += '\n';
        }
        output += `  Path: \`${doc.path}\``;
        output += '\n\n';
      }

      output += '---\n';
      output += `Total: ${registry.count()} document(s) in index.`;
      if (!query) {
        output += ' Use query param to search: smart_list_documents({ query: "keyword" })';
      }

      return output;
    } catch (err) {
      return `Error accessing document registry: ${err.message}`;
    }
  },
};
