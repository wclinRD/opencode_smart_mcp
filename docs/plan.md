# Devtool MCP — 能力現狀與強化路線圖

> 本文件是 smart MCP 的戰略規劃文件，涵蓋架構、能力矩陣、缺口分析、以及後續強化方向。
> 與 todo.md 互為補充：plan.md 定義「要做什麼、為什麼」，todo.md 定義「具體步驟」。

---

## 一、現狀摘要

Devtool MCP 是一個本地開發工具伺服器，透過 MCP 協定為 opencode agent 提供 36 個開發工具 + 專屬 agent personality。當前版本 3.3.1（Plugin Loader + Router 架構 + 動態多輪推理 + Context 管理 + Workflow 引擎 + Compose 引擎 + Agent 人格定義 + 小模型兜底工具 + 全面非阻塞 CLI）。

### 核心數據
- **工具總數**：38（6 原生 + 32 經 router — 含 4 Phase 10 程式碼語義工具 + 3 Phase D agent 輔助工具）
- **架構**：Plugin Loader → src/plugins/core/（6 原生 handler）/ src/plugins/standard/（24 router CLI — 全部非阻塞 async spawn）
- **Workflow 引擎**：Phase 4-6 完成 — dispatch 實際執行 + 5 模板 + compose/pipe/parallel 三種原語 + replan + summary
- **語言**：JavaScript (ESM) — 6 核心 handler + 24 CLI 全數非阻塞化 (Phase 6)
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
├── plugins/standard/    (30 standard tools, 經 smart_run router)
│   ├── agent-execute.mjs      → smart_agent_execute (小模型用)
│   ├── agent-plan.mjs         → smart_agent_plan (小模型用)
│   ├── agent-recommend.mjs    → smart_agent_recommend (小模型用)
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
│   ├── ts_helper.mjs         → smart_ts_helper
│   └── workflow.mjs          → smart_workflow  ✨新
│
├── cli/                 (各 tool CLI 實作)
│   ├── contextual-grep.mjs
│   ├── coverage-check.mjs
│   ├── thinking.mjs          (also used as lib by plugins)
│   ├── workflow.mjs          ✨新
│   └── ... (26 CLI files)
│
├── lib/
│   ├── utils.mjs        (shared utilities)
│   ├── context-manager.mjs  (Context 管理)
│   └── compose-engine.mjs   (工具組合引擎)
│
├── config/
│   ├── agents/
│   │   └── smart-mcp.md  (Agent personality 定義檔)
│   └── opencode.json     (opencode 設定範例)
│
├── smart-agent/          (npm 安裝工具包)
│   ├── src/
│   │   ├── agent/        (策略引擎: tool-strategy/workflow/memory/planner)
│   │   ├── install/      (安裝腳本: install-agent/generate-config/detect-project)
│   │   └── index.mjs     (主入口)
│   └── tests/            (5 套件, 65 項測試)
│
└── docs/                 (plan.md, todo.md, README...)
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
| **推理 (深層分析)** | 1 (smart_thinking) | ✅ 成熟 | 9 模板 + 動態多輪/state/branch/handler 化 |
| **推理 (快速思考)** | 1 (smart_think) | ✅ 成熟 | handler-based 輕量推理，已取代 sequential-thinking |
| **Workflow 編排** | 1 (smart_workflow) | ✅ 完成 | 5 模板 (debug/refactor/security/research/default) + create/report/replan/summary |

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
| 2026-06-04 | `invokeTool` | `handler` 不支援 async — 4 個 Phase 10 LSP 工具回傳 `[object Promise]` | handler 傳回 Promise 時回傳 `__async` sentinel，caller 路徑 resolve Promise 後 respond |

### 3.4 當前缺口 (Phase 1-6 完成後，2026-06-04)

| 缺口 | 嚴重性 | 說明 | 對應 Phase | 狀態 |
|------|--------|------|-----------|------|
| **🔴 無工具組合原語** | 高 | 無 compose/pipe/parallel 原語 | Phase 6 ✅ | **已解決** |
| **🔴 CLI spawn 阻塞 event loop** | 高 | 24 standard tools 用 spawnSync，Node.js 單執行緒卡住 | Phase 6 ✅ | **已解決** |
| **🟠 Workflow 無實際執行能力** | 高 | workflow 只管理 state，工具執行要靠 opencode agent 手動 dispatch | Phase 5 ✅ | **已解決** |
| **🟠 Context 無 workflow 維度聚合** | 中 | 不能問「這個 workflow 花了多少 token / 時間」 | Phase 5 | **已解決** |
| **🟠 Memory 僅 resolution** | 中 | 無 vector search / pattern abstraction / 跨 session context 合併 | Phase 7 | ❌ 未完成 |
| **🟡 無程式生成** | 中 | 純分析工具，不能寫 code / 產生 patch | Phase 8 | ❌ 未完成 |
| **🟡 Planner 無 LLM-based 分解** | 中 | 模板僅關鍵字比對，複雜目標（如「修復 memory leak」）match 不到 | Phase 2 | 部分完成 |
| **🟢 語言覆蓋不足** | 低 | 只有 Python/TS 助手，缺 Rust/Go/Java | Phase 9/10 | ❌ 未完成 |

#### 3.5 新缺口：程式碼語義推理深度不足（P0 — 追趕 Claude Code 關鍵）

> **核心問題**：Phase 1-6 全部完成後，smart-mcp 在「工具數量、workflow、記憶、規劃」上已與 Claude Code 相當，但**程式碼推理深度**仍落後。差距根源在於 Tool Layer 缺乏語義級分析能力。

| 缺失能力 | Claude Code 有 | smart-mcp 現況 | 影響 |
|---------|---------------|----------------|------|
| AST parsing + cross-reference | ✅ 原生 | `analyze.learn` 僅結構萃取，無 AST | 無法理解程式碼語義，只能字串匹配 |
| 呼叫鏈追蹤（call-graph）| ✅ 原生 | 無原生的 call-graph build | 改 A 函式不知道影響 B/C/D |
| 類型推導（type inference）| ✅ 原生 | 依賴 LSP skill（需額外設定） | 多檔案型別傳播無法追蹤 |
| 影響半徑分析（impact analysis）| ✅ 原生 | 無 | 重構時不知道範圍多大 |
| 架構契約擷取（contract extraction）| ✅ 原生 | 無 | 不理解模組之間的依賴契約 |

**差距本質**：
- Claude Code 的推理深度來自 **Anthropic 模型的程式碼理解 + 原生 tool use 整合**
- smart-mcp 的 `grep` / `analyze.learn` 只做到**結構察覺**（structure-aware），達不到**語義推理**（semantic reasoning）層次
- 差距不在規劃層（planner/DAG 已完善），而在**工具本身能理解多深的程式碼**

**突破口**（三層修改對應三個 Phase）：
1. **Tool Layer** → Phase 10：整合 LSP 引擎（Tree-sitter / typescript-lsp / sourcekit-lsp）作為語義分析 backbone
2. **Memory Layer** → Phase 7：新增 `code-fact` 類型（function signature / dependency contract）長期保留跨 session 架構認知
3. **Planner Layer** → Phase 10：整合 call-graph 約束， Planner 具備「改 X 會影響 Y」的感知能力

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

### 4.2 修復優先級 (當前 v3.2)

| 優先級 | 要解決的問題 | 預期效益 |
|--------|------------|---------|
| **P0** | 無工具組合原語 + CLI spawn 阻塞 | Workflow 平行執行加速 2-3x |
| **P0** | Workflow 無實際執行能力 | 真正自動化多工具流程 |
| **P1** | Workflow context 維度聚合 | 成本與效能可視化 |
| **P1** | Memory 升級 (vector + pattern) | 減少重複錯誤 60%+ |
| **P2** | 無程式生成 | 減少人工介入 70%+ |
| **P3** | Planner LLM-based 分解 | 複雜目標匹配率提升 |
| **P3** | 語言覆蓋不足 | 多語言專案支援 |

### 4.3 Workflow 引擎深度評估 (2026-06-04 Phase 4 完成後)

6 層面評估結果：

| 層面 | 評分 | 關鍵發現 |
|------|------|---------|
| **Plugin Loader** | ✅ 成熟 | 30 tools 自動載入，新增工具=新增 .mjs 檔案，零設定 |
| **Context Manager** | ✅ 成熟 | 自動注入/捕獲/持久化，workflowId 維度，findings 提取 |
| **Planner** | ✅ 成熟 | 9 模板 + DAG + 條件分支 + replan 引擎 |
| **Memory Store** | 🟡 夠用 | fuzzy match 堪用，但無 vector search / pattern abstraction |
| **Workflow Engine** | 🟡 夠用但有限 | 5 模板 + create/report/replan/summary，但**無實際執行能力** |
| **Error Handling** | ✅ 優秀 | per-tool ERROR_FIXES + keyword scanning + Fix/Try 提示 |

### 4.4 Workflow 引擎：能做到 vs 不能做到（Phase 5-6 完成後更新）

| 能做到 ✅ | 不能做到 ❌ |
|-----------|------------|
| **實際執行工具** — `dispatch` 指令直接呼叫 invokeTool (Phase 5 ✅) | **複雜條件分支** — cond 僅支援簡單 keyword 匹配 |
| **平行執行** — `mode: par` + Promise.all 非阻塞 (Phase 6 ✅) | **跨 workflow 記憶** — 每次從模板開始，無 code-fact 累積 |
| **工具組合原語** — seq/par/cond 三種模式 (Phase 6 ✅) | **語義級程式碼理解** — 仍是結構萃取，無 AST/call-graph |
| **回報步驟結果、追蹤進度** | **LLM-based 目標分解** — 僅關鍵字比對，無深層語義規劃 |
| **步驟失敗時 replan** | **影響半徑分析** — 改 A 函式不知道影響 B/C/D |
| **輸出 summary 報告 (findings/toolStats)** | **架構契約擷取** — 不理解模組之間的依賴契約 |
| **`computeParallelHints()` DAG 分群** | |

**2026-06-04 更新說明**：Phase 5 dispatch 完成後，workflow 從 state tracker 升級為真正可執行引擎。Phase 6 compose 完成後，CLI spawn 全數非阻塞化，工具並行成為可能。剩餘「不能做到」均屬於 Phase 10（程式碼語義推理）範疇。

### 4.5 關鍵架構決策

```
決策 1: 疊加 Workflow Layer 而非改寫核心 ✅
  → workflow.mjs 獨立，不修改 invokeTool/loader/context-manager

決策 2: Plan-based orchestration 而非 agent spawning ✅
  → MCP server 不 spawn subagent，opencode host 負責執行

決策 3: handler 為新工具首選，CLI 工具已全面非阻塞化 ✅ (Phase 6 完成)
  → smart_think / smart_thinking 已 handler 化
  → 其餘 24 standard tools 已從 spawnSync 改為 spawn + Promise + AbortController
  → 新工具原則上用 handler，CLI 作為 fallback
```

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


### Phase 4 完成摘要 (2026-06-04)

| 項目 | 狀態 | 備註 |
|------|------|------|
| 4.1 Planner 增強 — computeParallelHints + WORKFLOW_TEMPLATES + export | ✅ | `generatePlan/computeParallelHints/WORKFLOW_TEMPLATES/analyzeToolSequence` 已 export |
| 4.2 ContextManager 增強 — workflowId 維度 | ✅ | `capture()` 新增 `workflowId` 參數 + `getWorkflowHistory()` 過濾方法 |
| 4.3 src/cli/workflow.mjs — CLI 實作 | ✅ | 4 commands: create/report/replan/summary + list-templates |
| 4.4 src/plugins/standard/workflow.mjs — MCP plugin | ✅ | `smart_workflow` 工具，4 commands via smart_run router |
| 4.5 5 built-in templates | ✅ | debug-flow / refactor-flow / security-flow / research-flow / default-flow |
| 4.6 平行提示 | ✅ | `computeParallelHints()` 依 dependsOn 自動分群 |
| 4.7 測試 | ✅ | 9 tests pass: create/report/fail/replan/summary/parallel/context/list/lifecycle |
| 4.8 回歸測試 | ✅ | 36 既有 tests 全部 pass，0 regression |
| **工具總數** | **30 (6 core + 24 standard)** | workflow.mjs 加入 standard, 從 26 增至 30 |

**使用流程驗證**：
```
1. node workflow.mjs create "debug login error" --template debug-flow --state wf.json
   → 5 steps: [memory_search, grep, error_diagnose, cross_file_edit, test]
   → Parallel: [0,1] → [2,3] → [4] → [5]

2. node workflow.mjs report --state wf.json --step 0 --status ok --result "..." --duration 200
   → Workflow 前進

3. node workflow.mjs report --state wf.json --step 1 --status fail --error "Grep timed out"
   → onFailure=skip → 自動跳過，繼續

4. node workflow.mjs replan --state wf.json --context "new context"
   → 呼叫 planner 重新規劃剩餘步驟

5. node workflow.mjs summary --state wf.json --json
   → 完整工作流報告：狀態/步驟/findings/toolStats
```

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

### Phase 4: Workflow 引擎（P1）— Plan-Based Orchestration

**動機**：2026-05 月 Claude Code 推出 Dynamic Workflows（JS script + runtime + multi-agent orchestration）。但 Smart MCP 是 MCP server，無法直接 spawn agent / 管理 worktree / 控制 agent loop——這些是 host（opencode）的責任。Smart MCP 的 workflow 策略應改為 **plan-based orchestration**：產生 JSON plan 讓 opencode 執行，MCP 端管理 state/context/replan，26 工具提供執行能力。

```
┌─ opencode ───────┐   ┌─ Smart MCP (MCP protocol) ────────┐
│  agent loop      │←──│  smart_workflow_create → JSON plan  │
│  Task spawn      │   │  smart_workflow_report → context     │
│  決定順序/並行    │   │  smart_workflow_replan → 新計畫    │
│  管理 worktree   │   │  smart_workflow_summary → 報告     │
└──────────────────┘   └────────────────────────────────────┘
   執行步驟                 動態規劃 + 狀態管理
   spawn subagent           追蹤累積 findings
   呼叫 26 工具             記憶過往經驗
```

**與 Claude Code Dynamic Workflows 的核心差異**：

| 面向 | Claude Code | opencode + Smart MCP |
|------|-------------|---------------------|
| 計畫載體 | JS script（Claude 即席撰寫） | JSON plan（planner 動態生成） |
| 執行者 | Workflow Runtime spawn subagents | opencode agent/subagent |
| Context 管理 | script 變數（conversation 之外） | ContextManager 自動注入/捕獲/持久化 |
| 工具調用 | 基礎 4 工具（Read/Write/Bash/Grep） | 26 專業工具（security/thinking/test...） |
| 記憶 | 無（每次新 script） | memory-store 跨 session 累積 |
| 驗證機制 | Adversarial verification agent | planner onFailure + report-based |

**具體實作**：

1. `src/plugins/standard/workflow.mjs` — 4 個新 MCP tool：
   - `smart_workflow_create` — 動態產生執行計畫（整合 planner + thinking + context + memory）
   - `smart_workflow_report` — 回報步驟結果，更新 context，觸發 replan
   - `smart_workflow_replan` — 步驟失敗時動態重新規劃剩餘步驟
   - `smart_workflow_summary` — 工作流最終報告（含 findings/memory/toolStats）

2. `src/cli/workflow.mjs` — CLI 實作（workflow lifecycle management）

3. ContextManager 強化 — 支援 workflowId 維度查詢

4. planner 強化 — 支援 workflow template + parallel hint 輸出

**內建 workflow templates**：
- `debug-flow` — memory_search → grep → error_diagnose → cross_file_edit → test
- `refactor-flow` — import_graph → naming → rename_safety → cross_file_edit → test
- `security-flow` — security_scan → grep(高風險pattern) → cross_file_edit → test
- `research-flow` — exa_search → thinking(synthesize) → report

**使用流程**：
```
1. user: 找出並修復安全漏洞
2. opencode → smart_workflow_create(goal)
   ← JSON plan: [security_scan, grep, thinking, cross_file_edit, test]
3. opencode 執行 Step 1 → smart_workflow_report
4. 失敗 → smart_workflow_replan → 新 plan
5. 完成 → smart_workflow_summary → 報告
```

**已具備的前置條件**（不需重寫）：
- ✅ planner.mjs — 1387 行，plan generation + condition + DAG + replan
- ✅ context-manager.mjs — 363 行，context 注入/捕獲/持久化
- ✅ invokeTool/captureAndReturn — 自動 context 記錄
- ✅ 9 任務模板 + 條件分支
- ✅ 26 CLI tools

### Phase 5: Workflow 引擎強化（P0 — 實際執行能力）

**對應分析**：plan.md 四-4.3/4.4（Workflow 能做到 vs 不能做到）
**目標**：讓 workflow 能真正執行工具，而非只管理 state。

**動機**：目前 workflow.mjs 是 state tracker + report generator，實際工具執行靠 opencode agent 手動 dispatch。這不是真正的 workflow engine。

**具體實作**：

1. **Workflow Engine 加入 dispatch 層**
   - `workflow.mjs` 新增 `dispatch` 指令：接收 workflowId → 自動 call invokeTool()
   - 支援 `parallel(group)` dispatch：同時 spawn 多個獨立工具
   - 解決 `spawnSync` 阻塞問題：先用 sequential 模式驗證，平行執行留待 Phase 5.2

2. **Workflow 產出可直接執行的 JSON**
   - `create` 指令輸出格式強化：含完整 tool args + timeout + onFailure
   - opencode agent 可直接 iterate 執行，不需再 parse 描述文字

3. **Workflow context 聚合**
   - ContextManager 新增 `getWorkflowCost(workflowId)`：回傳該 workflow 的總 token/時間/錯誤率
   - `smart_context` 新增 `workflow-stats` 指令

**驗收標準**：
- [x] `workflow dispatch --id <wfId>` 自動執行第一步工具 ✅
- [x] `workflow dispatch --id <wfId> --parallel` 同時執行獨立步驟 ✅
- [x] `smart_context workflow-stats --id <wfId>` 回傳成本數據 ✅

### Phase 6: Compose 原語 + 平行執行基礎（P1 — 工具組合）✅

**對應分析**：plan.md 三-3.4（無工具組合原語、CLI spawn 阻塞）
**目標**：提供 compose/pipe/parallel 三種工具組合原語。
**狀態**：✅ 已完成（2026-06-04）

**具體實作**：

1. **Compose 原語定義**
   ```
   // 順序執行（pipe）：A 的輸出餵給 B
   pipe(smart_grep({pattern: "error"}), smart_error_diagnose())

   // 平行執行：A 和 B 同時跑
   parallel(smart_security({scan: "creds"}), smart_security({scan: "injection"}))

   // 條件執行：根據結果決定走哪條路
   cond(condition, thenTool, elseTool)
   ```

2. **`smart_compose` MCP tool**（or 強化 smart_run）
   - 輸入：`{ pipeline: [{ tool, args, mode: "seq"|"par"|"cond" }] }`
   - `mode: "par"` 時，使用 Promise.all + 非阻塞 spawn（child_process.spawn async）
   - `mode: "cond"` 時，檢查前一步結果的關鍵字決定分支

3. **CLI spawn 非阻塞改造**
   - 從 `spawnSync` 改為 `spawn` + Promise wrapper ✅
   - 保留 timeout 控制（AbortController）✅
   - 相容既有工具，不修改 signature ✅

**驗收標準**：
- [x] `smart_compose({ pipeline: [...] })` 正確執行多工具流程 ✅
- [x] `mode: "par"` 平行執行比依序快（2 個 500ms 工具約 500ms 而非 1000ms）✅
- [x] `mode: "cond"` 根據條件正確分支 ✅

### Phase 7: Memory 升級（P1 — 語意記憶 + 模式歸納）

**對應分析**：plan.md 三-3.4（Memory 僅 resolution）
**目標**：從 fuzzy string match 升級到語意搜尋 + 跨 session pattern 歸納。

**具體實作**：

1. **Vector search 層**
   - 使用 sentence embedding（`@xenova/transformers` 或 local ONNX model）
   - 對每個 resolution 產生 embedding vector
   - 搜尋時比對語意相似度而非 Levenshtein distance
   - 降級策略：vector search 失敗 → fallback 到 fuzzy match

2. **Pattern abstraction**
   - `tool-stats` `patterns` 指令增強：不只是 combo 分析
   - 自動歸納「失敗模式 cluster」：相同工具 + 相同 error type 多次失敗
   - 輸出 pattern report：「smart_grep 在 large 專案 timeout 率 40%，建議加 root 限制」

3. **Cross-session context 合併**
   - ContextManager 新增 `mergeSessions(sessionIds[])`：合併多 session 的 findings
   - `smart_context` 新增 `merge` 指令

**驗收標準**：
- [ ] 語意相似錯誤（"file not found" vs "cannot locate file"）可匹配
- [ ] tool-stats patterns 輸出 pattern cluster 報告
- [ ] cross-session merge 正確合併 findings

### Phase 8: 程式碼生成輔助（P2）

**目標**：分析問題後不僅報告，還能自動產出修復 patch。

**具體實作**：
1. `src/plugins/standard/patch-gen.mjs` — 根據分析結果生成 edit 指令
2. 整合 error-diagnose → patch-gen → cross-file-edit 流程
3. 安全閘門：重大修改需人批准（patch preview）

### Phase 9: 語言助手擴充（P3）

**目標**：支援更多程式語言的專屬分析。

**具體實作**：
1. `src/plugins/standard/rs-helper.mjs` — Rust（cargo check, clippy）
2. `src/plugins/standard/go-helper.mjs` — Go（go vet, golangci-lint）
3. 自動語言偵測 dispatch

### Phase 10: 程式碼語義推理基礎工具鏈（P0 — 確定性層建立）

**對應分析**：plan.md 三-3.5（程式碼語義推理深度不足）
**目標**：建立多層混合智能架構的第一層 — 確定性程式碼分析工具鏈。這 4 工具是後續 CKG/Hybrid Router/Change-Impact 的基礎。
**狀態**：🆕 新增（2026-06-04），第一週衝刺優先 🏃

**為何是 P0**：Phase 1-6 完成後，smart-mcp 與 Claude Code 的最大差距在於**程式碼推理深度**。Claude Code 的程式碼理解來自 LLM 內建能力，smart-mcp 的策略是用**確定性工具（LSP/Tree-sitter）取代 LLM 猜測**。這是架構級優勢 — 確定性工具永不 hallucinate。

#### 10.1 LSP bridge — 統一接入層

`src/lib/lsp-bridge.mjs` — 封裝所有 LSP 通訊的共用層。

```
┌──────────────────────────────────────────┐
│                LSP bridge                 │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │ TS LSP      │  │ Python LSP       │ ←→ │
│  │ (tsserver)  │  │ (pylsp)          │    │
│  ├─────────────┤  ├──────────────────┤   │
│  │ swift-lsp   │  │ php-lsp          │ ←→ │
│  └─────────────┘  └──────────────────┘   │
│                                           │
│  Method: initialize / open / close /      │
│          definition / references / hover   │
│           / documentSymbol / completion    │
│  Protocol: JSON-RPC 2.0 over stdio        │
│  Lifecycle: lazy-init, auto-reconnect     │
└───────────────────────────────────────────┘
```

**技術選擇**：
- 直接 spawn LSP process + stdio，不用 `vscode-languageserver-node`（減輕 10x）
- 先支援 TypeScript（typescript-language-server）+ Python（pylsp）
- 生命週期管理：lazy-init（首次工具呼叫時啟動）、auto-reconnect（crash 時重啟）
- 使用 `better-sqlite3` 快取 LSP 響應（避免重複 query）

**API**：
```js
class LspBridge {
  constructor(root)              // 初始化，不立即啟動 LSP
  async ensureOpen()             // lazy-start LSP process
  async getSymbols(file)         // documentSymbol → [{name, kind, range}]
  async getDefinition(file, pos) // definition → {file, range}
  async getReferences(file, pos) // references → [{file, range}]
  async getHover(file, pos)      // hover → {contents, range}
  async close()                  // 優雅關閉 LSP
  get isReady()                  // LSP 是否可用
}
```

#### 10.2 smart_code_ast — AST 結構查詢

`src/plugins/standard/code-ast.mjs` → `smart_code_ast`

**職責**：給定檔案和符號，回傳結構定義位置。取代「LLM 猜測函式/類別定義在哪」。

**參數**：
```js
{
  file: "src/foo.ts",        // required: 目標檔案
  symbol: "foo",             // optional: 指定符號
  kind: "function"|"class"|"interface"|"type"|"variable",  // optional: 過濾類型
  recursive: true|false      // optional: 是否遞迴回傳子節點
}
```

**輸出**：
```js
{
  file: "src/foo.ts",
  symbols: [
    { name: "foo", kind: "function", line: 10, col: 0,
      signature: "export function foo(a: A): B",
      range: { start: {line:10,col:0}, end: {line:25,col:1} },
      children: [...] },  // 遞迴模式下
    ...
  ]
}
```

**實作策略**：
1. 先用 LSP `textDocument/documentSymbol` 實現（24h 內可完成）
2. 再換 Tree-sitter（`web-tree-sitter` WASM）提供完整 AST
3. Tree-sitter 優點：離線、快速、不依賴 LSP server

#### 10.3 smart_code_call_graph — 呼叫鏈追蹤

`src/plugins/standard/code-call-graph.mjs` → `smart_code_call_graph`

**職責**：給定函式，回傳完整 caller/callee 鏈。取代「人工 grep 追蹤誰呼叫了誰」。

**參數**：
```js
{
  file: "src/foo.ts",
  symbol: "foo",
  direction: "callers"|"callees",  // 朝上或朝下追蹤
  depth: 1|2|3                     // 鏈深度（預設 1）
}
```

**輸出**：
```js
{
  root: { file: "src/foo.ts", symbol: "foo", line: 10 },
  callers: [
    { file: "src/bar.ts", symbol: "bar", line: 42,
      callers: [ ... ] },  // depth=2 遞迴
    ...
  ],
  callees: [ ... ]
}
```

#### 10.4 smart_code_type_infer — 型別推導

`src/plugins/standard/code-type-infer.mjs` → `smart_code_type_infer`

**職責**：給定檔案 + 位置，回傳型別資訊。使用 LSP `textDocument/hover`。

**參數**：`{ file, line, col }`
**輸出**：`{ type: "Array<string>", definition: "src/types.ts:42", documentation: "..." }`

#### 10.5 smart_code_impact — 影響半徑分析

`src/plugins/standard/code-impact.mjs` → `smart_code_impact`

**職責**：給定 diff 或檔案列表，分析改動會影響哪些下游模組。

**參數**：
```js
{
  diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -10,5 +10,7 @@\n...",  // git diff
  files: ["src/foo.ts"],   // 或直接指定檔案
  depth: 1|2|3             // 影響遞迴深度
}
```

**輸出**：
```js
{
  direct: [ { file: "src/bar.ts", symbols: ["baz"], reason: "calls foo" } ],
  transitive: [ { file: "src/qux.ts", ... } ],  // depth > 1
  totalFiles: 5,
  totalSymbols: 12,
  confidence: "high"|"medium"|"low"  // 基於確定性 vs 推測
}
```

#### 10.6 第一週衝刺計畫

| Day | 交付 | 工具 |
|-----|------|------|
| 1-2 | `lsp-bridge.mjs` — spawn LSP + lifecycle + lazy-init | TS LSP |
| 2-3 | `smart_code_ast` — documentSymbol + hover | LSP bridge |
| 3-4 | `smart_code_call_graph` — references → graph | LSP bridge |
| 4-5 | `smart_code_type_infer` — hover type query | LSP bridge |
| 5-7 | `smart_code_impact` — diff → AST → impact | LSP bridge |
| 7 | 4 工具註冊為 MCP tools + plugin loader | MCP |

**不做（第一週）**：
- ❌ Tree-sitter 整合（第二週再換）
- ❌ 多語言支援（只做 TypeScript）
- ❌ CKG（Phase 11）
- ❌ Hybrid Router（Phase 12）

**驗收標準**：
- [ ] `smart_code_ast({file: "src/foo.ts"})` 回傳正確的 symbols + signatures ✅
- [ ] `smart_code_call_graph({file, symbol, depth:2})` 回傳跨檔案呼叫鏈 ✅
- [ ] `smart_code_type_infer({file, line, col})` 回正確型別 ✅
- [ ] `smart_code_impact({files: ["src/foo.ts"], depth:2})` 回影響檔案列表 ✅
- [ ] 4 工具全部註冊為 MCP tool，可在 opencode agent 中呼叫 ✅

---

### Phase 11: Code Knowledge Graph（P0 — 殺手級能力）

**對應分析**：plan.md 三-3.5
**目標**：建立持久化的專案級程式碼知識圖譜。這是 Claude Code 架構上永遠做不到的能力。
**前置**：Phase 10 工具鏈完成

#### 11.1 架構

```
CKG 儲存層：
  ┌─ SQLite ─────────────────────────────┐
  │  nodes: (id, name, kind, file, range) │  ← function/class/module/file
  │  edges: (from, to, kind)              │  ← calls/imports/extends/implements
  │  facts: (node_id, key, value, version)│  ← signature / type / metrics
  └────────────────────────────────────────┘
  ┌─ JSON cache ──────────────────────────┐
  │  熱節點快取（最近 1000 次查詢）         │
  └────────────────────────────────────────┘
```

**節點類型**：
- `file` — 檔案節點（路徑、語言、大小、最後修改時間）
- `function` — 函式節點（name, signature, line, exported）
- `class` — 類別節點（name, extends[], implements[]）
- `interface` — 介面節點
- `type` — 型別別名節點
- `variable` — 變數節點（module-level）

**邊類型**：
- `calls` — A 呼叫 B（含呼叫位置）
- `imports` — A import B（含 import type）
- `extends` — A 繼承 B
- `implements` — A 實作 B
- `defines` — 檔案定義該符號
- `parameterOf` — A 是 B 的參數型別
- `returnTypeOf` — A 是 B 的回傳型別

#### 11.2 增量更新

- **首次建立**：全量掃描專案檔案，透過 Phase 10 工具產生 CKG 節點
- **增量更新**：watch mode（`chokidar` + debounce）監聽檔案變更
  - 檔案修改 → `smart_code_ast` 重新分析單檔 → 更新對應節點 + 邊
  - 檔案新增 → 新增節點 + 找到 import 邊
  - 檔案刪除 → 標記節點失效（不刪除，保留歷史）
- **git hook**：`post-commit` / `post-checkout` 觸發增量更新

#### 11.3 查詢介面

`src/plugins/standard/code-query.mjs` → `smart_code_query`

```js
// 查詢誰呼叫了某函式
smart_code_query({
  query: "callers",
  symbol: "foo",
  file: "src/foo.ts",
  depth: 2
})

// 查詢所有函式的複雜度指標
smart_code_query({
  query: "metrics",
  kind: "function",
  minComplexity: 10
})

// 查詢未使用的導出
smart_code_query({
  query: "unused-exports"
})

// 查詢模組之間的依賴結構
smart_code_query({
  query: "dependencies",
  file: "src/foo.ts"
})
```

#### 11.4 失效機制

- signature 變更 → 該 function 節點的所有 caller edges 標記「需驗證」
- 檔案刪除 → 節點標記 `stale: true`，保留 30 天
- 大型重構（git reset / rebase）→ 觸發部份重建

**驗收標準**：
- [ ] 1000 檔案專案 CKG 建立 < 30 秒
- [ ] 增量更新單檔 < 100ms
- [ ] `smart_code_query({query: "callers", symbol: "foo"})` 回傳正確呼叫者
- [ ] 檔案修改後 1 秒內 CKG 自動更新
- [ ] 跨 session 查詢同一資訊不需重掃

---

### Phase 12: Hybrid Reasoning Engine（P0 — 分層效率）

**目標**：建立 Task Classifier，根據問題類型自動路由到最適合的分析層（確定性 / LLM / 混合）。
**前置**：Phase 10 工具鏈 + Phase 11 CKG 完成

#### 12.1 Task Classifier

```
問題 → [Task Classifier]
         │
         ├── 結構查詢 > 90% → 確定性層（CKG / AST tools）
         │   「這個函式被誰呼叫？」→ smart_code_call_graph
         │   「這是什麼型別？」   → smart_code_type_infer
         │
         ├── 語義分析 > 70% → LLM + CKG context
         │   「這段程式碼在做什麼？」→ LLM with CKG context
         │   「這個演算法的複雜度？」→ LLM with AST context
         │
         ├── 變更影響 > 80% → Change-Impact Pipeline
         │   「改這個會影響誰？」→ smart_code_impact
         │
         └── 不確定 → 混合路徑（合併輸出）
             「這個重構安全嗎？」→ 確定性 impact + LLM review
```

**Rule-based classifier**（第一版）：
- 關鍵字比對問題類型（callers/callees → 結構、複雜度/演算法 → 語義、影響/影響 → 變更）
- confidence score + threshold
- 低於 threshold → 走混合路徑

#### 12.2 輸出合併引擎

確定性 + LLM 結果結構化合併：

```js
{
  answer: "foo() 被 3 個檔案呼叫（bar.ts:42, baz.ts:10, qux.ts:7）",
  sources: [
    { type: "deterministic", tool: "code_call_graph", confidence: 1.0 },
    { type: "llm", model: "claude-3.5", confidence: 0.85,
      note: "LLM 補充：呼叫模式為事件監聽器註冊" }
  ],
  confidence: 0.95,
  metadata: { latency: "12ms", tools: ["code_call_graph"] }
}
```

**驗收標準**：
- [ ] Task Classifier 準確率 > 90%（100 題測試集）
- [ ] 確定性路徑延遲 < 50ms
- [ ] 不確定時雙路徑合併無衝突
- [ ] 輸出格式結構化，可追溯來源

---

### Phase 13: Change-Impact Pipeline（P1 — 精確變更分析）

**目標**：建立 git diff → AST diff → 影響傳播 → 測試預測的完整 pipeline。
**前置**：Phase 10 + Phase 11 + Phase 12 完成

#### 13.1 流程

```
git diff → [AST Diff Engine] → 影響符號列表
    ↓                                  ↓
[Change-Impact Algorithm]    [Test Prediction Engine]
    ↓                                  ↓
受影響檔案 + 函式            需要更新的測試案例
    ↓
[Workflow Integration]
   → 自動產生 impact-flow 模板
   → planner 使用 impact context
```

#### 13.2 影響傳播演算法

1. 解析 diff → 找出新增/修改/刪除的符號（function/class/interface）
2. 查詢 CKG 找出這些符號的直接使用者和間接使用者
3. 標記影響：direct (depth=1) / transitive (depth=2+) / possible (動態語言)
4. 輸出影響清單 + 信心分數

**關鍵決策**：動態語言（JS/TS）採用 over-approximation（寧可多報不能漏報）。靜態語言（Rust/Go）可用精確分析。

#### 13.3 Workflow 整合

```
refactor-safe-flow:
  step 1: smart_code_impact({files: ["src/foo.ts"]})
  step 2: smart_code_call_graph({...})  // 確認影響範圍
  step 3: LLM review impact summary
  step 4: safe-edit (cross_file_edit with safety constraints)
  step 5: verify (test run)
```

**驗收標準**：
- [ ] AST diff 正確識別變更符號 > 95%
- [ ] Impact 傳播在 1000 檔案專案 < 200ms
- [ ] 重構 workflow 能主動警示「此修改影響 X 個下游模組」

---

### Phase 14: Multi-Model Orchestration（P2 — 成本效率）

**目標**：根據問題類型、複雜度、即時需求動態選擇處理模型/工具，最佳化成本與延遲。
**前置**：Phase 10-13 完成

#### 14.1 模型路由

```
[Task Classifier] → 任務分級
  ├── Tier 1（結構查詢）→ 確定性工具（成本 $0）
  ├── Tier 2（簡單語義）→ 本地小模型（成本 $0.001）
  ├── Tier 3（複雜語義）→ 中型模型 API（成本 $0.01）  
  └── Tier 4（重構/生成）→ 最強模型 API（成本 $0.05）
```

#### 14.2 實作

- `src/lib/model-router.mjs` — 模型路由核心
- 支援 plugin 式模型提供者（API / 本地 / 確定性）
- 成本追蹤 + 延遲監控
- 自動降級策略（API 不可用 → 本地模型 → 確定性工具）

**驗收標準**：
- [ ] 整體 API 成本降低 60%+（相較全走 LLM）
- [ ] 平均延遲改善 70%+（簡單問題走確定性層）
- [ ] 降級路徑正確觸發

---

#### Phase 10-14 完成後架構總覽

```
src/server/index.mjs
  ├── plugins/core/ (6 原生)
  │
  ├── plugins/standard/ (36+ router)
  │   ├── code-ast.mjs         → smart_code_ast         ← Phase 10
  │   ├── code-call-graph.mjs  → smart_code_call_graph  ← Phase 10
  │   ├── code-type-infer.mjs  → smart_code_type_infer  ← Phase 10
  │   ├── code-impact.mjs      → smart_code_impact      ← Phase 10
  │   ├── code-query.mjs       → smart_code_query       ← Phase 11 (CKG)
  │   ├── hybrid-router.mjs    → smart_code_router      ← Phase 12
  │   ├── impact-flow.mjs      → smart_impact_flow      ← Phase 13
  │   ├── model-router.mjs     → smart_model_router     ← Phase 14
  │   └── ... (既有工具)
  │
  ├── lib/
  │   ├── lsp-bridge.mjs       ← Phase 10
  │   ├── ckg-engine.mjs       ← Phase 11
  │   ├── hybrid-engine.mjs    ← Phase 12
  │   ├── impact-engine.mjs    ← Phase 13
  │   └── model-router.mjs     ← Phase 14
  │
  └── data/
      └── ckg/                 ← CKG SQLite database
```

---

## 六、架構演進

### 當前 v3.3.1（Phase 0-6 + Agent Phase D + Compose Engine 完成）

```
src/server/index.mjs
  ├── plugins/core/ (6 原生 — 全部 handler-based)
  │   ├── grep.mjs         → smart_grep
  │   ├── learn.mjs        → smart_learn
  │   ├── quick-think.mjs  → smart_think
  │   ├── security.mjs     → smart_security
  │   ├── test.mjs         → smart_test
  │   └── thinking.mjs     → smart_thinking
  │
  ├── plugins/standard/ (24 router)
  │   ├── agent-execute.mjs   → smart_agent_execute   ← Phase D
  │   ├── agent-plan.mjs      → smart_agent_plan       ← Phase D
  │   ├── agent-recommend.mjs → smart_agent_recommend  ← Phase D
  │   ├── workflow.mjs     → smart_workflow            ← Phase 4/5
  │   ├── compose.mjs      → smart_compose             ← Phase 6
  │   ├── planner.mjs      → smart_planner             ← Phase 2
  │   └── ... (18 既有工具)
  │
  ├── cli/                 (24 CLI 實作 — 全部非阻塞)
  └── lib/
      ├── utils.mjs
      ├── context-manager.mjs     ← Phase 3
      └── compose-engine.mjs      ← Phase 6
```

### 目標 v4.0

```
src/server/index.mjs
  ├── plugins/core/ (6 原生 — 全部 handler-based)
  │   ├── ... (smart_grep, smart_learn, smart_think, smart_security, smart_test, smart_thinking)
  │
  ├── plugins/standard/ (30+ router)
  │   ├── agent-recommend.mjs → smart_agent_recommend ← Agent Phase
  │   ├── agent-execute.mjs   → smart_agent_execute   ← Agent Phase
  │   ├── agent-plan.mjs      → smart_agent_plan      ← Agent Phase
  │   ├── workflow.mjs     → smart_workflow       ← Phase 5 (dispatch)
  │   ├── compose.mjs      → smart_compose        ← Phase 6
  │   ├── memory_store.mjs → smart_memory_store   ← Phase 7 升級 (vector)
  │   ├── patch-gen.mjs    → smart_patch_gen       ← Phase 8 新增
  │   ├── rs-helper.mjs    → smart_rs_helper       ← Phase 9 新增
  │   ├── go-helper.mjs    → smart_go_helper       → Phase 9 新增
  │   └── ... (既有 27 工具)
  │
  ├── config/agents/
  │   └── smart-mcp.md     ← Agent personality 定義
  │
  ├── cli/                 (全部 handler 化，無 spawnSync)
  └── lib/
      ├── utils.mjs
      ├── context-manager.mjs
      └── compose-engine.mjs                    ← Phase 6

#### v3.3.1 → v4.0 關鍵轉變

| 面向 | v3.3.1 (當前) | v4.0 (目標) |
|------|--------------|-------------|
| 推理工具架構 | 6 handler + 24 CLI 非阻塞 | 全部 handler (in-process) |
| 輸出內容 | 真實推理 + 工具鏈計畫 | 真實推理 + action 指令 |
| Workflow 策略 | ✅ dispatch + compose (Phase 5/6) | dispatch + 自動 replan |
| 工具組合原語 | ✅ compose/pipe/parallel (Phase 6) | ✅ 強化 |
| 工具數量 | 36 (6 core + 27 standard + 3 agent) | 42+ (含 code-ast/code-call-graph 等 Phase 10) |
| Agent 人格定義 | ✅ smart-mcp.md (220 行) | ✅ 持續強化 |
| 小模型兜底 | ✅ 3 個 agent MCP tools | ✅ 持續強化 |
| Memory 搜尋 | Fuzzy string match | Vector semantic search + code-fact |
| Context 傳遞 | ✅ ContextManager 自動 | ✅+ workflow 維度聚合 |
| 程式碼推理 | ❌ 無原生 AST/call-graph | ✅ LSP-based semantic analysis (Phase 10) |
| 影響半徑分析 | ❌ 無 | ✅ smart_code_impact + call-graph |

---

## 七、成功指標

| 指標 | 當前 v3.3.1 | 目標 v4.0 (2026 Q3) | 衡量方式 |
|------|------------|---------------------|---------|
| 推理工具延遲 | <1ms (handler) ✅ | <1ms | smart_think 呼叫時間 |
| 可取代 sequential-thinking | ✅ 已取代 | ✅ | agent 預設使用 smart_think |
| 工具一次呼叫成功率 | ~85% | >95% | tool-stats report |
| 相同錯誤重複發生率 | ~15% (fuzzy match) | <10% (vector search) | memory 命中率 |
| 複雜任務(5+工具)完成率 | ~75% | >85% | workflow_summary 追蹤 |
| 跨工具 context 傳遞 | ✅ 自動 | ✅+ workflow 聚合 | context layer |
| 動態多輪推理 | ✅ state+branch | ✅ | thinking --dynamic 完成度 |
| **自動規劃 replan** | ✅ 已完成 | ✅ | planner replan 引擎 |
| **Workflow 實際執行** | ✅ dispatch 引擎 (Phase 5) | ✅ 強化 | workflow dispatch 命令 |
| **工具組合原語** | ✅ compose/pipe/parallel (Phase 6) | ✅ 強化 | smart_compose 工具 |
| **CLI 非阻塞** | ✅ 全部 async spawn (Phase 6) | ✅ 全部 handler | 無 spawnSync 殘留 |
| **Memory 搜尋** | fuzzy string match | vector semantic search + code-fact | 語意匹配成功率 |
| **Workflow 範本數** | 5 | 8+ (含 compose/parallel) | workflow_template_list |
| **程式碼語義推理** | ❌ 無原生 AST/call-graph | ✅ smart_code_* 工具套件 (Phase 10) | 重構任務完成率 |
| **影響半徑分析** | ❌ 無法 | ✅ 100ms / 1000 檔案 | smart_code_impact 延遲 |
| **增量 diff 感知** | ❌ 無 | ⚠️ 部分 (需額外實作) | diff-aware workflow |
| **CKG 建立時間** | ❌ 無 | ✅ 1000 檔案 < 30 秒 (Phase 11) | sqlite query |
| **CKG 增量更新** | ❌ 無 | ✅ 單檔更新 < 100ms (Phase 11) | watch mode 測試 |
| **Hybrid Router 準確率** | ❌ 無 | ✅ > 90% (Phase 12) | 100 題分類測試集 |
| **Change-Impact 精確率** | ❌ 無 | ✅ > 95% (Phase 13) | 測試專案比對 |
| **多模型成本節省** | ❌ 單一模型 | ✅ 成本降低 60%+ (Phase 14) | API 帳單比較 |
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
| `smart_workflow` | standard/workflow.mjs | workflow.mjs | 多工具工作流編排 (create/report/replan/summary) |
| `smart_agent_recommend` | standard/agent-recommend.mjs | handler-based, no CLI | 工具推薦引擎 (12 種任務, 小模型兜底) |
| `smart_agent_execute` | standard/agent-execute.mjs | handler-based, no CLI | 工作流自動化計畫 (6 模板) |
| `smart_agent_plan` | standard/agent-plan.mjs | handler-based, no CLI | 複雜目標分解 (DAG + 風險分析) |
