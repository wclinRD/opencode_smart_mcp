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
| analyze | 分析、評估、架構、review | arch_overview / smart_learn / smart_thinking |
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

## 九、不做什麼

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
