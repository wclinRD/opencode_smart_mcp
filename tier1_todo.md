# Smart MCP 一級工具強化追蹤清單

## 📋 當前狀態

| 項目 | 狀態 |
|------|------|
| **整體進度** | 🟡 規劃中 |
| **最後更新** | 2026-07-18 |

---

## ROI 🔴 最高 — 低成本高收益（3-5 天）

### 1. smart_glob 強化（22 行，1 天）

- [ ] 新增 `type` 參數（`files` / `dirs` / `symlinks` / `all`）
  - [ ] CLI 層：加 `--type` 參數
  - [ ] Plugin 層：加 `type` 到 inputSchema
- [ ] 新增 `size` 參數（大小過濾，如 `+100k` / `-1m`）
  - [ ] CLI 層：加 `--size` 參數
  - [ ] Plugin 層：加 `size` 到 inputSchema
- [ ] 新增 `maxDepth` 參數（最大目錄深度）
  - [ ] CLI 層：加 `--max-depth` 參數
  - [ ] Plugin 層：加 `maxDepth` 到 inputSchema
- [ ] 新增 `gitignore` 參數（是否尊重 .gitignore，預設 true）
  - [ ] CLI 層：加 `--no-ignore` 反向控制
  - [ ] Plugin 層：加 `gitignore` 到 inputSchema
- [ ] 新增 `tree` 參數（Tree 輸出格式）
  - [ ] CLI 層：加 `--tree` 參數 + 自訂 formatter
  - [ ] Plugin 層：加 `tree` 到 inputSchema
- [ ] 新增 `countOnly` 參數（只回傳筆數）
  - [ ] CLI 層：加 `--count-only` 參數
  - [ ] Plugin 層：加 `countOnly` 到 inputSchema
- [ ] 測試：每個新參數的基本功能測試
- [ ] 更新 `config/agents/smart-mcp.md`（smart_glob 新參數）

---

### 2. smart_test 強化（24/283 行，2 天）

- [ ] 新增 `coverage` 功能
  - [ ] CLI 層：偵測 `c8` / `v8 --coverage`，執行並解析輸出
  - [ ] Plugin 層：加 `coverage` 到 inputSchema
  - [ ] 輸出格式：coverage summary（行覆蓋率 / 分支覆蓋率 / function 覆蓋率）
- [ ] 新增 `related` 命令
  - [ ] CLI 層：從 test file 的 import 找 target file，只跑相關測試
  - [ ] Plugin 層：加 `related` 到 inputSchema
  - [ ] 輸出格式：找到的相關測試檔列表 + 執行結果
- [ ] 新增 `file` 參數（只跑指定 test file）
  - [ ] CLI 層：直接傳路徑給 runner
  - [ ] Plugin 層：加 `file` 到 inputSchema
- [ ] 新增 `grep` 參數（只跑匹配名稱的 test case）
  - [ ] CLI 層：`--grep` / `-t` 參數
  - [ ] Plugin 層：加 `grep` 到 inputSchema
- [ ] 新增 `retry` 參數（失敗測試自動重試 N 次）
  - [ ] CLI 層：runTest loop + retry count
  - [ ] Plugin 層：加 `retry` 到 inputSchema
- [ ] 新增 error fix suggestion
  - [ ] CLI 層：pattern match error message → 附帶常見修復建議
  - [ ] 涵蓋：`ReferenceError`、`TypeError`、`AssertionError`、`timeout`
- [ ] 測試：coverage 執行正確性
- [ ] 測試：related 找到正確的相關測試
- [ ] 測試：retry 在 flaky test 時成功
- [ ] 更新 `config/agents/smart-mcp.md`（smart_test 新參數）

---

### 3. smart_security 加 .env 掃描（36/593 行，1 天）

- [ ] 新增 `.env` 檔案自動掃描
  - [ ] CLI 層：掃描 `.env`、`.env.local`、`.env.production`
  - [ ] Pattern：`/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/`
  - [ ] 排除空值和 `.env.example`
  - [ ] 偵測常見 secret key pattern（`API_KEY`、`SECRET`、`PASSWORD`、`TOKEN`）
- [ ] 新增 `.env.example` 比對
  - [ ] 找出 `.env` 有但 `.env.example` 沒有的 key
  - [ ] 輸出：missing in .env.example 列表
- [ ] 新增 Secret rotation 建議
  - [ ] 偵測到 leaked key 時建議下一步（rotating key、 revoke）
  - [ ] 輸出：actionable next steps
- [ ] 新增 Git history 掃描（可選）
  - [ ] `git log -p` 中是否洩漏過 secret
  - [ ] 限制：只掃最近 N commits（避免太慢）
- [ ] 新增 `scan` 選項：`env`（只掃 .env）/ `all`（含現有 credentials + env）
- [ ] 測試：.env 掃描正確性
- [ ] 測試：.env.example 比對正確性
- [ ] 測試：secret rotation 建議正確性
- [ ] 更新 `config/agents/smart-mcp.md`（smart_security 新 scan type）

---

## ROI 🟡 中 — 架構改善 + 功能增強（1-2 週）

### 4. smart_read cache hash-based（554 行，1 天）

- [ ] `cacheWrap()` 中加入 `fs.stat()` 檢查
  - [ ] TTL 到期時才做 stat（避免每次呼叫都 stat）
  - [ ] stat.mtime + stat.size 比對 entry
- [ ] TTL 到期 + mtime/size 未變 → 延長 cache
  - [ ] 更新 entry.timestamp（延長 TTL）
  - [ ] 回傳 cached result（不重讀）
- [ ] TTL 到期 + mtime/size 變了 → 重新讀取
  - [ ] 清除舊 cache entry
  - [ ] 重新讀取並存入 cache
- [ ] 新增 cache stats：`hit` / `miss` / `stale-refreshed` / `invalidated`
- [ ] 測試：cache hit 正確性
- [ ] 測試：cache miss 後重建
- [ ] 測試：file 變更後 cache 失效
- [ ] Benchmark：重複讀同一檔案的 disk I/O 測量

---

### 5. smart_grep postProcess + 增強（55/886 行，2 天）

- [ ] 新增 `searchInResults` 參數
  - [ ] CLI 層：接受上次結果的 JSON，對結果再搜
  - [ ] Plugin 層：加 `searchInResults` 到 inputSchema
- [ ] 新增 `postProcess` hook
  - [ ] CLI 層：接受 JS expression（如 `r => r.line > 10`）
  - [ ] Plugin 層：加 `postProcess` 到 inputSchema
- [ ] 新增 `groupBy` 參數
  - [ ] CLI 層：按 function / class / file 分組顯示
  - [ ] 輸出格式：grouped by scope
- [ ] 增強 `format:"json"` 輸出
  - [ ] 含 symbol info（function name、class name、scope）
  - [ ] 含 import graph（if `withImports`）
- [ ] 新增 error fix suggestion（無匹配時）
  - [ ] 建議替代 pattern（如：大小寫差異、相似識別字）
- [ ] 測試：searchInResults 正確性
- [ ] 測試：groupBy 正確性
- [ ] 測試：error fix suggestion 正確性

---

### 6. smart_edit_chain dry-run 增強（350 行，1 天）

- [ ] `dryRun:true` 時顯示完整 unified diff
  - [ ] 每個 edit 的 +/- 行
  - [ ] 行號標示
  - [ ] 統計摘要（+N/-N lines）
- [ ] 新增 `validate` 參數
  - [ ] apply 前用 AST 檢查語法（JS/TS/Python）
  - [ ] 語法錯誤時回傳 actionable message
- [ ] 跨檔案依賴偵測（可選）
  - [ ] A 改 function name → B 有 call site 時警告
  - [ ] 輸出：dependency warning
- [ ] 測試：dry-run diff 輸出正確性
- [ ] 測試：validate 語法檢查正確性

---

### 7. smart_rules YAML 增強（218 行，1 天）

- [ ] `parseSimpleYAML` 加 array / nested object 支援
  - [ ] 支援 `- item` 陣列語法
  - [ ] 支援 `key: { nested: value }` 巢狀語法
  - [ ] 支援多行字串（`|` / `>`）
- [ ] 新增 rule conflict detection
  - [ ] 偵測兩個 rule 對同一檔案的衝突指令
  - [ ] 輸出：conflict warning + 建議 resolution
- [ ] 新增 auto-fix suggestion
  - [ ] rule 建議但沒自動修正時，附帶修正指令
- [ ] 新增 `validate` 命令
  - [ ] 檢查 rule 文件格式是否正確
  - [ ] 輸出：validation errors
- [ ] 測試：array / nested YAML 解析正確性
- [ ] 測試：rule conflict 偵測正確性

---

### 8. smart_compact 摘要增強（536 行，1 天）

- [ ] `extractRecentEdits` 加入 function / class 摘要
  - [ ] 從 edit 的 file + line 推斷改了哪些 function
  - [ ] 輸出：`src/foo.mjs:parseRequest()` 改了 3 行
- [ ] `summarizeOutput` 加 token 預估
  - [ ] 估算：~3.5 chars/token
  - [ ] 輸出：`Estimated tokens: ~1200`
- [ ] 與 `smart_context({command:"budget"})` 聯動
  - [ ] compact 時自動顯示 budget 狀態
- [ ] Recovery context 加入 TODO 狀態摘要
  - [ ] 從 accumulatedFindings 提取 TODO items
- [ ] 測試：function 摘要正確性
- [ ] 測試：token 預估正確性

---

### 9. inline tools 外移（3 個工具，2 天）

- [ ] `smart_context` → `src/plugins/core/context.mjs`
  - [ ] 抽出 handleSmartContext() 函式
  - [ ] 抽出 inputSchema
  - [ ] index.mjs 保留薄 dispatch 層
- [ ] `smart_config` → `src/plugins/core/config.mjs`
  - [ ] 抽出 config handler 函式
  - [ ] 抽出 inputSchema
  - [ ] index.mjs 保留薄 dispatch 層
- [ ] `smart_hook` → `src/plugins/core/hook.mjs`
  - [ ] 抽出 hook handler 函式
  - [ ] 抽出 inputSchema
  - [ ] index.mjs 保留薄 dispatch 層
- [ ] 確認 `smart_deep_think` 是否需分離
  - [ ] 檢查 quick-think.mjs 是否已有 handler
  - [ ] 決定是否需要獨立 plugin
- [ ] 測試：三個工具功能不受影響
- [ ] 更新 manifest.json（自動產生）

---

### 10. server/index.mjs 拆分（3789 行，3 天）

- [ ] 抽出 `handlers.mjs`（inline tool handlers）
  - [ ] handleSmartContext()
  - [ ] handleSmartConfig()
  - [ ] handleSmartHook()
  - [ ] 估計 ~800 行
- [ ] 抽出 `pipeline.mjs`（invokeTool + retry + fallback）
  - [ ] invokeTool()
  - [ ] invokeToolWithRetry()
  - [ ] invokeToolAsync()
  - [ ] spawnToolAsync()
  - [ ] 估計 ~400 行
- [ ] 抽出 `hooks.mjs`（pre/post hooks + high-risk）
  - [ ] initBuiltinHooks()
  - [ ] checkHighRiskPrerequisites()
  - [ ] executePreHooks() / executePostHooks()
  - [ ] 估計 ~300 行
- [ ] 抽出 `memory.mjs`（auto-store + pre-check）
  - [ ] autoStoreToMemory()
  - [ ] preCheckMemory()
  - [ ] contextualMemorySearch()
  - [ ] 估計 ~400 行
- [ ] 抽出 `compaction.mjs`（auto-manage context）
  - [ ] autoManageContext()
  - [ ] writeSharedRecoveryFile()
  - [ ] writeCompactionStatus()
  - [ ] 估計 ~300 行
- [ ] index.mjs 保持 ~500 行（JSON-RPC dispatch + tool registry）
- [ ] 測試：所有工具功能不受影響
- [ ] 更新文件（如有）

---

### 11. 核心工具測試補強（70+ tests，3 天）

- [ ] `tests/fast-apply.test.mjs`（20+ tests）
  - [ ] 6 種 format 基本功能
  - [ ] fuzzy matching（L1-L6）
  - [ ] hashline 格式
  - [ ] block-diff 格式
  - [ ] atomic multi-file
  - [ ] dry-run 輸出
  - [ ] error handling
- [ ] `tests/smart-read.test.mjs`（15+ tests）
  - [ ] 11 種 mode 基本功能
  - [ ] cache hit / miss
  - [ ] batch 模式
  - [ ] image 模式
  - [ ] error cases（file not found, permission denied）
- [ ] `tests/edit-chain.test.mjs`（10+ tests）
  - [ ] 單檔編輯
  - [ ] 多檔編輯
  - [ ] atomic rollback
  - [ ] dry-run
  - [ ] format auto-detect
- [ ] `tests/contextual-grep.test.mjs`（15+ tests）
  - [ ] BM25 ranking
  - [ ] query detection
  - [ ] semantic search
  - [ ] budget / compress
  - [ ] error cases
- [ ] `tests/lsp-bridge.test.mjs`（10+ tests）
  - [ ] definition
  - [ ] references
  - [ ] hover
  - [ ] diagnostics
  - [ ] multi-lang support
- [ ] `tests/security-scan.test.mjs`（10+ tests）
  - [ ] credential scan
  - [ ] injection scan
  - [ ] dependency scan
  - [ ] .env scan（Phase 1 完成後）
- [ ] `tests/test-runner.test.mjs`（8+ tests）
  - [ ] runner detect
  - [ ] coverage
  - [ ] related
  - [ ] retry
- [ ] 所有測試 `node --test` 獨立運行通過

---

## ROI 🟢 中低 — 功能完善（2-3 週）

### 12. smart_learn 加命令（24/509 行，2 天）

- [ ] `update` 命令（增量更新）
  - [ ] CLI 層：只重新掃描變更的檔案
  - [ ] Plugin 層：加 `update` 到 command enum
- [ ] `compare` 命令（差異比較）
  - [ ] CLI 層：比較兩次 conventions 的差異
  - [ ] 輸出：新增/移除/修改的 conventions
- [ ] `enforce` 命令（規範檢查）
  - [ ] CLI 層：檢查 code 是否符合 conventions
  - [ ] 輸出：違規列表 + 建議修正
- [ ] 測試：每個新命令的基本功能

---

### 13. smart_fast_apply 增強（1134 行，2 天）

- [ ] dryRun 完整 diff 輸出
  - [ ] `formatOutput()` dryRun 分支改用 `formatDiff()`
  - [ ] 含 +/- 行、行號、統計
- [ ] multi-file diff 輸出
  - [ ] `applyAtomic()` 失敗時回傳 per-file 狀態
  - [ ] applitent/failed/unchanged 分類
- [ ] validate + auto-retry
  - [ ] apply 後語法驗證
  - [ ] 失敗自動 retry 一次
- [ ] error fix suggestion
  - [ ] 衝突時建議具體修正方式
- [ ] 測試：dryRun diff 正確性
- [ ] 測試：multi-file diff 正確性

---

### 14. smart_github_search 增強（9/291 行，1 天）

- [ ] `sortBy` 參數（stars / updated / best-match）
  - [ ] CLI 層：加 `--sort` 參數
  - [ ] Plugin 層：加 `sortBy` 到 inputSchema
- [ ] `dateRange` 參數（起始/結束日期）
  - [ ] CLI 層：加 `--date-from` / `--date-to` 參數
  - [ ] Plugin 層：加 `dateFrom` / `dateTo` 到 inputSchema
- [ ] `fileContent` 回傳
  - [ ] CLI 層：fetch 匹配檔案的實際內容
  - [ ] 輸出：含 file content（限制大小）
- [ ] rate limit 狀態
  - [ ] 偵測 403/429 時顯示剩餘 quota
  - [ ] 輸出：`Rate limit: 45/50 remaining, resets at HH:MM`
- [ ] 測試：sortBy / dateRange 正確性
- [ ] 測試：rate limit 偵測正確性

---

### 15. smart_decompose 進化（117/146 行，2 天）

- [ ] progress 自動追蹤
  - [ ] subtask 完成後自動更新進度條
  - [ ] 輸出：`[3/5] ✅ completed, [4/5] 🔄 in_progress`
- [ ] cycle detection 跨回合
  - [ ] 偵測重複 subtask（相同 goal + 相同 subtask ID）
  - [ ] 輸出：cycle warning + 建議 break
- [ ] tool suggestion 增強
  - [ ] 基於 subtask 類型選擇更精確的工具
  - [ ] 如：debug → `smart_lsp`，search → `smart_grep`
- [ ] budget auto-detect
  - [ ] 從 goal 長度/複雜度自動判斷 thinking budget
  - [ ] 輸出：`Budget: normal (auto-detected)`
- [ ] 測試：progress 追蹤正確性
- [ ] 測試：cycle detection 正確性

---

### 16. smart_eda_search 增強（79 行，1 天）

- [ ] auto 結果不足提示
  - [ ] auto 結果 < 3 筆時，自動建議 `smart_exa_search`
  - [ ] 輸出：`Results limited. Try: smart_exa_search({query:"..."})`
- [ ] troubleshoot 增強
  - [ ] 加入更多 FAQ index（目前 10 個 tool → 目標 15+）
- [ ] docs 命令
  - [ ] 爬取工具 user guide / 文件
  - [ ] 輸出：文件摘要
- [ ] 測試：auto 降級提示正確性

---

### 17. smart_medical_search 增強（1214 行，2 天）

- [ ] PMC table 解析
  - [ ] `parsePMCArticle()` 中加入 `<table>` 解析
  - [ ] 轉為 Markdown table 格式
  - [ ] 大型表格（>50 rows）自動截斷
- [ ] rate limit 狀態
  - [ ] `searchOpenEvidence()` 中偵測 429 response
  - [ ] 回傳 `rateLimited: true` + retry-after
  - [ ] auto mode 自動降級 PubMed
- [ ] 結果去重增強
  - [ ] 跨 source（PubMed + OpenAlex + Semantic Scholar）DOI 去重
  - [ ] 已有 `deduplicateByDOI`，確認是否完整覆蓋
- [ ] 測試：table 解析正確性
- [ ] 測試：rate limit 偵測正確性

---

### 18. smart_rtl_analyze 增強（655 行，1 天）

- [ ] slang fallback 訊息
  - [ ] parse error 時回傳行號 + 建議修正
  - [ ] 自動 fallback 到 regex mode
  - [ ] 輸出：`Parse error at line 42. Falling back to regex analysis.`
- [ ] synth 面積估算
  - [ ] 基於 cell count × technology node
  - [ ] 支援：`generic` / `asic` / `fpga`
  - [ ] 輸出：`Estimated area: ~0.12 mm² (generic 45nm)`
- [ ] parsers 命令增強
  - [ ] `generateParserActions` 完整利用
  - [ ] 輸出：可用 parser 列表 + 動作按鈕
- [ ] 測試：slang fallback 正確性
- [ ] 測試：synth 面積估算正確性

---

## ROI 🔵 長期 — 新工具補齊（需評估優先級）

### 19. smart_diff 新工具（2-3 天）

- [ ] 建立 `src/plugins/core/diff.mjs`
  - [ ] Plugin 定義（name / category / inputSchema）
  - [ ] 三種 mode：`file` / `commit` / `branch`
- [ ] 建立 `src/cli/diff-tool.mjs`
  - [ ] file mode：用 `smart_fast_apply` 的 dryRun diff
  - [ ] commit mode：用 `git diff <commit>~1 <commit>`
  - [ ] branch mode：用 `git diff <branch1>...<branch2>`
- [ ] `format:"ansi"` 彩色 diff 輸出
- [ ] 統計摘要（+N/-N lines, N files changed）
- [ ] 測試：三種 mode 正確性
- [ ] 更新 `config/agents/smart-mcp.md`

---

### 20. tool result 快取（2 天）

- [ ] 在 `invokeTool` 層加 content-hash 快取
  - [ ] `cacheKey = hash(toolName + JSON.stringify(sortedArgs))`
  - [ ] 快取 hit 時直接回傳（跳過 CLI spawn）
- [ ] 排除有副作用的工具
  - [ ] 排除清單：`smart_fast_apply`、`smart_test`、`smart_security`、`smart_hook`
- [ ] TTL 機制（5 分鐘）
- [ ] 快取 stats：`hit` / `miss` / `expired`
- [ ] 測試：cache hit 正確性
- [ ] 測試：副作用工具排除正確性

---

### 21. parallel tool execution（3 天）

- [ ] `concurrency-gate.mjs` 充分利用
  - [ ] 可並行工具：`smart_read`、`smart_grep`、`smart_glob`、`smart_lsp`
  - [ ] 需 serial 工具：`smart_fast_apply`、`smart_test`、`smart_security`
- [ ] `executeToolGated` 層加 parallel 支援
  - [ ] `Promise.all()` 執行多個並行工具
  - [ ] 結果合併
- [ ] 測試：並行執行正確性
- [ ] Benchmark：並行 vs 串行效能比較

---

### 22. tool usage analytics（1 天）

- [ ] `smart_context({command:"stats"})` 輸出
  - [ ] 每個工具的呼叫次數 / 平均耗時 / 錯誤率
  - [ ] Token 節省統計（compaction / prefetch / cache hit）
  - [ ] Session 級別摘要
- [ ] 測試：stats 輸出格式正確性

---

### 23. plugin 開發文件（1 天）

- [ ] 建立 `docs/PLUGIN_DEV.md`
  - [ ] Plugin 結構（name / category / description / inputSchema / cli / mapArgs / handler）
  - [ ] CLI delegation pattern（mapArgs → spawnSync → stdout）
  - [ ] Handler pattern（直接回傳 string 或 Promise）
  - [ ] 測試 pattern（獨立 .test.mjs）
  - [ ] Loader 自動註冊機制
  - [ ] 範例：從零建立一個新 plugin

---

## 📊 測試統計

| 測試檔 | 目標 | 數量 | 狀態 |
|--------|------|------|------|
| tests/fast-apply.test.mjs | smart_fast_apply | 20+ | 🔲 未開始 |
| tests/smart-read.test.mjs | smart_read | 15+ | 🔲 未開始 |
| tests/edit-chain.test.mjs | smart_edit_chain | 10+ | 🔲 未開始 |
| tests/contextual-grep.test.mjs | smart_grep | 15+ | 🔲 未開始 |
| tests/lsp-bridge.test.mjs | smart_lsp | 10+ | 🔲 未開始 |
| tests/security-scan.test.mjs | smart_security | 10+ | 🔲 未開始 |
| tests/test-runner.test.mjs | smart_test | 8+ | 🔲 未開始 |
| **合計** | — | **88+** | — |

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-18 | v1.0 | 建立追蹤清單（23 個一級工具全面分析） |

---

## 🎯 下一步

1. **Phase 1 開始**：smart_glob → smart_test → smart_security（3 天）
2. **Phase 2 開始**：smart_read cache → smart_grep → server 拆分（1-2 週）
3. **定期更新**：每完成一項更新本檔案的 checkbox 狀態
