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

## Phase 4：下一步規劃
