# Smart MCP — 開發工具集

MCP server 提供 **33 個開發工具** + **專屬 agent personality**，可在 opencode 中直接呼叫。

---

> ⚠️ **跨平台注意事項 — 給 LLM 的強制指令**
>
> 本專案在 **macOS 上開發**，也可在 **Windows 上使用**。LLM 必須自動偵測平台並調整路徑：
>
> | 平台 | 路徑格式範例 | 路徑分隔符號 |
> |------|-------------|-------------|
> | **macOS** | `/Users/dennis/opencode/smart/src/server/index.mjs` | `/` (forward slash) |
> | **Windows** | `C:\\Users\\dennis\\opencode\\smart\\src\\server\\index.mjs` | `\\` (double backslash) |
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

你是一個 LLM 或 AI Coding Agent，以下是如何安裝並設定 Smart MCP 的完整步驟。

### 🚀 快速安裝（完整流程）

#### 步驟 1：Clone 專案

```bash
git clone https://github.com/wclinRD/opencode_smart_mcp.git
cd opencode_smart_mcp
```

#### 步驟 2：安裝相依套件

```bash
cd .opencode && npm install && cd ..
```

#### 步驟 3：設定 MCP Server（opencode.jsonc）

編輯 `~/.config/opencode/opencode.jsonc`，加入：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "smart-mcp",
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/絕對路徑/opencode_smart_mcp/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

> ⚠️ `command[1]` 必須使用**絕對路徑**指向 clone 下來的 `src/server/index.mjs`。不可使用相對路徑！

#### 步驟 4：安裝 Agent Personality（讓 agent 懂得用 33 個工具）

```bash
node smart-agent/src/install/install-agent.mjs
```

這會自動：
1. 複製 `config/agents/smart-mcp.md` → `~/.config/opencode/agents/smart-mcp.md`
2. 設定 `default_agent = "smart-mcp"`
3. 建立記憶目錄 `~/.smart/memory/`

#### 步驟 5：重啟 opencode 並驗證

```bash
opencode mcp list
# smart 應顯示 connected
```

---

### 📦 透過 npm 安裝（smart-agent 套件）

```bash
npm install smart-agent
npm run install-agent   # 安裝 agent personality
```

---

### 🔧 自動安裝腳本（一鍵完成）

```bash
node smart-agent/src/install/install-agent.mjs
```

預設行為：
- 複製 agent 定義檔 → `~/.config/opencode/agents/smart-mcp.md`
- 更新 opencode 設定 → `~/.config/opencode/opencode.jsonc`
- 建立記憶目錄 → `~/.smart/memory/`

使用 `--dry-run` 預覽：

```bash
node smart-agent/src/install/install-agent.mjs --dry-run
```

---

### ✅ 安裝後驗證清單

| 檢查項目 | 指令 | 預期結果 |
|---------|------|---------|
| MCP server 連線 | `opencode mcp list` | smart → connected |
| Agent 定義存在 | `ls ~/.config/opencode/agents/smart-mcp.md` | 檔案存在 |
| 預設 agent | `cat ~/.config/opencode/opencode.jsonc \| grep default_agent` | `"smart-mcp"` |
| 工具可用 | 在 opencode 中呼叫 `smart_grep`、`smart_think` 等 | 正常回應 |

---

### ❌ 錯誤排除

| 錯誤訊息 | 原因 | 修復 |
|---------|------|------|
| `4/5 startup requests failed` | opencode.json 頂層含有非標準欄位 | 移除 `name`、`version`、`description` 等 |
| `ECONNREFUSED` / tool 沒回應 | command 路徑錯誤或 node 找不到 | 檢查 `command[1]` 是否為正確絕對路徑 |
| tool 不存在 / unknown tool | plugin 未正確載入 | 確認 `.opencode/node_modules/` 已安裝 |
| `default_agent not found` | agent 定義檔不在 `~/.config/opencode/agents/` | 執行 `node smart-agent/src/install/install-agent.mjs` |

---

## 🔧 給人類開發者的安裝方式

### 方式一：在 opencode 中啟用（手動）

編輯 `~/.config/opencode/opencode.jsonc`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "smart-mcp",          // 使用 smart-mcp agent 人格
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/絕對路徑/opencode_smart_mcp/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

### 方式二：透過 smart-agent npm 套件

```bash
npm install smart-agent
npm run setup          # postinstall + agent install
```

### 方式三：一鍵腳本

```bash
git clone https://github.com/wclinRD/opencode_smart_mcp.git
cd opencode_smart_mcp
node smart-agent/src/install/install-agent.mjs
```

---

## 🧠 Smart MCP Agent Personality

安裝後，opencode 預設使用 **smart-mcp agent**，它擁有以下能力：

### 工具選擇原則

你（agent）會根據任務類型自動選用最佳工具：

| 任務類型 | 首選工具 |
|---------|---------|
| 搜尋程式碼 | `smart_grep`（附 scope/import context） |
| 理解新專案 | `smart_learn`（語言、結構、慣例） |
| 快速推理 | `smart_think`（hypothesis→verify，取代 sequential-thinking） |
| 深層分析 | `smart_thinking`（9 模板） |
| 安全掃描 | `smart_security`（credentials/injection/path-traversal/dependencies） |
| 執行測試 | `smart_test`（自動偵測框架） |
| 診斷錯誤 | `smart_error_diagnose`（pattern KB + 記憶庫） |
| 跨檔案編輯 | `smart_cross_file_edit`（dry-run 安全） |
| Git 流程 | `smart_git_context` + `smart_git_commit` + `smart_git_pr` + `smart_git_review` |
| 網路研究 | `smart_exa_search` |
| GitHub 探索 | `smart_github_search` |
| 產生圖表 | `smart_diagram` |
| 產生報告 | `smart_report` |

### Workflow 自動化

5+ 步驟的複雜任務自動使用 workflow 引擎：

```bash
smart_workflow create "<目標>" --template <flow> --state wf.json
```

可用模板：`debug-flow`、`refactor-flow`、`security-flow`、`research-flow`、`git-flow`

### Pipeline 組合

自訂工具鏈，支援 seq/par/cond 三種模式：

```bash
smart_compose({ pipeline: [
  { tool: "smart_grep", args: {...}, mode: "seq" },
  { tool: "smart_debug", args: {...}, mode: "seq" },
  { tool: "smart_security", args: {...}, mode: "par" },
]})
```

---

## 🏗 架構

```
opencode_smart_mcp/
├── src/
│   ├── server/                # MCP server 核心
│   │   ├── index.mjs          # Entry point (JSON-RPC 2.0 over stdio)
│   │   └── loader.mjs         # 自動掃描 & 載入 plugins/ 的 plugin
│   ├── plugins/
│   │   ├── core/              # 6 個 native MCP tool（tools/list 直接顯示）
│   │   └── standard/          # 27 個 tool，透過 smart_run router 呼叫
│   ├── cli/                   # 各 tool 的 CLI 實作
│   └── lib/
│       ├── utils.mjs          # 共用工具函式
│       └── compose-engine.mjs # 工具組合引擎
├── config/
│   ├── agents/
│   │   └── smart-mcp.md       # 🤖 Agent personality 定義檔（給 LLM 用）
│   ├── opencode.json          # opencode 整合設定範例
│   └── .opencode-conventions.json
├── smart-agent/               # 📦 npm publish 套件
│   ├── src/
│   │   ├── agent/             # 策略引擎、memory、planner
│   │   ├── install/           # 安裝腳本
│   │   │   ├── postinstall.mjs
│   │   │   ├── install-agent.mjs     # 🆕 Agent 定義安裝器
│   │   │   ├── detect-project.mjs
│   │   │   └── generate-config.mjs   # 🆕 預設使用 smart-mcp agent
│   │   └── index.mjs
│   └── package.json
├── docs/
│   ├── README.md              # 簡化版安裝說明
│   ├── plan.md                # Smart MCP 發展藍圖
│   ├── todo.md                # Smart MCP 待辦事項
│   ├── smart-agent-plan.md    # Smart Agent 發展藍圖
│   └── smart-agent-todo.md    # Smart Agent 待辦事項
└── reports/                   # 自動產生的報告
```

---

## 🛠 Native Tools（6 個，直接呼叫）

| Tool name | 功能 |
|-----------|------|
| `smart_grep` | 用 regex 搜尋程式碼，支援 scope context、import graph |
| `smart_learn` | 分析專案結構、tech stack、相依性、coding conventions |
| `smart_think` | 快速推理引擎（hypothesis → verify → repeat 循環） |
| `smart_security` | 掃描 credentials、injection、path traversal、dependency 漏洞 |
| `smart_test` | 自動偵測並執行測試（vitest/jest/mocha/ava/node:test） |
| `smart_thinking` | 結構化推理，9 種 template + 動態多輪推理 |

## 🛠 Standard Tools（27 個，透過 smart_run router 呼叫）

使用方式：
```
smart_run(tool: "tool_name", args: {...})
```

### 分析工具

| Tool name | 功能 |
|-----------|------|
| `naming` | 分析檔案與識別字命名慣例（kebab/camel/Pascal/UPPER） |
| `coverage` | 分析未測試的 branch/condition/edge case |
| `debug` | 分析 error message / stack trace，分類錯誤類型，建議修復 |
| `error_diagnose` | 對照 failure pattern KB 診斷錯誤，回傳 root cause & 修復 |
| `test_suggest` | 從程式碼分析建議測試案例 |
| `import_graph` | 分析跨檔案 import dependencies，pre-refactor impact check |
| `py_helper` | 分析 Python 專案：venv detect、dep check、mypy、modernization |
| `ts_helper` | 分析 TypeScript 專案：tsconfig strict recs、unused exports、ESM/CJS |

### Git 工具

| Tool name | 功能 |
|-----------|------|
| `git_context` | 分析 staged/unstaged changes、commit diff、import graph impact |
| `git_commit` | 自動生成 conventional commit messages，分析 staged diff |
| `git_pr` | 建立 PR，包含自動生成描述（commit table + file list + diff stat） |
| `git_review` | heuristic 程式碼審查，4 個焦點領域（security/performance/correctness/style） |

### 重構工具

| Tool name | 功能 |
|-----------|------|
| `cross_file_edit` | 安全跨檔案編輯：用 import graph 找相關檔案，apply pattern changes |
| `rename_safety` | 多檔案 rename safety check，detect naming conflicts / shadowing |

### 搜尋工具

| Tool name | 功能 |
|-----------|------|
| `exa_search` | Exa AI search：搜尋網頁、crawl URL、找 code/documentation |
| `github_search` | 搜尋 public GitHub code，filter by repo/path/language |

### 視覺化工具

| Tool name | 功能 |
|-----------|------|
| `diagram` | 產生 Mermaid.js diagram（flowchart/sequence/class/ER） |
| `report` | 產生自包含 HTML report（test/security/coverage/custom） |

### Workflow 工具

| Tool name | 功能 |
|-----------|------|
| `workflow` | 多工具工作流編排：create/report/replan/summary |
| `planner` | 目標分解：9 種任務模板 + DAG + 條件分支 + replan |
| `compose` | 工具組合：seq（順序）/par（平行）/cond（條件）執行 |

### 整合工具

| Tool name | 功能 |
|-----------|------|
| `integrate` | 整合工具：list tools、suggest-commit、generate-pr、diagnose errors |
| `tool_stats` | 追蹤 tool 使用統計：calls、duration、success rate、trends |
| `toonify` | 用 TOON format 壓縮 JSON/CSV/YAML，token 減少 30-65% |

### 開發擴充工具

| Tool name | 功能 |
|-----------|------|
| `context` | Session 狀態管理（summary / findings / history / reset / inject） |
| `memory_store` | 記憶存取（search / store / list / confirm） |

---

## 🤖 如何將 smart-mcp agent 用在自己的專案

如果你想在自己的 opencode 專案中使用 smart-mcp agent personality，不需要整個 clone：

1. 複製 `config/agents/smart-mcp.md` 到 `~/.config/opencode/agents/`
2. 在 opencode.jsonc 中設定 `"default_agent": "smart-mcp"`
3. 確認 MCP server 設定指向你的 smart-mcp 安裝路徑

---

## 📦 如何新增 Tool

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

---

## 🎯 特殊工具呼叫

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

---

## 📋 開發階段

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 0 | thinking.mjs 改造 + smart_think 新增 | ✅ 完成 |
| Phase 1 | 自我學習 + 記憶系統 | ✅ 完成 |
| Phase 2 | 動態規劃引擎 | ✅ 完成 |
| Phase 3 | 狀態管理 + Context 傳遞 | ✅ 完成 |
| Phase 4 | Workflow 引擎（plan-based orchestration） | ✅ 完成 |
| Phase 5 | Workflow 引擎強化（實際執行能力） | ✅ 完成 |
| Phase 6 | Compose 原語 + 平行執行 | ✅ 完成 |
| Phase 7 | Memory 升級（語意記憶 + 模式歸納） | 🔄 進行中 |
| Phase 8 | 程式碼生成輔助 | 📋 規劃中 |
| Phase 9 | 語言助手擴充 | 📋 規劃中 |

詳細規劃請見 [docs/plan.md](./docs/plan.md)。

---

## 📄 相關文件

- [docs/plan.md](./docs/plan.md) — Smart MCP 發展藍圖
- [docs/todo.md](./docs/todo.md) — Smart MCP 待辦事項
- [docs/smart-agent-plan.md](./docs/smart-agent-plan.md) — Smart Agent 發展藍圖
- [docs/smart-agent-todo.md](./docs/smart-agent-todo.md) — Smart Agent 待辦事項
- [config/agents/smart-mcp.md](./config/agents/smart-mcp.md) — Agent personality 定義檔（原始檔）
