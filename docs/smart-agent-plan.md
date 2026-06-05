# Smart Agent — 整合規劃

> 本文件定義 smart-agent 的戰略目標、架構設計、和實作路線。
> smart-agent = opencode agent 的大腦配置層，讓 agent 能更聰明地使用 smart-mcp tools。
>
> **當前狀態**: 兩層架構已實作完成。強模型 → `config/agents/smart-mcp.md` 人格定義（220 行）。弱模型 → 3 個 JS MCP tools (`smart_agent_recommend/execute/plan`) 兜底。

---

## 一、願景

```
npm install smart-agent
↓
自動完成：
1. smart-mcp server 安裝
2. opencode agent 配置（大腦）
3. 專案慣例學習設定
4. 記憶系統初始化
↓
agent 立即具備：
- 知道何時用哪個 tool
- 知道如何 chain tools 成 workflow
- 知道如何從錯誤中學習
- 跨 session 記住專案 context
```

**核心價值**：讓 opencode agent 從「有很多工具」升級到「知道怎麼用對的工具」。

---

## 二、現狀分析

### 2.1 Smart MCP 現有資產

| 資產 | 數量 | 可複用性 |
|------|------|---------|
| MCP tools | 39 個（6 core + 33 standard） | ✅ 直接使用 |
| ContextManager | 1 個 | ✅ session/工具追蹤 |
| Memory Store | 1 個 | ✅ fuzzy match 經驗 |
| Workflow Engine | Phase 5 完成 | ✅ 已啟用 dispatch |
| Planner | Phase 2 完成 | ✅ 已整合進 agent 策略 |
| Agent Personality | config/agents/smart-mcp.md 220 行 | ✅ 已上線 |
| Agent MCP Tools | 3 個 (recommend/execute/plan) | ✅ handler-based 無等待 |

### 2.2 現有缺口（agent 角度）

| 缺口 | 影響 |
|------|------|
| **無 tool 選擇策略** | agent 需要自己推敲用哪個 tool，token 浪費在試錯 |
| **無 workflow 自動化** | 複雜任務需要 agent 手動 chain tools |
| **無專案記憶** | 每個 session 從零開始 |
| **無錯誤學習** | 同樣錯誤會重複發生 |
| **無 planner 整合** | agent 自己規劃，不利用 Phase 2 的 planner |

### 2.3 Smart Agent 定位

```
┌──────────────────────────────────────────────────────────────────┐
│                       opencode host                              │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Smart Agent（兩層架構）                        │  │
│  │                                                             │  │
│  │  ┌──── Layer 1：強模型自主推理（system prompt） ────────┐  │  │
│  │  │  config/agents/smart-mcp.md                          │  │  │
│  │  │  ├── 220 行完整人格定義                              │  │  │
│  │  │  ├── 33+ 工具策略表（任務→工具對照）                  │  │  │
│  │  │  ├── 工具鏈模板（除錯/重構/安全/探索/Git/研究）        │  │  │
│  │  │  ├── Workflow 自動化（6 模板）                        │  │  │
│  │  │  ├── Pipeline 組合（seq/par/cond）                    │  │  │
│  │  │  ├── 記憶/Context/規劃整合                            │  │  │
│  │  │  └── 小模型兜底策略                                   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  ┌──── Layer 2：小模型 JS 兜底（MCP tools） ───────────┐  │  │
│  │  │  src/plugins/standard/                                │  │  │
│  │  │  ├── agent-recommend.mjs → smart_agent_recommend     │  │  │
│  │  │  ├── agent-execute.mjs   → smart_agent_execute       │  │  │
│  │  │  └── agent-plan.mjs      → smart_agent_plan          │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         │                                         │
│                         ▼                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │               Smart MCP Server                             │  │
│  │  ├── 39 tools（6 core + 33 standard + 3 agent）           │  │
│  │  ├── ContextManager（session 追蹤）                       │  │
│  │  ├── Memory Store（經驗庫）                               │  │
│  │  └── Workflow Engine（dispatch 引擎）                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、架構設計

### 3.1 Package 結構

```
smart-agent/
├── package.json              # npm entry，peer: smart-mcp
├── README.md
│
├── src/
│   ├── agent/
│   │   ├── system-prompt.mjs      # Agent system prompt 片段
│   │   ├── tool-strategy.mjs      # Tool 選擇策略引擎
│   │   ├── workflow-strategy.mjs  # Workflow 執行策略
│   │   ├── memory-integration.mjs # Memory 自動學習整合
│   │   └── planner-integration.mjs # Planner 整合
│   │
│   ├── config/
│   │   ├── opencode.json          # opencode MCP 設定（模板）
│   │   └── .opencode-conventions.json  # 預設慣例
│   │
│   ├── install/
│   │   ├── postinstall.mjs        # 安裝後腳本
│   │   ├── detect-project.mjs     # 專案類型偵測
│   │   └── generate-config.mjs     # 產生 local config
│   │
│   └── index.mjs                  # 主入口（提供給 smart-mcp 呼叫）
│
├── smart-mcp/                 # smart-mcp 原始碼（submodule 或拷貝）
│   └── ...
│
└── tests/
    ├── agent.test.mjs
    ├── install.test.mjs
    └── strategy.test.mjs
```

### 3.2 核心模組職責

#### System Prompt 片段（`system-prompt.mjs`）

提供給 opencode agent 的 system prompt 增強片段：

```javascript
// 片段內容（會被插入到 opencode system prompt）
const SYSTEM_PROMPT_FRAGMENT = `
## Smart MCP Tools 使用策略

### Tool 選擇原則
- 搜尋程式碼 → smart_grep（比 grep 更語意感知）
- 理解新專案 → smart_learn（一次取得架構/依賴/慣例）
- 複雜推理 → smart_think（快速 hypothesis→verify）
- 深度分析 → smart_thinking（9 模板 + 動態多輪）
- 安全掃描 → smart_security（credentials/injection/deps）
- 執行測試 → smart_test（自動偵測 framework）
- 除錯錯誤 → smart_error_diagnose（對照 pattern KB）
- 跨檔案重構 → smart_cross_file_edit（import graph 感知）

### Workflow 自動化
- 遇到複雜任務（5+ 步驟）→ 使用 smart_workflow_create 建立 plan
- 執行 workflow → smart_workflow_execute（自動 dispatch 步驟）
- 失敗時 → smart_workflow_replan（自動重新規劃）
- 完成後 → smart_workflow_summary（產出報告）

### Memory 整合
- 錯誤發生時 → smart_error_diagnose 自動搜尋記憶庫
- 修復成功 → 自動存入 memory-store
- 相似錯誤 → 自動取出過往修復經驗

### Planner 整合
- 遇到不確定的複雜任務 → smart_planner 分解目標
- planner 輸出 DAG → workflow engine 執行
`;

export { SYSTEM_PROMPT_FRAGMENT };
```

#### Tool 策略引擎（`tool-strategy.mjs`）

根據任務描述，自動推薦合適的 tool 或 tool 組合：

```javascript
// 介面
export function recommendTools(goal, context) {
  // 輸入：目標描述 + 當前 context
  // 輸出：推薦的 tool 序列 + 理由
}

// 內建策略
const STRATEGIES = {
  'debug-error': ['smart_grep', 'smart_error_diagnose', 'smart_cross_file_edit', 'smart_test'],
  'refactor': ['smart_learn', 'smart_import_graph', 'smart_rename_safety', 'smart_cross_file_edit', 'smart_test'],
  'security-audit': ['smart_security', 'smart_grep', 'smart_thinking'],
  'understand-codebase': ['smart_learn', 'smart_grep', 'smart_import_graph'],
  // ...
};
```

#### Workflow 策略（`workflow-strategy.mjs`）

整合 Phase 5 workflow dispatch，自動執行多步驟任務：

```javascript
export async function executeWorkflow(goal, options) {
  // 1. smart_workflow_create → 建立 plan
  // 2. 迴圈：smart_workflow_execute → 執行下一步
  // 3. 失敗：smart_workflow_replan → 重新規劃
  // 4. 完成：smart_workflow_summary → 產出報告
}
```

#### Memory 整合（`memory-integration.mjs`）

自動將錯誤經驗寫入記憶庫，並在合適時機取出：

```javascript
export function shouldRemember(result) {
  // 判斷是否值得存入記憶
}

export function queryMemory(error, context) {
  // 查詢相似記憶
}
```

### 3.3 安裝流程

```
npm install smart-agent
    │
    ├── postinstall.mjs 觸發
    │   │
    │   ├── 1. 檢查 smart-mcp 是否已安裝
    │   │   ├── 是 → 取得路徑
    │   │   └── 否 → npm install smart-mcp
    │   │
    │   ├── 2. 偵測專案類型（detect-project.mjs）
    │   │   └── 輸出：{ language, framework, structure }
    │   │
    │   ├── 3. 產生 local opencode.json
    │   │   └── 指向 smart-mcp server 路徑
    │   │
    │   ├── 4. 執行 smart_learn 學習專案慣例
    │   │   └── 寫入 .opencode-conventions.json
    │   │
    │   └── 5. 初始化 memory store 目錄
    │       └── ~/.smart/memory/
    │
    └── 安裝完成，agent 已就緒
```

### 3.4 與 Smart MCP 的互動（兩層架構）

#### 強模型路徑（system prompt 驅動）

```
opencode host                     Smart MCP
    │                                │
    │ 載入 config/agents/smart-mcp.md│
    │ 人格定義嵌入 system prompt     │
    │                                │
    │ 自主推理選擇工具               │
    │──── smart_grep ───────────────▶│ 直接呼叫
    │──── smart_think ──────────────▶│ 直接呼叫
    │──── smart_workflow ───────────▶│ 複雜任務
```

#### 弱模型路徑（JS 引擎兜底）

```
opencode host                    Smart MCP
    │                                │
    │── smart_agent_recommend ──────▶│ 工具推薦
    │◀─ { primary, alternatives } ──│
    │                                │
    │── smart_agent_execute ────────▶│ 自動執行
    │◀─ workflow commands ──────────│
    │                                │
    │── smart_agent_plan ───────────▶│ 目標分解
    │◀─ DAG plan ──────────────────│
```

---

## 四、實作階段

### Phase A：Package 骨架（P0）

**目標**：建立 smart-agent npm package 結構，獨立於 smart-mcp。

```
smart-agent/
├── package.json
├── src/
│   ├── agent/
│   │   ├── system-prompt.mjs
│   │   ├── tool-strategy.mjs
│   │   ├── workflow-strategy.mjs
│   │   ├── memory-integration.mjs
│   │   └── planner-integration.mjs
│   ├── config/
│   │   └── opencode.json
│   └── install/
│       ├── postinstall.mjs
│       ├── detect-project.mjs
│       └── generate-config.mjs
└── README.md
```

**產出**：
- `package.json`（name: `smart-agent`，peer: `smart-mcp`）
- 骨架程式碼（無實際邏輯）
- `postinstall.mjs`（只印出「安裝完成」）

**驗收**：
- `npm install ./smart-agent` 成功
- `npm ls smart-mcp` 顯示為 dependency

---

### Phase B：System Prompt 整合（P0）

**目標**：讓 opencode agent 能自動載入 smart-agent 的 system prompt 片段。

**做法**：
1. `system-prompt.mjs` 匯出 `SYSTEM_PROMPT_FRAGMENT`
2. opencode 的 system prompt 透過 `env` 或 config 注入這個片段
3. 或：smart-agent 提供一個「引導 prompt」，讓使用者在 opencode 中執行一次

```javascript
// smart-agent 提供一個初始化 prompt
const INIT_PROMPT = `
請在 opencode 的 system prompt 中加入以下內容，來啟用 smart-agent：

[paste SYSTEM_PROMPT_FRAGMENT here]
`;
```

**另一做法**（更乾淨）：
- 在 `opencode.json` 中透過 `env.SMART_SYSTEM_PROMPT` 注入
- smart-mcp server 啟動時讀取並提供給 opencode

**驗收**：
- agent 的 system prompt 包含 tool 選擇策略
- agent 能正確回答「這個任務應該用哪個 tool」

---

### Phase C：Tool 策略引擎（P1）

**目標**：根據任務描述，自動推薦合適的 tool 或 tool 組合。

**實作**：
```javascript
// tool-strategy.mjs
const TASK_PATTERNS = [
  { pattern: /debug|error|exception|failed/i, tools: ['smart_grep', 'smart_error_diagnose', 'smart_cross_file_edit', 'smart_test'] },
  { pattern: /refactor|rename|rename.*file/i, tools: ['smart_learn', 'smart_import_graph', 'smart_rename_safety', 'smart_cross_file_edit', 'smart_test'] },
  { pattern: /security|vulnerability|credential|password/i, tools: ['smart_security', 'smart_grep'] },
  { pattern: /understand|explore|analyze.*codebase/i, tools: ['smart_learn', 'smart_import_graph', 'smart_grep'] },
  { pattern: /test|coverage|uncovered/i, tools: ['smart_test', 'smart_coverage'] },
  // ...
];

export function recommendTools(goal, context = {}) {
  // 1. 匹配 task pattern
  // 2. 檢查 context（已在 workflow 中？失敗過的步驟？）
  // 3. 回傳 { primary, alternatives, reason }
}
```

**驗收**：
- `recommendTools("debug login error")` 回傳正確的 tool 序列
- 給出合理的理由說明

---

### Phase D：Workflow 自動化（P1）

**目標**：讓 agent 能一鍵啟動複雜任務的自動化執行。

**實作**：
```javascript
// workflow-strategy.mjs
export async function autoExecute(goal, options = {}) {
  // 1. 建立 workflow
  const createResult = await smart_workflow_create({ goal, template: 'auto' });
  const { workflowId } = JSON.parse(createResult);
  
  // 2. 執行直到完成
  let state;
  while (true) {
    const executeResult = await smart_workflow_execute({ workflowId });
    state = JSON.parse(executeResult);
    
    if (state.status === 'completed') break;
    if (state.status === 'failed' && !options.replan) break;
    
    if (state.status === 'failed') {
      await smart_workflow_replan({ workflowId, context: state.failureReason });
    }
  }
  
  // 3. 產出 summary
  return smart_workflow_summary({ workflowId });
}
```

**整合進 MCP**：
- 新增 `smart_agent_execute` tool：接收 goal → 全自動執行 workflow
- 或：在 `smart_workflow` 工具中新增 `auto` command

**驗收**：
- `smart_agent_execute({ goal: "debug login error" })` 全自動執行
- 失敗時自動 replan
- 完成後產出 summary

---

### Phase E：Memory 自動整合（P1）

**目標**：錯誤發生時自動寫入記憶，相似錯誤自動取出。

**實作**：
```javascript
// memory-integration.mjs

// 攔截 tool 結果，自動判斷是否值得記憶
export function shouldRemember(toolName, args, result) {
  if (!result.ok) {
    // 失敗的 error_diagnose 值得記憶
    if (toolName === 'smart_error_diagnose') return { type: 'resolution', score: 0.9 };
    // 失敗的 cross_file_edit 值得記憶
    if (toolName === 'smart_cross_file_edit') return { type: 'refactor', score: 0.7 };
  }
  
  if (result.ok && toolName === 'smart_cross_file_edit') {
    // 成功的重構值得記憶
    return { type: 'refactor-success', score: 0.8 };
  }
  
  return null;
}

// 查詢記憶時包裝
export async function queryWithMemory(error, context) {
  // 1. 先查 memory store
  const memoryResult = await smart_memory_store({ command: 'search', query: error });
  
  // 2. 有找到 → 回傳記憶 + 標記為「已驗證」
  // 3. 沒找到 → 正常執行 tool，事後自動存入
}
```

**整合進 MCP**：
- 在 `invokeTool` / `captureAndReturn` 中自動呼叫
- 或：新增 `smart_agent_remember` tool

**驗收**：
- 錯誤發生後自動存入 memory store
- 相似錯誤再次發生時自動取出建議

---

### Phase F：Planner 整合（P1）

**目標**：讓 agent 在複雜任務開始時自動使用 planner 分解目標。

**實作**：
```javascript
// planner-integration.mjs
export async function planAndExecute(goal) {
  // 1. 呼叫 planner 分解
  const planResult = await smart_planner({ goal });
  const plan = JSON.parse(planResult);
  
  // 2. 根據 plan 自動執行
  // （或回傳給 agent 確認後再執行）
  
  return {
    plan,
    estimatedSteps: plan.steps.length,
    parallelGroups: plan.parallelGroups,
    canExecute: true,
  };
}
```

**驗收**：
- `planAndExecute("找出並修復所有安全漏洞")` 回傳完整 plan
- plan 包含 DAG 和 parallel hints

---

### Phase G：安裝體驗優化（P2） 

**目標**：讓 `npm install smart-agent` 成為一鍵完成的神奇體驗。

> ⚡ **部分完成**（2026-06-04）：
> - `smart-agent/src/install/install-agent.mjs` 已完成 — 一鍵安裝腳本
> - 3 個 MCP tools 已註冊並可透過 MCP protocol 呼叫
> - `install-agent.mjs --dry-run` 可預覽安裝內容
> - `install-agent.mjs` 實際安裝：agent 定義 + config + memory 目錄
> - 13 項測試全部通過
>
> 尚待完成：npm package 發布流程（`npm publish smart-agent`）

**實作**（剩餘部分）：
```javascript
// postinstall.mjs
export async function postinstall() {
  // 1. 檢查並安裝 smart-mcp
  await ensureSmartMCP();
  
  // 2. 偵測專案類型
  const project = detectProject();
  
  // 3. 產生 opencode.json
  generateOpencodeConfig(smartMCPPPath, project);
  
  // 4. 執行初始 learning（可選，耗時）
  if (process.env.SMART_AGENT_INIT_LEARN) {
    await smart_learn({ root: process.cwd() });
  }
  
  // 5. 初始化 memory 目錄
  ensureMemoryDir();
  
  console.log(`
✅ Smart Agent 安裝完成！

接下來：
1. 重啟 opencode
2. 試試：smart_agent_execute({ goal: "debug login error" })
  `);
}
```

**驗收**：
- [x] `smart-agent/src/install/install-agent.mjs --dry-run` 預覽正確
- [x] `install-agent.mjs` 實際安裝成功
- [ ] `npm install smart-agent && npm ls` 顯示完整 dependency tree（npm publish 後）
- [ ] `npm install smart-agent` 後重啟 opencode 直接可用（npm publish 後）

---

### Phase H：文件與發布（P2）

**目標**：建立完整的文件，讓其他開發者能輕易使用。

**實作**：
1. `README.md` — 安裝指引 + 快速開始
2. `docs/ARCHITECTURE.md` — 架構說明
3. `docs/API.md` — API 介面文件
4. `CHANGELOG.md` — 版本變更記錄
5. `npm publish` 到 npm registry

**驗收**：
- `npm install smart-agent` 文件存在
- 別人安裝後能正常運作

---

## 五、版本規劃

| 版本 | 階段 | 功能 | 完成狀態 |
|------|------|------|---------|
| **0.1.0** | Phase A + B | Package 骨架 + System Prompt | ✅ 已完成 (config/agents/smart-mcp.md) |
| **0.2.0** | Phase C | Tool 策略引擎 | ✅ 已完成 (3 agent MCP tools) |
| **0.3.0** | Phase D | Workflow 自動化 | ✅ 已完成 (smart_workflow dispatch) |
| **0.4.0** | Phase E + F | Memory + Planner 整合 | ⏳ 進行中 |
| **1.0.0** | Phase G + H | 安裝體驗 + 發布 | ⏳ Phase G 部分完成，待 npm publish |

---

## 六、與 Smart MCP 的介面

### 6.1 依賴關係

```
smart-agent (npm package)
├── peer: smart-mcp (^3.2.0)
└── 程式依賴：
    ├── smart_mcp tools（透過 MCP protocol）
    ├── ContextManager（直接 import，如果在同一 repo）
    └── Memory Store（透過 MCP tool）
```

### 6.2 使用的 MCP Tools

| Tool | 用途 |
|------|------|
| `smart_workflow_create` | 建立 workflow |
| `smart_workflow_execute` | 執行步驟 |
| `smart_workflow_replan` | 失敗時重新規劃 |
| `smart_workflow_summary` | 產出報告 |
| `smart_planner` | 目標分解 |
| `smart_memory_store` | 經驗存取 |
| `smart_error_diagnose` | 錯誤診斷 |
| `smart_learn` | 專案學習 |
| `smart_context` | session 管理 |

### 6.3 新增的 MCP Tools（smart-agent 提供）

| Tool | Plugin 路徑 | 用途 | 狀態 |
|------|-------------|------|------|
| `smart_agent_recommend` | `src/plugins/standard/agent-recommend.mjs` | 推薦 tool 組合（12 種任務模式） | ✅ 已上線 |
| `smart_agent_execute` | `src/plugins/standard/agent-execute.mjs` | 一鍵自動化執行（6 種模板） | ✅ 已上線 |
| `smart_agent_plan` | `src/plugins/standard/agent-plan.mjs` | Planner 整合入口（DAG + 風險分析） | ✅ 已上線 |

---

## 七、測試策略

### 7.1 單元測試

```javascript
// tests/strategy.test.mjs
import { recommendTools } from '../src/agent/tool-strategy.mjs';

assert(recommendTools('debug login error').primary === 'smart_grep');
assert(recommendTools('refactor rename').primary === 'smart_learn');
```

### 7.2 整合測試

```javascript
// tests/agent.test.mjs
// 測試完整 workflow
const result = await smart_agent_execute({
  goal: 'debug login error'
});
assert(result.status === 'completed');
assert(result.summary.findings.length > 0);
```

### 7.3 安裝測試

```javascript
// tests/install.test.mjs
// 在乾淨目錄執行 npm install
// 驗證 opencode.json 正確產生
// 驗證 smart-mcp 可連接
```

---

## 八、已知限制

1. **需要 opencode 支援 env 注入**：system prompt 片段需要 opencode 支援 `env.SMART_SYSTEM_PROMPT` 之類的機制（目前已透過 `config/agents/smart-mcp.md` 解決）
2. ~~Workflow Phase 5 未完成~~ ✅ **已完成**：`smart_workflow_execute` dispatch 功能已實作
3. **Memory 僅 fuzzy match**：Phase 7 vector search 尚未實作
4. **非真正的 agent**：smart-agent 是「配置」不是「自主 agent」，仍依賴 opencode host（兩層架構降低此依賴）

---

## 九、成功指標

| 指標 | 當前 | 目標 | 衡量方式 |
|------|------|------|---------|
| 安裝成功率 | ✅ 測試通過 | >95% | install-agent.mjs 執行結果 |
| Tool 推薦準確率 | ✅ 12 種任務模式 | >80% | smart_agent_recommend 測試 |
| 自動化執行成功率 | ✅ 6 種模板 | >70% | smart_agent_execute 測試 |
| 小模型兜底覆蓋 | ✅ 3 個 MCP tools | >80% | 弱模型使用 agent tools 比率 |
| 兩層架構切換 | ✅ 已實作 | 自動切換 | 強/弱模型不同路徑 |
| 記憶命中率 | ~20% (fuzzy match) | >60% | 相似錯誤自動取出率 |
| Agent 滿意度 | — | 提升 50% | 問卷/回饋 |