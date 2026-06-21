# ✅ 設計專案能力強化待辦清單
## Harness Engineering + Superpowers 整合

---

## Phase 0：基礎建設 ✅

### ✅ 0.1 安裝 d2 渲染引擎
- [x] `brew install d2` — v0.7.1
- [x] 驗證：`echo 'x -> y' | d2 -` 正確輸出 SVG
- [x] 確認 `which d2` — `/opt/homebrew/bin/d2`

### ✅ 0.2 驗證既有工具
- [x] `ssr(diagram)` — 支援 flowchart/sequence/class/ER
- [x] `ssr(adr)` — 完整 ADR lifecycle
- [x] `ssr(design_doc)` — Superpowers 標準格式
- [x] `ssr(consistency_check)` — Harness Engineering 機械化一致性
- [x] `ssr(planner)` — 計畫展開
- [x] `ssr(kg)` — 知識圖譜
- [x] `ssr(obsidian_write)` — Wiki 寫入

### ✅ 0.3 Wiki 設計目錄
- [x] 建立 `00-設計/`（在 pCloud vault 中）
- [x] 建立 `00-設計/README.md` 索引頁

---

## Phase 1：system-design skill ✅

### ✅ 1.1 Skill 目錄結構
- [x] `~/.config/opencode/skills/system-design/`
- [x] `templates/` + `templates/diagrams/`
- [x] `scripts/`

### ✅ 1.2 SKILL.md（220 行）
- [x] YAML frontmatter（name, description, triggers, dependencies）
- [x] **Stage 1** — Superpowers Brainstorming（smart_think beam + design_doc）
- [x] **Stage 2** — 視覺化（diagram sub-tool + d2 render）
- [x] **Stage 3** — Harness Engineering 機械化記錄（adr）
- [x] **Stage 4** — 🟥🟨🟩 設計品質閘
- [x] **Stage 5** — Superpowers Plan Cycle（planner + goal）
- [x] **Stage 6** — Harness Engineering 歸檔（obsidian_write + kg）
- [x] 快速指令、templates 索引、與 project-evaluation 整合

### ✅ 1.3 Templates
- [x] `design_doc_superpowers.md` — 含權衡分析矩陣
- [x] `adr_harness.md` — 含 🟥🟨🟩 分級
- [x] `diagrams/context_view.d2` — 可渲染
- [x] `diagrams/container_view.d2` — 可渲染
- [x] `diagrams/component_view.d2` — 可渲染

### ✅ 1.4 渲染腳本
- [x] `scripts/render-diagram.sh` — 支援 stdin / file、SVG/PNG 輸出

### ✅ 1.5 端到端測試
- [x] d2 模板全部可渲染（3/3 PASS）
- [x] install.sh 9/9 檢查通過
- [x] Skill 檔案格式符合 opencode 規範（含 frontmatter）

---

## Phase 2：🟥🟨🟩 品質閘自動化 🔄

### 2.1 設計品質閘（SKILL.md Stage 4 已定義）
- [x] 🟥 C1: design_doc.goal 不為空
- [x] 🟥 C2: design_doc.context 不為空
- [x] 🟥 C3: 重大決策有 ADR
- [x] 🟨 C4: diagram 存在且一致
- [x] 🟨 C5: 方案權衡分析完整
- [x] 🟩 C6: 細節完善度（可跳過）
- [ ] **待強化**：品質閘可透過 smart_run 自動執行（而非 LLM 手動判斷）

### 2.2 自動歸檔 pipeline
- [x] Stage 6 已定義 obsidian_write + kg 歸檔
- [ ] **待強化**：自動更新 `00-設計/README.md` 索引
- [ ] **待強化**：設計完成後自動觸發 project-evaluation Phase 3

---

## Phase 3：跨專案設計模式庫 🔄

### 3.1 設計知識反哺
- [ ] **待強化**：wiki-query 整合 — 設計時自動查詢相似案例
- [ ] **待強化**：新設計啟動時顯示「相關歷史設計」提示

### 3.2 模式提取
- [ ] **待強化**：從 wiki-lint 分析常見架構模式
- [ ] **待強化**：從 consistency_check 歷史提取反模式

### 3.3 Self-Reflection 整合
- [ ] **待強化**：design session 結束後自動回饋到 self-reflection

---

## 🔧 部署與可重複性 ✅

### 專案整合
- [x] skill 原始碼位於 `~/opencode/dev/smart/design-system/src/`
- [x] scripts 位於 `~/opencode/dev/smart/design-system/scripts/`
- [x] 專案 README.md 含結構說明與使用方式

### 安裝腳本
- [x] `install.sh` — 一鍵部署
- [x] 支援 `--dry-run` / `--force` 參數
- [x] 4 步驟：d2 安裝 → skill 部署 → wiki 設定 → 驗證
- [x] 安裝後 9/9 檢查全 PASS

---

## 📊 進度總表

| Phase | 項目 | 狀態 | 備註 |
|-------|------|:----:|------|
| P0 | Install d2 | ✅ | v0.7.1 |
| P0 | 驗證既有工具 | ✅ | 全通 |
| P1 | SKILL.md | ✅ | 220 行，含 frontmatter |
| P1 | Templates (5) | ✅ | doc/ADR/d2 x3 |
| P1 | render-diagram.sh | ✅ | stdin/file, SVG/PNG |
| P1 | 端到端測試 | ✅ | 9/9 PASS |
| P2 | 🟥🟨🟩 品質閘 | 🟡 | 已定義，待自動化 |
| P2 | 自動歸檔 | 🟡 | 已定義，待自動索引 |
| P3 | 設計知識反哺 | ⬜ | 長期 |
| P3 | 模式提取 | ⬜ | 長期 |
| **部署** | 專案整合 + install.sh | ✅ | 一鍵可重複安裝 |

> **圖例**：⬜ 未開始 🟡 待強化 ✅ 完成

---

## 📝 已知限制

1. **Session 級 skill 註冊**：`system-design` skill 已正確部署在
   `~/.config/opencode/skills/system-design/SKILL.md`，但目前的 session
   啟動時已快取 skill 列表。新的 session 中 skill 會自動出現在可用清單中。

2. **品質閘自動執行**：目前 🟥🟨🟩 檢查由 LLM 依 SKILL.md 指引手動執行，
   未來可強化成 smart_run 自動化 pipeline。

3. **wiki 路徑依賴**：install.sh 會自動偵測 vault 路徑，但 pCloud/CloudMounter
   同步可能造成延遲。若 wiki 目錄未出現，手動執行 `mkdir -p "$VAULT/00-設計"`。
