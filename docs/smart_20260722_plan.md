# Smart MCP — Claude Code / Cursor 競品對標強化計畫

> 建立日期：2026-07-22 | 修正日期：2026-07-22
> 基於 Claude Code StreamingToolExecutor 深度分析（6,789 行）、Cursor 3 Agent-First 架構、
> MCP Streamable HTTP 規格、Claude Code OS-level Sandboxing、以及 Smart MCP 實際程式碼交叉分析
> 目標：補齊 Smart MCP 與兩大競品的核心技術差距，同時持續強化獨家優勢

---

## 📋 背景與動機

### 三方定位差異

| 維度 | Claude Code | Cursor | Smart MCP |
|------|-------------|--------|-----------|
| **定位** | 完整 Agent 產品（CLI） | IDE 級產品（Agent-First） | 工具層/中間件（MCP server） |
| **核心驅動** | 單一 generator 迴圈（1,730 行） | Agent orchestration + Cloud agents | 88 個工具 + 洋蔥架構 |
| **模型綁定** | 只能用 Claude | 多模型（含自家 Composer 2.5） | 不綁定（任意 MCP agent） |
| **Transport** | stdio + HTTP | IDE native | stdio only |

### Smart MCP 獨有優勢（應持續強化）

1. 🧠 **推理引擎**（cit/beam/forest/structured + 10 模板）— 三者中最豐富
2. 🎯 **Token 效率**（smart_read auto + caveman + edit_chain + session cache）— 工具層最完整
3. 🔬 **垂直領域**（EDA/RTL 12 commands + 醫學 9 來源）— 完全獨家
4. 🔌 **模型不綁定**（任意 MCP 相容 agent）— 最大彈性
5. 🧅 **洋蔥架構**（core 21 + standard 67 + 8 skills）— 最佳可擴展性
6. 📦 **已有的 Context 管理**（三層自動壓縮 + Phase 33 cooldown）— 比計畫最初評估更完善

### 需補齊的核心差距（本計畫聚焦）

| 優先 | 差距 | 學誰 | 影響程度 | 備註 |
|:----:|------|------|:--------:|------|
| 🔴 P0 | Per-call 並行分類 + Streaming Pipelining | Claude Code | 🔴 嚴重 | 修正：從 tool-level 改為 per-call |
| 🔴 P0 | 命令安全分類器 + OS Sandbox | Claude Code | 🔴 嚴重 | 擴充：正則 + OS 隔離 |
| 🔴 P0 | Context Collapse 復原機制 | Claude Code | 🔴 致命 | 新增：7 條 continue path |
| 🟡 P1 | Context 管理優化（非重建） | Claude Code | 🟡 中等 | 修正：驗證現有壓縮效果 |
| 🟡 P1 | 工具 Lazy Loading | Claude Code | 🟡 中等 | 強化 schema 層 |
| 🟢 P2 | 推測性執行強化 | Cursor | 🟡 中等 | 整合 Phase 10 |
| 🟢 P2 | 記憶整合引擎（autoDream） | Claude Code | 🟡 中等 | autoDream 風格 |
| ⏸️ 未來 | MCP 協定升級（Streamable HTTP） | MCP 社群 | 🟡 中等 | 等 OpenCode 支援 |

---

## 🏗 強化方案設計

### A. Context 管理優化（修正版：非重建）

> ⚠️ **重要修正**：原始計畫認為 Smart MCP 缺少自動 Context 管理，但實際程式碼分析發現已有三層自動壓縮。本方案改為「驗證 + 優化」。

**現有狀態**（已實現）：
- MicroCompact：每次工具呼叫後自動觸發，保留最近 5 筆（`index.mjs:1479-1489`）
- FullCompact 3 級：75%/85%/95% 閾值自動觸發（`index.mjs:1491-1530`）
- Phase 33 Tiered Auto Context：cooldown 機制防止過度壓縮（`index.mjs:2628-2636`）
- Todo Follow-up：auto-compact 後追蹤 LLM 是否繼續待辦事項（`index.mjs:2638-2647`）

**需要補強的部分**：
1. Token 計算精度：目前用字元/4 估算，需驗證誤差範圍
2. 壓縮效果監控：需加入 metrics 追蹤壓縮前後的 token 數
3. 邊界案例：超大 tool result（>100K tokens）的處理

**實作位置**：`src/server/index.mjs` — `captureAndReturn()` + `autoManageContext()`

---

### B. Per-call 並行分類 + Streaming Pipelining（修正版）

> ⚠️ **重要修正**：原始計畫只做「tool-level 並行」，但 Claude Code 的做法是「per-call 並行」——同一個工具，不同輸入，不同安全等級。

**問題**：
1. 並行分類是 tool-level（`TOOL_PROFILES`），不是 per-call
2. 無 Streaming Pipelining（等模型想完才開始執行工具）

**Claude Code 做法**（深度分析）：
- `StreamingToolExecutor`（530 行）：模型串流中就開始執行已完成的 tool block
- `partitionToolCalls()`：per-call 分類，`isConcurrencySafe(parsedInput)`
- `siblingAbortController`：一個 Bash 失敗取消兄弟，Read 失敗不影響兄弟
- 4 階段狀態機：Pending → Ready → Executing → Complete

**Smart MCP 強化設計**：

```
目前（ConcurrentGate，concurrency-gate.mjs:19-60）：
  TOOL_PROFILES = {
    smart_read: { weight: 1, category: 'io' },      // 所有 smart_read 都一樣
    smart_fast_apply: { weight: 2, category: 'edit' }, // 所有 edit 都一樣
  }
  → Bash("ls") 和 Bash("rm -rf") 有相同的並行權重

強化後：
  為每個工具加入 isConcurrencySafe(parsedInput)：
  - smart_read → true（永遠唯讀）
  - smart_grep → true（永遠唯讀）
  - Bash("ls -la") → true（唯讀命令）
  - Bash("rm -rf build/") → false（破壞性命令）
  - smart_fast_apply → false（寫入操作）

  Streaming Pipelining：
  - 模型串流中 → ReadFile("a.ts") block 完成 → 立即開始執行
  - ReadFile("b.ts") block 完成 → 立即開始執行
  - Edit block 完成 → 等前兩個完成後執行
```

**並行規則**（per-call）：
- 讀操作 → `isConcurrencySafe: true` → 並行（最多 10）
- 寫操作 → `isConcurrencySafe: false` → 串行
- 混合操作 → 讀並行 + 寫串行
- Sibling Abort：Bash 失敗取消兄弟，Read 失敗不影響

**實作位置**：`src/server/index.mjs` — `handleRequest()` + 新增 `StreamingToolExecutor`

---

### C. 命令安全分類器 + OS Sandbox（擴充版）

> ⚠️ **重要擴充**：原始計畫只有正則匹配，但 Claude Code 的做法是正則 + OS-level sandboxing 雙重防護。

**問題**：高風險 bash 命令（rm -rf、curl|bash、fork bomb）零攔截，完全依賴 agent 判斷。

**Claude Code 做法**：
- 4 層權限：Deny → Allow → Bash classifier（2s timeout）→ 用戶提問
- tree-sitter AST 解析器偵測 24+ 危險模式
- **OS-level Sandboxing**（2025-10）：filesystem isolation + network isolation
  - Linux：bubblewrap（unprivileged sandbox）
  - macOS：seatbelt（sandbox-exec）
  - 結果：84% fewer permission prompts，同時安全性提升

**Smart MCP 強化設計**：

```
第一層：正則匹配（24+ 危險模式）
  bash({command: "rm -rf dist/ build/"}) →
    1. 安全分類器解析命令
    2. 偵測到 rm -rf + 多路徑 → 觸發 warning
    3. 回傳：{ ok: false, warning: "偵測到 rm -rf 操作，請確認" }

第二層：OS Sandbox（macOS seatbelt）
  定義沙箱規則：
  - Filesystem：只允許 cwd 讀寫，封鎖系統目錄
  - Network：只允許通過 unix domain socket 的 proxy
  - Process：封鎖 fork bomb、ptrace
  效果：agent 可自由執行安全命令，無需逐次確認
```

**危險模式清單**（24+ 模式）：
- 破壞性刪除：`rm -rf /`、`rm -rf /*`、`rm -r ~`、`rm -rf .`
- 管道到 shell：`curl ... | bash`、`wget ... | sh`、`curl ... | sh`
- Fork bomb：`:(){ :|:& };:`、`:(){ :|: & };:`
- 權限提升：`sudo rm`、`chmod 777`、`chmod -R 777`
- 環境破壞：`export PATH=`、`unset PATH`、`eval $`
- 網路危險：`ssh root@`、`nc -l`、`ncat -l`
- Git 危險：`git push --force`、`git reset --hard`、`git clean -fd`

**實作位置**：`src/lib/bash-safety.mjs`（新檔案）+ `src/lib/sandbox.mjs`（新檔案）+ `src/server/index.mjs` 拦截 bash 呼叫

---

### H. Context Collapse 復原機制（新增）

> ⚠️ **全新方案**：原始計畫完全遺漏此關鍵差距。Claude Code 有 7 條 continue path 處理各種崩潰場景。

**問題**：Smart MCP 無法優雅處理 context 溢位。當 context 接近上限時，可能中斷任務。

**Claude Code 做法**（`query.ts` 1,729 行）：
- 7 條 continue path：
  1. `collapse_drain_retry` — Context collapse 後重試
  2. `reactive_compact_retry` — 413 recovery 後重試
  3. `max_output_tokens_escalate` — Token escalation 8k→64k
  4. `max_output_tokens_recovery` — 注入 "continue writing" nudge
  5. `stop_hook_blocking` — Stop hook 阻擋後重試
  6. `token_budget_continuation` — Token budget 未耗盡繼續
  7. `next_turn` — 工具執行後下一輪

**Smart MCP 強化設計**：

```
目前：
  context 滿了 → 💥 任務中斷

強化後：
  context 接近上限 →
    1. Tier 1（75%）：顯示 droppable stats，建議 compact
    2. Tier 2（85%）：自動 microcompact + inject recovery hint
    3. Tier 3（95%）：自動 full compact + inject recovery context
    4. 如果 compact 失敗 → 注入 "continue" nudge + 重試（最多 3 次）
    5. 如果重試也失敗 → 記錄統計 + 回傳 graceful error
    6. Circuit Breaker：連續 3 次失敗停止壓縮
```

**實作位置**：`src/server/index.mjs` — `autoManageContext()` 擴展 + `respond()` 加入 continue path

---

### D. 工具 Lazy Loading

**問題**：67 個 sub-tools 的 schema 全部載入，佔 ~55K tokens（73% of 128K context）。

**目前狀態**：已有部分實現 — `HIDDEN_NATIVE_TOOLS` 依 model size 隱藏工具（`index.mjs:87-103`）

**Claude Code 做法**：
- MCP Tool Search：只在需要時才載入工具定義
- 從 ~55K tokens 降到 ~8.7K tokens（85% 減少）

**Smart MCP 強化設計**：

```
目前：
  所有 67 個 sub-tools schema 全部載入 → ~55K tokens
  部分隱藏：HIDDEN_NATIVE_TOOLS 依 model size 過濾

強化後：
  1. 核心工具（21 個 direct tools）→ 始終載入 → ~20K tokens
  2. Sub-tools schema → 按需載入（agent 呼叫 smart_smart_run 時才載入）
  3. 提供 smart_smart_run({tool:"help"}) → 回傳可用工具清單（~2K tokens）
  4. 總計：20K + 2K = 22K tokens（省 60%）
```

**實作位置**：`src/server/loader.mjs` — 動態載入 + `smart_smart_run` help 命令

---

### E. 推測性執行強化（學 Cursor）

**問題**：prefetch-engine 只做 tool 預取，不做結果預計算。

**Cursor 做法**：
- Speculative Edits：用現有源碼做 draft tokens，13x 加速
- Fast Apply：1000 tokens/sec，~3500 char/s

**Smart MCP 強化設計**：

```
目前：
  prefetchEngine：工具 A → 預取工具 B（但只預取 tool schema，不預取結果）

強化後：
  prefetchEngine：工具 A → 預取工具 B 的結果
  → smart_grep("error") 後 → 同時預計算 smart_lsp({hover, ...}) 結果
  → agent 真的呼叫 smart_lsp → 直接回傳 cached result（0ms）
  → agent 沒呼叫 → 丟棄（無害）

  進階：整合 Phase 10 transition learning，用動態統計取代靜態規則
```

**實作位置**：`src/lib/prefetch-engine.mjs` — 擴展 contextExtractor 為結果預計算

---

### F. 記憶整合引擎（學 Claude Code autoDream）

**問題**：記憶越多越亂，沒有自動去重、歸類、淘汰。

**Claude Code 做法**：
- autoDream：24 小時 + 5 次 session 後觸發
- 4 階段：Orient（掃描）→ Gather（收集）→ Consolidate（整合去重）→ Prune（淘汰過時）
- PID 鎖 + 60 分鐘 stale guard

**Smart MCP 強化設計**：

```
目前：
  autoExtractSkillPatches()：每 5 次成功呼叫觸發
  → 基於規則的 pattern matching → 記憶品質不穩定

強化後：
  autoDreamEngine：
    1. 觸發條件：session 數 > 5 且距上次整合 > 24h
    2. Orient：掃描 resolutions.json 所有記憶
    3. Gather：按 category 分組（error_fix / pattern / preference）
    4. Consolidate：合併重複記憶、解決衝突
    5. Prune：淘汰 > 30 天未使用的記憶
    6. PID 鎖：防止並發整合
```

**實作位置**：`src/lib/memory-consolidator.mjs`（新檔案）+ `src/server/index.mjs` 啟動時觸發

---

### G. MCP 協定升級（未來選項）

> ⏸️ **暫不實作**。OpenCode client 目前不支援 Streamable HTTP（Issue #8058 仍未解決）。

**觸發條件**：
- OpenCode 加入 Streamable HTTP client 支援
- 或：需要部署為遠端 MCP service

**目前限制**：
- Smart MCP 使用 `PROTOCOL_VERSION = '2024-11-05'` + stdio transport
- MCP 生態系已移至 `2025-03-26+` + Streamable HTTP
- 但 OpenCode client（`type: "remote"`）只支援 SSE，不支援 Streamable HTTP

**如果要實作**：
1. 升級 protocol version 到 `2025-03-26` 或更新
2. 加入 Streamable HTTP transport（HTTP endpoint + SSE streaming）
3. 保留 stdio 作為 fallback
4. 需要 OAuth 認證機制

---

## 📊 與現有 Phase 的關係

| 本計畫方案 | 現有 Phase | 關係 |
|-----------|-----------|------|
| A. Context 管理優化 | Phase 15（Smart Output Mgmt）+ Phase 33 | **驗證+優化**：已有三層壓縮，需驗證效果 |
| B. Per-call 並行 | Phase 16（Parallel Execution） | **根本性升級**：從 tool-level 改為 per-call + streaming |
| C. 安全分類器 + Sandbox | Phase 14（Self-Reflection） | **互補**：Phase 14 做反思，本方案做即時攔截 + OS 隔離 |
| H. Context Collapse 復原 | 無 | **全新**：補齊 context 溢位時的復原機制 |
| D. Lazy Loading | Phase 15（Smart Output Mgmt） | **互補**：Phase 15 做輸出管理，本方案做輸入管理 |
| E. 推測性執行 | Phase 3（Speculative Pre-fetch） | **擴展**：Phase 3 做 tool 預取，本方案加入結果預計算 |
| F. 記憶整合 | Phase 14（Self-Reflection） | **互補**：Phase 14 做反思，本方案做記憶清理 |
| G. MCP 協定升級 | 無 | **未來**：等 OpenCode 支援 Streamable HTTP |

---

## 🎯 預期成效

| 方案 | 改善前 | 改善後 | 影響 |
|------|--------|--------|------|
| A. Context 優化 | 現有壓縮效果未驗證 | 精確 token 計算 + metrics 追蹤 | 🟡 穩定性提升 |
| B. Per-call 並行 | tool-level 分類 + 等模型想完 | per-call 分類 + streaming pipelining | 🔴 速度提升 10-50x + 安全性提升 |
| C. 安全 + Sandbox | 高風險操作零攔截 | 24+ 模式 + OS 隔離 | 🔴 安全性大幅提升 + 84% fewer prompts |
| H. Context 復原 | context 滿了就崩潰 | 6 層復原機制 | 🔴 任務成功率 90%→95%+ |
| D. Lazy Loading | Context 被工具描述塞滿 | 85% token 省下 | 🟡 簡單問題回應更快 |
| E. 推測性執行 | 每輪都等 | 重疊執行省 25-30% | 🟡 複雜任務更快 |
| F. 記憶整合 | 記憶越多越亂 | 品質持續提升 | 🟡 長期使用更穩定 |

---

## 📅 實施順序建議

```
第一波（高優先，1-2 週）：
  B. Per-call 並行 + Streaming ← 效能 + 安全性提升最明顯
  C. 安全分類器 + Sandbox ← 安全性必備
  H. Context Collapse 復原 ← 可靠性必備

第二波（中優先，1-2 週）：
  A. Context 管理優化 ← 驗證現有壓縮效果
  D. 工具 Lazy Loading ← Token 節省最多

第三波（持續優化）：
  E. 推測性執行強化 ← 整合 Phase 10 transition learning
  F. 記憶整合引擎 ← 整合 Phase 14 reflection

未來（等 OpenCode 支援）：
  G. MCP 協定升級 ← 等 Streamable HTTP client 支援
```

---

## 🔗 相關文件

- `docs/plan.md` — 主路線圖（Phase 1-20）
- `docs/todo.md` — 實作追蹤
- `docs/smart_20260722_todo.md` — 本計畫實作追蹤
- `config/agents/smart-mcp.md` — Agent personality 定義

---

## 📝 修正紀錄

| 日期 | 修正內容 | 原因 |
|------|---------|------|
| 2026-07-22 | 方案 A 從「重建」改為「優化」 | 程式碼分析發現已有三層自動壓縮 |
| 2026-07-22 | 方案 B 從「tool-level 並行」改為「per-call 並行 + streaming」 | Claude Code 深度分析發現 per-call 分類 |
| 2026-07-22 | 方案 C 擴充加入 OS Sandbox | Claude Code sandboxing 分析 |
| 2026-07-22 | 新增方案 H（Context Collapse 復原） | Claude Code 7 條 continue path 分析 |
| 2026-07-22 | 新增方案 G（MCP 協定升級）標記為未來 | OpenCode Issue #8058 仍未解決 |
| 2026-07-22 | 修正優先級排序 | 基於實際程式碼分析重新評估 |