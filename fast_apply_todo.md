# smart_fast_apply P0 改進 TODO

## ✅ P0-1: tree-sitter AST-aware editing
- [x] 建立 `src/lib/tree-sitter-edit.mjs`
- [x] WASM 語言檔從 source build
- [x] 整合到 `parseBlockDiff()` + `extractSymbol()` fallback
- [x] 9/9 測試通過

## ✅ P0-2: LSP diagnostics 驗證 + auto-rollback
- [x] `validate` 參數擴展為 `string | boolean`（`"none"` / `"balance"` / `"full"`）
- [x] 匯入 `getLspBridge` from `lsp-bridge.mjs`
- [x] `validatePostApply()` 函式：query LSP diagnostics → error → auto rollback from `.apply.bak`
- [x] 整合到 atomic + sequential apply 兩個 return 路徑
- [x] 語法檢查 + 括號平衡通過

## 📋 P1 (next)
- [ ] 編輯後自動修復 diagnostics（auto-fix loop）
- [ ] `smart_edit_chain` 整合 tree-sitter
- [ ] multi-file apply 後批次 diagnostics 驗證

  - 整合 tree-sitter 到 apply-engine.mjs
  - block-diff 的 `symbol` 欄位改用 tree-sitter 找 node → 取代 node body
  - 支援 languages: JS/TS/Python/Go/Rust
  - 移除 tryStructuralMatch 的 regex fallback
  - 驗收：symbol edit 100% 正確（含 arrow function、decorator、generic）

- [ ] **apply 後 LSP diagnostics 驗證 + auto-rollback**
  - smart_fast_apply 新增 `validate: "full"` 選項
  - apply 完後自動呼叫 `smart_lsp({operation:"diagnostics", file})`
  - 如果有 error → 自動 rollback（讀取 .apply.bak）+ 回傳 error 訊息
  - 與 smart_lsp 整合，不需要額外 dependency

## 🟨 P1 — 效能與體驗（下週）

- [ ] **fuzzy matching 預計算共享 contentLines**
  - fuzzyMatch / detectMultiOccurrence / tryStructuralMatch 共用一次 split
  - 大檔案效能提升預估 3-5x
  - 驗收：500 行檔案 apply 時間 < 50ms

- [ ] **multi-occurrence 自動消歧**
  - 偵測到 multi-occurrence 時，如果有 `startLine` hint → 自動選最接近的匹配
  - 沒有 startLine → 自動附加前後 2 行 context 重試
  - 只在重試失敗時才回傳 conflict
  - 驗收：80% 的 multi-occurrence 自動解決

- [ ] **DMP 結果 tree-sitter parse 驗證**
  - applyByDiffMatchPatch 的結果加 tree-sitter parse check
  - parse 失敗 → 不寫入，回傳 conflict
  - 驗收：DMP 產生的壞代碼 0% 寫入

## 🟩 P2 — 架構優化（月中）

- [ ] **簡化 fuzzy 降級管線**
  - 評估合併 L1-L4 為單一 fuzzy 函式
  - 保留 L5 作為 fallback，L7 作為語言特定 fallback
  - 驗收：管線層數 ≤ 4，延遲不退化

- [ ] **transactional edit (staging dir)**
  - 寫入 /tmp/.fast-apply-staging/ → 驗證 → rename 到目標路徑
  - process crash 安全（不依賴 .bak）
  - 驗收：kill process 後目標檔案不損壞

- [ ] **import_graph 整合 multi-file dependency**
  - edit-chain 改 A 前先分析 import_graph
  - 自動把依賴檔案加入 chain（如果 LLM 沒指定）
  - 驗收：改 A 自動帶動 B/C 的 import 更新

## 🟩 P3 — 長期規劃

- [ ] **tree-sitter code action**：除了 edit，支援 extract function / rename symbol / move to file
- [ ] **model-adaptive format**：根據 LLM 模型自動選擇最佳 edit format（參考 Aider 的 --edit-format）
- [ ] **edit telemetry**：追蹤每次 apply 的 matchLevel / 成功率 / 延遲，用於優化 fallback 策略

---

## 參考資源

- Aider edit formats: https://aider.chat/docs/more/edit-formats.html
- Aider search_replace.py: https://github.com/Aider-AI/aider/blob/main/aider/coders/search_replace.py
- editkit-ts: https://github.com/arioberek/editkit-ts
- Scissorhands (tree-sitter AST editor): https://github.com/btsomogyi/scissorhands
- CodeStruct (Amazon, structured action space): https://github.com/amazon-science/codestruct
- Organon (tree-sitter tools): https://github.com/tta-lab/organon
- mcp-contextual-code-edit (tree-sitter MCP): https://github.com/cognitive-glitch/semantic-code-edit-mcp
- Cursor forum - search/replace failures: https://forum.cursor.com/t/search-and-replace-tool-failing-constantly/95760
