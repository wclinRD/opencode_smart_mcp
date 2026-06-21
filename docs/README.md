# Smart MCP — 開發工具集

MCP server 提供 **81 個開發工具**（15 個直接工具 + 66 個子工具），可在 opencode 中直接呼叫。

---

> ⚠️ **跨平台注意事項 — 給 LLM 的強制指令**
>
> 本專案在 **macOS 上開發**，也可在 **Windows 上使用**。LLM 必須自動偵測平台並調整路徑：
>
> | 平台 | 路徑格式範例 | 路徑分隔符號 |
> |------|-------------|-------------|
> | **macOS** | `/Users/您的帳號/opencode_smart_mcp/src/server/index.mjs` | `/` (forward slash) |
> | **Windows** | `C:\\Users\\您的帳號\\opencode_smart_mcp\\src\\server\\index.mjs` | `\\` (double backslash) |
>
> ### LLM 自動修正規則
>
> 當你（LLM）看到以下檔案含有路徑時，**必須自動調整為當前平台格式**：
>
> | 檔案 | 需要修改的欄位 | 說明 |
> |------|--------------|------|
> | `opencode.json` | `mcp.smart.command[1]` | 專案層級的 opencode 設定 |
> | `config/opencode.json` | `mcp.smart.command[1]` | 設定檔範本 |
> | `~/.config/opencode/opencode.jsonc` | `mcp.smart.command[1]` | 全域 opencode 設定 |
>
> **判斷方式**：
> - 若當前環境是 **macOS**（`process.platform === 'darwin'`）→ 使用 `/Users/...` 格式
> - 若當前環境是 **Windows**（`process.platform === 'win32'`）→ 使用 `C:\\Users\\...` 格式
>
> **安裝腳本已自動處理**：`smart-agent/src/install/install-agent.mjs` 和 `src/install/generate-config.mjs` 使用 Node.js `path.resolve()`，自動產生正確的平台路徑。建議 LLM 直接執行安裝腳本而非手動編輯路徑。

---

## 給 LLM / AI Agent 的安裝指引

如果你是 LLM 並被要求安裝這個 MCP server，請依以下步驟操作：

### 步驟 1：clone 專案

```bash
git clone https://github.com/wclinRD/opencode_smart_mcp.git
cd opencode_smart_mcp
```

### 步驟 2：安裝相依套件

```bash
cd .opencode && npm install && cd ..
```

### 步驟 3：確認 server 入口檔存在

```bash
ls src/server/index.mjs
# 應回傳：src/server/index.mjs
```

### 步驟 4：將 MCP 設定加入 opencode.json

在專案根目錄或 `~/.config/opencode/opencode.json` 中，加入以下內容：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/絕對路徑/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

> 注意：`command` 必須使用**絕對路徑**指向 clone 下來的 `src/server/index.mjs`。不可使用相對路徑，否則 opencode 會無法啟動 MCP server。

### 步驟 5：啟用後驗證

啟動 opencode 後檢查 MCP server 是否成功連接：

```bash
opencode mcp list
# smart 應顯示 connected
```

### 錯誤排除

| 錯誤訊息 | 原因 | 修復 |
|----------|------|------|
| `4/5 startup requests failed` | opencode.json 頂層含有非標準欄位 | 移除 `name`、`version`、`description` 等 |
| `ECONNREFUSED` | command 路徑錯誤或 node 找不到 | 檢查 `command[1]` 是否為正確絕對路徑 |
| tool 不存在 | plugin 未正確載入 | 確認 `.opencode/node_modules/` 已安裝 |

---

## 架構

```
smart/
├── src/
│   ├── server/            # MCP server 核心
│   │   ├── index.mjs      # Entry point (JSON-RPC 2.0 over stdio)
│   │   └── loader.mjs     # 自動掃描 & 載入 plugins/ 的 plugin
│   ├── plugins/
│   │   ├── core/          # 15 個 Direct tool（tools/list 直接顯示）
│   │   └── standard/      # 66 個 sub-tool，透過 smart_run router 呼叫
│   ├── cli/               # 各 tool 的 CLI 實作（也可獨立執行）
│   │   ├── contextual-grep.mjs
│   │   ├── thinking.mjs
│   │   └── ...
│   └── lib/
│       └── utils.mjs      # 共用工具函式
├── config/
│   ├── opencode.json      # opencode 整合設定檔
│   └── .opencode-conventions.json
├── docs/
│   ├── README.md
│   ├── plan.md
│   └── todo.md
└── reports/               # 自動產生的報告（coverage, security）
```

## 安裝方式

### 1. 在 opencode 中啟用

編輯 `config/opencode.json`（或放到專案根目錄）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/絕對路徑/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

### 2. 重要注意事項

- `opencode.json` 頂層**不能有** `name`、`version`、`description` 等非標準欄位 — 會導致 opencode 啟動失敗（`4/5 startup requests failed`）
- MCP server name 由 `mcp.smart` 這個 key 決定，無須額外 name 欄位
- `command` 中的路徑必須是**絕對路徑**

### 3. 測試安裝是否成功

啟動 opencode 後，狀態列（status bar）會顯示 `⊙ 1 MCP` 變為 `⊙ 2 MCP`（加上既有的 global MCP servers）。

或是用 `opencode mcp list` 確認 smart 顯示為 connected。

## Direct Tools（15 個，tools/list 直接顯示）

| Tool name | 功能 |
|-----------|------|
| `smart_compact` | 零成本 context 壓縮：分析 tool history 找出可安全捨棄的輸出 |
| `smart_deep_think` | 結構化慢想推理：10 種模板 + 3 種模式（static/iterative/dynamic） |
| `smart_exa_crawl` | 網頁爬取：自動偵測靜態/JS 網站，支援 clean/markdown/chunk |
| `smart_exa_search` | 網路搜尋：自然語言查詢網頁或程式碼 |
| `smart_fast_apply` | 統一編輯引擎：10 種輸入格式 + 6 級 fuzzy matching + atomic multi-file |
| `smart_github_search` | GitHub 程式碼搜尋：過濾 repo/path/language |
| `smart_glob` | 快速檔案 glob 搜尋（rg 底層，上限 100 筆） |
| `smart_grep` | 正規表達式程式碼搜尋（含 scope/import/budget/compress） |
| `smart_learn` | 專案 onboarding：自動分析結構、tech stack、coding conventions |
| `smart_lsp` | 語言伺服器程式碼分析：definition/references/hover/diagnostics |
| `smart_read` | 漸進式檔案讀取：11 種模式 + session cache |
| `smart_rules` | 編輯前必查專案規則（AGENTS.md/.cursorrules） |
| `smart_security` | 安全掃描：credentials/injection/dependency/all |
| `smart_test` | 自動偵測並執行測試（vitest/jest/mocha/ava/node:test） |
| `smart_think` | 對話式推理引擎：cit/beam/forest/structured 四種模式 |

## Sub-Tools（66 個，透過 smart_run router 呼叫）

使用方式：
```
smart_run(tool: "tool_name", args: {...})
```

### 路由與推理

| Tool name | 功能 |
|-----------|------|
| `smart_hybrid_router` | 通用任務路由 — 不確定用哪個工具時的唯一入口 |
| `smart_agent_recommend` | 工具推薦引擎：分析目標回傳最佳工具鏈 |
| `smart_mcts_plan` | MCTS 蒙地卡羅樹搜尋：複雜多步驟任務最佳工具鏈規劃 |
| `smart_model_router` | 多模型協調：依任務類型路由至最佳成本/效能層級 |

### 程式碼分析

| Tool name | 功能 |
|-----------|------|
| `smart_arch_overview` | 一覽專案架構：分層結構、相依違規、關鍵函式、未使用匯出 |
| `smart_code_ast` | AST 查詢：找出 function/class/interface 定義，不靠猜測 |
| `smart_code_call_graph` | 函式呼叫關係追蹤：callers 與 callees |
| `smart_code_impact` | 變更影響範圍分析：重構前風險評估 |
| `smart_code_query` | Code Knowledge Graph（CKG）查詢：持久化專案分析 |
| `smart_code_type_infer` | 型別推斷：精確型別查詢（含泛型、跨檔案型別合約） |
| `smart_codebase_index` | 持久化程式碼符號索引：建立/更新/查詢/repo map |
| `smart_consistency_check` | 機械化一致性檢查：專案結構飄移掃描 |
| `smart_import_graph` | 跨檔案 import 相依分析（支援 JS/TS/Python/Ruby/Rust/Go） |
| `smart_impact_flow` | 完整變更影響分析管線：CKG + LSP + 測試啟發式 |
| `smart_naming` | 命名慣例稽核：kebab/camel/Pascal/UPPER 一致性檢查 |
| `deps` | 相依性稽核：npm audit/outdated/analyze |

### 編輯與重構

| Tool name | 功能 |
|-----------|------|
| `smart_cross_file_edit` | 安全跨檔案編輯：import graph 找相關檔案，批次套用變更 |
| `smart_edit` | 精確字串取代編輯（支援 dry-run、regex、多檔案） |
| `smart_patch_gen` | 從分析工具的輸出自動產生編輯 patch |
| `smart_refactor_plan` | CKG 重構助手：分析現況→產出重構步驟 |
| `smart_rename_safety` | 多檔案 rename：命名衝突、shadowing、不完整取代偵測 |

### 文件處理

| Tool name | 功能 |
|-----------|------|
| `smart_ingest_document` | 二進位文件轉 Markdown（PDF/DOCX/XLSX/PPTX/HTML） |
| `smart_list_documents` | 查詢已匯入文件（跨 session 持久索引） |
| `smart_search_docs` | 全文搜尋已匯入文件內容 |
| `smart_docx_generate` | APA 7 格式自動產生 .docx 文件 |

### Git 工具鏈

| Tool name | 功能 |
|-----------|------|
| `smart_git_commit` | 自動產生 Conventional Commit 並執行提交 |
| `smart_git_context` | 分析 git 狀態：staged/unstaged 變更、diff、impact scope |
| `smart_git_pr` | 自動產生 PR 描述並透過 gh CLI 建立 |
| `smart_git_review` | 程式碼審查：分析 diff 含安全/效能/正確性/風格檢查 |

### 除錯與自動修復

| Tool name | 功能 |
|-----------|------|
| `smart_debug` | 錯誤分析：分類錯誤類型、識別 root cause、建議修復 |
| `smart_error_diagnose` | 對照 failure pattern KB 診斷錯誤，自動儲存成功診斷 |
| `smart_autofix` | 套用修復後自動用 test/lint/security 驗證，失敗可重試 |
| `smart_pr_review` | 自動化 PR review：git diff + security + code impact + LSP |

### 規劃與目標追蹤

| Tool name | 功能 |
|-----------|------|
| `smart_planner` | 目標分解為步驟、追蹤執行狀態、失敗自動重規劃 |
| `smart_goal` | 持久化目標追蹤：設定條件、跨回合自動檢查、完成回報 |
| `smart_memory_store` | 跨 session 記憶：錯誤解法/pattern/學習，模糊+向量混合搜尋 |
| `smart_design_doc` | 產出結構化設計文件（Superpowers brainstorming 整合） |
| `smart_todo` | 待辦事項管理：add/done/list/update，跨 session 持久 |
| `smart_schedule` | 排程週期性背景任務（cron），結果存於 memory |
| `smart_progress` | 查詢長時間任務進度：完成百分比、最近訊息 |
| `setup` | 專案 onboarding：自動偵測類型並產生 opencode 設定 |

### 自動化與工作流

| Tool name | 功能 |
|-----------|------|
| `smart_agent_execute` | 完整工作流自動化：模板選擇→建立→dispatch→重規劃→摘要 |
| `smart_agent_plan` | 複雜目標自動分解為 DAG 步驟（適合小型/弱模型） |
| `smart_compose` | 多工具呼叫管線組合：sequential（pipe）/parallel（fan-out）/conditional |
| `smart_workflow` | 多工具工作流執行：debug/refactor/security/research 等模板 |
| `smart_task_dispatch` | 格式化 task() 呼叫產生器（含 Smart MCP 路由規則注入） |
| `smart_integrate` | Meta 操作：list tools、suggest-commit、generate-pr、diagnose errors |

### 語言專用助手

| Tool name | 功能 |
|-----------|------|
| `smart_py_helper` | Python 專案分析：venv、相依、mypy、現代化建議 |
| `smart_ts_helper` | TypeScript 專案分析：tsconfig strict、unused exports、ESM/CJS |
| `smart_rs_helper` | Rust 專案分析：cargo check/clippy/deps/formatting |

### 資料庫與知識庫

| Tool name | 功能 |
|-----------|------|
| `smart_db` | SQLite 讀寫/遷移/比較 + PostgreSQL 唯讀 |
| `smart_obsidian_write` | 寫入 Obsidian vault（含 YAML frontmatter） |
| `smart_kg` | Knowledge Graph：結構化 entity-relation 儲存與查詢 |
| `smart_adr` | Architecture Decision Record：記錄設計決策原因 |

### 搜尋與研究

| Tool name | 功能 |
|-----------|------|
| `smart_academic_search` | 學術文獻搜尋（OpenAlex/Crossref/Semantic Scholar/Unpaywall） |
| `smart_research` | URL 端到端研究：自動決定爬取深度與策略 |

### 瀏覽器操作

| Tool name | 功能 |
|-----------|------|
| `smart_pw_browser` | 網頁瀏覽器控制：navigate/click/fill/screenshot/execute JS |

### 安全與驗證

| Tool name | 功能 |
|-----------|------|
| `smart_hallucination_check` | LLM 輸出幻覺檢測：fabrication/misattribution/self-contradiction |

### 工具 & 報告

| Tool name | 功能 |
|-----------|------|
| `smart_tool_stats` | 使用統計分析：呼叫次數、錯誤率、趨勢、pattern 發現 |
| `smart_coverage` | 測試覆蓋率分析：未測試 branch/condition/edge case |
| `smart_test_suggest` | 從程式碼分析建議遺漏的測試案例 |
| `smart_report` | 自包含 HTML 報告（test/security/coverage/custom） |
| `smart_diagram` | 產生 Mermaid.js 圖表（flowchart/sequence/class/ER） |
| `smart_diff_view` | 檔案差異比較：unified/side-by-side diff 預覽 |

### 執行環境

| Tool name | 功能 |
|-----------|------|
| `smart_exec` | 沙箱執行程式碼：bash/node/python/deno |

### 學術同儕審查

| Tool name | 功能 |
|-----------|------|
| `Remi` | 學術同儕審查：Nature/Science 等級 Remi 10 點框架 |

## 如何新增 Tool

1. 在 `src/plugins/core/`（native）或 `src/plugins/standard/`（router）下建立 `.mjs` 檔案
2. 遵循 plugin contract：

```js
export default {
  name: 'smart_xxx',             // 唯一 tool 名稱
  description: 'Tool 描述...',      // 給 LLM 看的說明
  inputSchema: {                    // JSON Schema
    type: 'object',
    properties: {
      arg1: { type: 'string', description: '...' },
    },
    required: ['arg1'],
  },
  cli: 'xxx-cli.mjs',              // CLI 實作檔名（相對於 src/cli/）
  mapArgs(a) {                      // args → CLI flags 轉換
    const cli = [];
    if (a.arg1) cli.push('--arg1', String(a.arg1));
    cli.push('--no-color');
    return cli;
  },
};
```

3. CLI 實作放在 `src/cli/xxx-cli.mjs`
4. 重新啟動 opencode，tool 會自動被 `loader.mjs` 載入

## 特殊工具呼叫

列出所有 router tool：
```
smart_run(tool: "help", args: {})
```

查詢特定 tool schema：
```
smart_run(tool: "describe", args: {name: "coverage"})
```

預熱（pre-warm）多個 tools：
```
smart_run(tool: "warmUp", args: {tools: ["coverage", "debug", "naming"]})
```

查詢 server 健康狀態：
```
smart/health
```

查詢 server 使用統計：
```
smart/stats
```
