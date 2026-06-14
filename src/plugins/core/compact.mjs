// compact.mjs → smart_compact
//
// Phase 14.2: Smart Compact Tool — rules-based tool history classifier.
// Analyzes tool call history and classifies each entry as DROP / KEEP SUMMARY / KEEP.
// Zero LLM cost — pure rules-based classification.
//
// Purpose: Help the LLM decide which tool outputs to discard before compaction,
// reducing context budget pressure and preventing unnecessary compaction cycles.
//
// Classification rules:
//   DROP          — smart_grep, smart_lsp, smart_test, smart_learn,
//                   import_graph, code_impact
//   KEEP SUMMARY  — smart_security, smart_ingest_document, git_*
//   KEEP          — smart_think, smart_deep_think, smart_fast_apply,
//                   edit, error_diagnose, debug
//   Unknown       → KEEP (conservative)
//
// Safety: Last 3 turns are always KEEP (never analyzed for dropping).

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/** Tools whose output is stale and can be safely dropped */
const DROP_TOOLS = new Set([
  'smart_grep',
  'smart_lsp',
  'smart_test',
  'smart_learn',
  'import_graph',
  'code_impact',
]);

/** Tools whose output should be summarized (keep key findings, drop raw output) */
const KEEP_SUMMARY_TOOLS = new Set([
  'smart_security',
  'smart_ingest_document',
]);

/** Tools whose output should be fully preserved */
const KEEP_TOOLS = new Set([
  'smart_think',
  'smart_deep_think',
  'smart_fast_apply',
  'edit',
  'error_diagnose',
  'debug',
]);

/** Prefix-based matching for git tools */
const GIT_PREFIX = 'git_';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a single tool call entry.
 * @param {{ tool: string, ok?: boolean, result?: string, error?: string }} entry
 * @returns {'DROP' | 'KEEP_SUMMARY' | 'KEEP'}
 */
export function classifyEntry(entry) {
  const tool = entry.tool || '';

  if (DROP_TOOLS.has(tool)) return 'DROP';
  if (KEEP_SUMMARY_TOOLS.has(tool)) return 'KEEP_SUMMARY';
  if (KEEP_TOOLS.has(tool)) return 'KEEP';
  if (tool.startsWith(GIT_PREFIX)) return 'KEEP_SUMMARY';

  // Unknown → conservative: KEEP
  return 'KEEP';
}

/**
 * Generate a brief summary from a tool output.
 * Extracts key findings, error counts, or first meaningful line.
 */
export function summarizeOutput(entry) {
  const text = entry.result || entry.error || '';
  if (!text) return '(empty output)';

  // Try to extract structured info
  const lines = text.split('\n').filter(l => l.trim());

  // For security: extract severity counts
  if (entry.tool === 'smart_security') {
    const critical = lines.filter(l => /critical/i.test(l)).length;
    const high = lines.filter(l => /high\s+severity/i.test(l)).length;
    const medium = lines.filter(l => /medium\s+severity/i.test(l)).length;
    if (critical + high + medium > 0) {
      return `Found ${critical} critical, ${high} high, ${medium} medium issues`;
    }
  }

  // For document ingestion: extract title/format
  if (entry.tool === 'smart_ingest_document') {
    const titleMatch = text.match(/["']?title["']?\s*:\s*["']([^"']+)["']/i);
    const formatMatch = text.match(/["']?format["']?\s*:\s*["']([^"']+)["']/i);
    if (titleMatch || formatMatch) {
      return `Document: ${titleMatch?.[1] || 'unknown'} (${formatMatch?.[1] || 'unknown format'})`;
    }
  }

  // For git tools: extract action
  if (entry.tool.startsWith('git_')) {
    const firstLine = lines[0] || '';
    return firstLine.slice(0, 200);
  }

  // Generic: first meaningful line
  return lines[0]?.slice(0, 200) || '(no readable summary)';
}

/**
 * Extract key findings from KEEP and KEEP_SUMMARY entries.
 */
function extractKeyFindings(entries) {
  const findings = [];
  for (const entry of entries) {
    const text = entry.result || entry.error || '';
    if (!text) continue;

    // Extract error patterns
    const errorMatch = text.match(/(?:error|Error|ERROR|exception|Exception)[:\s]+([^\n]{0,150})/);
    if (errorMatch) {
      findings.push(`[${entry.tool}] ${errorMatch[0].slice(0, 150)}`);
    }

    // Extract security findings
    const secMatch = text.match(/(?:critical|CRITICAL|vulnerability|CVE)[:\s]+([^\n]{0,150})/i);
    if (secMatch && !findings.some(f => f.includes(secMatch[0].slice(0, 80)))) {
      findings.push(`[${entry.tool}] ${secMatch[0].slice(0, 150)}`);
    }
  }
  return findings.slice(0, 5); // cap at 5
}

/**
 * Estimate tokens saved by dropping/summarizing entries.
 * Rough estimate: ~4 chars per token.
 */
function estimateTokensSaved(classification) {
  let charsSaved = 0;
  for (const item of classification) {
    const text = item.entry?.result || item.entry?.error || '';
    if (item.action === 'DROP') {
      charsSaved += text.length;
    } else if (item.action === 'KEEP_SUMMARY') {
      // Summary is ~10% of original size
      charsSaved += text.length * 0.9;
    }
  }
  return Math.round(charsSaved / 4);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array} args.toolHistory - Array of { tool, ok, result?, error?, timestamp? }
 * @param {number} [args.conversationLength] - Total conversation turns (for context)
 * @param {string} [args.currentGoal] - Current task goal
 * @param {Array} [args.currentTodos] - Current TODO items
 * @returns {string} JSON result
 */
function handler(args) {
  const toolHistory = args.toolHistory || [];
  const currentGoal = args.currentGoal || '';
  const currentTodos = args.currentTodos || [];

  if (!Array.isArray(toolHistory) || toolHistory.length === 0) {
    return JSON.stringify({
      toolCallsToDrop: [],
      toolOutputsToSummarize: [],
      recoveryContext: {
        goal: currentGoal || '(none)',
        todos: currentTodos,
        keyFindings: [],
        openQuestions: [],
      },
      estimatedTokensSaved: 0,
      note: 'No tool history to analyze.',
    });
  }

  // Safety: protect last 3 turns (only when history > 3)
  const PROTECT_LAST = 3;
  const analyzableCount = toolHistory.length > PROTECT_LAST
    ? toolHistory.length - PROTECT_LAST
    : toolHistory.length;
  const analyzable = toolHistory.slice(0, analyzableCount);
  const protected_ = toolHistory.slice(analyzableCount);

  // Classify each analyzable entry
  const classification = analyzable.map(entry => ({
    entry,
    action: classifyEntry(entry),
  }));

  // Build result
  const toolCallsToDrop = [];
  const toolOutputsToSummarize = [];

  for (const item of classification) {
    if (item.action === 'DROP') {
      toolCallsToDrop.push(toolHistory.indexOf(item.entry));
    } else if (item.action === 'KEEP_SUMMARY') {
      toolOutputsToSummarize.push({
        index: toolHistory.indexOf(item.entry),
        tool: item.entry.tool,
        summary: summarizeOutput(item.entry),
      });
    }
  }

  // Extract key findings from KEEP + KEEP_SUMMARY entries
  const keptEntries = classification
    .filter(c => c.action === 'KEEP' || c.action === 'KEEP_SUMMARY')
    .map(c => c.entry);
  const keyFindings = extractKeyFindings([...keptEntries, ...protected_]);

  // Open questions: entries that ended with errors
  const openQuestions = [...analyzable, ...protected_]
    .filter(e => e.ok === false)
    .map(e => `[${e.tool}] ${(e.error || '').slice(0, 150)}`)
    .slice(0, 3);

  const estimatedTokensSaved = estimateTokensSaved(classification);

  // Build recovery context
  const recoveryContext = {
    goal: currentGoal || '(not provided)',
    todos: currentTodos.slice(0, 10),
    keyFindings,
    openQuestions,
  };

  // Per-tool breakdown
  const breakdown = {};
  for (const item of classification) {
    const tool = item.entry.tool || 'unknown';
    if (!breakdown[tool]) breakdown[tool] = { action: item.action, count: 0 };
    breakdown[tool].count++;
  }

  return JSON.stringify({
    analyzed: analyzableCount,
    protected: protected_.length,
    toolCallsToDrop,
    toolOutputsToSummarize,
    recoveryContext,
    estimatedTokensSaved,
    breakdown,
    note: toolCallsToDrop.length === 0 && toolOutputsToSummarize.length === 0
      ? 'No entries can be safely dropped or summarized. All tool outputs are still relevant.'
      : `Found ${toolCallsToDrop.length} droppable and ${toolOutputsToSummarize.length} summarizable entries. Last ${PROTECT_LAST} turns protected.`,
  }, null, 2);
}

export default {
  name: 'smart_compact',
  category: 'core',
  description: `[compact] Use when: need to analyze tool history and identify which outputs can be safely dropped or summarized to free context budget. Rules-based (zero LLM cost). Returns droppable indices, summarizable entries, recovery context, and estimated token savings.`,
  responsePolicy: { maxLevel: 0 }, // Small output, keep raw
  inputSchema: {
    type: 'object',
    properties: {
      toolHistory: {
        type: 'array',
        description: 'Array of tool call entries: [{ tool, ok, result?, error?, timestamp? }]',
      },
      conversationLength: {
        type: 'number',
        description: 'Total conversation turns (for context, optional)',
      },
      currentGoal: {
        type: 'string',
        description: 'Current task goal for recovery context',
      },
      currentTodos: {
        type: 'array',
        description: 'Current TODO items for recovery context',
      },
    },
    required: ['toolHistory'],
  },

  handler,
};