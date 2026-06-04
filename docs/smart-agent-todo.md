# Smart Agent — 待辦清單

> 本檔案定義 smart-agent 整合的具體執行步驟。
> 與 `smart-agent-plan.md` 互為補充：plan.md 定義「要做什麼、為什麼」，todo.md 定義「具體步驟」。

---

## Phase A：Package 骨架

### A.1 建立 package.json

- [ ] 在 `smart-agent/` 目錄建立 `package.json`
- [ ] name: `smart-agent`
- [ ] peerDependencies: `smart-mcp@^3.2.0`
- [ ] scripts: `{ "postinstall": "node install/postinstall.mjs" }`
- [ ] 驗證：`npm install ./smart-agent` 成功

### A.2 建立目錄結構

- [ ] 建立 `smart-agent/src/agent/` 目錄
- [ ] 建立 `smart-agent/src/config/` 目錄
- [ ] 建立 `smart-agent/src/install/` 目錄
- [ ] 建立 `smart-agent/tests/` 目錄
- [ ] 建立 `smart-agent/README.md`（基本內容）

### A.3 建立骨架程式碼

- [ ] `smart-agent/src/agent/system-prompt.mjs`（匯出空片段）
- [ ] `smart-agent/src/agent/tool-strategy.mjs`（匯出 recommendTools 空函數）
- [ ] `smart-agent/src/agent/workflow-strategy.mjs`（匯出 autoExecute 空函數）
- [ ] `smart-agent/src/agent/memory-integration.mjs`（匯出空函數）
- [ ] `smart-agent/src/agent/planner-integration.mjs`（匯出空函數）
- [ ] `smart-agent/src/install/postinstall.mjs`（只印「安裝完成」）
- [ ] `smart-agent/src/install/detect-project.mjs`（空實作）
- [ ] `smart-agent/src/install/generate-config.mjs`（空實作）

### A.4 驗證 Phase A

- [ ] `npm install ./smart-agent` 不報錯
- [ ] `npm ls smart-mcp` 顯示 dependency
- [ ] `node smart-agent/src/install/postinstall.mjs` 輸出「安裝完成」

---

## Phase B：System Prompt 整合

### B.1 實作 System Prompt 片段

- [ ] 在 `system-prompt.mjs` 中實作 `SYSTEM_PROMPT_FRAGMENT`
- [ ] 包含 Tool 選擇原則（30 tools 的使用時機）
- [ ] 包含 Workflow 自動化說明
- [ ] 包含 Memory 整合說明
- [ ] 包含 Planner 整合說明

### B.2 設計注入機制

- [ ] 評估 opencode 支援的 env 注入方式
- [ ] 設計 `opencode.json` 中的 env 設定
- [ ] 實作 `smart-mcp` 端的 system prompt 讀取（如果需要）
- [ ] 撰寫初始化指引文件

### B.3 驗證 Phase B

- [ ] System prompt 片段正確匯出
- [ ] Agent 能正確載入並使用片段
- [ ] Agent 能正確回答「這個任務應該用哪個 tool」

---

## Phase C：Tool 策略引擎

### C.1 實作 Task Pattern 匹配

- [ ] 定義 `TASK_PATTERNS` 陣列（至少 10 種任務類型）
- [ ] 實作 `matchTaskPattern(goal)` 函數
- [ ] 測試常見任務的匹配結果

### C.2 實作 Tool 推薦邏輯

- [ ] 實作 `recommendTools(goal, context)` 函數
- [ ] 支援 context 參數（workflow 狀態、歷史失敗）
- [ ] 回傳 `{ primary, alternatives, reason }`
- [ ] 實作 `explainRecommendation(recommendation)` 函數

### C.3 實作 Tool Chain 策略

- [ ] 實作 `buildToolChain(goal)` 函數
- [ ] 根據任務類型推薦完整 tool 序列
- [ ] 支援 parallel hints（哪些步驟可平行）

### C.4 驗證 Phase C

- [ ] `recommendTools("debug login error")` → `smart_grep` + `smart_error_diagnose` + ...
- [ ] `recommendTools("refactor rename function")` → `smart_learn` + `smart_import_graph` + ...
- [ ] `recommendTools("security audit")` → `smart_security` + ...
- [ ] `recommendTools("understand codebase")` → `smart_learn` + ...

---

## Phase D：Workflow 自動化

### D.1 整合 smart_workflow dispatch

- [ ] 確認 `smart_workflow_execute` dispatch 功能已實作（Phase 5）
- [ ] 實作 `executeWorkflow(workflowId)` 包裝函數
- [ ] 實作 `pollWorkflowState(workflowId)` 輪詢直到完成

### D.2 實作 Auto-Execute

- [ ] 實作 `autoExecute(goal, options)` 主函數
- [ ] 自動建立 workflow → 執行 → replan → summary
- [ ] 支援 `options.replan` 控制失敗時是否 replan
- [ ] 支援 `options.timeout` 控制總超時

### D.3 新增 MCP Tool

- [ ] 在 `smart-mcp` 新增 `smart_agent_execute` tool
- [ ] 或：在 `smart_workflow` 新增 `auto` command
- [ ] 實作 handler：接收 goal → 呼叫 autoExecute → 回傳結果

### D.4 驗證 Phase D

- [ ] `smart_agent_execute({ goal: "debug login error" })` 全自動執行
- [ ] 失敗時自動 replan
- [ ] 完成後產出 summary
- [ ] 執行時間比手動 chain tools 快

---

## Phase E：Memory 自動整合

### E.1 實作 shouldRemember

- [ ] 實作 `shouldRemember(toolName, args, result)` 函數
- [ ] 失敗的 `smart_error_diagnose` → 值得記憶（score: 0.9）
- [ ] 失敗的 `smart_cross_file_edit` → 值得記憶（score: 0.7）
- [ ] 成功的 `smart_cross_file_edit` → 值得記憶（score: 0.8）
- [ ] 其他 tool 預設不記憶

### E.2 實作自動寫入

- [ ] 在 `invokeTool` / `captureAndReturn` 中整合 shouldRemember
- [ ] 值得記憶的結果自動呼叫 `smart_memory_store`
- [ ] 避免重複記憶（dedup）

### E.3 實作自動取出

- [ ] 在 `smart_error_diagnose` 執行前先查 memory store
- [ ] 找到相似記憶 → 回傳建議 + 標記「from-memory」
- [ ] 沒找到 → 正常執行，事後存入

### E.4 驗證 Phase E

- [ ] 錯誤發生後自動存入 memory store
- [ ] `memory_store list` 可看到新存入的記憶
- [ ] 相似錯誤再次發生時自動取出建議
- [ ] 記憶有正確的 score 和 category

---

## Phase F：Planner 整合

### F.1 實作 planAndExecute

- [ ] 實作 `planAndExecute(goal)` 函數
- [ ] 呼叫 `smart_planner` 分解目標
- [ ] 解析 planner 輸出（DAG + parallel hints）
- [ ] 回傳 `{ plan, estimatedSteps, parallelGroups, canExecute }`

### F.2 新增 MCP Tool

- [ ] 在 `smart-mcp` 新增 `smart_agent_plan` tool
- [ ] 實作 handler：接收 goal → 呼叫 planAndExecute → 回傳 plan

### F.3 驗證 Phase F

- [ ] `smart_agent_plan({ goal: "找出並修復所有安全漏洞" })` 回傳完整 plan
- [ ] plan 包含 DAG 結構
- [ ] plan 包含 parallel hints

---

## Phase G：安裝體驗優化

### G.1 實作 postinstall.mjs

- [ ] 實作 `ensureSmartMCP()`：檢查並安裝 smart-mcp
- [ ] 實作 `detectProject()`：偵測專案類型（language/framework）
- [ ] 實作 `generateOpencodeConfig()`：產生 local opencode.json
- [ ] 實作 `ensureMemoryDir()`：初始化 ~/.smart/memory/
- [ ] 支援可選的 `smart_learn` 初始學習

### G.2 實作 detect-project.mjs

- [ ] 偵測程式語言（Node.js/Python/Go/Rust...）
- [ ] 偵測框架（Express/Django/FastAPI/...）
- [ ] 偵測專案結構（src/test/dist...）
- [ ] 回傳 `{ language, framework, structure }`

### G.3 實作 generate-config.mjs

- [ ] 讀取 smart-mcp 路徑
- [ ] 產生 `opencode.json`（包含 MCP 設定）
- [ ] 處理路徑差異（絕對路徑）

### G.4 驗證 Phase G

- [ ] 在乾淨目錄執行 `npm install smart-agent`
- [ ] `opencode.json` 正確產生
- [ ] 重啟 opencode 後 smart-mcp 可用
- [ ] `npm ls` 顯示完整 dependency tree

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

## 測試清單

### 單元測試

- [ ] `tool-strategy.test.mjs` — recommendTools 測試（10+ 案例）
- [ ] `workflow-strategy.test.mjs` — autoExecute 測試
- [ ] `memory-integration.test.mjs` — shouldRemember 測試
- [ ] `planner-integration.test.mjs` — planAndExecute 測試

### 整合測試

- [ ] `agent.test.mjs` — 完整 workflow 測試
- [ ] `install.test.mjs` — 安裝流程測試

### 端到端測試

- [ ] 在乾淨環境安裝 smart-agent
- [ ] 執行 `smart_agent_execute({ goal: "debug login error" })`
- [ ] 驗證完整流程：create → execute → replan → summary

---

## 里程碑

| 里程碑 | 完成條件 | 預計日期 |
|--------|---------|---------|
| **M1: 骨架完成** | Phase A + B 完成，agent 可載入 system prompt | Day 7 |
| **M2: 策略引擎** | Phase C 完成，tool 推薦準確率 >80% | Day 14 |
| **M3: 自動化執行** | Phase D 完成，複雜任務自動執行成功 | Day 21 |
| **M4: 記憶整合** | Phase E 完成，錯誤自動記憶/取出 | Day 28 |
| **M5: 完整交付** | Phase F + G + H 完成，發布 npm | Day 35 |

---

## 依賴關係圖

```
Phase A (骨架)
    │
    ▼
Phase B (System Prompt) ──→ M1
    │
    ▼
Phase C (Tool Strategy) ──→ M2
    │
    ├──→ Phase D (Workflow) ──→ M3
    │
    ├──→ Phase E (Memory) ────→ M4
    │
    └──→ Phase F (Planner) ───→ M4
            │
            ▼
        Phase G (Install) ──→ M5
            │
            ▼
        Phase H (Publish) ──→ M5
```

---

## 備註

- Phase D 依賴 smart-mcp Phase 5（workflow dispatch）已實作
- Phase E 依賴 smart-mcp Phase 1（memory-store）已實作
- Phase F 依賴 smart-mcp Phase 2（planner）已實作
- Phase G 需要 Node.js 環境支援 npm install