# Think-Guard 追蹤清單

## 📋 當前狀態

| 項目 | 狀態 |
|------|------|
| **整體進度** | 🟢 Phase 2 + Bug Fixes 完成 |
| **測試狀態** | ✅ 206/206 通過 |
| **最後更新** | 2026-07-17 |

---

## ✅ Phase 1：核心實作（已完成）

### 1.1 核心模組 `src/lib/think-guard.mjs`

- [x] classifyThinkingMode() — 任務分類器
- [x] detectOverconfidence() — 過度自信偵測
- [x] enhanceVerifyStage() — VERIFY 增強
- [x] TASK_MODE_RULES — 32 條分類規則（含 12 個中文觸發詞）
- [x] OVERCONFIDENCE_INDICATORS — 12 條過度自信指標
- [x] SCOPE_QUESTIONS — 3 個範圍限定問題
- [x] COMPLEMENTARITY_CHECKLIST — 4 項互補判定清單
- [x] DEVILS_ADVOCATE — 反向測試問題

### 1.2 Handler 整合 `src/plugins/core/quick-think.mjs`

- [x] Layer 1 整合
- [x] Layer 2 整合
- [x] Layer 3 整合
- [x] classifyTask 子指令
- [x] smart_think 描述更新

### 1.3 測試

- [x] think-guard.test.mjs — 基礎單元測試（20 tests）
- [x] think-guard-comprehensive.test.mjs — 完整功能測試（80 tests）
- [x] think-guard-realworld.test.mjs — 真實世界測試（47 tests）

### 1.4 文件

- [x] think_plan.md — 計畫書
- [x] think_todo.md — 本檔案

---

## ✅ Phase 2：進階功能（已完成）

### 2.1 動態閾值

- [x] getDynamicThreshold(remainingFraction) — 根據 context budget 動態調整 overconfidence threshold
- [x] budget < 20% → threshold +2（非常保守）
- [x] budget 20%–40% → threshold +1（保守）
- [x] budget 40%–60% → 基礎閾值（平衡）
- [x] budget 60%–80% → threshold -1（積極）
- [x] budget > 80% → threshold -2（非常積極）
- [x] detectOverconfidence 整合 budgetFraction 參數

### 2.2 歷史學習

- [x] recordClassification(record) — 記錄分類結果
- [x] getHistoryStats() — 統計分類準確率
- [x] clearHistory() — 清空歷史
- [x] MAX_HISTORY = 200 自動截斷
- [x] Handler 整合歷史記錄

### 2.3 跨工具整合

- [x] DOMAIN_RULES — 3 個領域規則（eda/exa/medical）
- [x] detectDomain(task) — 領域偵測
- [x] 各領域 overconfidenceBoost 調整
- [x] 各領域 verifyAdditions 領域特定檢查
- [x] Handler 整合領域特定 VERIFY

### 2.4 並發安全

- [x] getSessionState(sessionId) — Session 隔離狀態
- [x] clearSessionState(sessionId) — 清除 Session
- [x] pruneStaleSessions(maxAge) — 清理過期 Session

### 2.5 測試

- [x] think-guard-phase2.test.mjs — Phase 2 功能測試（59 tests，含 Phase 3 Fix）

---

## 🔲 Phase 3：基於學術研究（Token 優先） — 大部分延後

> 基於 2025-2026 年最新論文分析，Phase 3 採取**最小 Token 損耗**策略。
> 參考：Premature Confidence (2025)、ReBalance (2025)、Think Just Enough (EACL 2026)、ConFix (2024)

### 3.1 Underthinking 偵測（P1 — 零成本） ⭐ 最高優先

- [ ] 在 `classifyThinkingMode` 加入反向規則
- [ ] 偵測「太早結束」模式（只分析 A 未比較 B）
- [ ] 複用現有 `branchingNeeded` 欄位
- [ ] Token 成本：0（純規則）

### 3.2 Confidence Trajectory 追蹤（P2 — 條件觸發）

- [ ] 只在 `branchingNeeded=true` 時追蹤（非每次 CIT）
- [ ] 複用 `branchReasoning` 欄位，不新增欄位
- [ ] 在 branchReasoning 中加入 underthinking 訊號
- [ ] Token 成本：~20-30 token（僅 5% 呼叫觸發）

### 3.3 Self-Correction Prompt（P3 — 高風險限定）

- [ ] 偵測到過度自信 + `taskRisk === 'high'` → 注入修正 prompt
- [ ] 其他任務只建議切換 mode（不注入）
- [ ] Token 成本：~30-50 token（僅高風險任務觸發）

### 3.4 更多領域（P4 — 模組化擴充）

- [ ] finance — 金融分析（與 stock-quant-analyzer 互補）
- [ ] legal — 法律文件分析
- [ ] science — 科學研究
- [ ] 採用 plugin 架構（每個領域一個 .mjs）

### Phase 3 不做的事

- ❌ 形式化驗證（VeriCoT）— 成本太高（+200-500 token）
- ❌ A/B 測試框架 — 需大量數據，建議 Phase 3.5+
- ❌ 可視化儀表板 — 非核心，建議用 Markdown 報告
- ❌ PANL probe（二階信心）— 需要 logprobs，短期不可行

---

## 🐛 已知問題

### 高優先級

| # | 描述 | 狀態 |
|---|------|------|
| 1 | classifyThinkingMode 對中文「分析」觸發率偏低 | ✅ 已修復（+12 個中文觸發詞） |
| 2 | detectOverconfidence 的 threshold 動態範圍 2-4 可能需微調 | ✅ 已修復（擴展為 5 級範圍 1-5） |
| 3 | enhanceVerifyStage 的 complementarity 觸發詞不包含「vs」 | ✅ 已修復（vs/versus 已加入觸發詞） |

### 中優先級

| # | 描述 | 狀態 |
|---|------|------|
| 4 | classifyTask 空字串走正常 handler 路徑 | ✅ 預期行為 |
| 5 | CIT 輸出格式為 "Thought N/N" 而非 "Round N" | ✅ 已修正測試 |
| 6 | DOMAIN_RULES 目前僅 3 個領域，可擴展 | ✅ 已知限制 |

---

## 📊 測試統計

| 測試檔 | 數量 | 通過 | 失敗 | 覆蓋率 |
|--------|------|------|------|--------|
| think-guard.test.mjs | 20 | 20 | 0 | 100% |
| think-guard-comprehensive.test.mjs | 80 | 80 | 0 | 100% |
| think-guard-realworld.test.mjs | 47 | 47 | 0 | 100% |
| think-guard-phase2.test.mjs | 59 | 59 | 0 | 100% |
| **合計** | **206** | **206** | **0** | **100%** |

### 測試執行時間

| 測試檔 | 時間 |
|--------|------|
| think-guard.test.mjs | ~110ms |
| think-guard-comprehensive.test.mjs | ~129ms |
| think-guard-realworld.test.mjs | ~123ms |
| think-guard-phase2.test.mjs | ~121ms |
| **合計** | **~483ms** |

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-17 | v1.0 | Phase 1 完成，147 測試通過 |
| 2026-07-17 | v1.0 | 建立 think_plan.md 和 think_todo.md |
| 2026-07-17 | v2.0 | Phase 2 完成：動態閾值 + 歷史學習 + 跨工具整合 + 並發安全，187 測試通過 |
| 2026-07-17 | v2.1 | Bug Fix #1: 中文「分析」觸發率增強（+12 個中文觸發詞） |
| 2026-07-17 | v2.2 | Bug Fix #2: Threshold 動態範圍從 3 級擴展為 5 級（範圍 1-5） |
| 2026-07-17 | v2.3 | 測試更新：think-guard-phase2.test.mjs 從 40 增加到 59 個測試 |

---

## 🎯 下一步

1. **觀察 1-2 週** — 收集實際使用數據（動態閾值、中文觸發率）
2. **決定是否做 P1** — Underthinking 偵測（需觀察是否有 false positive）
3. **決定是否做 P4** — 更多領域規則（finance/legal/science）
