# 跨 Session 記憶強化 — 待辦事項

> 最後更新：2026-06-15
> 對應計畫：[docs/mem_plan.md](./mem_plan.md)
> 總估時：5h

---

## Phase 1：啟動注入強化（1h）

### P1.1 — autoInjectMemory 改為 SQLite

| 項目 | 說明 |
|:---|:---|
| **目標** | 改讀 SQLite MemoryDB，用專案名 BM25 搜尋取代 JSON 隨機 top 3 |
| **檔案** | `src/server/index.mjs` |
| **估時** | 0.5h |

- [ ] P1.1.1 spawn CLI `memory-store.mjs search <projectName> --db --format json --limit 3`
- [ ] P1.1.2 SQLite 不存在時 fallback 到 JSON
- [ ] P1.1.3 結果過濾：只取有 files_changed 包含 projectName 或有 category 匹配的

### P1.2 — 輕提示取代 findings

| 項目 | 說明 |
|:---|:---|
| **目標** | 只注入 `<100 tokens` 的統計提示，不強塞具體記憶 |
| **檔案** | `src/server/index.mjs` |
| **估時** | 0.5h |

- [ ] P1.2.1 計算專案記憶總數 + 最近 checkpoint（如有）
- [ ] P1.2.2 注入格式：`📋 此專案有 N 筆跨 session 記憶（上次工作：HH:mm）`
- [ ] P1.2.3 無記憶時不注入任何 finding

---

## Phase 2：工具級上下文記憶搜尋（2h）

### P2.1 — 擴展 pre-check 工具集

| 項目 | 說明 |
|:---|:---|
| **目標** | 加入 fast_apply、think、refactor_plan 到記憶搜尋工具集 |
| **檔案** | `src/server/index.mjs` |
| **估時** | 0.5h |

- [ ] P2.1.1 PRECHECK_TOOLS 加入 `smart_fast_apply`、`smart_think`、`smart_refactor_plan`
- [ ] P2.1.2 原 blocking pre-check 保留給 debug/test/cross_file_edit
- [ ] P2.1.3 新增工具走非同步 contextual search（不 block）

### P2.2 — 非同步 contextual search

| 項目 | 說明 |
|:---|:---|
| **目標** | 工具執行時萃取 args 作為 query，BM25 搜尋記憶，非同步注入 findings |
| **檔案** | `src/server/index.mjs` |
| **估時** | 1.5h |

- [ ] P2.2.1 實作 `contextualMemorySearch(toolName, args)` 函式
- [ ] P2.2.2 從 args 萃取搜尋 query：`file`、`symbol`、`error`、`pattern`、`query` 等欄位
- [ ] P2.2.3 query 長度 < 5 chars 跳過
- [ ] P2.2.4 spawn CLI `memory-store.mjs search <query> --db --format json --limit 3`
- [ ] P2.2.5 BM25 分數 < 0.3 跳過（不注入不相關的）
- [ ] P2.2.6 命中時 inject findings（非同步，不 block 工具回傳）
- [ ] P2.2.7 在 invokeTool 中同步 pre-check 之後、執行工具之前呼叫（對新工具不 block）
- [ ] P2.2.8 統計：contextualSearchCount / contextualSearchHitCount

---

## Phase 3：Session Checkpoint（1h）

### P3.1 — 結束時存 checkpoint

| 項目 | 說明 |
|:---|:---|
| **目標** | gracefulShutdown 時存 session 摘要到 memory |
| **檔案** | `src/server/index.mjs` |
| **估時** | 0.5h |

- [ ] P3.1.1 實作 `saveSessionCheckpoint()` 函式
- [ ] P3.1.2 從 contextManager.getFindings() 取 top findings 摘要
- [ ] P3.1.3 從 toolHistory 取 files_changed（去重）
- [ ] P3.1.4 spawn CLI store checkpoint entry：`--type checkpoint --category <projectName>`
- [ ] P3.1.5 TTL 7 天（`--ttl 7d`）
- [ ] P3.1.6 gracefulShutdown 中呼叫（fire-and-forget，不延遲 shutdown）

### P3.2 — 啟動時提示 checkpoint

| 項目 | 說明 |
|:---|:---|
| **目標** | 啟動時提示上次工作時間（整合到 P1.2 輕提示） |
| **檔案** | `src/server/index.mjs` |
| **估時** | 0.5h |

- [ ] P3.2.1 啟動搜尋最近 checkpoint（`search <projectName> checkpoint --db --limit 1`）
- [ ] P3.2.2 整合到輕提示：「上次工作：昨天 17:30」

---

## Phase 4：Personality 引導（1h）

### P4.1 — 更新 system-prompt

| 項目 | 說明 |
|:---|:---|
| **目標** | 教 Agent 何時該主動查記憶、何時不該查 |
| **檔案** | `src/agent/system-prompt.mjs` |
| **估時** | 1h |

- [ ] P4.1.1 加入三種使用時機：開始新 task、編輯舊檔案、遇到錯誤
- [ ] P4.1.2 提示 contextual search 已自動執行（check findings）
- [ ] P4.1.3 提示可用 checkpoint 瀏覽上次工作狀態
- [ ] P4.1.4 提示哪些情況不需要查記憶（簡單查詢、全新 feature 無相關檔案）

---

## 進度追蹤

| Phase | 項目 | 狀態 | 開始 | 完成 | 測試 |
|:---|:---|:---|:---|:---|:---|
| P1.1 | autoInject → SQLite | ⬜ | - | - | - |
| P1.2 | 輕提示取代 findings | ⬜ | - | - | - |
| P2.1 | 擴展 pre-check 工具集 | ⬜ | - | - | - |
| P2.2 | 非同步 contextual search | ⬜ | - | - | - |
| P3.1 | 結束時存 checkpoint | ⬜ | - | - | - |
| P3.2 | 啟動時提示 checkpoint | ⬜ | - | - | - |
| P4.1 | 更新 system-prompt | ⬜ | - | - | - |

---

## 相關文件

- [docs/mem_plan.md](./mem_plan.md) — 跨 Session 記憶強化計畫
- [docs/plan.md](./plan.md) — Smart MCP 整體發展藍圖
