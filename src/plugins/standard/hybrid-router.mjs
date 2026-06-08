// hybrid-router.mjs → smart_hybrid_router
// Phase 12 + Phase 3: Universal Task Router — single entry point for ALL tasks.
//
// Routes questions to the optimal analysis path:
//   code tasks (structure/change-impact/debug/search/semantic)
//     → CKG/LSP/grep tools (deterministic execution)
//   general tasks (crawl/refactor/git/security/test/report/lang/search_web/edit/plan/office/wiki/analyze)
//     → structured recommendation (tool/skill/workflow)
//   unknown → broad context gathering (hybrid)
//
// Phase 3 upgrade: LLM only needs to describe the task. Router handles the rest.
//
// Output: structured answer with source tool attribution and confidence.

import {
  CATEGORIES,
  executeHybrid,
  extractSymbols,
} from '../../lib/hybrid-engine.mjs';
import { closeAllLspBridges } from '../../lib/lsp-bridge.mjs';

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_hybrid_router',
  category: 'standard',
  description: `Universal Task Router — single entry point for ALL tasks. Just describe what you need.

Phase 3: LLM only describes the task. Router handles classification + routing.
  code tasks (structure/debug/search/change-impact/semantic)
    → deterministic CKG/LSP/grep execution
  general tasks (crawl/refactor/git/security/test/report/lang/search/edit/plan/office/wiki/analyze)
    → structured tool/skill recommendation + workflow

Features:
- Universal Classifier: categorizes into 6 code types + 13 general domains
- Code tasks: automatic CKG/LSP/grep execution with confidence scoring
- General tasks: returns best-matching skill/tools/workflow recommendation
- Hybrid fallback: uncertain questions gather context from both paths

Examples:
  { question: "who calls authenticate() in src/auth.ts", root: "." }
    → code structure: CKG callers query + LSP type info

  { question: "幫我爬 iyf.tv 的 API", root: "." }
    → general crawl: recommends skill("smart-mcp-crawl") + workflow

  { question: "explain the architecture of this module", files: ["src/lib/hybrid-engine.mjs"] }
    → semantic: AST + deps + file content for LLM synthesis

  { question: "掃描這個專案的漏洞", root: "." }
    → general security: recommends skill("smart-mcp-security") + tools`,
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question about the codebase',
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: cwd)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relevant file paths to focus analysis',
      },
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Symbol names to focus analysis (auto-extracted from question if not provided)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
    },
    required: ['question'],
  },
  handler: async (args) => {
    let needCloseLsp = false;
    try {
      const question = args.question;
      const root = args.root || process.cwd();
      const files = args.files || [];
      const symbols = args.symbols || extractSymbols(question);
      const format = args.format || 'text';

      if (!question) {
        return format === 'json'
          ? JSON.stringify({ error: 'question is required' })
          : 'Error: question is required.';
      }

      // Single entry point: executeHybrid handles classification + routing
      //   code tasks → CKG/LSP deterministic execution
      //   general tasks → structured recommendation (no LSP needed)
      //   unknown → broad context gathering
      const merged = await executeHybrid({ question, root, files, symbols, format: 'all' });

      // Track if we need to close LSP (only for non-general tasks)
      if (!merged.metadata?.isGeneralTask) {
        needCloseLsp = true;
      }

      if (format === 'json') {
        return JSON.stringify(merged, null, 2);
      }

      // Build human-readable text output
      let text = '';

      // Check if this is a general task recommendation
      if (merged._raw?.recommendation) {
        text += merged.answer;
        return text;
      }

      // Header with classification
      if (merged.classification?.isHybrid) {
        text += `🔀 Hybrid Analysis`;
      } else {
        text += `🎯 Deterministic Analysis`;
      }
      text += ` — ${merged.classification?.description || ''}\n`;
      text += `${'─'.repeat(60)}\n`;

      // Classification info
      text += `\nCategory:   ${merged.classification?.category || 'unknown'}`;
      text += `\nConfidence: ${Math.round((merged.classification?.confidence || 0) * 100)}%`;
      text += `\nDuration:   ${merged.metadata?.duration || 0}ms`;
      text += `\nTools:      ${merged.metadata?.toolsUsed || 0} executed, ${merged.metadata?.toolsErrored || 0} errors`;
      text += '\n';

      // Answer
      text += `\n${merged.answer}\n`;

      // Source attribution
      if (merged.sources?.length > 0) {
        text += `\n${'─'.repeat(60)}`;
        text += '\nSources:\n';
        for (const src of merged.sources.slice(0, 8)) {
          const status = src.hasData ? '✓' : (src.error ? '✗' : '·');
          const confidence = src.confidence ? ` (${Math.round(src.confidence * 100)}%)` : '';
          text += `  ${status} ${src.tool}${confidence}\n`;
        }
      }

      // Errors
      if (merged._raw?.errors?.length > 0) {
        text += `\n⚠️  ${merged._raw.errors.length} tool error(s):\n`;
        for (const err of merged._raw.errors.slice(0, 3)) {
          text += `  ${err.tool}: ${err.error.slice(0, 100)}\n`;
        }
      }

      // Guidance for hybrid mode
      if (merged.classification?.isHybrid) {
        text += `\n${'─'.repeat(60)}`;
        text += `\n💡 This is a hybrid query. The deterministic context above can be fed to an LLM for deeper analysis.\n`;
        text += `   Alternatively, refine your question with file/symbol context: add files=[...] or improve phrasing.\n`;
      }

      return text;
    } finally {
      if (needCloseLsp) await closeAllLspBridges();
    }
  },
};
