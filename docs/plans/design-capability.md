# 🔧 設計專案能力強化計畫
## 以 Harness Engineering + Superpowers 為基礎

> **核心理念**：你不是需要新的設計框架，而是需要把**既有的 Harness Engineering（機械化一致性 + 熵管理）與 Superpowers（brainstorming + spec/plan/review 循環）** 串成一個引導式設計工作流。

---

## 📊 現狀盤點

### ✅ 已有而且對的

| 工具/方法 | 所屬體系 | 狀態 |
|-----------|---------|:----:|
| `ssr(design_doc)` — Goal/Context/Approach/Risks/Test Plan | **Superpowers brainstorming** | ✅ 完整 |
| `ssr(adr)` — 架構決策記錄 | **Harness Engineering 機械化** | ✅ 完整 |
| `ssr(diagram)` — Mermaid 圖表 | **輔助視覺化** | ✅ 已存在，需加 d2 render |
| `ssr(consistency_check)` — 結構飄移檢測 | **Harness Engineering 機械化一致性** | ✅ 完整 |
| `ssr(planner)` — 計畫展開 | **Superpowers plan cycle** | ✅ 完整 |
| `ssr(goal)` — 目標追蹤 | **Superpowers review cycle** | ✅ 完整 |
| `ssr(kg)` — 知識圖譜 | **Harness Engineering 熵管理** | ✅ 完整 |
| 🟥🟨🟩 三層品質閘 | **Harness Engineering 核心** | ✅ 內建於 project-evaluation |
| `project-evaluation` 10 階段管線 | **HE + Superpowers 融合** | ✅ 完整 |
| `ssr(obsidian_write)` — wiki 歸檔 | **熵管理（跨專案知識）** | ✅ 完整 |

### ❌ 真正缺少的

| 缺口 | 原因 | 優先級 |
|------|------|:------:|
| **無 system-design skill** 把上述工具串成引導流程 | 每次設計要手動記住所有步驟 | 🔴 P0 |
| **無 d2 渲染引擎** — diagram 只能輸出文字不能變圖檔 | 無法在文件/wiki 中嵌入圖表 | 🟡 P1 |
| **無設計階段的品質閘** — 設計完成後沒有自動檢查 | 設計缺陷直到實作才被發現 | 🟡 P1 |
| **無設計知識自動回饋** — 跨專案設計模式無法 reuse | 每次設計從零開始 | 🟢 P2 |

---

## 🗺 路線圖

```
Phase 0 (30min)       Phase 1 (1.5h)         Phase 2 (1h)          Phase 3 (持續)
┌──────────────┐     ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Install d2   │ →   │ Create       │ →    │ 🟥🟨🟩 品質閘 │ →   │ 跨專案       │
│ 驗證 tools   │     │ system-design│      │ 自動化檢查   │      │ 設計模式庫   │
│ 端到端連通   │     │ skill        │      │ wiki 自動歸檔│      │ self-learning │
│              │     │ (Superpowers │      │              │      │              │
│              │     │  + HE 融合)  │      │              │      │              │
└──────────────┘     └──────────────┘      └──────────────┘      └──────────────┘
```

---

## Phase 0：基礎建設 — 讓工具連通（30 min）

**目標**：確定所有既有工具可被 skill 呼叫，補 diagram 渲染缺口。

```
0.1 brew install d2
    → 唯一新增的外部依賴
    → 讓 diagram sub-tool 的 Mermaid 輸出可以變成 PNG/SVG

0.2 驗證端到端：
    ssr(design_doc) — 確認 Superpowers 標準輸出格式
    ssr(adr)        — 確認 ADR 儲存位置
    ssr(diagram)    — 確認 Mermaid 輸出正常
    ssr(consistency_check) — 確認可執行
    ssr(planner)    — 確認 TODO 展開
    ssr(obsidian_write) — 確認 wiki 寫入
    ssr(kg)         — 確認知識圖譜連通
```

---

## Phase 1：system-design skill — 核心交付（1.5h）

**目標**：建立一個 skill，把設計流程變成**引導式對話**，而不是讓使用者自己記步驟。

### 1.1 設計工作流（Superpowers + Harness Engineering）

```
Stage 1 — 🧠 Superpowers Brainstorming
  ├─ 工具: smart_think({mode:"beam"}) 探索 2-3 方案
  ├─ 工具: ssr(design_doc) 產出結構化設計
  │   Goal / Context / Approach / Risks / Test Plan
  └─ 產出: design_doc 檔案 → DESIGNS/{project}/

Stage 2 — 📐 視覺化（Brainstorming 輔助）
  ├─ 工具: ssr(diagram) 產出 Mermaid
  ├─ 增強: d2 render → PNG/SVG
  └─ 產出: 圖表嵌入 design_doc

Stage 3 — 📝 Harness Engineering 機械化記錄
  ├─ 工具: ssr(adr) 記錄每個重大決策
  │   Context → Decision → Alternatives → Consequences
  └─ 自動: ADR ID → design_doc 交叉引用

Stage 4 — 🔍 🟥🟨🟩 設計品質閘
  ├─ 🟥 C1: design_doc 是否完整（Goal + Context 不可缺）
  ├─ 🟥 C2: 重大決策有 ADR 記錄
  ├─ 🟨 C3: 有對應 diagram（建議）
  └─ 🟩 C4: 細節完善度（可跳過）

Stage 5 — 📋 Superpowers Plan Cycle
  ├─ 工具: ssr(planner) 展開實作 TODO
  ├─ 工具: ssr(goal) 設定達標條件
  └─ 循環: Spec → Plan → Review → Implement

Stage 6 — 🏛 Harness Engineering 歸檔（熵管理）
  ├─ 工具: ssr(obsidian_write) → wiki "70-設計/"
  ├─ 工具: ssr(kg) → 領域模型實體
  └─ 目的: 跨專案知識可查詢，避免重複設計
```

### 1.2 SKILL.md 結構

```markdown
# Skill: system-design

## 使用時機
開發新功能、大重構、架構變更前。

## 方法論
- **Superpowers**：brainstorming → spec → plan → review 循環
- **Harness Engineering**：機械化一致性、熵管理、🟥🟨🟩 品質閘

## 工作流（6 Stages）

### Stage 1: Superpowers Brainstorming
### Stage 2: 視覺化
### Stage 3: 機械化記錄
### Stage 4: 🟥🟨🟩 品質閘
### Stage 5: Plan Cycle
### Stage 6: 歸檔

## Templates
- design_doc 模板（Superpowers 標準）
- ADR 模板（Harness Engineering 標準）
- diagram 模板（C1/C2/C3 三層視角）

## 快速指令
  skill("system-design")
  → 引導式設計流程
```

### 1.3 Templates 目錄

```
system-design/
├── SKILL.md
├── templates/
│   ├── design_doc_superpowers.md    ← Superpowers 標準模板
│   ├── adr_harness.md               ← Harness Engineering ADR 模板
│   └── diagrams/
│       ├── context_view.d2          ← C1 系統上下文
│       ├── container_view.d2        ← C2 容器架構
│       └── component_view.d2        ← C3 元件細節
└── scripts/
    └── render-diagram.sh            ← d2 渲染腳本
```

---

## Phase 2：🟥🟨🟩 品質閘 + 自動化（1h）

**目標**：設計完成後自動跑品質檢查，結果自動歸檔。

### 2.1 設計品質閘（對齊 project-evaluation Phase 3）

```yaml
🟥 強制（必須通過才能進實作）:
  - design_doc 的 Goal 與 Context 不可為空
  - 至少 1 篇 ADR（若 stage 3 有觸發）
  - 無矛盾設計決策（consistency_check）

🟨 建議（LLM 判斷是否跳過）:
  - diagram 存在且與 design_doc 一致
  - 方案 A/B 的權衡分析完整
  - 風險評估涵蓋 edge cases

🟩 可跳過（例行省 token）:
  - 細節完善度
  - 命名一致性
  - 格式美化
```

### 2.2 自動歸檔 pipeline

```
設計完成
  → ssr(obsidian_write) → wiki "70-設計/{專案名}/{設計名}.md"
  → wiki page 含：design_doc 摘要 + ADR 連結 + diagram 圖檔
  → ssr(kg) → 領域實體寫入知識圖譜
  → 更新 wiki "70-設計/README.md" 索引
```

### 2.3 與 project-evaluation 對齊

```
system-design skill 完成後
  → 自動觸發 project-evaluation Phase 3（品質閘審查）
  → 設計階段的發現納入 Phase 7（文件品質）評分
  → 設計階段的 ADR 納入 Phase 10（報告）的決策軌跡
```

---

## Phase 3：跨專案設計模式庫（持續）

### 3.1 設計知識反哺

```
新專案設計時：
  wiki-query("類似 {專案描述} 的設計方案")
  → 從 wiki "70-設計/" 找出相似設計
  → 提供 ADR 和 diagram 參考
```

### 3.2 模式提取

```
從既有專案的 wiki 頁面自動提取：
  - 常見架構模式（透過 wiki-lint + kg 分析）
  - 反模式警示（透過 consistency_check 歷史）
  - 設計決策頻率統計（透過 adr 查詢）
```

### 3.3 Self-Reflection 整合

```
每次 design session 結束後：
  - 記錄哪些步驟順暢、哪些卡住
  - 自動更新 skill 的引導流程
  - 符合 self-reflection skill 的「持續學習迴圈」
```

---

## 📐 設計原則

1. **零核心修改** — 不改 Smart MCP server source，純 skill 層級
2. **既有方法論優先** — Superpowers brainstorming + Harness Engineering 機械化，不引進新框架
3. **🟥🟨🟩 分級** — 強制/建議/跳過，彈性適應不同場景
4. **漸漸進式** — Phase 0 → 1 → 2 → 3，每階段獨立可交貨
5. **知識閉環** — 設計 → 歸檔 → 查詢 → 再設計，形成熵管理循環
