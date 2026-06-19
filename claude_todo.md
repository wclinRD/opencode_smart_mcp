# Claude Code 無限上下文 — 實作待辦

**更新**: 2026-06-19

## P0: MicroCompact — 工具結果清理

- [ ] **P0.1 定義 MicroCompact 邏輯**
  - [ ] 決定保留工具結果數量 N（預設 5）
  - [ ] 決定大字數截斷閾值（預設 50K chars）
  - [ ] 佔位替代文字：「[Old tool result cleared]」
- [ ] **P0.2 實作工具結果清理機制**
  - [ ] 在哪一層 hook（tool call 回傳後 / context 組裝前）
  - [ ] 保留最近 N 個結果，舊的替換為佔位
  - [ ] 大字數結果截斷為 2KB 預覽 + 完整存檔到磁碟
- [ ] **P0.3 測試與驗證**
  - [ ] 測試 100+ 回合後 context 大小
  - [ ] 驗證佔位文字不影響 agent 行為
  - [ ] 驗證 50K+ 結果的正確截斷

## P1: Sub-agent Context 隔離強化

- [ ] **P1.1 審查現有 task() subagent 機制**
  - [ ] 確認 subagent 已有獨立 context window
  - [ ] 確認 subagent 回傳格式
- [ ] **P1.2 實作回傳摘要限制**
  - [ ] 限制回傳 ≤ 4K tokens
  - [ ] 超量時自動摘要化
- [ ] **P1.3 測試與驗證**
  - [ ] subagent 讀 50 檔案後主 context 不膨脹
  - [ ] 多 subagent 平行執行 context 互不干擾

## P2: 結構化 Full Compact

- [ ] **P2.1 定義 9 區塊結構化摘要模板**
  - [ ] Goal / Technical / Errors / Files / Commands / Todos / Decisions / State / Context
- [ ] **P2.2 實作兩階段 CoT Scratchpad**
  - [ ] Phase 1: LLM 推理（含完整推理）
  - [ ] Phase 2: 只保留結論（丟棄推理過程）
- [ ] **P2.3 實作觸發邏輯**
  - [ ] 監控 context 使用率（83% 門檻，可設定）
  - [ ] 絕對值閾值（effective window - 13,000）
  - [ ] 遞歸保護（壓縮子代理不再觸發壓縮）
  - [ ] 斷路器（連續 3 次失敗停止重試）
- [ ] **P2.4 實作 Context Collapse（可逆折疊）**
  - [ ] 原始 messages 另存 collapse store
  - [ ] 動態產生壓縮視圖
  - [ ] 支援 rollback 展開
- [ ] **P2.5 測試與驗證**
  - [ ] 壓縮率 ≥ 80%
  - [ ] 壓縮後對話可正確繼續
  - [ ] Collapse rollback 完整還原

## P3: 背景 Session Memory

- [ ] **P3.1 背景 fork agent 實作**
  - [ ] 每 ~5K tokens 新對話觸發更新
  - [ ] 更新 session memory 文件（9 區塊格式）
- [ ] **P3.2 整合到 Full Compact**
  - [ ] Full Compact 時優先使用 session memory
  - [ ] 無 session memory 時回退 P2 標準流程
- [ ] **P3.3 測試與驗證**
  - [ ] Full Compact 時零延遲（無需等待 LLM 摘要）

## P4: 自動回填機制

- [ ] **P4.1 壓縮後清除 file state cache**
- [ ] **P4.2 自動重新載入最近檔案**
  - [ ] 最近 5 個檔案，各 5K tokens 上限
- [ ] **P4.3 自動重新載入專案規則**
  - [ ] SMART.md / AGENTS.md / .cursorrules 等
- [ ] **P4.4 自動重新注入待辦事項**
  - [ ] 壓縮後保留 todo 狀態
- [ ] **P4.5 測試與驗證**
  - [ ] 壓縮回填後檔案內容與規則可用

## 基礎設施

- [ ] **Infra.1 Context 監控儀表板**
  - [ ] 即時顯示各層級使用率（system/history/tool/response）
  - [ ] 顯示最後壓縮時間與壓縮率
- [ ] **Infra.2 模型設定映射表**
  - [ ] 各模型 window size / compact 門檻
  - [ ] 使用現有 limit.input 設定（Gemma4:114688 / Qwen9B:98304 / Qwen4B:40960）

---

## 進度摘要

| 項目 | 狀態 | 備註 |
|------|------|------|
| P0 MicroCompact | ⏳ 待開始 | 優先實作 |
| P1 Sub-agent 隔離 | ⏳ 待開始 | 評估現有 task 機制 |
| P2 Full Compact | ⏳ 待開始 | 含 Collapse 可逆折疊 |
| P3 Session Memory | ⏳ 待開始 | 依賴 P2 |
| P4 自動回填 | ⏳ 待開始 | 依賴 P2 |
| Infra 監控 | ⏳ 待開始 | 輔助工具 |
