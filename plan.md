# smart_fast_apply 強化計畫

## ✅ Diff Rendering Enhancement 已完成
- ANSI 色碼輸出（+綠/-紅/@@青），支援 terminal 直接顯示
- 檔案語言映射（chroma 相容），TUI 也可語法高亮
- `format:"ansi"` 模式：純 ANSI 輸出，無 code block
- 向後相容：不影響現有 ` ```diff ` 格式（web/Shiki 可繼續用）

**opencode TUI 限制**：MCP 工具輸出無法用 custom renderer（#21018），
只能透過 chroma code block 語言 tag 間接達成效用。
若未來 opencode 實作 `diff.v1` metadata kind（#15451），
可移除 ANSI hack，改用原生 diff renderer。

## 目標
將 smart_fast_apply 的編輯衝突率從 ~25% 降至 ~2.5%，透過 4 個階段的技術升級。

## 路線圖

```
Phase 0 (1天)  Phase 1 (4天)   Phase 2 (0.5天)  Phase 3 (2天)
┌──────────┐   ┌──────────┐   ┌──────────┐    ┌──────────┐
│ P4:      │ → │ P1:      │ → │ P2:      │ →  │ P3:      │
│ BlockDiff│   │Tree-sitter│   │d-m-patch │    │AST驗證   │
│ 0 dep    │   │+WASM dep │   │ 0 dep    │    │重用P1    │
└──────────┘   └──────────┘   └──────────┘    └──────────┘
```

## Phase 0：BlockDiff 新格式
- **實作時間**：1 天
- **新依賴**：無（使用現有 `extractSymbol()`）
- **預期效果**：衝突率 ↓10-15%

### 實作內容
1. 在 `inputSchema.format.enum` 加入 `block-diff`
2. 新增 `parseBlockDiff()` 解析器
3. Handler 中轉為 `applyHashline()` 呼叫
4. 更新 description 文件

## Phase 1：Tree-sitter AST 匹配層
- **實作時間**：4 天
- **新依賴**：`web-tree-sitter` + `tree-sitter-wasms`
- **預期效果**：衝突率 ↓40-50%

### 實作內容
1. `npm install web-tree-sitter tree-sitter-wasms`
2. 建立 `src/lib/ast-engine.mjs`
   - `initParser(lang)` — lazy WASM 載入
   - `locateSymbol(content, lang, name)` — AST 節點定位
   - `matchByAST(content, lang, searchBlock)` — AST-aware 區塊匹配
   - `validateSyntax(content, lang)` — 語法驗證
3. `fuzzyMatch()` 加入 L7 fallback（AST 匹配）
4. 5 語言測試（JS/TS/PY/RS/GO）

## Phase 2：Google diff-match-patch 降級
- **實作時間**：0.5 天
- **新依賴**：無（直接嵌入，單檔無依賴）
- **預期效果**：衝突率 ↓10-15%

### 實作內容
1. 複製 Google diff-match-patch 核心
2. `fuzzyMatch()` 最尾端加入 `patch_apply()` 嘗試

## Phase 3：AST 驗證 + 自動修復循環
- **實作時間**：2 天
- **新依賴**：重用 Phase 1 的 `ast-engine.mjs`
- **預期效果**：衝突率 ↓25-30%（從剩餘衝突中救回）

### 實作內容
1. apply 後自動 `validateSyntax()`
2. 常見錯誤自動修復（縮排、遺漏分號）
3. 最多 2 輪自修復
4. 修不了 → 回 LLM 重試

## 衝突率疊加效果
```
Phase 前:  25.0% 衝突
Phase 0:  → 12.5%（↓50%） BlockDiff 減少誤差
Phase 1:  →  6.2%（↓50%） AST 匹配解決空白/排版差異
Phase 2:  →  3.1%（↓50%） diff-match-patch 捕撈剩餘
Phase 3:  →  1.5%（↓50%） 自修復處理語法錯誤
```

---

# smart_grep 強化計畫

## 背景
2025-2026 年程式碼搜尋技術快速演進，業界共識為「grep 替代品不是一個工具，而是三個」：
**lexical（文字）+ structural（結構）+ graph（關係圖）**。

目前 smart_grep 是純 Node.js regex 搜尋引擎，無索引、無排名、無 semantic、無 tree-sitter。

## 研究參考
| 工具 | 核心技術 | 參考價值 |
|------|---------|---------|
| semble_rs | BM25 + Model2Vec hybrid, tree-sitter AST, code-aware reranking | ⭐⭐⭐ |
| ColGREP | Identifier-aware BM25, camelCase 分割, NDCG +0.3 | ⭐⭐⭐ |
| codixing | Trigram pre-filter (110x), BM25+PageRank, incremental sync | ⭐⭐⭐ |
| Zoekt | Trigram 索引, sub-50ms, BM25 scoring | ⭐⭐ |
| clew | Hybrid search, 7-type relationship graph, intent routing | ⭐⭐ |
| Vectr | AST chunking, symbol graph, 6 fallback strategies | ⭐⭐ |
| ripgrep 15 | SIMD Teddy, HIR bridge literal extraction (3.23x) | ⭐ |
| ugrep 7.5 | Predict-match PM3+PM5, identifier-aware | ⭐ |

## 路線圖

```
Phase 1 (2-3天)     Phase 2 (1週)       Phase 3 (2週)
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│ BM25排名     │ → │ worker_threads│ →  │ Trigram索引  │
│ Identifier   │   │ 平行搜尋      │    │ Incremental  │
│ Reranking    │   │ Tree-sitter   │    │ indexing     │
│ 0 dep        │   │ +WASM dep     │    │ SQLite FTS5   │
└──────────────┘   └──────────────┘    └──────────────┘
```

## Phase 1：排名與相關性（短期、高回報）
- **實作時間**：2-3 天
- **新依賴**：無（純 JS BM25）
- **預期效果**：搜尋結果品質 ↑50%，LLM token 浪費 ↓30%

### 實作內容
1. **BM25 排名** — 對 searchFiles 結果做 BM25 相關性排序
   - 參考 Zoekt BM25Scoring、codixing BM25+PageRank
   - 支援 `--rank bm25` / `--rank none` 參數
2. **Identifier-aware tokenization** — camelCase/PascalCase/snake_case 分割
   - 參考 ColGREP IdentifierAware tokenizer
   - 查詢 `parseRequest` 自動匹配 `parse_request`、`parse request`
3. **Code-aware reranking signals**
   - Definition boost：符號定義行 +0.25 權重
   - Test demotion：test/spec 檔案 -0.30 權重
   - File-coherence boost：同檔案多匹配 +0.20 權重
   - 參考 semble_rs ranking signals

## Phase 2：效能與精準度（中期）
- **實作時間**：1 週
- **新依賴**：`web-tree-sitter` + `tree-sitter-wasms`
- **預期效果**：大型專案搜尋 3-5x 加速，scope 精準度 ↑80%

### 實作內容
1. **worker_threads 平行搜尋** — 多核加速檔案掃描
   - 參考 ripgrep rayon work-stealing
2. **Tree-sitter AST scope detection** — 取代 regex 猜測
   - 支援 JS/TS/Python/Rust/Go/PHP/Ruby/Java
   - 精準定位函式/類別/介面邊界
3. **AST-aware chunking** — 以語法單元為搜尋單位
   - 參考 semble_rs、clew tree-sitter chunking

## Phase 3：索引與增量（長期）
- **實作時間**：2 週
- **新依賴**：`better-sqlite3`
- **預期效果**：大型專案搜尋 10-50x 加速

### 實作內容
1. **Trigram 索引** — 基於 SQLite FTS5 或自建
   - 參考 Zoekt trigram 設計、codixing trigrep
   - 支援 `--index build` / `--index search` / `--index update`
2. **Incremental indexing** — mtime 或 git diff 增量
   - 參考 code-indexer Merkle tree sync
3. **Trigram pre-filtering** — 搜尋前先過濾不相關檔案
   - 參考 codixing 110x literal grep 加速

## 長期展望（Phase 4+）
- Hybrid BM25 + Semantic search（需 embedding model）
- Call graph / Dependency graph traversal
- SIMD 加速（WASM SIMD 或 native addon）

---

# exa 工具全系列提升至 Layer 1 ✅

## 背景
exa_search、exa_crawl、github_search 原本是 Layer 2 sub-tools，需透過 `ssr()` 呼叫。
但它們都是獨立搜尋工具，不依賴其他工具，使用頻率高。

## 已完成變更
- ✅ 搬移 `exa_search.mjs` → `src/plugins/core/`（Layer 1）
- ✅ 搬移 `exa_crawl.mjs` → `src/plugins/core/`（Layer 1）
- ✅ 搬移 `github_search.mjs` → `src/plugins/core/`（Layer 1）
- ✅ 更新 `config/agents/smart-mcp.md`：Layer 1 表格 + 權限
- ✅ 更新 `src/server/index.mjs` ROUTER_DESCRIPTION
- ✅ 保留 `ssr({tool:"exa_search"})` 向後相容（routerTools 仍可透過 smart_run 呼叫）

## 使用方式
```
# 直接呼叫（Layer 1）
smart_exa_search({command:"search", query:"latest AI news"})
smart_exa_crawl({urls:"https://example.com", clean:true, markdown:true})
smart_github_search({query:"useState", language:"typescript"})
```
