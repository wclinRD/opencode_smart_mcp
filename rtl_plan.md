# Smart RTL Analyze — 架構規劃

> **目標**：建立 EDA 領域的 RTL 程式碼理解引擎，讓 agent 能「看懂」使用者的硬體設計。

---

## 1. 定位與邊界

```
┌─────────────────────────────────────────────────────────┐
│                   Smart MCP EDA 生態系                    │
│                                                          │
│  smart_eda_search          smart_rtl_analyze（新）        │
│  ┌──────────────────┐      ┌──────────────────────┐      │
│  │ 搜尋 EDA 知識     │      │ 理解你的 RTL 設計     │      │
│  │ · 論文/GitHub     │◄────►│ · module hierarchy   │      │
│  │ · 社群 FAQ        │ 協作  │ · signal graph       │      │
│  │ · PDK index       │      │ · port connection    │      │
│  │ · Troubleshoot    │      │ · constraint mapping │      │
│  └──────────────────┘      └──────────────────────┘      │
│                                                          │
│  smart_lsp                   smart_rules                  │
│  (TypeScript/JS LSP)        (專案規則)                    │
└─────────────────────────────────────────────────────────┘
```

### 職責邊界

| 工具 | 職責 | 不做 |
|------|------|------|
| `smart_eda_search` | 從外部來源搜尋 EDA 知識 | 不解析使用者的 RTL code |
| `smart_rtl_analyze` | 解析使用者的 RTL code，產出結構化知識 | 不搜尋外部來源（委託 eda_search） |
| `smart_lsp` | 軟體語言的 LSP（JS/TS/Python） | 不做 RTL 分析 |

---

## 2. 核心能力（MVP → V2 → V3）

### Phase 1 — MVP：RTL 結構解析

```
輸入：RTL 專案目錄（含 .v / .sv / .vhd 檔案）
輸出：
  ├── module hierarchy tree
  ├── 每個 module 的 port list + direction
  ├── instantiation map（誰 instantiate 誰）
  └── file → module 對應表
```

### Phase 2 — Signal Graph

```
在 MVP 基礎上加：
  ├── wire/reg/tri 宣告列表
  ├── signal 跨 module 連接追蹤
  ├── 當前 module 的 input/output trace
  └── 識別 unconnected ports（潛在 bug）
```

### Phase 3 — Design Intelligence

```
在 Phase 2 基礎上加：
  ├── PDK cell mapping（哪個 module 用了哪些 cell）
  ├── SDC constraint 驗證（port 是否都有 timing constraint）
  ├── DFT scan chain 結構分析
  └── 跟 smart_eda_search 聯合查詢（設計問題 → 知識建議）
```

---

## 3. 技術架構

### 3.1 RTL Parser 選擇

| Parser | 優點 | 缺點 | 適合 |
|--------|------|------|------|
| **slang** (MikePopoloski/slang) | 最完整的 SystemVerilog parser，支援 elaborate（解析 instantiation） | C++ binary，需 compile | ✅ MVP 首選 |
| **verilator** | 业界標準，lint + simulation | 主要做 lint，不做完整 elaboration | 輔助 lint check |
| **yosys** | 開源 synthesis，可提取設計結構 | 太重，只為了解析不划算 | Phase 3 做 mapping |
| **tree-sitter-verilog** | 純 JS，無需 compile | 只做語法解析，不做語意分析 | 輔助 code navigation |

**決策**：MVP 用 **slang** 做核心 parser（最完整），tree-sitter-verilog 做 fallback（輕量場景）。

### 3.2 資料流

```
使用者 RTL 專案
       │
       ▼
┌─────────────────┐
│  File Discovery  │  掃描 .v / .sv / .vhd / filelist.f
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  RTL Parser      │  slang elaborate（解析 module + instantiation）
│  (slang binary)  │  產出 AST JSON
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Graph Builder   │  從 AST 建立：
│  (Node.js)       │  · ModuleHierarchyGraph
│                  │  · SignalGraph
│                  │  · PortConnectionMap
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Query Engine    │  支援查詢：
│  (Node.js)       │  · getHierarchy()
│                  │  · traceSignal(name)
│                  │  · getModulePorts(name)
│                  │  · findUnconnected()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Output Format   │  text / json / markdown
│                  │  + 可選：Mermaid 圖、Graphviz DOT
└─────────────────┘
```

### 3.3 Plugin 結構

```
src/plugins/core/
├── rtl-analyze.mjs              # Plugin 入口（name/handler/inputSchema）
├── rtl/                          # RTL 分析子目錄（跟 eda/ 同層）
│   ├── parser.mjs               # slang CLI wrapper
│   ├── graph-builder.mjs        # AST → Graph 轉換
│   ├── queries.mjs              # 查詢 API
│   ├── format.mjs               # 輸出格式化
│   └── lib/
│       ├── module-hierarchy.mjs  # Module tree 資料結構
│       ├── signal-graph.mjs      # Signal 連接圖
│       └── port-map.mjs          # Port connection map
```

---

## 4. Input/Output Schema

### 4.1 Input Schema

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "enum": ["analyze", "hierarchy", "signals", "ports", "lint", "trace"],
      "description": "分析動作"
    },
    "root": {
      "type": "string",
      "description": "RTL 專案根目錄（default: .）"
    },
    "target": {
      "type": "string",
      "description": "目標 module 名稱（hierarchy/signals/ports/trace 使用）"
    },
    "signal": {
      "type": "string",
      "description": "要追蹤的 signal 名稱（trace 使用）"
    },
    "format": {
      "type": "string",
      "enum": ["text", "json", "markdown", "mermaid"],
      "description": "輸出格式"
    },
    "filelist": {
      "type": "string",
      "description": "Verilog file list 路徑（default: 自動掃描）"
    }
  }
}
```

### 4.2 Output 範例

#### `command: "analyze"` — 全面分析

```
📋 RTL Design Analysis
━━━━━━━━━━━━━━━━━━━━━

📂 Scope: /path/to/project
📝 Files: 12 Verilog files
🔧 Parser: slang v0.9.0

🌳 Module Hierarchy (3 levels)
├── top
│   ├── cpu_core (cpu_core.v)
│   │   ├── alu (alu.v)
│   │   └── reg_file (reg_file.v)
│   ├── memory_ctrl (mem_ctrl.v)
│   └── bus_arbiter (bus_arbiter.v)

📊 Summary
  Modules: 5
  Total ports: 47
  Instantiations: 6
  Top-level inputs: 8
  Top-level outputs: 5
```

#### `command: "trace"` — Signal 追蹤

```
🔍 Signal Trace: data_out
━━━━━━━━━━━━━━━━━━━━━━━━━

top.data_out
  ← alu.result[31:0]  (alu.v:42)
    ← alu.op_a[31:0]  ← cpu_core.alu_a
      ← reg_file.rdata1[31:0]  (reg_file.v:18)
        ← reg_file.raddr1[4:0]  ← cpu_core.rs1
```

---

## 5. 跟 smart_eda_search 的整合場景

### 場景 1：設計問題診斷

```
使用者："我的 design 在 Innovus 裡 congestion 太高"

Step 1: smart_rtl_analyze → 分析 module hierarchy + signal graph
        → 發現 bus_arbiter 有 32-bit 寬匯流排跨多個 region

Step 2: smart_eda_search(action:"troubleshoot") → 搜尋 congestion FAQ
        → 找到 Cadence community 的最佳實踐

Step 3: 兩者結合 → 針對具體設計的建議
```

### 場景 2：PDK Cell 選擇

```
使用者："幫我選適合的 standard cell library"

Step 1: smart_rtl_analyze → 分析 design 的 module 特性
        → 發現大量 combinational logic，面積敏感

Step 2: smart_eda_search(action:"pdk") → 搜尋 PDK cell index
        → 找到 SKY130 的 area-optimized cells

Step 3: 結合 → 建議 cell mapping 方案
```

### 場景 3：Constraint 驗證

```
使用者："幫我檢查 SDC constraint 是否完整"

Step 1: smart_rtl_analyze(command:"lint") → 列出所有 input/output port
Step 2: smart_eda_search(action:"tool") → 搜尋 SDC 最佳實踐
Step 3: 比對 → 缺少 constraint 的 port 清單
```

---

## 6. 開源 PDK 支援

| PDK | 說明 | 支援時程 |
|-----|------|---------|
| SkyWater SKY130 | Google 開源 130nm | MVP |
| GlobalFoundries GF180MCU | 開源 180nm | Phase 2 |
| ASAP7 | 學術用 7nm | Phase 3 |

MVP 階段支援 SKY130 的 basic cell library mapping：
- `sky130_fd_sc_hd` (high-density)
- `sky130_fd_sc_hs` (high-speed)
- `sky130_fd_sc_lp` (low-power)

---

## 7. 部署考量

### slang binary

- 需要 C++ compile（或用預編譯 binary）
- macOS/Linux 支援，Windows 需 WSL
- 作為 optional dependency：找不到 slang 時降級到 tree-sitter-verilog（僅語法解析）

### 效能

- 解析 100 個 RTL 檔案預計 < 5 秒（slang 速度很快）
- Graph query（trace signal）預計 < 100ms
- 結果可 cache（同專案無變更 = 零成本重複查詢）

### 與現有工具的關係

```
smart_rtl_analyze 處理 RTL 語言
smart_lsp 處理 TypeScript/JS/Python
smart_grep 處理所有語言的文字搜尋

三者互補，不衝突。
```
