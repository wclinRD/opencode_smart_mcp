// ── P2 Tool 循環追蹤（decompose-think-tracking）──
// 供 smart_decompose_think 使用：tool call 狀態追蹤 + 工具結果引導 + 主動建議

import { parseThought, suggestToolByTask, checkConfidence, checkSkippedTool } from './decompose-think-analysis.mjs';

// ── Session store（P2 獨立，不與 P1 共用）──
// Map<sessionId, Map<subtaskId, Array<{thought, timestamp}>>>
const sessionStoreP2 = new Map();
const DEFAULT_SESSION = '_default';

// ── Threshold ──
const CYCLE_THRESHOLDS = { high: 2, medium: 3, low: 5 };

// ═══════════════════════════════════════════
// B4: 循環檢測（P2 獨立 store）
// ═══════════════════════════════════════════

import { cosineSimilarity } from './think-utils.mjs';

/**
 * P2 獨立循環檢測（不影響 P1 的 sessionStore）
 * @param {string|null} sessionId
 * @param {number} subtaskId
 * @param {string} thought
 * @param {string} strictness — high | medium | low
 * @returns {object|null} intervention
 */
export function detectCycleP2(sessionId, subtaskId, thought, strictness) {
  const sid = sessionId || DEFAULT_SESSION;
  if (!sessionStoreP2.has(sid)) sessionStoreP2.set(sid, new Map());
  const session = sessionStoreP2.get(sid);

  const entries = session.get(subtaskId) || [];
  entries.push({ thought: String(thought || ''), timestamp: Date.now() });
  session.set(subtaskId, entries);

  const threshold = CYCLE_THRESHOLDS[strictness] || 3;

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
 * 清除 P2 session store（測試用）
 */
export function resetSessionStoreP2() {
  sessionStoreP2.clear();
}

// ═══════════════════════════════════════════
// B1: trackToolCalls
// ═══════════════════════════════════════════

/**
 * 更新 tool call 狀態
 * @param {Array} toolCalls — 本輪 toolCalls
 * @param {Array|null} prevToolCalls — 前輪 toolCalls
 * @param {object|null} prevSuggestion — 前輪 toolSuggestion
 * @returns {object} { updatedToolCalls, newCalls, completedCalls, skippedSuggestion }
 */
export function trackToolCalls(toolCalls, prevToolCalls, prevSuggestion) {
  const current = Array.isArray(toolCalls) ? toolCalls.map(c => ({ ...c })) : [];
  const prev = Array.isArray(prevToolCalls) ? prevToolCalls : [];

  // 找出新的 tool call（不在 prev 中的）
  const newCalls = current.filter(c =>
    c.status === 'done' && !prev.some(p => p.tool === c.tool && p.status === 'done')
  );

  // 找出剛完成的 tool call（status 從 pending → done）
  const completedCalls = current.filter(c =>
    c.status === 'done' && prev.some(p => p.tool === c.tool && p.status === 'pending')
  );

  // 檢查 skipped tool
  const skippedSuggestion = checkSkippedTool(current, prevSuggestion);

  return { updatedToolCalls: current, newCalls, completedCalls, skippedSuggestion };
}

// ═══════════════════════════════════════════
// B2: buildToolResultContext
// ═══════════════════════════════════════════

/**
 * 產生工具結果引導 prompt
 * @param {Array} toolCalls
 * @returns {string|null} 格式化引導文字
 */
export function buildToolResultContext(toolCalls) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const lastDone = [...calls].reverse().find(c => c.status === 'done');

  if (!lastDone) return null;

  const resultPreview = lastDone.result
    ? lastDone.result.slice(0, 200)
    : '(無結果摘要)';

  return `┌─ 工具結果 ─────────────────────
│ 你剛剛呼叫了 ${lastDone.tool}
│ 結果摘要：${resultPreview}
│ 請根據這個結果，決定下一步：
│ - 結論（切換 subtask）
│ - 換工具（試不同方向）
│ - 繼續深入（同工具不同參數）
└────────────────────────────────`;
}

// ═══════════════════════════════════════════
// B3: activeToolSuggest
// ═══════════════════════════════════════════

/**
 * 主動建議工具 — 依優先級檢查
 * 優先級：skipped_tool > overconfidence > uncertainty > task_affinity
 *
 * @param {object} args
 * @param {object} args.parsed — parseThought 結果
 * @param {object} args.currentSubtask — 當前 subtask
 * @param {string} args.template — debug/refactor/search/generic
 * @param {Array} args.toolCalls — 更新後的 toolCalls
 * @param {string} args.strictness
 * @param {object|null} args.prevSuggestion
 * @param {object|null} args.prevIntervention
 * @returns {object|null} { subtaskId, suggestedTool, suggestedArgs, reason, trigger } | null
 */
export function activeToolSuggest(args) {
  const {
    parsed,
    currentSubtask,
    template,
    toolCalls,
    strictness = 'high',
    prevSuggestion = null,
    prevIntervention = null,
  } = args;

  if (!parsed || !currentSubtask) return null;

  // 🥇 1. skipped_tool
  if (prevSuggestion) {
    const skipped = checkSkippedTool(toolCalls, prevSuggestion);
    if (skipped) {
      return {
        subtaskId: currentSubtask.id,
        suggestedTool: prevSuggestion.suggestedTool,
        suggestedArgs: prevSuggestion.suggestedArgs || {},
        reason: skipped.suggestion,
        trigger: 'skipped_tool',
      };
    }
  }

  // 🥈 2. overconfidence
  const overconf = checkConfidence(parsed, toolCalls, strictness);
  if (overconf) {
    return {
      subtaskId: currentSubtask.id,
      suggestedTool: 'smart_grep',
      suggestedArgs: {},
      reason: overconf.suggestion,
      trigger: 'overconfidence',
    };
  }

  // 🥉 3. uncertainty
  if (parsed.hasUncertainty) {
    // 根據模板決定建議的工具
    if (template === 'search') {
      return {
        subtaskId: currentSubtask.id,
        suggestedTool: 'smart_exa_search',
        suggestedArgs: {},
        reason: '檢測到不確定性，建議搜尋資料確認',
        trigger: 'uncertainty',
      };
    }
    return {
      subtaskId: currentSubtask.id,
      suggestedTool: 'smart_grep',
      suggestedArgs: {},
      reason: '檢測到不確定性，建議用 smart_grep 釐清',
      trigger: 'uncertainty',
    };
  }

  // 🫸 4. task_affinity
  const taskMatch = suggestToolByTask(currentSubtask.desc, template);
  if (taskMatch) {
    return {
      subtaskId: currentSubtask.id,
      suggestedTool: taskMatch.tool,
      suggestedArgs: taskMatch.args,
      reason: taskMatch.reason,
      trigger: 'task_affinity',
    };
  }

  // catch-all: subtask.tool 欄位
  if (currentSubtask.tool && strictness === 'high') {
    return {
      subtaskId: currentSubtask.id,
      suggestedTool: currentSubtask.tool,
      suggestedArgs: currentSubtask.toolArgs || {},
      reason: `步驟 ${currentSubtask.id} 指定使用 ${currentSubtask.tool}`,
      trigger: 'subtask_tool',
    };
  }

  return null;
}
