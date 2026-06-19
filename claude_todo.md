# Smart MCP — Claude Code 功能學習 Todo

> 基於 2026-06-19 評估報告（見 claude_plan.md）

---

## 🚀 Sprint 1：Hooks 系統（建議優先）

### 階段 A — Hook Registry（3-4 天）

- [ ] **新增 `src/lib/hook-registry.mjs`**
  - [ ] `registerPreHook(hook)` / `registerPostHook(hook)` API
  - [ ] `executePreHooks(toolName, args)` → return `[{ hook, block?, message? }]`
  - [ ] `executePostHooks(toolName, args, result)` → return `[{ hook, promise }]`
  - [ ] `initBuiltinHooks()` 將現有三個 fire-and-forget 遷移為內建 hooks
    - [ ] `lsp-diagnostics`: match=`smart_fast_apply` + `apply:true`
    - [ ] `impact-warning`: match=`smart_fast_apply` + `files > 2`
    - [ ] `hallucination-check`: match=`isHighRiskOutput(toolName)`

- [ ] **修改 `src/server/index.mjs` — invokeTool()**
  - [ ] Phase 8：在 `checkHighRiskPrerequisites()` 之後、handler 之前，執行 pre-hooks
  - [ ] Phase 9：在 handler 之後、`captureAndReturn()` 之前，收集 post-hook promises
  - [ ] 若 pre-hook 回傳 `{ block: true }`，阻斷工具執行

- [ ] **修改 `src/server/index.mjs` — respond()**
  - [ ] 將 `_pendingImpact` / `_pendingLsp` / `_pendingHallucination` 統一為 `_pendingHooks` 陣列
  - [ ] 在 `_respondChain` 中迭代執行 `_pendingHooks`

- [ ] **測試**
  - [ ] 編輯檔案後自動觸發 LSP 診斷（行為不變）
  - [ ] >2 檔編輯自動觸發 impact 分析（行為不變）
  - [ ] 高風險工具（如 academic_search）自動觸發幻覺檢查（行為不變）
  - [ ] Pre-hook 回傳 block 正確阻斷工具

### 階段 B — 用戶自訂 Hooks（1 週）

- [ ] **新增 `smart_hook` 工具**
  - [ ] `command:"add"` — 註冊自訂 hook（bash / mcp_tool）
  - [ ] `command:"list"` — 列出已註冊 hooks
  - [ ] `command:"remove"` — 移除 hook
  - [ ] `command:"enable"` / `command:"disable"`
  - [ ] 持久化到 `~/.smart/hooks.json`

- [ ] **Hook action 執行器**
  - [ ] `type: "bash"` — 執行 shell command，支援 `{file}` 模板變數
  - [ ] `type: "mcp_tool"` — 呼叫現有 MCP 工具

- [ ] **範例 hook 腳本**
  - [ ] 編輯 TypeScript 後自動 prettier
  - [ ] Commit 前自動 lint

### 階段 C — Production 強化（1 週）

- [ ] Hook timeout（預設 10s），超時不阻斷主流程
- [ ] 同類型 hook 最多 10 個限制
- [ ] Hook 併發限制（最多 3 個並行）
- [ ] Hook 執行日誌（時間、成功/失敗）
- [ ] Defer 支援：pre-hook return `{ defer: true }` 暫停工具執行

---

## 🚀 Sprint 2：Auto Mode

### 階段 A — 基礎模式切換（2-3 天）

- [ ] **新增 `src/lib/auto-classifier.mjs`**
  - [ ] `classifyTool(toolName, args)` → `{ action: 'allow'|'warn'|'block'|'gate', reason? }`
  - [ ] 工具分類表（硬編碼）：read / write / other / dangerous
  - [ ] `BLOCKED_FILES` 清單：`.zshenv`, `.bashrc`, `.npmrc`, `.pre-commit-config.yaml`

- [ ] **修改 `src/server/index.mjs` — runtimeConfig**
  - [ ] 新增 `mode: 'interactive' | 'auto' | 'bypass'`

- [ ] **修改 `src/server/index.mjs` — invokeTool()**
  - [ ] 在 `checkHighRiskPrerequisites()` 之後，若 `mode === 'auto'`，執行 `classifyTool()`
  - [ ] `block` → 回傳錯誤訊息
  - [ ] `warn` → 在 result 附註 `[Auto Mode] auto-approved`

- [ ] **修改 `smart_config` 工具**
  - [ ] `set:{autoMode:true/false}` 切換模式
  - [ ] 持久化到 `~/.smart/config.json`

- [ ] **測試**
  - [ ] Auto mode 下 read 工具自動放行
  - [ ] Auto mode 下 fast_apply 正常執行但附註
  - [ ] Auto mode 下 blocked file 寫入被阻斷
  - [ ] 切回 interactive 模式恢復正常

### 階段 B — 分類器引擎（1 週）

- [ ] 取代硬編碼分類，改為規則引擎
- [ ] 動態分類：檢查 toolHistory 中最近 security finding
- [ ] 支援 `$defaults` 擴充（類似 Claude Code）

### 階段 C — 智慧安全檢查（2 週）

- [ ] 非同步背景安全掃描（fire-and-forget，透過 hook pipeline）
- [ ] 與 `smart_security` 整合
- [ ] 掃描結果發現問題 → 通知用戶

---

## 📋 Reference

- **Hooks 現有程式碼位置**：`src/server/index.mjs` L1469-1600（triggerImpactWarning, triggerLspDiagnostics, triggerHallucinationCheck）
- **respond() 中的 _respondChain**：`src/server/index.mjs` L2442-2530
- **門控機制**：`src/server/index.mjs` L975-1022（HIGH_RISK_PREREQUISITES）
- **工具載入**：`src/server/loader.mjs`
- **Concurrency Gate**：`src/lib/concurrency-gate.mjs`
- **Safe Handler**：`src/lib/safe-handler.mjs`
