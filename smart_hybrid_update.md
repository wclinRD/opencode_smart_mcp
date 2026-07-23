# smart-hybrid.md 更新計畫（code-review-graph 整合）

## 📋 更新概述

**目標**：在 smart-hybrid.md 中新增 code-review-graph 整合的工具說明和工作流。

**更新範圍**：
1. Permission 區域
2. Direct MCP tools 表格
3. Sub-tools 表格
4. 常用工作流速查
5. 工具規則

---

## 🔄 區域 1：Permission 區域（第 6-53 行）

### 新增 Core 工具 Permission

```yaml
  # ── Smart MCP 層（Layer 1 直接工具）──
  smart_smart_run: allow    # Sub-tools 路由入口
  smart_context: allow      # Session 管理
  smart_grep: allow         # 🥇 程式碼搜尋（取代 raw grep）
  smart_learn: allow        # 專案 onboarding
  smart_deep_think: allow   # 深度分析
  smart_think: allow        # 快速推理
  smart_decompose: allow    # 小模型任務分解 scaffold
  smart_decompose_think: allow  # 小模型 think↔tool 迴圈
  smart_security: allow     # 安全掃描
  smart_test: allow         # 測試執行
  smart_lsp: allow          # LSP 程式碼理解
  smart_read: allow         # 🥇 漸進式檔案讀取，11 種模式。Session cache 零重複磁碟 I/O
  smart_rules: allow        # 專案規則查詢
  smart_edit_chain: allow         # 🥇 批次編輯鏈（N 編輯 1 次 MCP 呼叫）
  smart_eda_search: allow         # 🥇 EDA 領域智慧知識引擎
  smart_rtl_analyze: allow       # 🥇 RTL 程式碼分析引擎
  smart_exa_search: allow         # 🥇 網路搜尋（取代 websearch/webfetch）
  smart_exa_crawl: allow          # 🥇 網頁爬取
  smart_github_search: allow      # 🥇 GitHub 程式碼搜尋
  smart_glob: allow             # 🥇 檔案 glob（取代內建 glob）
  smart_medical_search: allow   # 🥇 免費醫學文獻與臨床證據查詢
  smart_compact: allow          # 零成本 context 壓縮
  smart_config: allow           # Runtime 設定
  
  # 🆕 code-review-graph 整合工具
  smart_tree_sitter: allow      # 🆕 Tree-sitter AST 解析引擎（30+ 語言）
  smart_incremental: allow      # 🆕 增量更新引擎（< 2 秒更新 2,900 檔案）
```

### 新增 Standard 工具 Permission（透過 ssr）

```yaml
  # ── 其他工具 ──
  websearch: deny       # 強制使用 smart_exa_search
  bash:
    node: allow
    npm: allow
    git: allow          # git 操作
    curl: allow         # 下載檔案 / GitHub API
  todowrite: allow
  skill: allow          # Skill 載入
  subagent: allow       # 允許啟動 Subagent（複雜任務委派用）
  task: allow           # 允許使用 task 工具分派 Subagent
  
  # 🆕 code-review-graph Standard 工具（透過 ssr）
  # smart_blast_radius: allow   # 爆炸半徑分析（經 ssr）
  # smart_risk_score: allow     # 風險評分（經 ssr）
  # smart_community: allow      # 社群偵測（經 ssr）
```

---

## 🔄 區域 2：Direct MCP tools 表格（第 173-200 行）

### 新增 Core 工具說明

```markdown
| 工具 | 時機 |
|------|------|
| `smart_grep({pattern, budget?, compress?})` | 程式碼搜尋（附 scope/import/BM25；`--budget N` token 預算；`--compress L0\|L1\|L2` 壓縮等級） |
| `smart_learn({root})` | 新專案 onboarding |
| `smart_think({mode, thought, nextThoughtNeeded})` | 🥇 快思。`mode:"cit"` 預設 BN-DP 自動分支。`"beam"` 高風險多路徑。`"structured"` GOAL/STATE/ALGO/EDGE/VERIFY 省 50-70% token |
| `smart_decompose({goal, subtasks, currentSubtaskId, thought, nextNeeded})` | 🆕 小模型專用推理 scaffold。強制任務分解 + 工具引導 + 循環檢測 |
| `smart_decompose_think({goal, subtasks, ...})` | 🆕 小模型 think↔tool 迴圈（FR-CoT + budget auto-detect + XML parsing） |
| `smart_deep_think({topic, template})` | 慢想深度分析（10 模板含 peer_review） |
| `smart_security({scan?, failOn?})` | 🥇 安全掃描（`.env` 洩漏偵測）。`failOn:"high"` 阻擋提交 |
| `smart_test({root?, coverage?, related?, grep?})` | 🥇 測試執行。`coverage:true` / `related:"src/x.ts"` / `grep:"name"` |
| `smart_fast_apply({file, content\|search, replace\|sed, file, sed})` | 🥇 統一編輯（10 格式，6 級 fuzzy → structural → diff-match-patch → conflict，validate+auto-retry，atomic multi-file，dry-run 安全） |
| `smart_edit_chain({chain, apply?, atomic?})` | 🥇 批次編輯鏈（1 次呼叫 = N 編輯，自動偵測格式，共享檔案讀取，原子 rollback，節省 40-60% token） |
| `smart_context({command})` | Session 管理 + budget 查詢 |
| `smart_rules({file})` | **編輯前必查**專案規則 |
| `smart_lsp({operation, file, line, character})` | Type-aware 程式碼理解。7 種操作：`definition`、`references`、`hover`、`symbols`、`diagnostics`、`code_action`、`apply_edit` |
| `smart_read({file, mode?, symbol?, ...})` | 🥇 取代 raw read。11 種模式（auto/outline/signatures/symbol/explain/range/full/batch/project/image/目錄）。Session cache |
| `smart_compact({toolHistory})` | 零成本 context 壓縮 |
| `smart_config({set?})` | Runtime 設定（modelSize/mode/debug/timeoutMs） |
| `smart_exa_search({command, query, numResults?, searchType?, category?, highlights?, includeDomains?, excludeDomains?, startDate?, endDate?})` | 🥇 網路搜尋（取代 websearch/webfetch）。進階：searchType(auto/fast/instant)、category(8類)、highlights(10x省token)、domain/date filter |
| `smart_exa_crawl({urls, clean?, markdown?, chunk?, searchType?, category?, highlights?})` | 🥇 網頁爬取 |
| `smart_github_search({query, repo?, language?})` | 🥇 GitHub 程式碼搜尋 |
| `smart_glob({pattern, path?, depth?, maxFiles?, exclude?, type?, sort?, format?})` | 🥇 檔案 glob（rg 底層）。支援逗號分隔多 pattern |
| `smart_medical_search({question, action?, query?, maxResults?, dateFrom?, dateTo?})` | 🥇 免費醫學文獻與臨床證據查詢 + 藥典（9 來源，免 API 金鑰） |
| `smart_eda_search({question, action?, query?, maxResults?})` | 🥇 EDA 領域智慧知識引擎。55+ 工具索引。18 種 action |
| `smart_rtl_analyze({command, file?})` | 🥇 RTL 程式碼分析引擎。12 種命令 |
| `smart_tree_sitter({command, file, root?, language?, nodeTypes?})` | 🆕 Tree-sitter AST 解析引擎。支援 30+ 種語言。提取函數、類別、匯入、呼叫等結構。`command:"parse"` 解析檔案、`command:"languages"` 列出支援語言、`command:"stats"` 顯示統計 |
| `smart_incremental({command, root?, files?, watch?, debounceMs?})` | 🆕 增量更新引擎。`command:"update"` 增量更新、`command:"watch"` 監看模式、`command:"status"` 顯示狀態。< 2 秒更新 2,900 檔案。SHA-256 雜湊檢查避免重複解析 |
```

---

## 🔄 區域 3：Sub-tools 表格（第 203-225 行）

### 新增 Standard 工具說明

```markdown
### Sub-tools（透過 ssr 呼叫）

格式：`ssr({tool:"工具名", args:{...}})`

| 分類 | 工具 |
|------|------|
| 路由 | `hybrid_router` |
| 程式碼分析 | `arch_overview`, `import_graph`, `code_call_graph`, `code_ast`, `code_type_infer`, `code_query`, `code_impact`, `impact_flow`, `codebase_index`, `naming`, `consistency_check` |
| 編輯 | `patch_gen`, `cross_file_edit`, `rename_safety` |
| 文件 | `ingest_document`, `list_documents`, `search_docs` |
| Git | `git_context`, `git_commit`, `git_review`, `git_pr` |
| 除錯 | `error_diagnose`, `debug` |
| 規劃/目標 | `planner`, `goal`, `memory_store`, `design_doc` |
| Onboarding | `setup` |
| 依賴 | `deps` |
| 自動化 | `autofix`, `pr_review`, `agent_execute`, `compose`, `workflow` |
| 重構 | `refactor_plan`, `exec` |
| 學術/醫學 | `academic_search`, `academic_review`, `docx_generate`, `hallucination_check` |
| 知識庫 | `obsidian_write`, `kg`, `adr` |
| 資料 | `db` |
| 排程 | `schedule`, `progress` |
| 瀏覽器 | `pw_browser` |
| 🆕 code-review-graph | `smart_blast_radius`, `smart_risk_score`, `smart_community` |
```

---

## 🔄 區域 4：常用工作流速查（第 384-396 行）

### 新增 code-review-graph 工作流

```markdown
### 常用工作流速查

| 情境 | 路由 | 步驟 |
|------|------|------|
| Brainstorming | 🟢 | `smart_think({mode:"cit"})` 確認需求 → 列出 acceptance criteria → `ssr(design_doc)` |
| TDD 循環 | 🟢 | RED：寫測試看 fail → GREEN：最小實作測試 pass → REFACTOR：清理 → 再驗證 |
| 修 Bug | 🔴 | `smart_think(拆分)` → `todowrite` → `task(error_diagnose) → task(debug) → task(smart_fast_apply) → task(smart_test)` → `smart_deep_think(整合)` → 迭代判斷 |
| 重構 | 🔴 | `smart_think(拆分)` → `todowrite` → `task(import_graph) → task(code_impact) → task(smart_fast_apply) → task(smart_test)` → `smart_deep_think(整合)` → 迭代判斷 |
| 新功能 | 🔴 | `smart_think(確認spec)` → `smart_think(拆分)` → `todowrite` → `task(planner) → task(smart_fast_apply) → task(smart_test)` → `smart_deep_think(整合)` → 迭代判斷 |
| 批次編輯 | 🟢 | `smart_edit_chain({chain:[{file,search,replace}]})` → `smart_test`（1 次 MCP 呼叫完成 N 編輯，省 40-60% token） |
| Git 流程 | 🟢 | `ssr(git_context) → ssr(git_commit) → smart_test → ssr(git_pr)` |
| 安全修復 | 🔴 | `smart_security` → `smart_think({mode:"beam"})` → `smart_think(拆分)` → `todowrite` → `task(smart_fast_apply) → task(smart_test) → task(rescan)` → `smart_deep_think(整合)` → 迭代判斷 |
| GitHub Repo 研究 | 🔴 | `git clone --depth 1` → `smart_learn({root})` → `smart_think({mode:"cit"})` 架構分析 → `smart_read({mode:"outline"})` 結構 → `smart_grep({pattern})` 搜尋 → 回報摘要 |
| 🆕 影響分析 | 🟢/🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(impact_flow)` → `ssr(smart_blast_radius)` → `smart_think({mode:"cit"})` 分析 → 回報影響範圍 |
| 🆕 風險評分 | 🟢 | `smart_tree_sitter({command:"parse"})` → `ssr(smart_risk_score)` → `smart_think({mode:"cit"})` 評估 → 回報風險等級 |
| 🆕 架構分析 | 🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(arch_overview)` → `ssr(smart_community)` → `smart_deep_think({template:"analyze"})` → 回報架構建議 |
| 🆕 增量更新 | 🟢 | `smart_incremental({command:"update"})` → `smart_incremental({command:"status"})` → 回報更新結果 |
```

---

## 🔄 區域 5：工具規則（第 294-340 行）

### 新增 code-review-graph 規則

```markdown
### 搜尋優先順序

```
搜尋：smart_exa_search > smart_grep > raw
讀取：smart_read（11 種模式）
編輯：smart_fast_apply / smart_edit_chain
推理：smart_think（快）/ smart_deep_think（慢）
安全：smart_security → smart_think({mode:"beam"})
🆕 程式碼結構：smart_tree_sitter（30+ 語言）> smart_lsp（型別 aware）
🆕 影響分析：ssr(impact_flow) + ssr(smart_blast_radius) > smart_grep
🆕 風險評分：ssr(smart_risk_score) > smart_think({mode:"beam"})
```

### LSP 優先

```
定義→definition、型別→hover、引用→references
錯誤→diagnostics、修復→code_action
🆕 AST 解析→smart_tree_sitter（更全面、更多語言）
LSP timeout → retry 一次（縮小 scope），仍 timeout 才用 smart_grep
```

### code-review-graph 整合規則

```
🆕 Tree-sitter 解析：
  - 新專案先用 smart_tree_sitter({command:"parse"}) 建立結構
  - 增量更新用 smart_incremental({command:"update"})
  - 大型檔案用 smart_tree_sitter({command:"parse", nodeTypes:["function"]}) 提取特定結構

🆕 影響分析：
  - 變更前先用 ssr(impact_flow) 分析影響範圍
  - 高風險變更用 ssr(smart_blast_radius) 計算爆炸半徑
  - 結合 smart_think({mode:"beam"}) 進行多路徑分析

🆕 風險評分：
  - PR 審查用 ssr(smart_risk_score) 評估風險
  - 根據風險等級決定審查深度
  - HIGH 風險→smart_think({mode:"beam"})、MEDIUM→smart_think({mode:"cit"})、LOW→直接通過

🆕 社群偵測：
  - 架構分析用 ssr(smart_community) 偵測社群
  - 識別跨社群耦合和架構弱點
  - 結合 ssr(arch_overview) 提供優化建議
```

---

## 📝 完整更新內容

### 區域 1 更新（Permission）

```yaml
  # 🆕 code-review-graph 整合工具
  smart_tree_sitter: allow      # 🆕 Tree-sitter AST 解析引擎（30+ 語言）
  smart_incremental: allow      # 🆕 增量更新引擎（< 2 秒更新 2,900 檔案）
```

### 區域 2 更新（Direct MCP tools）

```markdown
| `smart_tree_sitter({command, file, root?, language?, nodeTypes?})` | 🆕 Tree-sitter AST 解析引擎。支援 30+ 種語言。提取函數、類別、匯入、呼叫等結構。`command:"parse"` 解析檔案、`command:"languages"` 列出支援語言、`command:"stats"` 顯示統計 |
| `smart_incremental({command, root?, files?, watch?, debounceMs?})` | 🆕 增量更新引擎。`command:"update"` 增量更新、`command:"watch"` 監看模式、`command:"status"` 顯示狀態。< 2 秒更新 2,900 檔案。SHA-256 雜湊檢查避免重複解析 |
```

### 區域 3 更新（Sub-tools）

```markdown
| 🆕 code-review-graph | `smart_blast_radius`, `smart_risk_score`, `smart_community` |
```

### 區域 4 更新（工作流）

```markdown
| 🆕 影響分析 | 🟢/🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(impact_flow)` → `ssr(smart_blast_radius)` → `smart_think({mode:"cit"})` 分析 → 回報影響範圍 |
| 🆕 風險評分 | 🟢 | `smart_tree_sitter({command:"parse"})` → `ssr(smart_risk_score)` → `smart_think({mode:"cit"})` 評估 → 回報風險等級 |
| 🆕 架構分析 | 🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(arch_overview)` → `ssr(smart_community)` → `smart_deep_think({template:"analyze"})` → 回報架構建議 |
| 🆕 增量更新 | 🟢 | `smart_incremental({command:"update"})` → `smart_incremental({command:"status"})` → 回報更新結果 |
```

### 區域 5 更新（工具規則）

```markdown
### code-review-graph 整合規則

```
🆕 Tree-sitter 解析：
  - 新專案先用 smart_tree_sitter({command:"parse"}) 建立結構
  - 增量更新用 smart_incremental({command:"update"})
  - 大型檔案用 smart_tree_sitter({command:"parse", nodeTypes:["function"]}) 提取特定結構

🆕 影響分析：
  - 變更前先用 ssr(impact_flow) 分析影響範圍
  - 高風險變更用 ssr(smart_blast_radius) 計算爆炸半徑
  - 結合 smart_think({mode:"beam"}) 進行多路徑分析

🆕 風險評分：
  - PR 審查用 ssr(smart_risk_score) 評估風險
  - 根據風險等級決定審查深度
  - HIGH 風險→smart_think({mode:"beam"})、MEDIUM→smart_think({mode:"cit"})、LOW→直接通過

🆕 社群偵測：
  - 架構分析用 ssr(smart_community) 偵測社群
  - 識別跨社群耦合和架構弱點
  - 結合 ssr(arch_overview) 提供優化建議
```

---

## 🎯 更新建議

### 優先順序

1. **Phase 1 更新**（立即）：
   - 新增 `smart_tree_sitter` 和 `smart_incremental` 到 permission 和 Direct MCP tools
   - 新增影響分析和增量更新工作流

2. **Phase 2 更新**（2-3 月後）：
   - 新增 `smart_blast_radius`、`smart_risk_score`、`smart_community` 到 Sub-tools
   - 新增風險評分和架構分析工作流

3. **Phase 3 更新**（3-6 月後）：
   - 完整整合所有工具和工作流
   - 新增完整的工具規則

### 測試建議

1. **更新後測試**：
   - 確認所有新工具可正常呼叫
   - 確認工作流可正常執行
   - 確認工具規則正確應用

2. **向後相容性測試**：
   - 確認現有功能不受影響
   - 確認舊工作流仍可正常執行

---

*最後更新：2026-07-21*
*版本：v1.0*
