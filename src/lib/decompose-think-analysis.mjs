// ── P2 核心分析引擎（decompose-think-analysis）──
// 供 smart_decompose_think 使用：thought 解析 + 工具配對 + 信心校準 + 模板引擎

// ═══════════════════════════════════════════
// A1: parseThought
// ═══════════════════════════════════════════

const UNSURE_PATTERNS = /maybe|not sure|i think|perhaps|possibly|不確定|可能|不太確定|guess|probably|似乎/gi;
const CONFIDENCE_PATTERNS = /definitely|certainly|absolutely|clearly| undoubtedly|無疑|肯定|一定|100%/gi;
const TOOL_CALL_MARKERS = /`?(?:smart_|ssr\()[\w_]+/gi;
const XML_TOOL_CALL_REGEX = /<tool_call>[\s\S]*?<\/tool_call>/gi;

/**
 * 解析 thought 內容，提取不確定性、信心、工具提及等信號
 * @param {string} thought
 * @returns {object} { hasUncertainty, hasHighConfidence, mentionedTools, xmlToolCalls, reasoningBudget }
 */
export function parseThought(thought) {
  if (!thought) {
    return {
      hasUncertainty: false,
      hasHighConfidence: false,
      mentionedTools: [],
      xmlToolCalls: [],
      reasoningBudget: 'normal',
    };
  }

  const hasUncertainty = UNSURE_PATTERNS.test(thought);
  // reset lastIndex because of global regex
  UNSURE_PATTERNS.lastIndex = 0;

  const hasHighConfidence = CONFIDENCE_PATTERNS.test(thought);
  CONFIDENCE_PATTERNS.lastIndex = 0;

  const toolMatches = [...thought.matchAll(TOOL_CALL_MARKERS)];
  TOOL_CALL_MARKERS.lastIndex = 0;
  const mentionedTools = [...new Set(toolMatches.map(m => m[0].replace(/^`/, '')))];

  const xmlMatches = [...thought.matchAll(XML_TOOL_CALL_REGEX)];
  XML_TOOL_CALL_REGEX.lastIndex = 0;
  const xmlToolCalls = xmlMatches.map(m => m[0]);

  // FR-CoT 推理長度檢測
  const reasoningBudget = detectReasoningBudget(thought);

  return { hasUncertainty, hasHighConfidence, mentionedTools, xmlToolCalls, reasoningBudget };
}

/**
 * FR-CoT 推理長度檢測：判斷 thought 的推理風格
 * brief: 8-32 tokens（簡短，tool calling 適用）
 * normal: 128-256 tokens（標準）
 * deep: 512+ tokens（深度推理）
 */
function detectReasoningBudget(thought) {
  if (!thought) return 'normal';
  const tokenCount = thought.split(/\s+/).length;

  // 偵測 FR-CoT 模板特徵
  const hasFRCoTSignature = /Function:\s*\w+|Key args:|Reason:\s/.test(thought);

  if (hasFRCoTSignature || tokenCount < 30) return 'brief';
  if (tokenCount > 300) return 'deep';
  return 'normal';
}

// ═══════════════════════════════════════════
// A2: suggestToolByTask
// ═══════════════════════════════════════════

const TASK_TOOL_MAP = {
  debug: [
    { patterns: [/find|locate|where|發生|位置|哪[裡裡]/i], tool: 'smart_grep', args: {} },
    { patterns: [/cause|root|為什麼|原因|root cause/i], tool: 'smart_lsp', args: { operation: 'diagnostics' } },
    { patterns: [/fix|edit|repair|改|修|solve|correct/i], tool: 'smart_fast_apply', args: {} },
    { patterns: [/test|verify|check|測|驗證/i], tool: 'smart_test', args: {} },
  ],
  refactor: [
    { patterns: [/depend|import|引用|dependency/i], tool: 'smart_run', args: { tool: 'import_graph' } },
    { patterns: [/impact|影響|改了|side effect/i], tool: 'smart_run', args: { tool: 'code_impact' } },
    { patterns: [/rename|改名|移動|move/i], tool: 'smart_run', args: { tool: 'rename_safety' } },
  ],
  search: [
    { patterns: [/research|search|查|找資料|find info/i], tool: 'smart_exa_search', args: {} },
    { patterns: [/read|文件|doc|document/i], tool: 'smart_exa_crawl', args: {} },
  ],
};

/**
 * 依 subtask 描述與模板配對建議工具
 * @param {string} desc — subtask 描述
 * @param {string} template — debug | refactor | search | generic
 * @returns {object|null} { tool, args, reason, confidence }
 */
export function suggestToolByTask(desc, template) {
  if (!desc) return null;

  const mappings = TASK_TOOL_MAP[template] || TASK_TOOL_MAP.debug;
  for (const entry of mappings) {
    for (const pattern of entry.patterns) {
      if (pattern.test(desc)) {
        return {
          tool: entry.tool,
          args: entry.args,
          reason: `步驟描述「${desc}」配對到 ${entry.tool}`,
          confidence: 0.7,
        };
      }
    }
  }

  // fallback: generic 模式比對
  if (/grep|search|find|look/i.test(desc)) {
    return { tool: 'smart_grep', args: {}, reason: `通用搜尋配對`, confidence: 0.5 };
  }
  if (/read|open|show|check|view/i.test(desc)) {
    return { tool: 'smart_read', args: {}, reason: `通用讀取配對`, confidence: 0.5 };
  }

  return null;
}

// ═══════════════════════════════════════════
// A3: checkConfidence
// ═══════════════════════════════════════════

/**
 * 信心校準：檢測 overconfidence（高信心但無工具驗證）
 * @param {object} parsed — parseThought 結果
 * @param {Array} toolCalls — tool call 歷史
 * @param {string} strictness — high | medium | low
 * @returns {object|null} intervention
 */
export function checkConfidence(parsed, toolCalls, strictness) {
  if (!parsed || strictness === 'low') return null;

  const calls = Array.isArray(toolCalls) ? toolCalls : [];

  // overconfidence: 高信心 + 無工具驗證
  if (parsed.hasHighConfidence && calls.length === 0 && strictness !== 'low') {
    return {
      type: 'overconfidence',
      message: '你似乎很有把握，但還沒有用工具驗證',
      suggestion: '建議先用 smart_grep 或 smart_lsp 確認推論是否正確',
    };
  }

  return null;
}

// ═══════════════════════════════════════════
// A4: checkSkippedTool
// ═══════════════════════════════════════════

/**
 * 跳過工具檢測：前輪有建議 tool 但未被執行
 * @param {Array} toolCalls — 本輪 toolCalls
 * @param {object|null} prevSuggestion — 前輪的 toolSuggestion
 * @returns {object|null} intervention
 */
export function checkSkippedTool(toolCalls, prevSuggestion) {
  if (!prevSuggestion || !prevSuggestion.suggestedTool) return null;

  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const executed = calls.some(c => c.status === 'done' && c.tool === prevSuggestion.suggestedTool);

  if (!executed) {
    return {
      type: 'skipped_tool',
      message: `前輪建議使用 ${prevSuggestion.suggestedTool} 但尚未執行`,
      suggestion: `是否忘記呼叫？試試 ssr({tool:"${prevSuggestion.suggestedTool}", args:{...}})`,
    };
  }

  return null;
}

// ═══════════════════════════════════════════
// A5: getTemplatePrompt
// ═══════════════════════════════════════════

const TEMPLATE_PROMPTS = {
  debug: `┌─ 除錯任務 ─────────────────────
│ 流程建議：
│   1. smart_lsp diagnostics → 看錯誤
│   2. smart_grep → 找相關程式碼
│   3. 分析 root cause
│   4. smart_fast_apply → 修復
│   5. smart_test → 驗證
└────────────────────────────────`,

  refactor: `┌─ 重構任務 ─────────────────────
│ 流程建議：
│   1. import_graph → 看依賴
│   2. code_impact → 分析影響
│   3. 逐步修改
│   4. smart_test → 驗證
└────────────────────────────────`,

  search: `┌─ 搜尋任務 ─────────────────────
│ 流程建議：
│   1. smart_exa_search → 找資料
│   2. 摘要重點
│   3. 交叉驗證（多來源）
│   4. 產出結論
└────────────────────────────────`,

  generic: `┌─ 任務分解 ─────────────────────
│ 執行建議：
│   依照 subtasks 順序逐步完成
│   每個步驟完成後更新 status
│   遇困難可先用 smart_exa_search 或 smart_grep 取得資訊
└────────────────────────────────`,

  'fr-cot': `┌─ FR-CoT 工具推理 ────────────────
│ 使用結構化格式：
│   Function: [工具名稱]
│   Key args: [關鍵參數]
│   Reason: [一句話解釋]
│
│ 注意：推理保持在 8-32 tokens 內
└────────────────────────────────`,
};

/**
 * 取得任務模板 prompt
 * @param {string} template — debug | refactor | search | generic | fr-cot
 * @returns {string} 格式化模板文字
 */
export function getTemplatePrompt(template) {
  return TEMPLATE_PROMPTS[template] || TEMPLATE_PROMPTS.generic;
}

/**
 * 取得模板顯示名稱
 * @param {string} template
 * @returns {string}
 */
export function getTemplateLabel(template) {
  const labels = {
    debug: 'debug',
    refactor: 'refactor',
    search: 'search',
    generic: 'generic',
    'fr-cot': 'fr-cot',
  };
  return labels[template] || 'generic';
}

// ═══════════════════════════════════════════
// A6: 邊界情況處理
// ═══════════════════════════════════════════

/**
 * 初始化 P2 參數，處理 undefined/null/邊界情況
 * @param {object} args — 原始參數
 * @returns {object} 安全的參數物件
 */
export function sanitizeP2Args(args) {
  if (!args || typeof args !== 'object') args = {};

  const toolCalls = normalizeToolCalls(args.toolCalls);
  const roundType = normalizeRoundType(args.roundType, toolCalls);
  const template = args.template || 'generic';
  const isFirstCall = toolCalls.length === 0;

  return {
    ...args,
    toolCalls,
    roundType,
    template,
    currentSubtaskId: Number(args.currentSubtaskId) || 1,
    strictness: args.strictness || 'high',
    thinkingStyle: args.thinkingStyle || 'disciplined',
    _isFirstCall: isFirstCall,
  };
}

/**
 * 標準化 toolCalls 欄位
 */
function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.filter(c => c && typeof c === 'object');
}

/**
 * 標準化 roundType 欄位，含自動校正
 */
function normalizeRoundType(roundType, toolCalls) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];

  if (calls.length === 0) return 'think';

  const hasNewDone = calls.some(c => c.status === 'done');

  if (roundType === 'think' && hasNewDone) {
    return 'tool_result';
  }
  if (roundType === 'tool_result' && !hasNewDone) {
    return 'think';
  }

  return roundType || 'think';
}
