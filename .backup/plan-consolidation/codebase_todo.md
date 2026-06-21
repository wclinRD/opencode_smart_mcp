# codebase-memory-mcp 整合 — 待辦清單

> 基於 [codebase_plan.md](./codebase_plan.md) 的執行追蹤

---

## Phase 1：安裝與註冊（0.5 天）

### 1.1 安裝 CBM binary
- [ ] 執行安裝：`curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash`
  - [ ] 確認 binary 在 PATH（`which codebase-memory-mcp`）
  - [ ] 確認版本（`codebase-memory-mcp version`）
  - [ ] 確認 CLI 可用（`codebase-memory-mcp cli list`）
  - [ ] 確認 MCP stdio 正常（`echo '{}' | codebase-memory-mcp` 輸出 JSON）

### 1.2 註冊到 opencode.json
- [ ] 在 `opencode.json` 的 `mcp` 區塊新增 `cbm` entry
  - [ ] `"type": "local"`
  - [ ] `"command": ["codebase-memory-mcp"]`
  - [ ] `"enabled": true`
- [ ] 重啟 opencode
- [ ] 執行 `/mcp` 確認兩個 server 都在（Smart: 15+ tools, CBM: 14 tools）
- [ ] 簡單驗證：`cbm_list_projects` 回傳空陣列（尚未 index）

### 1.3 索引測試
- [ ] 對 Smart 專案測試索引：`cbm_index_repository`
  - [ ] 確認 `cbm_list_projects` 顯示正確 node/edge 數
  - [ ] 確認 `cbm_search_graph` 可以查到函式
  - [ ] 確認 `cbm_get_architecture` 回傳有意義的結果

---

## Phase 2：CBM Bridge Skill（2 天）

### 2.1 建立 skill 目錄
- [ ] 建立 `.opencode/skills/cbm-bridge/` 目錄
- [ ] 建立 `.opencode/skills/cbm-bridge/SKILL.md`
  - [ ] CBM 優先路由規則
  - [ ] Smart 保留工具清單
  - [ ] 混合流程說明（架構評估 / 重構 / 除錯）

### 2.2 建立 CBM 工具參考文件
- [ ] 建立 `.opencode/skills/cbm-bridge/cbm-tools-reference.md`
  - [ ] 14 個 CBM MCP 工具完整清單與描述
  - [ ] 每個工具的參數範例
  - [ ] 工具分類（Indexing / Querying / Analysis）
  - [ ] Cypher 語法速查表（支援的子集）
  - [ ] 與 Smart 既有工具的對照表

### 2.3 註冊 skill 到 agent
- [ ] 在 `config/agents/smart-mcp.md` 中加入 CBM bridge skill 載入指引
  - [ ] 情境關鍵字對照表（`搜尋函式` → `call skill("cbm-bridge")`）
  - [ ] 初始載入提示（首次進入大型專案時自動提示 index）
- [ ] 建立 `config/agents/reference/cbm-bridge.md`（延遲載入參考）
  - [ ] CBM 完整工具描述
  - [ ] Cypher 範例查詢集

---

## Phase 3：hybrid_router 擴充（2 天）

### 3.1 建立 CBM 客戶端層
- [ ] 建立 `src/plugins/cbm/` 目錄
- [ ] 建立 `src/plugins/cbm/cbm-client.mjs`
  - [ ] `cbmCall(tool, args)` — 透過 child_process spawn CBM CLI
  - [ ] 錯誤處理（CBM 未安裝、timeout、invalid JSON）
  - [ ] 環境變數傳遞（`CBM_CACHE_DIR` 等）
- [ ] 建立 `src/plugins/cbm/cbm-search.mjs`
  - [ ] `searchGraph(pattern, label)` → `cbmCall('search_graph', ...)`
  - [ ] `searchCode(query)` → `cbmCall('search_code', ...)`
- [ ] 建立 `src/plugins/cbm/cbm-trace.mjs`
  - [ ] `tracePath(name, direction, depth)` → `cbmCall('trace_path', ...)`
- [ ] 建立 `src/plugins/cbm/cbm-arch.mjs`
  - [ ] `getArchitecture(root)` → `cbmCall('get_architecture', ...)`
- [ ] 建立 `src/plugins/cbm/cbm-impact.mjs`
  - [ ] `detectChanges(root)` → `cbmCall('detect_changes', ...)`
- [ ] 建立 `src/plugins/cbm/cbm-cypher.mjs`
  - [ ] `queryGraph(query)` → `cbmCall('query_graph', ...)`

### 3.2 擴充 hybrid_router
- [ ] 在 `src/lib/hybrid-engine.mjs` 新增 CBM 路由領域
  - [ ] `cbm_search` — 程式碼結構搜尋、呼叫鏈、架構
  - [ ] `cbm_impact` — 變更影響分析
  - [ ] `cbm_cypher` — Cypher 圖查詢（dead code, graph analysis）
- [ ] 更新 `classifyQuestion()` 以包含 CBM 關鍵字
- [ ] 更新 `getGeneralRecommendation()` 以回傳 CBM 工具建議

### 3.3 註冊 CBM 工具到 manifest
- [ ] 在 `config/tools/manifest.json` 新增 11 個 cbm_* 工具條目
  - [ ] `cbm_index_repository` — 索引專案
  - [ ] `cbm_search_graph` — 結構化搜尋
  - [ ] `cbm_trace_path` — 呼叫鏈追蹤
  - [ ] `cbm_detect_changes` — 變更影響
  - [ ] `cbm_query_graph` — Cypher 查詢
  - [ ] `cbm_get_architecture` — 架構總覽
  - [ ] `cbm_get_code_snippet` — 原始碼讀取
  - [ ] `cbm_search_code` — 全文搜尋
  - [ ] `cbm_manage_adr` — ADR 管理
  - [ ] `cbm_list_projects` — 列出專案
  - [ ] `cbm_index_status` — 索引狀態

### 3.4 更新 system prompt
- [ ] 在 `config/agents/smart-mcp.md` 中加入 CBM 路由規則區塊
  - [ ] CBM 優先工具清單（取代對應 Smart 工具）
  - [ ] Smart 保留工具清單
  - [ ] 混合流程範例
- [ ] 在 `src/agent/core/system-prompt-base.mjs` 中加入 CBM 工具層分類
- [ ] 更新 `README.md` 中的工具表格（加入 CBM 工具）

### 3.5 測試路由正確性
- [ ] 測試 keyword `搜尋函式` → hybrid_router 回傳 cbm_search_graph
- [ ] 測試 keyword `呼叫鏈` → hybrid_router 回傳 cbm_trace_path
- [ ] 測試 keyword `dead code` → hybrid_router 回傳 cbm_query_graph
- [ ] 測試 keyword `編輯這行程式碼` → 不走 CBM（走 Smart fast_apply）
- [ ] 測試 keyword `安全掃描` → 不走 CBM（走 Smart security）
- [ ] 測試非 CBM 關鍵字 → hybrid_router 維持原行為

---

## Phase 4：CKG 後端取代（可選，1-2 週）

### 4.1 評估與設計
- [ ] 分析 `smart_code_query` 的 7 種 query 類型的 CBM 對應
  - [ ] `build` → `cbmCall('index_repository', ...)`
  - [ ] `update` → 由 CBM watcher 自動處理
  - [ ] `callers` → `cbmCall('trace_path', { direction: 'inbound' })`
  - [ ] `callees` → `cbmCall('trace_path', { direction: 'outbound' })`
  - [ ] `dependencies` → `cbmCall('query_graph', { query: 'MATCH ...' })`
  - [ ] `unused-exports` → `cbmCall('query_graph', { query: 'MATCH (f:Function) WHERE NOT EXISTS...' })`
  - [ ] `symbol` → `cbmCall('search_graph', { name_pattern: ... })`
- [ ] 設計 graceful fallback 機制（CBM 不存在 → 用本地 CKG）

### 4.2 實作 CKG 相容層
- [ ] 建立 `src/plugins/cbm/cbm-ckg-bridge.mjs`
  - [ ] 包裝 `codeQuery()` 兼容介面
  - [ ] 自動偵測 CBM 是否可用
  - [ ] CBM 可用 → 呼叫 CBM；不可用 → fallback 到本地 CKG
- [ ] 在 `smart_code_query` handler 中整合 CBM bridge
- [ ] 測試所有 query 類型在 CBM backend 下的正確性

### 4.3 測試覆蓋
- [ ] 比對 CBM backend 與 CKG backend 的查詢結果
- [ ] 確認 callers/callees 結果一致
- [ ] 確認 symbol 查詢結果一致
- [ ] 確認 unused-exports 結果合理
- [ ] 確認 CBM 關閉時自動 fallback 正常

---

## Phase 5：CBM 工具最佳化（2 天）

### 5.1 Session Cache
- [ ] 在 `cbm-client.mjs` 中加入 Map-based session cache
  - [ ] 60 秒 TTL（可配置）
  - [ ] cache key: `${tool}:${JSON.stringify(args)}`
  - [ ] cache invalidation：專案重新索引時清除對應 cache
- [ ] 整合到 `src/lib/concurrency-gate.mjs` 的權重系統
  - [ ] CBM 工具權重設定（`cbm_query_graph` weight: 1, `cbm_index_repository` weight: 8）

### 5.2 Lazy Indexing
- [ ] 查詢前先 `cbm_list_projects` 確認專案是否已索引
- [ ] 未索引時背景觸發 `index_repository`（不 blocking 查詢）
- [ ] 背景索引期間用 Smart 既有工具提供 fallback
- [ ] 索引完成後自動重導 query 到 CBM

### 5.3 Token 優化
- [ ] 實作 CBM 結果壓縮層
  - [ ] `compressCbmResults(data, 'minimal')` — 只保留 name/file/line
  - [ ] `compressCbmResults(data, 'standard')` — 完整回傳（預設）
  - [ ] `compressCbmResults(data, 'full')` — 原始 JSON（用於 debug）
- [ ] 整合到 context budget 系統（大結果自動壓縮）

### 5.4 Graph UI 整合（可選）
- [ ] 啟動 CBM UI：`codebase-memory-mcp --ui=true --port=9749`
- [ ] 建立 `docs/cbm-graph-ui.md` 說明文件
- [ ] 在 `smart_context` 中加入 UI 啟動/狀態查詢

---

## 驗收（1 天）

### 功能驗收
- [ ] `opencode.json` 同時啟用 Smart + CBM 兩個 MCP server
- [ ] `skill("cbm-bridge")` 可正確載入路由規則
- [ ] `hybrid_router` 在關鍵字觸發時路由到 CBM 工具
- [ ] CBM 工具查詢結果可被 Smart 工作流正確消費
- [ ] CBM 未安裝時自動 fallback 到 Smart 原有工具
- [ ] 所有既有工作流不受影響

### 效能驗收
- [ ] 大型專案索引時間（CBM vs Smart CKG）
- [ ] 程式碼查詢 token 消耗（CBM vs grep/read）
- [ ] CBM 查詢 latency（p50/p95/p99）

### 相容性驗收
- [ ] `npm test` 全部通過
- [ ] 所有 Phase 1-3 的測試案例通過
- [ ] README.md 已更新

---

## 時間線

| Phase | 內容 | 時間 | 狀態 |
|-------|------|------|------|
| Phase 1 | 安裝與註冊 | 0.5 天 | ⏳ 待開始 |
| Phase 2 | CBM Bridge Skill | 2 天 | ⏳ 待開始 |
| Phase 3 | hybrid_router 擴充 | 2 天 | ⏳ 待開始 |
| Phase 4 | CKG 後端取代（可選） | 1-2 週 | ⏸️ 可選 |
| Phase 5 | CBM 工具最佳化 | 2 天 | ⏳ 待 Phase 3 |
| 驗收 | 整合測試 | 1 天 | ⏳ 待 Phase 3 |
| **總計（最小）** | Phase 1-3 + 驗收 | **5.5 天** | |
| **總計（含 CKG 取代）** | Phase 1-5 + 驗收 | **2-3 週** | |
