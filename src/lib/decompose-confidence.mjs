// ── 信心評分與驗證循環（decompose-confidence）──
// 研究來源：DPPM (arXiv 2506.02683)、Self-Correction via Verification (Wang et al. 2024)

// ═══════════════════════════════════════════
// I1: 信心評分計算
// ═══════════════════════════════════════════

/**
 * 信心分數計算
 * @param {object} signals
 * @param {number} [signals.thoughtLength] — 思考長度
 * @param {number} [signals.roundCount] — 已執行回合數
 * @param {boolean} [signals.hasResult] — 是否有結果
 * @param {number} [signals.resultConsistency] — 結果一致性 (0-10)
 * @param {number} [signals.toolSuccessRate] — 工具成功率 (0-10)
 * @param {number} [signals.crossValidation] — 交叉驗證分數 (0-10)
 * @returns {object} { score: number, factors: Array<{name, weight, value, contribution}> }
 */
export function calcConfidenceScore(signals) {
  const {
    thoughtLength = 0,
    roundCount = 0,
    hasResult = false,
    resultConsistency = 5,
    toolSuccessRate = 5,
    crossValidation = 0,
  } = signals || {};

  const factors = [];

  // F1: 思考深度（太短 = 低信心，太長 = 可能有問題）
  let depthScore = 5;
  if (thoughtLength < 20) depthScore = 2;
  else if (thoughtLength < 50) depthScore = 4;
  else if (thoughtLength < 150) depthScore = 6;
  else if (thoughtLength < 300) depthScore = 8;
  else if (thoughtLength < 500) depthScore = 7;
  else depthScore = 5; // >500, 可能陷入過度思考

  factors.push({ name: '思考深度', weight: 0.15, value: thoughtLength, contribution: depthScore });

  // F2: 回合數適中（太少=淺，太多=循環）
  let roundScore = 5;
  if (roundCount === 0) roundScore = 3;
  else if (roundCount <= 2) roundScore = 5;
  else if (roundCount <= 5) roundScore = 7;
  else if (roundCount <= 8) roundScore = 6;
  else roundScore = 4; // 太多回合，可能循環

  factors.push({ name: '回合適中', weight: 0.10, value: roundCount, contribution: roundScore });

  // F3: 是否有結果
  const resultScore = hasResult ? 8 : 2;
  factors.push({ name: '結果存在', weight: 0.20, value: hasResult ? 1 : 0, contribution: resultScore });

  // F4: 結果一致性
  factors.push({ name: '結果一致', weight: 0.25, value: resultConsistency, contribution: resultConsistency });

  // F5: 工具成功率
  factors.push({ name: '工具成功', weight: 0.15, value: toolSuccessRate, contribution: toolSuccessRate });

  // F6: 交叉驗證
  factors.push({ name: '交叉驗證', weight: 0.15, value: crossValidation, contribution: crossValidation || 0 });

  // 加權平均
  let score = 0;
  for (const f of factors) {
    score += f.contribution * f.weight;
  }

  // 限於 0-10
  score = Math.max(0, Math.min(10, score));

  return { score: Math.round(score * 10) / 10, factors };
}

// ═══════════════════════════════════════════
// I2: 驗證循環（single-node）
// ═══════════════════════════════════════════

/**
 * 驗證單一節點
 * @param {object} node — { id, desc, evidence, tool?, toolArgs? }
 * @param {object} context — { thought, doneIds, toolResults }
 * @returns {object} { verified: boolean, score: number, issues: string[] }
 */
export function validateNode(node, context) {
  const issues = [];
  const { thought = '', doneIds = [], toolResults = [] } = context || {};

  // V1: 有 evidence？
  if (!node.evidence || node.evidence.trim().length === 0) {
    issues.push('缺少 evidence');
  }

  // V2: 描述包含具體 action？
  const vagueActions = ['研究', '思考', '了解', 'check', 'fix', 'do'];
  const desc = node.desc || '';
  let vagueCount = 0;
  for (const va of vagueActions) {
    if (desc.includes(va)) vagueCount++;
  }
  if (vagueCount >= 2) {
    issues.push(`描述模糊（含 ${vagueCount} 個模糊動詞）`);
  }

  // V3: 有 tool 但未完全執行？
  if (node.tool && !toolResults.some(r => r.nodeId === node.id)) {
    issues.push(`建議工具 ${node.tool} 尚未執行`);
  }

  // V4: deps 都完成了？
  if (Array.isArray(node.deps) && node.deps.length > 0) {
    const missingDeps = node.deps.filter(d => !doneIds.includes(d));
    if (missingDeps.length > 0) {
      issues.push(`依賴節點 ${missingDeps.join(', ')} 尚未完成`);
    }
  }

  // V5: thought 包含不確定性？
  const uncertainWords = ['不確定', 'maybe', 'probably', 'might', 'could be', '應該', '可能'];
  const foundUncertain = uncertainWords.filter(w => thought.toLowerCase().includes(w));
  if (foundUncertain.length > 0) {
    issues.push(`思考含不確定性：${foundUncertain.join(', ')}`);
  }

  // 給分
  const maxScore = 10;
  const deduction = Math.min(issues.length * 2.5, 8);
  const score = Math.max(1, maxScore - deduction);

  return {
    verified: issues.length <= 1,
    score: Math.round(score * 10) / 10,
    issues,
  };
}

// ═══════════════════════════════════════════
// I3: 信心指示條（UI）
// ═══════════════════════════════════════════

/**
 * 格式化信心指示條
 * @param {number} score — 0-10
 * @returns {string}
 */
export function formatConfidenceBar(score) {
  const clamped = Math.max(0, Math.min(10, score));
  const filled = Math.round(clamped);
  const empty = 10 - filled;

  let icon;
  if (clamped >= 8) icon = '🟢';
  else if (clamped >= 5) icon = '🟡';
  else icon = '🔴';

  return `${icon} [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${clamped.toFixed(1)}/10`;
}

// ═══════════════════════════════════════════
// I4: 驗證循環整合
// ═══════════════════════════════════════════

/**
 * 完整驗證循環
 * @param {Array} dagNodes — DAG 節點陣列
 * @param {object} context — 上下文 { thought, doneIds, toolResults }
 * @returns {object} { results: Array, summary, shouldReThink: boolean }
 */
export function validateCycle(dagNodes, context) {
  if (!Array.isArray(dagNodes) || dagNodes.length === 0) {
    return { results: [], summary: null, shouldReThink: false };
  }

  const { doneIds = [] } = context || {};

  // 只驗證已完成及進行中的節點
  const activeNodes = dagNodes.filter(n =>
    doneIds.includes(n.id) || n.status === 'in_progress'
  );

  const results = activeNodes.map(node => {
    const result = validateNode(node, context);
    return { nodeId: node.id, desc: node.desc, ...result };
  });

  // 計算整體分數
  const verifiedCount = results.filter(r => r.verified).length;
  const totalActive = results.length;
  const overallScore = totalActive > 0
    ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / totalActive) * 10) / 10
    : 0;
  const coverage = totalActive > 0 ? Math.round((verifiedCount / totalActive) * 100) : 0;

  const summary = {
    overallScore,
    coverage,
    verifiedCount,
    totalActive,
    bar: formatConfidenceBar(overallScore),
  };

  // 是否需重新思考
  const shouldReThink = overallScore < 5 || coverage < 50;

  return { results, summary, shouldReThink };
}

// ═══════════════════════════════════════════
// I5: 自我修正建議
// ═══════════════════════════════════════════

/**
 * 根據驗證結果產生自我修正建議
 * @param {Array} validationResults
 * @returns {Array<string>} 建議列表
 */
export function generateFixSuggestions(validationResults) {
  if (!Array.isArray(validationResults)) return [];

  const suggestions = [];

  for (const result of validationResults) {
    if (result.verified) continue;

    for (const issue of result.issues) {
      if (issue.startsWith('缺少 evidence')) {
        suggestions.push(`節點 ${result.nodeId}: 補上 evidence — 說明執行結果或發現`);
      } else if (issue.includes('模糊')) {
        suggestions.push(`節點 ${result.nodeId}: 用具體可驗證的描述替換模糊動詞`);
      } else if (issue.includes('尚未執行')) {
        suggestions.push(`節點 ${result.nodeId}: 執行建議工具，或移除不必要的工具建議`);
      } else if (issue.includes('不確定性')) {
        suggestions.push(`節點 ${result.nodeId}: 重新確認不確定的部分，補強證據`);
      } else if (issue.includes('尚未完成')) {
        suggestions.push(`節點 ${result.nodeId}: 等待依賴節點完成後再驗證`);
      }
    }
  }

  return [...new Set(suggestions)]; // 去重
}
