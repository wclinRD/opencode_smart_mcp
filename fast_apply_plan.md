# smart_fast_apply 設計分析與改進計畫

## 完成狀態

- ✅ **tree-sitter AST-aware editing** — `src/lib/tree-sitter-edit.mjs` 建立完成，整合到 `parseBlockDiff()`
- ✅ **LSP diagnostics 驗證 + auto-rollback** — `validate:"full"` 選項，apply 後自動 query diagnostics，error 時 rollback
- ✅ **Auto-fix loop** — 最多 3 輪 LSP code_action 自動修復，isPreferred quick fix 優先

### 1. 缺少真正的 AST-level editing（最大缺口）

**現狀：** `tryStructuralMatch()` 只做文字層級的近似——先把 `\s+` 壓縮成單空格再比較，或是找 symbol 名稱後用 regex 識別。不是真正的 AST 操作。

**問題：**
- 依賴 regex 解析 function/class 宣告，容易漏掉 arrow function、decorator、generic 等複雜語法
- `searchLines.length < 5` 時只看 50% line overlap，容易 false positive
- 無法處理 template literal、嵌套結構等

**業界更好的設計：**
| 專案 | 方法 |
|------|------|
| **Scissorhands** | 基於 tree-sitter 的 polyglot AST editor，LLM 透過 node ID 操作 |
| **CodeStruct (Amazon)** | 將 codebase 重構為 structured action space，LLM 操作 named AST entities 而非文字 |
| **Organon** | Tree-sitter code editing，stdin 輸入/輸出，無 daemon |
| **mcp-contextual-code-edit** | MCP server + tree-sitter，AST-aware editing 防止檔案損壞 |

**改進方向：** 用 tree-sitter 做真正的 node-level edit（找 symbol → 取代 node body），block-diff 的 `symbol` 欄位應該走 tree-sitter 而非 regex。

---

### 2. Fuzzy matching 降級管線太長，延遲高

**現狀：** 管線是 `L1 → L2 → L3 → L4 → L5 → structural(L7) → DMP → suggestNearest`，共 8 層。

**問題：**
- L6 已被移除（300-3000ms 延遲），但 L5 仍是 O(n×m)
- 每層都 `content.split('\n')` 重複切分，大檔案重複切分 5+ 次
- `tryStructuralMatch` 又把 search 和 content 各切一次

**Aider 的做法更簡潔：** 只有 2 層：精確匹配 → fuzzy (difflib.get_close_matches)，失敗就 fallback 到 diff_match_patch。

**改進方向：**
- 預計算一次 contentLines，在所有層級共享
- 考慮把 L1-L4 合併成單一 fuzzy 函式
- L7 structural 應該是第一選擇（對有 tree-sitter 的語言），而非最後手段

---

### 3. DMP fallback 風險高，缺乏語義驗證

**現狀：** `applyByDiffMatchPatch` 把 search/replace 交給 diff-match-patch，只做 `checkBalance()` 驗證。

**問題：**
- DMP 是字元級別 diff，不知道語法結構——可能產生語法錯誤的中間狀態
- `checkBalance()` 只檢查 `{}`、`[]`、`()` 配對，不驗證語法正確性
- 平衡檢查通過不代表代碼能 compile

**改進方向：**
- DMP 結果應該用 tree-sitter parse 驗證（能 parse = 合法）
- 加入 lint check 作為 post-apply validation
- 提供 `validate: "syntax"` 選項

---

### 4. Multi-occurrence 處理不夠智慧

**現狀：** 精確匹配時，如果 search text 出現多次，直接回傳 `conflict` 要 LLM 加更多 context。

**問題：**
- LLM 被迫重寫整个 SEARCH block，浪費 token
- 沒有利用上下文（前後行）來自動消歧

**改進方向：**
- 當 multi-occurrence 時，自動取最接近 `startLine` 的匹配
- 或自動附加前後 2 行 context 做 disambiguation 重試
- 回傳 conflict 時建議具體的 disambiguation 策略

---

### 5. Lazy marker 設計有 edge case

**現狀：** `expandLazyMarkers` 用 regex 偵測 marker，然後用 fuzzyMatch 逐段匹配。

**問題：**
- `LAZY_MARKER_RE` 需要匹配多種注釋語法，regex 容易漏
- 逐段匹配假設 markers 是 sequential 的——順序不對就 crash
- 錯誤訊息不夠 actionable

**改進方向：**
- 用 tree-sitter 解析 search block 的結構，自動填充未變更的 node
- 或改用 Aider 的 diff-fenced 格式

---

### 6. 缺少 edit validation pipeline

**現狀：** post-apply 只有 `checkBalance()` 和 `validate:true` 時的 DMP retry。

**問題：**
- 沒有語法驗證
- 沒有 type-checking
- 沒有 test regression detection
- apply 成功不代表代碼正確

**業界更好的設計：**
- Cursor 的 apply 後自動跑 diagnostics（LSP errors）
- Aider 的 `--lint` 選項在 apply 後自動 lint

**改進方向：**
- 新增 `validate: "full"` 模式：apply → tree-sitter parse → LSP diagnostics → 如果有 error 就自動 rollback + suggest fix
- 與 `smart_lsp` 整合，apply 後自動 `diagnostics` check

---

### 7. Token 效率還可以更好

**現狀：** unified-diff 格式號稱最省 token，但 LLM 仍然需要輸出 `@@ ... @@` hunk header 和行號。

**更好的設計：**
- Aider 的 udiff 簡化版：省略行號，只用 `-`/`+` 行
- editkit-ts：提供 SEARCH/REPLACE + unified-diff + whole-file 三種，自動根據模型選擇最佳格式
- CodeStruct：完全不需要 LLM 輸出文字 diff，只需說「replace node X 的 body」

---

### 8. 缺少 multi-file atomic transaction 的進階支援

**現狀：** `edit-chain.mjs` 有 atomic 模式（all-or-nothing rollback），但：

**問題：**
- rollback 是用 `.apply.bak` 備份——不夠可靠（process crash 就丟了）
- 沒有 staging area（先寫到 temp file → 驗證 → rename）
- 跨檔案的 dependency（改 A 會影響 B）沒有自動偵測

**改進方向：**
- 用 git worktree 或 staging directory 做 transactional edit
- 改 A 前先分析 `import_graph`，自動加入依賴檔案的 edit

---

## 三、業界設計模式比較

| 特性 | smart_fast_apply | Aider | Cursor | Scissorhands |
|------|-----------------|-------|--------|-------------|
| Fuzzy matching | 6 層降級 | 2 層 (exact + fuzzy) | 內建 | N/A (AST) |
| AST editing | regex-based (L7) | 無 | 無 | tree-sitter |
| DMP fallback | ✅ | ✅ | ❌ | ❌ |
| Token 效率 | 7+ 格式 | 4 格式 | 2 格式 | 操作 node ID |
| Post-apply validation | checkBalance | lint (選配) | LSP diagnostics | tree-sitter parse |
| Multi-file | edit-chain | git commits | agent loop | 依賴分析 |
| Dry-run | ✅ 預設 | ❌ | ✅ | ✅ |
