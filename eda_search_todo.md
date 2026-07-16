# smart_eda_search 重構 TODO

> 配合 `eda_search_plan.md` 使用
> 狀態：⬜ Pending / 🔄 In Progress / ✅ Done / ⏭️ Skipped
>
> Phase 1 ✅ 完成（2026-07-16）：eda-search.mjs 3407→1347 行（-60%）

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

- [ ] 2.1 建立 `src/plugins/core/eda/sources/`
- [ ] 2.2 搬 `httpsGet()` → `eda/sources/http.mjs`（加 LRU cache + TTL）
- [ ] 2.3 搬 `searchWebDDG()` + `formatWebResults()` → `eda/sources/web.mjs`
- [ ] 2.4 搬 `searchEDACommunities()` + `crawlForumPages()` + `formatCommunityResults()` → `eda/sources/community.mjs`
- [ ] 2.5 搬 `searchGitHubPDK/EDA/Code()` + `formatGitHubResults()` → `eda/sources/github.mjs`
- [ ] 2.6 搬 `searchOpenAlex()` + `reconstructAbstract()` + `formatOpenAlexResults()` → `eda/sources/openalex.mjs`
- [ ] 2.7 搬 `searchSemanticScholar()` + `formatSemanticScholarResults()` → `eda/sources/semantic-scholar.mjs`
- [ ] 2.8 建立 `eda/sources/index.mjs`：`multiSourceSearch()` 統一入口
- [ ] 2.9 `eda-search.mjs` 改為 `import { searchXxx } from './eda/sources/*.mjs'`
- [ ] 2.10 驗證：重啟 MCP server → 測試 `auto` + `all` + `paper` 各 1 次

---

## Phase 3：Handler 重構（中風險）

> 目標：消除 switch-case 膨脹，統一重複邏輯
> 預估：~1.5 小時 | 風險：中（需完整回歸測試）

### 3A: 查詢增強 + 工具函式分離

- [ ] 3A.1 建立 `src/plugins/core/eda/query/`
- [ ] 3A.2 搬 `enhanceQueryForEDA()` + `generateSearchQueries()` → `eda/query/enhance.mjs`
- [ ] 3A.3 搬 `generateQueryVariants()` → `eda/query/expand.mjs`
- [ ] 3A.4 搬 `detectConference()` + `detectDocTopic()` + `isToolIssueQuery()` → `eda/query/detect.mjs`
- [ ] 3A.5 建立 `src/plugins/core/eda/lib/`
- [ ] 3A.6 搬 `generateVendorSearchURL()` + `searchToolFAQ()` → `eda/lib/vendor.mjs`
- [ ] 3A.7 搬 `fetchDocContent()` → `eda/lib/doc-fetch.mjs`
- [ ] 3A.8 建立 `src/plugins/core/eda/format/`
- [ ] 3A.9 搬 `formatPDKResults()` + `formatToolResults()` → `eda/format/local.mjs`

### 3B: 消除 auto/all 重複

- [ ] 3B.1 分析 `auto` 和 `all` 的共同邏輯（多源並行 + 結果格式化）
- [ ] 3B.2 抽取 `buildAutoSearchOptions(query)` — 判斷 tool/PDK/其他
- [ ] 3B.3 `auto` 和 `all` 都呼叫 `multiSourceSearch()`，只差 `crawlDepth` 和 `sources` 參數
- [ ] 3B.4 驗證：`auto` 測試 5 種查詢類型（tool/PDK/paper/general/error）
- [ ] 3B.5 驗證：`all` 測試 3 種查詢

### 3C: 消除 dft/lec/eco/fpga 重複

- [ ] 3C.1 建立 `eda/actions/flow.mjs`，接收 stage key 參數
- [ ] 3C.2 `dft/lec/eco/fpga` 四個 action 共用 `flow.mjs`，只傳不同 stageKey
- [ ] 3C.3 驗證：測試 `dft` + `lec` + `eco` + `fpga` + `flow` 各 1 次

### 3D: list actions 共用

- [ ] 3D.1 `list-tools` + `list-pdk` + `list-conferences` 合併到 `eda/actions/list.mjs`
- [ ] 3D.2 驗證：測試三個 list action

---

## Phase 4：Action Registry（中風險）

> 目標：switch-case → Map-based dispatch，新增 action 只加一個檔案
> 預估：~1 小時 | 風險：中

- [ ] 4.1 建立 `eda/actions/registry.mjs`（Map + registerAction + dispatch）
- [ ] 4.2 建立 `eda/actions/` 目錄，每個 action 一個檔案：
  - [ ] `auto.mjs`
  - [ ] `pdk.mjs`
  - [ ] `paper.mjs`
  - [ ] `tool.mjs`
  - [ ] `github.mjs`
  - [ ] `code.mjs`
  - [ ] `all.mjs`
  - [ ] `list.mjs`
  - [ ] `flow.mjs`（含 dft/lec/eco/fpga）
  - [ ] `troubleshoot.mjs`
  - [ ] `docs.mjs`
- [ ] 4.3 `eda-search.mjs` handler 簡化為：
  ```javascript
  import { dispatch } from './eda/actions/registry.mjs';
  import './eda/actions/index.mjs'; // side-effect: 註冊所有 actions
  async function edaSearch(args) { return dispatch(args.action, args); }
  ```
- [ ] 4.4 確認 `inputSchema` 不變（18 種 action enum）
- [ ] 4.5 驗證：逐一測試所有 18 種 action

---

## Phase 5：搜尋品質改進（低風險，附帶收益）

> 目標：整合 Exa + 深度爬取 + 去重 + 排序
> 預估：~2 小時 | 風險：低（新增功能，不改現有邏輯）

- [ ] 5.1 整合 `smart_exa_search`：auto/all 的多源搜尋加入第 7 來源
- [ ] 5.2 升級 `crawlForumPages`：用 `smart_exa_crawl({clean:true, markdown:true})` 取代暴力 HTML strip
- [ ] 5.3 新增 `depth` 參數：`"shallow"`（列 URL）vs `"deep"`（爬全文）
- [ ] 5.4 跨來源去重：DOI 去重學術論文，URL 去重網頁
- [ ] 5.5 結果排序：按來源權重 + 相關性分數
- [ ] 5.6 GitHub token 支援：從 `GITHUB_TOKEN` 環境變數讀取
- [ ] 5.7 驗證：`auto` 測試 → 確認 Exa 結果出現 + 去重生效

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
