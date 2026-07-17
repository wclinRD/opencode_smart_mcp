# Think-Guard 追蹤清單

## 📋 當前狀態

| 項目 | 狀態 |
|------|------|
| **整體進度** | 🟢 Phase 2 完成 |
| **測試狀態** | ✅ 187/187 通過 |
| **最後更新** | 2026-07-17 |

---

## ✅ Phase 1：核心實作（已完成）

### 1.1 核心模組 `src/lib/think-guard.mjs`

- [x] classifyThinkingMode() — 任務分類器
- [x] detectOverconfidence() — 過度自信偵測
- [x] enhanceVerifyStage() — VERIFY 增強
- [x] TASK_MODE_RULES — 20 條分類規則
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
- [x] budget < 30% → threshold +1（減少誤觸發）
- [x] budget > 60% → threshold -1（更積極偵測）
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

- [x] think-guard-phase2.test.mjs — Phase 2 功能測試（40 tests）

---

## 🔲 Phase 3：願景（規劃中）

### 3.1 歷史學習進階

- [ ] 根據 accuracyRate 自動調整 TASK_MODE_RULES 權重
- [ ] 歷史資料持久化（JSON 檔案）
- [ ] 分類模式分析（哪類任務最容易誤判）

### 3.2 A/B 測試框架

- [ ] 比較有/無 think-guard 的推理品質
- [ ] 量化 think-guard 對推理錯誤的改善程度
- [ ] 統計顯著性檢驗

### 3.3 可視化儀表板

- [ ] 分類統計圖表
- [ ] 過度自信偵測率趨勢
- [ ] Token 節省量統計

### 3.4 更多領域

- [ ] finance — 金融分析領域
- [ ] legal — 法律文件領域
- [ ] science — 科學研究領域

---

## 🐛 已知問題

### 高優先級

| # | 描述 | 狀態 |
|---|------|------|
| 1 | classifyThinkingMode 對中文「分析」觸發率偏低 | ⚠️ 待觀察 |
| 2 | detectOverconfidence 的 threshold 動態範圍 2-4 可能需微調 | ⚠️ 待觀察 |
| 3 | enhanceVerifyStage 的 complementarity 觸發詞不包含「vs」 | ✅ 已知 |

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
| think-guard-phase2.test.mjs | 40 | 40 | 0 | 100% |
| **合計** | **187** | **187** | **0** | **100%** |

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

---

## 🎯 下一步

1. **觀察期** — 使用 1-2 週，收集動態閾值和歷史學習數據
2. **調整** — 根據觀察結果調整 threshold 範圍和領域規則
3. **Phase 3** — 開始歷史學習進階和 A/B 測試框架
