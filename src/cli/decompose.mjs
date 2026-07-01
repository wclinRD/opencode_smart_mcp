// ── smart_decompose 核心邏輯 ──
// 強制任務分解 + 結構化輸出 + 工具引導 + 循環檢測

import {
  formatProgressBar,
  formatGoalHeader,
  formatSubtaskList,
  cosineSimilarity,
} from '../lib/think-utils.mjs';

// ── Session store（循環檢測用）──
// Map<sessionId, Map<subtaskId, Array<{thought, timestamp}>>>
const sessionStore = new Map();

// ── Threshold 對照 ──
const CYCLE_THRESHOLDS = { high: 2, medium: 3, low: 5 };
const BUDGET_THRESHOLDS = {
  high:  { critical: 0.20, warn: 0.40 },
  medium: { critical: 0.15, warn: 0.30 },
  low:   { critical: 0.10, warn: 0.20 },
};

// ═══════════════════════════════════════════
// C2: 參數驗證
// ═══════════════════════════════════════════

function validateArgs(args) {
  const errors = [];
  if (!args.goal || String(args.goal).trim().length === 0) {
    errors.push('goal is required');
  }
  if (!Array.isArray(args.subtasks) || args.subtasks.length === 0) {
    errors.push('subtasks must have at least 1 item');
  }
  if (Array.isArray(args.subtasks) && args.subtasks.length > 10) {
    errors.push('subtasks max 10 items');
  }
  if (Array.isArray(args.subtasks)) {
    for (const st of args.subtasks) {
      if (st.id == null) errors.push('each subtask needs an id');
      if (!st.desc) errors.push('each subtask needs a desc');
      if (!['pending', 'in_progress', 'done', 'blocked'].includes(st.status)) {
        errors.push(`invalid status "${st.status}" for subtask ${st.id}`);
      }
    }
    // currentSubtaskId 必須在 subtasks 中
    const ids = new Set(args.subtasks.map(s => s.id));
    if (!ids.has(args.currentSubtaskId)) {
      errors.push('currentSubtaskId not found in subtasks');
    }
  }
  return errors;
}

// ═══════════════════════════════════════════
// C3-C4: 格式化輸出
// ═══════════════════════════════════════════

function formatThought(args) {
  const { goal, subtasks, currentSubtaskId, thought, nextNeeded, thinkingStyle } = args;
  const total = subtasks.length;
  const completed = subtasks.filter(s => s.status === 'done').length;
  const current = subtasks.find(s => s.id === currentSubtaskId);
  const lines = [];

  // Header
  lines.push('┌─ smart_decompose ──────────────────────────');
  lines.push(`│ ${formatGoalHeader(goal)}`);
  lines.push(`│ 📊 ${formatProgressBar(completed, total)}`);
  lines.push('│');

  // Subtask list
  const taskLines = formatSubtaskList(subtasks, currentSubtaskId);
  lines.push(`│ ${'─'.repeat(45)}`);
  for (const tl of taskLines) lines.push(`│${tl}`);
  lines.push(`│ ${'─'.repeat(45)}`);

  // Current subtask reasoning
  if (current) {
    lines.push(`│ 🔍 當前步驟: ${current.desc} (${currentSubtaskId}/${total})`);
    lines.push('│ ┌─ 推理 ──────────────────────────');

    // C4: disciplined style — template guidance (server adds hints, LLM follows)
    if (thinkingStyle === 'disciplined' && thought) {
      const indentThought = String(thought).split('\n').map(l => `│ │ ${l}`).join('\n');
      lines.push(indentThought);
    } else if (thought) {
      const indentThought = String(thought).split('\n').map(l => `│ │ ${l}`).join('\n');
      lines.push(indentThought);
    }
    lines.push('│ └────────────────────────────────');
  } else if (thought) {
    lines.push('│ ┌─ 推理 ──────────────────────────');
    const indentThought = String(thought).split('\n').map(l => `│ │ ${l}`).join('\n');
    lines.push(indentThought);
    lines.push('│ └────────────────────────────────');
  }

  lines.push('│');
  return lines.join('\n');
}

// ═══════════════════════════════════════════
// C5: 進度計算
// ═══════════════════════════════════════════

function computeProgress(subtasks, currentId) {
  const total = subtasks.length;
  const completed = subtasks.filter(s => s.status === 'done').length;
  const blocked = subtasks.filter(s => s.status === 'blocked').length;
  const current = subtasks.find(s => s.id === currentId);
  return {
    total,
    completed,
    blocked,
    currentId,
    bar: formatProgressBar(completed, total),
    done: completed === total,
  };
}

// ═══════════════════════════════════════════
// C6: 工具建議
// ═══════════════════════════════════════════

function suggestTool(subtasks, currentId, strictness) {
  const current = subtasks.find(s => s.id === currentId);
  if (!current) return null;

  if (current.tool) {
    return {
      subtaskId: currentId,
      suggestedTool: current.tool,
      suggestedArgs: current.toolArgs || null,
      reasoning: `步驟 ${currentId} 建議使用 ${current.tool}`,
      level: 'info',
    };
  }

  if (strictness === 'high') {
    return {
      subtaskId: currentId,
      suggestedTool: null,
      suggestedArgs: null,
      reasoning: `⚠️ 步驟 ${currentId}「${current.desc}」未指定 tool，建議補上`,
      level: 'warning',
    };
  }

  return null;
}

// ═══════════════════════════════════════════
// C7: 循環檢測
// ═══════════════════════════════════════════

const DEFAULT_SESSION = '_default';

function detectCycle(sessionId, subtaskId, thought, threshold) {
  const sid = sessionId || DEFAULT_SESSION;
  if (!sessionStore.has(sid)) sessionStore.set(sid, new Map());
  const session = sessionStore.get(sid);

  const entries = session.get(subtaskId) || [];
  entries.push({ thought: String(thought || ''), timestamp: Date.now() });
  session.set(subtaskId, entries);

  if (entries.length >= threshold) {
    const first = entries[0].thought;
    const last = entries[entries.length - 1].thought;
    const similarity = cosineSimilarity(first, last);
    if (similarity > 0.7) {
      return {
        type: 'cycle',
        message: `已在步驟停留 ${entries.length} 次，推理內容高度相似`,
        suggestion: '嘗試不同方向，或使用工具取得新資訊 (smart_grep / smart_exa_search)',
      };
    }
  }
  return null;
}

/**
 * 清除 session store（測試用）
 */
export function resetSessionStore() {
  sessionStore.clear();
}

// ═══════════════════════════════════════════
// C8: Budget 感知
// ═══════════════════════════════════════════

function budgetCheck(strictness) {
  try {
    const { getContextBudget } = require ? { getContextBudget: () => null } : {};
    // dynamic import for ESM context
    // We import at module level — but context-budget may not be available in test
    return null; // placeholder — real budget check done in plugin
  } catch {
    return null;
  }
}

/**
 * Budget 檢查（由 plugin 注入 getContextBudget）
 * @param {Function|null} getBudgetFn
 * @param {string} strictness
 * @returns {object|null}
 */
export function checkBudget(getBudgetFn, strictness) {
  if (typeof getBudgetFn !== 'function') return null;
  try {
    const budget = getBudgetFn();
    if (!budget) return null;
    const frac = budget.remainingFraction;
    const thresholds = BUDGET_THRESHOLDS[strictness] || BUDGET_THRESHOLDS.high;

    if (frac < thresholds.critical) {
      return {
        level: 'critical',
        message: `budget 僅剩 ${Math.round(frac * 100)}%`,
        suggestion: '建議改用 structured 模式或降低 strictness',
      };
    }
    if (frac < thresholds.warn) {
      return {
        level: 'warn',
        message: `budget ${Math.round(frac * 100)}%`,
        suggestion: '建議降低 strictness 節省 context',
      };
    }
    return { level: 'ok', message: `budget ${Math.round(frac * 100)}%`, suggestion: null };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
// C9: main entry
// ═══════════════════════════════════════════

/**
 * @param {object} args
 * @param {string} args.goal
 * @param {Array} args.subtasks
 * @param {number} args.currentSubtaskId
 * @param {string} args.thought
 * @param {boolean} args.nextNeeded
 * @param {string} [args.strictness='high']
 * @param {string[]} [args.contextHints]
 * @param {string} [args.thinkingStyle='disciplined']
 * @param {string} [args.sessionId]
 * @param {Function} [args._getBudgetFn] — injected by plugin
 * @returns {object} { thought, progress, toolSuggestion, intervention, budget, error? }
 */
export function decomposeHandler(args) {
  // C2: validate
  const errors = validateArgs(args);
  if (errors.length > 0) {
    return {
      error: errors.join('; '),
      thought: `❌ ${errors.join('\n❌ ')}`,
      progress: null,
      toolSuggestion: null,
      intervention: null,
      budget: null,
    };
  }

  const {
    subtasks,
    currentSubtaskId,
    nextNeeded,
    strictness = 'high',
    sessionId,
    thinkingStyle = 'disciplined',
  } = args;

  // C5: progress
  const progress = computeProgress(subtasks, currentSubtaskId);

  // C6: tool suggestion
  const toolTip = suggestTool(subtasks, currentSubtaskId, strictness);

  // C7: cycle detection
  const cycle = detectCycle(sessionId, currentSubtaskId, args.thought, CYCLE_THRESHOLDS[strictness] || 3);

  // C8: budget (via injected fn)
  const budget = checkBudget(args._getBudgetFn, strictness);

  // C3-C4: format thought
  const thought = formatThought(args);

  // Append tool suggestion + intervention + budget to thought text
  const footer = [];
  if (toolTip) {
    footer.push(`│ 🔧 工具建議：${toolTip.reasoning}`);
  }
  if (cycle) {
    footer.push(`│ ⚠️ 干預提示：${cycle.message}`);
    footer.push(`│    建議：${cycle.suggestion}`);
  }
  if (budget) {
    const bIcon = budget.level === 'critical' ? '🔴' : budget.level === 'warn' ? '🟡' : '🟢';
    footer.push(`│ 📈 ${bIcon} ${budget.message}`);
    if (budget.suggestion) footer.push(`│    建議：${budget.suggestion}`);
  }

  // Status
  if (nextNeeded) {
    footer.push(`│ → 繼續推理（nextNeeded: true）`);
  } else {
    footer.push(`│ ✓ 完成（nextNeeded: false）`);
  }
  footer.push('└────────────────────────────────────────────');

  const fullThought = thought + '\n' + footer.join('\n');

  return {
    thought: fullThought,
    progress,
    toolSuggestion: toolTip,
    intervention: cycle,
    budget,
  };
}
