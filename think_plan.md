# Think-Guard 計畫書

## 📋 專案概要

| 項目 | 內容 |
|------|------|
| **專案名稱** | Think-Guard 3 層防禦系統 |
| **所屬專案** | Smart MCP（`~/opencode/dev/smart`） |
| **建立日期** | 2026-07-17 |
| **狀態** | ✅ 核心實作完成，測試通過 |

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
│   └── think-guard.mjs          # 核心模組（260 行）
│       ├── classifyThinkingMode()   # Layer 1
│       ├── detectOverconfidence()   # Layer 2
│       ├── enhanceVerifyStage()     # Layer 3
│       ├── TASK_MODE_RULES          # 分類規則（20 條）
│       ├── OVERCONFIDENCE_INDICATORS # 過度自信指標（12 條）
│       ├── SCOPE_QUESTIONS          # 範圍限定問題（3 個）
│       ├── COMPLEMENTARITY_CHECKLIST # 互補判定清單（4 項）
│       └── DEVILS_ADVOCATE          # 反向測試問題
└── plugins/core/
    └── quick-think.mjs          # Handler 整合（300 行）
        ├── Layer 1 整合（L206-214）
        ├── Layer 2 整合（L216-229）
        ├── Layer 3 整合（L231-239）
        └── classifyTask 子指令（L189-203）

tests/
├── think-guard.test.mjs              # 基礎單元測試（20 tests）
├── think-guard-comprehensive.test.mjs # 完整功能測試（80 tests）
└── think-guard-realworld.test.mjs     # 真實世界測試（47 tests）
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

**分類規則（TASK_MODE_RULES）：**

| 規則 | 觸發詞 | 建議模式 |
|------|--------|---------|
| 複雜（beam） | 重構.*跨檔案, rename.*across, 安全.*修復, 注入.*修復 | beam |
| 複雜（cit+forceBranch） | 優缺點, pros.*and.*cons, 好處.*壞處, 利弊 | cit + forceBranch |
| 中等（cit） | 為什麼, why, 如何, how, 分析.*差異, 比較.*不同 | cit |
| 簡易（null） | 搜尋, grep, find, 讀取, query | null |
| 長度 fallback | > 50 字元 | cit |

### detectOverconfidence(thought, branchReasoning, branchingNeeded, mode)

過度自信偵測器。當 CIT 說不分支時，檢查是否過度自信。

```javascript
// 回傳值
{
  overconfident: boolean,    // score >= 4
  reason: string,
  suggestedUpgrade: 'beam' | null
}
```

**過度自信指標（OVERCONFIDENCE_INDICATORS）：**

| 指標 | 權重 |
|------|------|
| 工具.*選擇, tool.*select | 3 |
| 抽象.*層級, 協議.*層, 個體.*群體 | 4 |
| 比較.*多個, 跨來源 | 3 |
| 分析.*差異, 分析.*比較 | 4 |
| 優缺點, pros.*and.*cons | 4 |
| 架構.*選擇, 技術.*評估 | 3 |
| 安全.*分析, 風險.*評估 | 3 |

**閾值：score >= 4 觸發**（需至少 2 個指標或 1 個高權重指標）

### enhanceVerifyStage(verifyText, thought)

VERIFY 階段增強器。自動加入 3 個檢查：

1. **範圍限定檢查**（SCOPE_QUESTIONS）
   - 這個結論的適用範圍是？（個體實作 / 群體統計 / 協議層規範）
   - 如果反過來看，這個結論成立嗎？
   - 這份數據的來源層級是？

2. **互補 vs 重疊判定**（僅比較任務）
   - 資料源是否相同？
   - 使用場景是否相同？
   - 路由規則是否明確？
   - 是否有 fallback 關係？

3. **反向測試**（DEVILS_ADVOCATE）
   - 如果這個優點不存在，會有什麼影響？
   - 如果去掉這個限制，會發生什麼？

---

## 🧪 測試覆蓋

| 測試檔 | 數量 | 覆蓋範圍 |
|--------|------|----------|
| think-guard.test.mjs | 20 | 基礎單元（分類/偵測/增強/常數） |
| think-guard-comprehensive.test.mjs | 80 | 完整功能（簡單→複雜→真實案例→邊界→整合→token） |
| think-guard-realworld.test.mjs | 47 | 真實世界（對話查詢→子指令→多回合→跨層級→對抗性→壓力） |
| **合計** | **147** | — |

### 測試矩陣

| 場景 | 測試數 | 預期行為 |
|------|--------|---------|
| 簡易問題（搜尋/grep/查詢） | 10 | 返回 null |
| 中等問題（why/how/分析） | 19 | 返回 cit |
| 複雜問題（重構/安全/rename） | 19 | 返回 beam 或 cit+forceBranch |
| 實際問題（從對話提取） | 18 | 保守派正確返回 null |
| 邊界情況（空值/超長/特殊字元） | 19 | 不崩潰 |
| 過度自信偵測 | 11 | 正確觸發/不觸發 |
| VERIFY 增強 | 12 | 正確加入檢查內容 |
| 整合測試 | 8 | Handler 端到端 |
| 壓力測試 | 5 | 100 次呼叫 < 1 秒 |
| 輸出格式 | 5 | 正確標籤/格式 |
| 端到端工作流 | 3 | 完整流程 |

---

## 📊 效能指標

| 指標 | 目標 | 實際 |
|------|------|------|
| 100 次 classifyThinkingMode | < 1s | ~0.6ms ✓ |
| 100 次 detectOverconfidence | < 1s | ~0.2ms ✓ |
| 100 次 enhanceVerifyStage | < 1s | ~0.5ms ✓ |
| Token 消耗（CIT mode） | < 150 | ~80-120 ✓ |
| Token 消耗（structured mode） | < 250 | ~150-200 ✓ |

---

## 🔮 未來擴展

### Phase 2（待辦）

1. **動態閾值** — 根據 context budget 動態調整 overconfidence threshold
2. **歷史學習** — 記錄過去的分類準確率，自動調整規則權重
3. **跨工具整合** — 與 smart_eda_search、smart_exa_search 聯動
4. **並發安全** — 多個 handler 同時執行時的狀態隔離

### Phase 3（願景）

1. **自適應規則** — 根據使用者歷史行為自動生成/停用規則
2. **A/B 測試** — 比較有/無 think-guard 的推理品質
3. **可視化儀表板** — 顯示分類統計、過度自信偵測率、token 節省量

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-17 | v1.0 | 核心實作完成，147 測試通過 |
