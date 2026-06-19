# Smart MCP 三層漸進式載入架構計畫

## 問題

`smart-mcp.md`（531 行，~25KB）是 agent 性格核心，**每次對話全量載入**。
簡單任務（讀檔、改一行、搜尋）也付出完整 system prompt 成本（~3000-5000 tokens），
導致簡單任務的 system prompt 成本 > 實際任務收益。

## 核心約束

- **`smart-mcp.md` 性格不能分裂** — 路由規則、行為閘、推理模式必須保持統一
- 必須對所有任務類型（簡單/中等/複雜）都有淨效益
- 向後相容，不破壞現有功能

## 解法：性格統一 + 工具描述精簡 + 詳細文件延遲載入

```
smart-mcp.md（性格統一，~250 行，省 50%）
  ├─ 路由規則、行為閘、推理模式 → 完整保留
  ├─ 工具描述 → 1-2 行精簡版（從 5-10 行縮短）
  ├─ 工作流模式 → 移到 reference（延遲載入）
  └─ 詳細範例 → 移到 reference（延遲載入）

MCP Server 端：
  ├─ Tier Manager → 監聽對話，動態升級
  ├─ L0 工具 → 永遠可用
  ├─ L1 工具 → 關鍵字觸發後可用
  └─ L2 工具 → 顯式呼叫 smart_run 後可用
```

---

## 完整工具三層分類

### L0 核心層（9 工具，永遠可用）

這些是「任何任務都可能會用」的基礎工具，覆蓋 90% 日常任務。

| # | 工具 | 分類 | 原因 |
|---|------|------|------|
| 1 | `smart_read` | 讀取 | 最常用工具，11 種模式，完全取代 raw read |
| 2 | `smart_grep` | 搜尋 | 程式碼 regex 搜尋，附 scope/import context |
| 3 | `smart_glob` | 搜尋 | 檔案 glob 查找，取代內建 glob |
| 4 | `smart_fast_apply` | 編輯 | 統一編輯工具，取代 write+edit |
| 5 | `smart_context` | 會話 | Session 管理、budget 查詢 |
| 6 | `smart_think` (cit) | 推理 | 基本推理，BN-DP 自動判斷分支 |
| 7 | `smart_exa_search` | 搜尋 | 網路搜尋，使用頻率極高 |
| 8 | `smart_exa_crawl` | 搜尋 | 網頁爬取，使用頻率高 |
| 9 | `smart_github_search` | 搜尋 | GitHub 程式碼搜尋 |

### L1 分析層（11 工具，關鍵字觸發）

這些是「需要深入分析程式碼」時才需要的工具。

**觸發條件**：LLM 對話或 tool call 包含以下關鍵字 —
`定義` `引用` `型別` `重構` `安全` `測試` `onboarding` `規則` `索引` `深度分析` `幻覺`

| # | 工具 | 分類 | 原因 |
|---|------|------|------|
| 10 | `smart_lsp` | 程式碼 | Type-aware：定義/引用/型別/診斷 |
| 11 | `smart_learn` | 程式碼 | 專案 onboarding（語言、結構、慣例） |
| 12 | `smart_rules` | 程式碼 | 專案規則查詢（AGENTS.md 等） |
| 13 | `smart_codebase_index` | 程式碼 | 持久化程式碼索引（build/query/map） |
| 14 | `smart_test` | 品質 | 自動偵測測試框架並執行 |
| 15 | `smart_security` | 品質 | 安全掃描（credentials/injection/deps） |
| 16 | `smart_compact` | 品質 | 零成本 context 壓縮 |
| 17 | `smart_hallucination_check` | 品質 | 輸出真實性驗證 |
| 18 | `smart_think` (beam/forest/structured) | 推理 | 進階推理模式 |
| 19 | `smart_deep_think` | 推理 | 深度分析（10 模板） |
| 20 | `smart_fast_apply` (advanced) | 編輯 | 進階編輯（hashline/block-diff/AST） |

### L2 工作流層（3 入口 + 49 sub-tools，顯式觸發）

這些是「需要多步驟工作流」時才需要的工具。

**觸發條件**：LLM 呼叫 `smart_run` 或 `smart_deep_think`

| # | 工具 | 分類 | 原因 |
|---|------|------|------|
| 21 | `smart_academic_search` | 學術 | 學術文獻搜尋（OpenAlex/Crossref/Semantic Scholar） |
| 22 | `smart_academic_review` | 學術 | 同儕審查（Remi 10-point） |
| 23 | `smart_docx_generate` | 學術 | APA 7th DOCX 生成 |
| 24 | `smart_run` | 路由 | **所有 sub-tools 入口**（見下方 49 個 sub-tools） |

#### L2 Sub-tools（透過 smart_run 呼叫，49 個）

| 分類 | 工具 |
|------|------|
| 程式碼分析 (9) | `hybrid_router` `arch_overview` `import_graph` `code_call_graph` `code_query` `code_impact` `code_ast` `code_type_infer` `naming` |
| 編輯 (3) | `patch_gen` `cross_file_edit` `rename_safety` |
| 除錯 (3) | `error_diagnose` `debug` `test_suggest` |
| Git (4) | `git_context` `git_commit` `git_review` `git_pr` |
| 規劃 (4) | `planner` `workflow` `compose` `memory_store` |
| 文件 (3) | `ingest_document` `list_documents` `search_docs` |
| 瀏覽器 (1) | `pw_browser` |
| 學術 (4) | `academic_search` `academic_review` `docx_generate` `hallucination_check` |
| 知識庫 (4) | `obsidian_write` `kg` `db` `adr` |
| 排程 (2) | `schedule` `progress` |
| 自動化 (4) | `autofix` `pr_review` `agent_execute` `refactor_plan` |
| 其他 (8) | `research` `model_router` `impact_flow` `integrate` `agent_recommend` `agent_plan` `coverage` `exec` |

---

## 實作方案

### Phase 1：smart-mcp.md 精簡化（核心）

**原則**：性格統一，工具描述精簡，詳細內容延遲載入。

```
smart-mcp.md 改造前後對比：

改造前（531 行）：
  ├─ 權限規則         30 行
  ├─ 路由規則         10 行
  ├─ L1 工具表格      30 行（每個工具 3-5 行描述）
  ├─ L2 工具表格      50 行（每個工具 1 行）
  ├─ 架構工作流       15 行
  ├─ 文件工具指南     30 行
  ├─ 常用工作流模式   40 行
  ├─ 推理品質工作流  140 行
  ├─ fast_apply 指南  15 行
  ├─ Token 優化       10 行
  ├─ 行為閘           55 行
  ├─ 推理品質閘       35 行
  └─ Skill Learning   30 行

改造後（~250 行，省 53%）：
  ├─ 權限規則         30 行  ← 保留
  ├─ 路由規則         10 行  ← 保留（精簡）
  ├─ L0 工具表格      15 行  ← 1-2 行/工具
  ├─ L1 工具表格      15 行  ← 1 行/工具 + 觸發條件
  ├─ L2 工具表格       8 行  ← 分類摘要 + smart_run 入口
  ├─ 架構工作流        0 行  ← 移到 reference
  ├─ 文件工具指南      0 行  ← 移到 reference
  ├─ 常用工作流模式    0 行  ← 移到 reference
  ├─ 推理品質工作流   40 行  ← 保留核心，精簡範例
  ├─ fast_apply 指南   5 行  ← 精簡為 3 種基本用法
  ├─ Token 優化       10 行  ← 保留
  ├─ 行為閘           30 行  ← 保留核心規則
  ├─ 推理品質閘       15 行  ← 保留強制規則
  └─ Skill Learning   15 行  ← 保留核心
```

### Phase 2：建立 Reference 文件（延遲載入）

建立 `config/agents/reference/` 目錄，存放詳細文件：

| 檔案 | 內容 | 載入時機 |
|------|------|---------|
| `workflows.md` | 架構評估、常用工作流模式 | L1 觸發 |
| `documents.md` | 文件工具指南（OCR 等） | 呼叫 ingest_document 時 |
| `reasoning.md` | 推理品質工作流完整範例 | L1 觸發 |
| `fast-apply.md` | fast_apply 完整指南（6 格式） | L1 觸發 |
| `behavior-gates.md` | 行為閘完整規則 | L1 觸發 |

### Phase 3：MCP Server Tier Manager

在 `src/server/index.mjs` 新增 Tier Manager：

```javascript
// Tier Manager 核心邏輯
const tierManager = {
  currentTier: 0,
  
  // L1 觸發關鍵字（正則）
  l1Triggers: /定義|引用|型別|重構|安全|測試|onboarding|規則|索引|深度分析|幻覺|diagnostics|references|definition/,
  
  // L1 觸發工具
  l1ToolTriggers: ['smart_lsp', 'smart_learn', 'smart_rules', 'smart_codebase_index', 
                    'smart_test', 'smart_security', 'smart_compact', 'smart_hallucination_check',
                    'smart_deep_think'],
  
  // L2 觸發工具
  l2ToolTriggers: ['smart_run', 'smart_academic_search', 'smart_academic_review', 'smart_docx_generate'],
  
  upgrade(tier) {
    if (tier <= this.currentTier) return;
    this.currentTier = tier;
    // 動態更新 tools/list
    this.notifyToolsChanged();
  },
  
  detectFromToolCall(toolName) {
    if (this.l2ToolTriggers.includes(toolName)) this.upgrade(2);
    else if (this.l1ToolTriggers.includes(toolName)) this.upgrade(1);
  },
  
  detectFromConversation(text) {
    if (this.l1Triggers.test(text)) this.upgrade(1);
  }
};
```

### Phase 4：system-prompt.mjs 更新

更新 `src/agent/system-prompt.mjs`，反映新的三層架構：

- L0 工具清單（精簡）
- L1/L2 觸發條件說明
- Reference 文件載入指引

---

## 預期效益

| 任務類型 | 目前 prompt | 改造後 prompt | 節省 |
|---------|------------|-------------|------|
| 🔹 簡單（讀檔、改一行、搜尋） | ~25KB (531行) | **~12KB (250行)** | **53%** |
| 🔸 中等（除錯、找定義、跑測試） | ~25KB (531行) | **~18KB (250行 + L1 ref)** | **28%** |
| 🔴 複雜（重構、安全修復、多步驟） | ~25KB (531行) | **~25KB (全載入)** | **0%** |

**關鍵**：簡單任務（佔 70%+ 對話）省 53% system prompt token，讓淨效益轉正。

---

## 不改動的部分

- `smart-mcp.md` 性格核心（路由規則、行為閘、推理模式）→ 保持統一
- 所有工具功能 → 不受影響
- `smart_run` sub-tools → 向後相容
- `config/agents/smart-mcp.md` 權限區塊 → 不變

---

## Phase 6：三層載入進階優化（3-4 天）

> 現有 Phase 1-5 解決了「量」的問題（省 token），Phase 6-9 解決「質」的問題（更聰明）。

### 6.1 L1 精準載入（取代全量關鍵字觸發）

**問題**：目前 L1 觸發是「全有或全無」— 關鍵字命中就載入全部 11 個 L1 工具。但「找定義」只需要 `smart_lsp`，不需要 `smart_security`。

**解法**：意圖分類 + 精準載入

```javascript
// 意圖 → 需要的 L1 工具（只載相關的 2-3 個，不是全部 11 個）
const INTENT_TOOLS = {
  find_definition:  ['smart_lsp'],                          // 找定義
  understand_code:  ['smart_lsp', 'smart_learn'],           // 理解程式碼
  refactor:         ['smart_lsp', 'smart_codebase_index'],  // 重構
  security:         ['smart_security'],                     // 安全
  testing:          ['smart_test'],                         // 測試
  deep_analysis:    ['smart_deep_think', 'smart_lsp'],      // 深度分析
  verify_output:    ['smart_hallucination_check'],          // 驗證輸出
};

// 意圖分類（輕量，~10 個 pattern）
function classifyIntent(text) {
  if (/找.*定義|definition|where is|在哪/.test(text)) return 'find_definition';
  if (/重構|refactor|rename|restructure/.test(text)) return 'refactor';
  if (/安全|security|vuln|漏洞/.test(text)) return 'security';
  if (/測試|test|跑.*測/.test(text)) return 'testing';
  // ...
  return 'understand_code'; // 預設
}
```

**預期效益**：L1 載入從 11 工具 → 2-3 工具，再省 30-40% token。

### 6.2 Session-tier 記憶

**問題**：每次對話從 L0 開始，連續 debug 5 次就要觸發 5 次。

**解法**：Session 內 tier 只升不降

```javascript
const tierManager = {
  currentTier: 0,
  sessionTier: 0,  // ← 新增：session 內記憶

  upgrade(tier) {
    if (tier <= this.sessionTier) return;  // session 內已升級過
    this.currentTier = tier;
    this.sessionTier = Math.max(this.sessionTier, tier);
    this.notifyToolsChanged();
  },

  resetSession() {
    this.sessionTier = 0;  // 新 session 才重置
    this.currentTier = 0;
  }
};
```

**預期效益**：同 session 內重複觸發成本 → 0。

### 6.3 專案類型預載入

**問題**：使用者開專案第一句話通常是「幫我理解這個專案」，這時才觸發 L1 已經慢了。

**解法**：偵測專案類型 → 預載對應工具

```javascript
const PROJECT_DEFAULTS = {
  'package.json':    ['smart_lsp'],                    // JS/TS
  'tsconfig.json':   ['smart_lsp'],                    // TypeScript
  'Cargo.toml':      ['smart_lsp', 'smart_learn'],     // Rust
  'go.mod':          ['smart_lsp', 'smart_learn'],     // Go
  'pyproject.toml':  ['smart_lsp'],                    // Python
  'pom.xml':         ['smart_learn'],                  // Java
};

// 啟動時偵測 → 直接預載到 L1
function detectProjectType(root) {
  for (const [file, tools] of Object.entries(PROJECT_DEFAULTS)) {
    if (fs.existsSync(path.join(root, file))) {
      tierManager.preload(tools);  // 預載，不等觸發
      return;
    }
  }
}
```

**預期效益**：第一個問題就快，不用等觸發。

---

## Phase 7：fast_apply 進階優化（3-4 天）

> 現有 plan.md Phase 0-3 解決「匹配衝突」，Phase 7 解決「語意正確性」。

### 7.1 編輯後自動測試驗證

**問題**：Phase 3 只驗證語法（縮排、分號），不驗證行為。

**解法**：編輯後自動跑相關測試

```javascript
// fast_apply 編輯完成後
async function verifyEdit(file, symbol) {
  // 1. 從 CKG test coverage map 找相關測試
  const relatedTests = await ckgQuery('test-coverage', { file, symbol });

  // 2. 跑相關測試
  if (relatedTests.length > 0) {
    const result = await smartTest({ include: relatedTests });

    // 3. 測試失敗 → 自動 rollback + 回報 LLM
    if (!result.passed) {
      await rollback(file);
      return {
        status: 'rollback',
        reason: `測試失敗：${result.failedTests.join(', ')}`,
        suggestion: '請修正後重試',
      };
    }
  }

  return { status: 'verified' };
}
```

**預期效益**：從「語法正確」升級到「行為正確」，避免 silent bug。

### 7.2 意圖導向編輯（長期目標）

**問題**：LLM 給 SEARCH/REPLACE block，匹配可能出錯。

**解法**：讓 LLM 給「意圖」而非「文字」，fast_apply 用 AST 精準執行

```javascript
// LLM 給意圖（不是 SEARCH/REPLACE）
const editIntent = {
  intent: 'make_async',
  target: { file: 'src/auth.ts', symbol: 'login' },
  changes: {
    addAsync: true,
    returnType: 'Promise<User>',
  },
};

// fast_apply 用 AST 定位 → 精準修改 → 自動處理連帶變更
function applyIntent(intent) {
  const ast = parseFile(intent.target.file);
  const node = findSymbol(ast, intent.target.symbol);

  if (intent.intent === 'make_async') {
    // 1. 加 async 關鍵字
    // 2. 改 return type
    // 3. 找所有呼叫處 → 加 await
    return applyAsyncTransform(node, intent.changes);
  }
}
```

**預期效益**：衝突率接近 0%，且自動處理連帶變更（呼叫處加 await）。

---

## Phase 8：hybrid_router 進階優化（2-3 天）

### 8.1 多信號路由

**問題**：目前只看關鍵字，不考慮專案大小、對話歷史、token budget。

**解法**：多維度路由決策

```javascript
function route(question, context) {
  const signals = {
    keyword: matchKeywords(question),           // 關鍵字匹配（現有）
    projectSize: context.fileCount,             // 專案大小
    isIndexed: context.hasIndex,                // 是否已索引
    recentTools: context.recentToolCalls,       // 最近用的工具
    budgetRemaining: context.tokenBudget,       // token 剩餘
    userPrefersSpeed: context.userPrefs.speed,  // 使用者偏好
  };

  // 專案 <100 檔 → 直接用 grep，不用建索引
  if (signals.projectSize < 100 && signals.keyword === 'search') {
    return { tool: 'smart_grep', reason: 'small_project' };
  }

  // 已索引 + 大專案 → 用 CKG
  if (signals.isIndexed && signals.projectSize > 500) {
    return { tool: 'smart_code_query', reason: 'indexed_large_project' };
  }

  // token 快沒了 → 用最省 token 的工具
  if (signals.budgetRemaining < 0.2) {
    return { tool: 'smart_grep', format: 'compact', reason: 'low_budget' };
  }

  // ...
}
```

**預期效益**：同樣的問題，不同情境給不同路由，整體效率提升 20-30%。

### 8.2 預測性路由

**問題**：每個問題獨立路由，不預測下一個問題。

**解法**：預測下一步需要的資訊，提前載入

```javascript
const PREDICTIVE_PRELOAD = {
  'find_definition': ['callers', 'callees'],     // 找到定義 → 下一步通常是誰呼叫
  'find_callers': ['callees'],                    // 找呼叫者 → 下一步可能是被呼叫者
  'architecture': ['dependencies', 'hotspots'],   // 看架構 → 下一步看依賴
};

async function routeWithPrediction(question, context) {
  const { tool, intent } = classifyQuestion(question);

  // 執行主要查詢
  const result = await executeTool(tool, question);

  // 背景預載下一步需要的資訊
  const preloadIntents = PREDICTIVE_PRELOAD[intent] || [];
  for (const preload of preloadIntents) {
    backgroundPreload(preload, context);  // 不 blocking
  }

  return result;
}
```

**預期效益**：連續問答快 3-5x（第二個問題的答案已經在 cache）。

---

## Phase 9：推理引擎進階優化（3-4 天）

### 9.1 自適應推理深度

**問題**：LLM 自己估 totalThoughts，常常低估或高估。

**解法**：快速複雜度評估 → 動態調整深度

```javascript
function adaptiveThink(question) {
  // Step 0：快速複雜度評估（用 structured mode，~50 tokens）
  const complexity = assessComplexity(question);
  // 回傳：{ level: 'simple'|'medium'|'complex', estimatedSteps: 3|5|7 }

  const config = {
    simple:  { totalThoughts: 3, mode: 'structured' },
    medium:  { totalThoughts: 5, mode: 'cit' },
    complex: { totalThoughts: 7, mode: 'beam' },
  }[complexity.level];

  // 推理過程中動態調整
  return smart_think({
    ...config,
    thought: question,
    nextThoughtNeeded: true,
    // 遇到新資訊 → needsMoreThoughts: true → 自動擴充
    // 答案已明確 → nextThoughtNeeded: false → 提前結束
  });
}
```

**預期效益**：簡單問題省 40% 推理 token，複雜問題更完整。

### 9.2 推理鏈記憶

**問題**：每個問題獨立推理，連續相關問題要從頭來。

**解法**：Session 內維護推理狀態鏈

```javascript
const reasoningChain = {
  domain: null,           // 當前推理領域（auth, db, api...）
  findings: [],           // 已確認的發現
  confidence: 0,          // 整體信心
  openQuestions: [],      // 尚未解決的問題
  evidenceMap: new Map(), // 發現 → 證據來源
};

function continueReasoning(question) {
  // 如果新問題與當前領域相關 → 從上次推理結果繼續
  if (isRelatedDomain(question, reasoningChain.domain)) {
    return smart_think({
      thought: question,
      context: reasoningChain.findings,  // 注入之前的發現
      totalThoughts: 2,  // 不需要從頭推理，2 步就夠
    });
  }

  // 新領域 → 重置推理鏈
  reasoningChain.reset();
  return smart_think({ thought: question, totalThoughts: 5 });
}
```

**預期效益**：連續推理省 50-70% token。

### 9.3 信心分數與不確定性標記

**問題**：LLM 給答案但沒有信心標示，使用者不知道該不該相信。

**解法**：每個結論附上信心分數

```javascript
// 推理完成後，自動評估信心
function assessConfidence(findings) {
  return findings.map(f => {
    if (f.evidence?.sourceCode) return { ...f, confidence: 0.95, icon: '✅' };
    if (f.evidence?.documentation) return { ...f, confidence: 0.85, icon: '✅' };
    if (f.evidence?.inference) return { ...f, confidence: 0.70, icon: '⚠️' };
    return { ...f, confidence: 0.50, icon: '❓', suggestion: '需要驗證' };
  });
}

// 輸出格式
// ✅ 高信心（>0.9）：login() 在 src/auth.ts:142 — 原始碼確認
// ⚠️ 中信心（0.7-0.9）：推測 token 過期原因 — 未直接驗證
// ❓ 低信心（<0.7）：不確定 refresh token TTL — 建議查看 config
```

**預期效益**：使用者知道哪些答案可靠，減少錯誤決策。

---

## 完整時間線（更新）

| Phase | 內容 | 時間 |
|-------|------|------|
| Phase 1 | smart-mcp.md 精簡化 | 2-3 天 |
| Phase 2 | Reference 文件建立 | 1 天 |
| Phase 3 | MCP Server Tier Manager | 2-3 天 |
| Phase 4 | system-prompt.mjs 更新 | 0.5 天 |
| Phase 5 | 驗證與交付（Phase 1-4） | 1 天 |
| **Phase 6** | **三層載入進階優化** | **3-4 天** |
| **Phase 7** | **fast_apply 進階優化** | **3-4 天** |
| **Phase 8** | **hybrid_router 進階優化** | **2-3 天** |
| **Phase 9** | **推理引擎進階優化** | **3-4 天** |
| Phase 10 | 進階優化驗收 | 1 天 |
| **總計（基礎）** | Phase 1-5 | **6.5-8.5 天** |
| **總計（含進階）** | Phase 1-10 | **18-24 天** |

---

## 進階優化預期效益總覽

| 優化 | 影響範圍 | 預期改善 |
|------|---------|---------|
| L1 精準載入 | 每次 L1 觸發 | 再省 30-40% token |
| Session-tier 記憶 | 連續問答 | 重複觸發成本 → 0 |
| 專案類型預載入 | 首次對話 | 第一個問題就快 |
| 編輯後自動測試 | 每次編輯 | 語法正確 → 行為正確 |
| 意圖導向編輯 | 每次編輯 | 衝突率 → 接近 0% |
| 多信號路由 | 每次路由 | 效率提升 20-30% |
| 預測性路由 | 連續問答 | 快 3-5x |
| 自適應推理深度 | 每次推理 | 簡單問題省 40% token |
| 推理鏈記憶 | 連續推理 | 省 50-70% token |
| 信心分數 | 每次推理 | 減少錯誤決策 |