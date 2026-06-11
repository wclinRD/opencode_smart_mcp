# Smart MCP — 效能與 Token 優化強化計畫

> 本文件定義 token 優化策略的架構設計與實作路線。
> 與 todo.md 互為補充：plan.md 定義「為什麼做、架構長怎樣」，todo.md 定義「具體步驟」。

## ONFI SPEC RESEARCH — 已完成 (2026-06-06)

**目標**: 建立一份 Verilog-實作-ready 的 ONFI NAND Flash 介面規格參考文件 (ONFI_SPEC_SUMMARY.md)。

**成果**: 經過 3 輪研究迭代，最終評分 **10/10**（15 維度全滿分）。

**Round 1**: 1309 行基礎架構（版本演進、SCA 協議、命令集、Feature Register、控制器架構、Behavioral Flow FSM、PHY 設計、時序模式表、SI 技術）

**Round 2**: 擴充至 1685 行（完整參數頁面 byte map、狀態暫存器、多平面命令序列、時序圖文本說明、電氣規格表、BGA pin map、DFE/FFE/per-bit deskew 實作細節、商用 IP 參考）

**Round 3**: 擴充至 2073 行（SCA CA 封包 2-bit 序列化格式、DLL/PLL 頻率對照表、DCC/Read DQ/Write DQ 訓練 FSM 完整流程、ZQ Calibration 時序參數 tZQCL=1µs/tZQCS=0.4µs、Warmup Cycle Verilog 實作、章節編號全面校正）

**學習**: 嚴格自我評分→迭代補缺口是有效的策略。每輪發現約 5-7 個缺口，透過 PDF 提取 + web 搜尋 + 專利文件分析閉合。

---

## 核心問題

Smart MCP 已實作 4 項 token 優化手段，但零散未成體系：

| 已實作 | 省 token 估算 | 問題 |
|--------|-------------|------|
| Toonify（JSON/CSV/YAML 被動壓縮） | 30-65% | 只看 JSON-like 格式，fire-and-forget 非同步不影響當前回應 |
| Selective tool listing（8 visible / 45 routed） | ~70% tools list | 已完善 |
| Onion architecture（106 行 core + 8 skills） | ~97% system prompt | 已完善 |
| 4-tier model router（T1 $0 ~ T4 LLM） | ~60-86% API cost | 已完善 |

**核心缺口**：工具輸出內容本身沒有系統性的壓縮策略。

---

## 設計哲學：分層擔責 + 透明告知 + 按需取回

```
LLM 端不可控（放掉）               MCP Server 端可控（全力做）
─────────────────────────          ─────────────────────────
Prompt caching (Anthropic API)     工具回傳內容格式 ✅
Context compaction pipeline       輸出壓縮/截斷/快取 ✅
ToolSearch deferred loading       Plugin responsePolicy ✅
Streaming response (MCP protocol)  透明標記 + 按需取回 ✅
```

### 核心原則

1. **每個工具自己決定「什麼可以壓縮」** — Plugin 宣告 `responsePolicy`
2. **LLM 永遠知道自己看到的是壓縮版** — Response 附加 `_optimized` metadata
3. **Lossless 優先** — L1 零風險，全部工具都做
4. **Lossy 限縮範圍** — L2 只開放有明確「重要/不重要」分割的工具
5. **不確定的就不壓** — Format 不明或無法判斷重要資訊 → 降級 L0

---

## 壓縮層級定義

| 層級 | 名稱 | 作法 | 資訊損失 | 適用 |
|------|------|------|---------|------|
| L0 | Raw | 不處理，直接 passthrough | 無 | 小輸出 <10KB |
| L1 | Lossless Compress | 縮短 key、壓縮空白、格式正規化 | **無**（所有 value 保留） | 結構化資料 10-50KB |
| L2 | Smart Summary | 保留 critical section，壓縮/略過次要 section | 有選擇性損失 | 大輸出 50KB+ |
| L3 | Truncated | **不使用** — 改用互動式 format:full | — | 取消，改按需取回 |

---

## Response Policy 機制

每個 Plugin 宣告自己的壓縮邊界：

```js
export default {
  name: 'smart_grep',
  responsePolicy: {
    maxLevel: 1,           // 最高壓縮層級（預設 1）
    criticalFields: [],     // 必須保留的欄位
    compressibleFields: [], // 可 lossless 壓縮的欄位
    droppableFields: [],    // 可丟棄的欄位（僅 L2 適用）
  }
}
```

預設值 `maxLevel: 1` — opt-in 才能開 L2，不是 opt-out。

### 各工具壓縮策略

| 工具 | 典型大小 | maxLevel | 理由 |
|------|---------|----------|------|
| smart_grep | 3-10KB | 0 | 結果很小且關鍵 |
| smart_learn | 2-5KB | 0 | 結果很小 |
| smart_test | 5-20KB | 0 | 結果很小 |
| smart_security | 30-200KB | 2 | 高/中/低風險可分割 |
| git_context/diff | 5-30KB | 1 | LLM 需完整 diff 做判斷 |
| import_graph | 10-50KB | 1 | JSON→Toonify lossless |
| code_query/AST | 5-30KB | 1 | JSON→Toonify lossless |
| naming/coverage | 3-10KB | 0 | 結果很小 |
| exa_crawl | 50-500KB | 2 | Readability 已 lossy |
| research | 50-500KB | 2 | 多文章 highlights 就夠 |
| pw_browser | 10-30KB | 1 | 結構化文字 |
| debug/error_diagnose | 3-15KB | 0 | 結果很小 |

---

## 調適後的壓縮 Response 格式

壓縮過的回應附加 `_optimized` metadata：

```json
{
  "_optimized": {
    "level": 2,
    "originalSize": 85000,
    "compressedSize": 12000,
    "cacheKey": "sha256-xxx",
    "message": "This is a summary. Use format:'full' to get the complete data."
  },
  "data": { ... 壓縮後的內容 ... }
}
```

LLM 可根據 `_optimized.level` 決定是否需要取回完整版。

---

## Agent 行為規範

Agent personality 中明確定義：

```
當工具回傳 _optimized.level >= 2 時：
  1. 先判斷摘要資訊是否足夠回答使用者問題
  2. 如果不夠 → 用相同參數 + format:'full' 取回完整版
  3. 如果使用者要求「找出全部」「分析所有」「比對差異」
     → 無論如何必須取回完整版
```

---

## Phase 1：核心架構

```
目標：建立基礎壓縮 pipeline，L1 全面啟用，L2 限 3 工具
時程：2-3 天
```

| 元件 | 說明 |
|------|------|
| `src/lib/output-optimizer.mjs` | Format auto-detect + 4 層級壓縮 + _optimized metadata 注入 |
| `src/lib/cache-manager.mjs` | 泛化 SQLite 快取（從 exa_crawl 抽出） |
| `src/server/index.mjs` | respond() 整合同步壓縮 + _optimized 標記 |
| `src/server/loader.mjs` | Plugin 新增 responsePolicy 支援 |
| Plugin responsePolicy | 各核心工具宣告壓縮邊界 |
| Agent personality | 加入 token 優化行為提示 |

---

## Phase 2：Smart Output Pipeline

```
目標：完整 Pipeline Layer（format → compress → truncate → cache）
時程：5-7 天
```

| 元件 | 說明 |
|------|------|
| `src/lib/output-pipeline.mjs` | Pipeline 框架：addStage → run |
| Pipeline 整合 | plugin 可選宣告 responsePipeline 覆寫預設 |
| Cache 統一管理 | 合併 exa_crawl cache + 新 cache |
| Agent skills 整合 | 各 skill 加入 token 優化提示 |

---

## 預期成效

| 優化項目 | 目前 | Phase 1 後 | Phase 2 後 |
|---------|------|-----------|-----------|
| System prompt | ~3KB（已做） | ~3KB | ~3KB |
| Tools listing | ~70% 省（已做） | ~70% 省 | ~70% 省 |
| **Tool 輸出壓縮** | **~30-65%（被動, fire-and-forget）** | **~40-60%（主動同步）** | **~50-70%（結構感知）** |
| 重複呼叫浪費 | ❌ 無快取 | ✅ SQLite cache | ✅ LRU + SQLite |
| 大輸出處理 | ❌ 原始回傳 | ✅ 層級處理 | ✅ 語意截斷 |
| **整體 token 節省** | **~40-50%** | **~60-70%** | **~75-85%** |

---

---

## Phase 3：Universal Task Router（LLM 路由減壓）

### 核心問題

目前洋蔥架構將路由決策完全交給 LLM：

```
LLM 問「我要做 X」→ LLM 自己查 4 層清單 → LLM 決定用哪個工具 → LLM 用正確 syntax 呼叫
                                                                   ↑ 瓶頸
```

LLM 必須記住 4 層 × 40+ 工具 × 各自的 calling convention。這違反「用最少 token 做最多事」。

### 解決方案：Universal Task Router

```
LLM 問「我要做 X」→ hybrid_router 自動分類 → code task？執行工具 → general task？推薦工具/skill
                                                   ↑ 單一入口，LLM 只需描述任務
```

### 設計

| 層面 | 作法 |
|------|------|
| **分類** | 在 hybrid-engine 新增 `GENERAL` 類別，涵蓋所有 Smart MCP 領域 |
| **路由** | code task → 現有 CKG/LSP 工具鏈；general task → 回傳工具/skill 推薦 + workflow |
| **Personality** | 簡化路由決策樹，LLM 只需記得 hybrid_router 一個入口 |
| **向後相容** | 不改變現有 code routing 行為，GENERAL 類別走新路徑 |

### 分類領域

| 領域 | 觸發關鍵字 | 推薦動作 |
|------|-----------|---------|
| crawl | 爬蟲、網站、API、抓取、crawl、scrape | `skill("smart-mcp-crawl")` + exa_crawl/pw_browser |
| refactor | 重構、rename、restructure、refactor | `skill("smart-mcp-refactor")` + import_graph/code_impact |
| debug | 錯誤、bug、除錯、例外、crash | `skill("smart-mcp-debug")` + error_diagnose/debug |
| git | commit、PR、review、branch、合併 | `skill("smart-mcp-git")` + git_commit/git_pr/git_review |
| security | 安全、漏洞、掃描、credentials、注入 | `skill("smart-mcp-security")` + smart_security |
| test | 測試、coverage、test case、單元測試 | `skill("smart-mcp-test")` + smart_test/coverage |
| report | 報告、圖表、diagram、簡報、文件 | `skill("smart-mcp-report")` + diagram/report |
| lang | Python/TS/Rust 檢查、lint、type | `skill("smart-mcp-lang")` + py_helper/ts_helper/rs_helper |
| search | 搜尋、研究、查資料、research | exa_search / websearch / research |
| edit | 編輯、修改、patch、replace | fast_apply / edit / cross_file_edit |
| plan | 規劃、workflow、流程、任務分解 | planner / workflow / compose |
| office | Office、文件、Word、Excel、PPT | officecli MCP tools（外部整合） |
| analyze | 分析、評估、架構、review | arch_overview / smart_learn / smart_deep_think |
| wiki | wiki、知識庫、筆記、obsidian | skill("wiki-xxx") |

### 實作階段

| 步驟 | 內容 | 檔案 |
|------|------|------|
| 1 | hybrid-engine 新增 GENERAL 類別 + 各領域 pattern | `src/lib/hybrid-engine.mjs` |
| 2 | hybrid-router 新增 general task handler | `src/plugins/standard/hybrid-router.mjs` |
| 3 | 簡化 agent personality 路由決策樹 | `config/agents/smart-mcp.md` |
| 4 | 將 agent_recommend 改為 hybrid-engine 薄 wrapper ✅ | `src/plugins/standard/agent-recommend.mjs` |
| 5 | 測試驗證：一般任務回傳推薦而非執行 | `tests/hybrid-engine.test.mjs` (manual) |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| LLM 需記住的 entry point | 4 層 × 40+ 工具 | 1 個 hybrid_router |
| 路由決策錯誤率 | 中（LLM 猜錯層/工具） | 低（系統自動分類） |
| 新工具加入成本 | 高（personality + 所有文件都要改） | 低（只加 classifier pattern） |
| Agent personality 大小 | 242 行 | ~150 行（路由部分簡化） |

---

---

## Phase 4：文件轉換（Document Ingestion）

> 基於生態圈研究結論：Phase 4 聚焦單一高價值缺口，不做功能堆疊。

### 核心問題

Smart MCP 目前只能讀純文字格式（.js, .ts, .py, .md, .txt, .json, .yaml, .csv）。完全無法讀取二進位文件：

| 格式 | 常見場景 | 目前狀態 |
|------|---------|---------|
| PDF | 規格書、合約、論文、技術報告 | ❌ 無法讀取 |
| DOCX/DOC | Word 文件、提案、會議記錄 | ❌ 無法讀取 |
| PPTX | 簡報、產品介紹 | ❌ 無法讀取 |
| XLSX | 試算表、數據報表 | ❌ 無法讀取 |
| HTML | 網頁內容匯出 | ❌ 無法處理（需 fetch） |

**生態佐證**: Microsoft markitdown（119K ⭐）是 MCP 生態圈最受歡迎的專案，證明「文件 → Markdown」是所有 LLM 工具的共同需求。

### 解決方案

新增 `ingest_document` 工具，將二進位文件轉換為 Markdown，讓 LLM 可以直接分析內容。

```
使用者：「幫我分析這份合約」
  → LLM 呼叫 ingest_document({path: "contract.pdf"})
  → 偵測格式 → 轉換 Markdown → 回傳純文字
  → LLM 分析條款、關鍵日期、風險
```

### 設計

| 層面 | 作法 |
|------|------|
| **轉換引擎** | 雙層架構：Node library（內建無依賴）+ system CLI（強化覆蓋率） |
| **格式偵測** | 副檔名優先 + magic bytes 驗證（`file-type` npm） |
| **輸出格式** | 統一 Markdown，追求 lossless 轉換 |
| **大檔案** | >100 頁自動分段回傳，支援 offset 續讀 |
| **路由整合** | 新增 `document` 領域到 hybrid-engine DOMAIN_MAP |
| **錯誤處理** | 無可用 converter → 清楚提示安裝指令 |

### 支援格式路線

| 格式 | 優先級 | 轉換方式 | 依賴 |
|------|--------|---------|------|
| PDF | **P0** | `pdf-parse` (Node) + fallback `pdftotext` | 無/可選 |
| DOCX | **P0** | `mammoth` (Node) + fallback `pandoc` | 無/可選 |
| HTML | **P0** | `html-to-text` (Node) | 無 |
| Markdown | P0 | 直接讀取（已有） | 無 |
| PPTX | **P1** | `pptx2md` CLI / python-pptx | 可選 |
| XLSX | **P1** | `xlsx` npm → Markdown table | 無 |
| CSV | P1 | 已有能力強化 | 無 |
| EPUB | P2 | `pandoc` / `epub2md` | 可選 |
| RTF | P2 | `textutil` (macOS built-in) | macOS |
| OCR | P2 | `tesseract`（圖片轉文字） | 可選 |

### 與現有系統整合

1. **hybrid_router** — 新增 `document` 領域：觸發關鍵字「分析合約」「讀取規格」「看這份報告」「PDF」「DOCX」
2. **fast_apply** — 若 LLM 需要修改文件內容，可透過 fast_apply 套用變更
3. **Document Registry** (Phase 4b ✅ 2026-06-08) — SQLite 文件索引，ingest 時自動註冊，支援跨 session 搜尋/列舉。取代最初的 CKG/wiki 路線（LLM 可自行組合 ingest + wiki-capture，不需基礎設施支援，但 LLM 無法跨 session 記憶 — registry 解決真實瓶頸）

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 可讀取文件格式 | 7 種（純文字） | 11+ 種（含二進位） |
| 新 onboarding 情境 | 只看程式碼 | 也可看 PDF 規格、Word 合約 |
| 生態競爭力 | 無文件支援 | 跟上 markitdown 模式 |
| 實用場景 | 純開發 | 開發 + 文件分析 + 合約審閱 |

### 不上什麼

| 不做的功能 | 原因 |
|-----------|------|
| 文件編輯（寫回 DOCX/PDF） | 需求差異大，LLM 產出結構化 Markdown 即可 |
| OCR 圖片辨識 | 依賴 tesseract 外部安裝，P2 可選 |
| 大量批次轉換 | 工具一次處理一份文件，batch 交給 shell script |
| 自動偵測目錄變化 | Scope creep，watch mode 以後再說 |

---

### Phase 4b 交付摘要 (2026-06-08)

| 元件 | 說明 |
|------|------|
| `src/lib/document-registry.mjs` | SQLite 文件索引（Node 26+ node:sqlite），無外部依賴。CRUD + search |
| `ingest-document.mjs` | 自動 register 每次 ingest，接受 summary 參數存入 registry |
| `list-documents.mjs` | `smart_list_documents` 工具：query 搜尋 + format 過濾 + limit 控制 |
| DOMAIN_MAP | `document` 領域新增 `smart_list_documents` 工具 |
| Agent personality | 兩工具加入 direct-call table + hybrid_router 例子 |
| Tests | 21 tests（core CRUD + search + singleton + plugin integration） |

**關鍵決策變更**：CKG/wiki 整合太早（LLM 能自行組合 `ingest_document → wiki-capture`），改做 document registry 解決 LLM 無法跨 session 記憶的真實瓶頸。

---

## Phase 5：全文文件檢索（Full-text Document Search）

> ✅ 2026-06-08 實作完成，7 個 Phase 5 測試 + 28 個 registry 測試全部通過。
> `search-docs.mjs` (126 行) + `document-registry.mjs` content search + excerpt extraction。

### 交付項目

| 項目 | 狀態 | 說明 |
|------|------|------|
| `storeContent()` / `searchContent()` | ✅ | document-registry.mjs，支援多詞 AND 搜尋 |
| DB auto-migration（ADD COLUMN content） | ✅ | schema version tracking |
| `smart_search_docs` MCP tool | ✅ | search-docs.mjs，含 excerpt extraction |
| hybrid-engine DOMAIN_MAP 整合 | ✅ | document 領域 |
| Agent personality 更新 | ✅ | direct-call table + router 例子 |
| 測試 | ✅ 28 pass, 0 fail | store/search/migration/plugin integration |

### 架構說明

```
Ingest 流程：
  File → ingestDocument() → registry.register(metadata)
                           → registry.storeContent(path, 前4000chars)

搜尋流程：
  query → registry.searchContent(query)
    → SELECT * FROM documents WHERE content LIKE '%q1%' AND content LIKE '%q2%'
    → 回傳：路徑 + 格式 + 內容片段（含 match 前後文）
```

### 不上什麼

- 不引入 FTS5 或 elasticsearch — LIKE 搜尋就夠用
- 不存全文 — 只存前 4000 chars 做搜尋，完整內容用 smart_ingest_document 讀取
- 不做 ranking/scoring — 簡單按 updated_at 排序
- 不做中文分詞 — 單字匹配就夠

---

## Phase 6：Hallucination Detection — 輸出真實性驗證層 ✅

> 2026-06-10 誠實盤點 → 2026-06-12 完整規劃 → 2026-06-12 實作完成。
> 原始 12 項 research 清單中，11 項已被現有功能覆蓋或價值不足 — 僅保留 1 項真正有 incremental value 的項目。

### 核心定位

**現狀問題**：Smart MCP 有輸出優化（Phase 1-2）、路由（Phase 3）、文件（Phase 4-5）、推理品質（Phase 7）、LSP（Phase 8）、記憶（Phase 10-11），但**完全沒有輸出真實性驗證**。LLM 可能亂掰函式名稱、錯誤歸因、引用不存在的檔案，沒有任何機制攔截。

**Phase 6 vs Phase 7 Self-Correction**：

| 層面 | Phase 7 Self-Correction ✅ | Phase 6 Hallucination Detection 📋 |
|------|---------------------------|-----------------------------------|
| 檢查者 | **LLM 自己**（self-check） | **獨立 LLM-as-Judge**（第三方驗證） |
| 盲點 | 可能錯過自己的錯誤假設 | 客觀 groundedness 驗證 |
| Token 成本 | 低（同一 context） | 中（額外 LLM call） |
| 整合深度 | prompt-level（建議性） | server-level（可強制） |
| 現狀 | ✅ prompt 規則已定義 | ❌ 尚未實作 |

**互補關係**：LLM 輸出 → self-check（Phase 7）→ independent judge（Phase 6）→ 需修正？→ 最多 1 輪

### 實作範圍：4 項交付

#### ① 研究：6 種幻覺類型評分 Prompt

| # | 類型 | 定義 | 檢測方式 |
|---|------|------|---------|
| 1 | **Fabrication** | 編造不存在的函式/檔案/API | 比對工具輸出中是否包含未回傳的資訊 |
| 2 | **Misattribution** | 錯誤歸因（說 A 函式造成 B 錯誤） | 交叉比對 error stack 與歸因 |
| 3 | **Unfaithful** | 偏離使用者問題或工具結果 | 比對輸出與工具實際回傳內容 |
| 4 | **Self-contradiction** | 前後矛盾 | 同一輸出內邏輯一致性檢查 |
| 5 | **Off-topic** | 答非所問 | 比對輸出主題與原始 query |
| 6 | **Confident refusal** | 過度自信的錯誤否定 | 檢查絕對性用語 + 工具結果對照 |

評分輸出格式：
```json
{ "score": 8, "issues": [{"type":"fabrication","detail":"...","severity":"high"}], "verdict": "pass" }
```
verdict: pass (≥7) | warn (4-6) | fail (<4)

#### ② 核心：`src/lib/hallucination-judge.mjs`

LLM-as-Judge 引擎，不直接 call LLM（Server 端無 LLM 存取權），而是產出**結構化檢查清單**供 LLM 自我驗證：

```
檢查流程：
  Output + Tool Context + Query
    ├─ 1. Factual Check：輸出中提到的函式/檔案/API 是否在工具結果中？
    ├─ 2. Consistency Check：輸出內部是否邏輯一致？
    ├─ 3. Groundedness Check：結論是否可從工具回傳內容回溯？
    ├─ 4. Off-topic Check：回答是否偏離原始問題？
    └─ 5. Confidence Check：是否有過度自信的錯誤陳述？
    → 回傳結構化檢查清單：{ checks: [{type, passed, detail}], overallScore, verdict }
```

#### ③ Plugin：`src/plugins/standard/hallucination-check.mjs`

```js
smart_hallucination_check {
  output: string,        // 要檢查的 LLM 輸出
  context?: string,      // 工具回傳的原始內容
  query?: string,        // 原始使用者問題
  toolName?: string,     // 輸出來自哪個工具
  strictness?: number,   // 嚴格度 1-10（預設 5）
}
```

#### ④ Server 端整合：Post-execution Hook

沿用 `captureAndReturn()` 的 Impact Warning 模式（Phase 10.2）：

```js
// captureAndReturn() 中：
if (success && isHighRiskOutput(toolName)) {
  result._pendingHallucination = triggerHallucinationCheck(toolName, args, result);
}

// respond() 中：
if (result._pendingHallucination) {
  const hcResult = await result._pendingHallucination;
  if (hcResult?.verdict === 'fail' || hcResult?.verdict === 'warn') {
    result.content[0].text += '\n\n---\n⚠️ ' + hcResult.summary + '\n---';
  }
}
```

**高風險工具判定**（與 Phase 7 self-correction 一致）：

| 工具 | 自動檢查？ | 理由 |
|------|-----------|------|
| `smart_security` 輸出 | ✅ | 安全修復不能錯 |
| `smart_error_diagnose` | ✅ | 錯誤歸因必須正確 |
| `smart_deep_think` (report/report模板) | ✅ | 報告類輸出 |
| `ingest_document` 摘要 | ✅ | 合約/規格分析 |
| `smart_grep` / `smart_test` | ❌ | 低風險，跳過省 token |

### 交付清單

| # | 項目 | 檔案 | 預計工時 | 狀態 |
|---|------|------|---------|------|
| 1 | 6 種幻覺類型評分 prompt + 定義 | `src/lib/hallucination-judge.mjs` | 0.5 天 | ✅ |
| 2 | Hallucination Judge 引擎 | `src/lib/hallucination-judge.mjs` | 1 天 | ✅ |
| 3 | MCP Plugin + schema | `src/plugins/standard/hallucination-check.mjs` | 0.5 天 | ✅ |
| 4 | Server 端 post-execution hook | `src/server/index.mjs` | 0.5 天 | ✅ |
| 5 | hybrid-router DOMAIN_MAP 整合 | `src/lib/hybrid-engine.mjs` | 0.25 天 | ✅ |
| 6 | Agent personality 更新 | `config/agents/smart-mcp.md` | 0.25 天 | ✅ |
| 7 | 測試：6 類型幻覺驗證 | `tests/hallucination-judge.test.mjs` | 1 天 | ✅ 29 tests |
| 8 | 測試：server 整合 + regression | `tests/hallucination-integration.test.mjs` | 0.5 天 | ✅ 15 tests |
| | **總計** | | **~4.5 天** | **1029 tests, 0 fail** |

### 整合架構

```
invokeTool() → invokeToolWithRetry()
  → 成功
    → captureAndReturn()
      → HIGH_RISK_PREREQUISITES (pre-execution quality gate)
      → autoStoreToMemory / autoExtractSkillPatches
      → Impact Warning (multi-file edits ≥3)
      → hallucination check (high-risk tools)    ← Phase 6
    → respond()
      → _pendingImpact  await
      → _pendingHallucination await              ← Phase 6
      → output-optimizer (L0/L1/L2)
      → context budget check
  → 全部失敗
    → fallback chain (Error Recovery 10.3)
```

### 不上什麼

| 項目 | 原因 |
|------|------|
| 依賴外部 LLM API | 規則 based 檢查就夠用（Server 端無 LLM 存取權） |
| 自動修改輸出 | 只標記不修改，留給 LLM 決定 |
| 全量輸出檢查 | 只檢查高風險工具，一般工具跳過 |
| Real-time streaming 檢查 | 產出完整後一次性檢查，streaming 檢查太複雜 |

### 其餘 11 項已移除的原因

| 項目 | 移除原因 | 已有替代 |
|------|---------|---------|
| Context Caching | provider 設定問題，不是 code 工作 | 選有支援的 provider 即可 |
| Prompt Compression | 與現有 output-optimizer L0/L1/L2 + opencode compaction 重疊 | Phase 1-2 ✅ |
| Guardrails | Server 端 HIGH_RISK_PREREQUISITES 已做到強制攔截 | Phase 7 ✅ |
| Observability / Tracing | 單開發者 debug 工具，不會讓 LLM 變聰明 | — |
| Multi-Agent Debate | Beam Search / Forest-of-Thought 已達類似效果 | Phase 7 ✅ |
| DSPy Prompt Optimization | Skill-level Learning (skill_patch) 是輕量替代 | Phase 7 ✅ |
| Tree of Thoughts / MCTS | Forest-of-Thought 已做到多樹分支 + consensus | Phase 7 ✅ |
| Speculative Decoding | provider 選擇問題，不是 code 工作 | — |
| LLM-as-Judge Eval | 開發者工具，非 core value | — |
| Self-Play | 需 RL 基礎設施，超出 MCP server 範圍 | — |
| Automated Red Teaming | 複雜度高，單開發者事件率極低 | — |

---

## Phase 7：Reasoning Quality — 讓 LLM 真正變聰明

> 2026-06-10 規劃。基於 Phase 1-6 的誠實反省。
> 核心洞察：Phase 1-5 讓 LLM 更**有效率**、更**安全**、更**多才多藝**，
> Phase 6（Hallucination Detection）讓輸出更**可靠**，
> 但都沒有直接讓它變得更**聰明**。

### 誠實盤點：6 個 Phase 的「智慧」貢獻

| Phase | 核心內容 | 做什麼 | LLM 有變聰明嗎？ |
|-------|---------|--------|----------------|
| 1-2 | 輸出壓縮 + Pipeline | 省 token | ❌ 變便宜，沒變聰明 |
| 3 | Universal Task Router | 減輕決策負擔 | ⚠️ 減少失誤，沒提升品質 |
| 4 | 文件轉換 | 看得懂更多格式 | ❌ 變廣，沒變深 |
| 5 | 全文搜尋 | 記得住更多內容 | ❌ 記憶變好，推理沒變 |
| 6 | Hallucination Detection | 輸出真實性驗證 | ⚠️ 減少幻覺，提升可信度 |

**結論**：截至 Phase 6，Smart MCP 的增強主要在**基礎設施層**（Phase 1-5）+ **輸出驗證層**（Phase 6），
但 LLM 的推理品質仍然完全由外部 provider 的模型決定。

### 核心問題

```
目前的推理流程：

  LLM 收到問題 → 線性思考一次 → 輸出
                     └── 錯了就錯了，沒有回溯、沒有備援路徑
```

Phase 7 要解決的是：**在不改變模型參數、不引入外部 reward model 的前提下，如何讓 LLM 的「思考過程」本身產生更好的結果？**

### 解決方案：三條可行的路

不同於 Phase 6（Hallucination Detection — 輸出真實性驗證），Phase 7 的三條路都是**輕量、可直接疊加**在現有架構上：

| 路徑 | 作法 | 工程難度 | 智慧提升 | 與現有系統關係 |
|------|------|---------|---------|-------------|
| **① Beam Search Thinking** | 升級 smart_think：2-3 條路徑並行推理 → 路徑評估 → 選最佳 | 🟡 中 | 🎯 直接 — 複雜推理品質 +15-30% | 擴充現有 smart_think，不新增 plugin |
| **② Self-Correction Loop** | 高風險輸出走「輸出→驗證→修正→最終」循環 | 🟡 中 | 🎯 直接 — 減少幻覺 + 提升可靠度 | 搭配 hallucination_check (Phase 6) |
| **③ Skill-level Learning** | 成功/失敗案例提煉為 skill prompt 改善，越用越強 | 🟡 中 | 🎯 長期累積 | 擴充 memory_store，不新增 plugin |

---

#### ① Beam Search Thinking

**現狀**：`smart_think` 只有線性 CoT — 一條路徑到底，錯了就錯了。

```
Request: 「幫我 debug 這個 crash」

目前線性 CoT：
  收到 crash log → 假設是 memory issue → 檢查 alloc/free → 找到 buffer overflow
  → 但如果其實是 race condition？已經來不及了。

Beam Search（2-3 條路徑）：
  收到 crash log →
  ┌ 路徑 A: 假設 memory issue → 檢查 alloc/free → 找到 buffer overflow (信心: 7/10)
  ├ 路徑 B: 假設 race condition → 檢查 lock → 找到 timing bug (信心: 3/10)
  └ 路徑 C: 假設 null pointer → 檢查 initialization → 找到未初始化變數 (信心: 8/10)
  → LLM 選 C（最高分）→ 輸出
```

**實作方式**：
- `smart_think` 新增 `mode: "beam"` 參數
- 內部：產生 2-3 條獨立推理路徑 → 每條路徑 LLM 自我評估信心度（不需外部 reward model）→ 收斂選擇最高分路徑
- 路徑產生策略：先產生全部路徑再評估，非逐步（避免過多 token 浪費）
- **回退機制**：beam 路徑分歧過大（信心度差異 < 20%）→ 降級回 linear CoT，避免浪費 token
- 預設只在 `template: "debug" | "refactor" | "architecture"` 等複雜模板啟用

**效益**：複雜推理場景（除錯、安全修復、重構方案、架構分析）品質提升 15-30%。
Token 成本僅多 2-3 倍（僅在複雜任務啟用，一般任務不受影響）。

---

#### ② Self-Correction Loop

**現狀**：LLM 輸出直接回使用者，不經過任何品質檢查。

```
目前：LLM 輸出 → 回使用者（錯了就錯了）

改為（高風險任務）：
  LLM 輸出 → hallucination_check(輸出, 任務描述)
    ├── 分數 ≥ 7/10 → 回使用者 ✅
    └── 分數 < 7/10 → LLM 修正 → 再檢查 → 回使用者
                          └── 仍然 < 7 → 標註「低信心度」後回使用者（最多 1 輪）
```

**實作方式**：
- 在 agent personality 新增行為規則，不用新增 plugin
- **高風險任務**自動啟用 self-correction：
  - 安全修復（`smart_security` 輸出）
  - 重大重構（影響多檔案）
  - 合約/文件分析（`ingest_document` 的總結）
  - 任何 LLM 自己判斷「不確定」的回答
- **一般任務**（grep、test、簡單編輯）→ 跳過，省 token
- 修正 loop 最多 1 輪（避免 infinite loop + token 爆炸）

**效益**：高風險輸出的可靠度大幅提升，達到生產級門檻。

---

#### ③ Skill-level Learning

**現狀**：`memory_store` 只記「錯誤解法」，不改變 LLM 的行為模式。下次遇到類似問題仍可能犯同樣錯。

```
目前：遇到 bug → 修好 → memory_store("xxx 的解法")
下次：遇到類似 bug → 讀 memory → 照做（被動，且依賴 LLM 記住去查 memory）

改為：遇到 bug → 修好 → 提煉「為什麼這樣修、判斷關鍵是什麼」
  → 更新對應 skill 的 prompt 或行為慣例
下次：skill 已內化 → 主動用正確方法（不需查 memory）
```

**實作方式**：
- **不新增獨立工具**。擴充 `memory_store` 使其支援 `type: "skill_patch"`
- `type: "skill_patch"` 的條目包含：
  - 觸發條件（什麼情境下適用）
  - 行為改善建議（「下次遇到 X 時，應該先做 Y」）
  - 對應 skill 名稱（如 `smart-mcp-debug`）
- Session 結束時自動掃描 findings → 提煉 1-2 條 skill_patch（非同步，不阻塞）
- agent_recommend 或 hybrid_router 可參考 skill_patch 調整推薦行為

**與 Phase 6 的 Hallucination Detection 差異**：
- Hallucination Detection：檢查「這一次」的輸出是否正確
- Skill-level Learning：讓「下一次」的輸出更好

**效益**：越用越強。不是被動記憶（memory），是指令改善（skill evolution）。

---

### 整合架構：Quality Layer + Reasoning Layer + Verification Layer

Phase 6（Hallucination Detection ✅）、Phase 7（Reasoning Quality ✅）、Phase 10（Error Recovery ✅）合併為統一 pipeline：

```
Pre-call 層     │ Quality Gate (HIGH_RISK_PREREQUISITES) + Error Recovery (retry)
Call 層         │ LSP Bridge + Smart Tools
Reasoning 層 🌟 │ Beam Search Thinking + Self-Correction Loop (Phase 7)
Post-call 層 🛡️ │ Hallucination Detection (Phase 6) + Impact Warning (Phase 10.2)
Output 層       │ L0/L1/L2 Output Optimizer + Context Budget (Phase 1-2 / 10.4)
Cross-cutting   │ Skill-level Learning + Auto Memory Injection (Phase 10.5/10.6)
```

### 優先級矩陣

| 優先 | 項目 | 難度 | 智慧提升 | Token 成本 | 時間估計 |
|------|------|------|---------|-----------|---------|
| 🥇 | Self-Correction Loop | 🟢 低 | 🎯 直接 | 多 1 倍 LLM call（僅高風險任務） | 2-3 天 |
| 🥇 | Beam Search Thinking | 🟡 中 | 🎯 直接 | 多 2-3 倍（僅複雜推理模板） | 3-5 天 |
| 🥇 | Skill-level Learning | 🟡 中 | 🎯 長期累積 | 無（session 結束非同步） | 5-7 天 |

### 不上什麼

| 項目 | 原因 |
|------|------|
| **Full MCTS / Tree of Thoughts** | 需要 reward model 訓練 + tree search engine，偏離 MCP 工具定位 |
| **Multi-Agent Debate** | 多 LLM call 成本高，單 agent beam search 已足夠 |
| **Self-Play / RL** | 訓練基礎設施需求過高，無法控制外部 provider 模型 |
| **DSPy 自動 prompt 優化** | Python dependency + eval dataset 建置成本高，skill-level learning 為輕量替代 |

---

### Phase 7 誠實盤點：已實作但無法強制

Phase 7 三條路徑已完成開發（程式碼 + prompt 規則），
但有一根本限制未被解決：**品質閘寫在 prompt 裡，LLM 可以選擇不遵守。**

| 機制 | 狀態 | 問題 |
|------|------|------|
| Beam Search Thinking | ✅ 程式碼 + prompt 規則完整 | **使用與否由 LLM 自主判斷，無法強制** |
| Self-Correction Loop | ✅ prompt 規則完整 | 高風險任務識別依賴 LLM 自評，可能漏掉 |
| Skill-level Learning | ✅ 程式碼 + prompt 規則完整 | memory_store 查詢與否由 LLM 決定 |

#### 2026-06-10 修正記錄：Beam Search 適用範圍校正

根據實際調用分析，發現 `smart-mcp.md` 有三處矛盾導致 beam search 被誤用：

| 位置 | 改前 | 改後 | 原因 |
|------|------|------|------|
| Beam Search 說明 | 除錯、重構方案選擇、**架構分析** | 除錯、重構方案選擇 | 架構分析是線性綜合，無競爭假設 |
| 推理品質閘 | 除錯 /** 架構分析** / 方案比較 | 除錯 / 方案比較 | 同上 |
| 常用推理工作流 | 架構方案比較用 `mode:"beam"` | 改用一般 `smart_think` | 方案比較不需多路徑 |

#### 實際調用統計（經驗觀察）

| 場景 | Beam Search 觸發？ | 原因 |
|------|-------------------|------|
| 股票分析 | ❌ 從未觸發 | 資料收集 + 公式打分，無競爭假設，正確 |
| 專案架構分析 | ❌ 不走 beam | 已修正排除，走 `smart_deep_think` 正確 |
| 複雜除錯（不確定原因） | ✅ 偶爾觸發 | 品質閘建議，LLM 自行判斷 |
| 重大重構（多方案比較） | ✅ 偶爾觸發 | 同上 |
| 一般查詢 / 編輯 | ❌ 不觸發 | 品質閘明確跳過，正確 |

#### 解決方案：Server 端強制執行（2026-06-10 已實作）

在 `src/server/index.mjs` 的 `invokeTool` 中，加入品質閘強制檢查：

```
LLM 呼叫 high-risk tool
  → server 檢查 session context 中是否有前提工具呼叫紀錄
  → 無？回傳錯誤（含下一步指引）
  → 有？執行工具
          ↑ LLM 無法繞過，因為 server 不執行
```

| 強制規則 | 檢查條件 | 前提要求 |
|---------|---------|---------|
| 安全修復 | `smart_fast_apply` 前有 `smart_security` | 必須先跑 `smart_think({mode:"beam",...})` |
| 跨檔案編輯 | `smart_cross_file_edit` 被呼叫 | 必須先跑 `import_graph` |

**技術實作**：`HIGH_RISK_PREREQUISITES` map + `checkHighRiskPrerequisites()` 攔截在 `invokeTool` 中，早於 handler/CLI 執行。搭配 `contextManager` 的 `toolHistory` 查詢前提工具。

**與 prompt 品質閘的差異**：

| 層面 | Prompt 建議（舊） | Server 強制（新） |
|------|-----------------|-----------------|
| 可繞過？ | ✅ LLM 可選擇不理 | ❌ 完全無法繞過 |
| 實作位置 | `config/agents/smart-mcp.md` | `src/server/index.mjs` |
| 錯誤回應 | 無（LLM 直接忽略） | 回傳結構化錯誤，指引 LLM 下一步 |
| 維護成本 | 低（純文字） | 中（需定義規則 + 測試） |

**不上什麼**：不拦截一般工具呼叫（grep/learn/test/think），不實作 post-execution 驗證（留給 Phase 6 hallucination_check）。

---

## Phase 8：Universal LSP Bridge — 讓 LLM 看懂程式碼

> ✅ 2026-06-10 完成。7 個 LSP 測試全部通過。
> 將現有 LspBridge (src/lib/lsp-bridge.mjs) 暴露為 `smart_lsp` MCP tool，
> 讓 LLM 可以直接進行 type-aware 程式碼理解（找定義、查引用、看型別、診斷錯誤）。

### 實作交付

| 項目 | 狀態 | 檔案 |
|------|------|------|
| `smart_lsp` MCP tool（5 種 operation） | ✅ 127 行，handler-based | `src/plugins/core/lsp.mjs` |
| PHP intelephense 支援 | ✅ 已加入 LSP_CONFIGS | `src/lib/lsp-bridge.mjs` |
| `getDiagnostics()` 方法 | ✅ textDocument/diagnostic | `src/lib/lsp-bridge.mjs` |
| Agent personality 路由規則 | ✅ 11 處提及 | `config/agents/smart-mcp.md` |
| 4 個 SKILL.md 更新 | ✅ php/pyright/typescript/swift | `~/.config/opencode/skills/*/SKILL.md` |
| Agent config 同步 | ✅ | `~/.config/opencode/agents/smart-mcp.md` |
| 測試 | ✅ 7 tests, 0 fail | `tests/lsp-bridge.test.mjs` |

### 架構

```
LLM (OpenCode)
  │ smart_lsp({operation:"definition", file:"src/auth.ts", line:42, character:10})
  ▼
Smart MCP Server
  │ src/plugins/core/lsp.mjs (handler-based)
  │   → import { getLspBridge } from '../../lib/lsp-bridge.mjs'
  ▼
LSP Bridge (src/lib/lsp-bridge.mjs)
  │ 自動依副檔名選 language server
  ├─ .ts/.tsx → typescript-language-server
  ├─ .py      → pylsp
  ├─ .rs      → rust-analyzer
  ├─ .swift   → sourcekit-lsp
  └─ .php     → intelephense (NEW)
```

### 不上什麼

| 項目 | 原因 |
|------|------|
| 通用 LSP protocol bridge（任意 language server） | 現有 5 語言覆蓋 90% 使用場景，其餘用 CLI fallback |
| LSP 自動安裝 | 依賴管理複雜，交給使用者 |
| workspace/symbol 跨檔案搜尋 | LSP bridge 已支援但 LLM 使用頻率低，先用 file-level operations |

---

## Phase 9：與 Claude Code 比較後的誠實盤點

> 2026-06-10 基於與 Claude Code 架構比較後的自我批判。
> 評估標準：同一個 LLM 的前提下，這個功能真的能讓 smart-agent 變聰明/變有效率嗎？
> 還是只是「人家有我也要有」的功能堆疊？

### 盤點

| # | 落後項目 | 原始印象 | 誠實評估 | Verdict |
|---|---------|---------|---------|---------|
| 1 | **Context Compactor** | 缺 conversation compaction 長 session 會 degradation | 已有 output-optimizer (L0/L1/L2) 壓工具輸出 + opencode-wm hook compaction 做記憶提取。更多 compaction 是 opencode client 端的責任，不是 MCP server 的。diminishing returns。 | ❌ **不實作** — 已夠用，opencode 端處理 |
| 2 | **Tool Strategy Feedback Loop** | 讓 hybrid_router 從使用中學習、自適應 | LLM 本身就在 session 中自適應 — 這次用 grep 找到結果，下次會繼續用。hybrid_router 是靜態分類器，加了學習會增加複雜度但 LLM 不一定會用。 | ❌ **不實作** — LLM 已在 session 內自適應 |
| 3 | **Sub-agent** | 可平行化閱讀/搜尋 | opencode 已有 Task tool 可 spawn sub-agent。Smart MCP 不需要再實作一層。 | ❌ **已有替代** — opencode 原生支援 |
| 4 | **Persistent Shell** | cd 狀態保留、env 累積 | 對效率有些幫助，但增加 stale state 風險。bash tool 已支援 workdir 參數。 | ❌ **不實作** — 風險 > 效益 |
| 5 | **Permission System** | 安全基礎設施 | opencode 已有 permission 機制。Smart MCP 疊一層只增加 friction。 | ❌ **已有替代** — opencode 原生支援 |
| 6 | **Streaming UI** | UX 改善 | Smart MCP 是 MCP server，不是 standalone agent。UI 是 opencode 的責任。 | ❌ **不適用** — 不在責任範圍 |
| 7 | **Hooks System** | pre/post tool hooks | opencode 已有 hooks 機制。 | ❌ **已有替代** — opencode 原生支援 |
| 8 | **Cost Tracking** | Token / API cost 追蹤 | opencode 已有 `/cost` 指令。Smart MCP 的 `smart_context budget` 已提供 context budget 查詢。 | ❌ **已有替代** — 兩層都已做到 |

### 關鍵洞察

**Smart MCP 的定位是「MCP server」不是「agent loop」**。Claude Code 的優勢架構（agent loop、context compaction pipeline、sub-agent、hooks）很大部分是 **Agent 層**而不是 Tool 層的責任。而 opencode 本身就是那個 Agent 層。

所以正確的比較不是：

```
Smart MCP             vs    Claude Code
（沒有 agent loop）         （有 agent loop）
```

而是：

```
opencode + Smart MCP   vs    Claude Code
（opencode 是 agent）        （monolithic）
```

在這個架構下，Smart MCP 應該專注在**工具深度**，而不是複製 Claude Code 的 agent 基礎設施。這正是目前路線圖的方向。

### 真正該關注的事

| 真有幫助的項目 | 所屬 Phase | 原因 |
|--------------|-----------|------|
| Beam Search Thinking / CiT / Forest | Phase 7 ✅ 已實作 | 讓 LLM 在同一個 context budget 下做出更好的推理 |
| Self-Correction Loop | Phase 7 ✅ 已實作 | 高風險任務的輸出可靠度提升 |
| LSP Bridge | Phase 8 ✅ 已完成 | Type-aware 程式碼理解，比 grep 精準且省 token |
| Full-text Search | Phase 5 ✅ 已完成 | 文件內容搜尋，跨 session 找到關鍵資訊 |
| Hallucination Detection | Phase 6 ✅ 已完成 | 輸出真實性檢查，生產級門檻。judge engine + plugin + server hook + 44 tests |
| Error Recovery / Benchmark / Sandbox / Auto Memory | Phase 10 📋 規劃中 | 讓人敢放手、持續用、越用越好 |

### 結論

Phase 6 + 7 + 8 走方向是對的。Phase 10 補上「信任 + 持續用 + 越用越好」這條 missing link。Phase 6 已完成（2026-06-12），補上最後一塊拼圖：輸出真實性驗證。**不需要為了追上 Claude Code 而做功能複製 — Smart MCP + OpenCode 的武器是工具深度，不是 agent loop。**

---

## Phase 14：取代 OpenCode Compaction — Smart MCP 智慧壓縮層

> 2026-06-12 規劃 → 2026-06-12 設計前提修正。
> 關鍵發現：OpenCode compaction 期間 agent 完全停住 → Phase 14 不可在 compaction hook 中做 blocking IPC。
> 設計轉向：**Prevention > Cure** — 在 compaction 發生前透過 budget threshold 觸發清理，而非 compaction 時處理。

### 核心發現：compaction 期間 agent 停住

OpenCode 的 compaction 是**同步堵塞的**。compaction-fix.js 的 `onCompacting` hook 雖然可以注入 context，但此時 agent 已經停住，無法處理任何 MCP IPC call。

**這代表**：

| 原本假設 | 實際限制 |
|---------|---------|
| onCompacting 中 call Smart MCP server (`spawnSync`) | ❌ Agent 已停住，IPC 會 timeout |
| messages.transform 中用 smart_compact 回傳的 recoveryContext | ✅ 可以，這是現有行為（compaction 完成後，auto-continue 前） |
| 透過 `_pendingImpact` / `_pendingHallucination` 非同步 post-processing | ✅ 可以，走 respond() promise chain，不影響 compaction |

### 設計轉向：Prevention > Cure

```
Before（cure）:
  compaction 前 → 呼叫 smart_compact + clear_tool_results → compaction 發生
                   ↑ agent 停更久 ✗

After（prevention）:
  budget 70% → auto clear_tool_results（非同步，無感）
  budget 80% → LLM 收到 warning 可主動呼叫 smart_compact
  budget 90% → 強烈建議開新 session
  compaction → 輕量 recovery 維持現狀（不新增 blocking IPC）
```

### 三層取代策略（修正版）

```
┌─ Layer 1: Proactive Cleanup ──────────────────────────┐
│  14.1 自動清除舊 tool results                           │
│  - 手動：smart_context({command:"clear_tool_results"})   │
│  - 自動：respond() 在 budget 70% fire-and-forget 觸發   │
│  - 安全：keepLatest 保護 + system prompt 不碰           │
└────────────────────────────────────────────────────────┘
                                 ↓
┌─ Layer 2: Smart Compact Tool ─────────────────────────┐
│  14.2 規則 based 工具呼叫分類 + recoveryContext 產生     │
│  - LLM 在 budget warning 時主動呼叫（不堵塞）            │
│  - Rules-based（不需 LLM call）：grep→DROP etc.        │
│  - recoveryContext 供 LLM compaction 後重建 context     │
└────────────────────────────────────────────────────────┘
                                 ↓
┌─ Layer 3: API Server-Side Compaction ─────────────────┐
│  14.3 驗證 zen-claude-proxy 是否支援                    │
│  - 僅調查 + 記錄，不做功能性實作                          │
│  - 支援 → 可選啟用；不支援 → 記錄為已知限制               │
└────────────────────────────────────────────────────────┘
```

### 各層詳細設計

#### 14.1 Proactive Cleanup（先決條件）— 2 檔案

**目標**：讓 LLM 可以主動清除舊的、不需要的 tool history，釋放 context budget。

**介面**：
```
smart_context({command:"clear_tool_results", olderThan:10, keepLatest:2})
→ { removed: 5, kept: 3 }  // 移除 5 輪，保留最近 2 輪
```

**安全機制**：
- `keepLatest` 保護：最近 N 輪的工具結果不清除
- System prompt / thinking blocks 不受影響
- 空 context → 回傳 `removed: 0`

**自動觸發**：
- `respond()` 在 context budget 70% 時 fire-and-forget 執行一次
- 非同步，不堵塞回應
- 只執行一次（避免重複 trigger）

#### 14.2 Smart Compact Tool — 規則 based 分類器

**目標**：提供 LLM 一個工具來分析當前的 toolHistory，分類哪些可丟棄、哪些需保留摘要、哪些要完整保留。**不是 LLM call**，是純規則 based。

**輸入/輸出**：
```
smart_compact({toolHistory, conversationLength, currentGoal?, currentTodos?})
→ {
    toolCallsToDrop: [0, 1, 4],           // toolHistory index
    toolOutputsToSummarize: [{index:5, summary:"..."}],
    recoveryContext: {goal, todos, keyFindings, openQuestions},
    estimatedTokensSaved: 12000
  }
```

**工具類型壓縮規則**（規則 based，零 LLM cost）：

| Tool type | 處置 | 理由 |
|-----------|------|------|
| `smart_grep`, `smart_lsp` | **DROP** | 搜尋結果過期，需重整 |
| `smart_security` | **KEEP SUMMARY** | 找到的漏洞不能丟，但結果不用全留 |
| `smart_think`, `smart_deep_think` | **KEEP** | 推理過程可能還有用 |
| `smart_fast_apply`, `edit` | **KEEP** | 編輯是持續性動作，不能丟 |
| `smart_test`, `smart_learn` | **DROP** | 結果已反映在專案狀態 |
| `smart_ingest_document` | **KEEP SUMMARY** | 文件摘要，原文可重讀 |
| `error_diagnose`, `debug` | **KEEP** | 錯誤追蹤可能關聯 |
| `import_graph`, `code_impact` | **DROP** | 分析結果已過期 |
| `git_*` | **KEEP SUMMARY** | Git 狀態可能有關 |
| 未知 tool | **KEEP** | 保守策略 |

**實作形式**：`src/plugins/core/compact.mjs`，handler-based（比照 `lsp.mjs`），**不實作 CLI**。

#### compaction-fix.js 維持現狀

| 原本計畫 | 修正後決策 |
|---------|-----------|
| onCompacting 中 call Smart MCP IPC | **不做** — agent 已停住，IPC 會 timeout |
| onCompacting 中 call smart_compact | **不做** — 同上 |
| onCompacting 保持輕量 recovery context 注入 | ✅ **維持現狀** |
| messages.transform 用 smart_compact recoveryContext | **不做** — compaction 後 LLM 可直接呼叫 smart_compact |

**結論**：compaction-fix.js **不升級**。14.1 和 14.2 的功能走 proactive 路徑（budget threshold 觸發 + LLM 主動呼叫），不依賴 compaction hook。

#### 14.3 API Server-Side Compaction（調查）🔍 已調查 — 不適用

| 項目 | 結果 |
|------|------|
| 架構 | OpenCode → @ai-sdk/openai-compatible → 9Router (port 20128) → providers |
| `anthropic-beta` header | OpenAI-compatible protocol 不支援 Anthropic 原生 beta headers |
| **結論** | **不適用** — 需直接 Anthropic API 才能使用 server-side compaction。記錄為已知限制。 |

**不上什麼**：不做 proxy 修改（超出 MCP server 範圍）。

#### 14.4 Context Rot Warning（強化現有機制）

現有 `context-budget.mjs` 已有 threshold 分級和 warning 注入（Phase 10.4），14.4 在此基礎上強化：

| Threshold | 現有 | 強化後 |
|-----------|------|--------|
| 50-70% | `💡 注意 budget 即將耗盡` | `💡 Budget ${usedPct}。可考慮 smart_context({command:"clear_tool_results", olderThan:10})` |
| 70-90% | `⚡ Context budget low` | `⚡ Budget ${usedPct}。建議 clear_tool_results 或呼叫 smart_compact` |
| > 90% | `⚠️ Budget critical` | `⚠️ Budget 剩 ${remainingPct}。強烈建議 run smart_compact 或開新 session` |

#### 14.5 Prompt Caching（調查）🔍 已調查 — 不適用

| 項目 | 結果 |
|------|------|
| `cache_control` breakpoints | Anthropic 原生 API 功能，OpenAI-compatible protocol 不支援 |
| 9Router 是否傳遞 | OpenAI-compatible 格式無此概念 |
| **結論** | **不適用** — 需直接 Anthropic API。記錄為已知限制。 |

**不上什麼**：不在 Phase 14 實作 cache_control 注入（需認清這是 provider 層問題）。

### 優先級與相依性

| 優先 | 項目 | 估時 | 相依 |
|------|------|:----:|:----:|
| 🥇 | **14.4 Context Rot Warning 強化** | 0.5 天 | 無（強化現有 Phase 10.4） |
| 🥇 | **14.1 Proactive Cleanup** | 1-2 天 | context-budget（70% 自動觸發） |
| 🥇 | **14.2 Smart Compact Tool** | 2-3 天 | 14.1（依賴 clear_tool_results） |
| 🥈 | **14.3 API Compaction 驗證** | 0.5 天 | 無 |
| 🥉 | **14.5 Prompt Caching 驗證** | 0.5 天 | 無 |

**實際執行順序**：14.4（獨立）→ 14.1（先決）→ 14.2（核心）→ 14.3/14.5（調查）

### 不上什麼

| 項目 | 原因 |
|------|------|
| compaction-fix.js 升級（加 IPC call） | Agent 停住時 IPC 會 timeout |
| smart_compact 使用 LLM call（非規則 based） | Token 成本 > 效益，規則 based 就夠分類 |
| API Server-Side Compaction 在 MCP server 實作 | 超出 MCP server 範圍，是 provider/proxy 層 |
| Prompt caching 在 MCP server 實作 | 同上，provider 層問題 |
| 自動化 conversation summary | OpenCode 端已有 compaction summarizer，MCP 不疊床架屋 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| Context budget 70% 以上時的行動 | 無（只看 warning） | 自動 clear_tool_results + LLM 可手動 smart_compact |
| Context budget 可用區間 | 0-50% | 0-90%（因定期清理釋放空間） |
| Compaction 頻率 | 依賴 OpenCode 自動判斷 | 減少 50-70%（proactive 清理延後觸發） |
| Compaction 復原能力 | compaction-fix 輕量 recovery | 同左（維持不變，不倒退） |

---

## Phase 10：Trust, Continuity & Learning — 放心用・持續用・越用好

> 2026-06-10 規劃。基於與市面 AI agent 比較後的缺點分析。
> 核心問題：Smart MCP 有深厚的工具層（LSP/CKG/Workflow），
> 但缺少讓人敢**放手**讓 agent 做事、願意**每天用**、而且**越用越好**的機制。

### 放心用（Trust）

#### 10.1 Sandbox Execution ✅ (2026-06-12)

讓 agent 不只是「建議你跑什麼」，而是直接在安全環境執行給你看。

**作法**：新增 `smart_exec` MCP tool，接收 `{ language, code, files?, timeout }`，
在 sandbox（deno / node / python / bash）執行，回傳 stdout + stderr + exit code。

```
LLM: 「這個 bug 應該在這…我跑個測試確認」
  → smart_exec({ language: "bash", code: "node test/index.test.mjs" })
  → 回傳: { stdout: "...", stderr: "", exitCode: 0 }
```

#### 交付摘要

| 項目 | 說明 | 檔案 |
|------|------|------|
| `smart_exec` MCP tool | handler-based plugin，支援 4 語言 + 4 權限等級 | `src/plugins/standard/exec.mjs` (230 行) |
| 語言支援 | bash, node, python, deno（自動偵測可用 runtime） | — |
| 安全層級 | none (deno --allow-none) / read / write / net | — |
| Timeout 保護 | 預設 30s，上限 120s，逾時自動 kill | — |
| 輸出截斷 | stdout ≤ 50KB, stderr ≤ 10KB | — |
| 安全警告 | bash/write/net 自動附加 ⚠️ 警告 | — |
| 測試 | 27 tests（plugin structure / 4 語言 / timeout / sandbox / permission / output capping） | `tests/exec.test.mjs` |
| 全量回歸 | **1143 tests, 0 fail** | — |

| 項目 | 說明 |
|------|------|
| 安全策略 | deno `--allow-none`（最嚴）、docker container、可設定 whitelist commands |
| 使用者控制 | Permission level: allow / prompt / deny |
| 風險 | deno sandbox 不可用 → 降級回「請使用者手動執行」 |

| 不上什麼 | 原因 |
|---------|------|
| 任意 runtime 支援 | 只做 node/python/bash/deno（覆蓋 90% 開發場景），其他提示安裝 |
| 網路存取 | 預設阻擋，白名單開啟 |
| Persistent filesystem | 暫存目錄用完即焚 |

#### 10.2 Impact Warning 自動觸發 ✅ (2026-06-11)

`code_impact` 已存在（Phase 4），但需要 LLM 主動呼叫才會跑。
改為在高風險編輯（fast_apply 影響 > 2 檔案）時自動觸發。

**作法**：`captureAndReturn()` 在 `smart_fast_apply` 成功執行後自動觸發：
- `triggerImpactWarning()` — 解析 blocks/changes/text/whole 四種輸入格式
- 3+ 檔案編輯 → 非同步跑 `code_impact` → 結果追加到輸出
- 採 `_pendingImpact` promise 模式，`_respondChain` 在 `writeMsg` 前 await 並 append
- 修復字串拷貝 bug：原本 `triggerImpactWarning` 修改 `result.output` 但 response 已拷貝舊值

| 不上什麼 | 原因 |
|---------|------|
| 強制阻擋 | 資訊性展示，LLM 仍可決定繼續（避免過度 friction） |
| Full dependency graph | code_impact 已有 git diff + symbol analysis，足夠 |

---

### 持續用（Daily Driver）

#### 10.3 Error Recovery 統一策略

目前 tool timeout / crash → LLM 要自己想辦法重試。
改為 Server 端內建 retry + fallback。

**作法**：`invokeTool` 層加入：
- Retry：3 次 exponential backoff（1s → 2s → 4s）
- Fallback：LSP 不通 → grep、ingest_document 不通 → 提示安裝
- Timeout 統一處理（不讓 LLM 看到 raw timeout error）

| 項目 | 說明 |
|------|------|
| 實作位置 | `src/server/index.mjs` — `invokeTool` wrapper |
| Retry 條件 | Network error / timeout / transient error |
| Fallback 定義 | 每個 plugin 可選宣告 `fallbackTool` |

#### 10.4 Context Budget 主動管理 ✅ (2026-06-11)

Server 端監控累積輸出大小，在 threshold 自動升壓縮層級，並注入 budget warning。

**作法**：
- `ContextBudget` 類別（`src/lib/context-budget.mjs`）追蹤累積輸出 + 呼叫次數
- `respond()` 每次輸出前呼叫 `decideCompression()`：
  - Critical (≤20%) → 強制 L2
  - Low (≤50%) → 強制 L1
  - Warning (≤70%) → 大輸出強制 L1
- budget status 注入輸出尾部供 LLM 參考
- `smart_context({command:"budget"})` 可查即時 budget
- **Tests**: 17 tests（tracking/compression decisions/status/singleton）

| 項目 | 說明 |
|------|------|
| 實作位置 | `src/lib/context-budget.mjs` + `src/server/index.mjs` respond() |
| 累積計算 | 追蹤 respond() 總輸出 bytes |
| 限制 | Server 只能控制自身輸出，client side context 由 OpenCode 管理 |

---

### 越用好（Learning）

#### 10.5 Auto Memory Injection

目前 `memory_store` 是被動的 — LLM 要主動「記得去查」才行。
改為：session 啟動（或新 task 開始）時，Server 自動查詢相關記憶並注入 context。

**作法**：
- `smart_memory_search` 在 session init / tool call 時自動觸發
- 依 `keyword extraction from user query` → 找相關 `finding` / `skill_patch`
- 注入到初始 context 中（不增加 LLM 負擔，content 可見）

| 項目 | 說明 |
|------|------|
| 觸發時機 | Session init + 每次 user query 到來時 |
| 注入量 | 限制 3-5 條，每條 < 200 chars（不爆 budget） |
| 來源 | `memory_store` 的 findings + skill_patches |

#### 10.6 Skill-level Learning（從 Phase 7 移入）

> ✅ 已在 Phase 7 實作（memory_store type:skill_patch + autoExtractSkillPatches）。
> 移到 Phase 10 是因為它屬於「越用越好」，不是「推理品質」。
> 維持現有實作，不需變動。

#### 10.7 Benchmark 套件

> ✅ 已在 Phase 7 實作初步結構（phase7-benchmark.test.mjs + benchmarks/phase7-benchmark.sh）。
> 移到 Phase 10，後續擴充為完整 agent 評測。

**擴充方向**：
- 新增真實 CRUD 場景（改 1 檔案 / 跨 3 檔案重構 / 找 bug 修復 / API 串接）
- 每次 release 前自動跑 benchmark → 分數有感的提升/下降
- Aider-style polyglot benchmark 為長期目標

#### 10.8 Memory Lifecycle Management ✅ (2026-06-11)

> 記憶體自動生命週期管理。解決「已解決的 bug fix 永久佔據記憶體」的核心問題。
> 三層架構：auto-cleanup → decay/archive → TTL/keep override。

##### 核心問題

`memory_store` 目前是 write-once, manual-delete 模型。Bug fix 記錄存入後永不自動清除，
即使 fix 已套用、測試全過，entry 仍永久佔據搜尋結果。缺乏任何生命週期管理。

##### 三層架構

```
Layer 1 ─ Auto-cleanup Stale Bug Fixes
  ├─ 條件：entry.filesChanged[] 所有檔案 mtime > entry.timestamp
  ├─ 例外：confirmedAt 不為空 / keep=always / success=false
  └─ 行為：自動 delete，下次搜尋時顯示 "♻ Lifecycle: N stale fix(es) cleaned."

Layer 2 ─ Hit Count Decay + Auto-archive
  ├─ 衰減：hitCount ≤ 2 且 lastSeen > 30 天 → 每 30 天 ×0.5
  ├─ 歸檔：hitCount < 1 且 lastSeen > 90 天 → status:"archived"
  ├─ 搜尋/列表預設排除 archived（--include-archived 可恢復）
  └─ 顯示：📦 標記

Layer 3 ─ TTL Expiration + Keep Override
  ├─ --ttl 7d/30d/1h → expiresAt 自動設定，過期後自動清除
  ├─ --keep always → 永不自動清除
  └─ 顯示：⏳ 標記（temporary）
```

##### 實作

| 元件 | 說明 |
|------|------|
| `runLifecycle()` | 核心生命週期函數，合併三層邏輯（`src/cli/memory-store.mjs`） |
| `parseTTL()` | TTL 字串解析（支援 d/h/m 單位） |
| `cmdStore` | 新增 `--ttl` / `--keep` 參數，lifecycle 整合 |
| `cmdSearch` | 預設排除 archived，lifecycle 整合 |
| `cmdList` | 預設排除 archived，`--include-archived` 恢復 |
| `cmdStats` | 新增 `archivedCount` / `temporaryCount` |
| Plugin schema | `memory_store.mjs` 新增 `ttl`/`keep`/`includeArchived` |
| Mappers | `workflow.mjs` + `compose-engine.mjs` 傳遞新參數 |

##### 與既有系統關係

| 既有功能 | 關係 |
|---------|------|
| Auto Memory Injection (10.5) | Lifecycle 確保注入的記憶是最新的（stale entries 已清除） |
| Skill-level Learning (10.6) | skill_patch 不受 lifecycle 影響（無 filesChanged，keep 預設 always） |
| Error Recovery (10.3) | 錯誤記錄有 filesChanged → 修復後自動清除，不污染記憶 |

##### 不上什麼

| 項目 | 原因 |
|------|------|
| 自動 confirmedAt 標記 | 需要 LLM 判斷「修復是否成功」，不可靠 |
| 跨 session 的 hitCount 衰減 | 已透過 lastSeen 時間差計算，不需跨 session 狀態 |
| 記憶體自動合併（dedup） | 不同於 wiki-dedup，記憶體 entry 是獨立事件，合併會丟失 context |

---

### 優先級

| 優先 | 項目 | 類別 | 難度 | 時間 | 相依 |
|------|------|------|------|------|------|
| 🥇 | Error Recovery (10.3) | 持續用 | 🟢 低 | 1-2 天 | 無 |
| 🥇 | Benchmark 擴充 (10.7) | 越用好 | 🟢 低 | 1-2 天 | 無 |
| 🥇 | Impact Warning (10.2) | 放心用 | 🟢 ✅ 已實作 | — | code_impact 已存在 |
| 🥇 | Sandbox Execution (10.1) | 放心用 | 🟡 中 | 3-5 天 | 無 |
| 🥇 | Auto Memory Injection (10.5) | 越用好 | 🟡 中 | 3-5 天 | memory_store 已存在 |
| 🥈 | Context Budget (10.4) | 持續用 | 🟢 ✅ 已實作 | — | output-optimizer 已存在 |
| 🥈 | Skill-level Learning (10.6) | 越用好 | 🟢 已完成 | — | 從 Phase 7 搬入 |
| 🥈 | Memory Lifecycle (10.8) | 越用好 | 🟢 ✅ 已實作 (2026-06-11) | — | memory_store 已存在 |
| 🟡 | LSP Startup 降級指引 (#10) | 持續用 | 🟢 ✅ 已實作 (2026-06-11) | — | smart_lsp 已存在 |

### 不上什麼

| 項目 | 原因 |
|------|------|
| **Diff Preview 機制** | Client UI 責任，Smart MCP 提供 smart_diff tool 即可 |
| **Session Continuity 框架** | 太模糊，被 Auto Memory Injection (10.5) 涵蓋 |
| **全自動 agent loop** | 這是 OpenCode 的責任，Smart MCP 是工具層 |
| **多模態/視覺理解** | Provider 層次，MCP 無法控制 |

---

## Phase 11：記憶系統升級 — Semantic Memory Engine（已重新設計）

> 2026-06-11 規劃 → 2026-06-11 基於 SOTA 研究重新設計。
> **研究結論**：業界對「輕量記憶系統」已收斂到可複製的模式。
> Scope 不變：**只做 Phase 11.1 Semantic Embedding**。
> KG (11.2) 和 Consolidation (11.3) 維持擱置。

### 研究發現：業界 SOTA 模式

| 我的原始設計 | 業界 SOTA（agentmemory / sqlite-vec 等） | 改變 |
|-------------|-----------------------------------------|------|
| 自實作 TF-IDF | **SQLite FTS5 (BM25)** — 內建、零依賴、數學正確 | ✅ 改採 FTS5 |
| 應用層 cosine similarity (O(n)) | **sqlite-vec ANN** — SQLite extension，native KNN | ✅ 新增，有 fallback |
| 加權和 (0.7\*semantic + 0.3\*fuzzy) | **RRF** (Reciprocal Rank Fusion, k=60) — rank-based，無需正規化 | ✅ 改採 RRF |
| onnxruntime-node | **@huggingface/transformers** — 單一 npm install，ONNX-based | ✅ 改採 |
| 單一 BM25 | **Triple-stream recall** — BM25 + Vector + KG（未來） | ✅ 架構預留 |
| JSON file | **SQLite 單 DB** — FTS5 + vec0 + entries 在同一檔案 | ✅ 合併 |

#### 關鍵 benchmark（agentmemory 數據）

| Query 難度 | 純 BM25 recall@10 | BM25 + Vector (RRF) | 改善 |
|-----------|-------------------|--------------------|:----:|
| 最簡單 | 77.8% | **91.7%** | +13.9pp |
| 最難 | 0.0% | **40.0%** | +40pp |
| **整體** | 58.7% | **67.3%** | **+8.6pp** |

- **結論**：對自然語言 query（無 keyword overlap），vector recall > BM25。RRF 融合後兩者兼具。
- 對 Smart MCP 真實場景：error message 搜尋 BM25 就夠好。但 Auto Memory Injection、skill_patch 搜尋是自然語言 → 需要 vector。

### 新做法

#### 技術架構

```
                    ┌──────────────────────┐
                    │   @huggingface/       │
                    │   transformers        │
                    │   (all-MiniLM-L6-v2)  │
                    └───────┬──────────────┘
                            │ 384-dim embedding
                            ▼
┌─────────────────────────────────────────────┐
│              memory.db (SQLite)              │
│                                              │
│  entries: id, hash, type, error_message,     │
│           resolution, hit_count, ...         │
│  entries_fts: FTS5 full-text index (BM25)    │
│  entries_vec: sqlite-vec vec0 (float32[384]) │
└──────────────┬──────────────────────────────┘
               │
               ▼
          RRF Fusion (k=60)
          BM25 rank + Vector rank + (future) KG rank
               │
               ▼
          Unified search results
```

#### 儲存層：SQLite + FTS5 + sqlite-vec

```
memory.db（單一檔案，三重索引）：

  entries (
    id TEXT PRIMARY KEY,
    hash TEXT UNIQUE,
    type TEXT, category TEXT, status TEXT,
    error_message TEXT, resolution TEXT,
    behavior_change TEXT, target_skill TEXT,
    tools_used TEXT, files_changed TEXT,
    success INTEGER, hit_count INTEGER DEFAULT 1,
    keep TEXT, expires_at TEXT, confirmed_at TEXT,
    created_at TEXT, last_seen TEXT,
    -- 不自帶 embedding BLOB（sqlite-vec 的 vec0 管理）
    -- FTS5 和 vec0 在各自的 virtual table 中
  )

  -- FTS5 for BM25 search
  CREATE VIRTUAL TABLE entries_fts USING fts5(
    error_message, resolution, behavior_change,
    content='entries', content_rowid='rowid'
  );

  -- sqlite-vec vec0 for ANN (approximate nearest neighbor)
  -- 384-dim float32 vectors, 自動內部存儲
  CREATE VIRTUAL TABLE entries_vec USING vec0(
    embedding float[384] distance_metric=cosine
  );
```

**sqlite-vec vs 應用層 cosine 的取捨**：

| 層面 | sqlite-vec（主路徑） | 應用層 cosine（備援） |
|------|-------------------|--------------------|
| 依賴 | Native C extension (npm install sqlite-vec) | 純 JS，無 native dep |
| 效能 | O(log n) ANN via IVF | O(n) 全掃 (n < 10K 可接受) |
| 安裝 | +1 npm dep，需 compile native addon | 無 |
| 精確度 | ANN (approximate) | 精確 cosine |

**決策**：主路徑 sqlite-vec。若 native compile 失敗 → 自動降級應用層 cosine（embedding 存 BLOB）。

#### 搜尋流程：三重串流 + RRF

```
query "找出之前那個 memory leak 的解法"
    │
    ├─ Stream 1: FTS5 BM25 ──────→ rank_1
    │    SELECT rank FROM entries_fts WHERE entries_fts MATCH ?
    │
    ├─ Stream 2: Vector ANN ─────→ rank_2
    │    embed(query) → SELECT rowid, distance FROM entries_vec WHERE embedding MATCH ?
    │    (sqlite-vec 自動 ANN，或應用層 cosine)
    │
    └─ Stream 3: KG (future) ────→ rank_3 (shelved)
    
    │
    ▼
RRF(k=60):
  score(id) = Σ( 1 / (k + rank_s(id)) ) for each stream s
  └── rank-based, 不需 score 正規化, 各 stream 權重自然平衡
    
    │
    ▼
Unified results (score desc)
```

**降級路徑**：
```
@huggingface/transformers 載入失敗 → embeddings disabled
  └── sqlite-vec not available → application cosine on BLOB
    └── FTS5 不存在 → LIKE fallback (Phase 5 style)
```

**無縫降級**：任何一層失敗不 crash，靜默走下一層。

### 交付狀態

| 項目 | 狀態 | 工時 | 說明 |
|------|------|:----:|------|
| 安裝依賴：better-sqlite3 + sqlite-vec + @huggingface/transformers | ✅ | 0.5 天 | 3 個 npm install，verified native compile |
| memory-db.mjs：SQLite 層（schema + FTS5 + vec0 + CRUD + 遷移 + RRF） | ✅ | 2 天 | 784 行，21/21 tests，含 migrateFromJSON |
| embedding.mjs 升級：@huggingface/transformers Layer 2 | ✅ | 1 天 | 三層降級架構：TF-IDF → transformers → hybrid |
| memory-store.mjs CLI → SQLite 後端 (--db flag) | ✅ | 1 天 | 8 命令 SQLite 實作，FTS5 BM25 取代 fuzzy，JSON 向後相容 |
| compaction-fix.js 策略修正 | ✅ | 0.5 天 | 不再依賴 messages.transform（compaction 後不觸發），改嵌入 compacting context |
| 搜尋升級：BM25 + Vector + RRF fusion 整合 CLI | ✅ | — | main() async + await cmdSearchDB 呼叫 db.searchHybrid()（RRF fusion 含 vector ANN） |
| Auto-embedding on store (async) | ✅ | — | cmdStoreDB async，await tryLoadSentenceModel + getSentenceEmbedding 確保 embedding 寫入 |
| **總計** | **~100%** | **~5.5 天** | 全部 Phase 11 項目完成 |

### 不上什麼（維持）

| 項目 | 原因 |
|------|------|
| Phase 11.2 Knowledge Graph | LLM 不會主動查圖，ROI 低 |
| Phase 11.3 Consolidation/Clustering | entry 數量 < 5000，不值得 |
| 外部分數資料庫（Milvus/Chroma） | sqlite-vec 已足夠，不可增加外部依賴 |
| 自動 LLM embedding（用 LLM 當 embedder） | @huggingface/transformers 更快、離線、免費 |
| 多語言模型（intfloat/multilingual-e5） | Smart MCP 以英文為主，中文 error message 用 BM25 就夠 |

### 與既有系統關係

| 既有功能 | 關係 |
|---------|------|
| Auto Memory Injection (10.5) | 注入品質因 semantic search 提升（自然語言 query 更準） |
| Skill-level Learning (10.6) | skill_patch 搜尋從 keyword BM25 → semantic RRF（8.6pp recall 提升） |
| Memory Lifecycle (10.8) | 不變，SQLite 版本維持相同 lifecycle 邏輯 |
| Document Registry (Phase 4b) | 使用 node:sqlite，memory-db.mjs 使用 better-sqlite3 — 兩者獨立，無衝突 |

---

## Phase 12：跨機器知識延續 — Auto-Seed ✅ (2026-06-11)

**問題**：`~/.smart/memory/memory.db` 是本機 SQLite，不在 git 中。新 clone 的專案缺少 Layer 2 保護（`keep=always` 的 skill_patch）。

**解法**：`config/seed-memory.json` + `openDB()` 自動匯入。

### 設計

```
新機器第一次跑 --db
  → memory.db 不存在（或空的）
  → openDB() 偵測 db.countEntries() === 0
  → 檢查 config/seed-memory.json 存在
  → 有 → migrateFromJSON() 匯入（INSERT OR IGNORE，hash dedup）
  → 輸出 "📚 Seeded N knowledge entry/ies"
```

### 防呆

- **不重複**：`INSERT OR IGNORE` + hash 比對，只會 seed 一次
- **非破壞**：只寫入空的 DB。已有資料的 DB 完全不受影響
- **可擴充**：seed 陣列可持續累積新 skill_patch，新安裝一次補齊

### 交付

| 項目 | 狀態 | 說明 |
|------|------|------|
| `config/seed-memory.json` | ✅ | 初始含 1 筆 LSP timeout skill_patch（keep=always） |
| `openDB()` auto-seed | ✅ | 空 DB 自動匯入 + 訊息提示 |
| 保護層級 | **Layer 1** `config/agents/smart-mcp.md`（git）→ **Layer 2** memory keep=always（seed）→ 雙重保險 |

---

## Phase 13：專案穩固 & 可發布性強化 ✅ (2026-06-12)

### 動機

```
Phase 11 (Semantic Memory) ──→ Phase 12 (Cross-machine) ──→ Phase 13 (Polish)
    核心功能完成              跨機器可用               可發布、可測試、可維護
```

Phase 11 和 12 建立了強大的記憶與 embedding 基礎，但：
- 核心 module `embedding.mjs`、`apply-engine.mjs` 完全沒有專屬測試
- CLI 無法 `npm link` / `npx` 使用（缺 `bin` entry）
- 測試覆蓋率缺口是 tech debt 的主要來源

### 目標

1. **補測試缺口** — 優先測試近期修改的 module（embedding）和風險最高的 module（apply-engine）
2. **CLI 可發布** — `package.json` 加 `bin` + 驗證 `npm link` 工作
3. **建立測試 culture** — 新 module 或重大修改附帶測試為門檻

### 測試優先順序

| 優先 | Module | 行數 | 理由 |
|------|--------|------|------|
| 🥇 | `embedding.mjs` | 329 | 最近被 CLI async 改造影響，vectorizer + hybridSearch + sentence bridge |
| 🥇 | `apply-engine.mjs` | 1303 | 最大檔，patch 套用核心邏輯，無任何測試 |
| 🥈 | `memory-db.mjs` | 784 | SQLite/sqlite-vec 整合，現有 21 測試靠 CLI 間接驗證 |
| 🥉 | `cache-manager.mjs` | 387 | 快取邏輯 |
| 🥉 | `compose-engine.mjs` | 264 | 組合引擎 |
| 🥉 | `refactor-planner.mjs` | 280 | 重構規劃 |
| 🥉 | `safe-handler.mjs` | 124 | 安全處理 |
| 🥉 | `utils.mjs` | 164 | 共用工具 |

### 成果

| 項目 | 數字 |
|------|------|
| 新增測試檔案 | **8**（embedding, apply-engine, utils, safe-handler, compose-engine, refactor-planner, cache-manager, memory-db） |
| 新增測試數 | **197**（30 + 49 + 24 + 17 + 11 + 19 + 19 + 28） |
| 總測試數 | **985**（↑ 25% from 788） |
| 回歸 | **0**（所有舊測試維持綠燈） |
| CLI 發布 | `smart-memory` via `npm link` / `npx` 可用 |
| Bug fix | `compose-engine.mjs` cond branch iterable 修復 |

### 學習

- `embedding.mjs` 的 `STOP_WORDS` 不包含 "and" — 這是設計取捨（常見但保留以涵蓋搜尋意圖），非 bug
- IEEE 754 浮點運算 → cosineSimilarity 測試用 `Math.abs(x - 1) < 1e-10` 取代 `assert.equal(x, 1.0)`
- 單字元 token 被 `t.length > 1` 過濾 → corpus 測試資料用 ≥2 字母詞避免誤判

---

## Phase 14：取代 OpenCode Compaction — Smart MCP 智慧壓縮層

> 2026-06-12 基於 Anthropic 官方 2026 上下文處理研究 + OpenCode 現有 compaction 機制分析。
>
> **關鍵洞察**：OpenCode 原生 compaction 是**無差別壓縮** — 把所有對話內容平等送進 LLM 摘要。
> Smart MCP 身為工具層，知道每個 tool output 的語義，可以做得更聰明。
>
> **取代策略**：三層架構，從被動壓縮變主動管理。

### 現狀分析

```
OpenCode 現有機制：

opencode.json { compaction: { auto: true, prune: true, reserved: 20000 } }
  └─ 對話變長 → 全部送 LLM → 平等壓縮 → auto-continue
  └─ 沒有工具感知，grep/test/security/think 全部一樣對待

compaction-fix.js plugin（5 hooks）：
  ├─ event                          → 追蹤 todo + compaction 事件
  ├─ chat.message                   → 追蹤使用者目標
  ├─ experimental.session.compacting → compaction 前注入 TODO/goal 到 prompt
  ├─ experimental.compaction.autocontinue → 確保 auto-continue 啟用
  └─ experimental.chat.messages.transform → 把 "continue" 換成恢復指令

問題：compaction-fix.js 是繞著 compaction 機制打補丁，無法讓 compaction 本身變聰明。
```

### 三層取代策略

```
取代前 (OpenCode 原生)：
  對話增長 → 全部送 LLM → 平等壓縮 → continue（30-50% token 節省）

取代後 (Smart MCP 主導)：
  Layer 1: Proactive Cleanup ── 先清掉可丟的 tool results
  Layer 2: Smart Compact ────── 工具感知的結構化壓縮 🆕
  Layer 3: API Compaction ───── 最後防線，Anthropic server-side
                              （60-80% token 節省）
```

---

### Layer 1：Proactive Cleanup（14.1）

**現狀**：長 session 中工具輸出堆積不減。沒有機制清理舊的 tool result。

**作法**：新增 `smart_context` 指令，在 compaction 觸發「之前」先清理：

```
smart_context({command:"clear_tool_results", olderThan:5, keepLatest:3})
  → 清除第 5 輪之前的 tool results
  → 保留最近 3 輪的結果（避免中斷上下文）
  → 不影響 user/assistant messages
  → 回傳 { removed: 12, kept: 3 }
```

**實作位置**：
| 檔案 | 修改內容 |
|------|---------|
| `src/lib/context-manager.mjs` | 新增 `clearToolResults({olderThan, keepLatest})` 方法 |
| `src/server/index.mjs` | `smart_context` handler 中新增指令路由 |

**安全機制**：
- 不清除 system prompt
- 不清除最近 N 輪（受 `keepLatest` 保護）
- 不清除 thinking blocks（API 自動管理）

**整合 compaction-fix.js**：`onCompacting` hook 在 compaction 前自動呼叫 clear_tool_results：
```
compaction 觸發
  → onCompacting hook
    → smart_context({command:"clear_tool_results", keepLatest:3})
    → 釋放 30-60% tool result token
  → 剩下的內容才進 compaction
  → compaction 頻率降低一半
```

---

### Layer 2：Smart Compact Tool（14.2）🆕

**核心取代策略**。新增 `smart_compact` MCP tool，作為 compaction 的智慧大腦：

```
compaction-fix.js
  │ 不再自己拼湊 recovery context
  │ 改呼叫 smart_compact
  ▼
Smart MCP
  │ 分析每筆 tool call 的語義：
  │   grep 結果 → 已用在後續編輯？→ DROP
  │   security 掃描 → 高風險已修？→ KEEP SUMMARY, DROP RAW
  │   deep_think → 保留結論，DROP 推理鏈
  │   LSP hover → 已用於編輯？→ DROP
  │   test 輸出 → 全過？→ KEEP SUMMARY, DROP RAW
  │   error_diagnose → 保留 root cause + fix
  ▼
  回傳結構化壓縮計畫：
  {
    "toolCallsToDrop": ["grep_3", "test_2", ...],      // 可直接刪除的整筆 tool call
    "toolOutputsToSummarize": {                          // 需摘要的
      "security_4": "3 high risks, 2 fixed, 1 mitigated",
      "deep_think_2": "Root cause: null pointer in parser.parse()"
    },
    "conversationSummary": "Debugging session: ...",     // 對話層摘要（OpenCode 原本做的）
    "recoveryContext": {                                  // 恢復上下文
      "goal": "Fix crash in parser",
      "todos": [{"status":"in_progress", "content":"..."}],
      "keyFindings": ["Null pointer at line 42"],
      "openQuestions": ["Why does input X trigger this?"]
    },
    "estimatedTokensSaved": 35000,
    "estimatedTokensRemaining": 15000
  }
```

**設計**：

| 層面 | 作法 |
|------|------|
| Plugin 位置 | `src/plugins/core/compact.mjs`，handler-based |
| 輸入 | `{ toolHistory, conversationLength, currentGoal?, currentTodos? }` |
| 輸出 | 結構化壓縮計畫（見上方） |
| 分析邏輯 | 不需要 LLM call — 規則 based 判斷各 tool type 的處置方式 |
| 安全性 | 不碰 user messages、不碰 system prompt、不碰 thinking blocks |
| 向後相容 | compaction-fix.js 可逐步採用：先加 call，再取代自製注入 |

**各工具類型的壓縮規則**：

| 工具類型 | 預設處置 | 條件 |
|---------|---------|------|
| `smart_grep` | DROP（匹配行已存於後續 context） | 除非是最後 2 輪內 |
| `smart_lsp` (hover) | DROP（型別資訊已用於編輯） | 除非是最後 1 輪 |
| `smart_lsp` (definition) | DROP | 除非是最後 1 輪 |
| `smart_lsp` (diagnostics) | KEEP SUMMARY（錯誤數 + 類型） | — |
| `smart_test` | KEEP SUMMARY（pass/fail 統計 + 失敗訊息） | 全部 pass → 更簡短 |
| `smart_security` | KEEP SUMMARY（高/中/低風險數 + 關鍵發現） | — |
| `smart_deep_think` | KEEP SUMMARY（結論 + 關鍵論證） | — |
| `smart_think` | KEEP SUMMARY（結論） | beam mode 保留 selectedBeam |
| `ssr(error_diagnose)` | KEEP（root cause + fix） | 完整保留，不壓縮 |
| `ssr(fast_apply)` | KEEP（改變了哪些檔案） | 保留檔案列表 |
| `ssr(import_graph)` | DROP（圖已 merge 到 context） | 除非是最後 2 輪 |
| `ssr(code_impact)` | KEEP SUMMARY（受影響檔案數 + 風險） | — |
| `smart_grep` (file search) | DROP | 總是 safe |
| Unknown tool | KEEP（保守 — 不認識就不壓） | — |

---

### Layer 3：API Server-Side Compaction（14.3）

最後一道防線。如果 Layer 1+2 還是不夠：

```
anthropic-beta: server-side-compaction-2026-02-15
```

**作法**：
1. 驗證 zen-claude-proxy 是否傳遞 `anthropic-beta` headers
2. 若支援 → `smart_context({command:"enable_compaction"})` 切換
3. 若不支援 → 記錄為已知限制

**與 Phase 9 的關係**：
- Phase 9 拒絕的是「自己實作 compaction pipeline」（Server 端工程，與 opencode 重疊）
- Layer 3 是「啟用 API 內建 compaction」（API 參數層）— 兩者不衝突

---

### 14.4 Context Rot 預警

**問題**：Anthropic 反覆強調 context rot（token 數↑→準確度↓），但 Smart MCP 的 budget 輸出只有用量 %。

**作法**：在 budget 輸出附加 context rot 預警 + 具體行動建議：

```
📊 Context Budget: 72% used (28% remaining)
⚠️ 用量 > 70%，context rot 風險增加（準確度可能下降）
   建議：smart_context({command:"clear_tool_results"}) 或 smart_compact
```

**Threshold 設計**：

| 用量 | 層級 | 輸出訊息 |
|------|------|---------|
| < 50% | ✅ 正常 | 僅顯示用量 |
| 50-70% | ⚠️ 注意 | 加入一般提醒 |
| 70-90% | ⚠️ 建議清理 | 加入具體建議（clear_tool_results / smart_compact） |
| > 90% | 🔴 高風險 | 強烈建議清理或開新 session |

**實作修改**：
| 檔案 | 修改內容 |
|------|---------|
| `src/lib/context-budget.mjs` | `formatBudgetStatus()` 依 threshold 加入預警文字 |
| `src/server/index.mjs` | 確保預警文字在 respond() 時注入 |

---

### 14.5 Prompt Caching 驗證

**問題**：claude() 走 zen-claude-proxy，無法確認是否享受 prompt caching 的 90% 折扣。

**作法**：

| 步驟 | 內容 |
|------|------|
| 1 | 檢查 zen-claude-proxy 原始碼：是否傳遞 `cache_control` breakpoints |
| 2 | 測試 call：觀察 API response 是否有 `cache_creation_input_tokens` / `cache_read_input_tokens` |
| 3 | 若無 → 決定在 proxy 層或 Smart MCP 層加入 `cache_control` |
| 4 | 記錄結果到 `docs/prompt-caching-report.md` |

---

### 整合後完整流程

```
對話增長
  │
  ├─ 14.4 Context Budget 監控
  │   └─ > 70% → 自動建議清理
  │
  ├─ 14.1 Proactive Cleanup
  │   └─ compaction-fix.js onCompacting 時自動呼叫 clear_tool_results
  │   └─ 釋放 30-60% token
  │
  ├─ 仍超過 threshold？
  │   └─ 14.2 Smart Compact 🆕
  │   └─ compaction-fix.js 呼叫 smart_compact
  │   └─ 結構化壓縮計畫 → OpenCode 執行
  │
  └─ 還是不夠？
      └─ 14.3 API Server-Side Compaction
      └─ anthropic-beta header
```

### 與現有系統的關係

```
compaction-fix.js（現有）→ 增強為 Smart Compaction 的閘道器：
  ├─ onCompacting → 先呼叫 clear_tool_results（Layer 1）
  │               → 再呼叫 smart_compact 取得壓縮計畫（Layer 2）
  │               → 用 smart_compact 的 recoveryContext 取代自製注入
  ├─ messages.transform → 用 smart_compact 的 recoveryContext 取代自製恢復指令
  └─ 向後相容：沒有 smart_compact 時維持原行為

output-optimizer（現有 L0/L1/L2）→ 獨立運作，不受影響：
  └─ 壓縮單筆 tool output 的顯示大小
  └─ smart_compact 決定的是「哪些整筆 tool call 可以消失」

Context Budget（現有 Phase 10.4）→ 提供觸發時機：
  └─ budget threshold → 觸發 compaction
  └─ budget output → 加入 context rot 預警（14.4）
```

### 優先級

| 優先 | 項目 | 難度 | 估時 | 類型 |
|------|------|------|------|------|
| 🥇 | **14.2 Smart Compact Tool**（核心取代） | 🟡 中 | 2-3 天 | MCP Plugin |
| 🥇 | **14.1 Proactive Cleanup**（先決條件） | 🟡 中 | 1-2 天 | context-manager |
| 🥇 | **compaction-fix.js 整合**（閘道器升級） | 🟢 低 | 0.5 天 | Plugin |
| 🥈 | **14.4 Context Rot 預警** | 🟢 低 | 0.5 天 | Budget 增強 |
| 🥉 | **14.3 API Compaction 驗證** | 🟢 低 | 0.5 天 | 驗證 |
| 🥉 | **14.5 Prompt Caching 驗證** | 🟢 低 | 0.5 天 | 驗證 |

### 不上什麼

| 項目 | 原因 |
|------|------|
| 自己實作 conversation compaction pipeline | Phase 9 已決定 — opencode client 負責 |
| Thinking block clearing | Anthropic API 對 extended thinking 自動 strip |
| FIFO conversation management | OpenCode client 層責任 |
| 多 session context merge | 無明確使用場景 |
| 自建 prompt cache 基礎設施 | provider/API 層功能 |

---

## Phase 15：Auto-intercept 三路徑並存架構

> 2026-06-12 設計決策。基於路由（Phase 3）與執行管線（Phase 1-2）的營運經驗，提出工具呼叫的三路徑架構。

### 核心洞察：LLM 直接呼叫永不消失

現有架構中，所有工具呼叫均由 LLM 發起，經由 MCP protocol 到達 Smart MCP Server。LLM 對工具名稱、參數、時機的選擇完全自主 — 這是 **MCP 協議的本質**，不是 bug。

```
LLM ──tools/call──→ Smart MCP Server ──handler/cli──→ 結果
         ↑ 單一路徑，完全由 LLM 決策
```

這產生兩組矛盾需求：

| 矛盾 | LLM 自主 | 系統保護 |
|------|---------|---------|
| 工具選擇 | LLM 選正確工具 | 不確定時自動走 hybrid_router |
| 參數品質 | LLM 給正確參數 | 缺參數時自動補/提醒 |
| 安全防護 | LLM 知道風險 | Server 強制高風險前置檢查 |
| 執行時機 | LLM 決定何時執行 | 緊急情況自動觸發（如 security scan 發現漏洞） |

**解決方案不是取代 LLM 決策，而是在不干擾主路徑的前提下，提供智慧備援與保護網。**

### 三路徑架構

```
                     ┌──────────────────────────────────────────────────────┐
 路徑 A (主) ←────── │  LLM → tools/call → Server → handler → 結果         │ ← 永不消失
   LLM 直接呼叫       │  LLM 全權決定工具、參數、時機                         │
                     └──────────────────────────────────────────────────────┘
                                    ↑
                     ┌──────────────┴──────────────────────────────────────┐
 路徑 B (備用) ←─── │  LLM → smart_auto → Server 自動分析 → 推薦/執行      │ ← P1
   Smart Auto        │  LLM 說「幫我做 X」→ server 選工具、填參數、執行       │
                     │  適用：LLM 不確定用哪個工具、忘記參數格式               │
                     └──────────────────────────────────────────────────────┘
                                    ↑
                     ┌──────────────┴──────────────────────────────────────┐
 保護網 (可選) ←─── │  Interceptor Layer → 攔截 tools/call → 檢查 → 放行/    │ ← P2
   Interceptor       │  修正/阻擋                                              │
                     │  manifest 驅動，預設關閉（opt-in）                       │
                     │  適用：高安全環境、敏感檔案操作、合規場景                 │
                     └──────────────────────────────────────────────────────┘
```

#### 路徑 A：LLM 直接呼叫（主路徑）

- **狀態**：✅ 現有，永不消失
- **觸發**：LLM 直接發起 `tools/call`，指名道姓呼叫工具
- **Server 處理**：現有 invokeTool → handler/cli → captureAndReturn → respond
- **保護**：僅 HIGH_RISK_PREREQUISITES（Phase 7）強制前置檢查
- **定位**：在所有路徑中優先級最高，永不降級為備用

#### 路徑 B：Smart Auto（備用路由）

- **狀態**：📋 P1 — 需 manifest 基礎建設完成後實作
- **觸發**：LLM 呼叫 `smart_auto({goal: "描述任務"})`，不指定工具
- **Server 處理**：hybrid_router 分類 → 自動選工具 → 填入推定參數 → 執行 → 回傳
- **定位**：LLM 不確定工具名稱/參數時的救援路徑。不是取代，是互補

| 場景 | 路徑 A 問題 | 路徑 B 解法 |
|------|-----------|-----------|
| 「幫我掃這個專案的安全性」 | LLM 要記 `smart_security` 名稱 + 參數 | `smart_auto({goal:"掃安全性"})` 自動完成 |
| 「分析這段程式碼的錯誤」 | LLM 要自己選 grep/LSP/diagnose | `smart_auto({goal:"分析錯誤"})` 選最佳工具鏈 |
| 「把這份文件存到 wiki」 | LLM 要串 ingest → wiki-capture | `smart_auto({goal:"存到 wiki"})` 自動組合工作流 |

#### 保護網：Interceptor Layer（可選保護）

- **狀態**：📋 P2 — 預設關閉，manifest 驅動
- **觸發**：由 manifest 聲明的規則決定是否在 `tools/call` 路徑上插入攔截點
- **Server 處理**：攔截 tools/call → 比對 manifest 規則 → 放行 / 修正參數 / 阻擋
- **定位**：安全監護，不干擾正常開發流程

```
tools/call 到達
  ├─ manifest 無對應規則 → 放行（快速路徑，零開銷）
  ├─ manifest 規則通過 → 放行
  ├─ manifest 規則警告 → 修正參數 + 放行（附註說明）
  └─ manifest 規則禁止 → 阻擋 + 回傳原因 + 建議替代方案
                                                            ↑ 預設關閉，opt-in
```

### 設計原則

| 原則 | 說明 |
|------|------|
| **Path A 優先** | LLM 直接呼叫永不繞過。Interceptor 永遠可被 LLM 覆寫（override） |
| **Interceptor 預設關閉** | 不改變現有行為，不增加 LLM friction。opt-in 啟用 |
| **Manifest 驅動** | 攔截規則宣告在 manifest 檔案中，非 hardcode |
| **三路徑可並存** | 不是互斥選擇。同一 session 可混用三種路徑 |
| **降級不當機** | Interceptor 不可用 → 退回路徑 A（不 crash，不提示） |

### Priorities（從 P0 降為 P2）

| 優先級 | 內容 | 狀態 |
|--------|------|------|
| **P1** | Manifest 基礎建設 — 工具描述 schema + manifest 檔案格式 + loader 支援 | ✅ 已完成 (2026-06-12) |
| **P2** | Interceptor 保護網 — manifest-driven tools/call 攔截器 | 📋 規劃中 |
| **P2** | Smart Auto — `smart_auto` 備用路由工具 | 📋 規劃中 |

**降級理由**：Auto-intercept 從原始 P0 降為 P2 是因為：
1. 現有 HIGH_RISK_PREREQUISITES（Phase 7）已覆蓋最重要的安全防護場景
2. Interceptor 對現有架構無 immediate benefit（LLM 直接呼叫目前運作良好）
3. 先做 manifest 才有 infrastructure 做 interceptor — 不可跳過

### Manifest 基礎建設（P1）✅ (2026-06-12)

什麼是 manifest：**工具規格宣告檔**。描述工具的名稱、用途、參數、類別、安全等級、路由規則。

#### 交付摘要

| 交付項目 | 說明 | 檔案 |
|---------|------|------|
| Manifest JSON Schema | JSON Schema 定義 manifest.json 格式 | `config/tools/manifest.schema.json` |
| Manifest loader | 自動從 plugin 定義生成 manifest.json + 載入/驗證/查詢 API | `src/lib/manifest-loader.mjs` (210 行) |
| Loader 整合 | `src/server/loader.mjs` 載入 plugin 後自動生成 manifest | `src/server/loader.mjs` (+8 行) |
| Manifest 生成 CLI | 獨立 script 可手動重新生成 manifest | `src/cli/manifest-gen.mjs` |
| 自動推論 | safetyLevel (low/medium/high/critical) + domain (21 領域) + qualityGates | manifest-loader 內建 |
| Bug fix | `refactor-plan.mjs` 修正 `tool` → `name`（plugin contract） | `src/plugins/standard/refactor-plan.mjs` |
| 測試 | 34 tests（generate/validate/load/find/domain/autoRoute/integration） | `tests/manifest-loader.test.mjs` |

#### 實際 manifest.json 內容

```json
{
  "version": 1,
  "generatedAt": "2026-06-12T...",
  "tools": [
    {
      "name": "smart_compact",
      "category": "core",
      "domain": "context",
      "safetyLevel": "medium",
      "routingRules": { "autoRoute": false, "interceptorRequired": false, "directCall": true },
      "qualityGates": [],
      "responsePolicy": { "maxLevel": 0 }
    },
    // ... 61 tools total
  ],
  "autoRoute": { "enabled": true },
  "interceptor": { "enabled": false, "defaultAction": "allow" }
}
```

**統計**：61 tools（9 core + 52 standard），safety: low:17 / medium:36 / high:7 / critical:1，21 domains

#### 設計決策

| 決策 | 原因 |
|------|------|
| **自動生成，非手寫** | 61 個 tool 手寫 manifest 不可維護。loader 啟動時自動從 plugin 定義生成 |
| **推論 safetyLevel** | 從 tool name pattern 推論（grep→low, fast_apply→high, exec→critical），不需 plugin 改寫 |
| **推論 domain** | 21 個領域 pattern matching，覆蓋所有現有工具 |
| **qualityGates 從 HIGH_RISK_PREREQUISITES 同步** | 不重複定義，manifest 反映 server 端實際強制規則 |
| **interceptor 預設關閉** | 不改變現有行為，P2 時 opt-in |

### 不上什麼

| 項目 | 原因 |
|------|------|
| **Interceptor 自動啟用** | 預設關閉是設計 choice — 不改變現有行為，避免 LLM friction |
| **Path A 降級機制** | Path A 永不降級，永遠是 LLM 直接呼叫的主路徑 |
| **管理 UI** | CLI json 編輯即可，不需 web dashboard |
| **Interceptor 即時規則更新** | hardcode + reload 就夠，不需 runtime rule engine |
| **路徑 A/B/C 互斥** | 三路徑可並存，不是選擇題 |

### 與現有系統關係

| Phase | 關係 |
|-------|------|
| Phase 3 (Universal Task Router) | Path B smart_auto 依賴 hybrid_router 的分類能力；hybrid_router 作為 smart_auto 的底層引擎 |
| Phase 7 (Quality Gate) | HIGH_RISK_PREREQUISITES 是精簡版 interceptor（硬編碼規則 vs manifest 驅動）。兩者互補：Quality Gate 強制、Interceptor 可選 |
| Phase 1-2 (Output Pipeline) | Interceptor 不影響輸出管線，攔截後仍走現有 output-optimizer |
| loader.mjs | Manifest 基礎建設會擴充 loader 的 plugin 合約，現有 plugin 不須改寫 |

### 預期成效

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| LLM 工具呼叫失敗率 | 約 5-10%（名稱/參數錯誤） | 可經 smart_auto 降低至 <1% |
| 安全防護場景 | 僅 HIGH_RISK_PREREQUISITES 強制規則 | + opt-in manifest 驅動保護網 |
| 架構彈性 | 單一路徑（LLM 必須精確指名） | 三路徑並存（LLM 可選擇精準呼叫或模糊委派） |
| 新工具加入成本 | 需改 agent personality 路由規則 | manifest 宣告即可自動被 smart_auto 發現 |

---

## Phase 15：Deep Research Agent 整合 ✅ (2026-06-12)

> 基於 [CYC2002tommy/Deep-Research-Agent](https://github.com/CYC2002tommy/Deep-Research-Agent) (MIT) 的選擇性整合。
> 填補 Smart MCP 在「學術研究」垂直領域的三個關鍵缺口：同儕審查、學術文獻搜尋、DOI 驗證。

### 整合價值

| 缺口 | DRA 貢獻 | Smart MCP 現狀 |
|------|---------|---------------|
| 學術同儕審查 | Remi 10-point framework | 完全沒有 |
| 學術文獻搜尋 | OpenAlex/Crossref/Semantic Scholar 整合 | 只有通用 exa_search |
| DOI 驗證 | 自動 DOI liveness check | hallucination-check 無此能力 |

### 交付項目

#### Phase 15.1: academic-review.mjs
- Remi 10-point peer review plugin（Nature/Science 等級）
- 3 modes: `prompt`（審查提示）、`template`（填空模板）、`framework`（定義）
- 內建 banned AI vocabulary 檢測
- 同步新增 `peer_review` 為 smart_deep_think 第 10 個 template

#### Phase 15.2: academic-search.mjs
- 多來源學術文獻搜尋：OpenAlex、Crossref、Semantic Scholar、Unpaywall
- OpenAlex：全文搜尋 + MDPI 自動過濾 + abstract_inverted_index 解碼
- Crossref：metadata 搜尋 + 單一 DOI 解析
- Semantic Scholar：AI 驅動搜尋 + citation count + OA PDF 連結
- Unpaywall：OA 可用性檢查
- 全部免費 API，無需 API key

#### Phase 15.3: hallucination-check.mjs DOI 模式
- 新增 `mode: "doi"` — 自動提取文中所有 DOI
- 逐一透過 doi.org HEAD request 驗證 liveness
- 分類：alive / dead (404) / restricted (403) / error
- Dead DOI = 可能偽造的引用

#### Phase 15.4: deep-research skill
- 完整 7-phase 學術研究 pipeline（SKILL.md）
- 全部使用 Smart MCP 原生工具（academic_search → ingest_document → hallucination_check → academic_review → docx_generate）
- 同步至 `.opencode/skills/` 和 `config/skills/`
- 附參考文件：academic-api-patterns.md、python-docx-manipulation.md

#### Phase 15.5: docx-generate.mjs
- APA 7th 格式化 DOCX 生成（`docx` npm library）
- Times New Roman 12pt、double-spaced、hanging indent 參考文獻
- 支援：title、abstract、sections（含 heading hierarchy）、tables、references

#### Phase 15.6: obsidian-write.mjs + 生態整合
- Obsidian vault 寫入（自動偵測 vault 路徑）
- YAML frontmatter（title、date、tags、category）
- hybrid-engine DOMAIN_MAP 新增 `academic` 領域
- Agent personality 更新：4 個 direct-call tools + 3 個 sub-tools + 3 個 workflow patterns

### 不整合的部分

| 項目 | 原因 |
|------|------|
| CloakBrowser | Smart MCP 已有 playwright_mcp |
| Scopus MCP | 需 API key，非通用 |
| Google Science Skills | 需 API key |
| NotebookLM MCP | 需 Google auth |
| 直接依賴 DRA repo | 維護風險，改為提取核心邏輯內嵌 |

### 檔案清單

| 檔案 | 行數 | 說明 |
|------|------|------|
| `src/plugins/standard/academic-review.mjs` | 196 | Remi 10-point review plugin |
| `src/plugins/standard/academic-search.mjs` | 378 | Multi-source academic search |
| `src/plugins/standard/docx-generate.mjs` | 280 | APA 7th DOCX generation |
| `src/plugins/standard/obsidian-write.mjs` | 196 | Obsidian vault writer |
| `src/plugins/standard/hallucination-check.mjs` | +130 | DOI verification mode |
| `src/plugins/core/thinking.mjs` | +2 | peer_review template enum |
| `src/cli/thinking.mjs` | +12 | peer_review template definition |
| `src/lib/hybrid-engine.mjs` | +8 | academic domain in DOMAIN_MAP |
| `config/agents/smart-mcp.md` | +12 | Agent personality updates |
| `.opencode/skills/deep-research/SKILL.md` | 180 | 7-phase research pipeline |
| `config/skills/deep-research/SKILL.md` | 180 | Synced copy |
