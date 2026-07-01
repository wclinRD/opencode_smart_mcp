// ── ADAPT 自適應分解（decompose-adapt）──
// 研究來源：ADAPT (arXiv 2503.17507)、DPPM (arXiv 2506.02683)

// ═══════════════════════════════════════════
// G1: 自適應分解核心
// ═══════════════════════════════════════════

/**
 * ADAPT 自適應分解決策
 * @param {object} context
 * @param {string} context.thought — 當前思考內容
 * @param {number} context.thoughtLength — 思考長度（tokens）
 * @param {string} context.currentTask — 當前任務描述
 * @param {number} context.confidence — 當前信心分數 (0-10)
 * @param {boolean} context.hasResult — 是否已有結果
 * @param {number} context.roundCount — 當前回合數
 * @param {number} context.maxDepth — 最大深度
 * @returns {object} { shouldDecompose: boolean, reason: string, priority: number }
 */
export function adaptCheckTrigger(context) {
  const {
    thought = '',
    thoughtLength = 0,
    currentTask = '',
    confidence = 5,
    hasResult = false,
    roundCount = 0,
    maxDepth = 3,
  } = context || {};

  // 超過最大深度 → 不分解
  if (roundCount >= maxDepth) {
    return { shouldDecompose: false, reason: '超過最大深度', priority: 0 };
  }

  const triggers = [];

  // T1: 思考過短（<30 tokens）表示未深入思考
  if (thoughtLength < 30 && roundCount > 0) {
    triggers.push({ reason: '思考過短', priority: 8 });
  }

  // T2: 思考過長（>300 tokens）可能有複合問題需分解
  if (thoughtLength > 300) {
    triggers.push({ reason: '思考過長，含複合問題', priority: 6 });
  }

  // T3: 信心不足（<4/10）
  if (confidence < 4) {
    triggers.push({ reason: '信心不足', priority: 9 });
  }

  // T4: 無結果但已思考多回合
  if (!hasResult && roundCount >= 2) {
    triggers.push({ reason: '無結果，需重新分解', priority: 7 });
  }

  // T5: 任務包含多個動詞/連詞（and/並且/同時）
  const taskMultiPart = (currentTask.match(/(and|並且|同時|、|，)/gi) || []).length;
  if (taskMultiPart >= 2) {
    triggers.push({ reason: '任務含多個子任務', priority: 5 });
  }

  if (triggers.length === 0) {
    return { shouldDecompose: false, reason: '無需分解', priority: 0 };
  }

  // 取最高優先級
  triggers.sort((a, b) => b.priority - a.priority);
  return { shouldDecompose: true, reason: triggers[0].reason, priority: triggers[0].priority };
}

// ═══════════════════════════════════════════
// G2: 深度限制
// ═══════════════════════════════════════════

/**
 * 檢查 ADAPT 最大深度
 * @param {number} currentDepth
 * @param {number} maxDepth
 * @returns {boolean}
 */
export function adaptMaxDepthCheck(currentDepth, maxDepth = 3) {
  return currentDepth < maxDepth;
}

/**
 * 建議的子步驟數量
 * @param {number} thoughtLength
 * @returns {number} 建議子步驟數 (2-6)
 */
export function adaptStepCount(thoughtLength) {
  if (thoughtLength < 50) return 2;
  if (thoughtLength < 150) return 3;
  if (thoughtLength < 300) return 4;
  if (thoughtLength < 500) return 5;
  return 6;
}

// ═══════════════════════════════════════════
// G3: 分解策略
// ═══════════════════════════════════════════

/**
 * ADAPT 分解策略選擇
 * @param {object} context
 * @returns {string} 策略名稱
 */
export function adaptChooseStrategy(context) {
  const {
    taskType = 'general',
    confidence = 5,
    hasResult = false,
  } = context || {};

  // Task type based
  const strategyMap = {
    debug: 'trace-backward',
    refactor: 'modularize',
    research: 'breadth-first',
    decision: 'compare-contrast',
    feature: 'top-down',
  };

  if (strategyMap[taskType]) return strategyMap[taskType];

  // Default: confidence-based
  if (confidence < 3) return 'breadth-first';
  if (confidence < 6) return 'top-down';
  if (!hasResult) return 'trace-forward';
  return 'top-down';
}

/**
 * 根據策略產生子步驟提示
 * @param {string} strategy
 * @param {string} task
 * @returns {Array<string>} 子步驟提示陣列
 */
export function adaptGenerateSubSteps(strategy, task) {
  const strategies = {
    'trace-backward': [
      `確定 ${task} 的預期行為`,
      `找出實際行為與預期的差異`,
      `追溯差異的來源路徑`,
      `驗證 root cause 假設`,
    ],
    'modularize': [
      `分析 ${task} 的職責邊界`,
      `提取可複用元件`,
      `重組依賴關係`,
      `驗證重構後行為不變`,
    ],
    'breadth-first': [
      `搜集 ${task} 的相關資訊`,
      `列舉所有可能方向`,
      `初步評估各方向可行性`,
      `選擇最具潛力的路徑`,
    ],
    'compare-contrast': [
      `列出 ${task} 的候選方案`,
      `比較各方案的優缺點`,
      `評估權衡與風險`,
      `做出決定並說明理由`,
    ],
    'top-down': [
      `定義 ${task} 的高層目標`,
      `拆解為可執行子任務`,
      `依序實作各子任務`,
      `整合並驗證完整性`,
    ],
    'trace-forward': [
      `從已知起點：${task}`,
      `逐步推進每一步`,
      `在關鍵節點驗證進展`,
      `收斂到最終結論`,
    ],
  };

  return strategies[strategy] || strategies['top-down'];
}

// ═══════════════════════════════════════════
// G4: 分解上下文
// ═══════════════════════════════════════════

/**
 * 產生分解上下文提示
 * @param {object} context
 * @returns {string}
 */
export function adaptBuildContext(context) {
  const {
    strategy = 'top-down',
    task = '',
    confidence = 5,
    errorHint = '',
    previousEvidence = '',
  } = context || {};

  const parts = [];
  parts.push(`📋 當前任務：${task || '未指定'}`);
  parts.push(`🎯 分解策略：${strategy}`);
  parts.push(`📊 當前信心：${'█'.repeat(Math.round(confidence))}${'░'.repeat(10 - Math.round(confidence))} (${confidence}/10)`);

  if (errorHint) parts.push(`⚠️ 提示：${errorHint}`);
  if (previousEvidence) parts.push(`📝 已知資訊：${previousEvidence}`);

  return parts.join('\n');
}

/**
 * ADAPT 回合摘要
 * @param {number} depth
 * @param {string} strategy
 * @param {Array} subSteps
 * @param {number} priority
 * @returns {string}
 */
export function adaptSessionSummary(depth, strategy, subSteps, priority) {
  const lines = [];
  lines.push(`┌─ ADAPT 回合 #${depth} ───────────`);
  lines.push(`│ 策略：${strategy}（優先級：${priority}）`);
  lines.push(`│ 子步驟：`);
  for (const step of subSteps) {
    lines.push(`│   • ${step}`);
  }
  lines.push(`└──────────────────────────────`);
  return lines.join('\n');
}
