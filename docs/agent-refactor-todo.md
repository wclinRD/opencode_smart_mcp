# Agent 模組分層重構 — 任務清單

> 計畫文件：[docs/plan/agent-refactor-plan.md](./plan/agent-refactor-plan.md)

## Phase 1：建立 core/ 目錄 ✅

- [x] 1. 建立 `src/agent/core/` 目錄
- [x] 2. 提取 `system-prompt-base.mjs`（兩個版本的共用骨架）
- [x] 3. 提取 `tool-strategy-base.mjs`（共用的任務模式匹配邏輯）
- [x] 4. 提取 `memory-integration-base.mjs`（共用的記憶規則）
- [x] 5. 移動 `workflow-strategy.mjs` → `core/`（完全相同）
- [x] 6. 移動 `planner-integration.mjs` → `core/`（完全相同）

## Phase 2：重構 src/agent/（MCP 內部版）✅

- [x] 7. 改寫 `system-prompt.mjs`：`import base + re-export`
- [x] 8. 改寫 `tool-strategy.mjs`：`import base + re-export`
- [x] 9. 改寫 `memory-integration.mjs`：`import base + re-export`
- [x] 10. 無需更新 index.mjs（src/agent/ 無 index.mjs）

## Phase 3：重構 smart-agent/src/agent/（npm 套件版）✅

- [x] 11. 改寫 `system-prompt.mjs`：`import base + re-export`
- [x] 12. 改寫 `tool-strategy.mjs`：`import base + re-export`
- [x] 13. 改寫 `memory-integration.mjs`：`import base + re-export`
- [x] 14. 改寫 `workflow-strategy.mjs`：`re-export from core`
- [x] 15. 改寫 `planner-integration.mjs`：`re-export from core`

## Phase 4：發布腳本 ✅

- [x] 16. 建立 `smart-agent/scripts/build-agent.mjs`
- [x] 17. 更新 `smart-agent/package.json`：加入 `prepublishOnly` script

## Phase 5：驗證與清理

- [x] 18. 執行測試：4/5 smart-agent 測試通過 ✅
- [x] 19. 修正 import 路徑（`../../` → `../../../`）
- [x] 20. 清理 41 個 `.apply.bak` 殘留檔案 ✅

## ⚠️ 待處理

- [ ] 更新 `smart-agent/tests/system-prompt.test.mjs`：3 個測試期望值需更新（現在 import 完整版 MCP prompt，內容更豐富）