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

# smart_grep 強化計畫（v2 — 2026-06 技術更新）

## 背景
2025-2026 年程式碼搜尋技術快速演進，業界共識為「grep 替代品不是一個工具，而是三個」：
**lexical（文字）+ structural（結構）+ graph（關係圖）**。

2026 年 6 月重新調研後，發現以下關鍵趨勢：
1. **Hybrid Semantic Search 已是標配**，不再是「未來展望」— Vera/QEX/Veles/semble_rs 全部內建
2. **Trigram/Sparse N-gram 索引**成為新標準 — Cursor 2026-03 發表 sparse n-gram 論文，trigrep/ngi/fastgrep 實作驗證
3. **Query Type Detection** 自動判斷 symbol/NL/path，選擇最佳搜尋策略
4. **Multi-Signal Ranking** 取代單純 BM25 — POEM 6-signal、cross-encoder reranking
5. **Token Budget Optimization** 對 AI agent 至關重要 — hypergrep/semble_rs 的 token-fitted 輸出

目前 smart_grep 是純 Node.js regex 搜尋引擎，無索引、無排名、無 semantic、無 tree-sitter。

## 研究參考（更新）
| 工具 | 核心技術 | 參考價值 | 新增於 |
|------|---------|---------|--------|
| Vera | BM25+vector+cross-encoder, MRR@10=0.91, 65 langs | ⭐⭐⭐ | v2 |
| QEX | BM25+dense+RRF, Merkle DAG sync, MCP native | ⭐⭐⭐ | v2 |
| Veles | BM25+semantic+RRF, persistent index, query-type detection | ⭐⭐⭐ | v2 |
| semble_rs | BM25+Model2Vec+RRF, code-aware reranking, token-efficient | ⭐⭐⭐ | v1 |
| hypergrep | Structural search, call graph, impact analysis, token budget | ⭐⭐⭐ | v2 |
| trigrep/ngi/fastgrep | Trigram index, 2-70x faster than ripgrep | ⭐⭐⭐ | v2 |
| search-semantically | POEM 6-signal ranking, git recency, import graph | ⭐⭐⭐ | v2 |
| goodgrep | Dense+ColBERT reranking, NL enrichment, MCP native | ⭐⭐ | v2 |
| ColGREP | Identifier-aware BM25, camelCase 分割, NDCG +0.3 | ⭐⭐⭐ | v1 |
| codixing | Trigram pre-filter (110x), BM25+PageRank, incremental sync | ⭐⭐⭐ | v1 |
| Zoekt | Trigram 索引, sub-50ms, BM25 scoring | ⭐⭐ | v1 |
| clew | Hybrid search, 7-type relationship graph, intent routing | ⭐⭐ | v1 |
| Vectr | AST chunking, symbol graph, 6 fallback strategies | ⭐⭐ | v1 |
| ast-grep | Structural pattern matching, code-shaped patterns | ⭐⭐ | v2 |
| Lucerna | AST chunking, hybrid search, knowledge graph, LanceDB | ⭐⭐ | v2 |
| CodeRAG | NL enrichment, hybrid search, token budget optimizer | ⭐⭐ | v2 |
| sensegrep | Semantic+structural, 30+ filters, tree-shaking output | ⭐⭐ | v2 |
| ripgrep 15 | SIMD Teddy, HIR bridge literal extraction (3.23x) | ⭐ | v1 |
| ugrep 7.5 | Predict-match PM3+PM5, identifier-aware | ⭐ | v1 |

## 路線圖（v2 更新）

```
Phase 1 (2-3天)    Phase 2 (1週)      Phase 3 (1週)      Phase 4 (2週)      Phase 5 (2週)
┌──────────────┐  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ BM25排名     │→ │ Hybrid       │→  │ Tree-sitter  │→  │ Trigram/     │→  │ Multi-Signal │
│ Identifier   │  │ Semantic     │   │ Structural   │   │ Sparse N-gram│   │ Ranking      │
│ Query Detect │  │ Model2Vec    │   │ Symbol Graph │   │ Token Budget │   │ Call Graph   │
│ 6 Rerank     │  │ RRF Fusion   │   │ AST Pattern  │   │ Incremental  │   │ Cross-encode │
│ 0 dep        │  │ 0 API key    │   │ +WASM dep    │   │ +SQLite dep  │   │ 可選 GPU     │
└──────────────┘  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

## Phase 1：排名與相關性 + Query Detection ✅（已完成 2026-06-13）
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
3. **Query Type Detection** 🆕 — 自動判斷查詢類型
   - 參考 Veles query-type detection、search-semantically QueryType
   - 三種類型：`symbol`（精確識別字）、`natural_language`（語意查詢）、`path`（路徑匹配）
   - 不同類型使用不同權重策略
4. **Code-aware reranking signals**（6 signals 🆕 從 3 擴充）
   - Definition boost：符號定義行 +0.25 權重
   - Test demotion：test/spec 檔案 -0.30 權重
   - File-coherence boost：同檔案多匹配 +0.20 權重
   - 🆕 Git recency：最近修改的檔案 +0.15 權重（參考 search-semantically）
   - 🆕 Path match：檔案路徑與查詢匹配 +0.20 權重
   - 🆕 Symbol name match：符號名稱精確匹配 +0.30 權重
   - 參考 semble_rs、search-semantically ranking signals

## Phase 2：Hybrid Semantic Search 🆕（從 Phase 4+ 提前）
- **實作時間**：1 週
- **新依賴**：`@xenova/transformers`（ONNX runtime，無 GPU 需求）或 Model2Vec static embeddings
- **預期效果**：語意查詢準確率 ↑60%，MRR ↑40-60%

### 實作內容
1. **Model2Vec static embeddings** — 無 GPU、無 API key、純 CPU
   - 參考 semble_rs/Veles 的 potion-code-16M 模型（~30MB）
   - 或 `@xenova/transformers` 的 all-MiniLM-L6-v2（~80MB ONNX）
   - 首次使用自動下載並快取模型
2. **BM25 + Semantic RRF Fusion** — Reciprocal Rank Fusion 合併排名
   - 參考 Vera/QEX/Veles 的 RRF 實作（k=60）
   - Query type 決定權重：symbol → BM25 70% + semantic 30%，NL → BM25 30% + semantic 70%
3. **Semantic chunking** — 以 semantic unit 為 embedding 單位
   - 先用 regex fallback，Phase 3 升級為 tree-sitter AST chunking
4. **Persistent embedding cache** — 嵌入向量快取到 `.smart/grep-embeddings.json`
   - mtime 檢查，只重新嵌入變更的檔案

## Phase 3：Tree-sitter Structural Intelligence（增強版 Phase 2）
- **實作時間**：1 週
- **新依賴**：`web-tree-sitter` + `tree-sitter-wasms`
- **預期效果**：scope 精準度 ↑80%，結構化搜尋能力從無到有

### 實作內容
1. **worker_threads 平行搜尋** — 多核加速檔案掃描
   - 參考 ripgrep rayon work-stealing
2. **Tree-sitter AST scope detection** — 取代 regex 猜測
   - 支援 JS/TS/Python/Rust/Go/PHP/Ruby/Java/C/C++
   - 精準定位函式/類別/介面邊界
3. **AST-aware chunking** — 以語法單元為搜尋單位
   - 參考 semble_rs、Veles tree-sitter chunking
   - 函式/類別/方法級別切割，保留完整語意
4. **Structural Pattern Search** 🆕 — AST 模式匹配
   - 參考 ast-grep 的 code-shaped pattern（`$VAR` wildcard）
   - 支援 `--structural` 模式：`smart_grep --structural "$obj.$method($arg)"`
   - 忽略空白/格式差異，只匹配結構
5. **Symbol Graph Extraction** 🆕 — 提取符號關係圖
   - 參考 Veles defs/refs、Lucerna knowledge graph
   - 每個檔案提取：定義符號、呼叫關係、import 關係
   - 支援 `--symbols` / `--defs` / `--refs` 查詢

## Phase 4：Trigram/Sparse N-gram 索引 + Token Budget（增強版 Phase 3）
- **實作時間**：2 週
- **新依賴**：`better-sqlite3`
- **預期效果**：大型專案搜尋 10-50x 加速，token 輸出 ↓60-80%

### 實作內容
1. **Trigram 索引** — 基於 SQLite 自建 inverted index
   - 參考 trigrep/ngi/fastgrep 的 trigram 設計
   - 支援 `--index build` / `--index search` / `--index update`
2. **Sparse N-gram 選項** 🆕 — 選擇性更強的先進索引
   - 參考 Cursor 2026-03 sparse n-gram 論文、GitHub Code Search
   - 對大型 monorepo 選擇性更佳（trigram 可能命中太多檔案）
   - 作為 `--index-type sparse` 選項
3. **Incremental indexing** — mtime + content hash 增量
   - 參考 QEX Merkle DAG、code-indexer Merkle tree sync
   - 只重新索引變更的檔案，其餘保留
4. **Trigram pre-filtering** — 搜尋前先過濾不相關檔案
   - 參考 codixing 110x literal grep 加速
   - 自動判斷：若 candidate files < 10% → 用索引；> 10% → fallback 全掃（參考 ngi 策略）
5. **Token Budget Optimization** 🆕 — AI agent 專用輸出優化
   - 參考 hypergrep `--budget`、semble_rs semantic compression
   - `--budget 500`：在 500 token 內回傳最佳結果
   - Greedy selection：依相關性分數選取，直到達到 token 上限
   - L0/L1/L2 壓縮等級（signature only / +context / full body）

## Phase 5：Multi-Signal Ranking + Graph Traversal 🆕（全新）
- **實作時間**：2 週
- **新依賴**：可選 ONNX runtime（cross-encoder）
- **預期效果**：搜尋準確率再 ↑15-25%，支援關係圖查詢

### 實作內容
1. **POEM-style Multi-Signal Ranking** — 6+ 信號融合排名
   - 參考 search-semantically POEM（Pareto Optimal Embedded Modelling）
   - 信號：BM25、Cosine similarity、Path match、Symbol match、Import graph、Git recency
   - 可自訂信號權重
2. **Import Graph Propagation** — import 關係傳播
   - 參考 search-semantically、git-semantic graph proximity boost
   - 搜尋結果的 import 來源/目標自動加分
3. **Call Graph Traversal** — 呼叫關係圖查詢
   - 參考 hypergrep call graph（2.5us）、Veles find_related
   - `--callers`：誰呼叫了這個符號
   - `--callees`：這個符號呼叫了誰
   - `--impact`：變更影響範圍分析
4. **Optional Cross-encoder Reranking** — 第二階段精排
   - 參考 Vera cross-encoder（MRR 0.28→0.60）、goodgrep ColBERT
   - 對 top-20 候選做 joint scoring
   - 可選啟用（需 ONNX model ~100MB）

## 長期展望（Phase 6+）
- NL Enrichment：程式碼 chunk 自動產生自然語言摘要（參考 CodeRAG 10x 品質提升）
- SIMD 加速：WASM SIMD 或 native addon
- MCP-native streaming：大型結果集串流回傳
- Multi-repo federated search：跨多個 repo 的聯合搜尋

## 預期效果疊加
```
Phase 前:  regex only，無排名，無索引
Phase 1:  搜尋品質 ↑50%，token 浪費 ↓30%（BM25 + 6 rerank signals）
Phase 2:  語意查詢準確率 ↑60%，MRR ↑40-60%（Hybrid semantic）
Phase 3:  scope 精準度 ↑80%，結構化搜尋從無到有（Tree-sitter + structural）
Phase 4:  大型專案 10-50x 加速，token 輸出 ↓60-80%（Trigram index + budget）
Phase 5:  準確率再 ↑15-25%，支援關係圖查詢（Multi-signal + graph）
```
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
