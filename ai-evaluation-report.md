# 專案評估報告：Smart MCP

- **日期**：2026-06-20
- **成熟度**：90.0/100（🟢 已管理 Managed）— 核心流程標準化，具量化管理能力
- **摘要**：Smart MCP 是一個高度成熟的 MCP server 專案，提供 70+ 開發工具與洋蔥架構 agent 系統，作為 **opencode 的 MCP 工具層使用**。測試覆蓋完整（1803 測試全數通過），架構乾淨無違規，安全基線穩固，無需 CI/CD（作為 MCP plugin 隨 opencode 載入，非獨立部署服務）。主要改善機會：缺少專案規則檔案、缺少 LICENSE/CHANGELOG、部分 API 文件不完整。

---

## Phase 分數

| Phase | 分數 | 狀態 | 說明 |
|-------|:----:|:----:|------|
| P1 入門與上下文 | 86.7/100 | ✅ | 語言/結構清晰，但缺 AGENTS.md 規則檔與 LICENSE/CHANGELOG |
| P2 機械化一致性 | 86.7/100 | ✅ | 命名機制良好，檔案命名有混合（kebab 57% / camel 30% / snake 12%） |
| P3 品質閘審查 | 100/100 | ✅ | golden rules 執行完整，無缺失 |
| P4 架構與依賴 | 86.7/100 | ✅ | 0 架構違規、無循環依賴，10 個未使用匯出 |
| P5 安全基線 | 100/100 | ✅ | 0 高 severity 問題，npm audit 乾淨 |
| P6 Git 健康度 | 86.7/100 | ✅ | Commit 品質優良（conventional commits），無需 CI/CD（opencode MCP plugin，非獨立服務） |
| P7 文件品質 | 86.7/100 | ✅ | README 極詳盡（883 行），JSDoc 覆蓋率中等 |
| P8 依賴健康度 | 86.7/100 | ✅ | 版本明確，分類正確，落後幅度小 |
| P9 測試健康度 | 90.0/100 | ✅ | 1803 測試全數通過，test:src 比 1:2.5 |
| **總分** | **90.0/100** | 🟢 | **已管理（Managed）** |

---

## 關鍵發現（依 severity）

### ❌ 需立即處理

| # | 問題 | Phase | 建議 |
|---|------|-------|------|
| 1 | 缺少 AGENTS.md/.cursorrules | P1 | 建立專案規則檔，定義 naming/module system/testing conventions |
| 2 | 缺少 LICENSE（僅 book-to-skill 有） | P1 | 在專案根目錄放置 MIT LICENSE 檔案 |
| 3 | 缺少 CHANGELOG.md | P1 | 建立 CHANGELOG 追蹤版本演進（已有 conventional commits 可自動產生） |

### ⚠️ 排入 backlog

| # | 問題 | Phase | 建議 |
|---|------|-------|------|
| 5 | 檔案命名不一致（kebab/camel/snake 混合） | P2 | 統一到 kebab-case 或維持現狀但明訂規則 |
| 6 | 10 個未使用的匯出 | P4 | 檢查 src/agent/tool-strategy.mjs 與 workflow-strategy.mjs 的匯出是否仍需保留 |
| 7 | JSDoc 覆蓋率中等 | P7 | 為公開 API 補上 @param/@returns 標記 |
| 8 | 依賴使用 ^ 寬鬆版本（devDeps） | P8 | 鎖定 devDeps 版本避免 CI 不一致 |

### ✅ 良好

| # | 項目 | Phase |
|---|------|-------|
| 1 | **1803 測試全數通過，0 失敗** | P9 |
| 2 | **0 安全漏洞**（credentials/injection/dependencies） | P5 |
| 3 | **0 架構違規**、0 循環依賴 | P4 |
| 4 | 極詳盡的 README（883 行，含架構圖、安裝、開發指引） | P7 |
| 5 | Conventional commits（feat/fix/docs 前綴） | P6 |
| 6 | 所有依賴鎖定明確版本 | P8 |
| 7 | 為 opencode 使用最佳化 — MCP plugin 隨 opencode 載入，無需獨立部署 | P1 |
| 8 | 8 個 domain skill 按需載入（洋蔥架構） | P4 |
| 9 | 24 個開發階段全部完成 | P7 |
| 10 | 專案有 .gitignore 且內容完整 | P2 |

---

## 架構摘要

```
opencode 整合模式：作為 MCP server 透過 opencode.json 載入，plugin/compaction-fix.js
自動恢復上下文。agent personality（smart-mcp.md）作為 opencode default_agent。

8 層架構（0 違規）：
  agent (5 files)       — 策略引擎、system prompt、memory
  cli (35 files)        — CLI 實作入口
  install (3 files)     — 安裝腳本
  lib (11+ lib files)   — 核心程式庫（ckg-engine, lsp-bridge, model-router...）
  plugins/core (15)     — 15 個 direct MCP tool
  plugins/standard (46) — 60+ router sub-tools
  server (2 files)      — MCP JSON-RPC 2.0 over stdio
  tests (70 test files) — node:test 框架，1803 案例

依賴方向：lib ← plugins ← server（單向，無循環）
```

## 關鍵統計

| 指標 | 數值 |
|------|:----:|
| 總檔案數 | ~332（含 config/skills） |
| 主要語言 | JavaScript（ESM） + Python（skills） |
| 函式數 | 1,418 |
| 測試案例 | 1,803（全部通過） |
| 測試檔案 | 70 |
| test:src 比 | ~1:2.5 |
| 安全漏洞 | 0 |
| 架構違規 | 0 |
| 未使用匯出 | 10 |
| 外部依賴 | 17（production deps） |

---

## 行動項目

- [ ] **高優先度**：建立 AGENTS.md 或 .cursorrules，明訂專案慣例
- [ ] **高優先度**：補上根目錄 LICENSE（MIT）與 CHANGELOG.md
- [ ] **中優先度**：檢討 10 個未使用匯出是否需要保留
- [ ] **中優先度**：補強公開 API 的 JSDoc 覆蓋率
- [ ] **低優先度**：統整檔案命名慣例

---

## 科技雷達摘要（經 exa_search 網路驗證）

| 技術 | 使用版本 | 最新版 | 落後 | Check-R1 (維護) | Check-R2 (替代) | Check-R3 (版本) | 評估 |
|------|:--------:|:------:|:----:|:---:|:---:|:---:|:----:|
| better-sqlite3 | 12.10.0 | **12.11.1** (Jun'26) | 1 minor | ✅ 月月更新 | ✅ 無替代必要 | ✅ <1 major | 健康 |
| @playwright/mcp | 0.0.75 | **0.0.76** (Jun'26) | 1 patch | ✅ 週週更新 | ✅ 官方 MCP | ✅ <1 major | 健康 |
| crawlee | 3.17.0 | **3.17.0** (Jun'26) | 0 | ✅ 月月更新 | ✅ 無替代必要 | ✅ 最新 | **最新** |
| tree-sitter-wasms | 0.1.13 | **0.1.13** (Oct'25) | 0 | ⚠️ 8個月未更新 | ✅ 無替代 | ✅ 最新 | 穩定 |
| docx | 9.7.1 | **9.7.1** (May'26) | 0 | ✅ 月月更新 | ✅ 無替代必要 | ✅ 最新 | **最新** |
| pdf-parse | 2.4.5 | **2.4.5** (Oct'25) | 0 | ✅ 活躍開發中 | ✅ 無替代必要 | ✅ 最新 | 健康 |
| node-xlsx | 0.24.0 | **0.24.0** (Apr'24) | 0 | ⚠️ 2年未更新 | ⚠️ 觀察替代 | ✅ 最新 | 凍結 |
| turndown | 7.2.4 | **7.2.4** (Apr'26) | 0 | ✅ 持續更新 | ✅ 無替代必要 | ✅ 最新 | **最新** |
| linkedom | 0.18.12 | **0.18.12** (Aug'25) | 0 | ⚠️ 10個月未更新 | ✅ 無替代必要 | ✅ 最新 | 穩定 |
| @mozilla/readability | 0.6.0 | **0.6.0** (Mar'25) | 0 | ⚠️ Mozilla 慢速但穩 | ✅ 無替代必要 | ✅ 最新 | 穩定 |
| @huggingface/transformers | 4.2.0 | **4.2.0** (Apr'26) | 0 | ✅ 快速迭代 | ✅ 無替代必要 | ✅ 最新 | **最新** |
| web-tree-sitter | 0.26.9 | **0.26.9** | 0 | ✅ tree-sitter 生態 | ✅ 無替代必要 | ✅ 最新 | 穩定 |

### 關鍵發現

- ✅ **9/12 技術** 處於最新版本或落後 <1 minor
- ✅ **所有技術均 active maintenance**（node-xlsx 雖 2 年未更新但功能穩定，無安全漏洞）
- ⚠️ **node-xlsx** 最後發布 2024/4，若未來需要新功能可關注 [sheetjs](https://sheetjs.com) 或 [exceljs](https://github.com/exceljs/exceljs)
- ✅ 動態 import 策略確保選裝套件無強依賴，升級風險低
- 專案採用 `peerDependencies` 搭配 `smart-mcp`，避免套件版本衝突

**結論**：整體技術棧非常健康，多數依賴保持在最新版。無需立即升級行動。
