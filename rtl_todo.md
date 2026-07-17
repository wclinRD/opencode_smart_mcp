# Smart RTL Analyze — 實作 TODO

> 詳細架構請看 [rtl_plan.md](./rtl_plan.md)

---

## Phase 1 — MVP：RTL 結構解析

### 🔧 環境準備
- [ ] **安裝 slang** — 在 macOS/Linux 上 compile slang，或下載預編譯 binary
- [ ] **建立 slang wrapper** — `src/plugins/core/rtl/parser.mjs`（CLI 呼叫 + JSON output）
- [ ] **降級機制** — 找不到 slang 時，嘗試 `tree-sitter-verilog` 做 fallback（僅語法層）

### 📁 File Discovery
- [ ] **掃描 RTL 檔案** — 支援 `.v` / `.sv` / `.vhd` / `.vhdl`
- [ ] **解析 filelist.f** — 支援 `-f filelist.f` 格式（EDA 工具標準）
- [ ] **自動掃描模式** — 無 filelist 時，遞迴掃描目錄

### 🌳 Module Hierarchy
- [ ] **slang elaborate** — 呼叫 `slang --elaborate` 產出 JSON AST
- [ ] **Module tree 建構** — 從 AST 提取 module 定義 + instantiation
- [ ] **Port list 提取** — 每個 module 的 input/output/inout port + 寬度
- [ ] **Hierarchy 顯示** — 樹狀圖格式輸出（含檔案位置）

### 📊 Summary Statistics
- [ ] **計數統計** — module 數量、port 數量、instantiation 數量
- [ ] **File → Module 對應** — 哪個檔案定義了哪些 module
- [ ] **Top module 偵測** — 自動識別 top-level module（無人 instantiate 的）

### 🔌 Plugin 入口
- [ ] **rtl-analyze.mjs** — Plugin 入口（name/handler/inputSchema）
- [ ] **command: "analyze"** — 全面分析（MVP 核心）
- [ ] **command: "hierarchy"** — 單獨查詢 module hierarchy
- [ ] **command: "ports"** — 單獨查詢 port list
- [ ] **format 支援** — text / json / markdown

### 🧪 測試
- [ ] **建立測試 RTL** — 寫一組簡單的 Verilog 測試檔案（top + 2 sub-modules）
- [ ] **單元測試** — parser / graph-builder / queries 各自的 unit test
- [ ] **整合測試** — 端到端：RTL 目錄 → analyze → 驗證輸出

---

## Phase 2 — Signal Graph

### 🔗 Signal 連接
- [ ] **wire/reg 宣告提取** — 從 module body 提取所有 signal 宣告
- [ ] **Port connection map** — instantiation 的 port mapping（.port(signal) 格式）
- [ ] **跨 module 連接追蹤** — 從 top 往下追蹤 signal 如何在 module 間傳遞
- [ ] **command: "signals"** — 列出某個 module 的所有 signal
- [ ] **command: "trace"** — 追蹤特定 signal 的路徑（從 source 到 sink）

### ⚠️ 基本檢查
- [ ] **Unconnected port 偵測** — instantiation 有 port 未連接（潛在 bug）
- [ ] **Width mismatch** — port 寬度不一致的警告
- [ ] **Float signal** — 有 driver 無 load 或有 load 無 driver

### 📐 輸出增強
- [ ] **Mermaid 圖** — module hierarchy 的 Mermaid flowchart
- [ ] **Graphviz DOT** — signal graph 的 DOT 格式（可渲染成圖片）
- [ ] **format: "mermaid"** — 直接輸出可貼到 Markdown 的 Mermaid 程式碼

---

## Phase 3 — Design Intelligence

### 🏭 PDK 整合
- [ ] **SKY130 cell index** — 內建 sky130_fd_sc_hd/hs/lp 的 cell 列表
- [ ] **Cell mapping 建議** — 根據 module 特性（comb/seq/面积優先）建議 cell library
- [ ] **command: "pdk"** — 查詢 PDK cell mapping
- [ ] **GF180MCU 支援** — 新增 GF180MCU 的 cell index

### ⏱️ Constraint 驗證
- [ ] **SDC port 比對** — 列出所有 top-level port，標示缺少 constraint 的
- [ ] **command: "lint"** — 驗證 constraint 完整性
- [ ] **跟 smart_eda_search 整合** — 搜尋 SDC 最佳實踐

### 🔍 DFT 分析
- [ ] **Scan chain 偵測** — 識別 scan flip-flop 和 scan chain 結構
- [ ] **DFT rule check** — 基本 DFT 規則（clock gating、reset 結構）
- [ ] **command: "dft"** — DFT 結構分析

### 🤝 跟 smart_eda_search 協作
- [ ] **設計摘要 → 知識查詢** — rtl_analyze 產出摘要 → 自動觸發 eda_search 搜尋相關 FAQ
- [ ] **Troubleshoot flow** — 使用者描述問題 → rtl_analyze 分析設計 → eda_search 搜尋解決方案
- [ ] **PDK 聯合查詢** — rtl_analyze 的 module 特性 → eda_search 的 PDK cell 推薦

---

## 📋 優先順序總覽

```
Week 1-2: Phase 1 MVP
  └── slang 安裝 + file discovery + module hierarchy + plugin 入口

Week 3-4: Phase 1 完善
  └── 統計 + file-module 對應 + 測試 + format 支援

Week 5-6: Phase 2
  └── signal graph + trace + 基本檢查 + Mermaid 輸出

Week 7+: Phase 3
  └── PDK mapping + constraint 驗證 + DFT + eda_search 整合
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
