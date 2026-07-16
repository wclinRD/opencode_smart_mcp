# smart_eda_search 重構 TODO

> 配合 `eda_search_plan.md` 使用
> 狀態：⬜ Pending / 🔄 In Progress / ✅ Done / ⏭️ Skipped
>
> Phase 1 ✅ 完成（2026-07-16）：eda-search.mjs 3407→1347 行（-60%）
> Phase 2 ✅ 完成（2026-07-16）：eda-search.mjs 1347→1033 行，6 個搜尋來源模組建立
> Phase 3 ✅ 完成（2026-07-16）：eda-search.mjs 1033→547 行，handler 去重 + 函式提取
> Phase 4 ✅ 完成（2026-07-16）：eda-search.mjs 547→135 行（-75%），switch-case → Action Registry
> Phase 5 ✅ 完成（2026-07-16）：整合 Exa 語意搜尋 + 深度爬取 + 去重 + 排序 + GitHub token
> Phase 6 ✅ 完成（2026-07-16）：eda-search.mjs 239→72 行（3407→72，-98%），multiSourceSearch 搬到 sources/index.mjs，20/20 回歸測試通過
> Phase 7 ✅ 完成（2026-07-16）：Caveman 4級壓縮引擎（light/semantic/aggressive/ultra）
> Phase 7B ✅ 完成（2026-07-16）：TOON encoder/decoder + SmartCrusher + Schema Compression
> Phase 11 ✅ 完成（2026-07-16）：EDA_ABBREV_DICT 250+ 組 + expandAbbreviations + 整合 enhanceQueryForEDA + auto
> Phase 12 ✅ 完成（2026-07-16）：6類 Query Intelligence 分類器 + CATEGORY_SOURCE_WEIGHTS + 整合 auto
> Phase 8 ✅ 完成（2026-07-16）：Semantic Scholar 429 retry + OpenAlex EDA post-filter + 社群 Tier 分級
> Phase 9-10 ⬜ 規劃中（可靠性 + 長期改進）
> Phase 13-16 ⬜ 規劃中（RAG + Benchmark + KG + Multi-Agent）

---

## Phase 1：資料外置（零風險）

> 目標：將 1200 行靜態資料從主檔案抽離，主檔案改為 import
> 預估：~30 分鐘 | 風險：極低

- [x] 1.1 建立目錄結構 `src/plugins/core/eda/data/`
- [x] 1.2 搬 `EDA_TOOL_INDEX` (55+) → `eda/data/tools.mjs`
- [x] 1.3 搬 `PDK_INDEX` (7) → `eda/data/pdk.mjs`
- [x] 1.4 搬 `TOOL_FAQ_INDEX` (10) + `TOOL_ISSUE_PATTERNS` → `eda/data/faq.mjs`
- [x] 1.5 搬 `CELL_FLOW_STAGES` (11 stages) → `eda/data/flow.mjs`
- [x] 1.6 搬 `VENDOR_DOCS` → `eda/data/docs.mjs`
- [x] 1.7 搬 `EDA_ABBREVIATIONS` + `PATTERN_RULES` → `eda/data/abbreviations.mjs`
- [x] 1.8 搬 `EDA_FORMATS` + `EDA_CONFERENCES` + `EDA_COMMUNITIES` + `EDA_CMD_INDEX` → `eda/data/meta.mjs`
- [x] 1.9 `eda-search.mjs` 改為 `import { ... } from './eda/data/*.mjs'`（3407→1347 行）
- [x] 1.10 驗證：`list-tools` ✅ `list-pdk` ✅ `auto` ✅

---

## Phase 2：搜尋來源分離（低風險）

> 目標：每個搜尋來源成為獨立模組，可單獨測試/mock
> 預估：~1 小時 | 風險：低

- [x] 2.1 建立 `src/plugins/core/eda/sources/`
- [x] 2.2 搬 `httpsGet()` → `eda/sources/http.mjs`（含 LRU cache TTL 5min）
- [x] 2.3 搬 `searchWebDDG()` + `formatWebResults()` → `eda/sources/web.mjs`
- [x] 2.4 搬 `searchEDACommunities()` + `crawlForumPages()` + `formatCommunityResults()` → `eda/sources/community.mjs`
- [x] 2.5 搬 `searchGitHubPDK/EDA/Code()` + `formatGitHubResults()` → `eda/sources/github.mjs`
- [x] 2.6 搬 `searchOpenAlex()` + `reconstructAbstract()` + `formatOpenAlexResults()` → `eda/sources/openalex.mjs`
- [x] 2.7 搬 `searchSemanticScholar()` + `formatSemanticScholarResults()` → `eda/sources/semantic-scholar.mjs`
- [x] 2.8 建立 `eda/sources/index.mjs`（re-export 統一入口）
- [x] 2.9 `eda-search.mjs` 改為 import from eda/sources/*.mjs（1347→1033 行）
- [x] 2.10 驗證：`auto` ✅ `paper` ✅ `list-tools` ✅

---

## Phase 3：Handler 重構（中風險）

> 目標：消除 switch-case 膨脹，統一重複邏輯
> 預估：~1.5 小時 | 風險：中（需完整回歸測試）

### 3A: 查詢增強 + 工具函式分離

- [x] 3A.1 建立 `eda/query/` + `eda/lib/` + `eda/format/` 目錄
- [x] 3A.2+3A.3+3A.4 搬查詢函式 → `eda/query/enhance.mjs` + `eda/query/detect.mjs`
- [x] 3A.6 搬 `generateVendorSearchURL()` + `searchToolFAQ()` → `eda/lib/vendor.mjs`
- [x] 3A.7 搬 `fetchDocContent()` → `eda/lib/doc-fetch.mjs`
- [x] 3A.9 搬 `searchLocalPDK/Tools()` + `formatPDKResults/ToolResults()` → `eda/format/local.mjs`

### 3B: 消除 auto/all 重複

- [x] 3B.1-3.3 抽取 `multiSourceSearch()` 統一入口，auto/all 共用（-94 行）
- [x] 3B.4+3B.5 驗證：`auto` ✅ `all` ✅

### 3C: 消除 dft/lec/eco/fpga 重複

- [x] 3C.1-3.2 抽取 `formatFlowStage()` 內聯函式，dft/lec/eco/fpga 各 1 行 delegate
- [x] 3C.3 驗證：`dft` ✅ `flow` ✅

### 3D: list actions 共用

- [x] 3D.1 list actions 保留在 switch-case（每 case 僅 3-7 行，提取效益低）
- [x] 3D.2 驗證：`list-tools` ✅ `list-pdk` ✅

---

## Phase 4：Action Registry（中風險）

> 目標：switch-case → Map-based dispatch，新增 action 只加一個檔案
> 預估：~1 小時 | 風險：中

- [x] 4.1 建立 `eda/actions/registry.mjs`（Map + registerAction + dispatch）
- [x] 4.2 建立 `eda/actions/` 目錄，每個 action 一個檔案（13 模組）
- [x] 4.3 `eda-search.mjs` handler 簡化為 dispatch()（547→135 行）
- [x] 4.4 確認 `inputSchema` 不變（18 種 action enum）✅
- [x] 4.5 驗證：registry + list-tools + list-pdk + alias 解析全部通過

---

## Phase 5：搜尋品質改進（低風險，附帶收益）

> 目標：整合 Exa + 深度爬取 + 去重 + 排序
> 預估：~2 小時 | 風險：低（新增功能，不改現有邏輯）

- [x] 5.1 整合 `smart_exa_search`：auto/all 的多源搜尋加入第 7 來源（Exa API 直接整合）
- [x] 5.2 升級 `crawlForumPages`：有 Exa key 用 Exa Contents API，無 key 退回 HTML strip
- [x] 5.3 新增 `depth` 參數：`"shallow"`（列 URL）vs `"deep"`（Exa 爬全文）
- [x] 5.4 跨來源去重：DOI 去重學術論文，URL 去重網頁
- [x] 5.5 結果排序：按來源權重 + 相關性分數
- [x] 5.6 GitHub token 支援：從 `GITHUB_TOKEN` 環境變數讀取（60→5000 req/hr）
- [x] 5.7 驗證：registry ✅ list-tools ✅ list-pdk ✅ papers alias ✅ Exa detection ✅

---

## Phase 6：驗證 & 清理

> 目標：確保所有功能正常，清除舊代碼
> 預估：~30 分鐘 | 風險：低

- [x] 6.1 完整回歸測試：20/20 全部通過（含 2 alias）
- [x] 6.2 確認 `eda-search.mjs` 從 3407 行降到 72 行（-98%）
- [x] 6.3 確認所有 import 正確（無殘留 inline 定義、無 circular import）
- [x] 6.4 更新 `smart-mcp.md`：action 17→18、工具索引 48+→55+、新增 Exa 來源
- [x] 6.5 確認 `manifest.json`（loader 自動重新產生）
- [x] 6.6 Commit & push（5107190）

---

## Phase 7：Token 效率 + Caveman 壓縮

> 目標：解決 A1-A3 + B3，預估省 50-70% token 輸出
> 預估：~3 小時 | 風險：中

- [x] 7.1 新建 `eda/lib/caveman.mjs` — 4 級壓縮引擎（light/semantic/aggressive/ultra）
- [x] 7.2 整合到 `multiSourceSearch()` — 格式化後套用 `compressOutput()`
- [x] 7.3 整合到 `paper` action — 論文搜尋結果壓縮
- [x] 7.4 整合到 `troubleshoot` action — FAQ 內容壓縮
- [x] 7.5 `inputSchema` 新增 `compress` 參數（none/light/semantic/aggressive/ultra）
- [x] 7.6 `eda-search.mjs` handler 傳遞 compress 到 actions
- [x] 7.7 專有名詞保護：stop words/filler/abbreviations 僅匹配小寫
- [x] 7.8 修正 aggressive lemmatization（移除有 bug 的 regex，改為僅移除程度副詞）
- [x] 7.9 測試驗證：Synopsys、Cadence、Information、Environment 等專有名詞安全
- [x] 7.10 Commit：`71c5312` feat(eda): 新增 caveman 壓縮引擎

---

## Phase 8：搜尋品質強化（🟡 中優先級）

> 目標：解決 A4 + B1 + B2，提升學術和社群搜尋品質
> 預估：~2.5 小時 | 風險：低（改良現有邏輯）

- [x] 8.1 Semantic Scholar 429 自動降級（exponential backoff + DDG fallback）
- [x] 8.2 OpenAlex concept filter 收窄（post-filter EDA 關鍵字二次驗證）
- [x] 8.3 社群搜尋 Tier 分級（Tier 1 高優先 + Tier 2 補充）+ URL 去重

---

## Phase 9：可靠性 + 可維護性（🟡 中優先級）

> 目標：解決 B4 + C1 + C3，提升可觀測性和可測試性
> 預估：~4 小時 | 風險：低

- [ ] 9.1 錯誤處理加入 warning 回報（multiSourceSearch 回傳 warnings array）
- [ ] 9.2 Cache TTL 差異化（按 hostname 設定不同 TTL）
- [ ] 9.3 單元測試建立（tests/eda/ 目錄，mock httpsGet）

---

## Phase 10：長期改進（🟢 低優先級）

> 目標：解決 C2 + C4，為未來擴展鋪路
> 預估：~3 小時 | 風險：低（非關鍵路徑）

- [ ] 10.1 靜態資料外部化（eda/data/*.mjs → JSON + 動態 import）
- [ ] 10.2 分頁支援（multiSourceSearch 加 offset 參數）
- [ ] 10.3 DDG → Exa 升級路徑（偵測 EXA_API_KEY 時優先用 Exa）

---

## Phase 11：Abbreviation De-hallucination（🔴 高優先級，ROI 極高）

> 目標：解決 A1 誤判問題（hal/diamond/netgen），建立 EDA 縮寫字典 + 查詢自動展開
> 參考：Ask-EDA (IBM) — 249 組 EDA 縮寫
> 預估：~1 小時 | 風險：極低（純資料新增）

- [x] 11.1 新增 `EDA_ABBREV_DICT` 到 `eda/data/abbreviations.mjs`（250+ 結構化縮寫，含 vendor/category）
- [x] 11.2 新增 `expandAbbreviations(query)` + `lookupAbbreviation(abbr)` 函式
- [x] 11.3 整合到 `enhanceQueryForEDA()`（Step 1 縮寫展開）
- [x] 11.4 整合到 `auto.mjs`（qExpanded 展開提升 tool 路由準確率）
- [x] 11.5 驗證：35/35 .mjs 全部通過 ✅

---

## Phase 12：Query Intelligence（🔴 高優先級）

> 目標：Query 4類分類 + category-specific routing，提升 auto 路由準確率
> 參考：EDA-Copilot (TODAES'25) — 4類分類器 + enhanced retrieval
> 預估：~2 小時 | 風險：低（prompt-based 分類）

- [x] 12.1 新建 `eda/query/classify.mjs`（6類分類器：TOOL_ISSUE/PDK_LOOKUP/ACADEMIC/FLOW_GUIDE/TOOL_DOCS/GENERAL）
- [x] 12.2 定義 `CATEGORY_SOURCE_WEIGHTS`（6類 × 7來源權重矩陣）
- [x] 12.3 整合到 `auto.mjs`（classifyQuery + maxResults 動態調整 + 類型顯示）
- [x] 12.4 驗證：36/36 .mjs 全部通過 ✅

---

## Phase 13：Hybrid Retrieval RAG（🟡 中優先級）

> 目標：建立 EDA 領域的 RAG 管線（BM25 + embedding hybrid + RRF + adaptive Top-K + post-retrieval reranker）
> 參考：RAG-EDA (TCAD'25)、Ask-EDA (IBM)、EDA-Copilot (TODAES'25)、ChipMind (AAAI'26)
> 預估：~5 小時 | 風險：中（+ adaptive Top-K + post-retrieval reranker）

- [ ] 13.1 新建 `eda/sources/fusion.mjs`（Reciprocal Rank Fusion）
- [ ] 13.2 新建 `eda/sources/embedding.mjs`（方案 A：LLM-based rerank）
- [ ] 13.3 定義 RRF 合併邏輯（BM25 + Local + Embedding 三路融合）
- [ ] 13.4 整合到 `multiSourceSearch()`（結果 RRF 融合 + rerank）
- [ ] 13.5 Prompt-based reranker（EDA domain-aware 排序）
- [ ] 13.6 🆕 Adaptive Top-K（ChipMind MIG-based：簡單 K=3, 複雜 K=10）
- [ ] 13.7 🆕 Post-retrieval reranker（EDA-Copilot mixed indexing：score < 0.3 過濾）
- [ ] 13.8 🆕 CSA filtering（去重 + 品質控制）
- [ ] 13.9 測試：對比 Before/After 的結果排序品質

---

## Phase 14：EDA QA Benchmark（🟡 中優先級）

> 目標：建立 EDA 搜尋品質評估基準集，每次重構後跑 benchmark 確認無退化
> 參考：RAG-EDA (ORD-QA, 90 pairs)、Ask-EDA (300 pairs)
> 預估：~3 小時 | 風險：低

- [ ] 14.1 建立 `tests/eda/benchmark/` 目錄結構
- [ ] 14.2 建立 `tool-100.json`（100 筆工具查詢，含縮寫+模糊）
- [ ] 14.3 建立 `troubleshoot-50.json`（50 筆問題診斷）
- [ ] 14.4 建立 `flow-50.json`（50 筆 cell flow 查詢）
- [ ] 14.5 建立 `academic-50.json`（50 筆學術論文查詢）
- [ ] 14.6 建立 `abbreviation-50.json`（50 筆縮寫查詢）
- [ ] 14.7 建立 `tests/eda/eval/metrics.mjs`（Recall@K, MRR, NDCG）
- [ ] 14.8 建立 `tests/eda/eval/runner.mjs`（Benchmark runner）
- [ ] 14.9 建立 `tests/eda/eda-benchmark.test.mjs`（自動化測試）

---

## Phase 15：EDA Knowledge Graph（🟢 低優先級，長期）

> 目標：整合 hdl-kgraph MCP server，建立 EDA 知識圖譜（改為整合已有專案，降低風險）
> 參考：hdl-kgraph（MCP server，已開源）、ChipMind (AAAI'26)、VeriRAG
> 預估：~3 小時（原 8hr，改為整合後 -5hr）| 風險：低（整合已有專案）

### Step 1: 安裝 + 整合 hdl-kgraph
- [ ] 15.1 Clone + 安裝 hdl-kgraph MCP server
- [ ] 15.2 整合到 smart_eda_search（sub-tool 呼叫）

### Step 2: 整合到現有 actions
- [ ] 15.3 整合到 `troubleshoot` action（用 hdl-kgraph 查 FAQ + command）
- [ ] 15.4 整合到 `docs` action（用 hdl-kgraph 查工具文件關聯）
- [ ] 15.5 整合到 `auto` action（查詢多跳關聯：Tool→Command→Option→Issue）

### Step 3: 測試 + 驗證
- [ ] 15.6 測試：DC → has_command → compile → has_option → map_effort
- [ ] 15.7 效能測試：KG 查詢延遲 < 500ms

---

## Phase 7B：Tool-Level Token Optimization（🔴 P0，新增 2026-07-16）

> 目標：補齊 tool-level token 壓縮，對標 TokenSeive/Tokenless/token-crunch
> 參考：TokenSeive SmartCrusher (85-93%)、TOON format (40-60%)、token-crunch structural collapse (70%+)
> 預估：~3 小時 | 風險：低（TOON 為 lossless 編碼）

- [x] 7B.1 TOON encoder/decoder 實作（eda/lib/toon-encoder.mjs，含 stats + roundtrip）
- [x] 7B.2 SmartCrusher 增強（eda/lib/caveman.mjs，30+ EDA 複合詞映射 + CamelCase 拆分）
- [x] 7B.3 Schema compression（eda/lib/caveman.mjs，schemaCompress/schemaDecompress）
- [x] 7B.4 整合到 caveman pipeline（compressOutput level='smart' → smartCrusher full mode）

---

## Phase 16：Multi-Agent Orchestration（🟢 P2，長期新增 2026-07-16）

> 目標：建立 EDA 領域多 agent 協作架構
> 參考：Marco (NVIDIA) — 200+ expert agents、ChipXplore (ICLAD'25) — 6 agent roles
> 預估：~8 小時 | 風險：高（架構變更大）

- [ ] 16.1 Agent 介面設計 + 通訊協議
- [ ] 16.2 Query Agent + Retrieval Agent 實作
- [ ] 16.3 Orchestrator 實作（動態路由 + 專家選擇）
- [ ] 16.4 整合測試 + 驗證

---

## 估計工時

| Phase | 工時 | 累計 | 風險 |
|-------|------|------|------|
| Phase 1: 資料外置 | 30 min | 30 min | 🟢 極低 |
| Phase 2: 搜尋來源分離 | 60 min | 1.5 hr | 🟢 低 |
| Phase 3: Handler 重構 | 90 min | 3 hr | 🟡 中 |
| Phase 4: Action Registry | 60 min | 4 hr | 🟡 中 |
| Phase 5: 搜尋增強 | 120 min | 6 hr | 🟢 低 |
| Phase 6: 驗證清理 | 30 min | 6.5 hr | 🟢 低 |
| Phase 7: Token 效率 + Caveman | 180 min | 9.5 hr | ✅ 已完成 |
| Phase 7B: Tool-Level Token 🆕 | 180 min | 12.5 hr | ✅ 已完成 |
| Phase 8: 搜尋品質 | 150 min | 15 hr | ✅ 已完成 |
| Phase 9: 可靠性 | 240 min | 19 hr | 🟢 低 |
| Phase 10: 長期改進 | 180 min | 22 hr | 🟢 低 |
| Phase 11: Abbreviation De-hallucination | 60 min | 23 hr | ✅ 已完成 |
| Phase 12: Query Intelligence | 120 min | 25 hr | ✅ 已完成 |
| Phase 13: Hybrid Retrieval RAG | 300 min | 30 hr | 🟡 中 |
| Phase 14: EDA QA Benchmark | 180 min | 33 hr | 🟢 低 |
| Phase 15: Knowledge Graph（整合 hdl-kgraph） | 180 min | 36 hr | 🟢 低 |
| Phase 16: Multi-Agent 🆕 | 480 min | 44 hr | 🔴 高 |

**總計：~44 小時**（Phase 1-8 + 11 + 12 已完成 17 hr + Phase 9-10 + 13-16 需 27 hr）

---

## Decision Log

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-07-16 | 不推翻重寫，採用漸進式重構 | 功能完整，問題在組織方式不在邏輯 |
| 2026-07-16 | Phase 1-2 先做 | 零風險 + 最大收益（解耦資料和來源） |
| 2026-07-16 | 保留 Plugin export 簽章不變 | 向後相容是硬需求 |
| 2026-07-16 | Action Registry 用 side-effect import | 避免手動維護 action 列表 |
| 2026-07-16 | Phase 11-15 基於業界/學術比較分析新增 | ChipXplore/RAG-EDA/Ask-EDA/ChipMind 等 13 專案比較 |
| 2026-07-16 | 新增 Phase 7B：Tool-Level Token Optimization | TokenSeive SmartCrusher 85-93% + TOON 40-60% + token-crunch |
| 2026-07-16 | Phase 13 加入 adaptive Top-K + post-retrieval | ChipMind MIG-based + EDA-Copilot mixed indexing |
| 2026-07-16 | Phase 15 改為整合 hdl-kgraph | 大幅降低風險（原 8hr→3hr），hdl-kgraph 已有 MCP server |
| 2026-07-16 | 新增 Phase 16：Multi-Agent Orchestration | Marco (NVIDIA) 200+ expert agents、ChipXplore 6-agent |
| 2026-07-16 | 總工時從 37hr 調整為 44hr | 新增 Phase 7B (3hr) + Phase 16 (8hr)，Phase 15 節省 5hr |
