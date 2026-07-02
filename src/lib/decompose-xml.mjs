// ── Qwen3.5 XML Tool Call 解析（decompose-xml）──
// 研究來源：Qwen3 CoE (arXiv 2505.19794)、Qwen3.5 XML Tool Call Spec

// ═══════════════════════════════════════════
// J1: XML Tool Call 解析
// ═══════════════════════════════════════════

/**
 * 從 thought 中解析 XML tool call
 * @param {string} thought
 * @returns {Array<{name: string, args: object, raw: string}>}
 */
export function parseXMLToolCalls(thought) {
  if (!thought || typeof thought !== 'string') return [];

  const calls = [];
  const regex = /<tool_call>\s*<name>\s*([^<]+?)\s*<\/name>\s*<arguments>\s*({[^}]*?})\s*<\/arguments>\s*<\/tool_call>/gi;
  let match;

  while ((match = regex.exec(thought)) !== null) {
    const name = match[1].trim();
    let args = {};
    try {
      args = JSON.parse(match[2]);
    } catch {
      // lenient JSON parsing attempt
      try {
        args = parseLenientJSON(match[2]);
      } catch {
        args = { _error: 'Failed to parse arguments', _raw: match[2] };
      }
    }
    calls.push({ name, args, raw: match[0] });
  }

  return calls;
}

/**
 * 從 thought 中提取 tool call 名稱列表
 * @param {string} thought
 * @returns {string[]}
 */
export function extractToolNames(thought) {
  const calls = parseXMLToolCalls(thought);
  return calls.map(c => c.name);
}

/**
 * 寬鬆 JSON 解析（處理未引號的 key 等）
 * @param {string} str
 * @returns {object}
 */
function parseLenientJSON(str) {
  // 補上 JSON key 的雙引號
  let cleaned = str
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ':"$1"')
    .trim();
  return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════
// J2: XML Tool Call 驗證
// ═══════════════════════════════════════════

const KNOWN_TOOLS = new Set([
  'smart_grep', 'smart_read', 'smart_fast_apply', 'smart_edit_chain',
  'smart_think', 'smart_deep_think', 'smart_lsp', 'smart_glob',
  'smart_exa_search', 'smart_exa_crawl', 'smart_github_search',
  'smart_security', 'smart_test', 'smart_rules', 'smart_context',
  'smart_learn', 'smart_run', 'smart_compact', 'smart_hallucination_check',
  'smart_codebase_index',
]);

/**
 * 驗證 XML tool call 是否合法
 * @param {object} call — { name, args }
 * @param {Set} [knownTools]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateToolCall(call, knownTools = KNOWN_TOOLS) {
  const errors = [];

  if (!call || !call.name) {
    return { valid: false, errors: ['missing tool name'] };
  }

  if (!knownTools.has(call.name) && !call.name.startsWith('smart_')) {
    errors.push(`unknown tool: ${call.name}`);
  }

  if (!call.args || typeof call.args !== 'object') {
    errors.push('missing or invalid arguments object');
  }

  if (call.args && call.args._error) {
    errors.push(`argument parse error: ${call.args._error}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 批量驗證 tool calls
 * @param {Array} calls
 * @returns {{ valid: Array, invalid: Array, errors: string[] }}
 */
export function validateToolCalls(calls) {
  if (!Array.isArray(calls)) return { valid: [], invalid: [], errors: ['not an array'] };

  const valid = [];
  const invalid = [];
  const allErrors = [];

  for (const call of calls) {
    const result = validateToolCall(call);
    if (result.valid) {
      valid.push(call);
    } else {
      invalid.push({ call, errors: result.errors });
      allErrors.push(...result.errors);
    }
  }

  return { valid, invalid, errors: [...new Set(allErrors)] };
}

// ═══════════════════════════════════════════
// J3: XML Tool Call 產生
// ═══════════════════════════════════════════

/**
 * 產生 XML tool call 字串
 * @param {string} name — tool name
 * @param {object} args — tool arguments
 * @returns {string}
 */
export function formatXMLToolCall(name, args) {
  const argsStr = JSON.stringify(args || {});
  return `<tool_call>\n  <name>${name}</name>\n  <arguments>${argsStr}</arguments>\n</tool_call>`;
}

/**
 * 從 subtask 產生建議的 XML tool call
 * @param {object} subtask — { id, desc, tool, toolArgs }
 * @returns {string|null}
 */
export function subtaskToXMLCall(subtask) {
  if (!subtask || !subtask.tool) return null;
  return formatXMLToolCall(subtask.tool, subtask.toolArgs || {});
}

// ═══════════════════════════════════════════
// J4: CoE 思考標籤解析
// ═══════════════════════════════════════════

/**
 * 解析 CoE 思考標籤（<thought> 與 <response>）
 * @param {string} text
 * @returns {object} { thought: string, response: string, mode: string }
 */
export function parseCoETags(text) {
  if (!text) return { thought: '', response: '', mode: 'text-cot' };

  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  const responseMatch = text.match(/<response>([\s\S]*?)<\/response>/i);

  const hasCoE = thoughtMatch || responseMatch;

  return {
    thought: thoughtMatch ? thoughtMatch[1].trim() : '',
    response: responseMatch ? responseMatch[1].trim() : '',
    mode: hasCoE ? 'coe' : 'text-cot',
  };
}

/**
 * 判斷 thought 是否包含 XML tool calls
 * @param {string} thought
 * @returns {boolean}
 */
export function hasXMLToolCalls(thought) {
  if (!thought) return false;
  return /<tool_call>[\s\S]*?<\/tool_call>/i.test(thought);
}
