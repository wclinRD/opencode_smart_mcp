# docs/plans/ — 子系統計畫索引

> 此目錄存放各子系統/專案的深度計畫文件。主路線圖請見 `docs/plan.md`（Phase 1-18）。
> 每個檔案對應一個子系統，包含背景、Phase 列表、關鍵決策。
> #8-12 為跨源碼/設定檔之子系統，以主要檔案路徑標示。

| # | 子系統 | 狀態 | 行數 | 檔案 | 依賴 |
|:-:|--------|:----:|:----:|------|------|
| 1 | **Boulder** — 狀態持久化 (SQLite + CLI + Agent Integration) | ✅ 已完成（CLI 889 lines、3 表 CRUD 完整） | 355 | [`boulder.md`](boulder.md) | memory-db |
| 2 | **CBM Integration** — codebase-memory-mcp 整合 (158 語言 AST + Cypher) | ⬜ 全部待開始 | 491 | [`cbm-integration.md`](cbm-integration.md) | Smart MCP core |
| 3 | **Claude Features** — Hooks 系統 + Auto Mode（已完成） | ✅ 全部完成 | 202 | [`claude-features.md`](claude-features.md) | — |
| 4 | **Design Capability** — Harness Engineering + Superpowers 引導設計 | 🟡 Ph0-1 ✅ Ph2 🟡 Ph3 ⬜ | 243 | [`design-capability.md`](design-capability.md) | d2, wiki |
| 5 | **Smart Glob** — ripgrep 增強的 glob 搜尋 | ✅ Phase 1 完成（CLI 113 lines + Plugin 22 lines） | 358 | [`smart-glob.md`](smart-glob.md) | ripgrep |
| 6 | **Three-Tier Architecture** — L0/L1/L2 漸進式載入 | ⬜ 全部待開始 | 589 | [`three-tier-architecture.md`](three-tier-architecture.md) | Smart MCP core |
| 7 | **Cross-Session Memory** — 記憶注入強化 + Session Checkpoint | ✅ Phase 3 完成（checkpoint CRUD 完整） | 149 | [`cross-session-memory.md`](cross-session-memory.md) | memory-db, SQLite |
| 8 | **Agent Configuration** — 洋蔥路由架構 | 🟡 活躍維護中 | 213 | config/agents/smart-mcp.md | 所有 Phase |
| 9 | **Skills Ecosystem** — 24 個 Skill | 🟡 8 內建 ✅ / 16 companion ⬜ | — | config/skills/ 目錄（24 個 skill） | MCP core tools |
| 10 | **Code Intelligence** — LSP + AST 分析 | ✅ 已完成 | — | src/lib/lsp-bridge.mjs + ast-engine + import-graph + impact | MCP core |
| 11 | **Search & Security** — 搜尋 + 安全檢驗 | ✅ 已完成 | — | src/cli/exa-search.mjs + semantic-search + security-scan + hallucination-judge | MCP core, network |
| 12 | **Infrastructure & Workflow** — 代理 + 自動化 | 🟡 核心完成 | — | src/agent/ + src/cli/git-* + workflow + compose + hooks + install | MCP core |

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

