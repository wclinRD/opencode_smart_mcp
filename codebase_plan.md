# codebase-memory-mcp 整合計畫

> 研究日期：2026-06-18
> 目標：將 [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)（CBM）整合為 Smart MCP 的 companion MCP server，實現 158 語言 AST、Hybrid LSP、semantic search、Cypher 圖查詢

---

## 為什麼要整合

| 面向 | 現狀（Smart MCP alone） | 整合後（+CBM） | 改善 |
|------|------------------------|----------------|------|
| 語言支援 | ~20 語言（Node tree-sitter） | 158 語言（C tree-sitter 編譯進 binary） | **8x** |
| 查詢速度 | 逐檔 grep/read（~400K tokens） | Graph query（~3.4K tokens） | **120x** |
| 型別解析 | 需外部 LSP process | Hybrid LSP embedded（9 語言） | **零外部依賴** |
| 語意搜尋 | ❌ 只有 regex | ✅ nomic-embed-code bundled | **新功能** |
| 圖查詢 | key-value | ✅ openCypher subset | **新功能** |
| Dead code | ❌ | ✅ Cypher `NOT EXISTS` | **新功能** |
| HTTP route 連結 | ❌ | ✅ Route nodes + HTTP_CALLS | **新功能** |
| 跨 repo 索引 | ❌ | ✅ CROSS_* edges | **新功能** |
| ADR 管理 | ❌ | ✅ manage_adr | **新功能** |
| Graph 可視化 | ❌ | ✅ 3D UI localhost:9749 | **新功能** |
| Team-shared artifact | ❌ | ✅ .codebase-memory/graph.db.zst | **新功能** |
| Agent 編排 | ✅ 70+ sub-tools, workflows | ❌ 純工具無編排 | **Smart 保留** |
| 推理引擎 | ✅ CiT/FoT/Beam/Structured | ❌ | **Smart 保留** |
| 編輯工具 | ✅ fast_apply 10 格式 | ❌ | **Smart 保留** |
| 安全/測試 | ✅ smart_security / smart_test | ❌ | **Smart 保留** |

---

## 分工架構

```
使用者提問
   │
   ▼
Smart MCP（大腦層）
   ├── hybrid_router ──→ 自動判斷走 CBM 還是 Smart 工具
   ├── smart_think    ──→ 推理（CBM 不做推理）
   ├── workflow       ──→ 工作流編排（CBM 不做編排）
   ├── fast_apply     ──→ 編輯（CBM 不做編輯）
   └── smart_test     ──→ 測試（CBM 不做測試）
          │
          ▼
  ╔══════════════════════════════════════╗
  ║  CBM Companion MCP Server（分析層）  ║
  ║  ├─ search_graph    — 結構化搜尋     ║
  ║  ├─ trace_path     — 呼叫鏈追蹤     ║
  ║  ├─ query_graph    — Cypher 查詢     ║
  ║  ├─ get_architecture — 架構總覽      ║
  ║  ├─ detect_changes — 變更影響       ║
  ║  ├─ search_code    — 全文搜尋       ║
  ║  ├─ get_code_snippet — 原始碼讀取   ║
  ║  ├─ manage_adr     — ADR 管理      ║
  ║  └─ index_repository — 專案索引     ║
  ╚══════════════════════════════════════╝
```

---

## 路由對照表

### CBM 優先（取代 Smart 對應工具）

| Smart 既有工具 | CBM 取代工具 | 效益 |
|--------------|-------------|------|
| `smart_grep`（純 regex） | `search_graph`（結構化） + `search_code`（全文） | 速度 + 精度 |
| `code_call_graph`（depth-limited） | `trace_path`（BFS，<1ms） | 快 100x |
| `import_graph`（file-level） | `query_graph`（IMPORTS edges） | 圖查詢更靈活 |
| `code_impact`（file+symbol） | `detect_changes`（diff + blast radius + risk） | 更完整 |
| `arch_overview`（規則式） | `get_architecture`（Louvain clusters） | 自動發現模組 |
| `code_query`/`codebase_index` | `index_repository` + `query_graph` | 158 語言 |

### Smart 保留（CBM 不做的）

| 工具 | 原因 |
|------|------|
| `smart_fast_apply` | CBM 不做編輯 |
| `smart_think` / `smart_deep_think` | CBM 無推理引擎 |
| `smart_security` | CBM 無安全掃描 |
| `smart_test` | CBM 無測試支援 |
| `smart_exa_search` / `smart_exa_crawl` | CBM 無網路搜尋 |
| `smart_lsp` | 互補：CBM 做離線分析，LSP 做即時編輯 |
| `smart_read` | CBM 的 `get_code_snippet` 只能讀已索引函式 |
| `ingest_document` / `academic_*` / `pw_browser` | CBM 無文件/學術/瀏覽器 |

### 混合路由（CBM 分析 + Smart 編排）

```
情境                           流程
─────────────────────────────────────────────────────
架構評估    CBM index → CBM get_architecture → Smart deep_think
變更影響    Smart git diff → CBM detect_changes → Smart impact report
重構        CBM import_graph → CBM trace_path → Smart rename_safety → Smart fast_apply
除錯        CBM trace_path → Smart think(beam) → Smart fast_apply
```

---

## Phase 1：安裝與註冊（0.5 天）

### 1.1 安裝 CBM binary

```bash
# 方式 A：一鍵安裝（推薦）
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash

# 方式 B：手動下載（版本控制）
# 從 https://github.com/DeusData/codebase-memory-mcp/releases/latest 下載
tar xzf codebase-memory-mcp-darwin-arm64.tar.gz
mv codebase-memory-mcp ~/.local/bin/
```

### 1.2 驗證安裝

```bash
codebase-memory-mcp version         # 確認版本
codebase-memory-mcp cli list        # 確認 CLI 可用
echo '{}' | codebase-memory-mcp     # 確認 MCP stdio 正常（應輸出 JSON）
```

### 1.3 註冊到 opencode.json

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "smart-mcp",
  "model": "opencode/big-pickle",
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/Users/wclin/opencode/dev/smart/src/server/index.mjs"],
      "enabled": true
    },
    "cbm": {
      "type": "local",
      "command": ["codebase-memory-mcp"],
      "enabled": true
    }
  }
}
```

### 1.4 測試雙 MCP Server 共存

```
重啟 opencode → /mcp 確認兩個 server 都在
→ Smart MCP: 15+ tools
→ codebase-memory-mcp: 14 tools
→ 驗證兩者不衝突
```

---

## Phase 2：CBM Bridge Skill（2 天）

### 2.1 建立 skill 目錄與檔案

```
.opencode/skills/cbm-bridge/
├── SKILL.md              ← skill 入口
└── cbm-tools-reference.md ← CBM 工具完整參考
```

### 2.2 SKILL.md 核心內容

```markdown
# CBM Bridge Skill

路由規則：當 LLM 需要程式碼分析時，依以下優先級決定用 CBM 還是 Smart 工具：

## 🥇 CBM 優先（先試 CBM，失敗才 fallback）

| LLM 需求 | CBM 工具 | Smart fallback |
|---------|----------|---------------|
| 搜尋函式/類別定義 | `cbm_search_graph` | `smart_grep` |
| 追蹤呼叫鏈 | `cbm_trace_path` | `code_call_graph` |
| 專案架構 | `cbm_get_architecture` | `arch_overview` |
| 變更影響 | `cbm_detect_changes` | `code_impact` |
| 全文搜尋 | `cbm_search_code` | `smart_grep` |
| 死碼檢測 | `cbm_query_graph` (Cypher) | — |

## ✅ Smart 保留（CBM 不做這些）

- `smart_fast_apply` — 所有編輯操作
- `smart_think` / `smart_deep_think` — 推理
- `smart_security` — 安全掃描
- `smart_test` — 測試
- `smart_exa_search` / `smart_exa_crawl` — 網路搜尋
- `smart_read` — 檔案讀取（get_code_snippet 僅限已索引函式）

## 🔄 混合流程

### 架構評估
```
CBM: index_repository → get_architecture
     → 輸出給 Smart: smart_deep_think(template:"architecture")
```

### 重構安全分析
```
CBM: trace_path(direction:"both", depth:3)
     → 輸出給 Smart: code_impact → rename_safety → fast_apply
```

### 除錯
```
CBM: trace_path → search_graph(name_pattern:".*Error.*")
     → Smart: smart_think(mode:"beam", template:"debug") → fast_apply
```
```

### 2.3 註冊 skill 到 Smart MCP

- 在 `src/lib/hybrid-engine.mjs` 的 `DOMAIN_MAP` 中新增 CBM 路由規則
- 在 `config/agents/smart-mcp.md` 中加入 CBM bridge skill 載入指引

---

## Phase 3：hybrid_router 擴充（2 天）

### 3.1 在 `src/lib/hybrid-engine.mjs` 新增 CBM 路由規則

```javascript
// 新增 CBM 路由領域
{
  domain: 'cbm_search',
  keywords: [
    '搜尋程式碼', 'find function', 'find class', 'symbol search',
    'trace call', '誰呼叫', '呼叫鏈', 'callers', 'callees',
    'architecture', '架構', 'module', 'dependency',
  ],
  skill: 'cbm-bridge',
  tools: ['cbm_search_graph', 'cbm_trace_path', 'cbm_get_architecture'],
  description: 'CBM-powered code intelligence — structural search, call chain, architecture',
  workflow: [
    'Load skill: skill("cbm-bridge")',
    'Index if needed: cbm_index_repository',
    'Query: cbm_search_graph / cbm_trace_path / cbm_get_architecture',
    'Fallback: smart_grep if CBM returns empty',
  ],
},
{
  domain: 'cbm_impact',
  keywords: [
    '影響', 'impact', 'blast radius', 'what breaks', 'change analysis',
    '變更', '修改', '風險', '風險評估',
  ],
  skill: 'cbm-bridge',
  tools: ['cbm_detect_changes', 'cbm_trace_path'],
  description: 'CBM-driven impact analysis — git diff mapping + blast radius',
  workflow: [
    'Load skill: skill("cbm-bridge")',
    'Detect changes: cbm_detect_changes',
    'Deep trace: cbm_trace_path',
    'Smart synthesis: smart_think',
  ],
},
{
  domain: 'cbm_cypher',
  keywords: [
    'dead code', 'unused', 'never called', 'unreachable', '死碼',
    'graph query', 'cypher', '圖查詢', '知識圖譜',
  ],
  skill: 'cbm-bridge',
  tools: ['cbm_query_graph'],
  description: 'CBM Cypher queries for advanced code graph analysis',
  workflow: [
    'Load skill: skill("cbm-bridge")',
    'Run Cypher: cbm_query_graph',
    'Synthesize: smart_think',
  ],
},
```

### 3.2 新增 CBM MCP 客戶端呼叫層

建立 `src/plugins/cbm/` 目錄，封裝 CBM 工具呼叫：

```
src/plugins/cbm/
├── cbm-client.mjs       ← MCP 客戶端包裝（透過 child_process 呼叫 CBM CLI）
├── cbm-search.mjs       ← search_graph / search_code 封裝
├── cbm-trace.mjs        ← trace_path 封裝
├── cbm-arch.mjs         ← get_architecture 封裝
├── cbm-impact.mjs       ← detect_changes 封裝
├── cbm-cypher.mjs       ← query_graph 封裝
└── cbm-manifest.json    ← 工具註冊清單
```

### 3.3 CBM Client 核心架構

```javascript
// cbm-client.mjs
import { spawn } from 'node:child_process';

const CBM_BIN = 'codebase-memory-mcp';

export async function cbmCall(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CBM_BIN, ['cli', tool, JSON.stringify(args)]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(`CBM ${tool} failed: ${stderr}`));
    });
  });
}

// 使用範例
// const results = await cbmCall('search_graph', { name_pattern: '.*Handler.*', label: 'Function' });
// const arch = await cbmCall('get_architecture', { repo_path: process.cwd() });
// const changes = await cbmCall('detect_changes', { repo_path: process.cwd() });
```

### 3.4 註冊 CBM 工具到 Smart MCP 工具清單

在 `config/tools/manifest.json` 中新增 cbm_* 工具條目：

| 工具名 | 功能 | 對應 CBM 工具 |
|--------|------|---------------|
| `cbm_index_repository` | 索引專案 | `index_repository` |
| `cbm_search_graph` | 結構化搜尋函式/類別 | `search_graph` |
| `cbm_trace_path` | 呼叫鏈追蹤 | `trace_path` |
| `cbm_detect_changes` | 變更影響分析 | `detect_changes` |
| `cbm_query_graph` | Cypher 圖查詢 | `query_graph` |
| `cbm_get_architecture` | 專案架構總覽 | `get_architecture` |
| `cbm_get_code_snippet` | 取得函式原始碼 | `get_code_snippet` |
| `cbm_search_code` | 全文搜尋 | `search_code` |
| `cbm_manage_adr` | ADR 管理 | `manage_adr` |
| `cbm_list_projects` | 列出已索引專案 | `list_projects` |
| `cbm_index_status` | 索引狀態查詢 | `index_status` |

---

## Phase 4：CKG 後端取代（可選，1-2 週）

### 4.1 評估：取代 `smart_code_query` 的 CKG 後端

```javascript
// 現狀：Smart CKG 使用 ~/.smart/ckg/ SQLite
// 目標：改用 CBM 的 ~/.cache/codebase-memory-mcp/ SQLite

// 步驟：
// 1. 在 CBM client 上層包裝相容 API
// 2. 更新 smart_code_query handler 呼叫 CBM 而非本地 CKG
// 3. 保留既有的 CKG 做為 fallback（當 CBM 未安裝時）

export async function codeQuery({ query, symbol, file, root }) {
  switch (query) {
    case 'build':
      return cbmCall('index_repository', { repo_path: root });
    case 'callers':
      return cbmCall('trace_path', { function_name: symbol, direction: 'inbound' });
    case 'callees':
      return cbmCall('trace_path', { function_name: symbol, direction: 'outbound' });
    case 'symbol':
      return cbmCall('search_graph', { name_pattern: symbol });
    case 'unused-exports':
      return cbmCall('query_graph', {
        query: `MATCH (f:Function) WHERE NOT EXISTS { (f)<-[:CALLS]-() } RETURN f.name`
      });
    default:
      return fallbackLocalCKG({ query, symbol, file, root });
  }
}
```

### 4.2 好處

- 支援從 20 語言擴充到 158 語言
- Cypher 查詢取代 key-value 查詢
- 增量索引（CBM watcher 自動偵測 git diff）
- Team-shared graph artifact（團隊共享索引）

### 4.3 風險

- CBM 是 C binary，不是 Node module（需 child_process 通訊）
- 若 CBM 版本更新 API 變動，需維護相容層
- CBM 未安裝時需 graceful fallback 到本地 CKG

---

## Phase 5：CBM 工具最佳化（2 天）

### 5.1 Session Cache 整合

CBM 查詢結果可 cache 到 Smart 的 session cache，避免重複呼叫：

```javascript
// 在 cbm-client.mjs 中加入 session cache
const cbmCache = new Map();

export async function cbmCallCached(tool, args, ttlMs = 60000) {
  const key = `${tool}:${JSON.stringify(args)}`;
  const cached = cbmCache.get(key);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.data;

  const data = await cbmCall(tool, args);
  cbmCache.set(key, { data, ts: Date.now() });
  return data;
}
```

### 5.2 Lazy Indexing

不要每次查詢都 index，判斷策略：

```javascript
// 查詢前先確認是否已 index
const projects = await cbmCall('list_projects');
const isIndexed = projects.some(p => p.path === root);

if (!isIndexed) {
  // 背景索引（不 blocking 查詢）
  cbmCall('index_repository', { repo_path: root }).catch(() => {});
  // 先用 Smart 既有工具做查詢
  return fallbackSearch();
}
```

### 5.3 Token 優化

CBM 查詢回傳的 JSON 很大（特別是大專案），需要壓縮：

```javascript
// 回傳結果壓縮（參考 Smart 的 L1 壓縮模式）
export function compressCbmResults(data, level = 'standard') {
  if (level === 'minimal') {
    // 只保留 name, file, line
    return data.results.map(r => ({
      n: r.name, f: r.file, l: r.line
    }));
  }
  return data;  // 標準：完整回傳
}
```

---

## 預計效益

| 指標 | 整合前 | 整合後 | 改善 |
|------|--------|--------|------|
| 大型專案索引時間（10K+ files） | ~30s（Smart CKG） | ~3s（CBM） | **10x** |
| 程式碼查詢 token 消耗 | ~412K（逐檔讀取） | ~3.4K（graph query） | **120x** |
| 支援語言數 | ~20 | 158 | **8x** |
| 型別解析 | 需外部 LSP process | CBM Hybrid LSP embedded | **零外部依賴** |
| 新功能（dead code / ADR / Route / Cross-repo） | ❌ 沒有 | ✅ 內建 | **+4 功能** |
| 現有工作流相容性 | — | 不變 | **100% 相容** |

---

## 時間線

| Phase | 內容 | 時間 | 依賴 |
|-------|------|------|------|
| **Phase 1** | 安裝與註冊 | 0.5 天 | 無 |
| **Phase 2** | CBM Bridge Skill | 2 天 | Phase 1 |
| **Phase 3** | hybrid_router 擴充 | 2 天 | Phase 2 |
| **Phase 4** | CKG 後端取代（可選） | 1-2 週 | Phase 3 |
| **Phase 5** | CBM 工具最佳化 | 2 天 | Phase 3 |
| **驗收** | 整合測試 | 1 天 | Phase 3 |
| **總計（最小）** | Phase 1-3 + 驗收 | **5.5 天** | |
| **總計（含 CKG 取代）** | Phase 1-5 + 驗收 | **2-3 週** | |

---

## 風險與緩解

| 風險 | 等級 | 緩解措施 |
|------|------|---------|
| CBM binary 版本更新 API 變動 | 🟡 低 | cbm-client.mjs 封裝層隔離變動 |
| CBM 未安裝時功能降級 | 🟡 低 | graceful fallback 到 Smart 既有工具 |
| dual MCP server 通訊延遲 | 🟢 很低 | stdio 通訊，<1ms 開銷 |
| 使用者學習成本 | 🟢 很低 | hybrid_router 自動路由，使用者無感 |
| 磁碟空間（CBM SQLite） | 🟢 很低 | 常見專案 <100MB |

---

## 驗收標準

- [ ] `opencode.json` 同時啟用 Smart + CBM 兩個 MCP server
- [ ] `skill("cbm-bridge")` 可正確載入路由規則
- [ ] `hybrid_router` 在關鍵字觸發時路由到 CBM 工具
- [ ] CBM 工具查詢結果可被 Smart 工作流正確消費
- [ ] CBM 未安裝時自動 fallback 到 Smart 原有工具
- [ ] 所有既有工作流不受影響
- [ ] `npm test` 全部通過
