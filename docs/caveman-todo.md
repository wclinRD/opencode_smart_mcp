# Caveman Compression 整合 — TODO

## Phase 1: caveman.mjs 壓縮引擎
- [ ] 建立 `src/cli/lib/caveman.mjs`
- [ ] 實作 9 條壓縮規則管線
- [ ] 實作三級壓縮：light / semantic / aggressive
- [ ] 實作 `compress(text, level)` 主函式
- [ ] 實作 `estimateTokens(text)` token 估算
- [ ] CLI 獨立測試

## Phase 2: exa-search.mjs 整合
- [ ] 新增 `--caveman` CLI flag
- [ ] 新增 `--caveman-level` CLI 參數（light/semantic/aggressive）
- [ ] `cmdSearch` 輸出前套用 caveman
- [ ] `cmdCrawl` / `cmdCrawlFetch` 輸出前套用 caveman
- [ ] `cmdCode` 輸出前套用 caveman
- [ ] 支援 caveman + chunk 並用

## Phase 3: plugin schema 更新
- [ ] `exa_search.mjs` 新增 `compress` / `compressLevel` 參數
- [ ] `exa_crawl.mjs` 同步新增 `compress` / `compressLevel` 參數
- [ ] `mapArgs` 傳遞新參數到 CLI

## Phase 4: 驗證
- [ ] 單元測試：caveman.mjs 壓縮正確性
- [ ] 整合測試：exa-search.mjs --caveman 端到端
- [ ] Token 節省率驗證（目標 15-30%）

## Phase 5: Agent 設定
- [ ] 更新 system prompt 路由規則
- [ ] 更新 manifest.json（若有自動生成）

## Phase 6: 發布
- [ ] Commit all changes
- [ ] Push to https://github.com/wclinRD/opencode_smart_mcp