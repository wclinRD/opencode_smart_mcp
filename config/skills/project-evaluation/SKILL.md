---
name: project-evaluation
description: 專案健康評估 — 10 階段管線（Harness Engineering + Superpowers）。首次進入專案、大重構前、定期健檢使用。產出量化分數（0-100）與結構化報告。
license: MIT
metadata:
  author: Smart MCP
  version: 1.0.0
  tags: [evaluation, health-check, harness-engineering, superpowers, quality-gate, audit]
  trigger:
    - 專案評估
    - project evaluation
    - 健康檢查
    - health check
    - 專案健檢
    - evaluate this project
    - 審查專案
    - project audit
  dependencies:
    skills:
      - smart-mcp-security
      - smart_exa_search
---

# 專案評估 Skill

**評估任何專案的 10 階段完整管線。遵循 Harness Engineering（機械化一致性 + 熵管理）與 Superpowers（spec/plan/review 循環）。**

## 使用時機

- 首次進入新專案 — 建立心智模型與評估基線
- 大重構或架構變更前 — 確認變更範圍與風險
- 每週/月定期健檢 — 監控品質趨勢
- 交接或釋出前 — 確保無遺漏問題

## 丟棄條件

- 專案為空或僅含單一檔案（單檔案直接 `smart_learn` 即可）
- 已有 7 天內的評估報告且無重大變更

## 主導變數

**專案規模與語言複雜度**決定評估深度。小專案（<50 檔）可跳過 Phase 4/6/8；多語言專案需每種語言執行一次 Phase 4。

## 呼叫慣例

```
Core 工具：直接呼叫 smart_learn(), smart_test(), smart_security(), ...
Standard 工具：ssr({tool:"工具名", args:{...}})
```

## 評估管線（10 階段）

### Phase 1: 入門與上下文

```
目的：建立專案心智模型

Check-1.1: smart_learn({root:目標目錄})
  PASS → 回傳語言、模組系統、命名慣例、測試框架
  WARN → 回傳內容不全（如無法解析語言）
  FAIL → 工具錯誤

Check-1.2: smart_rules({list:true}) — discover AGENTS.md / .cursorrules
  PASS → 找到至少一個規則檔案
  WARN → 規則檔案存在但 <5 行
  FAIL → 無任何規則檔案（建議建立 AGENTS.md）

Check-1.3: 根目錄關鍵檔案完整性
  PASS → package.json + README.md + .gitignore 都存在
  WARN → 缺少 LICENSE / CONTRIBUTING.md / CHANGELOG.md / .env.example 之一
  FAIL → 缺少 package.json 或 README.md

產出：專案摘要卡片（語言、規模、架構模式、規則覆蓋率）
```

### Phase 2: 機械化一致性

```
目的：檢查結構飄移（Harness Engineering 核心）

Check-2.1: ssr({tool:"consistency_check", args:{checks:"all"}})
  PASS → 所有 C1/C2/C3 通過
  WARN → 有 info-level 發現
  FAIL → 有 warn/error-level 發現（需修復後才能繼續）

Check-2.2: 修復所有 findings
  PASS → 全部修復完畢
  FAIL → 遺留未修復的 finding

產出：一致性檢查清單，每個 finding 含 fix 指令
```

### Phase 3: 品質閘審查

```
目的：確保工程紀律（Smart MCP 🟥🟨🟩）

🟥 強制（必須執行）：
  Check-3.1: 安全掃描（Phase 5 執行）
  Check-3.2: golden rules 可執行性（已含在 Phase 2）

🟨 建議（LLM 判斷）：
  Check-3.3: 新功能前有 brainstorming（smart_think cit mode）
  Check-3.4: 修復前有 beam search 多路徑分析
  Check-3.5: TDD 循環（RED→GREEN→REFACTOR）

🟩 跳過（例行省 token）：
  - 簡單編輯/查詢/例行測試

產出：品質閘通過清單（PASS/WARN/FAIL）
```

### Phase 4: 架構與依賴

```
目的：偵測架構腐化

Check-4.1: ssr({tool:"arch_overview", args:{}})
  PASS → 0 架構違反
  WARN → 有 info-level 發現（未使用匯出等）
  FAIL → 有層級違反或循環依賴

Check-4.2: ssr({tool:"import_graph", args:{}})
  PASS → 模組依賴單向無循環
  WARN → 有少數跨層依賴
  FAIL → 有循環依賴

Check-4.3: unused exports 審查
  PASS → 0 未使用匯出
  WARN → 1-5 個未使用匯出
  FAIL → >5 個未使用匯出

產出：架構圖摘要 + 依賴健康度表
```

### Phase 5: 安全基線

```
目的：建立安全底線（Harness Engineering 熵管理）

Check-5.1: smart_security({scan:"credentials"})
  PASS → 0 credential leak
  FAIL → 有高/中 severity leak（阻塞）

Check-5.2: smart_security({scan:"injection"})
  PASS → 0 高 severity injection
  WARN → 有中 severity 項目（需審查）
  FAIL → 有高 severity injection

Check-5.3: smart_security({scan:"dependencies"})
  PASS → 無已知漏洞依賴
  WARN → 有低 severity 漏洞
  FAIL → 有高/中 severity 漏洞

修復流程：高風險 → smart_think({mode:"beam"}) → smart_fast_apply → 再掃描

產出：安全掃描報告 + 修復狀態
```

### Phase 6: Git / CI 健康度

```
目的：確保版本控制與自動化紀律（Harness Engineering）

Check-6.1: ssr({tool:"git_context", args:{}})
  PASS → 有 .gitignore、branch 有追蹤 remote
  WARN → 缺少 .gitignore
  FAIL → 無 git repo

Check-6.2: CI/CD 配置
  PASS → 有 CI 配置檔（.github/workflows/ 等）
  WARN → CI 配置存在但最近 30 天未觸發
  FAIL → 無 CI 配置

Check-6.3: commit 健康度
  PASS → commit message 有意義（非 "fix" / "wip" 單詞）
  WARN → <20% 的 commit message 有意義
  FAIL → 無 commit 或僅單一 commit

產出：Git 健康度檢查表 + CI 狀態
```

### Phase 7: 文件品質

```
目的：確保知識可傳承（Superpowers spec/review）

Check-7.1: README 品質
  PASS → 含專案簡介、安裝、用法、API
  WARN → 缺安裝或用法的其中一項
  FAIL → <10 行或只有標題

Check-7.2: ADR / 設計文件
  PASS → DESIGNS/ 或 docs/decisions/ 有至少 1 篇
  WARN → 無設計文件但有 README 說明架構
  FAIL → 完全無架構/設計說明

Check-7.3: API 文件覆蓋率
  PASS → 公開函式/類別有 JSDoc/docstring 覆蓋 >50%
  WARN → 覆蓋率 10-50%
  FAIL → 覆蓋率 <10%

產出：文件覆蓋率報告
```

### Phase 8: 依賴健康度

```
目的：防止依賴腐化（Harness Engineering 熵管理）

Check-8.1: package.json 依賴版本明確性
  PASS → 所有依賴指定明確版本
  WARN → 有 ^/~ 寬鬆版本
  FAIL → 有未指定版本或 git: 依賴

Check-8.2: 過時依賴
  PASS → 所有依賴 <2 個 major version 落後
  WARN → 有依賴落後 2-3 個 major version
  FAIL → 依賴落後 >3 個 major version 或有 deprecated libs

Check-8.3: 開發 vs 生產依賴分類
  PASS → 分類正確
  WARN → 少數混淆（1-3 個）
  FAIL → 多數混淆（devDeps 出現在 production 路徑）

產出：依賴健康度評分表
```

### Phase 9: 測試健康度

```
目的：確保測試覆蓋（Superpowers TDD）

Check-9.1: smart_test({root:目標目錄})
  PASS → 全部通過
  FAIL → 有 failing tests（需修復後才能繼續）

Check-9.2: ssr({tool:"coverage", args:{}})
  PASS → 測試覆蓋率 >70%
  WARN → 覆蓋率 40-70%
  FAIL → 覆蓋率 <40% 或無測試

Check-9.3: 測試檔案比例 test:src
  PASS → 比 >1:3
  WARN → 比在 1:3 到 1:10 之間
  FAIL → 比 <1:10 或無測試檔案

Check-9.4: 測試品質（抽檢）
  PASS → 測試有 assert、有意義的 case name、涵蓋 edge cases
  WARN → 有意義但缺 edge cases
  FAIL → 無 assert 或全是 happy path

產出：測試覆蓋率報告 + 品質評估
```

### Phase 10: 評估報告

```
目的：彙整發現、量化分數、行動項目

Step 1: 依各 Phase 計算分數

  每項 Check：
    PASS = 5 分
    WARN = 3 分
    FAIL = 0 分

  Phase 分數 = (score / max) × 100
  總分 = 所有 Phase 分數平均

Step 2: 成熟度評等

  總分：
    0-25  🔴 初始（Initial）— 需建立基礎工程紀律
   26-50  🟠 發展中（Developing）— 部分紀律已建立
   51-70  🟡 已定義（Defined）— 核心流程標準化
   71-90  🟢 已管理（Managed）— 量化管理與預測
   91-100 🏆 優化中（Optimizing）— 持續改善

Step 3: 產出結構化報告（寫入 ai-evaluation-report.md）

  模板：
  ```
  # 專案評估報告：{專案名稱}
  - 日期：{YYYY-MM-DD}
  - 成熟度：{分數}/100（{等級}）
  - 摘要：{1-2 句總結}

  ## Phase 分數
  | Phase | 分數 | 狀態 |
  |-------|:----:|:----:|
  | P1 入門 | {n}/100 | ✅/⚠️/❌ |
  | ... | ... | ... |

  ## 關鍵發現（依 severity）
  ### ❌ 需立即處理
  - {finding}
  ### ⚠️ 排入 backlog
  - {finding}
  ### ✅ 良好
  - {finding}

  ## 行動項目
  - [ ] {高優先度}
  - [ ] {中優先度}
  - [ ] {低優先度}
  ```

產出：ai-evaluation-report.md（寫入專案根目錄）
```

## Token 優化提示

- Phase 1-2 強制執行（建立基線）
- Phase 3 純審查無工具呼叫（零 token 成本）
- Phase 6/7/8 可跳過（小專案省 token）
- 若 context budget <30%：只跑 P1 + P2 + P5 + P9 + P10
- 報告建議用 `smart_fast_apply` 寫入檔案（避免佔對話 context）

## 快速單行指令

```
# 完整 10 階段評估
skill("project-evaluation")

# 跳過已知健康的 phase（省 token）
skill("project-evaluation") → Phase 1,2,5,9,10

# 只跑改動過的 phase
ssr({tool:"consistency_check", args:{checks:"all"}})
smart_security({scan:"credentials"})
ssr({tool:"git_context", args:{}})
```

## 對應方法論

| Phase | Harness Engineering | Superpowers |
|-------|-------------------|-------------|
| P1 入門 | 地圖非手冊（Map not Manual） | — |
| P2 一致性 | 機械化執行（Mechanical Enforcement） | — |
| P3 品質閘 | 🟥🟨🟩 三層閘 | — |
| P4 架構 | 洋蔥路由架構 | — |
| P5 安全 | 熵管理（Entropy Management） | — |
| P6 Git/CI | 機械化閘道 | — |
| P7 文件 | — | Review 循環 |
| P8 依賴 | 熵管理（Entropy Management） | — |
| P9 測試 | — | TDD（RED→GREEN→REFACTOR） |
| P10 報告 | — | Brainstorming 閉環 |

### Phase 10a: 科技雷達（演進研究）

```
目的：上網搜尋最新技術趨勢，提供演進建議（Superpowers 持續改善）

前置條件：先完成 Phase 1 取得 tech stack、Phase 8 取得依賴清單

Step 1: 從 Phase 1/8 收集關鍵技術關鍵字
  範例：express, react-query, better-sqlite3, yfinance, playwright, python 3.11

Step 2: 對每個關鍵技術搜尋最新版本與替代方案

  smart_exa_search({command:"search", query:"{tech} latest version 2026 migration alternatives"})
  或使用 ssr({tool:"model_router", args:{question:"{tech} 最新版本與替代方案", mode: "research"}})

  檢查項目：
  Check-R1: 使用的技術是否仍在 active maintenance？
    PASS → 官方仍有定期更新（6 個月內有 release）
    WARN → 超過 6 個月未更新或進入 LTS-only 模式
    FAIL → 已 deprecated 或 archived（需立即規劃遷移）

  Check-R2: 是否有更現代的替代技術？
    PASS → 無明顯更好的替代（仍在生態主流）
    WARN → 有替代方案但遷移成本高
    FAIL → 有明顯更好且穩定的替代（需評估遷移）

  Check-R3: 是否落後最新 stable 版本 >2 major？
    PASS → 落後 <1 major
    WARN → 落後 1-2 major
    FAIL → 落後 >2 major（有重大安全或效能改善未跟上）

Step 3: 簡要評估每個發現

  格式：
  - {技術名} → 最新版 {ver}，目前使用 {ver}，落後 {n} major
    ⚠️ 建議：{具體行動}
    參考：{URL}

Step 4: 將演進建議納入最終報告的「行動項目」

產出：科技雷達摘要表
```

## 對應方法論

| Phase | Harness Engineering | Superpowers |
|-------|-------------------|-------------|
| P1 入門 | 地圖非手冊（Map not Manual） | — |
| P2 一致性 | 機械化執行（Mechanical Enforcement） | — |
| P3 品質閘 | 🟥🟨🟩 三層閘 | — |
| P4 架構 | 洋蔥路由架構 | — |
| P5 安全 | 熵管理（Entropy Management） | — |
| P6 Git/CI | 機械化閘道 | — |
| P7 文件 | — | Review 循環 |
| P8 依賴 | 熵管理（Entropy Management） | — |
| P9 測試 | — | TDD（RED→GREEN→REFACTOR） |
| P10 報告 | 熵管理 | Brainstorming 閉環 |
| P10a 科技雷達 | — | 持續改善（Continuous Improvement） |
