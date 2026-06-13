# Smart MCP — 完整強化路線圖

> 最後更新：2026-06-13 (M10 regression ✅)
> 基於競爭品分析（smart-mcp、MCPlex、Continuum、Tool Compass、mcpflow-router、ReasonKit Think 等）
> 與前沿技術研究（Structured CoT、MCTS Tool Planning、Meta-Reasoning、Self-Evolving Codegen 等）

---

## 競爭情資摘要（2026-06-13 研究）

### 直接競爭：MCP 智慧路由 / 工具代理

| 競爭品 | 核心差異 | Smart MCP 定位 |
|--------|---------|---------------|
| **smart-mcp** (spak2005) | FAISS 語義搜尋，2-tool surface，97% token 省 | ⚠️ 同名混淆。他們做 MCP proxy 層工具路由；Smart MCP 做 agent 智慧層。互補 |
| **MCPlex** (ModernOps888) | Rust 單一二進位 gateway，RBAC + audit + dashboard | Smart MCP 更輕量、更 agent-native；MCPlex 更企業級 |
| **Continuum** (redstone-md) | 跨 agent 持久記憶 daemon + AST 知識圖譜 | 🔥 最大威脅 — 做的是 Smart MCP context + memory 的超集 |
| **Tool Compass** | 漸進式揭露（compass→describe→execute），95% token 省 | Smart MCP hybrid_router 類似但更整合 |
| **mcpflow-router** | 專為 OpenCode 設計的 gateway | ⚠️ 直接競爭 — 也是 OpenCode 生態 |
| **multi-agent-mcp** | 多 agent CLI 路由（<1% context overhead） | Smart MCP 更全面（不只路由，還有 workflow/memory） |
| **agent-context-mcp** | Rust 原生，Milvus + Tantivy + SQLite 混合搜尋 | Smart MCP 已有 CKG + LSP + grep 混合搜尋 |
| **smart-context-mcp** (Arrayo) | 90% token 省，smart_read/smart_search/smart_context | Smart MCP 已有 output-optimizer + context-budget |
| **mcp-agora** | 跨 agent 共享持久記憶（ChromaDB + 語義路由） | Smart MCP memory-db 已有 SQLite + FTS5 + vec |
| **Sophon** | 決定性 context 壓縮器，21 種 domain filter | Smart MCP output-optimizer L0/L1/L2 已涵蓋 |

### 前沿技術趨勢

| 技術 | 來源 | 對 Smart MCP 的啟示 |
|------|------|-------------------|
| **Grammar-Constrained CoT** | andthattoo/structured-cot | 22× token 壓縮！用 GBNF grammar 限制思考格式 |
| **Verified Code CoT** | IBM/verified-code-cot | 執行追蹤驗證的 CoT，杜絕幻覺 |
| **ToolTree (MCTS)** | ICLR 2026 | 蒙地卡羅樹搜尋工具規劃 + 雙向剪枝 |
| **STATe-of-Thoughts** | zbambergerNLP | 結構化行動模板取代隨機採樣 |
| **Meta-Reasoning** | tictacguy | 外部認知控制器 — LLM 是 substrate，思考由外部治理 |
| **ReasonKit Think** | reasonkit | MCP 原生 CoT/ToT/GoT + 驗證矩陣 |
| **Self-Evolving Codegen** | tathadn | Tester agent 自我進化 prompt |
| **Speculative Action** | naimengye | 推測性工具執行（pre-fetch） |
| **Continuous CoT** | NeurIPS 2025 | 連續思考向量（superposition state）比離散 token 更高效 |
| **Harness MCP v2** | Harness | 130+ tools → 11 tools，registry-based dispatch，context 從 26% → 1.6% |
| **Anthropic Code Execution** | Anthropic | MCP 工具以 code API 呈現，on-demand loading |

### 關鍵洞察

1. **Smart MCP 的護城河是工具深度**（LSP/CKG/Impact/Reasoning templates），不是 agent loop
2. **競爭品多數做 MCP proxy 層**（工具路由/壓縮），Smart MCP 做的是 agent 智慧層，定位不同
3. **最大威脅是 Continuum**（跨 agent 記憶 + AST 知識圖譜），但 Smart MCP 已有 memory-db + CKG
4. **前沿技術中，Structured CoT + MCTS Tool Planning + Meta-Reasoning 最值得整合**

---

## Phase 16：Structured Thinking — Grammar-Constrained CoT

> 參考：andthattoo/structured-cot（22× token 壓縮，+14pp LiveCodeBench）
> 核心洞察：LLM 的 verbose prose thinking 中大量是 scaffolding，不是真正的推理。
> 用 grammar 約束思考格式，可以在不損失推理品質的前提下壓縮 50-70% 思考 token。

### 設計

```
目前 smart_think：
  LLM 自由格式思考 → 大量 "Let me think about this..." "I should consider..." 等 scaffolding

Phase 16 改為：
  smart_think 新增 mode: "structured" 參數
  → 內部注入 GBNF-style 格式約束：
    GOAL: <一句話目標>
    STATE: <目前已知資訊>
    ALGO: <推理路徑>
    EDGE: <邊界條件/限制>
    VERIFY: <自我驗證>
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Structured thinking prompt 模板 | `src/plugins/core/thinking.mjs` | 新增 `mode: "structured"` + GOAL/STATE/ALGO/EDGE/VERIFY 五段式 |
| 2 | Token 節省追蹤 | `src/lib/context-budget.mjs` | structured vs free-form 的 token 差異統計 |
| 3 | Agent personality 更新 | `config/agents/smart-mcp.md` | 加入 structured thinking 使用時機 |
| 4 | 測試 | `tests/thinking.test.mjs` | structured mode 格式驗證 + token 節省驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 思考 token 消耗 | 基準 | -50~70% |
| 推理品質 | 基準 | 不變或略升（結構化減少雜訊） |
| 適用場景 | — | debug/refactor/architecture 模板 |

---

## Phase 17：MCTS Tool Planning — 蒙地卡羅樹搜尋工具規劃 ✅

> 參考：ToolTree (ICLR 2026) — 雙回饋 MCTS + 雙向剪枝
> 核心洞察：目前 tool-strategy 是靜態正則匹配，無法處理複雜 multi-step 任務的工具選擇。
> MCTS 可以在工具空間中搜尋最佳路徑。 
> **完成日期：2026-06-13**

### 設計

```
目前 tool-strategy：
  任務 → 正則匹配 → 靜態工具鏈 → 執行

Phase 17 改為：
  任務 →
    Selection → 選最有潛力的工具節點
    Pre-Evaluation → 快速預估工具適用性（schema/slot 檢查）
    Expansion → 展開工具呼叫
    Execution → 實際執行
    Post-Evaluation → 根據結果評估貢獻
    Back-Propagation → 更新節點分數
    → 重複直到收斂 → 最佳工具鏈
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | MCTS 核心引擎 | `src/lib/mcts-planner.mjs` | UCT selection + pre/post evaluation + back-propagation |
| 2 | Pre-evaluator | `src/lib/mcts-planner.mjs` | 快速 schema/slot 檢查，過濾不相容工具 |
| 3 | Post-evaluator | `src/lib/mcts-planner.mjs` | 根據執行結果評分工具貢獻 |
| 4 | Bidirectional pruning | `src/lib/mcts-planner.mjs` | pre + post 雙向剪枝 |
| 5 | MCP Plugin | `src/plugins/standard/mcts-plan.mjs` | `smart_mcts_plan` 工具 |
| 6 | hybrid-engine 整合 | `src/lib/hybrid-engine.mjs` | 複雜 multi-step 任務自動觸發 MCTS |
| 7 | Agent personality | `config/agents/smart-mcp.md` | MCTS 使用時機 |
| 8 | 測試 | `tests/mcts-planner.test.mjs` | UCT/剪枝/收斂驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 複雜任務工具選擇準確率 | ~70%（靜態匹配） | ~85%+（MCTS 搜尋） |
| 不適用工具呼叫次數 | 2-3 次/任務 | <1 次/任務 |
| 適用場景 | — | 5+ 步驟的複雜 multi-step 任務 |

### 實作摘要

- `src/lib/mcts-planner.mjs` — MCTS 核心引擎（UCTNode / PreEvaluator / PostEvaluator / BidirectionalPruner）
- `src/plugins/standard/mcts-plan.mjs` — `smart_mcts_plan` MCP 工具（接收 goal/tools/context，回傳最佳工具鏈）
- `src/lib/hybrid-engine.mjs` — DOMAIN_MAP 新增 mcts_plan 領域
- `tests/mcts-planner.test.mjs` — 40 項測試，全部通過

---

## Phase 18：Speculative Tool Pre-fetch — 推測性工具預取

> 參考：naimengye/speculative-action
> 核心洞察：LLM 呼叫工具是序列化的（call → wait → result → next call）。
> 如果可以預測下一步會用什麼工具，可以提前執行，減少 round-trip。

### 設計

```
目前：
  LLM → smart_grep("error") → wait → result
  LLM → smart_lsp({operation:"hover", ...}) → wait → result

Phase 18 改為：
  LLM → smart_grep("error")
       → server 同時 pre-fetch smart_lsp hover（推測 LLM 下一步會查型別）
       → 如果 LLM 真的呼叫 smart_lsp → 直接回傳 cached result（0ms）
       → 如果 LLM 沒呼叫 → 丟棄 cached result（無害）
```

### Pre-fetch 規則（規則 based，零 LLM cost）

| 觸發工具 | Pre-fetch 工具 | 理由 |
|---------|---------------|------|
| `smart_grep` | `smart_lsp hover`（對 grep 結果的第一個符號） | grep 找到符號後通常會查型別 |
| `smart_think` | `memory_store search`（對 think topic） | 思考前通常會查相關記憶 |
| `smart_security` | `smart_grep`（對 security 找到的檔案） | 安全掃描後通常會 grep 相關程式碼 |
| `smart_learn` | `import_graph` | 了解專案後通常會看依賴 |
| `smart_error_diagnose` | `smart_lsp diagnostics` | 診斷錯誤後通常會看 LSP 診斷 |

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Pre-fetch 規則引擎 | `src/lib/prefetch-engine.mjs` | 規則 based，零 LLM cost |
| 2 | Pre-fetch cache | `src/lib/prefetch-engine.mjs` | TTL 5s 的 in-memory cache |
| 3 | Server 端整合 | `src/server/index.mjs` | invokeTool 後 fire-and-forget pre-fetch |
| 4 | Cache hit 檢查 | `src/server/index.mjs` | invokeTool 前檢查 pre-fetch cache |
| 5 | 測試 | `tests/prefetch.test.mjs` | cache hit/miss/expiry 驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 平均 tool call round-trip | 3-5 輪 | 2-3 輪（pre-fetch hit 省 1-2 輪） |
| Cache hit rate | — | 預估 40-60% |
| Token 成本 | 基準 | 無增加（pre-fetch 結果不進 context 除非命中） |

---

## Phase 19：Cross-Agent Shared Memory — 跨 Agent 記憶共享

> 參考：Continuum (redstone-md)、mcp-agora
> 核心洞察：目前 memory_store 是單一 agent 的。但使用者可能在 Claude Code、OpenCode、Codex 之間切換。
> 跨 agent 共享記憶可以讓所有 agent 受益於彼此的學習。

### 設計

```
目前：
  Claude Code session → memory_store → ~/.smart/memory/memory.db
  OpenCode session   → memory_store → ~/.smart/memory/memory.db（同一 DB，但無 agent 標記）

Phase 19 改為：
  memory_store 新增 agent_id 欄位
  → Claude Code 存的記憶標記 agent_id: "claude-code"
  → OpenCode 存的記憶標記 agent_id: "opencode"
  → 查詢時可選「只看本 agent」或「跨 agent 搜尋」
  → 跨 agent 搜尋時顯示來源 agent
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | memory-db schema 擴充 | `src/lib/memory-db.mjs` | 新增 agent_id 欄位 + 遷移 |
| 2 | memory_store plugin 更新 | `src/plugins/standard/memory-store.mjs` | 接受 agent_id 參數，自動偵測 |
| 3 | 跨 agent 查詢 | `src/lib/memory-db.mjs` | searchHybrid 支援 agent_id 過濾 |
| 4 | Agent personality | `config/agents/smart-mcp.md` | 跨 agent 記憶使用說明 |
| 5 | 測試 | `tests/memory-db.test.mjs` | agent_id 寫入/查詢/過濾驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 記憶覆蓋率 | 單 agent | 跨 agent（Claude Code + OpenCode + Codex） |
| 新 agent 冷啟動 | 從零開始 | 立即受益於其他 agent 的學習 |
| 重複錯誤率 | 中 | 低（跨 agent 共享 fix） |

---

## Phase 20：Execution-Grounded Verification — 執行驗證的程式碼生成 ✅

> 參考：IBM/verified-code-cot
> 核心洞察：目前 smart_exec 可以執行 code，但沒有自動驗證 code generation 的結果。
> 加入 sandbox 執行驗證，自動過濾掉無法執行的 code。
> **完成日期：2026-06-13**

### 設計

```
目前：
  LLM 產生 code → 回傳給使用者（可能無法執行）

Phase 20 改為：
  LLM 產生 code → smart_exec 在 sandbox 執行 → 驗證 exit code + output
    → 成功 → 回傳 code + 執行結果
    → 失敗 → 回傳 code + 錯誤訊息，LLM 自動修正（最多 1 輪）
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Code verification pipeline | `src/lib/code-verifier.mjs` | execute → verify → retry loop |
| 2 | smart_exec 擴充 | `src/plugins/standard/exec.mjs` | 新增 verify mode |
| 3 | Agent personality | `config/agents/smart-mcp.md` | code generation 自動驗證流程 |
| 4 | 測試 | `tests/code-verifier.test.mjs` | pass/fail/retry 驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 產生 code 可執行率 | ~70% | ~95%+ |
| 使用者手動修正次數 | 高 | 低（自動修正） |

### 實作摘要

- `src/lib/code-verifier.mjs` — Code verification pipeline（extractCode / verifyCode / verifyCodeBatch）
- `src/plugins/standard/exec.mjs` — `smart_exec` 新增 `mode:"verify"` 參數
- `config/agents/smart-mcp.md` — 加入 code verification 工作流
- `tests/code-verifier.test.mjs` — 21 項測試，全部通過

---

## 優先級總覽

| 優先 | Phase | 名稱 | 難度 | 影響 | 估時 |
|:----:|-------|------|:----:|:----:|:----:|
| 🥇 | **16** | Structured Thinking (Grammar-Constrained CoT) | 🟡 中 | 🔥 高（省 50-70% 思考 token） | ✅ 完成 (2026-06-13) |
| 🥇 | **18** | Speculative Tool Pre-fetch | 🟢 低 | 🔥 高（省 1-2 輪 round-trip） | ✅ 完成 (2026-06-13) |
| 🥇 | **17** | MCTS Tool Planning | 🔴 高 | 🔥 高（複雜任務工具選擇準確率 ~85%+） | ✅ 完成 (2026-06-13) |
| 🥈 | **19** | Cross-Agent Shared Memory | 🟢 低 | 🟡 中（跨 agent 學習） | ✅ 完成 (2026-06-13) |
| 🥈 | **20** | Execution-Grounded Verification | 🟡 中 | 🟡 中（code 品質提升，可執行率 ~95%+） | ✅ 完成 (2026-06-13) |
| 🥇 | **21** | smart_read — 漸進式檔案讀取 | 🟢 低 | 🔥 高（省 60-80% read token） | ✅ 完成 (2026-06-13) |
| 🥈 | **22** | smart_edit_ast — AST 感知編輯 | 🟢 低 | 🟡 中（更精確的編輯，減少編輯錯誤） | ✅ 完成 (2026-06-13) |
| 🥇 | **23** | smart_read 強化 — auto/range/batch/compact | 🟢 低 | 🔥 高（auto預設省token、range精準讀取、batch批量） | ✅ 完成 (2026-06-13) |
| 🥇 | **24** | Session Cache + Explain + Project Map | 🟢 低 | 🔥 高（explain一次取代三次呼叫、cache省重讀token、project一覽專案符號） | ✅ 完成 (2026-06-13) |

## 里程碑

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1-M5 | Phase 16-20 完成 | ✅ 2026-06-13 |
| M6 | Phase 21 (smart_read) 完成 | ✅ 2026-06-13 |
| M7 | Phase 22 (smart_edit_ast) 完成 | ✅ 2026-06-13 |
| M8 | Phase 23 (smart_read 強化) 完成 | ✅ 2026-06-13 |
| M9 | Phase 24 (Session Cache + Explain + Project Map) 完成 | ✅ 2026-06-13 |
| M10 | 全量 regression + 效能 benchmark | ✅ 2026-06-13 |

---

## Phase 21：smart_read — 漸進式檔案讀取 ✅

> 參考：Arrayo/smart-context-mcp（90% token 省採用 outline/signatures/symbol/full 四層壓縮）
> 核心洞察：LLM 讀檔案時 80% 的情況只需要結構或特定函式內容，不需要整份檔案。
> 漸進式讀取可以在不損失資訊完整性的前提下省 60-80% read token。
> **完成日期：2026-06-13**

### 設計

```
目前 raw read：
  LLM：「讀 src/auth.ts」
  → 回傳整份檔案（可能 500+ lines）
  → LLM 只看其中某個函式（浪費 90% token）

Phase 21 smart_read 改為：
  LLM：「smart_read({file: "src/auth.ts", mode:"outline"})」
  → 回傳檔案結構（5-10 lines summary of functions/classes）
  
  LLM：「smart_read({file: "src/auth.ts", mode:"symbol", symbol:"authenticate"})」
  → 只回傳 authenticate() 函式 body（精準定位）
  
  LLM：「smart_read({file: "src/auth.ts", mode:"full", offset:1, limit:100})」
  → 回傳第 1-100 行（支援分頁）
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | 核心引擎 | `src/lib/smart-read.mjs` | SmartReader class + parseDeclarations / generateOutline / generateSignatures / extractSymbol |
| 2 | 語言偵測 | `src/lib/smart-read.mjs` | 21 種 extension → language 映射 |
| 3 | JS/TS parsing | `src/lib/smart-read.mjs` | function/class/interface/type/enum/const/arrow function |
| 4 | Python parsing | `src/lib/smart-read.mjs` | def/async def/class/decorator-aware |
| 5 | Go parsing | `src/lib/smart-read.mjs` | func/struct/interface/method |
| 6 | Rust parsing | `src/lib/smart-read.mjs` | fn/struct/impl/trait/enum/const |
| 7 | 通用 fallback | `src/lib/smart-read.mjs` | 通用 pattern 支援所有語言 |
| 8 | Brace matching | `src/lib/smart-read.mjs` | 正確追蹤 { } 巢狀深度 |
| 9 | Python indentation | `src/lib/smart-read.mjs` | 基於縮排的 body 範圍偵測 |
| 10 | MCP Plugin | `src/plugins/standard/smart-read.mjs` | `smart_read` 工具，text/json 雙輸出 |
| 11 | Agent config | `config/agents/smart-mcp.md` | Layer 1 direct tool 權限 + 路由 + 工作流 |
| 12 | 測試 | `tests/smart-read.test.mjs` | 69 項測試，6 種語言，全部通過 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 平均 read token 消耗 | 500-2000 lines/file | 5-50 lines（outline/symbol mode） |
| 檔案結構理解速度 | 慢（需讀完整檔） | 快（outline 5-10 lines） |
| 特定函式定位 | grep 後讀整檔 | 精準 symbol extraction |
| 大檔案處理 | 單次讀取耗盡 context | offset/limit 分頁控制 |

### 實作摘要

- `src/lib/smart-read.mjs` — SmartReader class 核心引擎（detectLanguage / parseDeclarations / generateOutline / generateSignatures / extractSymbol）
- `src/plugins/standard/smart-read.mjs` — MCP plugin（outline/signatures/symbol/full 四模式，text/json 雙輸出）
- `tests/smart-read.test.mjs` — 69 項測試（language detection / JS / TS / Python / Go / Rust / SmartReader class / error handling），全部通過

---

## Phase 22：smart_edit_ast — AST 感知編輯 ✅

> 參考：Zenith-MCP（AST-based editing with content-match / block-boundary / symbol-edit 三模式）
> 核心洞察：傳統字串取代編輯（smart_edit）無法感知程式碼結構。AST 感知編輯可以：
>   - 在函式/類別體內精準操作
>   - 容錯 whitespace 差異
>   - 提供行區間編輯（insert/replace/delete）
> **完成日期：2026-06-13**

### 設計

```
目前 smart_edit：
  { oldString: "function foo()", newString: "function bar()" }
  → 只能做 exact string match，無法感知結構

Phase 22 smart_edit_ast 改為：
  { mode: "content-match", match: "function authenticate", replace: "async function authenticate" }
    → 上下文容錯取代（trim-tolerant） 
  
  { mode: "block-boundary", action: "replace", startLine: 10, endLine: 20, text: "..." }
    → 精確行區間編輯
  
  { mode: "symbol-edit", symbol: "authenticate", action: "append", text: "console.log('called');" }
    → 在 symbol body 內新增 log 語句
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | content-match mode | `src/plugins/standard/smart-edit-ast.mjs` | trim-tolerant 匹配 + context 顯示 |
| 2 | block-boundary mode | `src/plugins/standard/smart-edit-ast.mjs` | insert-before/insert-after/replace/delete |
| 3 | symbol-edit mode | `src/plugins/standard/smart-edit-ast.mjs` | 結合 smart_read extractSymbol 定位 + append/prepend/replace-body/delete |
| 4 | Simple diff | `src/plugins/standard/smart-edit-ast.mjs` | 編輯前後 diff 預覽 |
| 5 | Dry-run | `src/plugins/standard/smart-edit-ast.mjs` | 預設 dry-run，apply:true 才寫入 |
| 6 | Agent config | `config/agents/smart-mcp.md` | Layer 2 sub-tool，透過 ssr() 存取 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 編輯精確度 | exact string match（易因空白/排版失敗） | 容錯 whitespace + 結構感知 |
| 編輯安全 | 無 preview | dry-run + diff preview |
| 行區間編輯 | 需手動計算行數 | block-boundary 直接操作 |
| Symbol 內編輯 | 需先定位再編輯 | symbol-edit 一次搞定 |

---

## Phase 23：smart_read 強化 ✅

> 基於競爭品研究（Arrayo/smart-context-mcp, rjkaes/trueline-mcp, breca/codemap, cortex-works）
> 讓 smart_read 比原生 read 更強大、更有效率

### 新增功能

| # | 功能 | 檔案 | 說明 |
|---|------|------|------|
| 1 | `mode: "auto"` | `src/lib/smart-read.mjs` | 依檔案大小自動選模式（新預設！）<50 lines → full, 50-300 → signatures, >300 → outline |
| 2 | `mode: "range"` | `src/lib/smart-read.mjs` | 指定行範圍讀取（startLine/endLine），含 content checksum |
| 3 | `mode: "batch"` | `src/lib/smart-read.mjs` | 一次讀取多個檔案，各自自動選模式，混和錯誤處理 |
| 4 | Content hash | `src/lib/smart-read.mjs` | SHA-256 內容雜湊（16 hex），full/range 模式附帶，供編輯驗證 |
| 5 | `format: "compact"` | `src/plugins/standard/smart-read.mjs` | 零裝飾最小 token 輸出（無 emoji、無分隔線） |
| 6 | `numbered:false` | `src/lib/smart-read.mjs` | 可關閉行號（full/range 模式） |
| 7 | `thresholds` param | `src/lib/smart-read.mjs` | auto 模式可自訂 threshold（如 thresholds: {full:100, signatures:200}） |

### 研究參考

| 來源 | 借鏡的功能 | 實作方式 |
|------|-----------|---------|
| **Arrayo/smart-context-mcp** | batch 讀取、range mode、inline range | 七種模式 + batch handler |
| **trueline-mcp** | Content hash 行驗證 | SHA-256 hashContent() |
| **breca/codemap** | Progressive detail levels（原有 outline→signatures→symbol→full） | 維持 + auto 模式自動階梯 |
| **cortex-works** | L1→L2→L3 漸進揭露、compact output | auto mode 三階梯 + compact format |
| **treesitter-mcp** | Token budget-aware 輸出 | `format:"compact"` 精簡輸出 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 預設使用體驗 | 需手動選 mode（outline） | auto 自動選最佳模式，省認知負擔 |
| 精準讀取 | 需 offset/limit 計算 | range 直接指定 startLine/endLine |
| 多檔案讀取 | 逐次呼叫 | batch 一次完成 |
| 編輯安全 | 無原始內容驗證 | content checksum 確認編輯目標一致 |
| Token 效率 | 固定輸出格式 | compact 零裝飾模式最小化 token |

---

## Phase 24：Session Memory Cache + Explain + Project Map ✅

> 參考：Continuum（session cache）、cortex-works（漸進揭露）
> 目標：同一 session 內不重讀未修改檔案（Cache HIT 直接回傳），新增 explain 模式（符號 + imports + callers 一次取得），新增 project 模式（專案符號地圖 <500 tokens）。
> **完成日期：2026-06-13**

### 24.1 Session Memory Cache

- [x] `src/plugins/standard/smart-read.mjs` — `_readCache` Map（module-level，key=`path|mode|symbol-opts`）
- [x] Cache invalidation：mtime 變化 + 10 分鐘 TTL
- [x] `cacheWrap()` wrapper 包裹 SmartReader.read()
- [x] 透明快取：LLM 無感，回傳結果與無快取一致

### 24.2 Explain Mode

- [x] `src/lib/smart-read.mjs` — `extractImports(content, lang)`：抽取 import/require 陳述 + 行號
- [x] `src/lib/smart-read.mjs` — `extractCallers(content, lang, symbol)`：找出呼叫目標符號的位置（排除自身 body）
- [x] SmartReader.read() — `case 'explain'`：回傳 `{name, type, lineStart, lineEnd, signature, body, imports[], callers[]}`
- [x] 測試：symbol + imports + callers 一次回傳、missing symbol error、missing symbol param error

### 24.3 Project Map Mode

- [x] `src/lib/smart-read.mjs` — `buildProjectMap(root, opts={depth, maxFiles, maxTotalLines})`：遞迴掃目錄
- [x] 支援 extension: .js/.ts/.py/.go/.rs/.rb/.php/.java/.swift/.kt/.c/.h/.cpp/.cs 等
- [x] 自動跳過 node_modules/.git/dist/build/__pycache__/.venv 等
- [x] 壓制在 token budget 內（depth:4, maxFiles:40, maxTotalLines:500 預設）
- [x] 測試：專案符號地圖正確建立、maxFiles 限制正確

### 24.4 測試

- [x] extractImports 測試（JS imports、行號、空內容）
- [x] extractCallers 測試（找呼叫者、排除自身 body、無呼叫者）
- [x] explain mode 測試（完整回傳、錯誤處理）
- [x] project map 測試（地圖建立、maxFiles 限制）
- [x] **95 項測試全部通過**

---


---

## Phase 25：Tool Transition Learning — 工具轉移學習

> 參考：AutoTool（Learning to Route Tools）— 觀察工具呼叫序列，學習工具間的轉移模式
> 核心洞察：LLM 使用工具有固定序列模式（如 grep→lsp hover→fast_apply→test）。
> 目前 prefetch-engine 的 5 條規則是硬編碼的，無法適應實際使用模式。
> Phase 25 透過 SQLite 記錄工具轉移統計，讓 prefetch 和路由建議從數據中學習。

### 設計

```
目前：
  5 條硬編碼 pre-fetch 規則（維護者必須手動更新）

Phase 25 改為：
  工具 A 執行後 → 記錄工具 A → 工具 B 的轉移
  → 累積統計：from_tool × to_tool × success_count × avg_duration
  → prefetch-engine 查詢 DB：工具 A 後最可能用什麼？前 3 名
  → 靜態規則 + 動態統計混合（靜態作為 fallback）
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | `tool_transitions` 表 | `src/lib/memory-db.mjs` | from_tool, to_tool, success_count, fail_count, avg_duration, last_seen |
| 2 | Transition CRUD | `src/lib/memory-db.mjs` | recordTransition, getTopTransitions, getTransitionStats |
| 3 | Server hook | `src/server/index.mjs` | 每次成功工具呼叫後記錄 transition（前一個工具 → 當前工具） |
| 4 | Prefetch 強化 | `src/lib/prefetch-engine.mjs` | 查詢 DB transitions 取代/補充靜態規則 |
| 5 | Recipe 學習 | `src/lib/prefetch-engine.mjs` | 自動分析 3+ 步驟的常見工具鏈序列 |
| 6 | System prompt | `src/agent/system-prompt.mjs` | 提及 transition learning |
| 7 | 測試 | `tests/transition-learn.test.mjs` | 記錄/查詢/統計驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| Pre-fetch 規則維護 | 手動更新硬編碼 | 自動從數據學習 |
| Pre-fetch 準確率 | 靜態規則（50-60%） | 動態學習（70-85%+） |
| 冷啟動時間 | 需手動編寫規則 | 5-10 次使用後自動學習模式 |
| 適應不同專案 | 通用規則，不適應專案差異 | 自動學習專案特有模式 |

---

## Phase 26：Tool Selection Feedback — 工具選擇回饋

> 參考：JTPRO（Just-in-Time Prompt Routing）— 根據實際使用結果回饋調整路由策略
> 核心洞察：tool-strategy 的 12 條靜態規則永遠不會知道自己選對還是選錯。
> Phase 26 加入回饋迴路：推薦工具 → LLM 實際選擇 → 比較 → 調整。

### 設計

```
目前：
  任務描述 → 正則匹配 12 條規則 → 靜態推薦（永不修正）

Phase 26 改為：
  任務描述 → 正則匹配 → 推薦工具
  → LLM 實際呼叫的工具（由 server 記錄）
  → 對比推薦 vs 實際
  → 更新 tool_feedback 表：(goal_context, recommended_tool, actual_tool, success)
  → tool-strategy 查詢回饋統計調整推薦
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | `tool_feedback` 表 | `src/lib/memory-db.mjs` | goal_context, recommended_tool, actual_tool, success, duration, timestamp |
| 2 | Feedback CRUD | `src/lib/memory-db.mjs` | recordFeedback, getRecommendationStats, getPatternAdjustments |
| 3 | Server hook | `src/server/index.mjs` | 記錄每次推薦 → 實際選擇的對比 |
| 4 | tool-strategy 強化 | `src/agent/tool-strategy.mjs` | 查詢回饋統計，調整 pattern 分數 |
| 5 | 自動調整 | `src/agent/tool-strategy.mjs` | 低成功率 pattern 降級，高成功率 pattern 升級 |
| 6 | System prompt | `src/agent/system-prompt.mjs` | 提及回饋機制 |
| 7 | 測試 | `tests/tool-feedback.test.mjs` | 記錄/查詢/調整驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 工具推薦準確率 | 靜態（~70%） | 自適應（80-90%+） |
| 錯誤推薦率 | 固定（~30% 不適用） | 持續下降（每 20 次使用調整一次） |
| 適應性 | 永不改變 | 隨使用模式持續進化 |

---

## Phase 27：Semantic Cache Routing — 語意快取路由

> 參考：semantic-cache（Embedding-based caching for LLM routing decisions）
> 核心洞察：相同或類似的任務目標通常需要相同的工具鏈。
> 現有 sqlite-vec（384-dim 向量搜尋）已可支援語意相似度比對。

### 設計

```
目前：
  每次任務 → 正則匹配（O(n) 掃描 12 條規則）
  → 每次匹配結果相同（無記憶）

Phase 27 改為：
  新任務 →
    1. 產生任務目標 embedding（384-dim）
    2. 查詢 semantic_cache 表（sqlite-vec ANN）：找最相似 past goal
    3. 若相似度 > 0.85 → 直接回傳 cached tool chain（0ms）
    4. 若相似度 < 0.85 → 正常 pattern match
    5. 使用後將 (goal, tool_chain) 存入 cache
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | `semantic_cache` 表 | `src/lib/memory-db.mjs` | goal TEXT, goal_embedding BLOB(384), tool_chain TEXT, hit_count, success_count, created_at |
| 2 | Cache CRUD | `src/lib/memory-db.mjs` | cacheGoal, searchCache, updateCacheStats |
| 3 | Embedding 產生器 | `src/lib/semantic-cache.mjs` | 從 goal text 產生 384-dim embedding（hash-based 降級方案） |
| 4 | tool-strategy 整合 | `src/agent/tool-strategy.mjs` | recommendTools 前先查 cache |
| 5 | Server hook | `src/server/index.mjs` | 每次成功工具鏈後快取 |
| 6 | System prompt | `src/agent/system-prompt.mjs` | 提及語意快取 |
| 7 | 測試 | `tests/semantic-cache.test.mjs` | 快取/命中/未命中/相似度驗證 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 任務路由延遲 | O(n) pattern match | O(1) cache hit（相似度 > 0.85） |
| 冷啟動 | 無歷史 | 5-10 次使用後開始有 cache hit |
| 重複任務處理 | 每次都重新匹配 | 命中後直接回傳（省 100% pattern match token） |
| 長期準確率 | 靜態 | 隨 cache 累積持續提升 |

---

## 優先級總覽（更新後）

| 優先 | Phase | 名稱 | 難度 | 影響 | 估時 |
|:----:|-------|------|:----:|:----:|:----:|
| 🥇 | **16** | Structured Thinking (Grammar-Constrained CoT) | 🟡 中 | 🔥 高 | ✅ 完成 |
| 🥇 | **17** | MCTS Tool Planning | 🔴 高 | 🔥 高 | ✅ 完成 |
| 🥇 | **18** | Speculative Tool Pre-fetch | 🟢 低 | 🔥 高 | ✅ 完成 |
| 🥈 | **19** | Cross-Agent Shared Memory | 🟢 低 | 🟡 中 | ✅ 完成 |
| 🥈 | **20** | Execution-Grounded Verification | 🟡 中 | 🟡 中 | ✅ 完成 |
| 🥇 | **21** | smart_read — 漸進式檔案讀取 | 🟢 低 | 🔥 高 | ✅ 完成 |
| 🥈 | **22** | smart_edit_ast — AST 感知編輯 | 🟢 低 | 🟡 中 | ✅ 完成 |
| 🥇 | **23** | smart_read 強化 | 🟢 低 | 🔥 高 | ✅ 完成 |
| 🥇 | **24** | Session Cache + Explain + Project Map | 🟢 低 | 🔥 高 | ✅ 完成 |
| 🥇 | **25** | Tool Transition Learning | 🟡 中 | 🔥 高（自適應 prefetch） | 2-3h |
| 🥇 | **26** | Tool Selection Feedback | 🟡 中 | 🔥 高（自適應路由） | 2-3h |
| 🥈 | **27** | Semantic Cache Routing | 🔴 高 | 🟡 中（長期累積效益） | 3-4h |

## 里程碑（更新後）

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1-M10 | Phase 16-24 完成 | ✅ 2026-06-13 |
| M11 | Phase 25 (Transition Learning) 完成 | 📅 本期 |
| M12 | Phase 26 (Tool Selection Feedback) 完成 | 📅 本期 |
| M13 | Phase 27 (Semantic Cache Routing) 完成 | 📅 本期 |
| M14 | Phase 25-27 全量 regression | 📅 本期 |

## 長期研究方向（Phase 28+）

| Phase | 研究方向 | 說明 | 前置 |
|-------|---------|------|------|
| 28 | **External Cognitive Controller** | 參考 Meta-Reasoning — LLM 思考由外部治理，偵測 stall/redundancy 強制分支 | 需 Phase 25-27 穩定 |
| 29 | **Self-Evolving Tool Patterns** | 參考 self-evolving-codegen — pattern 規則根據 Phase 26 回饋自動進化 | 需 Phase 26 數據 |
| 30 | **Cross-Session Learning** | 跨 session 的工具使用模式遷移學習 | 需 Phase 25 DB |

## 不上什麼（競爭品分析後的取捨）

| 項目 | 競爭品有 | 不做的原因 |
|------|---------|-----------|
| MCP Proxy 層工具路由 | smart-mcp, MCPlex, Tool Compass | Smart MCP 已有 hybrid_router + Layer 1/2 分層，不需再做 proxy |
| RBAC + Audit + Dashboard | MCPlex | 單開發者不需要企業級功能 |
| 跨 agent daemon | Continuum | 架構複雜度高，Phase 19 的 agent_id 標記已足夠 |
| Rust 重寫 | MCPlex, agent-context-mcp | Node.js 生態整合更好，效能瓶頸不在語言 |
| 外部 LLM API 依賴 | ReasonKit Think | Smart MCP 是 MCP server，不應依賴外部 API |
| Multi-Agent Debate | — | Beam Search / Forest-of-Thought 已達類似效果 |
| DSPy Prompt Optimization | — | Skill-level Learning (skill_patch) 為輕量替代 |
