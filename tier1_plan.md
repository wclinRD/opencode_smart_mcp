# Smart MCP 一級工具全面強化計畫

## 📋 專案概要

| 項目 | 內容 |
|------|------|
| **專案名稱** | Smart MCP 一級工具全面強化 |
| **所屬專案** | Smart MCP（`~/opencode/dev/smart`） |
| **建立日期** | 2026-07-18 |
| **狀態** | 🟡 規劃中 |

---

## 🎯 總目標

對 Smart MCP 全部 **23 個一級工具**進行系統性強化，涵蓋：
- 功能缺口填補
- 架構一致性改善
- 測試覆蓋率提升
- 效能優化
- 新工具補齊

---

## 🗺 全覽圖（按 ROI 排序）

```
ROI 🔴 最高（1-3 天/項）
┌──────────────────────────────────────────────────────────────┐
│ 1. smart_glob 強化        — 22 行，加 5 參數，成本極低        │
│ 2. smart_test 強化        — 加 coverage + related 命令        │
│ 3. smart_security .env    — 一行 pattern，高價值              │
└──────────────────────────────────────────────────────────────┘

ROI 🟡 中（2-5 天/項）
┌──────────────────────────────────────────────────────────────┐
│ 4. smart_read hash cache  — 減 disk I/O                      │
│ 5. smart_grep postProcess — 結果二次處理                       │
│ 6. smart_edit_chain diff  — dry-run 完整 preview              │
│ 7. smart_rules YAML 增強  — 規則衝突偵測                      │
│ 8. smart_compact 摘要     — 改了哪些 function                  │
│ 9. inline tools 外移      — 4 個工具抽成 plugin               │
│ 10. server/index.mjs 拆分  — 3789 行 → ~500 行核心            │
│ 11. 核心工具測試補強       — 1 個 test → 70+ tests            │
└──────────────────────────────────────────────────────────────┘

ROI 🟢 中低（3-7 天/項）
┌──────────────────────────────────────────────────────────────┐
│ 12. smart_learn 加命令    — update / compare / enforce        │
│ 13. smart_fast_apply 增強 — diff preview / multi-file diff    │
│ 14. smart_github_search   — sortBy / dateRange / fileContent  │
│ 15. smart_decompose 進化  — progress 追蹤 / cycle detection   │
│ 16. smart_edasearch 增強  — 結果不足時 auto prompt exa        │
│ 17. smart_medical table   — PMC 表格解析 + rate limit 狀態    │
│ 18. smart_rtl_analyze     — slang fallback + synth 面積估算   │
└──────────────────────────────────────────────────────────────┘

ROI 🔵 長期（7+ 天 / 需新工具）
┌──────────────────────────────────────────────────────────────┐
│ 19. smart_diff 新工具     — multi-file 變更檢視               │
│ 20. tool result 快取      — content-hash 跨呼叫快取           │
│ 21. parallel tool exec    — concurrency gate 充分利用          │
│ 22. tool usage analytics  — 統計 dashboard                    │
│ 23. plugin 開發文件       — PLUGIN_DEV.md                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 1：ROI 🔴 最高 — 低成本高收益（3-5 天）

### 1. smart_glob 強化（成本極低，效果最直接）

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 22 行（plugin）+ 118 行（CLI） | — |
| **現狀** | 純 rg wrapper，只接受 pattern + path | — |

**新增參數（5 個）**：

| 參數 | 型別 | 說明 | 實作方式 |
|------|------|------|---------|
| `type` | string | `files` / `dirs` / `symlinks` / `all` | rg `--type` / `--type d` / `--type l` |
| `size` | string | 大小過濾，如 `+100k` / `-1m` | rg `--size` |
| `maxDepth` | number | 最大目錄深度 | rg `--max-depth` |
| `gitignore` | boolean | 是否尊重 .gitignore（預設 true） | rg `--no-ignore` 反向控制 |
| `tree` | boolean | Tree 輸出格式 | 自訂 formatter |

**額外**：加 `countOnly` 參數（只回傳筆數，不做 file listing）

**預估**：1 天完成

---

### 2. smart_test 強化（TDD 流程升級）

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 24 行（plugin）+ 283 行（CLI） | — |
| **支援** | vitest / jest / mocha / ava / node:test | — |

**新增功能**：

| 功能 | 說明 | 實作方式 |
|------|------|---------|
| `coverage` | 執行測試 + 回傳 coverage 報告 | 接 `c8` / `v8 --coverage` |
| `related` | 只跑跟特定檔案相關的測試 | 從 test file 的 import 找 target file |
| `file` | 只跑指定 test file 的測試 | 直接傳路徑給 runner |
| `grep` | 只跑匹配名稱的 test case | `--grep` / `-t` 參數 |
| `retry` | 失敗測試自動重試 N 次 | runTest loop |
| error fix suggestion | test failure 時附帶常見修復建議 | pattern match error message |

**預估**：2 天完成

---

### 3. smart_security 加 .env 掃描（一行 pattern）

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 36 行（plugin）+ 593 行（CLI） | — |
| **scan 類型** | credentials / injection / dependencies / all | — |

**新增**：

| 功能 | 說明 |
|------|------|
| `.env` 檔案自動掃描 | 偵測 `.env`、`.env.local`、`.env.production` 中的 secret |
| `.env.example` 比對 | 找出 `.env` 有但 `.env.example` 沒有的 key |
| Secret rotation 建議 | 偵測到 leaked key 時建議下一步（rotating key、 revoke） |
| Git history 掃描 | `git log -p` 中是否洩漏過 secret |

**`.env` 掃描 pattern**：
```
/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/  （排除空值和 .env.example）
```

**預估**：1 天完成

---

## Phase 2：ROI 🟡 中 — 架構改善 + 功能增強（1-2 週）

### 4. smart_read cache 改 hash-based

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 554 行 | — |
| **cache** | TTL 10 分鐘，到期全部失效 | — |

**改進方案**：

```javascript
// 現在
if (now - entry.timestamp > CACHE_TTL) → invalidate

// 改進後
if (now - entry.timestamp > CACHE_TTL) {
  const stat = fs.statSync(filePath);
  if (stat.mtime !== entry.mtime || stat.size !== entry.size) → invalidate
  else → 延長 cache（避免 disk I/O）
}
```

**預估效果**：重複讀同一檔案時 disk I/O ↓60-80%

---

### 5. smart_grep postProcess + 增強

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 55 行（plugin）+ 886 行（CLI） | — |
| **semantic** | Phase 1-2 已完成 BM25 + hybrid | — |

**新增功能**：

| 功能 | 說明 |
|------|------|
| `searchInResults` | 對上次 grep 結果再搜（避免重複掃描） |
| `postProcess` hook | 結果二次處理（filter / sort / aggregate） |
| `group-by` | 按 function / class / file 分組顯示 |
| structured output | `format:"json"` 加強，含 symbol info |
| error fix suggestion | 無匹配時建議替代 pattern |

---

### 6. smart_edit_chain dry-run 增強

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 350 行 | — |
| **dry-run** | 顯示結果摘要，無完整 diff | — |

**改進**：
1. `dryRun:true` 時顯示完整 unified diff（每個 edit 的 +/- 行）
2. 加 `validate` 選項（apply 前用 AST 檢查語法）
3. 跨檔案依賴偵測（A 改 function name → B 有 call site 時警告）

---

### 7. smart_rules YAML 增強

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 218 行 | — |
| **YAML parser** | `parseSimpleYAML` 14 行 | — |

**改進**：
1. YAML parser 加 `array` / `nested object` 支援
2. Rule conflict detection（兩個 rule 矛盾時警告）
3. Auto-fix suggestion（rule 建議但沒自動修正時，附帶修正指令）
4. `validate` 命令：檢查 rule 文件格式是否正確

---

### 8. smart_compact 摘要增強

| 項目 | 現狀 | 強化 |
|------|------|------|
| **行數** | 536 行 | — |
| **extractRecentEdits** | 顯示改了哪些檔案 | — |

**改進**：
1. `extractRecentEdits` 加入「改了哪些 function / class」的摘要
2. `summarizeOutput` 加 token 預估（目前只顯示字符數）
3. 與 `smart_context({command:"budget"})` 聯動更緊密
4. Recovery context 加入 TODO 狀態摘要

---

### 9. inline tools 外移

將 4 個 inline 工具從 `server/index.mjs` 抽成獨立 plugin：

| 工具 | 現狀行數 | 目標 |
|------|---------|------|
| `smart_context` | ~200 行 inline | `src/plugins/core/context.mjs` |
| `smart_config` | ~20 行 inline | `src/plugins/core/config.mjs` |
| `smart_hook` | ~80 行 inline | `src/plugins/core/hook.mjs` |
| `smart_deep_think` | ~50 行 inline | 確認是否已在 quick-think.mjs 中 |

**注意**：這三個工具是 `tools/list` 中直接註冊的（非經 plugin loader），外移後需保留薄 dispatch 層。

---

### 10. server/index.mjs 拆分

目前 3789 行，目標拆分：

```
src/server/
├── index.mjs          # 入口 + JSON-RPC dispatch（~500 行）
├── handlers.mjs       # 所有 inline tool handlers（~800 行）
├── pipeline.mjs       # invokeTool + retry + fallback（~400 行）
├── hooks.mjs          # pre/post hooks + high-risk（~300 行）
├── memory.mjs         # auto-store + pre-check（~400 行）
└── compaction.mjs     # auto-manage context（~300 行）
```

**原則**：逐步拆分，先抽 handlers → 保持向後相容。

---

### 11. 核心工具測試補強

目前全專案只有 1 個 test file。目標：

| 測試檔 | 目標工具 | 測試數量 | 覆蓋範圍 |
|--------|---------|---------|---------|
| `tests/fast-apply.test.mjs` | smart_fast_apply | 20+ | 6 種 format、fuzzy、hashline、block-diff、atomic |
| `tests/smart-read.test.mjs` | smart_read | 15+ | 11 種 mode、cache、batch、image、error |
| `tests/edit-chain.test.mjs` | smart_edit_chain | 10+ | 單檔/多檔、atomic rollback、dry-run |
| `tests/contextual-grep.test.mjs` | smart_grep | 15+ | BM25、query detection、semantic、budget |
| `tests/lsp-bridge.test.mjs` | smart_lsp | 10+ | definition、references、hover、diagnostics |
| `tests/security-scan.test.mjs` | smart_security | 10+ | credential/injection/dependency 掃描 |
| `tests/test-runner.test.mjs` | smart_test | 8+ | runner detect、coverage、related |

**原則**：`node:test` + `node:assert`，零依賴，獨立運行。

---

## Phase 3：ROI 🟢 中低 — 功能完善（2-3 週）

### 12. smart_learn 加命令

| 命令 | 說明 |
|------|------|
| `update` | 增量更新 conventions（不重跑全量 extract） |
| `compare` | 比較兩次分析的差異（哪些 conventions 變了） |
| `enforce` | 檢查 code 是否符合 conventions（違規列表） |

---

### 13. smart_fast_apply 增強

| 功能 | 說明 |
|------|------|
| dryRun 完整 diff | `dryRun:true` 顯示完整 unified diff（含 +/- 行、行號、統計） |
| multi-file diff 輸出 | atomic 失敗時顯示 per-file 狀態（applied/failed/unchanged） |
| validate + auto-retry | apply 後語法驗證，失敗自動 retry 一次 |
| error fix suggestion | 衝突時建議具體修正方式 |

---

### 14. smart_github_search 增強

| 功能 | 說明 |
|------|------|
| `sortBy` | stars / updated / best-match |
| `dateRange` | 起始/結束日期過濾 |
| `fileContent` | 回傳匹配檔案的實際內容（目前只有 metadata） |
| rate limit 狀態 | 偵測 403/429 時顯示剩餘 quota |

---

### 15. smart_decompose 進化

| 功能 | 說明 |
|------|------|
| progress 自動追蹤 | subtask 完成後自動更新進度條 |
| cycle detection 跨回合 | 偵測重複 subtask（相同 goal + 相同 subtask ID） |
| tool suggestion 增強 | 基於 subtask 類型選擇更精確的工具建議 |
| budget auto-detect | 從 goal 長度/複雜度自動判斷 thinking budget |

---

### 16. smart_eda_search 增強

| 功能 | 說明 |
|------|------|
| auto 結果不足提示 | auto 結果 < 3 筆時，自動建議 `smart_exa_search` 做更深入搜尋 |
| troubleshoot 增強 | 加入更多 FAQ index（目前 10 個 tool） |
| docs 命令 | 爬取工具 user guide / 文件 |

---

### 17. smart_medical_search 增強

| 功能 | 說明 |
|------|------|
| PMC table 解析 | `<table>` 轉 Markdown table |
| rate limit 狀態 | OpenEvidence 429 時回傳 retry-after + 自動降級 PubMed |
| 結果去重 | 跨 source（PubMed + OpenAlex + Semantic Scholar）DOI 去重增強 |

---

### 18. smart_rtl_analyze 增強

| 功能 | 說明 |
|------|------|
| slang fallback 訊息 | parse error 時回傳行號 + 建議修正 + 自動 fallback regex |
| synth 面積估算 | 基於 cell count × technology node 估算面積 |
| parsers 命令增強 | `generateParserActions` 完整利用 |

---

## Phase 4：ROI 🔵 長期 — 新工具補齊（需評估優先級）

### 19. smart_diff 新工具

**動機**：Agent 做 multi-file 變更後沒有一個統一的 diff 檢視工具。

```
smart_diff({
  command: "file" | "commit" | "branch",
  file?: "src/foo.mjs",        // file mode
  commit?: "HEAD~1",           // commit mode
  branch?: "main...feature",   // branch mode
  format: "text" | "ansi",     // 輸出格式
  context?: 3,                 // context lines
})
```

**實作**：
- file mode：用 `smart_fast_apply` 的 dryRun diff
- commit mode：用 `git diff <commit>~1 <commit>`
- branch mode：用 `git diff <branch1>...<branch2>`

**預估**：2-3 天

---

### 20. tool result 快取

**動機**：同樣的 `smart_read` 同一檔案可能被讀多次。

**方案**：在 `invokeTool` 層加 content-hash 快取：

```javascript
// invokeTool() 中
const cacheKey = hash(toolName + JSON.stringify(sortedArgs));
const cached = toolResultCache.get(cacheKey);
if (cached && !isStale(cached)) return cached;
```

**注意**：需排除有副作用的工具（smart_fast_apply、smart_test 等）。

---

### 21. parallel tool execution

**動機**：一次只能跑一個工具。

**方案**：`executeToolGated` 層加 parallel gate（`concurrency-gate.mjs` 已存在但未充分利用）。

**限制**：只有 `search` / `analyze` / `read` 類工具可並行，`edit` / `test` / `security` 需 serial。

---

### 22. tool usage analytics dashboard

**動機**：`stats` 物件有記錄但沒 dashboard。

**方案**：新增 `smart_context({command:"stats"})` 輸出：
- 每個工具的呼叫次數 / 平均耗時 / 錯誤率
- Token 節省統計（compaction / prefetch / cache hit）
- Session 級別摘要

---

### 23. plugin 開發文件

**動機**：新增 plugin 需要讀原始碼才能理解架構。

**方案**：建立 `docs/PLUGIN_DEV.md`：
- Plugin 結構（name / category / description / inputSchema / cli / mapArgs / handler）
- CLI delegation pattern（mapArgs → spawnSync → stdout）
- Handler pattern（直接回傳 string 或 Promise）
- 測試 pattern（獨立 .test.mjs）
- Loader 自動註冊機制

---

## 📊 預期效果總覽

| Phase | 改善面向 | 量化 |
|-------|---------|------|
| Phase 1 | 搜尋精度 | smart_glob 參數 ↑250% |
| Phase 1 | TDD 流程 | smart_test 功能 ↑200%（coverage + related + retry） |
| Phase 1 | 安全掃描 | .env 掃描覆蓋率 0% → 100% |
| Phase 2 | 讀取效能 | 重複讀 disk I/O ↓60-80% |
| Phase 2 | 架構一致性 | inline tools 0 → 3 個 plugin |
| Phase 2 | server 可維護性 | 3789 行 → ~500 行核心 |
| Phase 2 | 品質基線 | 測試覆蓋率 1% → 15%+ |
| Phase 3 | 功能完整度 | 每工具平均 +2-3 個命令/參數 |
| Phase 4 | 工具缺口 | smart_diff + 快取 + 並行 + analytics |

---

## 🔒 風險評估

| 風險 | 機率 | 影響 | 對策 |
|------|------|------|------|
| server 拆分 break 向後相容 | 中 | 高 | 先寫 integration test 再拆分 |
| cache hash change race condition | 低 | 中 | 原子操作 + 單 thread |
| test 覆蓋率目標太高 | 中 | 低 | 先做 smoke test，再逐步加 edge case |
| smart_diff 與現有 dry-run 重疊 | 低 | 低 | 明確分工：dry-run = apply 前預覽，diff = 變更後檢視 |

---

## 📝 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-18 | v1.0 | 建立計畫書（23 個一級工具全面分析） |
