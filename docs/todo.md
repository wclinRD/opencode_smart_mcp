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

## Phase 17：MCTS Tool Planning — 蒙地卡羅樹搜尋工具規劃

> 參考：ToolTree (ICLR 2026) — 雙回饋 MCTS + 雙向剪枝
> 目標：在工具空間中用 MCTS 搜尋最佳路徑，取代靜態正則匹配。
> 預估：複雜任務工具選擇準確率從 ~70% 提升至 ~85%+

### 17.1 研究：現有 tool-strategy 架構分析

- [ ] 閱讀 `src/agent/tool-strategy.mjs` 現有 code
- [ ] 分析 TASK_PATTERNS 的匹配邏輯和 chain 定義
- [ ] 理解 hybrid-engine.mjs 的 classifyQuestion + DOMAIN_MAP 路由
- [ ] 確定哪些任務適合 MCTS（5+ 步驟的複雜 multi-step 任務）

### 17.2 MCTS 引擎設計

- [ ] MCTS Node 資料結構：{ id, tool, args, parent, children, visits, reward, preScore, postScore }
- [ ] UCT (Upper Confidence Bound for Trees) selection formula
- [ ] Pre-evaluation：快速 schema/slot 檢查（不執行工具）
- [ ] Post-evaluation：根據執行結果評分工具貢獻
- [ ] Bidirectional pruning：pre + post 雙向剪枝
- [ ] 收斂條件：max iterations 或 score 穩定

### 17.3 實作：MCTS 引擎

- [ ] `src/lib/mcts-planner.mjs` — MCTS 核心引擎
- [ ] UCTNode class + selection/expansion/simulation/backpropagation
- [ ] PreEvaluator：工具 schema/slot 相容性檢查
- [ ] PostEvaluator：執行結果貢獻評分
- [ ] BidirectionalPruner：剪枝邏輯
- [ ] SearchLoop：iteration 管理 + 收斂判斷
- [ ] 降級機制：MCTS timeout → fallback 到靜態正則匹配

### 17.4 MCP Plugin

- [ ] `src/plugins/standard/mcts-plan.mjs` — `smart_mcts_plan` 工具
- [ ] inputSchema：{ goal, tools, context, maxIterations?, timeout? }
- [ ] handler：呼叫 MCTS engine → 回傳最佳工具鏈
- [ ] responsePolicy: maxLevel 0（結果不能壓縮）

### 17.5 hybrid-engine 整合

- [ ] `src/lib/hybrid-engine.mjs` DOMAIN_MAP 加入 mcts 領域
- [ ] 觸發條件：複雜 multi-step 任務（5+ 步驟、多檔案、跨工具）
- [ ] 整合流程：classify → MCTS → 推薦工具鏈
- [ ] 查看現有 general recommendation 流程，確保不破壞

### 17.6 測試

- [ ] MCTS Node selection (UCT) 正確性
- [ ] Pre-evaluation 正確過濾不相容工具
- [ ] Post-evaluation 正確評分
- [ ] Bidirectional pruning 正確性
- [ ] 收斂判斷（max iterations / score stable）
- [ ] 降級機制（timeout → static fallback）
- [ ] Plugin integration（smart_mcts_plan 正常回傳）
- [ ] hybrid-engine 整合不破壞現有 routing

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

## Phase 19：Cross-Agent Shared Memory — 跨 Agent 記憶共享

> 參考：Continuum (redstone-md)、mcp-agora
> 目標：讓 Claude Code、OpenCode、Codex 共享同一份 memory DB，新 agent 立即受益。
> 預估：新 agent 冷啟動時間從 0 → 立即受益於其他 agent 的學習。

### 19.1 Schema 擴充

- [ ] `src/lib/memory-db.mjs` — `entries` table 新增 `agent_id TEXT`
- [ ] `src/lib/memory-db.mjs` — 自動 migration（schema version bump）
- [ ] `src/lib/memory-db.mjs` — 新增 agent_aliases 設定（claude-code → claude, opencode → opencode 等）

### 19.2 memory_store CLI/Plugin 更新

- [ ] `src/plugins/standard/memory-store.mjs` — 接受 `agent_id` 參數
- [ ] 自動偵測 agent_id（env var → hostname → "unknown"）
- [ ] `src/cli/memory-store.mjs` — CLI 新增 `--agent` flag
- [ ] `src/lib/memory-db.mjs` — searchHybrid 支援 agent_id 過濾（`--agent claude-code`）
- [ ] `src/lib/memory-db.mjs` — 跨 agent 查詢模式（不加 agent_id 參數時搜尋全部）

### 19.3 Auto Memory Injection 更新

- [ ] `src/server/index.mjs` — autoInjectMemory 支援 agent_id 過濾
- [ ] 策略：優先注入本 agent 的記憶，其次跨 agent 的記憶
- [ ] 顯示 source agent（顯示記憶來自哪個 agent）

### 19.4 Agent personality

- [ ] `config/agents/smart-mcp.md` — 跨 agent 記憶使用說明
- [ ] 記憶搜尋策略：`memory_store search --agent all` 跨 agent

### 19.5 測試

- [ ] agent_id 寫入正確
- [ ] agent_id 過濾查詢正確（只看本 agent / 跨 agent）
- [ ] 自動 migration（舊 schema → 新 schema）
- [ ] Auto injection agent_id 過濾正確
- [ ] 全量 regression（確保不破壞現有 memory tests）

---

## Phase 20：Execution-Grounded Verification — 執行驗證的程式碼生成

> 參考：IBM/verified-code-cot
> 目標：code generation 後自動在 sandbox 執行驗證，確保產出可執行的 code。
> 預估：可執行率從 ~70% 提升至 ~95%+。

### 20.1 Code Verification Pipeline

- [ ] `src/lib/code-verifier.mjs` — `verifyCode(code, language)` 函數
- [ ] 執行流程：extract code → sandbox execute → check exit code + output
- [ ] 成功路徑：回傳 code + execution result + metadata
- [ ] 失敗路徑：回傳 code + error + suggestion
- [ ] Retry loop：最多 1 輪自動修正
- [ ] 安全限制：timeout 30s, output cap 50KB

### 20.2 smart_exec 擴充

- [ ] `src/plugins/standard/exec.mjs` — 新增 `verify` mode
- [ ] verify mode 參數：{ code, language, testCases?, maxRetries? }
- [ ] Handler：呼叫 code-verifier → 回傳驗證結果
- [ ] 回傳格式：{ ok, exitCode, stdout, stderr, verified }

### 20.3 Agent personality

- [ ] `config/agents/smart-mcp.md` — code generation 自動驗證流程
- [ ] 規則：產生 code 後自動呼叫 `smart_exec({mode:"verify", ...})`
- [ ] 驗證失敗：自動修正（最多 1 輪）

### 20.4 測試

- [ ] verifyCode 正確執行（4 種語言：js/py/bash/ts）
- [ ] 成功碼驗證（exit code 0 + 預期 output）
- [ ] 失敗碼處理（exit code non-zero + error 訊息）
- [ ] Retry loop 正確（最多 1 輪）
- [ ] Safety limits（timeout / output cap）
- [ ] Plugin integration（smart_exec mode:"verify"）

---

## Phase 16-20 里程碑

| 里程碑 | 內容 | 預計日期 |
|--------|------|---------|
| M1 | Phase 16 完成（Structured Thinking） | ✅ 2026-06-13 |
| M2 | Phase 18 完成（Speculative Pre-fetch） | ✅ 2026-06-13 |
| M3 | Phase 19 完成（Cross-Agent Memory） | t+11 天 |
| M4 | Phase 17 完成（MCTS Planning） | t+18 天 |
| M5 | Phase 20 完成（Verified Code Gen） | t+22 天 |
| M6 | 全量 regression + 效能 benchmark | t+25 天 |

---

## 各 Phase 依賴關係

```
Phase 16 (Structured Thinking)     — 無外部相依
Phase 17 (MCTS Tool Planning)      — 相依 hybrid-engine（已存在）
Phase 18 (Speculative Pre-fetch)    — 相依 server/index.mjs（已存在）
Phase 19 (Cross-Agent Memory)      — 相依 memory-db（已存在）
Phase 20 (Verified Code Gen)       — 相依 smart_exec（已存在，Phase 10.1 ✅）
```

**執行順序**：16 → 18 → 19（平行可做）→ 17 → 20

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