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

## Phase 5：全文文件檢索（Full-text Document Search）

> **目標**：讓使用者可以搜尋已 ingest 文件的**內容**，而不只是 metadata。
> 對應 plan.md Phase 5 章節。

### 1. `document-registry.mjs` 擴充 🔨

- [ ] 新增 `content TEXT` 欄位（ALTER TABLE ADD COLUMN migration）
- [ ] `storeContent(path, content)` — 儲存文件內容片段
- [ ] `searchContent(query, limit)` — LIKE %query% 全文搜尋（支援多詞 AND）
- [ ] 內部 migration 機制（schema version tracking）

### 2. Plugin 擴充 🔨

- [ ] `ingest-document.mjs` — ingest 後自動 storeContent（前 4000 chars）
- [ ] `src/plugins/standard/search-docs.mjs` — `smart_search_docs` 新工具
- [ ] 支援參數：`query`（必填）、`limit`（可選，預設 10）
- [ ] 回傳格式：路徑 + 格式 + title + 摘要片段 + updated_at

### 3. 整合 🔨

- [ ] `src/lib/hybrid-engine.mjs` DOMAIN_MAP 加入 `smart_search_docs`
- [ ] `config/agents/smart-mcp.md` 加入 direct-call table + router 例子
- [ ] Synced to `~/.config/opencode/agents/smart-mcp.md`

### 4. 測試 🔨

- [ ] storeContent / searchContent unit tests
- [ ] Migration 測試（舊 schema 無 content 欄位 → 自動加欄位）
- [ ] Plugin 整合測試（ingest auto-store + search-docs）
- [ ] 全量 regression

---

## Phase 6：LLM 增強技術研究缺口

> 2026-06-10 基於 web research 盤點 12 項業界方法。
> 對應 plan.md Phase 6 章節。
>
> 優先級矩陣見 plan.md，此處僅列待辦項目。

### 🥇 Tier 1：高 CP 值（建議先做）

#### 1. Context Caching（KV Cache 重複利用）📋

- [ ] **Provider 評估**：確認目前使用的 model provider（opencode/big-pickle）是否支援 prompt caching
- [ ] **Agent personality**：system prompt 加入 cache_control breakpoints 標記
- [ ] **Skill 整合**：各 skill 啟用 caching，減少重複計算
- [ ] **成效統計**：比較啟用前後 token 用量

#### 2. Prompt Compression（輸入壓縮）📋

- [ ] **研究**：評估 LLMLingua-2 vs Selective Context vs 自實 lightweight compressor
- [ ] **實作**：新增 `src/lib/prompt-compressor.mjs` — 壓縮引擎
- [ ] **Plugin**：新增 `src/plugins/standard/compress-prompt.mjs` — `smart_compress_prompt` 工具
- [ ] **整合**：hybrid_router DOMAIN_MAP 加入 `compress` 領域
- [ ] **Agent personality**：加入壓縮行為提示（大輸出自動壓縮）
- [ ] **測試**：壓縮率 benchmark + 準確率驗證

#### 3. Hallucination Detection（輸出真實性檢查）📋

- [ ] **研究**：定義 6 種幻覺類型的評分 prompt（fabrication/misattribution/unfaithful/self-contradiction/off-topic/confident-refusal）
- [ ] **實作**：新增 `src/plugins/standard/hallucination-check.mjs` — `smart_hallucination_check` 工具
- [ ] **整合**：高風險工具（debug/error_diagnose/report）自動串接檢查
- [ ] **Agent personality**：加入輸出自我驗證行為提示
- [ ] **測試**：各類型幻覺測試集驗證

#### 4. Guardrails（輸出安全閘）📋

- [ ] **設計**：定義規則格式（deny pattern + allow pattern + rewrite rule）
- [ ] **實作**：新增 `src/plugins/standard/guardrail.mjs` — `smart_guardrail` 工具
- [ ] **預設規則**：防止 prompt injection 繞過、強制引用來源
- [ ] **Agent personality**：加入 guardrail 行為提示
- [ ] **測試**：對抗性 prompt 測試

#### 5. Agent Observability / Tracing（可觀測性）📋

- [ ] **設計**：Span 模型定義（tool call → span，session → trace）
- [ ] **實作**：新增 `src/lib/tracer.mjs` — 輕量 tracing 引擎
- [ ] **Plugin**：新增 `src/plugins/standard/trace.mjs` — `smart_trace` 工具
- [ ] **匯出格式**：支援 JSON（後續可轉 OTel）
- [ ] **整合**：index.mjs 自動產生 span 包圍每個 tool call
- [ ] **測試**：multi-span trace 正確性

### 🥈 Tier 2：中長期

#### 6. Multi-Agent Debate（多 Agent 辯論）📋

- [ ] **設計**：Debate protocol（角色分配 + 回合制 + 共識機制）
- [ ] **Plugin**：新增 `src/plugins/standard/debate.mjs` — `smart_debate` 工具
- [ ] **整合**：高風險決策自動觸發 debate（如安全修復方案）
- [ ] **測試**：比較單 agent vs debate 準確率

#### 7. DSPy Prompt Optimization（提示詞自動優化）📋

- [ ] **研究**：DSPy 整合可行性（Python dependency）
- [ ] **替代方案**：自實 lightweight optimizer（JS only）
- [ ] **Pilot**：選 1-2 個 skill 建立 eval dataset + metric
- [ ] **自動化**：skill 修改後自動跑 optimization pipeline

#### 8. Tree of Thoughts / MCTS 搜尋式推理 📋

- [ ] **研究**：升級 `smart_think` 支援分支的路徑設計
- [ ] **Pilot**：導入 Process Reward Model（可用 LLM-as-Judge 替代）
- [ ] **實作**：tree search engine + 路徑評估
- [ ] **測試**：比較線性 CoT vs tree search 正確率

#### 9. Speculative Decoding（推測解碼）📋

- [ ] **Provider check**：opencode/big-pickle 是否支援
- [ ] **文件**：記錄各 provider 的 speculative decoding 支援狀況

#### 10. LLM-as-Judge 評估管線 📋

- [ ] **設計**：eval dataset 格式 + metric 定義
- [ ] **Plugin**：新增 `src/plugins/standard/eval.mjs` — `smart_eval` 工具
- [ ] **整合**：agent personality 修改後自動回歸

### 🥉 Tier 3：長期研究

#### 11. Self-Play 自我對弈學習 📋

- [ ] **研究**：Triadic Self-Evolution 架構在本專案的適用性
- [ ] **Pilot**：最小可行 loop（Proposer → Solver → Verifier）

#### 12. Automated Red Teaming（自動紅隊測試）📋

- [ ] **研究**：擴充 `smart_security` 支援 LLM red teaming
- [ ] **設計**：對抗性 prompt 生成 + 評估迴圈

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

### ③ Skill-level Learning（越用越強）✅

- [x] **設計**：`memory_store` 擴充支援 `type: "skill_patch"` → memory-store.mjs
- [x] **格式**：skill_patch 包含 target_skill + behavior_change + trigger → memory-store.mjs CLI
- [x] **Plugin schema**：memory_store.mjs plugin 新增 type/targetSkill/behaviorChange → plugins/standard/memory_store.mjs
- [x] **smart-mcp.md 整合**：新增 Skill-level Learning 工作流章節
- [x] **自動提煉**：`cmdExtractSkillPatches` + CLI extract command + `autoExtractSkillPatches` hook (server/index.mjs)
- [x] **非同步**：spawn + unref pattern (同 autoStoreToMemory) + rl.on close 觸發
- [x] **整合**：hybrid_router → `searchSkillPatches()` 注入 GENERAL/code 路徑
- [x] **測試**：S1-S5 skill_patch store/search/list/get 完整測試

### ④ 基準測試（Phase 7 Baseline）✅

- [x] **結構測試**：13 個 test in phase7-benchmark.test.mjs（B1-B5 + S1-S5 + R1-R3）
- [x] **定義指標**：coverage, hallucination, beam_structure, self_correction → benchmarks/phase7-benchmark.sh
- [x] **建立測試集**：10 debug + 10 architecture scenarios → benchmarks/phase7-benchmark.sh
- [x] **LLM benchmark script**：benchmarks/phase7-benchmark.sh（需 LLM_API_KEY 執行）
- [ ] **執行 benchmark**：需設定 LLM_API_KEY + 手動執行 bash benchmarks/phase7-benchmark.sh

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

## Phase 8：Universal LSP Bridge

> 2026-06-10 規劃。將現有 LSP bridge 暴露為 MCP tool。
> 對應 plan.md Phase 8 章節。

### 1. 新增 `src/plugins/core/lsp.mjs` — smart_lsp MCP tool 🔨

- [ ] Handler-based plugin（import LspBridge，無 CLI）
- [ ] 支援 operations: symbols, references, hover, definition, diagnostics
- [ ] 自動依副檔名選 language server
- [ ] inputSchema: operation (enum), file (required), line, character
- [ ] responsePolicy: maxLevel 0（輸出小，不需壓縮）

### 2. 擴充 `src/lib/lsp-bridge.mjs` 🔨

- [ ] 新增 PHP (intelephense) 到 LSP_CONFIGS
- [ ] 新增 `getDiagnostics(filePath)` 方法（textDocument/diagnostic + pull model）
- [ ] 確保 auto-detect 正確選擇 language server

### 3. 更新 `config/agents/smart-mcp.md` 🔨

- [ ] Layer 1 Direct tools 表格加入 `smart_lsp`
- [ ] 常用工作流加入 LSP 使用場景
- [ ] 行為閘加入「理解程式碼優先 LSP」規則
- [ ] permission 加入 `smart_lsp: allow`

### 4. 更新 4 個 SKILL.md 🔨

- [ ] php-lsp: 「無 native LSP」→「使用 smart_lsp，CLI fallback」
- [ ] pyright-lsp: 同上
- [ ] typescript-lsp: 同上
- [ ] swift-lsp: 同上

### 5. 同步 🔨

- [ ] `~/.config/opencode/agents/smart-mcp.md` 同步

### 6. 測試 🔨

- [ ] smart_lsp plugin 載入驗證
- [ ] 各 operation 正確性（symbols/references/hover/definition）
- [ ] PHP language server 偵測
- [ ] 不支援的語言降級提示
- [ ] 全量 regression

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
