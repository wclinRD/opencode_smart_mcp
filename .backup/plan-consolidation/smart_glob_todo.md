# smart_glob 實作 TODO

> 參考設計文件：`smart_glob_plan.md`
> 選定架構：**方案 C 混合架構**（Node.js + ripgrep）

---

## Phase 1：向後相容核心（預計 1-2 天）

- [x] **P1.1** 建立 `src/cli/smart-glob.mjs` 工具檔案
  - 參數：`pattern`（required）、`path`（optional）
  - 底層用 `rg --files --glob` 取代 `Ripgrep.files()`
  - 輸出格式與內建 glob 完全一致（純路徑清單，按 mtime 排序）
  - 上限 100 筆，截斷提示
- [x] **P1.2** 註冊為 `glob` tool ID（直接取代內建 glob）
  - 在 MCP server 中註冊 `smart_glob` 為 `glob` 工具
  - 確保 `pattern` 和 `path` 參數行為與內建一致
- [x] **P1.3** 基礎測試
  - `smart_glob({pattern: "*.ts"})` → 與內建 glob 輸出一致
  - `smart_glob({pattern: "**/*.ts", path: "src"})` → 正確過濾目錄
  - 空結果 → 顯示 "No files found"
  - 超過 100 筆 → 截斷提示

---

## Phase 2：增強過濾（預計 2-3 天）

- [ ] **P2.1** Brace expansion
  - 實作 `expandBraces(pattern)` 函數
  - 支援 `{ts,js,mjs}` 基本語法
  - 支援巢狀 `{a,b/{c,d}}`
  - 展開後多 pattern 用 `rg --glob` 多次或合併
- [ ] **P2.2** 多 pattern + 排除 pattern
  - `patterns: string[]` — OR 邏輯，合併多個 `--glob`
  - `exclude: string[]` — 用 `rg --glob '!pattern'` 排除
- [ ] **P2.3** 檔案類型過濾
  - `type: "file"` → `rg --type file`（或後處理過濾）
  - `type: "dir"` → 只回傳目錄
  - `type: "symlink"` → 只回傳 symlink
- [ ] **P2.4** 大小過濾
  - `minSize` / `maxSize`（位元組）
  - 後處理階段用 `fs.statSync` 過濾
- [ ] **P2.5** 時間過濾
  - `modifiedAfter` / `modifiedBefore` / `createdAfter` / `createdBefore`
  - 支援 ISO 8601 和相對時間（`"7d"`, `"24h"`）
  - 後處理階段用 `fs.statSync` 過濾
- [ ] **P2.6** 深度限制
  - `maxDepth` 參數
  - 用 `rg --max-depth` 或後處理計算路徑深度
- [ ] **P2.7** 可見性控制
  - `hidden: false` → `rg --hidden`（預設 `true` 與內建一致）
  - `ignoreGitignore: true` → `rg --no-ignore`
  - `ignoreVcs: false` → `rg --no-ignore-vcs`

---

## Phase 3：內容搜尋（預計 1-2 天）

- [ ] **P3.1** `content` 參數實作
  - 兩階段執行：
    1. `rg --files --glob <pattern>` → 候選檔案清單
    2. `rg --files-with-matches <content> <候選檔案>` → 過濾
  - 合併結果回傳
- [ ] **P3.2** 內容搜尋選項
  - `contentRegex: false` → `rg --fixed-strings`
  - `contentCaseSensitive: true` → `rg --case-sensitive`
- [ ] **P3.3** 效能優化
  - 候選檔案過多時分批處理
  - 內容搜尋 timeout 獨立於檔案發現 timeout

---

## Phase 4：進階輸出（預計 1-2 天）

- [ ] **P4.1** JSON 格式輸出
  - `format: "json"` → 結構化 JSON
  - 包含 `count`, `total`, `truncated`, `pattern`, `elapsed`, `files[]`
  - 每個 file 含 `path`, `size`, `mtime`, `type`
- [ ] **P4.2** 分組輸出
  - `format: "grouped"` → 依目錄分組顯示
  - 顯示檔案大小
  - 底部統計摘要
- [ ] **P4.3** 統計輸出
  - `format: "stats"` → count-only 模式
  - 顯示總數、總大小、最大檔案、最新檔案
- [ ] **P4.4** 排序與分頁
  - `sort: "name" | "size" | "mtime" | "ctime"`
  - `order: "asc" | "desc"`
  - `offset` + `limit` 分頁
- [ ] **P4.5** 檔案 metadata
  - `includeStats: true` → 在 paths 格式中也附帶 stat 資訊

---

## Phase 5：效能與安全（預計 1-2 天）

- [ ] **P5.1** Pattern 策略分派
  - 實作 `analyzePattern()` 函數
  - ExtensionStrategy / PrefixStrategy / SuffixStrategy / LiteralStrategy / GlobStrategy
  - 根據策略選擇最優 rg 參數組合
- [ ] **P5.2** Timeout 機制
  - `timeout` 參數（預設 30000ms）
  - `child_process` 用 `timeout` + `killSignal`
  - 超時時回傳部分結果 + 警告
- [ ] **P5.3** Symlink 防護
  - `followSymlinks: false`（預設）
  - `followSymlinks: true` 時追蹤 symlink，上限 32 層
- [ ] **P5.4** 結果快取
  - 相同 `pattern` + `path` + 過濾條件 → 短期快取（10 秒 TTL）
  - 減少重複查詢的開銷
- [ ] **P5.5** 安全上限
  - `MAX_LIMIT: 10000`
  - `MAX_TIMEOUT: 120000`
  - `MAX_DEPTH: 64`

---

## Phase 6：測試與文件（預計 1 天）

- [ ] **P6.1** 單元測試
  - Brace expansion 測試
  - 策略分派測試
  - 時間解析測試（ISO 8601 + 相對時間）
- [ ] **P6.2** 整合測試
  - 與內建 glob 輸出一致性測試
  - 各種 format 輸出測試
  - 內容搜尋測試
  - 過濾組合測試
- [ ] **P6.3** 效能測試
  - 大型專案（100K+ 檔案）的響應時間
  - 與內建 glob 的效能對比
- [ ] **P6.4** 文件更新
  - 更新 system prompt 中的 glob 描述
  - 更新路由規則中的 glob 使用說明

---

## 優先級摘要

| Phase | 優先級 | 預計工時 | 關鍵產出 |
|-------|--------|---------|---------|
| Phase 1 | 🔴 P0 | 1-2 天 | 向後相容的 glob 替代品 |
| Phase 2 | 🟠 P1 | 2-3 天 | 完整的檔案過濾能力 |
| Phase 3 | 🟠 P1 | 1-2 天 | 內容搜尋（殺手級功能） |
| Phase 4 | 🟡 P2 | 1-2 天 | 多種輸出格式 |
| Phase 5 | 🟡 P2 | 1-2 天 | 效能優化 + 安全防護 |
| Phase 6 | 🟢 P3 | 1 天 | 測試 + 文件 |

**總預計工時**：7-12 天

---

## 相依關係

```
Phase 1 ──→ Phase 2 ──→ Phase 3
                │
                └──→ Phase 4（可並行）
                │
                └──→ Phase 5（可並行）
                          │
Phase 2 + 3 + 4 + 5 ──→ Phase 6
```