// ── smart_decompose_think 核心邏輯 ──
// Qwen3.5-4B 專用推理工具 — 完整 think↔tool 循環 orchestration
// 整合 P2.1-P2.5：DAG/ADAPT/Budget/XML/Dual/Semantic/Resilience/FR-CoT/Necessity/CrossVal

import {
  formatProgressBar,
  formatGoalHeader,
  formatSubtaskList,
} from '../lib/think-utils.mjs';

import {
  parseThought,
  getTemplatePrompt,
  getTemplateLabel,
  sanitizeP2Args,
} from '../lib/decompose-think-analysis.mjs';

import {
  trackToolCalls,
  buildToolResultContext,
  activeToolSuggest,
  detectCycleP2,
  resetSessionStoreP2,
} from '../lib/decompose-think-tracking.mjs';

// P2.2
import { autoDetectBudget, formatBudgetIndicator, budgetDecision, contextPressure } from '../lib/decompose-budget.mjs';

// P2.3
import { detectSemanticSignals, semanticAnalysis } from '../lib/decompose-semantic.mjs';
import { chooseDualMode, summarizeCoE } from '../lib/decompose-dual.mjs';

// P2.4
import { frcotRecommend, frcotClassify, frcotFormat, frcotPrompt } from '../lib/decompose-frcot.mjs';
import { calcToolNecessity, calcBatchNecessity } from '../lib/decompose-necessity.mjs';
import { crossValidate, detectConflicts, validationReport } from '../lib/decompose-crossval.mjs';

// ═══════════════════════════════════════════
// 參數驗證（P1 驗證邏輯擴充）
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
    const ids = new Set(args.subtasks.map(s => s.id));
    if (!ids.has(args.currentSubtaskId)) {
      errors.push('currentSubtaskId not found in subtasks');
    }
  }
  return errors;
}

// ═══════════════════════════════════════════
// 進度計算
// ═══════════════════════════════════════════

function computeProgress(subtasks, currentId) {
  const total = subtasks.length;
  const completed = subtasks.filter(s => s.status === 'done').length;
  const blocked = subtasks.filter(s => s.status === 'blocked').length;
  const current = subtasks.find(s => s.id === currentId);
  return {
    total, completed, blocked, currentId,
    bar: formatProgressBar(completed, total),
    done: completed === total,
    current: current ? current.desc : '',
  };
}

// ═══════════════════════════════════════════
// D3: formatThinkOutput (P2.5 擴充版)
// ═══════════════════════════════════════════

function formatThinkOutput(args) {
  const {
    goal, subtasks, currentSubtaskId, thought, template,
    templatePrompt, resultContext, toolSuggestion, intervention,
    progress, nextNeeded, thinkingStyle, _isFirstCall,
    budget, frcot, necessity, signals, crossval,
  } = args;

  const lines = [];
  const templateLabel = getTemplateLabel(template);

  lines.push(`┌─ smart_decompose_think [${templateLabel}] ─────────`);
  lines.push(`│ ${formatGoalHeader(goal)}`);
  lines.push(`│ 📊 ${formatProgressBar(progress.completed, progress.total)}`);

  // Budget + FR-CoT info
  if (budget) {
    lines.push(`│ 💰 Budget: ${budget.budget} | Max steps: ${budget.params?.maxSteps || '?'}`);
  }
  if (frcot && frcot.mode !== 'normal') {
    lines.push(`│ ⚡ FR-CoT: ${frcot.mode}`);
  }
  if (_isFirstCall) lines.push('│ 🆕 首次呼叫 — 開始 think↔tool 循環');
  lines.push('│');

  // Template prompt
  if (templatePrompt) {
    lines.push(`│ ${'─'.repeat(35)}`);
    for (const tLine of templatePrompt.split('\n')) {
      lines.push(`│${tLine.startsWith('│') ? tLine : ` ${tLine}`}`);
    }
    lines.push(`│ ${'─'.repeat(35)}`);
  }

  // FR-CoT formatted thought (if in fr-cot mode)
  if (frcot && frcot.formatted && frcot.mode === 'brief') {
    lines.push(`│ ${'─'.repeat(35)}`);
    lines.push(`│ ${frcot.formatted}`);
    lines.push(`│ ${'─'.repeat(35)}`);
  }

  // Tool result context
  if (resultContext) {
    lines.push('│');
    for (const rLine of resultContext.split('\n')) {
      lines.push(`│${rLine.startsWith('│') ? rLine : ` ${rLine}`}`);
    }
  }

  lines.push('│');

  // Subtask list
  const taskLines = formatSubtaskList(subtasks, currentSubtaskId);
  lines.push(`│ ${'─'.repeat(45)}`);
  for (const tl of taskLines) lines.push(`│${tl}`);
  lines.push(`│ ${'─'.repeat(45)}`);

  // Current subtask reasoning
  const current = subtasks.find(s => s.id === currentSubtaskId);
  if (current) {
    lines.push(`│ 🔍 當前步驟: ${current.desc} (${currentSubtaskId}/${progress.total})`);
    lines.push('│ ┌─ 推理 ──────────────────────────');
    if (thought) {
      const indentThought = String(thought).split('\n').map(l => `│ │ ${l}`).join('\n');
      lines.push(indentThought);
    }
    lines.push('│ └────────────────────────────────');
  }

  lines.push('│');

  // Tool suggestion
  if (toolSuggestion) {
    const triggerIcons = {
      skipped_tool: '🔴', overconfidence: '⚠️',
      uncertainty: '❓', task_affinity: '🔧', subtask_tool: '🔧',
    };
    const icon = triggerIcons[toolSuggestion.trigger] || '🔧';
    lines.push(`│ ${icon} 建議：${toolSuggestion.reason}`);
    if (toolSuggestion.suggestedTool) {
      lines.push(`│    工具: ${toolSuggestion.suggestedTool}`);
    }
  }

  // Tool necessity
  if (necessity && necessity.score > 0) {
    lines.push(`│ 📐 Tool 必要性: ${necessity.score}/10${necessity.suggestedTool ? ` (${necessity.suggestedTool})` : ''}`);
  }

  // Semantic signals
  if (signals && signals.topSignal) {
    lines.push(`│ 📡 語意訊號: ${signals.topSignal.type} (${signals.topSignal.confidence}%)`);
  }

  // Intervention
  if (intervention) {
    const iIcons = { cycle: '🔄', overconfidence: '⚠️', skipped_tool: '🔴', budget_critical: '🔴' };
    const iIcon = iIcons[intervention.type] || '⚠️';
    lines.push(`│ ${iIcon} 干預提示：${intervention.message}`);
    if (intervention.suggestion) lines.push(`│    建議：${intervention.suggestion}`);
  }

  // Cross-validation score
  if (crossval && crossval.total > 0) {
    const xvIcon = crossval.score >= 80 ? '✅' : crossval.score >= 50 ? '⚠️' : '❌';
    lines.push(`│ ${xvIcon} CrossVal: ${crossval.score}/100 (${crossval.passed}/${crossval.total})`);
  }

  if (nextNeeded) {
    lines.push('│ → 繼續推理（nextNeeded: true）');
  } else {
    lines.push('│ ✓ 完成（nextNeeded: false）');
  }
  lines.push('└────────────────────────────────────────────');

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// D1-D2: decomposeThinkHandler 主流程
// ═══════════════════════════════════════════

export function decomposeThinkHandler(args) {
  // A6: sanitize args
  const safe = sanitizeP2Args(args);

  const errors = validateArgs(safe);
  if (errors.length > 0) {
    return {
      error: errors.join('; '),
      thought: `❌ ${errors.join('\n❌ ')}`,
      progress: null, toolSuggestion: null,
      intervention: null, budget: null,
    };
  }

  const {
    subtasks, currentSubtaskId, thought, nextNeeded,
    toolCalls, roundType, template, strictness,
    sessionId, _prevToolCalls, _prevSuggestion, _isFirstCall,
  } = safe;

  // 1. 解析 thought
  const parsed = parseThought(thought);

  // 2. 進度計算
  const progress = computeProgress(subtasks, currentSubtaskId);

  // 2b. Budget 自動偵測（P2.2）
  const budget = autoDetectBudget(safe.goal, {
    thought,
    confidence: parsed.isConfident ? 8 : 4,
    complexity: subtasks.length > 5 ? 4 : subtasks.length > 3 ? 3 : 2,
  });

  // 2c. FR-CoT 模式選擇（P2.4）
  const frcotMode = safe.frcotMode === 'auto'
    ? frcotRecommend({
        tokenCount: thought.length,
        confidence: parsed.isConfident ? 8 : 4,
        roundCount: _prevToolCalls?.length || 0,
        complexity: subtasks.length > 5 ? 5 : subtasks.length > 3 ? 3 : 1,
      })
    : safe.frcotMode;

  const frcot = {
    mode: frcotMode,
    formatted: frcotMode === 'brief'
      ? frcotFormat(currentSubtaskId ? subtasks.find(s => s.id === currentSubtaskId)?.desc : '', thought, null, { mode: 'brief' })
      : null,
  };

  // 3. 更新 tool call 追蹤（B1）
  const { updatedToolCalls, skippedSuggestion } = trackToolCalls(
    toolCalls, _prevToolCalls, _prevSuggestion
  );

  // 3b. Tool 必要性評分（P2.4）
  const currentSubtask = subtasks.find(s => s.id === currentSubtaskId);
  const necessity = currentSubtask ? calcToolNecessity(currentSubtask) : { score: 0, reason: '', suggestedTool: null };

  // 4. 主動工具建議（B3）
  const activeTip = activeToolSuggest({
    parsed,
    currentSubtask,
    template,
    toolCalls: updatedToolCalls,
    strictness,
    prevSuggestion: _prevSuggestion,
  });

  // 5. 工具結果引導（B2）
  const resultContext = roundType === 'tool_result'
    ? buildToolResultContext(updatedToolCalls)
    : null;

  // 6. 模板 prompt（A5）— FR-CoT 模式使用 frcotPrompt
  const templatePrompt = frcotMode === 'brief'
    ? frcotPrompt(template, 'brief')
    : getTemplatePrompt(template);

  // 7. 循環檢測（B4）
  const cycle = detectCycleP2(sessionId, currentSubtaskId, thought, strictness);

  // 7b. 語意訊號分析（P2.3）— detectSemanticSignals 回傳 { signals, summary, topSignal }
  const semanticResult = thought ? detectSemanticSignals(thought) : null;
  const signalTop = semanticResult && semanticResult.signals.length > 0 ? {
    topSignal: semanticResult.signals[0],
    count: semanticResult.signals.length,
  } : null;

  // 8. Cross-Validation（P2.4）— 只在有足夠 subtasks 時執行
  const crossval = subtasks.length >= 2
    ? crossValidate(subtasks, { tools: {} })
    : null;

  // 9. 格式化輸出（D3）
  const formatted = formatThinkOutput({
    goal: safe.goal, subtasks, currentSubtaskId, thought,
    template, templatePrompt, resultContext,
    toolSuggestion: activeTip, intervention: cycle,
    progress, nextNeeded, thinkingStyle: safe.thinkingStyle, _isFirstCall,
    budget, frcot, necessity, signals: signalTop, crossval,
  });

  return {
    thought: formatted,
    progress,
    toolSuggestion: activeTip,
    intervention: cycle,
    budget,
    frcot,
    crossval,
  };
}
