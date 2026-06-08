# Personal Assistant — 機械化檢查規範

> 遵循 Harness Engineering：文件會腐爛，檢查腳本不會。

---

## 檢查分層

| 層級 | 名稱 | 對應檢查 | 執行時機 |
|------|------|----------|----------|
| L1 | 單元測試 | UT-1~UT-5 | 每次修改 script 後 |
| L3 | 一致性檢查 | C1~C8 | 每個 Phase 完成後 |

---

## L3 一致性檢查 C1~C8

### C1：Scripts 存在性與可執行性

**目標**：確認所有預期的 script 都存在且可執行。

**檢查項目**：
- `scripts/profile.sh` 存在且可執行
- `scripts/stock.sh` 存在且可執行
- `scripts/calendar.sh` 存在且可執行
- `scripts/reminders.sh` 存在且可執行
- `scripts/notes.sh` 存在且可執行
- `scripts/system.sh` 存在且可執行
- `scripts/news.sh` 存在且可執行

**檢查方式**：
```bash
for f in profile stock calendar reminders notes system news; do
    script="scripts/${f}.sh"
    if [ ! -f "$script" ]; then
        echo "❌ C1 FAIL: $script not found"
        exit 1
    fi
    if [ ! -x "$script" ]; then
        echo "❌ C1 FAIL: $script not executable"
        echo "   Fix: chmod +x $script"
        exit 1
    fi
done
```

**PASS 條件**：所有 7 個 scripts 存在且 `chmod +x`。

---

### C2：Profile 範例欄位一致性

**目標**：確認 `examples/profile.example` 欄位與 SKILL.md 文件描述一致。

**必須包含的欄位**：
| 欄位 | 用途 | 必填 | 預設值 |
|------|------|------|--------|
| `city` | 居住城市 | ✅ | Taipei |
| `stocks_tw` | 台股清單 | ✅ | 2330,2454,2317 |
| `stocks_us` | 美股清單 | ✅ | AAPL,TSLA,MSFT,NVDA |
| `accounts` | 郵件帳號 | ⚠️ | （留空自動偵測） |
| `calendars` | 行事曆名稱 | ⚠️ | （留空自動偵測） |
| `news_feeds` | 新聞來源 | ✅ | ltn,cna,bbc_world |
| `news_max_per_feed` | 每來源上限 | ❌ | 5 |
| `news_max_total` | 總量上限 | ❌ | 15 |
| `checkin_layers` | 執行層級 | ❌ | all |

**檢查方式**：
- 讀取 `profile.example` 所有 key
- 比對上述必填清單
- 缺少任何必填 key → FAIL

**PASS 條件**：所有必填 key 存在於 example。

---

### C3：股市查詢功能驗證

**目標**：確認 `stock.sh` 可正確查詢台股與美股。

**檢查情境**：
1. **台股 2330.TW**：執行後輸出需包含 `2330` 或 `台積電` 與價格數字
2. **美股 AAPL**：執行後輸出需包含 `AAPL` 或 `Apple` 與價格數字
3. **無網路時**：不 crash，輸出錯誤訊息而非例外

**檢查方式**：
```bash
# 測試台股
output=$(bash scripts/stock.sh 2>&1)
if echo "$output" | grep -q "2330" && echo "$output" | grep -qE "[0-9]+\.[0-9]+"; then
    echo "✅ C3: TW stock 2330.TW OK"
else
    echo "❌ C3 FAIL: stock.sh cannot query 2330.TW"
    echo "   Output: $output"
    exit 1
fi
```

**PASS 條件**：
- 台股測試包含代號與價格
- 美股測試包含代號與價格
- exit code = 0

---

### C4：行事曆穩定性驗證

**目標**：確認 `calendar.sh` 無未捕獲例外，逾時時有優雅 fallback。

**檢查情境**：
1. **正常執行**：不回拋 `osascript` 未捕獲錯誤
2. **逾時處理**：單一帳號逾時顯示「讀取逾時」而非 crash
3. **無權限時**：顯示「請允許行事曆取用權限」提示

**檢查方式**：
```bash
output=$(bash scripts/calendar.sh 2>&1)
exit_code=$?

# 檢查是否有未捕獲 AppleScript 錯誤
if echo "$output" | grep -qE "execution error|OSStatus|Can't get"; then
    echo "❌ C4 FAIL: calendar.sh has uncaught AppleScript error"
    echo "   Output: $output"
    exit 1
fi

# 檢查 exit code 不為 crash（127, 255 等）
if [ $exit_code -eq 127 ] || [ $exit_code -eq 255 ]; then
    echo "❌ C4 FAIL: calendar.sh crashed (exit $exit_code)"
    exit 1
fi
```

**PASS 條件**：
- 無 AppleScript execution error
- exit code 為 0（成功）或 1（優雅錯誤），非 127/255

---

### C5：觸發詞跨文件一致性

**目標**：確認 plan.md、todo.md、SKILL.md 三者的觸發詞對照表一致。

**檢查項目**：
| 文件 | 驗證點 |
|------|--------|
| `plan.md` | 觸發詞對照表行數 |
| `todo.md` | 觸發詞對照表（若有） |
| `SKILL.md` | 觸發詞 YAML frontmatter / 表格 |

**觸發詞清單（必須全部支援）**：
```
入口選單：「個人助理」「今天重點」「早安」
glance 天氣：「天氣怎樣」「今天天氣」
glance 股市：「股市」「股票」「大盤」
glance 郵件：「今天有什麼信」「郵件」
glance 行事曆：「今天行程」「行事曆」
glance 提醒：「提醒我」「有什麼待辦」
glance 系統：「系統狀態」「磁碟」
glance 新聞：「有什麼新聞」「今天新聞」
search：「幫我找一下 XXX」「搜尋 XXX」
summarize：「整理重點」「摘要」
prepare：「會議準備」
remind：「提醒我重要郵件」
setup：「設定」「設定個人資訊」
```

**PASS 條件**：
- 三份文件的觸發詞數量一致（至少 13 組）
- 無文件漏列重要觸發詞

---

### C6：Phase 任務數量一致性

**目標**：確認 `plan.md` Practice 章節的 Phase 表格與 `todo.md` 的 Phase 數量一致。

**檢查項目**：
| Phase | plan.md 任務數 | todo.md 任務數 | 必須相等 |
|-------|---------------|----------------|----------|
| P1 基礎建設 | 4 | 4 | ✅ |
| P2 Scripts | 7 | 7 | ✅ |
| P3 SKILL.md | 3 | 3 | ✅ |
| P4 單元測試 | 5 | 5 | ✅ |
| P5 整合+一致性 | 2 | 2 | ✅ |
| P6 安全+REVIEW | 2 | 2 | ✅ |
| **總計** | **23** | **23** | ✅ |

**PASS 條件**：所有 Phase 的任務數量在兩文件中相等。

---

### C7：Profile 範例無真實個資

**目標**：確認 `examples/profile.example` 不含任何真實敏感資訊。

**禁止出現的模式**：
| 模式 | 風險 | 檢查方式 |
|------|------|----------|
| 真實 email | `xxx@gmail.com`, `xxx@company.com` | grep `@` 後面是否為真實 domain |
| 密碼/Token | `password=`, `token=`, `secret=` | grep 這些關鍵字 |
| 真實姓名 | 連續 2-4 個中文字（需人工審查） | 標註 [manual] |
| 真實股票代號以外的數字 | 電話、身分證字號 | grep 連續 6+ 數字 |

**自動化檢查**：
```bash
# 檢查是否有密碼關鍵字
if grep -qE "^(password|token|secret|api_key)=" examples/profile.example; then
    echo "❌ C7 FAIL: profile.example contains sensitive keywords"
    exit 1
fi

# 檢查是否有非範例的 email（@ 後面不是 example.com）
if grep -E "@" examples/profile.example | grep -qv "example.com"; then
    echo "❌ C7 FAIL: profile.example contains real email domain"
    exit 1
fi
```

**PASS 條件**：
- 無 `password=`、`token=` 等敏感欄位值
- 所有 `@` 若存在，應為 `example.com` 或註解說明

---

### C8：新聞 RSS 查詢驗證

**目標**：確認 `news.sh` 可正確查詢設定的 RSS feeds。

**檢查項目**：
1. **輸出格式**：每則新聞包含 `title`、`link`、`description`
2. **多來源支援**：至少 3 個不同來源可正常輸出
3. **錯誤隔離**：單一 feed 失效不影響其他 feeds

**檢查方式**：
```bash
output=$(bash scripts/news.sh 2>&1)
exit_code=$?

# 檢查是否有標題與連結
if echo "$output" | grep -q "title" && echo "$output" | grep -q "https://"; then
    echo "✅ C8: news.sh outputs title + link"
else
    echo "⚠️  C8: news.sh output format verification (check manually)"
fi
```

**PASS 條件**：
- 輸出包含至少 1 則新聞（有網路時）
- 或無網路時顯示優雅錯誤訊息
- 不 crash（exit code 非 127/255）

---

## 錯誤訊息格式規範

所有檢查失敗的錯誤訊息遵循 Harness Engineering 原則：

```
❌ [檢查ID] FAIL:
Error: [具體錯誤描述]

✅ 修正指令：
Fix:
  1. [第一步驟]
  2. [第二步驟]
  3. [若無效則...]
```

**範例**：
```
❌ C3 FAIL:
Error: scripts/stock.sh cannot query AAPL (exit code 1)

✅ 修正指令：
Fix:
  1. Test manually: bash scripts/stock.sh
  2. Check yfinance: python3 -c "import yfinance; print(yfinance.download('AAPL', period='1d'))"
  3. If network issue: check internet connection
```

---

## 執行方式

### 單一檢查
```bash
bash tests/check-consistency.sh --check C1
```

### 全部一致性檢查
```bash
bash tests/check-consistency.sh
```

### 全部檢查（單元測試 + 一致性）
```bash
bash tests/check-consistency.sh --all
```

---

## 檢查結果記錄

每次執行檢查後，更新下表：

| 檢查 | 日期 | 結果 | 備註 |
|------|------|------|------|
| C1 | YYYY-MM-DD | ✅/❌ | |
| C2 | YYYY-MM-DD | ✅/❌ | |
| C3 | YYYY-MM-DD | ✅/❌ | |
| C4 | YYYY-MM-DD | ✅/❌ | |
| C5 | YYYY-MM-DD | ✅/❌ | |
| C6 | YYYY-MM-DD | ✅/❌ | |
| C7 | YYYY-MM-DD | ✅/❌ | |
| C8 | YYYY-MM-DD | ✅/❌ | |
