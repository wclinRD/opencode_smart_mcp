# smart_fast_apply 改進 TODO

## ✅ P0-1: tree-sitter AST-aware editing
- [x] 建立 `src/lib/tree-sitter-edit.mjs`
- [x] WASM 語言檔從 source build
- [x] 整合到 `parseBlockDiff()` + `extractSymbol()` fallback
- [x] 9/9 測試通過

## ✅ P0-2: LSP diagnostics 驗證 + auto-rollback + auto-fix
- [x] `validate` 參數擴展為 `string`（`"none"` / `"balance"` / `"full"`）
- [x] 匯入 `getLspBridge` from `lsp-bridge.mjs`
- [x] `validatePostApply()` export function：query diagnostics → error → rollback
- [x] Auto-fix loop：最多 3 輪 LSP code_action 修復
- [x] 整合到 fast-apply atomic + sequential 兩個 return 路徑
- [x] 整合到 edit-chain（multi-file diagnostics 驗證）

## ✅ P1: smart_edit_chain 整合 tree-sitter
- [x] `resolveEdit()` 改為 async
- [x] block-diff 路徑：`findSymbolAST()` 優先，fallback `extractSymbol()`
- [x] Lazy init tree-sitter at module load

## 🟨 P2 — 效能與體驗
- [ ] fuzzy matching 預計算共享 contentLines
- [ ] multi-occurrence 自動消歧
- [ ] DMP 結果 tree-sitter parse 驗證

## 🟩 P3 — 架構優化
- [ ] 簡化 fuzzy 降級管線（≤ 4 層）
- [ ] transactional edit (staging dir)
- [ ] import_graph 整合 multi-file dependency

## 🟦 P4 — 長期規劃
- [ ] tree-sitter code action（extract function / rename / move）
- [ ] model-adaptive format（根據 LLM 模型選擇最佳 edit format）
- [ ] edit telemetry（追蹤 matchLevel / 成功率 / 延遲）
