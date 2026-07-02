// ── Tool Necessity 評分（decompose-necessity）──
// 研究來源：DPPM Tool Scheduling (arXiv 2506.02683)

// ═══════════════════════════════════════════
// O1: Tool Necessity 評分
// ═══════════════════════════════════════════

const TOOL_NECESSITY = {
  'smart_lsp':        { baseScore: 8, patterns: [/definition/i, /type of/i, /reference/i, /symbol/i, /hover/i], reason: 'type-aware analysis' },
  'smart_grep':       { baseScore: 7, patterns: [/find/i, /search/i, /locate/i, /where/i, /pattern/i], reason: 'pattern search' },
  'smart_read':       { baseScore: 6, patterns: [/read/i, /content/i, /show/i, /view/i, /source/i], reason: 'file content' },
  'smart_fast_apply': { baseScore: 8, patterns: [/edit/i, /change/i, /update/i, /modify/i, /replace/i, /fix/i], reason: 'code modification' },
  'smart_edit_chain': { baseScore: 9, patterns: [/batch edit/i, /multiple edit/i, /chain edit/i], reason: 'batch modification' },
  'smart_think':      { baseScore: 5, patterns: [/think/i, /reason/i, /analyze/i, /consider/i], reason: 'reasoning' },
  'smart_test':       { baseScore: 7, patterns: [/test/i, /run test/i, /check test/i], reason: 'test execution' },
  'smart_exa_search': { baseScore: 7, patterns: [/search web/i, /google/i, /research/i, /find online/i], reason: 'web search' },
  'smart_security':   { baseScore: 8, patterns: [/security/i, /vulnerability/i, /credential/i, /leak/i], reason: 'security scan' },
};

/**
 * 計算 subtask 是否需要 tool
 * @param {object} subtask — { id, desc, evidence, tool }
 * @returns {object} { score: number, reason: string, suggestedTool: string|null }
 */
export function calcToolNecessity(subtask) {
  if (!subtask || !subtask.desc) {
    return { score: 0, reason: 'missing description', suggestedTool: null };
  }

  const desc = subtask.desc;
  let bestScore = 0;
  let bestTool = null;
  let bestReason = '';

  for (const [tool, config] of Object.entries(TOOL_NECESSITY)) {
    for (const pattern of config.patterns) {
      if (pattern.test(desc)) {
        if (config.baseScore > bestScore) {
          bestScore = config.baseScore;
          bestTool = tool;
          bestReason = config.reason;
        }
        break;
      }
    }
  }

  // 已有 evidence → 分數降低（可能已不需 tool）
  if (subtask.evidence && subtask.evidence.trim().length > 0) {
    bestScore = Math.max(1, bestScore - 3);
    bestReason = `${bestReason || 'no tool needed'} (already has evidence)`;
  }

  // 已指定 tool → 加分
  if (subtask.tool) {
    bestScore = Math.min(10, bestScore + 2);
    bestReason = `${bestReason || 'explicit tool'} (user-specified: ${subtask.tool})`;
  }

  return {
    score: Math.round(bestScore * 10) / 10,
    reason: bestReason || 'no matching tool pattern',
    suggestedTool: bestTool,
  };
}

/**
 * 批量計算 tool necessity
 * @param {Array} subtasks
 * @returns {Array}
 */
export function calcBatchNecessity(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks.map(s => ({
    ...s,
    necessity: calcToolNecessity(s),
  }));
}

// ═══════════════════════════════════════════
// O2: Tool Selection 建議
// ═══════════════════════════════════════════

/**
 * 根據 necessity 選擇 tool
 * @param {Array} scored — 含 necessity 的 subtasks
 * @param {number} [threshold=5] — 必要性門檻（>= threshold 才建議 tool）
 * @returns {Array} 建議使用 tool 的 subtasks
 */
export function filterNecessaryTools(scored, threshold = 5) {
  if (!Array.isArray(scored)) return [];
  return scored.filter(s => s.necessity && s.necessity.score >= threshold);
}

/**
 * Tool 必要性摘要
 * @param {Array} scored
 * @returns {string}
 */
export function necessitySummary(scored) {
  if (!Array.isArray(scored) || scored.length === 0) return 'no tasks';

  const necessary = scored.filter(s => s.necessity && s.necessity.score >= 5);
  const optional = scored.filter(s => s.necessity && s.necessity.score < 5 && s.necessity.score > 0);
  const none = scored.filter(s => !s.necessity || s.necessity.score === 0);

  const parts = [];
  if (necessary.length > 0) parts.push(`必要工具: ${necessary.map(s => `#${s.id} ${s.necessity.suggestedTool}`).join(', ')}`);
  if (optional.length > 0) parts.push(`可選: ${optional.length} 項`);
  if (none.length > 0) parts.push(`無需工具: ${none.length} 項`);

  return parts.join(' | ');
}

export default {
  calcToolNecessity,
  calcBatchNecessity,
  filterNecessaryTools,
  necessitySummary,
};
