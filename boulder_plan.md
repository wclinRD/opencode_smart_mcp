# Boulder System — Smart MCP 狀態持久化計畫

## 為什麼需要 Boulder

目前 Smart MCP Agent 的狀態依存於 LLM context window（易失記憶體）：
- Ctrl+C 關閉 → context 清空 → 回來只能說「繼續」
- compaction 壓縮 → 中間狀態遺失
- 跨 session 不連貫 → 重複工作

Boulder = **檔案系統上的持久化狀態層**，獨立於 session 存在。

## 設計原則

1. **輕量** — 不引入新依賴（已有 `better-sqlite3` + `memory-db.mjs`）
2. **漸進** — 先核心功能（存/讀/續命），再進階（多 task、timer、recovery）
3. **與現有架構整合** — 不是取代 `memory-db`，而是延伸
4. **Smart MCP 風格** — CLI tool + agent hooks + system prompt directive

---

## 架構總覽

```
┌─────────────────────────────────────────┐
│  Agent Layer (system prompt 注入)        │
│  - Boulder continuation directive         │
│  - session.idle 偵測（future）           │
├─────────────────────────────────────────┤
│  CLI Layer (boulder.mjs)                │
│  - boulder plan/checkpoint/status/resume │
├─────────────────────────────────────────┤
│  Storage Layer (memory-db.mjs 延伸)     │
│  - boulder_plans table                  │
│  - boulder_checkpoints table            │
│  - boulder_tasks table                  │
└─────────────────────────────────────────┘
```

---

## Phase 1 — Storage Schema（memory-db.mjs 延伸）

### 新增表格

#### boulder_plans

```sql
CREATE TABLE IF NOT EXISTS boulder_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',       -- active | paused | completed | cancelled
  agent_id TEXT,                       -- which agent owns this
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  current_task_id TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  plan_data TEXT,                      -- JSON: full plan content
  metadata TEXT                        -- JSON: flexible extras
);

CREATE INDEX IF NOT EXISTS idx_boulder_plans_status ON boulder_plans(status);
CREATE INDEX IF NOT EXISTS idx_boulder_plans_updated ON boulder_plans(updated_at);
```

#### boulder_tasks

```sql
CREATE TABLE IF NOT EXISTS boulder_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',       -- pending | in_progress | completed | skipped | failed
  sort_order INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  elapsed_ms INTEGER,
  result TEXT,                         -- summary of what was done
  error TEXT,                          -- if failed
  metadata TEXT,                       -- JSON
  FOREIGN KEY (plan_id) REFERENCES boulder_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boulder_tasks_plan ON boulder_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_boulder_tasks_status ON boulder_tasks(status);
```

#### boulder_checkpoints

```sql
CREATE TABLE IF NOT EXISTS boulder_checkpoints (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  session_id TEXT,                     -- OpenCode session ID
  context_summary TEXT,                -- what was happening
  task_id TEXT,                        -- active task at checkpoint
  files_changed TEXT,                  -- JSON array of touched files
  decisions TEXT,                      -- key decisions made
  next_intent TEXT,                    -- what to do next
  token_usage INTEGER,                 -- approximate
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES boulder_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boulder_checkpoints_plan ON boulder_checkpoints(plan_id);
CREATE INDEX IF NOT EXISTS idx_boulder_checkpoints_session ON boulder_checkpoints(session_id);
```

### MemoryDB 新增方法

```javascript
// ── Boulder Plans ──
createPlan(name, description, tasks[])
getPlan(id)
updatePlan(id, updates)
listPlans(status?)
deletePlan(id)

// ── Boulder Tasks ──
addTasks(planId, tasks[])
getTask(id)
updateTask(id, updates)
listTasks(planId, status?)

// ── Boulder Checkpoints ──
saveCheckpoint(planId, { sessionId, contextSummary, taskId, filesChanged, decisions, nextIntent })
getLatestCheckpoint(planId)
listCheckpoints(planId, limit?)

// ── Continuation ──
getContinuationContext(planId)
  → 回傳 { plan, currentTask, checkpoint, progress }
  → 給 system prompt 注入用
```

**實作位置**：`src/lib/memory-db.mjs` 新增 `// ── Boulder ──` 區塊（約 200 行）

---

## Phase 2 — CLI Tool（src/cli/boulder.mjs）

### 命令結構

```
boulder plan create <name> [--desc "..."] [--tasks "t1,t2,t3"]
boulder plan list [--status active|completed]
boulder plan show <id|name>
boulder plan update <id> [--name "..."] [--status completed|cancelled]

boulder task list <planId>
boulder task update <taskId> [--status in_progress|completed|skipped] [--result "..."]

boulder checkpoint <planId> [--context "..."] [--task <id>] [--files "..."] [--decisions "..."] [--next "..."]
boulder status [--plan <id>]         ← 顯示當前進度摘要（類似 omo `oh-my-opencode boulder`）
boulder resume <planId>              ← 輸出續命 directive（給 LLM 用）
```

### 實作細節

- 獨立 `src/cli/boulder.mjs`（~300 行）
- 用 `getMemoryDB()` 取得 db 實例
- `boulder status` → 格式化表格：計畫名、進度、當前 task、經過時間
- `boulder resume` → 輸出 `[SYSTEM DIRECTIVE - BOULDER CONTINUATION]` 格式

---

## Phase 3 — Agent Integration（~100 行新增）

### 核心原則：Agent 知道但不用管

```
底層（自動，Agent 無感）：
  ✅ session 啟動時自動查 active plan
  ✅ 自動寫入 core_memory.goal/progress
  ✅ task 完成時自動存 checkpoint
  ✅ 中斷時自動恢復 context

上層（Agent 可選用）：
  ✅ system prompt 一行提示（~20 tokens）
  ✅ Agent 可呼叫 boulder status 看進度
  ✅ Agent 可主動 task update（但非必要）
```

### 3.1 system-prompt-base.mjs 加入一行

**檔案**：`src/agent/core/system-prompt-base.mjs`

在現有 `## Smart MCP — Tool Routing (40+ tools)` 區塊前（或 `### Memory` 區塊後），加入：

```javascript
// ── Boulder (狀態持久化) ──
// (Boulder 是基礎設施，Agent 無需管理)
// 啟動時若有 active plan，自動注入此行：
// ${BOULDER_LINE}
```

實際注入的字串（~20 tokens）：

```
[Boulder] Active plan: "{{name}}" ({{done}}/{{total}}).
續命：自動從上次進度恢復。需要進度查詢可用 boulder status。
```

**注入時機**：`getContinuationContext()` 回傳有 active plan 時，在 `SYSTEM_PROMPT_BASE` 尾部附加這行。

### 3.2 memory-integration-base.mjs 新增 Boulder 規則

**檔案**：`src/agent/core/memory-integration-base.mjs`

在 `MEMORY_RULES` 陣列中新增 2 條規則：

```javascript
// Task completed → auto-checkpoint
{
  test: (toolName, args, result) =>
    toolName === 'boulder_task_update' &&
    args.status === 'completed',
  type: 'boulder-checkpoint',
  score: 0.6,
  reason: 'Task completed: save checkpoint for continuation',
},
// Session ending with active plan → remember state
{
  test: (toolName, args, result) =>
    toolName === 'smart_session_end' ||
    (toolName === 'smart_context' && args.command === 'reset'),
  type: 'boulder-session-end',
  score: 0.7,
  reason: 'Session ending with active plan: preserve state for resume',
},
```

### 3.3 memory-integration 新增 getBoulderContext()

**檔案**：`src/agent/memory-integration.mjs` 或 `src/agent/core/memory-integration-base.mjs`

```javascript
/**
 * 查詢 active Boulder plan，自動更新 core_memory.
 * Agent 完全不需要知道 Boulder 存在。
 */
export function getBoulderContext() {
  const db = getMemoryDB();
  const plan = db.getActivePlan();
  if (!plan) return null;

  const continuation = db.getContinuationContext(plan.id);

  // 自動同步到 core_memory（Agent 看到的介面）
  return {
    hasActivePlan: true,
    goal: plan.name,                    // → core_memory.goal
    progress: `${plan.completed_tasks}/${plan.total_tasks} tasks`,
    currentTask: continuation.currentTask?.name,
    nextIntent: continuation.checkpoint?.next_intent,
  };
}
```

### 3.4 core_memory 自動同步

在 agent 啟動流程中加入：

```
session 啟動 →
  1. getBoulderContext()
  2. 有 active plan →
     core_memory_update({block:"goal", operation:"replace", content:plan.name})
     core_memory_update({block:"progress", operation:"replace", content:"{done}/{total} tasks"})
  3. 無 active plan → 維持原狀
```

### 3.5 續命流程（完整）

```
session 啟動 →
  1. getMemoryDB().getActivePlan()
  2. 無 → 正常啟動（無 Boulder）
  3. 有 →
     a. system-prompt 附加一行 [Boulder] 提示
     b. core_memory 設為 plan 狀態
     c. 任務繼續進行

task 完成時 →
  1. Agent 叫 boulder task update --status completed
  2. (或未來自動化時 MCP Server 自動偵測)
  3. memory-integration 自動存 checkpoint
  4. core_memory.progress 更新
```

---

## Phase 4 — Advanced Recovery（未來）

### session-recovery hook（類似 omo #4106）

```
session 被中斷（Ctrl+C / timeout） →
  偵測 dangling tool calls →
  注入 synthetic tool_result →
  解鎖 provider →
  正常續命
```

### auto-checkpoint

```
每個 task 完成時自動存 checkpoint →
  紀錄 files_changed + decisions + next_intent
```

---

## 與 omo Boulder 的差異

| 功能 | omo Boulder | Smart MCP Boulder (Phase 1-3) | 後續 |
|------|------------|-------------------------------|------|
| 儲存引擎 | JSON 檔案（.sisyphus/boulder/） | SQLite（memory-db.mjs） | SQLite 更強 |
| Atomic write | temp-rename + file lock | SQLite WAL（內建） | ✅ 不用自己寫 |
| Task tracking | checkbox 掃描 + task_sessions | 專屬 boulder_tasks 表 | ✅ 更精確 |
| Agent 記錄 | boulder.json agent 欄位 | boulder_plans.agent_id | ✅ 同等 |
| Timer | per-task elapsed_ms | per-task elapsed_ms | ✅ 同等 |
| Multi-work | works map | future: plan.covers | 可加 |
| Auto-continuation | session.idle 事件驅動 | Phase 3 agent 注入 | 基本版 |
| Tool recovery | synthetic error injection | Phase 4 | 可加 |
| stop-continuation guard | 狀態 flag | Phase 3 | 可加 |

---

## 檔案變更清單

| 檔案 | 變更 | 行數估計 |
|------|------|---------|
| `src/lib/memory-db.mjs` | 新增 Boulder schema + methods | +250 |
| `src/cli/boulder.mjs` | 全新 CLI 工具 | +350 |
| `src/agent/core/system-prompt-base.mjs` | 附加一行 [Boulder] 提示（~20 tokens）| +5 |
| `src/agent/core/memory-integration-base.mjs` | 新增 2 條 MEMORY_RULES + getBoulderContext() | +60 |

**核心路徑 M1-M3 總計**：約 665 行新增

### 實作優先順序

```
M1 (storage schema + CRUD)     → 250 行  ← 起點，無相依
  ↓
M2 (CLI tool)                  → 350 行  ← 相依 M1
  ↓
M3 (agent integration)         → 65 行   ← 相依 M1
  ↓
M4 (planner 整合 + 測試)        → 100 行  ← 相依 M2+M3
```
