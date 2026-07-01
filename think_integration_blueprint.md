# think_integration_blueprint.md — P1 整合藍圖

> **目標**：將 RAT / Auto-Mode / Self-Verify 三項強化整合進 smart-mcp 專案
> **專案路徑**：`~/opencode/dev/smart/`
> **當前版本**：smart-agent v0.1.0 (peer: smart-mcp ^3.2.0)

---

## 🔍 現有架構分析

### 1. Plugin 系統（核心機制）

```
src/plugins/core/          ← 核心工具（直接暴露給 MCP）
├── quick-think.mjs        ← smart_think 的 plugin 定義
└── thinking.mjs           ← smart_deep_think 的 plugin 定義

src/plugins/standard/      ← 標準工具（透過 router 呼叫）
├── ... (code-impact, hybrid-router 等)

src/cli/thinking.mjs       ← 核心邏輯（smart_think + smart_deep_think 共用）
src/lib/                   ← 共用工具函式
src/server/loader.mjs      ← Plugin 載入器（掃描 src/plugins/*/ 自動載入）
```

### 2. Plugin 註冊合約

每個 `.mjs` 檔案 export 一個 default object：

```javascript
export default {
  name: 'smart_think',             // 工具名稱
  description: '...',              // MCP tool description
  inputSchema: {                   // JSON Schema（MCP tool input schema）
    type: 'object',
    properties: { ... },
    required: ['thought', 'nextThoughtNeeded'],
  },
  responsePolicy: { maxLevel: 0 }, // 回應優化政策
  cli: null,                       // CLI 路徑（可選）
  handler(args) {                  // 直接 handler（回傳 string）
    return result.output;
  },
};
```

### 3. smart_think 目前實作流程

```
LLM 呼叫 smart_think({mode:"cit", thought:"...", nextThoughtNeeded:true})
  │
  ├─ quick-think.mjs (plugin)
  │   ├─ 驗證 inputSchema
  │   ├─ 呼叫 quickThought(args) → { output, done, totalThoughts? }
  │   └─ 附加 budget hint（若 budget < 60%）
  │
  └─ 回傳 result.output → LLM
```

### 4. 關鍵發現

| 發現 | 說明 |
|------|------|
| **Handler 是同步的** | 無 async/await，無法直接呼叫別的 MCP tool |
| **核心邏輯在 `src/cli/thinking.mjs`** | `quickThought()` 函式約 550 行 |
| **Plugin 定義在 `src/plugins/core/quick-think.mjs`** | 約 216 行 |
| **已有 `src/lib/` 工具函式庫** | 可直接使用（utils.mjs, context-budget.mjs 等） |
| **測試在 `tests/thinking.test.mjs`** | 808 行，用 `node --test` 執行 |
| **無資料庫/外部依賴** | 純函式，容易測試 |

---

## 🏗 整合策略

### 核心原則

1. **Plugin handler 保持輕量**：只做參數驗證 + 呼叫 lib 函式，不塞複雜邏輯
2. **新功能放入 `src/lib/`**：新增 `think-rat.mjs`、`think-auto-mode.mjs`、`think-verify.mjs`
3. **修改 `src/cli/thinking.mjs`**：擴充 `quickThought()` 參數
4. **修改 `src/plugins/core/quick-think.mjs`**：擴充 `inputSchema` + `handler`
5. **新增測試檔案**：`tests/think-rat.test.mjs`、`tests/think-auto-mode.test.mjs`、`tests/think-verify.test.mjs`

---

## 📂 檔案變更清單

### 新檔案（3 個 lib + 3 個測試 + 1 個類型定義）

```
src/lib/
├── think-rat.mjs          ← RAT mode 邏輯（實體萃取 + 檢索 + 壓縮）
├── think-auto-mode.mjs     ← Auto-Mode 分類器
└── think-verify.mjs        ← Self-Verify 驗證器

tests/
├── think-rat.test.mjs
├── think-auto-mode.test.mjs
└── think-verify.test.mjs
```

### 修改檔案（2 個核心檔案）

```
src/cli/thinking.mjs             ← 擴充 quickThought() 接收新參數 + 輸出格式
src/plugins/core/quick-think.mjs ← 擴充 inputSchema + handler 邏輯
```

---

## 📝 逐一實作細節

### 🔧 新檔案：`src/lib/think-rat.mjs`

```javascript
// Retrieval-Augmented Thinking (RAT) for smart_think
//
// Extracts technical entities from thought text, searches for relevant
// context using available tools, and returns compressed results.

/**
 * Extract technical entities from thought text.
 * @param {string} thought - LLM's reasoning text
 * @returns {string[]} - Extracted keywords
 */
export function extractEntities(thought) {
  const patterns = [
    /[A-Z][a-z]+[A-Z][a-z]+/g,     // CamelCase (React hooks, APIs)
    /v?\d+\.\d+(?:\.\d+)?/g,       // Version numbers
    /[a-z]+-[a-z]+/g,               // kebab-case identifiers
    /\b\w+Error\b/g,                // Error names
    /\b(?:use|get|set|is|has)[A-Z]\w+/g,  // Common prefixes
  ];

  const entities = new Set();
  for (const pattern of patterns) {
    const matches = thought.match(pattern) || [];
    for (const m of matches) {
      if (m.length > 2 && m.length < 50) entities.add(m);
    }
  }

  // Also extract quoted terms
  const quoted = thought.match(/["'`]([\w\s-]+)["'`]/g) || [];
  for (const q of quoted) {
    const clean = q.replace(/["'`]/g, '').trim();
    if (clean.length > 2 && clean.length < 60) entities.add(clean);
  }

  return Array.from(entities).slice(0, 5); // Max 5 keywords
}

/**
 * Select which search tools to use based on context.
 * @param {object} context - Available context info
 * @returns {string[]} - Tool names to use
 */
export function selectSearchTools(context) {
  const tools = [];
  if (context.hasProjectRoot) tools.push('smart_grep');
  if (context.isTechnical) tools.push('smart_exa_search');
  if (context.hasFileRef) tools.push('smart_lsp');
  return tools.slice(0, 3); // Max 3 tools
}

/**
 * Compress search results for context injection.
 * @param {Array} results - Raw search results
 * @param {number} maxTokens - Token budget
 * @returns {Array} - Compressed results
 */
export function compressResults(results, maxTokens = 500) {
  // Use caveman + semantic compression pattern
  return results
    .map(r => ({
      source: r.source,
      summary: r.summary || r.match?.substring(0, 200) || '',
      relevance: r.relevance || 0.5,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .reduce((acc, r) => {
      const cost = r.summary.length / 4; // Approx token count
      if (acc.total + cost <= maxTokens) {
        acc.items.push(r);
        acc.total += cost;
      }
      return acc;
    }, { items: [], total: 0 })
    .items;
}

/**
 * Check if thought appears to be technical (vs casual/general).
 * @param {string} thought
 * @returns {boolean}
 */
export function isTechnicalThought(thought) {
  const techPatterns = [
    /\b(code|function|api|bug|error|refactor|test|deploy)\b/i,
    /\b(redux|react|vue|node|python|docker|git|npm)\b/i,
    /\b(useEffect|useState|middleware|endpoint|schema)\b/i,
    /[{}()\[\];]/,
    /\b(v?\d+\.\d+)\b/,
  ];
  return techPatterns.some(p => p.test(thought));
}
```

### 🔧 新檔案：`src/lib/think-auto-mode.mjs`

```javascript
// Auto-Mode classifier for smart_think
//
// Automatically selects the best reasoning mode based on
// question characteristics and context budget.
// Pure rule-based — zero LLM calls, zero latency.

/**
 * Classify which reasoning mode to use.
 * @param {object} opts
 * @param {string} opts.thought - The thought/question text
 * @param {number} opts.budgetFraction - Current context budget (0.0-1.0)
 * @param {boolean} opts.hasUncertainty - Whether LLM expressed uncertainty
 * @returns {{ mode: string, reason: string }}
 */
export function classifyMode({ thought = '', budgetFraction = 1.0, hasUncertainty = false }) {

  // 1. Budget check first (low budget = structured mode)
  if (budgetFraction < 0.30) {
    return {
      mode: 'structured',
      reason: `Context budget low (${Math.round(budgetFraction * 100)}%) — use structured mode to save 50-70% token`,
    };
  }

  const lower = thought.toLowerCase();

  // 2. Comparison / evaluation questions
  const comparisonWords = ['比較', 'compare', 'vs', 'versus', '評估', 'evaluate',
    '哪個', 'which', '選擇', 'choose', 'trade-off', 'tradeoff'];
  if (comparisonWords.some(w => lower.includes(w))) {
    return {
      mode: 'beam',
      reason: 'Comparison/evaluation detected — beam search explores multiple paths',
    };
  }

  // 3. Cross-domain / multi-angle
  const multiWords = ['跨領域', '多角度', 'multi.*angle', 'synthesize', '綜合',
    'cross.*domain', 'comprehensive'];
  if (multiWords.some(w => new RegExp(w, 'i').test(lower))) {
    return {
      mode: 'forest',
      reason: 'Multi-angle analysis — forest of trees provides consensus',
    };
  }

  // 4. Causal / root cause questions
  const causalWords = ['為什麼', 'why', '原因', 'cause', 'root cause',
    '根本', 'reason'];
  if (causalWords.some(w => lower.includes(w))) {
    return {
      mode: 'cit',
      branchingNeeded: false,
      reason: 'Causal analysis — chain reasoning with BN-DP auto-branch',
    };
  }

  // 5. Technical debug / uncertainty
  if (hasUncertainty || /(不確定|unsure|maybe|懷疑|suspect|bug|error)/i.test(lower)) {
    return {
      mode: 'cit',
      branchingNeeded: true,
      reason: 'Uncertainty detected — BN-DP will auto-branch if needed',
    };
  }

  // 6. Default: chain mode (saves ~70% tokens)
  return {
    mode: 'cit',
    branchingNeeded: false,
    reason: 'Routine analysis — chain mode saves ~70% tokens',
  };
}
```

### 🔧 新檔案：`src/lib/think-verify.mjs`

```javascript
// Self-Verify for smart_think
//
// Extracts factual claims from thought text and checks them
// against available context. Light mode = context-only.
// Full mode = + web search.

/**
 * Extract factual claims from thought text.
 * @param {string} thought
 * @returns {Array<{text: string, type: string}>}
 */
export function extractClaims(thought) {
  const claims = [];
  const patterns = [
    // Definition assertions: "X is/are Y"
    { regex: /([A-Z]\w+(?:\s+\w+){0,3})\s+(?:是|is|are|was|were)\s+(.+?)(?:[.。]|$)/g, type: 'definition' },
    // Version assertions: "X in vN"
    { regex: /([A-Z]\w+)\s+(?:在|in|since|from)\s+(v?\d+\.\d+(?:\.\d+)?)/gi, type: 'version' },
    // Causal assertions: "because X, Y"
    { regex: /(?:因為|because|since)\s+(.+?)(?:[,，]|所以|therefore|so|$)/gi, type: 'causal' },
    // Quantitative: "X% improvement"
    { regex: /(\d+%)\s+(?:提升|下降|improvement|reduction|increase|decrease)/gi, type: 'quantitative' },
    // Deprecation/change
    { regex: /(deprecated|removed|changed)\s+(?:in|from)\s+(v?\d+\.\d+)/gi, type: 'deprecation' },
  ];

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(thought)) !== null) {
      claims.push({ text: match[0].trim(), type });
    }
  }

  return claims;
}

/**
 * Verify a claim against available context.
 * @param {{text: string, type: string}} claim
 * @param {object} context - Available context for verification
 * @returns {{text: string, status: string, confidence: number}}
 */
export function verifyClaim(claim, context = {}) {
  // Check against context memory
  if (context.memory && context.memory.length > 0) {
    const matches = context.memory.filter(m =>
      m.toLowerCase().includes(claim.text.toLowerCase().slice(0, 20))
    );
    if (matches.length > 0) {
      return { ...claim, status: 'supported', confidence: 0.85 };
    }
  }

  // Check against tool outputs in context
  if (context.toolOutputs) {
    for (const output of context.toolOutputs) {
      if (output.toLowerCase().includes(claim.text.toLowerCase().slice(0, 20))) {
        return { ...claim, status: 'supported', confidence: 0.75 };
      }
    }
  }

  // No evidence found
  return { ...claim, status: 'unsupported', confidence: 0.3 };
}

/**
 * Calculate overall confidence from multiple claims.
 * @param {Array} claims - Verified claims
 * @returns {{overallConfidence: number, needsFactCheck: boolean}}
 */
export function calculateOverallConfidence(claims) {
  if (claims.length === 0) return { overallConfidence: 1.0, needsFactCheck: false };

  const avg = claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length;
  const needsFactCheck = claims.some(c => c.confidence < 0.5);

  return {
    overallConfidence: Math.round(avg * 100) / 100,
    needsFactCheck,
  };
}
```

### ✏️ 修改：`src/cli/thinking.mjs`

**變更點**：

1. 在檔案頂部 import 新的 lib 模組
2. 擴充 `quickThought()` 的參數 + 輸出格式：
   - 新增 `autoContext`, `contextHints`, `maxContextTokens` 參數
   - 在回傳物件中加入 `contextResults` 和 `verification` 欄位
3. 新增 mode handler 分支：`mode === 'rat'`
4. 保留所有現有行為（向後相容）

```javascript
// 在頂部加入 import
import { extractEntities, isTechnicalThought, compressResults } from '../lib/think-rat.mjs';
import { classifyMode } from '../lib/think-auto-mode.mjs';
import { extractClaims, verifyClaim, calculateOverallConfidence } from '../lib/think-verify.mjs';

// 修改 quickThought function signature
export function quickThought(args) {
  const {
    // ... 現有參數 ...
    // 新增參數：
    autoContext = false,
    contextHints = null,
    maxContextTokens = 500,
    verify = true,
    verifyDepth = 'light',
  } = args;

  // ... 現有邏輯 ...

  // === AUTO MODE (new) ===
  if (mode === 'auto') {
    const classification = classifyMode({
      thought,
      budgetFraction: getBudgetFraction(),
      hasUncertainty: thought.includes('不確定') || thought.includes('unsure'),
    });
    // Override mode with classification result
    mode = classification.mode;
    if (classification.branchingNeeded !== undefined) {
      branchingNeeded = classification.branchingNeeded;
    }
    // Store selected mode for output
    autoSelectedMode = classification.mode;
  }

  // === RAT MODE (new) ===
  let contextResults = [];
  if (mode === 'rat') {
    const keywords = autoContext ? extractEntities(thought) : (contextHints || []);
    if (keywords.length > 0) {
      // Non-blocking: we just format the search intent
      // Actual search happens at the server/plugin level
      contextResults = keywords.map(k => ({
        source: 'rat',
        keyword: k,
        summary: `[RAT] Searching for: ${k}`,
        relevance: 1.0,
      }));
    }
  }

  // === VERIFY (new) ===
  let verificationResult = null;
  if (verify) {
    const claims = extractClaims(thought);
    if (claims.length > 0) {
      const verified = claims.map(c => verifyClaim(c, { memory: [], toolOutputs: [] }));
      const stats = calculateOverallConfidence(verified);
      verificationResult = {
        claims: verified,
        overallConfidence: stats.overallConfidence,
        needsFactCheck: stats.needsFactCheck,
      };
    }
  }

  // === 輸出格式強化 ===
  // 在原本的 output 基礎上，附加 contextResults 和 verification 區塊
  if (contextResults.length > 0) {
    lines.push('');
    lines.push(`┌─ RAT Context (${contextResults.length} results) ───────────`);
    for (const r of contextResults) {
      lines.push(`│ 🔍 ${r.keyword} — ${r.summary}`);
    }
    lines.push(`└───────────────────────────────────────────────────`);
  }

  if (verificationResult) {
    lines.push('');
    lines.push(`┌─ Self-Verify ──────────────────────────────────`);
    for (const c of verificationResult.claims) {
      const icon = c.status === 'supported' ? '✓' : '⚠';
      lines.push(`│ ${icon} ${c.text} (conf: ${c.confidence})`);
    }
    lines.push(`│ Overall: ${verificationResult.overallConfidence}`);
    if (verificationResult.needsFactCheck) {
      lines.push(`│ ⚠ Some claims need fact-checking`);
    }
    lines.push(`└──────────────────────────────────────────────────`);
  }

  // ... 回傳 output ...
  return {
    output: lines.join('\n'),
    done: isDone,
    totalThoughts: adjustTotalThoughts ? effectiveTotal : undefined,
    // 新欄位（可選，向後相容）
    contextResults: contextResults.length > 0 ? contextResults : undefined,
    verification: verificationResult || undefined,
    autoSelectedMode: autoSelectedMode || undefined,
  };
}
```

### ✏️ 修改：`src/plugins/core/quick-think.mjs`

**變更點**：

1. `inputSchema` 加入新參數
2. `handler` 處理新參數 + 呼叫 RAT/Verify lib

```javascript
// inputSchema 加入：
properties: {
  // ... 現有參數 ...

  // RAT mode
  autoContext: {
    type: 'boolean',
    description: 'RAT mode: auto-extract entities from thought and search for context',
  },
  contextHints: {
    type: 'array',
    items: { type: 'string' },
    description: 'RAT mode: manual search keywords (overrides autoContext)',
  },
  maxContextTokens: {
    type: 'number',
    description: 'RAT mode: max tokens for search results (default: 500)',
  },

  // Auto mode
  // mode 的 enum 加入 'auto' 和 'rat'

  // Verify
  verify: {
    type: 'boolean',
    description: 'Enable self-verification of factual claims (default: true)',
  },
  verifyDepth: {
    type: 'string',
    enum: ['light', 'full'],
    description: 'Verification depth: light=context-only, full=+web search',
  },
}
```

---

## 🔄 完整呼叫流程（整合後）

```
LLM: smart_think({mode:"auto", thought:"分析這個重構", verify:true})
  │
  ├─ quick-think.mjs (handler)
  │   │
  │   ├─ 1. Auto-Mode: classifyMode({thought, budget}) → "beam"
  │   │   └─ 自動設定 mode="beam"
  │   │
  │   ├─ 2. quickThought({thought, mode:"beam", ...})
  │   │   ├─ 格式化 beam search 輸出
  │   │   └─ 回傳 { output, done, contextResults?, verification? }
  │   │
  │   ├─ 3. Verify: extractClaims → verifyClaim → calculateOverallConfidence
  │   │   └─ 附加 verification 區塊
  │   │
  │   └─ 回傳 final output（含 Auto-Mode 標示 + Verify 結果）
  │
  MCP Response: {
    "thought": "...",
    "nextThoughtNeeded": true,
    "autoSelectedMode": "beam",
    "verification": {
      "claims": [...],
      "overallConfidence": 0.85,
      "needsFactCheck": false
    }
  }
```

---

## 🧪 測試策略

| 測試檔案 | 測試內容 | 預計案例數 |
|---------|---------|-----------|
| `tests/think-rat.test.mjs` | `extractEntities()`, `selectSearchTools()`, `compressResults()`, `isTechnicalThought()` | 8 |
| `tests/think-auto-mode.test.mjs` | `classifyMode()` 各分支（low budget / comparison / causal / uncertain / default） | 7 |
| `tests/think-verify.test.mjs` | `extractClaims()` 5 種 pattern, `verifyClaim()`, `calculateOverallConfidence()` | 10 |
| `tests/thinking.test.mjs` (擴充) | 現有 808 行 + 新 mode 整合測試 | +6 |

執行方式：`node --test tests/think-*.test.mjs`

---

## 📊 變更摘要

| 操作 | 檔案 | 行數估計 |
|------|------|---------|
| **新創** | `src/lib/think-rat.mjs` | ~140 行 |
| **新創** | `src/lib/think-auto-mode.mjs` | ~90 行 |
| **新創** | `src/lib/think-verify.mjs` | ~120 行 |
| **修改** | `src/cli/thinking.mjs` | ~+50 行（新增 import + 分支邏輯） |
| **修改** | `src/plugins/core/quick-think.mjs` | ~+40 行（擴充 schema + handler） |
| **新創** | `tests/think-rat.test.mjs` | ~120 行 |
| **新創** | `tests/think-auto-mode.test.mjs` | ~100 行 |
| **新創** | `tests/think-verify.test.mjs` | ~150 行 |
| **合計** | **9 個檔案異動** | **約 +810 行** |

---

## ⚠️ 注意事項

1. **向後相容性是第一要求**：所有新欄位都是 optional，舊呼叫 `smart_think({mode:"cit", thought:"...", nextThoughtNeeded:true})` 行為完全不受影響
2. **RAT mode 的搜尋是非同步的**：目前的 handler 是同步的，真正的工具搜尋需要在 server 層或透過 callback 機制處理。第一版可以只輸出「搜尋意圖」而不實際搜尋
3. **Auto-Mode 是純規則引擎**：不呼叫 LLM，不增加 latency
4. **Self-Verify 的 light mode 是純 regex**：不增加 API 成本
5. **測試覆蓋**：每個新函式至少 3 個測試案例（正常、邊界、錯誤）

---

## 🔗 相關檔案

- [think_plan.md](./think_plan.md) — P1 設計文件
- [think_todo.md](./think_todo.md) — TODO 追蹤
- `src/plugins/core/quick-think.mjs` — smart_think plugin（修改目標）
- `src/cli/thinking.mjs` — 核心邏輯（修改目標）
- `src/server/loader.mjs` — Plugin 載入機制
- `tests/thinking.test.mjs` — 現有測試
