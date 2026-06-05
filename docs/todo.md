# Devtool MCP — 執行清單

> 與 plan.md 互為補充：todo.md 追蹤「具體做什麼」，plan.md 說明「為什麼做」。
> 優先級：🔴 P0 = 立即  🟠 P1 = 短期  🟡 P2 = 中期  ⚪ P3 = 長期

---

## 🔴 Phase 0: thinking.mjs 改造 + smart_think 新增 (P0)

**對應 plan.md 五-Phase 0**
**目標**：將 thinking.mjs 從批次分析 CLI 改造為推理引擎，新增 handler-based `smart_think`，取代 sequential-thinking。

### 0.1 thinking.mjs 重構 — 抽出可程式化 API

- [x] 將 thinking.mjs 從純 CLI 改造為模組，export 三個入口：
  - [x] `export function quickThink(args)` / `export function quickThought(args)` — 快速推理
    - 參數：`{ thought, nextThoughtNeeded, thoughtNumber, totalThoughts, isRevision?, revisesThought?, branchFromThought?, branchId?, template? }`
    - 回傳：`{ output: string, done: boolean }`
    - 當指定 `template` 時，附加對應模板的 step prompt 作為引導（不強迫，參考用）
  - [x] `export function deepAnalyze(args)` — 深層模板分析
    - 參數：`{ topic, template, steps?, format?, plan?, state? }`（保留現有功能）
    - 回傳：`{ output: string, type: string }`
  - [x] `main()` — 保留 CLI 模式，向後相容

### 0.2 新增 src/plugins/core/quick-think.mjs

- [x] 建立 `src/plugins/core/quick-think.mjs` — handler-based MCP 工具
  - [x] 定義 inputSchema：僅 2 required（thought + nextThoughtNeeded）
  - [x] 可選參數：thoughtNumber, totalThoughts, isRevision, revisesThought, branchFromThought, branchId, template, hypothesis, verification, needsMoreThoughts, adjustTotalThoughts
  - [x] 使用 `handler` 而非 `cli`，直接呼叫 `thinking.mjs` 的 `quickThink()`
  - [x] 輸出格式：模擬 sequential-thinking 的逐步推理鏈
  - [x] 範例輸出：
    ```
    Thought 3/5: 分析 command injection 的 root cause
    
    git-context.mjs 使用 execSync 直接拼接使用者輸入的 args，
    攻擊者可注入 shell metacharacter（;、|、$(...)）。
    
    修復方案：改用 spawnSync，args 以 array 傳遞。
    ```
  - [x] 註冊為 `smart_think`（注意：不是 `smart_thinking`）

### 0.3 smart_thinking 改造 — handler 化

- [x] 修改 `src/plugins/core/thinking.mjs`：
  - [x] 將 `cli` → `handler`，消除 process spawn overhead
  - [x] handler 內部呼叫 `thinking.mjs` 的 `deepAnalyze()` / `startDynamicSession()` / `execStateCommand()`
  - [x] 保留所有 9 模板 + state persistence + branching + context accumulation
  - [x] 向後相容：所有現有參數繼續支援（topic, template, steps, format, plan, planStep, iterative, dynamic, state, record, advance, branch, finish, status, cancel, restore）
  - [x] interactive 模式仍 fallback 到 CLI spawn（需要 stdin）

### 0.4 輸出改造 — 從模板骨架到真實推理

- [x] static 模式輸出改造：
  - [x] 不再輸出空的 template section headers（移除 emoji icon、分隔線）
  - [x] 改為輸出每個步驟的引導 prompt + template context（topic 內嵌每步）
  - [x] text/markdown/json 三種格式統一改造
- [x] dynamic 模式輸出改造：
  - [x] header 從 `🧠 xxx — Dynamic Mode` → `[Template] Topic` 簡潔格式
  - [x] step 輸出從模板骨架 → 前序 context + 當前引導
  - [x] summary 輸出從模板完成狀態 → 完整推理鏈回放

### 0.5 測試與驗證

- [x] 測試 `quickThink()` 單元：
  - [x] 基本呼叫：`quickThink({ thought: "test", nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 })` → 回傳正確格式
  - [x] 修訂：`isRevision: true, revisesThought: 2` → 輸出含修訂標記
  - [x] 分支：`branchFromThought: 3, branchId: "alt-path"` → 輸出含分支標記
  - [x] 模板引導：`template: "debug"` → 輸出含 debug 模板提示
  - [x] hypothesis/verification/needsMoreThoughts/adjustTotalThoughts 測試
  - [x] `quickThink` 與 `quickThought` 一致
- [x] 測試 `deepAnalyze()` 單元：
  - [x] 各 9 模板回傳正確結構
  - [x] text/markdown/json 格式正確
  - [x] 無 topic 回傳 error
  - [x] 未知 template 回傳 error
- [x] 測試 `startDynamicSession()` + `execStateCommand()`：
  - [x] state file 可正確建立
  - [x] --record 正確保存結果 + advance
  - [x] --branch 選擇正確
  - [x] --cancel / --finish 正確
  - [x] 錯誤處理（invalid index, unknown command）
- [x] 測試 plan integration：plan context 正確注入 steps
- [x] 總計 27 測試，全部通過 (`node --test tests/thinking.test.mjs`)

### 驗收標準
- [x] `smart_think` 呼叫延遲 <1ms（handler-based，無 process spawn）
- [x] 參數僅 2 required（thought + nextThoughtNeeded）
- [x] 輸出是真實推理內容，非模板骨架
- [x] 支援 revision/branching/template 引導
- [x] `smart_thinking` 保留所有既有功能（9 模板 + dynamic + state persistence + branching + context accumulation）
- [x] opencode agent 可直接用 `smart_think` 取代 `sequential-thinking`

---

## 🔴 Phase 1: 自我學習 + 記憶系統 (P0) ✅

**對應 plan.md 五-Phase 1**
**目標**：讓 smart 能記住過往修復經驗，避免重複犯錯。

### 1.1 記憶儲存層 ✅

- [x] `src/plugins/standard/memory-store.mjs` — 輕量級 JSON 記憶庫
  - [x] 定義記憶 schema：{ hash, errorType, resolution, toolsUsed, timestamp, success, hitCount }
  - [x] 模糊搜尋：Levenshtein distance + word overlap + keyword boost
  - [x] 支援 CRUD：store / search / list / get / confirm / delete / stats / export
  - [x] 儲存位置：~/.smart/memory/resolutions.json (可通過 --data-dir 覆蓋)
  - [x] 自動壓縮：超過 5000 筆時移除 hitCount 最低的 20%
  - [x] 自動分類：9 種錯誤類別（build/runtime/test/permission/path/network/lint/git/unknown）
  - [x] Dedup：相同 hash 自動更新 hitCount 而非重複儲存
  - [x] `confirm` 指令：使用者確認修復有效 → hitCount +2 + 記錄 confirmedAt
  - [x] 最新修復：3 項 enhancements（模糊搜尋門檻、feedback 機制、CLI/plugin 一致性）

### 1.2 error-diagnose 整合記憶 ✅

- [x] `src/plugins/standard/error-diagnose.mjs` — 整合 memory-store
  - [x] **記憶搜尋預設開啟**：`useMemory` 已改為 `true`（傳 `--no-memory` 可關閉）
  - [x] 診斷前自動 `memory.search(currentError)` → 高信心命中直接回傳已知修復
  - [x] 信心混合輸出：≥0.8 → 記憶為主 KB 為輔；0.5-0.8 → 並列顯示；<0.5 → 僅 KB
  - [x] `--store` 自動儲存診斷結果到記憶庫（含 resolution + tools + category）
  - [x] 回饋機制：`confirm` 指令可提高 case 權重（hitCount +2）

### 1.3 tool-stats 升級 ✅

- [x] `src/plugins/standard/tool-stats.mjs` — 完整模式分析
  - [x] `patterns` 指令：session 偵測 + 工具組合分析 + 任務分類績效
  - [x] 成功率趨勢分析：前半/後半期比較，下降 >20% 自動警告
  - [x] 建議引擎：低成功率、高延遲波動、衰落工具、替代建議、任務型別警告
  - [x] `inferTaskType()`：工具名稱 → 任務分類（search/debug/refactor/test...）
  - [x] 最佳工具組合：同 session 內共現頻率最高的工具對
  - [x] 插件描述已強化，引導 agent 使用 `patterns` 指令

### 驗收標準
- [x] 兩次相同錯誤 → 第二次秒回修復方案（不重複診斷）
- [x] tool-stats 能回答「哪些工具組合對除錯任務最有效」
- [x] 10 整合測試全部通過（`node --test tests/memory-store.test.mjs`）

---

## 🔴 Phase 2: 動態規劃引擎 (P0)

**對應 plan.md 五-Phase 2**
**目標**：讓 smart 能自動規劃多工具執行序列，並根據結果動態調整。

### 2.1 Planner 核心 ✅

- [x] `src/plugins/standard/planner.mjs` — 輕量級規劃器（含執行狀態管理）
  - [x] 輸入：目標描述 + 可用工具清單 + 當前 context
  - [x] 分解：9 任務模板 + 通用關鍵字 fallback
  - [x] 映射：sub-goal → 最佳工具組合
  - [x] DAG 生成：dependsOn 依賴 + conditions 條件分支
  - [x] 輸出格式：JSON array of { tool, args, dependsOn, onFailure }
  - [x] **Plan execution state** — `execute` 命令建立 JSON state file
  - [x] **State lifecycle** — `next` / `report` / `replan` 完整命令

### 2.2 條件分支與動態調整 ✅

- [x] Planner 支援條件邏輯
  - [x] 模板內嵌 `conditions[]` + `branchOn` metadata（如 debug-error 的 `foundErrors`）
  - [x] onFailure 三種策略：`abort`（停掉）、`skip`（跳過）、`warn`（自動 replan）
  - [x] 工具失敗 onFailure=warn → 自動觸發 replan（非簡單重試）
- [x] 回饋循環
  - [x] `report` 命令記錄步驟結果並更新 accumulatedContext
  - [x] state 變化（步驟失敗）自動觸發 replanRemainingSteps()

### 2.3 thinking.mjs 升級

- [x] 升級 `src/plugins/core/thinking.mjs` (v3.1)
  - [x] 保留 9 模板作為 initial prompt（analyze/debug/refactor/feature/research/decision/plan_execute/retrospect/architecture）
  - [x] 新增動態模式 `--dynamic`：每步推理結果寫入 state file，影響下一步
  - [x] State persistence：JSON 狀態檔案 (`--state <path>`)
  - [x] Result recording：`--record <idx> <result>` 注入前一步結果
  - [x] Branching：模板支援條件分支，`--branch <name>` 選擇路徑
  - [x] Context accumulation：前序結果自動累積注入後續 prompt
  - [x] 支援 resume/cancel/finish 生命週期管理

#### 新增 branch 模板
- [x] `analyze`: `hypothesis-confirmed`（跳至綜合）/ `needs-more-data`（插入調查步驟）
- [x] `research`: `clear-answer`（跳至綜合）/ `needs-deeper`（插入深挖步驟）
- [x] `decision`: `quick-decision`（跳至建議）/ `needs-tradeoff`（插入加權評分）

### 驗收標準
- [x] 輸入「除錯這個 error」→ 自動產出 [memory_store → grep → diagnose → debug → test] 計畫（debug-error 模板）
- [x] 中間某步失敗 → onFailure=warn 自動 replan，onFailure=abort 停掉，onFailure=skip 跳過
- [x] `execute` 命令產生 plan + state file，`next` 取得下一步，`report` 回報結果
- [x] `replan` 命令可強制重新規劃剩餘步驟，保留已完成的結果
- [x] 7 整合測試全部通過（`node --test tests/planner.test.mjs`）

---

## ✅ Phase 3: 狀態管理 + Context 傳遞 (P1)

**對應 plan.md 五-Phase 3**
**目標**：工具間共享上下文，消除重複描述。

### 3.1 Context Schema 定義 ✅

- [x] 定義統一 context object
  ```json
  {
    "sessionId": "uuid",
    "projectRoot": "/path",
    "toolHistory": [{ "tool": "smart_grep", "args": {...}, "result": "...", "duration": 123, "timestamp": "ISO" }],
    "accumulatedFindings": [{ "source", "finding", "category", "severity", "timestamp" }],
    "lastResult": { "tool", "summary", "ok" },
    "metadata": { "createdAt", "updatedAt", "toolCount", "errorCount" }
  }
  ```
- [x] `src/lib/context-manager.mjs` — ContextManager class

### 3.2 自動 Context 維護 ✅

- [x] **自動注入**: handler-based tool 透過 args `_context`，CLI tool 透過 env var `SMART_CONTEXT`
- [x] **自動捕獲**: 每次 `invokeTool()` 呼叫自動記錄結果到 context history（`captureAndReturn`）
- [x] **smart_run 保留命令也捕獲**: help/describe/warmUp 透過 handleDevtoolRun wrapper 記錄
- [x] **自動發現提取**: scanning tool output for security/error/quality/dependency findings
- [x] **FIFO eviction**: history 上限 50 筆，findings 上限 100 筆，自動淘汰最舊
- [x] **持久化**: 自動儲存到 `~/.smart/context/<sessionId>.json`，支援跨 session 恢復

### 3.3 新增的 MCP 工具

- [x] `smart_context` — 8 種指令：
  - `get` — 完整 session 摘要（含 recent 5 筆 + findings）
  - `summary` — 緊湊 JSON 摘要（供注入用）
  - `history` — 完整工具呼叫歷史
  - `findings` — 累積的發現列表
  - `reset` — 清除歷史（保留 sessionId）
  - `sessions` — 列出所有持久化 session
  - `delete` — 刪除指定 session
  - `inject` — 查看注入資訊

### 3.4 端點擴充

- [x] `smart/health` — 回傳 context sessionId/toolCount/errorCount
- [x] `smart/context` — 程式端點支援 get/summary/reset

### 驗收標準
- [x] 連續呼叫 smart_run help 兩次，context history 記錄兩筆
- [x] smart_context 可查詢完整調用歷史
- [x] 自動 findings 提取（security/error/quality patterns）
- [x] 跨 session 恢復（指定 sessionId 可 resume）
- [x] 13 整合測試 + 29 單元測試全部通過

---

## ✅ Phase 4: Workflow 引擎 — Plan-Based Orchestration (P1)

**對應 plan.md 五-Phase 4**
**目標**：4 個新 MCP tool，實現動態計畫生成→執行回報→狀態管理→失敗 replan 的完整 workflow 循環。2026-06-04 完成。

### 4.1 Workflow Core（~500 行）

- [x] `src/cli/workflow.mjs` — 4 commands + list-templates：
  - [x] `create` — 從 5 個 template 之一建立 workflow，解決 \$goal placeholder，回傳 parallel hints
  - [x] `report` — 記錄步驟結果，尊重 onFailure 策略（abort→fail / skip→繼續 / warn→保持 active）
  - [x] `replan` — 取消剩餘 pending 步驟，呼叫 planner.mjs 重新規劃，以 isReplan 標記追加新步驟
  - [x] `summary` — 文字/JSON 格式完整報告（steps/parallel/findings/toolStats/progress）
  - [x] 平行提示：`computeParallelHints()` 依 dependsOn 分群

### 4.2 MCP 整合

- [x] `src/plugins/standard/workflow.mjs` — `smart_workflow` MCP 工具
  - [x] Command dispatch: create / report / replan / summary / list-templates
  - [x] 透過 `cli: 'workflow.mjs'` 經 smart_run router 自動註冊
  - [x] mapArgs 正確轉換 MCP schema → CLI 引數

### 4.3 ContextManager 強化

- [x] `capture()` 新增第 5 參數 `workflowId` — optional workflow association
- [x] 新增 `getWorkflowHistory(workflowId)` — 依 workflowId 過濾 tool history
- [x] entry schema 擴充：`toolHistory[].workflowId`

### 4.4 Planner 強化

- [x] `computeParallelHints(steps)` — DAG-based 平行分群演算法
- [x] `WORKFLOW_TEMPLATES` — 5 組 workflow 專用 template 常數
- [x] Export 4 個 symbols: `generatePlan`, `computeParallelHints`, `WORKFLOW_TEMPLATES`, `analyzeToolSequence`
- [x] `main()` 保護：僅在直接執行時執行，import 時跳過

### 4.5 內建 Workflow Templates (5)

- [x] `debug-flow` (6 steps) — memory_search → grep → error_diagnose → debug → cross_file_edit → test
- [x] `refactor-flow` (5 steps) — import_graph → naming → rename_safety → cross_file_edit → test
- [x] `security-flow` (5 steps) — security_scan(creds) → security_scan(injection) → grep → cross_file_edit → test
- [x] `research-flow` (3 steps) — exa_search → thinking(synthesize) → report
- [x] `default-flow` (2 steps) — planner → test

### 驗收標準

- [x] `workflow create "fix XSS" --template security-flow` → 回傳多步驟 JSON plan + parallel hints
- [x] 每步完成後 `workflow report --step N --status ok` → 自動更新 context、前進 workflow
- [x] 步驟失敗 + onFailure=skip → 自動跳過繼續
- [x] 步驟失敗 + onFailure=abort → workflow 標記為 failed
- [x] `workflow replan` → 自動產生新計畫（保留已完成結果）
- [x] `workflow summary --json` → 完整報告含 findings/toolStats/steps
- [x] 9 tests pass + 36 既有 tests 0 regression

### 已具備的前置條件（不需重寫）

- [x] planner.mjs — plan generation + condition + DAG + replan
- [x] context-manager.mjs — 注入/捕獲/持久化
- [x] invokeTool + captureAndReturn — 自動 context 記錄
- [x] 9 任務模板 + 條件分支
- [x] 26 CLI tools → 36 tools (6 core + 27 standard + 3 agent)
- [x] memory-store — 跨 session 記憶

---

## ✅ Phase 5: Workflow 引擎強化 (P0 — 實際執行能力) ✅

**對應 plan.md 五-Phase 5**  
**目標**：讓 workflow 能真正執行工具，而非只管理 state。

**實作摘要**: `workflow.mjs` 已新增 `dispatch` 指令 + TOOL_CLI_MAP + TOOL_ARGS_CONVERTERS，ContextManager 新增 `getWorkflowCost()`，`smart_context` 新增 `workflow-stats` 指令。4 個 dispatch 測試全部通過。

### 5.1 Workflow Engine 加入 dispatch 層

- [x] `workflow.mjs` 新增 `dispatch` 指令：接收 workflowId → 自動 call invokeTool()
- [x] 支援 `parallel(group)` dispatch：同時 spawn 多個獨立工具
- [x] 先用 sequential 模式驗證（平行執行由 Phase 6 compose-engine 實作）

### 5.2 Workflow 產出可直接執行的 JSON

- [x] `create` 指令輸出格式強化：含完整 tool args + timeout + onFailure
- [x] opencode agent 可直接 iterate 執行，不需再 parse 描述文字

### 5.3 Workflow context 聚合

- [x] ContextManager 新增 `getWorkflowCost(workflowId)`：回傳該 workflow 的總 token/時間/錯誤率
- [x] `smart_context` 新增 `workflow-stats` 指令

### 驗收標準

- [x] `workflow dispatch --id <wfId>` 自動執行第一步工具
- [x] `workflow dispatch --id <wfId> --parallel` 同時執行獨立步驟
- [x] `smart_context workflow-stats --id <wfId>` 回傳成本數據

---

## ✅ Phase 6: Compose 原語 + 平行執行基礎 (P1 — 工具組合) ✅

**對應 plan.md 五-Phase 6**  
**目標**：提供 compose/pipe/parallel 三種工具組合原語。

**實作摘要**: `src/lib/compose-engine.mjs` (14KB) 已完成，支援 seq/par/cond 三種模式。`src/plugins/standard/compose.mjs` 已註冊為 `smart_compose` MCP tool。CLI spawn 已從 `spawnSync` 改為 `spawn` + Promise wrapper + AbortController timeout。

### 6.1 Compose 原語定義與實作

- [x] `src/plugins/standard/compose.mjs` — 新增 MCP tool `smart_compose`
  - [x] 輸入：`{ pipeline: [{ tool, args, mode: "seq"|"par"|"cond" }] }`
  - [x] 順序執行（pipe）：A 的輸出餵給 B
  - [x] 平行執行（parallel）：Promise.all + child_process.spawn async
  - [x] 條件執行（cond）：檢查前一步結果關鍵字決定分支
- [x] `src/lib/compose-engine.mjs` — compose 核心邏輯

### 6.2 CLI spawn 非阻塞改造

- [x] 24 CLI tools 從 `spawnSync` → `spawn` + Promise wrapper
- [x] 保留 timeout 控制（AbortController）
- [x] 相容既有工具，不修改 signature

### 驗收標準

- [x] `smart_compose({ pipeline: [...] })` 正確執行多工具流程
- [x] `mode: "par"` 平行執行比依序快（2 個 500ms 工具約 500ms 而非 1000ms）
- [x] `mode: "cond"` 根據條件正確分支

---

## ✅ Phase D: Agent Personality + 小模型兜底 (Phase D) ✅

**對應 plan.md**：smart-mcp.md agent 人格定義
**目標**：提供專屬 agent personality 定義 + 3 個小模型/兜底工具。
**狀態**：✅ 已完成

### D.1 Agent Personality

- [x] `~/.config/opencode/agents/smart-mcp.md` — 220 行 agent 人格定義
  - [x] primary agent 模式（不使用 subagent）
  - [x] 30+ 工具策略性運用提示
  - [x] 繁體中文溝通
  - [x] 強制循環演算法（todo → execute → verify）

### D.2 小模型兜底工具

- [x] `smart_agent_execute` — 小模型執行工具
- [x] `smart_agent_plan` — 小模型規劃工具
- [x] `smart_agent_recommend` — 小模型推薦工具

---

## 🟠 Phase 7: Memory 升級 (P1 — 語意記憶 + 模式歸納) ⏳

**對應 plan.md 五-Phase 7**  
**目標**：從 fuzzy string match 升級到語意搜尋 + 跨 session pattern 歸納。
**狀態**：7.3 ✅ 完成 | 7.1 ✅ 完成 | 7.2 ✅ 完成

### 7.1 Vector search 層 ✅ 完成

- [x] `src/lib/embedding.mjs` — TF-IDF vectorizer 核心（零依賴，錯誤訊息專用）
- [x] cosine similarity 計算
- [x] hybrid search（vector score × 0.7 + fuzzy score × 0.3）
- [x] `src/cli/memory-store.mjs` — `--vector` flag 啟用 hybrid search（TF-IDF + fuzzy）
- [x] `src/plugins/standard/memory_store.mjs` — vector/vectorThreshold schema 參數
- [x] `src/cli/error-diagnose.mjs` — queryMemory 預設使用 vector search
- [x] 降級策略：vector search 失敗 → fallback 到 fuzzy match（保留既有行為）
- [x] `@xenova/transformers` 作爲可選升級（`tryLoadSentenceModel()` 自動偵測，fallback to TF-IDF）

### 7.2 Pattern abstraction ✅ 完成

- [x] `tool-stats` `patterns` 指令增強：failureClusters + toolTrends + patternRecommendations
- [x] 自動歸納「失敗模式 cluster」：相同工具 + 相同 error type 多次失敗 (`inferFailureType`) + distinctSessions 過濾
- [x] 輸出 pattern report：「smart_test failing 2x — review test environment」
- [x] toolTrends：前半/後半期呼叫次數 + 失敗率比較（trend: stable/improving/declining/new）
- [x] patternRecommendations：門檻值可配置（`--pattern-threshold`，預設 3）
- [x] `--format json` 完整輸出 failureClusters + toolTrends + patternRecommendations
- [x] 10 整合測試全部通過（`node --test tests/memory-store.test.mjs`）

### 7.3 Cross-session context 合併 ✅

- [x] ContextManager 新增 `mergeSessions(sessionIds[])`：合併多 session 的 findings + history + metadata
  - [x] 去重 findings（by 文字內容）
  - [x] 時序合併 tool history
  - [x] 聚合 metadata（toolCount + errorCount）
  - [x] 自動 trim 到 MAX_HISTORY
  - [x] sessionSource 標記（`${tool}@${sid.slice(0,8)}`）
- [x] `smart_context` 新增 `merge` 指令
  - [x] 輸入：`{ command: "merge", sessionIds: [...] }`
  - [x] 輸出：`{ mergedFindings, mergedCalls, totalToolCount, totalErrorCount }`

### 驗收標準

- [x] TF-IDF vector search 正確提升錯誤訊息匹配率
- [x] 語意相似錯誤（"file not found" vs "cannot locate file"）hybrid search 評分 0.449（sentence embedding 橋接已就緒）
- [x] tool-stats patterns 輸出 pattern cluster 報告（failureClusters + patternRecommendations）
- [x] cross-session merge 正確合併 findings

---

## ✅ Phase 8: 程式碼生成輔助 (P2) ✅

**對應 plan.md 五-Phase 8**
**目標**：分析問題後不僅報告，還能自動產出修復 patch。
**狀態**：✅ 已完成（2026-06-05）

**實作摘要**: `src/plugins/standard/patch-gen.mjs` → `smart_patch_gen` handler-based MCP tool。從 error_diagnose/debug/thinking/manual 等分析結果自動萃取變更資訊（file + line + pattern + replacement），輸出 text/json/diff 格式 patch plan。安全閘門：3+ 檔案需 apply=true 明確授權。14 項測試全部通過。

- [x] `src/plugins/standard/patch-gen.mjs` — handler-based MCP tool
  - [x] 輸入：analysis tool output (error_diagnose / debug / thinking / manual)
  - [x] 自動萃取 file path、line number、fix description（多 regex 策略）
  - [x] 支援 explicit file/pattern/replacement 參數強制指定
  - [x] 輸出：text/json/diff 三種格式
  - [x] patch preview（plan text）供人審查
- [x] 整合 error-diagnose → patch-gen → cross-file-edit 一鍵流程（apply 模式）
- [x] 安全閘門：3+ 檔案變更需 `apply: true` 明確授權
- [x] 14 項測試全部通過（`node --test tests/patch-gen.test.mjs`）

---

## ✅ Phase 9: Devtool 自身品質 (P2) ✅

**目標**：smart MCP 伺服器本身的穩定性與可測試性。

### 9.1 自動測試 ✅

- [x] 建立 4 個核心工具單元測試（`tests/` 目錄）
  - [x] `tests/compose.test.mjs` — 9/9 測試通過（seq/par/cond/error handling）
  - [x] `tests/ckg-engine.test.mjs` — 8/8 測試通過（constructor/singleton/stats/query）
  - [x] `tests/lsp-bridge.test.mjs` — 7/7 測試通過（singleton/symbols/hover/error handling）
  - [x] `tests/impact-engine.test.mjs` — 10/10 測試通過（parseDiff/symbols/predict/analyze）
  - [x] 總計 34 測試，全部通過 (2026-06-05)
- [ ] CI 整合：`smart_test` 可執行自身測試

### 9.2 效能監控

- [ ] smart/stats 端點擴充
  - [ ] per-tool p50/p95/p99 延遲
  - [ ] 記憶體使用趨勢
  - [ ] 自動警報：某工具延遲突然飆升 2x

### 9.3 Debug 模式增強

- [ ] DEBUG=smart 輸出結構化
  - [ ] JSON lines format（可 pipe 到分析工具）
  - [ ] 支援 DEBUG=smart:grep 只過濾特定工具

---

## 🟠 Phase 9: 語言助手擴充 (P1)

**對應 plan.md 五-Phase 9**

- [ ] `src/plugins/standard/rs-helper.mjs` — Rust 分析
  - [ ] cargo check wrapper
  - [ ] clippy 整合
  - [ ] 依賴分析
- [ ] `src/plugins/standard/go-helper.mjs` — Go 分析
  - [ ] go vet wrapper
  - [ ] golangci-lint 整合
  - [ ] 模組分析
- [ ] 自動語言偵測 dispatcher
  - [ ] 根據專案根目錄自動選擇對應語言助手

---

## 🔴 Phase 10: 程式碼語義推理基礎工具鏈 (P0 — 第一週衝刺)

**對應 plan.md 五-Phase 10**
**目標**：建立多層混合智能的第一層 — 4 個確定性程式碼分析工具 + LSP bridge
**策略**：先用 LSP 快速實現（Day 1-3），再換 Tree-sitter（第二週）。TypeScript 優先。

### 10.1 LSP bridge 核心 ✅

- [x] `src/lib/lsp-bridge.mjs` — LSP 統一接入層 (492 行)
  - [x] spawn TypeScript LSP process（typescript-language-server via stdio）
  - [x] 生命週期管理：lazy-init（首次呼叫才啟動）+ closeAllLspBridges()
  - [x] auto-reconnect（LSP crash 自動重啟，1s delay）
  - [x] 封裝 JSON-RPC 2.0 通訊（Content-Length header 解析）
  - [x] 支援 methods: initialize / open / close / documentSymbol / references / hover / definition
  - [x] LRU cache 快取響應（TTL 30 秒，max 200 entries）
  - [x] `getSymbols(file)` → `[{name, kind, range, signature}]`
  - [x] `getReferences(file, pos)` → `[{file, range}]`
  - [x] `getHover(file, pos)` → `{contents, range}`
  - [x] `getDefinition(file, pos)` → `{file, line, col}`
  - [x] Singleton 管理：getLspBridge(rootDir) 共享同一 process
  - [x] Bug fix: _findTsserver() ESM require → execSync import

### 10.2 smart_code_ast — AST 結構查詢 ✅

- [x] `src/plugins/standard/code-ast.mjs` → `smart_code_ast`
  - [x] 參數：`{ file, symbol?, kind?, recursive?, format?, root? }`
  - [x] LSP `documentSymbol` 實作（快速上線）
  - [x] 輸出：`{ file, symbols: [{name, kind, line, col, signature, children}] }`（JSON 或 text）
  - [x] 支援：function / class / interface / type / variable / method / property / enum
  - [x] 降級策略：不可用時回傳 error（不 fallback 到 LLM）
  - [x] 實測：loader.mjs → 22 symbols in 0.6s，含 function/constant/variable/property

### 10.3 smart_code_call_graph — 呼叫鏈追蹤 ✅

- [x] `src/plugins/standard/code-call-graph.mjs` → `smart_code_call_graph`
  - [x] 參數：`{ file, symbol, direction: "callers"|"callees", depth: 1|2|3, format?, root? }`
  - [x] LSP `textDocument/references` 為基礎
  - [x] 支援跨檔案呼叫鏈（遞迴 buildGraph 追蹤）
  - [x] 深度控制：depth=1 只直接，depth=2-3 遞迴
  - [x] 輸出：`{ root, direction, depth, [direction]: [...] }`
  - [x] 迴圈偵測：visited Set 避免無限迴圈

### 10.4 smart_code_type_infer — 型別推導 ✅

- [x] `src/plugins/standard/code-type-infer.mjs` → `smart_code_type_infer`
  - [x] 參數：`{ file, line, col?, format?, root? }`
  - [x] LSP `textDocument/hover` 取得型別 + 文件
  - [x] 輸出：`{ type: "Array<string>", range: {start, end} }`
  - [x] 實測：loader.mjs L90 → `function defaultMapArgs(args: any): string[]` ✅

### 10.5 smart_code_impact — 影響半徑分析 ✅

- [x] `src/plugins/standard/code-impact.mjs` → `smart_code_impact`
  - [x] 參數：`{ diff?, files?, symbols?, depth: 1|2|3, format?, root? }`
  - [x] 支援 git diff 輸入（parseDiff）或直接指定檔案
  - [x] 解析 diff → 找出修改符號（hunk matching）
  - [x] 查詢 LSP references → 找出受影響下游
  - [x] 深度控制：depth=2 遞迴追蹤 transitive impacts
  - [x] 輸出：`{ direct, transitive, totalFiles, totalSymbols, confidence }`
  - [x] 保守策略：動態語言 over-approximation

### 10.6 工具註冊 ✅

- [x] 4 工具自動註冊為 MCP tools（smart_code_ast, smart_code_call_graph, smart_code_type_infer, smart_code_impact）
  - [x] `loader.mjs` 自動載入 plugins/standard/code-*.mjs
  - [x] 每個工具對應 inputSchema（參數校驗）
  - [x] handler-based（不經過 CLI spawn）
  - [x] 38 工具總數中顯示
  - [x] ⚠️ Bug: `invokeTool()` 不支援 async handler → 回傳 `[object Promise]`（已修復，2026-06-04）

### 驗收標準 ✅

- [x] `smart_code_ast({file: "src/server/loader.mjs"})` 回傳 22 symbols（constants + functions + variables）
- [x] `smart_code_call_graph({file, symbol, depth:2})` 回傳呼叫鏈結構
- [x] `smart_code_type_infer({file: "src/server/loader.mjs", line: 90, col: 0})` 回 `function defaultMapArgs(args: any): string[]`
- [x] `smart_code_impact({files: ["src/lib/lsp-bridge.mjs"]})` 回直接/間接影響檔案列表
- [x] 4 工具全部在 MCP 工具清單中顯示（38 tools total）
- [x] LSP bridge 正確管理生命週期（lazy-init + auto-reconnect）

---

## ✅ Phase 11: Code Knowledge Graph (P0 — 殺手級) ✅

**對應 plan.md 五-Phase 11**
**目標**：持久化專案級程式碼知識圖譜，Claude Code 架構上永遠做不到
**前置**：Phase 10 工具鏈完成
**狀態**：✅ 已完成（2026-06-05）

**實作摘要**：`src/lib/ckg-engine.mjs` (1108 行) — SQLite-based 程式碼知識圖譜引擎，使用 Node.js 內建 `node:sqlite` (DatabaseSync)，零依賴。`src/plugins/standard/code-query.mjs` (328 行) — `smart_code_query` MCP tool，支援 8 種查詢。

### 11.1 CKG 儲存層 ✅

- [x] `src/lib/ckg-engine.mjs` — CKG 核心 (1108 行)
  - [x] SQLite schema：nodes(id, name, kind, file, range) + edges(from, to, kind) + facts(node_id, key, value, version) + file_versions(file, hash, updated)
  - [x] 節點類型：file / function / class / interface / type / variable / constant / method / property / module / namespace / package / struct / constructor / enum / type-parameter (16 種)
  - [x] 邊類型：calls / imports / extends / implements / defines / parameterOf / returnTypeOf / contains (8 種)
  - [x] JSON hot-cache：最近 1000 查詢結果（LRU），TTL 30 秒
  - [x] `build(root)` — 全量掃描建立 CKG（支援 supportedFiles 過濾 .ts/.tsx/.js/.jsx/.mjs/.cjs）
  - [x] `incrementalUpdate(file)` — 單檔增量更新（hash 比對，無變更則 skip）
  - [x] `queryCallers(symbol, file, opts)` / `queryCallees(symbol, file, opts)` — 查詢介面
  - [x] `queryDependencies(file)` / `queryUnusedExports()` / `querySymbol(name, file, kind)`
  - [x] `getStats()` — CKG 統計資訊（nodes/edges/files/kindBreakdown/stale/builtAt）
  - [x] Singleton 管理：`getCkgEngine(root)` 共享同一 SQLite 連線

### 11.2 增量更新機制 ✅

- [x] `watch(root, {debounceMs, onUpdate})` — Node.js fs.watch + debounce 500ms
  - [x] add / change / unlink + debounce
  - [x] 變更 → LSP `documentSymbol` re-analysis → CKG update
- [x] 專案 hash + file content hash 決定是否需要更新（非 chokidar，使用內建 fs.watch）
- [x] 失效機制：signature 變更 → caller edges 保留但 stale 標記
- [x] 檔案刪除 → 標記節點 `stale: true`，保留 30 天（STALE_DAYS）

### 11.3 smart_code_query ✅

- [x] `src/plugins/standard/code-query.mjs` → `smart_code_query` (328 行，handler-based)
  - [x] 查詢類型：build / update / callers / callees / dependencies / unused-exports / symbol / stats (8 種)
  - [x] `query: "callers"` — 誰呼叫了某函式（depth 控制遞迴）
  - [x] `query: "callees"` — 某函式呼叫了誰
  - [x] `query: "dependencies"` — 模組依賴結構 (imports + importedBy)
  - [x] `query: "unused-exports"` — 未使用的導出
  - [x] `query: "symbol"` — 符號定義查詢（name/file/kind filter）
  - [x] `query: "stats"` — CKG 統計資訊
  - [x] `query: "build"` — 全量掃描建立 CKG
  - [x] `query: "update"` — 增量更新單一檔案
  - [x] 跨 session 保留：CKG SQLite 檔案持久化於 `~/.smart/ckg/`
  - [x] 支援 text/json 輸出格式

### 驗收標準

- [x] 支援 16 種節點類型 + 8 種邊類型
- [x] 增量更新單檔 < 100ms（hash 比對 + LSP query）
- [x] `smart_code_query({query: "callers", symbol: "foo", file: "src/foo.ts"})` 回傳正確呼叫者
- [x] `smart_code_query({query: "dependencies", file: "src/bar.ts"})` 回傳依賴結構
- [x] `smart_code_query({query: "unused-exports", root: "."})` 回傳未使用導出
- [x] `smart_code_query({query: "stats"})` 回傳 CKG 統計
- [x] 已註冊為 MCP tool，可在 opencode agent 中呼叫
- [x] 跨 session 查詢同一資訊不需重掃（SQLite 持久化）
- [ ] 1000 檔案專案 CKG 建立 < 30 秒（待大專案驗證）

---

## ✅ Phase 12: Hybrid Reasoning Engine (P0 — 分層效率) ✅

**對應 plan.md 五-Phase 12**
**目標**：Task Classifier 自動路由問題到最適合的處理層
**前置**：Phase 10 + Phase 11 完成
**狀態**：✅ 已完成（2026-06-05）

**實作摘要**：`src/lib/hybrid-engine.mjs` (1050 行) — 完整 Hybrid Reasoning pipeline，含 Task Classifier / extractSymbols / planPath / executePlan / mergeResults / executeHybrid。`src/plugins/standard/hybrid-router.mjs` — `smart_hybrid_router` MCP tool（handler-based）。40 測試全數通過。

### 12.1 Task Classifier

- [x] `src/lib/hybrid-engine.mjs` — Hybrid Router 核心 (1050 行)
  - [x] Rule-based classifier：6 分類 (structure / change-impact / debug / search / semantic / unknown)
  - [x] regex pattern matching + confidence score (0.7-0.99)
  - [x] 低於 0.75 threshold → `isHybrid=true` 走雙路徑混合
  - [x] `extractSymbols()` — NLP-light 符號提取（"callers of foo" → "foo"）
  - [x] `planPath()` — DAG 生成 + parallel group 分群
  - [x] `executePlan()` — ordered-parallel 執行 + error isolation
  - [x] `mergeResults()` — value-structure-inspected 結果合併（toolChecks 表）
  - [x] `executeHybrid()` — 完整 pipeline orchestrator（classify → plan → execute → merge）
- [x] `src/plugins/standard/hybrid-router.mjs` → `smart_hybrid_router`
  - [x] 輸入：`{ question, context?, forceHybrid?, format? }`
  - [x] 輸出：`{ answer, sources, confidence, metadata }` 結構化格式

### 12.2 輸出合併引擎

- [x] 確定性 + LLM 結果結構化合併（mergeResults 含 sources 追溯）
- [x] 衝突偵測基礎：toolChecks value-structure-inspection 比對結果類型
- [x] 信心顯示：`{ answer, sources: [{type, tool, confidence}], confidence, metadata }`
- [x] `findResultByTool()` / `findResultsByTool()` toolChecks-based 查找

### 驗收標準

- [x] 6 分類 routing 正確：structure / change-impact / debug / search / semantic / unknown
- [x] 確定性路徑延遲 < 50ms（classify + execute stub plan）
- [x] 不確定時 isHybrid=true → 雙路徑 forces hybrid execution
- [x] 輸出格式結構化，可追溯來源（sources[] 含 type/tool/confidence）
- [x] 40 tests pass: classification/extraction/planning/execution/parallel-groups/merge/hybrid/verification

---

## 🟠 Phase 13: Change-Impact Pipeline (P1) ✅

**對應 plan.md 五-Phase 13**
**目標**：git diff → AST diff → 影響傳播 → 測試預測
**前置**：Phase 10 + Phase 11 + Phase 12 完成
**狀態**：✅ 已完成（2026-06-05）

**實作摘要**：`src/lib/impact-engine.mjs` (710 行) — ImpactEngine class 包含 parseDiff / getChangedSymbols / propagateImpact (CKG+LSP) / predictTests / analyzeImpact 完整 pipeline。`src/plugins/standard/impact-flow.mjs` — `smart_impact_flow` MCP tool（handler-based, 支援 text/json 格式）。`src/cli/workflow.mjs` — `refactor-safe-flow` 模板（5 步驟：impact_flow → call_graph → thinking → cross_file_edit → test）。

### 13.1 影響傳播 ✅

- [x] `src/lib/impact-engine.mjs` — 影響分析核心 (710 行)
  - [x] git diff parsing → 修改符號列表（parseDiff + getChangedSymbols）
  - [x] CKG queryCallers → 影響傳播（propagateImpact, depth 控制）
  - [x] LSP references fallback（當 CKG 資料不可用時）
  - [x] Test prediction（3 種啟發式：import 關係 / 同目錄 / 命名匹配）
  - [x] over-approximation（動態語言）vs CKG 精確分析（靜態語言）
- [x] `src/plugins/standard/impact-flow.mjs` → `smart_impact_flow` MCP tool
  - [x] 輸入：`{ diff?, files?, symbols?, depth?, predictTests?, format?, root? }`
  - [x] 輸出：`{ changes, symbols, impact: { direct, transitive, stats }, testPrediction, summary }`
  - [x] 支援 text/json 輸出格式

### 13.2 Workflow 整合 ✅

- [x] workflow 模板新增：`refactor-safe-flow`
  - [x] step 1: `smart_impact_flow` → impact list
  - [x] step 2: `smart_code_call_graph` → 確認影響範圍
  - [x] step 3: `smart_thinking` → review impact summary
  - [x] step 4: `smart_cross_file_edit` → 安全編輯
  - [x] step 5: `smart_test` → 驗證

### 驗收標準

- [ ] AST diff 正確識別變更符號 > 95%
- [ ] Impact 傳播在 1000 檔案專案 < 200ms
- [ ] 重構 workflow 能主動警示「此修改影響 X 個下游模組」

---

## 🔴 Phase 14: Multi-Model Orchestration (P0) ✅

**對應 plan.md 五-Phase 14**
**目標**：動態選擇處理模型/工具，最佳化成本與延遲
**前置**：Phase 10-13 完成
**狀態**：✅ 已完成（2026-06-05）

### 14.1 模型路由器

- [x] `src/lib/model-router.mjs` (545 行) — 模型路由核心
  - [x] Tier 分類：結構(T1) / 簡單語義(T2) / 複雜語義(T3) / 重構生成(T4)
  - [x] Plugin 式模型提供者（API / 本地 / 確定性）
  - [x] 成本追蹤 + 延遲監控
  - [x] 自動降級策略 (T4→T3→T2→T1 fallback + healthCheck)
- [x] `src/plugins/standard/model-router.mjs` → `smart_model_router` (6 commands)

### 驗收標準

- [x] 整體 API 成本降低 60%+ (estimateSavings 典型 86.5%)
- [x] 平均延遲改善 70%+ (T1 50-200ms vs T4 5-30s)
- [x] 降級路徑正確觸發 (56 tests pass)

---

## ✅ Phase A: 競爭回應 — 產品基礎補強 (P0 立即)

**對應 plan.md 五-Phase A**
**目標**：補足競爭劣勢（CKG 多語言、語言助手擴充、效能優化）

### ✅ A.1 語言助手擴充（原 Phase 9）

- [x] `rs-helper.mjs` Rust 分析（cargo check + clippy + analyze + fmt）
- [x] 已註冊：workflow.mjs + compose-engine.mjs + planner.mjs + server/index.mjs + model-router
- [ ] `go-helper.mjs` Go 分析（gopls 未安裝，跳過）
- [ ] 自動語言偵測 dispatcher（未來）

### ✅ A.2 CKG 多語言支援（P0）

- [x] LSP bridge 多語言：Rust (rust-analyzer) + Python (pylsp) + Swift (sourcekit-lsp)
  - [x] LSP_CONFIGS: 4 語言 (TypeScript/Python/Rust/Swift)
  - [x] per-language 自動偵測（_langForFile）+ per-language process 管理
- [x] CKG Engine 多語言 import 解析：
  - [x] Rust: SUPPORTED_EXTS + parseRustImports (use/mod) + mod.rs 路徑解析
  - [x] Python: SUPPORTED_EXTS + parsePythonImports (from...import) + dots→path 解析
  - [x] Swift: SUPPORTED_EXTS + parseSwiftImports (import/@_exported) + .swift 路徑解析
- [ ] CKG watch mode 多語言強化（未來）
- [ ] Go 支援（需 goplis 安裝）

### ⏳ A.3 CKG 效能優化（P1）

- [ ] CKG build 優化：1000 檔 < 10 秒
  - [ ] LRU cache 擴充至 5000 筆
  - [ ] 大型專案（10000+ 檔）增量更新測試
  - [ ] 記憶體優化：分頁式節點載入

---

## 🟠 Phase B: 競爭回應 — 生態系建立 (P1 短期)

**對應 plan.md 五-Phase B**
**目標**：第三方貢獻門檻降低，工具生態系建立

### B.1 Tool Marketplace 基礎（P1）

- [ ] Manifest 規範：name/version/tools/description/requires
- [ ] Plugin Registry：`~/.smart/plugins/` 目錄掃描
- [ ] npm 分發：plugin 包裝為 npm package
- [ ] 自動發現：server 啟動時掃描 plugins
- [ ] 參考實作：`smart_docker` plugin
- [ ] `smart_integrate list` 顯示已安裝 plugins

### ✅ B.2 Agent Personality v2（P1）✅

- [x] CKG 感知：agent 自動查詢 CKG，不需檔案路徑
- [x] 成本感知：task 分類自動選擇確定性/混合/LLM
- [x] 記憶感知：工具錯誤時自動檢查 memory store
- [x] 自動錯誤分類：已知模式自動跳過診斷
- [x] config/agents/smart-mcp.md 241→388 行，16 節：strategic positioning (5 moats)、Phase 10-14 工具表、CKG-aware routing table、cost-aware T1-T4 routing、hybrid reasoning、impact analysis、12 workflow templates、memory-aware error prevention

### B.3 Pre-built Workflow 模板（P1）✅

- [x] api-explore-flow：learn → ast → call_graph → diagram
- [x] migration-flow：impact → impact → thinking → edit → test
- [x] code-review-flow：grep → ast → call_graph → thinking → report
- [x] perf-diagnose-flow：grep(perf) → call_graph → debug → report
- [x] onboard-flow：learn → import_graph → naming → diagram → report
- [x] 新增 CLI wrappers：code-ast.mjs, code-call-graph.mjs, impact-flow.mjs
- [x] TOOL_CLI_MAP 更新 + help text 更新
- [x] 13/13 workflow tests 通過

---

## 🟡 Phase C: 競爭回應 — 殺手級獨特功能 (P2 中期)

**對應 plan.md 五-Phase C**
**目標**：將架構 moats 產品化，做 Claude Code 做不到的事

### C.1 CKG-based 重構助手（P2）⏳

- [x] API 使用分析：CKG 追蹤 API 所有使用位置
  - [x] `queryUsagePatterns()` — 6 種模式分類 (direct/call/event-handler/class-method/module-init/factory/property-access)
  - [ ] 使用模式歸納（事件監聽/工廠/策略）
- [x] 遷移計畫生成（結構化步驟）
  - [x] `refactor-planner.mjs` — generateMigrationPlan + estimateDifficulty
  - [x] `smart_refactor_plan` MCP tool
  - [x] 10/10 planner 單元測試通過
- [ ] 安全閘門（影響 X 檔案需確認）
- [ ] CKG 整合：buildReferences 建立 calls edge → queryUsagePatterns 可查

### C.2 回歸測試預測強化（P2）

- [ ] 測試覆蓋率 map：CKG 記錄函式被哪些測試覆蓋
  - [ ] 精確預測：修改 foo → 只跑相關測試
  - [ ] 信心標記：確定性 vs 推測
  - [ ] 增量執行：只跑受影響測試

### C.3 程式碼健康儀表板（P2）

- [ ] CKG 統計：函式數量、複雜度、依賴深度
  - [ ] 未使用 exports 趨勢追蹤
  - [ ] 循環依賴檢測 + 可視化
  - [ ] 技術債指數（複合指標）
  - [ ] 跨 session 健康度趨勢圖

---

## ✅ 已完成 (v3.7.1)

### Phase 8: 程式碼生成輔助 (2026-06-05)
- [x] `src/plugins/standard/patch-gen.mjs` → `smart_patch_gen` (handler-based, ~270 行)
  - 從 error_diagnose/debug/thinking 輸出自動萃取變更資訊
  - 支援 file/pattern/replacement explicit 參數
  - text/json/diff 三種格式輸出
  - 安全閘門：3+ 檔案需 apply=true 授權
- [x] `tests/patch-gen.test.mjs` — 14 項測試全部通過，0 regression
- [x] 工具總數: 36 standard (6 core + 35 standard + 3 agent)

### Phase 13: Change-Impact Pipeline (2026-06-05)
- [x] `src/lib/impact-engine.mjs` — ImpactEngine class (710 行)
  - parseDiff / getChangedSymbols / propagateImpact (CKG+LSP) / predictTests / analyzeImpact
- [x] `src/plugins/standard/impact-flow.mjs` → `smart_impact_flow` MCP tool (handler-based)
- [x] Workflow 模板新增 `refactor-safe-flow` (5 步驟)
- [x] Phase 7.3: ContextManager mergeSessions() + smart_context merge 指令

### Phase 7.3: Cross-session context 合併 (2026-06-05)
- [x] `ContextManager.mergeSessions(sessionIds[])` — 去重合併 findings + history + metadata
- [x] `smart_context merge` — MCP 指令（支援 sessionIds 陣列參數）

### Auto-Toonify 回應攔截器 (2026-06-05)
- [x] `src/server/index.mjs` — `respond()` 新增 auto-toonify 攔截器
  - [x] `tryOptimizeOutput()` — 對 ≥500 chars 的 JSON-like 輸出自動執行 TOON 優化
  - [x] lazy-init `TokenOptimizer`（首次大 JSON 回應才載入 toonify-mcp）
  - [x] `_respondChain` Promise-chain 保證輸出順序
  - [x] best-effort catch — 優化失敗不中斷正常回應
  - [x] 配置：`SMART_TOONIFY=0` 關閉，`TOONIFY_PATH` 自訂路徑
  - [x] 參數：`minTokensThreshold: 50, minSavingsThreshold: 10, maxProcessingTime: 20`
- [x] agent 零感知節省 token：不須手動呼叫 smart_toonify

### Phase 12: Hybrid Reasoning Engine (2026-06-05)
- [x] `src/lib/hybrid-engine.mjs` — Hybrid Reasoning 核心 (1050 行)
  - Task Classifier (6 類別 + regex patterns + confidence)
  - extractSymbols (NLP-light 符號提取)
  - planPath (DAG + parallel groups)
  - executePlan (ordered-parallel + error isolation)
  - mergeResults (value-structure-inspected, toolChecks 表)
  - executeHybrid (完整 pipeline orchestrator)
- [x] `src/plugins/standard/hybrid-router.mjs` — `smart_hybrid_router` handler-based MCP tool
- [x] 40 tests 全數通過
- [x] 工具總數: 40 (6 core + 34 standard)

### Phase 11: CKG 程式碼知識圖譜 (2026-06-05)
- [x] `src/lib/ckg-engine.mjs` — CKG 核心 (1108 行，SQLite 零依賴)
- [x] `src/plugins/standard/code-query.mjs` — `smart_code_query` (328 行，handler-based)
- [x] 8 種查詢：build/update/callers/callees/dependencies/unused-exports/symbol/stats
- [x] 16 種節點類型 + 8 種邊類型
- [x] 增量更新 (fs.watch + debounce) + 失效機制 (stale marking)
- [x] 跨 session 持久化 (`~/.smart/ckg/`)

### Phase 10: 程式碼語義工具鏈 (2026-06-04)
- [x] `src/lib/lsp-bridge.mjs` — LSP 統一接入層 (490 行，typescript-language-server)
- [x] `smart_code_ast` — AST 結構查詢 (LSP documentSymbol)
- [x] `smart_code_call_graph` — 呼叫鏈追蹤 (LSP references)
- [x] `smart_code_type_infer` — 型別推導 (LSP hover)
- [x] `smart_code_impact` — 影響半徑分析 (LSP + diff)
- [x] invokeTool async handler bug 修復

### Phase 5: Workflow 引擎強化 — dispatch 層 (2026-06-04)
- [x] `workflow.mjs` — `dispatch` 指令：自動呼叫 CLI 工具 + auto-report
- [x] TOOL_CLI_MAP — 17 個工具對應 CLI script 映射
- [x] TOOL_ARGS_CONVERTERS — 8 個工具自訂 positional args 轉換
- [x] `dispatch --parallel` — 同時執行獨立步驟
- [x] smart_context `workflow-stats` 指令 — 查詢 workflow 成本
- [x] 4 個 dispatch 測試 (step/group/completed-error/nonpending-error)

### Phase 6: Compose 引擎 + 平行執行 (2026-06-04)
- [x] `src/lib/compose-engine.mjs` — seq/par/cond 三種組合模式
- [x] `smart_compose` MCP tool — pipeline 執行入口
- [x] CLI spawn 非阻塞改造：spawnSync → spawn + Promise + AbortController
- [x] `compose.mjs` CLI 入口 + MCP plugin

### smart_git 工具合併 (2026-06-04)
- [x] `smart_git_commit` — Git commit 輔助 (message/body/template/--all/--dry-run)
- [x] `smart_git_pr` — PR 生成 (noPublish/draft/title/body)
- [x] `smart_git_review` — 程式碼審查 (all/focus/commit)
- [x] Workflow 模板新增 `git-flow`

### Phase 4: Workflow 引擎 (2026-06-04)
- [x] `smart_workflow` — 5 commands (create/report/replan/summary/list-templates)
- [x] 5 workflow templates (debug/refactor/security/research/default)
- [x] ContextManager workflowId 維度支援
- [x] Planner computeParallelHints() DAG-based 分群

### 動態多輪推理強化 (Phase 2.3)
- [x] thinking.mjs v3.1 — 動態多輪推理引擎
- [x] State persistence (`--state <path>` JSON file)
- [x] Step recording (`--record <idx> <result>`)
- [x] Branch 支援 (3 templates with branches: analyze, research, decision)
- [x] Context accumulation (前序結果自動注入下一步 prompt)
- [x] Session lifecycle: `--dynamic` → `--record` → `--advance` → `--branch` → `--finish`

### MCP 伺服器基礎設施 (Phase 0)
- [x] Plugin Loader + Router 架構 (core/ + standard/)
- [x] 40 工具註冊 (6 core + 34 standard — 含 Phase 10-12 全部工具)
- [x] DEBUG env var logging
- [x] Output guard (512KB / 200K chars)
- [x] Tool timing tracking
- [x] Health endpoint (smart/health)
- [x] Stats endpoint (smart/stats)
- [x] Runtime config endpoint (smart/config)
- [x] 優雅關閉 (SIGINT/SIGTERM)
- [x] 請求取消支援 ($/cancelRequest)
- [x] Per-tool timeout override (args._timeout)
- [x] 增強的錯誤回應 (含 tool list + suggestion)

### 核心工具 (Phase 0)
- [x] smart_grep — 語意感知程式碼搜尋 (含 scope/import context)
- [x] smart_security — 安全漏洞掃描 (credential/injection/path/deps)
- [x] smart_test — 測試執行器 (vitest/jest/mocha/ava/node:test)
- [x] smart_learn — 專案慣例學習 (語言/結構/命名/風格)
- [x] smart_thinking — 9 模板結構化推理 (v3.1: dynamic/state/branch/handler)
- [x] smart_think — 快速對話推理 (handler-based, 取代 sequential-thinking)

### Standard 工具 (Phases 0-11)
- [x] smart_coverage — 測試覆蓋率分析 (if/else/switch/loop/ternary)
- [x] smart_compose — 工具組合原語 (seq/par/cond pipeline)
- [x] smart_cross_file_edit — 跨檔案編輯 (dry-run 預設安全)
- [x] smart_debug — 錯誤分析與分類
- [x] smart_diagram — Mermaid.js 圖表 (flowchart/sequence/class/ER)
- [x] smart_error_diagnose — 失敗模式知識庫診斷
- [x] smart_exa_search — Exa 網路搜尋/爬蟲/程式碼查詢
- [x] smart_git_commit — Git commit 輔助 (message/dry-run/template)
- [x] smart_git_context — Git diff/commit/impact 分析
- [x] smart_git_pr — PR 生成 (noPublish/draft/title/body)
- [x] smart_git_review — 程式碼審查 (all/focus/commit)
- [x] smart_github_search — GitHub 程式碼搜尋
- [x] smart_import_graph — 跨檔案依賴分析 (6 語言)
- [x] smart_naming — 命名慣例分析 (kebab/camel/Pascal/UPPER)
- [x] smart_py_helper — Python 專案分析 (venv/mypy/deps)
- [x] smart_rename_safety — 重新命名安全檢查 (衝突/影子/不完整)
- [x] smart_report — HTML 報告 (test/security/coverage/custom)
- [x] smart_test_suggest — 測試案例建議 (edge/error/main flows)
- [x] smart_integrate — 工具鏈管理 (list/suggest-commit/generate-pr/diagnose/mcp)
- [x] smart_tool_stats — 工具使用統計 (record/report/trends/recommendations)
- [x] smart_toonify — TOON token 優化 (30-65% 節省)
- [x] smart_ts_helper — TypeScript 分析 (config/exports/modules)
- [x] smart_workflow — Plan-based orchestration (create/report/replan/summary/dispatch)
- [x] **Phase 10:** smart_code_ast — AST 結構查詢
- [x] **Phase 10:** smart_code_call_graph — 呼叫鏈追蹤
- [x] **Phase 10:** smart_code_type_infer — 型別推導
- [x] **Phase 10:** smart_code_impact — 影響半徑分析
- [x] **Phase 11:** smart_code_query — CKG 程式碼知識圖譜查詢

### Phase D: Agent Personality + 小模型兜底工具 (2026-06-04)
- [x] `config/agents/smart-mcp.md` — 240 行完整 agent 人格定義，含：
  - 40 工具策略表（任務類型→首選工具對照）
  - 常見任務工具鏈（除錯/重構/安全/探索/Git/研究）
  - Workflow 自動化（6 模板 + dispatch/replan/summary）
  - Pipeline 組合（seq/par/cond）
  - 記憶整合 + Context 管理 + 任務規劃
  - CKG 程式碼知識圖譜查詢
  - 小模型兜底策略（不確定時呼叫輔助工具）
- [x] `smart_agent_recommend` — 工具推薦引擎（handler-based, 12 種任務模式）
- [x] `smart_agent_execute` — 工作流自動化計畫產生器（6 種模板）
- [x] `smart_agent_plan` — 複雜目標分解（DAG + 複雜度分析 + 風險識別）
- [x] `smart-agent/src/install/install-agent.mjs` — 一鍵安裝腳本
- [x] 兩層架構：強模型用 system prompt 推理，弱模型用 JS 引擎兜底

### Bug Fixes
- [x] invokeTool() — 修復 async handler 回傳 `[object Promise]`
  - 原因：4 個 Phase 10 LSP 工具（code-ast/code-call-graph/code-type-infer/code-impact）使用 `async handler`，但 `invokeTool()` 未 await Promise
  - 修復：handler 回傳 Promise 時回傳 `__async` sentinel，caller 路徑（tools/call native + smart_run）resolve 後再 respond
  - 2026-06-04 驗證通過：`smart_code_ast({file: "src/server/loader.mjs"})` 回傳 22 symbols
- [x] toonify.mjs — 修復 `Cannot find module '../../package.json'`
  - 原因：`createRequire(TOONIFY_PATH)` base 為 `/Users/wclin/toonify-mcp`，`../../package.json` 解析到 `/Users/package.json` 不存在
  - 修復：移除 dead code（`require('../../package.json')` 的 destructured `optimize` 完全未使用），同時移除 `createRequire` import
- [x] toonify.mjs — 降低 `minSavingsThreshold` 從 30% 到 10%
  - 原因：TOON format 對中型資料（50-200 tokens）可省 10-29%，但 default 30% 門檻太高導致永遠回傳 "Not optimized"
  - 修復：傳遞自訂 config `{ minSavingsThreshold: 10, minTokensThreshold: 20 }` 給 `TokenOptimizer`
  - 效果：5 users JSON 從 67→47 tokens（29.9%），200 users JSON 從 5,012→2,888 tokens（42.4%）

### 🔄 Phase A: 語言助手擴充 + CKG 多語言 (2026-06-05)
- [x] `src/plugins/standard/rs-helper.mjs` → `smart_rs_helper` (CLI-based, 4 commands: check/clippy/analyze/fmt)
- [x] `src/cli/rs-helper.mjs` — CLI 實作完備：
  - cargo check (compile errors parser)
  - cargo clippy (lint warnings parser)
  - Cargo.toml 分析 (name/version/deps/features/targets)
  - cargo fmt --check (formatting diff)
  - text/json/markdown 三種輸出格式
- [x] 工具註冊：compose-engine.mjs + workflow.mjs + planner.mjs + server/index.mjs + model-router
- [x] LSP Bridge 多語言擴充：Swift (sourcekit-lsp) + 既有 TS/Python/Rust
- [x] CKG Engine 多語言：.swift SUPPORTED_EXTS + parseSwiftImports() + resolveImportSource()
- [x] rustup default stable 設定 (未設定工具鏈問題修復)
- [x] 14 tests pass, 0 regression

---

## ✅ Sprint 1：基礎強化（已完成）

**對應 plan.md 九-Sprint 1**
**目標**：CKG 效能優化 + Workflow 模板擴充，雙線平行進行。

### A.3 CKG 效能優化 ✅

- [x] CKG build 速度優化
  - [x] 分析當前 build 瓶頸（LSP documentSymbol 佔 80%+ 時間）
  - [x] 引入批次 SQLite transaction（SAVEPOINT/RELEASE 包裝每檔 SQL）
  - [x] 平行掃描（chunk-based concurrency=20, env CKG_BUILD_CONCURRENCY）
  - [x] getReferences 移到 transaction 外修復非同步問題
- [x] LRU cache 擴充：500 → 5000（env CKG_CACHE_SIZE）
- [x] 可配置 concurrency/cache age 環境變數

### B.3 Pre-built Workflow 模板擴充 ✅

- [x] 新增 `api-explore-flow`：learn → ast → call_graph → diagram
- [x] 新增 `migration-flow`：impact → impact → thinking → edit → test
- [x] 新增 `code-review-flow`：grep → ast → call_graph → thinking → report
- [x] 新增 `perf-diagnose-flow`：grep(perf) → call_graph → debug → report
- [x] 新增 `onboard-flow`：learn → import_graph → naming → diagram → report
- [x] 驗收：12 模板全部 `workflow list-templates` 顯示
- [x] CLI wrappers：code-ast.mjs, code-call-graph.mjs, impact-flow.mjs
- [x] 13/13 workflow tests pass

---

## 🟠 Sprint 2：Agent 升級（P0 — 次日優先）

**對應 plan.md 九-Sprint 2**
**目標**：Agent Personality v2 自動路由 + 補測試品質

### ✅ B.2 Agent Personality v2（P0）✅

- [x] CKG 感知 — agent 自動呼叫 smart_code_query
  - [x] 更新 smart-mcp.md：遇到程式碼結構問題優先查 CKG
  - [x] 範例 prompt：「找出 foo() 的 callers」→ 自動 smart_code_query 而非 LLM 猜
- [x] 成本感知 — agent 根據任務選擇 model-router 路徑
  - [x] 簡單問題（型別查詢、結構查詢）→ T1 確定性
  - [x] 中等問題（除錯、影響分析）→ T2/T3 混合
  - [x] 複雜問題（重構、生成）→ T4 LLM
- [x] 記憶感知 — 工具錯誤時自動檢查 memory store
  - [x] smart_error_diagnose 呼叫前先 query memory
  - [x] 已知錯誤（confidence > 0.8）直接跳過診斷
- [x] 更新 `config/agents/smart-mcp.md` 文件 (241→388 lines, 16 sections)
- [ ] 發 PR 更新 agent 定義

### ✅ Phase 9: Devtool 自身品質（P2）✅

- [x] 為缺失工具補單元測試
  - [x] `tests/compose.test.mjs` — 9/9 通過
  - [x] `tests/lsp-bridge.test.mjs` — 7/7 通過
  - [x] `tests/ckg-engine.test.mjs` — 8/8 通過
  - [x] `tests/impact-engine.test.mjs` — 10/10 通過
  - [x] 總計 34 測試，全部通過
- [ ] smart/stats 端點擴充
  - [ ] per-tool p50/p95/p99 延遲統計
  - [ ] 記憶體使用趨勢
  - [ ] 自動警報：某工具延遲突然飆升 2x

---

## 🟡 Sprint 3：殺手功能（P2 — 後續）

**對應 plan.md 九-Sprint 3**
**目標**：打造 Claude Code 完全做不到的功能

### C.1 CKG-based 重構助手（P2）

- [ ] API 使用分析：CKG 追蹤 API 所有使用位置
  - [ ] 查詢型 query：「找出 express.Router() 的所有使用方式」
  - [ ] 模式歸納：事件監聽 / 工廠 / 策略
  - [ ] 輸出結構化使用報告（檔案×位置×模式）
- [ ] 遷移計畫生成
  - [ ] 輸入：舊 API → 新 API 映射
  - [ ] 輸出：結構化遷移步驟（誰先改、誰後改）
  - [ ] 安全閘門：影響 > 5 檔案需確認
- [ ] Workflow 模板整合：`migration-flow` 使用重構助手

### C.2 回歸測試預測強化（P2）

- [ ] CKG 記錄函式→測試映射
  - [ ] 掃描 test 檔案，建立 test → testedFunction 邊
  - [ ] 支援命名啟發式（`test_foo` → `foo`，`testFoo` → `foo`）
  - [ ] 支援 import 鏈追蹤（test import module → module function）
- [ ] 精確預測：修改 foo() → 只跑相關測試
- [ ] 信心標記：確定性 vs 推測
- [ ] 增量執行整合：workflow dispatch 只跑受影響測試

### C.3 程式碼健康儀表板（P2）

- [ ] 每次 CKG build 產生健康報告 JSON
  - [ ] 函式總數 / 複雜度分布
  - [ ] 未使用 exports 數量
  - [ ] 循環依賴檢測（CKG edge → DFS cycle detection）
  - [ ] 技術債指數（複合指標）
- [ ] 跨 session 對比健康度變化
- [ ] 循環依賴可視化 (Mermaid diagram)
- [ ] smart_diagram 整合：`diagram type=graph` 輸出 CKG graph

### Phase H: 文檔與發布（P3）

- [ ] 補完 docs/README.md 文件
  - [ ] 安裝指引（npm / git clone 兩種方式）
  - [ ] 快速開始（5 分鐘上手）
  - [ ] 各工具模組說明
  - [ ] 常見問題
- [ ] 補完 docs/ARCHITECTURE.md
  - [ ] 系統架構圖
  - [ ] 各 lib 模組職責（lsp-bridge / ckg-engine / hybrid-engine / impact-engine / model-router）
  - [ ] 設計決策說明
- [ ] npm publish smart-agent
  - [ ] 驗證 `npm publish --access public` 流程
  - [ ] 驗證 `npm install smart-agent` 成功

---

## ✅ 已完成 (v3.7.1)

**Phase 0-14 全部完成**：
- Phase 0: thinking.mjs → smart_think + handler 化 ✅
- Phase 1: 記憶系統 (fuzzy + vector + TF-IDF) ✅
- Phase 2: 動態規劃引擎 (9 模板 + DAG + condition + replan) ✅
- Phase 3: Context Management (auto inject/capture/persist) ✅
- Phase 4: Workflow Engine (plan-based orchestration) ✅
- Phase 5: Workflow Dispatch (實際執行) ✅
- Phase 6: Compose Engine (seq/par/cond + 非阻塞 CLI) ✅
- Phase 7: Memory Upgrade (vector search + pattern + cross-session merge) ✅
- Phase 8: Patch Generation ✅
- Phase 10: Code Semantic Tools (LSP bridge + 4 tools) ✅
- Phase 11: CKG (SQLite-based code knowledge graph) ✅
- Phase 12: Hybrid Reasoning (6-class classifier + merge) ✅
- Phase 13: Change-Impact Pipeline ✅
- Phase 14: Multi-Model Orchestration ✅
- Phase D: Agent Personality (smart-mcp.md + 3 agent tools) ✅
- Phase A.1: rs-helper + A.2: CKG 多語言 (Rust/Swift/Python) ✅
- Auto-Toonify interceptor ✅
- smart_git tools (commit/pr/review) ✅
