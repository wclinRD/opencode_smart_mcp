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

# smart_grep 強化待辦清單

## Phase 1：排名與相關性（2-3 天）
- [ ] 建立 `src/lib/bm25.mjs` — 純 JS BM25 實作
  - [ ] `tokenize(text)` — 支援 identifier-aware 分割（camelCase/PascalCase/snake_case）
  - [ ] `bm25Score(query, doc)` — BM25 相關性分數計算
  - [ ] `rankResults(results, query)` — 對搜尋結果排序
- [ ] 整合到 `contextual-grep.mjs`
  - [ ] 新增 `--rank bm25` / `--rank none` CLI 參數
  - [ ] 預設啟用 BM25 排名
- [ ] Code-aware reranking signals
  - [ ] `definitionBoost(match)` — 符號定義行 +0.25
  - [ ] `testDemotion(filePath)` — test/spec 檔案 -0.30
  - [ ] `fileCoherenceBoost(fileResults)` — 同檔案多匹配 +0.20
- [ ] 測試：BM25 排名正確性
- [ ] 測試：identifier-aware tokenization（camelCase/snake_case）

## Phase 2：效能與精準度（1 週）
- [ ] `npm install web-tree-sitter tree-sitter-wasms`
- [ ] 建立 `src/lib/tree-sitter-scope.mjs`
  - [ ] `initParser(lang)` — lazy WASM 載入
  - [ ] `getEnclosingScope(content, line)` — AST 精準 scope
  - [ ] `extractSymbols(content, lang)` — AST 符號提取
- [ ] worker_threads 平行搜尋
  - [ ] 建立 `src/lib/parallel-search.mjs`
  - [ ] 檔案分組 → worker pool → 合併結果
- [ ] 整合到 `contextual-grep.mjs`
  - [ ] `--with-scope` 改用 tree-sitter（fallback regex）
  - [ ] `--parallel` 啟用 worker_threads
- [ ] 測試：5 語言 AST scope 精準度
- [ ] 測試：平行搜尋效能（vs 單線程）

## Phase 3：索引與增量（2 週）
- [ ] `npm install better-sqlite3`
- [ ] 建立 `src/lib/trigram-index.mjs`
  - [ ] `buildIndex(root)` — 建立 trigram 索引
  - [ ] `searchIndex(query)` — trigram 查詢
  - [ ] `updateIndex(changedFiles)` — 增量更新
- [ ] Trigram pre-filtering
  - [ ] 搜尋前用 trigram 過濾不相關檔案
  - [ ] 參考 codixing trigrep 110x 加速
- [ ] 整合到 `contextual-grep.mjs`
  - [ ] `--index build|search|update` CLI 參數
  - [ ] 自動偵測索引是否存在
- [ ] 測試：索引建立與查詢正確性
- [ ] 測試：incremental update 正確性
- [ ] Benchmark：大型專案（10K+ files）搜尋效能

## 驗證與交付
- [ ] `npm test` 全部通過
- [ ] 更新 smart_grep plugin description
- [ ] git commit & push

---

# exa 工具全系列提升至 Layer 1 ✅

- [x] 搬移 `exa_search.mjs` → `src/plugins/core/`
- [x] 搬移 `exa_crawl.mjs` → `src/plugins/core/`
- [x] 搬移 `github_search.mjs` → `src/plugins/core/`
- [x] 更新 `config/agents/smart-mcp.md`：Layer 1 表格 + 權限 + webfetch/websearch 引用
- [x] 更新 `src/server/index.mjs` ROUTER_DESCRIPTION
- [x] git commit & push
