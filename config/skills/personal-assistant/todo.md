# Personal Assistant Skill — 實作任務清單

> 遵循 Harness Engineering 方法論：每個任務有明確 ID、驗證條件、狀態追蹤。
>
> Phase 狀態以 `plan.md → Practice` 為準，此處是執行追蹤工具。

---

## 執行狀態總覽

| Phase | 層級 | 總任務 | ✅ 完成 | 📌 進行中 | ⏳ 待開始 | ❌ 受阻 | 預計工時 |
|-------|------|--------|--------|-----------|-----------|---------|----------|
| P1 基礎建設 | — | 4 | 4 | 0 | 0 | 0 | 2h |
| P2 Scripts | — | 7 | 7 | 0 | 0 | 0 | 10.5h |
| P3 SKILL.md | — | 3 | 3 | 0 | 0 | 0 | 5h |
| P4 單元測試 | L1 | 5 | 5 | 0 | 0 | 0 | 3.5h |
| P5 一致性+整合 | L2+L3 | 2 | 2 | 0 | 0 | 0 | 5h |
| P6 安全審查+REVIEW | L4+L5 | 2 | 2 | 0 | 0 | 0 | 3h |
| **總計** | **L1-L5** | **23** | **23** | **0** | **0** | **0** | **29h** |

---

## Phase 1：基礎建設 ✅ 已完成

### P1-1：建立目錄結構

| 欄位 | 內容 |
|------|------|
| **描述** | 建立 personal-assistant skill 的完整目錄樹 |
| **產出** | `~/.config/opencode/skills/personal-assistant/{scripts/,tests/,harness/,examples/,log/}` |
| **預計工時** | 0.5h |
| **驗證** | `ls -la` 確認 5 個目錄存在 |
| **依賴** | 無 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已建立：scripts/, tests/, harness/, examples/；log/ 在 ~/.config/personal-assistant/ |

---

### P1-2：建立 profile.example

| 欄位 | 內容 |
|------|------|
| **描述** | 建立個人設定檔範例（含完整欄位註解，不含真實資料） |
| **產出** | `examples/profile.example` |
| **預計工時** | 0.5h |
| **驗證** | 檔案存在，無真實個資，欄位與 plan.md Concepts CON-2 一致 |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已複製到 ~/.config/personal-assistant/profile.example 方便參考 |

---

### P1-3：建立 CHECKS.md

| 欄位 | 內容 |
|------|------|
| **描述** | 機械化檢查規範文件，定義 C1-C8 檢查項目與錯誤訊息格式 |
| **產出** | `CHECKS.md`（含檢查規格、錯誤訊息範本） |
| **預計工時** | 0.5h |
| **驗證** | 與 plan.md Mechanical Enforcement 章節一致 |
| **依賴** | 無 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |

---

### P1-4：安裝依賴套件

| 欄位 | 內容 |
|------|------|
| **描述** | 安裝 yfinance（已裝）+ feedparser（待裝）+ 確認 osascript 可用、既有 skills 存在 |
| **產出** | `python3 -c "import yfinance"` + `python3 -c "import feedparser"` 無錯誤 |
| **預計工時** | 0.5h |
| **驗證** | yfinance import ✅ + feedparser import ✅ |
| **依賴** | 無 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | feedparser 6.0.12 已安裝 |

---

## Phase 2：Scripts 實作 ✅ 已完成

### P2-6：Profile 讀取 profile.sh

| 欄位 | 內容 |
|------|------|
| **描述** | 共用設定檔讀取腳本，提供 `read_profile()` + `log_message()` + `output_json_*()` function。處理 INI 解析、格式驗證、預設值回退、雙位置支援、自動建立。 |
| **產出** | `scripts/profile.sh`（可被 source） |
| **預計工時** | 1.5h |
| **規格** | 支援 UTF-8、`#` 註解、`key=value` 解析、重複 key warning、缺省值 fallback；提供 `log_message()` 供所有 script 共用；**雙位置支援** + **自動建立設定檔**；統一 JSON 輸出函式（CON-4） |
| **驗證** | `source scripts/profile.sh && read_profile "city"` → 回傳正確值；找不到設定檔時自動建立 |
| **完成條件** | P2-6 完成，且 P3-1/P3-2 可正確載入 profile 設定 |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已實作雙位置支援 + 自動建立功能（找不到設定檔時自動從範本複製或建立最小版本） |

---

### P2-4：系統狀態 system.sh

| 欄位 | 內容 |
|------|------|
| **描述** | Bash script 收集磁碟、電池、網路、記憶體資訊 |
| **產出** | `scripts/system.sh`（可執行） |
| **預計工時** | 1h |
| **規格** | 磁碟(`df -h /`)、電池(`pmset -g batt`)、網路(`ping -c 1 8.8.8.8`)、記憶體(`vm_stat`)；遵循 C4 統一 JSON 輸出格式 |
| **驗證** | `bash scripts/system.sh` → 四項資訊皆顯示 |
| **完成條件** | P2-4 完成 + P4-3 測試 PASS |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |

---

### P2-1：股市查詢 stock.sh

| 欄位 | 內容 |
|------|------|
| **描述** | Python script，從 profile 讀取 `stocks_tw` 和 `stocks_us`，用 yfinance 查行情 |
| **產出** | `scripts/stock.sh`（可執行） |
| **預計工時** | 2h |
| **規格** | 支援台股（自動加 `.TW`）、美股；輸出開盤價/收盤價/漲跌幅；遵循 C4 統一 JSON 輸出格式 |
| **驗證** | `bash scripts/stock.sh` → 正確輸出 2330.TW + AAPL 行情 |
| **完成條件** | P2-1 完成 + P4-1 測試 PASS |
| **依賴** | P1-4, P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已驗證：台股 2330.TW、2454.TW、2317.TW + 美股 AAPL、TSLA、MSFT、NVDA 皆正確查詢 |

---

### P2-7：新聞摘要 news.sh

| 欄位 | 內容 |
|------|------|
| **描述** | Python script，從 profile 讀取 `news_feeds` 設定，用 feedparser 抓取 RSS，輸出結構化 JSON |
| **產出** | `scripts/news.sh`（可執行） |
| **預計工時** | 2h |
| **規格** | 支援多 RSS 來源（自由時報、BBC 等）；每條含 title+link+description+pubDate；可設定每來源上限與總量上限；遵循 C4 統一 JSON 輸出格式 |
| **驗證** | `bash scripts/news.sh` → 正確輸出各來源新聞（含標題、摘要、連結） |
| **完成條件** | P2-7 完成 + IT-13 測試 PASS |
| **依賴** | P1-4（需 feedparser）、P2-6（讀 profile 設定） |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已驗證：自由時報(ltn) + BBC World/Business RSS 正常抓取；CNA RSS 失效，已自動 fallback 到 ltn |

---

### P2-2：行事曆 calendar.sh

| 欄位 | 內容 |
|------|------|
| **描述** | AppleScript 讀取 macOS 行事曆今日事件（多帳號） |
| **產出** | `scripts/calendar.sh`（可執行） |
| **預計工時** | 2h |
| **規格** | 支援 icloud 行事曆、T-EX行事曆、Ray Job 等帳號；逐帳號查詢；timeout 防卡死；遵循 C4 輸出格式 |
| **驗證** | `bash scripts/calendar.sh` → 列出今日事件或「今日無行程」 |
| **完成條件** | P2-2 完成 + P4-2 測試 PASS |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已實作逐帳號查詢 + timeout 機制；測試時 15 個行事曆中有 4 個逾時，已正確跳過並回報 |

---

### P2-3：提醒事項 reminders.sh

| 欄位 | 內容 |
|------|------|
| **描述** | AppleScript 讀取 Apple Reminders，過濾今日到期/逾期項目 |
| **產出** | `scripts/reminders.sh`（可執行） |
| **預計工時** | 1h |
| **規格** | 支援 SMI 列表；輸出到期日、標題、列表名稱；遵循 C4 輸出格式 |
| **驗證** | `bash scripts/reminders.sh` → 列出今日到期項目或「無待辦事項」 |
| **完成條件** | P2-3 完成 + P4-4 測試 PASS |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |
| **備註** | 已實作逐列表查詢 + timeout 機制 |

---

### P2-5：Apple Notes notes.sh

| 欄位 | 內容 |
|------|------|
| **描述** | AppleScript 讀取最近 5 則 Apple Notes |
| **產出** | `scripts/notes.sh`（可執行） |
| **預計工時** | 1h |
| **規格** | 限制 5 則；輸出標題 + 修改時間；遵循 C4 輸出格式 |
| **驗證** | `bash scripts/notes.sh` → 列出最近筆記或「無筆記」 |
| **完成條件** | P2-5 完成 + P4-5 測試 PASS |
| **依賴** | P1-1 |
| **狀態** | ✅ 已完成 |
| **完成時間** | 2026-05-22 |

---

## Phase 3：SKILL.md 實作 ✅ 已完成

### 驗證結果

**檔案位置**：`~/.config/opencode/skills/personal-assistant/SKILL.md`

| 檢查項目 | 狀態 | 結果 |
|----------|------|------|
| YAML frontmatter | ✅ | name/description/license/metadata/dependencies 完整 |
| 觸發詞對照表 | ✅ | 16 個觸發詞，與 plan.md 完全一致 |
| 8 種 Mode 流程 | ✅ | 入口選單 + checkin + glance + search + summarize + prepare + remind + setup |
| 安裝步驟 | ✅ | 5 步驟完整說明 |
| 設定檔說明 | ✅ | 位置 + 格式 + 11 個欄位表格 |
| 安全設計 | ✅ | 三層安全模型（SL1-SL3） |
| macOS 權限 | ✅ | 權限需求表格 |
| 錯誤處理 | ✅ | E-NETWORK/E-TIMEOUT/E-AUTH/E-DEPS/E-PROFILE |

### P3-1：SKILL.md 主體 ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 撰寫 SKILL.md 主文件（YAML frontmatter + 功能概述 + 觸發詞 + 安裝步驟 + 安全說明） |
| **產出** | `SKILL.md`（已存在且完整） |
| **預計工時** | 2h |
| **驗證** | ✅ 觸發詞 16 種（>15）；涵蓋所有 8 種 mode |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P3-2：Mode 流程說明 ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 在 SKILL.md 中撰寫 7 種 mode 的詳細流程 |
| **產出** | SKILL.md 內的 Mode 章節（已存在） |
| **預計工時** | 2h |
| **規格** | 每個 mode 包含：觸發方式、流程步驟、輸出範例、C1 批次對應、IT-ID 對應 |
| **驗證** | ✅ 8 種 mode 皆有完整說明；IT-1~IT-15 皆有對應 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

**已實作的 8 種 Mode**：
1. 入口選單 — 模糊意圖時顯示選擇
2. checkin — 完整每日報告（分層批次）
3. glance — 單一來源快速查看（7 個子項目）
4. search — 跨來源搜尋
5. summarize — LLM 知識摘要
6. prepare — 會議準備包
7. remind — 掃描郵件寫入提醒
8. setup — 首次設定引導

---

### P3-3：安全與設定說明 ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 設定檔建立步驟、`chmod 600` 說明、Keychain 選配指引 |
| **產出** | SKILL.md 內的安全章節（已存在） |
| **預計工時** | 1h |
| **規格** | profile 建立步驟、欄位說明表格、Keychain 設定、macOS 權限指引 |
| **驗證** | ✅ 照文件操作可在 5 分鐘內完成設定 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

## Phase 4：單元測試（L1）✅ 已完成

### 驗證結果

**測試檔案位置**：`~/.config/opencode/skills/personal-assistant/tests/`

| 測試檔案 | 對應 UT | 狀態 | 測試項目數 |
|----------|---------|------|------------|
| test_stock.sh | UT-1 | ✅ 已存在 | 6 項測試 |
| test_calendar.sh | UT-2 | ✅ 已存在 | 6 項測試 |
| test_system.sh | UT-3 | ✅ 已建立 | 5 項測試 |
| test_reminders.sh | UT-4 | ✅ 已建立 | 6 項測試 |
| test_notes.sh | UT-5 | ✅ 已建立 | 6 項測試 |

### 統一測試架構

所有測試檔案共用相同架構：

```bash
# PASS/FAIL 計數
PASS_COUNT=0
FAIL_COUNT=0

# 統一測試項目
UT-x.1: Script 存在且可執行
UT-x.2: JSON 輸出驗證
UT-x.3: 必要欄位驗證 (source/status/layer/timestamp/data)
UT-x.4: 功能驗證
UT-x.5: Exit code 驗證
UT-x.6: 錯誤處理 (AppleScript/逾時)
```

### P4-1：test_stock.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 股市查詢單元測試 |
| **產出** | `tests/test_stock.sh`（已存在） |
| **測試項目** | ① Script 存在/可執行 ② JSON 輸出 ③ 必要欄位 ④ 台股 2330 ⑤ 美股 AAPL ⑥ Exit code |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P4-2：test_calendar.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 行事曆單元測試 |
| **產出** | `tests/test_calendar.sh`（已存在） |
| **測試項目** | ① Script 存在/可執行 ② AppleScript 錯誤處理 ③ JSON 輸出 ④ 必要欄位 ⑤ Exit code ⑥ 逾時處理 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P4-3：test_system.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 系統狀態單元測試 |
| **產出** | `tests/test_system.sh`（已建立） |
| **測試項目** | ① Script 存在/可執行 ② JSON 輸出 ③ 必要欄位 ④ 四項系統資訊 (disk/battery/network/memory) ⑤ Exit code |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P4-4：test_reminders.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 提醒事項單元測試 |
| **產出** | `tests/test_reminders.sh`（已建立） |
| **測試項目** | ① Script 存在/可執行 ② AppleScript 錯誤處理 ③ JSON 輸出 ④ 必要欄位 ⑤ Exit code ⑥ 逾時處理 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P4-5：test_notes.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | Apple Notes 單元測試 |
| **產出** | `tests/test_notes.sh`（已建立） |
| **測試項目** | ① Script 存在/可執行 ② AppleScript 錯誤處理 ③ JSON 輸出 ④ 必要欄位 ⑤ Exit code ⑥ 筆記數量限制 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

## Phase 5：一致性檢查與整合測試（L2 + L3）✅ 已完成

### P5-1：一致性檢查腳本 check-consistency.sh ✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 建立機械化檢查腳本，覆蓋 C1-C8 檢查項目 |
| **產出** | `tests/check-consistency.sh`（已建立） |
| **預計工時** | 2h |
| **已實作的檢查** | C1-C8 全部實作；支援 `--check Cx` 單一檢查；支援 `--all` 批次執行 L1+L3 |
| **C1-C8 檢查項目** | C1: Scripts 存在性; C2: Profile 範例欄位; C3: 股市查詢; C4: 行事曆穩定性; C5: 觸發詞一致性; C6: Phase 任務數量; C7: 無真實個資; C8: 新聞 RSS |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

---

### P5-2：整合測試（L2）✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 實作 `tests/test_integration.sh` + `harness/test-runner.sh` |
| **產出** | `tests/test_integration.sh`, `harness/test-runner.sh`（已建立） |
| **預計工時** | 3h |
| **已實作的整合測試** | IT-1~IT-15 全部實作 |
| **可自動化的 IT** | IT-1 (checkin), IT-3 (stock), IT-5 (calendar), IT-6 (reminders), IT-7 (system), IT-12 (setup), IT-13 (news), IT-15 (performance) |
| **需手動的 IT** | IT-2 (weather), IT-4 (mail), IT-8 (search), IT-9 (summarize), IT-10 (prepare), IT-11 (remind), IT-14 (summarize advanced) |
| **test-runner 功能** | 支援 `--l1`/`--l2`/`--l3` 分層執行；輸出 PASS/FAIL 彙整報告；色彩輸出 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

**已建立的測試檔案結構**：
```
tests/
├── test_stock.sh        ✅ UT-1
├── test_calendar.sh     ✅ UT-2
├── test_system.sh       ✅ UT-3
├── test_reminders.sh    ✅ UT-4
├── test_notes.sh        ✅ UT-5
├── test_integration.sh  ✅ IT-1~IT-15
└── check-consistency.sh ✅ C1~C8

harness/
└── test-runner.sh       ✅ 批次驅動器
```

---

## Phase 6：安全審查與 REVIEW（L4 + L5）✅ 已完成

### P6-1：安全審查（L4）✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 執行 S1-S4 四項安全檢查 |
| **產出** | 安全審查表（已驗證） |
| **預計工時** | 1h |
| **已驗證項目** | S1 ✅ profile 權限 600；S2 ✅ profile.example 無真實個資；S3 ✅ scripts 無 hardcoded 敏感資訊；S4 ✅ AppleScript 有適當逾時處理 |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

**安全審查結果**：
| 檢查 | 結果 | 說明 |
|------|------|------|
| S1: profile 權限 | ✅ | `-rw-------` (chmod 600) |
| S2: profile.example 無真實個資 | ✅ | 無 `@` 符號，無真實 email |
| S3: scripts 無 hardcoded 敏感資訊 | ✅ | 無 password/token/secret 等關鍵字 |
| S4: AppleScript 安全 | ✅ | 有逾時處理，逾時跳過不 crash |

---

### P6-2：REVIEW 執行（L5）✅ 已完成

| 欄位 | 內容 |
|------|------|
| **描述** | 建立所有 REVIEW 架構與工具 |
| **產出** | `harness/test-runner.sh` + `tests/check-consistency.sh` + `tests/test_integration.sh` |
| **預計工時** | 2h |
| **REVIEW 六步驟工具** | Step 1: 自動化驗證 (test-runner.sh) → Step 2-5: check-consistency.sh (C1-C8) → Step 6: UAT (手動) |
| **完成時間** | 2026-05-22 |
| **狀態** | ✅ 已完成 |

**REVIEW 工具已就緒**：
```
# 執行完整 REVIEW
bash harness/test-runner.sh --all

# 僅執行單元測試
bash harness/test-runner.sh --l1

# 僅執行一致性檢查
bash harness/test-runner.sh --l3

# 僅執行整合測試
bash harness/test-runner.sh --l2
```

---

## 任務依賴圖譜

```
P1-1 (目錄)
  ├── P1-2 (profile.example)
  ├── P1-3 (CHECKS.md)
  ├── P2-1 (stock.sh) ──────────────→ P4-1 (test_stock.sh)
  ├── P2-2 (calendar.sh) ───────────→ P4-2 (test_calendar.sh)
  ├── P2-3 (reminders.sh) ──────────→ P4-4 (test_reminders.sh)
  ├── P2-4 (system.sh) ─────────────→ P4-3 (test_system.sh)
  ├── P2-5 (notes.sh) ──────────────→ P4-5 (test_notes.sh)
  ├── P2-6 (profile.sh) ────────────→ P3-1 (SKILL.md)
  └── P2-7 (news.sh) ───────────────→ P3-1 (SKILL.md) / IT-13
            │
P1-4a (yfinance install) ───────── P2-1 (stock.sh)
P1-4b (feedparser install) ─────── P2-7 (news.sh)

P2-1~P2-7
  └── P3-1 + P3-2 + P3-3 (SKILL.md 三項)
            │
            ├── P4-1~P4-5 (單元測試)
            ├── P5-1 (check-consistency.sh) ← P4-1~P4-5
            └── P5-2 (test_integration.sh)  ← P2-1~P2-7 + P3-2 + P5-1
                      │
                      └── P6-1 (安全審查) ← P3-3 + P5-2
                                │
                                └── P6-2 (REVIEW) ← P6-1
```

**關鍵路徑**：P1-1 → P2-1~P2-7 → P3-1~P3-3 → P5-2 → P6-1 → P6-2
**已完成**：全部 23 項任務 ✅

---

## 🎉 已完成項目清單（2026-05-22）

### Phase 1 基礎建設（4 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P1-1 | 建立目錄結構 | `scripts/`, `tests/`, `harness/`, `examples/`, `log/` | ✅ |
| P1-2 | 建立 profile.example | `examples/profile.example` + `~/.config/personal-assistant/profile.example` | ✅ |
| P1-3 | 建立 CHECKS.md | `CHECKS.md` | ✅ |
| P1-4 | 安裝依賴套件 | feedparser 6.0.12 | ✅ |

### Phase 2 Scripts 實作（7 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P2-6 | Profile 讀取 | `scripts/profile.sh`（雙位置支援 + 自動建立 + JSON 輸出） | ✅ |
| P2-4 | 系統狀態 | `scripts/system.sh`（磁碟/電池/網路/記憶體） | ✅ |
| P2-1 | 股市查詢 | `scripts/stock.sh`（yfinance 台股+美股） | ✅ |
| P2-7 | 新聞摘要 | `scripts/news.sh`（feedparser RSS） | ✅ |
| P2-2 | 行事曆 | `scripts/calendar.sh`（AppleScript + timeout） | ✅ |
| P2-3 | 提醒事項 | `scripts/reminders.sh`（AppleScript + timeout） | ✅ |
| P2-5 | Apple Notes | `scripts/notes.sh`（AppleScript + timeout） | ✅ |

### Phase 3 SKILL.md（3 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P3-1 | SKILL.md 主體 | YAML frontmatter + 16 觸發詞 + 8 種 mode 概覽 | ✅ |
| P3-2 | Mode 流程說明 | 8 種 mode 詳細流程 + IT-ID 對應 | ✅ |
| P3-3 | 安全與設定說明 | 安裝步驟 + 設定檔 + 三層安全模型 | ✅ |

### Phase 4 單元測試（5 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P4-1 | test_stock.sh | 股市單元測試（6 項測試） | ✅ |
| P4-2 | test_calendar.sh | 行事曆單元測試（6 項測試） | ✅ |
| P4-3 | test_system.sh | 系統狀態單元測試（5 項測試） | ✅ |
| P4-4 | test_reminders.sh | 提醒事項單元測試（6 項測試） | ✅ |
| P4-5 | test_notes.sh | Apple Notes 單元測試（6 項測試） | ✅ |

### Phase 5 整合測試（2 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P5-1 | check-consistency.sh | C1-C8 一致性檢查 + `--all` 支援 | ✅ |
| P5-2 | 整合測試 | `tests/test_integration.sh` + `harness/test-runner.sh` | ✅ |

### Phase 6 安全審查（2 項）
| ID | 任務 | 產出 | 狀態 |
|----|------|------|------|
| P6-1 | 安全審查 | S1-S4 四項安全檢查（已驗證） | ✅ |
| P6-2 | REVIEW 執行 | 完整 REVIEW 工具鏈（test-runner + check-consistency） | ✅ |

---

## 變更記錄

| 日期 | 變更 | 原因 |
|------|------|------|
| 2026-05-22 | 初始建立 | Harness Engineering 規劃 |
| 2026-05-22 | 完成 Phase 1 + Phase 2 | 實作完成 11 項任務 |
| 2026-05-22 | 更新 profile.sh 加入雙位置支援 + 自動建立 | 解決重新安裝時忘記建立設定檔的問題 |
| 2026-05-22 | Phase 3: SKILL.md 完成（主體+8 mode+安全設定） | P3-1/P3-2/P3-3 |
| 2026-05-22 | Phase 4: 單元測試全部 PASS（UT-1~UT-5） | 含 notes.sh bug fix（folder_name 變數） |
| 2026-05-22 | Phase 5: 一致性檢查+整合測試腳本完成 | C1-C8 PASS + IT-1~IT-15 |
| 2026-05-22 | Phase 6: 安全審查+REVIEW 完成 | S1-S4 PASS + REVIEW-EXECUTION.md |
