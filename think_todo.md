# Think-Guard 追蹤清單

## 📋 當前狀態

| 項目 | 狀態 |
|------|------|
| **整體進度** | 🟢 Phase 1 完成 |
| **測試狀態** | ✅ 147/147 通過 |
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

- [x] Layer 1 整合（L206-214）
- [x] Layer 2 整合（L216-229）
- [x] Layer 3 整合（L231-239）
- [x] classifyTask 子指令（L189-203）
- [x] smart_think 描述更新

### 1.3 測試

- [x] think-guard.test.mjs — 基礎單元測試（20 tests）
- [x] think-guard-comprehensive.test.mjs — 完整功能測試（80 tests）
- [x] think-guard-realworld.test.mjs — 真實世界測試（47 tests）

### 1.4 文件

- [x] think_plan.md — 計畫書
- [x] think_todo.md — 本檔案

---

## 🔲 Phase 2：進階功能（待辦）

### 2.1 動態閾值

- [ ] 根據 context budget 動態調整 overconfidence threshold
- [ ] budget < 30% 時提高 threshold（減少誤觸發）
- [ ] budget > 60% 時降低 threshold（更積極偵測）

### 2.2 歷史學習

- [ ] 記錄 classifyThinkingMode 的分類結果
- [ ] 統計過度自信偵測的準確率
- [ ] 根據歷史數據自動調整規則權重

### 2.3 跨工具整合

- [ ] 與 smart_eda_search 聯動（EDA 領域特定規則）
- [ ] 與 smart_exa_search 聯動（廣度搜尋特定規則）
- [ ] 與 smart_medical_search 聯動（醫學領域特定規則）

### 2.4 並發安全

- [ ] 多個 handler 同時執行時的狀態隔離
- [ ] 全域狀態鎖機制
- [ ] 並發測試

---

## 🔮 Phase 3：願景（規劃中）

### 3.1 自適應規則

- [ ] 根據使用者歷史行為自動生成規則
- [ ] 根據使用頻率自動停用無效規則
- [ ] 規則權重動態調整演算法

### 3.2 A/B 測試框架

- [ ] 比較有/無 think-guard 的推理品質
- [ ] 量化 think-guard 對推理錯誤的改善程度
- [ ] 統計顯著性檢驗

### 3.3 可視化儀表板

- [ ] 分類統計圖表
- [ ] 過度自信偵測率趨勢
- [ ] Token 節省量統計
- [ ] 測試覆蓋率儀表板

---

## 🐛 已知問題

### 高優先級

| # | 問述 | 狀態 |
|---|------|------|
| 1 | classifyThinkingMode 對中文「分析」觸發率偏低 | ⚠️ 待觀察 |
| 2 | detectOverconfidence 的 threshold=4 可能過高 | ⚠️ 待觀察 |
| 3 | enhanceVerifyStage 的 complementarity 觸發詞不包含「vs」 | ✅ 已知 |

### 中優先級

| # | 描述 | 狀態 |
|---|------|------|
| 4 | classifyTask 空字串走正常 handler 路徑 | ✅ 預期行為 |
| 5 | CIT 輸出格式為 "Thought N/N" 而非 "Round N" | ✅ 已修正測試 |

---

## 📊 測試統計

| 測試檔 | 數量 | 通過 | 失敗 | 覆蓋率 |
|--------|------|------|------|--------|
| think-guard.test.mjs | 20 | 20 | 0 | 100% |
| think-guard-comprehensive.test.mjs | 80 | 80 | 0 | 100% |
| think-guard-realworld.test.mjs | 47 | 47 | 0 | 100% |
| **合計** | **147** | **147** | **0** | **100%** |

### 測試執行時間

| 測試檔 | 時間 |
|--------|------|
| think-guard.test.mjs | ~82ms |
| think-guard-comprehensive.test.mjs | ~85ms |
| think-guard-realworld.test.mjs | ~79ms |
| **合計** | **~246ms** |

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-17 | v1.0 | Phase 1 完成，147 測試通過 |
| 2026-07-17 | v1.0 | 建立 think_plan.md 和 think_todo.md |

---

## 🎯 下一步

1. **觀察期** — 使用 1-2 週，收集分類準確率數據
2. **調整** — 根據觀察結果調整 threshold 和規則
3. **Phase 2** — 開始動態閾值和歷史學習功能
