# Smart MCP — 向 Claude Code 學習：Auto Mode 與 Hooks 系統評估報告

> 2026-06-19 | 基於 Smart MCP v3.2.0 原始碼逆向分析，對照 Claude Code v2.1.169+

---

## 📐 背景：Smart MCP 現有架構摘要

**工具執行流程（精簡）：**

```
tools/call → handleRequest()
  → toolMap.get(toolName)
  → executeToolGated()
    → invokeToolWithRetry()     // 最多 3 次 retry + FALLBACK_MAP
      → invokeTool()
        ├─ preCheckMemory()
        ├─ contextualMemorySearch()
        ├─ prefetchEngine.checkCache()
        ├─ checkHighRiskPrerequisites()  // ⭐ 當前僅 2 條硬編碼規則
        ├─ contextManager.inject()
        ├─ auto-fix 層
        └─ handler() 或 spawnSync()
  → captureAndReturn()          // stats + context + microCompact
  → respond()                   // output 優化 + pending hooks
```

**關鍵發現：Smart MCP 沒有：**
1. 工具安全分類（safe / destructive / user-confirm）
2. 用戶可配置的 allow/deny 規則
3. 背景安全檢查引擎
4. 執行前/後的生命週期鉤子
5. 模式切換（interactive ↔ auto）

**現有 hook-like 機制（fire-and-forget）的代碼位置（src/server/index.mjs）：**
- `_pendingImpact` → `triggerImpactWarning()`（L1469，>2 檔編輯時觸發 impact 分析）
- `_pendingLsp` → `triggerLspDiagnostics()`（L1502，編輯後自動跑 LSP 診斷）
- `_pendingHallucination` → `triggerHallucinationCheck()`（L1562，高風險輸出幻覺檢查）
- 三者在 `respond()` 的 `_respondChain` 中非同步執行（L2442-2530）
- **本質上已是 PostToolUse hooks 原型，只是各自獨立、hardcoded**

---

## 🔷 Item 1：Hooks 系統（工具生命週期鉤子）

### Claude Code 實作

- **四種鉤子事件**：`ToolUse`（前）、`PostToolUse`（後）、`Notification`、`Stop`
- **能力**：可執行 shell command、可直接呼叫 MCP tools、支援 `defer` 決策、支援 `reloadSkills`
- **範例**：編輯後自動 `npx prettier --write`

### 實作方案（三階段）

#### 階段 A：統一的 Hook Registry（~200 行，3-4 天）

```javascript
// 新增檔案：src/lib/hook-registry.mjs
// 將現有三個 fire-and-forget 統一為 hook registry
// 支援：registerPreHook() + registerPostHook() + match pattern

const HOOKS = { preTool: [], postTool: [] };

// 內建 hooks（從現有 code 遷移）：
// - lsp-diagnostics:   after smart_fast_apply → LSP 診斷
// - impact-warning:    after multi-file edit → impact 分析
// - hallucination-check: after high-risk output → 幻覺檢查

// 在 invokeTool() 整合點：
// Phase 8: pre-hooks（L1748 之後、handler 之前）
//   preResults = executePreHooks(def.name, args)
//   if any hook returns { block: true } → 阻斷執行

// Phase 9: post-hooks（handler 之後、captureAndReturn 之前）
//   attach 到 result._pendingHooks → _respondChain 執行
```

#### 階段 B：用戶自訂 Hooks（~250 行，1 週）

```javascript
// smart_hook 工具：
//   command:"add", event:"postTool", match:{tool:"smart_fast_apply"},
//   action:{type:"bash", command:"npx prettier --write {file}"}
//
// 持久化：~/.smart/hooks.json
```

#### 階段 C：Production 強化（~200 行，1 週）

- Hook timeout 10s、併發限制 3 個、日誌追蹤、Defer 支援

### 所需檔案

| 檔案 | 修改類型 | 規模 |
|------|---------|------|
| `src/lib/hook-registry.mjs` | **新增** | ~150 行 |
| `src/server/index.mjs` | 修改 invokeTool() + respond() | ~90 行 |
| `src/server/index.mjs` | 新增 smart_hook dispatch | ~80 行 |

---

## 🔷 Item 2：Auto Mode（無打擾自動執行）

### Claude Code 實作

- **觸發**：`Shift+Tab` 切換
- **核心**：背景安全分類器，常規自動放行，破壞性攔截
- **安全集合**：`autoMode.soft_deny`、`"$defaults"` 擴充
- **保護對象**：shell startup files、git config、build tool configs

### 實作方案（三階段）

#### 階段 A：基礎 Auto Mode（~150 行，2-3 天）

```javascript
// runtimeConfig 加 mode: 'interactive' | 'auto' | 'bypass'

// invokeTool() 內新增分類邏輯：
//   1. classifyTool(def.name, args) → 'read' | 'write' | 'dangerous'
//   2. read → 直接放行
//   3. dangerous（含 blockedFiles） → 阻斷 + 說明
//   4. write → 放行但結果附註 ⚡ auto-approved

// smart_config 加 autoMode enabled/disabled
// 持久化到 ~/.smart/config.json
```

**工具分類表（第一版）：**

| 分類 | 包含工具 | Auto Mode 行為 |
|------|---------|---------------|
| `read` | smart_read, smart_grep, smart_glob, smart_lsp, smart_context, smart_rules, smart_exa_*, smart_github_search | ✅ 直接放行 |
| `write` | smart_fast_apply | ⚡ 放行 + 附註 |
| `other` | smart_think, smart_deep_think, smart_run, smart_compact | ✅ 直接放行 |
| `dangerous` | fast_apply 目標含 .zshenv/.bashrc/.npmrc 等 | ❌ 阻斷 |

#### 階段 B：安全分類器引擎（~200 行，1 週）

- 取代 hardcode 分類，用規則引擎
- 動態檢查：若最近有 security finding，write 工具升級為 gate

#### 階段 C：智慧安全檢查（~300 行，2 週）

- 非同步背景安全掃描（fire-and-forget）
- 可整合現有 `smart_security`

### 所需檔案

| 檔案 | 修改類型 | 規模 |
|------|---------|------|
| `src/lib/auto-classifier.mjs` | **新增** | ~120 行 |
| `src/server/index.mjs` | 修改 invokeTool() + runtimeConfig | ~100 行 |

---

## ⚖️ 比較與建議順序

| 面向 | Auto Mode | Hooks |
|------|-----------|-------|
| 階段 A 實作量 | ~150 行 | ~200 行 |
| 與現有架構衝突 | 低 | 低（平滑遷移） |
| 用戶立即有感 | ✅ 一鍵靜音 | ✅ 自動格式化/lint |
| 差異化價值 | 中 | 高 |
| 技術風險 | 低 | 低 |

**建議先做 Hooks 階段 A**，理由：
1. 本質是**重構** — 把三個各自獨立的 fire-and-forget 統一管理，立即降低複雜度
2. Hooks 完成後，Auto Mode 的背景安全檢查可直接重用 hook pipeline
3. 兩者共用 `_respondChain` 非同步架構

**時間估計**：Hooks 階段 A（3-4 天）→ Auto Mode 階段 A（2-3 天）→ **總計 1-1.5 週**

---

## 📋 參考原始碼位置

- `src/server/index.mjs` — 主 server：tool 執行流程、門控、pending hooks
- `src/server/loader.mjs` — 工具載入器：plugin 合約、mapArgs
- `src/lib/concurrency-gate.mjs` — 併發閘：工具權重、佇列
- `src/lib/safe-handler.mjs` — Handler 安全包裝（try-catch）
- `src/lib/hallucination-judge.mjs` — 幻覺檢查（現有 post-hook 之一）
- `src/lib/context-manager.mjs` — Context 管理

---

## 📊 實作對照總表（2026-06-19 驗證）

| 規劃項目 | 狀態 | 實際檔案/位置 | 備註 |
|---------|------|-------------|------|
| **Hooks 階段 A**：Hook Registry | ✅ 全部實作 | `src/lib/hook-registry.mjs` (476 行) | register/hook API、executePreHooks/PostHooks、initBuiltinHooks、invokeTool Phase 8/9、respond() _pendingHooks |
| **Hooks 階段 B**：用戶自訂 Hooks | ✅ 全部實作 | `src/server/index.mjs` L2993 | smart_hook tool (add/list/remove/enable/disable)、bash action with template vars、mcp_tool action (stub)、~/.smart/hooks.json 持久化 |
| **Hooks 階段 C**：Production 強化 | ✅ 全部實作 | `src/lib/hook-registry.mjs` | 10s timeout、max 10 hooks/type、concurrency 3、execution log、defer support |
| **Auto Mode 階段 A**：基礎模式切換 | ✅ 已實作 (2 Missing ⚠️) | `src/lib/auto-classifier.mjs` (300 行) | classifyTool、runtimeConfig.mode、invokeTool block/warn/gate、smart_config set:{mode:'auto'} |
| **Auto Mode 階段 B**：分類器引擎 | ✅ 已實作 | `src/lib/auto-classifier.mjs` | addRule/removeRule/listRules、PRIORITY、extraCheck、$defaults |
| **Auto Mode 階段 C**：智慧安全檢查 | ✅ 已實作 | hook-init + `security-scan.mjs` | 原 fire-and-forget，已遷移為內建 hooks |

### 找到的 Gap（目前已全部修復 ✅）

1. **✅ `~/.smart/config.json` 持久化** — 新增 `loadConfig()` / `saveConfig()`，啟動時自動載入，`smart_config` 改變後自動存檔
2. **✅ 專屬 auto-mode 測試（40 項）** — `tests/auto-classifier.test.mjs`，涵蓋工具分類 / 封鎖檔案 / 安全上下文 / 規則管理 / summary / override
3. **✅ mcp_tool hook action** — `setMcpToolInvoker` 注入，支援 JS handler 工具直接呼叫 + CLI 工具 spawnSync
4. **✅ 範例 hook 腳本** — `examples/hooks/pre-format.sh` + `examples/hooks/pre-commit-lint.sh` + README
