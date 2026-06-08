---
name: stock-quant-analyzer
description: 台美股量化評估分析 — 基於 [[美股量化評估方法論]] 四層框架（資料管線→多因子評分→情境分析→風險管理）。自動化 yfinance + web scraping + Exa search，完全免費無需 API key。支援 quick/full 雙模式、US/TW 雙市場、歷史對比、事件情境引擎、Scraper 斷路器、Obsidian 寫入。
license: opencode
compatibility: opencode
version: 2.1
---

# Skill: stock-quant-analyzer v2.1

台美股量化評估分析。基於 [[美股量化評估方法論]] 的 25+ 指標 × 4 面向框架（估值面 / 資金流信用面 / 技術面 / 總經面），自動化執行：資料收集 → 評分計算 → 事件情境感知 → 風險等級 → 報告產出。

### What's New in v2.1
- **US市場**: 商品ETF (GLD/SLV/CPER) 取代期貨、外匯 (EUR/USD、USD/JPY)、板塊輪動分析 (XLF/XLK/XLE/XLU)、風險代理 (HYG/LQD/TLT/BTC/EEM/SOX)
- **台股支援**: 基本評分（TWII PE/200MA偏離/RSI），維度自動過濾（無 US 特有指標）
- **Scraper 斷路器**: 連續 3 次失敗 → 跳過 1 小時（JSON 持久化）
- **事件情境引擎**: 通用日曆模式 — 財報季 / 除息 / Fed靜默 / OPEX / 季末再平衡 / 經濟數據發布
- **整合測試**: 9 項全管線測試（含評分聚合、報告生成、複合計算、事件情境結構）
- **已知限制**: 仍依賴 Exa search 補充 13 項指標（BofA/CPI/FedWatch/AAII 等）

## 觸發條件

- "量化分析美股" / "量化分析台股" / "分析台美股"
- "跑評分卡" / "每週市場評估" / "check market health"
- "美股現在風險等級?" / "台股估值如何?"
- "stock quant" / "market risk assessment"

## 快速開始

```bash
# 美股快速評估（~15秒，8 個自動化指標）
python3 scripts/quant_analyzer.py --market us --mode quick --output report

# 台股快速評估
python3 scripts/quant_analyzer.py --market tw --mode quick --output report

# 美股完整評估（含市場寬度，~45秒）
python3 scripts/quant_analyzer.py --market us --mode full --output report

# 含歷史對比
python3 scripts/quant_analyzer.py --market us --output report --compare

# 儲存到 Obsidian
python3 scripts/quant_analyzer.py --market us --output report --save-obsidian

# 查看歷史
python3 scripts/quant_analyzer.py --history
```

## 架構

```
stock-quant-analyzer/
├── SKILL.md                  # 本檔案
├── config.json               # 基準值、權重、風險等級設定
├── scripts/
│   ├── quant_analyzer.py     # 主 orchestrator（CLI 入口）
│   ├── fetchers.py           # yfinance 資料擷取（含 fallback）
│   ├── scrapers.py           # Web scraping（CAPE/AAII/FedWatch/PCR）
│   ├── scoring.py            # 20 指標評分規則（純函數）
│   ├── cache.py              # JSON 快取層（TTL-based）
│   ├── history.py            # 歷史追蹤與對比
│   └── requirements.txt      # yfinance, pandas, numpy, lxml
└── .cache/                   # 快取目錄（自動建立）
    ├── stock_quant_cache.json
    └── score_history.json
```

## 完整工作流（LLM 執行）

當使用者觸發此 skill 時，依以下步驟執行：

### Phase 1: 自動化資料收集

```bash
# Step 1.1: 執行 Python 腳本（自動化 yfinance + scrapers）
python3 scripts/quant_analyzer.py --market {us|tw|both} --mode {quick|full} --output json
```

此步驟自動取得以下指標：

| 類別 | 自動化指標 | 來源 |
|:-----|:----------|:-----|
| 價格 | 指數價格、200MA 偏離、RSI(14) | yfinance |
| 估值 | P/E (Trailing)、Forward P/E (fallback SPY→IVV→VOO) | yfinance |
| 估值 | Shiller CAPE | multpl.com scraping |
| 波動 | VIX | yfinance |
| 利率 | 10Y/2Y Treasury、利差 | yfinance |
| 商品/原物料 | WTI 原油、黃金(GLD×10)、白銀(SLV)、銅(CPER×0.16)、布蘭特原油(BNO) | yfinance ETFs |
| 匯率 | DXY、EUR/USD、USD/JPY | yfinance |
| 外國指數 | BTC-USD、EEM、^SOX（半導體） | yfinance |
| 信用/避險 | HYG、LQD、TLT | yfinance |
| 板塊輪動 | XLF、XLK、XLE、XLU（相對強度/循環vs防禦） | yfinance |
| 技術 | 市場寬度 (% >200MA, full mode only) | yfinance (平行化) |
| 台股 | TWII PE、200MA偏離、RSI | yfinance |
| 事件情境 | 財報季/除息/Fed靜默/OPEX/季末/數據發布 | 日曆模式引擎 |

### Phase 2: Exa Search 補充（並行搜尋）

Python 腳本無法自動化的指標，使用 Exa search 補充。**全部同時發送**：

```
⚠️ 腳本會自動輸出 CALENDAR_MONTH/NEXT_MONTH 變數，取代月份

╔═══ US 市場（quick + full）═══════════════════════╗
1. "BofA Bull and Bear indicator latest {CALENDAR_MONTH}"
2. "US core PCE inflation rate latest"
3. "CME FedWatch probability rate hike {CALENDAR_MONTH} FOMC"
4. "AAII investor sentiment survey latest week {CALENDAR_MONTH}"
5. "major geopolitical events impacting markets {CALENDAR_MONTH}"
6. "S&P 500 year end target Goldman Sachs Morgan Stanley consensus"
7. "US stock market news headlines today"
8. "consensus Q2 earnings growth estimate S&P 500"
9. "S&P 500 companies reporting earnings this week {CALENDAR_MONTH}"

╠═══ US 市場（full 模式額外）═══════════════════════╣
10. "US IG investment grade credit spread OAS latest {CALENDAR_MONTH}"
11. "US high yield credit spread OAS latest {CALENDAR_MONTH}"
12. "CBOE equity put call ratio latest {CALENDAR_MONTH}"
13. "US equity fund flows weekly latest {CALENDAR_MONTH}"
14. "Cleveland Fed recession probability latest"
15. "major ETFs ex-dividend dates {CALENDAR_MONTH}"
16. "US economic calendar {CALENDAR_MONTH} key events"

╚═══ TW 市場（quick 額外）═══════════════════════════╝
17. "台灣加權指數本益比(PE ratio) {CALENDAR_MONTH}"
18. "台股外資買賣超 {CALENDAR_MONTH}"
19. "台灣GDP成長率最新數據"
```
⚡ 必搜（quick + full 模式）：
1. "BofA Bull and Bear indicator latest reading June 2026"
2. "US core PCE inflation rate latest May 2026"
3. "CME FedWatch probability rate hike June 2026 FOMC"
4. "AAII investor sentiment survey latest week June 2026"

📋 選搜（full 模式額外）：
5. "US IG investment grade credit spread OAS latest June 2026"
6. "US high yield credit spread OAS latest June 2026"
7. "S&P 500 year end 2026 target Goldman Sachs Morgan Stanley consensus"
8. "CBOE equity put call ratio latest June 2026"
9. "US equity fund flows weekly latest June 2026"
10. "Cleveland Fed recession probability latest 2026"
```

### Phase 3: 評分計算

根據 [[美股量化評估方法論]] 的評分規則，將每個指標轉換為 0-100 分數：

```
US 綜合 = 估值面(avg) × 0.30 + 資金流面(avg) × 0.25 + 技術面(avg) × 0.20 + 總經面(avg) × 0.25
TW 綜合 = 估值面(avg) × 0.50 + 技術面(avg) × 0.50   # 等權重再分配（無 US 特有維度）
```

風險等級對照：

| 分數 | 等級 | 建議曝險 |
|:---:|:-----|:-------:|
| 80-100 | 🟢 極度安全 | 80-100% |
| 65-80 | 🟢 安全 | 70-85% |
| 50-65 | 🟡 中性 | 55-70% |
| 35-50 | 🟠 謹慎 | 40-55% |
| 20-35 | 🔴 風險偏高 | 25-40% |
| 0-20 | 🔴🔴 極度危險 | <25% |

### Phase 4: 報告產出

將 Phase 1-3 的結果組裝為結構化報告。報告格式見下方「輸出格式」。

### Phase 5: 儲存（可選）

若使用者要求儲存，寫入 Obsidian：
```
40-投資/42-總經分析/{美股|台股}量化評估-YYYY-MM-DD.md
```

---

## CLI 參數完整說明

| 參數 | 說明 | 選項 | 預設 |
|:-----|:-----|:-----|:-----|
| `--market` | 目標市場 | `us` / `tw` / `both` | `us` |
| `--mode` | 分析深度 | `quick` (8指標) / `full` (含市場寬度) | `quick` |
| `--output` | 輸出格式 | `json` / `report` / `both` | `json` |
| `--save-obsidian` | 儲存報告到 Obsidian vault | flag | false |
| `--compare` | 與上期報告對比 | flag | false |
| `--history` | 顯示歷史評分趨勢 | flag | false |
| `--no-cache` | 強制重新擷取（略過快取） | flag | false |
| `--no-scrapers` | 略過 web scraping | flag | false |
| `--cache-stats` | 顯示快取統計 | flag | false |
| `--clear-cache` | 清除快取 | flag | false |

---

## Quick vs Full 模式

| 面向 | Quick | Full |
|:-----|:-----|:-----|
| **自動化指標** | 8 個 | 9 個 (+市場寬度) |
| **市場寬度** | ❌ | ✅ (S&P 500 前100檔，平行化) |
| **執行時間** | ~15 秒 | ~45 秒 |
| **適用場景** | 每日快速檢查 | 每週完整評估 |

---

## 輸出格式

### Report 模式（Markdown）

```markdown
# {美股|台股}量化評估報告 — YYYY-MM-DD

> **{指數名稱}：** XXXX　｜　**資料時間：** ...
> **模式：** auto-scores only　｜　**方法論：** [[美股量化評估方法論]]

## 📊 綜合評分卡
| 面向 | 分數 | 權重 | 加權 | 覆蓋 |
...

## 🎯 風險等級：XXXX　｜　建議股票曝險：XX%

## 📈 與上期對比（若有 --compare）
> 上期綜合分數：XX/100
> 本期變動：+X.X → 趨勢

## 各指標明細
### 估值面
| # | 指標 | 數值 | 分數 | 來源 |
...

## 📈 自動化覆蓋率：{auto_count}/{total_count}（{pct}%）

> US 完整: 22/35（63%，12+yfinance + 1 scraped + 9 event/ctx）<br>
> TW 基本: 7/24（29%，PE/200MA/RSI）
```

---

## 資料來源總覽

| 來源 | 類型 | 取得方式 | 需要 API Key |
|:-----|:-----|:--------|:-----------:|
| **yfinance** | 股價/估值/技術/商品/外匯/板塊 | Python library | ❌ 免費 |
| **multpl.com** | Shiller CAPE | Web scraping | ❌ 免費 |
| **CBOE** | Put/Call Ratio | Web scraping + Exa fallback | ❌ 免費 |
| **TradingView** | Barchart PCR（備援） | Web scraping | ❌ 免費 |
| **Exa Search** | BofA/CPI/信用利差/投顧共識/新聞/地緣政治 | MCP tool | ❌ 已整合 |
| **Wikipedia** | S&P 500 成分股清單 | pandas read_html | ❌ 免費 |
| **twse_api** | 台股加權指數/外資買賣超 | Skill | ❌ 已整合 |

---

## 相依 Skill

- `twse_api`：台股模式時自動載入
- `stock-rating-compare`：台股投顧目標價（可選）

## 限制與注意事項

1. **非投資建議**：此分析僅供參考，不構成買賣建議
2. **資料延遲**：yfinance 可能有 15-20 分鐘延遲
3. **資金流面依賴 Exa**：BofA B&B、信用利差、資金流等需 Exa search 補充
4. **台股資料限制**：yfinance 台股資料不如美股完整（僅 3 項自動化指標）
5. **首次使用**：需 `pip3 install yfinance pandas numpy lxml html5lib`
6. **Web scraping 有斷路器**：AAII/FedWatch/PCR連續失敗 3 次 → 跳過 1 小時；CBOE 為主、Barchart 備援
7. **SOX 需 ^ 前綴**：`^SOX` 而非 `SOX`（phlx semiconductor index）
8. **銅價 CPER×0.16**：CPER 追蹤銅期貨，轉換係數約 0.16 倍現貨磅價