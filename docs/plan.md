# Devtool MCP — 能力現狀與強化路線圖

> 本文件是 smart MCP 的戰略規劃文件，涵蓋架構、能力矩陣、缺口分析、以及後續強化方向。
> 與 todo.md 互為補充：plan.md 定義「要做什麼、為什麼」，todo.md 定義「具體步驟」。

---

## 一、現狀摘要

Devtool MCP 是一個本地開發工具伺服器，透過 MCP 協定為 opencode agent 提供 27 個開發工具。當前版本 3.2.0（Plugin Loader + Router 架構 + 動態多輪推理 + Context 管理）。

### 核心數據
- **工具總數**：27（7 原生 + 20 經 router）
- **架構**：Plugin Loader → src/plugins/core/（原生）/ src/plugins/standard/（router 分發）
- **語言**：JavaScript (ESM)
- **輸出保護**：512KB buffer / 200K chars soft limit
- **Health Endpoint**：`smart/health`（含 context 資訊）
- **Context 管理**：`smart_context` MCP tool + `smart/context` 端點 + 自動注入/捕獲/持久化
- **動態推理**：thinking v3.1 — state persistence, branching, multi-round, context accumulation

---

## 二、當前架構

```
src/
├── server/              (MCP Server Entry)
│   ├── index.mjs        → JSON-RPC 2.0 over stdio
│   └── loader.mjs       → Plugin auto-loader
│
├── plugins/core/        (6 native tools, 直接註冊為 MCP tools)
│   ├── grep.mjs              → smart_grep
│   ├── learn.mjs             → smart_learn
│   ├── quick-think.mjs       → smart_think (快速推理, handler-based)
│   ├── security.mjs          → smart_security
│   ├── test.mjs              → smart_test
│   └── thinking.mjs          → smart_thinking (深層分析, handler-based)
│
├── plugins/standard/    (20 standard tools, 經 smart_run router)
│   ├── coverage.mjs          → smart_coverage
│   ├── cross_file_edit.mjs   → smart_cross_file_edit
│   ├── debug.mjs             → smart_debug
│   ├── diagram.mjs           → smart_diagram
│   ├── error_diagnose.mjs    → smart_error_diagnose
│   ├── exa_search.mjs        → smart_exa_search
│   ├── git_context.mjs       → smart_git_context
│   ├── github_search.mjs     → smart_github_search
│   ├── import_graph.mjs      → smart_import_graph
│   ├── integrate.mjs         → smart_integrate
│   ├── memory_store.mjs      → smart_memory_store
│   ├── naming.mjs            → smart_naming
│   ├── planner.mjs           → smart_planner
│   ├── py_helper.mjs         → smart_py_helper
│   ├── rename_safety.mjs     → smart_rename_safety
│   ├── report.mjs            → smart_report
│   ├── test_suggest.mjs      → smart_test_suggest
│   ├── tool_stats.mjs        → smart_tool_stats
│   ├── toonify.mjs           → smart_toonify
│   └── ts_helper.mjs         → smart_ts_helper
│
├── cli/                 (各 tool CLI 實作)
│   ├── contextual-grep.mjs
│   ├── coverage-check.mjs
│   ├── thinking.mjs          (also used as lib by plugins)
│   └── ... (25 CLI files)
│
├── lib/
│   └── utils.mjs        (shared utilities)
│
└── ... (config, docs, reports)
```

---

## 三、能力矩陣（誠實評估）

### 3.1 分類覆蓋

| 領域 | 工具數 | 成熟度 | 說明 |
|------|--------|--------|------|
| **程式碼搜尋** | 2 | ✅ 成熟 | grep (語意感知) + naming (慣例分析) |
| **依賴分析** | 1 | ✅ 成熟 | import-graph (JS/TS/Python/Ruby/Rust/Go) |
| **測試** | 3 | ✅ 成熟 | test-runner + test-suggest + coverage-check |
| **安全** | 1 | ✅ 成熟 | security-scan (credential/injection/path/deps) |
| **除錯** | 2 | 🟡 中等 | debug-assist + error-diagnose (依賴預設 pattern KB) |
| **重構** | 2 | ✅ 成熟 | cross-file-edit + rename-safety (皆有 dry-run) |
| **Git** | 1 | ✅ 成熟 | git-context (diff/commit/impact) |
| **語言助手** | 2 | 🟡 中等 | py-helper + ts-helper (僅 Python/TS) |
| **搜尋** | 3 | ✅ 成熟 | exa-search + github-search + grep |
| **可視化** | 2 | ✅ 成熟 | diagram (Mermaid) + report (HTML) |
| **後設** | 3 | 🟡 中等 | integrate + tool-stats + toonify |
| **推理 (深層分析)** | 1 (smart_thinking) | ✅ 成熟 | 9 模板 + 動態多輪/state/branch，但 CLI spawn 不適合對話推理 |
| **推理 (快速思考)** | 1 (smart_think - 新增) | 🆕 規劃中 | handler-based 輕量推理，目標取代 sequential-thinking |

### 3.2 已驗證的強項

1. **工具廣度** — 從搜索→分析→測試→除錯→重構→安全→報表，涵蓋開發全流程
2. **安全設計** — cross-file-edit / rename-safety 預設 dry-run，不怕誤改
3. **import graph 核心** — 多工具 (git-context, cross-file-edit, diagram, report) 共享依賴分析，產生 synergies
4. **Plugin Loader 架構** — 新增工具 = 新增 .mjs 檔案到 src/plugins/standard/，零設定
5. **輸出保護** — 512KB / 200K chars 截斷，避免撐爆 LLM context
6. **健康檢查** — smart/health 端點可監控伺服器狀態
7. **優雅關閉** — SIGINT/SIGTERM 正確清理 pending calls

### 3.3 近期修復記錄

| 日期 | 工具 | 問題 | 修復 |
|------|------|------|------|
| 2026-06-04 | `toonify` | `require('../../package.json')` dead code 導致 `Cannot find module` | 移除未使用的 `createRequire` + `require` 呼叫 |
| 2026-06-04 | `toonify` | default `minSavingsThreshold: 30` 太高，中小型資料 (<100 tokens) 無法優化 | 降為 10% + 增加 `minTokensThreshold: 20` |
| 2026-06-04 | Phase 0 | 多項 Phase 0 完成 | 見下方 Phase 0 完成摘要 |
| 2026-06-04 | Phase 1 | 記憶系統+error-diagnose 整合+tool-stats 升級 | memory-store: confirm 指令+auto-category+dedup+壓縮; error-diagnose: 記憶預設開啟(useMemory=true→noMemory); tool-stats: patterns 指令+session 分析+combo 發現; 10 整合測試通過 |

### 3.4 關鍵缺口

| 缺口 | 嚴重性 | 說明 | 影響 |
|------|--------|------|------|
| **🟠 無狀態** | 高 | 每次工具呼叫獨立，不記得上次做了什麼、結果是什麼 | 無法做多步驟推理，複雜任務需外部 orchestration |
| **🔴 無自我學習** | 高 | tool-stats 只計數（呼叫次數/成功率），沒有 pattern extraction、沒有 resolution caching | 同樣錯誤會重複犯，無法隨時間進步 |
| **🔴 無動態規劃** | 高 | thinking 是靜態模板，不能根據中間結果調整策略、不能分支/回溯 | 複雜任務需手動迭代，無法自動化 |
| **🟠 無記憶** | 高 | 沒有 past resolutions KB、沒有 failure pattern 累積機制 | 每輪從零開始，經驗無法 reuse |
| **🟠 無程式生成** | 中 | 純分析工具，不能寫 code / 產生 patch | 找到問題無法自動修，需人工介入 |
| **🟡 無 context 傳遞** | 中 | 工具間沒有標準化的 context 傳遞機制 | 無法自動化多工具流程 |
| **🟡 無 workflow 引擎** | 中 | 沒有 pipeline / DAG 定義與執行能力 | 複雜工作流需在 agent 層硬編碼 |
| **🟢 語言覆蓋不足** | 低 | 只有 Python/TS 助手，缺 Rust/Go/Java | 多語言專案支援不完整 |

---

## 四、核心問題深度分析

### 4.1 為什麼「看起來工具很多，但複雜任務仍吃力」？

根本原因：**Devtool MCP 是工具箱，不是工匠。**

```
現狀：
  工具 A ──→ 結果 A ──→ (人) ──→ 決定下一步 ──→ 工具 B
                                 ↑
                             需要外部智能體中斷、判斷、再出發

理想：
  工具 A ──→ 結果 A ──→ [內部分析] ──→ 自動決定 ──→ 工具 B ──→ ...
                           ↑                          ↑
                      根據結果動態調整            記住脈絡
```

目前 smart 完全依賴 **opencode agent 的 system prompt 指令**（如強制循環演算法）來串接工具。這意味著：
- 每步推理都在 LLM context 中進行 → token 消耗大
- 工具間沒有共享記憶 → 每次都要重新描述上下文
- 無法累積經驗 → 同樣情境每次從零推理

### 4.2 修復優先級

| 優先級 | 要解決的問題 | 預期效益 |
|--------|------------|---------|
| **P0** | 無自我學習 + 無記憶 | 減少重複錯誤 60%+ |
| **P0** | 無動態規劃 | 複雜任務成功率提升 40%+ |
| **P1** | 無狀態 + 無 context 傳遞 | 減少 token 消耗 30%+ |
| **P1** | 無 workflow 引擎 | 多工具協作速度提升 50%+ |
| **P2** | 無程式生成 | 減少人工介入 70%+ |
| **P3** | 語言覆蓋不足 | 多語言專案支援 |

---

## 五、強化路線圖

### Phase 0: thinking.mjs 改造 + smart_think 新增（P0 — 推理引擎革新）

**目標**：將 thinking.mjs 從「批次分析 CLI」改造為「推理引擎」，新增 handler-based 快速思考工具 `smart_think`，最終取代 opencode 的 sequential-thinking。

**動機**：目前 smart_thinking 透過 `cli: 'thinking.mjs'` 每次 spawn Node.js process，延遲 ~100ms+，且輸出模板骨架而非推理內容。這使其無法取代 sequential-thinking（in-process, sub-ms, 對話原生）。

```
現狀：
  smart_thinking (CLI spawn) → 模板骨架輸出
  sequential-thinking (in-process) ← opencode 優先使用

目標：
  smart_think (handler, in-process) → 真實推理輸出 ← opencode 預設
  smart_thinking (handler, in-process) → 深層模板分析（保留功能）
```

#### 0.1 thinking.mjs 重構（共享推理引擎）

將 `thinking.mjs` 從純 CLI 改造為可程式化呼叫的模組：

```
thinking.mjs
├── export quickThink(args)    → 供 smart_think 呼叫
│     ├── 4 參數: thought/nextThoughtNeeded/thoughtNumber/totalThoughts
│     ├── 回傳格式化推理文字（相容 sequential-thinking 輸出）
│     └── 可選 template 引導（不強迫，僅附加 prompt 提示）
│
├── export deepAnalyze(args)   → 供 smart_thinking 呼叫
│     ├── 保留 9 模板 + state persistence + branching
│     └── 從 CLI 產出改為 function return
│
└── main()                     → CLI 模式保留（獨立使用不中斷）
```

#### 0.2 新增 `smart_think` 工具（快速推理）

`src/plugins/core/quick-think.mjs` — 使用 `handler` 而非 `cli`，in-process 執行：

| 面向 | smart_think | sequential-thinking | 優勢 |
|------|---------------|-------------------|------|
| 延遲 | sub-ms (handler) | sub-ms (in-process) | 持平 |
| required 參數 | 2 (thought + nextThoughtNeeded) | 4 (thought + nextThoughtNeeded + thoughtNumber + totalThoughts) | ✅ 更少 |
| 自由格式 | ✅ | ✅ | 持平 |
| Revision | ✅ | ✅ | 持平 |
| Branching | ✅ | ✅ | 持平 |
| **可選模板引導** | ✅ 9 模板可選 | ❌ | **獨有** |
| **跨 session 持久化** | ✅ state file 可選 | ❌ | **獨有** |
| **與 planner 整合** | ✅ 可載入 planner JSON | ❌ | **獨有** |

#### 0.3 現有 smart_thinking 改造（handler 化）

將 `src/plugins/core/thinking.mjs` 的 `cli` 改為 `handler`，消除 process spawn overhead，同時保留所有既有功能（9 模板、state persistence、branching、context accumulation）。

#### Phase 0 完成摘要 (2026-06-04)

| 項目 | 狀態 | 備註 |
|------|------|------|
| 0.1 thinking.mjs 重構 | ✅ | `quickThought` / `quickThink` / `deepAnalyze` / `main` 全部匯出 |
| 0.2 quick-think.mjs 新增 | ✅ | handler-based, 2 required params, 支援 hypothesis/verification/branching |
| 0.3 smart_thinking handler 化 | ✅ | 9 模板 + dynamic/state/branch, iterative 模式 fallback 到 CLI |
| 0.4 輸出改造 | ✅ | 無 emoji/分隔線, topic 內嵌, header 簡潔, summary 推理鏈 |
| 0.5 測試 | ✅ | 27 測試 (quickThought/deepAnalyze/startDynamicSession/execStateCommand/plan) |
| 命名對齊 | ✅ | `quickThink` 別名已加入, import 使用 `quickThink` |
| **工具數** | **6 core + 20 standard = 26** | smart_think 加入 core, 總數 26 |

#### 0.4 輸出改造

兩種模式輸出都應是「真實推理內容」而非模板骨架：
- **smart_think**: 直接輸出 agent 的 thought 內容 + 格式化 metadata（步驟號、修訂、分支）
- **smart_thinking**: 模板引導產出結構化分析，但內容是 LLM 實際決策過程，不是 empty sections

#### 成功指標

| 指標 | 當前 | 目標 |
|------|------|------|
| 推理工具延遲 | ~100ms (CLI spawn) | <1ms (handler) |
| 參數數量 | 15+ | 2 required |
| 模板骨架輸出 | ✅ 是 | ❌ 否，改為真實推理 |
| 可取代 sequential-thinking | ❌ | ✅ |

---

### Phase 1: 自我學習 + 記憶系統（P0）✅

**目標**：讓 smart 能從過往經驗中學習，避免重複犯錯。

```
┌─ Memory Layer ──────────────────────────────┐
│  storage: ~/.smart/memory/                  │
│  ├── resolutions.json   (過往修復記錄)        │
│  ├── patterns.json      (失敗模式歸納)        │
│  └── stats.db           (工具使用統計進階版)  │
│                                               │
│  API: memory.search(query) → 找到相似案例     │
│       memory.store(case)  → 存入新案例        │
└───────────────────────────────────────────────┘
```

**具體實作**：
1. `src/plugins/standard/memory-store.mjs` — 輕量級 JSON-based 記憶儲存 ✅
   - key: 錯誤訊息的 hash
   - value: { resolution, toolsUsed, timestamp, success, hitCount, confirmedAt[] }
   - 支援模糊搜尋（Levenshtein / word overlap / keyword boost）
   - 自動分類（9 categories）+ dedup + auto-compression（5000 筆上限）
   - `confirm` 指令：回饋機制，boost hitCount +2
2. `error-diagnose.mjs` 增強 — 診斷前先搜尋記憶庫 ✅
   - 記憶搜尋預設**開啟**（`--no-memory` 可關閉）
   - 找到匹配 → 直接回傳已知修復方案（≥0.8 信心）
   - 未找到 → 正常診斷，完成後 `--store` 存入記憶庫
3. `tool-stats.mjs` 升級 — 不只是計數，加入 pattern 分析 ✅
   - `patterns` 指令：session 偵測 + combo 分析 + 任務分類績效
   - 成功率趨勢分析（前半/後半比較）+ 衰落工具警告 + 替代建議

### Phase 2: 動態規劃引擎（P0） ✅

**目標**：讓 smart 能根據目標自動生成執行計畫，並根據中間結果調整。

```
┌─ Planner Layer ─────────────────────────────┐
│  輸入：goal + available_tools + context      │
│                                              │
│  Step 1: 分解目標 → sub-goals               │
│  Step 2: 每個 sub-goal 映射到工具組合       │
│  Step 3: 標記依賴關係 → 生成 DAG            │
│  Step 4: 依 DAG 執行，每步結果回饋到 planner │
│  Step 5: 某步失敗 → 重新規劃剩餘步驟        │
└──────────────────────────────────────────────┘
```

**具體實作**：
1. **Plan generation** ✅ — 9 任務模板 + 關鍵字 fallback + 條件分支 + DAG 依賴
   - 模板比對（debug-error/refactor-rename/search-code/...）
   - 變數替換（`$goal`, `$contextFile`, `$symbol`）
   - 條件分支 metadata（`conditions[]` + `branchOn`）
2. **Plan execution state** ✅（新增）— JSON state file runtime 追蹤
   - `execute <goal>` — 產生 plan + 建立 state file + 回傳第一步
   - `next --state <path>` — 回傳下一步（尊重 dependencies）
   - `report --state <path> --step N --status ok|fail` — 回報結果，觸發動態調整
   - `replan --state <path> [--context]` — 強制重新規劃剩餘步驟
3. **Replan engine** ✅（新增）— 步驟失敗時動態調整
   - onFailure='abort' → 停掉整個 plan
   - onFailure='skip' → 跳過，標記依賴步驟為 skipped
   - onFailure='warn' → 自動觸發 replan：重新產生 plan 取代剩餘步驟
   - 累積已完成的 context 作為新 plan 的輸入
4. `thinking.mjs` 升級（v3.1 ✅）— 從靜態模板 → 動態多輪推理
   - **State persistence**: JSON 狀態檔案 (`--state <path>`)
   - **Step-by-step dynamic mode**: `--dynamic` 一次只顯示當前步驟
   - **Result recording**: `--record <idx> <result>`
   - **Branching**: 模板支援條件分支
   - **Context accumulation**: 前序結果自動注入後續 prompt
   - **plan_execute 模板**: 與 planner 輸出整合

### Phase 3: 狀態管理 + Context 傳遞（P1）✅

**目標**：工具間能共享上下文，減少重複描述。2026-06-04 完成。

```
┌─ Context Layer ──────────────────────────────┐
│  src/lib/context-manager.mjs                  │
│  每次工具呼叫自動記錄到 context history:       │
│  {                                            │
│    sessionId: "uuid",                         │
│    projectRoot: "/path",                      │
│    toolHistory: [ { tool, args, result } ],   │
│    accumulatedFindings: [...],                │
│    lastResult: { tool, summary, ok },         │
│    metadata: { toolCount, errorCount }        │
│  }                                            │
│                                               │
│  注入: handler 透過 args._context             │
│        CLI 透過 env SMART_CONTEXT             │
│  捕獲: invokeTool() + handleDevtoolRun()      │
│  持久化: ~/.smart/context/<sessionId>.json    │
└───────────────────────────────────────────────┘
```

**具體實作**：
1. ✅ `src/lib/context-manager.mjs` — ContextManager class（schema/注入/捕獲/持久化）
2. ✅ `src/server/index.mjs` — `captureAndReturn()` + `ensureContext()` + context env inj
3. ✅ `smart_context` MCP tool — 8 指令（get/summary/history/findings/reset/sessions/delete/inject）
4. ✅ 自動 findings 提取 — security/error/quality/dependency patterns
5. ✅ 42 測試通過（29 unit + 13 integration）

### Phase 4: Workflow 引擎（P1）

**目標**：定義可復用的多工具工作流，一鍵執行。

```
┌─ Workflow Layer ────────────────────────────┐
│  格式：YAML / JSON                           │
│                                              │
│  example: debug-workflow.yaml                │
│  steps:                                      │
│    - tool: smart_grep                      │
│      args: { pattern: "error" }             │
│    - if: result.count > 0                    │
│      then:                                  │
│        - tool: smart_debug                 │
│          args: { error: result.first }       │
│    - tool: smart_test                      │
│      args: {}                               │
└──────────────────────────────────────────────┘
```

**具體實作**：
1. 定義 workflow YAML schema
2. `src/plugins/standard/workflow-runner.mjs` — 解析 + 執行 workflow
3. 支援 `smart_workflow_run <file>` MCP 工具
4. 內建常用 workflow：debug-flow, refactor-flow, security-scan-flow

### Phase 5: 程式碼生成輔助（P2）

**目標**：分析問題後不僅報告，還能自動產出修復 patch。

**具體實作**：
1. `src/plugins/standard/patch-gen.mjs` — 根據分析結果生成 edit 指令
2. 整合 error-diagnose → patch-gen → cross-file-edit 流程
3. 安全閘門：重大修改需人批准（patch preview）

### Phase 6: 語言助手擴充（P3）

**目標**：支援更多程式語言的專屬分析。

**具體實作**：
1. `src/plugins/standard/rs-helper.mjs` — Rust（cargo check, clippy）
2. `src/plugins/standard/go-helper.mjs` — Go（go vet, golangci-lint）
3. 自動語言偵測 dispatch

---

## 六、架構演進

### 當前 v3.0

```
src/server/index.mjs
  ├── plugins/core/ (6 原生 — 全部 handler-based)
  │   ├── thinking.mjs   → smart_thinking (深層模板分析，handler 化)
  │   └── quick-think.mjs → smart_think (快速推理，取代 sequential-thinking)
  └── plugins/standard/ (20 router)
```

### 目標 v4.0

```
src/server/index.mjs
  ├── plugins/core/ (6 原生 — 全部 handler-based)
  │   ├── thinking.mjs   → smart_thinking (深層模板分析，handler 化)
  │   └── quick-think.mjs → smart_think (快速推理，取代 sequential-thinking)
  ├── standard/ (18+ router)
  ├── memory/          ← Phase 1 新增
  │   └── memory-store.mjs
  ├── planner/         ← Phase 2 新增
  │   └── planner.mjs
  ├── context/         ← Phase 3 新增
  │   └── context-manager.mjs
  └── workflow/        ← Phase 4 新增
      └── workflow-runner.mjs
```

#### v3.0 → v4.0 關鍵轉變

| 面向 | v3.0 | v4.0 |
|------|------|------|
| 推理工具架構 | CLI spawn (process per call) | handler (in-process) |
| 輸出內容 | 模板骨架 | 真實推理 |
| 對話支援 | ❌ 批次導向 | ✅ 對話原生 |
| 工具數量 core | 5 | 6 (+smart_think) |

---

## 七、成功指標

| 指標 | 當前 | 目標 (2026 Q3) | 衡量方式 |
|------|------|---------------|---------|
| 推理工具延遲 | ~100ms (CLI spawn) | <1ms (handler) | smart_think 呼叫時間 |
| 可取代 sequential-thinking | ❌ | ✅ | agent 預設使用 smart_think |
| 工具一次呼叫成功率 | ~85% | >95% | tool-stats report |
| 相同錯誤重複發生率 | ~40% | <10% | memory 命中率 |
| 複雜任務(5+工具)完成率 | ~60% | >85% | planner 追蹤 |
| 跨工具 context 傳遞 | ❌ 無 | ✅ 自動 | context layer |
| 動態多輪推理 | ❌ 靜態模板 | ✅ state+branch | thinking --dynamic 完成度 |
| **自動規劃 replan** | ❌ 步驟失敗就中斷 | ✅ 自動重新規劃 | **planner replan 引擎** |
| 可復用 workflow 數量 | 0 | 5+ | workflow 目錄 |
| 語言覆蓋 | 2 (Py/TS) | 4+ (Py/TS/RS/Go) | 語言助手工具數 |

---

## 八、現有工具一覽

| MCP 名稱 | Plugin | CLI 實作 | 用途 |
|---------|--------|----------|------|
| `smart_grep` | core/grep.mjs | contextual-grep.mjs | 語意感知程式碼搜尋 |
| `smart_security` | core/security.mjs | security-scan.mjs | 安全漏洞掃描 |
| `smart_test` | core/test.mjs | test-runner.mjs | 測試執行器 |
| `smart_learn` | core/learn.mjs | learn-adapt.mjs | 專案慣例學習 |
| `smart_thinking` | core/thinking.mjs | thinking.mjs (also lib) | 深層結構化分析 (9 模板 + 動態多輪) |
| `smart_think` | core/quick-think.mjs | handler-based, no CLI | 快速對話推理 (取代 sequential-thinking) |
| `smart_coverage` | standard/coverage.mjs | coverage-check.mjs | 測試覆蓋率分析 |
| `smart_cross_file_edit` | standard/cross_file_edit.mjs | cross-file-edit.mjs | 跨檔案編輯協調 |
| `smart_debug` | standard/debug.mjs | debug-assist.mjs | 錯誤分析與除錯 |
| `smart_diagram` | standard/diagram.mjs | diagram.mjs | Mermaid.js 圖表生成 |
| `smart_error_diagnose` | standard/error_diagnose.mjs | error-diagnose.mjs | 錯誤模式診斷 |
| `smart_exa_search` | standard/exa_search.mjs | exa-search.mjs | Exa 網路搜尋 |
| `smart_git_context` | standard/git_context.mjs | git-context.mjs | Git 脈絡分析 |
| `smart_github_search` | standard/github_search.mjs | github-search.mjs | GitHub 程式碼搜尋 |
| `smart_import_graph` | standard/import_graph.mjs | import-graph.mjs | 跨檔案依賴分析 |
| `smart_naming` | standard/naming.mjs | naming-convention.mjs | 命名慣例分析 |
| `smart_py_helper` | standard/py_helper.mjs | py-helper.mjs | Python 專案分析 |
| `smart_rename_safety` | standard/rename_safety.mjs | rename-safety.mjs | 重新命名安全檢查 |
| `smart_report` | standard/report.mjs | report.mjs | HTML 報告生成 |
| `smart_test_suggest` | standard/test_suggest.mjs | test-suggest.mjs | 測試案例建議 |
| `smart_integrate` | standard/integrate.mjs | tool-integrate.mjs | 工具鏈管理 |
| `smart_tool_stats` | standard/tool_stats.mjs | tool-stats.mjs | 工具使用統計 |
| `smart_toonify` | standard/toonify.mjs | toonify.mjs | TOON token 優化 (閾值 10%, 原 30%) |
| `smart_ts_helper` | standard/ts_helper.mjs | ts-helper.mjs | TypeScript 分析 |
