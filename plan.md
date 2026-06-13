# smart_fast_apply 強化計畫

## 目標
將 smart_fast_apply 的編輯衝突率從 ~25% 降至 ~2.5%，透過 4 個階段的技術升級。

## 路線圖

```
Phase 0 (1天)  Phase 1 (4天)   Phase 2 (0.5天)  Phase 3 (2天)
┌──────────┐   ┌──────────┐   ┌──────────┐    ┌──────────┐
│ P4:      │ → │ P1:      │ → │ P2:      │ →  │ P3:      │
│ BlockDiff│   │Tree-sitter│   │d-m-patch │    │AST驗證   │
│ 0 dep    │   │+WASM dep │   │ 0 dep    │    │重用P1    │
└──────────┘   └──────────┘   └──────────┘    └──────────┘
```

## Phase 0：BlockDiff 新格式
- **實作時間**：1 天
- **新依賴**：無（使用現有 `extractSymbol()`）
- **預期效果**：衝突率 ↓10-15%

### 實作內容
1. 在 `inputSchema.format.enum` 加入 `block-diff`
2. 新增 `parseBlockDiff()` 解析器
3. Handler 中轉為 `applyHashline()` 呼叫
4. 更新 description 文件

## Phase 1：Tree-sitter AST 匹配層
- **實作時間**：4 天
- **新依賴**：`web-tree-sitter` + `tree-sitter-wasms`
- **預期效果**：衝突率 ↓40-50%

### 實作內容
1. `npm install web-tree-sitter tree-sitter-wasms`
2. 建立 `src/lib/ast-engine.mjs`
   - `initParser(lang)` — lazy WASM 載入
   - `locateSymbol(content, lang, name)` — AST 節點定位
   - `matchByAST(content, lang, searchBlock)` — AST-aware 區塊匹配
   - `validateSyntax(content, lang)` — 語法驗證
3. `fuzzyMatch()` 加入 L7 fallback（AST 匹配）
4. 5 語言測試（JS/TS/PY/RS/GO）

## Phase 2：Google diff-match-patch 降級
- **實作時間**：0.5 天
- **新依賴**：無（直接嵌入，單檔無依賴）
- **預期效果**：衝突率 ↓10-15%

### 實作內容
1. 複製 Google diff-match-patch 核心
2. `fuzzyMatch()` 最尾端加入 `patch_apply()` 嘗試

## Phase 3：AST 驗證 + 自動修復循環
- **實作時間**：2 天
- **新依賴**：重用 Phase 1 的 `ast-engine.mjs`
- **預期效果**：衝突率 ↓25-30%（從剩餘衝突中救回）

### 實作內容
1. apply 後自動 `validateSyntax()`
2. 常見錯誤自動修復（縮排、遺漏分號）
3. 最多 2 輪自修復
4. 修不了 → 回 LLM 重試

## 衝突率疊加效果
```
Phase 前:  25.0% 衝突
Phase 0:  → 12.5%（↓50%） BlockDiff 減少誤差
Phase 1:  →  6.2%（↓50%） AST 匹配解決空白/排版差異
Phase 2:  →  3.1%（↓50%） diff-match-patch 捕撈剩餘
Phase 3:  →  1.5%（↓50%） 自修復處理語法錯誤
```
