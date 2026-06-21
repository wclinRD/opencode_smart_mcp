# 🧅 Smart MCP Server — 架構規劃書

> **版本**: 1.0 | **最後更新**: 2026-06-21
> **專案路徑**: `/Users/wclin/opencode/dev/smart`

---

## 目錄

1. [概觀與哲學](#1-概觀與哲學)
2. [C4 架構總覽](#2-c4-架構總覽)
3. [Context Diagram — 生態系定位](#3-context-diagram--生態系定位)
4. [Container Diagram — 內部容器](#4-container-diagram--內部容器)
5. [Component Diagram — 核心元件](#5-component-diagram--核心元件)
6. [Quality Gates — 品質閘系統](#6-quality-gates--品質閘系統)
7. [三大應用場景](#7-三大應用場景)
8. [技術風險與緩解](#8-技術風險與緩解)
9. [效能與指標](#9-效能與指標)
10. [Extension Points — 擴充點地圖](#10-extension-points--擴充點地圖)
11. [Plugin/Tool Registration Blueprint](#11-plugintool-registration-blueprint)
12. [Installation & Configuration Sync](#12-installation--configuration-sync)

---

## 1. 概觀與哲學

### 是什麼

Smart MCP Server 是一個具備 **79 個開發工具** 的 MCP (Model Context Protocol) Server，專為 AI Agent（opencode / Claude Code 等）提供結構化、高可靠的開發工具層。

### 核心哲學

| 原則 | 說明 |
|------|------|
| 🎯 **最少 token 做最多事** | 所有設計以 token 效率為最優先 |
| 🚦 **閘門驅動** | 三層品質閘（🟥🟨🟩）確保正確性不加倍 token |
| 🧠 **推理分層** | 快思（smart_think）vs 慢想（smart_deep_think） |
| 🔌 **Plugin 優先** | 核心 15 + 標準 68，無需改核心即可擴充 |
| 🛡 **安全內建** | 安全修復前強制 beam search，self-correction loop |

### 規模一覽

| 維度 | 數值 |
|------|------|
| 總行數 | ~12,000+ |
| 主入口 | `index.mjs` (3,705 行) |
| 直接工具 (Layer-1) | 15 個 |
| 子工具 (Layer-2) | 68 個 |
| CLI 實作 | ~30 個 |
| Lib 模組 | 38 個 |
| Agent 策略 | 5 個 |
| D2 架構圖 | 4 張 |

---

## 2. C4 架構總覽

本文件採用 **C4 Model**（Context → Container → Component → Code）四層視角，外加 Quality Gates 作為跨層品質系統：

```
┌─────────────────────────────────────────┐
│  Level 1: Context Diagram               │  ← Smart MCP 在生態系中的定位
│  ┌─────────────────────────────────────┐│
│  │  Level 2: Container Diagram         ││  ← Server 內部的 8 個容器
│  │  ┌───────────────────────────────┐  ││
│  │  │  Level 3: Component Diagram   │  ││  ← Library Layer 38 模組
│  │  │  ┌─────────────────────────┐  │  ││
│  │  │  │  Quality Gates          │  │  ││  ← 跨層品質閘系統
│  │  │  └─────────────────────────┘  │  ││
│  │  └───────────────────────────────┘  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

---

## 3. Context Diagram — 生態系定位

> **層級**: Level 1（System Context）
> **視角**: Smart MCP 在 AI Coding 生態系中的「工具層」角色

![Context Diagram](context_view.svg)

### 角色說明

| 角色 | 形狀 | 職責 |
|------|------|------|
| 👤 **Developer** | Oval | 以自然語言發出任務請求 |
| 🖥 **opencode CLI** | Hexagon | 對話式 AI 程式碼編輯器，協調 user ↔ agent |
| 🤖 **AI Agent (LLM)** | Person | LLM + Smart MCP Agent，判斷任務路由 |
| 🧅 **Smart MCP Server** | Rectangle **粗框** | 79 個開發工具的 MCP Server（核心系統） |
| 🔗 **External Integrations** | Cloud | 網路搜尋 / 爬蟲 / GitHub API |

### 資料流

```
Developer ──自然語言──→ opencode CLI ──轉發──→ AI Agent
                               ↑                    │
                               │                    ▼
                               ←──工具結果──── Smart MCP Server
                                               │
                                               ▼
                                        External Integrations
```

---

## 4. Container Diagram — 內部容器

> **層級**: Level 2（Container）
> **視角**: Smart MCP Server 內部的 8 個容器與互動關係

![Container Diagram](container_view.svg)

### 容器對照

| 容器 | 形狀 | 大小 | 職責 |
|------|------|------|------|
| 📡 **MCP Server** | Rectangle | `index.mjs` (3,705 行) | JSON-RPC 2.0 主入口，接收/回應 MCP 請求 |
| 🔌 **Plugin Loader** | Hexagon | `loader.mjs` | 自動掃描 `plugin-manager/` 載入 plugins |
| ⚡ **Core Plugins** | Circle | 15 工具 | 直接呼叫的 Layer-1 工具（核心） |
| 📦 **Standard Plugins** | Circle | 68 工具 | 透過 `smart_run` 路由的 Layer-2 子工具 |
| 🛠 **CLI Layer** | Parallelogram | ~30 實作 | CLI 命令執行層（bash/node/python/deno 沙箱） |
| 📚 **Library Layer** | Document | 38 模組 | 共享函式庫，7 大群組 |
| 🧠 **Agent Strategies** | Cylinder | 5 模組 | 策略引擎（auto-classifier / model-router 等） |
| 💾 **Memory & Cache** | Stored Data | 4 模組 | Session 持久化、語意快取、嵌入快取、預取 |
| ⚙ **Configuration** | Parallelogram | — | 設定管理（agents / skills / tools / conventions） |

### 啟動流程

```
MCP Server
  └─→ Plugin Loader (啟動時載入)
       ├─→ Core Plugins (15 個直接工具)
       └─→ Standard Plugins (68 個子工具)
              │
              ▼
         CLI Layer (~30 CLI 實作)
              │
              ▼
         Library Layer (38 模組 ─ 7 大群組)
```

---

## 5. Component Diagram — 核心元件

> **層級**: Level 3（Component）
> **視角**: Library Layer 中 38+ 模組的群組與依賴關係

![Component Diagram](component_view.svg)

### 7 大群組

#### ⚙ Core Engines（4 模組）

| 模組 | 職責 | 關鍵依賴 |
|------|------|----------|
| **apply-engine** | 編輯引擎（smart_fast_apply 核心） | → ast-engine |
| **hybrid-engine** | 混合搜尋融合 | → bm25, semantic, hybrid-search |
| **compose-engine** | 工具組合與編排 | — |
| **ckg-engine** | 知識圖譜 (Concept Knowledge Graph) | → memory-db |

#### 🔍 Search & Ranking（6 模組）

| 模組 | 職責 |
|------|------|
| **bm25** | BM25 文本排名演算法 |
| **semantic-search** | 語意搜尋（向量化） |
| **hybrid-search** | RRF (Reciprocal Rank Fusion) 融合 |
| **query-detector** | 查詢類型自動偵測（影響融合權重） |
| **embedding** | 向量嵌入生成 |
| **embedding-cache** | 嵌入快取（避免重複計算） |

#### 💾 Memory & Cache（4 模組）

| 模組 | 職責 |
|------|------|
| **memory-db** | 記憶資料庫（SQLite 持久化） |
| **semantic-cache** | 語意快取（相似查詢命中） |
| **prefetch-engine** | 預取引擎（predictive loading） |
| **cache-manager** | 快取管理策略（LRU/TTL） |

#### 🧠 Reasoning & Safety（4 模組）

| 模組 | 職責 |
|------|------|
| **auto-classifier** | 任務自動分類（→ model-router） |
| **hallucination-judge** | 幻覺檢測（hallucination_check 核心） |
| **safe-handler** | 安全包裝層（credentials/injection 過濾） |
| **model-router** | 模型路由決策（large/small/micro） |

#### 🛠 Infrastructure（10 模組）

| 模組 | 職責 |
|------|------|
| **context-manager** | Session 管理（get/set/reset/merge） |
| **context-budget** | Token 預算控制與警告 |
| **hook-registry** | 生命週期 Hook 註冊系統 |
| **output-pipeline** | 輸出管線（壓縮/格式化） |
| **output-optimizer** | 輸出優化（L0/L1/L2 壓縮） |
| **concurrency-gate** | 並發控制閘 |
| **code-verifier** | 程式碼驗證（braces/balance） |
| **lsp-bridge** | LSP 橋接（TS/Python/Rust/Swift/PHP） |
| **manifest-loader** | manifest 產生與載入 |
| **lenient-json** | 寬鬆 JSON 解析 |

#### 📋 Planning & AST（4 模組）

| 模組 | 職責 |
|------|------|
| **mcts-planner** | MCTS (Monte Carlo Tree Search) 規劃 |
| **refactor-planner** | 重構規劃（import_graph → code_impact） |
| **ast-engine** | AST 引擎（語法樹分析/驗證） |
| **codebase-index** | 程式碼索引（持久化） |

#### 📄 Documents（3 模組）

| 模組 | 職責 |
|------|------|
| **document-ingester** | 文件攝取（PDF/DOCX/XLSX/PPTX/HTML + OCR） |
| **document-registry** | 文件註冊與索引 |
| **db-query** | 資料庫操作（SQLite 讀寫/遷移/比較；PostgreSQL 唯讀） |

### 關鍵依賴鏈

```
apply-engine → ast-engine (編輯驗證)
hybrid-engine → bm25 → semantic → embedding → embedding-cache
              → hybrid-search → query-detector
ckg-engine → memory-db (知識持久化)
auto-classifier → model-router (路由決策)
output-pipeline → output-optimizer (壓縮管線)
context-manager → context-budget (預算控制)
safe-handler → concurrency-gate (並發保護)
```

---

## 6. Quality Gates — 品質閘系統

> **跨層系統**: 適用於所有 C4 層級
> **設計理念**: 機械化一致性 + 三層風險分級

![Quality Gates](quality_gates.svg)

### 閘門對照

| 閘門 | 強度 | 觸發條件 | 動作 |
|------|------|----------|------|
| 🟥 **RED** | Server 強制 | 安全修復 | `smart_think(mode:"beam")` — 多路徑探索 |
| 🟥 **RED** | Server 強制 | 所有編輯前 | `smart_rules({file})` — 專案慣例檢查 |
| 🟨 **YELLOW** | LLM 判斷 | 新功能開發 | `smart_think(mode:"cit")` — 鏈式推理 |
| 🟨 **YELLOW** | LLM 判斷 | 高風險任務 | self-correction loop（hallucination_check） |
| 🟨 **YELLOW** | LLM 判斷 | 跨檔案編輯 | `import_graph` 先行 |
| 🟨 **YELLOW** | LLM 判斷 | 深度分析 | `smart_deep_think`（10 模板） |
| 🟩 **GREEN** | 可跳過 | 例行 grep/test | 直接執行，節省 token |
| 🟩 **GREEN** | 可跳過 | 簡單編輯/查詢 | 直接執行 |

### Self-Correction Loop

```
執行工具 → 產出結果 → hallucination_check(分數<7?) ──是──→ 修正（最多 1 輪）
                          │                              ↑
                          否                              │
                          ▼                              │
                      報告結果 ───────────────────────────┘
```

---

## 7. 三大應用場景

### 場景一：🔧 修 Bug

```
觸發: 使用者回報錯誤
流程:
  1. 🟥 RED Gate: 安全檢查 + smart_rules
  2. ssr(error_diagnose) ── 錯誤診斷
  3. ssr(debug) ── 建立 reproducible case
  4. smart_fast_apply ── 修復
  5. smart_test ── 驗證修復
  6. ssr(memory_store) ── 記錄學習

使用工具: error_diagnose, debug, smart_fast_apply, smart_test, memory_store
平均回合: 4-6 步
```

### 場景二：🏗 重構/新功能

```
觸發: 重構需求或功能新增
流程:
  1. 🟥 RED Gate: smart_rules + 安全檢查
  2. 🟨 YELLOW Gate: smart_think(mode:"cit" or "beam")
  3. ssr(import_graph) ── 依賴分析
  4. ssr(code_impact) ── 影響範圍評估
  5. smart_fast_apply(atomic:true) ── 批次編輯
  6. smart_test ── 完整測試
  7. 🟨 YELLOW Gate: self-correction（若有問題）

使用工具: import_graph, code_impact, smart_think, smart_fast_apply, smart_test
平均回合: 8-12 步
```

### 場景三：🔍 研究/探索

```
觸發: 未知領域探索或技術研究
流程:
  1. 🟩 GREEN Gate: 直接開始
  2. smart_think(mode:"forest") ── 多角度探索
  3. smart_exa_search (compress:"caveman") ── 網路搜尋
  4. smart_exa_crawl (clean+markdown) ── 深度爬取
  5. smart_github_search ── 實例查詢
  6. ssr(planner) ── 結構化規劃
  7. ssr(goal) ── 持久化目標追蹤

使用工具: smart_think (forest), smart_exa_search, smart_exa_crawl,
          smart_github_search, planner, goal
平均回合: 5-8 步
```

---

## 8. 技術風險與緩解

| 風險 | 等級 | 影響 | 緩解策略 |
|------|------|------|----------|
| **Plugin 數量膨脹** | 🟡 Medium | 啟動延遲、記憶體增長 | Plugin Loader 懶載入 + manifest-based 快取 |
| **LSP timeout** | 🟡 Medium | 程式碼分析中斷 | L1 retry（縮小 scope）→ L2 fallback (smart_grep) |
| **Context Budget 爆裂** | 🟡 Medium | Session 中斷 | context-budget 預警 + smart_compact 自動壓縮 |
| **Hybrid search 冷啟動** | 🟢 Low | 新專案初期搜尋品質差 | 語意快取 + prefetch-engine 提前填充 |
| **幻覺漏檢** | 🟡 Medium | 錯誤程式碼被認為正確 | hallucination-judge 多維度驗證（DOI 驗證 + 語意比對） |
| **並發衝突** | 🟢 Low | 編輯覆寫 | concurrent-gate + atomic multi-file + rollback |
| **D2 圖表與實作脫節** | 🟢 Low | 文件過時 | D2 source 與實作同一 repo，版本綁定 |

---

## 9. 效能與指標

### Token 效率

| 模式 | Token 節省 | 適用情境 |
|------|-----------|----------|
| `smart_think(mode:"structured")` | 50-70% | Grammar-Constrained CoT |
| `smart_think(mode:"cit")` | ~70% | BN-DP 自動分支，不確定才分支 |
| `smart_read(mode:"auto")` | 40-80% | 依檔案大小自動選擇 outline/signature/full |
| `smart_fast_apply(unified-diff)` | 40-60% | +/- 行格式取代全文 |
| `smart_exa_search(compress:"caveman")` | 15-30% | 語意壓縮（無文法，保留事實） |
| `smart_compact` | 自由調整 | 零成本 context 壓縮 |

### 推理品質

| 閘門 | 強制率 | 平均額外 Token |
|------|--------|---------------|
| 🟥 RED Gate | 100%（Server 強制） | ~200-500 |
| 🟨 YELLOW Gate | ~40%（LLM 判斷） | ~300-800 |
| 🟩 GREEN Gate | 0%（可跳過） | 0 |

### 圖表渲染

| 圖表 | 渲染時間 | 檔案大小 |
|------|----------|----------|
| Context Diagram | ~64ms | 2.8KB D2 |
| Container Diagram | ~66ms | 3.2KB D2 |
| Component Diagram | ~161ms | 4.5KB D2 |
| Quality Gates | ~84ms | 3.3KB D2 |

---

---

## 10. Extension Points — 擴充點地圖

> 當 LLM 要整合新技術（WebSocket / Redis 快取 / 新的 CLI 命令等），先看這張地圖判斷插在哪裡。

### 擴充點總覽

```
Smart MCP 擴充點一覽：

┌─ 新工具 ──────────────────────────────────────┐
│                                                │
│  plugin-manager/core/  ← Layer-1 直接工具      │
│    ex: smart_read, smart_think                  │
│    特點: MCP 直接暴露，不需路由                  │
│                                                │
│  plugin-manager/standard/  ← Layer-2 子工具     │
│    ex: error_diagnose, import_graph             │
│    特點: 經 smart_run/hybrid_router 路由        │
│                                                │
│  config/skills/  ← Skill 封裝                   │
│    ex: mail-checker, stock-quant-analyzer       │
│    特點: 領域知識封裝，可 standalone 執行        │
│                                                │
├─ 新 Lib 模組 ──────────────────────────────────┤
│                                                │
│  lib/ 底下 7 大群組任一種                       │
│    ex: search-engine/ 新搜尋引擎                │
│        memory-db/ 新記憶後端                    │
│        apply-engine/ 新編輯策略                 │
│                                                │
├─ 新 CLI ───────────────────────────────────────┤
│                                                │
│  cli/ 目錄                                     │
│    ex: ~30 個現有 CLI handler 之一              │
│    特點: bash/node/python/deno 沙箱執行          │
│                                                │
├─ 新 Config/Plugin Loader ──────────────────────┤
│                                                │
│  plugin-manager/loader.mjs  ← 載入邏輯         │
│  config/tools/manifest.json   ← 工具清單       │
│  opencode.json               ← MCP 註冊        │
│  config/agents/smart-mcp.md ← Agent prompt     │
└────────────────────────────────────────────────┘
```

### 擴充判斷樹

```
想加新功能 →
├─ 是開發工具（讀/寫/搜尋/分析）？
│  ├─ 頻繁使用、需直接呼叫？ → Layer-1 direct tool (plugin-manager/core/)
│  └─ 偶爾使用、可路由？   → Layer-2 sub-tool (plugin-manager/standard/)
├─ 是領域知識封裝（股市/天氣/郵件）？
│  └─ → config/skills/ 以 SKILL.md 封裝
├─ 是底層演算法（排序/嵌入/快取）？
│  └─ → lib/ 對應群組模組
├─ 是 CLI 命令（需沙箱執行）？
│  └─ → cli/ + 在 tool 的 handler 註冊
├─ 是外部服務整合（新 API/資料源）？
│  └─ → plugin-manager/standard/ 或 config/skills/
│       取決於是否需要領域知識
└─ 只是設定調整？
   └─ → opencode.json 或 config/agents/smart-mcp.md 或 manifest.json

不確定？→ 參考 hybrid_router 的路由決策
```

### 各擴充點所需檔案對照

| 擴充類型 | 最少需改 | 建議也改 | 需註冊？ |
|----------|---------|---------|---------|
| Layer-1 tool | `plugin-manager/core/xxx.mjs` | `index.mjs` (TOOL_MAP) | ✅ manifest.json |
| Layer-2 sub-tool | `plugin-manager/standard/xxx.mjs` | CLI handler | ✅ hybrid_router |
| Skill | `config/skills/xxx/SKILL.md` | 腳本/設定檔 | `install-skills.sh` 自動 |
| Lib 模組 | `lib/xxx/` | 主入口匯出 | — |
| CLI | `cli/xxx` | tool 的 handler | — |
| Config | `opencode.json` | `config/opencode.json` | 需同步至 `~/.config/opencode/` |

---

## 11. Plugin/Tool Registration Blueprint

### Blueprint A: Layer-1 Direct Tool

> 適合：高頻使用、需直接暴露給 MCP 的工具（如 smart_read, smart_think）

```markdown
步驟:
  1. 在 `plugin-manager/core/` 建立 `my_tool.mjs`

     export async function myTool(args, context) {
       // args: 使用者傳入的參數 (schema 由 manifest 定義)
       // context: { sessionId, config, log }
       const result = await doSomething(args);
       return { result };
     }

  2. 在 `index.mjs` 的 TOOL_MAP 註冊（約第 3500 行）

     import { myTool } from './plugin-manager/core/my_tool.mjs';
     const TOOL_MAP = {
       ...,
       "my_tool": myTool,
     };

  3. 在 `config/tools/manifest.json` 加入 schema

     {
       "name": "my_tool",
       "description": "做某件事",
       "category": "core",
       "domain": "xxx",
       "inputSchema": {
         "type": "object",
         "properties": { ... }
       }
     }

  4. 撰寫 CLI handler（如需 CLI 版本）
     在 `cli/` 目錄建立對應 handler

  5. 測試：node index.mjs 確認工具可被呼叫
```

### Blueprint B: Layer-2 Sub-tool

> 適合：經 `smart_run` 路由的工具（如 error_diagnose, import_graph）

```markdown
步驟:
  1. 在 `plugin-manager/standard/` 建立 `my_subtool.mjs`

     export async function mySubTool(args, context) {
       return { result: ... };
     }

  2. 在 hybrid_router 或對應分類路由註冊
     確定工具可經由 `ssr({tool:"my_subtool", args:{...}})` 呼叫

  3. 更新相關路由分類表（在 smart-mcp.md 的 sub-tools 表格中新增）

  4. CLI handler（選擇性）
```

### Blueprint C: New Skill

> 適合：領域知識封裝（股市查詢、天氣、郵件檢查等）

```markdown
步驟:
  1. 在 `config/skills/` 建立 `my-skill/SKILL.md`

     ---
     description: 做某件事的 skill
     ---
     # My Skill
     ...

  2. 撰寫必要的腳本放在 `config/skills/my-skill/scripts/`

  3. 安裝：bash config/skills/install-skills.sh

  4. 使用：在對話中 AI Agent 會自動載入 skill("my-skill")
```

### Blueprint D: New Lib Module

> 適合：底層演算法或共用邏輯

```markdown
步驟:
  1. 在 `lib/` 建立 `my-module/`
     依功能放在對應群組：
     - 編輯相關 → apply-engine/ 或編輯類
     - 搜尋相關 → search-engine/ 或搜尋類
     - 記憶相關 → memory-db/ 或記憶類
     - 推理相關 → reasoning/ 或推理類
     - 基礎設施 → context-manager/ 或 infra 類

  2. 在主入口匯出（如果需要被工具使用）

  3. 撰寫測試
```

---

## 12. Installation & Configuration Sync

### 安裝架構總覽

```
┌─ 專案目錄 ────────────────────────────────────┐
│ /Users/wclin/opencode/dev/smart/               │
│                                                 │
│  opencode.json  ← 專案級 MCP Server 設定        │
│  config/                                        │
│   ├── opencode.json     ← 共用設定樣板           │
│   ├── agents/           ← Agent definition       │
│   │   └── smart-mcp.md  ← 主要 agent prompt     │
│   ├── skills/           ← Skill 目錄             │
│   │   └── install-skills.sh ← 部署腳本          │
│   └── tools/manifest.json ← 工具清單            │
└─────────────────────────────────────────────────┘
        │
        │ 安裝/同步
        ▼
┌─ 使用者層級 ───────────────────────────────────┐
│ ~/.config/opencode/                             │
│                                                 │
│  opencode.json  ← 使用者級 MCP/Provider 設定     │
│  agents/                                        │
│   ├── smart-mcp.md     ← (由專案同步)           │
│   ├── smart-small.md   ← 輕量版 agent           │
│   └── lite.md          ← 更精簡版               │
│  skills/              ← (由 install-skills.sh 同步)│
│   ├── mail-checker/                             │
│   ├── stock-quant-analyzer/                     │
│   ├── system-design/                            │
│   └── ... (30+ skills)                          │
└─────────────────────────────────────────────────┘
```

### 安裝步驟（首次）

```markdown
1. 複製專案到本機

   git clone <repo-url>
   cd smart

2. 設定 opencode 使用 Smart MCP
   方式 A — 專案級（僅此專案有效）：
     opencode.json 已內建 smart MCP server 設定
     自動生效，無需額外操作

   方式 B — 全域（所有專案有效）：
     將 MCP 設定加入 ~/.config/opencode/opencode.json
     {
       "mcp": {
         "smart": {
           "type": "local",
           "command": ["node", "/path/to/smart/src/server/index.mjs"],
           "enabled": true
         }
       }
     }

3. 安裝 Agent definition

   cp config/agents/smart-mcp.md ~/.config/opencode/agents/
   或在 opencode.json 中設定 "default_agent": "smart-mcp"

4. 安裝 Skills

   bash config/skills/install-skills.sh
   # 建立 symlink，與專案保持同步
   # 或 bash config/skills/install-skills.sh --copy（獨立管理）

5. 驗證安裝

   opencode 啟動後，確認 Smart MCP 工具可用：
   在對話中嘗試呼叫 smart_read 或 smart_think
```

### Configuration Sync 流程

```
專案內檔案                     使用者層級 (~/.config/opencode/)
─────────────────             ─────────────────────────────────
opencode.json
  ├─ smart MCP server ──────→ opencode.json (mcp.smart 區段)
  ├─ default_agent ─────────→ opencode.json (default_agent)
  ├─ agents ────────────────→ agents/smart-mcp.md
  │                            (手動 cp 或由 opencode 自動讀取)
  └─ tools manifest ────────→ Server 啟動時自動載入

config/opencode.json
  └─ 專案共用設定樣板 ──────→ 可作為新專案的起點

config/skills/
  └─ install-skills.sh ─────→ skills/ 目錄
        (symlink 模式)          (自動與專案同步)
        (copy 模式)             (一次性複製，需手動更新)
```

### 設定檔案對照

| 檔案 | 路徑 | 用途 | 同步方式 |
|------|------|------|---------|
| **MCP Server 設定** | `opencode.json` (root) | 定義 Smart MCP server 命令路徑 | 專案級自帶 |
| **全域 MCP 設定** | `~/.config/opencode/opencode.json` | 全 opencode MCP 設定 | 手動或 installer |
| **Agent prompt** | `config/agents/smart-mcp.md` | LLM 行為規則、路由表、閘門 | `cp` 到 `~/.config/opencode/agents/` |
| **工具清單** | `config/tools/manifest.json` | 所有工具的 schema、類別、品質閘 | Server 啟動自動載入 |
| **專案慣例** | `config/.opencode-conventions.json` | 命名/測試/結構慣例 | `smart_rules` 自動讀取 |
| **Skills** | `config/skills/` | 30+ 領域技能封裝 | `install-skills.sh` (symlink/copy) |
| **種子記憶** | `config/seed-memory.json` | 初始記憶資料 | Server 啟動載入 |

### 更新後同步流程

> **關鍵規則**：修改專案內的任何設定檔後，如果該檔案有對應的使用者層級位置，就必須執行同步，否則 opencode 不會看到變更。

```markdown
★ 同步通則：
  修改專案檔案 → 執行對應的同步指令 → 重新啟動 opencode 或 Server

  例外：symlink 模式的 skills 不需任何動作（自動同步）
```

#### 同步對照表

| 你在專案改了什麼 | 同步指令 | 需要重啟？ |
|-----------------|---------|-----------|
| `config/agents/smart-mcp.md`（agent prompt） | `cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md` | ✅ 重啟 opencode |
| `opencode.json`（root，MCP server 設定） | 手動合併 `mcp.smart` 區段到 `~/.config/opencode/opencode.json` | ✅ 重啟 opencode |
| `config/opencode.json`（共用設定樣板） | 手動合併需要的設定到 `~/.config/opencode/opencode.json` | ✅ 重啟 opencode |
| `config/skills/` 下某個 skill（symlink 模式） | ⛔ 無需操作 — symlink 指向專案，自動同步 | ❌ 不需 |
| `config/skills/` 下某個 skill（copy 模式） | `bash config/skills/install-skills.sh --copy` 重新部署 | ❌ 不需 |
| `config/skills/` 新增了 skill 目錄 | `bash config/skills/install-skills.sh` | ❌ 不需 |
| `plugin-manager/core/` 或 `standard/` 新工具 | ⛔ 無需操作 — Server 啟動時自動載入 | ✅ 重啟 MCP Server |
| `config/tools/manifest.json` | ⛔ 無需操作 — Server 啟動時自動載入 | ✅ 重啟 MCP Server |
| `config/seed-memory.json` | ⛔ 無需操作 — Server 啟動時自動載入 | ✅ 重啟 MCP Server |
```

### 三大常見同步情境

```markdown
情境 A：你修改了 agent prompt（smart-mcp.md）
  ┌─ 專案檔案: config/agents/smart-mcp.md
  ├─ 使用者位置: ~/.config/opencode/agents/smart-mcp.md
  ├─ 同步指令:
  │    cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
  └─ 注意: 之後要重啟 opencode 才會生效

情境 B：你新增了一個 skill（例: my-new-skill/）
  ┌─ 專案目錄: config/skills/my-new-skill/SKILL.md
  ├─ 同步指令:
  │    bash config/skills/install-skills.sh
  │    # symlink 模式 → 自動同步，不需再手動操作
  │    # copy 模式    → 需執行 --copy 重新部署
  └─ 注意: 不需重啟，下次對話自動可用

情境 C：你修改了 opencode.json（MCP server 路徑/模型）
  ┌─ 專案檔案: opencode.json (root)
  ├─ 使用者位置: ~/.config/opencode/opencode.json 的 mcp.smart 區段
  ├─ 同步方式: 手動編輯 ~/.config/opencode/opencode.json
  │    找到 mcp.smart 區段，更新 command 路徑或 model
  └─ 注意: 之後要重啟 opencode
```

### 首次安裝流程

```markdown
1. 複製專案到本機

   git clone <repo-url>
   cd smart

2. 設定 opencode 使用 Smart MCP
   方式 A — 專案級（僅此專案有效）：
     opencode.json 已內建 smart MCP server 設定
     自動生效，無需額外操作

   方式 B — 全域（所有專案有效）：
     將 MCP 設定加入 ~/.config/opencode/opencode.json
     {
       "mcp": {
         "smart": {
           "type": "local",
           "command": ["node", "/path/to/smart/src/server/index.mjs"],
           "enabled": true
         }
       }
     }

3. 安裝 Agent definition

   cp config/agents/smart-mcp.md ~/.config/opencode/agents/
   或在 opencode.json 中設定 "default_agent": "smart-mcp"

4. 安裝 Skills

   bash config/skills/install-skills.sh
   # 建立 symlink，與專案保持同步
   # 或 bash config/skills/install-skills.sh --copy（獨立管理）

5. 驗證安裝

   opencode 啟動後，確認 Smart MCP 工具可用：
   在對話中嘗試呼叫 smart_read 或 smart_think
```

### 進階情境

```markdown
情境 D：更新 Smart MCP 版本（git pull）
  1. git pull
  2. 檢查 config/agents/smart-mcp.md 是否有變更
     git diff HEAD~1 -- config/agents/smart-mcp.md
  3. 如果有變更 → 同步 agent prompt：
     cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
  4. 檢查 config/skills/ 是否有新增/修改
     git diff HEAD~1 --stat -- config/skills/
  5. 如果有變更：
     - symlink 模式：skills 自動更新，不需操作
     - copy 模式：bash config/skills/install-skills.sh --copy
  6. 重啟 opencode

情境 E：加到另一個專案使用 Smart MCP
  1. 在該專案的 opencode.json 加入：
     {
       "mcp": {
         "smart": {
           "type": "local",
           "command": ["node", "/path/to/smart/src/server/index.mjs"],
           "enabled": true
         }
       }
     }
  2. 將 agent prompt 複製到該專案或全域 agents/
  3. 無需重新安裝 skills（全域共用）

情境 F：只更新某一個 skill 的內容
  1. 編輯 config/skills/xxx/SKILL.md
  2. symlink 模式：不需任何操作（已指向專案檔案）
  3. copy 模式：bash config/skills/install-skills.sh --copy
```

---

## 附錄 A：相關文件

| 文件 | 路徑 | 說明 |
|------|------|------|
| D2 Source — Context | `docs/diagrams/context_view.d2` | C4 Level 1 |
| D2 Source — Container | `docs/diagrams/container_view.d2` | C4 Level 2 |
| D2 Source — Component | `docs/diagrams/component_view.d2` | C4 Level 3 |
| D2 Source — Quality Gates | `docs/diagrams/quality_gates.d2` | 品質閘系統 |
| SVG 輸出 | `docs/diagrams/*.svg` | 4 張渲染圖 |
| Smart MCP 主入口 | `index.mjs` | Server 核心 (3,705 行) |
| Plugin Loader | `plugin-manager/loader.mjs` | Plugin 動態載入 |
| Layer-1 Direct Tools | `plugin-manager/core/` | 15 個直接工具 |
| Layer-2 Sub-tools | `plugin-manager/standard/` | 68 個子工具 |
| CLI Handlers | `cli/` | ~30 CLI 實作 |
| Lib 模組 | `lib/` | 38 個模組，7 大群組 |
| Project Config | `opencode.json` (root) | MCP Server 設定 + Agent 定義 |
| Shared Config Template | `config/opencode.json` | 專案共用設定樣板 |
| Agent Prompt | `config/agents/smart-mcp.md` | LLM 行為規則、路由表、閘門 (213 行) |
| Tool Manifest | `config/tools/manifest.json` | 所有工具的 schema、類別、品質閘 |
| Project Conventions | `config/.opencode-conventions.json` | 命名/測試/結構慣例 |
| Skills | `config/skills/` | 30+ 領域技能封裝 |
| Skills Installer | `config/skills/install-skills.sh` | Skills 部署腳本 |
| Seed Memory | `config/seed-memory.json` | 初始記憶資料 |
| User Config | `~/.config/opencode/opencode.json` | 使用者級 MCP/Provider 設定 |
| User Agents | `~/.config/opencode/agents/` | Agent definition 安裝位置 |
| Render Script | `config/skills/system-design/scripts/render-diagram.sh` | D2 → SVG CLI |

---

> **本文件使用 C4 Model 撰寫，由 D2 語言渲染為 SVG 圖表。**
> 所有 D2 source 與專案程式碼同倉庫，隨版本迭代更新。
