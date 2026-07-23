# Todo — Claude Code / Cursor 競品對標強化實作追蹤

> 建立日期：2026-07-22 | 修正日期：2026-07-22
> 對應計畫：`docs/smart_20260722_plan.md`
> 與 plan.md 互補：plan.md 定義「為什麼做、架構長怎樣」，todo.md 定義「具體步驟」。

---

## 📋 LLM 標準作業流程（SOP）

### 📖 閱讀（READ）
1. **掃描**優先級總覽 → 知哪些完成、哪些待做
2. **深讀**特定方案 → 點對應章節
3. **驗證** `npm test` 或 `git diff` 確認文件與程式碼一致

### ✏️ 新增（ADD）
1. 🧠 Brainstorm ≥2 方案 → 2. 📝 寫 Spec → 3. 📄 更新此文件 → 4. 🟥 測試計畫 → 5. 💻 實作 + 測試 → 6. ✅ Regression

---

## 優先級總覽

| 優先 | 方案 | 名稱 | 難度 | 影響 | 狀態 |
|:----:|:----:|------|:----:|:----:|:----:|
| 🔴 P0 | **B'** | Per-call 並行 + Streaming | 🔴 高 | 🔴 嚴重 | ⬜ 待開始 |
| 🔴 P0 | **C'** | 命令安全 + OS Sandbox | 🟡 中 | 🔴 嚴重 | ⬜ 待開始 |
| 🔴 P0 | **H** | Context Collapse 復原 | 🟡 中 | 🔴 致命 | ⬜ 待開始 |
| 🟡 P1 | **A'** | Context 管理優化 | 🟢 低 | 🟡 中等 | ⬜ 待開始 |
| 🟡 P1 | **D** | 工具 Lazy Loading | 🟡 中 | 🟡 中等 | ⬜ 待開始 |
| 🟢 P2 | **E** | 推測性執行強化 | 🟡 中 | 🟡 中等 | ⬜ 待開始 |
| 🟢 P2 | **F** | 記憶整合引擎 | 🟡 中 | 🟡 中等 | ⬜ 待開始 |
| ⏸️ | **G** | MCP 協定升級 | 🔴 高 | 🟡 中等 | ⏸️ 未來 |

---

## 方案 B'：Per-call 並行分類 + Streaming Pipelining（修正版）

> ⚠️ **重要修正**：從 tool-level 分類改為 per-call 分類 + 加入 Streaming Pipelining。
> 目標：多檔案分析加速 20-100x，安全性提升（per-call 安全判斷）。

### B'.1 研究：現有並行架構分析

- [ ] 閱讀 `src/lib/concurrency-gate.mjs` 的 `TOOL_PROFILES`（行 19-60）— 理解現有 tool-level 分類
- [ ] 閱讀 `src/server/index.mjs` 的 `executeToolGated()`（行 2581-2617）— 理解現有 gate 機制
- [ ] 閱讀 `src/server/index.mjs` 的 `handleRequest()`（行 3230-3764）— 理解 tool_use 處理流程
- [ ] 研究 Claude Code 的 `StreamingToolExecutor`（530 行）— 理解 per-call 分類 + streaming pipelining
- [ ] 研究 Claude Code 的 `partitionToolCalls()` — 理解 per-call 安全判斷邏輯

### B'.2 設計：Per-call 並行分類

- [ ] 為每個工具定義 `isConcurrencySafe(parsedInput)` 方法：
  - [ ] `smart_read` → true（永遠唯讀）
  - [ ] `smart_grep` → true（永遠唯讀）
  - [ ] `smart_glob` → true（永遠唯讀）
  - [ ] `smart_lsp` → 依 operation 判斷（hover/symbols=true, code_action=false）
  - [ ] `smart_fast_apply` → false（寫入操作）
  - [ ] `smart_edit_chain` → false（寫入操作）
  - [ ] `smart_test` → false（執行測試）
  - [ ] `smart_security` → false（掃描但可能觸發修改）
- [ ] 設計 `partitionToolCalls(toolCalls)` 演算法：
  - [ ] 連續的 concurrencySafe tool → 合併為一批並行執行
  - [ ] 非 safe tool → 獨立批次串行執行
  - [ ] Fail-closed：解析失敗 → 保守判定為 serial
- [ ] 設計並行限制：最多 N 個同時執行（預設 10）

### B'.3 設計：Streaming Pipelining

- [ ] 設計 4 階段狀態機：Pending → Ready → Executing → Complete
- [ ] 設計 StreamingToolExecutor：模型串流中就開始執行已完成的 tool block
- [ ] 設計 Sibling Abort：
  - [ ] Bash 失敗 → 取消兄弟（因為後續命令可能依賴前一個）
  - [ ] Read 失敗 → 不影響兄弟（獨立操作）
- [ ] 設計結果依序回傳：保持 tool_use_id 對應

### B'.4 實作

- [ ] 建立 `src/lib/parallel-executor.mjs` — ParallelExecutor class
- [ ] 實作 `isConcurrencySafe(toolName, parsedInput)` — per-call 安全判斷
- [ ] 實作 `partitionToolCalls(toolCalls)` — 批次分割演算法
- [ ] 實作 `executeParallel(toolCalls)` — 並行執行引擎
- [ ] 實作 `abortSiblings(controller, toolCalls)` — Sibling Abort
- [ ] 整合到 `src/server/index.mjs` — `handleRequest()` 中偵測並行 tool_use
- [ ] 修改 `src/lib/concurrency-gate.mjs` — 從 TOOL_PROFILES 改為 per-call 分類

### B'.5 測試

- [ ] `tests/parallel-executor.test.mjs` — per-call 分類正確
- [ ] 讀工具並行、寫工具串行
- [ ] Sibling Abort 正確觸發（Bash 失敗取消兄弟）
- [ ] 結果依序回傳正確
- [ ] 並行限制（>10 時佇列）
- [ ] 向後相容：單一 tool_use 時行為不變

### B'.6 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入並行執行使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 B' 標記為進行中/完成

---

## 方案 C'：命令安全分類器 + OS Sandbox（擴充版）

> ⚠️ **重要擴充**：加入 OS-level sandboxing 雙重防護。
> 目標：24+ 危險模式自動攔截 + OS 隔離（84% fewer permission prompts）。

### C'.1 研究：Claude Code 安全模型分析

- [ ] 研究 Claude Code 的 bash classifier 24+ 危險模式清單
- [ ] 研究 Claude Code 的 OS-level sandboxing（2025-10）：
  - [ ] Linux：bubblewrap（unprivileged sandbox）
  - [ ] macOS：seatbelt（sandbox-exec）
  - [ ] 結果：84% fewer permission prompts
- [ ] 確認 Smart MCP 的 bash 呼叫入口（`src/server/index.mjs` 的 `invokeTool`）

### C'.2 設計：雙層安全引擎

**第一層：正則匹配（24+ 危險模式）**
- [ ] 定義危險模式規則表：
  - [ ] 破壞性刪除：`rm -rf /`、`rm -rf /*`、`rm -r ~`、`rm -rf .`
  - [ ] 管道到 shell：`curl ... | bash`、`wget ... | sh`、`curl ... | sh`
  - [ ] Fork bomb：`:(){ :|:& };:`、`:(){ :|: & };:`
  - [ ] 權限提升：`sudo rm`、`chmod 777`、`chmod -R 777`
  - [ ] 環境破壞：`export PATH=`、`unset PATH`、`eval $`
  - [ ] 網路危險：`ssh root@`、`nc -l`、`ncat -l`
  - [ ] Git 危險：`git push --force`、`git reset --hard`、`git clean -fd`
- [ ] 設計危險等級：🔴 高（直接攔截）、🟡 中（警告但允許）、🟢 低（記錄但不攔截）
- [ ] 設計回傳格式：`{ ok: boolean, danger: string[], level: "high"|"medium"|"low", message: string }`

**第二層：OS Sandbox（macOS seatbelt）**
- [ ] 設計沙箱規則：
  - [ ] Filesystem：只允許 cwd 讀寫，封鎖系統目錄
  - [ ] Network：只允許通過 unix domain socket 的 proxy
  - [ ] Process：封鎖 fork bomb、ptrace
- [ ] 設計實作方式：macOS sandbox-exec + 規則檔

### C'.3 實作

- [ ] 建立 `src/lib/bash-safety.mjs` — BashSafety class
- [ ] 實作 `classifyCommand(command)` — 解析命令，回傳危險分類
- [ ] 實作 `matchDangerPatterns(command)` — 正則匹配 24+ 危險模式
- [ ] 實作 `formatSafetyResult(result)` — 格式化安全檢查結果
- [ ] 建立 `src/lib/sandbox.mjs` — Sandbox class（macOS seatbelt）
- [ ] 實作 `createSandboxProfile(rules)` — 產生 sandbox 規則檔
- [ ] 實作 `runInSandbox(command, profile)` — 在沙箱中執行命令
- [ ] 整合到 `src/server/index.mjs` — `invokeTool()` 中攔截 bash 呼叫

### C'.4 測試

- [ ] `tests/bash-safety.test.mjs` — 24+ 危險模式逐一驗證
- [ ] 安全等級分類正確（high/medium/low）
- [ ] 正常命令不被誤攔截（ls、cat、git status 等）
- [ ] 邊界案例：空命令、超長命令、Unicode 繞過
- [ ] 整合測試：bash 呼叫被正確攔截/警告/放行

### C'.5 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入安全分類器使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 C' 標記為進行中/完成

---

## 方案 H：Context Collapse 復原機制（新增）

> ⚠️ **全新方案**：補齊 context 溢位時的復原機制。
> 目標：context 滿了時優雅復原，而非中斷任務。

### H.1 研究：Claude Code 復原機制分析

- [ ] 研究 Claude Code 的 7 條 continue path（`query.ts` 1,729 行）：
  - [ ] `collapse_drain_retry` — Context collapse 後重試
  - [ ] `reactive_compact_retry` — 413 recovery 後重試
  - [ ] `max_output_tokens_escalate` — Token escalation 8k→64k
  - [ ] `max_output_tokens_recovery` — 注入 "continue writing" nudge
  - [ ] `stop_hook_blocking` — Stop hook 阻擋後重試
  - [ ] `token_budget_continuation` — Token budget 未耗盡繼續
  - [ ] `next_turn` — 工具執行後下一輪
- [ ] 確認 Smart MCP 的 context 管理入口（`autoManageContext()`）

### H.2 設計：六層復原機制

- [ ] Tier 1（75%）：顯示 droppable stats，建議 compact
- [ ] Tier 2（85%）：自動 microcompact + inject recovery hint
- [ ] Tier 3（95%）：自動 full compact + inject recovery context
- [ ] Recovery Path 1：compact 失敗 → 注入 "continue" nudge + 重試（最多 3 次）
- [ ] Recovery Path 2：重試也失敗 → 記錄統計 + 回傳 graceful error
- [ ] Circuit Breaker：連續 3 次失敗停止壓縮

### H.3 實作

- [ ] 擴展 `src/server/index.mjs` 的 `autoManageContext()` — 加入復原機制
- [ ] 實作 `injectContinueNudge()` — 注入 "continue writing" 訊息
- [ ] 實作 `handleContextCollapse(error)` — 處理 context 溢位錯誤
- [ ] 實作 `getRecoveryStats()` — 追蹤復原統計
- [ ] 整合到 `src/server/index.mjs` — `respond()` 加入 continue path

### H.4 測試

- [ ] `tests/context-collapse.test.mjs` — Tier 1/2/3 觸發正確
- [ ] Recovery Path 正確觸發（compact 失敗 → nudge → 重試）
- [ ] Circuit Breaker 邊界：連續 3 次失敗後停止
- [ ] 向後相容：context 未滿時行為不變

### H.5 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入 Context 復原使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 H 標記為進行中/完成

---

## 方案 A'：Context 管理優化（修正版：非重建）

> ⚠️ **重要修正**：現有三層自動壓縮已完善，本方案改為「驗證 + 優化」。
> 目標：驗證現有壓縮效果 + 補強 token 計算精度。

### A'.1 研究：現有壓縮機制分析

- [ ] 閱讀 `src/server/index.mjs` 的 `captureAndReturn()`（行 1479-1530）— MicroCompact + FullCompact
- [ ] 閱讀 `src/server/index.mjs` 的 `autoManageContext()`（行 2684-2808）— Phase 33 Tiered Auto Context
- [ ] 分析 token 估算精度：字元/4 的誤差範圍
- [ ] 確認現有壓縮效果：壓縮前後的 token 數變化

### A'.2 設計：優化項目

- [ ] 設計 token 計算精度驗證：比較字元/4 與實際 API 回報的 token 數
- [ ] 設計壓縮效果 metrics：追蹤每次壓縮的 token 節省量
- [ ] 設計邊界案例處理：超大 tool result（>100K tokens）

### A'.3 實作

- [ ] 在 `src/server/index.mjs` 加入壓縮 metrics 追蹤
- [ ] 驗證 token 估算精度（誤差 < 20%）
- [ ] 處理邊界案例：超大 tool result 自動截斷

### A'.4 測試

- [ ] Token 估算精度驗證（誤差 < 20%）
- [ ] 壓縮效果 metrics 正確
- [ ] 邊界案例：超大 tool result 正確處理

### A'.5 文件

- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 A' 標記為進行中/完成

---

## 方案 D：工具 Lazy Loading

> 目標：sub-tools schema 按需載入，減少 60% 工具描述 token。
> 預估：context 空間從 55K → 22K tokens，更多空間給實際對話。

### D.1 研究：現有工具載入架構

- [ ] 閱讀 `src/server/loader.mjs` 的工具載入邏輯
- [ ] 分析 `nativeTools` 和 `routerTools` 的 schema 大小
- [ ] 閱讀 `src/server/index.mjs` 的 `HIDDEN_NATIVE_TOOLS`（行 87-103）— 理解現有部分隱藏機制
- [ ] 確認 MCP 協定是否支援動態工具列表

### D.2 設計：動態工具載入

- [ ] 設計核心工具（21 個 direct tools）→ 始終載入
- [ ] 設計 sub-tools schema → 按需載入（agent 呼叫 smart_smart_run 時才載入）
- [ ] 設計 `smart_smart_run({tool:"help"})` → 回傳可用工具清單（~2K tokens）
- [ ] 設計工具描述精簡版（每個工具一行摘要 vs 完整 schema）

### D.3 實作

- [ ] 修改 `src/server/loader.mjs` — 支援 lazy loading 模式
- [ ] 實作 `getToolSummary()` — 回傳工具清單摘要（~2K tokens）
- [ ] 實作 `getToolSchema(toolName)` — 按需回傳完整 schema
- [ ] 整合到 `smart_smart_run` — `help` 命令回傳工具清單
- [ ] 更新 `src/server/index.mjs` — 動態工具列表管理

### D.4 測試

- [ ] `tests/dynamic-loader.test.mjs` — 核心工具始終載入
- [ ] Sub-tools 按需載入正確
- [ ] Help 命令回傳正確工具清單
- [ ] 向後相容：所有工具仍可正常呼叫

### D.5 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入 lazy loading 使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 D 標記為進行中/完成

---

## 方案 E：推測性執行強化

> 目標：擴展 prefetch-engine 到結果預計算，減少 25-30% round-trip。
> 預估：複雜任務速度提升 25-30%。

### E.1 研究：現有 prefetch-engine 分析

- [ ] 閱讀 `src/lib/prefetch-engine.mjs` 現有 5 條靜態規則
- [ ] 分析 `contextExtractor` 的實作方式
- [ ] 確認 Phase 10 transition learning 的 DB 結構

### E.2 設計：結果預計算

- [ ] 設計結果預計算：工具 A 執行後 → 預計算工具 B 的結果（不只是 schema）
- [ ] 設計 cache hit 判斷：agent 真的呼叫 → 直接回傳 cached result（0ms）
- [ ] 設計 cache miss 處理：agent 沒呼叫 → 丟棄（無害）
- [ ] 整合 Phase 10 transition learning：用動態統計取代靜態規則

### E.3 實作

- [ ] 修改 `src/lib/prefetch-engine.mjs` — 擴展 contextExtractor 為結果預計算
- [ ] 實作 `prefetchResult(toolName, args)` — 預計算工具結果
- [ ] 整合 `tool_transitions` 表：用動態統計決定預取什麼
- [ ] 整合到 `src/server/index.mjs` — `captureAndReturn()` 中加入結果預計算

### E.4 測試

- [ ] 結果預計算正確（cache hit 時 0ms）
- [ ] Cache miss 時無副作用
- [ ] 整合 Phase 10 transition learning 正確
- [ ] 向後相容：無 prefetch 時行為不變

### E.5 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入結果預計算使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 E 標記為進行中/完成

---

## 方案 F：記憶整合引擎

> 目標：實現 autoDream 風格的記憶整合，自動去重、歸類、淘汰。
> 預估：記憶品質持續提升，長期使用更穩定。

### F.1 研究：現有記憶系統分析

- [ ] 閱讀 `src/server/index.mjs` 的 `autoExtractSkillPatches()` 函數（行 978-1032）
- [ ] 分析 `resolutions.json` 的記憶結構
- [ ] 確認 `memory-db.mjs` 的 schema 和 CRUD 操作

### F.2 設計：四階段記憶整合

- [ ] 設計觸發條件：session 數 > 5 且距上次整合 > 24h
- [ ] 設計 Orient 階段：掃描所有記憶，統計分佈
- [ ] 設計 Gather 階段：按 category 分組（error_fix / pattern / preference）
- [ ] 設計 Consolidate 階段：合併重複記憶、解決衝突（同類型 + 相似內容）
- [ ] 設計 Prune 階段：淘汰 > 30 天未使用的記憶
- [ ] 設計 PID 鎖：防止並發整合（file-based lock）

### F.3 實作

- [ ] 建立 `src/lib/memory-consolidator.mjs` — MemoryConsolidator class
- [ ] 實作 `shouldConsolidate()` — 檢查觸發條件
- [ ] 實作 `orient()` — 掃描所有記憶，統計分佈
- [ ] 實作 `gather()` — 按 category 分組
- [ ] 實作 `consolidate()` — 合併重複、解決衝突
- [ ] 實作 `prune()` — 淘汰過時記憶
- [ ] 實作 `acquireLock()` / `releaseLock()` — PID 鎖
- [ ] 整合到 `src/server/index.mjs` — 啟動時觸發記憶整合

### F.4 測試

- [ ] `tests/memory-consolidator.test.mjs` — 觸發條件正確
- [ ] Orient 統計正確
- [ ] Consolidate 合併邏輯正確（同類型 + 相似內容）
- [ ] Prune 淘汰邏輯正確（> 30 天）
- [ ] PID 鎖防止並發
- [ ] 向後相容：無記憶時行為不變

### F.5 文件

- [ ] 更新 `config/agents/smart-mcp.md` — 加入記憶整合使用說明
- [ ] 更新 `docs/smart_20260722_plan.md` — 方案 F 標記為進行中/完成

---

## 方案 G：MCP 協定升級（未來選項）

> ⏸️ **暫不實作**。OpenCode client 目前不支援 Streamable HTTP（Issue #8058 仍未解決）。

### 觸發條件

- [ ] OpenCode 加入 Streamable HTTP client 支援（Issue #8058）
- [ ] 或：需要部署為遠端 MCP service

### 如果要實作

- [ ] 升級 protocol version 到 `2025-03-26` 或更新
- [ ] 加入 Streamable HTTP transport（HTTP endpoint + SSE streaming）
- [ ] 保留 stdio 作為 fallback
- [ ] 需要 OAuth 認證機制

---

## 📊 實施順序與里程碑

```
第一波（高優先，1-2 週）：
  M1：方案 B' 完成（Per-call 並行 + Streaming）← 效能 + 安全性提升最明顯
  M2：方案 C' 完成（安全分類器 + Sandbox）← 安全性必備
  M3：方案 H 完成（Context Collapse 復原）← 可靠性必備

第二波（中優先，1-2 週）：
  M4：方案 A' 完成（Context 管理優化）← 驗證現有壓縮效果
  M5：方案 D 完成（Lazy Loading）← Token 節省最多

第三波（持續優化）：
  M6：方案 E 完成（推測性執行強化）← 整合 Phase 10 transition learning
  M7：方案 F 完成（記憶整合引擎）← 整合 Phase 14 reflection

最終驗證：
  M8：全量 regression + 效能 benchmark
  M9：與 Claude Code / Cursor 的差距驗證

未來（等 OpenCode 支援）：
  M10：方案 G 完成（MCP 協定升級）← 等 Streamable HTTP client 支援
```

---

## 📝 修正紀錄

| 日期 | 修正內容 | 原因 |
|------|---------|------|
| 2026-07-22 | 方案 A 從「重建」改為「優化」 | 程式碼分析發現已有三層自動壓縮 |
| 2026-07-22 | 方案 B 從「tool-level 並行」改為「per-call 並行 + streaming」 | Claude Code 深度分析發現 per-call 分類 |
| 2026-07-22 | 方案 C 擴充加入 OS Sandbox | Claude Code sandboxing 分析 |
| 2026-07-22 | 新增方案 H（Context Collapse 復原） | Claude Code 7 條 continue path 分析 |
| 2026-07-22 | 新增方案 G（MCP 協定升級）標記為未來 | OpenCode Issue #8058 仍未解決 |
| 2026-07-22 | 修正優先級排序 | 基於實際程式碼分析重新評估 |

---

## 🔗 相關文件

- `docs/smart_20260722_plan.md` — 對應計畫
- `docs/plan.md` — 主路線圖（Phase 1-20）
- `docs/todo.md` — 主路線圖實作追蹤
- `config/agents/smart-mcp.md` — Agent personality 定義