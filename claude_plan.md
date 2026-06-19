# Claude Code 無限上下文 — Smart MCP 實作計畫

**目標**：在 Smart MCP 中實現多層 Context Engineering，使 local LLM 在 32K-128K 窗口內達到「無限上下文」效果。

## 架構總覽

```
Context Pressure Monitor
    │
    ├─ P0: MicroCompact (工具結果壓縮)      ← 馬上做，零成本高回報
    ├─ P1: Sub-agent Context 隔離強化       ← 已有 task 機制，改造即可
    ├─ P2: 結構化 Full Compact              ← 需 LLM 呼叫，一次成本
    ├─ P3: 背景 Session Memory              ← 需 fork agent 持續蒸餾
    └─ P4: 自動回填機制                     ← 壓縮後自動載入關鍵檔案
```

## 原則

1. **最低成本優先** — 能截斷不摘要，能 reuse 不清除
2. **資訊分級** — 語義走摘要、狀態走附件、永久走快取
3. **防禦性設計** — 遞歸保護、斷路器、sticky-on
4. **Local LLM 無 cache_edits** — 改以 messages array 手術代替

---

## P0: MicroCompact — 工具結果清理

**優先度**: 🔴 P0
**成本**: 零 LLM 呼叫，純邏輯
**回報**: 減少 ~30-50% context 壓力

### 做法

每次 tool call 完成後：

```
1. 保留最近 N=5 個工具結果（含當前）
2. N+1 及更舊的結果 → 替換為 "[Old tool result cleared]"
3. 超大字數結果（>50K chars）→ 截斷為 2KB 預覽 + 完整存檔
```

### 驗收
- [ ] 100 回合對話後 context 不超過初始 2x

---

## P1: Sub-agent Context 隔離強化

**優先度**: 🟠 P1
**成本**: 架構修改，無 LLM 成本
**回報**: 重度任務（搜尋/爬蟲/讀大量檔）不污染主 context

### 做法

```
1. 現有 task() 機制已有獨立 context
2. 新增限制：subagent 回傳主 agent 的內容 ≤ 4K tokens
3. 超量內容自動摘要化（摘要 prompt 另定）
4. 多 subagent 平行執行時各自獨立
```

### 驗收
- [ ] subagent 讀 50 個檔案後主 agent context 不膨脹

---

## P2: 結構化 Full Compact

**優先度**: 🟡 P2
**成本**: 每次 1 次 LLM 呼叫
**回報**: 壓縮率 80-95%

### 做法

觸發時機：當 context 達 effective window × 83% 時（可設定）

```
1. 收集所有 messages
2. 呼叫 LLM 產生 9 區塊結構化摘要：
   - Goal：當前目標
   - Technical：技術方案/修改
   - Errors：錯誤與解決
   - Files：已讀/修改檔案列表
   - Commands：執行過的重要指令
   - Todos：待辦事項
   - Decisions：關鍵決策與原因
   - State：非同步任務狀態
   - Context：環境/專案背景
3. 使用兩階段 CoT Scratchpad：
   - 模型先推理（確保品質），然後只保留結論（節省 tokens）
   - "Discard the work, keep the conclusion."
4. 替換舊 messages 為摘要訊息
```

### 2A: Context Collapse（可逆折疊）

在 P2 之上強化：

```
1. 原始 messages 不刪除，另存到 collapse store（檔案或 DB）
2. 傳給 LLM 時動態產生壓縮視圖
3. 支援 rollback：可展開回原始對話
```

### 驗收
- [ ] 壓縮後對話仍可正確繼續
- [ ] 壓縮率 ≥ 80%
- [ ] Collapse rollback 可還原原始 messages

---

## P3: 背景 Session Memory

**優先度**: 🟢 P3
**成本**: 每 ~5K tokens 1 次輕量 LLM 呼叫（分散成本）
**回報**: Full Compact 時零延遲

### 做法

```
1. 在背景啟動 fork agent
2. 每累積 ~5K tokens 新對話，更新 session memory 文件
3. Full Compact 時直接用此記憶取代 LLM 摘要呼叫
4. Session memory 結構同一 9 區塊格式
```

### 驗收
- [ ] Full Compact 時無需等待 LLM 摘要

---

## P4: 自動回填機制

**優先度**: 🟢 P4
**成本**: 純邏輯，零 LLM
**回報**: 壓縮後關鍵資訊不遺失

### 做法

```
1. 壓縮完成後清除 file state cache
2. 自動重新讀取最近 5 個檔案（各 5K tokens 上限）
3. 自動重新載入專案規則（SMART.md / AGENTS.md）
4. 自動重新注入待辦事項狀態
```

### 驗收
- [ ] 壓縮回填後檔案內容與規則仍可用

---

## 模型特定設定

| 模型 | Window | Auto-compact 門檻 (83%) | 備註 |
|------|--------|------------------------|------|
| Gemma 4 E4B | 114,688 | ~95,000 | 已設定 limit.input |
| Qwen3.5-9B-Flash | 98,304 | ~81,500 | 已設定 limit.input |
| Qwen3.5-4B-MTP | 40,960 | ~34,000 | 已設定 limit.input |

## 已知限制

- **Local LLM 無 cache_edits 等效**：改用 messages array 內直接移除+插入替代
- **Summarizer 品質依賴模型能力**：4B 模型摘要效果差，9B+ 較可靠
- **Session Memory fork agent**：需確保背景 agent 不干擾主對話流程

---

## 參考資料

- `20-工作/22-開發/opencode/claude-code-infinite-context-architecture`（Obsidian wiki）
- [[opencode-compaction-limit-input]] — 現有 per-model limit.input 設定
- [[opencode-compaction-investigation]] — OpenCode 內建 prune 未生效調查
- [[task-subagent-routing-injection]] — 現有 subagent routing 機制
