// lsp.mjs → smart_lsp
//
// Universal LSP bridge — exposes type-aware code intelligence to the LLM.
// Wraps the existing LspBridge (src/lib/lsp-bridge.mjs) as a handler-based MCP tool.
//
// Supported operations:
//   symbols     — list all symbols (functions, classes, variables) in a file
//   references  — find all references to a symbol at line:character
//   hover       — get type info + documentation for a symbol
//   definition  — jump to definition of a symbol
//   diagnostics — get errors/warnings for a file
//
// Auto-detects language from file extension:
//   .ts/.tsx/.js/.jsx → typescript-language-server
//   .py               → pylsp
//   .rs               → rust-analyzer
//   .swift            → sourcekit-lsp
//   .php              → intelephense

import { getLspBridge, closeAllLspBridges } from '../../lib/lsp-bridge.mjs';

export default {
  name: 'smart_lsp',
  category: 'code',
  description: `[lsp] Use when: need type-aware code understanding — find definitions, references, hover types, symbols, or diagnostics. Auto-detects language from file extension. Supports TypeScript/JS, Python, Rust, Swift, PHP. Avoid when: searching by text pattern (use smart_grep instead).`,
  responsePolicy: { maxLevel: 0 }, // Small output, keep raw
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['symbols', 'references', 'hover', 'definition', 'diagnostics'],
        description: 'LSP operation: symbols (list all), references (find usages), hover (type info), definition (jump to def), diagnostics (errors/warnings)',
      },
      file: {
        type: 'string',
        description: 'File path relative to project root (e.g. "src/auth.ts")',
      },
      line: {
        type: 'number',
        description: 'Line number (1-indexed). Required for references, hover, definition.',
      },
      character: {
        type: 'number',
        description: 'Character offset (0-indexed). Required for references, hover, definition.',
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: current working directory)',
      },
    },
    required: ['operation', 'file'],
  },

  async handler(args) {
    const root = args.root || process.cwd();
    const bridge = getLspBridge(root);

    try {
      switch (args.operation) {
        case 'symbols': {
          const result = await bridge.getSymbols(args.file);
          if (result.error) return JSON.stringify(result);
          const { file, symbols } = result;
          if (!symbols || symbols.length === 0) {
            return JSON.stringify({ file, symbols: [], note: 'No symbols found. File may be empty or language server not started.' });
          }
          // Return compact symbol list
          const compact = symbols.map(s => ({
            name: s.name,
            kind: s.kind,
            line: s.line,
            signature: s.signature,
          }));
          return JSON.stringify({ file, symbols: compact, total: compact.length });
        }

        case 'references': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for references operation' });
          }
          const result = await bridge.getReferences(args.file, args.line, args.character || 0);
          if (result.error) return JSON.stringify(result);
          const { file, references } = result;
          if (!references || references.length === 0) {
            return JSON.stringify({ file, references: [], note: 'No references found.' });
          }
          return JSON.stringify({ file, references, total: references.length });
        }

        case 'hover': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for hover operation' });
          }
          const result = await bridge.getHover(args.file, args.line, args.character || 0);
          return JSON.stringify(result);
        }

        case 'definition': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for definition operation' });
          }
          const result = await bridge.getDefinition(args.file, args.line, args.character || 0);
          return JSON.stringify(result);
        }

        case 'diagnostics': {
          const result = await bridge.getDiagnostics(args.file);
          return JSON.stringify(result);
        }

        default:
          return JSON.stringify({
            error: `Unknown operation: ${args.operation}`,
            supported: ['symbols', 'references', 'hover', 'definition', 'diagnostics'],
          });
      }
    } catch (err) {
      return JSON.stringify({
        error: err.message || 'LSP operation failed',
        hint: err.message?.includes('not found')
          ? `Language server not installed. Install with your package manager.`
          : 'Check that the language server is installed and the file exists.',
      });
    }
  },
};