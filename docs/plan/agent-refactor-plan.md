# Agent 模組分層重構計畫

## 背景

目前 `src/agent/` 和 `smart-agent/src/agent/` 各自維護一份 agent 模組（5 個檔案），其中 3 個已有 drift：

| 檔案 | 狀態 |
|------|------|
| `system-prompt.mjs` | ❌ 差異大（MCP 版有 70+ 工具路由，npm 版是簡化列表） |
| `tool-strategy.mjs` | ❌ 小差異（MCP 版多了 smart_read 模式） |
| `memory-integration.mjs` | ❌ 小差異（npm 版多了 smart_toonify 規則） |
| `workflow-strategy.mjs` | ✅ 完全相同 |
| `planner-integration.mjs` | ✅ 完全相同 |

## 目標

消除 fork，建立單一事實來源。新增功能時不需要記住任何標記規則，架構本身強制正確行為。

## 架構設計

```
src/agent/
├── core/                         ← 🧬 單一事實來源（共用基底）
│   ├── system-prompt-base.mjs    ← 兩邊共用的 prompt 骨架
│   ├── tool-strategy-base.mjs    ← 共用的任務模式匹配邏輯
│   ├── memory-integration-base.mjs ← 共用的記憶規則
│   ├── workflow-strategy.mjs     ← 完全相同 → 直接移入
│   └── planner-integration.mjs   ← 完全相同 → 直接移入
│
├── system-prompt.mjs             ← import base + MCP 擴展（70+ 工具路由）
├── tool-strategy.mjs             ← import base + MCP 擴展（smart_read 模式）
├── memory-integration.mjs        ← import base + MCP 擴展
└── index.mjs                     ← MCP 入口（路徑不變）

smart-agent/src/agent/
├── system-prompt.mjs             ← import base + npm 擴展（簡化工具列表）
├── tool-strategy.mjs             ← import base + npm 擴展（toonify 規則）
├── memory-integration.mjs        ← import base + npm 擴展
├── workflow-strategy.mjs         ← re-export from core
└── planner-integration.mjs       ← re-export from core

smart-agent/scripts/
└── build-agent.mjs               ← 🆕 發布前自動複製 core/ 並修正 import 路徑
```

### 開發時 vs 發布時

| 階段 | smart-agent import 路徑 | core/ 位置 |
|------|------------------------|-----------|
| 開發 | `../../src/agent/core/xxx.mjs` | `src/agent/core/` |
| 發布（npm pack） | `./core/xxx.mjs` | `smart-agent/src/agent/core/`（由 build script 複製） |

## 實作步驟

### Phase 1：建立 core/ 目錄

1. 建立 `src/agent/core/` 目錄
2. 從現有檔案提取共用部分，寫入 core/ 檔案
3. 將完全相同的 `workflow-strategy.mjs` 和 `planner-integration.mjs` 移入 core/

### Phase 2：重構 src/agent/

4. 改寫 `system-prompt.mjs`：import base + MCP 擴展
5. 改寫 `tool-strategy.mjs`：import base + MCP 擴展
6. 改寫 `memory-integration.mjs`：import base + MCP 擴展
7. 更新 `index.mjs` 的 import 路徑（如有需要）

### Phase 3：重構 smart-agent/src/agent/

8. 改寫 `system-prompt.mjs`：import base + npm 擴展
9. 改寫 `tool-strategy.mjs`：import base + npm 擴展
10. 改寫 `memory-integration.mjs`：import base + npm 擴展
11. 改寫 `workflow-strategy.mjs`：re-export from core
12. 改寫 `planner-integration.mjs`：re-export from core

### Phase 4：發布腳本

13. 建立 `smart-agent/scripts/build-agent.mjs`
14. 更新 `smart-agent/package.json`：加入 `prepublishOnly` script

### Phase 5：驗證

15. 執行 `npm test` 確認所有測試通過
16. 手動驗證 smart-agent 的 import 路徑正確
17. 清理 `.apply.bak` 殘留檔案

## 風險與注意事項

- **smart-agent 的 import 路徑**：開發時用 `../../src/agent/core/`，發布時 build script 會改成 `./core/`
- **向後相容**：`src/agent/index.mjs` 的 export 介面保持不變
- **測試覆蓋**：smart-agent 和 MCP 兩邊的測試都要通過
- **不要動 src/cli/**：這次只重構 agent 模組，CLI 工具不動