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

## Phase 1：Tree-sitter AST 匹配層 ✅
> 實作方式變更：採用零依賴 AST-free 方案（regex + extractSymbol），
> 不使用 web-tree-sitter WASM（避免 30MB+ 依賴膨脹）。
- [x] `npm install web-tree-sitter tree-sitter-wasms`（已安裝但未使用）
- [x] 建立 `src/lib/ast-engine.mjs`（AST-free，用 regex + extractSymbol）
- [x] `fuzzyMatch()` 加入 L7 結構化降級：`tryStructuralMatch()` 含 3 策略
  - Strategy 1: 空白正規化文字匹配
  - Strategy 2: anchor line 匹配
  - Strategy 3: symbol-level 匹配（function/class 名稱偵測 + body 比較）
- [x] `ast-engine.test.mjs` — 6 項測試通過
- [x] DMP `patch_make` + `patch_apply` 作為最終防線（Phase 2 整合）

## Phase 2：Google diff-match-patch 降級 ✅
- [x] `npm install diff-match-patch`（已安裝）
- [x] 整合 `applyByDiffMatchPatch()` 使用真實 DMP `patch_make` + `patch_apply`
- [x] fuzzyMatch 最後防線（L7 失敗後自動嘗試 DMP before returning conflict）
- [x] 測試：空白/排版差異成功降級（3 項測試從 conflict 改為 applied）

## Phase 3：AST 驗證 + 自動修復 ✅
- [x] apply 後 `checkBalance()` 驗證（`opts.validate=true` 啟用）
- [x] 自動修復：不平衡時嘗試 DMP retry
- [x] 最多 1 輪自修復
- [x] 修不了 → 保留原始結果

## 驗證與交付 ✅
- [x] `npm test` 全部通過（161 tests）
- [x] 已更新 agent 設定（grep 新增 budget/compress 參數）
- [x] git commit & push

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

## Phase 2：Hybrid Semantic Search 🆕 ✅（已完成 2026-06-13）
- [x] 使用現有 `@huggingface/transformers`（已安裝）
- [x] 建立 `src/lib/semantic-search.mjs`
  - [x] `chunkCode(content, filePath)` — 結構化程式碼切割（JS/TS/Python/Rust/Go）
  - [x] `semanticSearch(query, chunks)` — TF-IDF 語意搜尋
  - [x] `initSemanticSearch()` — lazy 載入 sentence embedding model
  - [x] `embedText(text)` — sentence embedding（fallback TF-IDF）
- [x] 建立 `src/lib/hybrid-search.mjs`
  - [x] `rrfFusion(bm25Results, semanticResults, k=60)` — RRF 合併
  - [x] `weightedFusion(bm25Results, semanticResults, queryType)` — 依 query type 加權
  - [x] `hybridRank(bm25Results, semanticResults, queryType)` — 主入口
- [x] 建立 `src/lib/embedding-cache.mjs`
  - [x] `loadCache(root)` — 載入 `.smart/grep-embeddings.json`
  - [x] `saveCache(root, cache)` — 儲存快取
  - [x] `getCachedOrEmbed(file, mtime, cache)` — mtime + content hash 檢查
  - [x] `cleanStaleEntries(cache)` — 清除過期條目
  - [x] `getCacheStats(cache)` — 快取統計
- [x] 整合到 `contextual-grep.mjs`
  - [x] `--semantic` 啟用 hybrid search
  - [x] `--semantic-weight 0.0-1.0` 自訂 semantic 權重
  - [x] 預設：symbol query → BM25 70% + semantic 30%
  - [x] 預設：NL query → BM25 30% + semantic 70%
- [x] 更新 `grep.mjs` plugin（新增 semantic/semanticWeight 參數）
- [x] 更新 `compose-engine.mjs` TOOL_ARGS_CONVERTERS
- [x] 更新 `workflow.mjs` TOOL_ARGS_CONVERTERS
- [x] 測試：semantic search 正確性（概念查詢）— 6 tests
- [x] 測試：RRF fusion 正確性 — 6 tests
- [x] 測試：embedding cache 命中率 — 5 tests
- [x] 測試：CLI integration — 4 tests
- [x] **21 項測試全部通過**

## Phase 3：Tree-sitter Structural Intelligence（v3 增強版，1.5 週）
- [ ] `npm install web-tree-sitter tree-sitter-wasms`
- [ ] 建立 `src/lib/tree-sitter-scope.mjs`
  - [ ] `initParser(lang)` — lazy WASM 載入
  - [ ] `getEnclosingScope(content, line)` — AST 精準 scope
  - [ ] `extractSymbols(content, lang)` — AST 符號提取
- [ ] 建立 `src/lib/structural-search.mjs`
  - [ ] `parseStructuralPattern(pattern)` — 解析 `$VAR` wildcard
  - [ ] `matchStructuralPattern(ast, pattern)` — AST 結構匹配
  - [ ] 支援 JS/TS/Python/Rust/Go 五語言
- [ ] 建立 `src/lib/symbol-graph.mjs`
  - [ ] `extractDefs(content, lang)` — 提取符號定義
  - [ ] `extractRefs(content, lang, symbol)` — 提取符號引用
  - [ ] `extractCallGraph(content, lang)` — 提取呼叫關係
  - [ ] `extractImportGraph(content, lang)` — 提取 import 關係
- [ ] 🆕 建立 `src/lib/bundled-detectors.mjs`（v3 新增）
  - [ ] `detectSqlStringConcat(ast)` — SQL injection 檢測
  - [ ] `detectWeakCrypto(ast)` — 弱加密演算法檢測
  - [ ] `detectHardcodedSecret(ast)` — 硬編碼密鑰檢測
  - [ ] `detectPanicInLibrary(ast)` — library panic 檢測
  - [ ] `detectEmptyCatch(ast)` — 空 catch block 檢測
  - [ ] `detectHttpClientNoTimeout(ast)` — HTTP client 無 timeout 檢測
  - [ ] `runDetector(name, ast)` — 統一檢測器介面
  - [ ] 支援 `--detect <name>` CLI 參數
- [ ] 🆕 建立 `src/lib/codebase-summary.mjs`（v3 新增）
  - [ ] `generateSummary(root)` — 產生 ~500 token 專案結構摘要
  - [ ] 包含：目錄樹、主要模組、entry points、關鍵符號
  - [ ] 支援 `--summary` CLI 參數
- [ ] worker_threads 平行搜尋
  - [ ] 建立 `src/lib/parallel-search.mjs`
  - [ ] 檔案分組 → worker pool → 合併結果
- [ ] 整合到 `contextual-grep.mjs`
  - [ ] `--with-scope` 改用 tree-sitter（fallback regex）
  - [ ] `--parallel` 啟用 worker_threads
  - [ ] `--structural` 啟用 AST 模式匹配
  - [ ] `--symbols` / `--defs` / `--refs` 符號查詢
  - [ ] 🆕 `--detect <name>` 安全/品質檢測器
  - [ ] 🆕 `--summary` 專案結構摘要
- [ ] 測試：5 語言 AST scope 精準度
- [ ] 測試：structural pattern matching 正確性
- [ ] 測試：symbol graph 提取正確性
- [ ] 🆕 測試：bundled detectors 正確性（6 個檢測器）
- [ ] 🆕 測試：codebase summary 正確性
- [ ] 測試：平行搜尋效能（vs 單線程）

## Phase 4：Sparse N-gram 索引 + Token Budget（v3 增強版，2.5 週）
- [ ] `npm install better-sqlite3`
- [ ] 🆕 建立 `src/lib/sparse-ngram-index.mjs`（v3：升級為主要索引）
  - [ ] `buildFrequencyTable(corpus)` — 從大型語料庫計算 bigram 頻率表
  - [ ] `buildAllNgrams(text)` — monotonic stack 演算法，最多 2n-2 個 n-gram
  - [ ] `buildCoveringNgrams(query)` — 最小覆蓋子集，最多 n-2 個 n-gram
  - [ ] `buildSparseIndex(root)` — sparse n-gram inverted index
  - [ ] `searchSparseIndex(query)` — sparse n-gram 查詢
  - [ ] 預設索引策略（`--index build` 預設使用 sparse）
- [ ] 建立 `src/lib/trigram-index.mjs`（備用 fallback）
  - [ ] `buildIndex(root)` — 建立 trigram inverted index
  - [ ] `searchIndex(query)` — trigram 查詢 + candidate filtering
  - [ ] `updateIndex(changedFiles)` — 增量更新（mtime + content hash）
  - [ ] `autoFallback(candidateRatio)` — >10% 自動 fallback 全掃
  - [ ] 支援 `--index-type trigram` 強制使用
- [ ] 🆕 建立 `src/lib/git-index-layer.mjs`（v3 新增）
  - [ ] `buildBaseLayer(commitHash)` — 固定在 Git commit 的 base layer
  - [ ] `buildOverlayLayer(dirtyFiles)` — 未 commit 變更的 overlay
  - [ ] `mergeLayers(baseResults, overlayResults)` — 合併兩層結果
  - [ ] 支援 `--index-base <commit>` 指定 base commit
- [ ] 🆕 建立 `src/lib/bloom-filter.mjs`（v3 新增）
  - [ ] `buildBloomFilter(root)` — 建立專案級 Bloom filter
  - [ ] `checkExists(term)` — O(1) 存在性查詢
  - [ ] `checkPackageExists(pkgName)` — 套件存在性查詢
  - [ ] 支援 `--exists <term>` / `--exists-pkg <pkg>` CLI 參數
  - [ ] False positive rate < 1%
- [x] 建立 `src/lib/token-budget.mjs` ✅
  - [x] `fitToBudget(results, maxTokens)` — greedy selection
  - [x] `compressLevel(results, level)` — L0/L1/L2 壓縮
    - [x] L0: signature only（檔名+行號+匹配行，~15 tokens/result）
    - [x] L1: +3 行 context + call graph（~80-120 tokens/result）
    - [x] L2: full function body（~200-800 tokens/result）
  - [x] `estimateTokens(text)` — 粗略 token 估算（~3.5 chars/token）
- [x] 整合到 `contextual-grep.mjs` ✅
  - [ ] `--index build|search|update` CLI 參數（未實作）
  - [ ] `--index-type sparse|trigram` 索引類型（未實作）
  - [ ] 🆕 `--index-base <commit>` Git base commit（未實作）
  - [ ] 🆕 `--exists <term>` Bloom filter 存在性查詢（未實作）
  - [ ] 🆕 `--exists-pkg <pkg>` 套件存在性查詢（未實作）
  - [x] `--budget <N>` token 預算限制 ✅
  - [x] `--compress L0|L1|L2` 壓縮等級 ✅
  - [ ] 自動偵測索引是否存在（未實作）
- [ ] 測試：sparse n-gram 索引建立與查詢正確性（未實作）
- [ ] 測試：frequency-based weight 正確性
- [ ] 測試：Git-based layering 正確性（base + overlay）
- [ ] 測試：Bloom filter 正確性（false positive rate）
- [ ] 測試：incremental update 正確性（mtime + hash）
- [ ] 測試：sparse n-gram vs trigram 選擇性比較
- [ ] 測試：token budget greedy selection 正確性
- [ ] Benchmark：大型專案（10K+ files）搜尋效能

## Phase 5：Multi-Signal Ranking + Graph Traversal（v3 增強版，2 週）
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
- [ ] 🆕 三模態範式文件化（v3 新增）
  - [ ] 更新 agent system prompt：Lexical / Structural / Graph 三模態引導
  - [ ] 更新 `config/agents/smart-mcp.md`：smart_grep 三模態使用說明
  - [ ] 更新 README.md：三模態範式架構圖
- [ ] 🆕 效能目標驗證（v3 新增）
  - [ ] Cold index benchmark：目標 < 500ms
  - [ ] Warm query benchmark：目標 < 10ms
  - [ ] NDCG@10 benchmark：目標 > 0.80
  - [ ] Token reduction benchmark：目標 > 85% vs grep+read
- [ ] 整合到 `contextual-grep.mjs`
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

---

# Smart MCP 商用工程等級強化 — 待辦清單

> **務實版**：只做真正有用的，其餘取消或延後。
> 判斷原則：如果現有 CLI 已能輕鬆完成（npm audit / degit / ChatGPT），就不包裝成 MCP 工具。

## Phase 1：唯一真正的阻斷者 — smart_db 升級（1-2 週）

### smart_db 寫入支援（最高優先）
- [ ] `smart_db` 新增寫入支援 — 修改 `src/lib/db-query.mjs`
  - [ ] `dbWrite(table, data)` — INSERT（含型別檢查 + SQL injection 防護）
  - [ ] `dbUpdate(table, data, where)` — UPDATE（強制 WHERE 條件）
  - [ ] `dbDelete(table, where)` — DELETE（強制 `--confirm` 確認）
  - [ ] 安全閘：所有寫入操作需 `--confirm`，支援 `--dry-run` 預覽
- [ ] 新增 `smart_db({command:"write|update|delete", ...})` 命令路由
- [ ] 更新 `smart_db` plugin description（加入寫入命令）
- [ ] 更新 `compose-engine.mjs` TOOL_ARGS_CONVERTERS
- [ ] 更新 `workflow.mjs` TOOL_ARGS_CONVERTERS
- [ ] 測試：INSERT 正確性（基本 + 特殊字元）
- [ ] 測試：UPDATE 正確性（含 WHERE 條件）
- [ ] 測試：DELETE 正確性（含 `--confirm` 安全閘）
- [ ] 測試：SQL injection 防護
- [ ] 測試：rollback 正確性
- [ ] 測試：型別檢查（number/string/boolean/null）

### smart_db Migration 管理
- [ ] 建立 migration 框架
  - [ ] `migrateCreate(name, dialect)` — 從現有 schema 產生 migration 模板
  - [ ] `migrateUp()` — 套用待處理 migration（追蹤已套用狀態）
  - [ ] `migrateDown(steps?)` — 回滾指定步數
  - [ ] `migrateStatus()` — 列出 migration 狀態樹
  - [ ] 支援 SQLite + PostgreSQL（透過 SQL dialect adapter）
- [ ] Migration 狀態儲存（`_migrations` 表追蹤已套用版本）
- [ ] 安全閘：migration 失敗自動 rollback
- [ ] 測試：migrateCreate + migrateUp 正確性
- [ ] 測試：migrateDown 回滾正確性
- [ ] 測試：migrateStatus 顯示正確性
- [ ] 測試：migration 失敗 rollback

### smart_db Schema diff
- [ ] `schemaDiff(from, to)` — 比較兩個分支/版本的 schema
  - [ ] 輸出：新增 table、移除 table、新增 column、移除 column、型別變更
- [ ] 測試：schema diff 正確性

---

## Phase 1b：輕量輔助工具（3-5 天）

### smart_setup — 新專案 onboarding
- [ ] 建立 `src/lib/setup-engine.mjs`
  - [ ] `detectProjectType(root)` — 從現有檔案偵測語言/框架
  - [ ] `generateOpenCodeConfig(projectType)` — 產生 opencode.json（含 smart-mcp）
  - [ ] `generateConventions(projectType)` — 產生 `.opencode-conventions.json`
  - [ ] `generateEnvTemplate(projectType)` — 產生 `.env.example`
- [ ] 註冊 `smart_setup` 為 sub-tool（透過 smart_run）
- [ ] 註冊 `smart_setup` 為 Layer 1 direct tool（如果夠常用）
- [ ] 測試：偵測專案類型正確性（JS/TS/Python/Go）
- [ ] 測試：opencode.json 產生格式正確
- [ ] 測試：`.opencode-conventions.json` 產生格式正確

### smart_deps 極簡版 — 依賴審計 wrapper
- [ ] 建立 `src/lib/deps-lite.mjs`
  - [ ] `depAudit()` — 執行 `npm audit` / `pip audit`，解析 JSON 輸出
  - [ ] `depOutdated()` — 執行 `npm outdated`，產生表格報告
  - [ ] `depSuggestFix(auditResult)` — LLM 讀取漏洞報告，給修復建議
- [ ] 註冊 `smart_deps` 為 sub-tool（透過 smart_run）
- [ ] 測試：audit 解析正確性
- [ ] 測試：outdated 解析正確性

---

## 已取消項目（不實作）

| 項目 | 理由 |
|:----|:------|
| `smart_init`（完整 scaffold 引擎） | degit + ChatGPT 已足夠，維護 5 樣板成本 > 收益 |
| `smart_build`（Dockerfile 產生） | 寫一次的東西，ChatGPT 10 秒解決 |
| `smart_deploy`（CI/CD 產生） | GitHub Actions 樣板到處都是 |
| `smart_team`（團隊協作） | 現有 wiki + git 已 cover 80%，共用記憶需 server 端 |
| `smart_api`（OpenAPI 全流程） | 有價值但非緊急，延後評估 |
| `smart_quality`（架構規範引擎） | 複雜 + 配置一次就不動，延後評估 |

---

## 驗證與交付
- [ ] `npm test` 全部通過
- [ ] 更新 `config/agents/smart-mcp.md`（smart_db 新增命令 ＋ smart_setup/smart_deps 權限）
- [ ] 更新 README.md（商用等級功能概述）
- [ ] 建立 end-to-end 測試：從 scaffold → 寫 code → 操作資料庫 → 測試
