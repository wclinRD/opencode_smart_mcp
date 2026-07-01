# think_todo.md — smart_decompose_think P2 實作 TODO

> **範圍**：Phase 2 — 建立 `smart_decompose_think` 工具，專為 Qwen3.5-4B 等 thinking model 設計。
> 核心：主動 think↔tool 循環 orchestration + 任務模板 + 信心校準。
> 🆕 **CoE Trace 格式**：Chain-of-Edits 論文證實小模型思考 token 應格式化為**工具使用軌跡**而非自然語言。
> P2 核心設計：tool call = 思考 token 的具體實現，而非思考的替代。
> **預計工時**：5 天（17 檔案，~4100 行）
> ⚠️ P2.1（已計畫）：1.5 天，~1400 行
> ⚠️ P2.2 🆕（研究整合）：+1.5 天，~1400 行
> ⚠️ **P2.3 🆕（Qwen3.5 生態 + Bug Resilience + 最新研究）**：+2 天，~1300 行
> **合計 P2**：5 天，17 檔案，~4100 行
> **狀態標記**：⬜ 待辦 · 🔄 進行中 · ✅ 完成 · ❌ 阻塞

---

## 📋 工作區塊 A：核心分析引擎（decompose-think.mjs）

- [ ] ⬜ **A1** `parseThought(thought)` — 解析 thought 內容
  - `UNSURE_PATTERNS`: `/maybe|not sure|i think|perhaps|possibly|不確定|可能/gi`
  - `CONFIDENCE_PATTERNS`: `/definitely|certain|100%|absolutely|clearly|無疑/gi`
  - `TOOL_CALL_MARKERS`: `` /`tool:\s*\w+|`smart_\w+|`ssr\(/gi ``（LLM 在 thought 中提及工具）
  - 🆕 **Qwen3.5 XML tool call 解析**：`` /<tool_call>.*?<\/tool_call>/gs ``，擷取 XML 格式 tool call
  - 🆕 `XML_TOOL_CALL_REGEX`: `` /<function=(\w+)>.*?<parameter=(\w+)>([\s\S]*?)<\/parameter>/g ``
  - 🆕 解析 thinking/reasoning 分離：偵測 `reasoning_content` 與 `content` 通道
  - 🆕 **FR-CoT 推理長度檢測**：`detectReasoningBudget(thought)` — 判斷推理是否過長
  - 🆕 **FR-CoT 範例**：`Function: smart_grep / Key args: pattern="X" / Reason: 原因`
  - 回傳：`{ hasUncertainty, hasHighConfidence, mentionedTools[], toolCallMentions[], xmlToolCalls[], reasoningChannel, reasoningBudget }`

- [ ] ⬜ **A2** `suggestToolByTask(subtaskDesc, template)` — 依任務類型配對 tool
  - debug 模板配對：
    - `find/locate/where/發生/位置` → `smart_grep` / `smart_lsp`
    - `cause/root/為什麼/原因` → `smart_lsp` / `smart_grep`
    - `fix/edit/repair/修/改` → `smart_fast_apply`
    - `test/verify/check/測/驗證` → `smart_test`
  - refactor 模板配對：
    - `depend/import/引用` → `smart_run(import_graph)`
    - `impact/影響/改了` → `smart_run(code_impact)`
    - `rename/改名/移動` → `smart_run(rename_safety)`
  - search 模板配對：
    - `research/search/查/找資料` → `smart_exa_search`
    - `read/文件/doc` → `smart_exa_crawl`
  - 回傳：`{ tool, args?, reason, confidence } | null`

- [ ] ⬜ **A3** `checkConfidence(parsed, toolCalls, strictness)` — 信心校準
  - 條件：hasHighConfidence && toolCalls.length === 0 && strictness !== 'low'
  - → `{ type: 'overconfidence', message: '你似乎很有把握，但還沒有用工具驗證', suggestion: '建議先用 smart_grep 確認' }`
  - 🆕 **cross-validation**：加入 AgentProp-Bench 警告 — LLM 自報 tool 結果 κ=0.049
  - 🆕 `crossValidateToolCalls(reportedCalls, thought)` — 檢查 toolCalls 與 thought 一致性
    - tool 聲稱已執行但 thought 未提及 → warning
    - result 過長 (>200 chars) → warning
  - 回傳：`intervention | null`

- [ ] ⬜ **A4** `checkSkippedTool(toolCalls, prevSuggestion)` — 跳過工具檢測
  - 前輪有建議 tool，但本輪 toolCalls 無對應 `status:"done"` 的記錄
  - → `{ type: 'skipped_tool', message: '前輪建議使用 {tool} 但尚未執行', suggestion: '是否忘記呼叫？' }`
  - 回傳：`intervention | null`

- [ ] ⬜ **A5** `getTemplatePrompt(template)` — 任務模板引擎
  - 回傳格式化 prompt 字串（含 box-drawing 流程建議）
  - debug / refactor / search / generic / 🆕 **fr-cot** 五種模板
  - 🆕 fr-cot 模板：`Function: [name] / Key args: [...] / Reason: (一句話)`

- [ ] ⬜ **A6** 首次呼叫 / 邊界情況處理
  - `toolCalls` 為 `undefined` / `null` / 非陣列 → 初始化為 `[]`
  - `_prevToolCalls` 不存在 → 跳過 trackToolCalls 比對
  - `roundType` 不存在 → 預設 `"think"`
  - `template` 不存在 → 預設 `"generic"`
  - `subtaskTemplates` 為空物件 → 不產生模板 prompt
  - **首次呼叫**（toolCalls 初始為空陣列時）：
    - 隱藏工具結果引導區塊（無結果可顯示）
    - 不顯示 skipped_tool intervention（無前輪建議）
    - 可選：在 box-drawing 標題加 `[首次呼叫]` 標記

---

## 📋 工作區塊 B：Tool 循環追蹤

- [ ] ⬜ **B1** `trackToolCalls(toolCalls, prevToolCalls, prevSuggestion)` — 更新 tool call 狀態
  - 比對本輪與前輪的 toolCalls，將 status 從 `"pending"` → `"done"`（如果本輪收到 result）
  - 檢查是否有新的 tool call 記錄（新增項目）
  - 回傳：`{ updatedToolCalls, newCalls[], completedCalls[], skippedSuggestion }`

- [ ] ⬜ **B2** `buildToolResultContext(toolCalls)` — 產生工具結果引導 prompt
  - 找出最近一個 `status:"done"` 的 tool call
  - `┌─ 工具結果 ─────────────────────┐`
  - `│ 你剛剛呼叫了 {tool}，結果摘要：{result}`
  - `│ 請根據結果決定下一步`
  - `└──────────────────────────────────┘`

- [ ] ⬜ **B3** `activeToolSuggest(args)` — 主動建議整合函式
  - 🆕 **前置步驟**：`checkToolNecessity(thought, taskContext)`
    - 必要性低 + 信心高 → 跳過 activeToolSuggest（省 token）
    - 必要性高 → 正常流程
    - heuristic proxy 規則（Probe&Prefill 啟發）：
      - thought 含具體答案 + 引用 → 低必要性
      - 任務需外部資訊 → 高必要性
      - 不確定 → 保守預設高必要性
  - 依序檢查（優先級順序）：
    1. 前輪是否有 skipped tool → A4
    2. 是否 overconfidence → A3
    3. thought 是否有不確定詞 → A1 + A2
    4. subtask.desc 是否配對到 tool → A2
  - 只回傳**最高優先級**的一個建議

- [ ] ⬜ **B4** P2 獨立 session store + `detectCycleP2()`
  - ⚠️ 不共用 P1 的 `sessionStore`（namespace 衝突）
  - 建立獨立的 `sessionStoreP2 = new Map()`
  - `detectCycleP2(sessionId, subtaskId, thought, threshold)` 邏輯同 P1
  - 但使用獨立 store，不影響 P1 的循環檢測狀態

---

## 📋 工作區塊 C：Plugin + 整合

- [ ] ⬜ **C1** 建立 `src/plugins/core/smart-decompose-think.mjs`
  - 繼承 P1 的 plugin 合約模式
  - Schema 加上 P2 新增欄位：`toolCalls`, `roundType`, `template`
  - `required`: 原有的 5 個 + `roundType`

- [ ] ⬜ **C2** 撰寫 `handler(args)`
  - 匯入 `decomposeThinkHandler` from new core
  - 注入 `_getBudgetFn`
  - 回傳 formatted text

- [ ] ⬜ **C3** 撰寫 `description`
  - 「Qwen3.5-4B 專用推理工具 — 主動 think↔tool 循環」
  - 強調與 `smart_decompose` 的區別

- [ ] ⬜ **C4** 更新路由規則（smart-mcp.md）
  - 加入 `smart_decompose_think` 到 Direct MCP tools 表
  - 三工具比較表：`smart_think` / `smart_decompose` / `smart_decompose_think`

- [ ] ⬜ **C5** `autoCorrectRoundType(args)` — roundType 自動校正（新增 lib 函式）
  - 回傳校正後的 roundType
  - 校正規則：
    1. 首次呼叫（toolCalls 空/未定義）→ `"think"`（強制無視 LLM 輸入）
    2. toolCalls 有新的 status:"done" 但 roundType="think" → `"tool_result"`
    3. toolCalls 無新的 status:"done" 但 roundType="tool_result" → `"think"`
    4. 其餘保持原始 roundType
  - 回傳：`{ correctedRoundType: string, wasCorrected: boolean, correctionReason?: string }`
  - 測試重點：6 種組合（首次/有 done/無 done × think/tool_result）

- [ ] ⬜ 🆕 **C6** `autoCorrectReasoningBudget(args)` — 依 roundType/needsTool 調整推理長度
  - needsTool=true + roundType="think" → reasoningBudget="brief"（FR-CoT 優化）
  - semanticType="synthesize"|"decide" → reasoningBudget="deep"
  - 預設 → reasoningBudget="normal"
  - 回傳：`{ budget: string, reason: string }`

---

## 📋 工作區塊 D：核心整合（decomposeThinkHandler）

- [ ] ⬜ **D1** 建立 `src/cli/decompose-think.mjs`
  - import: `think-utils.mjs` + `decompose.mjs` 既有函式
  - export: `decomposeThinkHandler(args)` → `{ thought, progress, toolSuggestion, intervention, budget }`

- [ ] ⬜ **D2** `decomposeThinkHandler(args)` 主流程
  ```javascript
  export function decomposeThinkHandler(args) {
    // 1. 驗證（同 P1）
    const errors = validateArgs(args);
    if (errors.length > 0) return { error: errors.join('; '), ... };

    // 2. 解析 thought
    const parsed = parseThought(args.thought);

    // 3. 更新 tool call 追蹤
    const { updatedToolCalls, skippedSuggestion } = trackToolCalls(
      args.toolCalls, args._prevToolCalls, args._prevSuggestion
    );

    // 4. 主動工具建議
    const activeTip = activeToolSuggest({
      parsed, subtask: currentSubtask, template,
      toolCalls: updatedToolCalls,
      strictness, prevSuggestion: skippedSuggestion,
    });

    // 5. 工具結果引導（roundType === 'tool_result'）
    const resultContext = args.roundType === 'tool_result'
      ? buildToolResultContext(updatedToolCalls)
      : null;

    // 6. 模板 prompt
    const templatePrompt = getTemplatePrompt(args.template || 'generic');

    // 7. 進度 + 循環 + budget（同 P1）
    const progress = computeProgress(args.subtasks, args.currentSubtaskId);
    const cycle = detectCycle(sessionId, currentSubtaskId, thought, threshold);
    const budget = checkBudget(getBudgetFn, strictness);

    // 8. 格式化輸出（含模板 + 工具結果上下文）
    const thought = formatThinkOutput({
      ...args, templatePrompt, resultContext,
      toolSuggestion: activeTip,
    });

    return { thought, progress, toolSuggestion: activeTip, intervention: cycle || activeTip?.intervention, budget };
  }
  ```

- [ ] ⬜ **D3** `formatThinkOutput(args)` — P2 格式化工事
  - 需整合 DAG 視覺化、confidence bar、thinkBudget 顯示
  - 🆕 **CoE Trace 格式**：輸出應引導 tool call 作為「思考 token」的一部分
  - tool call 前後應有推理銜接，而非獨立區塊
  - `多輪 tool call 時保留 assistant 的 reasoning_content`（Qwen3 必備）
  - 同 P1 box-drawing + 模板 prompt 區塊 + 工具結果區塊
  ```
  ┌─ smart_decompose_think [debug] ─────────
  │ 🎯 {goal}
  │ 📊 [████░░░░░░] 2/5
  │
  │ ┌─ 模板建議 ──────────────────
  │ │ 1. smart_lsp diagnostics → 看錯誤
  │ │ 2. smart_grep → 找相關程式碼
  │ └────────────────────────────
  │
  │ ┌─ 工具結果 ──────────────────
  │ │ smart_lsp 回傳：TypeError at line 142
  │ └────────────────────────────
  │
  │ 🔍 當前步驟: locate error (1/5)
  │ ┌─ 推理 ──────────────────────
  │ │ {thought}
  │ └────────────────────────────
  │
  │ 🔧 建議：smart_grep({pattern:"parseToken"})
  │ ⚠️ 你似乎很有把握，但尚未用工具驗證
  │
  │ → 繼續推理（nextNeeded: true）
  └────────────────────────────────────────
  ```

---

## 📋 工作區塊 E：測試

- [ ] ⬜ **E1** 建立 `tests/decompose-think.test.mjs`
  - 使用 `node --test`

- [ ] ⬜ **E2** 測試案例

| 測試 | 預期 |
|------|------|
| `parseThought` 含不確定詞 | `hasUncertainty=true` |
| `parseThought` 含工具提及 | `mentionedTools` 含 match |
| `suggestToolByTask` "find the bug" (debug) | tool=`smart_grep` |
| `suggestToolByTask` "fix the error" (debug) | tool=`smart_fast_apply` |
| `suggestToolByTask` "search for docs" (search) | tool=`smart_exa_search` |
| `checkConfidence` high + no toolCalls | intervention.type='overconfidence' |
| `checkConfidence` high + has toolCalls | null（已有驗證） |
| `checkSkippedTool` 前輪有建議 + 本輪無執行 | intervention.type='skipped_tool' |
| `trackToolCalls` pending → done | updatedToolCalls[0].status='done' |
| `buildToolResultContext` 有 done 的 tool | 輸出含 "你剛剛呼叫了" |
| `decomposeThinkHandler` 基本呼叫 | 含模板區塊 + 結構化欄位 |
| `decomposeThinkHandler` roundType="tool_result" | 含工具結果引導區塊 |
| `decomposeThinkHandler` template="debug" | 輸出含 "除錯任務" |
| `decomposeThinkHandler` template="refactor" | 輸出含 "重構任務" |
| 不確定詞觸發主動建議 | `toolSuggestion.trigger='uncertainty'` |
| `autoCorrectRoundType` 首次呼叫 + toolCalls=null | corrected=`'think'`, wasCorrected=true |
| `autoCorrectRoundType` toolCalls 有 done + roundType='think' | corrected=`'tool_result'`, wasCorrected=true |
| `autoCorrectRoundType` toolCalls 無 done + roundType='tool_result' | corrected=`'think'`, wasCorrected=true |
| `autoCorrectRoundType` 正常情況（無需校正） | wasCorrected=false |
| `activeToolSuggest` 無條件符合（catch-all high strictness） | fallback 到 subtask.tool |
| `activeToolSuggest` 全部不符合 + strictness=low | 回傳 null |
| 🆕 FR-CoT 格式：needsTool=true + roundType=think | reasoningBudget="brief"，輸出含 FR-CoT 模板 |
| 🆕 `checkToolNecessity` 低必要性 + 高信心 | activeToolSuggest 跳過 |
| 🆕 `checkToolNecessity` 高必要性 + 不確定 | activeToolSuggest 正常執行 |
| 🆕 `crossValidateToolCalls` 一致 | warnings=[] |
| 🆕 `crossValidateToolCalls` tool 未在 thought 提及 | warnings 含 warning |
| 🆕 `autoCorrectReasoningBudget` needsTool=true | budget="brief" |

- [ ] ⬜ **E3** 執行測試
  ```bash
  node --test tests/decompose-think.test.mjs tests/decompose.test.mjs tests/think-utils.test.mjs
  ```

- [ ] ⬜ **E4** 🆕 跨區塊整合測試矩陣
  | 測試組合 | 測試案例 | 預期 |
  |---------|---------|------|
  | M（Bug Resilience）× J（XML Parser） | Content=null + XML tool call in reasoning_content | fallbackExtractContent 正確提取並解析 XML tool call |
  | M × K（Dual Format） | sanitizeContent 後 + CoE 格式輸出 | 清理後的 thought 仍保持 CoE 軌跡結構 |
  | J × K | XML tool call 出現在 CoE 推理軌跡中 | XML 被正確識別為 tool call 而非推理文字 |
  | L（Semantic）× N2（ITL） | Semantic signal 指導工具載入決策 | synthesize/decide 節點不載入工具描述 |
  | M × N1（preserve_thinking） | content=null 復原後 + preserve_thinking 啟用 | raw reasoning 被保留並注入下輪 context |
  | 全部同時 | 完整 P2.3 管線：sanitize → XML parse → CoE format → confidence → ITL | 端到端正確 |
| 🆕 O1（FR-CoT）× A5（template） | FR-CoT 模板在 needsTool 步驟正確觸發 | 輸出含 "Function:" 前綴 |
| 🆕 O2（Necessity）× B3（activeSuggest） | checkToolNecessity 過濾正確 | 低必要性時跳過 tool suggestion |
| 🆕 O3（CrossVal）× A3（confidence） | crossValidateToolCalls 觸發 warning | toolCalls 不一致時低 confidence 標記 |
| 🆕 O1×K（Dual Format） | FR-CoT 與 CoE/text-CoT 混合切換 | 同一任務多步驟混合格式正確 |

---

## 📊 進度追蹤

| 區塊 | 總項 | ✅ | 📊 進度 |
|------|------|----|---------|
| A: 核心分析引擎（含 XML parser） | 6 | 0 | 0% |
| B: Tool 循環追蹤 | 4 | 0 | 0% |
| C: Plugin + 整合 | 5 | 0 | 0% |
| D: 核心整合（含 dual format） | 4 | 0 | 0% |
| **P2.1 小計（原計畫）** | **21** | **0** | **0%** |
| F: Atomic DAG 實作 | 5 | 0 | 0% |
| G: ADAPT 自適應分解 | 4 | 0 | 0% |
| H: Thinking Budget 整合 | 3 | 0 | 0% |
| I: 信心評分與驗證循環 | 4 | 0 | 0% |
| **P2.2 小計（研究整合）** | **16** | **0** | **0%** |
| J: Qwen3.5 XML 格式支援 🆕 | 5 | 0 | 0% |
| K: Dual Output Format 🆕 | 4 | 0 | 0% |
| L: Semantic Signal + Hint Injection 🆕 | 4 | 0 | 0% |
| M: Bug Resilience & Content Fallback 🆕 | 6 | 0 | 0% |
| N: Enhanced Schema & Advanced Features 🆕 | 3 | 0 | 0% |
| **P2.3 小計（Qwen3.5 生態 + 最新研究）** | **20** | **0** | **0%** |
| O: FR-CoT & Tool Necessity & Cross-Validation 🆕 | 3 | 0 | 0% |
| **P2.4 小計（FR-CoT + Probe + CrossVal）** | **3** | **0** | **0%** |
| **總計（P2）** | **60** | **0** | **0%** |

---

## ⚠️ 工具結果真實性

Server 遵循 MSARL 原則不直接呼叫工具。`toolCalls[].result` 由 LLM 自報，
Server 輸出含提醒列。實作時需在 `formatThinkOutput` 中嵌入此提醒。

---

## 📋 工作區塊 F：Atomic Thinking DAG 實作

> 研究來源：Atomic Thinking DAG (OpenReview 2025)、DPPM (arXiv 2506.02683)

- [ ] ⬜ **F1** `dagSort(nodes)` — Topological Sort（Kahn's algorithm）
  - 輸入：`dagNodes: [{id, deps[]}]`
  - 回傳：`{ sorted: number[], circular: boolean, circularPath: number[] }`
  - circular 時報錯「檢測到 circular dependency: N1→N2→...→N1」
  - 測試：4 案例（正常/平行/circular/空）

- [ ] ⬜ **F2** `dagGetReadyNodes(nodes, doneIds)` — 取得可執行節點
  - 所有 deps 都已完成的節點 = ready
  - 回傳：`{ ready: dagNode[], blocked: dagNode[], done: dagNode[] }`
  - 輸出 hint：「📋 可平行執行節點: A, C (無依賴關係)」

- [ ] ⬜ **F3** `dagValidate(args)` — DAG 參數驗證
  - 檢查：每個 node 有 id/desc/status
  - 檢查：deps 指向存在的 node id
  - 檢查：atomic=true 節點不可有 deps
  - 相容 P1 subtasks：若傳 subtasks 非 dagNodes，自動轉換
  - 回傳：`{ errors[], warnings[], converted: boolean }`

- [ ] ⬜ **F4** DAG 輸出格式（formatThinkOutput 整合）
  - DAG 視覺化（ASCII 樹狀圖）：
  ```
  │ ┌─ DAG ────────────────────────
  │ │ A ──→ B ──→ D
  │ │  │ └─→ C ──↑
  │ │ ready: A (可平行執行)
  │ └──────────────────────────────
  ```
  - 平行執行提示：「📋 節點 B 與 C 無依賴關係，可平行進行」

- [ ] ⬜ **F5** DAG + ADAPT 交互
  - ADAPT 分解產生的子節點，自動繼承父節點的 deps
  - 子節點 ID pattern：`{parentId}.{subIndex}`（如 2.1、2.2）
  - 子節點完成後自動標記父節點為 done

---

## 📋 工作區塊 G：ADAPT 自適應分解

> 研究來源：ADAPT (NAACL 2024)、Select-Then-Decompose (EMNLP 2025)

- [ ] ⬜ **G1** `adaptDecompose(args)` — 動態分解核心
  - 觸發條件：LLM 回報 blocked / 無助詞 / cycle 3 次 / confidence < threshold
  - 自動生成子節點：`{ id: nextId, desc: "子步驟", deps: [currentNodeId], parentId }`
  - 檢查 `currentDepth < maxDepth`，否則報 `max_depth` intervention
  - 回傳：`{ newNodes: dagNode[], intervention: {type,message}, updatedDepth }`

- [ ] ⬜ **G2** `adaptCheckTrigger(args)` — 檢查是否需要分解
  - 輸入：parsed thought + 當前節點狀態 + confidence + cycle 狀態
  - 規則：
    1. `status === "blocked"` → 觸發
    2. thought 含無助詞 (`can't`/`無法`/`不知道`) → 觸發
    3. cycle 檢測觸發後仍無改善 → 觸發
    4. confidence < threshold → 觸發
    5. 首次觸發先 suggest tool，無效才 decompose（避免過度分解）
  - 回傳：`{ shouldDecompose: boolean, reason: string, suggestToolFirst: boolean }`

- [ ] ⬜ **G3** `adaptMaxDepthCheck(currentDepth, maxDepth, onFail)` — 深度上限
  - `currentDepth >= maxDepth` → 依 `onFail` 策略行動
  - `onFail="retry"` → 輸出 intervention.type='retry_hint'
  - `onFail="escalate"` → 輸出 intervention.type='escalate'
  - `onFail="decompose"` → 無視深度限制（不安全但靈活）

- [ ] ⬜ **G4** 整合到 `decomposeThinkHandler` 主流程
  - 在 step 4 (active tool suggest) 之後、step 5 (cycle) 之前
  - 先 check trigger → 若需分解 → adaptDecompose → 注入 newNodes 到輸出
  - 輸出格式：
  ```
  │ 🔄 步驟 2「分析錯誤」無法完成
  │    自動分解為：
  │    2.1 定位錯誤位置
  │    2.2 分析 root cause
  │    2.3 建議修復方案
  ```

---

## 📋 工作區塊 H：Thinking Budget 整合

> 研究來源：Qwen3 官方文件、Speculative Thinking (arXiv 2504.12329)

- [ ] ⬜ **H1** `autoDetectBudget(args)` — 自動推斷 thinking budget
  - 規則：
    - `dagNodes.length > 5 || maxDepth > 2` → budget = 1024
    - `dagNodes.length > 3 || template="debug"` → budget = 768
    - 預設 → budget = 512
    - LLM 指定 → 直接用（不覆蓋）
  - 回傳：`{ budget: number, reason: string }`

- [ ] ⬜ **H2** `formatBudgetIndicator(budget, usedTokens?)` — Budget 顯示
  - ASCII budget bar：`💰 [███████░░░] 512 tok (已用 180)`
  - 低於 20% → 紅色 warning
  - box-drawing 嵌入：
  ```
  │ 💰 thinkBudget: 512 tokens ─────────────────
  │    [███████░░░░░░░] 已用 180 (35%)
  │    ✅ 充足
  ```

- [ ] ⬜ **H3** `getQwen3Params(args)` — Qwen3 參數產生器
  - 需處理 Qwen3-4B-Thinking-2507 thinking-only 變體（無 enable_thinking）
  - 根據 task 特性產生 vLLM / Qwen-Agent 相容參數
  - 回傳：`{ enable_thinking, temperature, top_p, top_k, min_p, presence_penalty }`
  - 整合 thinking mode 開關：`args.enableThinking === false` → `enable_thinking: false`
  - 供外部方用：`ssr({tool:"decompose_think", args:{...}})` 可攜帶這些參數

---

## 📋 工作區塊 I：信心評分與驗證循環

> 研究來源：SMART (arXiv 2504.09923)、Blueprint (arXiv 2506.08669)

- [ ] ⬜ **I1** `calcConfidenceScore(parsed, toolCalls, node)` — 信心分數校準
  - 輸入：parseThought 結果 + toolCalls 狀態 + 當前節點
  - 校準公式（SMART 啟發）：
  ```
  score = LLM提供的confidence (0.0-1.0)
  if (parsed.hasHighConfidence && toolCalls.length === 0) score -= 0.2
  if (parsed.hasUncertainty) score -= 0.1 * parsed.uncertaintyLevel
  if (parsed.specificEvidence) score += 0.1
  if (cosineSimilarity(prevThought, currentThought) > 0.5) score += 0.05
  return clamp(score, 0, 1)
  ```
  - 回傳：`{ raw: number, adjusted: number, adjustments: string[] }`

- [ ] ⬜ **I2** `validateNode(node, toolCalls)` — Node 完成驗證
  - checkType 決定驗證方式：
    - `tool_result`：找 toolCalls 中是否有對應的 done 記錄
    - `logical`：檢查 node.evidence 非空 + 非廢話 (tautology check)
    - `manual`：回傳 `{ passed: true, checkType: 'manual' }`（信任 LLM）
  - 回傳：`{ passed: boolean, checkType, checkedAt, reason?: string }`
  - 寫回 node.validation

- [ ] ⬜ **I3** `formatConfidenceBar(score, threshold)` — 信心條視覺化
  - 10 格 ASCII bar：`██████░░░░`
  - 低於 threshold → 紅色 + warning
  - 輸出：
  ```
  │ 🎯 信心水準: ██████░░░░ 0.62
  │ ⚠️ 低於閾值 0.7 → 建議工具驗證
  ```

- [ ] ⬜ **I4** 驗證循環整合
  - 在 `decomposeThinkHandler` 中加入步驟 2.5（介於 parseThought 和 tool tracking 之間）
  - 流程：
    1. LLM 回報 thought + confidence
    2. Server calcConfidenceScore
    3. 若 score < threshold → action（suggest tool / retry / decompose）
    4. 若 score ≥ threshold → 繼續
    5. Node 完成時 validateNode → 記錄結果
  - 輸出：正常情況 confidence 條隱藏，只在低信心時顯示 warning

---

## 📋 工作區塊 J 🆕：Qwen3.5 XML 格式支援

> 研究來源：Qwen3.5 官方文件、vLLM qwen3_coder parser、qwen3_xml parser

- [ ] ⬜ **J1** 建立 `src/lib/qwen3-xml-parser.mjs` — XML tool call 解析器
  - 支援兩種 parser：
    - **qwen3_coder 風格**：regex-based，`<tool_call><function=X><parameter=Y>Z</parameter></tool_call>`
    - **qwen3_xml 風格**：expat-based，更穩定於長 context / 特殊字元
  - 回傳：`{ toolCalls: [{ tool, args: Record<string,string>, raw }] }`
  - 測試：10+ 案例（正常 XML / 巢狀 / 特殊字元 / 截斷 / 空）

- [ ] ⬜ **J2** `parseXmlToolCalls(text)` — 從 thought/reasoning_content 擷取 XML tool call
  - Regex 解析 `<tool_call>` 區塊
  - 處理邊界情況：tool call 在 `<think>` 區塊內、跨多行、巢狀
  - 回傳：`{ found: boolean, calls: xmlToolCall[], warnings: string[] }`

- [ ] ⬜ **J3** `formatXmlToolCall(tool, args)` — 產生 Qwen3.5 相容 XML 格式
  - 輸出：`<tool_call>\n<function={tool}>\n<parameter={key}>\n{value}\n</parameter>\n</tool_call>`
  - 支援多參數
  - 確保 XML 格式與 chat template 相容

- [ ] ⬜ **J4** `detectReasoningChannel(text)` — 偵測 thinking/reasoning 分離
  - 檢查是否有 `<think>` 標記
  - 偵測 tool call 是否在 reasoning_content 而非 content
  - 回傳：`{ channel: "separate"|"inline", toolCallInThink: boolean }`

- [ ] ⬜ **J5** 整合到 `decomposeThinkHandler` 主流程
  - 步驟 0：偵測 `toolCallFormat` 決定用 XML 或 JSON parser
  - 步驟 2：`parseThought` 後接 `parseXmlToolCalls`（若 `toolCallFormat === "xml"`）
  - 步驟 4：XML 格式的 tool suggestion 輸出
  - 測試：5+ 整合案例（Qwen3.5 XML / Qwen3 JSON / thinking-only / streaming）

---

## 📋 工作區塊 K 🆕：Dual Output Format（CoE + Text-CoT 混合）

> 研究來源：Chain-of-Edits (arXiv 2507.05065)、4B boundary finding

- [ ] ⬜ **K1** `detectFormatPreference(subtasks, dagNodes)` — 決定每步驟的輸出格式
  - 規則：
    - dagNode.needsTool === true → **CoE 格式**（tool interaction trace）
    - dagNode.semanticType in ["synthesize","decide"] → **text-CoT 格式**
    - confidence ≥ 0.8 AND toolCalls ≥ 1 → text-CoT（工具已足夠）
    - 預設 → 依 model size（4B 用混合模式）
  - 回傳：`{ steps: [{ nodeId, format: "coe"|"text-cot" }] }`

- [ ] ⬜ **K2** `formatCoEOutput(thought, toolCalls)` — CoE 格式化輸出
  - `<tool_call>` 作為思考 token 的具體實現
  - tool call 前後有推理銜接，非獨立區塊
  - 輸出範例：
  ```
  │ ┌─ 推理軌跡 ──────────────────
  │ │ 錯誤可能在 parseToken 函數  <tool_call> smart_grep({pattern:"parseToken"}) </tool_call>
  │ │ 結果回傳：src/parser.ts:142  │ │ → 確認是 type mismatch
  │ └────────────────────────────
  ```

- [ ] ⬜ **K3** `formatTextCoTOutput(thought)` — text-CoT 格式化輸出
  - 純自然語言推理，不插入 tool call 標記
  - 適用於 `semanticType="synthesize"` 或 `"decide"` 步驟
  - 輸出範例：
  ```
  │ ┌─ 推理 ──────────────────────
  │ │ 根據 grep 結果和 LSP diagnostics，
  │ │ root cause 是 type mismatch...
  │ └────────────────────────────
  ```

- [ ] ⬜ **K4** 前端整合到 `formatThinkOutput`
  - 同一個 `formatThinkOutput` 依 `formatPreference` 動態選擇 CoE / text-CoT
  - 同一任務可混合兩種格式（簡單步驟 CoE，複雜推理 text-CoT）

---

## 📋 工作區塊 L 🆕：Semantic Signal DAG + Hint Injection + TrigReason

> 研究來源：Reasoning Scaffolding (arXiv 2509.23619)、CoRT (NeurIPS 2025)、TrigReason (arXiv 2604.14847)

- [ ] ⬜ **L1** 建立 `src/lib/decompose-semantic.mjs` — Semantic Signal 引擎
  - 詞彙表：analyze / search / verify / synthesize / decide / execute（6 信號）
  - `getSignalForNode(node, context)` — 依 dagNode 內容和 context 決定信號
  - `getToolForSignal(signal)` — 信號→工具配對
  - 回傳：`{ signal: string, prompt: string, suggestedTool: string|null }`

- [ ] ⬜ **L2** `generateHint(node, toolCalls, signal)` — Hint Injection
  - 動態產生 1-2 行 hint，非靜態模板
  - 規則：
    - 首次進入節點 → 提示第一步
    - tool 已執行 → 提示分析結果
    - 信心低 → 提示驗證
    - 重複循環 → 提示換方向
  - 回傳：`{ hint: string|null, position: "before"|"after" }`

- [ ] ⬜ **L3** `trigReasonIntervention(args)` — TrigReason 三觸發器
  - **strategic_primer**：新任務首次呼叫，LLM 產生初始計畫後 Server 提供 strategic priming
  - **cognitive_offload**：偵測到 overconfidence → 建議工具卸載認知負載
  - **intervention_request**：偵測循環/無進展 → 介入建議換方向
  - 取代原有的四優先級系統（保留向後相容）
  - 回傳：`{ trigger: string, intervention, suggestion }`

- [ ] ⬜ **L4** 整合到 `decomposeThinkHandler`
  - 步驟 2.5（parseThought 後）：semantic signal 判斷
  - 步驟 3.5（tool tracking 後）：hint injection
  - 步驟 4.5（active suggest 後）：trigReason 觸發器檢查
  - 測試：15+ 案例（6 信號 × 3 觸發器 + 邊界）

---

## 📋 工作區塊 M 🆕：Bug Resilience & Content Fallback

> 研究來源：vLLM #38789, #38894, #39056；LM Studio #1971, #1589；Qwen-Agent #789

- [ ] ⬜ **M1** `sanitizeContent(text)` — 清理 streaming 洩漏的 reasoning tags
  - 移除殘留的 `<think>`、`</think>`、`<reasoning>`、`</reasoning>` 標記
  - 處理部分 tag（如 `<think` 被截斷在 chunk boundary）
  - 回傳：`{ clean: string, removed: string[], warnings: string[] }`
  - 測試：8+ 案例（完整 tags / 截斷 tags / 巢狀 / 空）

- [ ] ⬜ **M2** `fallbackExtractContent(response)` — 偵測 content=null 並回退
  - 若 `response.choices[0].message.content === null || === ""`：
    - 嘗試從 `reasoning_content` 提取（Qwen3.5 長思考）
    - 查找 `</think>` 之後的內容作為實際 content
    - 若仍無有效 content → 回傳 `{ empty: true, rawReasoning }`
  - 測試：6+ 案例（正常 content / null / 空字串 / reasoning 含 tool call）

- [ ] ⬜ **M3** `detectResponseFormat(response)` — 雙重偵測 API 響應格式
  - 檢查 `reasoning_content` 欄位（OpenAI / DashScope 風格）
  - 檢查 `reasoning` 欄位（Ollama / vLLM 原生風格）
  - 檢查 `reasoning_summary_text` 欄位（Responses API）
  - 回傳：`{ reasoningField: string|null, thinkingMode: boolean, content }`
  - 測試：4+ 案例（OpenAI / Ollama / Responses / 無 thinking）

- [ ] ⬜ **M3.5** `storeRawReasoning(response)` — 儲存原始 reasoning_content 供除錯
  - 在 sanitizeContent 前，先保留原始 `reasoning_content` / `reasoning` 欄位
  - 存到 `_rawReasoningContent` 欄位（不在 schema 中，僅內部使用）
  - 測試：3+ 案例（正常 / null / 含 tool call）
  - 用途：當 M1-M4 回退後，仍可從 raw 還原原始思考內容

- [ ] ⬜ **M5** `retryWithFallback(fn, options)` — M1-M4 重試策略與斷路器
  - 當 content=null 時，最多重試 3 次（每次遞增 thinking_budget）
  - 當 XML parser 持續失敗時，降級為 JSON fallback parser
  - 當所有 parser 都失敗時，回退為純文字推理（no tool call）
  - 斷路器：同一 session 連續 5 次失敗 → 標記為 unrecoverable，通知上層
  - 測試：8+ 案例（重試成功 / 降級 / 斷路 / 混合）
  - 與 Session Store 整合：記錄 `_retryCount`、`_fallbackActive`、`_circuitOpen`

- [ ] ⬜ **M4** 整合到 `decomposeThinkHandler` 主流程
  - 步驟 -1（parseThought 前）：**sanitizeContent** — 清理 streaming 洩漏
  - 步驟 -0.5（參數驗證後）：**fallbackExtractContent** — 補救 content=null
  - 步驟 0（roundType 判斷）：**detectResponseFormat** — 決定 reasoning 欄位來源
  - `ollamaCompat: true` 時啟用額外偵測
  - 測試：10+ 整合案例（各種 bug 組合）

---

## 📋 工作區塊 N 🆕：Enhanced Schema & Advanced Features

> 研究來源：Qwen3.6 Official Docs、ATLAS (arXiv 2603.06713)、KATE (ACL 2026)、Qwen3.5 preserve_thinking

- [ ] ⬜ **N1** `detectPreserveThinking(modelName, qwenVersion)` — Qwen3.6+ preserve_thinking 支援
  - 偵測是否支援 `preserve_thinking: true`
  - 在 multi-turn tool call 中自動啟用
  - 輸出提示：「🔄 preserve_thinking 啟用，多輪 thinking 一致性提升」
  - 回傳：`{ supported: boolean, enabled: boolean }`

- [ ] ⬜ **N2** `iterativeToolLoading(args, dagNodes)` — 動態工具載入（ATLAS ITL 概念）
  - **Handler 定位**：在 roundType 判斷（步驟 0）之後、args 驗證（步驟 1）之前
  - 不屬於 decomposeThinkHandler 的主步驟流程，而是**共享 context 注入函式**
  - 輸出 `{ loadedTools, skippedTools, tokensSaved }` 供 debug 用
  - 依 dagNode.needsTool 和 semanticType 決定哪些工具描述要載入
  - 非目前步驟需要的工具描述不注入 prompt，節省 token
  - 規則：
    - dagNode.needsTool=true → 載入對應工具的完整描述
    - dagNode.semanticType="synthesize"|"decide" → 不載入工具描述（純推理）
    - 預設載入常用工具（smart_grep / smart_read / smart_fast_apply）
  - 回傳：`{ loadedTools: string[], skippedTools: string[], tokensSaved: number }`

- [ ] ⬜ **N3** Qwen3.6 相容性前瞻
  - 文件備註：Qwen3.6 已修復 tool call 在 thinking 區塊問題
  - Qwen3.6 支援平行 tool call（P2 可規劃平行執行）
  - 標記 Qwen3.6-35B-A3B、Qwen3.6-27B 為推薦升級目標

---

## 📁 檔案清單（更新）

| 操作 | 檔案 | 行數 | 歸屬 |
|------|------|------|------|
| 🆕 新創 | `src/plugins/core/smart-decompose-think.mjs` | ~300 行 | P2.1 |
| 🆕 新創 | `src/cli/decompose-think.mjs` | ~900 行 | P2.1+P2.2+P2.3 |
| 🆕 新創 | `src/lib/decompose-dag.mjs` | ~250 行 | 🆕 P2.2 F |
| 🆕 新創 | `src/lib/decompose-adapt.mjs` | ~200 行 | 🆕 P2.2 G |
| 🆕 新創 | `src/lib/decompose-budget.mjs` | ~150 行 | 🆕 P2.2 H |
| 🆕 新創 | `src/lib/decompose-confidence.mjs` | ~200 行 | 🆕 P2.2 I |
| 🆕 新創 | `src/lib/qwen3-xml-parser.mjs` | ~200 行 | 🆕 P2.3 J |
| 🆕 新創 | `src/lib/decompose-semantic.mjs` | ~150 行 | 🆕 P2.3 L |
| 🆕 新創 | `src/lib/decompose-resilience.mjs` | ~150 行 | 🆕 P2.3 M |
| 🆕 新創 | `src/lib/decompose-advanced.mjs` | ~100 行 | 🆕 P2.3 N |
| 🆕 新創 | `src/lib/decompose-frcot.mjs` | ~100 行 | 🆕 P2.4 O1 FR-CoT |
| 🆕 新創 | `src/lib/decompose-necessity.mjs` | ~80 行 | 🆕 P2.4 O2 Tool Necessity |
| 🆕 新創 | `src/lib/decompose-crossval.mjs` | ~80 行 | 🆕 P2.4 O3 Cross-Validation |
| 🔼 擴充 | `src/lib/think-utils.mjs` | +~250 行 | P2.1+P2.2+P2.3+P2.4 |
| 🆕 新創 | `tests/decompose-think.test.mjs` | ~900 行 | P2.1+P2.2+P2.3 |
| 🆕 新創 | `tests/decompose-frcot.test.mjs` | ~100 行 | 🆕 P2.4 O1 |
| 🆕 新創 | `tests/decompose-necessity.test.mjs` | ~80 行 | 🆕 P2.4 O2 |
| 🆕 新創 | `tests/decompose-crossval.test.mjs` | ~80 行 | 🆕 P2.4 O3 |
| 🆕 新創 | `tests/decompose-dag.test.mjs` | ~200 行 | 🆕 P2.2 F |
| 🆕 新創 | `tests/decompose-confidence.test.mjs` | ~150 行 | 🆕 P2.2 I |
| 🆕 新創 | `tests/qwen3-xml-parser.test.mjs` | ~150 行 | 🆕 P2.3 J |
| 🆕 新創 | `tests/decompose-semantic.test.mjs` | ~150 行 | 🆕 P2.3 L |
| 🆕 新創 | `tests/decompose-resilience.test.mjs` | ~150 行 | 🆕 P2.3 M |
| 🆕 新創 | `tests/decompose-advanced.test.mjs` | ~100 行 | 🆕 P2.3 N |
| ✅ **合計** | **23 檔案** | **~+4620 行** | **P2 總計** |

## 🎯 P2 實作順序建議

```
P2.1（核心機制）→ P2.2（研究整合）
  │                    │
  ├─ A 分析引擎        ├─ F DAG 實作
  ├─ B Tool 追蹤       ├─ G ADAPT 分解
  ├─ C Plugin          ├─ H Budget 整合
  ├─ D 核心整合        ├─ I 信心評分
  └─ E 測試           └─ 整合測試
```

> **執行策略**：P2.1 → P2.2 → P2.3 → P2.4（FR-CoT + Necessity + CrossVal）
> P2.3 平行執行：J (XML) → M (Bug Resilience) → K (Dual Format) → L (Semantic Signal) → N (Advanced)
> P2.4 順序：O1 FR-CoT（最簡單，獨立 lib）→ O2 Necessity（依賴 A1）→ O3 CrossVal（依賴 B1）→ 整合測試
> 每個區塊實作順序：lib → cli → plugin → test

---

## 🔗 參考

- [think_plan.md](./think_plan.md) — 完整設計文件（含 P2.2 + P2.3 新設計）
- `src/plugins/core/smart-decompose.mjs` — P1 plugin
- `src/cli/decompose.mjs` — P1 核心
- `src/lib/think-utils.mjs` — 共用格式化工具
- `src/lib/context-budget.mjs` — budget 管理
- `src/lib/qwen3-xml-parser.mjs` — 🆕 Qwen3.5 XML tool call parser
- `src/lib/decompose-semantic.mjs` — 🆕 Semantic Signal + Hint Injection
- `src/lib/decompose-resilience.mjs` — 🆕 Bug Resilience (M1-M4)
- `src/lib/decompose-advanced.mjs` — 🆕 Advanced Features (N1-N3)
- `config/agents/smart-mcp.md` — 路由規則

### 🆕 新增引用論文

- - CoRT — Hint-Engineering (NeurIPS 2025)
- Tandem — Cost-Aware Termination (ACL 2026 Findings)
- PASTE — Speculative Tool Execution (arXiv 2603.18897)
- Reasoning Scaffolding — Semantic Signals (arXiv 2509.23619)
- TrigReason — Three-Trigger Intervention (arXiv 2604.14847)
- Qwen3.5 — Official Documentation (2026)
- Qwen3-Coder-Next — XML Tool Format (arXiv 2603.00729)
- ATLAS — Agentic Scaffolding + Iterative Tool Loading (arXiv 2603.06713)
- KATE — Knowledge-Augmented Tool Execution (ACL 2026, Findings)
- PTR — Profile-Then-Reason (arXiv 2604.04131)
- TInR — Tool-Internalized Reasoning (ACL 2026)
- Maestro-4B — RL-trained 4B Orchestrator (arXiv 2605.22177)
- ToolOrchestra — 8B RL Orchestrator (OpenReview 2026)
- ParaManager — Qwen3-4B Parallel Orchestrator (arXiv 2604.17009)
- vLLM #38789 — Streaming + stop 序列洩漏 `</think>`
- vLLM #38894 — Qwen3.5 thinking-only content=null
- LM Studio #1971 — Structured output 進 reasoning_content 非 content
- LM Studio #1589 — Reasoning parser 吸收 `<tool_call>` 區塊
- FR-CoT — Brief Is Better (arXiv 2604.02155)
- Probe&Prefill — Hidden State Tool Necessity (arXiv 2605.09252)
- AgentProp-Bench — Tool Result Reliability κ=0.049 (arXiv 2604.16706)
- When2Tool — Tool Necessity Benchmark (arXiv 2605.09252)
- LocoOperator-4B — 4B Distillation Tool Calling (HuggingFace 2026)
- ToolTuned-Qwen — LoRA Qwen3.5-4B Tool Calling (GitHub 2026)
- WildToolBench — Multi-turn Tool Orchestration (arXiv 2604.06185)
- MAVEN — Verification Scaffold (arXiv 2605.30738)

---

## 📋 工作區塊 P：🆕 P2.5 Tool Presence Management (P2.5-A)

- [ ] ⬜ **P1** `decideVisibility(args, dagNodes, roundType)` — 決定 tool visibility
  - 支援 `always` / `decision_only` / `auto` 三模式
  - auto 模式判斷規則（見 think_plan.md P2.5-A）
  - 回傳 `{ hideTools, reason, nextVisibility }`
  - 測試：12 案例（3 模式 × 4 情境）

- [ ] ⬜ **P2** `stripToolDescriptions(args)` — 從 prompt 移除工具描述
  - 隱藏所有 tool schema，保留 tool call 歷史
  - 回傳修改後的 args + `{ _toolsHidden, _hiddenCount }`
  - 測試：4 案例（部分隱藏/全隱藏/無工具/已隱藏）

- [ ] ⬜ **P3** `restoreToolDescriptions(args)` — 恢復工具描述
  - 在 LLM 決定 call tool 時注入工具 schema
  - 輸出提示：「🔧 工具已就緒」
  - 測試：4 案例

- [ ] ⬜ **P4** 整合到 `decomposeThinkHandler` 主流程
  - 步驟 -2（最高優先級，在 sanitizeContent 之前）
  - 測試：6 案例（整合場景）

## 📋 工作區塊 Q：🆕 P2.5 Chat Template Detection (P2.5-B)

- [ ] ⬜ **Q1** 建立 `src/lib/template-detector.mjs`
  - `detectChatTemplate(modelName, responseHeaders)` — 偵測當前 template
  - `scoreTemplate(template)` — 評分 0-100
  - `checkKnownIssues(template)` — 檢查 CT1-CT5
  - 測試：10 案例（5 問題 × 2 狀態）

- [ ] ⬜ **Q2** `recommendTemplateAction(score, warnings, engine)` — 建議動作
  - score ≥ 60 → 正常
  - score 40-59 → warning + 建議
  - score < 40 → 降級警告
  - 回傳 `{ action, message, recommendedTemplate }`
  - 測試：6 案例

- [ ] ⬜ **Q3** 整合到 `decomposeThinkHandler` 步驟 -1.5
  - 在 engine detection 之後、sanitizeContent 之前
  - 測試：4 案例

## 📋 工作區塊 R：🆕 P2.5 Graceful Degradation (P2.5-C)

- [ ] ⬜ **R1** `checkDegradation(history, currentLevel)` — 降級條件檢查
  - Level 0→1：連續 3 次 intervention 無改善 / confidence < 0.3 達 2 輪
  - Level 1→2：Level 1 仍失敗 / budget critical
  - 回傳 `{ shouldDegrade, newLevel, reason }`
  - 測試：8 案例

- [ ] ⬜ **R2** `formatDegradationHeader(level, reason)` — 降級標題格式化
  - Level 0：正常 `smart_decompose_think`
  - Level 1：`smart_decompose (degraded)` + 原因
  - Level 2：`direct (minimal)` + 原因
  - 測試：3 案例

- [ ] ⬜ **R3** 整合到 `decomposeThinkHandler` 步驟 8
  - 在 formatThinkOutput 前檢查降級
  - 降級後修改 toolSuggestion/intervention 行為
  - 測試：6 案例

## 📋 工作區塊 S：🆕 P2.5 Engine Abstraction (P2.5-D)

- [ ] ⬜ **S1** 建立 `src/lib/engine-detector.mjs`
  - `detectEngine()` — 從環境變數/model path 自動偵測
  - `getEngineConfig(type)` — 回傳引擎特定參數
  - `formatEngineHint(config)` — 輸出部署建議
  - 測試：6 案例（vLLM/SGLang/llama.cpp/Ollama/MLX/unknown）

- [ ] ⬜ **S2** 引擎特定相容性表
  | 引擎 | toolCallParser | reasoningParser | contentNull |
  |------|---------------|-----------------|-------------|
  | vLLM | qwen3_coder | qwen3 | fallback |
  | SGLang | qwen3_coder | qwen3 | fallback |
  | llama.cpp | auto | built-in | rare |
  | Ollama | auto | built-in | common |
  | MLX | qwen3_coder | qwen3_5 | fixed(PR#284) |

- [ ] ⬜ **S3** 整合到 `decomposeThinkHandler` 步驟 -1
  - 自動偵測引擎並設定相容性 flags
  - 影響：parser 選擇、fallback 策略、streaming 模式
  - 測試：6 案例

## 📊 進度追蹤（更新）

| 區塊 | 總項 | ✅ | 📊 進度 |
|------|------|----|---------|
| A: 核心分析引擎 | 6 | 0 | 0% |
| B: Tool 循環追蹤 | 4 | 0 | 0% |
| C: Plugin + 整合 | 5 | 0 | 0% |
| D: 核心整合 | 4 | 0 | 0% |
| F: Atomic DAG 實作 | 5 | 0 | 0% |
| G: ADAPT 自適應分解 | 4 | 0 | 0% |
| H: Thinking Budget | 3 | 0 | 0% |
| I: 信心評分 | 4 | 0 | 0% |
| J: Qwen3.5 XML 格式 | 5 | 0 | 0% |
| K: Dual Output Format | 4 | 0 | 0% |
| L: Semantic Signal | 4 | 0 | 0% |
| M: Bug Resilience | 6 | 0 | 0% |
| N: Advanced Features | 3 | 0 | 0% |
| O: FR-CoT & Necessity & CrossVal | 3 | 0 | 0% |
| **P: Tool Presence Management 🆕** | **4** | **0** | **0%** |
| **Q: Chat Template Detection 🆕** | **3** | **0** | **0%** |
| **R: Graceful Degradation 🆕** | **3** | **0** | **0%** |
| **S: Engine Abstraction 🆕** | **3** | **0** | **0%** |
| **總計（P2+P2.5）** | **73** | **0** | **0%** |

---

## 📋 工作區塊 T：🆕 P2.6-A 強化 Tool Necessity Scorer

- [ ] ⬜ **T1** 重寫 `scoreToolNecessity(thought, taskContext, history)` — 三層必要性評分
  - 取代原 O2 的 80 行 `checkToolNecessity`（保留相容性 wrapper）
  - 三層：heuristic proxy + context-aware + history-aware
  - 輸出：`{ score, confidence, reason, action }`
  - 測試：15 案例（5 heuristic × 3 context）

- [ ] ⬜ **T2** `getDynamicThreshold(args)` — 動態閾值
  - 依 strictness / 循環狀態 / budget 調整
  - 回傳 0.3-0.9 浮動值
  - 測試：8 案例（4 因子 × 2 組合）

- [ ] ⬜ **T3** 整合到 B3 `activeToolSuggest`
  - 取代原有的前置 checkToolNecessity 呼叫
  - 測試：6 整合案例

## 📋 工作區塊 U：🆕 P2.6-B 強化 Cross-Validation

- [ ] ⬜ **U1** 重寫 `crossValidateToolCalls(reportedCalls, thought, history)` — 4 維度驗證
  - 取代原 O3（保留 wrapper）
  - 維度：claim_evidence_gap / result_length_anomaly / cross_turn_inconsistency / empty_args
  - 輸出：`{ score, checks[], conclusion }`
  - 測試：20 案例（4 維度 × 5 情境）

- [ ] ⬜ **U2** 整合到 A3 `checkConfidence` / I1 `calcConfidenceScore`
  - conclusion="cautious" → confidence -= 0.15
  - conclusion="low_confidence" → confidence = min(confidence, 0.4)
  - 測試：6 案例

## 📋 工作區塊 V：🆕 P2.6-C 平行 Tool Call Orchestration

- [ ] ⬜ **V1** `batchToolCallsByDAG(dagNodes)` — 從 DAG 產生批次
  - Kahn's algorithm 分層 → 每層一個 batch
  - 回傳 `{ batches: [{ ids, tools }], parallel: boolean[] }`
  - 測試：8 案例（3 DAG 結構 × 邊界）

- [ ] ⬜ **V2** `detectParallelToolCall(thought)` — 偵測 Qwen3.6 平行 tool call
  - 多個 `<tool_call>` 區塊無分隔文字
  - 回傳 `{ isParallel, callCount, tools[] }`
  - 測試：6 案例

- [ ] ⬜ **V3** 整合到 B1 `trackToolCalls`
  - 支援一次處理多個 tool call 狀態更新
  - 測試：4 案例

## 📋 工作區塊 W：🆕 P2.6-D Budget Forcing

- [ ] ⬜ **W1** `checkBudgetForcing(subtaskId, toolCalls, config)` — 工具次數強制
  - 低於 minToolCallsPerSubtask → intervention
  - 超過 maxToolCallsPerSubtask → intervention
  - 回傳 `{ forceNeeded, type, message }`
  - 測試：6 案例

- [ ] ⬜ **W2** 整合到主流程（步驟 5.5，在 activeToolSuggest 後、循環檢測前）
  - 測試：4 案例

## 📊 進度追蹤（更新）

| 區塊 | 總項 | ✅ | 📊 進度 |
|------|------|----|---------|
| A: 核心分析引擎 | 6 | 0 | 0% |
| B: Tool 循環追蹤 | 4 | 0 | 0% |
| C: Plugin + 整合 | 5 | 0 | 0% |
| D: 核心整合 | 4 | 0 | 0% |
| F: Atomic DAG 實作 | 5 | 0 | 0% |
| G: ADAPT 自適應分解 | 4 | 0 | 0% |
| H: Thinking Budget | 3 | 0 | 0% |
| I: 信心評分 | 4 | 0 | 0% |
| J: Qwen3.5 XML 格式 | 5 | 0 | 0% |
| K: Dual Output Format | 4 | 0 | 0% |
| L: Semantic Signal | 4 | 0 | 0% |
| M: Bug Resilience | 6 | 0 | 0% |
| N: Advanced Features | 3 | 0 | 0% |
| O: FR-CoT & Necessity & CrossVal | 3 | 0 | 0% |
| P: Tool Presence Management | 4 | 0 | 0% |
| Q: Chat Template Detection | 3 | 0 | 0% |
| R: Graceful Degradation | 3 | 0 | 0% |
| S: Engine Abstraction | 3 | 0 | 0% |
| **T: O2 Necessity Scorer 🆕** | **3** | **0** | **0%** |
| **U: O3 Cross-Validation 🆕** | **2** | **0** | **0%** |
| **V: Parallel Tool Call 🆕** | **3** | **0** | **0%** |
| **W: Budget Forcing 🆕** | **2** | **0** | **0%** |
| **總計（P2+P2.5+P2.6）** | **83** | **0** | **0%** |

---

## 📋 工作區塊 X：🆕 P2.7-A 效能指標框架

- [ ] ⬜ **X1** 建立 `src/lib/decompose-metrics.mjs`
  - `initMetrics()` — 初始化追蹤器
  - `updateMetrics(roundData)` — 每輪更新 6 個 KPIs
  - `formatMetricsBar(metrics)` — 儀表板輸出
  - 測試：8 案例（每 KPI 更新 + 整合）

- [ ] ⬜ **X2** 整合到 `decomposeThinkHandler` 步驟 9
  - 在 formatThinkOutput 後、回傳前
  - `_showMetrics: true` 時附加儀表板
  - 測試：4 案例

## 📋 工作區塊 Y：🆕 P2.7-B 模型配置設定檔

- [ ] ⬜ **Y1** 建立 `src/lib/model-configs.mjs`
  - 3 個預設配置：Qwen3.5-4B / Qwen3-4B-Thinking-2507 / Qwen3.6-27B
  - `detectModelConfig(modelName)` — 從模型名稱自動匹配
  - `getRecommendedParams(config)` — 回傳推理參數
  - 測試：6 案例（4 模型匹配 + 2 未知回退）

- [ ] ⬜ **Y2** 整合到 `decomposeThinkHandler` 步驟 -1.5
  - 在 engine detection 之後、chat template detection 之前
  - 影響：toolCallParser / thinkingBudget / contentNullRisk 等設定
  - 測試：4 案例

## 📋 工作區塊 Z：🆕 P2.7-C 整合測試

- [ ] ⬜ **Z1** 建立 `tests/integration-p2-end-to-end.test.mjs`
  - 8 個 E2E 測試案例（見 think_plan.md P2.7-C 表格）
  - 使用 mock LLM 回應（避免實際 API 呼叫）
  - 測試架構：
    ```javascript
    describe('P2 E2E', () => {
      it('E2E-1: 簡單 Q&A 無需 tool', async () => { ... });
      it('E2E-2: 搜尋任務 1 tool', async () => { ... });
      it('E2E-3: 除錯任務 3 tools', async () => { ... });
      it('E2E-4: 工具結果錯誤 + cross-val', async () => { ... });
      it('E2E-5: Tool presence suppression', async () => { ... });
      it('E2E-6: 降級鏈測試', async () => { ... });
      it('E2E-7: Qwen3.6 平行 tool call', async () => { ... });
      it('E2E-8: Chat template 問題偵測', async () => { ... });
    });
    ```

- [ ] ⬜ **Z2** P2.5 整合測試（I-P2.5-1 ~ I-P2.5-8）
- [ ] ⬜ **Z3** P2.6 整合測試（I-P2.6-1 ~ I-P2.6-8）

## 📊 最終進度追蹤

| 區塊 | 總項 | ✅ | 📊 進度 |
|------|------|----|---------|
| A: 核心分析引擎 | 6 | 0 | 0% |
| B: Tool 循環追蹤 | 4 | 0 | 0% |
| C: Plugin + 整合 | 5 | 0 | 0% |
| D: 核心整合 | 4 | 0 | 0% |
| F: Atomic DAG 實作 | 5 | 0 | 0% |
| G: ADAPT 自適應分解 | 4 | 0 | 0% |
| H: Thinking Budget | 3 | 0 | 0% |
| I: 信心評分 | 4 | 0 | 0% |
| J: Qwen3.5 XML 格式 | 5 | 0 | 0% |
| K: Dual Output Format | 4 | 0 | 0% |
| L: Semantic Signal | 4 | 0 | 0% |
| M: Bug Resilience | 6 | 0 | 0% |
| N: Advanced Features | 3 | 0 | 0% |
| O: FR-CoT & Necessity & CrossVal | 3 | 0 | 0% |
| P: Tool Presence Management | 4 | 0 | 0% |
| Q: Chat Template Detection | 3 | 0 | 0% |
| R: Graceful Degradation | 3 | 0 | 0% |
| S: Engine Abstraction | 3 | 0 | 0% |
| T: O2 Necessity Scorer (強化) | 3 | 0 | 0% |
| U: O3 Cross-Validation (強化) | 2 | 0 | 0% |
| V: Parallel Tool Call | 3 | 0 | 0% |
| W: Budget Forcing | 2 | 0 | 0% |
| **X: Performance Metrics 🆕** | **2** | **0** | **0%** |
| **Y: Model Config Profiles 🆕** | **2** | **0** | **0%** |
| **Z: Integration Tests 🆕** | **3** | **0** | **0%** |
| **總計（P2.1-P2.7）** | **90** | **0** | **0%** |
