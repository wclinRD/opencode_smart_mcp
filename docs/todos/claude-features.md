# Smart MCP — Claude Code 功能學習 Todo

> 基於 2026-06-19 評估報告（見 claude_plan.md）

---

## 🚀 Sprint 1：Hooks 系統（建議優先）

### 階段 A — Hook Registry ✅（已實作）

- [x] **新增 `src/lib/hook-registry.mjs`**（476 行）
  - [x] `registerPreHook(hook)` / `registerPostHook(hook)` API
  - [x] `executePreHooks(toolName, args)` → return `[{ hook, block?, message? }]`
  - [x] `executePostHooks(toolName, args, result)` → return `[{ hook, promise }]`
  - [x] `initBuiltinHooks()` 將現有三個 fire-and-forget 遷移為內建 hooks
    - [x] `lsp-diagnostics`: match=`smart_fast_apply` + `apply:true`
    - [x] `impact-warning`: match=`smart_fast_apply` + `files > 2`
    - [x] `hallucination-check`: match=`isHighRiskOutput(toolName)`

- [x] **修改 `src/server/index.mjs` — invokeTool()**
  - [x] Phase 8：在 auto-classifier 之後、handler 之前，執行 pre-hooks（L1890 sync, L2133 async）
  - [x] Phase 9：在 handler 之後、`captureAndReturn()` 之前，收集 post-hook promises（L1446-1453）
  - [x] 若 pre-hook 回傳 `{ block: true }`，阻斷工具執行

- [x] **修改 `src/server/index.mjs` — respond()**
  - [x] 將 `_pendingImpact` / `_pendingLsp` / `_pendingHallucination` 統一為 `_pendingHooks` 陣列
  - [x] 在 `_respondChain` 中迭代執行 `_pendingHooks`（L2611-2628）

- [x] **測試** — 1690 tests all pass, hooks behavior verified via integration tests

### 階段 B — 用戶自訂 Hooks ✅（已實作）

- [x] **新增 `smart_hook` 工具**（L2993）
  - [x] `command:"add"` — 註冊自訂 hook（bash / mcp_tool）
  - [x] `command:"list"` — 列出已註冊 hooks
  - [x] `command:"remove"` — 移除 hook
  - [x] `command:"enable"` / `command:"disable"`
  - [x] 持久化到 `~/.smart/hooks.json`

- [x] **Hook action 執行器**
  - [x] `type: "bash"` — 執行 shell command，支援 `{file}` 模板變數
  - [x] `type: "mcp_tool"` — 呼叫現有 MCP 工具 ✅（支援 JS handler 與 CLI spawn）

- [x] **範例 hook 腳本** ✅（`examples/hooks/`）
  - [x] 編輯 TypeScript 後自動 prettier（`examples/hooks/pre-format.sh`）
  - [x] Commit 前自動 lint（`examples/hooks/pre-commit-lint.sh`）
  - [x] 使用說明（`examples/hooks/README.md`）

### 階段 C — Production 強化 ✅（已實作）

- [x] Hook timeout（預設 10s），超時不阻斷主流程
- [x] 同類型 hook 最多 10 個限制
- [x] Hook 併發限制（最多 3 個並行）
- [x] Hook 執行日誌（時間、成功/失敗）
- [x] Defer 支援：pre-hook return `{ defer: true }` 暫停工具執行

---

## 🚀 Sprint 2：Auto Mode

### 階段 A — 基礎模式切換 ✅（已實作）

- [x] **新增 `src/lib/auto-classifier.mjs`**（300 行）
  - [x] `classifyTool(toolName, args)` → `{ action: 'allow'|'warn'|'block'|'gate', reason? }`
  - [x] 工具分類表（內建 rules）：read / write / other / dangerous
  - [x] `BLOCKED_FILE_PATTERNS` 清單：shell configs, git configs, npmrc, 安全敏感路徑

- [x] **修改 `src/server/index.mjs` — runtimeConfig**
  - [x] 新增 `mode: 'interactive' | 'auto' | 'bypass'`

- [x] **修改 `src/server/index.mjs` — invokeTool()**
  - [x] 在 auto-classifier 之後，若 `mode === 'auto'`，執行 `classifyTool()`（L1874 sync, L2117 async）
  - [x] `block` → 回傳錯誤訊息
  - [x] `warn` → 在 result 附註 `[Auto Mode] auto-approved`
  - [x] `gate` → 要求切回 interactive 模式才允許

- [x] **修改 `smart_config` 工具**
  - [x] `set:{mode:'auto'}` 切換模式（支援大小寫容錯）
  - [x] **持久化到 `~/.smart/config.json`** ✅ — `loadConfig()` / `saveConfig()` 在 `src/server/index.mjs` L523-551，啟動時自動載入，`smart_config` 變更後自動存檔

- [x] **測試** ✅ — `tests/auto-classifier.test.mjs`（40 項測試），涵蓋工具分類/封鎖檔案/安全上下文/規則管理/summary/override

### 階段 B — 分類器引擎 ✅（已實作）

- [x] 取代硬編碼分類，改為 `addRule`/`removeRule`/`listRules` 規則引擎
- [x] 動態分類：`extraCheck` 檢查 toolHistory 中最近 security finding（L235-260）
- [x] 支援 `$defaults` 擴充：`$defaults:read`, `$defaults:write`, `$defaults:unknown`, `$defaults:other`

### 階段 C — 智慧安全檢查（2 週）

- [x] 非同步背景安全掃描（fire-and-forget，透過 hook pipeline）
- [x] 與 `smart_security` 整合（spawn security-scan.mjs CLI）
- [x] 掃描結果發現問題 → 通知用戶（append 到 result output）

---

## 📋 Reference

- **Hooks 現有程式碼位置**：`src/server/index.mjs` L1469-1600（triggerImpactWarning, triggerLspDiagnostics, triggerHallucinationCheck）
- **respond() 中的 _respondChain**：`src/server/index.mjs` L2442-2530
- **門控機制**：`src/server/index.mjs` L975-1022（HIGH_RISK_PREREQUISITES）
- **工具載入**：`src/server/loader.mjs`
- **Concurrency Gate**：`src/lib/concurrency-gate.mjs`
- **Safe Handler**：`src/lib/safe-handler.mjs`
