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
| **SIFS** 🆕 | Sparse BM25 + Model2Vec, 182ms cold index, NDCG@10=0.82 | ⭐⭐⭐ | v3 |
| **Gortex** 🆕 | 257 langs, 100+ MCP tools, in-memory CKG, 3-modality paradigm | ⭐⭐⭐ | v3 |
| **Cursor sparse n-grams** 🆕 | Frequency-based sparse n-gram, Git base+overlay, 2026-03 | ⭐⭐⭐ | v3 |
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

## Phase 2：Hybrid Semantic Search 🆕 ✅（已完成 2026-06-13）
- **實作時間**：1 週
- **新依賴**：無（使用現有 `@huggingface/transformers` + TF-IDF fallback）
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

## Phase 3：Tree-sitter Structural Intelligence（v3 增強版）
- **實作時間**：1.5 週（原 1 週 + 0.5 週 v3 新增）
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
4. **Structural Pattern Search** — AST 模式匹配
   - 參考 ast-grep 的 code-shaped pattern（`$VAR` wildcard）
   - 支援 `--structural` 模式：`smart_grep --structural "$obj.$method($arg)"`
   - 忽略空白/格式差異，只匹配結構
5. **Symbol Graph Extraction** — 提取符號關係圖
   - 參考 Veles defs/refs、Lucerna knowledge graph
   - 每個檔案提取：定義符號、呼叫關係、import 關係
   - 支援 `--symbols` / `--defs` / `--refs` 查詢
6. **🆕 Bundled Security/Quality Detectors** — 內建結構化檢測器（v3 新增）
   - 參考 Gortex search_ast 的 10 個 bundled detectors
   - 內建檢測器：`sql-string-concat`、`weak-crypto`、`hardcoded-secret`、`panic-in-library`、`empty-catch`、`http-client-no-timeout`
   - 支援 `--detect sql-string-concat` 一鍵掃描
   - 每個結果附帶 enclosing symbol，可直接串接 `--callers` / `--impact`
7. **🆕 Codebase Mental Model** — 專案結構摘要（v3 新增）
   - 參考 hypergrep `--model`（699 tokens codebase summary）
   - 支援 `--summary`：回傳 ~500 token 專案結構摘要
   - 包含：目錄樹、主要模組、entry points、關鍵符號
   - Agent session 開始時載入一次，省 80% 探索性搜尋

## Phase 4：Sparse N-gram 索引 + Token Budget（v3 增強版）
- **實作時間**：2.5 週（原 2 週 + 0.5 週 v3 新增）
- **新依賴**：`better-sqlite3`
- **預期效果**：大型專案搜尋 10-50x 加速，token 輸出 ↓60-80%
- **v3 核心變更**：Sparse N-gram 從「選項」升級為「主要索引策略」

### 實作內容
1. **Sparse N-gram 索引（主要）** 🆕 — 取代 trigram 成為預設索引
   - 參考 Cursor 2026-03 sparse n-gram 論文、GitHub Blackbird、Roslyn PR #82708
   - **Frequency-based weight function**：從大型開源語料庫計算 bigram 頻率表
     - 稀有 bigram（如 `Q_`、`zx`）→ 高權重 → 自然邊界 → 長 n-gram
     - 常見 bigram（如 `th`、`er`）→ 低權重 → 邊界在 hash valley
   - **BuildAllNgrams**（索引時）：monotonic stack 演算法，最多 2n-2 個 variable-length n-gram
   - **BuildCoveringNgrams**（查詢時）：最小覆蓋子集，最多 n-2 個 n-gram
   - 效果：`handleClick` → trigram 需 9 次 lookup，sparse 只需 2 次（`handleCl`、`Click`）
   - 支援 `--index build` / `--index search` / `--index update`
2. **Trigram 索引（備用）** — 保留作為 fallback
   - 參考 trigrep/ngi/fastgrep 的 trigram 設計
   - 當 sparse n-gram 不適用時自動 fallback（如極短查詢 < 4 chars）
   - 支援 `--index-type trigram` 強制使用
3. **🆕 Git-based Index Layering** — base commit + live overlay（v3 新增）
   - 參考 Cursor 的 Git commit pinning + overlay 架構
   - Base layer：固定在當前 Git commit，mmap 唯讀
   - Overlay layer：未 commit 的變更（dirty files），輕量增量
   - 效果：commit 後不需重建整個索引，只更新 overlay
4. **Incremental indexing** — mtime + content hash 增量
   - 參考 QEX Merkle DAG、code-indexer Merkle tree sync
   - 只重新索引變更的檔案，其餘保留
5. **🆕 Bloom Filter Existence Checks** — 快速存在性查詢（v3 新增）
   - 參考 hypergrep `--exists`（291ns）、bloom filter 設計
   - 支援 `--exists redis`：瞬間回答「這個專案是否使用 Redis」
   - 支援 `--exists-pkg express`：檢查特定套件是否存在
   - 基於 Bloom filter，false positive rate < 1%
6. **Trigram pre-filtering** — 搜尋前先過濾不相關檔案
   - 參考 codixing 110x literal grep 加速
   - 自動判斷：若 candidate files < 10% → 用索引；> 10% → fallback 全掃（參考 ngi 策略）
7. **Token Budget Optimization** — AI agent 專用輸出優化
   - 參考 hypergrep `--budget`、semble_rs semantic compression
   - `--budget 500`：在 500 token 內回傳最佳結果
   - Greedy selection：依相關性分數選取，直到達到 token 上限
   - L0/L1/L2 壓縮等級：
     - L0: signature only（檔名+行號+匹配行，~15 tokens/result）
     - L1: +3 行 context + call graph（~80-120 tokens/result）
     - L2: full function body（~200-800 tokens/result）

## Phase 5：Multi-Signal Ranking + Graph Traversal（v3 增強版）
- **實作時間**：2 週
- **新依賴**：可選 ONNX runtime（cross-encoder）
- **預期效果**：搜尋準確率再 ↑15-25%，支援關係圖查詢
- **v3 核心變更**：明確三模態範式 + 效能目標 + CKG 整合

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
5. **🆕 Three-Modality Paradigm 文件化** — 明確三模態分工（v3 新增）
   - 參考 Gortex「grep replacement is three tools, not one」
   - Lexical（文字）：`smart_grep` — regex/BM25/hybrid search
   - Structural（結構）：`smart_grep --structural` — AST pattern matching
   - Graph（關係）：`smart_grep --callers/--callees/--impact` — call graph traversal
   - 更新 agent system prompt 引導 LLM 選擇正確模態
6. **🆕 效能目標** — 對標 SIFS 級別（v3 新增）
   - Cold index：< 500ms（SIFS: 182ms）
   - Warm query：< 10ms（SIFS: 4.8ms）
   - NDCG@10：> 0.80（SIFS: 0.82, Vera: 0.84）
   - Token reduction：> 85% vs grep+read（hypergrep: 87%, semble: 98%）

## 長期展望（Phase 6+）
- NL Enrichment：程式碼 chunk 自動產生自然語言摘要（參考 CodeRAG 10x 品質提升）
- SIMD 加速：WASM SIMD 或 native addon
- MCP-native streaming：大型結果集串流回傳
- Multi-repo federated search：跨多個 repo 的聯合搜尋
- 🆕 Code Knowledge Graph (CKG) 完整整合：參考 Gortex in-memory graph（257 langs, 100+ tools）
- 🆕 LSP bridge：直接對接 language server 做 resolved references（參考 Gortex 22-server LSP bridge）

## 預期效果疊加
```
Phase 前:  regex only，無排名，無索引
Phase 1:  搜尋品質 ↑50%，token 浪費 ↓30%（BM25 + 6 rerank signals）
Phase 2:  語意查詢準確率 ↑60%，MRR ↑40-60%（Hybrid semantic）
Phase 3:  scope 精準度 ↑80%，結構化搜尋從無到有（Tree-sitter + structural + detectors）
Phase 4:  大型專案 10-50x 加速，token 輸出 ↓60-80%（Sparse N-gram index + budget + bloom）
Phase 5:  準確率再 ↑15-25%，支援關係圖查詢（Multi-signal + graph + 3-modality）
```

---

## v3 更新摘要（2026-06-13）

### 調研發現
2026 年 6 月深度調研 SIFS、Gortex、Cursor sparse n-grams、Hypergrep 後，發現以下關鍵差距：

| 差距 | 現有計畫 | v3 調整 |
|------|---------|--------|
| Sparse N-gram 定位 | Phase 4 可選 (`--index-type sparse`) | Phase 4 **主要索引策略**（預設） |
| Frequency-based weights | 未提及 | Phase 4 新增 bigram 頻率表 |
| Git-based layering | 僅 mtime 增量 | Phase 4 新增 base commit + overlay |
| Bloom filter | 未提及 | Phase 4 新增 `--exists` 快速查詢 |
| Bundled detectors | 未提及 | Phase 3 新增 6 個安全/品質檢測器 |
| Codebase mental model | 未提及 | Phase 3 新增 `--summary` |
| 三模態範式 | 隱含但未明確 | Phase 5 明確文件化 |
| 效能目標 | 無量化目標 | Phase 5 對標 SIFS 級別 |
| CKG 整合 | Phase 6+ 模糊 | Phase 6+ 明確參考 Gortex |
| LSP bridge | 未提及 | Phase 6+ 新增 |

### 時間調整
| Phase | 原估計 | v3 調整 | 原因 |
|-------|--------|--------|------|
| Phase 3 | 1 週 | 1.5 週 | +bundled detectors + codebase summary |
| Phase 4 | 2 週 | 2.5 週 | sparse n-gram 升級 + Git layering + Bloom filter |
| Phase 5 | 2 週 | 2 週 | 不變（新增項目為文件化 + 效能目標） |
| **總計** | **6 週** | **6.5 週** | +0.5 週 |
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

---

# Smart MCP 商用工程等級強化計畫（2026-06）

## 背景
Smart MCP 在**開發中段**（編輯→分析→測試→除錯）已相當成熟，但在**開發前後端**（初始化→建置→部署→協作）有系統性缺口。此計畫補足 7 大關鍵缺口，分三階段達成商用工程等級。

## 總覽圖
```
Phase 1 (3-4週)       Phase 2 (5-6週)        Phase 3 (4-5週)
┌────────────────┐   ┌────────────────┐    ┌────────────────┐
│ 商用基礎 🏗️     │ → │ 專業工作流 🚀   │ →  │ 企業治理 🏢    │
│                │   │                │    │                │
│ smart_init     │   │ smart_api      │    │ smart_quality  │
│ smart_db 升級  │   │ smart_build    │    │ smart_team     │
│ scaffold 樣板  │   │ smart_deploy   │    │ wiki 協作強化  │
│                │   │ smart_deps     │    │ 規範同步       │
└────────────────┘   └────────────────┘    └────────────────┘
```

## 7 大關鍵缺口與對應工具

### 🔴 缺口 1：專案 Scaffold 與初始化
**現狀**：手動建目錄、寫 package.json / pyproject.toml  
**商用級要求**：`opencode init` 一條命令完成，官方+社群樣板庫  
**新工具**：`smart_init`

```
smart_init({
  template: "monorepo-ts" | "fastify-api" | "next-app" | "python-lib" | "cli-tool",
  projectName: "my-project",
  features: ["docker", "ci", "testing", "database"],
  packageManager: "pnpm" | "npm" | "yarn"
})
```

**配套**：`smart_template({command:"list|search|publish|install", ...})` 樣板管理系統

---

### 🔴 缺口 2：資料庫生命週期管理
**現狀**：SQLite/PostgreSQL **唯讀**查詢  
**商用級要求**：完整 CRUD + Migration + Seed + Schema diff  
**升級**：現有 `smart_db` 擴充

```
# 寫入
smart_db({command:"write", table:"users", data:{name:"John", email:"..."}})

# Migration 管理
smart_db({command:"migrate:create", name:"add_users_table", dialect:"postgres"})
smart_db({command:"migrate:up"})
smart_db({command:"migrate:down", steps:1})
smart_db({command:"migrate:status"})

# Schema diff（分支間比較）
smart_db({command:"schema:diff", from:"main", to:"feature-branch"})

# Seed 資料
smart_db({command:"seed:generate", tables:["users","posts"], count:100})
```

---

### 🔴 缺口 3：API 開發全流程
**現狀**：無 API 專用工具  
**商用級要求**：OpenAPI 規範 ↔ 程式碼 雙向產生 + Mock server + Client 產生  
**新工具**：`smart_api`

```
# 從程式碼產生 OpenAPI spec
smart_api({command:"generate:spec", from:"src/routes/**/*.ts", format:"openapi3"})

# 從 OpenAPI spec 產生 API client
smart_api({command:"generate:client", spec:"openapi.yaml", lang:"typescript"})

# 啟動 Mock server
smart_api({command:"mock:serve", spec:"openapi.yaml", port:4000})

# API 端點分析
smart_api({command:"analyze:endpoints", source:"src/routes"})
```

---

### 🔴 缺口 4：建置、容器化與部署
**現狀**：無建置/部署工具  
**商用級要求**：Docker 化 → CI/CD → 部署 一條龍  
**新工具**：`smart_build` + `smart_deploy`

```
# Dockerfile 產生（多階段建置最佳化）
smart_build({command:"docker:generate", base:"node:20-alpine", entry:"dist/index.js"})

# Docker Compose 管理
smart_build({command:"compose:generate", services:["app","db","redis"]})

# CI/CD pipeline 產生
smart_deploy({command:"ci:generate", platform:"github-actions", steps:["lint","test","build","deploy"]})

# 環境設定管理
smart_deploy({command:"env:validate", env:".env.production", template:".env.example"})
```

---

### 🟡 缺口 5：套件與依賴管理
**現狀**：透過 bash 手動操作 npm/pip  
**商用級要求**：深度依賴分析 + 安全審計 + 更新自動化  
**新工具**：`smart_deps`

```
smart_deps({command:"audit"})          // 依賴安全漏洞報告
smart_deps({command:"outdated"})       // 過期套件列表 + 更新建議
smart_deps({command:"upgrade", dryRun:true})  // 安全更新預覽
smart_deps({command:"analyze"})        // 依賴圖分析、重複依賴、bundle size impact
```

---

### 🟡 缺口 6：商用級程式碼品質閘
**現狀**：LSP diagnostics + security scan  
**商用級要求**：架構規範強制 + 技術債量化 + API 穩定性保證  
**新工具**：`smart_quality`

```
# 架構規範檢查（ArchUnit 風格）
smart_quality({command:"arch:check", rules:[
  "domain 不得依賴 infrastructure",
  "controller 只能呼叫 service 層",
  "所有 public 方法必須有 JSDoc/TSDoc"
]})

# 技術債量化
smart_quality({command:"debt:measure", metrics:["complexity","duplication","coverage","lint-errors"]})

# Breaking change 檢測
smart_quality({command:"breaking:check", from:"main", to:"feature"})

# 公共 API 表面分析
smart_quality({command:"api-surface", source:"src/"})
```

---

### 🟡 缺口 7：團隊協作基礎建設
**現狀**：個人工具，無團隊功能  
**商用級要求**：共用知識庫 + Review 流程 + 規範同步  
**新工具**：`smart_team` + 擴充 `memory_store`

```
# 共用記憶庫
smart_team({command:"knowledge:push", topic:"deploy-troubleshooting", content:"..."})
smart_team({command:"knowledge:pull", topic:"deploy-troubleshooting"})

# PR review 規則引擎（強化現有 git_pr）
smart_team({command:"review:rules", file:".review-rules.yaml"})

# Coding 規範同步（wiki → .opencode-conventions.json）
smart_team({command:"sync:rules", source:"wiki:team-coding-standards"})

# Changelog 自動產生
smart_team({command:"changelog", from:"v1.0.0", to:"HEAD"})
```

---

## ☕ 務實重新排序：不是每個缺口都值得做

### 優先級矩陣

| 缺口 | 使用頻率 | 有無現成替代 | **判斷** |
|:----|:--------|:-----------|:--------:|
| **smart_db 寫入 + Migration** | 🔥 每天 | ❌ 需跳工具鏈 | **唯一阻斷者** |
| smart_setup（opencode.json 產生） | 🟡 每季 | ⚠️ 手動設定易錯 | **輕量輔助** |
| smart_deps（依賴審計） | 🟡 每月 | ✅ npm audit 有但無 LLM 修復 | **low-hanging fruit** |
| smart_api（OpenAPI） | 🟢 每週 | ⚠️ 有 CLI 但 LLM 可加分 | 延後 |
| smart_quality（架構規範） | 🟢 設定一次 | ❌ 無好用的 ArchUnit CLI | 延後 |
| smart_init（完整 scaffold） | ⚫ 每季 | ✅ degit / npm create | ❌ 取消 |
| smart_build（Docker） | ⚫ 設定一次 | ✅ ChatGPT 10 秒 | ❌ 取消 |
| smart_deploy（CI/CD） | ⚫ 設定一次 | ✅ GitHub Actions 樣板 | ❌ 取消 |
| smart_team（協作） | 🟡 每週 | ✅ git + wiki 已 cover | ❌ 取消 |

---

## ✅ 修正後路線圖

### Phase 1：只做真正有用的事（2-3 週）

```
Phase 1（2-3 週，不是 3-4 週）
┌─────────────────────────────────────────┐
│ smart_db 升級（1-2 週） ← 唯一真・阻斷者  │
│  ├─ 寫入支援（INSERT/UPDATE/DELETE）     │
│  ├─ Migration 管理（create/up/down）     │
│  └─ Schema diff（分支間比較）            │
│                                         │
│ smart_setup（3-5 天） ← 輕量 onboarding  │
│  └─ 專案偵測 → 自動產生 opencode.json    │
│                                         │
│ smart_deps 極簡版（1 天） ← low-hanging  │
│  └─ npm audit wrapper + LLM 修復建議    │
└─────────────────────────────────────────┘
```

### 其餘項目：全數取消或無限期延後

| 項目 | 處置 | 理由 |
|:----|:----|:------|
| `smart_init`（樣板引擎） | ❌ **取消** | 沒必要重做 degit。模板變數替換不難，但維護 5 個樣板的成本遠大於收益 |
| `smart_build`（Dockerfile） | ❌ **取消** | 寫一次的東西。`degit` + 內建模板檔就夠了 |
| `smart_deploy`（CI/CD） | ❌ **取消** | 同上。GitHub Actions 樣板到處都是 |
| `smart_team`（協作） | ❌ **取消** | 現有 wiki + git 已 cover 80%。共用記憶庫需要 server 端，超出本專案 scope |
| `smart_api`（OpenAPI） | ⏳ **延後** | 有價值但非緊急。Phase 2 有餘力再評估 |
| `smart_quality`（架構規範） | ⏳ **延後** | 複雜 + 低配置頻率，適合 Phase 3 或獨立的 skill |

### 為什麼這樣砍？

**核心判斷原則**：一個 MCP 工具如果只是包裝既有的 CLI，而且那個 CLI 已經很好用，那就不值得做。

- `npm audit` → 3 秒、一行命令 → 包成 MCP 工具不增加價值
- `degit project template` → 5 秒、一行命令 → 包成 MCP 工具不增加價值
- `docker init` → ChatGPT 幫你寫 → 包成 MCP 工具不增加價值

**但 `smart_db` 不同**：現有的 `psql` / DataGrip / DBeaver 都是**圖形化或純 CLI**，無法與 LLM 對話流程整合。LLM 說「在 orders 表插入一筆訂單」，然後工具直接執行 — 這才是 LLM 原生工作流的價值。

---

## 整合方式

```
Direct Layer（常用工具）
┌─────────────────────┐
│ smart_db（擴充）     │ ← 升級現有工具，保持向後相容
│ smart_deps（新增）   │ ← sub-tool 層級
└─────────────────────┘

基礎設施
├── smart_db 延用現有 db-query.mjs 安全模型
├── smart_setup 延用現有 opencode.json 生成邏輯
├── goal 持久化追蹤（實作過程追蹤進度）
└── memory_store 記錄實作決策
```

## 價值總結

| 維度 | 現狀 | Phase 1 後 |
|:----|:----|:----------|
| **資料庫開發** | ⚠️ 唯讀查詢 | ✅ **完整 CRUD + Migration** ← 唯一真正的突破 |
| **新專案 onboarding** | ⚠️ 手動設 opencode.json | ✅ 一條命令自動產生 |
| **依賴安全** | ⚠️ 需跳出去跑 npm audit | ✅ 工具內審計 + LLM 修復 |
| **其餘（API/容器/CI/品質/協作）** | — | — 維持現狀，有現成 CLI 替代 |
