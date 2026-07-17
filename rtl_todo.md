# Smart RTL Analyze — 實作 TODO

> 詳細架構請看 [rtl_plan.md](./rtl_plan.md)

---

## Phase 1 — MVP：RTL 結構解析 ✅ 完成

> **完成日期**：2026-07-17  |  **Commit**：b0d4784

### 🔧 環境準備
- [x] **安裝 slang** — slang v11.0.0 compile 完成，安裝於 `~/bin/slang`
- [x] **建立 slang wrapper** — `src/plugins/core/rtl/parser.mjs`（CLI 呼叫 + `--ast-json` output）
- [x] **降級機制** — 找不到 slang 時，自動降級到 regex fallback（支援 module + port + instance 解析）

### 📁 File Discovery
- [x] **掃描 RTL 檔案** — 支援 `.v` / `.sv` / `.vhd` / `.vhdl`
- [x] **解析 filelist.f** — 支援 `-f filelist.f` 格式（EDA 工具標準）
- [x] **自動掃描模式** — 無 filelist 時，遞迴掃描目錄

### 🌳 Module Hierarchy
- [x] **slang elaborate** — 呼叫 `slang --ast-json` 產出 JSON AST
- [x] **Module tree 建構** — 從 AST 提取 module 定義 + instantiation
- [x] **Port list 提取** — 每個 module 的 input/output/inout port + 寬度
- [x] **Hierarchy 顯示** — 樹狀圖格式輸出（含檔案位置）

### 📊 Summary Statistics
- [x] **計數統計** — module 數量、port 數量、instantiation 數量
- [x] **File → Module 對應** — 哪個檔案定義了哪些 module
- [x] **Top module 偵測** — 自動識別 top-level module（無人 instantiate 的）

### 🔌 Plugin 入口
- [x] **rtl-analyze.mjs** — Plugin 入口（name/handler/inputSchema）
- [x] **command: "analyze"** — 全面分析（MVP 核心）
- [x] **command: "hierarchy"** — 單獨查詢 module hierarchy
- [x] **command: "ports"** — 單獨查詢 port list
- [x] **format 支援** — text / json / markdown

### 🧪 測試
- [x] **建立測試 RTL** — `/tmp/test-rtl/`：top.v + cpu_core.v + alu.v + reg_file.v
- [x] **單元測試** — 通過基本驗證
- [x] **整合測試** — 端到端測試通過

---

## Phase 1.5 — slang v11 AST 整合 ✅ 完成

> **完成日期**：2026-07-17  |  **slang 版本**：v11.0.0

### 🔬 研究結論

slang v11 `--ast-json` 的 AST 格式與預期不同：
- 預期：`{ modules: [...] }` flat module list
- 實際：`{ design: { members: [...] } }` nested elaborated instance tree
- **需要完全重寫 `buildFromSlang()`** 才能正確解析 v11 AST

### ✅ 整合價值

| 面向 | Regex Fallback | slang v11 AST |
|------|---------------|---------------|
| Port connection mapping | ❌ | ✅ **完整 .port(signal)** |
| Wire/reg 宣告 | ❌ | ✅ **所有 signal 宣告 + type** |
| Assign/always 邏輯 | ❌ | ✅ **完整 AST** |
| 跨 module signal trace | ❌ | ✅ 可追蹤 signal |
| Type checking | ❌ | ✅ 每個 expression 有 type |

### 📋 整合任務

- [x] **研究 v11 AST 結構** — 分析 `design.members` tree，找出 module/instance/port 的正確 path
- [x] **重寫 `buildFromSlang()`** — 依照 v11 實際 AST 結構 traversal
- [x] **新增 Port Connection Map** — 從 `connections` 欄位提取 `.port(signal)` mapping
- [x] **新增 Signal 宣告提取** — 從 `body.members` 提取所有 Net/Variable 宣告
- [x] **測試驗證** — 用 `/tmp/test-rtl/` 驗證 slang 整合後的結果
- [x] **更新 `graph-builder.mjs`** — 加入 v11 AST traversal 邏輯

### 📁 參考文件

- `rtl_plan.md` §7 — slang v11 AST 結構與比較表
- `/tmp/slang-ast.json` — slang v11 實際 AST 範例（test RTL project）

---

## Phase 2 — Signal Graph ✅ 完成

> **完成日期**：2026-07-17

### 🔗 Signal 連接
- [x] **wire/reg 宣告提取** — 從 module body 提取所有 signal 宣告
- [x] **Port connection map** — instantiation 的 port mapping（.port(signal) 格式）
- [x] **跨 module 連接追蹤** — 從 top 往下追蹤 signal 如何在 module 間傳遞
- [x] **command: "signals"** — 列出某個 module 的所有 signal
- [x] **command: "trace"** — 追蹤特定 signal 的路徑（從 source 到 sink）

### ⚠️ 基本檢查
- [x] **Unconnected port 偵測** — instantiation 有 port 未連接（潛在 bug）
- [x] **Width mismatch** — port 寬度不一致的警告
- [x] **Float signal** — 有 driver 無 load 或有 load 無 driver（基於 port connection 分析）

### 📐 輸出增強
- [x] **Mermaid 圖** — module hierarchy 的 Mermaid flowchart（`format: "mermaid"`）
- [x] **Graphviz DOT** — module hierarchy 的 DOT 格式（`format: "dot"`）
- [x] **format: "mermaid"** — hierarchy 和 check 命令均支援
- [x] **format: "dot"** — hierarchy 和 check 命令均支援（Graphviz DOT 格式）

---

## Phase 3 — Design Intelligence ✅ 完成

> **完成日期**：2026-07-17

### ⏱️ Constraint 驗證 ✅
- [x] **SDC parser** — 解析 .sdc 檔案（create_clock, set_input_delay, set_output_delay, etc.）
- [x] **SDC file 自動掃描** — 遞迴掃描目錄找 .sdc 檔案
- [x] **command: "lint"** — 比對 RTL top-level port 與 SDC constraint，標示缺少 constraint 的 port
- [x] **支援多格式** — text / json / markdown 輸出
- [x] **Name mismatch 偵測** — SDC 與 RTL port 名稱不一致時正確標示
- [x] **Fix suggestions** — 為每個 unconstrained port 自動生成 SDC template

### 🏭 PDK 整合 (deprioritized)
- [ ] PDK cell library query (→ smart_eda_search)

---

## Phase 4 — Advanced Analysis ✅ 完成

> **完成日期**：2026-07-17

### ⏱️ CDC 偵測 ✅
- [x] **Clock domain detection** — 自動辨識 always @posedge/negedge 的 clock domain
- [x] **Signal-domain assignment** — 追蹤每個 signal 屬於哪個 clock domain
- [x] **Crossing detection** — 偵測跨時鐘域的 signal 連接
- [x] **Synchronizer pattern detection** — 檢測 2-FF chain、_sync suffix、handshake
- [x] **CDC report + fix suggestions** — 產生 CDC 報告 + 2-FF synchronizer 程式碼
- [x] **command: "cdc"** — Clock Domain Crossing 分析

### 🔍 Lint Rule Engine ✅
- [x] **15 built-in rules** — naming (5), style (3), completeness (2), latch (1), reset (2), width (1), sensitivity (1)
- [x] **Custom rules** — 透過 .rtl-lint.json 輸入自訂規則
- [x] **Severity filtering** — 可過濾 error/warning/info
- [x] **Violation grouping** — 按 category 分組顯示
- [x] **command: "rules"** — 可配置 lint 規則執行

### ⚙️ Synthesis 整合 ✅
- [x] **Yosys integration** — 偵測 Yosys 可用時執行真正 synthesis
- [x] **Fallback analysis** — 無 Yosys 時用 regex 估算資源
- [x] **Resource utilization** — Regs、Wires、Ports、Estimated LUTs
- [x] **Cell type breakdown** — 顯示各類 cell 數量
- [x] **command: "synth"** — Synthesis 資源分析

---

## 📋 優先順序總覽

```
Week 1-2: Phase 1 MVP ✅ 完成 (commit b0d4784)
  └── slang 安裝 + file discovery + module hierarchy + plugin 入口

Week 3: Phase 1.5 — slang v11 AST 整合 ✅ 完成
  └── 重寫 buildFromSlang() + port connection map + signal extraction

Week 4: Phase 2 — Signal Graph ✅ 完成 (2026-07-17)
  └── signals command + trace command + check command (unconnected/width/float)
  └── Mermaid + DOT 輸出格式

Week 5+: Phase 3
  └── Constraint 驗證 ✅ 完成 (2026-07-17)
     └── SDC parser + command: "lint" + text/json/markdown 輸出
  └── DFT 分析
  └── eda_search 協作
```

---

## 🎯 驗收標準（MVP）

完成 Phase 1 後，應能：

```
✅ 執行 smart_rtl_analyze(command:"analyze", root:"/path/to/rtl")
   → 正確顯示 module hierarchy tree
   → 正確列出每個 module 的 port
   → 正確顯示 file → module 對應

✅ 執行 smart_rtl_analyze(command:"hierarchy", target:"cpu_core")
   → 顯示 cpu_core 的子 module 階層

✅ 執行 smart_rtl_analyze(command:"ports", target:"alu")
   → 顯示 alu 的所有 input/output port + 寬度

✅ 在無 slang 的環境下降級到 tree-sitter-verilog
   → 雖然功能受限但不 crash

✅ 所有測試通過
```
