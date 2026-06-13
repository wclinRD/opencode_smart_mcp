# smart_fast_apply 強化待辦清單

## Diff Rendering Enhancement ✅
- [x] `ansiColorizeDiff()` — +綠/-紅/@@青 ANSI 色碼
- [x] `codeBlockLang()` — 副檔名→chroma 語言映射
- [x] `wrapDiffBlock(diffText, filePath)` — 格式 code block + ANSI
- [x] `formatAnsiDiff()` — 純 ANSI 輸出模式
- [x] `format:"ansi"` 加入 output enum
- [x] 第 4 個 SEARCH/REPLACE conflict 修復（r.file 參數）
- [x] 78 tests pass, 0 fail

## Phase 0：BlockDiff 新格式 ✅
- [x] plan.md / todo.md 建立（已在 Phase 0 前完成）
- [x] `inputSchema.format.enum` 已含 `block-diff`（前期已加入）
- [x] 新增 `parseBlockDiff()` 區塊解析（自動化函式，含 JSDoc）
- [x] Handler 中 block-diff → applyHashline 轉換（現呼叫 parseBlockDiff -> applyHashline）
- [x] 更新 description 文件（7 種格式，block-diff 排首位）
- [x] 測試：5 個 block-diff 測試（replace/append/prepend/錯誤處理）

## Phase 1：Tree-sitter AST 匹配層
- [ ] `npm install web-tree-sitter tree-sitter-wasms`
- [ ] 建立 `src/lib/ast-engine.mjs`
- [ ] `fuzzyMatch()` 加入 L7 AST fallback
- [ ] 更新 description 文件
- [ ] 測試：5 語言 AST 匹配
- [ ] 測試：AST 匹配成功降級

## Phase 2：Google diff-match-patch 降級
- [ ] 整合 diff-match-patch
- [ ] fuzzyMatch 最後防線加入 patch_apply
- [ ] 測試：程式碼移動後仍 patch 成功

## Phase 3：AST 驗證 + 自動修復
- [ ] apply 後 validateSyntax()
- [ ] 自動修復 handler
- [ ] 測試：語法錯誤自動修復
- [ ] 測試：修不了時正確回報

## 驗證與交付
- [ ] `npm test` 全部通過
- [ ] 更新 agent 設定（如有需要）
- [ ] git commit & push

---

# smart_grep 強化待辦清單（v2 — 2026-06 技術更新）

## Phase 1：排名與相關性 + Query Detection ✅（2-3 天）
- [x] 建立 `src/lib/bm25.mjs` — 純 JS BM25 實作
  - [x] `tokenize(text)` — 支援 identifier-aware 分割（camelCase/PascalCase/snake_case）
  - [x] `bm25Score(query, doc)` — BM25 相關性分數計算
  - [x] `rankResults(results, query)` — 對搜尋結果排序
- [x] 建立 `src/lib/query-detector.mjs` 🆕 — 查詢類型偵測
  - [x] `detectQueryType(query)` — 回傳 symbol / natural_language / path
  - [x] 啟發式規則：全小寫+空格 → NL，camelCase/PascalCase → symbol，含 `/` 或 `.` → path
- [x] 整合到 `contextual-grep.mjs`
  - [x] 新增 `--rank bm25` / `--rank none` CLI 參數
  - [x] 預設啟用 BM25 排名
  - [x] 預設啟用 query type detection
- [x] Code-aware reranking signals（6 signals 🆕）
  - [x] `definitionBoost(match)` — 符號定義行 +0.25
  - [x] `testDemotion(filePath)` — test/spec 檔案 -0.30
  - [x] `fileCoherenceBoost(fileResults)` — 同檔案多匹配 +0.20
  - [x] 🆕 `gitRecencyBoost(filePath)` — git log 最近修改 +0.15
  - [x] 🆕 `pathMatchBoost(filePath, query)` — 路徑匹配 +0.20
  - [x] 🆕 `symbolNameBoost(match, query)` — 符號名稱精確匹配 +0.30
- [x] 測試：BM25 排名正確性
- [x] 測試：identifier-aware tokenization（camelCase/snake_case）
- [x] 測試：query type detection 三種類型

## Phase 2：Hybrid Semantic Search 🆕（1 週）
- [ ] `npm install @xenova/transformers`
- [ ] 建立 `src/lib/semantic-search.mjs`
  - [ ] `initEmbedder(modelName)` — lazy 載入 ONNX model（all-MiniLM-L6-v2）
  - [ ] `embedChunks(chunks)` — 批量 embedding
  - [ ] `cosineSimilarity(a, b)` — 餘弦相似度
  - [ ] `semanticSearch(query, chunks)` — 語意搜尋
- [ ] 建立 `src/lib/hybrid-search.mjs`
  - [ ] `rrfFusion(bm25Results, semanticResults, k=60)` — RRF 合併
  - [ ] `weightedFusion(bm25Results, semanticResults, queryType)` — 依 query type 加權
- [ ] 建立 `src/lib/embedding-cache.mjs`
  - [ ] `loadCache(root)` — 載入 `.smart/grep-embeddings.json`
  - [ ] `saveCache(root, cache)` — 儲存快取
  - [ ] `getCachedOrEmbed(file, mtime, embedder)` — mtime 檢查 + 嵌入
- [x] 整合到 `contextual-grep.mjs`
  - [ ] `--semantic` 啟用 hybrid search
  - [ ] `--semantic-weight 0.0-1.0` 自訂 semantic 權重
  - [ ] 預設：symbol query → BM25 70% + semantic 30%
  - [ ] 預設：NL query → BM25 30% + semantic 70%
- [ ] 測試：semantic search 正確性（概念查詢）
- [ ] 測試：RRF fusion 正確性
- [ ] 測試：embedding cache 命中率

## Phase 3：Tree-sitter Structural Intelligence（1 週）
- [ ] `npm install web-tree-sitter tree-sitter-wasms`
- [ ] 建立 `src/lib/tree-sitter-scope.mjs`
  - [ ] `initParser(lang)` — lazy WASM 載入
  - [ ] `getEnclosingScope(content, line)` — AST 精準 scope
  - [ ] `extractSymbols(content, lang)` — AST 符號提取
- [ ] 建立 `src/lib/structural-search.mjs` 🆕
  - [ ] `parseStructuralPattern(pattern)` — 解析 `$VAR` wildcard
  - [ ] `matchStructuralPattern(ast, pattern)` — AST 結構匹配
  - [ ] 支援 JS/TS/Python/Rust/Go 五語言
- [ ] 建立 `src/lib/symbol-graph.mjs` 🆕
  - [ ] `extractDefs(content, lang)` — 提取符號定義
  - [ ] `extractRefs(content, lang, symbol)` — 提取符號引用
  - [ ] `extractCallGraph(content, lang)` — 提取呼叫關係
  - [ ] `extractImportGraph(content, lang)` — 提取 import 關係
- [ ] worker_threads 平行搜尋
  - [ ] 建立 `src/lib/parallel-search.mjs`
  - [ ] 檔案分組 → worker pool → 合併結果
- [x] 整合到 `contextual-grep.mjs`
  - [ ] `--with-scope` 改用 tree-sitter（fallback regex）
  - [ ] `--parallel` 啟用 worker_threads
  - [ ] 🆕 `--structural` 啟用 AST 模式匹配
  - [ ] 🆕 `--symbols` / `--defs` / `--refs` 符號查詢
- [ ] 測試：5 語言 AST scope 精準度
- [ ] 測試：structural pattern matching 正確性
- [ ] 測試：symbol graph 提取正確性
- [ ] 測試：平行搜尋效能（vs 單線程）

## Phase 4：Trigram/Sparse N-gram 索引 + Token Budget（2 週）
- [ ] `npm install better-sqlite3`
- [ ] 建立 `src/lib/trigram-index.mjs`
  - [ ] `buildIndex(root)` — 建立 trigram inverted index
  - [ ] `searchIndex(query)` — trigram 查詢 + candidate filtering
  - [ ] `updateIndex(changedFiles)` — 增量更新（mtime + content hash）
  - [ ] `autoFallback(candidateRatio)` — >10% 自動 fallback 全掃
- [ ] 建立 `src/lib/sparse-ngram-index.mjs` 🆕
  - [ ] `buildSparseIndex(root)` — sparse n-gram 索引（參考 Cursor 2026-03）
  - [ ] `searchSparseIndex(query)` — sparse n-gram 查詢
  - [ ] 作為 `--index-type sparse` 選項
- [ ] 建立 `src/lib/token-budget.mjs` 🆕
  - [ ] `fitToBudget(results, maxTokens)` — greedy selection
  - [ ] `compressLevel(results, level)` — L0/L1/L2 壓縮
    - [ ] L0: signature only（檔名+行號+匹配行）
    - [ ] L1: +3 行 context
    - [ ] L2: full function body
- [x] 整合到 `contextual-grep.mjs`
  - [ ] `--index build|search|update` CLI 參數
  - [ ] `--index-type trigram|sparse` 索引類型
  - [ ] 🆕 `--budget 500` token 預算限制
  - [ ] 🆕 `--compress L0|L1|L2` 壓縮等級
  - [ ] 自動偵測索引是否存在
- [ ] 測試：索引建立與查詢正確性
- [ ] 測試：incremental update 正確性（mtime + hash）
- [ ] 測試：sparse n-gram vs trigram 選擇性比較
- [ ] 測試：token budget greedy selection 正確性
- [ ] Benchmark：大型專案（10K+ files）搜尋效能

## Phase 5：Multi-Signal Ranking + Graph Traversal 🆕（2 週）
- [ ] 建立 `src/lib/multi-signal-rank.mjs`
  - [ ] `computeSignals(query, candidates)` — 計算 6 個信號分數
  - [ ] `poemRank(signals)` — POEM Pareto Optimal 排名
  - [ ] `weightedRank(signals, weights)` — 可自訂權重排名
- [ ] 建立 `src/lib/import-graph.mjs`
  - [ ] `buildImportGraph(root)` — 建立 import 關係圖
  - [ ] `propagateBoost(results, graph)` — import 關係傳播加分
  - [ ] `findRelatedFiles(file, graph)` — 找相關檔案
- [ ] 建立 `src/lib/call-graph.mjs`
  - [ ] `buildCallGraph(root)` — 建立呼叫關係圖（from Phase 3 symbol graph）
  - [ ] `getCallers(symbol)` — 誰呼叫了這個符號
  - [ ] `getCallees(symbol)` — 這個符號呼叫了誰
  - [ ] `impactAnalysis(symbol)` — 變更影響範圍
- [ ] 建立 `src/lib/cross-encoder.mjs`（可選）
  - [ ] `initCrossEncoder(modelName)` — lazy 載入 ONNX cross-encoder
  - [ ] `rerank(query, candidates)` — 第二階段精排 top-20
  - [ ] 可選啟用（`--cross-encode`）
- [x] 整合到 `contextual-grep.mjs`
  - [ ] `--callers symbol` / `--callees symbol` / `--impact symbol`
  - [ ] `--cross-encode` 啟用精排
  - [ ] `--signal-weights` 自訂信號權重
- [ ] 測試：POEM ranking vs 單純 BM25
- [ ] 測試：import graph propagation 正確性
- [ ] 測試：call graph traversal 正確性
- [ ] 測試：cross-encoder reranking 品質提升

## 驗證與交付
- [ ] `npm test` 全部通過
- [ ] 更新 smart_grep plugin description
- [ ] 更新 `config/agents/smart-mcp.md`（如有新參數）
- [ ] git commit & push

---

# exa 工具全系列提升至 Layer 1 ✅

- [x] 搬移 `exa_search.mjs` → `src/plugins/core/`
- [x] 搬移 `exa_crawl.mjs` → `src/plugins/core/`
- [x] 搬移 `github_search.mjs` → `src/plugins/core/`
- [x] 更新 `config/agents/smart-mcp.md`：Layer 1 表格 + 權限 + webfetch/websearch 引用
- [x] 更新 `src/server/index.mjs` ROUTER_DESCRIPTION
- [x] git commit & push
