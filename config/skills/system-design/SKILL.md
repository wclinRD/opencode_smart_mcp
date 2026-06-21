---
name: system-design
description: 引導式系統設計工作流 — 基於 Harness Engineering（機械化一致性 + 熵管理）與 Superpowers（brainstorming + spec/plan/review 循環）。從需求發想到實作計畫，含 ADR 記錄、圖表渲染、🟥🟨🟩 品質閘、wiki 歸檔。
metadata:
  author: Smart MCP
  version: 1.0.0
  tags: [design, architecture, harness-engineering, superpowers, c4, adr, planning]
  trigger:
    - 設計
    - 規劃
    - 架構
    - system design
    - 幫我設計
    - 技術選型
    - 想一下怎麼做
    - design the architecture
    - plan the system
  dependencies:
    tools:
      - smart_think
      - smart_run
    skills:
      - project-evaluation
---
# system-design

基於 **Harness Engineering**（機械化一致性 + 熵管理）與 **Superpowers**（brainstorming + spec/plan/review 循環）的引導式設計工作流。

## 使用時機

- 開發新功能或新專案前
- 大重構或架構變更前
- 技術選型需要系統性評估
- 需要記錄設計決策給團隊或未來的自己

## 觸發詞

- "設計"、"規劃"、"架構"、"system design"
- "幫我設計"、"想一下怎麼做"、"技術選型"
- "design"、"architecture"、"plan the architecture"

## 方法論

### Superpowers
- **Brainstorming**：先發散再收斂，smart_think({mode:"beam"}) 探索多路徑
- **Spec → Plan → Review 循環**：design_doc → planner → 審查
- **TDD 循環**：RED → GREEN → REFACTOR（實作階段）

### Harness Engineering
- **機械化一致性**：consistency_check 自動檢測結構飄移
- **熵管理**：設計知識歸檔到 wiki + kg，跨專案可查詢
- **🟥🟨🟩 品質閘**：強制/建議/跳過三層分級

## 工作流（6 Stages）

```
Stage 1: 🧠 Superpowers Brainstorming
Stage 2: 📐 視覺化（Brainstorming 輔助）
Stage 3: 📝 Harness Engineering 機械化記錄
Stage 4: 🔍 🟥🟨🟩 設計品質閘
Stage 5: 📋 Superpowers Plan Cycle
Stage 6: 🏛 Harness Engineering 歸檔（熵管理）
```

### Stage 1: Superpowers Brainstorming

**目標**：在實作前先徹底想清楚。

```
LLM 引導：
  1. 先用 smart_think({mode:"beam"}) 探索 2-3 個方案
     → beam mode 強制多路徑，避免 tunnel vision
  2. 對每個方案分析：
     - 優點 / 缺點
     - 實作成本（估算人天）
     - 風險與不確定性
  3. 選定最佳方案後，產出 design_doc

設計文件（design_doc）：
  Goal      — 一句話目標
  Context   — 背景、限制、既有架構
  Approach  — 實作方案與理由
  Risks     — 已知風險、edge cases、失敗模式
  Test Plan — 如何驗證正確性
```

**輸出**：`DESIGNS/{project}/{timestamp}-{設計名}.md`

### Stage 2: 視覺化（Brainstorming 輔助）

**目標**：用圖表幫助思考與溝通。

```
LLM 引導：
  1. 判斷需要哪種圖：
     - flowchart → 流程/狀態機/決策樹
     - sequence  → 互動/API 呼叫順序
     - class     → 型別/實體關係
     - er        → 資料庫表格關係
  2. 呼叫 ssr(diagram) 產出 Mermaid 文字
  3. 用 scripts/render-diagram.sh 轉成 PNG/SVG
  4. 圖表嵌入 design_doc

圖表三層視角（僅供參考，非強制）：
  - context_view  → 系統邊界、外部角色
  - container_view → service / database / client
  - component_view → 模組內部元件
```

**輸出**：PNG/SVG 圖檔，嵌入 design_doc

### Stage 3: Harness Engineering 機械化記錄

**目標**：每個重大決策都要記錄「為什麼」，不是只記錄「做了什麼」。

```
LLM 引導：
  每次做出重大設計決策時：
    1. 呼叫 ssr(adr) 記錄
       - title: [專案名] 決定使用 {技術/方案}
       - context: 背景與限制
       - decision: 做了什麼決定
       - alternatives: 考慮過的其他選項
       - consequences: 這個決定的影響
       - status: accepted

  什麼是「重大決策」？
     🟥 影響整個系統的（資料庫選型、架構模式）
     🟨 影響一個模組的（library 選擇、API 風格）
     🟩 可跳過的（實作細節、命名慣例）

ADR ID → 自動交叉引用到 design_doc
```

**輸出**：ADR 記錄，含 ID 與 status

### Stage 4: 🟥🟨🟩 設計品質閘

**目標**：在進入實作前捕捉設計缺陷。

```
LLM 執行以下檢查：

🟥 強制（必須通過才能進實作）:
  C1: design_doc 的 goal 與 context 不可為空
  C2: 若 Stage 3 有觸發重大決策，至少 1 篇 ADR
  C3: 設計無矛盾（一致性檢查）

🟨 建議（LLM 判斷是否跳過）:
  C4: diagram 存在且與 design_doc 一致
  C5: 方案 A/B 的權衡分析完整
  C6: 風險評估涵蓋 edge cases

🟩 可跳過（例行省 token）:
  C7: 細節完善度
  C8: 命名一致性
  C9: 格式美化

若 🟥 任一 FAIL → 退回修改 → 重跑 Stage 4
若 🟥 全 PASS → 可進入 Stage 5
```

### Stage 5: Superpowers Plan Cycle

**目標**：把設計變成可執行的 TODO。

```
LLM 引導：
  1. 呼叫 ssr(planner) 展開實作 TODO
     - 依據 Stage 1 的 Approach 拆成步驟
     - 每個步驟包含：檔案、預期變更、測試策略
  2. 呼叫 ssr(goal) 設定達標條件
     - 每個 TODO 對應一個 goal
     - autoCheck: true（自動追蹤進度）
  3. 建立 Spec → Plan → Review 循環
     - 每個 TODO 完成後自動跑 review
```

**輸出**：planner TODO list + goal tracking

### Stage 6: Harness Engineering 歸檔（熵管理）

**目標**：設計知識不流失，跨專案可復用。

```
LLM 引導：
  1. 寫入 Obsidian wiki
     路徑: 00-設計/{專案名}/{設計名稱}.md
     內容: design_doc 摘要 + ADR 連結 + diagram 圖檔
     索引: 更新 00-設計/README.md

  2. 寫入 Knowledge Graph
     實體: 專案、模組、技術選型
     關係: uses / depends_on / decides
     目的: 跨專案查詢「我們用過哪些技術」

  3. 記錄到 self-reflection
     哪些步驟順暢？
     哪些卡住？
     下次怎麼改善？
```

**輸出**：wiki page + kg entities + 學習記錄

---

## 快速指令

```bash
# 完整設計流程（6 Stages）
skill("system-design")
→ LLM 引導你走完所有 stage

# 只做 brainstorming（快速設計）
skill("system-design")
→ 跳到 Stage 1, 詢問是否需要後續 stages

# 設計審查（已有 design_doc）
skill("system-design")
→ 跳到 Stage 4（品質閘）開始
```

## Templates

位於 `templates/` 目錄：
- `design_doc_superpowers.md` — Superpowers 標準設計文件模板
- `adr_harness.md` — Harness Engineering ADR 模板
- `diagrams/context_view.d2` — 系統上下文圖
- `diagrams/container_view.d2` — 容器架構圖
- `diagrams/component_view.d2` — 元件細節圖

## 與 project-evaluation 整合

system-design 完成後，建議執行 project-evaluation：
- **Phase 3**（品質閘審查）— 驗證設計階段的 🟥 檢查
- **Phase 7**（文件品質）— ADR 與 design_doc 納入評分
- **Phase 10a**（科技雷達）— 技術選型的競品分析

## 注意事項

1. **零核心修改** — 不改 Smart MCP server source，純 skill 層級
2. **既有方法論優先** — Superpowers + Harness Engineering，不引進新框架
3. **🟥🟨🟩 彈性** — 強制/建議/跳過，適應不同場景
4. **知識閉環** — 設計 → 歸檔 → 查詢 → 再設計
