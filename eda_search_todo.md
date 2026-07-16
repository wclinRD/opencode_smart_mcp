# smart_eda_search 重構 TODO

> 配合 `eda_search_plan.md` 使用
> 狀態：⬜ Pending / 🔄 In Progress / ✅ Done / ⏭️ Skipped
>
> Phase 1 ✅ 完成（2026-07-16）：eda-search.mjs 3407→1347 行（-60%）
> Phase 2 ✅ 完成（2026-07-16）：eda-search.mjs 1347→1033 行，6 個搜尋來源模組建立
> Phase 3 ✅ 完成（2026-07-16）：eda-search.mjs 1033→547 行，handler 去重 + 函式提取
> Phase 4 ✅ 完成（2026-07-16）：eda-search.mjs 547→135 行（-75%），switch-case → Action Registry
> Phase 5 ✅ 完成（2026-07-16）：整合 Exa 語意搜尋 + 深度爬取 + 去重 + 排序 + GitHub token

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

- [ ] 6.1 完整回歸測試：18 種 action 各至少 1 次
- [ ] 6.2 確認 `eda-search.mjs` 從 3407 行降到 <100 行
- [ ] 6.3 確認所有 import 正確（無殘留的 inline 定義）
- [ ] 6.4 更新 AGENTS.md 中 smart_eda_search 的說明
- [ ] 6.5 更新 `config/tools/manifest.json`（loader 會自動重新產生）
- [ ] 6.6 Commit & push

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

**總計：~6.5 小時**（可分 2-3 天執行）

---

## Decision Log

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-07-16 | 不推翻重寫，採用漸進式重構 | 功能完整，問題在組織方式不在邏輯 |
| 2026-07-16 | Phase 1-2 先做 | 零風險 + 最大收益（解耦資料和來源） |
| 2026-07-16 | 保留 Plugin export 簽章不變 | 向後相容是硬需求 |
| 2026-07-16 | Action Registry 用 side-effect import | 避免手動維護 action 列表 |
