// compact.mjs → smart_compact + MicroCompact classification
//
// Phase 14.2: Smart Compact Tool — rules-based tool history classifier.
// Analyzes tool call history and classifies each entry as DROP / KEEP_SUMMARY / KEEP.
// Zero LLM cost — pure rules-based classification.
//
// P0 MicroCompact extension: every tool now has a computed "compact action" so
// the auto-clear can decide which outputs to replace with placeholder vs keep.
//
// Classification rules:
//   DROP          — search/lookup tools: grep, glob, lsp, test, learn, *search, crawl
//   KEEP_SUMMARY  — security, ingest, git_*, exa tools, github_search, read, bash
//   KEEP          — think, deep_think, fast_apply, edit, error_diagnose, debug
//                   context, config, compact, security
//   P5 content-aware: 同時分析輸出內容模式
//     - 輸出含 error/exception → 升級至 KEEP (不受工具分類限制)
//     - 輸出含 "no matches" / "0 results" → 降級至 DROP
//     - 輸出長度 < 50 chars → 降級至 DROP (空結果)
//     - 輸出含 security findings → 升級至 KEEP_SUMMARY
//     - 輸出含 "applied" / "written" → 升級至 KEEP (有實際變更)
//   Unknown       → KEEP (conservative)
//
// Safety: Last 3 turns are always KEEP (never analyzed for dropping).

// ---------------------------------------------------------------------------
// Classification rules (P0: expanded for all Smart MCP tools)
// ---------------------------------------------------------------------------

/** Tools whose output is stale and can be safely dropped.
 *  These are ephemeral lookups — once read, the result is consumed. */
const DROP_TOOLS = new Set([
  'smart_grep',
  'smart_lsp',
  'smart_test',
  'smart_learn',
  'smart_glob',
  'smart_run',
  'import_graph',
  'code_impact',
  'naming',
  'coverage',
  'test_suggest',
  'git_context',
  'py_helper',
  'ts_helper',
  'rs_helper',
  'diagram',
  'report',
  'warm_up',
  'integrate',
  'compose',
  'tool_stats',
]);

/** Tools whose output should be summarized (keep key findings, drop raw output).
 *  These are valuable but verbose — keep a summary, drop the details. */
const KEEP_SUMMARY_TOOLS = new Set([
  'smart_security',
  'smart_ingest_document',
  'smart_exa_search',
  'smart_exa_crawl',
  'smart_github_search',
  'smart_read',
  'smart_rules',
  'bash',
  'smart_context',
  'smart_compact',
  'smart_config',
  'memory_store',
]);

/** Tools whose output should be fully preserved.
 *  These contain decision-quality information that must survive compaction. */
const KEEP_TOOLS = new Set([
  'smart_think',
  'smart_deep_think',
  'smart_fast_apply',
  'smart_fast_apply_verbose',
  'edit',
  'write',
  'error_diagnose',
  'debug',
  'planner',
  'cross_file_edit',
  'rename_safety',
]);

/** Prefix-based matching */
const GIT_PREFIX = 'git_';
const SMART_PREFIX = 'smart_';
const MEMORY_PREFIX = 'memory_';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * P5: Content-aware patterns for classification override.
 * 即使工具名稱屬於 DROP，輸出內容若符合這些模式則升級。
 * 即使工具名稱屬於 KEEP，輸出內容若符合這些模式則降級。
 */
const CONTENT_UPGRADE_PATTERNS = [
  // 含明確錯誤 → 升級至 KEEP (決策價值)。避免 "0 failed" 這類成功訊息
  { pattern: /error|exception|crash|traceback|TypeError|ReferenceError|SyntaxError/i, upgradeTo: 'KEEP' },
  // 含安全漏洞/嚴重性關鍵字 → 升級至 KEEP_SUMMARY
  { pattern: /CRITICAL|HIGH.*?(?:severity|issue|vuln)|vulnerability|CVE-/i, upgradeTo: 'KEEP_SUMMARY' },
  // 含 patch apply 記錄 (特定模式，避免 "created"/"written" 過度匹配)
  { pattern: /applied\s+\d+\/\d+/i, upgradeTo: 'KEEP' },
];

const CONTENT_DOWNGRADE_PATTERNS = [
  // 空結果 → 降級至 DROP
  { pattern: /(?:no matches|0 matches|not found|no results|0 results)/i, downgradeTo: 'DROP' },
];

/**
 * Classify a single tool call entry — P5 content-aware version.
 * 同時考慮工具名稱 + 輸出內容模式。
 * 
 * @param {{ tool: string, ok?: boolean, result?: string, error?: string }} entry
 * @returns {'DROP' | 'KEEP_SUMMARY' | 'KEEP'}
 */
export function classifyEntry(entry) {
  const tool = entry.tool || '';
  const output = entry.result || entry.error || '';

  // 先決定基礎分類 (工具名稱為主)
  let base;
  if (DROP_TOOLS.has(tool)) base = 'DROP';
  else if (KEEP_SUMMARY_TOOLS.has(tool)) base = 'KEEP_SUMMARY';
  else if (KEEP_TOOLS.has(tool)) base = 'KEEP';
  else if (tool.startsWith(GIT_PREFIX)) base = 'KEEP_SUMMARY';
  else if (tool.startsWith(MEMORY_PREFIX)) base = 'KEEP_SUMMARY';
  else if (tool.startsWith(SMART_PREFIX)) {
    const baseName = tool.slice(SMART_PREFIX.length);
    if (/^(search|find|list|show|get|check|scan)/i.test(baseName)) base = 'DROP';
    else base = 'KEEP_SUMMARY';
  } else {
    base = 'KEEP'; // Unknown → conservative
  }

  // P5: 只有在有實際輸出內容時才套用 content-aware override
  if (output && output.length > 0) {
    // 1. 先檢查 upgrade (重要內容優先保留)
    for (const cp of CONTENT_UPGRADE_PATTERNS) {
      if (cp.pattern.test(output)) {
        return cp.upgradeTo;
      }
    }

    // 2. 再檢查 downgrade (空結果就丟)
    for (const cp of CONTENT_DOWNGRADE_PATTERNS) {
      if (cp.pattern.test(output)) {
        return cp.downgradeTo;
      }
    }

    // 3. 最後才判斷短內容 (< 50 chars, 僅 DROP 類基礎工具才降級)
    // KEEP_SUMMARY 工具如 git_commit 本來就產出短摘要，不應被降級
    if (output.length < 50 && base === 'DROP') {
      return 'DROP';
    }
  }

  return base;
}

/**
 * P5: Numeric value score for a tool entry (0-3).
 * 供 prefetch 機制做更細粒度的壓縮決定。
 * 3 = critical (保留完整), 2 = useful (摘要), 1 = summarizable (短摘要), 0 = discardable (可丟)
 */
export function classifyValue(entry) {
  const tool = entry.tool || '';
  const output = entry.result || entry.error || '';
  const length = output.length;

  // 含嚴重錯誤 → 最高價值
  if (/error|exception|failed|crash|traceback|TypeError/i.test(output.slice(0, 500))) return 3;
  // 含實際變更 → 高價值
  if (/applied\s+\d+\/\d+|written|created/i.test(output.slice(0, 300))) return 3;
  // 含安全/漏洞 → 高價值
  if (/critical|vulnerability|CVE-/i.test(output.slice(0, 500))) return 3;
  // 決策類工具 → 高價值
  if (tool === 'smart_think' || tool === 'smart_deep_think' || tool === 'error_diagnose' || tool === 'planner') return 3;
  // 編輯類工具 → 高價值
  if (tool === 'smart_fast_apply' || tool === 'edit' || tool === 'write') return 2;
  // 讀取類工具 → 中度價值 (摘要即可)
  if (tool === 'smart_read' || tool === 'smart_rules') return 2;
  // 查詢類工具 → 低價值 (語意查詢/搜尋結果)
  if (tool === 'smart_grep' || tool === 'smart_lsp' || tool === 'smart_test' || tool === 'smart_glob' || tool === 'smart_learn') return 1;
  if (tool === 'smart_exa_search' || tool === 'smart_exa_crawl' || tool === 'smart_github_search') return 1;
  if (tool.startsWith('git_') || tool === 'bash') return 1;
  // 空結果或極短輸出 (僅對尚未匹配的通用工具) → 無價值
  if (length < 20 || /no matches|0 matches|not found|0 results/i.test(output.slice(0, 200))) return 0;
  // 預設: 有用
  return 2;
}

/**
 * P5: Check if an entry should be prefetch-compressed (low-value → immediate compress).
 * 在 capture 當下就決定是否預壓縮，阻止它進 context。
 */
export function shouldPrefetchCompact(entry) {
  const value = classifyValue(entry);
  // value 0 → 立刻壓縮 (連佔位都不用留)
  // value 1 → 預摘要化 (只留前 200 chars)
  if (value <= 1) return { compress: true, action: value === 0 ? 'drop' : 'preview' };
  return { compress: false, action: 'keep' };
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
        description: 'Array of tool call entries: [{ tool, ok, result?, error?, timestamp? }]. Auto-populated from server context when auto:true.',
      },
      auto: {
        type: 'boolean',
        description: 'Auto mode: server injects toolHistory from current session context. No need to pass toolHistory manually.',
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
    required: [],
  },

  handler,
};