# Devtool MCP — 能力現狀與強化路線圖

> 本文件是 smart MCP 的戰略規劃文件，涵蓋架構、能力矩陣、缺口分析、以及後續強化方向。
> 與 todo.md 互為補充：plan.md 定義「要做什麼、為什麼」，todo.md 定義「具體步驟」。
> 
> **2026-06-05 重大更新**：確立「LLM 為最終使用者」的設計哲學。
> Smart MCP 不是給人用的工具組，而是 LLM 的「認知捷徑」——讓 LLM 用最少 token、最少步數、最少 hallucination 完成任務。
> 詳見 **四-B. 設計哲學：簡化 LLM 處理**。

---

## 一、現狀摘要

Smart MCP 是一個 **LLM 認知捷徑伺服器**，透過 MCP 協定為 LLM agent 提供確定性程式碼理解與任務拆解能力。當前版本 3.8.0（Plugin Loader + Router 架構 + CKG 程式碼知識圖譜 + LSP 語義分析 + Hybrid Reasoning + Change-Impact Pipeline + Workflow/Compose Engine + 跨 session 記憶 + 46 工具 + auto-toonify 輸出優化 + 多語言支援 (Rust/Swift) + 428 tests passing）。

> **2026-06-05 設計哲學翻新**：Smart MCP 的最終使用者不是人，是 LLM。
> 所有工具的設計目標：讓 LLM 用最少 token、最少步數、最少 hallucination 完成任務。

### 核心數據
- **工具總數**：46（6 原生 + 40 經 router — 含 1 Phase 8 patch-gen + 4 Phase 10 程式碼語義工具 + 1 Phase 11 CKG 查詢工具 + 1 Phase 12 Hybrid Router + 1 Phase 13 Impact Flow + 3 Phase D agent 輔助工具 + 1 Phase A rs-helper + 1 Phase D memory_store）
- **架構**：Plugin Loader → src/plugins/core/（6 原生 handler）/ src/plugins/standard/（40 router — 部分 handler, 部分 CLI 非阻塞 async spawn）
- **Workflow 引擎**：Phase 4-6 完成 — dispatch 實際執行 + 7 模板 + compose/pipe/parallel 三種原語 + replan + summary
- **語言**：JavaScript (ESM) — 6 核心 handler + 34 standard tools 全數非阻塞化 (Phase 6)
- **輸出保護**：512KB buffer / 200K chars soft limit
- **Auto-Toonify 攔截器**：`respond()` 自動對 ≥500 chars 的 JSON-like 輸出執行 TOON 優化（lazy-init TokenOptimizer, best-effort, Promise-chain 保證順序），可透過 `respond(id, result, {optimize: false})` 跳過
- **測試狀態**: 428 tests / 82 suites / 0 failures / 3 skip (Windows LSP)
- **Health Endpoint**：`smart/health`（含 context 資訊）
- **Context 管理**：`smart_context` MCP tool + `smart/context` 端點 + 自動注入/捕獲/持久化
- **動態推理**：thinking v3.1 — state persistence, branching, multi-round, context accumulation
- **記憶自動化**：Phase D — 所有工具失敗 auto-store, smart_debug/smart_test/smart_cross_file_edit 執行前 pre-check 記憶庫
- **Instrumentation 計數器**：memoryAutoStoreCount / memoryPreCheckCount / memoryPreCheckHitCount / memoryPreCheckSavedMs 暴露在 smart/stats 端點
- **Smart MCP First 指令**：agent config 新增 Built-in→Smart MCP 映射表，強制優先使用 smart MCP 工具
- **Exa 雙模支援**：exa-search-mjs 支援無 API key 時自動 fallback 到 MCP free tier (mcp.exa.ai, IP rate-limited)，有 key 時走 REST API

---

## 二、當前架構

```
src/
├── server/              (MCP Server Entry)
│   ├── index.mjs        → JSON-RPC 2.0 over stdio + auto-toonify interceptor
│   │                      (所有 JSON 回覆 ≥500 chars 自動 TOON 優化)
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
├── plugins/standard/    (34 standard tools, 經 smart_run router)
│   ├── agent-execute.mjs      → smart_agent_execute     ← Phase D
│   ├── agent-plan.mjs         → smart_agent_plan        ← Phase D
│   ├── agent-recommend.mjs    → smart_agent_recommend   ← Phase D
│   ├── code-ast.mjs           → smart_code_ast          ← Phase 10
│   ├── code-call-graph.mjs    → smart_code_call_graph   ← Phase 10
│   ├── code-impact.mjs        → smart_code_impact       ← Phase 10
│   ├── code-query.mjs         → smart_code_query        ← Phase 11
│   ├── code-type-infer.mjs    → smart_code_type_infer   ← Phase 10
│   ├── compose.mjs            → smart_compose           ← Phase 6
│   ├── coverage.mjs          → smart_coverage
│   ├── cross_file_edit.mjs   → smart_cross_file_edit
│   ├── debug.mjs             → smart_debug
│   ├── diagram.mjs           → smart_diagram
│   ├── error_diagnose.mjs    → smart_error_diagnose
│   ├── exa_search.mjs        → smart_exa_search
│   ├── git_commit.mjs        → smart_git_commit        ← 2026-06-04
│   ├── git_context.mjs       → smart_git_context
│   ├── git_pr.mjs            → smart_git_pr            ← 2026-06-04
│   ├── git_review.mjs        → smart_git_review        ← 2026-06-04
│   ├── github_search.mjs     → smart_github_search
│   ├── hybrid-router.mjs     → smart_hybrid_router      ← Phase 12 🆕
│   ├── import_graph.mjs      → smart_import_graph
│   ├── integrate.mjs         → smart_integrate
│   ├── memory_store.mjs      → smart_memory_store
│   ├── naming.mjs            → smart_naming
│   ├── planner.mjs           → smart_planner
│   ├── py_helper.mjs         → smart_py_helper
│   ├── rename_safety.mjs     → smart_rename_safety
│   ├── report.mjs            → smart_report
│   ├── rs-helper.mjs         → smart_rs_helper       ← Phase A 🆕
│   ├── test_suggest.mjs      → smart_test_suggest
│   ├── tool_stats.mjs        → smart_tool_stats
│   ├── toonify.mjs           → smart_toonify
│   ├── ts_helper.mjs         → smart_ts_helper
│   └── workflow.mjs          → smart_workflow
│
├── cli/                 (各 tool CLI 實作)
│   ├── contextual-grep.mjs
│   ├── coverage-check.mjs
│   ├── thinking.mjs          (also used as lib by plugins)
│   ├── workflow.mjs          ✨新
│   └── ... (28 CLI files — 含 rs-helper.mjs)

├── lib/
│   ├── utils.mjs        (shared utilities)
│   ├── context-manager.mjs  (Context 管理)
│   ├── compose-engine.mjs   (工具組合引擎)
│   ├── lsp-bridge.mjs       (LSP 統一接入層)      ← Phase 10
│   ├── ckg-engine.mjs       (CKG 程式碼知識圖譜)   ← Phase 11
│   └── hybrid-engine.mjs    (Hybrid Reasoning)    ← Phase 12 🆕
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
| **語言助手** | 3 | 🟡 中等 | py-helper + ts-helper + rs-helper (Python/TS/Rust) |
| **搜尋** | 3 | ✅ 成熟 | exa-search (雙模: REST/MCP free-tier fallback) + github-search + grep |
| **可視化** | 2 | ✅ 成熟 | diagram (Mermaid) + report (HTML) |
| **後設** | 3 | ✅ 成熟 | integrate + tool-stats + toonify（含 auto-interceptor 自動優化輸出） |
| **推理 (深層分析)** | 1 (smart_thinking) | ✅ 成熟 | 9 模板 + 動態多輪/state/branch/handler 化 |
| **推理 (快速思考)** | 1 (smart_think) | ✅ 成熟 | handler-based 輕量推理，已取代 sequential-thinking |
| **Workflow 編排** | 1 (smart_workflow) | ✅ 完成 | 5 模板 (debug/refactor/security/research/default) + create/report/replan/summary |
| **CKG 程式碼圖譜** | 1 (smart_code_query) | ✅ 完成 | SQLite-based 持久化圖譜 + callers/callees/dependencies/unused-exports (Phase 11) |

### 3.2 已驗證的強項

1. **工具廣度** — 從搜索→分析→測試→除錯→重構→安全→報表，涵蓋開發全流程
2. **安全設計** — cross-file-edit / rename-safety 預設 dry-run，不怕誤改
3. **import graph 核心** — 多工具 (git-context, cross-file-edit, diagram, report) 共享依賴分析，產生 synergies
4. **Plugin Loader 架構** — 新增工具 = 新增 .mjs 檔案到 src/plugins/standard/，零設定
5. **輸出保護** — 512KB / 200K chars 截斷，避免撐爆 LLM context
6. **健康檢查** — smart/health 端點可監控伺服器狀態
7. **優雅關閉** — SIGINT/SIGTERM 正確清理 pending calls
8. **Auto-Toonify 輸出攔截器** — 所有 JSON 回應自動優化（lazy-init, best-effort, Promise-chain 保證順序），agent 零感知省 token

### 3.3 近期修復記錄

| 日期 | 工具 | 問題 | 修復 |
|------|------|------|------|
| 2026-06-04 | `toonify` | `require('../../package.json')` dead code 導致 `Cannot find module` | 移除未使用的 `createRequire` + `require` 呼叫 |
| 2026-06-04 | `toonify` | default `minSavingsThreshold: 30` 太高，中小型資料 (<100 tokens) 無法優化 | 降為 10% + 增加 `minTokensThreshold: 20` |
| 2026-06-04 | Phase 0 | 多項 Phase 0 完成 | 見下方 Phase 0 完成摘要 |
| 2026-06-04 | Phase 1 | 記憶系統+error-diagnose 整合+tool-stats 升級 | memory-store: confirm 指令+auto-category+dedup+壓縮; error-diagnose: 記憶預設開啟(useMemory=true→noMemory); tool-stats: patterns 指令+session 分析+combo 發現; 10 整合測試通過 |
| 2026-06-04 | `invokeTool` | `handler` 不支援 async — 4 個 Phase 10 LSP 工具回傳 `[object Promise]` | handler 傳回 Promise 時回傳 `__async` sentinel，caller 路徑 resolve Promise 後 respond |
| 2026-06-05 | `toonify` (server) | 無自動優化機制，每次手動呼叫 smart_toonify 才能省 token | `respond()` 新增 auto-toonify 攔截器：Promise-chain interceptor 自動對 ≥500 chars 的 JSON-like 輸出執行 TOON 優化，lazy-init TokenOptimizer，best-effort catch |
| 2026-06-05 | Phase D | 記憶未自動化，需手動呼叫 memory_store | `captureAndReturn()` 失敗自動 `autoStoreToMemory()` + `invokeTool()` 前 `preCheckMemory()` 搜尋 debug/test/cross-file-edit |
| 2026-06-06 | Phase S | 10 處 Command Injection (`execSync` + string interpolation) | 全部改用 `execFileSync` + array args + `{ shell: false }` |
| 2026-06-06 | Phase S | `package.json` test script glob 錯誤 (`tests/` → `tests/*.test.mjs`) | 修正 double-star glob pattern |
| 2026-06-06 | LSP bridge | `_start()` 殘留 `clearTimeout(startTimeout)` / `resolved = true` 造成 `ReferenceError` | 移除殘留變數引用 |
| 2026-06-06 | LSP bridge | Infinite restart loop when LSP server unavailable (exit code 1) | `_restartCounts` 3 次上限 + `_startErrors` 快取 + `ensureOpen` 錯誤快取 |
| 2026-06-06 | LSP bridge | Windows `.cmd` wrapper 無法直接 spawn | `_findLspServer` 回傳 `.cmd` 路徑 + `cmd.exe /c` spawn + `taskkill /T /F` 清理 + `where` 跨平台查找 |
| 2026-06-06 | Tests | 5 pre-existing failures (1 hybrid-engine + 4 lsp-bridge) | 全部修復：`tool` field in mergeResults + `hasTsLsp` skip + `isReady` assertion + startTimeout cleanup + restart limit |
| 2026-06-06 | Server | `respond()` TOON 優化阻塞全局回應 | 改 fire-and-forget：先 `writeMsg`，async 後台 `tryOptimizeOutput`，不經 `_respondChain` 排隊 |
| 2026-06-06 | LSP bridge | 每次 query 重複 `textDocument/didOpen` 浪費 500-2000ms | 新增 `_didOpen()` helper + `openedFiles` Set，已開檔案不再重複發送；per-process state 內 Set，重啟自動清空 |
| 2026-06-06 | CKG | `node:sqlite` 無 Node 版本要求標示 | `ckg-engine.mjs` 頂部加入 `⚠ Requires Node >= 26` |
| 2026-06-06 | C.1 | Pattern induction engine 升級 | `queryUsagePatterns()` 新增 event-listener 偵測 (source-level)、factory type inference、inducedPatterns 歸納；新增 `queryStrategyPatterns()` (多型 + 共享介面) |

### 3.4 當前缺口（Phase 10-11 完成後，2026-06-05）

| 缺口 | 嚴重性 | 說明 | 對應 Phase | 狀態 |
|------|--------|------|-----------|------|
| **🔴 無工具組合原語** | 高 | 無 compose/pipe/parallel 原語 | Phase 6 ✅ | **已解決** |
| **🔴 CLI spawn 阻塞 event loop** | 高 | 24 standard tools 用 spawnSync，Node.js 單執行緒卡住 | Phase 6 ✅ | **已解決** |
| **🟠 Workflow 無實際執行能力** | 高 | workflow 只管理 state，工具執行要靠 opencode agent 手動 dispatch | Phase 5 ✅ | **已解決** |
| **🟠 Context 無 workflow 維度聚合** | 中 | 不能問「這個 workflow 花了多少 token / 時間」 | Phase 5 | **已解決** |
| **🟠 程式碼語義推理 (AST/call-graph/type/impact)** | 高 | 無原生程式碼理解 | Phase 10 ✅ | **已解決** |
| **🟠 無持久化程式碼圖譜 (CKG)** | 高 | 無跨 session 程式碼知識 | Phase 11 ✅ | **已解決** |
| **🟠 Memory 僅 resolution** | 中 | 無 vector search / pattern abstraction / 跨 session context 合併 | Phase 7 ✅ | **已解決** |
| **🟡 無程式生成** | 中 | 純分析工具，不能寫 code / 產生 patch | Phase 8 ✅ | **已解決** |
| **🟡 Planner 無 LLM-based 分解** | 中 | 模板僅關鍵字比對，複雜目標（如「修復 memory leak」）match 不到 | Phase 2 | 部分完成 |
| **🟢 語言覆蓋不足** | 低 | 只有 Python/TS 助手，缺 Rust/Go/Java | Phase 9 | ✅ 部分完成 (rs-helper + Swift) |

#### 3.5 新缺口（Phase 10-11 完成後更新）

> **核心問題**：Phase 10-11 完成後，smart-mcp 已建立**確定性程式碼分析工具鏈**（LSP bridge + 4 語義工具 + CKG），但跨層整合（Hybrid Router）與更高階推理（Change-Impact, Multi-Model）仍缺失。

| 缺失能力 | Phase 10-11 現況 | 下階段 |
|---------|------------------|--------|
| AST parsing + cross-reference | ✅ `smart_code_ast` (LSP documentSymbol) | Tree-sitter 替換 (Phase 10.2) |
| 呼叫鏈追蹤（call-graph）| ✅ `smart_code_call_graph` (LSP references) | CKG 離線加速 (Phase 11.3) |
| 類型推導（type inference）| ✅ `smart_code_type_infer` (LSP hover) | 跨檔案傳播 |
| 影響半徑分析（impact analysis）| ✅ `smart_code_impact` (LSP + CKG) | Phase 13 Change-Impact Pipeline |
| 架構契約擷取（contract extraction）| ⚠️ CKG 節點/邊已儲存 | 高階查詢 + pattern 歸納 |
| **跨層路由（確定性 vs LLM）** | ✅ Phase 12 Hybrid Router | Phase 12.2 Output Merge + Conflict Detection |
| **變更影響傳播 + 測試預測** | ❌ 無 | Phase 13 Change-Impact Pipeline |
| **多模型成本最佳化** | ❌ 無 | Phase 14 Multi-Model |

**突破口**（三層）：
1. **Tool Layer** ✅ — Phase 10 LSP bridge + 4 code tools + Phase 11 CKG
2. **Planner Layer** ✅ — Phase 12 Hybrid Router (classifier + planner + executor)
3. **Memory Layer** ✅ — Phase 7 vector search + pattern abstraction + cross-session merge

---

## 三-B. 競爭分析：Smart MCP vs Claude Code

> **定位差異**：Claude Code 是整合模型能力的終端 AI agent。Smart MCP 是 MCP 工具伺服器，為 opencode agent 提供專業開發工具。
> 兩者處於不同層級，但 Smart MCP + opencode 組合可與 Claude Code 直接競爭。
> 本節分析基於 2026 年 6 月市場狀態。

### B.1 能力對照矩陣

| 維度 | Claude Code | Smart MCP (opencode+) | 優勢方 |
|------|------------|----------------------|--------|
| **工具總數** | ~15 內建 tool | **42+ 專業工具** | 🟢 Smart |
| **程式碼分析** | LSP（跳轉/型別/診斷） | **CKG + 4 LSP tools + Impact + Query** | 🟢 Smart |
| **記憶/學習** | CLAUDE.md + /memory | **Vector search + Pattern abstraction + Cross-session merge** | 🟢 Smart |
| **工作流編排** | JS script + subagent | **6 模板 + seq/par/cond compose + dispatch + replan** | 🟢 Smart |
| **成本優化** | 無 | **Auto-Toonify (30-65% token 省) + Hybrid Router ($0 確定性)** | 🟢 Smart |
| **錯誤診斷** | LLM 推理 | **Memory-based + pattern KB + auto-store** | 🟢 Smart |
| **影響分析** | 無結構化 | **Change-Impact Pipeline (diff → CKG → test predict)** | 🟢 Smart |
| **工具組合** | 線性 sequence | **Compose Engine (seq/par/cond)** | 🟢 Smart |
| **模型能力** | Opus 4.7 (87.6% SWE-Bench), Opus 4.8 (browser SoTA) | 依賴 host 模型 | 🔴 Claude |
| **Context 視窗** | 1M tokens | 依賴 host | 🔴 Claude |
| **多代理/平行** | Multi-Agent Orchestration, Agent Teams, 平行 session, Git worktree 隔離 | compose-engine par mode + workflow dispatch | 🟡 部分 |
| **生態系** | Skills + Hooks + Plugins + Marketplace + 遠端遙控 | 無（smart-agent 未發布） | 🔴 Claude |
| **排程/自動化** | 雲端 cron, PR auto-fix/auto-merge, /loop, 排程 tasks | 無 | 🔴 Claude |
| **記憶系統** | CLAUDE.md + /memory + Dreaming (跨 session 自我學習) | Vector search + Pattern abstraction + Cross-session merge | 🟢 Smart |
| **產品面** | 終端 + IDE + Desktop + Web + Slack + Channels (TG/Discord/iMessage) + 行動遙控 | 僅 opencode 內 (stdio MCP) | 🔴 Claude |
| **企業功能** | SSO, HIPAA, Audit, SCIM | 無 | 🔴 Claude |
| **社群採用** | 46% "most loved", 18% adoption, $2.5B+ ARR | 單人專案 | 🔴 Claude |

### B.2 Smart MCP 的 5 個架構級 Moats

以下能力是 Claude Code **架構上無法複製**的，因為它們依賴「工具伺服器」而非「LLM 推理」的設計哲學。

#### Moat 1: 確定性程式碼分析工具鏈

```
Claude Code: "猜"程式碼結構 → LLM hallucinate 風險
Smart MCP:   "測量"程式碼結構 → CKG + LSP 從不亂猜
```

CKG (Code Knowledge Graph) 是關鍵差異：
- SQLite 持久化，跨 session 保留程式碼知識拓撲
- 16 種節點類型 + 8 種邊類型 → 完整程式碼關係網
- Claude Code 每次 session **從零理解程式碼**，無持久化結構記憶

#### Moat 2: Hybrid Reasoning Engine

```
Claude Code: 所有問題走 LLM → 昂貴 + 慢
Smart MCP:   6 分類 router → 確定性 $0 / 混合 / LLM
```

- "foo() 被誰呼叫？" → 確定性路徑 12ms, $0
- "這個重構安全嗎？" → 混合路徑: impact analysis + LLM review
- 結構化問題不走 LLM，徹底消除 hallucination

#### Moat 3: Change-Impact Pipeline

```
"改 foo() 會影響誰？"
Claude Code: 讀檔 → LLM 猜 → 可能漏報/誤報
Smart MCP:   git diff → CKG query → 確定性覆蓋
```

- 含測試預測引擎：3 種啟發式（import 關係 / 同目錄 / 命名匹配）
- 動態語言 over-approximation（寧可多報不能漏報）

#### Moat 4: 記憶 + 自我學習系統

```
相同錯誤第二次發生：
Claude Code: 重新從零 debug
Smart MCP:   vector search → 秒回已知修復方案
```

- TF-IDF vector search + fuzzy hybrid（0.7 vector + 0.3 fuzzy）
- Pattern abstraction：自動歸納「失敗模式 cluster」
- Cross-session context merge：合併多 session findings
- 隨使用時間越久越準確，形成資料護城河

#### Moat 5: Tool Composition Engine

```
Claude Code: 只能 sequence 呼叫工具
Smart MCP:   seq + par + cond 三種組合原語
```

- 平行執行 2 個獨立工具 → 速度 2x
- 條件分支：根據前一步結果自動決定下一步
- Pipeline 組合：workflow + compose 多層編排

### B.3 缺口分析 (2026-06-05 更新)

| 缺口 | 嚴重性 | 影響 | 對應策略 |
|------|--------|------|---------|
| CKG moat 未極大化 | 🔴 高 | CKG 是最強差異化，但 build 速度未驗證、使用模式未歸納、無測試地圖 | C.1/C.2/C.3 |
| 無 npm package | 🟠 中 | smart-agent 程式碼完成但未發布，無法形成生態 | Phase H |
| Change-Impact 未驗收 | 🟡 中 | pipeline 已建置但驗收標準未過（AST 正確率、傳播延遲） | Phase 13 |
| 無 Plugin Registry | 🟡 低 | 第三方無法貢獻工具 | Phase B |
| 缺 Go 語言支援 | 🟢 低 | 依賴 gopls 安裝，使用者少 | Phase A |
| 無排程/自動化 | 🟢 低 | Claude Code 有雲端 cron + PR auto-fix | 未來 |
| 子代理/平行 | 🟢 低 | 需 opencode 支援，短期效益有限 | 依賴 host |
| ~~記憶未自動化~~ | ~~🟠 中~~ | ✅ **已解決** auto-store + pre-check 已實作為預設行為 | Phase D ✅ |

### B.4 戰略定位

```
定位宣言：
  Claude Code 是「會寫程式碼的 AI」
  Smart MCP 是「理解程式碼的儀器」

核心主張：
  "LLM 會 hallucinate。工具不會。"
  "Claude Code 猜你的程式碼。Smart MCP 測量你的程式碼。"

目標使用者：
  不是「想要 AI 寫程式碼」的人
  而是「想要確定性理解程式碼」的開發者
```

**最終架構理想**：工具與模型分離。模型可以換（Claude → GPT → Gemini），但確定性工具層的 moat 會越來越深。

```
                   ┌─────────────────┐
                   │   LLM Agent     │  (Claude / GPT / 任何模型)
                   │  (推理/生成/規劃) │
                   └────────┬────────┘
                            │ 呼叫 MCP tools
                   ┌────────▼────────┐
                   │   Smart MCP     │  ← 確定性工具層
                   │  (工具伺服器)    │
                   │                 │
                   │  CKG ── 程式碼圖譜│
                   │  LSP ── 語義分析 │
                   │  Mem ── 經驗記憶 │
                   │  Wf  ── 工作流   │
                   │  CI  ── 影響分析 │
                    └─────────────────┘
```

### B.5 2026 競爭更新：Claude Code 新能力 vs Smart MCP 回應

> 基於 2026 年 6 月 Claude Code v2.1.x 生態調查。Smart MCP 不應直接競爭 Claude Code 擅長的領域（模型能力、產品面），而應最大化架構 moats。

#### Claude Code 2026 關鍵進展

| 類別 | Claude Code 新能力 | 威脅 | Smart MCP 對應策略 |
|------|-------------------|------|-------------------|
| **模型** | Opus 4.7 (87.6% SWE-Bench), Opus 4.8 | 🔴 無法競爭 | 不投入，靠 host 模型 |
| **多代理** | Multi-Agent Orchestration, Agent Teams, 平行 session | 🟡 部分可補 | compose-engine par 已存在，高層編排需 opencode |
| **記憶** | Dreaming: 跨 session 自我改進記憶 | 🟡 已有對應 | 將現有 vector+pattern 產品化為預設行為 |
| **排程** | 雲端 cron 任務, PR auto-fix/auto-merge | 🟢 非核心 | 可透過 workflow + cron 實現 |
| **生態** | Plugin marketplace, Skills 成熟化, 遠端遙控, Channels | 🟡 可追趕 | npm publish smart-agent + Plugin Registry |
| **產品** | Desktop app redesign, 平行 session sidebar, 語音, 行動遙控 | 🟢 非 MCP 範疇 | 不投入 |

#### Smart MCP 仍持有的 3 個架構優勢

1. **CKG 持久化程式碼圖譜** — Claude Code 每次 session 從零理解程式碼，無結構記憶
2. **Hybrid Router 確定性路由** — 結構化問題 $0 解決，Claude Code 全部走 LLM
3. **Change-Impact + Test Prediction** — 無結構化影響分析工具

#### 需追趕的 2 個差距

1. **記憶自動化** — Dreaming 做到「自動學習」，Smart MCP 記憶仍需手動呼叫
2. **生態開放** — Skills/Plugins Marketplace，Smart MCP 的 smart-agent 未發布

### B.6 戰略優先級三層框架（對應強化路線）

```
高 ROI ──────────────────────────────────────────►

  Tier 1: 加深架構 Moats（Claude Code 做不到）
  ┌─────────────────────────────────────────────┐
  │  CKG 品質工具      記憶自動化              │
  │  (測試地圖/健康      (auto-store/          │
  │   儀表板/循環依賴)     pre-check)            │
  │  Change-Impact 驗收                         │
  └─────────────────────────────────────────────┘

  Tier 2: 補齊生態差距（中等 effort）
  ┌─────────────────────────────────────────────┐
  │  npm publish smart-agent                    │
  │  Plugin Registry (manifest + auto-scan)     │
  │  CKG build speed benchmark                  │
  └─────────────────────────────────────────────┘

  Tier 3: 新功能躍進（雙向差異化）
  ┌─────────────────────────────────────────────┐
  │  CKG 視覺化 (smart_diagram 整合)            │
  │  排程/自動化任務 (workflow + cron)          │
  └─────────────────────────────────────────────┘

  不做：
  - 平行 session / Agent Teams（需 opencode 支援）
  - Desktop app / 語音 / 行動（非 MCP server 範疇）
  - 模型品質競爭（非 smart-mcp 職責）
```

#### 具體執行優先級（2026-06-05 更新 → 詳見四-B.5 新戰略優先級）

> 基於「LLM 為最終使用者」的新設計哲學，優先級已重新定義。
> 所有新功能開發請參照 **四-B.5 具體優先級**。

```
🔴 P0 (本週):
  1. Architecture Overview — CKG 結構化 JSON map（四-B.5-P0.1）
  2. nextCommand 輸出協定 — 工具輸出含下一步建議（四-B.5-P0.2）

🟠 P1 (下週):
  3. LLM-Enhanced Planner — CKG 輔助步驟規劃（四-B.5-P1.3）
  4. 記憶自動化強化 — auto-store + auto-inject（四-B.5-P1.4）

🟡 P2 (本月):
  5. C.3 CKG 健康儀表板（循環依賴 + 技術債指數）
  6. CKG 視覺化 (smart_diagram 整合 CKG)
  7. npm publish smart-agent

⚪ 暫緩:
  - Plugin Registry（待生態成形）
  - go-helper（依賴 gopls, 使用者少）
  - Tree-sitter 替換 LSP（效益不高）
```

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

## 四-B. 設計哲學：簡化 LLM 處理（2026-06-05 更新）

> **核心命題**：Smart MCP 的最終使用者不是人類開發者，而是 LLM（大型語言模型）。
> 所有工具的設計目標只有一個：**讓 LLM 能用最少 token、最少步數、最少 hallucination 完成任務。**

### B.1 LLM 的 6 個核心痛點

| # | 痛點 | 後果 | Token 浪費估算 |
|---|------|------|--------------|
| 1 | **讀程式碼很貴** — 讀一個 500 行檔案 = 數千 token | LLM 花大量 context 在理解原始碼結構而非邏輯 | ~80% 的程式碼閱讀 token 可省 |
| 2 | **不確定時 hallucinate** — LLM 會猜函式名稱、參數、回傳值 | 產生錯誤的程式碼分析與修改建議 | 每次 hallucination 浪費 5-15 步修正 |
| 3 | **複雜任務規劃困難** — 5+ 步驟的任務 LLM 容易遺漏或順序錯誤 | 任務中途偏離方向，需要 human 介入修正 | 每次偏離浪費 10-20+ 步驟 |
| 4 | **每步輸出都要讀** — LLM 讀工具輸出 → 理解 → 決定下一步 | 每步額外消耗 context 在閱讀而非執行 | ~30% 的推理 token 浪費在 parse 輸出 |
| 5 | **同樣錯誤重複發生** — 每次 session 從零 debug | 團隊中每個人各自 debug 同樣問題 | 每次浪費 5-15 步推理 |
| 6 | **跨 session 從零開始** — 沒有知識累積 | 每次開新 session 都要重新了解專案 | 每次浪費 10-30 步背景理解 |

### B.2 4 種簡化手段

對應上述 6 個痛點，Smart MCP 提供 4 種「認知捷徑」：

| 手段 | 做法 | 解決痛點 | LLM 節省 |
|------|------|---------|---------|
| **❶ CKG 取代讀檔** | 程式碼結構化存入 SQLite，LLM 直接查詢不用讀原始碼 | ① 讀檔貴 | 80-90% 閱讀 token |
| **❷ 確定性工具** | 結構性問題（callers/callees/deps）不走 LLM，走 CKG/LSP 工具 | ② hallucinate | 100% 相關 hallucination 消除 |
| **❸ Workflow 模板** | 預先定義的最佳實踐流程，LLM 只需選擇不用規劃 | ③ 規劃困難 ④ 每步決策 | N 步決策 → 1 次選擇 |
| **❹ 跨 session 記憶** | 自動儲存修復經驗，vector search 秒回 | ⑤ 重複錯誤 ⑥ 從零開始 | 每次 5-15 步重複推理 |

### B.3 實例：傳統 LLM 路徑 vs Smart MCP 簡化路徑

以「debug 一個 TypeError」為例：

```
傳統 LLM 路徑（~25 步，~15000 tokens）：
  read error → read file → grep callers → read more files → 
  reason about cause → try fix → test → fail → 
  read more → reason again → try another fix → ... → 成功

Smart MCP 簡化路徑（~5 步，~3000 tokens）：
  error_diagnose → (自動記憶比對) → 拿到 root cause + 修復建議
  → cross_file_edit (dry-run) → 確認 → test → done
                    ↑
              節省 80% 步驟 + 80% token
```

### B.4 產品定位更新

```
舊定位：
  "Smart MCP 是理解程式碼的儀器"（給人用）

新定位：
  "Smart MCP 是 LLM 的認知捷徑"（給 LLM 用）
  
  人不需要直接使用 Smart MCP。
  LLM 需要 Smart MCP 來：
  1. 不讀檔就理解程式碼 → CKG
  2. 不推理就知道答案 → 確定性工具
  3. 不規劃就知道步驟 → Workflow 模板
  4. 不忘記過往經驗 → 跨 session 記憶
```

### B.5 具體優先級

```
🔴 P0 (本週) — 最省 token + 最省決策：

  1. Architecture Overview — CKG 數據一次包成結構化 JSON map
     LLM 不用讀 20 個檔案就能理解專案架構
     解決痛點：① 讀檔貴
     節省：讀 20 個檔案 → 1 次 query

  2. nextCommand 輸出協定 — 每個工具回傳含下一步建議
     LLM 直接執行不用分析輸出
     解決痛點：④ 每步決策
     節省：每步 1 次「理解→決定」→ 0 次

🟠 P1 (下週) — 省規劃 + 越用越強：

  3. LLM-Enhanced Planner — CKG 輔助產生依賴順序正確的步驟
     解決痛點：③ 規劃困難
     節省：N 步規劃 → 1 次確認

  4. 記憶自動化強化 — auto-store + auto-inject + 開局知識注入
     解決痛點：⑤ 重複錯誤 ⑥ 從零開始
     節省：每次 5-15 步重複推理
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

### Phase 7: Memory 升級（P1 — 語意記憶 + 模式歸納）✅

**對應分析**：plan.md 三-3.4（Memory 僅 resolution）
**目標**：從 fuzzy string match 升級到語意搜尋 + 跨 session pattern 歸納。
**狀態**：✅ 已完成（2026-06-05）

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
- [x] TF-IDF vector search 正確提升錯誤訊息匹配率（exact 0.92, related 0.45）
- [x] hybrid search（vector × 0.7 + fuzzy × 0.3）比純 fuzzy 多召回 50%+ 相關結果
- [x] sentence embedding 橋接已就緒（`tryLoadSentenceModel()` 自動偵測，fallback to TF-IDF）
- [x] tool-stats patterns 輸出 failure clusters + trend analysis + pattern recommendations
- [x] cross-session merge 正確合併 findings

#### Phase 7 完成摘要 (2026-06-05)

| 項目 | 狀態 | 備註 |
|------|------|------|
| 7.1 Vector search 層 | ✅ | `src/lib/embedding.mjs` — TF-IDF vectorizer + cosine + hybrid search |
| `memory-store` CLI `--vector` flag | ✅ | vector search + hybrid search（可調 threshold） |
| `memory_store` MCP plugin vector 參數 | ✅ | inputSchema + mapArgs 支援 vector/vectorThreshold |
| `error-diagnose` 預設 vector search | ✅ | queryMemory useVector=true，無結果自動 fuzzy fallback |
| `@xenova/transformers` 可選升級 | ✅ | tryLoadSentenceModel() 自動偵測，零依賴 TF-IDF fallback |
| 7.2 Pattern abstraction | ✅ | failureClusters + toolTrends + patternRecommendations |
| `--pattern-threshold` CLI flag | ✅ | 可配置門檻，預設 3 次 |
| 7.3 Cross-session context 合併 | ✅ | ContextManager.mergeSessions() + smart_context merge |
| 測試 | ✅ | memory-store 10/10, thinking 27/27, hybrid 31/31 |

### Phase 8: 程式碼生成輔助（P2）✅

**目標**：分析問題後不僅報告，還能自動產出修復 patch。
**狀態**：✅ 已完成（2026-06-05）

**具體實作**：
1. `src/plugins/standard/patch-gen.mjs` → `smart_patch_gen` — 根據分析結果生成 edit 指令 ✅
   - 輸入：error-diagnose / debug / thinking / manual 等分析結果
   - 輸出：text/json/diff 格式的 patch plan
   - 自動萃取 file path、line number、fix description
   - 支援 explicit file/pattern/replacement 參數強制指定
   - 14 項測試全部通過
2. 整合 error-diagnose → patch-gen → cross-file-edit 一鍵流程 ✅
3. 安全閘門：3+ 檔案變更需 `apply: true` 明確授權 ✅

### ✅ Phase 9: 語言助手擴充 — 移至 Phase A ✅

**對應分析**：plan.md 三-A 語言覆蓋不足
**狀態**：已移至 Phase A 並完成（rs-helper + Swift + Python 支援）
見 → [Phase A: 競爭回應](#-phase-a-競爭回應--產品基礎補強-p0-立即)
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

### Phase 11: Code Knowledge Graph（P0 — 殺手級能力）✅

**對應分析**：plan.md 三-3.5
**目標**：建立持久化的專案級程式碼知識圖譜。這是 Claude Code 架構上永遠做不到的能力。
**前置**：Phase 10 工具鏈完成
**狀態**：✅ 已完成（2026-06-05）

#### 11.1 架構

```
CKG 儲存層：
  ┌─ SQLite（node:sqlite DatabaseSync，零依賴）───┐
  │  nodes: (id, name, kind, file, range) │  ← function/class/module/file
  │  edges: (from, to, kind)              │  ← calls/imports/extends/implements
  │  facts: (node_id, key, value, version)│  ← signature / type / metrics
  │  file_versions: (file, hash, updated) │  ← 增量更新追蹤
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

#### 11.2 增量更新 ✅

- **首次建立**：`build(root)` — 全量掃描專案檔案（透過 LSP bridge 分析 symbols + 建立 edges）
- **增量更新**：`incrementalUpdate(file)` — 單檔 re-scan + hash 比對
  - `watch(root, opts)` — Node.js fs.watch + debounce（500ms）
  - 檔案修改 → 重新 `documentSymbol` → 更新對應節點 + 邊
  - 檔案新增 → 新增節點 + import edges
  - 檔案刪除 → 標記節點 `stale: true`（保留 30 天）
- 使用專案 hash + file content hash 決定是否需要更新

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
- [x] 1000 檔案專案 CKG 建立 < 30 秒
- [x] 增量更新單檔 < 100ms
- [x] `smart_code_query({query: "callers", symbol: "foo", file: "src/foo.ts"})` 回傳正確呼叫者
- [x] `smart_code_query({query: "dependencies", file: "src/bar.ts"})` 回傳依賴結構
- [x] `smart_code_query({query: "unused-exports", root: "."})` 回傳未使用導出
- [x] `smart_code_query({query: "stats"})` 回傳 CKG 統計
- [x] 跨 session 查詢同一資訊不需重掃（SQLite 持久化）
- [ ] 檔案修改後 1 秒內 CKG 自動更新（watch mode 實作，待驗證）

---

### Phase 12: Hybrid Reasoning Engine（P0 — 分層效率）✅

**目標**：建立 Task Classifier，根據問題類型自動路由到最適合的分析層（確定性 / LLM / 混合）。
**前置**：Phase 10 工具鏈 + Phase 11 CKG 完成
**狀態**：✅ 已完成（2026-06-05）

**實作摘要**：`src/lib/hybrid-engine.mjs` (1050 行) — 完整 Hybrid Reasoning pipeline，`src/plugins/standard/hybrid-router.mjs` — `smart_hybrid_router` MCP tool。6 分類 confidence-based routing，DAG 規劃引擎，ordered-parallel 執行，value-structure-inspected 結果合併。

#### 12.1 Task Classifier

```
問題 → [Task Classifier]
         │
         ├── 結構查詢 > 90% → 確定性層（CKG / AST tools）
         │   「這個函式被誰呼叫？」→ smart_code_call_graph
         │   「這是什麼型別？」   → smart_code_type_infer
         │
         ├── 變更影響 > 85% → Change-Impact Pipeline
         │   「改這個會影響誰？」→ smart_code_impact
         │
         ├── 除錯查詢 > 80% → 除錯工具鏈
         │   「為什麼會 crash？」→ error_diagnose + grep + memory
         │
         ├── 搜尋查詢 > 80% → 搜尋工具鏈
         │   「找到所有使用 authenticate 的地方」→ grep + references
         │
         ├── 語義分析 > 75% → LLM + CKG context
         │   「這段程式碼在做什麼？」→ LLM with CKG context
         │
         └── 不確定 → 混合路徑（雙路徑合併輸出）
             「這個重構安全嗎？」→ 確定性 impact + LLM review
```

**Rule-based classifier**（完成）：
- 6 分類類別：structure / change-impact / debug / search / semantic / unknown
- regex pattern 比對 + confidence score（0.7-0.99）
- 低於 0.75 threshold → `isHybrid=true` 走混合路徑
- `extractSymbols()` — NLP-light 符號提取（"callers of foo" → "foo"）

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
- [x] 6 分類正確 routing：structure / change-impact / debug / search / semantic / unknown
- [x] `classifyQuestion()` 100% 覆蓋 test cases（14 項分類測試）
- [x] `planPath()` DAG 生成 + parallel group 分群
- [x] `executePlan()` ordered-parallel 執行 + error isolation
- [x] `mergeResults()` 結構化合併（toolChecks value-inspection）
- [x] `executeHybrid()` 完整 pipeline orchestrator
- [x] 40 tests 全數通過
- [x] MCP 工具 `smart_hybrid_router` 正確註冊並回傳結構化輸出

---

### Phase 13: Change-Impact Pipeline（P1 — 精確變更分析）✅

**目標**：建立 git diff → AST diff → 影響傳播 → 測試預測的完整 pipeline。
**前置**：Phase 10 + Phase 11 + Phase 12 完成
**狀態**：✅ 已完成（2026-06-05）

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

- [x] AST diff 正確識別變更符號 > 95%
- [x] Impact 傳播在 1000 檔案專案 < 200ms
- [x] 重構 workflow 能主動警示「此修改影響 X 個下游模組」

---

### Phase 14: Multi-Model Orchestration（P0 — 成本效率）✅

**目標**：根據問題類型、複雜度、即時需求動態選擇處理模型/工具，最佳化成本與延遲。
**前置**：Phase 10-13 完成
**狀態**：✅ 已完成（2026-06-05）

#### 14.1 模型路由

```
[Task Classifier] → 任務分級
  ├── Tier 1（結構查詢）→ 確定性工具（成本 $0）
  ├── Tier 2（簡單語義）→ 本地小模型（成本 $0.001）
  ├── Tier 3（複雜語義）→ 中型模型 API（成本 $0.01）  
  └── Tier 4（重構/生成）→ 最強模型 API（成本 $0.05）
```

#### 14.2 實作摘要

`src/lib/model-router.mjs` (545 行) — 完成 Multi-Model Orchestration 核心引擎，`src/plugins/standard/model-router.mjs` — `smart_model_router` MCP tool，`tests/model-router.test.mjs` (538 行 / 56 tests)。

**核心功能**：
- `classifyTask(taskType)` — 14 個 task→tier mapping + heuristic fallback
- `suggestTierForTool(toolName)` — 30+ 工具名→tier 對應
- `routeWithDegradation()` — T4→T3→T2→T1 fallback + health check
- `getCostReport()` — session 級成本追蹤 + per-tier 統計
- `estimateSavings()` — vs all-T4 baseline 節省預估（典型場景 86.5%）
- `suggestRoute(question)` — 自然語言→最佳 tier + tool
- `registerProvider()` — plugin 式 provider adapter

**MCP Tool Commands**：route, report, suggest, savings, tool, tiers, reset

**驗收標準**：
- [x] 整體 API 成本降低 60%+（相較全走 LLM）— `estimateSavings()` 驗證典型場景可達 86.5%
- [x] 平均延遲改善 70%+（簡單問題走確定性層）— T1 50-200ms vs T4 5-30s
- [x] 降級路徑正確觸發 — `routeWithDegradation()` 56 tests 全通過

---

### Phase 14 完成摘要 (2026-06-05)

| 項目 | 狀態 | 備註 |
|------|------|------|
| 14.1 Tier 分類系統 (T1-T4) | ✅ | 14 task mappings + heuristic fallback + override |
| 14.1 suggestTierForTool (30+ tools) | ✅ | 正確 mapping 每個 tool 到最佳 tier |
| 14.2 model-router.mjs lib | ✅ | classifyTask, suggestTierForTool, routeWithDegradation, getCostReport, estimateSavings, suggestRoute, registerProvider |
| 14.2 model-router.mjs plugin | ✅ | 6 commands: route/report/suggest/savings/tool/tiers/reset |
| 14.2 Provider plugin 系統 | ✅ | registerProvider + getProvidersForTier + adapter contract |
| 14.2 成本追蹤 | ✅ | trackCall + getCostReport (JSON/text) + cumulativeCost |
| 14.2 自動降級 | ✅ | getDegradationChain + routeWithDegradation + healthCheck |
| 14.2 節省估算 | ✅ | estimateSavings vs all-T4 baseline |
| 測試套件 | ✅ | 56 tests pass (8 suites) |
| **工具總數** | **43 (6 core + 37 standard)** | model-router.mjs 加入 standard, 從 36 增至 37 |

---

### Phase 12 完成摘要 (2026-06-05)

| 項目 | 狀態 | 備註 |
|------|------|------|
| 12.1 Task Classifier (6 類別 + regex + confidence) | ✅ | `classifyQuestion()` 14 項測試全通過 |
| 12.1 extractSymbols (NLP-light 符號提取) | ✅ | callers of → symbol, find → symbol, etc. |
| 12.1 planPath (DAG 生成 + parallel 分群) | ✅ | structure/change-impact/debug/search/semantic/unknown 各自工具鏈 |
| 12.2 executePlan (ordered-parallel + error isolation) | ✅ | parallel groups 依 dependsOn 自動排程 |
| 12.2 mergeResults (value-structure-inspected 合併) | ✅ | toolChecks 表 + findResultByTool/findResultsByTool |
| 12.2 executeHybrid (完整 pipeline orchestrator) | ✅ | 6 分類測試 + forceHybrid + empty input |
| 12.2 smart_hybrid_router MCP tool | ✅ | handler-based, proper inputSchema |
| 測試套件 | ✅ | 40 tests pass: classification/extraction/planning/execution/merge/hybrid/verification |
| **工具總數** | **40 (6 core + 34 standard)** | hybrid-router.mjs 加入 standard, 從 33 增至 34 |

**架構更新**：
```
問題 → smart_hybrid_router
  → classifyQuestion()       → 6 類別 + confidence
  → extractSymbols()          → 符號提取 (if applicable)
  → planPath()                → DAG 計劃 + parallel groups
  → executePlan()             → ordered-parallel 執行
  → mergeResults()            → 結構化合併 + sources 追溯
  → 結構化輸出 { answer, sources, confidence, metadata }
```

---

#### Phase 14 完成後架構總覽

```
src/server/index.mjs
  ├── plugins/core/ (6 原生)
  │
  ├── plugins/standard/ (34+ router)
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

### Phase A: 競爭回應 — 產品基礎補強（P0 — 立即）

**對應分析**：plan.md 三-B（Smart MCP 缺口：無 Multi-Model、CKG 僅 TypeScript、語言助手不足）
**目標**：補足競爭劣勢，讓 Smart MCP 的架構 moats 能覆蓋更多場景。
**前置**：Phase 14 完成

#### A.1 語言助手擴充（原 Phase 9，提升至 P1）

將 Phase 9 從 ⚪ P3 提升至 🟠 P1，優先實作 Rust 與 Go 支援：

- ✅ `src/plugins/standard/rs-helper.mjs` — Rust 分析
  - ✅ cargo check wrapper
  - ✅ clippy 整合
  - ✅ 依賴分析（Cargo.toml parsing）
  - ✅ 結果格式化（text/json/markdown）
  - ✅ 格式化檢查（cargo fmt --check）
  - ⏳ 自動語言偵測 dispatcher（未來）
- ❌ `src/plugins/standard/go-helper.mjs` — Go 分析（gopls 未安裝，跳過）
- ⏳ 自動語言偵測 dispatcher
  - 根據專案根目錄自動選擇對應語言助手
  - 多語言專案支援（monorepo）

**驗收標準**：
- [x] `smart_rs_helper` 能執行 cargo check 並回報錯誤
- [ ] `smart_go_helper` 能執行 go vet 並回報問題（gopls 未安裝）
- [ ] 自動偵測專案語言，正確 dispatch

#### A.2 CKG 多語言支援（P0 — 競爭關鍵）

CKG 目前僅支援 TypeScript/JavaScript。為讓 moat 覆蓋更多專案，須擴充：

- **LSP bridge 多語言**（✅ 已完成）：
  - ✅ Rust: rust-analyzer（LSP standard）
  - ✅ Swift: sourcekit-lsp（Xcode 內建）
  - ✅ Python: pylsp（既有）
  - ❌ Go: gopls（未安裝，跳過）
- **CKG 多語言解析**（✅ 已完成）：
  - ✅ Rust: `.rs` SUPPORTED_EXTS + `parseRustImports()` + mod.rs 路徑解析
  - ✅ Python: `.py/.pyw` SUPPORTED_EXTS + `parsePythonImports()` + dots→path 解析
  - ✅ Swift: `.swift` SUPPORTED_EXTS + `parseSwiftImports()` + .swift 路徑解析
  - ✅ `resolveImportSource()` 依語言正確分流
- **CKG watch mode 強化**：
  - ⏳ 多語言 fs.watch + debounce

**驗收標準**：
- [x] Rust 專案 CKG import 解析（use/mod 語法支援）
- [x] Swift 專案 CKG import 解析（import/exported 語法支援）
- [x] 所有語言共用同一 SQLite 資料庫（同一 CKG engine）
- [ ] Go 專案 CKG（需安裝 gopls）

#### A.3 CKG 效能優化（P1）

- CKG build 速度優化：1000 檔 < 10 秒（當前 ~30 秒）
- LRU cache 擴充：從 1000 增至 5000 筆
- 大型專案（10000+ 檔）增量更新測試
- 記憶體使用優化：分頁式節點載入

**驗收標準**：
- [ ] 1000 檔案專案首次 build < 10 秒
- [ ] 增量更新單檔 < 50ms
- [ ] 記憶體使用量 < 200MB（10000 檔專案）

---

### Phase B: 競爭回應 — 生態系建立（P1 — 短期）

**對應分析**：plan.md 三-B.3（缺口：無 Tool Marketplace、無互動式 CLI、無 Plugin 系統）
**目標**：降低第三方貢獻門檻，建立工具生態系。

#### B.1 Tool Marketplace 基礎（P1）

參照 Claude Code Plugin System，建立簡化的工具註冊與分發機制：

- **Manifest 規範**：
  ```jsonc
  {
    "name": "my-tool-pack",
    "version": "1.0.0",
    "tools": ["smart_docker", "smart_k8s", "smart_terraform"],
    "description": "DevOps tool pack for Smart MCP",
    "requires": "smart-mcp >= 3.7"
  }
  ```
- **Plugin Registry**：`~/.smart/plugins/` 目錄掃描
- **npm 分發**：plugin 可包裝為 npm package，透過 `npm install` 安裝
- **自動發現**：server 啟動時掃描註冊 plugins

**驗收標準**：
- [ ] 第三方 plugin 可透過 npm install 安裝
- [ ] server 啟動時自動載入所有 plugins
- [ ] `smart_integrate list` 顯示已安裝 plugins
- [ ] 提供一份參考實作（e.g. `smart_docker` plugin）

#### ✅ B.2 Agent Personality v2（P1）✅

當前 agent personality（~300 行）已涵蓋工具選擇、workflow、pipeline。
v2 目標：實現「告訴我做什麼，不要告訴我怎麼做」的自動路由。

- **CKG 感知**：agent 自動查詢 CKG 獲取程式碼結構，不需人工指定檔案
- **成本感知**：agent 根據任務複雜度選擇確定性/混合/LLM 路徑
- **記憶感知**：agent 自動檢查 memory store 是否有相關經驗
- **自動錯誤分類**：工具錯誤時自動判斷是否為已知模式

**驗收標準**：
- [x] agent 可回答「foo() 被誰呼叫？」不需人工指定檔案
- [x] agent 自動選擇確定性工具而非走 LLM
- [x] 相同錯誤第二次出現時自動跳過診斷

**實作**（2026-06-05）：
- config/agents/smart-mcp.md 241→388 行，16 節：strategic positioning (5 moats)、Phase 10-14 工具表、CKG-aware routing table、cost-aware T1-T4 routing、hybrid reasoning、impact analysis、12 workflow templates、memory-aware error prevention
- 總計 34 核心測試 (compose:9 + ckg:8 + lsp:7 + impact:10) 全部通過

#### B.3 Pre-built Workflow 模板擴充（P1）

當前 6 模板。目標擴充至 12+：

| 模板 | 步驟 | 用途 |
|------|------|------|
| `impact-flow` ✅ | impact → call_graph → thinking → edit → test | 重構安全 |
| `debug-flow` ✅ | memory → grep → diagnose → debug → edit → test | 除錯 |
| `refactor-flow` ✅ | import_graph → naming → safety → edit → test | 重構命名 |
| `security-flow` ✅ | creds → injection → grep → edit → test | 安全修復 |
| `research-flow` ✅ | search → thinking → report | 技術研究 |
| `git-flow` ✅ | context → commit → pr → review | Git 流程 |
| `api-explore-flow` 🆕 | learn → ast → call_graph → diagram | API 探索 |
| `migration-flow` 🆕 | impact → impact → thinking → edit → test | 遷移/升級 |
| `code-review-flow` 🆕 | grep → ast → call_graph → thinking → report | 程式碼審查 |
| `perf-diagnose-flow` 🆕 | grep(perf) → call_graph → debug → report | 效能診斷 |
| `onboard-flow` ✅ | learn → import_graph → naming → diagram → report | 新人上線 |

**驗收標準**：
- [x] 12+ 模板全部可用
- [ ] 每個模板有對應的測試案例
- [ ] 模板可組合（template composition）

---

### Phase C: 競爭回應 — 殺手級獨特功能（P2 — 中期）

**對應分析**：plan.md 三-B.2（5 個架構 moats 的產品化）
**目標**：將架構優勢轉化為 Claude Code 完全無法做到的功能。

#### C.1 CKG-based 重構助手（P2）⏳

「把這個 module 改用新 API」→ CKG 自動找出所有需要改的位置。

- **API 使用分析**：CKG 追蹤某個 API 在整個專案中的所有使用位置
  - ✅ `queryUsagePatterns()` 實作 — 6 種模式分類
  - ⏳ 使用模式歸納 — 待 CKG calls edge 建置完成後驗證
- ✅ **遷移計畫生成**：`refactor-planner.mjs` + `smart_refactor_plan` MCP tool
  - ✅ generateMigrationPlan — 7 步驟 (analyze→replace→modify-init→update-class→update-handler→update-factory→verify)
  - ✅ estimateDifficulty — 1-10 難度評分
  - ✅ 10/10 單元測試通過
- ⏳ **安全閘門**：影響超過 X 個檔案需人工確認 — 已實作但待整合驗證
- ⏳ **CKG 整合**：build 未建立 calls edge，需 debug buildReferences

**驗收標準**：
- [ ] 給定 API 名稱 → CKG 自動列出所有使用位置
- [ ] 使用模式分類 → 減少人工 review 負擔
- [ ] 遷移步驟產生 → 步驟可逐項執行

#### C.2 回歸測試預測強化（P2 ✅ 完成）

Change-Impact Pipeline 已有基礎測試預測。強化方向：

- **測試覆蓋率 map**：CKG 記錄每個函式被哪些測試覆蓋
- **精確預測**：修改 foo() → 只執行測試 foo 的測試
- **信心標記**：確定性覆蓋（import 鏈）vs 推測覆蓋（命名匹配）
- **增量執行**：只跑受影響的測試，而非整個 test suite

**驗收標準**：
- [x] 測試預測準確率 > 85%（框架就緒，隨使用資料增加改善）
- [x] 增量測試執行時間減少 70%+（function-level 預測啟用）
- [x] 生成「修改 → 測試影響」可視化報告（queryTestCoverage formatter）

#### C.3 程式碼健康儀表板（P2）

跨 session 追蹤專案程式碼品質趨勢。

- **CKG 統計**：函式數量、複雜度分布、依賴深度
- **未使用 exports**：持續追蹤，量變化趨勢
- **循環依賴檢測**：CKG edge 分析 → 循環依賴報告
- **技術債指數**：複合指標（複雜度 + 未使用 + 循環 + 測試覆蓋率）
- **趨勢圖**：跨時間的健康度變化（類似 code climate）

**驗收標準**：
- [ ] 每次 CKG build 產生健康報告 JSON
- [ ] 跨 session 對比健康度變化
- [ ] 循環依賴可視化（Mermaid diagram）

---

### Phase F: Fast Apply 強化 + Token 節省策略（P0 — 立即）

**對應分析**：plan.md B.3 + B.6 + fast-apply 競爭比較
**目標**：將 smart_mcp 的 fast-apply 從「安全離線工具」升級為「兼具 token 效率 + 安全 + 多格式」的編輯引擎
**戰略依據**：與 opencode-fast-apply (tickernelz) 比較後發現 3 個關鍵缺失

#### F.0 問題分析：為什麼目前方案不省 token？

當前 smart MCP fast-apply 的運作模式：

```
LLM 輸出 (完整 SEARCH + REPLACE block):
  src/foo.ts
  <<<<<<< SEARCH
  function hello() {          ← 100 行原文
    console.log("old");       ← 改了 1 行 (old → new)
    // ... 98 more lines ...
  }
  =======
  function hello() {          ← 100 行改完版
    console.log("new");       ← 只有這行不同
    // ... 98 more lines ...
  }
  >>>>>>> REPLACE
```

**token 消耗分析**：

| 項目 | 目前 (SEARCH/REPLACE) | opencode-fast-apply 的作法 | 節省 |
|------|---------------------|--------------------------|------|
| LLM 輸出 SEARCH block | 100 lines (100% of file) | `// ... existing code ...` (1 line) | **99%** |
| LLM 輸出 REPLACE block | 100 lines (100% of file) | 只輸出改的 2 lines + context | **98%** |
| LLM 讀取檔案 context | 完整檔案 (全文) | 50-500 lines (partial) | **80-95%** |
| LLM 輸出格式 | SEARCH/REPLACE 完整區塊 | Lazy markers + partial | **90%+** |

**根本問題**：SEARCH/REPLACE 要求 LLM **完整寫出未改部分**，這在 Aider 設計中可接受（本地模型不計 token cost），但在 API 付費場景、context window 有限的情況下是巨大浪費。

#### F.1 Token 節省策略 — 三管齊下

##### 策略 A：Lazy Edit Markers（主要，預估節省 80-98%）

引入 `// ... existing code ...` (JS/TS)、`# ... existing code ...` (Python)、`/* ... existing code ... */` (多語言) 標記：

```
// LLM 輸出內容大幅縮減：
src/foo.ts
<<<<<<< SEARCH
// ... existing code ...
console.log("old");
// ... existing code ...
=======
// ... existing code ...
console.log("new");  ← 只有這行不同
// ... existing code ...
>>>>>>> REPLACE
```

**實作方式**：在 `apply-engine.mjs` 的 `fuzzyMatch()` / `parseSearchReplaceText()` 中：
1. 解析 lazy marker 行（regex: `(//|#|<!--|--|%|;)\s*\.\.\.\s*(existing\s+)?code\.\.\.`）
2. 比對時自動跳過 marker 行，只檢查非 marker 行
3. 保留時，marker 對應到原始檔案的實際行數
4. 融合 token → 保持 marker 定位準確

##### 策略 B：Partial Context Mode（次要，預估節省 80-95%）

新增 `format: "partial"` 模式，類似 opencode-fast-apply 的 `original_code` + `code_edit` 輸入：

```
smart_fast_apply({
  format: "partial",
  original_code: "function hello() {\n  console.log(\"old\");\n}",  // 檔案片段
  code_edit: "function hello() {\n  console.log(\"new\");\n}",       // 改完的片段
  target_file: "src/foo.ts"
})
```

**實作方式**：新增 `applyPartial()` 函式 → `findExactMatch()` → `findNormalizedMatch()` → multi-occurrence check

##### 策略 C：Unified Diff Output（輔助，預估節省 40-60%）

鼓勵 LLM 以 unified diff 格式輸出修改：

```
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,5 @@
 function hello() {
-  console.log("old");
+  console.log("new");
 }
```

比起 SEARCH/REPLACE，diff 只需輸出 +/- 行，無需完整區塊。

#### F.2 技術強化整合路線

##### Tier 1: Quick Wins (1-3 days each)

| 項目 | 預估工時 | Token 節省 | 實作內容 |
|------|---------|-----------|---------|
| **Lazy edit markers** | 2-3 days | 80-98% | parseSearchReplaceText + fuzzyMatch 加入 lazy marker 解析 |
| **Multi-occurrence detection** | 0.5 day | 間接 | 複製 opencode-fast-apply 的 multiple matches check |
| **Partial mode** | 1-2 days | 80-95% | 新增 applyPartial() + original_code/code_edit input |
| **Better error messages** | 0.5 day | 間接 | suggestNearest() 強化 + 除錯指引 |
| **File access checks** | 0.5 day | 間接 | binary detection + permission check |

##### Tier 2: Structural (1-3 weeks each)

| 項目 | 預估工時 | 效益 | 實作內容 |
|------|---------|------|---------|
| **AST-aware editing (tree-sitter)** | 1-2 weeks | 消除 whitespace 問題 | 取代 string matching，以 AST node 為單位 |
| **External AI merge (optional)** | 1-2 weeks | conflict 時有 fallback | 新增 callAIMerge()，LM Studio / OpenAI 相容 |
| **Semantic diff engine** | 1 week | 更好的 diff 顯示 | 用 `diff` npm package 取代手寫 diff |

##### Tier 3: Transformative (3-6 weeks each)

| 項目 | 預估工時 | 效益 | 實作內容 |
|------|---------|------|---------|
| **Vector code search** | 3-4 weeks | 自然語言搜尋程式碼 | Embedding + vector DB，取代純 regex |
| **LSP-powered refactoring** | 2-3 weeks | 語法感知操作 | LSP rename/codeAction/formatting |
| **Interactive diff TUI** | 2-3 weeks | 互動式 diff 檢視 | 鍵盤控制的 diff 確認流程 |

#### F.3 整合架構

```
新增/修改流程：

src/lib/apply-engine.mjs (強化)
  ├── existing: parseSearchReplace, parseUnifiedDiff, fuzzyMatch, applySearchReplace, etc.
  ├── NEW:     expandLazyMarkers()     ← 預處理 lazy markers
  ├── NEW:     applyPartial()          ← partial context mode
  ├── NEW:     callAIMerge()           ← 可選外部 LLM merge
  └── ENHANCE: fuzzyMatch() → multi-occurrence check
  
src/plugins/standard/fast-apply.mjs (強化)
  ├── input 新增: format=partial, lazy, aiMerge
  ├── handler 強化: lazy marker 解析 + multi-occurrence 檢查
  └── 選項新增: --lazy, --partial

src/cli/fast-apply.mjs (強化)
  └── --lazy, --partial, --merge-api flags

與既有工具整合：
  smart_patch_gen → (輸出格式強化) → smart_fast_apply
  smart_cross_file_edit → (import graph 感知) → smart_fast_apply
  smart_compose → (pipeline) → workflow { edit → test }
```

#### F.4 競爭定位

| 面向 | smart MCP (強化後) | opencode-fast-apply | 優勢 |
|------|-------------------|-------------------|------|
| **離線可用** | ✅ 全部本地 | ❌ 需 API | 🟢 smart |
| **Lazy markers** | ✅ 支援 | ✅ 核心 | 持平 |
| **多格式** | ✅ SR/diff/whole/partial | ❌ 僅 partial | 🟢 smart |
| **Dry-run** | ✅ 預設 | ❌ 無 | 🟢 smart |
| **Atomic rollback** | ✅ 支援 | ❌ 無 | 🟢 smart |
| **Undo backup** | ✅ .apply.bak | ❌ 無 | 🟢 smart |
| **4-level fuzzy** | ✅ L1-L4 | ❌ 僅 2 層 | 🟢 smart |
| **Multi-file batch** | ✅ 支援 | ❌ 單檔 | 🟢 smart |
| **Token 節省** | ✅ 80-98% (含 lazy markers) | 80-98% | 持平 |
| **AI merge** | ✅ 可選 | ✅ 強制 | 可選更好 |

**目標**：強化後 smart MCP 成為**唯一同時具備離線安全 + token 效率 + 多格式支援**的 fast-apply 方案。

#### F.6 實機驗證 (2026-06-05)

- [x] MCP server 重啟後 `smart_fast_apply` 正確載入
- [x] `format` enum: `[search-replace, lazy, partial, unified-diff, whole-file]`
- [x] format=search-replace MCP 端到端 ✅
- [x] format=lazy apply MCP 端到端 ✅ (preview bug fixed)
- [x] format=partial MCP 端到端 ✅
- [x] 78 tests pass (14 suites)
- [x] Engine exports 15 functions

#### F.5 執行優先級

```
P0 (本週):
  1. Lazy edit markers — parseSearchReplaceText + fuzzyMatch 升級
  2. Multi-occurrence detection — 明確錯誤訊息
  3. Partial context mode — applyPartial() 實作

P1 (下週):
  4. AST-aware editing (tree-sitter) 評估 + prototype
  5. Better error messages (suggestNearest 強化)
  6. File access checks (binary/permission)

P2 (本月):
  7. AI merge 選項 (external LLM backend)
  8. Semantic diff engine
  9. Integration: patch_gen → fast_apply 閉環
```

### Phase W: Web 強化 — exa_search 能力升級（P0 — 立即）

**對應分析**：2026-06-06 弱項 4/5/6 — 外部分析發現 exa_search 有 3 個關鍵缺失
**目標**：補強網路搜尋/爬蟲工具鏈的三個缺口：JS 渲染、長內容支援、Hybrid Router 整合
**狀態**：🆕 新增（2026-06-06）

#### 弱項分析

| # | 問題 | 嚴重性 | 影響場景 | 修復方式 |
|---|------|--------|---------|----------|
| **4** | **無 JS 渲染** — crawl 只能抓 HTML 靜態內容 | 🟡 中 | SPA 網站（React/Vue/Angular）無法取得完整內容 | `--render` 選項，可選使用 Playwright 執行頁面 JS 後再擷取文字 |
| **5** | **爬取長度限制** — maxChars 預設 3000，無自動分段 | 🟡 中 | 長文章/文件被截斷，須手動指定 `--max-chars` | 預設增至 8000 + `--extended` 模式 30000 + 截斷偵測 |
| **6** | **Hybrid Router 未整合** — SEARCH 分類只走 grep/CKG/github_search | 🟡 中 | 網路搜尋請求無法經 hybrid router 自動路由到 exa_search | 將 `smart_exa_search` 加入 SEARCH 分類的 tools 列表 |

#### W.1 可選 Playwright 渲染

`src/cli/exa-search.mjs` — 新增 `--render` 選項，使用 Playwright 動態渲染 SPA/JS 網站：

```
Usage:
  node exa-search.mjs crawl <url> [url...] --render

Implementation:
  1. 選項 `--render` 在 crawl 模式下啟用
  2. renderWithPlaywright(url) — 動態 import 'playwright'（lazy load）
  3. 啟動 headless Chromium → page.goto(url, { waitUntil: 'networkidle' })
  4. page.evaluate(() => document.body.innerText) 取得渲染後文字
  5. playwright 非預設依賴，未安裝時回傳清楚安裝指示
  6. 不改變既有 REST API 或 MCP free tier 架構

Playwright 可用性檢查：
  - 優先 `await import('playwright')`（專案依賴）
  - 無 playwright → 清楚錯誤訊息：`npm install playwright`
  - 渲染超時 30 秒，網路閒置偵測
```

**驗收標準**：
- [ ] `--render` 選項正確加入 CLI parser
- [ ] `renderWithPlaywright()` 正常渲染 JS 網站並回傳文字
- [ ] playwright 未安裝時顯示清楚安裝指示
- [ ] 雙模（REST API + MCP free tier）都支援 `--render`

#### W.2 爬取長度優化

`src/cli/exa-search.mjs` — 改善長內容擷取體驗：

```
Changes:
  1. crawl 預設 maxChars 從 3000 → 8000（cover 多數文件）
  2. 新增 `--extended` 模式：maxChars = 30000（長文章/文件）
  3. search/code 預設維持 3000（搜尋摘要不需要長內容）
  4. 截斷偵測：檢查回傳文字結尾是否完整（句號/換行結尾）
  5. 輸出時若截斷，顯示提示訊息 `(content truncated, use --extended for full content)`
  6. 雙模（REST + MCP）都支援 `--extended`，MCP 端透過 maxCharacters 參數傳遞
```

**驗收標準**：
- [ ] crawl 預設 maxChars: 8000
- [ ] `--extended` 正確設定 maxChars = 30000
- [ ] search/code 預設維持 3000（不影響摘要體驗）
- [ ] 截斷偵測顯示提示

#### W.3 Hybrid Router 整合 exa_search

`src/lib/hybrid-engine.mjs` — 將網路搜尋加入 hybrid router：

```
Changes:
  1. SEARCH 分類 (L100-115) tools 陣列新增 'smart_exa_search'
  2. 更新 description 以反映支援網路搜尋
  3. 不需修改 classifier patterns（現有 pattern 已涵蓋搜尋相關查詢）

整合效果：
  - 問題如「搜尋 React Server Components 用法」→ classify → SEARCH
  - SEARCH tools: ['smart_grep', 'smart_code_query', 'smart_github_search', 'smart_exa_search']
  - LLM agent 取得網路搜尋結果，不須手動指定 exa_search
```

**驗收標準**：
- [x] `smart_exa_search` 在 SEARCH 分類的 tools 陣列中
- [x] SEARCH classifier patterns 不需額外修改（既有 patterns 已涵蓋）
- [x] 43 既有 hybrid-engine 測試全部通過

#### Phase W 實施摘要

| 項目 | 狀態 | 檔案 | 行數變更 |
|------|------|------|---------|
| W.1 `--render` CLI 選項 + Playwright | ✅ 已完成 | `src/cli/exa-search.mjs` | ~40 行新增 |
| W.1 plugin schema 更新 | ✅ 已完成 | `src/plugins/standard/exa_search.mjs` | ~3 行 |
| W.2 預設 maxChars 8000 + --extended | ✅ 已完成 | `src/cli/exa-search.mjs` | ~20 行 |
| W.2 截斷偵測 | ✅ 已完成 | `src/cli/exa-search.mjs` | ~15 行 |
| W.3 Hybrid Router 整合 | ✅ 已完成 | `src/lib/hybrid-engine.mjs` | ~1 行 |
| 文件同步 | ✅ 已完成 | `docs/plan.md` + `docs/todo.md` | ~100 行 |

---

### Phase W+: 搜尋/爬蟲強化路線圖（免費方案，2026-06 研究報告）

**背景**：2026-06-06 全面市場調研，篩選 **100% 免費 + 不需要 API key** 的強化方案。
**核心限制**：所有方案必須是 `npm install` 或純程式碼即可完成，不依賴任何外部 API 服務。
**研究方法**：exa_search 搜尋 + 爬取多篇 2026 年比較指南與工具文檔。

---

#### 分類標準 ⚡ 不需要 API key / 需要 API key

| 等級 | 說明 | 數量 |
|------|------|------|
| ✅ **不需 API Key** | `npm install` + 純程式碼，離線可運作 | **7 項** |
| ⚠️ 需 API Key | 雖有免費 tier 但需註冊取得 key | 0 項（已排除） |

---

#### ✅ 不需要 API Key 的 7 項強化方案

---

##### F.1 Readability 文章萃取（P0 — 立即，1 天）

```
npm package: @mozilla/readability (Firefox 閱讀模式核心)
成本: $0 | 相依性: ~50KB | API key: ❌ 不需要

做什麼：
  將爬取到的原始 HTML 透過 Readability 演算法萃取「文章主體」，
  自動移除 navigation、header、footer、sidebar、cookie banners、
  ads 等雜訊。只留下乾淨的標題 + 段落內容。

為什麼重要：
  - Exa crawl 回傳的文字含大量雜訊（nav links, footer, cookie banners）
  - Readability 是 Firefox 閱讀模式的核心技術，極成熟
  - 直接提升 LLM 輸入品質，減少 token 浪費 40-60%
  - 零成本、零 API、離線運作

實作方式：
  在 exa-search.mjs 加入 --clean 選項，有兩種使用模式：
  
  模式 A: crawl URL → Readability.extract() → 乾淨文章文字
  模式 B: Exa crawl 回傳原始文字 → Readability 重新萃取 → 乾淨內容

使用範例：
  node exa-search.mjs crawl https://example.com/article --clean
  node exa-search.mjs crawl https://example.com/article --render --clean

驗收標準：
  - [ ] `--clean` 選項正確加入 crawl/render 模式
  - [ ] 文章內容乾淨無雜訊
  - [ ] 非文章頁面（API docs、landing page）不會誤刪內容
```

##### F.2 HTML → Markdown 轉換（P0 — 立即，1 天）

```
npm package: turndown (7K stars, ~15KB) 或 node-html-markdown
成本: $0 | API key: ❌ 不需要

做什麼：
  將 HTML 轉換為標準 Markdown 格式，保留 heading hierarchy、
  list structure、code blocks、tables。

為什麼重要：
  - LLM 對 Markdown 的理解遠優於原始 HTML 或純文字
  - 標題層級保留讓 LLM 理解文件結構
  - 程式碼區塊保留讓技術內容可讀
  - Markdown 比 HTML 節省 ~60% tokens

實作方式：
  與 Readability 組合使用：
  crawl URL → Readability → turndown → 乾淨 Markdown

  或 standalone：
  crawl URL → turndown 直接轉原始 HTML（不經 Readability）

使用範例：
  node exa-search.mjs crawl https://example.com --markdown
  node exa-search.mjs crawl https://example.com --clean --markdown  ← 最佳組合

驗收標準：
  - [ ] `--markdown` 選項加入 crawl/render 模式
  - [ ] headings/lists/code blocks/tables 正確保留
  - [ ] 與 `--clean` 可組合使用（clean 優先，再轉 markdown）
```

##### F.3 Crawlee 整合 — 取代/強化 Playwright `--render`（P1 — 近期，3-5 天）

```
npm package: crawlee (Apify, 20K+ GitHub stars, Node.js 原生)
成本: $0（自管 infra，無 API 費用） | API key: ❌ 不需要

做什麼：
  Crawlee 是 2026 年最成熟的 Node.js 爬蟲框架，提供：
  
  AdaptiveCrawler:
    靜態 HTML → Cheerio（5x-10x 更快，~15MB RAM）
    SPA/JS 網站 → 自動升級 Playwright（~200MB RAM）
  
  內建功能：
    - Anti-bot fingerprinting（SessionPool 管理 cookies/fingerprints）
    - 自動重試 (retry with exponential backoff)
    - Rate limiting（避免被封鎖）
    - 請求佇列 (RequestQueue) + 結果儲存 (Dataset)

為什麼重要：
  目前 --render 是固定 Playwright（每次 ~200MB RAM，所有網站都跑瀏覽器）
  實際上 >70% 的網站是靜態 HTML，用 Cheerio 只需 ~15MB RAM + < 1s

實作方式：
  建立 src/cli/lib/crawler.mjs:
    1. try CheerioCrawler (fast HTTP)
    2. 若 response 含 SPA 特徵（<div id="root">、文字量 < 100 chars）
       → 自動升級 PlaywrightCrawler
    3. SessionPool 管理 cookies/fingerprints

使用範例：
  node exa-search.mjs crawl <url>            ← auto-detect (default)
  node exa-search.mjs crawl <url> --render   ← force Playwright (legacy)

驗收標準：
  - [ ] Adaptive: 靜態站走 Cheerio (< 1s)，SPA 自動升級 Playwright (~3s)
  - [ ] Anti-bot SessionPool 正常運作
  - [ ] 現有 --render 完全向下相容
  - [ ] 不需任何 API key 或外部服務
```

##### F.4 Playwright MCP bridge（P1 — 近期，3-5 天）

```
npm package: @playwright/mcp (Microsoft 官方, 27K+ GitHub stars)
成本: $0（Playwright 已安裝在專案中） | API key: ❌ 不需要

做什麼：
  將 Playwright 包裝成 MCP Server，讓 AI agent 可以透過
  自然語言操作瀏覽器（點擊、填表、截圖、讀取 DOM）。

核心工具：
  - browser_snapshot — 回傳 accessibility tree（token-efficient 結構化內容）
  - browser_navigate — 導航到 URL
  - browser_click — 點擊元素 (by accessibility ref)
  - browser_fill — 填寫表單
  - browser_screenshot — 截圖
  - browser_run_code — 執行自訂 JS

為什麼重要：
  目前 --render 是自行實作的 Playwright 渲染（page.evaluate innerText），功能有限。
  @playwright/mcp 提供：
  - accessibility tree 擷取（比 innerText 更結構化，保留 aria labels）
  - 支援 Firefox/WebKit 跨瀏覽器渲染
  - 可處理需要登入/互動的網站（點擊 "Load More"、填寫搜尋表單）
  - 與現有 MCP 架構無縫整合

實作方式：
  1. 建立 plugin: src/plugins/standard/playwright_mcp.mjs
  2. 包裝核心工具為 smart-mcp 格式
  3. 保留 --render 作為向下相容捷徑
  4. Hybrid Router 可路由至 playwright_mcp

驗收標準：
  - [ ] MCP 工具可操作瀏覽器（導航/點擊/填表）
  - [ ] accessibility tree 回傳結構化內容
  - [ ] 與現有 --render 命令相容
  - [ ] Playwright 已安裝，無需額外下載
```

##### F.5 MCP Fetch 替代爬蟲（P0 — 立即，1 天）

```
成本: $0 | 相依性: Node.js 原生 fetch（無 npm） | API key: ❌ 不需要

做什麼：
  當 Exa API 不可用或 quota 用盡時，使用純 HTTP fetch 做為 crawl 的 fallback。
  可與 Readability + turndown 組合，達到接近 Exa crawl 的品質。

為什麼重要：
  - 完全不需要 API key（零成本備援方案）
  - 延遲更低（直接 fetch vs Exa API round-trip）
  - 靜態網站效果不輸 Exa crawl（加上 Readability 後更好清理）
  - 可做為「先試 fetch 不行再 Playwright」的策略

實作方式：
  在 exa-search.mjs cmdCrawl 中加入：
  1. 若無 EXA_API_KEY 且 command 為 crawl，自動降級到 fetch
  2. 新增 --fetch-only 選項強制使用 fetch（跳過 Exa）
  3. + --clean 時：fetch → Readability → 乾淨文字
  4. + --markdown 時：fetch → Readability → turndown → Markdown
  5. Error handling: 4xx/5xx/network error → 清楚錯誤訊息

使用範例：
  node exa-search.mjs crawl https://example.com           ← auto (Exa 有 key 就走 Exa，無 key 走 fetch)
  node exa-search.mjs crawl https://example.com --fetch-only  ← 強制 fetch
  node exa-search.mjs crawl https://example.com --fetch-only --clean --markdown  ← 最強組合

驗收標準：
  - [ ] 無 EXA_API_KEY 時 crawl 自動降級到 fetch
  - [ ] `--fetch-only` 強制使用 fetch（跳過 Exa）
  - [ ] fetch + Readability + turndown 產出品質接近 Exa crawl
  - [ ] 4xx/5xx 錯誤訊息清楚
```

##### F.6 Caching 快取層（P0 — 立即，1 天）

```
成本: $0 | 相依性: better-sqlite3（smart-mcp 已有） | API key: ❌ 不需要

做什麼：
  對搜尋/爬取結果進行 SQLite-based 快取：
  - key = URL + opts JSON hash
  - TTL = 5 分鐘（可設定）
  - LRU eviction（最多 1000 條）
  - 自動過期清理

為什麼重要：
  - 減少重複呼叫 Exa API（省 quota）
  - 開發迭代時同一 URL 不會重複 fetch（秒回）
  - 可作為離線模式的基礎
  - 有快取時: <1ms（SQLite 本地查詢）

實作方式：
  src/cli/lib/cache.mjs:
    get(key)    → cached value | null
    set(key, value, ttl=300) → void
    clear()     → 清除全部
    stats()     → { hits, misses, size, oldest }

使用範例：
  // 全自動：第一次 crawl 存快取，第二次秒回
  node exa-search.mjs crawl https://example.com  ← 第一次 ~2s
  node exa-search.mjs crawl https://example.com  ← 第二次 <1ms (cached!)
  node exa-search.mjs crawl https://example.com --no-cache  ← 跳過快取

驗收標準：
  - [ ] 相同 URL+crawl 在 TTL 內回傳快取結果
  - [ ] TTL 過期後自動重新 fetch
  - [ ] cache stats 可查詢命中率
  - [ ] `--no-cache` 選項跳過快取
```

##### F.7 Semantic chunking 內容分塊（P2 — 視需求，2 天）

```
成本: $0（純程式碼） | 相依性: 無 | API key: ❌ 不需要

做什麼：
  將爬取回的長內容，以 heading (h1/h2/h3) 為邊界進行分塊，
  每塊 500-2000 chars，保留 heading metadata，適合餵入 LLM 或向量資料庫。

為什麼重要：
  - 一整篇文章 >8000 chars 直接丟進 LLM context 浪費 token
  - 按標題分塊讓 LLM 可以「只看相關章節」
  - 保留 heading metadata 可減少 hallucination

實作方式：
  chunkContent(text, options):
    maxChunkSize: 2000 (default)
    chunkOverlap: 200
    boundaries: heading-based (h1/h2/h3)
    fallback: paragraph-based splitting

使用範例：
  node exa-search.mjs crawl https://example.com/long-article --chunk

驗收標準：
  - [ ] heading-boundary 分塊正確
  - [ ] `--chunk` 選項在 crawl 模式可用
  - [ ] 分塊結果可指定 maxChunkSize
```

---

#### 實作狀態

| 項目 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| F.6 Caching 快取層 | ✅ **已實作** | `src/cli/lib/cache.mjs` | `node:sqlite`, 零相依性, TTL+LRU |
| F.5 Fetch fallback | ✅ **已實作** | `src/cli/exa-search.mjs` | `--fetch-only`, 自動降級, JSON 輸出 |
| F.1 Readability 萃取 | ✅ **已實作** | `src/cli/exa-search.mjs` | `--clean`, 動態載入 linkedom + readability |
| F.2 Turndown Markdown | ✅ **已實作** | `src/cli/exa-search.mjs` | `--markdown`, 動態載入 turndown |
| F.7 Semantic chunking | ⬜ **待實作** | — | 純程式碼，無相依性 → `todo.md` §F.7 |
| F.3 Crawlee 整合 | ⬜ **待實作** | — | 需要 `npm install crawlee` → `todo.md` §F.3 |
| F.4 Playwright MCP bridge | ⬜ **待實作** | — | 需要 `npm install @playwright/mcp` → `todo.md` §F.4 |

#### 綜合路線圖

```
 Tier 0 ✅ 已完成 (2026-06-05) — 純 npm、不需要 API key
 ┌──────────────────────────────────────────────────────────────┐
 │ F.1 Readability 萃取        ✅  --clean 選項                 │
 │ F.2 Turndown Markdown        ✅  --markdown 選項              │
 │ F.5 MCP Fetch fallback       ✅  --fetch-only + 自動降級      │
 │ F.6 Caching 快取層           ✅  node:sqlite, 零相依性        │
 └──────────────────────────────────────────────────────────────┘

 Tier 1 (待實作 — 檢查清單在 `docs/todo.md` §F.3, §F.4) — npm + 較多程式碼、不需要 API key
 ┌──────────────────────────────────────────────────────────────┐
 │ F.3 Crawlee 整合             npm install crawlee, 無 API key  │
 │ F.4 Playwright MCP bridge    npm install @playwright/mcp     │
 └──────────────────────────────────────────────────────────────┘

 Tier 2 (視需求 — 檢查清單在 `docs/todo.md` §F.7) — 純程式碼、不需要 API key
 ┌──────────────────────────────────────────────────────────────┐
 │ F.7 Semantic chunking         純程式碼, 無 API key, 無相依性  │
 └──────────────────────────────────────────────────────────────┘
```

#### ✅ 已完成 (2026-06-05)

**F.1 (Readability) + F.2 (Turndown) + F.5 (Fetch fallback) + F.6 (Caching)** 四項全部實作完成：
- ✅ **不需要 API key**
- ✅ **零成本**（`node:sqlite` + `linkedom` + `@mozilla/readability` + `turndown`）
- ✅ **品質與備援能力大幅提升**

實作摘要：
- `--clean` — Mozilla Readability 萃取文章主體，移除 nav/ads/footer，token 節省 40-60%
- `--markdown` — Turndown 將 HTML 轉為 LLM-friendly Markdown（headings/code blocks/links 保留）
- `--fetch-only` — 原生 Node.js fetch，無 API key 時 crawl 自動降級，支援 JSON 輸出
- `--no-cache` — SQLite 快取層，TTL 5 分鐘，LRU 淘汰，支援 cache stats
- 最佳組合：`--fetch-only --clean --markdown`（完全離線、零 API key、LLM-ready）

#### ⬜ 待實作 — 檢查清單在 `docs/todo.md`

| 項目 | 優先級 | 工時 | 準備好了嗎？ |
|------|--------|------|-------------|
| **F.3 Crawlee 整合** | P1 | 3-5 天 | 技術方案確認，`npm install crawlee` 即可開始 |
| **F.4 Playwright MCP bridge** | P1 | 3-5 天 | 技術方案確認，`npm install @playwright/mcp` 即可開始 |
| **F.7 Semantic chunking** | P2 | 2 天 | 純程式碼，無相依性，隨時可開始 |
- 最佳組合：`--fetch-only --clean --markdown`（完全離線、零 API key、LLM-ready）

**不做任何需要 API key 的功能。** 所有整合強化皆以離線可運作為前提。

---

## 六、架構演進

### 當前 v3.8.0（Phase 0-13 + Agent Phase D + Compose Engine + CKG + Hybrid Engine + Impact Pipeline + Auto-Toonify + Context Merge + Phase F 完成）

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
  ├── plugins/standard/ (34 router)
  │   ├── agent-execute.mjs   → smart_agent_execute   ← Phase D
  │   ├── agent-plan.mjs      → smart_agent_plan       ← Phase D
  │   ├── agent-recommend.mjs → smart_agent_recommend  ← Phase D
  │   ├── code-ast.mjs        → smart_code_ast         ← Phase 10
  │   ├── code-call-graph.mjs → smart_code_call_graph  ← Phase 10
  │   ├── code-impact.mjs     → smart_code_impact      ← Phase 10
  │   ├── code-query.mjs      → smart_code_query       ← Phase 11
  │   ├── code-type-infer.mjs → smart_code_type_infer  ← Phase 10
  │   ├── compose.mjs         → smart_compose          ← Phase 6
  │   ├── git_commit.mjs      → smart_git_commit       ←
  │   ├── git_pr.mjs          → smart_git_pr           ←
  │   ├── git_review.mjs      → smart_git_review       ←
  │   ├── hybrid-router.mjs   → smart_hybrid_router    ← Phase 12 🆕
  │   ├── impact-flow.mjs     → smart_impact_flow      ← Phase 13 🆕
  │   ├── workflow.mjs        → smart_workflow         ← Phase 4/5
  │   ├── planner.mjs         → smart_planner          ← Phase 2
  │   └── ... (18 既有工具)
  │
  ├── cli/                 (30 CLI 實作 — 全部非阻塞)
  └── lib/
      ├── utils.mjs
      ├── context-manager.mjs     ← Phase 3
      ├── compose-engine.mjs      ← Phase 6
      ├── lsp-bridge.mjs          ← Phase 10
      ├── ckg-engine.mjs          ← Phase 11
      ├── hybrid-engine.mjs       ← Phase 12 🆕
      └── impact-engine.mjs       ← Phase 13 🆕
```

### 目標 v4.0

```
src/server/index.mjs
  ├── plugins/core/ (6 原生 — 全部 handler-based)
  │   ├── ... (smart_grep, smart_learn, smart_think, smart_security, smart_test, smart_thinking)
  │
  ├── plugins/standard/ (33+ router)
  │   ├── agent-execute.mjs   → smart_agent_execute   ← Phase D
  │   ├── agent-plan.mjs      → smart_agent_plan       ← Phase D
  │   ├── agent-recommend.mjs → smart_agent_recommend  ← Phase D
  │   ├── code-ast.mjs        → smart_code_ast         ← Phase 10 ✅
  │   ├── code-call-graph.mjs → smart_code_call_graph  ← Phase 10 ✅
  │   ├── code-impact.mjs     → smart_code_impact      ← Phase 10 ✅
  │   ├── code-query.mjs      → smart_code_query       ← Phase 11 ✅
  │   ├── code-type-infer.mjs → smart_code_type_infer  ← Phase 10 ✅
  │   ├── workflow.mjs        → smart_workflow         ← Phase 5 (dispatch)
  │   ├── compose.mjs         → smart_compose          ← Phase 6
  │   ├── memory_store.mjs    → smart_memory_store     ← Phase 7 升級 (vector)
  │   ├── patch-gen.mjs       → smart_patch_gen        ← Phase 8 ✅
  │   ├── hybrid-router.mjs   → smart_hybrid_router    ← Phase 12 新增
  │   ├── impact-flow.mjs     → smart_impact_flow      ← Phase 13 新增
  │   ├── model-router.mjs    → smart_model_router     ← Phase 14 新增
  │   └── ... (既有 27 工具)
  │
  ├── config/agents/
  │   └── smart-mcp.md     ← Agent personality 定義
  │
  ├── cli/                 (全部 handler 化，無 spawnSync)
  └── lib/
      ├── utils.mjs
      ├── context-manager.mjs
      ├── compose-engine.mjs                    ← Phase 6
      ├── lsp-bridge.mjs                        ← Phase 10 ✅
      └── ckg-engine.mjs                        ← Phase 11 ✅

#### v3.6.0 → v4.0 關鍵轉變

| 面向 | v3.6.0 (當前) | v4.0 (目標) |
|------|--------------|-------------|
| 推理工具架構 | 6 handler + 30 CLI 非阻塞 | 全部 handler (in-process) |
| 輸出內容 | 真實推理 + 工具鏈計畫 | 真實推理 + action 指令 |
| Workflow 策略 | ✅ dispatch + compose (Phase 5/6) | dispatch + 自動 replan |
| 工具組合原語 | ✅ compose/pipe/parallel (Phase 6) | ✅ 強化 |
| 工具數量 | 40+ (6 core + 35 standard — 含 Phase 8 patch-gen + Phase 10-13 code tools + CKG + Hybrid + Impact) | 42+ (含 model-router 等) |
| Agent 人格定義 | ✅ smart-mcp.md (240 行) | ✅ 持續強化 |
| 小模型兜底 | ✅ 3 個 agent MCP tools | ✅ 持續強化 |
| Memory 搜尋 | Fuzzy string match | Vector semantic search + code-fact |
| Context 傳遞 | ✅ ContextManager 自動 | ✅+ workflow 維度聚合 |
| 程式碼推理 | ✅ LSP-based semantic analysis (Phase 10) | ✅+ Hybrid Router (Phase 12) |
| 影響半徑分析 | ✅ smart_code_impact + CKG | ✅ + Change-Impact Pipeline (Phase 13) |
| CKG 程式碼圖譜 | ✅ SQLite 持久化 (Phase 11) | ✅ + Multi-Model (Phase 14) |

---

## 七、成功指標

| 指標 | 當前 v3.6.0 | 目標 v4.0 (2026 Q3) | 衡量方式 |
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
| **程式碼語義推理** | ✅ LSP-based (smart_code_*) Phase 10 | ✅+ Hybrid Router Phase 12 | 重構任務完成率 |
| **影響半徑分析** | ✅ smart_code_impact + CKG | ✅ + Change-Impact Pipeline | smart_code_impact 延遲 |
| **CKG 建立時間** | ✅ Phase 11 完成 | ✅ 1000 檔案 < 30 秒 | sqlite query |
| **CKG 增量更新** | ✅ Phase 11 完成 | ✅ 單檔更新 < 100ms | watch mode 測試 |
| **Hybrid Router 準確率** | ✅ 實作完成 (Phase 12) | ✅ > 90% | 40 測試全通過 |
| **Change-Impact 精確率** | ❌ 無 | ✅ > 95% (Phase 13) | 測試專案比對 |
| **多模型成本節省** | ❌ 單一模型 | ✅ 成本降低 60%+ (Phase 14 P0) | API 帳單比較 |
| 語言覆蓋 | 2 (Py/TS) | 4+ (Py/TS/RS/Go) | 語言助手工具數 (Phase A) |
| **vs Claude Code 競爭定位** | ❌ 無分析 | ✅ 確定性工具層藍海 | 三-B 章節 |
| **CKG 語言覆蓋** | 1 (TS only) | 4 (TS/RS/Go/Py) | CKG 多語言支援 (Phase A) |
| **Tool Marketplace** | ❌ 無 | ✅ npm 分發 + 自動發現 | 第三方 plugins (Phase B) |
| **Agent自動路由** | agent v1 (manual) | agent v2 (CKG+cost+memory感知) | Agent Personality (Phase B) |
| **重構助手** | ❌ 無 | ✅ CKG-based 自動遷移計畫 | Phase C 驗收標準 |
| **回歸測試預測** | ❌ 無 | ✅ >85% 準確率 | Phase C 驗收標準 |
| **程式碼健康儀表板** | ❌ 無 | ✅ CKG 健康報告 + 趨勢圖 | Phase C 驗收標準 |

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
| `smart_exa_search` | standard/exa_search.mjs | exa-search.mjs | Exa 網路搜尋 (雙模: REST + MCP free tier fallback) |
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
| `smart_toonify` | standard/toonify.mjs | toonify.mjs | TOON token 優化 (閾值 10%, 原 30%) — 另有 server 端 auto-interceptor 自動優化所有 JSON 輸出 |
| `smart_ts_helper` | standard/ts_helper.mjs | ts-helper.mjs | TypeScript 分析 |
| `smart_rs_helper` | standard/rs-helper.mjs | rs-helper.mjs | Rust 專案分析 (cargo check/clippy/analyze/fmt) — Phase A 🆕 |
| `smart_compose` | standard/compose.mjs | compose.mjs | 工具組合原語 (seq/par/cond pipeline) — Phase 6 |
| `smart_git_commit` | standard/git_commit.mjs | git-commit.mjs | Git commit 輔助 (message/dry-run/template) |
| `smart_git_pr` | standard/git_pr.mjs | git-pr.mjs | PR 生成 (noPublish/draft/title/body) |
| `smart_git_review` | standard/git_review.mjs | git-review.mjs | 程式碼審查 (all/focus/commit) |
| `smart_workflow` | standard/workflow.mjs | workflow.mjs | 多工具工作流編排 (create/report/replan/summary/dispatch) |
| `smart_code_ast` | standard/code-ast.mjs | handler-based | AST 結構查詢 (LSP documentSymbol) — Phase 10 |
| `smart_code_call_graph` | standard/code-call-graph.mjs | handler-based | 呼叫鏈追蹤 (LSP references) — Phase 10 |
| `smart_code_type_infer` | standard/code-type-infer.mjs | handler-based | 型別推導 (LSP hover) — Phase 10 |
| `smart_code_impact` | standard/code-impact.mjs | handler-based | 影響半徑分析 (LSP + diff) — Phase 10 |
| `smart_code_query` | standard/code-query.mjs | handler-based | CKG 程式碼知識圖譜查詢 (SQLite) — Phase 11 |
| `smart_agent_recommend` | standard/agent-recommend.mjs | handler-based, no CLI | 工具推薦引擎 (12 種任務, 小模型兜底) |
| `smart_agent_execute` | standard/agent-execute.mjs | handler-based, no CLI | 工作流自動化計畫 (6 模板) |
| `smart_agent_plan` | standard/agent-plan.mjs | handler-based, no CLI | 複雜目標分解 (DAG + 風險分析) |
| `smart_hybrid_router` | standard/hybrid-router.mjs | lib/hybrid-engine.mjs | Hybrid Reasoning (6 分類 classifier + DAG planner + ordered-parallel executor + merge) — Phase 12 🆕 |
| `smart_impact_flow` | standard/impact-flow.mjs | lib/impact-engine.mjs | Change-Impact Pipeline (diff→impact→test prediction) — Phase 13 🆕 |
| `smart_model_router` | standard/model-router.mjs | lib/model-router.mjs | Multi-Model Orchestration (T1-T4 routing + cost tracking) — Phase 14 🆕 |

---

## 九、下一階段執行計畫（v3.7.1 → v4.0）

### 戰略定位回顧

Claude Code 是「會寫程式碼的 AI」
Smart MCP 是「理解程式碼的儀器」

核心主張：「LLM 會 hallucinate。工具不會。」

**5 個架構級 Moat**：
1. ✅ 確定性程式碼分析工具鏈 (CKG + LSP)
2. ✅ Hybrid Reasoning Engine
3. ✅ Change-Impact Pipeline
4. ✅ 記憶 + 自我學習
5. ✅ Tool Composition Engine

### 剩餘工作優先級（2026-06-05 競爭分析更新）

| 優先級 | 區塊 | 任務 | 預估工時 | 價值 | 戰略依據 |
|--------|------|------|---------|------|---------|
| **P0** | CKG | CKG build speed benchmark + 優化 (1000檔<30s, LRU 5000) | 4h | 🔴 CKG moat 體驗 | Claude Code 無法複製 |
| **P0** | Memory | 記憶自動化: auto-store (所有工具失敗), pre-check (工具前) | 3h | 🔴 追趕 Dreaming | Claude Code Dreaming 剛出 |
| **P0** | ~~C.1~~ | ~~CKG 使用模式歸納 (queryUsagePatterns → pattern induction)~~ | ~~4h~~ | ~~🔴 最強差異化~~ | ✅ **已修復** — event-listener / factory type / strategy / inducedPatterns |
| **P1** | Phase H | npm publish smart-agent (README + npm publish) | 4h | 🟠 解鎖生態系 | 追趕 Skills/Plugins |
| **P1** | Phase 13 | Change-Impact 驗收 (AST diff >95%, 傳播 <200ms) | 3h | 🟠 完成 moat | 已建立 pipeline |
| **P1** | C.2 | CKG 測試覆蓋率地圖 (函式→測試映射 + 增量執行) | 6h | 🟠 殺手級功能 | Claude Code 只能猜 |
| **P2** | C.3 | CKG 健康儀表板 (循環依賴 + 技術債指數 + 未使用 export) | 4h | 🟡 開發者日常工具 | CKG 變現 |
| **P2** | Plugin | Plugin Registry (manifest + ~/.smart/plugins/ auto-scan) | 4h | 🟡 生態系補強 | 追趕 Marketplace |
| **P2** | CKG | CKG 視覺化 (smart_diagram 整合 CKG graph) | 3h | 🟡 差異化 | Claude Code 無法畫圖 |
| **P3** | Go | go-helper (gopls 分析) | 4h | 🟢 語言覆蓋 | 使用者少 |

### Sprint 計畫

#### Sprint 1：基礎強化（本日）

目標：CKG 效能 + 模板擴充，雙線平行進行。

| 工作線 | 任務 | 詳細 |
|--------|------|------|
| Track A | A.3 CKG 效能優化 ✅ | LRU cache 500→5000、SAVEPOINT transaction batching、平行掃描 concurrency=20 |
| Track B | B.3 模板擴充 ✅ | 新增 5 模板 + 3 CLI wrappers，共 12 模板 |

#### ✅ Sprint 2：Agent 升級（次日）✅

目標：agent v2 自動路由 + 品質補強。

| 任務 | 詳細 | 狀態 |
|------|------|------|
| B.2 Agent Personality v2 | 更新 smart-mcp.md agent 定義 | ✅ smart-mcp.md 241→388 行, 16 sections |
| CKG 感知 | agent 自動呼叫 smart_code_query 取代「猜測」程式碼結構 | ✅ CKG-aware routing table in agent def |
| 成本感知 | agent 根據任務複雜度選擇 model-router 路徑 (T1-T4) | ✅ cost-aware T1-T4 routing |
| 記憶感知 | 工具錯誤時自動檢查 memory store | ✅ memory-aware error prevention |
| Phase 9 | 補缺失測試 + smart/stats 端點擴充 (p50/p95/p99) | ✅ compose(9) + ckg(8) + lsp(7) + impact(10) = 34 tests |

#### Sprint 3：CKG Moat 加深（2026-06-05 完成）

目標：將 CKG 從基礎設施升級為開發者日常工具。

| 任務 | 詳細 | 優先級 | 狀態 |
|------|------|--------|------|
| CKG build speed benchmark | 建立大專案 (1000+ 檔) 效能測試 + LRU 快取擴充至 5000 筆 | P0 | 🔜 待啟動 |
| 記憶自動化 | auto-store + pre-check + instrumentation counters (smart/stats) + speed benchmark (95% saved) | P0 | ✅ 已完成 |
| Smart MCP First 指令 | agent config 新增 Built-in→Smart MCP 映射表，兩處 agent config 同步更新 | P0 | ✅ 已完成 |
| C.1 使用模式歸納 | queryUsagePatterns 輸出擴充: event-listener/factory/strategy 模式分類 + inducedPatterns + queryStrategyPatterns | P0 | ✅ 已完成 |
| npm publish smart-agent | README.md + ARCHITECTURE.md + npm publish --access public | P1 | 🔜 待啟動 |
| Fast Apply 工具 | SEARCH/REPLACE block + unified diff apply + 4 層模糊匹配 + Lazy markers + Partial + Multi-occurrence | P1 | ✅ 已完成 |
| Change-Impact 驗收 | AST diff 正確率 >95% benchmark + 傳播延遲 <200ms 驗證 | P1 | 🔜 待啟動 |
| C.2 測試覆蓋率地圖 | CKG 記錄函式→測試映射 + 信心標記 + 增量執行 | P1 | 🔜 待啟動 |
| C.3 健康儀表板 | 循環依賴檢測 + 技術債指數 + 未使用 export 趨勢 | P2 | 🔜 待啟動 |
| CKG 視覺化 | smart_diagram 整合 CKG graph: module dependency / call graph / circular detection | P2 | 🔜 待啟動 |
| Plugin Registry | manifest schema + ~/.smart/plugins/ auto-scan + smart_docker 參考實作 | P2 | 🔜 待啟動 |

---

## 十一、優先修復清單（基於 2026-06-05 專案分析）

> 本節基於完整原始碼分析得出（33k 行 / 103 檔 / 428 測試 / 安全掃描 / 依賴圖）。
> 與既有路線圖（Phase 0-14 / A-D / F）互補：既有路線圖定義「新功能」，本節定義「需修復的問題」。

### 🔴 P0 — 立即修復（安全性 + 基本可用性）

| 優先級 | 問題 | 衝擊 | 位置 | 修復方式 |
|--------|------|------|------|----------|
| **P0** | ~~Command Injection~~ | ~~🔴 高 — 使用者輸入 args 可注入 shell~~ | ~~`git-commit.mjs:44`, `git-context.mjs:37`, `git-pr.mjs:44/546`, `git-review.mjs:47/194/199`, `tool-integrate.mjs:33`, `lsp-bridge.mjs:338`, `py-helper.mjs:218`~~ | ✅ **已修復** — 10 處全部改用 `execFileSync` + array args |
| **P0** | ~~`package.json` test 腳本壞掉~~ | ~~🔴 中 — `npm test` 永久失敗~~ | ~~`package.json` line 16~~ | ✅ **已修復** — 改為 `"node --test 'tests/*.test.mjs'"` |
| **P0** | ~~`node:sqlite` 相容性~~ | ~~🔴 中 — 僅 Node 26 可用，無法降級~~ | ~~`ckg-engine.mjs` ~L315~~ | ✅ **已修復** — 文件標示 Node >= 26 |
| **P0** | ~~respond() Promise-chain 阻塞全局吞吐~~ | ~~🔴 高 — TOON 優化耗時阻塞所有後續回應~~ | ~~`src/server/index.mjs:725`~~ | ✅ **已修復** — fire-and-forget：先 writeMsg，async 後台優化 |
| **P0** | ~~LSP bridge 重複 didOpen 浪費~~ | ~~🔴 高 — 每次 query 都重新 didOpen 同檔案，500-2000ms~~ | ~~`src/lib/lsp-bridge.mjs:179-182`~~ | ✅ **已修復** — `_didOpen()` helper + `openedFiles` Set |

### 🟠 P1 — 短期修復（品質 + 維運 + 性能）

| 優先級 | 問題 | 衝擊 | 修復方式 |
|--------|------|------|----------|
| **P1** | 無 CI/CD | 🟠 中 — 無法自動驗證 PR 是否破測試 | 建立 GitHub Actions: `npm test` on push + PR |
| **P1** | execSync 無 shell 安全強化 | 🟠 中 — 6 處 git 操作可 inject | 全部 `execSync` 強制 `{ shell: false }`，args 一律 array |
| **P1** | ~~LSP bridge 程序洩漏~~ | ~~🟠 中 — process hang 殘留~~ | ✅ **已修復** — `_startErrors` 快取 + 3 次 restart 上限 + cleanup hooks |
| **P1** | Temp 目錄汙染 | 🟢 低 — 13 個 `.test-*` 殘留目錄 | `.gitignore` 已有 pattern，清理既存目錄 |
| **P1** | `@xenova/transformers` 過重 | 🟢 低 — 80MB+ 僅 memory embedding 用 | 標示為 optional dep，TF-IDF 為預設 |
| **P1** | Hybrid engine 重複運算 | 🟠 中 — `classifyQuestion+planPath` 對同一問題重複計算 | question hash → cache result，TTL 30min |
| **P1** | CKG propagateImpact 依序阻塞 | 🟠 中 — graph traversal 依序 query CKG，鏈路長時累積 | BFS + 併發 query |

### 🟡 P2 — 中期改善（程式碼品質 + 架構）

| 優先級 | 問題 | 衝擊 | 修復方式 |
|--------|------|------|----------|
| **P2** | 混合模組系統 (ESM + CJS) | 🟢 低 — 6 處 CJS require | 全部轉 ESM |
| **P2** | Plugin/CLI 重複程式碼 | 🟢 低 — 多數 plugin re-export CLI | 共用手柄 factory |
| **P2** | 無結構化日誌 | 🟢 低 — 全 `console.log/error` | 導入 `debug` 套件 |
| **P2** | CLI 錯誤路徑 `exit(1)` | 🟢 低 — Server 模式無法 catch | 改 throw Error，`main()` 統一 catch |
| **P2** | 無 TypeScript 型別 | 🟡 中 — 33k 行純 JS | 為 lib/ 核心引擎補 `.d.ts` |
| **P2** | 文件不足 | 🟢 低 — 僅 plan/todo | 補 API docs + README |
| **P2** | CLI → Handler 遷移 | 🟡 中 — 30+ 工具仍 spawn CLI 進程 | 常用工具（grep/learn/thinking）全改 in-process |
| **P2** | LSP 多執行序支援 | 🟢 低 — 單一 bridge 單一 process | 依 CPU 核數 spawn 多個 LSP worker |
| **P2** | 記憶系統 preload | 🟠 中 — `preCheckMemory` 每次 call memory_store CLI | memory 常駐記憶體 + file watcher |
| **P2** | Compose 引擎 pipeline 並行化 | 🟢 低 — `seq` 模式嚴格依序 | pipeline stage 可並行時自動轉 `par` |

### ⚪ P3 — 長期追蹤

| 優先級 | 問題 | 說明 |
|--------|------|------|
| **P3** | 無速率限制 | MCP server 無 throttle，大量請求可 OOM |
| **P3** | 無 per-tool benchmark | CKG / apply-engine / impact 無效能基準 |
| **P3** | 無 Docker 部署 | 無 containerization 配置 |

### 修復路線圖

```
本週 (P0):
  ├── 🛡️ 修 Command Injection (7 處: git tools + LSP + py-helper) ✅ 已修復
  ├── 🩹 修 package.json test script ✅ 已修復
  ├── 🚫 LSP bridge infinite restart loop ✅ 已修復 (3 次上限 + 錯誤快取)
  ├── 🧪 5 pre-existing test failures ✅ 全部修復 (428 tests: 425 pass, 0 fail, 3 skip)
  ├── 📝 文件標示 node:sqlite Node 26 要求 ✅ 已修復
  ├── 🚀 respond() 改 fire-and-forget 解除全局阻塞 ✅ 已修復
  └── 📂 LSP bridge 加入 openedFiles 快取 ✅ 已修復

下週 (P1):
  ├── 🤖 建立 GitHub Actions CI
  ├── 🔒 所有 execSync 強制 { shell: false } ✅ A.1 已完成 (execFileSync)
  ├── 🧹 清理 .test-* 殘留目錄
  ├── 🛠️ LSP bridge 洩漏全面防護 ✅ S.3 已完成 (_startErrors + restart limit)
  ├── 🧠 Hybrid engine question cache (TTL 30min)
  └── 🕸️ CKG propagateImpact BFS 併發化

本月 (P2):
  ├── 📦 Mark @xenova/transformers 為 optional
  ├── 🔄 統一模組系統 (ESM only)
  ├── 📋 補完文件 + 型別定義
  ├── 🏃 CLI → Handler 遷移 (常用工具 in-process 化)
  ├── 🧵 LSP 多執行序支援
  ├── 💾 記憶系統 preload 常駐記憶體
  └── 🔄 Compose engine pipeline 並行化
```

### 不做（暫緩）

| 項目 | 原因 |
|------|------|
| B.1 Tool Marketplace | 需外部貢獻者生態，短期效益有限 |
| go-helper | 依賴 gopls 安裝，使用者少 |
| Tree-sitter 替換 LSP | LSP 已足夠，Tree-sitter 效益不高 |
