# Todo — 效能與 Token 優化實作追蹤

> 對應 plan.md 的 Phase 1（核心架構）。
> 每完成一項請更新狀態。

---

## ONFI SPEC RESEARCH ✅ (2026-06-06)

- [x] Round 1: 基礎架構（1309 行，~47 KB）
- [x] Round 2: 參數頁面/電氣規格/BGA pinmap/DFE-FFE-desks（1685 行，~62 KB）
- [x] Round 3: SCA 封包格式/DLL-PLL 頻率表/訓練 FSM/ZQ timing/Warmup/章節修正（2073 行）
- [x] 最終評分: **15/15 維度全 10/10**

---

## Phase 1：核心架構（目標 2-3 天）

### 1. 新增 `src/lib/output-optimizer.mjs` ✅

- [x] Format auto-detect：JSON / CSV / YAML / Markdown / HTML / Code / PlainText
- [x] Level 0 (Raw)：passthrough，無任何處理
- [x] Level 1 (Lossless)：Toonify for JSON/CSV/YAML，空白壓縮 for Markdown/Code
- [x] Level 2 (Smart Summary)：保留 critical section，壓縮次要 section
- [x] _optimized metadata 注入
- [x] Edge case：空輸出、非字串輸出、二進位輸出

### 2. 新增 `src/lib/cache-manager.mjs` ✅

- [x] 從 exa_crawl 抽出共用 cache 邏輯（Map-based Phase 1，SQLite Phase 2）
- [x] JSON 檔案持久化（Phase 1 替代 SQLite）
- [x] TTL 支援
- [x] In-memory + optional disk persistence
- [ ] ~~SQLite-based 持久化~~（Phase 2）
- [ ] ~~LRU eviction~~（Phase 2）

### 3. 修改 `src/server/loader.mjs` ✅

- [x] Plugin 介面新增可選 `responsePolicy` 欄位
- [x] 預設值：{ maxLevel: 0 }（lossless，不優化）
- [x] 無預設值的 plugin 自動補上 maxLevel: 0
- [ ] ~~驗證邏輯：maxLevel ∈ [0, 1, 2]~~（輕量驗證在 runtime）

### 4. 修改 `src/server/index.mjs` ✅

- [x] respond() 整合 output-optimizer：偵測 responsePolicy → 選層級 → 同步壓縮
- [x] L0/L1 同步執行（非同步不阻塞）
- [x] fire-and-forget Toonify 保留作為向後相容
- [x] 回傳附加 `_optimized` metadata（level, originalSize, compressedSize, savings, cacheKey）
- [x] 不改變現有 respondError / 非 text content 行為
- [x] phase 1 將 L2 降級為 L1（L2 Phase 2 啟用）
- [x] captureAndReturn 傳遞 def 以便 attach responsePolicy

### 5. 為核心 Plugin 加入 responsePolicy ✅

- [x] `src/plugins/core/grep.mjs` — maxLevel: 0
- [x] `src/plugins/core/learn.mjs` — maxLevel: 0
- [x] `src/plugins/core/security.mjs` — maxLevel: 2（Phase 2 啟用 L2）
- [x] `src/plugins/core/test.mjs` — maxLevel: 0
- [x] `src/plugins/core/quick-think.mjs` — maxLevel: 0
- [x] `src/plugins/core/thinking.mjs` — maxLevel: 0

### 6. 更新 Agent Personality ✅

- [x] `config/agents/smart-mcp.md` 加入 token 優化行為提示區塊
- [x] 定義 `_optimized` 回應處理規則（level 0/1 vs 2 不同策略）
- [x] 說明 format:full 互動決策樹

### 7. 測試驗證 ✅

- [x] output-optimizer unit test：format detection（18 cases）
- [x] output-optimizer unit test：L1/L2 compression（8 cases + 3 L2 + 3 async）
- [x] output-optimizer unit test：metadata correctness（3 cases）
- [x] integration test：responsePolicy L0 → no opt（3 cases）
- [x] integration test：responsePolicy L1 → compress（3 cases）
- [x] integration test：no policy safety（3 cases）
- [x] integration test：metadata contract format（2 cases）
- [x] integration test：CacheManager integration（4 cases）
- [x] integration test：JSON round-trip lossless（1 case）
- [x] 回歸測試：328 pass（non-context）+ 55 new = **383 tests, 0 fail**

---

## Phase 2：Smart Output Pipeline ✅

### Pipeline Layer

- [x] `src/lib/output-pipeline.mjs` — Pipeline 框架（5 built-in stages, registerStage API）
- [x] Built-in stages: format, compress, summarize, truncate, cache
- [x] Semantic truncator（Markdown/JSON/HTML/CSV/Code/PlainText）
- [x] Plugin 可選宣告 responsePipeline 覆寫預設（security.mjs 已整合）

### Cache 統一

- [x] 合併 exa_crawl cache + 新 cache → `~/.smart/cache/unified.db`
- [x] SQLite backend + LRU eviction（2000 cap）+ memory fallback

### Agent Skills 整合

- [x] 8 個 skill 文件加入 token 優化提示
- [x] 告知 LLM 大輸出自動壓縮機制（config/agents/smart-mcp.md）

### Tests

- [x] 22 pipeline tests（pipeline creation, stages, truncation, cache, empty/null input）
- [x] 全量回歸：**531 tests, 0 fail**

---

## Phase 3：Universal Task Router ✅

> LLM 路由減壓 — single entry point, LLM 只需描述任務
>
> 已全部完成，2026-06-08 部署。現有兩條路徑：
>   code task → CKG/LSP 工具鏈（不變）
>   general task → 結構化推薦（domain + skill + tools + workflow）
> agent_recommend 改為 hybrid-engine 薄 wrapper，一致體驗。

### 1. hybrid-engine 新增 GENERAL 類別 ✅

- [x] 新增 `GENERAL` 類別常數（已 export）
- [x] 加入所有領域 pattern（crawl/refactor/git/security/test/report/lang/search_web/edit/plan/office/wiki/analyze）
- [x] 每個領域含觸發關鍵字、推薦工具、workflow（DOMAIN_MAP）
- [x] 保持現有 code routing 完全不受影響

### 2. hybrid-router 支援 general task 路由 ✅

- [x] GENERAL 類別不回傳 CKG/LSP 工具鏈，改回結構化推薦
- [x] 推薦格式：{ domain, confidence, skill, tools, workflow }
- [x] handler 改用 executeHybrid 單一入口（取代舊的 classify→plan→execute→merge）

### 3. 簡化 agent personality ✅

- [x] 路由原則改為「hybrid_router 優先，特殊情況直接呼叫」
- [x] 4 層路由決策樹 → 簡化版 13 行
- [x] 242 行 → 139 行（~103 行縮減）
- [x] `~/.config/opencode/agents/smart-mcp.md` 同步更新

### 4. 測試驗證 ✅

- [x] `classifyQuestion` 直接驗證：GENERAL 正確分類
- [x] 實測：`hybrid_router("幫我爬一個網站")` → crawl 推薦
- [x] 實測：`hybrid_router("掃描漏洞")` → security 推薦
- [x] 實測：`hybrid_router("幫我 commit 並發 PR")` → git 推薦
- [x] 實測：`hybrid_router("who calls hybrid_router")` → code structure 路徑正常

### 5. 修復 ✅

- [x] export CATEGORIES from hybrid-engine.mjs（未 export 導致 hybrid-router 載入失敗）

### 6. agent_recommend 薄 wrapper ✅

- [x] agent-recommend.mjs 改為 import hybrid-engine.mjs，移除 smart-agent 依賴
- [x] 使用統一分類器（classifyQuestion + getGeneralRecommendation）
- [x] 保留相同 API（goal/context/format），輸出格式相容
- [x] 一般任務回傳 domain + skill + tool chain
- [x] 程式任務回傳分類資訊 + tool chain

---

## Phase 4：文件轉換

> 新增 `ingest_document` 工具，將 PDF/DOCX/PPTX/XLSX 等二進位文件轉換為 Markdown。
> 對應 plan.md Phase 4 章節。
>
> 關鍵決策：捨棄 auto-execution / session-aware / custom workflow 等不確定方向，
> 聚焦單一高價值缺口（119K⭐ markitdown 證明需求）。
>
> **2026-06-08 交付**：31 個 Phase 4a 測試、638 全域測試 0 fail

### Phase 4a：核心文件轉換工具 ✅

#### 1. `src/lib/document-ingester.mjs` — 轉換引擎 ✅

- [x] 格式偵測：副檔名 + magic bytes（自實作 magic header check，無需 file-type npm）
- [x] PDF 轉換：雙層策略 — pdftotext（CLI, 品質優先）→ pdf-parse（Node, 降級）
- [x] DOCX 轉換：`mammoth` npm（Markdown output mode），保留 heading/list/emphasis
- [x] HTML 轉換：`html-to-text` npm（保留連結、表格、標題層級）
- [x] PPTX 轉換：`pptx2md` CLI / python-pptx（可選，有則用，無則提示安裝）
- [x] XLSX 轉換：`xlsx` npm → Markdown table（多 sheet 分開，row/column 保留）
- [x] RTF 轉換：macOS `textutil -convert html` + html-to-text（有則用）
- [x] 大文件分頁：PDF 支援 offset/limit 參數續讀（其他格式不支援頁概念）
- [x] 錯誤處理：無可用 converter → 回傳清晰安裝指令；無法解析 → 回傳錯誤訊息不 crash
- [x] 統一輸出格式：`{ format, title, totalPages, content, pages[] }`

#### 2. `src/plugins/standard/ingest-document.mjs` — MCP Plugin ✅

- [x] Plugin 註冊 `smart_ingest_document` 工具
- [x] 參數：`path`（必填）, `offset`（選填, PDF 續讀起始頁）, `limit`（選填, PDF 回傳頁數上限）
- [x] 呼叫 document-ingester 進行轉換
- [x] 回傳 Markdown 內容 + metadata（格式、頁數、字數統計）
- [x] responsePolicy: 無（內容直接回傳，LLM 需要完整文件）

#### 3. hybrid-engine 整合 ✅

- [x] DOMAIN_MAP 新增 `document` 領域（位於 office 之後、wiki 之前，優先於 analyze）
- [x] 觸發關鍵字：「合約、規格、PDF、Word、文件分析、讀取 pdf、審閱文件、試算表」
- [x] 推薦工具：`smart_ingest_document`
- [x] 推薦 workflow：`Ingest → Analyze → Optionally save to wiki`
- [x] GENERAL 分類器新增 document regex patterns

#### 4. 測試 ✅

- [x] unit test：格式偵測（10 格式逐一測試 + nonexistent + unknown extension）
- [x] unit test：PDF 轉換（多頁、pagination metadata、offset/limit）
- [x] unit test：DOCX 轉換（內容驗證、heading 保留）
- [x] unit test：HTML 轉換（文字萃取、table 保留）
- [x] unit test：XLSX 轉換（多 sheet 驗證、cell 資料正確性）
- [x] unit test：大文件分段機制（PDF offset/limit）
- [x] unit test：無可用 converter 錯誤路徑（ZIP 格式不明確）
- [x] integration test：hybrid_router 分類 document 任務（5 種問法）
- [x] 全量回歸：**638 tests, 0 fail**

### Phase 4b：Document Registry（文件索引）✅

> 2026-06-08 交付。跨 session 文件索引，讀過的文件自動註冊可查。
>
> 關鍵決策：捨棄 CKG/wiki 整合路線（LLM 可自行組合工具做到），
> 改做文件索引 registry（LLM 無法跨 session 記憶）。

#### 1. `src/lib/document-registry.mjs` — SQLite 文件索引庫 ✅

- [x] SQLite 持久化（Node 26+ node:sqlite，無外部依賴）
- [x] `register(path, format, title, summary?)` — 註冊/更新文件
- [x] `list(limit)` — 列出所有文件（最新優先）
- [x] `search(query, limit)` — 依 title/path/summary 搜尋
- [x] `get(path)` — 依路徑查詢
- [x] `delete(path)` — 刪除
- [x] `count()` — 總數
- [x] Singleton 模式（getRegistry / resetRegistry）
- [x] 跨 instance 持久化驗證

#### 2. Plugin 整合 ✅

- [x] `ingest-document.mjs` — ingest 時自動 register（非致命錯誤不影響內容）
- [x] 接受 `summary` 參數存入 registry
- [x] 回傳內容標註「已註冊到文件索引」
- [x] 新增 `src/plugins/standard/list-documents.mjs` — `smart_list_documents` 工具
- [x] 支援 `query` 搜尋參數、`format` 篩選、`limit` 控制

#### 3. Agent Personality 更新 ✅

- [x] `smart_list_documents` 加入可直接呼叫工具表
- [x] hybrid_router 例子表新增「想找文件」
- [x] `~/.config/opencode/agents/smart-mcp.md` 同步

#### 4. 測試 ✅

- [x] DocumentRegistry CRUD（register/list/search/get/delete/count）
- [x] 搜尋驗證（title/path/summary 三路徑）
- [x] Singleton 正確性（相同 instance + 跨 instance 持久化）
- [x] Plugin 整合（auto-register + summary + list-plugin）
- [x] 全量回歸：**659 tests, 0 fail**

---

## Phase 5：全文文件檢索（Full-text Document Search） ✅

> ✅ 2026-06-10 全部完成。28 個 document-registry 測試 + 7 個 Phase 5 測試通過。

### 1. `document-registry.mjs` 擴充 ✅

- [x] 新增 `content TEXT` 欄位（ALTER TABLE ADD COLUMN + auto-migration）
- [x] `storeContent(path, content)` — 儲存文件內容片段
- [x] `searchContent(query, limit)` — LIKE %query% 全文搜尋（支援多詞 AND）
- [x] 內部 migration 機制（schema version tracking）

### 2. Plugin 擴充 ✅

- [x] `ingest-document.mjs` — ingest 後自動 storeContent（前 4000 chars）
- [x] `src/plugins/standard/search-docs.mjs` — `smart_search_docs` 工具（126 行）
- [x] 支援參數：`query`（必填）、`limit`（可選，預設 10）
- [x] 回傳格式：路徑 + 格式 + title + 摘要片段 + updated_at

### 3. 整合 ✅

- [x] `src/lib/hybrid-engine.mjs` DOMAIN_MAP 加入 `smart_search_docs`
- [x] `config/agents/smart-mcp.md` 加入 direct-call table + router 例子
- [x] Synced to `~/.config/opencode/agents/smart-mcp.md`

### 4. 測試 ✅

- [x] storeContent / searchContent unit tests
- [x] Migration 測試（舊 schema 無 content 欄位 → 自動加欄位）
- [x] Plugin 整合測試（ingest auto-store + search-docs）
- [x] 全量 regression（695 tests, 0 fail）

---

## Phase 6：Hallucination Detection

> 2026-06-10 誠實盤點後縮減。原始 12 項中 11 項已被現有功能覆蓋或價值不足。
> 移除項目見「已決定不做的功能」表格。

### 唯一保留項目 📋

#### Hallucination Detection（輸出真實性檢查）

- [ ] **研究**：定義 6 種幻覺類型的評分 prompt（fabrication/misattribution/unfaithful/self-contradiction/off-topic/confident-refusal）
- [ ] **實作**：新增 `src/plugins/standard/hallucination-check.mjs` — `smart_hallucination_check` 工具
- [ ] **整合**：高風險工具（debug/error_diagnose/report）自動串接檢查
- [ ] **Agent personality**：加入輸出自我驗證行為提示
- [ ] **測試**：各類型幻覺測試集驗證

---

## Phase 7：Reasoning Quality — 讓 LLM 真正變聰明

> 2026-06-10 規劃。對應 plan.md Phase 7 章節。
> 核心目標：在不改變模型參數的前提下，讓 LLM 的**推理品質**直接提升。

### ① Self-Correction Loop（高風險輸出自我修正）✅

- [x] **Agent personality**：定義「高風險任務」清單（安全修復/重大重構/合約分析）→ smart-mcp.md 🚨區塊
- [x] **行為規則**：高風險任務自動走「輸出 → self-check → 修正 → 最終」循環 → smart-mcp.md 推理品質閘
- [x] **閾值定義**：hallucination_check 分數 < 7/10 觸發修正，最多 1 輪 → smart-mcp.md
- [x] **Token 保護**：一般任務跳過 self-correction → smart-mcp.md 推理品質閘
- [ ] **測試**：高風險 vs 一般任務的正確率比較（依賴 LLM 環境，需手動驗證）

### ② Beam Search Thinking（多路徑推理）✅

- [x] **設計**：`smart_think` 新增 `mode: "beam"` 參數 → thinking.mjs quickThought
- [x] **路徑產生**：2-3 條獨立推理路徑 prompt 模板 → beams array input + 🧠工作流
- [x] **信心度評估**：LLM 自我評分機制 → confidence 1-10
- [x] **路徑收斂**：選擇最高分路徑的邏輯 → selectedBeam + Best: 標示
- [x] **回退機制**：路徑分歧過大降級回 linear CoT → 無 beams 參數時降級提示
- [x] **模板綁定**：在 debug/refactor/architecture 模板啟用建議 → 🧠工作流表
- [x] **Agent personality**：加入 beam search 使用時機提示 → smart-mcp.md 推理品質閘
- [x] **測試**：15 個 beam mode test (thinking.test.mjs) + 13 個 benchmark test (phase7-benchmark.test.mjs)

---

### ⑤ Phase 7 校正：Beam Search 適用範圍修正 ✅ (2026-06-10)

> 實際調用分析後發現 smart-mcp.md 有三處矛盾，
> 導致 beam search 被建議用在不需要多路徑推理的場景（架構分析）。

- [x] **Beam Search 說明**：移除「架構分析」— 它是線性綜合，無競爭假設
- [x] **推理品質閘**：移除「架構分析」— 不應強制走 beam
- [x] **常用推理工作流**：架構方案比較改為一般 `smart_think`，不用 `mode:"beam"`
- [x] **同步** `~/.config/opencode/agents/smart-mcp.md`

### ⑥ 核心限制：品質閘無法強制執行 ✅ (2026-06-10)

> 已實作 Server 端強制執行機制。不同於 prompt 文字規則，LLM 無法繞過。

- [x] **設計**：定義「強制執行 vs 建議」的分界線 — `src/server/index.mjs` 的 `HIGH_RISK_PREREQUISITES` map
- [x] **研究**：MCP server 端可在 `invokeTool` 中攔截工具呼叫（检查 `contextManager.toolHistory`）
- [x] **Pilot**：`smart_fast_apply` 安全修復 — 強制先跑 `smart_think({mode:"beam"})`
- [x] **Pilot**：`smart_cross_file_edit` — 強制先跑 `import_graph`
- [x] **Agent personality**：`smart-mcp.md` 品質閘區塊新增「強制執行 vs 建議」分界說明
- [x] **Error fix**：新增 `_enforcement` 錯誤類型 + 指引訊息
- [x] **plan.md**：Phase 7 新增設計文件
- [ ] **測試**：驗證高風險任務無法繞過品質閘（待補 test case）

---

## Phase 8：Universal LSP Bridge ✅

> ✅ 2026-06-10 全部完成。7 個 LSP 測試通過。

### 1. 新增 `src/plugins/core/lsp.mjs` — smart_lsp MCP tool ✅

- [x] Handler-based plugin（import LspBridge，無 CLI）
- [x] 支援 operations: symbols, references, hover, definition, diagnostics
- [x] 自動依副檔名選 language server
- [x] inputSchema: operation (enum), file (required), line, character
- [x] responsePolicy: maxLevel 0（輸出小，不需壓縮）

### 2. 擴充 `src/lib/lsp-bridge.mjs` ✅

- [x] 新增 PHP (intelephense) 到 LSP_CONFIGS
- [x] 新增 `getDiagnostics(filePath)` 方法（textDocument/diagnostic + pull model）
- [x] 確保 auto-detect 正確選擇 language server

### 3. 更新 `config/agents/smart-mcp.md` ✅

- [x] Layer 1 Direct tools 表格加入 `smart_lsp`
- [x] 常用工作流加入 LSP 使用場景
- [x] 行為閘加入「理解程式碼優先 LSP」規則
- [x] permission 加入 `smart_lsp: allow`

### 4. 更新 4 個 SKILL.md ✅

- [x] php-lsp: 「無 native LSP」→「使用 smart_lsp，CLI fallback」
- [x] pyright-lsp: 同上
- [x] typescript-lsp: 同上
- [x] swift-lsp: 同上

### 5. 同步 ✅

- [x] `~/.config/opencode/agents/smart-mcp.md` 同步

### 6. 測試 ✅

- [x] smart_lsp plugin 載入驗證
- [x] 各 operation 正確性（symbols/references/hover/definition）
- [x] PHP language server 偵測
- [x] 不支援的語言降級提示
- [x] 全量 regression（695 tests, 0 fail）

---

## Phase 10：Trust, Continuity & Learning

> 對應 plan.md Phase 10 章節。
> 補上「放心用・持續用・越用好」三條 missing link。

### 10.1 Sandbox Execution

- [ ] **設計**：決定 sandbox 技術（deno --allow-none / docker / 兩者並行）
- [ ] **實作**：新增 `src/plugins/standard/exec.mjs` — `smart_exec` tool
- [ ] **安全**：Permission level（allow / prompt / deny）
- [ ] **降級**：sandbox 不可用 → 提示使用者手動執行
- [ ] **測試**：基本 sandbox 執行 + 錯誤路徑 + 安全限制驗證
- [ ] **Agent personality**：加入 smart_exec 使用時機與安全提示

### 10.2 Impact Warning 自動觸發

- [ ] **設計**：在 quality gate 加入自動 code_impact 觸發條件（edit > 2 files）
- [ ] **實作**：擴充 `src/server/index.mjs` `checkHighRiskPrerequisites()`
- [ ] **測試**：單檔編輯不觸發、多檔編輯自動觸發

### 10.3 Error Recovery 統一策略

- [ ] **設計**：retry (3次 exponential backoff) + fallback 定義格式
- [ ] **實作**：`invokeTool` 加入 retry wrapper + fallback chain
- [ ] **Fallback 定義**：各 plugin 可選宣告 fallbackTool（LSP→grep, ingest→提示安裝）
- [ ] **測試**：timeout retry + fallback 正確性

### 10.4 Context Budget 主動管理

- [ ] **設計**：threshold 定義（80%→L1, 90%→L2, 100%→存檔）
- [ ] **實作**：`output-optimizer.mjs` 加入 budget-aware auto-escalation
- [ ] **測試**：各 threshold 壓縮層級正確升級

### 10.5 Auto Memory Injection（自動記憶注入）

- [ ] **設計**：session init 自動查 memory_store + 注入策略（3-5條, <200 chars each）
- [ ] **實作**：tool call wrapper 在 user query 時自動觸發 memory search
- [ ] **測試**：相關記憶正確注入 + 不爆 budget

### 10.6 Skill-level Learning（從 Phase 7 移入）✅

> 已在 Phase 7 實作完畢。`memory_store type:skill_patch` + `autoExtractSkillPatches` hook。
> 移入 Phase 10 是為了分類一致（「越用越好」而非「推理品質」），實作不變。

- [x]  8 項 skill_patch 全部完成（store/search/list/get + auto-extract）

### 10.7 Benchmark 套件（從 Phase 7 移入）✅

> 已在 Phase 7 實作初步結構。13 tests + shell script + 場景定義。

- [x]  結構測試：13 tests（B1-B5 + S1-S5 + R1-R3）
- [x]  定義指標：coverage / hallucination / beam_structure / self_correction
- [x]  建立場景集：10 debug + 10 architecture
- [x]  LLM benchmark script
- [ ]  **執行 benchmark**：需手動跑 `bash benchmarks/phase7-benchmark.sh`
- [ ]  **擴充真實場景**：CRUD 任務（改1檔案/跨3檔案重構/找bug修復/API串接）

---

## 已決定不做的功能（記入反省）

以下是曾經考慮但經評估後捨棄的方向，記錄以避免重複討論：

| 方向 | 捨棄原因 | 評估日期 |
|------|---------|---------|
| Auto-execution（router 代執行） | 不安全 — router 無對話 context，可能做錯事 | 2026-06-08 |
| Session-aware routing | 不必要 — LLM 已提供 context | 2026-06-08 |
| Custom workflow pipeline | 重複 — 已存在 skill 機制 | 2026-06-08 |
| Observability dashboard | 低價值 — 單開發者不需 web dashboard | 2026-06-08 |
| External integrations (Jira/Slack) | 太早 — plugin 生態未建立 | 2026-06-08 |
| Fine-tuning / 模型訓練 | 偏離 MCP 工具定位，基礎設施需求過高 | 2026-06-10 |
| RAG 系統 | 已有 wiki-ingest + search_docs | 2026-06-10 |
| Multi-modal 支援 | 與 tool-assisted LLM 核心場景不一致 | 2026-06-10 |
| Inference engine 開發 | 應選擇現有 provider | 2026-06-10 |
| **Context Compactor**（conversation compaction） | 已有 output-optimizer + opencode-wm 記憶提取。更多 compaction 是 opencode client 端責任 | 2026-06-10 |
| **Tool Strategy Feedback Loop** | LLM 已在 session 內自適應，router 加學習層複雜度 > 效益 | 2026-06-10 |
| **Sub-agent** | opencode 原生支援 Task tool | 2026-06-10 |
| **Persistent Shell** | bash tool 已支援 workdir，stale state 風險 > 效益 | 2026-06-10 |
| **Permission System** | opencode 已有 permission 機制 | 2026-06-10 |
| **Streaming UI** | Smart MCP 是 MCP server，UI 是 opencode 責任 | 2026-06-10 |
| **Hooks System** | opencode 已有 hooks 機制 | 2026-06-10 |
| **Cost Tracking** | opencode 已有 `/cost` + smart_context budget | 2026-06-10 |
| **Context Caching** | provider 設定問題，非 code 工作 | 2026-06-10 |
| **Prompt Compression** | 與現有 output-optimizer (L0/L1/L2) + opencode compaction 重疊 | 2026-06-10 |
| **Guardrails** | Server 端 HIGH_RISK_PREREQUISITES 已做到強制攔截 | 2026-06-10 |
| **Agent Observability / Tracing** | 單開發者 debug 工具，不影響 LLM 表現 | 2026-06-10 |
| **Multi-Agent Debate** | Beam Search / Forest-of-Thought 已達類似多路徑推理效果 | 2026-06-10 |
| **DSPy Prompt Optimization** | Skill-level Learning (skill_patch) 為輕量替代 | 2026-06-10 |
| **Tree of Thoughts / MCTS** | Forest-of-Thought 已做到多樹分支 + consensus | 2026-06-10 |
| **Speculative Decoding** | provider 選擇問題，非 code 工作 | 2026-06-10 |
| **LLM-as-Judge Eval** | 開發者工具，非 core value | 2026-06-10 |
| **Self-Play** | 需 RL 基礎設施，超出 MCP server 範圍 | 2026-06-10 |
| **Automated Red Teaming** | 複雜度高，單開發者事件率極低 | 2026-06-10 |
| **Diff Preview 機制** | Client UI 責任，server 不該管使用者看到什麼 | 2026-06-10 |
| **Session Continuity 框架** | 太模糊，被 Auto Memory Injection (Phase 10.5) 涵蓋 | 2026-06-10 |
| **全自動 agent loop** | OpenCode 的責任，Smart MCP 是工具層 | 2026-06-10 |
| **多模態/視覺理解** | Provider 層次，MCP server 無法控制 | 2026-06-10 |

### 模式歸納

這些「不做」的項目有一個共同模式：**opencode 層已有對應功能，Smart MCP 不需要重複實作。**

| Smart MCP 該做的事 | opencode 層的事 |
|-------------------|----------------|
| Output optimizer (L0/L1/L2) | Conversation compaction |
| Memory store + skill_patch | Session context management |
| Code intelligence (LSP/CKG/Impact) | Agent loop + sub-agent |
| Document ingestion + search | Permission system + hooks |
| Reasoning tools (think/deep_think) | UI + cost tracking + streaming |

> 這不是缺陷，是**設計分工**。Smart MCP 的深度（LSP/CKG/Impact/Reasoning templates）才是真正的護城河。
