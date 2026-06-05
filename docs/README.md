# Smart MCP — 開發工具集

MCP server 提供 33+ 個開發工具，可在 opencode 中直接呼叫。

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
│   │   ├── core/          # 6 個 native MCP tool（tools/list 直接顯示）
│   │   └── standard/      # 20 個 tool，透過 smart_run router 呼叫
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

## Native Tools（6 個，直接呼叫）

| Tool name | 功能 |
|-----------|------|
| `smart_grep` | 用 regex 搜尋程式碼，支援 scope context、import graph |
| `smart_learn` | 分析專案結構、tech stack、相依性、coding conventions |
| `smart_think` | 快速推理引擎（hypothesis → verify → repeat 循環） |
| `smart_security` | 掃描 credentials、injection、path traversal、dependency 漏洞 |
| `smart_test` | 自動偵測並執行測試（vitest/jest/mocha/ava/node:test） |
| `smart_thinking` | 結構化推理，9 種 template + 動態多輪推理 |

## 標準 Tools（20 個，透過 smart_run router 呼叫）

使用方式：
```
smart_run(tool: "tool_name", args: {...})
```

| Tool name | 功能 |
|-----------|------|
| `naming` | 分析檔案與識別字命名慣例（kebab/camel/Pascal/UPPER） |
| `coverage` | 分析未測試的 branch/condition/edge case |
| `debug` | 分析 error message / stack trace，分類錯誤類型，建議修復 |
| `error_diagnose` | 對照 failure pattern KB 診斷錯誤，回傳 root cause & 修復 |
| `test_suggest` | 從程式碼分析建議測試案例 |
| `git_context` | 分析 staged/unstaged changes、commit diff、import graph impact |
| `import_graph` | 分析跨檔案 import dependencies，pre-refactor impact check |
| `integrate` | 整合工具：list tools、suggest-commit、generate-pr、diagnose errors |
| `cross_file_edit` | 安全跨檔案編輯：用 import graph 找相關檔案，apply pattern changes |
| `rename_safety` | 多檔案 rename safety check，detect naming conflicts / shadowing |
| `diagram` | 產生 Mermaid.js diagram（flowchart/sequence/class/ER） |
| `report` | 產生自包含 HTML report（test/security/coverage/custom） |
| `py_helper` | 分析 Python 專案：venv detect、dep check、mypy、modernization |
| `ts_helper` | 分析 TypeScript 專案：tsconfig strict recs、unused exports、ESM/CJS |
| `tool_stats` | 追蹤 tool 使用統計：calls、duration、success rate、trends |
| `exa_search` | Exa AI search：搜尋網頁、crawl URL、找 code/documentation |
| `github_search` | 搜尋 public GitHub code，filter by repo/path/language |
| `toonify` | 用 TOON format 壓縮 JSON/CSV/YAML，token 減少 30-65% |

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
