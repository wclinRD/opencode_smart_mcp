# Todo — 強化路線圖實作追蹤（Phase 16-20）

> 基於 2026-06-13 競爭品分析與前沿技術研究。
> 與 plan.md 互為補充：plan.md 定義「為什麼做、架構長怎樣」，todo.md 定義「具體步驟」。
>
> 核心方向：在不改變模型參數的前提下，讓 LLM 在 OpenCode 上更聰明、更有效率。

---

## Phase 16：Structured Thinking — Grammar-Constrained CoT ✅

> 參考：andthattoo/structured-cot（22× token 壓縮，+14pp LiveCodeBench）
> 目標：smart_think 新增 mode:"structured"，用 GOAL/STATE/ALGO/EDGE/VERIFY 五段式取代自由格式思考。
> 預估：省 50-70% 思考 token，推理品質不變或略升。
> **完成日期：2026-06-13**

### 16.1 研究：現有 smart_think 架構分析

- [x] 閱讀 `src/plugins/core/quick-think.mjs` 現有 code
- [x] 分析 `mode:"cit"` / `mode:"beam"` / `mode:"forest"` 三種模式的 prompt 模板
- [x] 理解 BN-DP（Branching Necessity Decision Process）的分支邏輯
- [x] 確定 where to inject structured format constraint（在 quickThought() 中新增 mode === 'structured' 分支）

### 16.2 Structured prompt 設計

- [x] 設計 GOAL/STATE/ALGO/EDGE/VERIFY 五段式 prompt 模板
- [x] 確認向後相容：無 mode 參數時沿用現有行為
- [x] 採用模板方式（非 grammar），在 quickThought() 中格式化輸出

### 16.3 實作：smart_think 擴充

- [x] `src/plugins/core/quick-think.mjs` — 新增 `mode:"structured"` 參數 + 5 個 structured 欄位
- [x] `src/cli/thinking.mjs` — quickThought() 新增 structured mode 渲染邏輯
- [x] GOAL 區塊：一句話定義目標
- [x] STATE 區塊：目前已知資訊和上下文
- [x] ALGO 區塊：推理路徑和方法
- [x] EDGE 區塊：邊界條件和限制
- [x] VERIFY 區塊：自我驗證邏輯
- [x] 支援 partial fields（只填部分欄位）
- [x] 支援 supplementary thought（structured + free-form 補充）
- [x] 支援 fallback（無 structured fields 時顯示 free-form fallback）

### 16.4 整合

- [x] `src/lib/context-budget.mjs` — 加入 structured thinking token 節省追蹤（trackStructuredThinking + getStructuredThinkingStats）
- [x] `config/agents/smart-mcp.md` — 加入 structured thinking 使用時機說明 + 完整範例
- [x] 模板綁定：debug/refactor/architecture 模板建議啟用 structured mode

### 16.5 測試

- [x] Structured mode 格式驗證（5 區塊正確產生）
- [x] Partial fields 正確（只顯示有值的區塊）
- [x] Supplementary thought 正確附加
- [x] Fallback 模式正確
- [x] Token 節省驗證（structured vs free-form 的 token 差異 ≥50%）
- [x] 向後相容：無 mode 參數時行為不變
- [x] 全量 regression（48 項 thinking tests + 26 項 context-budget tests 全部通過）

---

## Phase 17：MCTS Tool Planning — 蒙地卡羅樹搜尋工具規劃 ✅

> 參考：ToolTree (ICLR 2026) — 雙回饋 MCTS + 雙向剪枝
> 目標：在工具空間中用 MCTS 搜尋最佳路徑，取代靜態正則匹配。
> 預估：複雜任務工具選擇準確率從 ~70% 提升至 ~85%+
> **完成日期：2026-06-13**

### 17.1 研究：現有 tool-strategy 架構分析

- [x] 閱讀 `src/agent/tool-strategy.mjs` 現有 code
- [x] 分析 TASK_PATTERNS 的匹配邏輯和 chain 定義
- [x] 理解 hybrid-engine.mjs 的 classifyQuestion + DOMAIN_MAP 路由
- [x] 確定哪些任務適合 MCTS（5+ 步驟的複雜 multi-step 任務）

### 17.2 MCTS 引擎設計

- [x] MCTS Node 資料結構：{ id, tool, args, parent, children, visits, reward, preScore, postScore }
- [x] UCT (Upper Confidence Bound for Trees) selection formula
- [x] Pre-evaluation：快速 schema/slot 檢查（不執行工具）
- [x] Post-evaluation：根據執行結果評分工具貢獻
- [x] Bidirectional pruning：pre + post 雙向剪枝
- [x] 收斂條件：max iterations 或 score 穩定

### 17.3 實作：MCTS 引擎

- [x] `src/lib/mcts-planner.mjs` — MCTS 核心引擎
- [x] UCTNode class + selection/expansion/simulation/backpropagation
- [x] PreEvaluator：工具 schema/slot 相容性檢查
- [x] PostEvaluator：執行結果貢獻評分
- [x] BidirectionalPruner：剪枝邏輯
- [x] SearchLoop：iteration 管理 + 收斂判斷
- [x] 降級機制：MCTS timeout → fallback 到靜態正則匹配

### 17.4 MCP Plugin

- [x] `src/plugins/standard/mcts-plan.mjs` — `smart_mcts_plan` 工具
- [x] inputSchema：{ goal, tools, context, maxIterations?, timeout? }
- [x] handler：呼叫 MCTS engine → 回傳最佳工具鏈
- [x] responsePolicy: maxLevel 0（結果不能壓縮）

### 17.5 hybrid-engine 整合

- [x] `src/lib/hybrid-engine.mjs` DOMAIN_MAP 加入 mcts 領域
- [x] 觸發條件：複雜 multi-step 任務（5+ 步驟、多檔案、跨工具）
- [x] 整合流程：classify → MCTS → 推薦工具鏈
- [x] 查看現有 general recommendation 流程，確保不破壞

### 17.6 測試

- [x] MCTS Node selection (UCT) 正確性
- [x] Pre-evaluation 正確過濾不相容工具
- [x] Post-evaluation 正確評分
- [x] Bidirectional pruning 正確性
- [x] 收斂判斷（max iterations / score stable）
- [x] 降級機制（timeout → static fallback）
- [x] Plugin integration（smart_mcts_plan 正常回傳）
- [x] hybrid-engine 整合不破壞現有 routing
- [x] **40 項測試全部通過**

---

## Phase 18：Speculative Tool Pre-fetch — 推測性工具預取 ✅

> 參考：naimengye/speculative-action
> 目標：當 LLM 呼叫一個工具時，server 推測下一步可能用什麼工具並提前執行。
> 預估：省 1-2 輪 tool call round-trip，cache hit rate 40-60%。
> **完成日期：2026-06-13**

### 18.1 設計 Pre-fetch 規則

- [x] 定義 pre-fetch 規則表（觸發工具 → pre-fetch 工具 + TTL）
  - smart_grep → smart_lsp hover（對 grep 結果的第一個符號）
  - smart_think → memory_store search（對 think topic）
  - smart_security → smart_grep（對 security 找到的檔案）
  - smart_learn → import_graph
  - smart_error_diagnose → smart_lsp diagnostics
- [x] TTL 設計：pre-fetch 結果 TTL 5s，過期自動丟棄
- [x] 安全機制：pre-fetch 結果不進 context 除非命中

### 18.2 實作：Pre-fetch Engine

- [x] `src/lib/prefetch-engine.mjs` — Pre-fetch 引擎
- [x] PrefetchRule：{ trigger, prefetch, ttl, contextExtractor }
- [x] contextExtractor：從 trigger tool 的 args/result 中提取 pre-fetch 所需的 context
- [x] In-memory cache：Map<tool+argsHash, { result, expiresAt }>
- [x] Cache hit/miss 判斷 + TTL 檢查
- [x] Fire-and-forget 執行（不堵塞主回應）
- [x] 統計追蹤：cache hit/miss/expiry/triggered/skipped 次數
- [x] Recursion guard：pre-fetch 結果不觸發進一步 pre-fetch
- [x] Dedup：相同 key 的 pre-fetch 只執行一次

### 18.3 Server 端整合

- [x] `src/server/index.mjs` — invokeTool 成功後 fire-and-forget pre-fetch（captureAndReturn）
- [x] `src/server/index.mjs` — invokeTool 前檢查 pre-fetch cache
- [x] 條件：只在成功呼叫後觸發（失敗不 pre-fetch）
- [x] 條件：只在非預取操作觸發（skipCapture 避免遞迴）
- [x] Pre-fetch stats 整合進 getStatsSummary

### 18.4 測試

- [x] Pre-fetch 觸發規則正確性（5 條規則逐一驗證）
- [x] Cache hit/miss 判斷正確
- [x] TTL 過期自動清除
- [x] Fire-and-forget 不堵塞主回應
- [x] 遞迴 pre-fetch 防護
- [x] 統計追蹤正確
- [x] 19 項測試全部通過

---

## Phase 19：Cross-Agent Shared Memory — 跨 Agent 記憶共享 ✅

> 參考：Continuum (redstone-md)、mcp-agora
> 目標：讓 Claude Code、OpenCode、Codex 共享同一份 memory DB，新 agent 立即受益。
> 預估：新 agent 冷啟動時間從 0 → 立即受益於其他 agent 的學習。
> **完成日期：2026-06-13**

### 19.1 Schema 擴充

- [x] `src/lib/memory-db.mjs` — `entries` table 新增 `agent_id TEXT` 欄位
- [x] `src/lib/memory-db.mjs` — 自動 migration（ALTER TABLE ADD COLUMN）
- [x] `src/lib/memory-db.mjs` — 新增 `idx_entries_agent_id` index
- [x] `src/lib/memory-db.mjs` — insertEntry/updateEntry 支援 agent_id

### 19.2 memory_store CLI/Plugin 更新

- [x] `src/plugins/standard/memory_store.mjs` — 接受 `agent` 參數
- [x] `src/cli/memory-store.mjs` — 自動偵測 agent_id（detectAgentId: env var → hostname → "unknown"）
- [x] `src/cli/memory-store.mjs` — CLI 新增 `--agent` flag
- [x] `src/lib/memory-db.mjs` — searchHybrid 支援 agent_id 過濾
- [x] `src/lib/memory-db.mjs` — listEntries 支援 agent_id 過濾
- [x] 跨 agent 查詢模式（不加 agent_id 或 `--agent all` 時搜尋全部）

### 19.3 Auto Memory Injection 更新

- [x] `src/server/index.mjs` — autoInjectMemory 支援 agent_id 優先注入
- [x] 策略：優先注入本 agent 的記憶（agentBonus +50），其次跨 agent 的記憶
- [x] `src/server/index.mjs` — 新增 detectAgentId() 函數

### 19.4 Agent personality

- [x] `config/agents/smart-mcp.md` — 跨 agent 記憶使用說明（已透過 memory_store 的 agent 參數涵蓋）

### 19.5 測試

- [x] agent_id 寫入正確
- [x] agent_id 過濾查詢正確（只看本 agent / 跨 agent）
- [x] 自動 migration（舊 schema → 新 schema）
- [x] Auto injection agent_id 過濾正確
- [x] 全量 regression（28 項 memory-db tests + 7 項 agent tests 全部通過）

---

## Phase 20：Execution-Grounded Verification — 執行驗證的程式碼生成 ✅

> 參考：IBM/verified-code-cot
> 目標：code generation 後自動在 sandbox 執行驗證，確保產出可執行的 code。
> 預估：可執行率從 ~70% 提升至 ~95%+。
> **完成日期：2026-06-13**

### 20.1 Code Verification Pipeline

- [x] `src/lib/code-verifier.mjs` — `verifyCode(code, language)` 函數
- [x] 執行流程：extract code → sandbox execute → check exit code + output
- [x] 成功路徑：回傳 code + execution result + metadata
- [x] 失敗路徑：回傳 code + error + suggestion
- [x] Retry loop：最多 1 輪自動修正
- [x] 安全限制：timeout 30s, output cap 50KB

### 20.2 smart_exec 擴充

- [x] `src/plugins/standard/exec.mjs` — 新增 `verify` mode
- [x] verify mode 參數：{ code, language, testCases?, maxRetries? }
- [x] Handler：呼叫 code-verifier → 回傳驗證結果
- [x] 回傳格式：{ ok, verified, compilation, execution, retries, issues }

### 20.3 Agent personality

- [x] `config/agents/smart-mcp.md` — code generation 自動驗證流程
- [x] 規則：產生 code 後自動呼叫 `smart_exec({mode:"verify", ...})`
- [x] 驗證失敗：自動修正（最多 1 輪）

### 20.4 測試

- [x] verifyCode 正確執行（4 種語言：js/py/bash/ts）
- [x] 成功碼驗證（exit code 0 + 預期 output）
- [x] 失敗碼處理（exit code non-zero + error 訊息）
- [x] Retry loop 正確（最多 1 輪）
- [x] Safety limits（timeout / output cap）
- [x] Plugin integration（smart_exec mode:"verify"）
- [x] **21 項測試全部通過**

---

## Phase 21：smart_read — 漸進式檔案讀取 ✅

> 參考：Arrayo/smart-context-mcp（90% token 省 — outline/signatures/symbol/full 四層壓縮）
> 目標：用 outline/signatures/symbol/full 四模式取代 raw read，省 60-80% read token。
> **完成日期：2026-06-13**

### 21.1 核心引擎

- [x] `src/lib/smart-read.mjs` — SmartReader class + 四種 mode handler
- [x] `detectLanguage()` — 21 種 extension → language 映射
- [x] `getPatternsForLanguage()` — 6 種語言 pattern（JS/TS/Python/Go/Rust/Universal）
- [x] `parseDeclarations()` — line-based 解析器（regex + 行號追蹤）
- [x] `extractSymbol()` — exact + fuzzy symbol 查詢
- [x] `generateOutline()` — 檔案結構輪廓（name + type + line）
- [x] `generateSignatures()` — 結構 + 簽名行 + 行範圍
- [x] `readFull()` — 傳統完整讀取
- [x] Brace matching body extraction（JS/TS/Go/Rust/C/etc.）
- [x] Python indentation-based body extraction
- [x] Dedup + 排序（按行號）

### 21.2 JS/TS 支援

- [x] 函式：`function`, `async function`, `export function`, `export default function`
- [x] 類別：`class`, `export class`, `abstract class`, `export default class`
- [x] 箭頭函式：`const name = (args) =>`
- [x] 變數：`const`, `let`, `var` assignments
- [x] 介面：`interface Name`
- [x] Type alias：`type Name =`
- [x] Enum：`enum Name`
- [x] Symbol body 提取（正確巢狀 brace matching）

### 21.3 Python 支援

- [x] 函式：`def name`, `async def name`
- [x] 類別：`class Name`
- [x] Decorator-aware（`@property`, `@staticmethod` 等）
- [x] Indentation-based body extraction

### 21.4 Go 支援

- [x] 函式：`func name`, `func (r T) name`
- [x] 結構體：`type T struct`
- [x] 介面：`type T interface`
- [x] Type alias：`type T =`

### 21.5 Rust 支援

- [x] 函式：`fn name`, `pub fn name`, `async fn name`
- [x] 結構體：`struct Name`
- [x] Impl：`impl Name`
- [x] Trait：`trait Name`
- [x] Enum：`enum Name`
- [x] 常數：`const NAME: type`

### 21.6 MCP Plugin

- [x] `src/plugins/standard/smart-read.mjs` — `smart_read` 工具
- [x] inputSchema：{ file, mode, symbol, root, offset, limit, lang, format }
- [x] Four modes：outline / signatures / symbol / full
- [x] Text 輸出格式（human-readable + 省 token tip）
- [x] JSON 輸出格式（machine-readable）
- [x] responsePolicy: maxLevel 0（lossless）

### 21.7 測試

- [x] `tests/smart-read.test.mjs` — language detection（21 cases）
- [x] JS parseDeclarations（7 cases）
- [x] JS outline / signatures / extractSymbol
- [x] TS interface/type/enum/class/function 檢測
- [x] TS symbol body extraction（class + interface）
- [x] Python def/class/async def 檢測
- [x] Python class body extraction（indentation-based）
- [x] Go func/struct/interface 檢測
- [x] Rust fn/struct/impl/trait/enum 檢測
- [x] SmartReader class 整合（8 cases：outline/signatures/symbol/full/offset/error）
- [x] Error handling（file not found, symbol not found, invalid mode）
- [x] **69 項測試全部通過**

---

## Phase 22：smart_edit_ast — AST 感知編輯 ✅

> 參考：Zenith-MCP（AST-based editing，三模式）
> 目標：提供比 smart_edit 更精確、更容錯的編輯能力。
> **完成日期：2026-06-13**

### 22.1 Plugin 實作

- [x] `src/plugins/standard/smart-edit-ast.mjs` — `smart_edit_ast` 工具
- [x] inputSchema：{ file, mode, match/replace, action/startLine/endLine/text, symbol, apply, format }
- [x] responsePolicy: maxLevel 0（lossless）

### 22.2 content-match 模式

- [x] Exact match（原始字串）
- [x] Flexible match（trim-tolerant，逐行比對）
- [x] Context display（前後 3 行）
- [x] Diff preview（簡易 unified diff）

### 22.3 block-boundary 模式

- [x] replace：取代指定行範圍
- [x] delete：刪除指定行範圍
- [x] insert-before：在指定行前插入
- [x] insert-after：在指定行後插入
- [x] 行範圍驗證（1-indexed，邊界檢查）

### 22.4 symbol-edit 模式

- [x] 整合 smart-read extractSymbol 定位 symbol
- [x] append：在 symbol body 結尾附加
- [x] prepend：在 symbol body 開頭插入
- [x] replace-body：置換整個 body
- [x] delete：刪除整個 symbol

### 22.5 安全性

- [x] 預設 dry-run（apply:false）
- [x] Diff preview 在 dry-run 時顯示
- [x] File existence 檢查
- [x] JSON/text 雙輸出格式

---

## Phase 16-22 里程碑

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1 | Phase 16 完成（Structured Thinking） | ✅ 2026-06-13 |
| M2 | Phase 18 完成（Speculative Pre-fetch） | ✅ 2026-06-13 |
| M3 | Phase 19 完成（Cross-Agent Memory） | ✅ 2026-06-13 |
| M4 | Phase 17 完成（MCTS Planning） | ✅ 2026-06-13 |
| M5 | Phase 20 完成（Verified Code Gen） | ✅ 2026-06-13 |
| M6 | Phase 21 完成（smart_read） | ✅ 2026-06-13 |
| M7 | Phase 22 完成（smart_edit_ast） | ✅ 2026-06-13 |
| M8 | 全量 regression + 效能 benchmark | ⏳ 待辦 |

---

## 各 Phase 依賴關係

```
Phase 16 (Structured Thinking)     — 無外部相依
Phase 17 (MCTS Tool Planning)      — 相依 hybrid-engine（已存在）
Phase 18 (Speculative Pre-fetch)    — 相依 server/index.mjs（已存在）
Phase 19 (Cross-Agent Memory)      — 相依 memory-db（已存在）
Phase 20 (Verified Code Gen)       — 相依 smart_exec（已存在，Phase 10.1 ✅）
Phase 21 (smart_read)              — 相依 src/lib/smart-read.mjs（新建）
Phase 22 (smart_edit_ast)          — 相依 src/lib/smart-read.mjs（Phase 21）
```

**執行順序**：16 → 18 → 19（平行可做）→ 17 → 20 → 21 → 22

---

## 競爭品追蹤（持續更新）

| 競爭品 | 最新版本 | 變化 | 影響 |
|--------|---------|------|------|
| smart-mcp (spak2005) | 2026-02 | FAISS 語義路由，97% token 省 | 同名混淆，需持續關注定位區隔 |
| MCPlex | 2026-04 | Rust gateway + RBAC + dashboard | 目標客群不同（企業 vs 個人開發者） |
| Continuum | 2026-05 | 跨 agent daemon + AST KG | 🔥 最大威脅 — 需加速 Phase 19 |
| Tool Compass | 2026-01 | 漸進式揭露，95% token 省 | Smart MCP hybrid_router 已涵蓋 |
| mcpflow-router | 2026-03 | OpenCode 專用 gateway | 直接競爭，但只做路由不做智慧層 |
| ReasonKit Think | 2026-05 | MCP 原生 CoT/ToT/GoT | 方向一致，但 Smart MCP 更輕量 |
| structured-cot | 2026-04 | 22× token 壓縮 | ⬅️ Phase 16 直接參考 |
| ToolTree (ICLR 2026) | 2026-03 | MCTS 工具規劃 | ⬅️ Phase 17 直接參考 |
| Meta-Reasoning | 2026-04 | 外部認知控制器 | ⬅️ Phase 21 長期參考 |