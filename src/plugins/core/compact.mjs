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
  { pattern: /error|exception|crash|traceback|TypeError|ReferenceError|SyntaxError/i, upgradeTo: 'KEEP' },
  { pattern: /CRITICAL|HIGH.*?(?:severity|issue|vuln)|vulnerability|CVE-/i, upgradeTo: 'KEEP_SUMMARY' },
  { pattern: /applied\s+\d+\/\d+/i, upgradeTo: 'KEEP' },
  { pattern: /(?:failed|failure|failing)\s+\d+/i, upgradeTo: 'KEEP' },
  { pattern: /\d+\s+(?:file|files?\s*changed|insertion|deletion)/i, upgradeTo: 'KEEP_SUMMARY' },
  { pattern: /deprecated|migration\s+needed|will\s+be\s+removed/i, upgradeTo: 'KEEP_SUMMARY' },
  { pattern: /✅\s*(?:done|complete|success|applied|added)/i, upgradeTo: 'KEEP' },
  { pattern: /\d+\s+(?:error|warning|problem|diagnostic)/i, upgradeTo: 'KEEP_SUMMARY' },
];

const CONTENT_DOWNGRADE_PATTERNS = [
  { pattern: /(?:no matches|0 matches|not found|no results|0 results)/i, downgradeTo: 'DROP' },
  { pattern: /(?:nothing to commit|already up.to.date|no changes|0 files changed)/i, downgradeTo: 'DROP' },
  { pattern: /0\s+(?:vulnerabilit|issue|finding|alert|problem)/i, downgradeTo: 'DROP' },
  { pattern: /no\s+(?:data|content|entries|items|results?\s+found)/i, downgradeTo: 'DROP' },
  { pattern: /^(?:ok|done|noop|nop|\.|\s*)$/i, downgradeTo: 'DROP' },
];

/**
 * Classify a single tool call entry — P5 content-aware version.
 */
export function classifyEntry(entry) {
  const tool = entry.tool || '';
  const output = entry.result || entry.error || '';

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
    base = 'KEEP';
  }

  if (output && output.length > 0) {
    for (const cp of CONTENT_UPGRADE_PATTERNS) {
      if (cp.pattern.test(output)) return cp.upgradeTo;
    }
    for (const cp of CONTENT_DOWNGRADE_PATTERNS) {
      if (cp.pattern.test(output)) return cp.downgradeTo;
    }
    if (output.length < 50 && base === 'DROP') return 'DROP';
  }

  return base;
}

/**
 * Numeric value score for a tool entry (0-3).
 */
export function classifyValue(entry) {
  const tool = entry.tool || '';
  const output = entry.result || entry.error || '';
  const length = output.length;

  if (/error|exception|failed|crash|traceback|TypeError/i.test(output.slice(0, 500))) return 3;
  if (/applied\s+\d+\/\d+|written|created/i.test(output.slice(0, 300))) return 3;
  if (/critical|vulnerability|CVE-/i.test(output.slice(0, 500))) return 3;
  if (tool === 'smart_think' || tool === 'smart_deep_think' || tool === 'error_diagnose' || tool === 'planner') return 3;
  if (tool === 'smart_fast_apply' || tool === 'edit' || tool === 'write') return 2;
  if (tool === 'smart_read' || tool === 'smart_rules') return 2;
  if (tool === 'smart_grep' || tool === 'smart_lsp' || tool === 'smart_test' || tool === 'smart_glob' || tool === 'smart_learn') return 1;
  if (tool === 'smart_exa_search' || tool === 'smart_exa_crawl' || tool === 'smart_github_search') return 1;
  if (tool.startsWith('git_') || tool === 'bash') return 1;
  if (length < 20 || /no matches|0 matches|not found|0 results/i.test(output.slice(0, 200))) return 0;
  return 2;
}

/**
 * P5: Check if an entry should be prefetch-compressed.
 */
export function shouldPrefetchCompact(entry) {
  const value = classifyValue(entry);
  if (value <= 1) return { compress: true, action: value === 0 ? 'drop' : 'preview' };
  return { compress: false, action: 'keep' };
}

/**
 * Generate a brief summary from a tool output.
 */
export function summarizeOutput(entry) {
  const text = entry.result || entry.error || '';
  if (!text) return '(empty output)';
  const lines = text.split('\n').filter(l => l.trim());

  if (entry.tool === 'smart_security') {
    const critical = lines.filter(l => /critical/i.test(l)).length;
    const high = lines.filter(l => /high\s+severity/i.test(l)).length;
    const medium = lines.filter(l => /medium\s+severity/i.test(l)).length;
    if (critical + high + medium > 0)
      return `Found ${critical} critical, ${high} high, ${medium} medium issues`;
  }
  if (entry.tool === 'smart_ingest_document') {
    const titleMatch = text.match(/["']?title["']?\s*:\s*["']([^"']+)["']/i);
    const formatMatch = text.match(/["']?format["']?\s*:\s*["']([^"']+)["']/i);
    if (titleMatch || formatMatch)
      return `Document: ${titleMatch?.[1] || 'unknown'} (${formatMatch?.[1] || 'unknown format'})`;
  }
  if (entry.tool.startsWith('git_'))
    return (lines[0] || '').slice(0, 200);
  return lines[0]?.slice(0, 200) || '(no readable summary)';
}

// ---------------------------------------------------------------------------
// Recovery context helpers (P2.6: 真正有用的 recovery)
// ---------------------------------------------------------------------------

/**
 * 過濾 todos：只留 active（pending/in_progress），已完成的至多留 3 筆
 */
function filterRecoveryTodos(todos) {
  if (!Array.isArray(todos)) return [];
  const active = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const completed = todos.filter(t => t.status === 'completed').slice(-3);
  return [...active, ...completed];
}

/**
 * 從 tool history 擷取最近編輯的檔案路徑
 */
function extractRecentEdits(entries) {
  const edits = [];
  for (const entry of entries) {
    const text = entry.result || entry.error || '';
    if (!text) continue;

    // smart_fast_apply output 通常含檔案路徑
    if (entry.tool === 'smart_fast_apply' || entry.tool === 'smart_fast_apply_verbose') {
      // 匹配 "File: xxx" 或 "xxx.mjs" 或 "+x -x" diff 統計
      const fileMatch = text.match(/✅\s*(.*?\.(?:mjs|js|ts|json|md|css|html))\b/i)
                     || text.match(/file:\s*(\S+)/i)
                     || text.match(/(?:\/[\w.-]+\/)+\w+\.\w+/);
      if (fileMatch) edits.push({ tool: entry.tool, file: fileMatch[1], ok: entry.ok !== false });
    }
    // bash git diff 輸出也可能含檔案
    if (entry.tool === 'bash' && /git\s+(diff|show|log|add)/i.test(text)) {
      const files = text.match(/---\s+a\/(\S+)|\+\+\+\s+b\/(\S+)/g);
      if (files) {
        for (const f of files) {
          const file = f.replace(/^[-+]{3}\s+[ab]\//, '');
          if (file && file.length > 1) edits.push({ tool: 'git', file, ok: true });
        }
      }
    }
    // multi-file apply 格式
    if (entry.tool === 'smart_fast_apply') {
      const multiMatch = text.match(/Applied\s+\d+\/\d+\s+—\s*([^]+?)(?:\n|$)/i);
      if (multiMatch) edits.push({ tool: 'fast_apply', file: multiMatch[1].trim(), ok: true });
    }
  }
  return edits.slice(0, 8); // 最多 8 筆
}

/**
 * 擷取重要發現（非僅 error—也包含 test pass、commit、edit）
 */
function extractUsefulFindings(entries) {
  const findings = [];

  for (const entry of entries) {
    const text = entry.result || entry.error || '';
    if (!text) continue;

    // Error 是最重要的 finding
    const errorMatch = text.match(/(?:error|Error|ERROR|exception|Exception)[:\s]+([^\n]{0,120})/);
    if (errorMatch) {
      findings.push(`[${entry.tool}] ${errorMatch[0].slice(0, 120)}`);
      continue; // error 優先，同一 entry 不重複
    }

    // Test pass/fail
    if (entry.tool === 'smart_test' || entry.tool === 'test') {
      const passMatch = text.match(/(\d+)\s+pass/);
      const failMatch = text.match(/(\d+)\s+fail/);
      if (failMatch || passMatch) {
        const summary = `tests: ${passMatch?.[1] || 0} pass, ${failMatch?.[1] || 0} fail`;
        findings.push(`[${entry.tool}] ${summary}`);
        continue;
      }
    }

    // Git commit
    if (entry.tool === 'git_commit') {
      const commitLine = text.split('\n')[0]?.slice(0, 80);
      if (commitLine) findings.push(`[commit] ${commitLine}`);
      continue;
    }

    // Apply/edit summary
    if (entry.tool === 'smart_fast_apply' && /✅\s*Applied/i.test(text)) {
      const fileMatch = text.match(/✅\s*Applied\s+\d+\/\d+\s+(.+)/);
      if (fileMatch) findings.push(`[edit] edited ${fileMatch[1].trim()}`);
      continue;
    }

    // Security findings
    const secMatch = text.match(/(?:critical|CRITICAL|vulnerability|CVE)[:\s]+([^\n]{0,100})/i);
    if (secMatch && !findings.some(f => f.includes(secMatch[0].slice(0, 60)))) {
      findings.push(`[${entry.tool}] ${secMatch[0].slice(0, 120)}`);
    }
  }

  return findings.slice(0, 8); // 最多 8 筆
}

/**
 * 計算真實的 session 統計（排除分類器產生的雜訊）
 */
function computeSessionStats(entries) {
  const tools = new Set();
  let errors = 0;
  let applies = 0;
  let tests = { pass: 0, fail: 0 };

  for (const entry of entries) {
    if (entry.tool) tools.add(entry.tool);
    if (entry.ok === false) errors++;
    if (entry.tool === 'smart_fast_apply') applies++;
    if (entry.tool === 'smart_test' || entry.tool === 'test') {
      const text = entry.result || '';
      const passMatch = text.match(/(\d+)\s+pass/i);
      const failMatch = text.match(/(\d+)\s+fail/i);
      if (passMatch) tests.pass += parseInt(passMatch[1]);
      if (failMatch) tests.fail += parseInt(failMatch[1]);
    }
  }

  return {
    totalCalls: entries.length,
    uniqueTools: tools.size,
    tools: [...tools].slice(0, 15),
    errors,
    applies,
    testsPassed: tests.pass,
    testsFailed: tests.fail,
  };
}

/**
 * 從 entries 取得最近的檔案
 */
function extractRecentFiles(entries) {
  const files = [];
  const seen = new Set();
  for (const entry of entries) {
    const text = entry.result || entry.error || '';
    if (!text) continue;
    // 匹配常見檔案路徑模式
    const fileMatches = text.match(/(?:src|lib|tests|config|plugins|cli)\/[\w./-]+\.(?:mjs|js|ts|json|md|css)/g);
    if (fileMatches) {
      for (const f of fileMatches) {
        if (!seen.has(f)) {
          seen.add(f);
          files.push(f);
        }
      }
    }
  }
  return files.slice(-6); // 最近 6 個不重複檔案
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function handler(args) {
  const toolHistory = args.toolHistory || [];
  const currentGoal = args.currentGoal || '';
  const currentTodos = args.currentTodos || [];

  // ── 計算 session 統計 ──
  const session = computeSessionStats(toolHistory);

  if (!Array.isArray(toolHistory) || toolHistory.length === 0) {
    return JSON.stringify({
      toolCallsToDrop: [],
      toolOutputsToSummarize: [],
      recoveryContext: {
        goal: currentGoal,
        doneRatio: '-',
        activeTasks: filterRecoveryTodos(currentTodos),
        recentEdits: [],
        recentFiles: [],
        testResults: null,
        keyFindings: [],
        openQuestions: [],
        session,
      },
      estimatedTokensSaved: 0,
      note: 'No tool history to analyze.',
    });
  }

  // Safety: protect last 3 turns
  const PROTECT_LAST = 3;
  const analyzableCount = toolHistory.length > PROTECT_LAST
    ? toolHistory.length - PROTECT_LAST
    : toolHistory.length;
  const analyzable = toolHistory.slice(0, analyzableCount);
  const protected_ = toolHistory.slice(analyzableCount);
  const allEntries = [...analyzable, ...protected_];

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

  const estimatedTokensSaved = estimateTokensSaved(classification);

  // ── Recovery context (P2.6: 真正有用) ──
  const filteredTodos = filterRecoveryTodos(currentTodos);
  const recentEdits = extractRecentEdits(allEntries);
  const recentFiles = extractRecentFiles(allEntries);
  const keyFindings = extractUsefulFindings(allEntries);
  const openQuestions = allEntries
    .filter(e => e.ok === false)
    .map(e => `[${e.tool}] ${(e.error || e.result || '').slice(0, 120)}`)
    .filter((v, i, a) => a.indexOf(v) === i) // dedup
    .slice(0, 3);

  const doneCount = allEntries.filter(e => e.ok !== false).length;
  const doneRatio = toolHistory.length > 0
    ? `${Math.round((doneCount / toolHistory.length) * 100)}% (${doneCount}/${toolHistory.length})`
    : '-';

  const recoveryContext = {
    goal: currentGoal,
    doneRatio,
    activeTasks: filteredTodos,
    recentEdits,
    recentFiles,
    testResults: session.testsPassed + session.testsFailed > 0
      ? `${session.testsPassed} pass, ${session.testsFailed} fail`
      : null,
    keyFindings,
    openQuestions,
    session,
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

function estimateTokensSaved(classification) {
  let charsSaved = 0;
  for (const item of classification) {
    const text = item.entry?.result || item.entry?.error || '';
    if (item.action === 'DROP') {
      charsSaved += text.length;
    } else if (item.action === 'KEEP_SUMMARY') {
      charsSaved += text.length * 0.9;
    }
  }
  return Math.round(charsSaved / 4);
}

export default {
  name: 'smart_compact',
  category: 'core',
  description: `[compact] Use when: need to analyze tool history and identify which outputs can be safely dropped or summarized to free context budget. Rules-based (zero LLM cost). Returns droppable indices, summarizable entries, recovery context, and estimated token savings.`,
  responsePolicy: { maxLevel: 0 },
      inputSchema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'LLM 寫的 session 摘要：目前在做什麼、進度到哪、下一步。存入 recovery context，compaction 後優先顯示。',
      },
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
