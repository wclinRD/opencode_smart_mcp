# code-review-graph 整合計畫

## 📋 專案概述

**目標**：將 code-review-graph 的核心能力整合到 Smart MCP，提升程式碼理解、影響分析和 token 效率。

**整合策略**：混合策略，優先強化現有工具，必要時新增工具。

**預期效益**：
- Token 節省：82-100x（現有 10-20x）
- 語言支援：30+ 種（現有 5-10 種）
- 影響分析準確度：+15-20%
- 增量更新：< 2 秒（新增能力）

---

## 🏗️ 架構設計

### 整合層架構

```
smart_code_graph.mjs（高階整合層）
│
├── 強化現有工具
│   ├── impact-flow.mjs（+ Tree-sitter + blast radius）
│   ├── arch-overview.mjs（+ 社群偵測）
│   ├── code-call-graph.mjs（+ Tree-sitter）
│   └── code-impact.mjs（+ 風險評分）
│
└── 新增工具
    ├── smart_tree_sitter.mjs（核心解析引擎）
    ├── smart_incremental.mjs（增量更新引擎）
    ├── smart_blast_radius.mjs（爆炸半徑分析）
    ├── smart_risk_score.mjs（風險評分）
    └── smart_community.mjs（社群偵測）
```

### 工具層級

| 層級 | 工具類型 | 執行方式 | 適用場景 |
|------|----------|----------|----------|
| Layer 0 | core | 直接呼叫 | 高頻率、低延遲需求 |
| Layer 1 | standard | 經 smart_run | 中頻率、複雜邏輯 |
| Layer 2 | subagent | 經 task | 低頻率、高計算量 |

---

## 📅 Phase 1：核心整合（1-2 月）

### 1.1 強化 impact-flow.mjs

**現狀分析**：
- 目前使用 CKG + LSP 進行影響分析
- 支援 diff、files、symbols 三種輸入模式
- 預測受影響的測試檔案

**整合方案**：
```javascript
// 新增參數
impact-flow.mjs({
  diff: "...",
  files: [...],
  symbols: [...],
  useTreeSitter: true,      // 新增：使用 Tree-sitter 解析
  blastRadius: true,        // 新增：blast radius 分析
  riskScoring: true,        // 新增：風險評分
  depth: 2,                 // 現有：影響傳播深度
  predictTests: true,       // 現有：測試預測
})
```

**預期效果**：
- 影響分析更全面（追蹤所有 callers、dependents、tests）
- 新增風險評分（HIGH/MEDIUM/LOW）
- 改進測試預測準確度

### 1.2 新增 smart_tree_sitter.mjs

**核心功能**：
```javascript
smart_tree_sitter({
  command: "parse",           // parse | languages | stats
  file: "src/index.ts",      // 目標檔案
  root: ".",                  // 專案根目錄
  language: "typescript",     // 語言（可選，自動偵測）
  nodeTypes: ["function", "class", "import"],  // 提取的節點類型
})
```

**功能範圍**：
- Tree-sitter AST 解析
- 支援 30+ 種語言
- 提取函數、類別、匯入、呼叫等結構
- 語言自動偵測

**技術考量**：
- 使用 `tree-sitter` npm 套件
- 支援增量解析
- 快取機制避免重複解析

### 1.3 整合評估

**需要評估的項目**：
1. Tree-sitter 與現有 LSP 的整合方式
2. 效能影響（啟動時間、記憶體使用）
3. 向後相容性確保

---

## 📅 Phase 2：功能擴展（2-3 月）

### 2.1 強化 arch-overview.mjs

**現狀分析**：
- 目前提供基礎架構概覽
- 基於檔案結構和匯入關係

**整合方案**：
```javascript
arch-overview.mjs({
  root: ".",
  includeCommunity: true,    // 新增：社群偵測
  communityAlgorithm: "leiden",  // 新增：演算法選擇
  resolution: 1.0,           // 新增：解析度參數
})
```

**新增功能**：
- Leiden 社群偵測演算法
- 跨社群耦合分析
- 架構弱點偵測

### 2.2 新增 smart_incremental.mjs

**核心功能**：
```javascript
smart_incremental({
  command: "update",         // update | watch | status
  root: ".",
  files: ["src/index.ts"],   // 指定檔案（可選）
  watch: false,              // 監看模式
  debounceMs: 1000,          // 防抖時間
})
```

**功能範圍**：
- 增量更新（只解析變更檔案）
- 監看模式（檔案變更自動更新）
- SHA-256 雜湊檢查（避免重複解析）
- < 2 秒更新 2,900 檔案

**技術考量**：
- 使用 `chokidar` 進行檔案監看
- 背景執行避免阻塞
- 狀態持久化（.code-review-graph/）

### 2.3 強化 code-call-graph.mjs

**整合方案**：
```javascript
code-call-graph.mjs({
  file: "src/index.ts",
  symbol: "main",
  direction: "both",         // callers | callees | both
  depth: 3,
  useTreeSitter: true,       // 新增：使用 Tree-sitter
  maxTokens: 5000,           // 新增：token 預算
})
```

**預期效果**：
- 更準確的呼叫圖（Tree-sitter vs regex）
- 支援更多語言
- token 預算控制

---

## 📅 Phase 3：進階功能（3-6 月）

### 3.1 新增 smart_blast_radius.mjs

**核心功能**：
```javascript
smart_blast_radius({
  files: ["src/auth.ts"],
  symbols: ["login", "authenticate"],
  depth: 2,
  includeTests: true,
  riskScoring: true,
  format: "text",            // text | json
})
```

**功能範圍**：
- 爆炸半徑分析（所有 callers、dependents、tests）
- 風險評分（基於耦合度、測試覆蓋率）
- 影響範圍視覺化
- 測試缺口偵測

### 3.2 新增 smart_risk_score.mjs

**核心功能**：
```javascript
smart_risk_score({
  command: "analyze",        // analyze | suggest | report
  diff: "git diff text",
  files: ["src/auth.ts"],
  threshold: "medium",       // high | medium | low
  format: "text",
})
```

**功能範圍**：
- PR 審查風險評分
- 基於變更範圍、耦合度、測試覆蓋率
- 提供修復建議
- GitHub Action 整合

### 3.3 新增 smart_community.mjs

**核心功能**：
```javascript
smart_community({
  command: "detect",         // detect | analyze | suggest
  root: ".",
  algorithm: "leiden",
  resolution: 1.0,
  minCommunitySize: 5,
  format: "text",
})
```

**功能範圍**：
- 社群偵測（Leiden 演算法）
- 跨社群耦合分析
- 架構優化建議
- 社群分割（過大社群）

---

## 📅 Phase 4：文件與配置更新（與 Phase 1-3 並行）

### 4.1 Agent 配置文件更新

**更新目標**：確保所有 Agent 配置文件都包含 code-review-graph 整合的工具說明。

**需要更新的文件**：

| 文件 | 更新內容 | 優先順序 |
|------|----------|----------|
| `config/agents/smart-mcp.md` | 新增 core 工具 permission + Direct MCP tools 說明 | 高 |
| `config/agents/smart-hybrid.md` | 新增 core/standard 工具 + 工作流 + 工具規則 | 高 |
| `config/agents/smart-agent.md` | 新增 standard 工具 + Sub-tools 說明 | 中 |
| `config/agents/smart-small.md` | 新增精簡版工具說明（可選） | 低 |

### 4.2 smart-mcp.md 更新

**更新區域**：

1. **Permission 區域**（第 17-41 行）
   ```yaml
   # 🆕 code-review-graph 整合工具
   smart_tree_sitter: allow      # 🆕 Tree-sitter AST 解析引擎（30+ 語言）
   smart_incremental: allow      # 🆕 增量更新引擎（< 2 秒更新 2,900 檔案）
   ```

2. **Direct MCP tools 表格**（第 69-96 行）
   ```markdown
   | `smart_tree_sitter({command, file, root?, language?, nodeTypes?})` | 🆕 Tree-sitter AST 解析引擎。支援 30+ 種語言。`command:"parse"` 解析、`command:"languages"` 列出語言、`command:"stats"` 統計 |
   | `smart_incremental({command, root?, files?, watch?, debounceMs?})` | 🆕 增量更新引擎。`command:"update"` 增量更新、`command:"watch"` 監看、`command:"status"` 狀態。< 2 秒更新 2,900 檔案 |
   ```

3. **搜尋優先順序**（新增）
   ```
   🆕 程式碼結構：smart_tree_sitter（30+ 語言）> smart_lsp（型別 aware）
   🆕 影響分析：ssr(impact_flow) + ssr(smart_blast_radius) > smart_grep
   ```

### 4.3 smart-hybrid.md 更新

**更新區域**：

1. **Permission 區域**（第 17-41 行）
   ```yaml
   # 🆕 code-review-graph 整合工具
   smart_tree_sitter: allow      # 🆕 Tree-sitter AST 解析引擎（30+ 語言）
   smart_incremental: allow      # 🆕 增量更新引擎（< 2 秒更新 2,900 檔案）
   ```

2. **Direct MCP tools 表格**（第 173-200 行）
   ```markdown
   | `smart_tree_sitter({command, file, root?, language?, nodeTypes?})` | 🆕 Tree-sitter AST 解析引擎。支援 30+ 種語言。`command:"parse"` 解析、`command:"languages"` 列出語言、`command:"stats"` 統計 |
   | `smart_incremental({command, root?, files?, watch?, debounceMs?})` | 🆕 增量更新引擎。`command:"update"` 增量更新、`command:"watch"` 監看、`command:"status"` 狀態。< 2 秒更新 2,900 檔案 |
   ```

3. **Sub-tools 表格**（第 203-225 行）
   ```markdown
   | 🆕 code-review-graph | `smart_blast_radius`, `smart_risk_score`, `smart_community` |
   ```

4. **常用工作流速查**（第 384-396 行）
   ```markdown
   | 🆕 影響分析 | 🟢/🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(impact_flow)` → `ssr(smart_blast_radius)` → `smart_think({mode:"cit"})` 分析 → 回報影響範圍 |
   | 🆕 風險評分 | 🟢 | `smart_tree_sitter({command:"parse"})` → `ssr(smart_risk_score)` → `smart_think({mode:"cit"})` 評估 → 回報風險等級 |
   | 🆕 架構分析 | 🔴 | `smart_tree_sitter({command:"parse"})` → `ssr(arch_overview)` → `ssr(smart_community)` → `smart_deep_think({template:"analyze"})` → 回報架構建議 |
   | 🆕 增量更新 | 🟢 | `smart_incremental({command:"update"})` → `smart_incremental({command:"status"})` → 回報更新結果 |
   ```

5. **工具規則**（第 294-340 行）
   ```markdown
   ### code-review-graph 整合規則
   
   🆕 Tree-sitter 解析：
     - 新專案先用 smart_tree_sitter({command:"parse"}) 建立結構
     - 增量更新用 smart_incremental({command:"update"})
     - 大型檔案用 smart_tree_sitter({command:"parse", nodeTypes:["function"]}) 提取特定結構
   
   🆕 影響分析：
     - 變更前先用 ssr(impact_flow) 分析影響範圍
     - 高風險變更用 ssr(smart_blast_radius) 計算爆炸半徑
     - 結合 smart_think({mode:"beam"}) 進行多路徑分析
   
   🆕 風險評分：
     - PR 審查用 ssr(smart_risk_score) 評估風險
     - 根據風險等級決定審查深度
     - HIGH 風險→smart_think({mode:"beam"})、MEDIUM→smart_think({mode:"cit"})、LOW→直接通過
   
   🆕 社群偵測：
     - 架構分析用 ssr(smart_community) 偵測社群
     - 識別跨社群耦合和架構弱點
     - 結合 ssr(arch_overview) 提供優化建議
   ```

### 4.4 smart-agent.md 更新

**更新區域**：

1. **Permission 區域**（第 17-41 行）
   ```yaml
   # 🆕 code-review-graph 整合工具
   smart_tree_sitter: allow      # 🆕 Tree-sitter AST 解析引擎（30+ 語言）
   smart_incremental: allow      # 🆕 增量更新引擎（< 2 秒更新 2,900 檔案）
   ```

2. **Sub-tools 路由表格**（第 279-296 行）
   ```markdown
   | 🆕 code-review-graph | `smart_blast_radius`, `smart_risk_score`, `smart_community` |
   ```

3. **常用工作流速查**（第 308-320 行）
   ```markdown
   | 🆕 影響分析 | `smart_tree_sitter({command:"parse"})` → `ssr(impact_flow)` → `ssr(smart_blast_radius)` → `smart_think({mode:"cit"})` 分析 → 回報影響範圍 |
   | 🆕 風險評分 | `smart_tree_sitter({command:"parse"})` → `ssr(smart_risk_score)` → `smart_think({mode:"cit"})` 評估 → 回報風險等級 |
   | 🆕 架構分析 | `smart_tree_sitter({command:"parse"})` → `ssr(arch_overview)` → `ssr(smart_community)` → `smart_deep_think({template:"analyze"})` → 回報架構建議 |
   | 🆕 增量更新 | `smart_incremental({command:"update"})` → `smart_incremental({command:"status"})` → 回報更新結果 |
   ```

### 4.5 smart-small.md 更新（可選）

**更新區域**：

1. **Direct call 清單**（第 44-52 行）
   ```markdown
   | `smart_tree_sitter({file:"..."})` | 解析程式碼結構 |
   | `smart_incremental({command:"update"})` | 增量更新圖譜 |
   ```

2. **核心工作流**（第 59-64 行）
   ```markdown
   新專案：`smart_tree_sitter → smart_learn → smart_codebase_index`
   影響分析：`smart_tree_sitter → smart_run(impact_flow) → smart_run(blast_radius)`
   ```

---

## 🔧 技術實作

### 依賴管理

**新增依賴**：
```json
{
  "dependencies": {
    "tree-sitter": "^0.21.0",
    "tree-sitter-javascript": "^0.21.0",
    "tree-sitter-typescript": "^0.21.0",
    "tree-sitter-python": "^0.21.0",
    "chokidar": "^3.5.3",
    "igraph": "^0.11.0"
  }
}
```

**可選依賴**：
```json
{
  "optionalDependencies": {
    "tree-sitter-go": "^0.21.0",
    "tree-sitter-rust": "^0.21.0",
    "tree-sitter-java": "^0.21.0",
    "tree-sitter-c": "^0.21.0"
  }
}
```

### 配置管理

**新增配置選項**：
```javascript
// config/agents/smart-mcp.md 新增
## code-review-graph 整合

### 功能開關
- `CRG_ENABLE_TREE_SITTER`: 啟用 Tree-sitter 解析（預設：true）
- `CRG_ENABLE_INCREMENTAL`: 啟用增量更新（預設：true）
- `CRG_ENABLE_BLAST_RADIUS`: 啟用 blast radius 分析（預設：true）
- `CRG_ENABLE_RISK_SCORING`: 啟用風險評分（預設：false）
- `CRG_ENABLE_COMMUNITY`: 啟用社群偵測（預設：false）

### 效能設定
- `CRG_MAX_PARSE_DEPTH`: Tree-sitter 解析深度（預設：10）
- `CRG_INCREMENTAL_DEBOUNCE`: 增量更新防抖時間（預設：1000ms）
- `CRG_COMMUNITY_MIN_SIZE`: 最小社群大小（預設：5）
```

### 測試策略

**單元測試**：
- Tree-sitter 解析正確性
- 增量更新邏輯
- blast radius 計算
- 風險評分算法

**整合測試**：
- 與現有工具的整合
- 效能基準測試
- 向後相容性測試

**端對端測試**：
- 完整工作流程測試
- 多語言支援測試
- 大型程式碼庫測試

---

## 📊 效能基準

### 目標指標

| 指標 | 現狀 | 目標 | 提升 |
|------|------|------|------|
| Token 節省 | 10-20x | 82-100x | 5-8x |
| 語言支援 | 5-10 種 | 30+ 種 | 3-5x |
| 影響分析 F1 | 0.6-0.7 | 0.7-0.8 | 15-20% |
| 增量更新效能 | 無 | < 2 秒 | ∞ |
| 啟動時間 | < 1 秒 | < 2 秒 | +1 秒 |
| 記憶體使用 | < 100MB | < 200MB | +100MB |

### 效能優化策略

1. **Lazy Loading**：Tree-sitter 模組需要時才載入
2. **背景預載入**：啟動時背景預載入常用語言
3. **快取機制**：避免重複解析相同檔案
4. **增量更新**：只解析變更檔案

---

## 🚨 風險評估

### 高風險

| 風險 | 影響 | 機率 | 緩解措施 |
|------|------|------|----------|
| Tree-sitter 效能問題 | 啟動時間增加 | 中 | Lazy loading + 背景預載入 |
| 記憶體使用增加 | 系統不穩定 | 中 | 快取清理 + 記憶體監控 |
| 與現有工具衝突 | 功能異常 | 低 | 充分測試 + 向後相容 |

### 中風險

| 風險 | 影響 | 機率 | 緩解措施 |
|------|------|------|----------|
| 語言支援不完整 | 使用體驗差 | 中 | 漸進式新增語言 |
| 增量更新不穩定 | 資料不一致 | 中 | 狀態驗證 + 重新整理 |
| 配置複雜度增加 | 使用者困惑 | 中 | 簡化預設配置 |

### 低風險

| 風險 | 影響 | 機率 | 緩解措施 |
|------|------|------|----------|
| 依賴套件漏洞 | 安全風險 | 低 | 定期更新 + 安全掃描 |
| 文件不足 | 學習成本高 | 低 | 完整文件 + 範例 |

---

## 📈 成功指標

### 短期（1-2 月）

- [ ] Tree-sitter 解析引擎整合完成
- [ ] impact-flow.mjs 強化完成
- [ ] 單元測試覆蓋率 > 80%
- [ ] 效能基準測試通過
- [ ] smart-mcp.md 更新完成
- [ ] smart-hybrid.md 更新完成

### 中期（3-6 月）

- [ ] 增量更新功能完成
- [ ] blast radius 分析完成
- [ ] 風險評分功能完成
- [ ] 整合測試覆蓋率 > 70%
- [ ] smart-agent.md 更新完成
- [ ] smart-small.md 更新完成（可選）

### 長期（6-12 月）

- [ ] 社群偵測功能完成
- [ ] 多語言支援 > 20 種
- [ ] 使用者滿意度 > 4.0/5.0
- [ ] 社群貢獻者 > 5 人

---

## 📚 參考資源

### code-review-graph

- [GitHub Repository](https://github.com/tirth8205/code-review-graph)
- [文件](https://code-review-graph.com)
- [API 參考](https://code-review-graph.com/docs/api)

### Tree-sitter

- [官方文件](https://tree-sitter.github.io/tree-sitter/)
- [npm 套件](https://www.npmjs.com/package/tree-sitter)
- [語言支援](https://tree-sitter.github.io/tree-sitter/#available-parsers)

### Smart MCP

- [專案文件](./AGENTS.md)
- [工具清單](./config/tools/manifest.json)
- [現有工具](./src/plugins/)

---

## 📝 備註

### 整合原則

1. **最小化破壞**：強化現有工具，保持 API 相容
2. **漸進式整合**：分階段實施，每階段可獨立交付
3. **效能優先**：確保整合後效能不會顯著下降
4. **使用者導向**：以使用者體驗為中心設計

### 決策紀錄

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-07-21 | 採用混合策略 | 最小化風險，最大化效益 |
| 2026-07-21 | 優先強化現有工具 | 使用者無需學習新工具 |
| 2026-07-21 | 新增核心工具 | 全新能力需要獨立工具 |
| 2026-07-21 | 分四階段實施 | 包含文件更新，確保完整性 |

---

*最後更新：2026-07-21*
*版本：v1.1*
