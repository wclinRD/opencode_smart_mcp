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

## Phase 25：Tool Transition Learning — 工具轉移學習 ✅

> 參考：AutoTool（Learning to Route Tools）— 觀察工具呼叫序列，學習工具間的轉移模式
> 核心洞察：LLM 使用工具有固定序列模式（如 grep→lsp hover→fast_apply→test）。
> 目前 prefetch-engine 的 5 條規則是硬編碼的，無法適應實際使用模式。
> Phase 25 透過 SQLite 記錄工具轉移統計，讓 prefetch 和路由建議從數據中學習。
> **完成日期：2026-06-21**

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
| 3 | Tool chain learning | `src/lib/memory-db.mjs` | learnToolChain：從 transitions 提取 3+ 步驟工具鏈、NaN guard |
| 4 | Server hook | `src/server/index.mjs` | 每次成功工具呼叫後記錄 transition（前一個工具 → 當前工具） |
| 5 | Prefetch 強化 | `src/lib/prefetch-engine.mjs` | 查詢 DB transitions 取代/補充靜態規則 |
| 6 | Recipe 學習 | `src/lib/prefetch-engine.mjs` | 自動分析 3+ 步驟的常見工具鏈序列 |
| 7 | System prompt | `src/agent/system-prompt.mjs` | 提及 transition learning |
| 8 | 測試 | `tests/transition-learn.test.mjs` | 14 項：記錄/查詢/鏈提取/NaN 防護/空 DB 處理 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| Pre-fetch 規則維護 | 手動更新硬編碼 | 自動從數據學習 |
| Pre-fetch 準確率 | 靜態規則（50-60%） | 動態學習（70-85%+） |
| 冷啟動時間 | 需手動編寫規則 | 5-10 次使用後自動學習模式 |
| 適應不同專案 | 通用規則，不適應專案差異 | 自動學習專案特有模式 |
| 鏈準確度 | 無鏈感知 | learnToolChain 完美邊緣 score=1.0 |

---

## Phase 26：Tool Selection Feedback — 工具選擇回饋 ✅

> 參考：JTPRO（Just-in-Time Prompt Routing）— 根據實際使用結果回饋調整路由策略
> 核心洞察：tool-strategy 的 12 條靜態規則永遠不會知道自己選對還是選錯。
> Phase 26 加入回饋迴路：推薦工具 → LLM 實際選擇 → 比較 → 調整。
> **完成日期：2026-06-21**

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
| 1 | `tool_feedback` 表 | `src/lib/memory-db.mjs` | goal_context, recommended_tool, actual_tool, success, duration, session_id, timestamp |
| 2 | Feedback CRUD | `src/lib/memory-db.mjs` | recordFeedback (含 sessionId 參數), getRecommendationStats, getPatternAdjustments |
| 3 | Server hook | `src/server/index.mjs` | 記錄每次推薦 → 實際選擇的對比（含 session_id） |
| 4 | tool-strategy 強化 | `src/agent/tool-strategy.mjs` | 查詢回饋統計，調整 pattern 分數 |
| 5 | 自動調整 | `src/agent/tool-strategy.mjs` | 低成功率 pattern 降級，高成功率 pattern 升級 |
| 6 | Last recommendation | `src/agent/tool-strategy.mjs` | global.__lastRecommendation 跨請求追蹤 |
| 7 | System prompt | `src/agent/system-prompt.mjs` | 提及回饋機制 |
| 8 | 測試 | `tests/tool-feedback.test.mjs` | 10 項：含 sessionId/null sessionId/空 DB 邊界 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 工具推薦準確率 | 靜態（~70%） | 自適應（80-90%+） |
| 錯誤推薦率 | 固定（~30% 不適用） | 持續下降（每 20 次使用調整一次） |
| 適應性 | 永不改變 | 隨使用模式持續進化 |
| 推薦可追溯性 | 無 | session_id 連結每次推薦與實際使用 |

---

## Phase 27：Semantic Cache Routing — 語意快取路由 ✅

> 參考：semantic-cache（Embedding-based caching for LLM routing decisions）
> 核心洞察：相同或類似的任務目標通常需要相同的工具鏈。
> 現有 sqlite-vec（384-dim 向量搜尋）已可支援語意相似度比對。
> **完成日期：2026-06-21**

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
| 1 | `semantic_cache` 表 | `src/lib/memory-db.mjs` | goal TEXT, goal_embedding BLOB(384), tool_chain TEXT, hit_count, success_count, session_id, created_at |
| 2 | Cache CRUD | `src/lib/memory-db.mjs` | cacheGoal (auto-embedding), searchCache (hash+cosine), updateCacheStats |
| 3 | Embedding 產生器 | `src/lib/memory-db.mjs` | #hashEmbed：384-dim 三重 seed + bigram + position mixing（改良版） |
| 4 | tool-strategy 整合 | `src/agent/tool-strategy.mjs` | recommendTools 前先查 cache（含回退：hash→embedding→regex）  |
| 5 | Server hook | `src/server/index.mjs` | 工具鏈自動快取：追蹤連續 3+ 不同工具成功後快取 |
| 6 | Multi-step chain | `src/server/index.mjs` | global.__toolSequence 追蹤多步序列，自動 cacheGoal |
| 7 | System prompt | `src/agent/system-prompt.mjs` | 提及語意快取 |
| 8 | 測試 | `tests/semantic-cache.test.mjs` | 8 項：快取/命中/未命中/auto-embedding/空字串邊界 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 任務路由延遲 | O(n) pattern match | O(1) cache hit（相似度 > 0.85） |
| 冷啟動 | 無歷史 | 5-10 次使用後開始有 cache hit |
| 重複任務處理 | 每次都重新匹配 | 命中後直接回傳（省 100% pattern match token） |
| 長期準確率 | 靜態 | 隨 cache 累積持續提升 |
| 多步快取 | 僅單一 goal→chain | 自動累積 3+ 連續呼叫為 chain |

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
| 🥇 | **25** | Tool Transition Learning | 🟡 中 | 🔥 高（自適應 prefetch） | ✅ 完成 (2026-06-21) |
| 🥇 | **26** | Tool Selection Feedback | 🟡 中 | 🔥 高（自適應路由） | ✅ 完成 (2026-06-21) |
| 🥈 | **27** | Semantic Cache Routing | 🔴 高 | 🟡 中（長期累積效益） | ✅ 完成 (2026-06-21) |
| 🔴 | **28** | Semantic Tool Router（embedding 語意匹配） | 🟡 中 | 🔥 高（推薦準確率 +30-50%） | 3-4h |
| 🔴 | **29** | Self-Reflection & Adaptive Learning | 🟡 中 | 🔥 高（錯誤重複率 -50%） | 4-5h |
| 🔴 | **30** | Smart Output Management（截斷+壓縮+streaming） | 🟡 中 | 🔥 高（token -15-25%） | 3-4h |
| 🟡 | **31** | Parallel Execution & Pre-Indexing | 🟡 中 | 🔥 高（速度 2-3x） | 4-5h |
| 🟡 | **32** | Multi-Agent Collaboration Enhancement | 🟡 中 | 🟡 中（跨 agent 共享） | 3-4h |
| 🟢 | **33** | Skill Auto-Generation & Knowledge Graph | 🔴 高 | 🟡 中（長期累積） | 5-6h |

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1-M10 | Phase 16-24 完成 | ✅ 2026-06-13 |
| M11 | Phase 25-27 完成 | ✅ 2026-06-21 |
| M12 | Phase 25-27 Round 1 優化（tool-strategy 分數回饋、cacheGoal auto-embedding） | ✅ 2026-06-21 |
| M13 | Phase 25-27 Round 2 優化（multi-step 鏈快取、feedback session_id） | ✅ 2026-06-21 |
| M14 | Phase 25-27 Round 3 優化（#hashEmbed 改良、NaN guard、全邊界測試） | ✅ 2026-06-21 |
| ⋮ | ⋮ | ⋮ |
| M15 | Phase 28-30 (P0：語意路由+自我反思+輸出管理) 完成 | 📅 下期 |
| M16 | Phase 31-32 (P1：平行執行+多Agent協作) 完成 | 📅 下期 |
| M17 | Phase 33 (P2：Skill自動生成+知識圖譜) 完成 | 📅 下下期 |
| M18 | Phase 28-33 全量 regression | 📅 下下期 |

> 基於 2026-06-14 競爭品研究與前沿技術分析，Phase 28-33 聚焦三大方向：
> **效率**（推測預取、平行執行、token 壓縮）、**智能**（語意匹配、自我反思、adaptive routing）、**協作**（多 agent 記憶共享、role specialization、知識圖譜）

---

## Phase 28：Semantic Tool Router — Embedding 語意工具匹配

> 參考：OpenAI Agents SDK（semantic tool matching）、Cursor（relevance-based context）
> 核心洞察：目前 `tool-strategy.mjs` 用 12 條 regex 規則匹配工具，無法處理模糊/新穎的任務描述。
> 加入 TF-IDF + embedding 語意匹配，讓工具推薦更精準。

### 設計

```
目前 tool-strategy：
  任務描述 → regex 匹配 12 條規則 → 靜態推薦

Phase 28 改為：
  任務描述 →
    1. Regex 快速匹配（現有，作為 fallback）
    2. TF-IDF 語意相似度計算（對工具 description + inputSchema）
    3. Embedding 向量相似度（sqlite-vec，384-dim）
    4. 融合分數（regex × 0.3 + TF-IDF × 0.3 + embedding × 0.4）
    → 最佳工具推薦 + 信心分數
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | TF-IDF 向量化器 | `src/lib/tfidf-matcher.mjs` | 對工具 description + schema 建 TF-IDF 矩陣 |
| 2 | Embedding 語意匹配 | `src/lib/semantic-router.mjs` | sqlite-vec ANN 搜尋，384-dim embedding |
| 3 | 融合評分引擎 | `src/lib/semantic-router.mjs` | regex + TF-IDF + embedding 三路融合 |
| 4 | tool-strategy 整合 | `smart-agent/src/agent/tool-strategy.mjs` | `recommendTools()` 改用 semantic router |
| 5 | 工具 description 強化 | 各 `src/plugins/**/*.mjs` | 加入 `avoidWhen` 欄位（anti-pattern 指引） |
| 6 | Agent personality | `config/agents/smart-mcp.md` | semantic router 使用時機 |
| 7 | 測試 | `tests/semantic-router.test.mjs` | 匹配準確率 / 融合權重 / 邊界案例 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 工具推薦準確率 | ~70%（純 regex） | ~90%+（三路融合） |
| 模糊任務匹配 | 經常失敗 | TF-IDF + embedding 覆蓋 |
| 新任務適應性 | 需手動加 regex | 自動語意匹配 |

---

## Phase 29：Self-Reflection & Adaptive Learning — 自我反思與自適應學習

> 參考：Reflexion Pattern（agent 自我反思）、OpenAI Agents SDK（tool guardrails）
> 核心洞察：目前 agent 完成任務後不會反思「哪些步驟多餘？哪個工具效果差？」。
> 加入 self-reflection hook + adaptive routing，讓 agent 從每次執行中學習。

### 設計

```
目前：
  任務 → 執行 → 完成（無反思）

Phase 29 改為：
  任務 → 執行 →
    Post-Task Reflection Hook：
      1. 分析 tool call history：哪些工具被呼叫但結果未使用？
      2. 分析 tool chain：哪些步驟可以跳過？
      3. 分析 tool stats：哪個工具最常失敗？
      4. 產生 reflection summary → 寫入 memory_store
    →
    Adaptive Routing：
      1. 下次相似任務 → pre-execution memory check
      2. 根據歷史 toolStats 動態調整 recommendTools() 權重
      3. 低成功率 pattern 自動降級
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Reflection engine | `src/lib/reflection-engine.mjs` | 分析 tool history，產生 reflection summary |
| 2 | Post-task hook | `src/server/index.mjs` | 任務完成後自動觸發 reflection |
| 3 | Adaptive weight adjuster | `src/lib/reflection-engine.mjs` | 根據 toolStats 動態調整 pattern 權重 |
| 4 | Pre-execution memory check | `smart-agent/src/agent/tool-strategy.mjs` | `buildToolChain()` 前先搜 memory |
| 5 | Tool input validation | `src/lib/tool-validator.mjs` | JSON Schema 驗證層，呼叫前檢查參數 |
| 6 | Agent personality | `config/agents/smart-mcp.md` | reflection 使用說明 |
| 7 | 測試 | `tests/reflection-engine.test.mjs` | reflection / adaptive / validation |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 錯誤重複率 | 高（無記憶） | -50%（pre-execution memory check） |
| 工具呼叫錯誤 | 頻繁（無驗證） | -70%（JSON Schema validation） |
| 工具鏈效率 | 固定（無優化） | 持續改善（adaptive routing） |

---

## Phase 30：Smart Output Management — 智能輸出管理

> 參考：Sophon（21 種 domain filter）、Anthropic prompt caching、structured-cot（22× token 壓縮）
> 核心洞察：目前工具輸出無自動截斷，大輸出直接塞進 context。Context budget 警告頻繁但無自動節流。
> 加入智能截斷 + caveman 通用壓縮 + streaming 輸出 + 自動 budget 管理。

### 設計

```
目前：
  工具輸出 → 直接回傳（可能 50K+ chars）→ context budget 爆表

Phase 30 改為：
  工具輸出 →
    1. 智能截斷：超過 threshold 自動摘要 + "[展開完整輸出]" 連結
    2. Caveman 通用壓縮：所有工具輸出可選 compress:"caveman"（省 20-40%）
    3. Streaming 輸出：大結果分批回傳，不必等完整結果
    4. 自動 budget 管理：
       - budget < 80%：溫和提示
       - budget < 95%：強烈建議 compact
       - budget < 100%：自動 compact + 提示 agent 簡化回應
    5. Budget 計算優化：不重複計算 session cache 命中內容、排除 metadata
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | 智能截斷引擎 | `src/lib/truncation-engine.mjs` | 保留關鍵段落 + 摘要其餘 + 展開連結 |
| 2 | Caveman 通用壓縮 | `src/lib/caveman-compress.mjs` | 從 exa_search 擴展到所有工具輸出 |
| 3 | Streaming 輸出 | `src/server/index.mjs` | MCP 協定 streaming 支援 |
| 4 | 自動 budget 管理 | `src/lib/context-budget.mjs` | 分級警告 + 自動 compact |
| 5 | Budget 計算優化 | `src/lib/context-budget.mjs` | 排除 cache hit + metadata |
| 6 | 提高預設 threshold | `src/lib/context-budget.mjs` | 200K → 400K chars（反映實際 LLM window） |
| 7 | Agent personality | `config/agents/smart-mcp.md` | 輸出管理使用說明 |
| 8 | 測試 | `tests/output-management.test.mjs` | 截斷/壓縮/streaming/budget |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| Context budget 觸發頻率 | 頻繁（每 10-15 次呼叫） | 減少 60%+ |
| 平均輸出 token | 基準 | -15-25%（截斷+壓縮） |
| Budget 警告準確度 | 單一 threshold | 三級分級警告 |
| 大輸出體驗 | 阻塞等待 | streaming 漸進顯示 |

---

## Phase 31：Parallel Execution & Pre-Indexing — 平行執行與預索引

> 參考：Anthropic parallel tool calling、Cursor codebase indexing
> 核心洞察：目前 workflow dispatch 是 sequential 執行，無法利用平行化加速。
smart_learn 是 on-demand 分析，非 pre-indexed，首次使用慢。

### 設計

```
目前：
  workflow dispatch → tool A → tool B → tool C（sequential）
  smart_learn → 每次 on-demand 分析（慢）

Phase 31 改為：
  workflow dispatch →
    group A: [tool A, tool B]（平行，無相依）
    group B: [tool C]（相依於 A 結果）
    group C: [tool D, tool E]（平行，相依於 B）

  Pre-Indexing：
    專案首次開啟 → 自動建立 smart_learn 快取索引（background）
    → 後續查詢直接命中 cache（<100ms vs 2-5s）
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Parallel dispatch engine | `src/lib/parallel-executor.mjs` | 分析 DAG 相依性，平行執行無相依 group |
| 2 | Workflow 整合 | `src/plugins/standard/workflow.mjs` | `dispatch` 支援 parallel group |
| 3 | Pre-indexing engine | `src/lib/pre-indexer.mjs` | 專案開啟時 background 建立索引 |
| 4 | smart_learn cache | `src/lib/pre-indexer.mjs` | SQLite 持久化專案分析結果 |
| 5 | smart_learn 整合 | `src/plugins/core/learn.mjs` | 優先查 cache，miss 才重新分析 |
| 6 | Agent personality | `config/agents/smart-mcp.md` | parallel + pre-index 使用說明 |
| 7 | 測試 | `tests/parallel-executor.test.mjs` | DAG 分析 / 平行執行 / cache |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 多步任務速度 | sequential（基準） | 2-3x（平行 group） |
| smart_learn 首次速度 | 2-5s（on-demand） | <100ms（cache hit） |
| 專案切換速度 | 每次重新分析 | 即時（pre-indexed） |

---

## Phase 32：Multi-Agent Collaboration Enhancement — 多 Agent 協作強化

> 參考：Continuum（跨 agent daemon + AST KG）、mcp-agora（ChromaDB 語義路由）
> 核心洞察：Phase 19 已加入 agent_id 標記，但缺少真正的共享記憶池與 role-based 工具權限。

### 設計

```
目前：
  memory_store → 單一 agent 記憶（有 agent_id 標記但無共享查詢）
  subagent → 相同工具權限（無 allowlist/denylist）

Phase 32 改為：
  Shared Memory Pool：
    memory_store search → 可選 scope:"all"（跨 agent）或 scope:"self"
    → 跨 agent 搜尋時顯示來源 agent + 信心分數

  Role-Based Tool Access：
    subagent 定義 tool allowlist/denylist
    → security agent 只能用 security 相關工具
    → 減少 subagent 誤用工具的風險

  Agent-to-Agent Message Bus：
    agent A → structured message → agent B
    → 傳遞 context + findings + tool results
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Shared memory search | `src/lib/memory-db.mjs` | `searchHybrid` 支援 `scope` 參數 |
| 2 | memory_store 更新 | `src/plugins/standard/memory-store.mjs` | search 支援跨 agent 查詢 |
| 3 | Role-based tool access | `src/lib/role-manager.mjs` | subagent tool allowlist/denylist |
| 4 | Agent message bus | `src/lib/agent-bus.mjs` | structured message 傳遞 |
| 5 | Agent personality | `config/agents/smart-mcp.md` | 多 agent 協作使用說明 |
| 6 | 測試 | `tests/multi-agent.test.mjs` | shared memory / role / bus |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 跨 agent 知識覆蓋 | 單 agent 孤立 | 跨 agent 共享 |
| subagent 工具誤用 | 高（全工具可用） | 低（role-based 限制） |
| agent 間協作 | 手動傳遞 context | structured message bus |

---

## Phase 33：Skill Auto-Generation & Knowledge Graph — 技能自動生成與知識圖譜

> 參考：self-evolving-codegen（tester agent 自我進化）、Continuum（AST 知識圖譜）
> 核心洞察：目前 skill 需手動編寫。累積足夠的成功 pattern 後應自動生成。
> memory entries 之間缺少結構化關係（entity-relation graph）。

### 設計

```
Skill Auto-Generator：
  1. 監控 tool call history → 識別重複出現的成功 pattern（≥5 次）
  2. 自動萃取：trigger condition + tool chain + expected outcome
  3. 產生 skill 檔案（YAML frontmatter + Markdown body）
  4. 寫入 ~/.config/opencode/skills/ → 下次自動載入

Knowledge Graph：
  1. 從 memory entries 自動萃取 entity（tool/error/pattern/file）
  2. 建立 relation（causes/fixes/depends_on/similar_to）
  3. sqlite-vec 向量索引 → 支援語意查詢
  4. 視覺化：Mermaid.js graph 輸出
```

### 實作範圍

| # | 項目 | 檔案 | 說明 |
|---|------|------|------|
| 1 | Pattern miner | `src/lib/pattern-miner.mjs` | 從 tool history 識別重複成功 pattern |
| 2 | Skill generator | `src/lib/skill-generator.mjs` | 自動產生 skill 檔案 |
| 3 | Entity extractor | `src/lib/kg-builder.mjs` | 從 memory entries 萃取 entity |
| 4 | Relation builder | `src/lib/kg-builder.mjs` | 建立 entity 間關係 |
| 5 | KG query engine | `src/lib/kg-builder.mjs` | sqlite-vec 語意查詢 |
| 6 | KG visualization | `src/lib/kg-builder.mjs` | Mermaid.js graph 輸出 |
| 7 | Agent personality | `config/agents/smart-mcp.md` | skill auto-gen + KG 使用說明 |
| 8 | 測試 | `tests/skill-autogen.test.mjs` | pattern mining / skill gen / KG |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| Skill 建立 | 手動編寫（30min+/skill） | 自動生成（<1min） |
| 知識結構 | 平面 memory entries | 結構化 entity-relation graph |
| 跨任務理解 | 無（孤立記憶） | KG 語意查詢 |

## 不上什麼（競爭品分析後的取捨）

| 項目 | 競爭品有 | 不做的原因 |
|------|---------|-----------|
| MCP Proxy 層工具路由 | smart-mcp, MCPlex, Tool Compass | Smart MCP 已有 hybrid_router + Layer 1/2 分層 + Phase 28 semantic router |
| RBAC + Audit + Dashboard | MCPlex | 單開發者不需要企業級功能（Phase 32 role-based access 已足夠） |
| 跨 agent daemon | Continuum | 架構複雜度高，Phase 19 + Phase 32 共享記憶池已足夠 |
| Rust 重寫 | MCPlex, agent-context-mcp | Node.js 生態整合更好，效能瓶頸不在語言 |
| 外部 LLM API 依賴 | ReasonKit Think | Smart MCP 是 MCP server，不應依賴外部 API |
| Multi-Agent Debate | — | Beam Search / Forest-of-Thought 已達類似效果 |
| DSPy Prompt Optimization | — | Skill-level Learning (skill_patch) + Phase 33 auto-gen 為輕量替代 |