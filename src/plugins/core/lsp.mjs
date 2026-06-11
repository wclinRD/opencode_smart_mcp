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
//   .ts/.tsx/.js/.jsx/.mjs/.cjs → typescript-language-server
//   .py/.pyw                    → pylsp
//   .rs                         → rust-analyzer
//   .swift                      → sourcekit-lsp
//   .php/.phtml/.inc            → intelephense

import { extname } from 'node:path';
import { getLspBridge, closeAllLspBridges } from '../../lib/lsp-bridge.mjs';

// ---------------------------------------------------------------------------
// LSP install commands per language
// ---------------------------------------------------------------------------
const INSTALL_COMMANDS = {
  typescript: {
    name: 'TypeScript/JavaScript',
    exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    // istanbul ignore next — only used in error messages
    install: () => {
      if (process.platform === 'darwin') return 'brew install typescript-language-server';
      return 'npm install -g typescript-language-server';
    },
    fallback: (file, line, character) => {
      if (line) return `smart_grep({pattern:"...", include:"${file}"}) with line ${line} context`;
      return `smart_grep({pattern:"...", include:"${file}"})`;
    },
  },
  python: {
    name: 'Python',
    exts: ['.py', '.pyw'],
    // istanbul ignore next — only used in error messages
    install: () => {
      if (process.platform === 'darwin') return 'brew install pylsp || pip3 install "python-lsp-server[all]"';
      return 'pip install "python-lsp-server[all]"';
    },
    fallback: (file, line) => {
      if (line) return `smart_grep({pattern:"...", include:"${file}"}) with line ${line} context`;
      return `smart_grep({pattern:"...", include:"${file}"})`;
    },
  },
  rust: {
    name: 'Rust',
    exts: ['.rs'],
    // istanbul ignore next — only used in error messages
    install: () => {
      if (process.platform === 'darwin') return 'brew install rust-analyzer || rustup component add rust-analyzer';
      return 'rustup component add rust-analyzer';
    },
    fallback: (file, line) => {
      if (line) return `smart_grep({pattern:"...", include:"${file}"}) with line ${line} context`;
      return `smart_grep({pattern:"...", include:"${file}"})`;
    },
  },
  swift: {
    name: 'Swift',
    exts: ['.swift'],
    // istanbul ignore next — only used in error messages
    install: () => 'xcode-select --install   # sourcekit-lsp ships with Xcode',
    fallback: (file, line) => {
      if (line) return `smart_grep({pattern:"...", include:"${file}"}) with line ${line} context`;
      return `smart_grep({pattern:"...", include:"${file}"})`;
    },
  },
  php: {
    name: 'PHP',
    exts: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php6', '.php7', '.php8', '.phps', '.inc'],
    // istanbul ignore next — only used in error messages
    install: () => 'npm install -g intelephense',
    fallback: (file, line) => {
      if (line) return `smart_grep({pattern:"...", include:"${file}"}) with line ${line} context`;
      return `smart_grep({pattern:"...", include:"${file}"})`;
    },
  },
};

/** All supported file extensions */
const SUPPORTED_EXTS = new Set();
for (const cfg of Object.values(INSTALL_COMMANDS)) {
  for (const ext of cfg.exts) SUPPORTED_EXTS.add(ext);
}

/**
 * Detect language from file extension.
 * @param {string} filePath
 * @returns {object|null} Language config or null if unsupported
 */
function detectLang(filePath) {
  const ext = extname(filePath).toLowerCase();
  for (const [lang, cfg] of Object.entries(INSTALL_COMMANDS)) {
    if (cfg.exts.includes(ext)) return { lang, ...cfg };
  }
  return null;
}

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
    const file = args.file || '';

    // Phase 10 — LSP startup degradation: validate file extension early
    const langInfo = detectLang(file);
    if (!langInfo) {
      return JSON.stringify({
        error: `Unsupported file type: ${file}`,
        supported: [...SUPPORTED_EXTS].join(', '),
        suggestion: `This file type is not supported by smart_lsp. Use smart_grep to search text patterns, or read the file directly.`,
      });
    }

    const bridge = getLspBridge(root);

    try {
      switch (args.operation) {
        case 'symbols': {
          const result = await bridge.getSymbols(file);
          if (result.error) return JSON.stringify(result);
          const { file: f, symbols } = result;
          if (!symbols || symbols.length === 0) {
            return JSON.stringify({ file: f, symbols: [], note: 'No symbols found. File may be empty or language server not started.' });
          }
          // Return compact symbol list
          const compact = symbols.map(s => ({
            name: s.name,
            kind: s.kind,
            line: s.line,
            signature: s.signature,
          }));
          return JSON.stringify({ file: f, symbols: compact, total: compact.length });
        }

        case 'references': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for references operation' });
          }
          const result = await bridge.getReferences(file, args.line, args.character || 0);
          if (result.error) return JSON.stringify(result);
          const { file: f, references } = result;
          if (!references || references.length === 0) {
            return JSON.stringify({ file: f, references: [], note: 'No references found.' });
          }
          return JSON.stringify({ file: f, references, total: references.length });
        }

        case 'hover': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for hover operation' });
          }
          const result = await bridge.getHover(file, args.line, args.character || 0);
          return JSON.stringify(result);
        }

        case 'definition': {
          if (!args.line) {
            return JSON.stringify({ error: 'line parameter required for definition operation' });
          }
          const result = await bridge.getDefinition(file, args.line, args.character || 0);
          return JSON.stringify(result);
        }

        case 'diagnostics': {
          const result = await bridge.getDiagnostics(file);
          return JSON.stringify(result);
        }

        default:
          return JSON.stringify({
            error: `Unknown operation: ${args.operation}`,
            supported: ['symbols', 'references', 'hover', 'definition', 'diagnostics'],
          });
      }
    } catch (err) {
      const msg = err.message || '';
      // Phase 10 — LSP startup degradation: detect missing LSP → specific install + grep fallback
      const installCfg = langInfo?.install;
      const fallbackHint = langInfo?.fallback;
      const installCmd = installCfg ? installCfg() : '';
      const fallback = fallbackHint ? fallbackHint(file, args.line, args.character) : 'smart_grep({pattern:"..."})';

      if (msg.includes('not found') || msg.includes('ENOENT') || msg.includes('spawn')) {
        return JSON.stringify({
          error: `${langInfo.name} language server not found`,
          installCommand: installCmd,
          hint: `Run the install command above, then restart OpenCode.`,
          suggestion: `Meanwhile, use ${fallback} as a text-based alternative.`,
        });
      }

      return JSON.stringify({
        error: msg || 'LSP operation failed',
        hint: 'Check that the file exists and the language server is properly installed.',
        suggestion: `Use ${fallback} as a text-based alternative.`,
      });
    }
  },
};