# Caveman Compression 整合計畫

> 將 Caveman 語義壓縮技術整合到 `smart_exa_search` / `smart_exa_crawl`，節省搜尋結果 15-30% token

## 背景

Caveman Compression 是 2025-2026 年最主流的 LLM token 節省技術（GitHub 38K+ stars），核心原理：

- **移除可預測的**：articles、connectives、被動語態、填充詞、禮貌用語
- **保留不可預測的**：數字、名稱、日期、技術術語、URL、程式碼

## 架構

```
搜尋結果文字 → caveman compress → 壓縮後文字（餵給 LLM）
```

Pipeline 位置（最後一層）：
```
fetch → clean (Readability) → markdown (Turndown) → chunk → 🆕 caveman → 輸出
```

## Phase 規劃

### Phase 1: caveman.mjs 壓縮引擎
- 檔案：`src/cli/lib/caveman.mjs`
- 零依賴，純規則引擎（9 條規則管線）
- 支援三級壓縮：`light` / `semantic` / `aggressive`
- 預期：15-30% token 節省，<1ms 延遲

### Phase 2: exa-search.mjs 整合
- 新增 `--caveman` / `--caveman-level` CLI 參數
- 在 `cmdSearch`、`cmdCrawl`、`cmdCode` 輸出前套用 caveman
- 支援 `--caveman` 與 `--chunk` 並用

### Phase 3: exa_search.mjs plugin schema
- 新增 `compress` 參數：`none` | `caveman`
- 新增 `compressLevel` 參數：`light` | `semantic` | `aggressive`
- 更新 `smart_exa_crawl` 同步支援

### Phase 4（未來）: LLM-based 後端
- 用本地 Ollama 或 OpenAI-compatible endpoint 做 caveman 壓縮
- 40-58% token 節省

## 技術參考

| 實作 | 壓縮率 | 特色 |
|------|--------|------|
| wilpel/caveman-compression | 15-58% | 原創 Python，三種後端 |
| JuliusBrussee/caveman | 65-75% | Claude Code Skill，38K+ stars |
| ether-btc/rust-cave-001 | 48-55% | Rust+PyO3，9 條規則 |
| Elastic-caveman | 63.6% | 100% 技術值保留 |

## 9 條壓縮規則（取自 rust-cave-001 + wilpel spec）

1. 句子分割 — 按 `.` `!` `?` 分割
2. 代名詞解析 — 替換模糊代名詞
3. 主動語態轉換 — 被動 → 主動
4. 現在式正規化 — 過去式 → 現在式
5. 強化詞移除 — very/extremely/quite
6. 冠詞移除 — the/a/an
7. 連接詞移除 — therefore/however/because
8. 字數限制 — 每句 ≤5 字
9. 邏輯完整性 — 至少 2 字