---
name: asic1-weekly-report
description: Generate weekly report DOCX for ASIC1 team (DennisLin format). Accepts task items with progress, multi-level hierarchy, auto-colors Done items gray. Outputs .docx matching company template.
license: MIT
compatibility: opencode
metadata:
  audience: macos_users
  workflow: asic1-weekly-report
  requires: python-docx
---

# asic1-weekly-report

## 功能

Generate weekly report `.docx` for ASIC1 team. Matches DennisLin weekly report format — header table (department, date, author), instruction paragraph, and task table with Items/Progress columns.

Key features:
- **Multi-level numbering**: items can specify level=0/1/2/3 for hierarchy
- **Gray color**: items with progress "Done" get gray text (A6A6A6)
- **Theme fonts**: preserves minorHAnsi/minorEastAsia (Calibri/微軟雅黑)
- **Progress alignment**: center-aligned with negative indent matching original
- **1:1 item/progress**: each item gets exactly one progress cell

## 使用時機

當使用者說出以下內容時觸發：

- 「產生週報」/「寫 ASIC1 週報」
- 「asic1 週報」/「asic weekly report」
- 「產出 DennisLin 格式週報」
- 「建立本週工作報告 docx」

## 使用方法

腳本與 SKILL.md 同目錄：

```bash
# 基本用法
python3 <skill_dir>/generate_weekly_report.py \
  --date "2026/05/28" \
  --author "林文仲" \
  --department "IC設計部" \
  --items "SM2758 Plan:Discussion::On-going" \
            "Milestone.1 Main feature (3/E)::80%" \
  --output "DennisLin_1_2_ZA0603.docx"
```

### CLI 項目格式

`"項目文字::進度"` — 雙冒號分隔項目與進度。
注意：CLI 用雙冒號 `::`（非單冒號），因項目文字常含單冒號（如 "SM2758 Development Plan:Discussion"）。

暫不支援 CLI 指定層級，請改用 JSON 輸入。

### JSON 輸入（支援層級）

```json
{
  "department": "IC設計部",
  "date": "2026/05/28",
  "author": "林文仲",
  "items": [
    {"item": "SM2758 Development Plan", "progress": "", "level": -1},
    {"item": "Discussion", "progress": "", "level": 0},
    {"item": "Auto acquired read buffer address", "progress": "Done", "level": 1},
    {"item": "Milestone", "progress": "", "level": 0},
    {"item": "[Feature] inverse Zigzag CMDQ (4/E)", "progress": "80%", "level": 1},
    {"item": "FPGA", "progress": "", "level": 0},
    {"item": "M2 version FPGA try-run", "progress": "On-going", "level": 1}
  ]
}
```

執行：

```bash
python3 <skill_dir>/generate_weekly_report.py \
  --json-input weekly_items.json \
  --output "DennisLin_1_2_ZA0603.docx"
```

## 層級說明

每個 item 可指定 `level` 值：

| level | 用途 | 範例 |
|-------|------|------|
| `-1` | 區段標題（無編號，無 numPr） | `"SM2758 Development Plan"` |
| `0` | 一級項目 | `"Discussion"`, `"Milestone"`, `"FPGA"` |
| `1` | 二級項目 | `"[Feature] inverse Zigzag CMDQ (4/E)"` |
| `2` | 三級項目 | `"Hierarchy Partition"` |
| `3` | 四級項目 | `"[M2IO] Warmup cycle"` |

對應到 Word 的編號：

```
1.  Discussion (level=0)
   1.1  Auto acquired read buffer address (level=1)
   1.2  Auto SN comparison (level=1)
2.  Milestone (level=0)
   2.1  [Feature] inverse Zigzag CMDQ (level=1)
3.  FPGA (level=0)
```

## 寫作風格指南

實際產出週報時，請參考原始 DennisLin 範本的風格：

1. **Section headers**: 無編號的區段標題（level=-1），直接描述專案名稱
2. **Milestone 結構**: 用 `level=0 "Milestone"` 作為大分類，下接 `level=1` 的具體工作項目
3. **項目前綴**: `[Feature]`, `[M2IO]`, `[issue]` 等方括號標籤表示工作類型
4. **人員標註**: `(Piper)`, `(Kyle/Taylor)`, `(Terry)` 等表示負責人
5. **進度表示**: `Done`（灰色）、`On-going`、`Pending`、`80%`、`90%` 等
6. **狀態附註**: `Wait M2 update database 5/11`、`Doc Ready, Continue on C code flow translated` 等

## 資料來源

產生週報前，建議先執行 `weekly-report` skill 收集資訊：

```bash
bash ~/.config/opencode/skills/weekly-report/generate-weekly-report.sh new
```

然後從產出的 `.md` 週報檔中提取 ASIC1 相關項目，轉換為 JSON 輸入。

## 進度值顯示規則

| 進度值 | 顯示效果 |
|--------|---------|
| `Done` | 灰色文字 (A6A6A6)，項目字體灰色 |
| `On-going` | 黑色文字 |
| `Pending` | 黑色文字 |
| `80%`, `90%` 等 | 黑色文字，百分比格式 |

## 產出格式

```
┌─────────┬──────────────┬──────┬──────┬──────────────┐
│ 部門    │ IC設計部      │      │ 日期 │ 2026/05/28   │
├─────────┼──────────────┼──────┼──────┼──────────────┤
│ 撰寫人  │              │      │      │ 林文仲       │
└─────────┴──────────────┴──────┴──────┴──────────────┘

工作週報應於每週一中午前繳交，中英不拘。內容以敘述過去一週工作重點為
主，包含主要工作項目、面對之問題、解決之問題、與重要發現。

┌──────────────────────────────────────────────────────────┬──────────┐
│ Items                                                    │ Progress │
├──────────────────────────────────────────────────────────┼──────────┤
│ SM2758 Development Plan                                  │          │
│   1. Discussion                                          │          │
│     1.1 Auto acquired read buffer address                │    Done  │
│     1.2 Auto SN comparison                               │    Done  │
│     1.3 SM2758 Buffer analysis with Daniel               │ On-going │
│   2. Milestone                                           │          │
│     2.1 [Feature] inverse Zigzag CMDQ (4/E) (Piper)     │ On-going │
│     ...                                                  │          │
└──────────────────────────────────────────────────────────┴──────────┘
```

## 注意事項

- 需要 `python-docx`：`pip3 install python-docx`
- 字型大小固定 20 half-pt (10pt)，與公司範本一致
- 進度欄位支援：`Done`（自動灰色）、`On-going`、`Pending`、百分比
- 範本自動從 `~/Downloads` 或專案目錄找最新的 `DennisLin_1_2_ZA*.docx`
- JSON 輸入支援 `level` 欄位，CLI `--items` 暫不支援層級
- 項目文字若含特殊字元，建議使用 JSON 輸入
- 產出 DOCX 已驗證在 Microsoft Word 中可正常開啟
