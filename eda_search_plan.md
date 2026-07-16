# smart_eda_search 重構計畫

> 日期：2026-07-16（初版）→ 2026-07-16（Phase 7-10 新增）
> 狀態：Phase 1-6 ✅ 已完成 | Phase 7-10 ⬜ 規劃中
> 目標：Phase 1-6 重構完成（3407→72 行，-98%），Phase 7-10 針對搜尋品質、token 效率、可靠性進行強化

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

## 5. 風險評估（Phase 1-6）

| Phase | 風險 | 緩解 |
|-------|------|------|
| Phase 1: 資料外置 | 極低 | 純搬運，import/export 不影響邏輯 |
| Phase 2: 搜尋來源分離 | 低 | 每個來源獨立測試，行為不變 |
| Phase 3: Handler 重構 | 中 | `auto`/`all` 共用 + flow 參數化，需完整回歸測試 |
| Phase 4: Action Registry | 中 | switch-case → Map，需確認所有 action 路由正確 |
| Phase 5: 搜尋增強 | 低 | 新增 Exa 來源 + crawl 升級，不改現有邏輯 |

---

## 6. 現存問題診斷（2026-07-16 程式碼審閱 + 實測）

### 6.1 嚴重度：🔴 高

| # | 問題 | 位置 | 實測症狀 |
|---|------|------|---------|
| A1 | `auto` Tool 偵測使用 40+ 個 `.includes()` 脆弱匹配 | `auto.mjs:20-31` | `hal` 誤判為 Cadence HAL、`diamond` 誤判為 Lattice Diamond |
| A2 | Local search 無 relevance ranking，返回全部匹配 | `format/local.mjs:32-41` | 查 "Design Compiler" 返回 26 個工具（含 Yosys/OpenROAD 等無關工具） |
| A3 | `auto` Tool/PDK 路徑跳過多源搜尋 | `auto.mjs:32-67` | Tool 查詢只搜 GitHub，缺少 web/community/academic |
| A4 | Semantic Scholar 無 rate limit 降級 | `paper.mjs:16-25` | 實測直接 429，無 retry 無 fallback |

### 6.2 嚴重度：🟡 中

| # | 問題 | 位置 | 說明 |
|---|------|------|------|
| B1 | OpenAlex concept filter 過廣 | `openalex.mjs:6` | 返回 "Fluid Mechanics" 等非 EDA 論文 |
| B2 | DDG Web 搜尋品質不穩定 | `web.mjs:4-29` | Lite 版 HTML 結構易變、無 JS 渲染 |
| B3 | 輸出過長浪費 token | `auto.mjs:32-67` | 26 個工具表格 = ~130 行，佔大量 context |
| B4 | 錯誤處理過於靜默 | 多處 `catch { /* ignore */ }` | 至少 8 處，用戶不知道哪些來源失敗 |

### 6.3 嚴重度：🟢 低

| # | 問題 | 位置 | 說明 |
|---|------|------|------|
| C1 | 無測試覆蓋 | 整個 `eda/` 目錄 | ~2000 行原始碼無任何測試 |
| C2 | 靜態資料無法外部更新 | `eda/data/*.mjs` | 新增工具需改程式碼 + 重新部署 |
| C3 | Cache TTL 無差異化 | `http.mjs:12` | 所有 URL 共用 5min TTL |
| C4 | 無分頁支援 | 所有 source | 只取第一頁結果 |

---

## 7. Phase 7：Token 效率優化（🔴 高優先級）

> 目標：解決 A1-A3 + B3，預估省 50-70% token 輸出
> 預估：~3 小時 | 風險：中（需改 auto 路由邏輯 + local search）

### 7.1 Tool 偵測改用 Word Boundary + Confidence Scoring

**問題**：40+ 個 `.includes()` 匹配太脆弱（`hal`/`diamond`/`netgen` 誤判）

**方案**：

```javascript
// eda/query/detect.mjs — 新增 detectToolCategory()

// 精確 tool 名稱（word boundary 匹配）
const EXACT_TOOL_KEYS = Object.keys(EDA_TOOL_INDEX); // ['yosys','dc','genus',...]

// 問題描述 patterns（後綴匹配）
const ISSUE_SUFFIXES = [
  /error/i, /fail/i, /violation/i, /issue/i, /problem/i,
  /crash/i, /hang/i, /warning/i, /not found/i, /timeout/i,
];

/**
 * 偵測查詢是否涉及 EDA 工具
 * @returns {{ isToolQuery: boolean, confidence: number, detectedTool: string|null }}
 */
export function detectToolQuery(query) {
  const q = query.toLowerCase();
  let confidence = 0;
  let detectedTool = null;

  // Tier 1: 精確 tool 名稱匹配（confidence +90）
  for (const key of EXACT_TOOL_KEYS) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(query)) {
      return { isToolQuery: true, confidence: 0.95, detectedTool: key };
    }
  }

  // Tier 2: 工具類別關鍵字（confidence +60）
  const categoryKeywords = [
    'synthesis', 'synth', 'place', 'route', 'p&r', 'sta',
    'timing', 'simulation', 'lint', 'formal', 'dft', 'lec',
    'eco', 'fpga', 'drc', 'lvs', 'pex', 'extraction',
  ];
  const categoryHits = categoryKeywords.filter(k => q.includes(k)).length;
  if (categoryHits >= 2) confidence += 0.6;
  else if (categoryHits === 1) confidence += 0.3;

  // Tier 3: 問題描述 suffix（confidence +20）
  if (ISSUE_SUFFIXES.some(p => p.test(query))) confidence += 0.2;

  // Tier 4: 泛用關鍵字（僅 +5，降低誤判）
  if (/\btool\b/.test(q)) confidence += 0.05;
  if (/工具/.test(q)) confidence += 0.05;

  // 閾值：confidence >= 0.5 才判定為 tool 查詢
  return {
    isToolQuery: confidence >= 0.5,
    confidence: Math.min(confidence, 1.0),
    detectedTool,
  };
}
```

**關鍵改變**：
- `\b` word boundary 避免 `hal` 誤判
- Confidence scoring：多個線索疊加，單一泛用字（`tool`/`工具`）僅 +5%
- 閾值 0.5：至少需要 2 個中階線索才判定為 tool 查詢

### 7.2 Local Search 加 Relevance Ranking + Top-N

**問題**：`searchLocalTools()` 返回全部匹配，26 筆結果浪費 token

**方案**：

```javascript
// eda/format/local.mjs — 改進 searchLocalTools()

/**
 * 本地工具搜尋（加 TF-IDF 詞頻加權）
 * @param {string} query
 * @param {number} maxResults - 最大返回數（預設 8）
 * @returns {Array} 排序後的結果
 */
export function searchLocalTools(query, maxResults = 8) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];

  const scored = [];
  for (const [key, tool] of Object.entries(EDA_TOOL_INDEX)) {
    const searchable = `${key} ${tool.name} ${tool.category} ${tool.desc} ${tool.alt}`.toLowerCase();
    const matchWords = words.filter(w => searchable.includes(w));
    if (matchWords.length === 0) continue;

    // Score: 精確 key 匹配 + 名稱匹配 + 描述匹配
    let score = 0;
    for (const w of matchWords) {
      if (key === w) score += 10;                    // 精確 key 匹配
      else if (tool.name.toLowerCase().includes(w)) score += 5;  // 名稱匹配
      else if (tool.category.includes(w)) score += 3;            // 類別匹配
      else score += 1;                                            // 描述匹配
    }
    // Bonus: commercial tools 在 troubleshoot 場景加分
    if (tool.commercial) score += 1;

    scored.push({ key, score, ...tool });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
```

**關鍵改變**：
- 加入分數：精確 key=10、名稱=5、類別=3、描述=1
- `maxResults` 預設 8（可由呼叫端覆蓋）
- 排序後返回，最相關的在前

### 7.3 輸出加入 `brief` / `full` 模式

**問題**：Tool 查詢返回 26 個完整表格（~130 行），浪費 token

**方案**：

```javascript
// eda-search.mjs — inputSchema 新增 outputMode 參數
inputSchema: {
  properties: {
    // ... 現有參數
    outputMode: {
      type: 'string',
      enum: ['brief', 'full'],
      description: 'brief=精簡摘要（省 60% token），full=完整表格（預設）',
      default: 'full',
    },
  },
},
```

```javascript
// eda/format/local.mjs — 新增 formatToolResultsBrief()
export function formatToolResultsBrief(results) {
  if (!results || results.length === 0) return '🔧 EDA Tool：無符合結果\n';
  let out = `🔧 EDA 工具（${results.length} 筆）\n\n`;
  out += `| 工具 | 類別 | 說明 |\n|------|------|------|\n`;
  for (const t of results) {
    out += `| **${t.name}** (\`${t.key}\`) | ${t.category} | ${t.desc.slice(0, 60)}... |\n`;
  }
  return out;
}
```

**關鍵改變**：
- `brief` 模式：單行表格，每筆 ~20 tokens（vs full 模式 ~50 tokens）
- 26 筆 × 20 = 520 tokens（vs 26 × 50 = 1300 tokens），省 60%
- `auto` 模式預設用 `brief`，`tool` action 用 `full`

### 7.4 Auto 的 Tool 路徑補上多源搜尋

**問題**：`auto.mjs` 偵測到 tool 後只搜 GitHub，缺少 web/community/academic

**方案**：

```javascript
// auto.mjs — Tool 偵測後同時觸發多源搜尋
if (detectToolQuery(searchQuery).isToolQuery) {
  // 本地索引（即時）
  const localTools = searchLocalTools(searchQuery);
  let output = localTools.length > 0 ? formatToolResults(localTools) + '\n' : '';

  // GitHub（平行）
  try {
    const ghResults = await searchGitHubEDA(searchQuery, 5);
    output += formatGitHubResults(ghResults, 'GitHub 相關 EDA 工具');
  } catch { /* ignore */ }

  // 🆕 多源搜尋（平行）— 解決 A3 問題
  const multiOutput = await multiSourceSearch(searchQuery, Math.min(maxResults, 5));
  if (multiOutput) output += '\n' + multiOutput;

  // FAQ（問題偵測時）
  if (isToolIssueQuery(searchQuery)) {
    // ... 現有 FAQ 邏輯不變
  }

  return { ok: true, output };
}
```

**關鍵改變**：
- Tool 查詢也觸發 `multiSourceSearch()`（web + community + scholar + openalex + github）
- 與 GitHub 搜尋平行執行（Promise.allSettled）
- `maxResults` 限制為 5（避免過多結果）

### 7.5 Caveman 壓縮引擎（✅ 2026-07-16 已完成）

**問題**：搜尋結果含大量冗詞、filler phrases、stop words，浪費 token

**方案**：新建 `eda/lib/caveman.mjs`，4 級文字壓縮

```javascript
// eda/lib/caveman.mjs — 核心 API
export function cavemanCompress(text, level = 'semantic');
export function compressResults(results, level, fields);
export function compressOutput(text, level);
```

**4 級壓縮策略**：

| 級別 | 策略 | 預估 savings | 適用場景 |
|------|------|-------------|---------|
| `none` | 不壓縮（預設）| 0% | 預設，需完整內容時 |
| `light` | 去 stop words | ~10-15% | 輕量壓縮 |
| `semantic` | + 去 filler phrases | ~20-30% | **推薦預設** |
| `aggressive` | + 移除程度副詞 | ~35% | 需更多省 token |
| `ultra` | + 縮寫 + 箭頭化 | ~50% | 極限壓縮 |

**專有名詞保護機制**：
- Stop words / filler phrases / abbreviations → 僅匹配小寫，不碰大寫字
- Aggressive 級 → 僅移除程度副詞（very/really），不做詞形還原（避免 regex 貪婪問題）
- Ultra 縮寫映射 → 用 `g` flag（不分大小寫），`Environment`、`Information` 等不會被替換
- EDA_PRESERVE 集合 → 保護 60+ EDA 專有名詞（Design Compiler, Synopsys, Cadence, PDK...）

**整合點**：
- `multiSourceSearch()` → 格式化後套用 `compressOutput()`
- `paper` action → 論文搜尋結果壓縮
- `troubleshoot` action → FAQ 內容壓縮
- `inputSchema` → 新增 `compress` 參數

**已修改檔案**：
- `eda/lib/caveman.mjs`（🆕 新建）
- `eda/sources/index.mjs`（引入 + options.compress）
- `eda-search.mjs`（inputSchema + handler 傳遞）
- `eda/actions/auto.mjs`（傳遞 compress）
- `eda/actions/all.mjs`（傳遞 compress）
- `eda/actions/paper.mjs`（加 compressOutput）
- `eda/actions/troubleshoot.mjs`（加 compressOutput）

---

## 8. Phase 8：搜尋品質強化（🟡 中優先級）

> 目標：解決 A4 + B1 + B2，提升學術和社群搜尋品質
> 預估：~2.5 小時 | 風險：低（改良現有邏輯）

### 8.1 Semantic Scholar 429 自動降級

**問題**：無 API key 時 100 req/5min，實測直接 429

**方案**：

```javascript
// eda/sources/semantic-scholar.mjs — 加入 retry + fallback

export async function searchSemanticScholar(query, maxResults = 10, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const q = encodeURIComponent(query);
      const fields = 'title,authors,year,venue,citationCount,externalIds,openAccessPdf,tldr,abstract';
      const url = `${SCHOLAR_API}/paper/search?query=${q}&limit=${maxResults}&fields=${fields}`;
      const data = await httpsGet(url);
      // ... 現有邏輯
    } catch (err) {
      if (err.message?.includes('429') && attempt < retries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      // 429 且 retries 用完 → 回傳降級訊息
      return {
        ok: false,
        message: `Semantic Scholar: ${err.message}（已重試 ${retries} 次）`,
        degraded: true,  // 標記為降級
      };
    }
  }
}
```

```javascript
// paper.mjs — 偵測降級 → 自動補充 DDG 學術搜尋
if (scholarResult.degraded) {
  output += `\n💡 Semantic Scholar 暫時不可用，改用 DuckDuckGo 搜尋學術論文：\n`;
  const ddgFallback = await searchWebDDG(`${searchQuery} site:arxiv.org OR site:ieee.org`, 5);
  output += formatWebResults(ddgFallback, '🌐 學術備選');
}
```

### 8.2 OpenAlex Concept Filter 收窄

**問題**：`C119857082` (Computer science) 範圍太廣，返回流體力學等非 EDA 論文

**方案**：

```javascript
// eda/sources/openalex.mjs — 替換 concept filter

// Before: 太泛
// filter=concepts.id:C119857082|C154945302|C41008148

// After: EDA 專屬 concept（需查 OpenAlex concept IDs）
const EDA_CONCEPTS = [
  'C119857082',  // Computer science (保留，但加 keyword filter)
  'C154945302',  // Engineering
  'C41008148',   // Electrical engineering
].join('|');

// Post-filter: 關鍵字二次驗證
const EDA_KEYWORDS = [
  'eda', 'vlsi', 'asic', 'fpga', 'synthesis', 'place', 'route',
  'timing', 'sta', 'drc', 'lvs', 'pdk', 'cell library', 'netlist',
  'cad', 'physical design', 'logic synthesis', 'floorplan',
];

function isEDARelated(article) {
  const text = `${article.title} ${article.abstract || ''}`.toLowerCase();
  return EDA_KEYWORDS.some(k => text.includes(k));
}

export async function searchOpenAlex(query, maxResults = 10) {
  const results = await searchOpenAlexRaw(query, maxResults);
  return results.filter(isEDARelated).slice(0, maxResults);
}
```

### 8.3 社群搜尋去重 + 過濾

**問題**：8 個社群各發 DDG 查詢，結果重複且噪音多

**方案**：

```javascript
// eda/sources/community.mjs — 改進 searchEDACommunities()

export async function searchEDACommunities(query, maxResults = 10) {
  // Tier 1: 高優先社群（DDG site: 限定）
  const tier1 = EDA_COMMUNITIES.filter(c => ['Cadence Community', 'Synopsys SolvNet', 'Reddit r/ASIC'].includes(c.name));
  // Tier 2: 低優先社群（僅在 Tier 1 結果不足時搜尋）
  const tier2 = EDA_COMMUNITIES.filter(c => !tier1.includes(c));

  const allResults = [];

  // Tier 1 搜尋
  for (const community of tier1) {
    try {
      const siteQuery = community.queryTemplate(query);
      const results = await searchWebDDG(siteQuery, 3);
      allResults.push(...results.map(r => ({ ...r, community: community.name, tier: 1 })));
    } catch { /* ignore */ }
  }

  // Tier 2: 僅在 Tier 1 結果不足時
  if (allResults.length < maxResults) {
    for (const community of tier2) {
      try {
        const siteQuery = community.queryTemplate(query);
        const results = await searchWebDDG(siteQuery, 2);
        allResults.push(...results.map(r => ({ ...r, community: community.name, tier: 2 })));
      } catch { /* ignore */ }
    }
  }

  // 去重（URL 去重）
  const seen = new Set();
  return allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, maxResults);
}
```

---

## 9. Phase 9：可靠性 + 可維護性（🟡 中優先級）

> 目標：解決 B4 + C1 + C3，提升可觀測性和可測試性
> 預估：~4 小時 | 風險：低

### 9.1 錯誤處理加入 Warning 回報

**問題**：至少 8 處 `catch { /* ignore */ }`，用戶不知道哪些來源失敗

**方案**：

```javascript
// eda/sources/index.mjs — multiSourceSearch 回傳 warnings

export async function multiSourceSearch(searchQuery, maxResults = 10, options = {}) {
  const warnings = [];
  const sources = [ /* ... 現有 sources ... */ ];

  const results = await Promise.allSettled(sources);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const sourceNames = ['DDG', 'Community', 'SemanticScholar', 'OpenAlex', 'GitHubCode', 'GitHubRepo', 'Exa'];
      warnings.push(`⚠️ ${sourceNames[i] || `Source ${i}`} 搜尋失敗: ${r.reason?.message || 'unknown'}`);
    }
  });

  // ... 現有格式化邏輯

  // 在輸出末尾附上 warnings
  if (warnings.length > 0) {
    output += `\n---\n${warnings.join('\n')}\n`;
  }

  return output;
}
```

### 9.2 Cache TTL 差異化

**問題**：所有 URL 共用 5min TTL

**方案**：

```javascript
// eda/sources/http.mjs — 按 hostname 設定不同 TTL

const HOST_TTL = {
  'api.github.com': 5 * 60 * 1000,           // GitHub: 5 min（資料變動快）
  'lite.duckduckgo.com': 15 * 60 * 1000,     // DDG: 15 min（搜尋結果較穩定）
  'api.semanticscholar.org': 30 * 60 * 1000,  // S2: 30 min（論文不常變）
  'api.openalex.org': 60 * 60 * 1000,         // OpenAlex: 1 hr（學術資料穩定）
  'api.exa.ai': 10 * 60 * 1000,              // Exa: 10 min
};

const DEFAULT_TTL = 5 * 60 * 1000; // 預設 5 min
```

### 9.3 單元測試建立

**問題**：整個 EDA 模組 ~3500 行無測試

**方案**：為每個 action + 核心函式建立測試

```
tests/
├── eda/
│   ├── actions/
│   │   ├── auto.test.mjs        # 測試自動路由偵測
│   │   ├── paper.test.mjs       # 測試學術搜尋
│   │   ├── troubleshoot.test.mjs # 測試 FAQ 匹配
│   │   └── flow.test.mjs        # 測試 flow 查詢
│   ├── query/
│   │   ├── detect.test.mjs      # 測試 tool issue 偵測
│   │   └── enhance.test.mjs     # 測試查詢增強
│   ├── format/
│   │   └── local.test.mjs       # 測試本地搜尋 ranking
│   └── sources/
│       ├── github.test.mjs      # 測試 GitHub API（mock）
│       └── openalex.test.mjs    # 測試 OpenAlex API（mock）
```

**測試策略**：
- **Unit tests**：mock `httpsGet()`，測試純邏輯
- **Integration tests**：真實 API 呼叫（CI 中 skip），測試端到端
- **Fixture**：靜態 JSON 回應快取，避免重複 API 呼叫

---

## 10. Phase 10：長期改進（🟢 低優先級）

> 目標：解決 C2 + C4，為未來擴展鋪路
> 預估：~3 小時 | 風險：低（非關鍵路徑）

### 10.1 靜態資料外部化

**方案**：將 `eda/data/*.mjs` 改為 JSON + 動態載入

```
eda/data/
├── tools.json           # EDA_TOOL_INDEX
├── pdk.json             # PDK_INDEX
├── faq.json             # TOOL_FAQ_INDEX（regex patterns 改為字串，runtime 編譯）
├── flow.json            # CELL_FLOW_STAGES
└── index.mjs            # 動態 import() + regex 編譯
```

**好處**：
- 新增工具/PDK 只需改 JSON，不需改程式碼
- 可從 wiki 或外部 API 同步更新
- JSON 可被其他工具消費

### 10.2 分頁支援

**方案**：為 `multiSourceSearch()` 加入 `offset` 參數

```javascript
export async function multiSourceSearch(query, maxResults = 10, options = {}) {
  const { offset = 0 } = options;
  // ... 搜尋後 slice(offset, offset + maxResults)
}
```

### 10.3 DDG → Exa 升級路徑

**方案**：偵測 `EXA_API_KEY` 存在時，優先用 Exa 取代 DDG

```javascript
// eda/sources/web.mjs
export async function searchWebDDG(query, maxResults = 8) {
  if (isExaAvailable()) {
    // 優先用 Exa（語意搜尋，品質更高）
    return searchExaAsWebFallback(query, maxResults);
  }
  // 現有 DDG 邏輯
}
```

---

## 11. Phase 7-10 風險評估

| Phase | 風險 | 緩解 |
|-------|------|------|
| Phase 7: Token 效率 | 中 | Tool 偵測改 word boundary 有精確度風險，需 A/B 測試 |
| Phase 8: 搜尋品質 | 低 | 改良現有邏輯，不改架構 |
| Phase 9: 可靠性 | 低 | 新增 warning + cache + test，不改核心邏輯 |
| Phase 10: 長期改進 | 低 | 非關鍵路徑，可隨時做 |

---

## 12. Phase 7-10 估計工時

| Phase | 工時 | 累計（含 Phase 1-6） | 優先級 |
|-------|------|---------------------|--------|
| Phase 7: Token 效率 | 3 hr | 9.5 hr | 🔴 P0 |
| Phase 8: 搜尋品質 | 2.5 hr | 12 hr | 🟡 P1 |
| Phase 9: 可靠性 | 4 hr | 16 hr | 🟡 P1 |
| Phase 10: 長期改進 | 3 hr | 19 hr | 🟢 P2 |

**總計：~19 小時**（Phase 1-6 已完成 6.5 hr + Phase 7-10 需 12.5 hr）
