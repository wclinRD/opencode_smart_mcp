# RFC: Context Lifecycle Management — 自動化管理 Context Budget + Findings + Compact

- **Phase**: 32
- **Status**: Draft
- **作者**: Smart MCP Agent
- **關聯 Issue**: Context budget 缺乏自動管理 / Findings 單向成長 / 無重要性權重 / compact 未整合

---

## 1. 問題回顧

### 1.1 Current State（現況）

```
ContextManager                   ContextBudget                 smart_compact (tool)
┌──────────────────────┐         ┌──────────────────┐          ┌──────────────────┐
│ toolHistory []        │         │ effectiveChars   │          │ classifyEntry()  │
│ accumulatedFindings[] │◄──────►│ thresholds       │          │ DROP/KEEP_SUMMARY│
│ MAX_HISTORY=50       │         │ decideCompression│          │ /KEEP            │
│ MAX_FINDINGS=100     │         │ getRotWarning()  │          │                  │
│ clearToolResults()   │         │ auto-clear@80%   │          │ standalone tool  │
└──────┬───────────────┘         └──────────────────┘          └──────────────────┘
       │                                                              │
       │  ❌ 各自為政                                                │  ❌ 未被呼叫
       │                                                              │
       └──────────────────────────────────────────────────────────────┘
```

### 1.2 具體缺失

| # | 問題 | 症狀 | 根因 |
|---|------|------|------|
| 1 | **Budget 只給警告不做動作** | 顯示「建議執行 smart_compact」但無人執行 | 無 Progressive Escalation |
| 2 | **Findings 只進不出** | 堆到 100 條後 FIFO 盲目丟棄 | 無重要性權重 + 無 Pruning |
| 3 | **無重要性權重** | critical 和 low severity 同等待遇 | findings 沒有 score / weight |
| 4 | **compact 未整合** | 從未被自動呼叫 | 無 bridge 串聯 |

---

## 2. 設計目標

1. **自動化** — 零人工干預，Context Budget 自動管理
2. **漸進式** — 隨 budget 惡化逐步升級處理力度
3. **加權感知** — findings 依重要性保留，高價值永遠優先
4. **零額外 LLM 成本** — 全部 rules-based，不調用 LLM

---

## 3. 架構設計

### 3.1 核心：`ContextLifecycle` 類別

新增 `src/lib/context-lifecycle.mjs`，作為 ContextManager + ContextBudget + Compact 三者的 orchestrator：

```
src/lib/context-lifecycle.mjs  ← NEW
src/lib/context-manager.mjs    ← 小改 (add importanceWeight, add findings lifecycle)
src/lib/context-budget.mjs     ← 小改 (add adaptive thresholds)
src/plugins/core/compact.mjs   ← 抽取 classify logic → shared function
src/server/index.mjs           ← 整合 lifecycle.check() 到 post-tool hook
```

### 3.2 資料流

```
Tool 執行完成
     │
     ▼
captureAndReturn()  ← server/index.mjs
     │
     ├──→ contextManager.capture(tool, args, result)
     │       └── extractFindings() + push (加 importance weight)
     │
     └──→ lifecycle.check(budget, contextManager)  ← NEW
              │
              ├── [Phase 1] 評估 budget 等級 (OK / WARN / LOW / CRITICAL / DANGER)
              │
              ├── [Phase 2] Findings Pruning (依權重 + 年齡)
              │
              ├── [Phase 3] Tool History Compact (自動移除可丟棄項目)
              │
              └── [Phase 4] 回傳建議 + 摘要字串 (注入到 response)
```

---

## 4. 詳細實作

### 4.1 `src/lib/context-lifecycle.mjs` — ContextLifecycle

```javascript
// context-lifecycle.mjs — Phase 32: Automatic context lifecycle management
//
// Orchestrates ContextManager + ContextBudget + smart_compact classification
// into an automatic progressive escalation protocol.
// Zero LLM cost — all rules-based.

// Thresholds (5 levels)
const BUDGET_LEVELS = [
  { level: 'OK',       minRemaining: 0.30 },  // < 70% used
  { level: 'WARN',     minRemaining: 0.20 },  // 70-80% used
  { level: 'LOW',      minRemaining: 0.12 },  // 80-88% used
  { level: 'CRITICAL', minRemaining: 0.05 },  // 88-95% used
  { level: 'DANGER',   minRemaining: 0.00 },  // > 95% used
];

// Actions per level
const ACTION_PLAN = {
  OK:       { pruneFindings: false, compactHistory: false, forceSummary: false },
  WARN:     { pruneFindings: true,  compactHistory: false, forceSummary: false },
  LOW:      { pruneFindings: true,  compactHistory: true,  forceSummary: false },
  CRITICAL: { pruneFindings: true,  compactHistory: true,  forceSummary: true  },
  DANGER:   { pruneFindings: true,  compactHistory: true,  forceSummary: true, emergencyClear: true },
};

export class ContextLifecycle {
  constructor(contextManager, contextBudget) {
    this._cm = contextManager;
    this._budget = contextBudget;
    this._lastCompactTurn = 0;  // Prevent repeated compact on every call
    this._compactCooldown = 5;  // Skip compact if done within last N turns
  }

  /**
   * Main check: evaluate budget level and take corresponding actions.
   * Called after every tool capture — must be fast (< 1ms for OK levels).
   * @param {number} [currentTurn] — current tool count (for cooldown)
   * @returns {{level:string, actions:object, summary:string}}
   */
  check(currentTurn) {
    const level = this._evaluateLevel();
    const actions = ACTION_PLAN[level];

    let summary = '';

    // Phase 1: Findings pruning (weighted)
    if (actions.pruneFindings) {
      const pruned = this._pruneFindings(level);
      if (pruned > 0) summary += `🧹 findings:${pruned} `;
    }

    // Phase 2: Tool history compaction (with cooldown)
    if (actions.compactHistory && this._canCompact(currentTurn)) {
      const compacted = this._compactHistory(level);
      if (compacted > 0) summary += `📦 compact:${compacted} `;
      this._lastCompactTurn = currentTurn;
    }

    // Phase 3: Force summary / emergency clear
    if (actions.forceSummary) {
      // Already handled by compactHistory for CRITICAL+
    }
    if (actions.emergencyClear) {
      const cleared = this._emergencyClear();
      if (cleared > 0) summary += `🚨 emergency:${cleared} `;
    }

    return {
      level,
      actions,
      summary: summary.trim() || 'ok',
    };
  }

  _evaluateLevel() {
    const remaining = this._budget.remainingFraction;
    for (const bl of BUDGET_LEVELS) {
      if (remaining > bl.minRemaining) return bl.level;
    }
    return 'DANGER';
  }

  _canCompact(currentTurn) {
    return (currentTurn - this._lastCompactTurn) >= this._compactCooldown;
  }

  /**
   * Weighted findings pruning.
   * Scoring formula: score = severityWeight × recencyBonus × dedupBonus
   *   severityWeight: critical=100, high=50, medium=20, low=5, memory=3
   *   recencyBonus: 1.0 (current hour) → 0.5 (24h+) → 0.1 (7d+)
   *   dedupBonus: 1.0 (unique) → 0.3 (duplicate category)
   * Keep top N based on budget level (LOW=60, CRITICAL=40, DANGER=20)
   */
  _pruneFindings(level) { /* 見 4.2 */ }

  /**
   * Auto-compact tool history using smart_compact classification.
   * 1. Get toolHistory from ContextManager
   * 2. Run classifyEntry() on each (excluding last 3 protected)
   * 3. Remove DROP entries from contextManager
   * 4. Summarize KEEP_SUMMARY entries
   * 5. Return count of removed entries
   */
  _compactHistory(level) { /* 見 4.3 */ }

  _emergencyClear() { /* 見 4.4 */ }
}
```

### 4.2 Findings Weighting & Pruning

**Scoring formula**:
```
score = severityWeight × recencyMultiplier × dedupMultiplier
```

| 維度 | 參數 | 權重 |
|------|------|------|
| **Severity** | critical | 100 |
| | high | 50 |
| | medium | 20 |
| | low | 5 |
| | memory (auto-inject) | 3 |
| **Recency** | < 1 hour | 1.0 |
| | 1-6 hours | 0.8 |
| | 6-24 hours | 0.6 |
| | 1-7 days | 0.5 |
| | > 7 days | 0.1 |
| **Dedup** | unique category+source combo | 1.0 |
| | duplicate category | 0.5 |
| | exact duplicate text | 0.1 |

**Pruning target** (保留上限依 budget level 遞減)：

| Level | max findings | 行為 |
|-------|-------------|------|
| OK | 100 (不變) | 不 pruning |
| WARN | 80 | 移除 score < 5 的低價值 findings |
| LOW | 60 | 移除 score < 15 的 |
| CRITICAL | 40 | 只保留 score ≥ 30 的 |
| DANGER | 20 | 只保留 critical/high severity |

### 4.3 Compact Bridge — 抽取 classifyEntry 為共享函式

從 `src/plugins/core/compact.mjs` 抽出 `classifyEntry()` 和 `summarizeOutput()` 到 `src/lib/compact-classifier.mjs`（或直接放進 context-lifecycle.mjs），讓 ContextLifecycle 可以直接呼叫：

```javascript
// src/lib/compact-classifier.mjs (NEW — extracted from compact.mjs)

export function classifyEntry(entry) { /* 原邏輯 */ }
export function summarizeOutput(entry) { /* 原邏輯 */ }
export const DROP_TOOLS = new Set([...]);  // exported for testing
export const KEEP_SUMMARY_TOOLS = new Set([...]);
export const KEEP_TOOLS = new Set([...]);
```

`compact.mjs` 改為 import 這份共享邏輯，保持工具介面不變。

`_compactHistory()` 實作：

```javascript
_compactHistory(level) {
  const ctx = this._cm.get();
  if (!ctx || !ctx.toolHistory.length) return 0;

  const history = ctx.toolHistory;
  const PROTECT_LAST = 3;
  const analyzableCount = history.length > PROTECT_LAST
    ? history.length - PROTECT_LAST : 0;
  if (analyzableCount === 0) return 0;

  const newHistory = [];
  let removedCount = 0;

  for (let i = 0; i < history.length; i++) {
    // Protected zone: always keep
    if (i >= history.length - PROTECT_LAST) {
      newHistory.push(history[i]);
      continue;
    }
    const action = classifyEntry(history[i]);
    if (action === 'DROP') {
      removedCount++;
      // Don't push → effectively removed
    } else if (action === 'KEEP_SUMMARY' && level === 'CRITICAL' || level === 'DANGER') {
      // At CRITICAL+, replace output with summary
      newHistory.push({
        ...history[i],
        result: summarizeOutput(history[i]),
        _summarized: true,
      });
    } else {
      newHistory.push(history[i]);
    }
  }

  // Write back to contextManager (via internal API, not persistence yet)
  this._cm._context.toolHistory = newHistory;
  this._cm._save();

  return removedCount;
}
```

### 4.4 Emergency Clear

當 budget > 95% 時，除了 compact 還執行：

```javascript
_emergencyClear() {
  const ctx = this._cm.get();
  if (!ctx) return 0;

  // 1. Clear ALL findings (keep nothing at DANGER)
  const findingsCount = ctx.accumulatedFindings.length;
  ctx.accumulatedFindings = [];

  // 2. Clear tool history down to last 5
  const historyCount = ctx.toolHistory.length;
  ctx.toolHistory = ctx.toolHistory.slice(-5);

  // 3. Reset budget counter
  this._budget.reset();

  this._cm._save();
  return findingsCount + (historyCount - Math.min(5, historyCount));
}
```

---

## 5. 整合點

### 5.1 server/index.mjs — 加入 lifecycle hook

在 `captureAndReturn()` 中的最佳插入點：

```javascript
// 現有 code (L1113):
contextManager.capture(toolName, args, result, elapsedMs);

// 新增 (Phase 32):
if (lifecycle) {
  const currentTurn = contextManager.get()?.metadata?.toolCount || 0;
  const lifecycleResult = lifecycle.check(currentTurn);
  if (lifecycleResult.level !== 'OK') {
    debugLog(`[Lifecycle] ${lifecycleResult.level}: ${lifecycleResult.summary}`);
    // Attach hint to response for LLM awareness (not always shown)
    if (lifecycleResult.level === 'CRITICAL' || lifecycleResult.level === 'DANGER') {
      result._lifecycleHint = lifecycleResult.summary;
    }
  }
}
```

Server 初始化時：

```javascript
import { ContextLifecycle } from '../lib/context-lifecycle.mjs';

// 在 contextManager init 附近
const lifecycle = new ContextLifecycle(contextManager, budget);
```

### 5.2 context-manager.mjs — 小改

1. 加 `importanceWeight` 到 finding schema（非破壞性擴充）

```javascript
// 在 extractFindings 或 addFindings 中：
findings.push({
  source: toolName,
  finding: ...,
  category: fp.category,
  severity: fp.severity,
  timestamp: nowISO(),
  importanceWeight: computeImportance(fp.severity, toolName),  // NEW
});
```

2. `computeImportance()` 輔助函式：

```javascript
const SEVERITY_WEIGHT = { critical: 100, high: 50, medium: 20, low: 5 };
function computeImportance(severity, toolName) {
  const base = SEVERITY_WEIGHT[severity] || 5;
  // 某些 tool 的 findings 天然比較重要
  if (toolName === 'smart_security') return base * 1.5;
  if (toolName === 'smart_think') return base * 1.3;
  if (toolName === 'smart_fast_apply') return base * 1.2;
  return base;
}
```

3. 新增 `pruneFindings(minScore, maxCount)` 公開方法供 Lifecycle 呼叫

### 5.3 context-budget.mjs — 小改

1. 加入 `trackFindings(count)` 方法 — 追蹤 findings 對 budget 的貢獻
2. 加入 `getUsedByComponent()` — 區分 toolHistory / findings / metadata 各吃多少

---

## 6. 實作順序

### Phase A — 核心抽取（1-2 天）

| Step | 檔案 | 內容 |
|------|------|------|
| A1 | `src/lib/compact-classifier.mjs` | 從 compact.mjs 抽出 classifyEntry / summarizeOutput |
| A2 | `src/plugins/core/compact.mjs` | 改為 import compact-classifier，行為不變 |
| A3 | `src/lib/context-lifecycle.mjs` | 實作 ContextLifecycle class（_evaluateLevel + _canCompact） |
| A4 | 測試 | compact-classifier.test.mjs（確保抽取後行為一致） |

### Phase B — Findings Weighting（1 天）

| Step | 檔案 | 內容 |
|------|------|------|
| B1 | `src/lib/context-manager.mjs` | 加 importanceWeight 到 finding schema |
| B2 | 同上 | 加 computeImportance() + pruneFindings() |
| B3 | `src/lib/context-lifecycle.mjs` | 實作 _pruneFindings() |
| B4 | 測試 | findings 權重計算 + pruning 邊界 |

### Phase C — Auto-Compact & Emergency Clear（1 天）

| Step | 檔案 | 內容 |
|------|------|------|
| C1 | `src/lib/context-lifecycle.mjs` | 實作 _compactHistory() |
| C2 | 同上 | 實作 _emergencyClear() |
| C3 | 測試 | compact bridge + emergency clear |

### Phase D — Server 整合（0.5 天）

| Step | 檔案 | 內容 |
|------|------|------|
| D1 | `src/server/index.mjs` | Lifecycle init + check() hook |
| D2 | 同上 | debugLog lifecycle results |
| D3 | 端到端測試 | simulate budget levels |

---

## 7. 測試策略

### 7.1 Unit Tests

```
src/lib/context-lifecycle.test.mjs
├── _evaluateLevel() — 5 個 level 的正確閾值
├── _pruneFindings() — 權重計算 + 保留策略
├── _compactHistory() — DROP/KEEP_SUMMARY/KEEP
├── _emergencyClear() — 極端情況
└── check() — 端到端流程
```

### 7.2 情境測試

| 情境 | 預期行為 |
|------|---------|
| Budget 65% → check() | level=OK, 不做任何事, summary='ok' |
| Budget 75% → check() | level=WARN, prune 低價值 findings |
| Budget 85% → check() | level=LOW, prune + compact 歷史 |
| Budget 90% → check() | level=CRITICAL, prune + compact + summary |
| Budget 96% → check() | level=DANGER, emergency clear |
| Budget 85% → 連續呼叫 3 次 | 第二次開始 compact 被 cooldown 跳過 |
| 50 個 findings 全是 low severity | WARN 時移除了 40 個，保留 10 個 |

### 7.3 效能測試

- `_evaluateLevel()` 需 < 0.01ms
- `_pruneFindings(100 items)` 需 < 0.1ms
- `_compactHistory(50 items)` 需 < 0.2ms
- 確保 OK level 的 check() 在 0.05ms 內完成

---

## 8. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| Findings 誤刪重要資訊 | 低 | 中 | Pruning 只作用於 low/medium severity；critical 永不自動刪除 |
| Compact 移除還在用的 tool output | 低 | 低 | PROTECT_LAST=3 保護最近 3 筆；分類邏輯已運作多時 |
| Cooldown 太保守 → budget 惡化 | 中 | 低 | cooldown=5 可調；DANGER 級別會繞過 cooldown |
| 引入新 bug 影響現有流程 | 低 | 高 | 全部新 function，不修改現有 public API；逐步部署 |

---

## 9. 成功標準

1. **Context Budget 永不超過 90%** — 自動 compact + findings pruning 確保
2. **Findings 保留品質提升** — critical/high 永不因 FIFO 被丟棄
3. **Zero user intervention** — 從不出現「建議執行 smart_compact」
4. **Zero LLM cost  overhead** — lifecycle.check() 在 OK level 需 < 0.05ms
5. **100% test coverage** — 新程式碼 line coverage ≥ 90%

---

## 10. 附錄：現有程式碼對照

### 現有 threshold 系統 (context-budget.mjs L53-55)

```javascript
const WARN_THRESHOLD = 0.80;       // remaining <= 80% → warning
const LOW_THRESHOLD = 0.50;        // remaining <= 50% → low
const CRITICAL_THRESHOLD = 0.20;   // remaining <= 20% → critical
```

這些數字是 **remaining fraction**（剩餘比例），跟 BUDGET_LEVELS 的語義一致。新設計的閾值更積極（WARN 在 remaining 30% 就觸發），因為 findings + history 需要更多空間。

### 現有 auto clear_tool_results (server/index.mjs L1974-1982)

```javascript
if (budget.usedFraction >= 0.80 && !_autoCleared) {
  _autoCleared = true;
  const cleared = contextManager.clearToolResults({ olderThan: 10, keepLatest: 2 });
}
```

此程式碼保留不刪，作為第一道防線。ContextLifecycle 在更進階的 level 接手。

### 現有 compact.mjs 分類表

| 分類 | Tools | 新行為 |
|------|-------|--------|
| DROP | smart_grep, smart_lsp, smart_test, smart_learn, import_graph, code_impact | 自動移除（LOW+ level） |
| KEEP_SUMMARY | smart_security, smart_ingest_document, git_* | CRITICAL+ level 時摘要替代 |
| KEEP | smart_think, smart_deep_think, smart_fast_apply, edit, error_diagnose, debug | 永不自動移除 |

---

## 11. 檔案變更總表

| 檔案 | 變更類型 | 新增/修改行數 |
|------|---------|--------------|
| `src/lib/compact-classifier.mjs` | **新增** | ~60 行 |
| `src/lib/context-lifecycle.mjs` | **新增** | ~250 行 |
| `src/lib/context-manager.mjs` | 小改 | ~30 行 (5 處修改) |
| `src/lib/context-budget.mjs` | 小改 | ~10 行 (2 處新增方法) |
| `src/plugins/core/compact.mjs` | 重構 | ~5 行 (改 import) |
| `src/server/index.mjs` | 小改 | ~15 行 (init + hook) |
| `src/lib/context-lifecycle.test.mjs` | **新增** | ~200 行 |
| `src/lib/compact-classifier.test.mjs` | **新增** | ~80 行 |
| `docs/plan/context-lifecycle-rfc.md` | **新增** | 本文件 |

---

*END OF RFC*
