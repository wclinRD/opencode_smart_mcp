// ── Thinking Budget 整合（decompose-budget）──
// 研究來源：DPPM Budget Scheduling (arXiv 2506.02683)、Unsloth Context-Aware (2025)

// ═══════════════════════════════════════════
// H1: Thinking Budget 自動偵測
// ═══════════════════════════════════════════

const BUDGET_LEVELS = {
  quick:    { label: '⚡ Quick',   maxThoughts: 3, maxSteps: 1, maxDepth: 1, detailLevel: 'low',    defaultTemplate: 'analyze' },
  normal:   { label: '📊 Normal',  maxThoughts: 5, maxSteps: 2, maxDepth: 2, detailLevel: 'medium',  defaultTemplate: 'analyze' },
  deep:     { label: '🔬 Deep',    maxThoughts: 8, maxSteps: 3, maxDepth: 3, detailLevel: 'high',    defaultTemplate: 'analyze' },
  research: { label: '📚 Research', maxThoughts: 12, maxSteps: 4, maxDepth: 4, detailLevel: 'full', defaultTemplate: 'research' },
};

const TASK_COMPLEXITY = {
  simple:   { score: 1, budget: 'quick',   patterns: [/^what is/i, /^who is/i, /^when/i, /^where/i] },
  moderate: { score: 2, budget: 'normal',  patterns: [/^how (to|do|can)/i, /^why (does|is|did)/i, /^explain/i] },
  complex:  { score: 3, budget: 'deep',    patterns: [/^debug/i, /^fix/i, /^refactor/i, /^implement/i, /^design/i] },
  research: { score: 4, budget: 'research', patterns: [/^research/i, /^analyze/i, /^compare/i, /^evaluate/i] },
};

/**
 * 根據任務自動偵測合適的 budget 等級
 * @param {string} task — 任務描述
 * @param {object} [options]
 * @param {number} [options.thoughtLength] — 當前思考長度
 * @param {number} [options.confidence] — 信心分數
 * @param {number} [options.roundCount] — 回合數
 * @returns {object} { budget: string, params: object }
 */
export function autoDetectBudget(task, options = {}) {
  const { thoughtLength = 0, confidence = 5, roundCount = 0 } = options;

  // 1) 根據任務內容判斷複雜度
  let bestMatch = { score: 0, budget: 'normal' };
  for (const [level, config] of Object.entries(TASK_COMPLEXITY)) {
    for (const pattern of config.patterns) {
      if (pattern.test(task)) {
        if (config.score > bestMatch.score) {
          bestMatch = { score: config.score, budget: config.budget };
        }
        break;
      }
    }
  }

  // 2) 信心不足時升級 budget
  if (confidence < 4 && bestMatch.score < 3) {
    bestMatch = { score: 3, budget: 'deep' };
  }

  // 3) 思考長 + 多回合 → 升級
  if (thoughtLength > 300 && roundCount >= 2 && bestMatch.score < 3) {
    bestMatch = { score: 3, budget: 'deep' };
  }

  const budget = bestMatch.budget;
  const params = BUDGET_LEVELS[budget] || BUDGET_LEVELS.normal;

  return { budget, params };
}

/**
 * 格式化 Budget 指示條
 * @param {string} budget — 'quick' | 'normal' | 'deep' | 'research'
 * @param {number} [used] — 已使用 thoughts
 * @returns {string}
 */
export function formatBudgetIndicator(budget, used = 0) {
  const level = BUDGET_LEVELS[budget] || BUDGET_LEVELS.normal;
  const max = level.maxThoughts;
  const bars = Math.min(Math.round((used / max) * 10), 10);
  const barStr = '█'.repeat(bars) + '░'.repeat(10 - bars);
  return `Budget ${level.label} [${barStr}] (${used}/${max} thoughts)`;
}

/**
 * 根據 budget 取得 Qwen3.5 參數
 * @param {string} budget
 * @returns {object} { maxTokens, temperature, topP, repetitionPenalty }
 */
export function getQwen3Params(budget) {
  const params = {
    quick:    { maxTokens: 512,  temperature: 0.6, topP: 0.8, repetitionPenalty: 1.0 },
    normal:   { maxTokens: 1024, temperature: 0.7, topP: 0.85, repetitionPenalty: 1.05 },
    deep:     { maxTokens: 2048, temperature: 0.8, topP: 0.9, repetitionPenalty: 1.1 },
    research: { maxTokens: 4096, temperature: 0.85, topP: 0.95, repetitionPenalty: 1.15 },
  };
  return params[budget] || params.normal;
}

// ═══════════════════════════════════════════
// H2: Token/Step 限制
// ═══════════════════════════════════════════

/**
 * 根據 budget 和 task 取得建議的 thinking token 預算
 * @param {string} budget — 'quick' | 'normal' | 'deep' | 'research'
 * @param {string} task
 * @returns {object} { recommendTokens, minTokens, maxTokens }
 */
export function getThinkingTokenBudget(budget, task) {
  const baseTokens = {
    quick:    { recommend: 150,  min: 50,  max: 300 },
    normal:   { recommend: 300,  min: 100, max: 600 },
    deep:     { recommend: 600,  min: 200, max: 1200 },
    research: { recommend: 1000, min: 300, max: 2000 },
  };

  const base = baseTokens[budget] || baseTokens.normal;

  // 任務越長 → 需要更多 token
  const taskLen = (task || '').length;
  const multiplier = Math.max(1, Math.min(2, 1 + (taskLen / 200)));

  return {
    recommendTokens: Math.round(base.recommend * multiplier),
    minTokens: base.min,
    maxTokens: Math.round(base.max * multiplier),
  };
}

// ═══════════════════════════════════════════
// H3: Budget 決策邏輯（Routing Integration）
// ═══════════════════════════════════════════

/**
 * 整合式 budget 決策（供 router 使用）
 * @param {object} context
 * @param {string} context.task
 * @param {number} [context.thoughtLength]
 * @param {number} [context.confidence]
 * @param {number} [context.roundCount]
 * @returns {object} { budget, params, indicator, tokenBudget, strategy }
 */
export function budgetDecision(context) {
  const { task = '', thoughtLength = 0, confidence = 5, roundCount = 0 } = context || {};

  // 1) 自動偵測 budget
  const { budget, params } = autoDetectBudget(task, { thoughtLength, confidence, roundCount });

  // 2) 格式化指示器
  const indicator = formatBudgetIndicator(budget, roundCount);

  // 3) Token 預算
  const tokenBudget = getThinkingTokenBudget(budget, task);

  // 4) 對應的 ADAPT 策略
  const strategy = budget === 'quick' ? 'top-down' :
    budget === 'research' ? 'breadth-first' : 'top-down';

  return { budget, params, indicator, tokenBudget, strategy };
}

// ═══════════════════════════════════════════
// H4: Context Window 壓力計
// ═══════════════════════════════════════════

/**
 * 估算當前 context 壓力
 * @param {number} totalTokens — 已使用的 token 總數
 * @param {number} maxTokens — 最大 context 容量（default: 8192）
 * @returns {object} { pressure, level, recommendAction }
 */
export function contextPressure(totalTokens, maxTokens = 8192) {
  const ratio = totalTokens / maxTokens;

  let level, recommendAction;
  if (ratio < 0.5) {
    level = 'low';
    recommendAction = '正常進行';
  } else if (ratio < 0.7) {
    level = 'medium';
    recommendAction = '考慮壓縮舊輸出';
  } else if (ratio < 0.85) {
    level = 'high';
    recommendAction = '優先壓縮，減少思考深度';
  } else {
    level = 'critical';
    recommendAction = '立即壓縮，切換為 quick budget';
  }

  return {
    pressure: Math.round(ratio * 100),
    level,
    recommendAction,
    bars: '█'.repeat(Math.round(ratio * 10)) + '░'.repeat(10 - Math.round(ratio * 10)),
  };
}
