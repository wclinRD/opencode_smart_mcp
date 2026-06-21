# docs/todos/ — 子系統待辦索引

> 此目錄存放各子系統/專案的詳細待辦清單。主路線圖待辦請見 `docs/todo.md`（Phase 1-18）。
> 每個檔案對應一個子系統，包含 Phase 列表、詳細工作項、完成狀態。
> #8-12 為跨源碼/設定檔之子系統，以主要檔案路徑標示。

| # | 子系統 | 狀態 | 行數 | 檔案 | 對應計畫 |
|:-:|--------|:----:|:----:|------|---------|
| 1 | **Boulder** | ✅ 已完成 | ~110 | [`boulder.md`](boulder.md) | `docs/plans/boulder.md` |
| 2 | **CBM Integration** | ⬜ 全部待開始 | ~150 | [`cbm-integration.md`](cbm-integration.md) | `docs/plans/cbm-integration.md` |
| 3 | **Claude Features** | ✅ 全部完成 | ~40 | [`claude-features.md`](claude-features.md) | `docs/plans/claude-features.md` |
| 4 | **Design Capability** | 🟡 Ph0-1 ✅ Ph2 🟡 Ph3 ⬜ | ~80 | [`design-capability.md`](design-capability.md) | `docs/plans/design-capability.md` |
| 5 | **Smart Glob** | ✅ Phase 1 完成 | ~80 | [`smart-glob.md`](smart-glob.md) | `docs/plans/smart-glob.md` |
| 6 | **Three-Tier Architecture** | ⬜ 全部待開始 | ~60 | [`three-tier-architecture.md`](three-tier-architecture.md) | `docs/plans/three-tier-architecture.md` |
| 7 | **Cross-Session Memory** | ✅ Phase 3 完成 | ~40 | [`cross-session-memory.md`](cross-session-memory.md) | `docs/plans/cross-session-memory.md` |
| 8 | **Agent Configuration** | 🟡 活躍維護中 | — | config/agents/smart-mcp.md | —（與所有 Phase 同步） |
| 9 | **Skills Ecosystem** | 🟡 8 內建 ✅ / 16 companion ⬜ | — | config/skills/ 目錄（24 個 skill） | `config/skills/` |
| 10 | **Code Intelligence** | ✅ 已完成 | — | src/lib/lsp-bridge.mjs 等 | —（已整合至 MCP core） |
| 11 | **Search & Security** | ✅ 已完成 | — | src/cli/exa-search.mjs 等 | —（已整合至 MCP core） |
| 12 | **Infrastructure & Workflow** | 🟡 核心完成 | — | src/agent/ + src/cli/git-* 等 | —（已整合至 MCP core） |

## 相依圖

```
Boulder ─── memory-db
CBM ─────── Smart MCP core
Claude ──── (獨立，已完成)
Design ──── d2 + wiki
Smart Glob ─ ripgrep
Three-Tier ─ Smart MCP core
Memory ──── memory-db + SQLite
Agent Config ─ 所有 Phase（雙向同步）
Skills ── MCP core tools
Code Intel ─ MCP core
Search & Security ─ MCP core + network
Infra/Workflow ─ MCP core
```

> 更新：2026-06-21
