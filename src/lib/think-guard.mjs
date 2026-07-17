/**
 * think-guard.mjs — Thinking Quality Guard
 *
 * Three-layer defense against reasoning errors:
 *   Layer 1: Task classification → auto-suggest thinking mode
 *   Layer 2: Overconfidence detection → force upgrade when CIT under-branches
 *   Layer 3: VERIFY stage enhancement → scope/complementarity/devil's advocate
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
  {
    patterns: [/分析/i, /評析/i, /剖析/i, /analysis/i],
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
export function detectOverconfidence(thought, branchReasoning, branchingNeeded, mode) {
  if (mode !== 'cit' || branchingNeeded === true) {
    return { overconfident: false, reason: '', suggestedUpgrade: null };
  }

  let score = 0;
  const matchedIndicators = [];

  for (const indicator of OVERCONFIDENCE_INDICATORS) {
    const combinedText = `${thought || ''} ${branchReasoning || ''}`;
    if (indicator.pattern.test(combinedText)) {
      score += indicator.weight;
      matchedIndicators.push(indicator.pattern.source.slice(0, 30));
    }
  }

  // Threshold: score >= 3 suggests overconfidence（單一高權重指標或 2 個低權重指標）
  if (score >= 3) {
    return {
      overconfident: true,
      reason: `偵測到過度自信：任務涉及 [${matchedIndicators.join(', ')}]，但 CIT 判定不需要分支。建議升級為 beam mode 進行多路徑探索。`,
      suggestedUpgrade: 'beam',
    };
  }

  return { overconfident: false, reason: '', suggestedUpgrade: null };
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
// Exports
// ---------------------------------------------------------------------------
export default {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
  SCOPE_QUESTIONS,
  COMPLEMENTARITY_CHECKLIST,
  DEVILS_ADVOCATE,
};
