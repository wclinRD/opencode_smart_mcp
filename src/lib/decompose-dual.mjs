// ── Dual Format: CoE + Text-CoT（decompose-dual）──
// 研究來源：Qwen3 CoE (arXiv 2505.19794)

// ═══════════════════════════════════════════
// K1: 模式選擇
// ═══════════════════════════════════════════

/**
 * 根據上下文選擇 CoE 或 Text-CoT 模式
 * @param {object} context
 * @param {string} [context.taskType] — 'debug'|'refactor'|'research'|'decision'|'general'
 * @param {number} [context.confidence] — 0-10
 * @param {number} [context.thoughtLength] — token 長度
 * @param {boolean} [context.needsToolCall] — 是否需要 tool call
 * @returns {object} { mode: string, label: string, reason: string }
 */
export function chooseDualMode(context) {
  const { taskType = 'general', confidence = 5, thoughtLength = 0, needsToolCall = false } = context || {};

  // CoE 適用條件：
  // 1) 需要 tool call（debug/research 常見）
  // 2) 高信心（>7）
  // 3) 簡單任務（<100 tokens）
  const coeConditions = [
    needsToolCall,
    confidence > 7,
    thoughtLength < 100 && taskType !== 'research',
    ['decision', 'general'].includes(taskType),
  ];

  const coeScore = coeConditions.filter(Boolean).length;

  if (coeScore >= 2) {
    return { mode: 'coe', label: 'CoE', reason: 'tool-needed or confident or simple' };
  }

  return { mode: 'text-cot', label: 'Text-CoT', reason: 'complex or low-confidence or research' };
}

// ═══════════════════════════════════════════
// K2: CoE 格式產生
// ═══════════════════════════════════════════

/**
 * 產生 CoE 格式輸出
 * @param {string} thought — 快速思考內容
 * @param {string} [response] — 回應內容（optional）
 * @returns {string}
 */
export function formatCoE(thought, response) {
  let result = `<thought>\n${thought}\n</thought>`;
  if (response) {
    result += `\n<response>\n${response}\n</response>`;
  }
  return result;
}

/**
 * 產生 Text-CoT 格式輸出
 * @param {string} text
 * @returns {string}
 */
export function formatTextCoT(text) {
  return text;
}

// ═══════════════════════════════════════════
// K3: 格式轉換
// ═══════════════════════════════════════════

/**
 * 將 CoE 轉換為 Text-CoT（去除標籤）
 * @param {string} coeText
 * @returns {string}
 */
export function coeToText(coeText) {
  if (!coeText) return '';
  return coeText
    .replace(/<\/?thought>/gi, '')
    .replace(/<\/?response>/gi, '')
    .trim();
}

/**
 * 將 Text-CoT 包裝為 CoE
 * @param {string} text
 * @returns {string}
 */
export function textToCoE(text) {
  if (!text) return '';
  return `<thought>\n${text}\n</thought>`;
}

// ═══════════════════════════════════════════
// K4: CoE 語境總結
// ═══════════════════════════════════════════

/**
 * 從 CoE text 中提取純文本摘要
 * @param {string} coeText
 * @param {number} [maxLen=200]
 * @returns {string}
 */
export function summarizeCoE(coeText, maxLen = 200) {
  const plain = coeToText(coeText);
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen) + '...';
}

export default {
  chooseDualMode,
  formatCoE,
  formatTextCoT,
  coeToText,
  textToCoE,
  summarizeCoE,
};
