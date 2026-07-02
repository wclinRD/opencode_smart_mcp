// ── Semantic Signal 引擎（decompose-semantic）──
// 研究來源：Semantic Signal Hypothesis (Li et al. 2024)、DPPM Context Signals

// ═══════════════════════════════════════════
// L1: Signal 定義
// ═══════════════════════════════════════════

const SIGNAL_PATTERNS = {
  uncertainty: {
    patterns: [/不確定/i, /maybe/i, /probably/i, /might/i, /could be/i, /應該/i, /可能/i, /perhaps/i],
    weight: 0.8,
    label: '不確定性',
  },
  confidence: {
    patterns: [/definitely/i, /certainly/i, /clearly/i, /毋庸置疑/i, /確定/i, /肯定/i],
    weight: 0.9,
    label: '高信心',
  },
  contradiction: {
    patterns: [/but (on the other|however|nevertheless)/i, /然而/i, /但(是)? /, /however/i],
    weight: 0.7,
    label: '矛盾',
  },
  exploration: {
    patterns: [/consider|explore|investigate|what if|could there|perhaps we/i],
    weight: 0.6,
    label: '探索中',
  },
  conclusion: {
    patterns: [/therefore|thus|hence|conclude|in summary|so the|所以/i],
    weight: 0.7,
    label: '結論',
  },
  error: {
    patterns: [/error|failed|bug|crash|issue|problem|錯誤|失敗|問題/i],
    weight: 0.8,
    label: '錯誤',
  },
  question: {
    patterns: [/\?$/m],
    weight: 0.5,
    label: '提問',
  },
  tool_intent: {
    patterns: [/should (use|call|run|try)/i, /need to (search|find|check|read)/i, /let me/i],
    weight: 0.6,
    label: '工具意圖',
  },
};

// ═══════════════════════════════════════════
// L2: Signal 偵測
// ═══════════════════════════════════════════

/**
 * 從 thought 中偵測語意訊號
 * @param {string} thought
 * @param {object} [options]
 * @param {Array} [options.signals] — 要偵測的訊號列表（預設全部）
 * @returns {object} { signals: Array, summary: string, topSignal: string|null }
 */
export function detectSemanticSignals(thought, options = {}) {
  if (!thought || typeof thought !== 'string') {
    return { signals: [], summary: 'empty', topSignal: null };
  }

  const { signals: signalNames } = options;
  const activeSignals = signalNames
    ? Object.fromEntries(Object.entries(SIGNAL_PATTERNS).filter(([k]) => signalNames.includes(k)))
    : SIGNAL_PATTERNS;

  const detected = [];

  for (const [key, config] of Object.entries(activeSignals)) {
    const matches = [];
    for (const pattern of config.patterns) {
      if (pattern.test(thought)) {
        matches.push(pattern.source);
      }
    }
    if (matches.length > 0) {
      detected.push({
        type: key,
        label: config.label,
        weight: config.weight,
        matchCount: matches.length,
        matchedPatterns: matches.slice(0, 3),
      });
    }
  }

  // 排序：matchCount * weight（越多次匹配且權重越高）
  detected.sort((a, b) => (b.matchCount * b.weight) - (a.matchCount * a.weight));

  const topSignal = detected.length > 0 ? detected[0].type : null;

  return {
    signals: detected,
    summary: detected.length > 0
      ? detected.map(s => `${s.label}(${s.matchCount})`).join(', ')
      : 'no signals',
    topSignal,
  };
}

/**
 * 根據訊號產生建議
 * @param {Array} signals
 * @returns {Array<string>}
 */
export function signalRecommendations(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return [];

  const recs = [];

  for (const s of signals) {
    switch (s.type) {
      case 'uncertainty':
        recs.push('考慮分解任務或搜集更多證據');
        break;
      case 'contradiction':
        recs.push('檢查矛盾點並驗證假設');
        break;
      case 'exploration':
        recs.push('收斂探索方向，選擇最可行路徑');
        break;
      case 'error':
        recs.push('錯誤訊號 — 建議執行 debug 流程');
        break;
      case 'tool_intent':
        recs.push('工具意圖明確 — 建議產生 tool call');
        break;
      case 'question':
        recs.push('包含提問 — 確認是否需要外部資訊');
        break;
    }
  }

  return recs;
}

// ═══════════════════════════════════════════
// L3: 整合 Signal 摘要
// ═══════════════════════════════════════════

/**
 * 完整語意分析（整合 signal + 建議）
 * @param {string} thought
 * @returns {object} { signals, recommendations, topSignal, summary }
 */
export function semanticAnalysis(thought) {
  const { signals, summary, topSignal } = detectSemanticSignals(thought);
  const recommendations = signalRecommendations(signals);

  return { signals, recommendations, topSignal, summary };
}

export default {
  detectSemanticSignals,
  signalRecommendations,
  semanticAnalysis,
  SIGNAL_PATTERNS,
};
