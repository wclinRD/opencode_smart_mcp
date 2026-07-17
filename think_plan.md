# Think-Guard 計畫書

## 📋 專案概要

| 項目 | 內容 |
|------|------|
| **專案名稱** | Think-Guard 3 層防禦系統 |
| **所屬專案** | Smart MCP（`~/opencode/dev/smart`） |
| **建立日期** | 2026-07-17 |
| **狀態** | ✅ Phase 2 + Bug Fixes 完成，206 測試通過 |

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
│   │   ├── classifyThinkingMode()   # Layer 1（Phase 3 Fix #1: 中文增強）
│   │   ├── detectOverconfidence()   # Layer 2（Phase 2.1: 動態閾值 5 級）
│   │   ├── enhanceVerifyStage()     # Layer 3
│   │   ├── TASK_MODE_RULES          # 分類規則（32 條，含中文觸發詞）
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
└── think-guard-phase2.test.mjs        # Phase 2 功能測試（59 tests，含 Phase 3 Fix）
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
| < 20% | +2（非常保守） | 最大限度減少誤觸發 |
| 20%–40% | +1（保守） | 減少誤觸發，節省 token |
| 40%–60% | 0（基礎） | 平衡 |
| 60%–80% | -1（積極） | 更積極偵測 |
| > 80% | -2（非常積極） | 最大限度偵測過度自信 |

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
| think-guard-phase2.test.mjs | 59 | Phase 2 + Phase 3 Fix（動態閾值 5 級→中文觸發率→歷史學習→跨工具整合→並發安全→整合→壓力） |
| **合計** | **206** | — |

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

### Phase 3（基於學術研究，Token 優先）

基於 2025-2026 年最新論文（Premature Confidence、ReBalance、Think Just Enough、Layered-CoT、ConFix）的分析，Phase 3 採取**最小 Token 損耗**策略：

#### 3.1 Underthinking 偵測（P1 — 零成本）

**來源**：ReBalance (2025)、Think Just Enough (EACL 2026)

> 學術發現：overthinking（推理太長）和 underthinking（推理太短）都是問題。
> Think-Guard 目前只處理 overthinking，未處理 underthinking。

**實作**：在 `classifyThinkingMode` 加入反向規則 — 偵測「太早結束」的模式：
- 「比較 A 和 B」→ 但只分析了 A → 需要分支
- 「優缺點分析」→ 只有優點 → 需要分支
- 「分析 X 的影響」→ 只正面 → 需要分支

**Token 成本**：0（純規則，複用現有結構）

#### 3.2 Confidence Trajectory 追蹤（P2 — 條件觸發）

**來源**：Premature Confidence (arxiv 2605.24396)

> 學術發現：模型在 CoT 20% 處就 commitment，剩餘 80% 推理已無法改變答案。
> 大型模型更嚴重。

**實作**：只在 `branchingNeeded=true` 時追蹤信心變化（非每次 CIT）：
- 複用 `branchReasoning` 欄位，不新增欄位
- 在 branchReasoning 中加入 underthinking 訊號

**Token 成本**：~20-30 token（僅 5% 呼叫觸發）

#### 3.3 Self-Correction Prompt（P3 — 高風險限定）

**來源**：ConFix (2024)、Self-Check Pattern (2026)

> 學術發現：用高信心事實修正低信心事實，不需要外部知識。
> Think-Guard 偵測到問題後只建議切換 mode，未嘗試修正推理。

**實作**：只在高風險任務（安全/重構）時注入修正指令：
- 偵測到過度自信 + `taskRisk === 'high'` → 注入修正 prompt
- 其他任務只建議切換 mode

**Token 成本**：~30-50 token（僅高風險任務觸發）

#### 3.4 更多領域（P4 — 模組化擴充）

**來源**：現有 `DOMAIN_RULES` 架構

**實作**：採用 plugin 架構，每個領域一個 `.mjs`：
- finance — 與 `stock-quant-analyzer` skill 互補
- legal — 法律文件分析
- science — 科學研究

**Token 成本**：0（純規則擴充）

### Phase 3 不做的事

| 功能 | 理由 |
|------|------|
| 形式化驗證（VeriCoT） | 成本太高（+200-500 token），不符合 Think-Guard 理念 |
| A/B 測試框架 | 需大量數據，建議 Phase 3.5+ |
| 可視化儀表板 | 非核心功能，建議用 Markdown 報告或對接 Obsidian |
| PANL probe（二階信心） | 需要 logprobs，短期不可行 |

### Phase 3 Token 預算

| 功能 | 觸發率 | 每次成本 | 年化成本（1000 次） |
|------|--------|---------|-------------------|
| P1: Underthinking | 100%（CIT） | 0 token | 0 |
| P2: Confidence trajectory | 5% | 20-30 token | 20K-30K |
| P3: Self-correction | 5%（高風險） | 30-50 token | 30K-50K |
| P4: 更多領域 | 100%（領域任務） | 0 token | 0 |
| **合計** | — | — | **+50K-80K token/年** |

**結論**：Phase 3 整體 token 增加 < 80%，主要來自 P2 和 P3 的條件觸發。

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-17 | v1.0 | Phase 1 核心實作完成，147 測試通過 |
| 2026-07-17 | v2.0 | Phase 2 完成：動態閾值 + 歷史學習 + 跨工具整合 + 並發安全，187 測試通過 |
| 2026-07-17 | v2.1 | Bug Fix #1: 中文「分析」觸發率增強（+12 個中文觸發詞） |
| 2026-07-17 | v2.2 | Bug Fix #2: Threshold 動態範圍從 3 級擴展為 5 級（範圍 1-5） |
| 2026-07-17 | v3.0 | Phase 3 規劃：基於學術研究（Premature Confidence/ReBalance/ConFix），Token 優先策略 |
