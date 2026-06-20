---
description: 專案健康評估 — 7 階段管線。整合 Harness Engineering 機械化一致性 + Superpowers spec/plan/review 循環。首次進入專案、大重構前、定期健檢使用。
---

# 專案評估 Skill

## 使用時機

- 首次進入新專案
- 大重構或架構變更前
- 每週/月定期健檢
- 交接或釋出前

## 呼叫慣例

```
Core 工具：直接呼叫 smart_learn(), smart_test(), ...
Standard 工具：ssr({tool:"工具名", args:{...}})
```

## 評估管線（7 階段）

### Phase 1: 入門與上下文

```
目的：建立專案心智模型

1. smart_learn({root:目標目錄})
2. smart_rules({list:true})  — 發現 AGENTS.md/.cursorrules
3. 若無 AGENTS.md → 建議建立（Harness Engineering 地圖非手冊）
```

### Phase 2: 機械化一致性

```
目的：檢查結構飄移（Harness Engineering）

1. ssr({tool:"consistency_check", args:{checks:"all"}})
   - C1: 檔案數 vs README 聲明
   - C2: wikilink 斷裂
   - C3: golden rules 可執行性
2. 每個 finding 含 fix 指令 → smart_fast_apply 逐一修復
```

### Phase 3: 品質閘審查

```
目的：確保工程紀律

🟥 強制（必須執行）：
  - smart_security({scan:"all"}) — 安全基線
  - golden rules 機械化執行（smart_rules 回傳）

🟨 建議（LLM 判斷）：
  - 新功能需 brainstorming 確認 spec（smart_think）
  - TDD 循環（RED→GREEN→REFACTOR）
  - 跨檔案編輯先跑 import_graph

🟩 跳過（例行省 token）：
  - 簡單編輯/查詢/例行測試
```

### Phase 4: 架構與依賴

```
目的：偵測架構腐化

1. ssr({tool:"arch_overview", args:{}})
   - 層級違反、循環依賴、未使用匯出
2. ssr({tool:"import_graph", args:{}})
   - 模組依賴健康度
```

### Phase 5: 安全基線

```
目的：建立安全底線

1. smart_security({scan:"all"})
2. 高風險發現 → smart_think({mode:"beam"}) 多路徑分析修復
3. smart_fast_apply 套用修復
4. smart_security 重新掃描確認
```

### Phase 6: 測試健康度

```
目的：確保測試覆蓋

1. smart_test({root:目標目錄})
2. 缺測試的程式碼路徑 → ssr({tool:"coverage", args:{}}) 
3. 遵循 TDD 補測試：RED 寫測試看 fail → GREEN 最小實作 → REFACTOR
```

### Phase 7: 評估報告

```
目的：摘要發現與行動項目

1. 彙整各 phase 發現，依 severity 排序（error > warn > info）
2. 產出行動清單（checklist 格式）
3. 評估專案成熟度：
   - 🔴 紅：有 error severity 發現 → 需立即處理
   - 🟡 黃：有 warn severity 發現 → 排入 backlog
   - 🟢 綠：僅 info → 健康
```

## 快速單行指令

```
# 完整 7 階段評估
skill("project-evaluation")  → 依 SKILL.md 逐階段執行

# 只跑一致性檢查
ssr({tool:"consistency_check", args:{checks:"all"}})

# 只跑架構審查
ssr({tool:"arch_overview"}) → ssr({tool:"import_graph"})

# 只跑安全
smart_security({scan:"all"})
```

## 與 Harness Engineering + Superpowers 對應

| 評估階段 | 對應方法論 | 核心概念 |
|---------|-----------|---------|
| Phase 1 入門 | Harness Engineering | 地圖非手冊（Map not Manual） |
| Phase 2 一致性 | Harness Engineering | 機械化執行（Mechanical Enforcement） |
| Phase 3 品質閘 | Smart MCP | 🟥🟨🟩 三層閘 |
| Phase 4 架構 | Smart MCP | 洋蔥路由架構 |
| Phase 5 安全 | Harness Engineering | 熵管理（Entropy Management） |
| Phase 6 測試 | Superpowers | TDD 循環（RED→GREEN→REFACTOR） |
| Phase 7 報告 | Superpowers | Brainstorming + Review 閉環 |

## Token 優化提示

- `smart_learn` / `smart_rules` 輸出通常 <5KB，不壓縮
- `consistency_check` 的 findings 含內嵌 fix 指令，直接餵給 `smart_fast_apply`
- Phase 3-6 可依需求跳過，不必每次跑完整 7 階段
- 若 context budget <30%，建議只跑 Phase 2 + Phase 5
