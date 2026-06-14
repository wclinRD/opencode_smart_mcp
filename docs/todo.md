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

## Phase 23：smart_read 強化（auto/range/batch/compact）✅

> 參考：Arrayo/smart-context-mcp, rjkaes/trueline-mcp, breca/codemap, cline/cortex-works
> 目標：讓 smart_read 比原生 read 更強大、更有效率

### 23.1 研究：競爭品 smart read 功能比較（已完成）

- [x] Arrayo/smart-context-mcp — batch 讀取、range mode、session context 恢復
- [x] trueline-mcp — content hash 行驗證、大檔案自動轉向 smart_read
- [x] breca/codemap — Tree-sitter AST SQLite 索引、漸進細節層級
- [x] cortex-works — L1→L2→L3 漸進揭露、compact output

### 23.2 實作：核心引擎強化

- [x] `mode: "auto"` — 依檔案大小自動選模式（新預設！<50 full / 50-300 sig / >300 outline）
- [x] `mode: "range"` — 指定行範圍讀取（startLine/endLine），附 content checksum
- [x] `mode: "batch"` — 一次讀取多個檔案（files:["f1","f2"]），混合錯誤處理
- [x] `hashContent()` — SHA-256 內容雜湊（16 hex），供編輯驗證用
- [x] `thresholds` 自訂參數 — auto 模式 threshold 可設定

### 23.3 實作：Plugin 強化

- [x] 更新 inputSchema — 新增 mode:auto/range/batch、startLine/endLine、files
- [x] `format: "compact"` — 零裝飾最小 token 輸出
- [x] batch 模式輸出格式（進度摘要 + 各檔案預覽）
- [x] range 模式輸出格式（含 checksum 顯示）
- [x] Updated routing tips

### 23.4 測試

- [x] Auto mode tests（small→full, medium→sig, large→outline, custom thresholds）
- [x] Range mode tests（specific range, default range, checksum, numbered:false）
- [x] Batch mode tests（multiple files, mixed success/error, empty list）
- [x] hashContent tests（consistency, different content, hex format）
- [x] Full mode checksum test

### 23.5 文件

- [x] `docs/plan.md` — Phase 23 完成條目、長期願景重新編號
- [x] `docs/todo.md` — Phase 23 完整追蹤、里程碑更新
- [x] `config/agents/smart-mcp.md` — 路由規則更新

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

## Phase 16-24 里程碑

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1 | Phase 16 完成（Structured Thinking） | ✅ 2026-06-13 |
| M2 | Phase 18 完成（Speculative Pre-fetch） | ✅ 2026-06-13 |
| M3 | Phase 19 完成（Cross-Agent Memory） | ✅ 2026-06-13 |
| M4 | Phase 17 完成（MCTS Planning） | ✅ 2026-06-13 |
| M5 | Phase 20 完成（Verified Code Gen） | ✅ 2026-06-13 |
| M6 | Phase 21 完成（smart_read） | ✅ 2026-06-13 |
| M7 | Phase 22 完成（smart_edit_ast） | ✅ 2026-06-13 |
| M8 | Phase 23 完成（smart_read 強化） | ✅ 2026-06-13 |
| M9 | Phase 24 (Session Cache + Explain + Project Map) | ✅ 2026-06-13 |
| M10 | 全量 regression + 效能 benchmark | ✅ 2026-06-13 |

---

## Phase 25：Tool Transition Learning — 工具轉移學習

> 參考：AutoTool（Learning to Route Tools）
> 目標：從工具呼叫序列中學習轉移模式，讓 prefetch 和路由建議從數據學習而非硬編碼。
> 預估：pre-fetch 準確率從 50-60% 提升至 70-85%+

### 25.1 Schema：`tool_transitions` 表

- [ ] `src/lib/memory-db.mjs` — 新增 `tool_transitions` SQLite 表
  - from_tool TEXT NOT NULL
  - to_tool TEXT NOT NULL
  - success_count INTEGER DEFAULT 1
  - fail_count INTEGER DEFAULT 0
  - avg_duration REAL
  - last_seen TEXT
  - UNIQUE(from_tool, to_tool)

### 25.2 Transition CRUD

- [ ] `src/lib/memory-db.mjs` — `recordTransition(from, to, success, duration)`：記錄一次工具轉移
- [ ] `src/lib/memory-db.mjs` — `getTopTransitions(fromTool, limit=3)`：查詢最可能的下個工具
- [ ] `src/lib/memory-db.mjs` — `getTransitionStats()`：整體轉移統計
- [ ] `src/lib/memory-db.mjs` — `learnToolChain(minLength=3)`：從 transition 數據學習常用工具鏈

### 25.3 Server 端 hook

- [ ] `src/server/index.mjs` — invokeTool 成功後記錄 transition（追蹤前一個工具 → 當前工具）
- [ ] Transition 追蹤：{ lastTool, lastToolResult, lastToolDuration } session 變數
- [ ] 僅記錄成功呼叫（失敗不影響 transition 權重）

### 25.4 Prefetch 強化

- [ ] `src/lib/prefetch-engine.mjs` — `prefetchFromTransitions(fromTool)`：查詢 DB 取得 top 3 轉移
- [ ] 靜態規則 + 動態 transition 混合：transition 有數據時優先使用，否則 fallback 靜態規則
- [ ] 自動在 5 筆 transitions 後啟用動態模式

### 25.5 測試

- [ ] Transition 記錄正確（from→to + success/fail）
- [ ] getTopTransitions 回傳正確排序
- [ ] 混合模式（靜態 + 動態）正確
- [ ] 冷啟動：無數據時正常 fallback

---

## Phase 26：Tool Selection Feedback — 工具選擇回饋

> 參考：JTPRO（Just-in-Time Prompt Routing）
> 目標：記錄推薦 vs 實際使用的工具，根據回饋自動調整路由策略。
> 預估：工具推薦準確率從 ~70% 提升至 80-90%+

### 26.1 Schema：`tool_feedback` 表

- [ ] `src/lib/memory-db.mjs` — 新增 `tool_feedback` SQLite 表
  - id INTEGER PRIMARY KEY
  - goal_context TEXT（任務描述片段）
  - recommended_tool TEXT
  - actual_tool TEXT
  - success INTEGER（推薦命中 = 1）
  - duration_ms INTEGER
  - session_id TEXT
  - created_at TEXT

### 26.2 Feedback CRUD

- [ ] `src/lib/memory-db.mjs` — `recordFeedback(goal, recommended, actual, duration)`
- [ ] `src/lib/memory-db.mjs` — `getRecommendationStats(tool)`：查詢某工具的推薦成功率
- [ ] `src/lib/memory-db.mjs` — `getPatternAdjustments()`：取得需調整的 pattern 列表

### 26.3 tool-strategy 強化

- [ ] `src/agent/tool-strategy.mjs` — recommendTools 傳入 feedback context
- [ ] 低成功率 tool chain 降級（success < 0.3 自動降低優先順序）
- [ ] 高成功率 pattern 升級（success > 0.8 提高 matchScore 權重）

### 26.4 Server 端 hook

- [ ] `src/server/index.mjs` — 在 invokeTool 入口記錄推薦 vs 實際選擇
- [ ] 服務統計 API 包含 feedback 數據

### 26.5 測試

- [ ] Feedback 記錄正確
- [ ] getRecommendationStats 正確計算
- [ ] Pattern 自動調整正確
- [ ] 無數據時正常運作

---

## Phase 27：Semantic Cache Routing — 語意快取路由

> 參考：semantic-cache（Embedding-based caching for LLM routing）
> 目標：對相同/相似任務目標直接回傳 cached tool chain，省 pattern match 時間。
> 預估：重複任務處理速度提升 10x（cache hit）

### 27.1 Schema：`semantic_cache` 表

- [ ] `src/lib/memory-db.mjs` — 新增 `semantic_cache` SQLite 表
  - goal TEXT（原始任務描述）
  - goal_hash TEXT UNIQUE（用於 exact match）
  - goal_embedding BLOB（384-dim）
  - tool_chain TEXT（JSON 陣列）
  - hit_count INTEGER DEFAULT 1
  - success_count INTEGER DEFAULT 1
  - created_at TEXT
  - last_seen TEXT

### 27.2 Embedding 產生器

- [ ] `src/lib/semantic-cache.mjs` — `hashEmbed(text)`：使用 hash-based 384-dim embedding（不依賴外部模型）
- [ ] 降級方案：使用 simple hash → 384-dim float 轉換（確保與現有 sqlite-vec 相容）

### 27.3 Cache CRUD

- [ ] `src/lib/memory-db.mjs` — `cacheGoal(goal, toolChain)`：儲存 goal→toolChain 映射 + embedding
- [ ] `src/lib/memory-db.mjs` — `searchCache(goal, threshold=0.85)`：語意搜尋最相似 past goal
- [ ] `src/lib/memory-db.mjs` — `updateCacheStats(goalHash, success)`：更新命中/成功統計

### 27.4 tool-strategy 整合

- [ ] `src/agent/tool-strategy.mjs` — recommendTools 前先查 semantic cache
- [ ] Cache hit（similarity > 0.85）→ 直接回傳 cached tool chain
- [ ] Cache miss → 正常 pattern match → 快取結果

### 27.5 測試

- [ ] hashEmbed 一致性驗證（相同 text → 相同 embedding）
- [ ] cacheGoal / searchCache 正確
- [ ] 相似度 threshold 正確過濾
- [ ] 無數據時正常 fallback

---

## Phase 25-27 里程碑

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M11 | Phase 25 (Transition Learning) 完成 | 📅 本期 |
| M12 | Phase 26 (Tool Selection Feedback) 完成 | 📅 本期 |
| M13 | Phase 27 (Semantic Cache Routing) 完成 | 📅 本期 |
| M14 | Phase 25-27 全量 regression | 📅 本期 |

---

## M10 全量 regression（已完成 ✅）

- [x] 執行全量測試 — 發現 personality test 中 task subagent routing rule 的 assert 字串過時（`smart_read` 已插入工具鏈），已修正為 `smart_lsp > smart_read > smart_grep > raw grep/read`
- [x] 確認 251 項核心測試通過（smart-read / MCTS / thinking / code-verifier / prefetch / memory-db）
- [x] 已知問題：`dispatch group` workflow 測試因 `smart_test` 遞迴執行完整測試套件而 timeout（預設 30s timeout + 測試總時間 > 30s），為獨立 pre-existing issue
- [x] 代理設定檔 `smart-mcp.md` 已同步（`read: deny` 正確）
- [x] 里程碑 M10 標記為 ✅

---

## Phase 28：Semantic Tool Router — Embedding 語意工具匹配

> 參考：OpenAI Agents SDK（semantic tool matching）、Cursor（relevance-based context）
> 目標：tool-strategy 從純 regex 升級為 regex + TF-IDF + embedding 三路融合匹配
> 預估：工具推薦準確率 +30-50%，模糊任務匹配覆蓋率大幅提升

### 28.1 研究：現有 tool-strategy 架構分析

- [ ] 閱讀 `smart-agent/src/agent/tool-strategy.mjs` 現有 12 條 regex 規則
- [ ] 分析 `recommendTools()` 的匹配流程與 `matchScore` 計算
- [ ] 分析 `buildToolChain()` 的工具鏈組合邏輯
- [ ] 確定 semantic matching 的注入點（在 regex 之後作為第二層）

### 28.2 TF-IDF 向量化器

- [ ] 建立 `src/lib/tfidf-matcher.mjs` — TfidfMatcher class
- [ ] 實作 `buildIndex(tools[])` — 對工具 description + inputSchema 建 TF-IDF 矩陣
- [ ] 實作 `search(query)` — 回傳 top-K 匹配工具 + 分數
- [ ] 支援中文分詞（使用 whitespace tokenizer + bigram fallback）

### 28.3 Embedding 語意匹配

- [ ] 建立 `src/lib/semantic-router.mjs` — SemanticRouter class
- [ ] 實作 `buildIndex(tools[])` — 對工具 description 產生 384-dim embedding（sqlite-vec）
- [ ] 實作 `search(query)` — ANN 搜尋 top-K 匹配
- [ ] 實作 `fuseScores(regexScore, tfidfScore, embScore)` — 三路融合（0.3/0.3/0.4）

### 28.4 tool-strategy 整合

- [ ] 修改 `smart-agent/src/agent/tool-strategy.mjs` — `recommendTools()` 改用 semantic router
- [ ] 保留 regex 作為 fallback（semantic router 失敗時）
- [ ] 加入 `confidence` 欄位到推薦結果

### 28.5 工具 description 強化（anti-pattern 指引）

- [ ] 為每個 Layer 1 工具加入 `avoidWhen` 欄位
- [ ] 為每個 Layer 2 工具加入 `avoidWhen` 欄位
- [ ] 更新 `config/agents/smart-mcp.md` — 加入 anti-pattern 使用說明

### 28.6 測試

- [ ] `tests/semantic-router.test.mjs` — TF-IDF 匹配準確率
- [ ] embedding 匹配準確率
- [ ] 三路融合權重驗證
- [ ] regex fallback 驗證
- [ ] 邊界案例（空 query、未知任務）

---

## Phase 29：Self-Reflection & Adaptive Learning — 自我反思與自適應學習

> 參考：Reflexion Pattern、OpenAI Agents SDK（tool guardrails）
> 目標：任務完成後自動反思 + 根據歷史 toolStats 動態調整路由權重 + JSON Schema 輸入驗證
> 預估：錯誤重複率 -50%，工具呼叫錯誤 -70%

### 29.1 Reflection Engine

- [ ] 建立 `src/lib/reflection-engine.mjs` — ReflectionEngine class
- [ ] 實作 `analyzeToolHistory(history)` — 分析哪些工具被呼叫但結果未使用
- [ ] 實作 `analyzeToolChain(chain)` — 分析哪些步驟可以跳過
- [ ] 實作 `analyzeToolStats(stats)` — 分析哪個工具最常失敗
- [ ] 實作 `generateReflection(analysis)` — 產生結構化 reflection summary
- [ ] 實作 `storeReflection(summary)` — 寫入 memory_store（skill_patch type）

### 29.2 Post-Task Hook

- [ ] 修改 `src/server/index.mjs` — 在 session 結束或任務完成時觸發 reflection
- [ ] 實作 `triggerReflection()` — fire-and-forget，不阻塞回應
- [ ] 加入 reflection 頻率控制（每 N 次任務觸發一次，避免過度）

### 29.3 Adaptive Weight Adjuster

- [ ] 在 `src/lib/reflection-engine.mjs` 加入 `adjustWeights(toolStats)`
- [ ] 根據 toolStats 動態調整 `recommendTools()` 的 pattern 權重
- [ ] 低成功率 pattern 自動降級（權重 ×0.5）
- [ ] 高成功率 pattern 自動升級（權重 ×1.2）

### 29.4 Pre-Execution Memory Check

- [ ] 修改 `smart-agent/src/agent/tool-strategy.mjs` — `buildToolChain()` 前先搜 memory
- [ ] 實作 `checkMemoryBeforeExecution(goal)` — 查 memory_store 有無 past fix pattern
- [ ] 若命中高信心 past fix → 直接回傳 known tool chain

### 29.5 Tool Input Validation

- [ ] 建立 `src/lib/tool-validator.mjs` — ToolValidator class
- [ ] 實作 `validate(toolName, args)` — 對照 inputSchema 驗證參數
- [ ] 支援型別檢查（string/number/boolean/enum）
- [ ] 支援 required 欄位檢查
- [ ] 整合到 `src/server/index.mjs` — invokeTool 前自動驗證

### 29.6 Agent Personality 更新

- [ ] 更新 `config/agents/smart-mcp.md` — 加入 reflection + adaptive routing 使用說明

### 29.7 測試

- [ ] `tests/reflection-engine.test.mjs` — reflection 產生
- [ ] adaptive weight 調整
- [ ] pre-execution memory check
- [ ] tool input validation（正確/錯誤/邊界）
- [ ] post-task hook 觸發

---

## Phase 30：Smart Output Management — 智能輸出管理

> 參考：Sophon（21 種 domain filter）、Anthropic prompt caching
> 目標：智能截斷 + caveman 通用壓縮 + streaming 輸出 + 自動 budget 管理
> 預估：Context budget 觸發頻率 -60%+，平均輸出 token -15-25%

### 30.1 智能截斷引擎

- [ ] 建立 `src/lib/truncation-engine.mjs` — TruncationEngine class
- [ ] 實作 `smartTruncate(text, maxChars)` — 保留關鍵段落 + 摘要其餘
- [ ] 實作 `extractKeySections(text)` — 辨識 error message / code block / 關鍵數據
- [ ] 實作 `generateSummary(truncated)` — 產生截斷部分的簡短摘要
- [ ] 實作 `formatTruncated(text, summary, fullLink)` — 格式化輸出 + 展開連結

### 30.2 Caveman 通用壓縮

- [ ] 建立 `src/lib/caveman-compress.mjs` — CavemanCompress class
- [ ] 從 `smart_exa_search` 的 caveman 邏輯抽取通用版
- [ ] 支援 `compressLevel`: light / semantic / aggressive / ultra
- [ ] 整合到 `src/lib/output-optimizer.mjs` — 所有工具輸出可選 caveman 壓縮

### 30.3 Streaming 輸出

- [ ] 研究 MCP 協定的 streaming 機制
- [ ] 修改 `src/server/index.mjs` — 支援 streaming response
- [ ] 大輸出（>50K chars）自動切換為 streaming mode
- [ ] 實作 chunk 邊界偵測（以段落/程式碼區塊為單位）

### 30.4 自動 Budget 管理

- [ ] 修改 `src/lib/context-budget.mjs` — 三級分級警告
  - budget < 80%：溫和提示 "💡 Budget 80%"
  - budget < 95%：強烈建議 "⚡ Budget 95%。建議 compact"
  - budget < 100%：自動 compact + "⚠️ Budget 滿。已自動 compact"
- [ ] 實作 `autoCompact()` — budget 滿時自動執行 compact
- [ ] 提高預設 threshold：200K → 400K chars

### 30.5 Budget 計算優化

- [ ] 修改 `src/lib/context-budget.mjs` — 不重複計算 session cache 命中的內容
- [ ] 排除 metadata（checksum、_optimized、tooltip）
- [ ] 加入 `budget reset` 指令（手動重置計數器）

### 30.6 Agent Personality 更新

- [ ] 更新 `config/agents/smart-mcp.md` — 加入輸出管理使用說明

### 30.7 測試

- [ ] `tests/output-management.test.mjs` — 智能截斷
- [ ] caveman 壓縮（各 level）
- [ ] streaming 輸出
- [ ] budget 分級警告
- [ ] budget 自動 compact
- [ ] budget 計算優化

---

## Phase 31：Parallel Execution & Pre-Indexing — 平行執行與預索引

> 參考：Anthropic parallel tool calling、Cursor codebase indexing
> 目標：workflow dispatch 支援平行 group 執行 + 專案首次開啟自動 pre-index
> 預估：多步任務速度 2-3x，smart_learn 首次查詢 <100ms

### 31.1 Parallel Dispatch Engine

- [ ] 建立 `src/lib/parallel-executor.mjs` — ParallelExecutor class
- [ ] 實作 `analyzeDag(steps)` — 分析步驟間相依性，分組
- [ ] 實作 `executeGroup(group)` — 平行執行無相依的步驟（Promise.all）
- [ ] 實作 `executePipeline(dag)` — 依序執行各 group
- [ ] 支援 timeout per group
- [ ] 支援 partial failure（某步驟失敗不影響其他平行步驟）

### 31.2 Workflow 整合

- [ ] 修改 `src/plugins/standard/workflow.mjs` — `dispatch` 支援 parallel group
- [ ] 修改 `src/plugins/standard/compose.mjs` — `mode:"par"` 改用 parallel executor
- [ ] 修改 `smart-agent/src/agent/workflow-strategy.mjs` — 自動標記可平行化的步驟

### 31.3 Pre-Indexing Engine

- [ ] 建立 `src/lib/pre-indexer.mjs` — PreIndexer class
- [ ] 實作 `buildIndex(root)` — 掃描專案結構 + 建立 SQLite cache
- [ ] 實作 `checkCache(root)` — 檢查 cache 是否有效（mtime 比對）
- [ ] 實作 `getFromCache(root)` — 從 cache 讀取分析結果
- [ ] 實作 `invalidateCache(root)` — 手動清除 cache

### 31.4 smart_learn 整合

- [ ] 修改 `src/plugins/core/learn.mjs` — 優先查 pre-index cache
- [ ] cache miss 才執行完整分析
- [ ] 分析完成後自動更新 cache

### 31.5 Agent Personality 更新

- [ ] 更新 `config/agents/smart-mcp.md` — 加入 parallel + pre-index 使用說明

### 31.6 測試

- [ ] `tests/parallel-executor.test.mjs` — DAG 分析
- [ ] 平行執行正確性
- [ ] timeout 處理
- [ ] partial failure 處理
- [ ] pre-index cache hit/miss/invalidation

---

## Phase 32：Multi-Agent Collaboration Enhancement — 多 Agent 協作強化

> 參考：Continuum（跨 agent daemon）、mcp-agora（ChromaDB 語義路由）
> 目標：共享記憶池 + role-based 工具權限 + agent-to-agent message bus
> 預估：跨 agent 知識覆蓋率大幅提升，subagent 工具誤用率降低

### 32.1 Shared Memory Pool

- [ ] 修改 `src/lib/memory-db.mjs` — `searchHybrid` 加入 `scope` 參數（"self" / "all"）
- [ ] 跨 agent 搜尋時顯示來源 agent + 信心分數
- [ ] 修改 `src/plugins/standard/memory-store.mjs` — search 支援跨 agent 查詢
- [ ] 加入 `agent_id` 過濾器

### 32.2 Role-Based Tool Access

- [ ] 建立 `src/lib/role-manager.mjs` — RoleManager class
- [ ] 實作 `defineRole(name, allowlist, denylist)` — 定義 agent 角色
- [ ] 預設角色：security-agent（security 相關工具）、refactor-agent（edit 相關工具）、research-agent（search 相關工具）
- [ ] 修改 `src/server/index.mjs` — invokeTool 前檢查 role permission

### 32.3 Agent-to-Agent Message Bus

- [ ] 建立 `src/lib/agent-bus.mjs` — AgentBus class
- [ ] 實作 `send(from, to, message)` — 傳遞 structured message
- [ ] 實作 `receive(agentId)` — 接收訊息
- [ ] 訊息格式：{ type, context, findings, toolResults, timestamp }

### 32.4 Agent Personality 更新

- [ ] 更新 `config/agents/smart-mcp.md` — 加入多 agent 協作使用說明

### 32.5 測試

- [ ] `tests/multi-agent.test.mjs` — shared memory search（跨 agent）
- [ ] role-based tool access（allow/deny）
- [ ] agent message bus（send/receive）
- [ ] 邊界案例（未知 agent、空訊息）

---

## Phase 33：Skill Auto-Generation & Knowledge Graph — 技能自動生成與知識圖譜

> 參考：self-evolving-codegen、Continuum（AST 知識圖譜）
> 目標：從成功 pattern 自動生成 skill + 從 memory entries 建立 entity-relation graph
> 預估：skill 建立從手動 30min → 自動 <1min，知識從平面 → 結構化

### 33.1 Pattern Miner

- [ ] 建立 `src/lib/pattern-miner.mjs` — PatternMiner class
- [ ] 實作 `minePatterns(history)` — 從 tool call history 識別重複出現的成功 pattern
- [ ] 最小重複次數：5 次
- [ ] 實作 `extractTrigger(pattern)` — 萃取 trigger condition
- [ ] 實作 `extractToolChain(pattern)` — 萃取 tool chain
- [ ] 實作 `extractExpectedOutcome(pattern)` — 萃取 expected outcome

### 33.2 Skill Generator

- [ ] 建立 `src/lib/skill-generator.mjs` — SkillGenerator class
- [ ] 實作 `generateSkill(pattern)` — 產生 skill 檔案（YAML frontmatter + Markdown body）
- [ ] 實作 `validateSkill(skill)` — 驗證 skill 格式正確
- [ ] 實作 `installSkill(skill)` — 寫入 ~/.config/opencode/skills/
- [ ] 加入人機確認機制（dry-run 預覽 → 使用者確認 → 安裝）

### 33.3 Knowledge Graph Builder

- [ ] 建立 `src/lib/kg-builder.mjs` — KgBuilder class
- [ ] 實作 `extractEntities(entries)` — 從 memory entries 萃取 entity（tool/error/pattern/file）
- [ ] 實作 `buildRelations(entities)` — 建立 relation（causes/fixes/depends_on/similar_to）
- [ ] 實作 `buildGraph(entities, relations)` — 建立 graph 結構
- [ ] 實作 `queryGraph(query)` — sqlite-vec 語意查詢

### 33.4 KG Visualization

- [ ] 實作 `visualizeGraph(graph)` — Mermaid.js graph 輸出
- [ ] 支援 flowchart / graph LR 格式
- [ ] 整合到 `smart_smart_run({tool:"diagram"})` — 可選 KG 資料來源

### 33.5 Agent Personality 更新

- [ ] 更新 `config/agents/smart-mcp.md` — 加入 skill auto-gen + KG 使用說明

### 33.6 測試

- [ ] `tests/skill-autogen.test.mjs` — pattern mining（重複 pattern 識別）
- [ ] skill generation（格式正確性）
- [ ] skill validation
- [ ] KG entity extraction
- [ ] KG relation building
- [ ] KG query
- [ ] KG visualization

---

Phase 25 (Transition Learning)     — 相依 memory-db（已存在）
Phase 26 (Tool Selection Feedback) — 相依 memory-db + tool-strategy（已存在）
Phase 27 (Semantic Cache Routing)  — 相依 memory-db + sqlite-vec（已存在）
Phase 28 (Semantic Tool Router)    — 相依 tool-strategy + sqlite-vec（已存在）
Phase 29 (Self-Reflection)         — 相依 memory-db + tool-strategy（Phase 26 數據）
Phase 30 (Smart Output Mgmt)       — 相依 output-optimizer + context-budget（已存在）
Phase 31 (Parallel + Pre-Index)    — 相依 workflow + compose + smart_learn（已存在）
Phase 32 (Multi-Agent Collab)      — 相依 memory-db（Phase 19 基礎）
Phase 33 (Skill Auto-Gen + KG)     — 相依 memory-db + Phase 29 reflection 數據
```

**執行順序**：
- 第一波（已完成）：16 → 18 → 19（平行）→ 17 → 20 → 21 → 22 → 23
- 第二波（本期）：25 → 26 → 27（平行可做 25+26，27 相依 26）
- 第三波（下期 P0）：28（平行）→ 29（相依 26+28）→ 30（平行，無相依）
- 第四波（下期 P1）：31（平行）→ 32（相依 19）
- 第五波（下下期 P2）：33（相依 29 reflection 數據）

**執行順序**：16 → 18 → 19（平行可做）→ 17 → 20 → 21 → 22 → 23
| smart-mcp (spak2005) | 2026-02 | FAISS 語義路由，97% token 省 | 同名混淆，Phase 28 semantic router 可追平 |
| MCPlex | 2026-04 | Rust gateway + RBAC + dashboard | 目標客群不同（企業 vs 個人開發者） |
| Continuum | 2026-05 | 跨 agent daemon + AST KG | 🔥 最大威脅 — Phase 32+33 直接應對 |
| Tool Compass | 2026-01 | 漸進式揭露，95% token 省 | Smart MCP hybrid_router 已涵蓋 |
| mcpflow-router | 2026-03 | OpenCode 專用 gateway | 直接競爭，但只做路由不做智慧層 |
| ReasonKit Think | 2026-05 | MCP 原生 CoT/ToT/GoT | 方向一致，但 Smart MCP 更輕量 |
| structured-cot | 2026-04 | 22× token 壓縮 | ⬅️ Phase 16 直接參考 |
| ToolTree (ICLR 2026) | 2026-03 | MCTS 工具規劃 | ⬅️ Phase 17 直接參考 |
| Meta-Reasoning | 2026-04 | 外部認知控制器 | ⬅️ Phase 29 self-reflection 為輕量替代 |
| **OpenAI Agents SDK** | 2026-05 | semantic tool matching + guardrails + handoff | ⬅️ Phase 28+29+32 直接參考 |
| **Anthropic MCP 2.0** | 2026-06 | streaming + parallel tool calling + prompt caching | ⬅️ Phase 30+31 直接參考 |
| **Cursor** | 2026-06 | codebase pre-indexing + relevance-based context | ⬅️ Phase 31 pre-indexing 直接參考 |
| **self-evolving-codegen** | 2026-03 | tester agent 自我進化 prompt | ⬅️ Phase 33 auto-gen 直接參考 |
| Continuum | 2026-05 | 跨 agent daemon + AST KG | 🔥 最大威脅 — 需加速 Phase 19 |
| Tool Compass | 2026-01 | 漸進式揭露，95% token 省 | Smart MCP hybrid_router 已涵蓋 |
| mcpflow-router | 2026-03 | OpenCode 專用 gateway | 直接競爭，但只做路由不做智慧層 |
| ReasonKit Think | 2026-05 | MCP 原生 CoT/ToT/GoT | 方向一致，但 Smart MCP 更輕量 |
| structured-cot | 2026-04 | 22× token 壓縮 | ⬅️ Phase 16 直接參考 |
| ToolTree (ICLR 2026) | 2026-03 | MCTS 工具規劃 | ⬅️ Phase 17 直接參考 |
| Meta-Reasoning | 2026-04 | 外部認知控制器 | ⬅️ Phase 21 長期參考 |