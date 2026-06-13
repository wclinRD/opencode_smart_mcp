# smart_fast_apply 強化待辦清單

## Diff Rendering Enhancement ✅
- [x] `ansiColorizeDiff()` — +綠/-紅/@@青 ANSI 色碼
- [x] `codeBlockLang()` — 副檔名→chroma 語言映射
- [x] `wrapDiffBlock(diffText, filePath)` — 格式 code block + ANSI
- [x] `formatAnsiDiff()` — 純 ANSI 輸出模式
- [x] `format:"ansi"` 加入 output enum
- [x] 第 4 個 SEARCH/REPLACE conflict 修復（r.file 參數）
- [x] 78 tests pass, 0 fail

## Phase 0：BlockDiff 新格式 ✅
- [x] plan.md / todo.md 建立（已在 Phase 0 前完成）
- [x] `inputSchema.format.enum` 已含 `block-diff`（前期已加入）
- [x] 新增 `parseBlockDiff()` 區塊解析（自動化函式，含 JSDoc）
- [x] Handler 中 block-diff → applyHashline 轉換（現呼叫 parseBlockDiff -> applyHashline）
- [x] 更新 description 文件（7 種格式，block-diff 排首位）
- [x] 測試：5 個 block-diff 測試（replace/append/prepend/錯誤處理）

## Phase 1：Tree-sitter AST 匹配層
- [ ] `npm install web-tree-sitter tree-sitter-wasms`
- [ ] 建立 `src/lib/ast-engine.mjs`
- [ ] `fuzzyMatch()` 加入 L7 AST fallback
- [ ] 更新 description 文件
- [ ] 測試：5 語言 AST 匹配
- [ ] 測試：AST 匹配成功降級

## Phase 2：Google diff-match-patch 降級
- [ ] 整合 diff-match-patch
- [ ] fuzzyMatch 最後防線加入 patch_apply
- [ ] 測試：程式碼移動後仍 patch 成功

## Phase 3：AST 驗證 + 自動修復
- [ ] apply 後 validateSyntax()
- [ ] 自動修復 handler
- [ ] 測試：語法錯誤自動修復
- [ ] 測試：修不了時正確回報

## 驗證與交付
- [ ] `npm test` 全部通過
- [ ] 更新 agent 設定（如有需要）
- [ ] git commit & push
