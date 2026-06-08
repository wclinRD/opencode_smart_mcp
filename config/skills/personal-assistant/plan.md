# Personal Assistant Skill — Harness Plan

> 遵循 Harness Engineering 方法論：從概念理解到獨立實踐的完整實現計畫。
>
> 參考：[Harness Engineering 學習指南](https://github.com/deusyu/harness-engineering)

---

## AGENTS.md — 專案導航入口

### 這是什麼？

本專案實作一個 OpenCode Skill (`personal-assistant`)，讓使用者能一站掌握天氣、郵件、行事曆、提醒事項、股市（台股+美股）、系統狀態、新聞、筆記等資訊，並支援重點摘要與互動選單。

### 專案結構

```
~/.config/opencode/skills/personal-assistant/   ← skill 本體
├── SKILL.md                                      ← skill 主說明（給 opencode 與人類）
├── scripts/
│   ├── profile.sh                                # Bash: 共用設定檔讀取
│   ├── stock.sh                                  # Python: 股市查詢（yfinance）
│   ├── calendar.sh                               # AppleScript: 行事曆讀取
│   ├── reminders.sh                              # AppleScript: 提醒事項
│   ├── notes.sh                                  # AppleScript: Apple Notes
│   ├── system.sh                                 # Bash: 系統狀態
│   └── news.sh                                   # Python: RSS 新聞採集（feedparser）
├── tests/
│   ├── test_stock.sh                             # 股市查詢單元測試
│   ├── test_calendar.sh                          # 行事曆單元測試
│   ├── test_reminders.sh                         # 提醒事項單元測試
│   ├── test_system.sh                            # 系統狀態單元測試
│   ├── test_notes.sh                             # Apple Notes 單元測試
│   ├── test_integration.sh                       # L2 整合測試（批次腳本）
│   └── check-consistency.sh                      # L3 一致性機械化檢查
├── harness/
│   └── test-runner.sh                            # 測試批次器（執行全部測試並回報）
├── examples/
│   └── profile.example                           # 設定檔範例（安全，不含真實資料）
└── CHECKS.md                                     # 機械化檢查規範文件

~/.config/personal-assistant/profile              ← 個人設定檔（chmod 600）
```

### 從哪裡開始

| 如果你要... | 請看... |
|------------|---------|
| 理解整體設計 | `plan.md → Concepts 章節` |
| 知道要做什麼 | `plan.md → Practice 章節` |
| 看當下進度 | `todo.md` |
| 驗證完整性 | `plan.md → Mechanical Enforcement 章節` |
| 審查品質 | `plan.md → REVIEW Plan 章節` |

---

## Concepts — 架構概念

### CON-1：多源資訊彙聚模式

**問題**：個人助理需要從 9+ 個不同來源收集資訊（天氣、郵件、行事曆、提醒、股市、系統、新聞、筆記、wiki），每個來源的取得方式不同（skill、script、API、websearch）。

**決策**：採用「統一入口 + 順序批次 + 分層輸出」模式。

```
使用者輸入
    │
    ├─ 入口選單／模式路由
    │
    ├─ 批次 1（系統層，快速）──
    │   ├─ script (system.sh)         → 系統狀態        ~1s
    │   └─ script (calendar.sh)       → 行事曆          ~5s（含 timeout）
    │
    ├─ 批次 2（網路層，中度）──
    │   ├─ script (stock.sh)          → 股市            ~2s
    │   ├─ skill (weather-forcast)    → 天氣            ~2s
    │   └─ script (news.sh)          → 新聞            ~3s
    │
    ├─ 批次 3（系統整合，慢速）──
    │   ├─ script (reminders.sh)      → 提醒事項        ~3s
    │   ├─ script (notes.sh)          → Apple Notes     ~3s
    │   ├─ skill (mail-checker)       → 郵件            ~5s
    │   └─ skill (wiki-query)         → wiki 知識       ~3s
    │
    └─ 輸出 → 結構化報告（依 profile 設定分層）
```

**理由**：
- opencode 工具為順序執行模型，批次內可巢狀呼叫但無法真正平行
- 分批次意圖：**快速失敗** — 前段有問題（系統掛了）就不浪費時間查郵件
- **分層輸出**：批次 1 完成即可輸出第一區塊，使用者不用等全部跑完
- **容錯**：單一批次內某來源失敗，僅該來源顯示錯誤，不影響其他批次

### CON-2：個人設定檔安全模型

**問題**：助理需要知道居住城市、股票清單、郵件帳號等個人資訊，這些資訊需要保護。

**決策**：三層安全模型（Security Layers）。

| 層級 | 機制 | 保護對象 | 強度 |
|------|------|----------|------|
| SL1 | 檔案權限 `chmod 600` | 設定檔本體 | 作業系統級 |
| SL2 | 範例檔不含真實資料 | 防止誤傳 | 流程級 |
| SL3 | 選配 macOS Keychain | 密碼/Token | 加密儲存級 |

設定檔位置：`~/.config/personal-assistant/profile`（獨立於 skill 目錄外，避免誤提交）

**SL3 Keychain 實作路徑**（選配，建議郵件密碼/API Token 使用）：

```bash
# 寫入 Keychain（首次設定）
security add-generic-password -a "$USER" \
  -s "personal-assistant-email-password" \
  -w "your-email-password"

# 讀取 Keychain（script 內使用）
email_pass=$(security find-generic-password \
  -a "$USER" \
  -s "personal-assistant-email-password" \
  -w 2>/dev/null)

# 若 security 指令失敗，fallback 到 profile 讀取（明文）
if [ -z "$email_pass" ]; then
  email_pass=$(grep '^email_password=' "$PROFILE" | cut -d= -f2-)
fi
```

**設計原則**：
- Keychain 為選配，不強制 — 降低首次設定門檻
- 無 Keychain 時回退 profile 明文（仍受 chmod 600 保護）
- 服務名稱統一前綴 `personal-assistant-` 避免與其他工具衝突
- 支援 `security` CLI（macOS 內建，無需額外安裝）

### CON-3：快取策略（Session Cache）

**問題**：每次呼叫 `/assistant checkin` 都重新查全部 9 個來源，yfinance 有 API rate limit（~5 calls/sec），AppleScript 每次 ~3-10 秒。

**決策**：純 session 快取，不持久化。一次 checkin 呼叫內，同來源不重複查。

```
checkin 啟動 → 建立 session cache（dict）
  ├─ 查天氣 → cache['weather'] = 結果
  ├─ 查股市 → cache['stock'] = 結果
  ├─ 查行事曆 → cache['calendar'] = 結果
  └─ ...
  
glance 天氣 → 先看 cache 有無 weather
  ├─ 有 → 直接回傳（不重查）
  └─ 無 → 查新資料

下一次 checkin → 新的 session，新的 cache
```

**理由**：
- 不持久化避免資料過期
- 同一次對話內多次 glance 不重複查
- 未來可擴充為可選的磁碟快取（TTL 設定）

### CON-4：統一輸出格式規範

**問題**：9+ 個來源各自輸出不同格式（純文字、JSON、表格混合），agent 消化時需猜測結構，錯誤率高，且無法程式化判斷成功/失敗。

**決策**：定義統一 JSON 輸出規範，所有 script 共同遵循。

```
// 統一輸出格式範例
{
  "source": "stock",        // 來源名稱，與 CON-6 模組名稱一致
  "status": "ok",           // "ok" | "error" | "partial"
  "layer": 2,               // 對應批次層級 1/2/3（CON-1）
  "timestamp": "2026-05-22T09:00:00+08:00",
  "data": { ... },          // 各來源特定資料，格式由各 script 定義
  "error": null,            // status=error 時含錯誤訊息
  "metrics": {              // 效能追蹤（L2 IT-15 監控）
    "elapsed_ms": 2340,
    "items_count": 5
  }
}
```

**錯誤碼規範**（適用於所有 script）：

| 錯誤碼 | 含義 | 處理方式 | 使用者顯示 |
|--------|------|----------|-----------|
| E-NETWORK | 網路無法連線 | 跳過該來源 | 「[來源] 暫時無法連線」 |
| E-TIMEOUT | 執行逾時 | 跳過，記錄來源 | 「[來源] 讀取逾時」 |
| E-AUTH | 缺少 macOS 權限 | 提示授權指引 | 「請允許 [來源] 取用權限」 |
| E-DEPS | 缺少依賴套件 | 提示安裝指令 | 「需安裝 [套件]：pip install ...」|
| E-PROFILE | 設定檔錯誤 | 使用預設值 + warning | 「設定錯誤，使用預設值」 |
| E-UNKNOWN | 未預期錯誤 | 顯示通用訊息 | 「[來源] 暫時無法取得」 |

**理由**：
- 統一格式讓 agent 層可程式化處理，不需自然語言猜測
- 錯誤碼讓機械化檢查（L3）可判斷嚴重性，決定是否中止流程
- metrics 區塊讓效能基準（IT-15）可自動追蹤
- 向前相容：新增欄位不破壞既有消費者
- 對應 CON-6 模組化架構：新來源只要輸出此格式即可加入

### CON-5：互動式入口 vs 直接路由

**問題**：使用者不想記指令，但也不希望每次都被選單打斷。

**決策**：雙路徑設計。

```
使用者輸入 → 語意匹配
    ├─ 模糊（「個人助理」「今天重點」）→ 顯示互動選單
    ├─ 明確（「天氣怎樣」「股市今天」）→ 直接路由
    └─ 指令（「/assistant checkin」）→ 直接執行
```

**理由**：打字成本最低的路徑就是使用者會用的路徑。不強制選單，也不強制指令。

### CON-6：模組化擴充架構

**問題**：未來一定會想加更多資料來源或新模式。

**決策**：每個資料來源 = 獨立 script/skill，介面統一為 stdout 輸出。

```
新增來源只需：
1. 寫 scripts/newsource.sh → stdout 輸出文字
2. Profile 加對應欄位（選用）
3. SKILL.md 的 glance 加一行路由
4. checkin 流程加一段輸出

不影響既有功能，不改動核心流程。
```

---

## Thinking — 設計決策記錄

### T1：為什麼用混合模式（skill + script）而非純 shell script

**考量**：
- 純 shell script 無法利用既有 skills（weather-forcast, mail-checker, wiki-query）
- 純 skill 工具呼叫無法穩定讀取 macOS 系統資訊（Calendar, Reminders 需要 AppleScript）
- 混合模式兩者兼得

**代價**：依賴 opencode 環境，無法獨立執行。但這本來就是 opencode skill，合理。

### T2：AppleScript 風險與緩解

**風險**：AppleScript 操作 Calendar/Reminders 容易逾時（之前測試 Calendar 就遇到 timeout）。

**緩解**：
1. 逐帳號查詢，單一帳號逾時不影響其他
2. `timeout` 指令包裝，防止 script 卡死
3. 回退方案：逾時時顯示「行事曆暫時無法讀取」而非報錯中止

```bash
# calendar.sh 核心模式
# 帳號清單從 profile.calendars 讀取，預設自動發現
calendars=$(grep '^calendars=' ~/.config/personal-assistant/profile 2>/dev/null | cut -d= -f2-)
if [ -z "$calendars" ]; then
    # 自動發現：從 Calendar.app 取得所有 calendar 名稱
    calendars=$(osascript -e 'tell app "Calendar" to get name of every calendar' 2>/dev/null)
fi

IFS=',' read -ra CAL_LIST <<< "$calendars"
for cal in "${CAL_LIST[@]}"; do
    cal=$(echo "$cal" | xargs)  # trim whitespace
    timeout 10 osascript -e "tell app \"Calendar\" to ..." 2>/dev/null \
        || echo "$cal: 讀取逾時"
done
```

### T3：為什麼從 twse_api skill 轉向 yfinance

**考量**：
- 原 `twse_api` skill 只支援台股，不支援美股
- `yfinance` 同時覆蓋台股（`2330.TW`）和美股（`AAPL`）
- 統一資料來源，減少維護成本
- 已安裝驗證通過

**代價**：yfinance 資料有時延（~15-20分鐘），但個人使用可接受。

### T5：Profile Schema 定義

**問題**：設定檔如果格式寫錯、編碼錯誤、或重複鍵，助理行為會異常。

**決策**：定義正式 INI 格式，實作 parser 做基本驗證。

```
# ~/.config/personal-assistant/profile (UTF-8, chmod 600)
# 格式: key=value
# 註解: # 開頭
# 多值: 逗號分隔，無空格

city=Taipei
stocks_tw=2330,2454,2317
stocks_us=AAPL,TSLA,MSFT,NVDA
accounts=SMI,Gmail
calendars=icloud 行事曆,T-EX行事曆,Ray Job  # 行事曆帳號
news_feeds=ltn,cna,bbc_world,bbc_business,technews  # 新聞來源
news_max_per_feed=5                                   # 每來源最多取幾則
news_max_total=15                                     # 新聞總量上限
checkin_layers=all
```

**解析規則**：
- UTF-8 編碼
- `#` 開頭跳過（註解）
- 空白行跳過
- `key=value` 解析，value 前後 trim
- 重複 key → 後者覆蓋前者（附 warning）
- 未知 key → 跳過不報錯（向前相容）
- 缺少必要 key（city, stocks_tw）→ 使用預設值 + warning；news_max_per_feed 預設 5，news_max_total 預設 15

**實作**：`scripts/profile.sh` 提供 `read_profile()` function，所有 script 共用。

### T6：多 Skill 依賴的 Fallback 策略

**問題**：personal-assistant 依賴 3 個外部 skill（weather-forcast, mail-checker, wiki-query）。任何一個改版/失效都會影響。

**決策**：每種依賴定義 fallback 層級。

| 來源 | 依賴 | Fallback |
|------|------|----------|
| 天氣 | weather-forcast | 顯示「天氣資料暫時無法取得」 |
| 郵件 | mail-checker | 顯示「郵件暫時無法讀取」 |
| wiki 知識 | wiki-query | 跳過該區塊，不顯示 |
| 股市 | yfinance | 顯示「股市行情暫時無法取得」 |
| 行事曆 | AppleScript | 單帳號逾時不影響其他帳號 |
| 系統 | bash | 單項失敗不影響其他項 |

**原則**：任一來源失敗，不影響其他來源的輸出，也不影響整個 mode 執行。

### T7：SKILL.md 執行模型

**問題**：SKILL.md 描述流程時，需要明確 spec 說明「如何在 opencode 內載入子 skill」。

**決策**：

1. **子 skill 載入方式**：使用 opencode 的 `skill` 工具載入 weather-forcast、mail-checker、wiki-query
2. **本地 script 執行**：使用 `bash <skill_dir>/scripts/xxx.sh` 透過 bash 工具執行
3. **websearch**：直接使用 opencode 的 `websearch` 工具
4. **profile 讀取**：SKILL.md 內透過 bash 執行 `scripts/profile.sh`

```yaml
# SKILL.md 內的執行參考
checkin:
  - step: load skills
    uses: skill tool → weather-forcast, mail-checker, wiki-query
  - step: collect system info
    uses: bash → scripts/system.sh, scripts/calendar.sh
  - step: collect network info
    uses: bash → scripts/stock.sh, skill(weather), websearch
  - step: collect integrated info
    uses: bash → scripts/reminders.sh, scripts/notes.sh, skill(mail-checker), skill(wiki-query)
  - step: compose output
    uses: format with layers
```

### T4：Profile 為什麼放 `~/.config/` 而非 skill 目錄內

**考量**：
- Skill 目錄可能被版本控制或複製，不適合放真實個資
- `~/.config/personal-assistant/` 是 macOS 慣例
- `chmod 600` 保護，僅 owner 可讀

### T8：新聞來源 — RSS + Agent 雙層消化

**問題**：使用者需要助理消化過的新聞重點（非 raw headlines），且要有連結可點入閱讀，但不能依賴 API key。

**決策**：兩層架構 — Layer 1 機械採集 + Layer 2 AI 消化。

```
Layer 1: scripts/news.sh（RSS 採集）
  ├─ feedparser 抓取 profile 設定的 RSS feeds
  ├─ 輸出 JSON: {source, category, title, description, link, published}
  └─ 純機械，不耗 LLM token，可獨立測試

Layer 2: Agent（opencode agent 消化）
  ├─ 讀取 news.sh 輸出 → 分類、去重、排序
  ├─ glance 模式：用 RSS description 做 quick digest（< 10s）
  ├─ checkin 模式：top 5 做 deep digest + 其餘 quick digest
  └─ summarize 模式：對 top 10 fetch 全文後 deep digest
```

**RSS 來源選擇原則**（實際驗證過全部可用）：
- 國內：自由時報（description 2-3 句，品質佳）、中央社
- 國際：BBC World / Business（description 僅 1 句，deep digest 需 fetch 全文）
- 科技：科技新報（description 被截斷，deep digest 需 fetch 全文）、iThome
- 財經：鉅亨網

**Profile 設定**：
```
news_feeds=ltn,cna,bbc_world,bbc_business,technews,ithome,cnyes
news_max_per_feed=5
news_max_total=15
```

**理由**：
- RSS 標準 20+ 年，各新聞機構持續維護，無 API key 需求
- 兩層分工：script 機械採集（可測試），agent 智能消化（LLM 擅長）
- 每條新聞自帶 link，終端機 Cmd+click 可直接開啟
- 三種 digest 深度（quick / mixed / deep）對應不同使用情境

**代價**：
- 需要 `pip install feedparser`（純 Python，無系統依賴）
- BBC/TechNews description 較短，deep digest 需額外 fetch 全文
- 部分來源（如聯合新聞網）已移除 RSS，需替代來源

### T9：錯誤碼與 Logging 策略

**問題**：9+ 來源批次執行時，任一來源出錯需要追蹤 root cause。無統一 logging 時難以 debug，也無法判斷問題是暫時性（網路抖動）還是永久性（API 改版）。

**決策**：三層 logging + 結構化錯誤碼。

**Logging 層級**：

| 層級 | 儲存位置 | 內容 | 輪替 |
|------|----------|------|------|
| L0 Console | stdout/stderr（即時） | 當前執行狀態，人類可讀 | 不持久 |
| L1 Session | `~/.config/personal-assistant/log/session.log` | 每次 checkin 的開始/結束/錯誤摘要 | 每次啟動 truncate |
| L2 Debug | `~/.config/personal-assistant/log/debug.log` | 每步驟耗時、API response 摘要、AppleScript output | 保留最近 5 次，logrotate |

**Log 格式**（L1/L2）：

```
[2026-05-22T09:00:01] [INFO] [checkin] Starting checkin session
[2026-05-22T09:00:02] [INFO] [system.sh] Disk: 256GB/512GB
[2026-05-22T09:00:03] [WARN] [calendar.sh] E-TIMEOUT: 行事曆帳號「icloud 行事曆」讀取逾時（>10s）
[2026-05-22T09:00:05] [ERROR] [stock.sh] E-NETWORK: 無法連線 yfinance API
[2026-05-22T09:00:06] [INFO] [checkin] Checkin completed: 6/8 sources OK, 2 errors
```

**錯誤碼體系**（與 CON-4 統一輸出格式整合）：

| 錯誤碼 | 層級 | 自動恢復 | 需使用者操作 |
|--------|------|----------|-------------|
| E-NETWORK | WARN | ✅ 下次自動重試 | ❌ |
| E-TIMEOUT | WARN | ✅ 下次自動重試 | ❌ |
| E-AUTH | ERROR | ❌ | ✅ 需授權 |
| E-DEPS | ERROR | ❌ 安裝後恢復 | ✅ 需安裝 |
| E-PROFILE | WARN | ✅ 使用預設值 | ⚠️ 建議修正 |
| E-UNKNOWN | ERROR | ❌ | ⚠️ 需檢查 log |

**實作**：`scripts/profile.sh` 提供 `log_message()` function，所有 script 共用。

```bash
# 所有 script 使用統一的 log function
log_message() {
    local level="$1"   # INFO | WARN | ERROR
    local source="$2"  # script name
    local message="$3"
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [${level}] [${source}] ${message}"
    # L1: 寫入 session log
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [${level}] [${source}] ${message}" \
        >> "$LOG_DIR/session.log" 2>/dev/null
}
```

**代價**：
- 增加 disk I/O（但 log 量極小，每次 checkin < 5KB，可忽略）
- 需建立 log 目錄與權限（P1-1 已涵蓋 log/ 子目錄）
- Debug log 可能包含部分個人資訊（如行事曆事件標題），不適合長時間保留

### T10：輸出語言與 i18n 策略

**問題**：助理資料來源包含中文（天氣、新聞）、英文（BBC、yfinance、系統命令輸出），使用者介面語言應統一以中文為主，但保留英文專有名詞可讀性。

**決策**：中英雙軌策略 — 框架中文，專有名詞保留原文。

```
使用者介面語言：繁體中文（台灣）
  ├─ 觸發詞：全中文
  ├─ 輸出框架：中文（「今天天氣：...」「台積電收盤價：...」）
  ├─ 專有名詞：保留原文（「RSS feeds」「AppleScript」「Calendar.app」）
  ├─ 錯誤訊息：中文（「行事曆暫時無法讀取」）
  ├─ 數字格式：台灣慣用（日期 YYYY-MM-DD，時間 24h，金額 NT$/US$）
  └─ 技術術語：首次出現時附英文原文（如「快取 Session Cache」）
```

**資料來源語言處理**：

| 來源 | 原始語言 | 處理方式 |
|------|----------|----------|
| weather-forcast | 中文（skill 輸出） | 直接使用 |
| mail-checker | 中英混合（skill 輸出） | 直接使用，保留原文 |
| stock.sh (yfinance) | 英文（API 回傳） | 數字不翻譯，欄位名中文化 |
| news.sh (RSS) | 中英依來源 | Agent 消化時摘要為中文 |
| system.sh | 英文（bash 輸出） | 關鍵數字顯示，原文輔助 |
| calendar.sh | 中英依事件 | 直接顯示，不翻譯 |
| wiki-query | 中文（wiki 內容） | 直接使用 |

**代價**：
- 無法直接複用輸出到其他語言環境
- 部分 yfinance 欄位（如「marketCap」）需手動 mapping 中文化
- 但如果未來需要英文版，只需 extract 字串到 i18n 檔

---

## Practice — 實作計畫

### Phase 1：基礎建設（4 項）

| # | 任務 | 產出 | 依賴 |
|---|------|------|------|
| P1-1 | 建立目錄結構 | `personal-assistant/` + `scripts/` + `tests/` + `examples/` | — |
| P1-2 | 建立 profile.example | `examples/profile.example`（含完整欄位與註解） | P1-1 |
| P1-3 | 建立 CHECKS.md | 機械化檢查規範文件 | — |
| P1-4 | 安裝 yfinance + feedparser | `yfinance` 可用、`feedparser` 可用 | — |

### Phase 2：Scripts 實作（7 項）

| # | 任務 | 產出 | 驗證條件 | 依賴 |
|---|------|------|----------|------|
| P2-1 | 股市查詢 `stock.sh` | Python script + yfinance | 台股 2330.TW + 美股 AAPL 正確回傳 | P1-1, P1-4 |
| P2-2 | 行事曆 `calendar.sh` | AppleScript | 至少 3 個帳號可讀，逾時有 fallback | P1-1 |
| P2-3 | 提醒事項 `reminders.sh` | AppleScript | 今日到期項目正確列出 | P1-1 |
| P2-4 | 系統狀態 `system.sh` | Bash script | 磁碟/電池/網路/記憶體正確 | P1-1 |
| P2-5 | Apple Notes `notes.sh` | AppleScript | 最近 5 則筆記可讀 | P1-1 |
| P2-6 | 設定檔讀取 `profile.sh` | Bash script + INI parser | `read_profile()` 正確解析設定檔；支援 UTF-8、註解、缺省值回退；所有 script 共用 | P1-1 |
| P2-7 | 新聞摘要 `news.sh` | Python script + feedparser | 從 RSS 來源抓取新聞，輸出含 title+link+description；支援多來源設定；單一來源失敗不影響其他 | P1-1, P1-4, P2-6 |

### Phase 3：SKILL.md 實作（3 項）

| # | 任務 | 產出 | 內容 | 依賴 |
|---|------|------|------|------|
| P3-1 | SKILL.md 主體 | YAML frontmatter + 功能概述 + 觸發詞 | 完整描述 skill | P2-1~P2-7（所有 scripts 完成） |
| P3-2 | Mode 流程 | 7 種 mode 詳細流程 | 入口選單 → checkin/glance/search/summarize/prepare/remind | P3-1 |
| P3-3 | 安全與設定說明 | 設定檔建立步驟 + 安全注意事項 | 使用者引導 | P3-1 |

### Phase 4：單元測試 L1（5 項）

| # | 任務 | 產出 | 對應腳本 |
|---|------|------|----------|
| P4-1 | 股市測試 | `tests/test_stock.sh` | scripts/stock.sh |
| P4-2 | 行事曆測試 | `tests/test_calendar.sh` | scripts/calendar.sh |
| P4-3 | 系統測試 | `tests/test_system.sh` | scripts/system.sh |
| P4-4 | 提醒測試 | `tests/test_reminders.sh` | scripts/reminders.sh |
| P4-5 | 筆記測試 | `tests/test_notes.sh` | scripts/notes.sh |

### Phase 5：一致性 + 整合測試 L2+L3（2 項）

| # | 任務 | 產出 | 範圍 | 依賴 |
|---|------|------|------|------|
| P5-1 | 一致性檢查腳本 | `tests/check-consistency.sh` | L3 C1-C8 | P4-1~P4-5 |
| P5-2 | 整合測試腳本 + 執行 | `tests/test_integration.sh` + `harness/test-runner.sh` | L2 IT-1~IT-15 | P2-1~P2-7, P3-2, P5-1 |

### Phase 6：安全審查 + REVIEW L4+L5（2 項）

| # | 任務 | 產出 | 範圍 | 依賴 |
|---|------|------|------|------|
| P6-1 | 安全審查 | 安全審查表 | L4 S1-S4 | P3-3, P5-2 |
| P6-2 | REVIEW 執行 | `REVIEW-EXECUTION.md` | L5 六步驟完整審查（含 UAT） | P6-1 |

---

## Release Criteria — 發布標準

### MVP（v0.1）：checkin + glance 4 項 + setup

| 條件 | 說明 | 驗證方式 |
|------|------|----------|
| R1 | checkin 可執行且輸出 6+ 來源 | IT-1 PASS |
| R2 | glance 支援天氣/股市/行事曆/系統 | IT-2/3/5/7 PASS |
| R3 | setup 引導完成 profile 建立 | IT-12 PASS（手動確認） |
| R4 | 所有 script 無 crash（有 fallback） | L1 單元測試全部 PASS |
| R5 | C1-C8 一致性檢查全部 PASS | check-consistency.sh --all |
| R6 | profile 權限 600 確認 | L4 S1 PASS |

### v1.0：完整功能

| 條件 | 說明 | 驗證方式 |
|------|------|----------|
| R7 | 全部 9 來源 checkin（含新聞+郵件+提醒+筆記） | IT-1 含所有子項 |
| R8 | search/summarize/prepare/remind 4 種 mode | IT-8~IT-11 PASS（手動） |
| R9 | 新聞 RSS 雙層消化（glance + summarize） | IT-13/14 PASS |
| R10 | 效能基準：完整 checkin < 30s | IT-15 PASS |
| R11 | 安全審查 S1-S4 全部通過 | P6-1 完成 |
| R12 | L5 REVIEW 無 blocking issues | REVIEW-EXECUTION.md 結論 ✅ |
| R13 | UAT 至少一位真實使用者操作無阻礙 | L5 Step 6 完成 |

### 不屬於 v1.0 範圍（未來版本）

- 語音輸入/讀出
- Line / Telegram 整合
- macOS Menu Bar 常駐
- 多語言支援（除繁體中文外）

---

## 已知風險與緩解

| 風險 | 影響 | 機率 | 緩解 |
|------|------|------|------|
| AppleScript Calendar 逾時 | 行事曆無法讀取 | 高 | 逐帳號 + timeout 10 + 跳過機制 |
| yfinance API 變更 | 股市無法查詢 | 低 | 依賴穩定版 pip 套件，有版本鎖定 |
| macOS 版本升級 breaks AppleScript | 系統整合失效 | 中 | 腳本備註相容版本範圍，AppleScript 使用基礎語法 |
| 使用者忘記設 chmod 600 | 個資暴露 | 中 | SKILL.md 明確提醒 + setup mode 自動設定 |
| profile 格式寫錯 | 助理行為異常 | 中 | parser 錯誤檢查 + 預設值回退（T5） |
| 外部 skill 改版（weather/mail/wiki） | 部分功能失效 | 低 | 每來源獨立 fallback 不影響整體（T6） |
| opencode 工具模型無法平行 | 收集速度比預期慢 | 中 | 順序批次 + 分層輸出（CON-1） |
| L2 整合測試 4 項需手動驗證 | 無法全自動 CI | 中 | 明確標記 [manual] 並提供操作指引 |
| RSS feed URL 變更或失效 | 新聞來源中斷 | 低 | 多來源設計，單一失效不影響整體 |
| feedparser 套件未安裝 | 新聞無法取得 | 低 | P1-4 納入安裝檢查；缺少時回退顯示提示 |
| BBC/TechNews description 過短 | quick digest 過於簡略 | 中 | glance 模式接受，summarize 模式 fetch 全文 |
| **使用者長時間未使用** | 設定檔過期、套件版本落後 | 中 | checkin 啟動時自動檢查依賴版本，提示更新 |
| **AppleScript 權限被撤銷**（macOS 更新後常見） | 行事曆/提醒/筆記全失效 | 中 | 單一來源失敗不影響整體，錯誤訊息引導重新授權 |
| **多來源同時出錯難以快速定位** | debug 耗時 | 低 | T9 logging 策略 + 結構化錯誤碼，直接指向問題來源 |

---

## References — 參考資源

### 既有 Skills（本專案依賴）

| Skill | 位置 | 用途 |
|-------|------|------|
| weather-forcast | `~/.config/opencode/skills/weather-forcast/` | 天氣查詢 |
| mail-checker | `~/.config/opencode/skills/mail-checker/` | 郵件讀取 |
| wiki-query | `~/.agents/skills/wiki-query/` | Obsidian 知識查詢 |

### Python 套件

| 套件 | 用途 | 安裝狀態 |
|------|------|----------|
| yfinance | 台股+美股行情查詢 | ✅ 已安裝 |
| feedparser | RSS 新聞解析 | ⏳ 待安裝 |

### macOS 內建工具

| 工具 | 用途 |
|------|------|
| osascript (AppleScript) | 行事曆、提醒事項、Apple Notes |
| df, pmset, ping, vm_stat | 系統狀態 |

---

## Verification Flow — 五層驗證流程

本專案採用五層驗證，對應 Harness Engineering 從本地到 CI 的機械化執行理念。

```
L1: 單元測試 ─ 每個 script 獨立正確性
L2: 整合測試 ─ Mode 流程端到端
L3: 一致性檢查 ─ 跨文件數字/結構/定義同步
L4: 安全審查 ─ 權限/資料暴露
L5: REVIEW ─ 結構化人工審查
```

### L1 — 單元測試（Unit Tests）

| ID | 目標 | 位置 | 驗證條件 |
|----|------|------|----------|
| UT-1 | stock.sh | `tests/test_stock.sh` | 台股 `2330.TW` 回傳含價格；美股 `AAPL` 回傳含價格；無網路時回傳錯誤訊息 |
| UT-2 | calendar.sh | `tests/test_calendar.sh` | 不回拋未捕獲例外；逾時回傳「讀取逾時」非 crash |
| UT-3 | reminders.sh | `tests/test_reminders.sh` | 不回拋例外；無待辦回傳「無待辦事項」 |
| UT-4 | system.sh | `tests/test_system.sh` | 四項資訊（磁碟/電池/網路/記憶體）皆輸出 |
| UT-5 | notes.sh | `tests/test_notes.sh` | 不回拋例外；無筆記回傳「無筆記」 |

每個測試腳本獨立執行，exit 0 = PASS, exit 1 = FAIL。

### L2 — 整合測試（Integration Tests）

實作於 `tests/test_integration.sh`，由 `harness/test-runner.sh` 批次驅動。

每個 IT 對應一個 shell function，exit 0=PASS / 1=FAIL。無法自動化驗視覺輸出的項目標記為 `[manual]`，由測試腳本輸出操作指引。

```bash
# harness/test-runner.sh 核心邏輯
run_test() {
    local id=$1; local desc=$2; local func=$3
    echo "[RUN] $id: $desc"
    $func && echo "[PASS] $id" || echo "[FAIL] $id"
}

# 執行全部整合測試
run_test "IT-1"  "checkin (full)"      test_checkin
run_test "IT-2"  "glance weather"      test_glance_weather
run_test "IT-3"  "glance stock"        test_glance_stock
run_test "IT-4"  "glance mail"         test_glance_mail
run_test "IT-5"  "glance calendar"     test_glance_calendar
run_test "IT-6"  "glance reminders"    test_glance_reminders
run_test "IT-7"  "glance system"       test_glance_system
run_test "IT-8"  "search [manual]"     test_search
run_test "IT-9"  "summarize [manual]"  test_summarize
run_test "IT-10" "prepare [manual]"    test_prepare
run_test "IT-11" "remind [manual]"     test_remind
run_test "IT-12" "setup [manual]"      test_setup
run_test "IT-13" "glance news"         test_glance_news
run_test "IT-14" "summarize news"      test_summarize_news
run_test "IT-15" "checkin performance" test_checkin_performance
```

| ID | 目標 | 自動化 | 驗證條件 |
|----|------|--------|----------|
| IT-1 | checkin mode | ✅ 腳本 | 系統+行事曆+天氣+郵件+股市+新聞 皆正確顯示 |
| IT-2 | glance 天氣 | ✅ 腳本 | 天氣資訊正確 |
| IT-3 | glance 股市 | ✅ 腳本 | 台股+美股行情顯示 |
| IT-4 | glance 郵件 | ✅ 腳本 | 郵件摘要顯示（無新信也顯示「無新信」） |
| IT-5 | glance 行事曆 | ✅ 腳本 | 行事曆事件或「無行程」 |
| IT-6 | glance 提醒 | ✅ 腳本 | 待辦事項或「無待辦」 |
| IT-7 | glance 系統 | ✅ 腳本 | 四項系統資訊 |
| IT-8 | search mode | ❌ manual | wiki-query + 郵件 + 行事曆 整合輸出 |
| IT-9 | summarize mode | ❌ manual | LLM 摘要輸出 |
| IT-10 | prepare mode | ❌ manual | 會議準備包產出 |
| IT-11 | remind mode | ❌ manual | 掃描郵件寫入提醒事項 |
| IT-12 | setup mode | ❌ manual | profile 建立成功，chmod 600 確認 |
| IT-13 | glance news | ✅ 腳本 | 新聞摘要正確顯示（含連結），各來源正常輸出 |
| IT-14 | summarize news [manual] | ❌ manual | LLM 對新聞重點摘要輸出品質 |
| IT-15 | checkin performance | ✅ 腳本 | 完整 checkin 耗時 < 30s；每階段耗時記錄至 log/metrics |

### L3 — 一致性檢查（Consistency Checks）

| ID | 檢查 | 方式 | 自動化 |
|----|------|------|--------|
| C1 | `scripts/*.sh` 全部存在且可執行 | `ls -la` + `-x` 檢查 | ✅ |
| C2 | `profile.example` 欄位 = SKILL.md 描述欄位 | diff 欄位名稱集合 | ✅ |
| C3 | stock.sh 可查台股+美股 | 執行 + 輸出驗證 | ✅ |
| C4 | calendar.sh 無未捕獲例外 | 執行 + exit code | ✅ |
| C5 | plan.md → todo.md → SKILL.md 觸發詞一致 | pl.md: grep 觸發詞清單行數 = todo.md: 觸發詞表行數 = SKILL.md: 觸發詞行數 | ✅ |
| C6 | plan.md Practice Phase 數量 = todo.md Phase 數量 | 兩文件 Phase 表格行數 diff 為 0 | ✅ |
| C7 | profile.example 不含真實資料（無 email/密碼/住址） | grep 敏感模式 | ✅ |
| C8 | news.sh 可查詢設定 feeds | 執行 + 輸出驗證（含 title+link） | ✅ |

### L4 — 安全審查（Security Review）

| ID | 檢查 | 觸發時機 |
|----|------|----------|
| S1 | `profile` 檔案權限為 600 | 每次 setup 完成後 |
| S2 | `profile.example` 無真實個資 | 每次修改 example 後 |
| S3 | Script 中無 hardcoded 敏感資訊 | Phase 完成時 |
| S4 | AppleScript 無輸出未授權資料 | REVIEW 時 |

### L5 — REVIEW（結構化審查）

見下方 [REVIEW Plan](#review-plan--審查計畫) 章節。

---

## Mechanical Enforcement — 機械化檢查腳本

### 為什麼需要

文件會腐爛。人會忘記。Script 會壞。但檢查腳本每次都會執行。

### 檢查範圍（C1-C8）

`tests/check-consistency.sh` 實現 L3 一致性檢查 C1-C8，以及 L1 單元測試的批次執行入口。

### 執行方式

```bash
# 單元測試（全部）
bash tests/test_stock.sh && bash tests/test_calendar.sh && bash tests/test_system.sh

# 一致性檢查
bash tests/check-consistency.sh

# 全部驗證
bash tests/check-consistency.sh --all    # 含單元測試 + 一致性
```

### 錯誤訊息設計

遵循 Harness Engineering 原則：錯誤訊息 = 修復指令。

```
❌ C3 FAIL:
Error: scripts/stock.sh cannot query AAPL (exit code 1)

✅ 修正指令：
Fix: 
  1. Test manually: bash scripts/stock.sh
  2. Check yfinance: python3 -c "import yfinance; print(yfinance.download('AAPL', period='1d'))"
  3. If network issue: check internet connection
```

### 執行頻率

| 層級 | 頻率 | 觸發 |
|------|------|------|
| L1 單元測試 | 每次修改後 | `bash tests/*.sh` |
| L3 一致性 | 每次 Phase 完成 | `bash tests/check-consistency.sh` |
| L5 REVIEW | 每月 / Phase 完成 | REVIEW Plan |

---

## REVIEW Plan — 審查計畫

### 審查範圍

| In Scope | Out of Scope |
|----------|-------------|
| SKILL.md 完整性和正確性 | `~/.config/personal-assistant/profile`（個人檔案，不外審） |
| 所有 scripts/ 功能正確 | 第三方 API 變動（如 yfinance upstream 改版） |
| 機械化檢查腳本有效性 | AppleScript 的 macOS 版本相容性（以當前版本為準） |
| Profile 設定流程安全性 | |

### 審查執行順序

**Step 1：L1+L3 自動化驗證（先跑檢查腳本）**
```bash
bash tests/check-consistency.sh     # 一致性 C1-C8
bash tests/test_stock.sh            # 單元測試
bash tests/test_calendar.sh
bash tests/test_system.sh
```
→ 全部 PASS 才進入 Step 2。

**Step 2：結構審查**
- 目錄結構是否與 plan.md 一致
- 每個預期檔案是否存在
- 權限設定是否正確
- C5（跨文件觸發詞一致）+ C6（任務數字一致）通過

**Step 3：功能審查（L2）**
- IT-1 ~ IT-12 逐項驗證
- 每個 script 獨立執行是否正確
- SKILL.md 描述的每個 mode 是否可觸發
- 錯誤處理是否到位（逾時、缺依賴、缺設定檔）

**Step 4：安全審查（L4）**
- S1: profile 權限 600 確認
- S2: profile.example 不含真實資料確認
- S3: script 無 hardcoded 敏感資訊
- S4: AppleScript 無不當輸出

**Step 5：一致性審查**
- plan.md、todo.md、SKILL.md 之間描述是否一致（C5）
- 觸發詞對照表是否涵蓋所有 mode
- 機械化檢查項目是否全部通過（C1-C8）

**Step 6：使用者驗收測試（UAT）**
- 真實使用者操作：從頭完成一次 setup → checkin → glance 流程
- 記錄操作時間：首次 setup < 10 分鐘
- 回饋收集：至少 3 個「操作順暢點」與 3 個「困惑點」
- UAT 結果記錄於 REVIEW-EXECUTION.md 的「UAT 回饋」區塊

  ```markdown
  ## UAT 回饋
  | 項目 | 評價 | 改善建議 |
  |------|------|----------|
  | setup 流程 | ⭐⭐⭐/5 | 需更清楚說明 profile 路徑 |
  | checkin 速度 | ⭐⭐⭐⭐/5 | 天氣查詢可提前批次 |
  | 輸出可讀性 | ⭐⭐⭐⭐⭐/5 | — |
  ```

### 審查時機

| 時機 | 觸發 | 執行範圍 |
|------|------|----------|
| Phase 完成後 | 每個 Phase 結束 | 該 Phase 所有 UT + 相關 IT |
| 重大修改後 | scripts/ 或 SKILL.md 結構變更 | L1+L3 全部 |
| 每月 | 對應 daily-update 週期 | L5 完整五步驟 |

### REVIEW 產出格式

每次 REVIEW 記錄於 `REVIEW-EXECUTION.md`，格式：

```markdown
# REVIEW 執行報告 — YYYY-MM-DD

## 審查範圍
[本次審查的 Phase/modified files]

## 自動化驗證結果
- L1 單元測試: ✅ 全部 PASS / ❌ N 項 FAIL（見下）
- L3 一致性: ✅ 全部 PASS / ❌ N 項 FAIL（見下）

## 發現問題
| ID | 問題 | 影響 | 修復建議 |
|----|------|------|----------|

## UAT 回饋
| 項目 | 評價 | 改善建議 |
|------|------|----------|
| （操作項目） | ⭐/5 | （建議） |

## 結論
✅ 通過 / ⏳ 有條件通過（列出 blocking issues）
```

---

---

## 變更記錄

| 日期 | 變更 | 原因 |
|------|------|------|
| 2026-05-22 | 初始建立 | Harness Engineering 規劃 |
| 2026-05-22 | 新增 CON-4 統一輸出格式概念 | 補上跳號，定義 JSON 輸出規範與錯誤碼體系 |
| 2026-05-22 | 新增 T9 錯誤碼與 Logging 策略 | 三層 logging + 結構化錯誤碼，解決多來源 debug 需求 |
| 2026-05-22 | 新增 T10 i18n 策略 | 定義中英雙軌輸出語言處理方式 |
| 2026-05-22 | 新增 IT-15 效能基準測試 | 監控 checkin 整體耗時 < 30s SLA |
| 2026-05-22 | L5 REVIEW 增加 Step 6 UAT | 補上真實使用者驗收環節 |
| 2026-05-22 | 新增 Release Criteria 章節 | 定義 MVP 與 v1.0 發布標準 |
| 2026-05-22 | 擴充風險登記表 | 新增 3 項風險（使用者閒置、權限撤銷、多來源 debug） |
| 2026-05-22 | 修復 P1-4/P2-6 不一致、CON 與 L3 編號衝突 | 所有 Phase 表格加依賴欄；Concepts 改 CON- 前綴避免與 L3 C1-C8 衝突 |
| 2026-05-22 | 補上 Keychain 實作細節 | 擴充 CON-2 SL3 說明含 security CLI 範例 |

---

## 觸發詞對照表（總覽）

| 使用者輸入 | 路由至 |
|-----------|--------|
| 「個人助理」「今天重點」「早安」 | 入口選單 |
| 「天氣怎樣」「今天天氣」 | glance 天氣 |
| 「股市」「股票」「大盤」 | glance 股市 |
| 「今天有什麼信」「郵件」 | glance 郵件 |
| 「今天行程」「行事曆」 | glance 行事曆 |
| 「提醒我」「有什麼待辦」 | glance 提醒 |
| 「系統狀態」「磁碟」 | glance 系統 |
| 「有什麼新聞」「今天新聞」 | glance 新聞 |
| 「幫我找一下 XXX」「搜尋 XXX」 | search XXX |
| 「整理重點」「摘要」 | summarize |
| 「會議準備」 | prepare（無參數時問會議名稱） |
| 「提醒我重要郵件」 | remind |
| 「設定」「設定個人資訊」 | setup |
