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

## 已決定不做的功能（記入反省）

以下是曾經考慮但經評估後捨棄的方向，記錄以避免重複討論：

| 方向 | 捨棄原因 | 評估日期 |
|------|---------|---------|
| Auto-execution（router 代執行） | 不安全 — router 無對話 context，可能做錯事 | 2026-06-08 |
| Session-aware routing | 不必要 — LLM 已提供 context | 2026-06-08 |
| Custom workflow pipeline | 重複 — 已存在 skill 機制 | 2026-06-08 |
| Observability dashboard | 低價值 — 單開發者不需 web dashboard | 2026-06-08 |
| External integrations (Jira/Slack) | 太早 — plugin 生態未建立 | 2026-06-08 |
