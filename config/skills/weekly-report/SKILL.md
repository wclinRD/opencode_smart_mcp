---
name: weekly-report
description: 產生週報並儲存到 Obsidian wiki。從 SMI 郵件、Teams、wiki log/hot、會議記錄自動彙整本週工作項目，產出結構化週報寫入 70-日誌/72-週-月回顧/。
license: MIT
compatibility: opencode
metadata:
  audience: macos_users
  workflow: weekly-report
  requires: Apple Mail.app, Obsidian vault
---

# weekly-report

## 功能

自動彙整本週工作項目，產出結構化週報並寫入 Obsidian wiki。

**三種模式：**

1. **new** — 建立新週報，自動掃描 SMI 郵件 + wiki 更新 + 會議記錄填入，日期週期為 **上週四 ~ 本週三**
2. **fill <file>** — 對已存在的週報檔，重新掃描資料來源補充內容
3. **template** — 僅產生空白週報模板，手動填寫

## 使用時機

當使用者說出以下內容時觸發：

- 「寫週報」/「產生週報」/「本週週報」
- 「週報」/「weekly report」
- 「記錄本週工作」/「整理這週進度」
- 「存週報到 obsidian」

## 使用方法

腳本位址與 skill 同目錄：

```bash
bash <skill_dir>/generate-weekly-report.sh new [date]       # 建立週報（預設今天，週期：上週四~本週三）
bash <skill_dir>/generate-weekly-report.sh fill <file_path>  # 補充已存在的週報
bash <skill_dir>/generate-weekly-report.sh template [date]   # 僅產空白模板
```

### 範例

```bash
# 建立本週週報（自動計算上週四 ~ 本週三）
bash <skill_dir>/generate-weekly-report.sh new

# 指定參考日期
bash <skill_dir>/generate-weekly-report.sh new 2026-05-20

# 產生空白模板
bash <skill_dir>/generate-weekly-report.sh template
```

## 資料來源

腳本自動掃描以下 9 項來源彙整週報內容：

| 來源 | 說明 |
|------|------|
| SMI 郵件 | 透過 AppleScript 掃描指定區間郵件，**自動分組**（UFS5a 細分/M2/SM2755/SM2758/等），**每封附 📧 連結**一鍵回查。預設精簡模式只顯示分組計數，完整列表可折疊展開 |
| Apple Calendar | 透過 AppleScript 讀取行事曆事件，按行事曆名稱分組 |
| Apple Reminders | 讀取指定列表（預設 SMI）的待辦事項，分未完成/已完成 |
| wiki log.md | 讀取 Obsidian wiki 的 log.md 中的 capture/skill_create/migrate 記錄 |
| 會議記錄 | 掃描 `20-工作/24-會議記錄/` 下本週的會議筆記 |
| Obsidian 筆記 | 掃描 vault 中本週新建/修改的 .md 檔案列表 |
| Git log | 從 ~/.opencode、~/.agents 等 git repo 自動擷取本週 commits |
| Teams | 透過 personal-assistant/teams.sh 讀取 Microsoft Teams 聊天室（7 天範圍），含參與者、訊息數量、時間跨度 |
| 主題摘要 | 從郵件標題自動提取高頻關鍵詞，產生本週焦點標籤 |

### 郵件連結功能

每封郵件條目末尾自動附加 `📧` 連結，格式為 `message://%3C...%3E`。

**在 Obsidian 中點擊 `📧` 可直接開啟 Apple Mail 並跳轉到該封原始郵件**，方便回查討論脈絡。範例：

```
● [發信] [2026年5月20日] Re: M2 SF5 4800 ONFI meeting [📧](message://%3C...%3E)
○ [參與] [2026年5月19日] RE: [UFS5a] Analog IP review [📧](message://%3C...%3E)
   寄件人: 同事姓名 <user@company.com>
```

## 日期週期

週報期間固定為 **上週四 ~ 本週三**。例如參考日期為 2026-05-20（週三），則期間為 2026-05-14（四）~ 2026-05-20（三）。

## 郵件呈現方式（精簡模式 + 可折疊列表）

郵件區塊使用 **兩層架構**：

1. **摘要層（預設可見）**：`✉️ 你發出的郵件`（少量，直接展開）+ `👀 參與的討論（摘要）`（只顯示每組討論串計數）
2. **完整層（可折疊）**：用 Obsidian callout `> [!summary]- 📨 完整郵件列表（N 封）` 包裹全部郵件，預設摺疊

```markdown
### ✉️ 你發出的郵件
● [發信] [日期] 主旨 [📧](message://...)

### 👀 參與的討論（摘要）
  🔵 UFS5a - Analog IP ........ **5** threads
  🔵 UFS5a - LDPC ............. **14** threads
  🟢 M2 SF5 / ONFI ............ **3** threads
  ...

> [!summary]- 📨 完整郵件列表（25 封）
>   **🔵 UFS5a - Analog IP** (5)
>   ○ [參與] ...
>   ...
```

## 郵件分組規則

SMI 郵件按以下順序分組：
1. **UFS5a 細分**：Analog IP / PLATS / LDPC / Verification / Synthesis / Floorplan
2. **M2/ONFI**
3. **SM2755 / SM2758**
4. **SM2752P DVT**
5. **Regression**
6. **系統通知**（Calendar/Delivery/Return Receipt）
7. **其他**（未分類的歸入此類）

每組顯示討論串數量的計數徽章。

## 產出格式

週報寫入 `obsidian_vault/70-日誌/72-週-月回顧/{year}-週記-{MMDD}.md`
（`{MMDD}` 為週三的月日，例如 `2026-週記-0520.md`）

新週報包含以下區塊（自動從 8 項資料來源填入）：

```markdown
---
title: "2026-05-14 ~ 2026-05-20"
date: {today}
type: weekly-report
tags: [weekly-report, work]
status: draft
---

# 📆 週記 — 2026-05-14 ~ 2026-05-20

**05/14 (四) → 05/20 (三)**

---

## 📋 一週總覽

| 類別 | 數量 |
|------|------|
| 📧 郵件討論串 | 25 |
| 💬 Teams 聊天 | 4 |
| 📅 會議/行程 | 3 |
| 📝 筆記產出 | 5 |
| 💻 Git commits | 12 |

**出勤：** 05/14(四) ~ 05/20(三)

**🏷️ 本週焦點：** `#LDPC` `#Analog` `#UFS5a` `#ONFI` `#Release`

## 📧 郵件摘要

### ✉️ 你發出的郵件
● [發信] [日期] 主旨 [📧](message://...)

### 👀 參與的討論（摘要）
  🔵 UFS5a - Analog IP ........ **5** threads
  🔵 UFS5a - LDPC ............. **14** threads
  ...

> [!summary]- 📨 完整郵件列表（25 封）
>   **🔵 UFS5a - Analog IP** (5)
>   ○ [參與] ... [📧](...)
>   ...

## 📅 行程與會議
  **行事曆名稱**
  - 2026/5/20 下午3:00 會議主題 @ 地點

### 📄 會議記錄
- 會議筆記連結

## ✅ 待辦事項
  **未完成 (1)**
  - ⏳ 工作項目

  **已完成 (2)**
  - ✅ 已完成項目

## 📝 筆記與產出
  **📋 log.md 記錄**
  - CAPTURE/SKILL_CREATE/WEEKLY_REPORT 等記錄

  **📝 新增/修改筆記**
  - 筆記名稱 (日期)

## 💻 開發進度
  **opencode**
  - abc1234 feat: add new feature
  - def5678 fix: resolve bug

  **agents**
  - ...

## 💬 Teams 討論
  **聊天室名稱** (12 則訊息)
  - 參與者: Name1 / Name2 / Name3
  - 時間: 2026-05-21 ~ 2026-05-27

## 📋 下週計劃
- [ ] （自動從 reminders + 郵件建議）
- [ ] （手動填寫）

---
*🛠️ 由 weekly-report skill 自動產生*
```

## 注意事項

- 需要 `osascript` (macOS 內建)，不需額外安裝
- Apple Mail.app 必須正在執行（郵件掃描功能才可用）
- 需要 Obsidian vault 路徑設定在 `~/.obsidian-wiki/config`
- `new` 模式如果週報已存在，會自動跳過不覆蓋
- 初次執行可能需要授予「輔助使用」權限（系統設定 → 隱私權 → 輔助使用）
- 檔名格式：`{年份}-週記-{週三月日}.md`（例如 `2026-週記-0520.md`）
