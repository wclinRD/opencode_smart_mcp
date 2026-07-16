# smart_eda_search 重構計畫

> 日期：2026-07-16
> 狀態：Plan Phase
> 目標：將 3407 行 God Module 重構為模組化架構，同時保持 API 向後相容

---

## 1. 現狀分析

### 1.1 檔案結構

```
src/plugins/core/eda-search.mjs (3407 行，單一檔案)
├── 🗃️ 資料索引     ~1200 行 (35%)  靜態常數
├── 🔍 搜尋引擎     ~300 行  (9%)   外部 I/O
├── 🧠 查詢增強     ~200 行  (6%)   query transform
├── 📝 結果格式化   ~200 行  (6%)   output render
├── ⚙️ 工具函式     ~150 行  (4%)   shared utils
└── 🎯 主 Handler   ~1350 行 (40%)  switch-case 18 分支
```

### 1.2 五個架構問題

| # | 問題 | 嚴重度 | 說明 |
|---|------|--------|------|
| 1 | 違反 SRP | 🔴 | 一個檔案承擔 6 個職責：資料、搜尋、查詢增強、格式化、工具、路由 |
| 2 | switch-case 膨脹 | 🔴 | 18 個 case，`auto`/`all` 80% 重複，`dft/lec/eco/fpga` 100% 重複 |
| 3 | 資料硬編碼 | 🟨 | 1200 行靜態資料佔 35% context，無法外部更新 |
| 4 | 路由邏輯反模式 | 🟨 | auto 用 40+ 個 `.includes()` 判斷，tool 路徑跳過社群/學術搜尋 |
| 5 | 不可測試 | 🟨 | 直接 fetch 無法 mock，所有邏輯耦合無法獨立測試 |

### 1.3 功能完整度（保持不動）

| 能力 | 數量 | 評價 |
|------|------|------|
| 搜尋來源 | 6 並行 | ✅ 廣度足夠 |
| 本地索引 | 55+ 工具 / 7 PDK / 10 FAQ | ✅ 非常完整 |
| Action | 18 種 | ✅ 覆蓋全面 |
| 查詢增強 | 縮寫展開 + 模式規則 + 多變體 | ✅ 聰明 |
| Cell Flow | 11 階段 × 多工具 × 完整命令 | ✅ 業界最全 |

---

## 2. 目標架構

### 2.1 模組拆分

```
src/plugins/core/
├── eda-search.mjs                    # 入口：~30 行（import + export）
│
├── eda/
│   ├── data/                         # 🗃️ 純靜態資料（可 tree-shake）
│   │   ├── tools.mjs                 # EDA_TOOL_INDEX (55+)
│   │   ├── pdk.mjs                   # PDK_INDEX (7)
│   │   ├── faq.mjs                   # TOOL_FAQ_INDEX (10) + regex patterns
│   │   ├── flow.mjs                  # CELL_FLOW_STAGES (11 stages)
│   │   ├── docs.mjs                  # VENDOR_DOCS (開源+商業)
│   │   ├── abbreviations.mjs         # EDA_ABBREVIATIONS + PATTERN_RULES
│   │   └── meta.mjs                  # EDA_FORMATS, CONFERENCES, COMMUNITIES, TOOL_ISSUE_PATTERNS
│   │
│   ├── sources/                      # 🔍 搜尋來源（每個可獨立 test/mock）
│   │   ├── http.mjs                  # httpsGet (統一 HTTP 層，含 cache + retry)
│   │   ├── web.mjs                   # searchWebDDG
│   │   ├── community.mjs             # searchEDACommunities + crawlForumPages
│   │   ├── github.mjs                # searchGitHubPDK / searchGitHubEDA / searchGitHubCode
│   │   ├── openalex.mjs              # searchOpenAlex + reconstructAbstract
│   │   ├── semantic-scholar.mjs      # searchSemanticScholar
│   │   └── index.mjs                 # multiSourceSearch() — 統一多源並行入口
│   │
│   ├── query/                        # 🧠 查詢轉換
│   │   ├── enhance.mjs               # enhanceQueryForEDA + generateSearchQueries
│   │   ├── expand.mjs                # generateQueryVariants (縮寫展開 + 模式規則)
│   │   └── detect.mjs                # detectConference + detectDocTopic + isToolIssue
│   │
│   ├── format/                       # 📝 結果格式化
│   │   ├── web.mjs                   # formatWebResults
│   │   ├── community.mjs             # formatCommunityResults
│   │   ├── github.mjs                # formatGitHubResults
│   │   ├── academic.mjs              # formatOpenAlexResults + formatSemanticScholarResults
│   │   └── local.mjs                 # formatPDKResults + formatToolResults
│   │
│   ├── lib/                          # ⚙️ 業務工具
│   │   ├── vendor.mjs                # generateVendorSearchURL + searchToolFAQ
│   │   └── doc-fetch.mjs             # fetchDocContent + detectDocTopic
│   │
│   └── actions/                      # 🎯 Action Handlers（取代 switch-case）
│       ├── registry.mjs              # Action 自動註冊表
│       ├── auto.mjs                  # 自動路由（多源並行）
│       ├── pdk.mjs                   # PDK 查詢
│       ├── paper.mjs                 # 學術論文
│       ├── tool.mjs                  # EDA 工具
│       ├── github.mjs                # GitHub 專案
│       ├── code.mjs                  # GitHub 程式碼
│       ├── all.mjs                   # 綜合搜尋（共用 multiSourceSearch）
│       ├── list.mjs                  # list-tools + list-pdk + list-conferences
│       ├── flow.mjs                  # flow + dft + lec + eco + fpga（共用，參數化）
│       ├── troubleshoot.mjs          # Tool 問題診斷
│       └── docs.mjs                  # 工具文件
```

### 2.2 關鍵設計變更

#### A. Switch-case → Action Registry

**Before:**
```javascript
switch (action) {
  case 'auto':    { /* 80 行 */ }
  case 'pdk':     { /* 15 行 */ }
  case 'paper':   { /* 30 行 */ }
  // ... 15 more cases
}
```

**After:**
```javascript
// actions/registry.mjs
const actions = new Map();

// 自動註冊
export function registerAction(name, handler) {
  actions.set(name, handler);
}

export async function dispatch(action, args) {
  const handler = actions.get(action);
  if (!handler) return { ok: false, error: `未知 action: ${action}` };
  return handler(args);
}

// actions/pdk.mjs
import { registerAction } from './registry.mjs';
registerAction('pdk', async (args) => { ... });
```

#### B. `auto` / `all` 共用邏輯

**Before:** `auto` 和 `all` 各自實現 6 來源並行搜尋，80% 重複。

**After:** 統一的 `multiSourceSearch(query, options)`:

```javascript
// sources/index.mjs
export async function multiSourceSearch(query, options = {}) {
  const {
    sources = ['web', 'community', 'scholar', 'openalex', 'github'],
    maxResults = 10,
    crawlDepth = 0,  // 0=不爬, >0=爬 top N 個結果
    queries = {},    // 各來源的專屬查詢
  } = options;

  const searches = sources.map(s => sourceMap[s](queries[s] || query, maxResults));
  const results = await Promise.allSettled(searches);

  // 統一格式 + 去重
  return mergeAndDedup(results, { crawlDepth });
}
```

- `auto` = `multiSourceSearch(q, { sources: ['web','community','scholar','openalex','github'], crawlDepth: 0 })`
- `all` = `multiSourceSearch(q, { sources: ALL, crawlDepth: 3 })`

#### C. `dft/lec/eco/fpga` → 參數化 `flow`

**Before:** 4 個 copy-paste case，只差 stage key。

**After:** 單一 `flow.mjs`:
```javascript
const STAGE_MAP = {
  'dft': '1.5-dft',
  'lec': '8-lec',
  'eco': '9-eco',
  'fpga': '10-fpga',
};

registerAction('flow', async ({ query }) => {
  const stageKey = STAGE_MAP[query] || detectFlowStage(query);
  return formatFlowStage(CELL_FLOW_STAGES[stageKey]);
});
```

#### D. 資料外置（零風險第一步）

```javascript
// Before: eda-search.mjs
const EDA_TOOL_INDEX = { 'yosys': { ... }, ... };  // 500+ 行

// After: eda/data/tools.mjs
export const EDA_TOOL_INDEX = { 'yosys': { ... }, ... };

// eda-search.mjs
import { EDA_TOOL_INDEX } from './eda/data/tools.mjs';
```

#### E. HTTP 層加 Cache

```javascript
// sources/http.mjs
const cache = new Map();
const TTL = {
  'api.github.com': 5 * 60 * 1000,     // GitHub: 5 min
  'lite.duckduckgo.com': 10 * 60 * 1000, // DDG: 10 min
  'api.semanticscholar.org': 30 * 60 * 1000, // S2: 30 min
  'api.openalex.org': 60 * 60 * 1000,   // OpenAlex: 1 hr
};

export async function httpsGet(url, opts = {}) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < (TTL[new URL(url).hostname] || 60000)) {
    return cached.data;
  }
  // ... fetch logic
  cache.set(url, { data, ts: Date.now() });
  return data;
}
```

---

## 3. 向後相容保證

| 項目 | 保證 |
|------|------|
| **Plugin export** | `export default { name, description, inputSchema, handler }` 不變 |
| **inputSchema** | 18 種 action + question/query/maxResults 參數不變 |
| **handler 簽章** | `async function(args) => { ok, output/error }` 不變 |
| **Loader 自動發現** | 檔案名 `eda-search.mjs` 不變，loader 自動註冊 |

---

## 4. 搜尋品質改進（重構附帶）

| 改進 | 說明 |
|------|------|
| 整合 `smart_exa_search` | auto/all 模式加入 Exa 語意搜尋作為第 7 來源 |
| 論壇深度爬取 | 用 `smart_exa_crawl` 取代 `crawlForumPages`，支援 JS 渲染 |
| `depth` 參數 | `depth: "shallow" | "deep"`，deep 模式自動爬取 top N 結果全文 |
| 跨來源去重 | DOI / URL 去重學術論文 |
| 結果相關性排序 | 按來源權重 + 相關性分數排序 |

---

## 5. 風險評估

| Phase | 風險 | 緩解 |
|-------|------|------|
| Phase 1: 資料外置 | 極低 | 純搬運，import/export 不影響邏輯 |
| Phase 2: 搜尋來源分離 | 低 | 每個來源獨立測試，行為不變 |
| Phase 3: Handler 重構 | 中 | `auto`/`all` 共用 + flow 參數化，需完整回歸測試 |
| Phase 4: Action Registry | 中 | switch-case → Map，需確認所有 action 路由正確 |
| Phase 5: 搜尋增強 | 低 | 新增 Exa 來源 + crawl 升級，不改現有邏輯 |
