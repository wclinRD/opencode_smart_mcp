---
name: personal-assistant
description: 一站掌握天氣、郵件、行事曆、提醒事項、股市、系統狀態、新聞、筆記、Teams — 支援 8 種互動模式與批次收集
license: MIT
metadata:
  author: wclin
  version: 0.1.0
  tags: [assistant, daily, productivity, weather, stock, calendar, mail, news]
  trigger:
    - 個人助理
    - 今天重點
    - 早安
    - 天氣怎樣
    - 今天天氣
    - 股市
    - 股票
    - 大盤
    - 今天有什麼信
    - 郵件
    - 今天行程
    - 行事曆
    - 提醒我
    - 有什麼待辦
    - 系統狀態
    - 磁碟
    - 有什麼新聞
    - 今天新聞
    - 幫我找一下
    - 搜尋
    - 整理重點
    - 摘要
    - 會議準備
    - 提醒我重要郵件
    - 設定
    - 設定個人資訊
    - /assistant
  dependencies:
    skills:
      - weather-forcast
      - mail-checker
      - wiki-query
    python:
      - yfinance
      - feedparser
    apple_script:
      - Calendar.app
      - Reminders.app
      - Notes.app
---

# Personal Assistant Skill

> 一站掌握每日重點 — 天氣、郵件、行事曆、提醒事項、股市、系統、新聞、筆記、wiki 知識。

## 功能概述

Personal Assistant 是 OpenCode Skill，從 10+ 來源批次收集資訊，提供 8 種互動模式。

**資料來源總覽**：

| # | 來源 | 方式 | 批次 | 耗時 |
|---|------|------|------|------|
| 1 | 系統狀態 (system.sh) | Bash script | 1 (系統層) | ~1s |
| 2 | 行事曆 (calendar.sh) | AppleScript | 1 (系統層) | ~5s |
| 3 | 股市 (stock.sh) | Python yfinance | 2 (網路層) | ~2s |
| 4 | 天氣 (weather-forcast) | 外部 skill | 2 (網路層) | ~2s |
| 5 | 新聞 (news.sh) | Python feedparser | 2 (網路層) | ~3s |
| 6 | 提醒事項 (reminders.sh) | AppleScript | 3 (系統整合) | ~3s |
| 7 | Apple Notes (notes.sh) | AppleScript | 3 (系統整合) | ~3s |
| 8 | 郵件 (mail-checker) | 外部 skill | 3 (系統整合) | ~5s |
| 9 | **Teams (teams.sh)** | **Graph API** | **3 (系統整合)** | **~5s** |
| 10 | Wiki 知識 (wiki-query) | 外部 skill | 3 (系統整合) | ~3s |

**8 種互動模式**：

| 模式 | 用途 | 快速 |
|------|------|------|
| **入口選單** | 模糊意圖時顯示選擇 | — |
| **checkin** | 全部 10+ 來源完整報告 | `/assistant checkin` |
| **glance** | 單一來源快速查看 | 自然語言觸發 |
| **search** | 跨來源搜尋 | 「幫我找一下...」 |
| **summarize** | LLM 摘要產出 | 「整理重點」 |
| **prepare** | 會議準備包 | 「會議準備」 |
| **remind** | 掃描郵件寫入提醒 | 「提醒我重要郵件」 |
| **teams** | Teams 討論摘要 | 「Teams 討論」「有什麼 Teams」 |
| **setup** | 首次設定引導 | 「設定個人資訊」 |

---

## 觸發詞對照表

| 使用者輸入 | 路由至 |
|-----------|--------|
| 「個人助理」「今天重點」「早安」 | 入口選單 → 選擇模式 |
| 「天氣怎樣」「今天天氣」 | glance 天氣 |
| 「股市」「股票」「大盤」 | glance 股市 |
| 「今天有什麼信」「郵件」 | glance 郵件 |
| 「今天行程」「行事曆」 | glance 行事曆 |
| 「提醒我」「有什麼待辦」 | glance 提醒 |
| 「系統狀態」「磁碟」 | glance 系統 |
| 「有什麼新聞」「今天新聞」 | glance 新聞 |
| 「Teams 討論」「有什麼 Teams」「Teams 訊息」 | glance teams |
| 「幫我找一下 XXX」「搜尋 XXX」 | search XXX |
| 「整理重點」「摘要」 | summarize |
| 「會議準備」 | prepare（無參數時問會議名稱） |
| 「提醒我重要郵件」 | remind |
| 「設定」「設定個人資訊」 | setup |
| `/assistant` | 指令前綴，後面接 mode 名稱 |

---

## 安裝步驟

### 前置需求

- OpenCode 環境（必備）
- macOS 14+（AppleScript 相容性）
- Python 3.10+（已內建於 macOS）

### Step 1：確認依賴套件

```bash
# 檢查 Python 套件
python3 -c "import yfinance; import feedparser" 2>/dev/null && echo "✅ 套件已安裝" || echo "❌ 缺少套件，請執行下一步"
```

### Step 2：安裝 Python 套件

```bash
pip3 install yfinance feedparser
```

### Step 3：確認依賴 skills

確保以下 skills 存在於 OpenCode 環境中：

- `weather-forcast` — 天氣查詢
- `mail-checker` — 郵件讀取
- `wiki-query` — wiki 知識查詢

### Step 4：建立個人設定檔

```bash
# 自動建立（skill 會自動偵測並引導）
# 或手動：
cp ~/.config/opencode/skills/personal-assistant/examples/profile.example ~/.config/personal-assistant/profile
chmod 600 ~/.config/personal-assistant/profile
# 編輯設定：
open -e ~/.config/personal-assistant/profile
```

### Step 5：Teams OAuth 授權（選配）

如需要使用 Teams 討論摘要，執行一次授權：

```bash
bash ~/.config/opencode/skills/personal-assistant/scripts/teams-setup.sh
```

完成後會自動儲存 token 在 `~/.config/personal-assistant/teams-tokens.json`。

### Step 6：授權 macOS 權限

使用 AppleScript 功能需要授權：

1. **系統設定 → 隱私權與安全性 → 自動化**
2. 為 Terminal/iTerm2 授權：
   - Calendar ✅
   - Reminders ✅
   - Notes ✅

---

## 設定檔說明

### Profile 位置與格式

設定檔位於 `~/.config/personal-assistant/profile`（獨立於 skill 目錄外，避免誤提交）。

格式：標準 INI 風格，`#` 開頭註解，`key=value` 方式設定。

```
# ~/.config/personal-assistant/profile (UTF-8, chmod 600)

city=Taipei
stocks_tw=2330,2454,2317
stocks_us=AAPL,TSLA,MSFT,NVDA
accounts=iCloud,Gmail
calendars=
news_feeds=ltn,cna,bbc_world,bbc_business
news_max_per_feed=5
news_max_total=15
checkin_layers=all
```

### 欄位說明

| 欄位 | 用途 | 必填 | 預設值 | 範例 |
|------|------|------|--------|------|
| `city` | 居住城市（天氣用） | ✅ | Taipei | Taipei, NewTaipei |
| `stocks_tw` | 台股清單（逗號分隔） | ✅ | 2330,2454,2317 | 2330,2454,2317 |
| `stocks_us` | 美股清單（逗號分隔） | ✅ | AAPL,TSLA,MSFT,NVDA | AAPL,TSLA |
| `accounts` | 郵件帳號名稱 | ⚠️ | （自動偵測） | iCloud,Gmail |
| `calendars` | 行事曆名稱 | ⚠️ | （自動發現） | icloud 行事曆 |
| `news_feeds` | RSS 新聞來源 | ✅ | ltn,cna,bbc_world | ltn,bbc_world |
| `news_max_per_feed` | 每來源上限 | ❌ | 5 | 10 |
| `news_max_total` | 總量上限 | ❌ | 15 | 20 |
| `checkin_layers` | 執行層級 | ❌ | all | all, 1,2 |
| `log_level` | 日誌層級 | ❌ | INFO | DEBUG |
| `timeout_seconds` | 逾時秒數 | ❌ | 10 | 15 |

### 安全注意事項

- **權限保護**：`chmod 600` 確保只有你可讀設定檔
- **不含密碼**：建議郵件密碼使用 macOS Keychain（選配）
- **範本無個資**：`examples/profile.example` 僅含範例資料
- **獨立目錄**：設定檔在 `~/.config/`，不混入 skill 目錄

### Teams 獨立認證設定

Teams 功能透過 Microsoft Graph API 讀取聊天訊息，需要一次性的 OAuth 授權：

```bash
bash ~/.config/opencode/skills/personal-assistant/scripts/teams-setup.sh
```

流程：
1. 瀏覽器開啟 Microsoft 登入頁面
2. 用公司帳號登入並同意權限（Chat.ReadWrite）
3. 複製 redirect URL 貼回終端機
4. Token 儲存至 `~/.config/personal-assistant/teams-tokens.json`
5. 後續會自動 refresh（不需重複授權）

**移除授權**：刪除 `~/.config/personal-assistant/teams-tokens.json` 即可。

### Teams LLM 摘要流程

Teams 訊息內含大量自然語言對話，**teams.sh 不進行語意分析**（關鍵字比對無法理解上下文）。

真正的摘要發生在 agent 層級：當 checkin / glance 模式收到 teams.sh 的輸出時，agent 的 LLM 負責：

1. 閱讀每個聊天室的 messages（按時間排列）
2. 識別：**討論主題、決策事項、待辦工作、誰被交辦**
3. 輸出簡潔摘要

**實作提示**（agent 使用 teams 輸出時）：

```
收到 teams.sh JSON → 提取每個 chat 的 messages
→ LLM 分析：這個聊天室在討論什麼？有什麼結論？誰需要做什麼？
→ 輸出摘要（每個聊天室 1-3 句）
```

teams.sh 提供乾淨的結構化資料（messages 陣列、participants 發言統計、time_span），方便 LLM 快速理解上下文。

### Keychain 選配設定

```bash
# 寫入 Keychain（首次設定）
security add-generic-password -a "$USER" \
  -s "personal-assistant-email-password" \
  -w "your-email-password"

# 讀取 Keychain（script 內自動使用）
email_pass=$(security find-generic-password \
  -a "$USER" \
  -s "personal-assistant-email-password" \
  -w 2>/dev/null)
```

---

## 安全設計

### 三層安全模型

| 層級 | 機制 | 保護對象 | 強度 |
|------|------|----------|------|
| SL1 | 檔案權限 `chmod 600` | 設定檔本體 | 作業系統級 |
| SL2 | 範例檔不含真實資料 | 防止誤傳 | 流程級 |
| SL3 | 選配 macOS Keychain | 密碼/Token | 加密儲存級 |

### macOS 權限需求

| 功能 | 需要權限 | 首次使用提示 |
|------|----------|-------------|
| 行事曆 (Calendar.app) | 自動化 → Calendar | 「行事曆暫時無法讀取」 |
| 提醒事項 (Reminders.app) | 自動化 → Reminders | 「提醒事項暫時無法讀取」 |
| 備忘錄 (Notes.app) | 自動化 → Notes | 「備忘錄暫時無法讀取」 |
| 郵件 (Mail.app) | 自動化 → Mail | 由 mail-checker 處理 |
| 網路 | 無需額外權限 | 特定來源顯示錯誤 |

所有來源獨立容錯：任一失敗不影響其他來源輸出。

---

## Mode 流程說明

### 入口選單

當使用者輸入模糊意圖（如「個人助理」「今天重點」）時，顯示互動選單讓使用者選擇模式。

**流程**：
1. 使用者輸入模糊觸發詞
2. 顯示 8 種模式選項（含簡短說明）
3. 使用者選擇後進入對應模式
4. 若使用者輸入明確指令（如「天氣怎樣」），直接路由跳過選單

**輸出範例**：
```
╭─────────────────────────────────────╮
│  Personal Assistant                  │
├─────────────────────────────────────┤
│ 你想要做什麼？                       │
│                                     │
│  1️⃣  checkin   完整每日報告(10來源)│
│  2️⃣  glance    快速查看特定資訊     │
│  3️⃣  search    搜尋跨來源資料       │
│  4️⃣  summarize LLM 知識摘要         │
│  5️⃣  prepare   會議準備包           │
│  6️⃣  remind    掃描郵件建立提醒事項 │
│  7️⃣  teams     Microsoft Teams 討論 │
│  8️⃣  setup     設定個人資訊         │
│                                     │
│  (或直接輸入「天氣怎樣」快速查看)    │
╰─────────────────────────────────────╯
```

---

### checkin 模式

完整每日報告模式。批次收集全部 9 個來源，分層輸出。

**觸發方式**：
- 自然語言：「今天重點」「幫我 checkin」
- 指令：`/assistant checkin`

**流程**（對應 CON-1 三層批次）：

```
checkin 啟動
  │
  ├─ 批次 1（系統層）──
  │   ├─ system.sh     → 系統狀態（磁碟/電池/網路/記憶體）
  │   └─ calendar.sh   → 行事曆今日事件
  │
  ├─ 批次 2（網路層）──
  │   ├─ stock.sh      → 台股+美股行情
  │   ├─ weather       → 今日天氣（weather-forcast skill）
  │   └─ news.sh       → RSS 新聞摘要
  │
  ├─ 批次 3（系統整合）──
  │   ├─ reminders.sh  → 提醒事項
  │   ├─ notes.sh      → Apple Notes 最近筆記
  │   ├─ mail-checker  → 郵件摘要
  │   ├─ teams.sh      → Teams 討論摘要（含參與者、關鍵術語、動作項 digest）
  │   └─ wiki-query    → 相關知識
  │
  └─ 輸出：分層報告
```

**分層輸出原則**：
- 批次 1 完成 → 立即輸出系統 + 行事曆區塊
- 批次 2 完成 → 輸出天氣 + 股市 + 新聞區塊
- 批次 3 完成 → 輸出提醒 + 筆記 + 郵件 + Teams + wiki 區塊
- 使用者不用等全部跑完即可看到部分結果

**設定控制**：
- `checkin_layers=1,2` → 只跑快速層（跳過郵件/提醒/筆記/wiki）
- `checkin_layers=all` → 全部 3 層

對應整合測試：IT-1, IT-15

---

### glance 模式

單一來源快速查看。不執行完整 checkin，只查指定來源。

**觸發方式**：直接輸入來源相關關鍵字（見觸發詞對照表）

**可用 glance 項目**：

| 來源 | 觸發詞 | 資訊內容 |
|------|--------|----------|
| 天氣 | 「天氣怎樣」「今天天氣」 | 溫度、體感、降雨機率、日出日落 |
| 股市 | 「股市」「股票」「大盤」 | 台股+美股開盤/收盤/漲跌幅 |
| 郵件 | 「今天有什麼信」「郵件」 | 今日未讀郵件數量與摘要 |
| 行事曆 | 「今天行程」「行事曆」 | 今日事件列表（含時間+地點） |
| 提醒 | 「提醒我」「有什麼待辦」 | 未完成提醒事項 |
| 系統 | 「系統狀態」「磁碟」 | 磁碟用量、電池、網路、記憶體 |
| 新聞 | 「有什麼新聞」「今天新聞」 | RSS 新聞摘要（含連結） |
| Teams | 「Teams 討論」「有什麼 Teams」「Teams 訊息」 | Teams 聊天摘要（含參與者統計、時間跨度、LLM 摘要建議） |

**流程**：
1. 語意匹配到特定來源
2. 載入對應 script/skill
3. 輸出該來源資訊

對應整合測試：IT-2 ~ IT-7, IT-13

---

### search 模式

跨來源搜尋。從郵件、行事曆、筆記、wiki 知識中搜尋關鍵字。

**觸發方式**：
- 「幫我找一下 XXX」
- 「搜尋 XXX」

**流程**：
1. 提取搜尋關鍵字
2. 並行查詢 mail-checker（搜尋郵件）、calendar.sh（搜尋行程事件）、wiki-query（搜尋知識）
3. 彙整結果輸出

**輸出範例**：
```
🔍 搜尋「開會通知」結果：

📧 郵件（2 封）
  • 今日下午 3:00 專案會議 — 來自 Jane
  • 週五部門週會通知 — 來自 Boss

📅 行事曆（1 個）
  • 14:00-15:00 專案進度會議 @ 會議室 B

📝 Wiki（3 篇）
  • 會議記錄模板
  • 部門週會 SOP
```

對應整合測試：IT-8

---

### summarize 模式

LLM 知識摘要。對指定來源或跨來源內容做 LLM 摘要。

**觸發方式**：
- 「整理重點」
- 「摘要」
- 「幫我摘要今天的郵件」

**流程**：
1. 判斷摘要範圍（所有來源或指定來源）
2. 收集資料
3. 使用 LLM 整理結構化摘要
4. 輸出重點條列 + 行動建議

**摘要深度**：

| 模式 | 範圍 | 摘要深度 | 適用情境 |
|------|------|----------|----------|
| quick digest | 單一來源 | 簡短條列 | glance 快速查看 |
| mixed digest | checkin 全來源 | top 5 深度 + 其餘 quick | 每日 checkin |
| deep digest | 指定項目 | fetch 全文後深度摘要 | summarize 模式 |

對應整合測試：IT-9, IT-14

---

### prepare 模式

會議準備包。針對指定會議，收集相關郵件、筆記、wiki 知識。

**觸發方式**：
- 「會議準備」
- 「準備下午的會議」

**流程**：
1. 無參數 → 問使用者會議名稱
2. 有會議名稱 → 查詢行事曆找到該會議時間
3. 收集：相關郵件（mail-checker）+ 筆記（notes.sh）+ wiki 知識（wiki-query）
4. 產出結構化會議準備包

**輸出範例**：
```
📋 會議準備包：專案進度會議

📅 時間：今日 14:00-15:00
📍 地點：會議室 B

📧 相關郵件
  • 專案進度報告 v3 — 附件

📝 最近筆記
  • 會議記錄 2026-05-20

📚 Wiki 知識
  • 專案架構概覽
  • 技術決策記錄
```

對應整合測試：IT-10

---

### remind 模式

掃描郵件並將重要項目寫入 Apple Reminders。

**觸發方式**：
- 「提醒我重要郵件」
- 「幫我整理郵件中的待辦」

**流程**：
1. 使用 mail-checker 讀取今日郵件
2. LLM 識別需要追蹤的項目（需回覆、待辦事項、會議確認）
3. 對每個項目建立提醒事項（含 message:// 郵件連結、Zoom 連結、內容摘要）
4. 回報建立結果

**建立提醒事項**（透過 reminders.sh 的 AppleScript 功能）：

每個提醒包含：
- 標題：郵件主題 + 行動提示
- 到期日：依據郵件內容判斷
- 備註：message:// 郵件連結 + 內容摘要
- 列表：SMI（預設）

對應整合測試：IT-11

---

### teams 模式

Microsoft Teams 討論摘要。透過 Microsoft Graph API 讀取近期聊天訊息。

**觸發方式**：
- 「Teams 討論」「有什麼 Teams」「Teams 訊息」
- 入口選單選 7

**流程**：
1. 讀取 OAuth token（優先獨立認證，次之 Obsidian ms-outlook plugin）
2. 若 token 過期則自動 refresh
3. 列出使用者參與的聊天室（最多 10 個）
4. 平行收取每個聊天室近期訊息（ThreadPoolExecutor）
5. 輸出結構化 JSON（含參與者統計、時間跨度、訊息預覽、chat digest）

**LLM 摘要層**：

teams.sh 僅產出結構化資料，語意摘要由 agent 層 LLM 負責：

```
收到 teams.sh JSON → 提取每個 chat 的 messages
→ LLM 分析：討論主題、結論、待辦、交辦對象
→ 輸出每個聊天室 1-3 句摘要
```

**授權需求**（一次性）：
```bash
bash ~/.config/opencode/skills/personal-assistant/scripts/teams-setup.sh
```

**設定欄位**（`~/.config/personal-assistant/profile`）：

| 欄位 | 用途 | 預設值 |
|------|------|--------|
| `teams_msg_hours` | 查詢時間範圍(小時) | 24 |
| `teams_max_chats` | 最多聊天室數 | 10 |
| `teams_max_msg_per_chat` | 每聊天室最多訊息 | 20 |
| `teams_max_workers` | 平行執行緒數 | 5 |

對應整合測試：IT-16

---

### setup 模式

首次設定引導。協助使用者建立個人設定檔並授權 macOS 權限。

**觸發方式**：
- 「設定」
- 「設定個人資訊」

**流程**：
1. 檢查設定檔是否存在
   - 已存在 → 顯示目前設定值
   - 不存在 → 自動從範本建立（auto_create_profile）
2. 引導使用者編輯設定檔
3. 檢查 macOS 權限（Calendar / Reminders / Notes）
4. 檢查依賴套件（yfinance / feedparser）
5. 輸出設定摘要

**自動建立設定檔**：
```
⚠️ 找不到設定檔
🔧 開始自動建立...
✅ 設定檔已建立：~/.config/personal-assistant/profile
📝 請編輯此檔案設定個人資訊：
   open -e ~/.config/personal-assistant/profile
```

對應整合測試：IT-12

---

## 共同行為規範

### 快取策略

一次 checkin 呼叫內，同來源不重複查。下一次 checkin 重新查。

```
checkin → 建立 session cache
  ├─ 天氣 → cache['weather']
  ├─ 股市 → cache['stock']
  └─ ...
glance → 先檢查 cache，有則直接回傳
```

### 輸出語言

- 框架文字：繁體中文（台灣）
- 專有名詞：保留原文（Calendar.app, yfinance）
- 數字格式：台灣慣用（YYYY-MM-DD, 24h, NT$/US$）
- 錯誤訊息：中文（「行事曆暫時無法讀取」）

### 錯誤處理

所有來源獨立容錯，任一失敗不影響整體：

| 錯誤碼 | 含義 | 使用者顯示 |
|--------|------|-----------|
| E-NETWORK | 網路無法連線 | 「[來源] 暫時無法連線」 |
| E-TIMEOUT | 執行逾時 | 「[來源] 讀取逾時」 |
| E-AUTH | 缺少 macOS 權限 | 「請允許 [來源] 取用權限」 |
| E-DEPS | 缺少依賴套件 | 「需安裝 [套件]」 |
| E-PROFILE | 設定檔錯誤 | 「設定錯誤，使用預設值」 |

---

## 執行參考

```yaml
checkin:
  - step: load skills
    uses: skill tool → weather-forcast, mail-checker, wiki-query
  - step: collect system info
    uses: bash → scripts/system.sh, scripts/calendar.sh
  - step: collect network info
    uses: bash → scripts/stock.sh, skill(weather), bash scripts/news.sh
  - step: collect integrated info
    uses: bash → scripts/reminders.sh, scripts/notes.sh, skill(mail-checker), skill(wiki-query)
  - step: compose output
    uses: format with layers (batch 1 → batch 2 → batch 3)

glance:
  - step: match source from trigger word
  - step: check session cache
  - step: if miss, load single script/skill
  - step: output formatted info

setup:
  - step: check profile exists
  - step: if missing → auto_create_profile()
  - step: guide user edit
  - step: check macOS permissions
  - step: check dependencies
```

---

## 測試對應

| Mode | 整合測試 ID | 自動化 |
|------|-------------|--------|
| checkin | IT-1 (full), IT-15 (performance) | ✅ |
| glance weather | IT-2 | ✅ |
| glance stock | IT-3 | ✅ |
| glance mail | IT-4 | ✅ |
| glance calendar | IT-5 | ✅ |
| glance reminders | IT-6 | ✅ |
| glance system | IT-7 | ✅ |
| glance news | IT-13 | ✅ |
| glance teams | IT-16 | ✅ |
| search | IT-8 | ❌ manual |
| summarize | IT-9, IT-14 | ❌ manual |
| prepare | IT-10 | ❌ manual |
| remind | IT-11 | ❌ manual |
| setup | IT-12 | ❌ manual |

L1 單元測試：UT-1 (stock) ~ UT-5 (notes) — 每個 script 獨立測試。

---

## 專案結構

```
~/.config/opencode/skills/personal-assistant/
├── SKILL.md                                      ← 此文件
├── CHECKS.md                                     ← 機械化檢查規範
├── scripts/
│   ├── profile.sh                                # Bash: 共用設定檔 + JSON 輸出 + logging
│   ├── stock.sh                                  # Python: 股市查詢（yfinance）
│   ├── calendar.sh                               # AppleScript: 行事曆讀取
│   ├── reminders.sh                              # AppleScript: 提醒事項
│   ├── notes.sh                                  # AppleScript: Apple Notes
│   ├── system.sh                                 # Bash: 系統狀態
│   ├── news.sh                                   # Python: RSS 新聞（feedparser）
│   ├── teams.sh                                  # Python: Teams 聊天摘要（Graph API）
│   └── teams-setup.sh                            # Bash/Python: Teams OAuth 設定工具
├── tests/
│   ├── test_stock.sh
│   ├── test_calendar.sh
│   ├── test_reminders.sh
│   ├── test_system.sh
│   ├── test_notes.sh
│   ├── test_integration.sh
│   └── check-consistency.sh
├── harness/
│   └── test-runner.sh
├── examples/
│   └── profile.example
└── log/                                          ← 執行時自動建立於 ~/.config/personal-assistant/log/
```

個人設定檔（獨立目錄，git 隔離）：
```
~/.config/personal-assistant/profile              ← chmod 600
```
