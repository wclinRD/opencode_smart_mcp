# Smart MCP 安裝指引

## 前置需求

- Node.js >= 18
- npm
- opencode CLI

## 安裝步驟

### 1. Clone 專案

```bash
git clone <repo-url> ~/smart-mcp
cd ~/smart-mcp
npm install
```

### 2. 設定 opencode.json

將 `src/config/opencode.json` 複製到 `~/.config/opencode/opencode.json`（或專案根目錄），
並將 `__SMART_MCP_DIR__` 取代為實際的專案路徑：

```json
{
  "mcp": {
    "smart": {
      "type": "local",
      "command": ["node", "/YOUR_ACTUAL_PATH/smart-mcp/src/server/index.mjs"],
      "enabled": true
    }
  }
}
```

### 3. 安裝 companion skills

```bash
bash config/skills/install-skills.sh
```

可選 `--copy` 參數改為獨立複製模式（不同步專案更新）。

### 4. 環境變數（選配）

| 變數 | 用途 | 預設值 |
|------|------|--------|
| `TOONIFY_PATH` | Toonify MCP 優化工具路徑 | `$HOME/toonify-mcp` |
| `SMART_TOONIFY` | 設為 `0` 關閉 Toonify 優化 | `1`（啟用） |
| `SMI_EMAIL` | 週報用 Apple Mail 過濾寄件人 Email | 無（需設定） |
| `SMART_AGENT_INIT_LEARN` | 安裝時自動學習專案慣例 | `false` |

## 各平台注意事項

### macOS

部分 skills 需要 macOS 特定功能：

| Skill | 依賴 |
|-------|------|
| `meeting-minute/` | ScreenCaptureKit, whisper.cpp (`brew install whisper-cpp`) |
| `mail-checker/` | Apple Mail.app（內建） |
| `podcast-transcript/` | whisper.cpp, ffmpeg (`brew install ffmpeg`) |

### Linux / Windows

macOS 專用技能（`mail-checker`、`meeting-minute`）無法執行。
核心開發工具（程式分析、Git、除錯）跨平台可用。

## 首次啟動檢查

啟動 opencode 後，執行 health check：

```
smart/health
```

預期回傳：
```json
{ "status": "ok", "toolsRegistered": 53, "nativeCount": 6, "routerCount": 47 }
```

若工具數不符，檢查 opencode.json 中的 `command` 路徑是否正確。

## 目錄結構

```
smart-mcp/
├── src/server/index.mjs     ← MCP 伺服器入口（opencode.json 需指向此檔）
├── config/skills/           ← 22 個可安裝的 OpenCode skills
│   ├── install-skills.sh    ← 安裝腳本
│   ├── README.md            ← skills 說明
│   └── */SKILL.md           ← 各 skill 說明
├── src/cli/                 ← CLI 工具（自動被 MCP server 載入）
├── src/plugins/             ← MCP plugin 定義
└── src/lib/                 ← 共用函式庫

  需手動修改的檔案：
  ├── opencode.json           ← MCP command 路徑（依專案位置）
  ├── src/config/opencode.json ← 複製用範本（含 __SMART_MCP_DIR__ 佔位符）
  └── smart-agent/src/config/opencode.json ← 同上
```
