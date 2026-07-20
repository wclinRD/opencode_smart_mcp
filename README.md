# Smart MCP — AI Coding Agent Intelligence Layer

> **用最少 token 做最多事** — 88 個開發工具 + 洋蔥架構 agent，為任何 MCP 相容的 AI coding agent 注入智慧工具層。

> 🧅 **洋蔥架構**：核心極簡（21 個 direct tools + 任務分類器 + 67 個 sub-tools），收到「爬蟲」「重構」「除錯」等任務時自動載入對應 skill，不再把所有知識塞進 system prompt。

---

## 🚀 Quick Start（30 秒）

```bash
# 1. Clone
git clone https://github.com/wclinRD/opencode_smart_mcp.git && cd opencode_smart_mcp

# 2. Install
cd .opencode && npm install && cd ..
npm install @mozilla/readability@0.6.0 linkedom@0.18.12 turndown@7.2.4

# 3. 一鍵安裝 agent + skills
node smart-agent/src/install/install-agent.mjs
```

### 支援的 AI Agent

| Agent | 整合方式 | 狀態 |
|-------|---------|------|
| **opencode** | MCP server + agent personality（完整支援） | ✅ 主要平台 |
| **Claude Code** | MCP server 連接（`mcp_config.json`） | ✅ 可用 |
| **Cursor** | MCP server 連接（Settings → MCP） | ✅ 可用 |
| **任何 MCP 相容 agent** | 標準 MCP 協議 | ✅ 可用 |

---

## 📦 什麼是 Smart MCP？

Smart MCP 是一個 **MCP（Model Context Protocol）伺服器**，提供 88 個智慧化開發工具。它不是 IDE，不是模型，而是**任何 AI coding agent 的工具層** — 讓你的 agent 擁有搜尋、編輯、分析、安全掃描、RTL 程式碼理解、醫學文獻查詢等深度能力。

### 核心差異化

| 能力 | Smart MCP | Claude Code | Cursor |
|------|-----------|-------------|--------|
| 工具數量 | 🥇 **88 個** | ~15 個 | IDE 內建 |
| 模型綁定 | 🥇 **不綁**（任意模型） | 只能用 Claude | 多模型 |
| Token 效率 | 🥇 **核心設計**（壓縮/快取/漸進式） | 無特別機制 | IDE 層級 |
| 垂直領域 | 🥇 **EDA/RTL + 醫學文獻** | 無 | 無 |
| 本地執行 | 🥇 **完全本地**，免 API key | 需連 Anthropic | 需連 Cursor |
| 可擴展性 | 🥇 **洋蔥架構** + 26 skills + plugin | MCP 擴展 | Cursor Rules |

---

## 🧅 洋蔥架構（Onion Architecture）

```
你給任務 → Smart MCP Agent（~597 行 system prompt）
               │
               ├── 行為閘：檢查該用 MCP 工具還是寫 script？
               │
               ├── Direct Tools：21 個（直接呼叫，不需 router）
               │   ├── 搜尋/學習：smart_grep, smart_learn, smart_lsp, smart_rules, smart_glob, smart_read
               │   ├── 網路/檔案：smart_exa_search, smart_exa_crawl, smart_github_search
               │   ├── 推理：     smart_think, smart_deep_think, smart_decompose, smart_decompose_think
               │   ├── 編輯：     smart_fast_apply, smart_edit_chain
               │   ├── 安全/測試：smart_security, smart_test
               │   ├── 管理：     smart_context, smart_compact
               │   ├── 領域：     smart_eda_search, smart_medical_search, smart_rtl_analyze
               │   └── 設定：     smart_rules, smart_config
               │
               └── Sub-tools（67 個，透過 smart_smart_run 路由呼叫）
                      ├── 分析： arch_overview, import_graph, code_call_graph, code_impact, coverage, naming
                      ├── 編輯： cross_file_edit, rename_safety, patch_gen
                      ├── 文件： ingest_document, list_documents, search_docs
                      ├── Git：  git_context, git_commit, git_pr, git_review
                      ├── 記憶： memory_store, kg, obsidian_write, adr
                      ├── 規劃： planner, goal, workflow, compose, agent_execute
                      ├── 搜尋： research, hybrid_router
                      ├── 重構： refactor_plan
                      ├── 瀏覽器： pw_browser
                      └── 其他： debug, error_diagnose, db, exec, model_router, tool_stats
```

**關鍵概念**：
- 21 個 direct tools（直接呼叫）+ 67 個 sub-tools（經 router 路由）= **88 個工具**
- 8 個 domain skill（按需載入）+ 16 個 companion skill（選配）
- 不確定用什麼？→ `hybrid_router` 或 `agent_recommend` 自動推薦

---

## 🔌 安裝指引

> **給 LLM / AI Agent 的強制指令**：你是一個 LLM 或 AI Coding Agent。以下是如何安裝 Smart MCP 的完整步驟。**你必須按順序執行，不可跳步驟。**

### 步驟 0：取得專案路徑

**找出你的 Smart MCP 安裝路徑**（你之後所有設定都會用到）：

```bash
# macOS / Linux
cd opencode_smart_mcp && pwd
# 輸出：/Users/yourname/opencode_smart_mcp

# Windows PowerShell
cd opencode_smart_mcp; pwd
# 輸出：C:\Users\yourname\opencode_smart_mcp

# Windows CMD
cd opencode_smart_mcp && echo %cd%
# 輸出：C:\Users\yourname\opencode_smart_mcp
```

> ⚠️ **路徑對照表** — 後續所有設定中的路徑都要替換成你的實際路徑：

| 項目 | macOS / Linux | Windows |
|------|--------------|---------|
| **專案路徑** | `/Users/yourname/opencode_smart_mcp` | `C:\Users\yourname\opencode_smart_mcp` |
| **路徑分隔符** | `/`（正斜線） | `\`（反斜線） |
| **opencode 設定檔** | `~/.config/opencode/opencode.json` | `%APPDATA%\opencode\opencode.json` |
| **opencode Agent 檔** | `~/.config/opencode/agents/smart-mcp.md` | `%APPDATA%\opencode\agents\smart-mcp.md` |
| **opencode Skills 目錄** | `~/.config/opencode/skills/` | `%APPDATA%\opencode\skills\` |
| **Claude Code MCP** | `~/.claude/mcp.json` | `%USERPROFILE%\.claude\mcp.json` |
| **node 指令** | `node` | `node`（相同） |
| **複製檔案** | `cp` | `copy` |
| **顯示目前路徑** | `pwd` | `echo %cd%`（CMD）或 `pwd`（PowerShell） |

### 步驟 1：安裝相依套件

```bash
cd /Users/yourname/opencode_smart_mcp   # ← 替換成你的實際路徑

# 1a. MCP server 框架
cd .opencode && npm install && cd ..

# 1b. 文章萃取 + Markdown 轉換（必裝，<1MB）
npm install @mozilla/readability@0.6.0 linkedom@0.18.12 turndown@7.2.4
```

> 💡 Windows 用戶：`cd C:\Users\yourname\opencode_smart_mcp`

### 步驟 2：安裝 Agent Personality + Skills

```bash
# macOS / Linux
node ~/opencode_smart_mcp/smart-agent/src/install/install-agent.mjs

# Windows
node C:\Users\yourname\opencode_smart_mcp\smart-agent\src\install\install-agent.mjs
```

這會自動完成：
1. 複製 `config/agents/smart-mcp.md` → `~/.config/opencode/agents/smart-mcp.md`
2. 複製 8 個 domain skill → `~/.config/opencode/skills/`
3. 設定 `default_agent = "smart-mcp"`
4. 建立記憶目錄 `~/.smart/memory/`

### 步驟 3：設定 MCP Server（依你的 Agent 選擇）

#### 選擇 A：opencode（主要平台）

編輯 opencode 設定檔（路徑見上方對照表），**將以下內容合併進去**（不要覆蓋其他設定）：

**macOS / Linux** — `~/.config/opencode/opencode.json`：

```jsonc
{
  // ... 你原本的設定保持不動 ...
  "default_agent": "smart-mcp",
  "plugin": [
    ["/Users/yourname/opencode_smart_mcp/plugin/compaction-fix.js", { "debug": false }]
  ],
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/Users/yourname/opencode_smart_mcp/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

**Windows** — `%APPDATA%\opencode\opencode.json`：

```jsonc
{
  // ... 你原本的設定保持不動 ...
  "default_agent": "smart-mcp",
  "plugin": [
    ["C:\\Users\\yourname\\opencode_smart_mcp\\plugin\\compaction-fix.js", { "debug": false }]
  ],
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "C:\\Users\\yourname\\opencode_smart_mcp\\src\\server\\index.mjs"],
      "enabled": true
    }
  }
}
```

> ⚠️ **opencode 額外步驟**：Smart MCP 有兩組設定檔必須同步。每次修改 `config/agents/smart-mcp.md` 或 `config/skills/` 後，必須同步到 `~/.config/opencode/`：
> ```bash
> cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
> cp config/skills/smart-mcp-*.md ~/.config/opencode/skills/
> cp plugin/compaction-fix.js ~/.config/opencode/plugins/compaction-fix.js
> ```

#### 選擇 B：Claude Code

Claude Code 有兩種設定方式：

**方式 1：專案級 MCP（推薦）**

在你的專案根目錄建立 `.mcp.json`：

**macOS / Linux：**

```json
{
  "mcpServers": {
    "smart": {
      "command": "node",
      "args": ["/Users/yourname/opencode_smart_mcp/src/server/index.mjs"]
    }
  }
}
```

**Windows：**

```json
{
  "mcpServers": {
    "smart": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\opencode_smart_mcp\\src\\server\\index.mjs"]
    }
  }
}
```

**方式 2：全域 MCP**

編輯 MCP 設定檔（路徑見上方對照表）：

**macOS / Linux** — `~/.claude/mcp.json`：

```json
{
  "mcpServers": {
    "smart": {
      "command": "node",
      "args": ["/Users/yourname/opencode_smart_mcp/src/server/index.mjs"]
    }
  }
}
```

**Windows** — `%USERPROFILE%\.claude\mcp.json`：

```json
{
  "mcpServers": {
    "smart": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\opencode_smart_mcp\\src\\server\\index.mjs"]
    }
  }
}
```

> 💡 Claude Code 會自動偵測 Smart MCP 的 88 個工具，無需額外設定。

#### 選擇 C：Cursor

在 Cursor Settings → MCP → Add new MCP server，填入：

**macOS / Linux：**

```json
{
  "smart": {
    "command": "node",
    "args": ["/Users/yourname/opencode_smart_mcp/src/server/index.mjs"]
  }
}
```

**Windows：**

```json
{
  "smart": {
    "command": "node",
    "args": ["C:\\Users\\yourname\\opencode_smart_mcp\\src\\server\\index.mjs"]
  }
}
```

#### 選擇 D：其他 MCP Agent

任何支援 MCP 協議的 agent，只需確保 MCP server 指向 Smart MCP 的 `src/server/index.mjs`（路徑依你的平台替換）。

### 步驟 4：驗證安裝

```bash
# 驗證 1：node 能找到（macOS / Windows 通用）
node -e "console.log('✅ Node OK')"

# 驗證 2：MCP server 能啟動
# macOS / Linux
node /Users/yourname/opencode_smart_mcp/src/server/index.mjs --help
# Windows
node C:\Users\yourname\opencode_smart_mcp\src\server\index.mjs --help
# 兩者都應該看到幫助訊息，不會 crash

# 驗證 3（opencode 用戶）：確認 MCP 連線
opencode mcp list
# smart 應顯示 connected
```

### 步驟 5：開始使用

在你的 AI agent 中說：
- 「幫我分析這個專案的架構」→ 自動使用 `smart_learn` + `arch_overview`
- 「搜尋 XXX 相關的程式碼」→ 自動使用 `smart_grep`
- 「幫我爬一個網站」→ 自動載入 crawl skill
- 「安全掃描這個專案」→ 自動使用 `smart_security`

---

### ❌ 常見錯誤排除

| 錯誤訊息 | 原因 | 修復 |
|---------|------|------|
| `ECONNREFUSED` / tool 沒回應 | `command` 路徑錯誤或 node 找不到 | 檢查 JSON 中的路徑是否為正確絕對路徑 |
| `4/5 startup requests failed` | opencode.json 頂層含有非標準欄位 | 只保留 `$schema`、`default_agent`、`plugin`、`mcp` |
| `default_agent not found` | agent 定義檔不存在或 CRLF 換行 | 確認 `~/.config/opencode/agents/smart-mcp.md` 存在且使用 LF 換行 |
| Compaction 後 LLM 忘記在做什麼 | compaction-fix plugin 未安裝 | 確認 plugin 路徑正確且 opencode.json 的 plugin 陣列包含它 |
| Windows 上 agent 未載入 | CRLF 換行問題 | 執行下方 CRLF 修復指令 |

---

### 🔄 opencode 用戶：雙路徑同步規則

> 🟥 **強制規則**：opencode 有兩組設定檔，**修改任一組都必須同步到另一組**。

| 檔案 | 專案原始檔（source of truth） | opencode 實際載入位置 |
|------|-----|-----|
| Agent 定義 | `config/agents/smart-mcp.md` | `~/.config/opencode/agents/smart-mcp.md` |
| Skills | `config/skills/smart-mcp-*.md` | `~/.config/opencode/skills/smart-mcp-*.md` |
| Plugin | `plugin/compaction-fix.js` | `~/.config/opencode/plugins/compaction-fix.js` |

**macOS / Linux：**

```bash
# 方向 A：修改專案原始檔後，同步到 opencode
cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
cp config/skills/smart-mcp-*.md ~/.config/opencode/skills/
cp plugin/compaction-fix.js ~/.config/opencode/plugins/compaction-fix.js

# 方向 B：直接在 ~/.config/opencode 修改後，同步回專案
cp ~/.config/opencode/agents/smart-mcp.md config/agents/smart-mcp.md
cp ~/.config/opencode/skills/smart-mcp-*.md config/skills/
cp ~/.config/opencode/plugins/compaction-fix.js plugin/compaction-fix.js

# 驗證同步一致（兩者行數應相同）
wc -l config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
```

**Windows（PowerShell）：**

```powershell
# 方向 A：修改專案原始檔後，同步到 opencode
copy config\agents\smart-mcp.md %APPDATA%\opencode\agents\smart-mcp.md
copy config\skills\smart-mcp-*.md %APPDATA%\opencode\skills\
copy plugin\compaction-fix.js %APPDATA%\opencode\plugins\compaction-fix.js

# 方向 B：直接在 %APPDATA%\opencode 修改後，同步回專案
copy %APPDATA%\opencode\agents\smart-mcp.md config\agents\smart-mcp.md
copy %APPDATA%\opencode\skills\smart-mcp-*.md config\skills\
copy %APPDATA%\opencode\plugins\compaction-fix.js plugin\compaction-fix.js

# 驗證同步一致（兩者行數應相同）
(Get-Content config\agents\smart-mcp.md).Count
(Get-Content %APPDATA%\opencode\agents\smart-mcp.md).Count
```

> ⚠️ **Windows 用戶特別注意**：`config/agents/smart-mcp.md` 的 YAML frontmatter 必須使用 **LF (`\n`) 換行**。opencode 的 frontmatter parser **不接受 CRLF (`\r\n`)**。git clone 在 macOS/Linux 自動使用 LF；Windows 上若 `core.autocrlf=true` 會轉成 CRLF，導致 agent 無法載入。安裝腳本使用 `fs.copyFileSync()` 不會自動轉換，請手動確認。

**修復 CRLF（Windows 用戶必做）：**

```powershell
# PowerShell — 將 opencode agents 目錄下的所有 .md 檔案轉為 LF
Get-ChildItem "$env:APPDATA\opencode\agents\*.md" | ForEach-Object {
  $c = [IO.File]::ReadAllText($_.FullName)
  $c = $c.Replace("`r`n", "`n")
  [IO.File]::WriteAllText($_.FullName, $c)
  Write-Host "Fixed: $($_.Name)"
}
```

```bash
# macOS / Linux — 通常不需要，但若意外混入 CRLF 可用此指令修復
sed -i '' 's/\r$//' ~/.config/opencode/agents/smart-mcp.md
```

---

### 📦 選配：安裝 Companion Skills（+16 個工具）

```bash
# macOS / Linux
bash ~/opencode_smart_mcp/config/skills/install-skills.sh

# 或複製模式（獨立管理）
bash ~/opencode_smart_mcp/config/skills/install-skills.sh --copy

# Windows — 在 Git Bash 或 WSL 中執行（安裝腳本依賴 bash）
cd C:\Users\yourname\opencode_smart_mcp
bash config/skills/install-skills.sh
```

### 📦 選配：安裝選裝套件

```bash
# Playwright（JS 網站渲染，~300MB）
npm install playwright && npx playwright install chromium

# Crawlee（自適應爬蟲，自動判斷靜態/JS 網站）
npm install crawlee

# impers（TLS 指紋模擬，繞過 Cloudflare，首次執行自動下載）
npm install impers
```

> 💡 **本專案所有核心功能都不需要 API key** — 搜尋使用原生 HTTP fetch，crawl 使用 Readability + Turndown，全部離線可用。

---

## 🛠 工具一覽（88 個）

### Direct Tools（21 個，直接呼叫）

| Tool | 功能 |
|------|------|
| `smart_grep` | 程式碼搜尋（regex + scope context + import graph + BM25） |
| `smart_read` | 🥇 漸進式檔案讀取：11 種模式（auto/outline/signatures/symbol/explain/range/full/batch/project/image/directory），Session cache |
| `smart_glob` | 🥇 快速檔案匹配（glob 模式，支援多 pattern） |
| `smart_learn` | 專案結構分析（語言、tech stack、相依性、coding conventions） |
| `smart_lsp` | Type-aware 程式碼理解：definition / references / hover / diagnostics / symbols / code_action |
| `smart_rules` | 查詢專案規則（AGENTS.md / .cursorrules）— 編輯前必查 |
| `smart_fast_apply` | 🥇 統一編輯工具：10 格式 + 6 級 fuzzy match + atomic multi-file |
| `smart_edit_chain` | 🥇 批次編輯鏈：1 次 MCP 呼叫完成 N 筆編輯（省 40-60% token） |
| `smart_exa_search` | 🥇 網路搜尋（Exa 引擎，含 caveman 壓縮、highlights、domain filter） |
| `smart_exa_crawl` | 🥇 網頁爬取（clean/markdown/chunk/crawlee/render） |
| `smart_github_search` | 🥇 GitHub 程式碼搜尋（filter by repo/language） |
| `smart_think` | 快速推理（hypothesis → verify，mode: cit/beam/forest/structured） |
| `smart_deep_think` | 結構化深度推理（10 種 template + 動態多輪） |
| `smart_decompose` | 小模型推理 scaffold（任務分解 + 工具引導 + 循環檢測） |
| `smart_decompose_think` | 小模型 think↔tool 迴圈（FR-CoT + budget auto-detect） |
| `smart_security` | 安全掃描（credentials / injection / path traversal / dependencies） |
| `smart_test` | 自動偵測並執行測試（vitest/jest/mocha/ava/node:test） |
| `smart_context` | Session 管理（summary / findings / history / budget） |
| `smart_compact` | 零成本 context 壓縮（分析工具歷史，安全釋放 token） |
| `smart_config` | Runtime 設定（modelSize/mode/debug/timeoutMs） |
| `smart_eda_search` | 🥇 EDA 領域知識引擎（55+ 工具索引、11 個 cell flow stages） |
| `smart_medical_search` | 🥇 醫學文獻查詢（9 來源、免 API key） |
| `smart_rtl_analyze` | 🥇 RTL 程式碼分析（12 commands：analyze/hierarchy/ports/signals/trace/lint/cdc...） |

### Sub-tools（67 個，透過 `smart_smart_run` 呼叫）

<details>
<summary>點擊展開完整 sub-tool 清單</summary>

#### 分析工具
| Tool | 功能 |
|------|------|
| `arch_overview` | 專案架構總覽（層次架構、依賴關係、架構違規） |
| `import_graph` | 跨檔案 import dependencies 分析 |
| `code_call_graph` | 函式呼叫關係（callers / callees，可跨檔案） |
| `code_impact` | 變更影響分析（修改某函式會影響哪些檔案） |
| `impact_flow` | 完整變更影響管線：git diff → CKG call graph → test prediction |
| `codebase_index` | 持久化程式碼符號索引（build/update/query） |
| `code_ast` | AST 查詢（找函式/類別/介面/型別定義） |
| `code_type_infer` | 型別推斷（查詢變數/表達式的精確型別） |
| `code_query` | CKG（Code Knowledge Graph）持久化查詢 |
| `naming` | 命名慣例分析（kebab/camel/Pascal/UPPER） |
| `consistency_check` | 程式碼一致性檢查 |
| `coverage` | 未測試 branch/condition/edge case 分析 |
| `hybrid_router` | 混合推理：自動判斷問題類型並路由到最佳分析路徑 |
| `debug` | 分析 error message / stack trace，分類錯誤類型 |
| `error_diagnose` | 對照 failure pattern KB 診斷錯誤 |
| `test_suggest` | 從程式碼分析建議測試案例 |

#### Git 工具
| Tool | 功能 |
|------|------|
| `git_context` | 分析 staged/unstaged changes、commit diff |
| `git_commit` | 自動生成 conventional commit messages |
| `git_pr` | 建立 PR（含自動生成描述） |
| `git_review` | heuristic 程式碼審查 |

#### 重構工具
| Tool | 功能 |
|------|------|
| `cross_file_edit` | 安全跨檔案編輯（import graph 感知） |
| `rename_safety` | 多檔案 rename safety check |
| `patch_gen` | 橋接分析工具與編輯工具 |
| `refactor_plan` | CKG 重構助手（API usage → difficulty → migration plan） |

#### 文件工具
| Tool | 功能 |
|------|------|
| `ingest_document` | 文件攝取（PDF/DOCX/XLSX/HTML → Markdown，含 OCR） |
| `list_documents` | 列出已攝取文件 |
| `search_docs` | 全文搜尋已攝取文件內容 |
| `obsidian_write` | 寫入 Obsidian 筆記 |

#### 研究/學術工具
| Tool | 功能 |
|------|------|
| `academic_search` | 學術文獻搜尋（OpenAlex/Crossref/Semantic Scholar） |
| `academic_review` | 學術同儕審查 |
| `hallucination_check` | 輸出真實性驗證（幻覺檢查） |
| `docx_generate` | DOCX 文件生成 |
| `research` | Pipeline meta-tool：一條龍研究（quick/deep/exhaustive） |

#### 視覺化工具
| Tool | 功能 |
|------|------|
| `diagram` | Mermaid.js diagram（flowchart/sequence/class/ER） |
| `report` | 自包含 HTML report |
| `diff_view` | 視覺化 diff 比對 |

#### Workflow/排程工具
| Tool | 功能 |
|------|------|
| `workflow` | 多工具工作流編排（7 種模板） |
| `planner` | 目標分解（9 種任務模板 + DAG） |
| `mcts_plan` | MCTS 蒙地卡羅樹搜索規劃器 |
| `compose` | 工具組合（seq/par/cond） |
| `agent_execute` | 全自動工作流執行 |
| `agent_plan` | 任務分解器 |
| `agent_recommend` | 工具推薦 |
| `schedule` | 排程背景任務（cron） |
| `progress` | 長時間任務進度追蹤 |
| `goal` | 持久化目標追蹤（跨回合自動檢查） |
| `autofix` | 自動修復 + verify |
| `todo` | 待辦事項管理 |

#### 整合工具
| Tool | 功能 |
|------|------|
| `integrate` | 整合工具（list tools / suggest-commit / diagnose） |
| `tool_stats` | 工具使用統計 |
| `model_router` | 多模型路由（auto/cheap/balanced/quality） |
| `db` | 唯讀 SQL 查詢（SQLite/PostgreSQL） |
| `kg` | 知識圖譜記憶（entity-relation） |
| `adr` | 架構決策記錄 |
| `memory_store` | 記憶存取（search/store/list） |
| `streaming_progress` | Streaming 進度追蹤 |
| `setup` | 專案偵測 → 自動產生設定 |
| `deps` | 依賴分析（npm audit/outdated） |
| `exec` | 沙箱執行程式碼（bash/node/python/deno） |
| `pw_browser` | 瀏覽器操作（導航/點擊/填表/截圖） |
| `smart_edit` | 基礎編輯工具 |
| `py_helper` | Python 專案分析 |
| `ts_helper` | TypeScript 專案分析 |
| `rs_helper` | Rust 專案分析 |
| `task_dispatch` | 任務分派 |

</details>

---

## 🧠 Skills 生態（8 內建 + 16 選配）

### 內建 Skills（自動載入）

收到對應任務時自動載入，不需要手動設定：

| Skill | 觸發場景 |
|-------|---------|
| `smart-mcp-crawl` | 「爬一個網站」「抓取 SPA」「逆向 JavaScript」 |
| `smart-mcp-debug` | 「幫我除錯」「分析 error」「stack trace」 |
| `smart-mcp-git` | 「commit」「建 PR」「review code」 |
| `smart-mcp-lang` | 「分析語言專案」「Python/TypeScript/Rust 專案」 |
| `smart-mcp-refactor` | 「重構」「改善程式碼品質」「提取函式」 |
| `smart-mcp-report` | 「產生報告」「畫圖表」「visualize」 |
| `smart-mcp-security` | 「安全掃描」「檢查洩漏」「 vulnerability」 |
| `smart-mcp-test` | 「跑測試」「寫測試」「coverage」 |

### 選配 Companion Skills（16 個）

```bash
bash config/skills/install-skills.sh    # 一鍵安裝所有 companion skills
```

包含：LSP 語法檢查、天氣查詢、台股分析、個人助理、會議記錄、週報、郵件助理等。

---

## 🧠 進階特性

### Token 節省引擎

| 機制 | 說明 | 節省 |
|------|------|------|
| `smart_read` auto 模式 | <50 行 full read，50-300 行 signatures，>300 行 outline | 60-80% |
| `smart_grep` budget + compress | token 預算 + L0/L1/L2 壓縮 | 50-70% |
| `smart_exa_search` caveman | 去 stop words + filler phrases | 50-70% |
| `smart_edit_chain` | 1 次 MCP 呼叫完成 N 筆編輯 | 40-60% |
| `smart_fast_apply` unified-diff | 只傳 +/- 行，不傳未變更行 | 40-60% |
| Session cache | 同檔案未變更 = 零 disk read | ~100% |

### 推理引擎

| 模式 | 適用場景 | 特點 |
|------|---------|------|
| `mode:"cit"` | 日常任務（有方向） | BN-DP 自動分支，最省 token（~70%） |
| `mode:"beam"` | 高風險（安全/重構） | 強制多路徑探索 + 信心評分 |
| `mode:"forest"` | 複雜多角度問題 | 多樹 consensus voting |
| `mode:"structured"` | context 緊張 | GOAL/STATE/ALGO/EDGE/VERIFY 五段式（省 50-70%） |

### 垂直領域（Claude Code / Cursor 完全沒有）

| 領域 | 工具 | 能力 |
|------|------|------|
| **EDA/RTL** | `smart_rtl_analyze` + `smart_eda_search` | RTL lint → fix → re-verify；CDC 偵測；synthesis 分析；55+ EDA 工具索引 |
| **醫學** | `smart_medical_search` | PubMed 搜尋 → 全文閱讀 → 幻覺檢查 → DOCX 報告（9 來源，免 API key） |
| **半導體** | RTL + EDA 工具組合 | PDK 選型、cell library 分析、design flow 自動化 |

---

## 📁 架構

```
opencode_smart_mcp/
├── src/
│   ├── server/                # MCP server 核心
│   │   ├── index.mjs          # Entry point (JSON-RPC 2.0 over stdio)
│   │   └── loader.mjs         # 自動掃描 & 載入 plugins/ 的 plugin
│   ├── plugins/
│   │   ├── core/              # 21 個 direct MCP tool（直接呼叫）
│   │   └── standard/          # 67 個 tool，透過 smart_run router 呼叫
│   ├── cli/                   # 各 tool 的 CLI 實作
│   └── lib/                   # 共享函式庫
├── config/
│   ├── agents/
│   │   └── smart-mcp.md       # 🤖 Agent personality（洋蔥核心）
│   └── skills/                # 🧅 8 個 domain skills（按需載入）
├── plugin/
│   └── compaction-fix.js      # Compaction 後自動恢復上下文
├── smart-agent/               # 📦 npm publish 套件
└── docs/                      # 📄 路線圖 + 待辦
```

---

## 🔧 如何新增 Tool

1. 在 `src/plugins/core/`（native）或 `src/plugins/standard/`（router）下建立 `.mjs` 檔案
2. 遵循 plugin contract：

```js
export default {
  name: 'smart_xxx',
  description: 'Tool 描述...',
  inputSchema: { type: 'object', properties: { ... } },
  cli: 'xxx-cli.mjs',
  mapArgs(a) { return cli; },
};
```

3. CLI 實作放在 `src/cli/xxx-cli.mjs`
4. 重新啟動 opencode，tool 會自動被 `loader.mjs` 載入

---

## 📋 開發階段

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 1 | Structured Thinking（Grammar-Constrained CoT） | ✅ |
| Phase 2 | MCTS Tool Planning（蒙地卡羅樹搜尋） | ✅ |
| Phase 3 | Speculative Tool Pre-fetch（推測性工具預取） | ✅ |
| Phase 4 | Cross-Agent Shared Memory（跨 Agent 記憶共享） | ✅ |
| Phase 5 | Execution-Grounded Verification（執行驗證） | ✅ |
| Phase 6-9 | smart_read 漸進式讀取 + Session Cache | ✅ |
| Phase 10-12 | 工具轉移學習 + 語意快取路由 | ✅ |
| Phase 13 | Semantic Tool Router（Embedding 語意匹配） | ⬜ |
| Phase 14 | Self-Reflection（自動學習） | ⬜ |
| Phase 15 | Smart Output Management | ⬜ |
| Phase 16-18 | 平行執行 + 多 Agent 協作 + Skill 自動生成 | ⬜ |
| Phase 19 | Server 重構（3705 行 → 8 檔） | ⬜ |
| Phase 20 | README 工具清單同步 | ⬜ |

詳細規劃：[docs/plan.md](./docs/plan.md)

---

## 📄 相關文件

- [docs/plan.md](./docs/plan.md) — 發展藍圖
- [docs/todo.md](./docs/todo.md) — 實作追蹤
- [docs/smart-agent-plan.md](./docs/smart-agent-plan.md) — Smart Agent 藍圖
- [config/agents/smart-mcp.md](./config/agents/smart-mcp.md) — Agent personality 定義

---

## 📜 License

MIT
