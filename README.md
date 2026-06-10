# Smart MCP — 開發工具集

MCP server 提供 **50+ 開發工具** + **洋蔥架構 agent（8 個 task skill 按需載入）**，可在 opencode 中直接呼叫。

> 🧅 **洋蔥架構**：smart-mcp agent 採用核心極簡設計（187 行，28 個 reflex core 工具 + 任務分類器），收到「爬蟲」「重構」「除錯」等任務時自動載入對應 skill，不再把所有知識塞進 system prompt。

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
>
> ### 🔍 Agent 定義檔換行格式注意
>
> **`config/agents/smart-mcp.md` 的前置 YAML frontmatter 必須使用 LF (`\n`) 換行**，即使是在 Windows 上也是如此。opencode 的 frontmatter parser **不接受 CRLF (`\r\n`)**，若使用 Windows 預設 CRLF 格式會導致 agent 無法被載入，`opencode agent list` 中不會顯示 `smart-mcp` agent。
>
> 當你（LLM）看到以下情況時：
> - `opencode agent list` 沒有 `smart-mcp` 但檔案 `~/.config/opencode/agents/smart-mcp.md` 存在
>
> 請執行（**Windows 上的 LLM 特別注意**）：
> ```bash
> # 將 smart-mcp.md 的 CRLF 換行轉換為 LF
> node -e "
> const fs = require('fs');
> const p = require('os').homedir() + '/.config/opencode/agents/smart-mcp.md';
> let c = fs.readFileSync(p, 'utf-8');
> c = c.replace(/\r\n/g, '\n');
> fs.writeFileSync(p, c, 'utf-8');
> console.log('Converted to LF');
> "
> ```
>
> **判斷方式**：
> - **macOS / Linux**（`process.platform !== 'win32'`）→ git clone 自動使用 LF，無需處理
> - **Windows**（`process.platform === 'win32'`）→ **必須手動轉換為 LF**，否則 opencode 會略過該 agent
>
> **安裝腳本提醒**：`smart-agent/src/install/install-agent.mjs` 使用 `fs.copyFileSync()` 原樣複製檔案，**不會自動轉換換行符號**。若在 Windows 上執行安裝腳本後，請以上述 `node -e` 指令確認 agent 檔案使用 LF 換行。

---

## 📦 相依套件一覽

本專案採用**動態 import**（非強制依賴未安裝時拋清晰提示）。以下列出各功能所需的 npm 套件：

| 套件 | 是否必裝 | 功能 | 安裝大小 |
|------|---------|------|---------|
| `@opencode-ai/plugin` | ✅ **必裝** | MCP server framework（`.opencode/package.json`） | ~2 MB |
| `@mozilla/readability` | ✅ **必裝** | 文章萃取（clean 模式），移除 nav/ads/footer | ~100 KB |
| `linkedom` | ✅ **必裝** | 快速 HTML parser（Readability 底層） | ~200 KB |
| `turndown` | ✅ **必裝** | HTML → Markdown 轉換（markdown 模式） | ~80 KB |
| `playwright` | ⬜ **選裝** | JS 網站渲染（`--render` 模式），需另外 `npx playwright install chromium` | ~300 MB |
| `crawlee` | ⬜ **選裝** | 自適應爬蟲（自動判斷靜態/JS 網站，自動降級 Cheerio/Playwright） | ~50 MB |
| `impers` | ⬜ **選裝** | TLS 指紋模擬繞過 Cloudflare（`--stealth` 模式），自動下載 libcurl-impersonate | ~500 KB |

> 💡 **全部必裝套件安裝完成不到 1 MB**。選裝套件（playwright、crawlee）體積較大，請依需求安裝。
>
> 💡 **本專案所有功能都不需要 API key** — 搜尋使用原生 HTTP fetch，crawl 使用 Readability + Turndown，全部離線可用。

### 一鍵安裝所有必裝套件

```bash
# 安裝 MCP server 框架
cd .opencode && npm install && cd ..

# 安裝文章萃取、Markdown 轉換（Readability + Turndown）
npm install @mozilla/readability@0.6.0 linkedom@0.18.12 turndown@7.2.4
```

### 選裝：Playwright（JS 網站渲染）

```bash
npm install playwright
npx playwright install chromium   # 下載 Chromium 瀏覽器（~300MB）
```

### 選裝：Crawlee（自適應爬蟲）

```bash
# F.3 功能：自動判斷網站靜態/JS，選用 Cheerio 或 Playwright 引擎
npm install crawlee
```

### 選裝：impers（Cloudflare 繞過 — TLS 指紋模擬）

```bash
# F.Stealth 功能：TLS 指紋偽裝繞過 Cloudflare/Akamai 等 bot 防護
# 使用前無需額外設定，首次執行自動下載 libcurl-impersonate 二進位
npm install impers
```

### 選裝：opencode-toon-plugin（Token 優化）

> **⚠️ 若使用 `opencode-toon-plugin`，必須正確設定環境變數，否則所有 `smart_smart_run` 工具都會崩潰！**

`opencode-toon-plugin` 會自動將 bash 指令輸出中的 JSON 編碼為更緊湊的 Toon 格式，節省 token。

```bash
# 安裝
npm install opencode-toon-plugin
```
```json
// 在 opencode.json 的 "plugin" 陣列中加入
"plugin": ["opencode-toon-plugin"]
```

**⚠️ 關鍵設定**：`OPENCODE_TOON_PLUGIN_TOOLS` 只能包含 `bash`，**不可加入任何 MCP 工具名稱**。

```bash
# ✅ 正確 — 只處理 bash 輸出
export OPENCODE_TOON_PLUGIN_TOOLS="bash"

# ❌ 錯誤 — 會導致 smart_smart_run 等 MCP 工具崩潰
export OPENCODE_TOON_PLUGIN_TOOLS="bash,smart_smart_run,smart_grep,smart_learn,..."
```

**錯誤原因**：toon plugin 的 `tool.execute.after` handler 使用 `output.output.trim()` 處理輸出結果。bash 工具回傳 `{ output: "..." }` 格式，但 MCP 工具（如 `smart_smart_run`）回傳的是 `{ content: [{ type: 'text', text: '...' }] }`，沒有 `.output` 屬性。若將 MCP 工具加入清單，每次呼叫都會噴錯：

```
undefined is not an object (evaluating 'output.output.trim')
```

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
# 安裝 MCP server 框架
cd .opencode && npm install && cd ..

# 安裝文章萃取 + Markdown 轉換（必要）
npm install @mozilla/readability@0.6.0 linkedom@0.18.12 turndown@7.2.4
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

> 💡 **安裝後 agent 會自動載入 skills**：你的 `smart-mcp agent` 使用洋蔥架構，收到任務時會自動分類並載入對應 skill（如「爬蟲」→ `smart-mcp-crawl`）。不需額外設定。

#### 步驟 3.5：安裝 Companion Skills（選配）

`config/skills/` 目錄下除了 8 個 `smart-mcp-*.md` 核心 skill 外，還有 **15 個 companion skills**（如 LSP 語法檢查、天氣查詢、台股、週報、郵件助理等）。

```bash
# 安裝所有 companion skills（建立 symlink）
bash config/skills/install-skills.sh

# 或複製模式（獨立管理）
bash config/skills/install-skills.sh --copy
```

#### 步驟 3.6：設定環境變數（選配）

部分工具需要環境變數才能正確運作：

```bash
# Toonify token 優化工具路徑（預設 $HOME/toonify-mcp）
export TOONIFY_PATH="/your/path/toonify-mcp"

# 週報用 — 你的公司 Email（用於 Apple Mail 過濾自己的信件）
export SMI_EMAIL="user@company.com"
```

各工具會自動偵測上述變數，若未設定則使用合理預設值。

#### 步驟 4：安裝 Agent Personality（讓 agent 懂得用 50+ 工具 + 8 個 task skills）

```bash
node smart-agent/src/install/install-agent.mjs
```

這會自動：
1. 複製 `config/agents/smart-mcp.md` → `~/.config/opencode/agents/smart-mcp.md`
2. 複製 `config/skills/smart-mcp-*.md` → `~/.config/opencode/skills/`（8 個 domain skill）
3. 設定 `default_agent = "smart-mcp"`
4. 建立記憶目錄 `~/.smart/memory/`

#### 步驟 5：重啟 opencode 並驗證

```bash
opencode mcp list
# smart 應顯示 connected
```

---

### 🔄 關鍵架構知識：雙路徑必須同步（給 LLM 的強制指令）

本專案有**兩組設定檔**，**修改任一組都必須同步到另一組**：

| 位置 | 用途 | 修改時機 |
|:---|:---|:---|
| **`config/agents/smart-mcp.md`** | 專案內的原始檔（source of truth） | 開發 agent personality 時 |
| **`~/.config/opencode/agents/smart-mcp.md`** | opencode 實際載入的 agent 定義 | 修改原始檔後必須同步 |
| **`config/skills/smart-mcp-*.md`** | 專案內的 8 個原始 skill 檔 | 開發/修改 skill 時 |
| **`~/.config/opencode/skills/smart-mcp-*.md`** | opencode 實際載入的 skill 定義 | 修改原始檔後必須同步 |

#### 同步規則

```bash
# 方向 A：專案原始檔 → opencode 實際載入位置（開發修改後必做）
cp config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
cp config/skills/smart-mcp-*.md ~/.config/opencode/skills/

# 方向 B：opencode 實際載入位置 → 專案原始檔（直接在 ~/.config/opencode 修改時）
cp ~/.config/opencode/agents/smart-mcp.md config/agents/smart-mcp.md
cp ~/.config/opencode/skills/smart-mcp-*.md config/skills/
```

> ⚠️ **LLM 注意**：當你（LLM）被要求修改 agent 行為或 skill 內容時，**必須同時修改兩個位置的對應檔案**。只改其中一邊會導致 opencode 行為與原始碼不一致。每次修改後用 `wc -l` 比對行數確認同步。

#### 哪些檔案需要同步

| 檔案 | 專案路徑 | opencode 路徑 |
|:---|:---|:---|
| Agent 定義 | `config/agents/smart-mcp.md` | `~/.config/opencode/agents/smart-mcp.md` |
| 爬蟲 skill | `config/skills/smart-mcp-crawl.md` | `~/.config/opencode/skills/smart-mcp-crawl.md` |
| 重構 skill | `config/skills/smart-mcp-refactor.md` | `~/.config/opencode/skills/smart-mcp-refactor.md` |
| 除錯 skill | `config/skills/smart-mcp-debug.md` | `~/.config/opencode/skills/smart-mcp-debug.md` |
| Git skill | `config/skills/smart-mcp-git.md` | `~/.config/opencode/skills/smart-mcp-git.md` |
| 安全 skill | `config/skills/smart-mcp-security.md` | `~/.config/opencode/skills/smart-mcp-security.md` |
| 測試 skill | `config/skills/smart-mcp-test.md` | `~/.config/opencode/skills/smart-mcp-test.md` |
| 報告 skill | `config/skills/smart-mcp-report.md` | `~/.config/opencode/skills/smart-mcp-report.md` |
| 語言 skill | `config/skills/smart-mcp-lang.md` | `~/.config/opencode/skills/smart-mcp-lang.md` |

#### 驗證同步一致

```bash
# 比對 agent 定義檔行數
wc -l config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md
# 兩者行數應完全一致

# 比對所有 skill 行數
for f in config/skills/smart-mcp-*.md; do
  name=$(basename "$f")
  echo "$name: project=$(wc -l < "$f")  opencode=$(wc -l < ~/.config/opencode/skills/"$name")"
done
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
| Skills 安裝 | `ls ~/.config/opencode/skills/smart-mcp-*.md` | 8 個 skill 檔案 |
| 預設 agent | `cat ~/.config/opencode/opencode.jsonc \| grep default_agent` | `"smart-mcp"` |
| 工具可用 | 在 opencode 中呼叫 `smart_grep` 等 | 正常回應 |
| Skill 載入 | 說「幫我爬一個網站」應自動載入 crawl skill | 看到 skill 載入訊息 |
| 雙路徑同步 | `wc -l config/agents/smart-mcp.md ~/.config/opencode/agents/smart-mcp.md` | 行數一致 |

---

### ❌ 錯誤排除

| 錯誤訊息 | 原因 | 修復 |
|---------|------|------|
| `4/5 startup requests failed` | opencode.json 頂層含有非標準欄位 | 移除 `name`、`version`、`description` 等 |
| `ECONNREFUSED` / tool 沒回應 | command 路徑錯誤或 node 找不到 | 檢查 `command[1]` 是否為正確絕對路徑 |
| tool 不存在 / unknown tool | plugin 未正確載入 | 確認 `.opencode/node_modules/` 已安裝 |
| `default_agent not found` 或 agent 未出現在 `opencode agent list` 中 | agent 定義檔不存在或 frontmatter 換行格式錯誤（Windows CRLF） | 確認 `~/.config/opencode/agents/smart-mcp.md` 存在，且使用 **LF** 換行（參閱跨平台注意事項） |

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

## 🧅 洋蔥架構（Onion Architecture）

Smart MCP agent 採用**洋蔥架構**：核心極簡 + domain skill 按需載入，而非把所有知識塞進 system prompt。

```
你給任務 → smart-mcp agent (187 行 system prompt)
               │
               ├── 行為閘：檢查該用 MCP 工具還是寫 script？
               ├── Reflex Core：28 個常用工具（🥇9 + 🥈12 + 🥉7，不需 skill）
               │   ├── 搜尋/分析：smart_grep, smart_learn, arch_overview, import_graph
               │   ├── 推理/安全：smart_think, smart_deep_think, smart_security
               │   ├── 編輯：     fast_apply, edit, cross_file_edit
               │   ├── 搜尋網路： exa_search, exa_crawl, github_search, research
               │   ├── 除錯：     error_diagnose, debug
               │   ├── Git/規劃： git_context, planner, workflow, compose
               │   └── Meta：     integrate, hybrid_router, agent_execute
               │
               └── 任務分類器：比對關鍵字 → 自動載入 skill
                      │
                      ├── 「爬取 iyf.tv」  → skill("smart-mcp-crawl")
                      ├── 「重構這個函式」 → skill("smart-mcp-refactor")
                      ├── 「除錯」         → skill("smart-mcp-debug")
                      ├── 「Git commit」   → skill("smart-mcp-git")
                      ├── 「掃描漏洞」     → skill("smart-mcp-security")
                      ├── 「跑測試」       → skill("smart-mcp-test")
                      ├── 「產報告」       → skill("smart-mcp-report")
                      └── 「Python 檢查」   → skill("smart-mcp-lang")
```

**關鍵概念**：
- `config/agents/smart-mcp.md` — **主 agent**（187 行），僅含行為閘 + 28 個 reflex core 工具 + 任務分類器
- `config/skills/smart-mcp-*.md` — **8 個 domain skill**（各 40-118 行），按需載入
- skill 不執行工具，skill 是「知識」— 載入後告訴 agent 正確的流程和工具選擇
- 任務分類器比對使用者請求，自動 `skill("smart-mcp-xxx")` 載入對應知識
- 不確定時 → `hybrid_router(question)` 或 `agent_recommend(goal)` 請求推薦

**與傳統架構對比**：

| | 傳統（改造前） | 洋蔥架構（改造後） |
|--|--------------|-----------------|
| system prompt 大小 | 667 行 / 89KB | **187 行 / 6KB** |
| 記憶負擔 | 40+ 工具平鋪，選擇性遺忘 | 28 個核心工具 + 分類器 |
| 領域知識 | 全部混在 agent 裡 | 分 8 個 skill，按需載入 |
| 遺漏工具 | 容易遺漏不熟的（如 pw_browser） | skill 內有完整 workflow 提示 |

## 🧠 Smart MCP Agent Personality

安裝後，opencode 預設使用 **smart-mcp agent**，它擁有 50+ 開發工具：

### 工具選擇原則

你（agent）會根據任務類型自動選用最佳工具：

| 任務類型 | 🥇 首選工具（依優先級） |
|---------|------------------------|
| 搜尋程式碼 | `smart_grep`（附 scope/import context） |
| 理解新專案 | `smart_learn` + `arch_overview`（語言、結構、架構） |
| 依賴分析 | `import_graph`（跨檔案追蹤） |
| 快速推理 | `smart_think`（hypothesis→verify，取代 sequential-thinking） |
| 深層分析 | `smart_deep_think`（9 模板） |
| 安全掃描 | `smart_security`（credentials/injection/path-traversal/dependencies） |
| 執行測試 | `smart_test`（自動偵測框架） |
| 套用 LLM patch | `fast_apply`（支援 5 格式，省 40-60% token，via `smart_smart_run`） |
| 精確編輯 | `edit`（單檔案 string replace，via `smart_smart_run`） |
| 跨檔案編輯 | `cross_file_edit`（import graph 感知，via `smart_smart_run`） |
| 診斷錯誤 | `error_diagnose`（pattern KB + 記憶庫，via `smart_smart_run`） |
| 除錯分析 | `debug`（根因分析，via `smart_smart_run`） |
| Git 狀態 | `git_context`（staged/unstaged/diff，via `smart_smart_run`） |
| Git 流程 | `git_commit` + `git_pr` + `git_review`（via `smart_smart_run`） |
| 網路搜尋 | `exa_search`（via `smart_smart_run`） |
| 網頁爬取 | `exa_crawl`（clean/markdown/chunk/crawlee，via `smart_smart_run`） |
| 全端研究 | `research`（選 depth 即可，via `smart_smart_run`） |
| 瀏覽器操作 | `pw_browser`（導航、點擊、填表、JS 執行，via `smart_smart_run`） |
| GitHub 探索 | `github_search`（via `smart_smart_run`） |
| 多步驟任務 | `planner` / `workflow` / `compose`（按複雜度選，via `smart_smart_run`） |
| 產生圖表 | `diagram`（via `smart_smart_run`） |
| 產生報告 | `report`（via `smart_smart_run`） |
| Token 優化 | `toonify`（壓縮 JSON/CSV/YAML 30-65%，via `smart_smart_run`） |
| 不確定用什麼 | `integrate list` 或 `hybrid_router`（via `smart_smart_run`） |

### Workflow 自動化

5+ 步驟的複雜任務自動使用 workflow 引擎：

```
smart_smart_run({tool:"workflow", args:{command:"create", goal:"<目標>", template:"<flow>"}})
```

可用模板：`debug-flow`、`refactor-flow`、`security-flow`、`research-flow`、`git-flow`

### Pipeline 組合

自訂工具鏈，支援 seq/par/cond 三種模式：

```
smart_smart_run({tool:"compose", args:{pipeline: [
  { tool: "smart_grep", args: {...}, mode: "seq" },
  { tool: "debug", args: {...}, mode: "seq" },
  { tool: "smart_security", args: {...}, mode: "par" },
]}})
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
│       ├── chunker.mjs        # 內容分塊引擎（heading-based split）
│       ├── quality.mjs        # 內容品質分析 + LLM-facing 使用建議
│       ├── stealth.mjs        # 反爬蟲引擎（TLS impersonation + stealth Playwright）
│       ├── crawler.mjs        # Crawlee 自適應爬蟲（Cheerio → Playwright 降級）
│       ├── cache.mjs          # SQLite 快取層
│       └── compose-engine.mjs # 工具組合引擎
├── config/
│   ├── agents/
│   │   └── smart-mcp.md       # 🤖 Agent personality（洋蔥核心：行為閘 + 分類器）
│   ├── skills/                # 🧅 Domain skills (按需載入)
│   │   ├── smart-mcp-crawl.md    # 爬蟲/SPA 逆向
│   │   ├── smart-mcp-refactor.md # 重構
│   │   ├── smart-mcp-debug.md    # 除錯
│   │   ├── smart-mcp-git.md      # Git 操作
│   │   ├── smart-mcp-security.md # 安全掃描
│   │   ├── smart-mcp-test.md     # 測試
│   │   ├── smart-mcp-report.md   # 報告/圖表
│   │   └── smart-mcp-lang.md     # 語言專案分析
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
| `smart_deep_think` | 結構化推理，9 種 template + 動態多輪推理 |

## 🛠 Standard Tools（30+ 個，透過 smart_smart_run 路由呼叫）

使用方式：
```
smart_smart_run({tool: "tool_name", args: {...}})
```

> 注意：`smart_run` 是 MCP server 內部路由，LLM 呼叫請用 `smart_smart_run({tool, args})`。

### 分析工具

| Tool name | 功能 |
|-----------|------|
| `arch_overview` | **🥇 專案架構總覽**：層次架構、依賴關係、架構違規（進入新專案第一站） |
| `import_graph` | 跨檔案 import dependencies 分析，pre-refactor impact check |
| `naming` | 分析檔案與識別字命名慣例（kebab/camel/Pascal/UPPER） |
| `coverage` | 分析未測試的 branch/condition/edge case |
| `code_ast` | AST 查詢：找函式/類別/介面/型別/變數定義 |
| `code_call_graph` | 函式呼叫關係：callers（誰呼叫我）/ callees（我呼叫誰），可跨檔案 |
| `code_type_infer` | 型別推斷：查詢變數/表達式的精確型別，跨檔案型別驗證 |
| `code_query` | CKG（Code Knowledge Graph）持久化查詢 |
| `code_impact` | 變更影響分析：修改某函式會影響哪些檔案/模組 |
| `impact_flow` | 完整變更影響管線：git diff → CKG call graph → test prediction |
| `hybrid_router` | 混合推理：自動判斷問題類型並路由到最佳分析路徑 |
| `debug` | 分析 error message / stack trace，分類錯誤類型，建議修復 |
| `error_diagnose` | 對照 failure pattern KB 診斷錯誤，回傳 root cause & 修復 |
| `test_suggest` | 從程式碼分析建議測試案例 |
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
| `fast_apply` | **🥇 LLM patch 套用**：支援 5 種輸入格式（unified-diff / lazy / partial / search-replace / whole-file），5 級 fuzzy match，atomic multi-file apply，dry-run 預設安全無副作用 |
| `cross_file_edit` | 安全跨檔案編輯：用 import graph 找相關檔案，apply pattern changes |
| `rename_safety` | 多檔案 rename safety check，detect naming conflicts / shadowing |
| `patch_gen` | 橋接分析工具（error_diagnose/debug/thinking）與編輯工具（fast_apply） |
| `code_ast` | AST 結構查詢：取代盲目 grep 找函式/類別/介面定義 |
| `code_call_graph` | 函式呼叫關係追蹤：callers（誰呼叫我）/ callees（我呼叫誰） |

### 搜尋工具

| Tool name | 功能 |
|-----------|------|
| `exa_search` | 搜尋網頁或程式碼（search + code） |
| `exa_crawl` | 爬取網頁內容，支援 clean / markdown / chunk / crawlee / **stealth** |
| `github_search` | 搜尋 public GitHub code，filter by repo/path/language |

### 研究工具

| Tool name | 功能 |
|-----------|------|
| `research` | Pipeline meta-tool：一條龍研究 URL，只選 depth（quick/deep/exhaustive） |
| `quality` | Output 品質分析：批次分析結果、產生 LLM-facing 使用建議 |

### 瀏覽器工具

| Tool name | 功能 |
|-----------|------|
| `pw_browser` | 操作瀏覽器：導航、點擊、填寫表單、截圖、執行程式碼 |

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
| `agent_execute` | 全自動工作流：選模板 → create → dispatch → replan → summary |
| `agent_plan` | 任務分解器：將模糊目標拆解成 DAG 步驟 |

### 整合工具

| Tool name | 功能 |
|-----------|------|
| `integrate` | 整合工具：list tools、suggest-commit、generate-pr、diagnose errors |
| `tool_stats` | 追蹤 tool 使用統計：calls、duration、success rate、trends |
| `toonify` | 用 TOON format 壓縮 JSON/CSV/YAML，token 減少 30-65% |
| `model_router` | 多模型路由：依任務類型（auto/cheap/balanced/quality）自動選模型 |

### 開發擴充工具

| Tool name | 功能 |
|-----------|------|
| `context` | Session 狀態管理（summary / findings / history / reset / inject） |
| `memory_store` | 記憶存取（search / store / list / confirm） |
| `agent_recommend` | 工具推薦：給目標描述，自動推薦最佳工具組合 |
| `agent_execute` | 複雜任務全自動執行：選擇模板 → 產生計畫 → 分派 → 總結 |
| `agent_plan` | 任務分解：將模糊目標分解為 DAG（有向無環圖）步驟 |

---

## 🤖 如何將 smart-mcp agent 用在自己的專案

如果你想在自己的 opencode 專案中使用 smart-mcp agent personality，不需要整個 clone：

1. 複製 `config/agents/smart-mcp.md` 到 `~/.config/opencode/agents/`
2. 複製 `config/skills/smart-mcp-*.md` 到 `~/.config/opencode/skills/`（8 個 domain skill）
3. 在 opencode.jsonc 中設定 `"default_agent": "smart-mcp"`
4. 確認 MCP server 設定指向你的 smart-mcp 安裝路徑

> ⚠️ **後續維護**：如果你之後修改了 `config/agents/smart-mcp.md` 或 `config/skills/` 下的檔案，**必須手動同步到 `~/.config/opencode/`** 對應路徑。參閱「🔄 關鍵架構知識：雙路徑必須同步」章節。

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
smart_smart_run({tool: "help", args: {}})
```

查詢特定 tool schema：
```
smart_smart_run({tool: "describe", args: {name: "coverage"}})
```

預熱（pre-warm）多個 tools：
```
smart_smart_run({tool: "warmUp", args: {tools: ["coverage", "debug", "naming"]}})
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
