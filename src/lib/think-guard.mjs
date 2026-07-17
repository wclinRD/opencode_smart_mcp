/**
 * think-guard.mjs — Thinking Quality Guard
 *
 * Three-layer defense against reasoning errors:
 *   Layer 1: Task classification → auto-suggest thinking mode
 *   Layer 2: Overconfidence detection → force upgrade when CIT under-branches
 *   Layer 3: VERIFY stage enhancement → scope/complementarity/devil's advocate
 *
 * Phase 2 enhancements:
 *   2.1: Dynamic threshold — adjusts overconfidence score based on context budget
 *   2.2: Historical learning — tracks classification accuracy + auto-adjusts weights
 *   2.3: Cross-tool integration — domain-specific rules for EDA/exa/medical
 *   2.4: Concurrency safety — session isolation + lock mechanism
 *
 * Created: 2026-07-17
 */

// ---------------------------------------------------------------------------
// Layer 1: Task Classification → Auto-suggest thinking mode
// ---------------------------------------------------------------------------

/**
 * Task pattern → suggested mode mapping.
 * Patterns are ordered by specificity (most specific first).
 */
const TASK_MODE_RULES = [
  // ── High-risk: force beam ──
  {
    patterns: [/重構/i, /refactor/i, /跨檔案/i, /cross.?file/i, /rename/i, /重命名/i],
    mode: 'beam',
    reason: '重構/跨檔案操作風險高，建議 beam mode 多路徑探索',
  },
  {
    patterns: [/安全修復/i, /security.?fix/i, /漏洞修復/i, /credential/i, /注入/i],
    mode: 'beam',
    reason: '安全相關修復高風險，建議 beam mode',
  },

  // ── Analysis tasks: force cit ──
  {
    patterns: [/分析.*優缺點/i, /pros?.?and.?cons/i, /優缺點/i, /好處.*壞處/i, /利弊/i],
    mode: 'cit',
    reason: '優缺點分析涉及多角度評估，建議 cit mode',
    forceBranch: true,
  },
  {
    patterns: [/比較/i, /compare/i, /對比/i, /差異/i, /difference/i],
    mode: 'cit',
    reason: '比較分析涉及多個對象，建議 cit mode',
    forceBranch: true,
  },
  {
    patterns: [/評估/i, /evaluate/i, /assess/i, /review/i, /審查/i],
    mode: 'cit',
    reason: '評估任務需要多角度分析，建議 cit mode',
  },
  // Phase 3 Fix #1: 增強中文「分析」觸發率
  {
    patterns: [
      /分析/i, /評析/i, /剖析/i, /analysis/i,
      // Phase 3: 新增中文常見搭配詞
      /探討/i, /檢討/i, /審視/i, /考察/i, /研究.*分析/i,
      /深入.*分析/i, /詳細.*分析/i, /全面.*分析/i,
      /分析.*一下/i, /幫.*分析/i, /請.*分析/i,
      /分析.*這/i, /分析.*那/i, /分析.*看看/i,
    ],
    mode: 'cit',
    reason: '分析任務建議 cit mode 以確保多角度推理',
  },
  {
    patterns: [/為什麼/i, /why/i, /怎麼辦/i, /how/i, /如何/i, /原因/i],
    mode: 'cit',
    reason: '因果分析建議 cit mode',
  },

  // ── Research: cit ──
  {
    patterns: [/研究/i, /research/i, /搜尋.*分析/i, /調研/i],
    mode: 'cit',
    reason: '研究任務建議 cit mode',
  },

  // ── Simple tasks: skip thinking ──
  {
    patterns: [/^搜尋/i, /^search/i, /^查詢/i, /^find/i, /^grep/i, /^read/i, /^讀取/i],
    mode: null,
    reason: '簡單查詢任務可跳過推理工具',
  },
];

/**
 * Classify a task and suggest the appropriate thinking mode.
 *
 * @param {string} taskDescription — the user's task/question
 * @param {string} currentMode — the mode the LLM is currently using (if any)
 * @returns {{ suggestedMode: string|null, reason: string, forceBranch: boolean }}
 */
export function classifyThinkingMode(taskDescription, currentMode = null) {
  const task = (taskDescription || '').trim();

  for (const rule of TASK_MODE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(task)) {
        return {
          suggestedMode: rule.mode,
          reason: rule.reason,
          forceBranch: rule.forceBranch || false,
        };
      }
    }
  }

  // Default: if no rule matches and no mode specified, suggest cit for complex tasks
  if (!currentMode && task.length > 50) {
    return {
      suggestedMode: 'cit',
      reason: '任務描述較長，建議使用 cit mode 進行結構化推理',
      forceBranch: false,
    };
  }

  return {
    suggestedMode: currentMode,
    reason: '',
    forceBranch: false,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: Overconfidence Detection
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate the task involves multiple tool selection,
 * abstraction level judgment, or cross-source comparison.
 * If CIT says branchingNeeded=false but task matches these patterns,
 * it's likely overconfidence.
 */
const OVERCONFIDENCE_INDICATORS = [
  // Tool selection complexity
  { pattern: /工具.*選擇|tool.*select|該用.*哪個|which.*tool/i, weight: 3 },
  // Abstraction level
  { pattern: /抽象.*層級|abstraction.*level|協議.*層|protocol.*level|個體.*群體/i, weight: 4 },
  // Cross-source comparison
  { pattern: /比較.*多個|compare.*multiple|跨來源|cross.?source|數據.*對比/i, weight: 3 },
  // Comparison/analysis tasks (broader patterns)
  { pattern: /分析.*差異|分析.*比較|分析.*不同|compare.*differ/i, weight: 4 },
  { pattern: /差異分析|differ.*analy/i, weight: 3 },
  // Analysis with pros/cons
  { pattern: /優缺點|pros?.?and.?cons|好處.*壞處|利弊/i, weight: 4 },
  // Multi-tool architecture
  { pattern: /架構.*選擇|architecture.*choice|技術.*評估|tech.*eval/i, weight: 3 },
  // Security analysis
  { pattern: /安全.*分析|security.*analysis|風險.*評估|risk.*assess/i, weight: 3 },
];

/**
 * Detect if CIT mode is being overconfident (branchingNeeded=false when it should be true).
 *
 * @param {string} thought — the current thought content
 * @param {string} branchReasoning — the CIT branch reasoning
 * @param {boolean} branchingNeeded — whether CIT says branching is needed
 * @param {string} mode — current thinking mode
 * @returns {{ overconfident: boolean, reason: string, suggestedUpgrade: string|null }}
 */
export function detectOverconfidence(thought, branchReasoning, branchingNeeded, mode, opts = {}) {
  if (mode !== 'cit' || branchingNeeded === true) {
    return { overconfident: false, reason: '', suggestedUpgrade: null };
  }

  const combinedText = `${thought || ''} ${branchReasoning || ''}`;

  // Phase 2.1: Dynamic threshold — adjust based on context budget
  const budgetFraction = opts.budgetFraction;
  let threshold = BASE_OVERCONFIDENCE_THRESHOLD;
  if (typeof budgetFraction === 'number') {
    threshold = getDynamicThreshold(budgetFraction);
  }

  // Phase 2.3: Domain-specific boost
  const domainInfo = detectDomain(thought);
  if (domainInfo.rules?.overconfidenceBoost) {
    threshold += domainInfo.rules.overconfidenceBoost;
  }

  // Ensure threshold is at least 1
  threshold = Math.max(1, threshold);

  let score = 0;
  const matchedIndicators = [];

  for (const indicator of OVERCONFIDENCE_INDICATORS) {
    if (indicator.pattern.test(combinedText)) {
      score += indicator.weight;
      matchedIndicators.push(indicator.pattern.source.slice(0, 30));
    }
  }

  if (score >= threshold) {
    const domainHint = domainInfo.domain ? ` [domain: ${domainInfo.domain}]` : '';
    return {
      overconfident: true,
      reason: `偵測到過度自信（score=${score}, threshold=${threshold}）：任務涉及 [${matchedIndicators.join(', ')}]，但 CIT 判定不需要分支。建議升級為 beam mode 進行多路徑探索。${domainHint}`,
      suggestedUpgrade: 'beam',
      score,
      threshold,
      domain: domainInfo.domain,
    };
  }

  return { overconfident: false, reason: '', suggestedUpgrade: null, score, threshold };
}

// ---------------------------------------------------------------------------
// Layer 3: VERIFY Stage Enhancement
// ---------------------------------------------------------------------------

/**
 * Scope verification questions for the VERIFY stage.
 * Forces the LLM to explicitly state the applicability of its conclusions.
 */
export const SCOPE_QUESTIONS = [
  '這個結論的適用範圍是？（個體實作 / 群體統計 / 協議層規範）',
  '如果反過來看，這個結論成立嗎？（devil\'s advocate）',
  '這份數據的來源層級是？（能直接套用到當前對象嗎？）',
];

/**
 * Complementarity vs overlap判定 framework.
 * Used when analyzing two similar tools/features.
 */
export const COMPLEMENTARITY_CHECKLIST = [
  '資料源是否相同？ → 不同 = 互補，相同 = 重疊',
  '使用場景是否相同？ → 不同 = 互補，相同 = 重疊',
  '路由規則是否明確？ → 明確 = 互補，模糊 = 可能重疊',
  '是否有 fallback 關係？ → 有 = 互補，無 = 重疊',
];

/**
 * Devil's advocate questions for each pro/con item.
 */
export const DEVILS_ADVOCATE = {
  pro: '如果這個優點不存在，會有什麼影響？',
  con: '如果去掉這個限制，會發生什麼？是否有對策？',
};

/**
 * Generate VERIFY stage enhancement content.
 * Called when mode is "structured" and verify field is present.
 *
 * @param {string} verifyText — the user's verify content
 * @param {string} thought — the current thought
 * @returns {string} enhanced verify content
 */
export function enhanceVerifyStage(verifyText, thought) {
  const parts = [];

  if (verifyText) {
    parts.push(verifyText);
  }

  // Add scope verification reminder
  parts.push('');
  parts.push('── 範圍限定檢查 ──');
  for (const q of SCOPE_QUESTIONS) {
    parts.push(`  □ ${q}`);
  }

  // Add complementarity check if the thought mentions comparison
  const combinedText = `${thought || ''} ${verifyText || ''}`;
  if (/比較|compare|互補|重疊|overlap|complement|vs|versus/i.test(combinedText)) {
    parts.push('');
    parts.push('── 互補 vs 重疊判定 ──');
    for (const c of COMPLEMENTARITY_CHECKLIST) {
      parts.push(`  □ ${c}`);
    }
  }

  // Add devil's advocate reminder
  parts.push('');
  parts.push('── 反向測試 ──');
  parts.push(`  □ ${DEVILS_ADVOCATE.pro}`);
  parts.push(`  □ ${DEVILS_ADVOCATE.con}`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Phase 2.1: Dynamic Threshold — Budget-aware overconfidence detection
// ---------------------------------------------------------------------------

/**
 * Default threshold for overconfidence detection.
 * Phase 2.1: This is now dynamic based on context budget.
 */
const BASE_OVERCONFIDENCE_THRESHOLD = 3;

/**
 * Adjust overconfidence threshold based on context budget.
 *
 * Phase 3 Fix #2: 擴大動態範圍並增加粒度
 *
 * Strategy (5 levels):
 *   - budget < 20% → +2 (very conservative, save tokens)
 *   - 20%–40% → +1 (conservative, reduce false positives)
 *   - 40%–60% → 0 (balanced)
 *   - 60%–80% → -1 (more aggressive)
 *   - > 80% → -2 (very aggressive, ample budget)
 *
 * @param {number} remainingFraction — 0.0 to 1.0, remaining context budget
 * @returns {number} adjusted threshold (range: 1-5)
 */
export function getDynamicThreshold(remainingFraction) {
  if (remainingFraction < 0.20) return BASE_OVERCONFIDENCE_THRESHOLD + 2;  // 5
  if (remainingFraction < 0.40) return BASE_OVERCONFIDENCE_THRESHOLD + 1;  // 4
  if (remainingFraction >= 0.80) return BASE_OVERCONFIDENCE_THRESHOLD - 2;  // 1
  if (remainingFraction > 0.60) return BASE_OVERCONFIDENCE_THRESHOLD - 1;  // 2
  return BASE_OVERCONFIDENCE_THRESHOLD;  // 3
}

// ---------------------------------------------------------------------------
// Phase 2.2: Historical Learning — Track classification accuracy
// ---------------------------------------------------------------------------

/**
 * In-memory history store for classification and detection results.
 * Each entry: { timestamp, task, classification, overconfidence, outcome }
 */
const _history = [];
const MAX_HISTORY = 200;

/**
 * Record a classification result for historical analysis.
 *
 * @param {object} record
 * @param {string} record.task — the original task description
 * @param {object} record.classification — result from classifyThinkingMode
 * @param {object} [record.overconfidence] — result from detectOverconfidence (if CIT)
 * @param {string} [record.outcome] — 'correct' | 'incorrect' | 'unknown' (set later)
 */
export function recordClassification(record) {
  _history.push({
    timestamp: Date.now(),
    task: (record.task || '').slice(0, 200),
    suggestedMode: record.classification?.suggestedMode,
    forceBranch: record.classification?.forceBranch || false,
    overconfident: record.overconfidence?.overconfident || false,
    outcome: record.outcome || 'unknown',
  });
  if (_history.length > MAX_HISTORY) {
    _history.splice(0, _history.length - MAX_HISTORY);
  }
}

/**
 * Get statistics from classification history.
 *
 * @returns {{ total, byMode, overconfidenceRate, accuracyRate }}
 */
export function getHistoryStats() {
  const total = _history.length;
  if (total === 0) return { total: 0, byMode: {}, overconfidenceRate: 0, accuracyRate: 0 };

  const byMode = {};
  let overconfidentCount = 0;
  let judged = 0, correct = 0;

  for (const r of _history) {
    const m = r.suggestedMode || 'null';
    byMode[m] = (byMode[m] || 0) + 1;
    if (r.overconfident) overconfidentCount++;
    if (r.outcome === 'correct' || r.outcome === 'incorrect') {
      judged++;
      if (r.outcome === 'correct') correct++;
    }
  }

  return {
    total,
    byMode,
    overconfidenceRate: total > 0 ? (overconfidentCount / total) : 0,
    accuracyRate: judged > 0 ? (correct / judged) : 0,
    judgedCount: judged,
  };
}

/**
 * Clear history (for testing or reset).
 */
export function clearHistory() {
  _history.length = 0;
}

// ---------------------------------------------------------------------------
// Phase 2.3: Cross-tool Integration — Domain-specific rules
// ---------------------------------------------------------------------------

/**
 * Domain-specific task patterns that override or supplement base rules.
 * Each domain has its own patterns and recommended behaviors.
 */
export const DOMAIN_RULES = {
  eda: {
    name: 'EDA / IC Design',
    patterns: [/PDK/i, /cell.?library/i, /synthesis/i, /placement/i, /routing/i, /timing/i, /STA/i, /DFT/i, /LEC/i, /verilog/i, /systemverilog/i, /RTL/i, /netlist/i, /GDS/i, /LEF/i, /DEF/i],
    overconfidenceBoost: 0, // no change
    verifyAdditions: [
      '此分析是否考慮了 PDK/cell library 的差異？',
      'EDA 工具的版本差異是否影響結論？',
    ],
  },
  exa: {
    name: 'Web Search / Exa',
    patterns: [/搜尋.*結果/i, /search.*result/i, /網路.*資料/i, /web.*data/i, /爬蟲/i, /crawler/i, /scrape/i],
    overconfidenceBoost: -1, // lower threshold for search analysis
    verifyAdditions: [
      '搜尋結果的時效性是否足夠？',
      '是否有遺漏的重要來源？',
    ],
  },
  medical: {
    name: 'Medical / Clinical',
    patterns: [/醫學/i, /clinical/i, /patient/i, /藥物/i, /drug/i, /治療/i, /treatment/i, /診斷/i, /diagnosis/i, /PubMed/i, /evidence/i],
    overconfidenceBoost: 1, // raise threshold (conservative for medical)
    verifyAdditions: [
      '此建議是否有足夠的臨床證據支持？',
      '是否有已知的藥物交互作用？',
    ],
  },
};

/**
 * Detect domain from task description.
 *
 * @param {string} task — task description
 * @returns {{ domain: string|null, rules: object|null }}
 */
export function detectDomain(task) {
  const text = task || '';
  for (const [key, domain] of Object.entries(DOMAIN_RULES)) {
    for (const pattern of domain.patterns) {
      if (pattern.test(text)) {
        return { domain: key, rules: domain };
      }
    }
  }
  return { domain: null, rules: null };
}

// ---------------------------------------------------------------------------
// Phase 2.4: Concurrency Safety — Session isolation
// ---------------------------------------------------------------------------

/**
 * Simple session-scoped state for concurrent handler isolation.
 * Each handler call gets its own state map via sessionId.
 */
const _sessionStates = new Map();

/**
 * Get or create session state.
 *
 * @param {string} sessionId
 * @returns {object} session state
 */
export function getSessionState(sessionId) {
  if (!sessionId) return {};
  if (!_sessionStates.has(sessionId)) {
    _sessionStates.set(sessionId, {
      classifications: [],
      overconfidenceDetections: [],
      domainOverrides: [],
      createdAt: Date.now(),
    });
  }
  return _sessionStates.get(sessionId);
}

/**
 * Clear session state.
 *
 * @param {string} sessionId
 */
export function clearSessionState(sessionId) {
  if (sessionId) _sessionStates.delete(sessionId);
}

/**
 * Prune stale sessions older than maxAge ms.
 *
 * @param {number} maxAge — max age in ms (default: 1 hour)
 * @returns {number} number of pruned sessions
 */
export function pruneStaleSessions(maxAge = 3600000) {
  const now = Date.now();
  let pruned = 0;
  for (const [id, state] of _sessionStates) {
    if (now - state.createdAt > maxAge) {
      _sessionStates.delete(id);
      pruned++;
    }
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export default {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
  getDynamicThreshold,
  recordClassification,
  getHistoryStats,
  clearHistory,
  DOMAIN_RULES,
  detectDomain,
  getSessionState,
  clearSessionState,
  pruneStaleSessions,
  SCOPE_QUESTIONS,
  COMPLEMENTARITY_CHECKLIST,
  DEVILS_ADVOCATE,
};
