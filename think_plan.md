# Think-Guard 計畫書

## 📋 專案概要

| 項目 | 內容 |
|------|------|
| **專案名稱** | Think-Guard 3 層防禦系統 |
| **所屬專案** | Smart MCP（`~/opencode/dev/smart`） |
| **建立日期** | 2026-07-17 |
| **狀態** | ✅ Phase 2 完成，187 測試通過 |

---

## 🎯 目標

解決 `smart_smart_think` 推理錯誤問題：

1. **過度自信** — CIT 模式說 `branchingNeeded=false`，但任務其實需要多路徑探索
2. **範圍混淆** — 把 MCP 協議層的統計套用到 Smart MCP 個體實作
3. **分類不當** — 把互補工具（smart_exa_search vs smart_eda_search）誤判為「邊界模糊」

---

## 🏗 架構設計

### 3 層防禦

```
任務來 →
  ├─ Layer 1: classifyThinkingMode（任務分類）
  │   └─ 自動建議 thinking mode（CIT/beam/structured/null）
  ├─ Layer 2: detectOverconfidence（過度自信偵測）
  │   └─ CIT 說不分支？檢查是否過度自信 → 建議改 beam
  └─ Layer 3: enhanceVerifyStage（VERIFY 增強）
      └─ structured 模式自動加入範圍限定 + 互補判定 + 反向測試
```

### 觸發條件（Token 優化）

| 層級 | 觸發條件 | 不觸發時 |
|------|---------|---------|
| Layer 1 | 使用者沒指定 mode | 零成本 |
| Layer 2 | CIT + `branchingNeeded=false` | 零成本 |
| Layer 3 | structured + verify 欄位存在 | 零成本 |

**結論：不浪費 token** — 三層全部有條件觸發。

---

## 📁 檔案結構

```
src/
├── lib/
│   ├── think-guard.mjs          # 核心模組（480 行）
│   │   ├── classifyThinkingMode()   # Layer 1
│   │   ├── detectOverconfidence()   # Layer 2（Phase 2.1: 動態閾值）
│   │   ├── enhanceVerifyStage()     # Layer 3
│   │   ├── TASK_MODE_RULES          # 分類規則（20 條）
│   │   ├── OVERCONFIDENCE_INDICATORS # 過度自信指標（12 條）
│   │   ├── SCOPE_QUESTIONS          # 範圍限定問題（3 個）
│   │   ├── COMPLEMENTARITY_CHECKLIST # 互補判定清單（4 項）
│   │   ├── DEVILS_ADVOCATE          # 反向測試問題
│   │   ├── getDynamicThreshold()    # Phase 2.1: 動態閾值
│   │   ├── recordClassification()   # Phase 2.2: 歷史記錄
│   │   ├── getHistoryStats()        # Phase 2.2: 歷史統計
│   │   ├── clearHistory()           # Phase 2.2: 清空歷史
│   │   ├── DOMAIN_RULES             # Phase 2.3: 領域規則
│   │   ├── detectDomain()           # Phase 2.3: 領域偵測
│   │   ├── getSessionState()        # Phase 2.4: Session 狀態
│   │   ├── clearSessionState()      # Phase 2.4: 清除 Session
│   │   └── pruneStaleSessions()     # Phase 2.4: 清理過期 Session
│   └── context-budget.mjs       # Context Budget 管理
└── plugins/core/
    └── quick-think.mjs          # Handler 整合（331 行）
        ├── Layer 1 整合
        ├── Layer 2 整合（Phase 2.1: 動態閾值）
        ├── Layer 3 整合（Phase 2.3: 領域特定 VERIFY）
        ├── classifyTask 子指令
        └── Phase 2.2: 歷史記錄整合

tests/
├── think-guard.test.mjs              # 基礎單元測試（20 tests）
├── think-guard-comprehensive.test.mjs # 完整功能測試（80 tests）
├── think-guard-realworld.test.mjs     # 真實世界測試（47 tests）
└── think-guard-phase2.test.mjs        # Phase 2 功能測試（40 tests）
```

---

## 🔧 核心 API

### classifyThinkingMode(taskDescription, currentMode?)

任務分類器。根據關鍵詞自動建議 thinking mode。

```javascript
// 回傳值
{
  suggestedMode: 'cit' | 'beam' | 'structured' | null,
  reason: string,
  forceBranch: boolean
}
```

### detectOverconfidence(thought, branchReasoning, branchingNeeded, mode, opts?)

過度自信偵測器。Phase 2.1 整合動態閾值。

```javascript
// 回傳值（Phase 2 新增 score, threshold, domain）
{
  overconfident: boolean,
  reason: string,
  suggestedUpgrade: 'beam' | null,
  score: number,        // Phase 2.1
  threshold: number,    // Phase 2.1
  domain: string|null   // Phase 2.3
}
```

**動態閾值策略：**

| Budget 剩餘 | 閾值調整 | 效果 |
|-------------|---------|------|
| < 30% | +1（提高） | 減少誤觸發，節省 token |
| 30%–60% | 0（基礎） | 平衡 |
| > 60% | -1（降低） | 更積極偵測 |

### getDynamicThreshold(remainingFraction)

根據 context budget 回傳調整後的閾值。

### recordClassification(record) / getHistoryStats()

歷史學習 API。記錄分類結果並提供統計分析。

### detectDomain(task)

領域偵測。回傳 `{ domain, rules }` 或 `{ domain: null, rules: null }`。

### DOMAIN_RULES

```javascript
{
  eda: { name, patterns, overconfidenceBoost: 0, verifyAdditions: [...] },
  exa: { name, patterns, overconfidenceBoost: -1, verifyAdditions: [...] },
  medical: { name, patterns, overconfidenceBoost: +1, verifyAdditions: [...] },
}
```

### getSessionState(sessionId) / clearSessionState(sessionId)

並發安全 API。Session 隔離的狀態管理。

---

## 🧪 測試覆蓋

| 測試檔 | 數量 | 覆蓋範圍 |
|--------|------|----------|
| think-guard.test.mjs | 20 | 基礎單元（分類/偵測/增強/常數） |
| think-guard-comprehensive.test.mjs | 80 | 完整功能（簡單→複雜→真實案例→邊界→整合→token） |
| think-guard-realworld.test.mjs | 47 | 真實世界（對話查詢→子指令→多回合→跨層級→對抗性→壓力） |
| think-guard-phase2.test.mjs | 40 | Phase 2（動態閾值→歷史學習→跨工具整合→並發安全→整合→壓力） |
| **合計** | **187** | — |

---

## 📊 效能指標

| 指標 | 目標 | 實際 |
|------|------|------|
| 100 次 classifyThinkingMode | < 1s | ~0.6ms ✓ |
| 100 次 detectOverconfidence | < 1s | ~0.2ms ✓ |
| 100 次 enhanceVerifyStage | < 1s | ~0.5ms ✓ |
| 100 次 recordClassification + getHistoryStats | < 1s | ~0.9ms ✓ |
| 100 次 detectDomain | < 1s | ~0.6ms ✓ |
| Token 消耗（CIT mode） | < 150 | ~80-120 ✓ |
| Token 消耗（structured mode） | < 250 | ~150-200 ✓ |

---

## 🔮 未來擴展

### Phase 3（規劃中）

1. **歷史學習進階** — 根據 accuracyRate 自動調整 TASK_MODE_RULES 權重
2. **A/B 測試** — 比較有/無 think-guard 的推理品質
3. **可視化儀表板** — 分類統計、過度自信偵測率、token 節省量
4. **更多領域** — 加入 finance、legal、science 等領域規則

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-17 | v1.0 | Phase 1 核心實作完成，147 測試通過 |
| 2026-07-17 | v2.0 | Phase 2 完成：動態閾值 + 歷史學習 + 跨工具整合 + 並發安全，187 測試通過 |
