// ── Bug Resilience: Error Handling + Recovery + Fallback（decompose-resilience）──
// 研究來源：DPPM Error Recovery (arXiv 2506.02683)、Self-Correction via Verification

// ═══════════════════════════════════════════
// M1: Error Classification
// ═══════════════════════════════════════════

const ERROR_CATEGORIES = {
  parse: {
    patterns: [/parse error/i, /Unexpected token/i, /JSON\.parse/i, /SyntaxError/i],
    severity: 'high',
    strategy: 'retry-lenient',
  },
  tool: {
    patterns: [/tool.*fail/i, /tool.*error/i, /ECONNREFUSED/i, /ETIMEOUT/i, /timeout/i],
    severity: 'high',
    strategy: 'retry-backoff',
  },
  lsp: {
    patterns: [/LSP.*error/i, /language server/i, /sourcekit-lsp/i, /intelephense/i],
    severity: 'medium',
    strategy: 'degrade-grep',
  },
  auth: {
    patterns: [/unauthorized/i, /401/i, /403/i, /permission denied/i, /access denied/i],
    severity: 'high',
    strategy: 'stop',
  },
  context: {
    patterns: [/context.*overflow/i, /context.*limit/i, /token.*limit/i, /budget/i],
    severity: 'medium',
    strategy: 'compact',
  },
  cycle: {
    patterns: [/cycle detected/i, /infinite loop/i, /too many rounds/i],
    severity: 'medium',
    strategy: 'reset-session',
  },
};

/**
 * 分類錯誤
 * @param {string} errorMessage
 * @returns {object} { category: string, severity: string, strategy: string, matched: boolean }
 */
export function classifyError(errorMessage) {
  if (!errorMessage) {
    return { category: 'unknown', severity: 'low', strategy: 'retry', matched: false };
  }

  for (const [category, config] of Object.entries(ERROR_CATEGORIES)) {
    for (const pattern of config.patterns) {
      if (pattern.test(errorMessage)) {
        return {
          category,
          severity: config.severity,
          strategy: config.strategy,
          matched: true,
        };
      }
    }
  }

  return { category: 'unknown', severity: 'low', strategy: 'retry', matched: false };
}

// ═══════════════════════════════════════════
// M2: Recovery Strategies
// ═══════════════════════════════════════════

/**
 * 根據錯誤分類產生回復策略
 * @param {object} errorInfo — { category, severity, strategy }
 * @param {object} context — { error, retryCount, tool }
 * @returns {object} { action: string, params: object, message: string }
 */
export function recoveryPlan(errorInfo, context = {}) {
  const { category = 'unknown', severity = 'low', strategy = 'retry' } = errorInfo || {};
  const { retryCount = 0, tool = '' } = context || {};

  const plans = {
    'retry-lenient': () => ({
      action: 'retry-lenient',
      params: { useLenientJSON: true },
      message: `對 ${tool} 使用寬鬆 JSON 解析重試`,
    }),
    'retry-backoff': () => ({
      action: 'retry-backoff',
      params: { delay: Math.min(1000 * Math.pow(2, retryCount), 10000), maxRetries: 3 },
      message: `對 ${tool} 使用指數退避重試 (${retryCount + 1}/3)`,
    }),
    'degrade-grep': () => ({
      action: 'degrade',
      params: { fallbackTool: 'smart_grep' },
      message: `LSP 失敗，降級為 smart_grep`,
    }),
    'stop': () => ({
      action: 'stop',
      params: {},
      message: `嚴重錯誤 (${category})，建議停止操作`,
    }),
    'compact': () => ({
      action: 'compact',
      params: { strategy: 'drop-old-outputs' },
      message: `Context 壓力過高，執行壓縮`,
    }),
    'reset-session': () => ({
      action: 'reset-session',
      params: { resetStore: true },
      message: `偵測到循環，重置 session state`,
    }),
    'retry': () => ({
      action: 'retry',
      params: {},
      message: `未知錯誤，簡單重試`,
    }),
  };

  const plan = plans[strategy] || plans.retry;
  return plan();
}

/**
 * 判斷是否應放棄重試
 * @param {number} retryCount
 * @param {number} [maxRetries=3]
 * @returns {boolean}
 */
export function shouldGiveUp(retryCount, maxRetries = 3) {
  return retryCount >= maxRetries;
}

// ═══════════════════════════════════════════
// M3: Fallback Chain
// ═══════════════════════════════════════════

const FALLBACK_CHAINS = {
  'smart_lsp': ['smart_grep', 'smart_read', null],
  'smart_exa_search': ['smart_exa_crawl', 'smart_github_search', null],
  'smart_deep_think': ['smart_think', null, null],
  'smart_fast_apply': ['smart_edit_chain', 'bash sed', null],
};

/**
 * 取得 fallback 工具
 * @param {string} tool
 * @param {number} [level=0] — fallback level
 * @returns {string|null}
 */
export function getFallback(tool, level = 0) {
  const chain = FALLBACK_CHAINS[tool];
  if (!chain) return null;
  return chain[level] || null;
}

/**
 * 執行 fallback 決策
 * @param {string} tool
 * @param {number} retryCount
 * @returns {object} { shouldFallback: boolean, fallbackTool: string|null, level: number }
 */
export function fallbackDecision(tool, retryCount) {
  const level = Math.min(retryCount - 1, 2);
  const fallbackTool = getFallback(tool, level);

  return {
    shouldFallback: retryCount >= 1 && fallbackTool !== null,
    fallbackTool,
    level,
  };
}

// ═══════════════════════════════════════════
// M4: Safe Execution Wrapper
// ═══════════════════════════════════════════

/**
 * 安全執行包裝
 * @param {Function} fn — 要執行的函數
 * @param {object} [options]
 * @param {number} [options.maxRetries=2]
 * @param {string} [options.toolName='']
 * @returns {Promise<{ ok: boolean, result: any, error: string|null, retries: number }>}
 */
export async function safeExecute(fn, options = {}) {
  const { maxRetries = 2, toolName = '' } = options;
  let lastError = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await fn();
      return { ok: true, result, error: null, retries: i };
    } catch (err) {
      lastError = err;
      const errorInfo = classifyError(err.message || String(err));

      if (i < maxRetries) {
        const plan = recoveryPlan(errorInfo, { retryCount: i, tool: toolName });
        // 如果是 stop，直接放棄
        if (plan.action === 'stop') break;
        // 如果是 degrade，換 fallback
        if (plan.action === 'degrade') {
          return { ok: false, result: null, error: `degraded: ${plan.message}`, retries: i + 1 };
        }
      }
    }
  }

  return { ok: false, result: null, error: lastError?.message || 'unknown error', retries: maxRetries };
}

export default {
  classifyError,
  recoveryPlan,
  shouldGiveUp,
  getFallback,
  fallbackDecision,
  safeExecute,
};
