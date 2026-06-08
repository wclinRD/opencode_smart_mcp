// search-docs.mjs → smart_search_docs
// Phase 5: Full-text search within previously ingested document content.
// Enables cross-session content retrieval ("what was that paragraph about X?").
//
// Usage:
//   smart_search_docs({ query: "timing constraints" })
//   smart_search_docs({ query: "Q&A bridge mode", limit: 5 })

import { getRegistry } from '../../lib/document-registry.mjs';

export default {
  name: 'smart_search_docs',
  category: 'standard',
  description: `Full-text search within previously ingested document content.

Searches the content, title, and summary of documents you've previously
read with smart_ingest_document. Multiple search terms are combined with AND.

Examples:
  { query: "timing constraints" }          → find docs mentioning both terms
  { query: "Q&A bridge mode", limit: 5 }  → top 5 results
  { query: "contract termination" }        → find contract clauses

Use smart_list_documents to browse by metadata instead.`,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search terms (space-separated = AND, searches content + title + summary)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 10)',
      },
    },
    required: ['query'],
  },

  handler: async (args) => {
    const { query, limit = 10 } = args;

    if (!query || !query.trim()) {
      return 'Error: query is required.';
    }

    try {
      const registry = getRegistry();
      const results = registry.searchContent(query.trim(), limit);

      if (results.length === 0) {
        return `No documents found matching "${query}". Try different terms, or use smart_list_documents to browse all indexed documents.`;
      }

      let output = `🔍 **Search: "${query}"** — ${results.length} result${results.length > 1 ? 's' : ''}\n\n`;

      for (let i = 0; i < results.length; i++) {
        const doc = results[i];
        const fileName = doc.path ? doc.path.split('/').pop() : doc.title;
        output += `### ${i + 1}. ${fileName}\n`;
        output += `**Format:** ${doc.format.toUpperCase()}\n`;
        output += `**Title:** ${doc.title || '(no title)'}\n`;

        // Show matching excerpt from content
        if (doc.content) {
          const excerpt = extractExcerpt(doc.content, query, 200);
          output += `**Excerpt:**\n> ${excerpt}\n`;
        }

        if (doc.summary) {
          output += `**Summary:** ${doc.summary}\n`;
        }

        output += `**Path:** \`${doc.path}\`\n`;
        output += `**Last updated:** ${doc.updated_at}\n\n`;
      }

      output += `---\n*Tip: use \`smart_ingest_document({path: "..."})\` to read the full document.*`;

      return output;
    } catch (err) {
      return `Error searching documents: ${err.message}`;
    }
  },
};

/**
 * Extract a relevant excerpt from content around matching terms.
 * Finds the first occurrence of any search term and returns surrounding context.
 *
 * @param {string} content - Document content
 * @param {string} query - Search query (space-separated)
 * @param {number} contextChars - Characters of context around match
 * @returns {string} Excerpt with "..." markers if truncated
 */
function extractExcerpt(content, query, contextChars = 200) {
  const terms = query.split(/\s+/).filter(Boolean);
  const fullText = content;

  // Find first occurrence of any term (case-insensitive)
  let firstIdx = -1;
  let matchedTerm = '';
  for (const term of terms) {
    const idx = fullText.toLowerCase().indexOf(term.toLowerCase());
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
      matchedTerm = term;
    }
  }

  if (firstIdx === -1) {
    // No direct match in content (might match title/summary only)
    return fullText.slice(0, contextChars) + (fullText.length > contextChars ? '...' : '');
  }

  const start = Math.max(0, firstIdx - Math.floor(contextChars / 2));
  const end = Math.min(fullText.length, firstIdx + matchedTerm.length + Math.floor(contextChars / 2));

  let excerpt = '';
  if (start > 0) excerpt += '...';
  excerpt += fullText.slice(start, end);
  if (end < fullText.length) excerpt += '...';

  return excerpt;
}
