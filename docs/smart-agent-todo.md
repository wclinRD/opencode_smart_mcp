# Smart Agent — 待辦清單

> 本檔案定義 smart-agent 整合的具體執行步驟。
> 與 `smart-agent-plan.md` 互為補充：plan.md 定義「要做什麼、為什麼」，todo.md 定義「具體步驟」。

---

## ✅ Phase A：Package 骨架 (2026-06-04) ✅

**實作摘要**: 完整 package 結構已建立，包含 package.json、src/agent/、src/config/、src/install/、tests/ 目錄。所有模組皆已完整實作（非僅骨架）。

### A.1 建立 package.json

- [x] 在 `smart-agent/` 目錄建立 `package.json`
- [x] name: `smart-agent`
- [x] peerDependencies: `smart-mcp@^3.2.0`
- [x] scripts: `{ "postinstall": "node install/postinstall.mjs" }`
- [x] 驗證：`npm install ./smart-agent` 成功

### A.2 建立目錄結構

- [x] 建立 `smart-agent/src/agent/` 目錄
- [x] 建立 `smart-agent/src/config/` 目錄
- [x] 建立 `smart-agent/src/install/` 目錄
- [x] 建立 `smart-agent/tests/` 目錄

### A.3 建立模組程式碼（完整實作）

- [x] `smart-agent/src/index.mjs` — 主入口，匯出所有模組
- [x] `smart-agent/src/agent/system-prompt.mjs` — 完整 System Prompt 片段（含 30+ 工具策略 + workflow + compose + memory + planner）
- [x] `smart-agent/src/agent/tool-strategy.mjs` — 完整推薦引擎（12 任務類型、pattern 匹配、context 感知、工具鏈生成）
- [x] `smart-agent/src/agent/workflow-strategy.mjs` — 完整 Workflow 策略（template 選擇、dispatch/replan/summary 命令生成、findings 提取）
- [x] `smart-agent/src/agent/memory-integration.mjs` — 完整記憶整合（7 種規則的 shouldRemember、store command 生成、記憶格式化）
- [x] `smart-agent/src/agent/planner-integration.mjs` — 完整 Planner 整合（計劃生成、DAG 分析、步驟決定、複雜度預估）
- [x] `smart-agent/src/install/postinstall.mjs` — 安裝完成提示
- [x] `smart-agent/src/install/detect-project.mjs` — 專案類型偵測（7 語言 + 框架分析）
- [x] `smart-agent/src/install/generate-config.mjs` — opencode config 生成（自動尋找 smart-mcp 路徑）
- [x] `smart-agent/src/config/opencode.json` — opencode 配置模板
- [x] `smart-agent/.opencode-conventions.json` — 預設專案慣例

### A.4 驗證 Phase A

- [x] `npm install ./smart-agent` 不報錯
- [x] 65 個測試全部通過（`node --test tests/`）
- [x] 支援完整工具推薦、工作流自動化、記憶整合、計劃分解

---

## ✅ Phase B：System Prompt 整合 (2026-06-04) ✅

**實作摘要**: 完整的 SYSTEM_PROMPT_FRAGMENT 已匯出，涵蓋 30+ 工具選擇時機、workflow 自動化、compose pipeline、memory 整合、context 管理、planner 策略。8 項驗證測試通過。

### B.1 實作 System Prompt 片段

- [x] 在 `system-prompt.mjs` 中實作 `SYSTEM_PROMPT_FRAGMENT`（~3500 chars）
- [x] 包含 Tool 選擇原則（30+ tools 的使用時機）
- [x] 包含 Workflow 自動化說明（debug/refactor/security/research/git-flow）
- [x] 包含 Compose pipeline 說明（seq/par/cond）
- [x] 包含 Memory 整合說明（store/confirm/stats patterns）
- [x] 包含 Context 管理說明（summary/findings/reset）
- [x] 包含 Planner 整合說明
- [x] 8 項驗證測試全部通過

---

## ✅ Phase C：Tool 策略引擎 (2026-06-04) ✅

**實作摘要**: 完整的 recommendTools / buildToolChain / explainRecommendation 引擎。12 種任務類型（debug/refactor/rename/security/understand/test/git/research/diagram/performance/dependency/setup）。context-aware 過濾、詳細評分解釋。21 項測試全部通過。

### C.1 實作 Task Pattern 匹配

- [x] 定義 `TASK_PATTERNS` 陣列（12 種任務類型）
- [x] 實作 `matchTaskPattern(goal)` 函數（多重 regex 加權評分）
- [x] 測試常見任務的匹配結果（21 測試通過）

### C.2 實作 Tool 推薦邏輯

- [x] 實作 `recommendTools(goal, context)` 函數
- [x] 支援 context 參數（recentTools 過濾、workflow 狀態感知）
- [x] 回傳 `{ primary, alternatives, chain, reason, matchScore }`
- [x] 實作 `explainRecommendation(recommendation)` 函數（Markdown 格式）

### C.3 實作 Tool Chain 策略

- [x] 實作 `buildToolChain(goal)` 函數（含 dependsOn 依賴分析）
- [x] 根據任務類型推薦完整 tool 序列
- [x] 支援 parallel hints（相依性分析）

### C.4 驗證 Phase C

- [x] `recommendTools("debug login error")` → `smart_grep` + `smart_error_diagnose` + ...
- [x] `recommendTools("security audit")` → `smart_security` + ...
- [x] `recommendTools("understand codebase")` → `smart_learn` + ...
- [x] 21 項測試全部通過

---

## ✅ Phase D：Workflow 自動化 (2026-06-04) ✅

**實作摘要**: workflow-strategy.mjs 提供完整的工作流自動化 API：template 選擇（6 種）、planAutoExecute、getDispatchCommand、getReplanCommand、getSummaryCommand、shouldReplan、extractFindings。18 項測試通過。

### D.1 整合 smart_workflow dispatch

- [x] 確認 `smart_workflow_execute` dispatch 功能已實作（Phase 5 ✅）
- [x] 實作 `getDispatchCommand(workflowState)` 命令生成函數
- [x] 實作 `getReplanCommand(workflowId, statePath, context)` 命令生成

### D.2 實作 Auto-Execute 命令生成

- [x] 實作 `planAutoExecute(goal, options)` — create 命令生成
- [x] 支援自動 template 選擇（`selectTemplate()` 6 種）
- [x] 支援 `options.replan`、`options.state`、`options.json`
- [x] `getSummaryCommand()` — summary 命令生成

### D.3 狀態決策

- [x] `shouldReplan(stepResult)` — 判斷是否需要 replan
- [x] `extractFindings(summary)` — 從 summary 提取 actionable findings
- [x] 18 項測試全部通過

---

## ✅ Phase E：Memory 自動整合 (2026-06-04) ✅

**實作摘要**: memory-integration.mjs 提供 7 種記憶規則（resolution/refactor/security/debug/test/optimization）、shouldRemember 決策引擎、buildStoreCommand 命令生成、formatMemoryResult 格式化。13 項測試通過。

### E.1 實作 shouldRemember

- [x] 實作 `shouldRemember(toolName, args, result)` 函數（7 條規則）
- [x] 失敗的 `smart_error_diagnose` → 值得記憶（score: 0.9）
- [x] 成功的 `smart_cross_file_edit` → 值得記憶（score: 0.8）
- [x] 失敗的 `smart_cross_file_edit` → 值得記憶（score: 0.7）
- [x] 安全發現、除錯 root cause、測試失敗、TOON 優化 → 值得記憶
- [x] smart_grep、一般 test 等不記憶

### E.2 實作記憶命令生成

- [x] `buildStoreCommand()` — 產生 `smart_memory_store` 命令
- [x] 自動分類（runtime/refactor/security/test/optimization...）
- [x] 自動建構 resolution 描述

### E.3 實作記憶格式化

- [x] `formatMemoryResult()` — 將記憶搜尋結果格式化為可讀文字
- [x] 支援空結果、entries 格式、信心度顯示
- [x] 13 項測試全部通過

---

## ✅ Phase F：Planner 整合 (2026-06-04) ✅

**實作摘要**: planner-integration.mjs 提供 planAndExecute、analyzePlan、determineNextAction、needsPlanning 等完整 API。支援 DAG 分析、複雜度預估、風險識別、步驟決策。14 項測試全部通過。

### F.1 實作 planAndExecute

- [x] 實作 `planAndExecute(goal)` 函數（產生 `smart_planner execute` 命令）
- [x] 複雜度預估（low/medium/high 基於字數）
- [x] 支援 options（steps/strict/state）

### F.2 實作 Plan 分析

- [x] `analyzePlan(planOutput)` — 解析 planner 輸出
- [x] 步驟計數、平行群組計數
- [x] 時間預估（sequentialSteps × 5-15s）
- [x] 風險識別（onFailure=abort 關鍵步驟、無 dry-run 的編輯）

### F.3 步驟決策

- [x] `determineNextAction(planState, completedStep, status)` — 三種行動
- [x] continue：正常繼續
- [x] abort：關鍵步驟失敗
- [x] replan：onFailure=warn 觸發重新規劃
- [x] complete：所有步驟完成

### F.4 實作 needsPlanning

- [x] `needsPlanning(goal)` — 判斷目標是否夠複雜需要 planner
- [x] 啟發式：>15 字、多個關鍵詞、逗號分隔
- [x] 14 項測試全部通過

---

## ✅ Phase G：安裝體驗優化（部分完成）✅

> ⚠️ **兩層架構提醒**: 以下 Phase G 工作已透過 **smart-mcp 內建**方式完成（非 npm 方式）。
> 
> 新的架構是：
> - smart-mcp 內建 `config/agents/smart-mcp.md` 人格定義
> - smart-mcp 內建 3 個 agent MCP tools (`smart_agent_recommend/execute/plan`)
> - `smart-agent/` JS 模組作為 MCP tools 的後端引擎
> - `install-agent.mjs` 腳本可供自主安裝
>
> 待完成：將 `smart-agent/` 打包為 npm package 發布。

### G.1 實作 install-agent.mjs（已完成）

- [x] `smart-agent/src/install/install-agent.mjs` — 完整安裝腳本（支援 --dry-run / --force）
- [x] `install-agent.mjs` 一鍵安裝：agent 定義 + config + memory 目錄
- [x] `install-agent.mjs --dry-run` 預覽安裝計畫
- [x] 安裝完成後顯示成功訊息與後續步驟

### G.2 3 個 Agent MCP Tools 註冊（已完成）

- [x] `src/plugins/standard/agent-recommend.mjs` → `smart_agent_recommend` MCP tool
  - 12 種任務模式匹配（debug/refactor/security/explore/test/git/research/diagram/performance/dependency/setup/compose）
  - 回傳 `{ primary, alternatives, chain, reason }`
- [x] `src/plugins/standard/agent-execute.mjs` → `smart_agent_execute` MCP tool
  - 6 種 workflow template（debug-flow/refactor-flow/security-flow/explore-flow/git-flow/research-flow）
  - 回傳可執行的 workflow 指令序列
- [x] `src/plugins/standard/agent-plan.mjs` → `smart_agent_plan` MCP tool
  - 複雜目標分解（DAG + 複雜度分析 + 風險識別）
  - 回傳 `{ plan, steps, analysis }`

### G.3 兩層架構整合（已完成）

- [x] `config/agents/smart-mcp.md` — 220 行完整 agent 人格定義
- [x] 強模型路徑：system prompt 嵌入，agent 自主推理選擇工具
- [x] 弱模型路徑：不確定時呼叫 `smart_agent_recommend/execute/plan` 兜底
- [x] 13 項測試全部通過（5 smart-agent + 3 結構 + 5 handler）

### G.4 待完成：npm publish

- [ ] 打包 `smart-agent/` 為獨立 npm package
- [ ] `npm publish --access public`
- [ ] 驗證 `npm install smart-agent` 成功

---

## Phase H：文件與發布

### H.1 撰寫 README.md

- [ ] 安裝指引
- [ ] 快速開始（5 分鐘上手）
- [ ] 各模組說明
- [ ] API 參考
- [ ] 常見問題

### H.2 撰寫 ARCHITECTURE.md

- [ ] 系統架構圖
- [ ] 各模組職責
- [ ] 與 smart-mcp 的互動
- [ ] 設計決策說明

### H.3 發布到 npm

- [ ] 申請 npm account（如果還沒有）
- [ ] `npm login`
- [ ] `npm publish --access public`
- [ ] 驗證：`npm install smart-agent` 成功

### H.4 驗證 Phase H

- [ ] README.md 完整且正確
- [ ] `npm install smart-agent` 文件存在
- [ ] 別人安裝後能正常運作

---

## ✅ 測試清單 (全部通過)

### 單元測試（65 項 smart-agent + 13 項整合）

- [x] `system-prompt.test.mjs` — SYSTEM_PROMPT_FRAGMENT 驗證（8 項測試）
- [x] `tool-strategy.test.mjs` — recommendTools 測試（21 項測試，12 種任務類型）
- [x] `workflow-strategy.test.mjs` — workflow 命令生成（18 項測試）
- [x] `memory-integration.test.mjs` — shouldRemember + 格式化（13 項測試）
- [x] `planner-integration.test.mjs` — planAndExecute + 分析 + 決策（14 項測試）
- [x] `tests/agent-recommend.test.mjs` — `smart_agent_recommend` handler (5 項測試)
- [x] `tests/plugin-structure.test.mjs` — 3 個 plugin 結構驗證（檔案存在/export/註冊格式）
- [x] `tests/agent-execute.test.mjs` — `smart_agent_execute` handler（5 項測試，含所有 template）

### 驗證結果

- [x] `recommendTools("debug login error")` → `smart_grep`（正確匹配 debug 模式）
- [x] `recommendTools("security audit")` → `smart_security`（正確匹配安全模式）
- [x] `recommendTools("understand codebase")` → `smart_learn`（正確匹配探索模式）
- [x] `shouldRemember("smart_error_diagnose", fail)` → score 0.9（正確判斷記憶價值）
- [x] `planAndExecute("fix all security bugs")` → 回傳 planner 命令（正確生成）
- [x] `analyzePlan({steps, parallelHints})` → 回傳完整分析（步驟/時間/風險）
- [x] `selectTemplate("fix login error")` → `debug-flow`（正確選擇模板）
- [x] `smart_agent_recommend({ goal: "debug login error" })` → 回傳 smart_grep 工具鏈
- [x] `smart_agent_execute({ goal: "refactor auth" })` → 回完整 workflow 命令序列
- [x] `smart_agent_plan({ goal: "find security vulnerabilities" })` → 回分解計畫
- [x] **65 項 smart-agent 測試 + 13 項整合測試全部通過** (`node --test tests/`)

---

## 里程碑（已提前完成）

| 里程碑 | 完成條件 | 狀態 | 實際日期 |
|--------|---------|------|---------|
| **M1: 骨架+提示** | Phase A + B 完成，agent 可載入 system prompt | ✅ 完成 | Day 1 (2026-06-04) |
| **M2: 策略引擎** | Phase C 完成，tool 推薦準確率 >80% | ✅ 完成 | Day 1 (2026-06-04) |
| **M3: 自動化執行** | Phase D 完成，複雜任務自動執行決策 | ✅ 完成 | Day 1 (2026-06-04) |
| **M4: 記憶+規劃** | Phase E + F 完成，記憶自動化 + planner 整合 | ✅ 完成 | Day 1 (2026-06-04) |
| **M5: 完整交付** | Phase G + H 完成，發布 npm | ⏳ 部分完成（MCP tools + install-agent.mjs ✅，npm publish 待辦） | TBD |

---

## 依賴關係圖（更新）

```
Phase A (骨架) ────── 2026-06-04 ✅  (smart-agent JS modules)
    │
    ▼
Phase B (System Prompt) ── 2026-06-04 ✅  (→ config/agents/smart-mcp.md)
    │
    ▼
Phase C (Tool Strategy) ── 2026-06-04 ✅  (→ smart_agent_recommend)
    │
    ├──→ Phase D (Workflow) ── 2026-06-04 ✅  (→ smart_agent_execute)
    │
    ├──→ Phase E (Memory) ──── 2026-06-04 ✅
    │
    └──→ Phase F (Planner) ─── 2026-06-04 ✅  (→ smart_agent_plan)
            │
            ▼
        Phase G (Install) ── 2026-06-04 ✅╌╌╌ 部分完成（MCP tools + install-agent.mjs）
            │
            ▼
        Phase H (Publish) ── ⏳ 待辦（npm publish）
```

---

## 備註

- ✅ Phase A-F 已完整實作並通過 65 項測試
- ✅ Phase D 依賴 smart-mcp Phase 5（workflow dispatch）✅ 已實作
- ✅ Phase E 依賴 smart-mcp Phase 1（memory-store）✅ 已實作  
- ✅ Phase F 依賴 smart-mcp Phase 2（planner）✅ 已實作
- ✅ Phase G (Install) 部分完成：
  - `config/agents/smart-mcp.md` — 220 行人格定義 ✅
  - 3 個 Agent MCP tools (recommend/execute/plan) — handler-based ✅
  - `install-agent.mjs` — 一鍵安裝腳本 ✅
  - 13 項測試全部通過 ✅
  - 尚待：npm package 發布流程
- ⏳ Phase H (Publish) 需後續實作：README、ARCHITECTURE.md、npm publish
- 🔄 **架構轉變**：原本設計為獨立 npm package → 現在實作為 smart-mcp 內建能力 + 兩層架構