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
- [x] 26 CLI tools → 30 tools (6 core + 24 standard)
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

## 🟠 Phase 7: Memory 升級 (P1 — 語意記憶 + 模式歸納)

**對應 plan.md 五-Phase 7**  
**目標**：從 fuzzy string match 升級到語意搜尋 + 跨 session pattern 歸納。

### 7.1 Vector search 層

- [ ] 使用 sentence embedding（`@xenova/transformers` 或 local ONNX model）
- [ ] 對每個 resolution 產生 embedding vector
- [ ] 搜尋時比對語意相似度而非 Levenshtein distance
- [ ] 降級策略：vector search 失敗 → fallback 到 fuzzy match

### 7.2 Pattern abstraction

- [ ] `tool-stats` `patterns` 指令增強：不只是 combo 分析
- [ ] 自動歸納「失敗模式 cluster」：相同工具 + 相同 error type 多次失敗
- [ ] 輸出 pattern report：「smart_grep 在 large 專案 timeout 率 40%，建議加 root 限制」

### 7.3 Cross-session context 合併

- [ ] ContextManager 新增 `mergeSessions(sessionIds[])`：合併多 session 的 findings
- [ ] `smart_context` 新增 `merge` 指令

### 驗收標準

- [ ] 語意相似錯誤（"file not found" vs "cannot locate file"）可匹配
- [ ] tool-stats patterns 輸出 pattern cluster 報告
- [ ] cross-session merge 正確合併 findings

---

## 🟡 Phase 8: 程式碼生成輔助 (P2)

**對應 plan.md 五-Phase 8**
**目標**：分析問題後不僅報告，還能自動產出修復 patch。

- [ ] `src/plugins/standard/patch-gen.mjs`
  - [ ] 輸入：error-diagnose 結果 / thinking 分析結果
  - [ ] 輸出：edit 指令序列（可直接餵給 edit tool）
  - [ ] patch preview（diff format）供人審查
- [ ] 整合 error-diagnose → patch-gen → cross-file-edit 一鍵流程
- [ ] 安全閘門：重大修改（跨檔案 >3 個）需人批准

---

## 🟡 Phase 9: Devtool 自身品質 (P2)

**目標**：smart MCP 伺服器本身的穩定性與可測試性。

### 9.1 自動測試

- [ ] 為每個 tool 建立單元測試（`tests/` 目錄）
  - [ ] `tests/grep.test.mjs`
  - [ ] `tests/security.test.mjs`
  - [ ] `tests/thinking.test.mjs`
  - [ ] ...類推
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

## ⚪ Phase 10: 語言助手擴充 (P3)

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

## ✅ 已完成 (v3.3)

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
- [x] 30 工具註冊 (6 core + 24 standard)
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

### Standard 工具 (Phases 0-6)
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

### Bug Fixes
- [x] toonify.mjs — 修復 `Cannot find module '../../package.json'`
  - 原因：`createRequire(TOONIFY_PATH)` base 為 `/Users/wclin/toonify-mcp`，`../../package.json` 解析到 `/Users/package.json` 不存在
  - 修復：移除 dead code（`require('../../package.json')` 的 destructured `optimize` 完全未使用），同時移除 `createRequire` import
- [x] toonify.mjs — 降低 `minSavingsThreshold` 從 30% 到 10%
  - 原因：TOON format 對中型資料（50-200 tokens）可省 10-29%，但 default 30% 門檻太高導致永遠回傳 "Not optimized"
  - 修復：傳遞自訂 config `{ minSavingsThreshold: 10, minTokensThreshold: 20 }` 給 `TokenOptimizer`
  - 效果：5 users JSON 從 67→47 tokens（29.9%），200 users JSON 從 5,012→2,888 tokens（42.4%）
