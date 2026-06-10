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

## 一、核心問題

Smart MCP 已實作 4 項 token 優化手段，但零散未成體系：

| 已實作 | 省 token 估算 | 問題 |
|--------|-------------|------|
| Toonify（JSON/CSV/YAML 被動壓縮） | 30-65% | 只看 JSON-like 格式，fire-and-forget 非同步不影響當前回應 |
| Selective tool listing（8 visible / 45 routed） | ~70% tools list | 已完善 |
| Onion architecture（106 行 core + 8 skills） | ~97% system prompt | 已完善 |
| 4-tier model router（T1 $0 ~ T4 LLM） | ~60-86% API cost | 已完善 |

**核心缺口**：工具輸出內容本身沒有系統性的壓縮策略。

---

## 二、設計哲學：分層擔責 + 透明告知 + 按需取回

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

## 三、壓縮層級定義

| 層級 | 名稱 | 作法 | 資訊損失 | 適用 |
|------|------|------|---------|------|
| L0 | Raw | 不處理，直接 passthrough | 無 | 小輸出 <10KB |
| L1 | Lossless Compress | 縮短 key、壓縮空白、格式正規化 | **無**（所有 value 保留） | 結構化資料 10-50KB |
| L2 | Smart Summary | 保留 critical section，壓縮/略過次要 section | 有選擇性損失 | 大輸出 50KB+ |
| L3 | Truncated | **不使用** — 改用互動式 format:full | — | 取消，改按需取回 |

---

## 四、Response Policy 機制

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

## 五、調適後的壓縮 Response 格式

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

## 六、Agent 行為規範

Agent personality 中明確定義：

```
當工具回傳 _optimized.level >= 2 時：
  1. 先判斷摘要資訊是否足夠回答使用者問題
  2. 如果不夠 → 用相同參數 + format:'full' 取回完整版
  3. 如果使用者要求「找出全部」「分析所有」「比對差異」
     → 無論如何必須取回完整版
```

---

## 七、實作路線

### Phase 1：核心架構（目前）

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

### Phase 2：Smart Output Pipeline（Phase 1 後）

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

## 八、預期成效

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

## 十、Phase 3：Universal Task Router（LLM 路由減壓）

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

> 2026-06-08 規劃。Phase 4b 只能搜 metadata（title/path/summary），Phase 5 讓你搜**內容**。

### 動機

Phase 4b 的 document registry 追蹤「看過哪些文件」，但無法回答「在哪份文件的哪個段落提到 X」。使用者需要的是：
- 「上週看的那份 ONFI spec，提到 timing constraints 的段落在哪？」
- 「那份合約裡關於賠償條款怎麼寫的？」
- 「記得 Q&A 表裡有討論 bridge mode issue，細節是什麼？」

這些全是 **全文內容搜尋**，不是 metadata 搜尋。

### 架構

```
Ingest 流程（修改 ingest-document plugin）：
  File → ingestDocument() → registry.register(metadata)
                           → registry.storeContent(path, 前4000chars)

搜尋流程（新工具 smart_search_docs）：
  query → registry.searchContent(query)
    → SELECT * FROM documents WHERE content LIKE '%q1%' AND content LIKE '%q2%'
    → 回傳：檔案路徑 + 格式 + 內容片段（含 match 前後文）

儲存：
  重用 ~/.smart/cache/documents.db，新增 content TEXT 欄位
  不引入 FTS5（Node 26 node:sqlite 不支援 extension loading）
  LIKE '%query%' 對單開發者 local 工具（數百份文件內）效能足夠
```

### 為何不選其他方向

| 候選方向 | 不選原因 |
|---------|---------|
| Code+Doc 交叉比對 | 依賴 CKG 複雜基礎設施，Phase 6 再評估 |
| 自主工作流引擎 | Phase 3 已拒絕（auto-execution），LLM 已能勝任 |
| 文件變更追蹤 | 使用頻率太低，不配 Phase 編號 |
| 文件→Wiki 橋接 | LLM 已能組合 ingest_document → wiki-capture 完成 |

### 不上什麼

- 不引入 FTS5 或 elasticsearch — LIKE 搜尋就夠用
- 不存全文 — 只存前 4000 chars 做搜尋，完整內容用 smart_ingest_document 讀取
- 不做 ranking/scoring — 簡單按 updated_at 排序
- 不做中文分詞 — 單字匹配就夠

### 成效預估

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| 文件搜尋範圍 | 只有 title/path/summary | 文件**內容**也可搜 |
| 找到目標時間 | 要記得文件名稱或摘要 | 忘記文件名也沒關係，搜內容即可 |
| 跨 session 可用性 | 知道看過但找不到內容 | 直接跳到相關段落 |
| 新工具數 | 0 | 1 (`smart_search_docs`) |

---

## Phase 6：LLM 增強技術研究缺口

> 2026-06-10 研究補充。基於 web search 調查 2025-2026 年 LLM augmentation 技術，
> 盤點 Smart MCP 尚未實作但具備潛力的 12 項方法。
> 對應 todo.md Phase 6。

### 核心發現

Smart MCP 目前的增強策略集中在「工具層」（54 個 MCP tool）+「知識層」（洋蔥 skill）
+「記憶層」（memory_store）。以下 12 項是業界已驗證但專案尚未觸及的領域。

---

### 🥇 Tier 1：高 CP 值，建議優先實作

#### 1. Context Caching（KV Cache 重複利用）

| 層面 | 說明 |
|------|------|
| **問題** | 每次工具呼叫都從頭計算完整 prompt，system prompt + skill 內容重複浪費 |
| **業界做法** | Anthropic Prompt Caching（cached tokens 90% off）、OpenAI 自動 caching（50% off） |
| **實作方式** | Agent personality 指定 cache_control breakpoints；Provider 層即生效，agent 端 awareness |
| **效益** | 工具呼叫的 system prompt 可 cached，節省 50-90% token 成本 |
| **難度** | 🟢 低 — provider 原生支援，只需配置 |

#### 2. Prompt Compression（輸入壓縮）

| 層面 | 說明 |
|------|------|
| **問題** | 工具回傳的大輸出直接餵給 LLM，冗餘 token 浪費 + lost-in-the-middle 效應 |
| **業界做法** | LLMLingua-2（10x 壓縮準確率幾乎不降）、Selective Context、RECOMP |
| **實作方式** | 新增 `compress_prompt` tool，在傳給 LLM 前自動壓縮冗餘檢索文件/歷史紀錄 |
| **效益** | 省 50-80% token + 減輕 lost-in-the-middle 提升準確率 |
| **難度** | 🟡 中 — 需整合 LLMLingua 或自實 lightweight compressor |

#### 3. Hallucination Detection（輸出真實性檢查）

| 層面 | 說明 |
|------|------|
| **問題** | LLM 可能編造事實、錯誤歸因、離題，但 Smart MCP 完全不檢查就回傳 |
| **業界做法** | Faithfulness judge / Groundedness score / Consistency check / Context adherence |
| **實作方式** | 新增 `hallucination_check` tool，回應前用 LLM-as-Judge 自我驗證 |
| **效益** | 輸出可靠度大幅提升，達到生產級門檻 |
| **難度** | 🟡 中 — 需定義評分 prompt + 判斷閾值 |

#### 4. Guardrails（輸出安全閘）

| 層面 | 說明 |
|------|------|
| **問題** | 目前「行為閘」在 agent prompt 層，LLM 輸出無過濾直接回使用者 |
| **業界做法** | Constitutional AI、NVIDIA NeMo Guardrails、Guardrails AI |
| **實作方式** | 新增 `guardrail` tool，設定「永遠不執行 X」「永遠引用來源」等規則 |
| **效益** | 安全合規、防止 prompt injection 繞過 |
| **難度** | 🟢 低 — 規則式過濾即可開始 |

#### 5. Agent Observability / Tracing（可觀測性）

| 層面 | 說明 |
|------|------|
| **問題** | `smart_context` 只記錄工具呼叫清單，無標準化 span/trace，debug 困難 |
| **業界做法** | Arize Phoenix、LangFuse、Traceloop；基於 OpenTelemetry 的 span + trace + eval |
| **實作方式** | 新增 `trace` tool，匯出 OTel 相容格式 + 可視化 agent 決策路徑 |
| **效益** | 開發者 debug agent 行為效率提升 |
| **難度** | 🟡 中 — 需設計 span 模型 + 匯出格式 |

---

### 🥈 Tier 2：高價值但實作成本較高

#### 6. Multi-Agent Debate（多 Agent 辯論）

| 層面 | 說明 |
|------|------|
| **問題** | 單一 LLM 做所有推理，無校驗機制 |
| **業界做法** | MAD 框架：多個 LLM 角色互相辯論收斂出最佳答案；iMAD（2025）選擇性觸發，token 省 92% |
| **實作方式** | 新增 `debate` tool，高風險決策（安全修復、重構方案）啟用多 Agent 辯論 |
| **效益** | 複雜推理準確率 +13.5% |
| **難度** | 🟠 高 — 需多 LLM 呼叫 + 共識機制 |

#### 7. DSPy Prompt Optimization（提示詞自動優化）

| 層面 | 說明 |
|------|------|
| **問題** | 所有 skill 的 system prompt 人工撰寫，無法自動改善 |
| **業界做法** | DSPy 框架：定義 Signature + metric → compiler 自動找最佳 prompt + few-shot |
| **實作方式** | 對每個 skill 建立 eval dataset + metric，離線跑 optimizer |
| **效益** | 手寫 prompt 54% → 自動優化 90%；跨模型可移植 |
| **難度** | 🟡 中 — 需收集 training examples + 設計 metric |

#### 8. Tree of Thoughts / MCTS 搜尋式推理

| 層面 | 說明 |
|------|------|
| **問題** | `smart_think` 只有線性 CoT（一條路徑到底），複雜問題無法探索多路徑 |
| **業界做法** | CMCTS（2025）：7B + MCTS 勝過 72B；Self-Guided Self-Play（2026）：樹狀搜尋 |
| **實作方式** | 升級 `smart_think` 支援多路徑分支 + Process Reward Model 評估 |
| **效益** | 複雜推理場景（除錯、數學、規劃）品質大幅提升 |
| **難度** | 🔴 非常高 — 需 reward model + tree search engine |

#### 9. Speculative Decoding（推測解碼）

| 層面 | 說明 |
|------|------|
| **問題** | 這是 inference 層的優化，agent 端不需直接實作，但可 awareness |
| **業界做法** | EAGLE-2、vLLM/SGLang 原生支援；小模型草稿 → 大模型平行驗證，2-4x 加速 |
| **實作方式** | 選擇支援 speculative decoding 的 provider / inference engine |
| **效益** | 2-4x 生成加速 |
| **難度** | 🟢 低 — provider 選擇問題 |

#### 10. LLM-as-Judge 評估管線

| 層面 | 說明 |
|------|------|
| **問題** | 無系統化評估 agent 輸出品質的方法 |
| **業界做法** | 多 judge 面板（weak judges, strong panel）：3 個不相關 judge 聯合判定 |
| **實作方式** | 新增 `eval` tool，每次修改 agent personality 後自動跑回歸測試 |
| **效益** | 品質量化 + 回歸保護 |
| **難度** | 🟡 中 — 需設計 eval datasets |

---

### 🥉 Tier 3：長期研究方向

#### 11. Self-Play 自我對弈學習

| 層面 | 說明 |
|------|------|
| **問題** | LLM 參數固定，不隨使用改善 |
| **業界做法** | Triadic Self-Evolution（2026）：Proposer/Solver/Verifier 三角；SGS：7B 經 200 輪勝 671B |
| **實作方式** | `self_evolve` tool：從成功/失敗案例學習，不只是儲存記憶 |
| **效益** | 長期持續進步 |
| **難度** | 🔴 非常高 — 需 RL 訓練基礎設施 |

#### 12. Automated Red Teaming（自動紅隊測試）

| 層面 | 說明 |
|------|------|
| **問題** | `smart_security` 掃 source code 不掃 LLM 本身 |
| **業界做法** | Giskard Continuous Red Teaming：動態多輪攻擊，context-aware |
| **實作方式** | 擴充 `smart_security` 支援 LLM red teaming |
| **效益** | 防止 prompt injection 繞過 agent 限制 |
| **難度** | 🟠 高 — 需對抗性 prompt 生成 |

---

### 優先級矩陣

| 優先 | 技術 | 難度 | 效益 | 時間估計 |
|------|------|------|------|---------|
| 🥇 | Context Caching | 🟢 低 | token 省 50-90% | 1 天 |
| 🥇 | Guardrails | 🟢 低 | 安全合規 | 1-2 天 |
| 🥇 | Prompt Compression | 🟡 中 | token 省 50-80% + 準確率↑ | 3-5 天 |
| 🥇 | Hallucination Detection | 🟡 中 | 輸出可靠度↑ | 3-5 天 |
| 🥈 | Agent Observability | 🟡 中 | debug 效率↑ | 5-7 天 |
| 🥈 | DSPy Prompt Optimization | 🟡 中 | skill 效能↑ | 5-7 天 |
| 🥈 | LLM-as-Judge Eval | 🟡 中 | 品質量化 | 3-5 天 |
| 🥈 | Multi-Agent Debate | 🟠 高 | 準確率 +13% | 7-14 天 |
| 🥈 | Speculative Decoding | 🟢 低 | 2-4x 加速 | 選擇 provider |
| 🥈 | Tree of Thoughts / MCTS | 🔴 非常高 | 複雜推理 | 14-30 天 |
| 🥉 | Self-Play | 🔴 非常高 | 持續進步 | 30+ 天 |
| 🥉 | Automated Red Teaming | 🟠 高 | 安全性 | 7-14 天 |

---

### 不上什麼（Phase 6 對應）

| 項目 | 原因 |
|------|------|
| **Fine-tuning / 模型訓練** | 訓練基礎設施需求過高，偏離 MCP 工具定位 |
| **RAG 系統** | 已有 wiki-ingest + search_docs，不需另建 vector DB |
| **Multi-modal 支援** | 與 tool-assisted LLM 核心場景不一致 |
| **Inference engine 開發** | 應選擇現有 provider，不自己寫 |

---

## Phase 8：Universal LSP Bridge — 讓 LLM 看懂程式碼

> 2026-06-10 規劃。基於 research.md 的競爭分析。
> 核心問題：LSP bridge 已存在但未暴露為 MCP tool，LLM 無法使用 type-aware 程式碼理解。

### 現狀

| 元件 | 狀態 |
|------|------|
| `src/lib/lsp-bridge.mjs` | ✅ 已實作（TS/Python/Rust/Swift），支援 getSymbols/getReferences/getHover/getDefinition |
| 內部使用 | ✅ code-call-graph、code-impact 等插件使用 |
| MCP tool 暴露 | ❌ 無 — LLM 看不到 |
| SKILL.md | ❌ 4 個 skill 都寫「無 native LSP，用 CLI」 |
| PHP 支援 | ❌ LSP bridge 無 intelephense |
| Diagnostics | ❌ LSP bridge 無 getDiagnostics 方法 |

### 解決方案

```
新增 smart_lsp MCP tool（handler-based，~80 行）
  → 包裝現有 LspBridge API
  → 自動依副檔名選 language server
  → 支援 operations: symbols, references, hover, definition, diagnostics
  → 加入 PHP (intelephense) 支援
```

### 實作項目

| 步驟 | 內容 | 檔案 |
|------|------|------|
| 1 | 新增 `smart_lsp` plugin | `src/plugins/core/lsp.mjs` |
| 2 | LSP bridge 加 PHP + getDiagnostics | `src/lib/lsp-bridge.mjs` |
| 3 | System prompt 加路由規則 | `config/agents/smart-mcp.md` |
| 4 | 更新 4 個 SKILL.md | `~/.config/opencode/skills/{php,pyright,typescript,swift}-lsp/SKILL.md` |
| 5 | 同步 agent config | `~/.config/opencode/agents/smart-mcp.md` |

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

## Phase 7：Reasoning Quality — 讓 LLM 真正變聰明

> 2026-06-10 規劃。基於 Phase 1-6 的誠實反省。
> 核心洞察：Phase 1-6 讓 LLM 更**有效率**、更**安全**、更**多才多藝**，
> 但沒有直接讓它變得更**聰明**。

### 誠實盤點：6 個 Phase 的「智慧」貢獻

| Phase | 核心內容 | 做什麼 | LLM 有變聰明嗎？ |
|-------|---------|--------|----------------|
| 1-2 | 輸出壓縮 + Pipeline | 省 token | ❌ 變便宜，沒變聰明 |
| 3 | Universal Task Router | 減輕決策負擔 | ⚠️ 減少失誤，沒提升品質 |
| 4 | 文件轉換 | 看得懂更多格式 | ❌ 變廣，沒變深 |
| 5 | 全文搜尋 | 記得住更多內容 | ❌ 記憶變好，推理沒變 |
| 6 | Context Caching / Guardrails / 等 | 更快更省更安全 | ❌ 純 infrastructure 層 |

**結論**：截至 Phase 6，Smart MCP 的所有增強都在**基礎設施層**，
LLM 的推理品質完全由外部 provider 的模型決定。

### 核心問題

```
目前的推理流程：

  LLM 收到問題 → 線性思考一次 → 輸出
                     └── 錯了就錯了，沒有回溯、沒有備援路徑
```

Phase 7 要解決的是：**在不改變模型參數、不引入外部 reward model 的前提下，如何讓 LLM 的「思考過程」本身產生更好的結果？**

### 解決方案：三條可行的路

不同於 Phase 6 的多數學術研究導向項目，這三條路都是**輕量、可直接疊加**在現有架構上：

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

### 整合架構：Quality Layer + Reasoning Layer

Phase 6 的 Quality Layer 與 Phase 7 的 Reasoning Layer 合併為統一 pipeline：

```
Pre-call 層     │ Guardrails (input) + Context Caching
Call 層         │ Speculative Decoding + Prompt Compression
Reasoning 層 🌟 │ Beam Search Thinking + Self-Correction Loop
Post-call 層    │ Hallucination Detection + L2 Summary (Phase 1-2)
Cross-cutting   │ Agent Observability + Skill-level Learning
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



## 九、不做什麼（完整列表）

| 項目 | 原因 |
|------|------|
| L3 Truncated（只回摘要 + cache key） | 風險 > 效益，改用 format:full 互動機制 |
| Progressive tool loading（ToolSearch） | 需 opencode 支援 MCP protocol 擴展 |
| Context compaction pipeline | 需 opencode client 端支援 |
| Prompt caching（cache_control） | 需 Anthropic API 支援 |
| Streaming response chunks | MCP protocol 不支援分塊 |
| **Auto-execution**（router 自動執行而非推薦） | Router 無對話 context，可能做錯事。當前「推薦→LLM決定」是安全機制不是浪費 |
| **Session-aware routing** | LLM 呼叫 router 時已帶完整對話歷史，router 不需重複記憶 |
| **Custom workflow pipeline** | 等同 skill 功能已存在。加強 skill 建立工具即可 |
| **Observability dashboard** | 單開發者場景價值低，web UI scope 過大 |
| **External integrations**（Jira/Slack/GitHub Issues） | 產品成熟後再說，現階段 plugin 生態未建立 |
| **Fine-tuning / 模型訓練** | 訓練基礎設施需求過高，偏離 MCP 工具定位 |
| **RAG 系統** | 已有 wiki-ingest + search_docs，不需另建 vector DB |
| **Multi-modal 支援** | 與 tool-assisted LLM 核心場景不一致 |
| **Inference engine 開發** | 應選擇現有 provider，不自己寫 |
