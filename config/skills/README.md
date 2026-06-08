# Smart MCP Companion Skills

此目錄包含 Smart MCP 專案搭配的 OpenCode skills。

## 分類

共有 **23 個 skills**（8 個內建 + 15 個 companion）。

### 🟢 內建 skills（8 個 `smart-mcp-*.md`）
由 Smart MCP 的 MCP 工具直接支援，無需額外安裝即可使用。

| Skill | 用途 | 對應工具 |
|-------|------|---------|
| `smart-mcp-crawl` | 爬蟲 / SPA 逆向工程 | `pw_browser`, `exa_crawl`, `research` |
| `smart-mcp-debug` | 除錯流程 | `error_diagnose`, `debug`, `memory_store`, `fast_apply` |
| `smart-mcp-git` | Git 操作 | `git_context`, `git_commit`, `git_pr`, `git_review` |
| `smart-mcp-lang` | 語言專案健康檢查 | `py_helper`, `ts_helper`, `rs_helper` |
| `smart-mcp-refactor` | 重構工作流 | `import_graph`, `rename_safety`, `code_impact`, `fast_apply` |
| `smart-mcp-report` | 報告與圖表 | `diagram`, `report`, `toonify` |
| `smart-mcp-security` | 安全掃描 | `smart_security`, `fast_apply` |
| `smart-mcp-test` | 測試執行與覆蓋率 | `smart_test`, `coverage`, `test_suggest` |

### 🔵 Companion skills（15 個，來自 `~/.config/opencode/skills/`）
這些是 Smart MCP 專案從使用者環境收集的進階 skill，**需要安裝至 `~/.config/opencode/skills/` 才能使用**。

#### LSP / 語法檢查
| Skill | 用途 |
|-------|------|
| `php-lsp/` | PHP 語法檢查 + intelephense |
| `pyright-lsp/` | Python type checking (pyright) |
| `swift-lsp/` | Swift code intelligence (sourcekit-lsp) |
| `typescript-lsp/` | TypeScript/JS code intelligence |

#### 外部資料
| Skill | 用途 |
|-------|------|
| `weather-forcast/` | openmeteo 天氣查詢 |
| `twse_api/` | 台股資訊查詢 |
| `stock-quant-analyzer/` | 台美股量化評估分析（需 Python 環境） |
| `stock-rating-compare/` | 投顧目標價評等比對（需 Python 環境） |

#### 通訊 / 個人助理
| Skill | 用途 |
|-------|------|
| `mail-checker/` | Apple Mail 今日郵件 + Reminders 匯入 |
| `personal-assistant/` | 一站式個人助理（天氣/郵件/行事曆/股市） |
| `meeting-minute/` | 會議錄音 → whisper 轉錄 → 摘要 |
| `podcast-transcript/` | Podcast 訂閱 → 下載 → 轉錄 → 摘要 |
| `telegram-search/` | Telegram 群組歷史訊息搜尋（需 Telethon） |

#### 報表
| Skill | 用途 |
|------|------|
| `asic1-weekly-report/` | ASIC1 週報 DOCX 產生（需 python-docx） |
| `weekly-report/` | 自動彙整週報寫入 Obsidian |

## 安裝方式

### 自動安裝（推薦）

```bash
# symlink 模式 — skills 與專案保持同步
bash config/skills/install-skills.sh

# 或 copy 模式 — 一次性複製，獨立管理
bash config/skills/install-skills.sh --copy
```

### 手動安裝

```bash
# 單一 skill 安裝
ln -sf "$(pwd)/config/skills/weather-forcast" ~/.config/opencode/skills/weather-forcast

# 或複製
cp -R config/skills/weather-forcast ~/.config/opencode/skills/weather-forcast
```

### 預覽將安裝的 skills

```bash
bash config/skills/install-skills.sh --list
```

## 相依性提醒

部分 skills 需要額外環境才能完整運作：

| Skill | 需要 |
|-------|------|
| `stock-quant-analyzer` | `pip install -r scripts/requirements.txt` |
| `meeting-minute` | whisper.cpp (`brew install whisper-cpp`), Swift |
| `podcast-transcript` | whisper.cpp, ffmpeg |
| `mail-checker` | macOS (Apple Mail.app, AppleScript) |
| `personal-assistant` | 依賴 weather-forcast + mail-checker 等 sub-skills |
| `asic1-weekly-report` | `pip install python-docx` |
| `telegram-search` | `pip install telethon` |

## 目錄結構

```
config/skills/
├── README.md                    ← 本說明
├── install-skills.sh            ← 安裝腳本
├── smart-mcp-*.md (8)           ← 內建 skills
├── php-lsp/                     ← companion skills (15)
├── pyright-lsp/
├── swift-lsp/
├── typescript-lsp/
├── weather-forcast/
├── twse_api/
├── stock-quant-analyzer/
├── stock-rating-compare/
├── mail-checker/
├── personal-assistant/
├── meeting-minute/
├── podcast-transcript/
├── telegram-search/
├── asic1-weekly-report/
├── weekly-report/
└── ...
```
