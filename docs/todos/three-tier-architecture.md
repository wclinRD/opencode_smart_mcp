# Smart MCP 三層漸進式載入 — 待辦清單

## Phase 1：smart-mcp.md 精簡化（核心，2-3 天）

### 1.1 工具表格精簡
- [ ] L0 工具表格：9 個工具，每個 1-2 行描述（從 3-5 行縮短）
  - [ ] `smart_read` — 1 行：11 種模式，完全取代 raw read
  - [ ] `smart_grep` — 1 行：regex 搜尋，附 scope/import context
  - [ ] `smart_glob` — 1 行：檔案 glob，rg --files --glob
  - [ ] `smart_fast_apply` — 2 行：統一編輯，支援 search-replace/unified-diff/hashline
  - [ ] `smart_context` — 1 行：session 管理 + budget 查詢
  - [ ] `smart_think` — 1 行：基本推理，cit mode（BN-DP 自動分支）
  - [ ] `smart_exa_search` — 1 行：網路搜尋，取代 websearch/webfetch
  - [ ] `smart_exa_crawl` — 1 行：網頁爬取，支援 clean/markdown/chunk
  - [ ] `smart_github_search` — 1 行：GitHub 程式碼搜尋
- [ ] L1 工具表格：11 個工具，每個 1 行 + 觸發條件說明
  - [ ] `smart_lsp` — type-aware 程式碼理解（定義/引用/型別/診斷）
  - [ ] `smart_learn` — 專案 onboarding
  - [ ] `smart_rules` — 專案規則查詢
  - [ ] `smart_codebase_index` — 程式碼索引 build/query/map
  - [ ] `smart_test` — 自動偵測測試框架
  - [ ] `smart_security` — 安全掃描
  - [ ] `smart_compact` — context 壓縮
  - [ ] `smart_hallucination_check` — 幻覺檢測
  - [ ] `smart_think` (beam/forest/structured) — 進階推理
  - [ ] `smart_deep_think` — 深度分析 10 模板
  - [ ] `smart_fast_apply` (advanced) — hashline/block-diff/AST 編輯
- [ ] L2 工具摘要：分類列表 + `smart_run` 入口說明
  - [ ] 程式碼分析 (9)：hybrid_router, arch_overview, import_graph, code_call_graph, code_query, code_impact, code_ast, code_type_infer, naming
  - [ ] 編輯 (3)：patch_gen, cross_file_edit, rename_safety
  - [ ] 除錯 (3)：error_diagnose, debug, test_suggest
  - [ ] Git (4)：git_context, git_commit, git_review, git_pr
  - [ ] 規劃 (4)：planner, workflow, compose, memory_store
  - [ ] 文件 (3)：ingest_document, list_documents, search_docs
  - [ ] 瀏覽器 (1)：pw_browser
  - [ ] 學術 (4)：academic_search, academic_review, docx_generate, hallucination_check
  - [ ] 知識庫 (4)：obsidian_write, kg, db, adr
  - [ ] 排程 (2)：schedule, progress
  - [ ] 自動化 (4)：autofix, pr_review, agent_execute, refactor_plan
  - [ ] 其他 (8)：research, model_router, impact_flow, integrate, agent_recommend, agent_plan, coverage, exec

### 1.2 內容搬移（移到 reference 文件）
- [ ] 建立 `config/agents/reference/` 目錄
- [ ] 搬移「架構評估工作流」→ `reference/workflows.md`
- [ ] 搬移「文件工具選擇指南（含 OCR）」→ `reference/documents.md`
- [ ] 搬移「常用工作流模式」表格 → `reference/workflows.md`
- [ ] 搬移「推理品質工作流」完整範例 → `reference/reasoning.md`
- [ ] 搬移「fast_apply 完整指南」→ `reference/fast-apply.md`
- [ ] 搬移「行為閘完整規則」→ `reference/behavior-gates.md`

### 1.3 保留內容（性格核心，精簡但完整）
- [ ] 權限規則區塊 → 不變
- [ ] 路由規則 → 精簡為 4 條核心規則
- [ ] 推理品質工作流 → 保留核心概念，去掉完整範例
- [ ] Token 優化 → 不變
- [ ] 行為閘 → 保留核心禁止事項
- [ ] 推理品質閘 → 保留強制規則表格
- [ ] Skill Learning → 保留核心流程

### 1.4 新增內容
- [ ] L1 觸發條件說明區塊
- [ ] L2 觸發條件說明區塊
- [ ] Reference 文件載入指引（`smart_rules({rule:"workflows"})` 等）

---

## Phase 2：Reference 文件建立（1 天）

- [ ] 建立 `config/agents/reference/workflows.md`
  - [ ] 架構評估工作流（7 步驟）
  - [ ] 常用工作流模式（25+ 情境）
- [ ] 建立 `config/agents/reference/documents.md`
  - [ ] 文件工具選擇指南
  - [ ] OCR 行為說明
  - [ ] 文件分析完整流程
- [ ] 建立 `config/agents/reference/reasoning.md`
  - [ ] CiT BN-DP 完整範例
  - [ ] Beam Search 完整範例
  - [ ] Forest-of-Thought 完整範例
  - [ ] Structured Thinking 完整範例
  - [ ] Self-Correction Loop 完整說明
  - [ ] 常用推理工作流表格
- [ ] 建立 `config/agents/reference/fast-apply.md`
  - [ ] 6 種 patch 格式完整說明
  - [ ] 使用情境對照表
  - [ ] AST 結構編輯說明
- [ ] 建立 `config/agents/reference/behavior-gates.md`
  - [ ] 完整禁止事項清單
  - [ ] task subagent 路由規則
  - [ ] LSP 優先原則
  - [ ] JSON 引號規則
  - [ ] Context Budget 意識

---

## Phase 3：MCP Server Tier Manager（2-3 天）

### 3.1 建立 `src/server/tier-manager.mjs`
- [ ] Tier state machine（L0 → L1 → L2）
- [ ] `detectFromConversation(text)` — 關鍵字匹配
  - [ ] L1 觸發關鍵字正則：`定義|引用|型別|重構|安全|測試|onboarding|規則|索引|深度分析|幻覺|diagnostics|references|definition|hover`
- [ ] `detectFromToolCall(toolName)` — 工具呼叫偵測
  - [ ] L1 工具清單：smart_lsp, smart_learn, smart_rules, smart_codebase_index, smart_test, smart_security, smart_compact, smart_hallucination_check, smart_deep_think
  - [ ] L2 工具清單：smart_run, smart_academic_search, smart_academic_review, smart_docx_generate
- [ ] `upgrade(tier)` — 升級並通知
- [ ] `getActiveTools()` — 回傳當前 tier 的 tools/list
- [ ] `getActivePromptHints()` — 回傳當前 tier 的 prompt 補充

### 3.2 整合到 `src/server/index.mjs`
- [ ] 在 `handleRequest` 中加入 conversation text 偵測
- [ ] 在 `invokeTool` / `invokeToolAsync` 中加入 tool call 偵測
- [ ] 在 `tools/list` handler 中依 tier 過濾工具
- [ ] 在 `smart_context` inject 中加入 reference 載入支援
  - [ ] `smart_context({command:"inject", rule:"workflows"})` → 載入 reference/workflows.md
  - [ ] `smart_context({command:"inject", rule:"documents"})` → 載入 reference/documents.md
  - [ ] `smart_context({command:"inject", rule:"reasoning"})` → 載入 reference/reasoning.md
  - [ ] `smart_context({command:"inject", rule:"fast-apply"})` → 載入 reference/fast-apply.md
  - [ ] `smart_context({command:"inject", rule:"behavior-gates"})` → 載入 reference/behavior-gates.md

### 3.3 測試
- [ ] L0 啟動：確認只有 9 個工具可用
- [ ] L1 觸發：關鍵字出現後，11 個 L1 工具變可用
- [ ] L2 觸發：smart_run 呼叫後，L2 工具變可用
- [ ] 降級測試：session reset 後回到 L0
- [ ] Reference 載入：inject 命令正確載入文件

---

## Phase 4：system-prompt.mjs 更新（0.5 天）

- [ ] 更新 `src/agent/system-prompt.mjs`
  - [ ] L0 工具清單（9 個，精簡）
  - [ ] L1/L2 觸發條件說明
  - [ ] Reference 文件載入方式
  - [ ] 保持與 smart-mcp.md 一致

---

## Phase 5：驗證與交付（1 天）

- [ ] 對比改造前後 smart-mcp.md 行數（目標：531 → ~250）
- [ ] 對比改造前後 token 數（目標：省 50%+）
- [ ] 確認所有工具在對應 tier 正確可用
- [ ] 確認性格核心（路由規則、行為閘、推理模式）完整保留
- [ ] 確認向後相容：現有功能不受影響
- [ ] `npm test` 全部通過
- [ ] 更新 `README.md`（如有需要）
- [ ] git commit & push

---

## 預期時間線

| Phase | 內容 | 時間 |
|-------|------|------|
| Phase 1 | smart-mcp.md 精簡化 | 2-3 天 |
| Phase 2 | Reference 文件建立 | 1 天 |
| Phase 3 | MCP Server Tier Manager | 2-3 天 |
| Phase 4 | system-prompt.mjs 更新 | 0.5 天 |
| Phase 5 | 驗證與交付 | 1 天 |
| **總計** | | **6.5-8.5 天** |