# Devtool MCP — 執行清單

> 與 plan.md 互為補充：todo.md 追蹤「具體做什麼」，plan.md 說明「為什麼做」。
> 優先級：🔴 P0 = 立即  🟠 P1 = 短期  🟡 P2 = 中期  ⚪ P3 = 長期

---

## 🔴 Phase 0: thinking.mjs 改造 + smart_think 新增 (P0)

**對應 plan.md 五-Phase 0**
**目標**：將 thinking.mjs 從批次分析 CLI 改造為推理引擎，新增 handler-based `smart_think`，取代 sequential-thinking。

### 0.1 thinking.mjs 重構 — 抽出可程式化 API

- [ ] 將 thinking.mjs 從純 CLI 改造為模組，export 三個入口：
  - [ ] `export function quickThink(args)` — 快速推理
    - 參數：`{ thought, nextThoughtNeeded, thoughtNumber, totalThoughts, isRevision?, revisesThought?, branchFromThought?, branchId?, template? }`
    - 回傳：`{ output: string, done: boolean }`
    - 當指定 `template` 時，附加對應模板的 step prompt 作為引導（不強迫，參考用）
  - [ ] `export function deepAnalyze(args)` — 深層模板分析
    - 參數：`{ topic, template, steps?, format?, plan?, state? }`（保留現有功能）
    - 回傳：`{ output: string, state?: object }`
  - [ ] `main()` — 保留 CLI 模式，向後相容

### 0.2 新增 src/plugins/core/quick-think.mjs

- [ ] 建立 `src/plugins/core/quick-think.mjs` — handler-based MCP 工具
  - [ ] 定義 inputSchema：僅 2 required（thought + nextThoughtNeeded）
  - [ ] 可選參數：thoughtNumber, totalThoughts, isRevision, revisesThought, branchFromThought, branchId, template
  - [ ] 使用 `handler` 而非 `cli`，直接呼叫 `thinking.mjs` 的 `quickThink()`
  - [ ] 輸出格式：模擬 sequential-thinking 的逐步推理鏈
  - [ ] 範例輸出：
    ```
    Thought 3/5: 分析 command injection 的 root cause
    
    git-context.mjs 使用 execSync 直接拼接使用者輸入的 args，
    攻擊者可注入 shell metacharacter（;、|、$(...)）。
    
    修復方案：改用 spawnSync，args 以 array 傳遞。
    ```
  - [ ] 註冊為 `smart_think`（注意：不是 `smart_thinking`）

### 0.3 smart_thinking 改造 — handler 化

- [ ] 修改 `src/plugins/core/thinking.mjs`：
  - [ ] 將 `cli` → `handler`，消除 process spawn overhead
  - [ ] handler 內部呼叫 `thinking.mjs` 的 `deepAnalyze()`
  - [ ] 保留所有 9 模板 + state persistence + branching + context accumulation
  - [ ] 向後相容：所有現有參數繼續支援（topic, template, steps, format, plan, planStep, iterative, dynamic, state, record, advance, branch, finish, status, cancel, restore）

### 0.4 輸出改造 — 從模板骨架到真實推理

- [ ] static 模式輸出改造：
  - [ ] 不再輸出空的 template section headers
  - [ ] 改為輸出每個步驟的引導 prompt + template context
  - [ ] agent 看到 prompt 後可直接產出推理內容
- [ ] dynamic 模式輸出改造：
  - [ ] step 輸出從模板骨架 → 前序 context + 當前引導
  - [ ] summary 輸出從模板完成狀態 → 完整推理鏈回放

### 0.5 測試與驗證

- [ ] 測試 `quickThink()` 單元：
  - [ ] 基本呼叫：`quickThink({ thought: "test", nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 })` → 回傳正確格式
  - [ ] 修訂：`isRevision: true, revisesThought: 2` → 輸出含修訂標記
  - [ ] 分支：`branchFromThought: 3, branchId: "alt-path"` → 輸出含分支標記
  - [ ] 模板引導：`template: "debug"` → 輸出含 debug 模板提示
- [ ] 測試 `deepAnalyze()` 單元：
  - [ ] 各模板回傳正確結構
  - [ ] state file 可正確建立
  - [ ] branch 選擇正確
- [ ] 測試 smart-mcp 可正確載入 quick-think.mjs
- [ ] 測試 smart_think 可被 MCP client 呼叫

### 驗收標準
- [ ] `smart_think` 呼叫延遲 <1ms（無 process spawn）
- [ ] 參數僅 2 required（thought + nextThoughtNeeded）
- [ ] 輸出是真實推理內容，非模板骨架
- [ ] 支援 revision/branching/template 引導
- [ ] `smart_thinking` 保留所有既有功能，但延遲從 ~100ms 降到 <1ms
- [ ] opencode agent 可直接用 `smart_think` 取代 `sequential-thinking`

---

## 🔴 Phase 1: 自我學習 + 記憶系統 (P0)

**對應 plan.md 五-Phase 1**
**目標**：讓 smart 能記住過往修復經驗，避免重複犯錯。

### 1.1 記憶儲存層

- [ ] `src/plugins/standard/memory-store.mjs` — 建立輕量級 JSON 記憶庫
  - [ ] 定義記憶 schema：{ hash, errorType, resolution, toolsUsed, timestamp, success }
  - [ ] 模糊搜尋：Levenshtein distance / keyword match 比對錯誤訊息
  - [ ] 支援 CRUD：store / search / update / delete
  - [ ] 儲存位置：~/.smart/memory/resolutions.json
  - [ ] 自動壓縮：超過 N 筆時壓縮舊記錄

### 1.2 error-diagnose 整合記憶

- [ ] 修改 `src/plugins/standard/error-diagnose.mjs`
  - [ ] 診斷前先 `memory.search(currentError)` → 命中直接回傳已知修復
  - [ ] 未命中 → 正常診斷 → 診斷完成後 `memory.store(case)`
  - [ ] 回饋機制：使用者確認修復有效 → 提高該 case 權重

### 1.3 tool-stats 升級

- [ ] 升級 `src/plugins/standard/tool-stats.mjs`
  - [ ] 不只是計數：加入 pattern 歸納（哪類任務配哪組工具最成功）
  - [ ] 成功率趨勢分析：自動偵測某工具連續失敗
  - [ ] 建議引擎增強：不只報表，直接產出 actionable 建議

### 驗收標準
- [ ] 兩次相同錯誤 → 第二次秒回修復方案（不重複診斷）
- [ ] tool-stats 能回答「哪些工具組合對除錯任務最有效」

---

## 🔴 Phase 2: 動態規劃引擎 (P0)

**對應 plan.md 五-Phase 2**
**目標**：讓 smart 能自動規劃多工具執行序列，並根據結果動態調整。

### 2.1 Planner 核心

- [ ] `src/plugins/standard/planner.mjs` — 輕量級規劃器
  - [ ] 輸入：目標描述 + 可用工具清單 + 當前 context
  - [ ] 分解：將目標拆為 sub-goals
  - [ ] 映射：sub-goal → 最佳工具組合（參照 plan.md 任務-工具映射表）
  - [ ] DAG 生成：標記依賴關係，產出有序執行序列
  - [ ] 輸出格式：JSON array of { tool, args, dependsOn, onFailure }

### 2.2 條件分支與動態調整

- [ ] Planner 支援條件邏輯
  - [ ] `if result.X > threshold → use tool Y`
  - [ ] `if result.X contains "error" → use tool Z`
  - [ ] 工具失敗 → 自動切換到 onFailure 分支（非簡單重試）
- [ ] 回饋循環
  - [ ] 每步執行結果更新 planner state
  - [ ] state 變化觸發 replanning（必要時）

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
- [ ] 輸入「除錯這個 error」→ 自動產出 [grep → debug → read → fix → test] 計畫
- [ ] 中間某步失敗 → 自動調整後續步驟，不崩潰
- [x] `--dynamic` 模式可正確建立 state file、record、advance、branch、finish

---

## 🟠 Phase 3: 狀態管理 + Context 傳遞 (P1)

**對應 plan.md 五-Phase 3**
**目標**：工具間共享上下文，消除重複描述。

### 3.1 Context Schema 定義

- [ ] 定義統一 context object
  ```json
  {
    "projectRoot": "/path",
    "sessionId": "uuid",
    "toolHistory": [{ "tool": "smart_grep", "result": "...", "duration": 123 }],
    "accumulatedErrors": [],
    "lastResult": null
  }
  ```
- [ ] 寫入 src/server/index.mjs 作為 internal state

### 3.2 自動 Context 維護

- [ ] 每次工具呼叫自動注入 context（不須各工具手動處理）
- [ ] 工具輸出自動包含 contextUpdate
- [ ] Context 序列化/反序列化支援跨 session 恢復

### 驗收標準
- [ ] 連續呼叫 grep → debug → test，test 自動知道 grep/debug 的結果
- [ ] 重啟 smart server 後可恢復 context

---

## 🟠 Phase 4: Workflow 引擎 (P1)

**對應 plan.md 五-Phase 4**
**目標**：定義可復用的多工具工作流，一鍵執行。

### 4.1 Workflow 定義

- [ ] 定義 workflow YAML schema
  ```yaml
  name: debug-flow
  steps:
    - id: search
      tool: smart_grep
      args: { pattern: "${error_message}" }
    - id: analyze
      tool: smart_debug
      args: { error: "${steps.search.result}" }
      if: steps.search.count > 0
    - id: fix
      tool: smart_cross_file_edit
      args: { file: "${steps.analyze.file}", pattern: "${steps.analyze.badPattern}", replacement: "${steps.analyze.goodPattern}" }
      onFailure: report
    - id: verify
      tool: smart_test
      args: {}
  ```
- [ ] 內建 3 個預設 workflow：
  - [ ] `debug-flow.yaml` — grep → debug → fix → test
  - [ ] `refactor-flow.yaml` — import-graph → naming → cross-file-edit → test
  - [ ] `security-scan-flow.yaml` — security → report

### 4.2 Workflow Runner

- [ ] `src/plugins/standard/workflow-runner.mjs`
  - [ ] 解析 YAML → 執行 DAG（支援並行步驟）
  - [ ] 變數替換（`${...}` 語法）
  - [ ] 條件執行（`if` / `onFailure`）
  - [ ] 執行中斷與恢復

### 4.3 MCP 整合

- [ ] 註冊 `smart_workflow_run` 工具
  - [ ] 參數：`workflow` (path 或 name) + `vars` (變數映射)
  - [ ] 輸出：逐步結果 + 最終摘要
- [ ] 註冊 `smart_workflow_list` 工具
  - [ ] 列出所有可用 workflow + 說明

### 驗收標準
- [ ] 執行 `smart_workflow_run debug-flow errorMessage="TypeError: ..."` → 自動完成除錯
- [ ] 可自行撰寫 workflow YAML 並執行

---

## 🟡 Phase 5: 程式碼生成輔助 (P2)

**對應 plan.md 五-Phase 5**
**目標**：分析問題後不僅報告，還能自動產出修復 patch。

- [ ] `src/plugins/standard/patch-gen.mjs`
  - [ ] 輸入：error-diagnose 結果 / thinking 分析結果
  - [ ] 輸出：edit 指令序列（可直接餵給 edit tool）
  - [ ] patch preview（diff format）供人審查
- [ ] 整合 error-diagnose → patch-gen → cross-file-edit 一鍵流程
- [ ] 安全閘門：重大修改（跨檔案 >3 個）需人批准

---

## 🟡 Phase 6: Devtool 自身品質 (P2)

**目標**：smart MCP 伺服器本身的穩定性與可測試性。

### 6.1 自動測試

- [ ] 為每個 tool 建立單元測試（`tests/` 目錄）
  - [ ] `tests/grep.test.mjs`
  - [ ] `tests/security.test.mjs`
  - [ ] `tests/thinking.test.mjs`
  - [ ] ...類推
- [ ] CI 整合：`smart_test` 可執行自身測試

### 6.2 效能監控

- [ ] smart/stats 端點擴充
  - [ ] per-tool p50/p95/p99 延遲
  - [ ] 記憶體使用趨勢
  - [ ] 自動警報：某工具延遲突然飆升 2x

### 6.3 Debug 模式增強

- [ ] DEBUG=smart 輸出結構化
  - [ ] JSON lines format（可 pipe 到分析工具）
  - [ ] 支援 DEBUG=smart:grep 只過濾特定工具

---

## ⚪ Phase 7: 語言助手擴充 (P3)

**對應 plan.md 五-Phase 6**

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

## ✅ 已完成 (v3.1)

### 動態多輪推理強化
- [x] thinking.mjs v3.1 — 動態多輪推理引擎
- [x] State persistence (`--state <path>` JSON file)
- [x] Step recording (`--record <idx> <result>`)
- [x] Branch 支援 (3 templates with branches: analyze, research, decision)
- [x] Context accumulation (前序結果自動注入下一步 prompt)
- [x] Session lifecycle: `--dynamic` → `--record` → `--advance` → `--branch` → `--finish`

### MCP 伺服器基礎設施
- [x] Plugin Loader + Router 架構 (core/ + standard/)
- [x] 23 工具註冊 (5 core + 18 standard) — Phase 0 完成後變為 24 (6 core + 18 standard)
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

### 核心工具
- [x] smart_grep — 語意感知程式碼搜尋 (含 scope/import context)
- [x] smart_security — 安全漏洞掃描 (credential/injection/path/deps)
- [x] smart_test — 測試執行器 (vitest/jest/mocha/ava/node:test)
- [x] smart_learn — 專案慣例學習 (語言/結構/命名/風格)
- [x] smart_thinking — 6 模板結構化推理 (debug/refactor/feature/research/decision/analyze) (v3.1: 9 模板 + dynamic/state/branch)
- [ ] smart_think — 快速對話推理 (Phase 0 新增, handler-based, 取代 sequential-thinking)

### Standard 工具
- [x] smart_coverage — 測試覆蓋率分析 (if/else/switch/loop/ternary)
- [x] smart_cross_file_edit — 跨檔案編輯 (dry-run 預設安全)
- [x] smart_debug — 錯誤分析與分類
- [x] smart_diagram — Mermaid.js 圖表 (flowchart/sequence/class/ER)
- [x] smart_error_diagnose — 失敗模式知識庫診斷
- [x] smart_exa_search — Exa 網路搜尋/爬蟲/程式碼查詢
- [x] smart_git_context — Git diff/commit/impact 分析
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
