// hybrid-router.mjs → smart_hybrid_router
// Phase 12: Hybrid Reasoning Engine — MCP tool entry point.
//
// Routes questions to the optimal analysis path:
//   structure    → CKG callers/callees + LSP type/ast (deterministic)
//   change-impact → CKG + impact analysis + import graph (deterministic)
//   debug        → grep + CKG context + error diagnosis (deterministic)
//   search       → grep + CKG symbol lookup (deterministic)
//   semantic     → CKG context + LSP data + LLM path (hybrid)
//   unknown      → broad context gathering (hybrid)
//
// Output: structured answer with source tool attribution and confidence.

import {
  classifyQuestion,
  planPath,
  executePlan,
  mergeResults,
  extractSymbols,
} from '../../lib/hybrid-engine.mjs';
import { closeAllLspBridges } from '../../lib/lsp-bridge.mjs';

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_hybrid_router',
  category: 'standard',
  description: `Hybrid Reasoning Engine — routes code questions to optimal analysis path.

Phase 12: Two-layer intelligence. Determines whether a question needs
deterministic tools (CKG/LSP/grep), LLM analysis, or both.

Features:
- Task Classifier: categorizes questions into 6 types (structure/search/debug/change-impact/semantic/unknown)
- Deterministic execution: automatically calls CKG/LSP/grep for structure/search/debug
- Confidence scoring: each answer includes confidence + source attribution
- Hybrid fallback: uncertain questions gather context from both paths

Examples:
  { question: "who calls authenticate() in src/auth.ts", root: "." }
    → structure: CKG callers query + LSP type info

  { question: "what if I rename authenticate()", root: ".", files: ["src/auth.ts"] }
    → change-impact: CKG callers + LSP impact analysis + deps

  { question: "explain the architecture of this module", files: ["src/lib/hybrid-engine.mjs"] }
    → semantic: AST + deps + file content for LLM synthesis`,
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

      // Step 1: Classify the question
      const classification = classifyQuestion(question, { files, symbols });

      // Step 2: Generate execution plan
      const plan = planPath(classification, question, { root, files, symbols });

      // Step 3: Execute deterministic tools
      const execResult = await executePlan(plan);

      // Step 4: Merge outputs
      const merged = mergeResults(classification, execResult, question);

      if (format === 'json') {
        return JSON.stringify(merged, null, 2);
      }

      // Build human-readable text output
      let text = '';

      // Header with classification
      if (classification.isHybrid) {
        text += `🔀 Hybrid Analysis`;
      } else {
        text += `🎯 Deterministic Analysis`;
      }
      text += ` — ${classification.description}\n`;
      text += `${'─'.repeat(60)}\n`;

      // Classification info
      text += `\nCategory:   ${classification.category}`;
      text += `\nConfidence: ${Math.round(classification.confidence * 100)}%`;
      text += `\nDuration:   ${merged.metadata.duration}ms`;
      text += `\nTools:      ${merged.metadata.toolsUsed} executed, ${merged.metadata.toolsErrored} errors`;
      text += '\n';

      // Answer
      text += `\n${merged.answer}\n`;

      // Source attribution
      if (merged.sources.length > 0) {
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
      if (classification.isHybrid) {
        text += `\n${'─'.repeat(60)}`;
        text += `\n💡 This is a hybrid query. The deterministic context above can be fed to an LLM for deeper analysis.\n`;
        text += `   Alternatively, refine your question with file/symbol context: add files=[...] or improve phrasing.\n`;
      }

      return text;
    } finally {
      await closeAllLspBridges();
    }
  },
};
