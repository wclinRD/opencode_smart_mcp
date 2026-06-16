# Boulder System — 實作 TODO

## Phase 1 — Storage Schema（memory-db.mjs）

### 1.1 新增 Boulder 表格 schema
- [ ] `boulder_plans` table（id, name, description, status, agent_id, total_tasks, completed_tasks, current_task_id, started_at, updated_at, completed_at, plan_data, metadata）
- [ ] `boulder_tasks` table（id, plan_id, name, description, status, sort_order, started_at, completed_at, elapsed_ms, result, error, metadata）
- [ ] `boulder_checkpoints` table（id, plan_id, session_id, context_summary, task_id, files_changed, decisions, next_intent, token_usage, created_at）
- [ ] Indexes: boulder_plans(status), boulder_plans(updated_at), boulder_tasks(plan), boulder_tasks(status), boulder_checkpoints(plan), boulder_checkpoints(session)

### 1.2 MemoryDB CRUD — Plans
- [ ] `createPlan(name, description, tasks[])` → 回傳 plan + 自動建立 tasks
- [ ] `getPlan(id)` → 回完整 plan + tasks count
- [ ] `updatePlan(id, updates)` → status / name / completed_tasks / current_task_id
- [ ] `listPlans(status?)` → 按 updated_at DESC
- [ ] `deletePlan(id)` → CASCADE 刪除 tasks + checkpoints

### 1.3 MemoryDB CRUD — Tasks
- [ ] `addTasks(planId, tasks[])` → 批次加入
- [ ] `getTask(id)` → 回 task + plan name
- [ ] `updateTask(id, updates)` → status / result / elapsed_ms / error
- [ ] `listTasks(planId, status?)` → 按 sort_order ASC

### 1.4 MemoryDB CRUD — Checkpoints
- [ ] `saveCheckpoint(planId, data)` → 自動 timestamp
- [ ] `getLatestCheckpoint(planId)` → 最新一筆
- [ ] `listCheckpoints(planId, limit=10)` → 按時間 DESC

### 1.5 MemoryDB — Continuation
- [ ] `getContinuationContext(planId)` → 組裝 { plan, currentTask, checkpoint, progress }
- [ ] `getActivePlan()` → 找 status='active' 的最新 plan
- [ ] `completePlan(id)` → 更新 status + completed_at

### 1.6 Migration
- [ ] 在 `memory-db.mjs` 的 `open()` 加入 Boulder schema exec
- [ ] 加入 try/catch 相容舊 schema

---

## Phase 2 — CLI Tool

### 2.1 工具框架
- [ ] 建立 `src/cli/boulder.mjs`
- [ ] `main()` 解析 argv，支援 `plan|task|checkpoint|status|resume` subcommands
- [ ] `getMemoryDB()` 取得 db 連線
- [ ] `--help` / `--json` flag

### 2.2 `boulder plan` subcommands
- [ ] `plan create <name> [--desc] [--tasks "t1,t2,t3"]` — 建立計畫
- [ ] `plan list [--status]` — 列表
- [ ] `plan show <id|name>` — 詳細 + tasks
- [ ] `plan update <id> [--name] [--status]` — 更新

### 2.3 `boulder task` subcommands
- [ ] `task list <planId>` — 列表含狀態
- [ ] `task update <taskId> [--status] [--result]` — 更新進度

### 2.4 `boulder checkpoint`
- [ ] `checkpoint <planId> [--context] [--task] [--files] [--decisions] [--next]` — 存 checkpoint

### 2.5 `boulder status`
- [ ] `status [--plan <id>]` — 格式化輸出當前進度
- [ ] 顯示：計畫名、進度條、當前 task、經過時間、最新 checkpoint

### 2.6 `boulder resume`
- [ ] `resume <planId>` — 輸出續命 directive 格式
- [ ] 格式：`[SYSTEM DIRECTIVE - BOULDER CONTINUATION]` + plan 資訊 + next intent

---

## Phase 3 — Agent Integration

### 3.1 system-prompt-base.mjs 注入 Boulder 一行
- [x] 在 `SYSTEM_PROMPT_BASE` 加入 Boulder 註解區塊
- [x] 實作條件注入邏輯：`buildSystemPrompt()` 僅有 active plan 時才附加 Boulder line
- [x] 注入內容（約 20 tokens）：`[Boulder] Active plan: "{{name}}" ({{done}}/{{total}}).\n續命...`
- [x] 測試：buildSystemPrompt 回傳 { prompt, boulderContext }，有/無 active plan 正確

### 3.2 memory-integration-base.mjs 新增 Boulder 規則
- [x] 在 `MEMORY_RULES` 加入 `boulder-checkpoint` 規則（task update → completed 時自動存）
- [x] 在 `MEMORY_RULES` 加入 `boulder-session-end` 規則（session 結束時保留狀態）
- [x] 測試：MEMORY_RULES 陣列包含 boulder-checkpoint + boulder-session-end 規則

### 3.3 memory-integration 新增 getBoulderContext()
- [x] 新增 `getBoulderContext()` — 查 active plan + 回傳 { hasActivePlan, goal, progress, currentTask, nextIntent }
- [x] 匯出供 agent 啟動流程使用（透過 index.mjs + memory-integration.mjs）

### 3.4 core_memory 自動同步
- [x] 新增 `getBoulderSyncCommands()` — 有 active plan 時回傳 core_memory_update payload 陣列
- [x] 無 active plan → 回傳空陣列，不影響正常啟動
- [x] 匯出供外部消費端使用（透過 index.mjs）
- [x] 測試：getBoulderSyncCommands 回傳 [{ block, operation, content }, ...] 格式正確

### 3.5 完整續命流程整合測試
- [x] 測試：建立 plan → 完成 2 task → 模擬中斷 → getContinuationContext 正確組裝進度
- [x] 測試：getActivePlan 找到 active plan，無 active plan 時回傳 null
- [x] 測試：deletePlan CASCADE 刪除關聯 tasks + checkpoints
- [x] 測試：19 項整合測試全部通過（node --test tests/boulder-integration.test.mjs）

---

## Phase 4 — Workflow Integration

### 4.1 planner 整合
- [x] 新增 `createBoulderPlan(goal, steps)` — 從 goal + steps 建立 plan + tasks
- [x] 新增 `completeBoulderTask(taskId, options)` — 完成 task + 自動存 checkpoint

### 4.2 auto-checkpoint
- [x] `completeBoulderTask` 內建 auto-checkpoint（files_changed + decisions）
- [x] 記錄 files_changed + decisions + next_intent

### 4.3 續命流程測試
- [x] 測試：建立 plan → 完成 2 task → 模擬中斷 → resume → 確認正確
- [x] 測試：跨 session 續命（6 步驟完整流程）

---

## Phase 4+ — Advanced（選擇性）

### 4.4 session-recovery hook
- [ ] 偵測 dangling tool calls
- [ ] 注入 synthetic error tool_result
- [ ] 解鎖 provider

### 4.5 Multi-work
- [ ] 一個 plan 可以有多個 work 並行
- [ ] 各自有 timer + 狀態

### 4.6 stop-continuation
- [ ] `/stop-continuation` 命令
- [ ] 標記 plan 為 paused
- [ ] 在 paused 狀態不注入 continuation directive

---

## 里程碑

| 里程碑 | 內容 | 預計行數 |
|--------|------|---------|
| **M1** | Phase 1 schema + CRUD 完成 | ~250 |
| **M2** | Phase 2 CLI tool 可用 | ~350 |
| **M3** | Phase 3 agent injection + 初步續命 | ~70 |
| **M4** | Phase 4 planner 整合 + 自動化 | ~100 |
| **M5** | Phase 4+ session-recovery（選擇性） | ~200 |

**M1-M3 核心路徑**：約 670 行，可在一輪實作內完成
