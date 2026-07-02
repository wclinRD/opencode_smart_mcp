// ── FR-CoT: Few-shot Reasoning Chain of Thought（decompose-frcot）──
// 研究來源：FR-CoT (arXiv 2505.18574)、MiniChain-of-Thought (Wei et al. 2024)

// ═══════════════════════════════════════════
// N1: FR-CoT 推理長度判定
// ═══════════════════════════════════════════

/**
 * 判定 FR-CoT 模式（brief/normal/deep）
 * @param {number} tokenCount
 * @returns {string} 'brief' | 'normal' | 'deep'
 */
export function frcotClassify(tokenCount) {
  if (tokenCount < 30) return 'brief';
  if (tokenCount >= 300) return 'deep';
  return 'normal';
}

/**
 * FR-CoT 推理層級建議
 * @param {object} context
 * @param {number} [context.tokenCount] — 已使用 tokens
 * @param {number} [context.confidence] — 信心分數
 * @param {number} [context.roundCount] — 回合數
 * @param {number} [context.complexity] — 任務複雜度 1-5
 * @returns {string} 'brief' | 'normal' | 'deep'
 */
export function frcotRecommend(context) {
  const { tokenCount = 0, confidence = 5, roundCount = 0, complexity = 1 } = context || {};

  // 低 token 壓力 + 高信心 + 簡單 → brief
  if (tokenCount < 50 && confidence > 7 && complexity <= 2) return 'brief';

  // 高 token 壓力 + 低信心 + 複雜 → deep
  if (tokenCount > 200 || confidence < 4 || complexity >= 4) return 'deep';

  // 多回合 + 仍無結果 → deep
  if (roundCount >= 3 && confidence < 5) return 'deep';

  return 'normal';
}

// ═══════════════════════════════════════════
// N2: FR-CoT 模板
// ═══════════════════════════════════════════

const FR_COT_TEMPLATES = {
  brief: {
    label: '⚡ Brief',
    format: '{ task } → { observation } → { action }',
    maxTokens: 150,
    examples: [
      { task: 'find null pointer', observation: 'auth.ts line 42', action: 'add null check' },
      { task: 'fix login bug', observation: 'missing await', action: 'add await' },
    ],
  },
  normal: {
    label: '📋 Normal',
    format: '{ task } → { evidence } → { reasoning } → { action }',
    maxTokens: 300,
    examples: [
      { task: 'fix auth timeout', evidence: 'fetch call no timeout', reasoning: 'increase timeout to 10s', action: 'edit fetch config' },
    ],
  },
  deep: {
    label: '🔬 Deep',
    format: '{ task } → { evidence } → { alternatives } → { tradeoff } → { action }',
    maxTokens: 600,
    examples: [
      { task: 'refactor DB layer', evidence: 'current ORM slow', alternatives: ['raw SQL', 'new ORM', 'query opt'], tradeoff: 'raw SQL fastest but less safe', action: 'rewrite hot queries' },
    ],
  },
};

/**
 * 取得 FR-CoT 模板
 * @param {string} mode — 'brief' | 'normal' | 'deep'
 * @returns {object}
 */
export function frcotGetTemplate(mode) {
  return FR_COT_TEMPLATES[mode] || FR_COT_TEMPLATES.normal;
}

// ═══════════════════════════════════════════
// N3: FR-CoT 格式輸出
// ═══════════════════════════════════════════

/**
 * 產生 FR-CoT 格式字串
 * @param {string} task — 任務描述
 * @param {string} observation — 觀察
 * @param {string} [action] — 行動（可選）
 * @param {object} [options]
 * @param {string} [options.mode='normal']
 * @returns {string}
 */
export function frcotFormat(task, observation, action, options = {}) {
  const { mode = 'normal' } = options;
  const parts = [];

  if (task) parts.push(`Task: ${task}`);
  if (observation) parts.push(`Obs: ${observation}`);
  if (action) parts.push(`Act: ${action}`);

  if (parts.length === 0) return '';

  const template = FR_COT_TEMPLATES[mode] || FR_COT_TEMPLATES.normal;
  return `[${template.label}] ${parts.join(' | ')}`;
}

/**
 * 將 thought 壓縮為 FR-CoT 簡短格式
 * @param {string} thought
 * @returns {string}
 */
export function frcotCompress(thought) {
  if (!thought || thought.length < 30) return thought || '';

  const lines = thought.split('\n').filter(l => l.trim());
  if (lines.length <= 2) return thought;

  // 取第一行 + 最後一行 = 簡短摘要
  const first = lines[0].trim();
  const last = lines[lines.length - 1].trim();
  return `${first.slice(0, 80)}...${last.slice(0, 80)}`;
}

// ═══════════════════════════════════════════
// N4: FR-CoT 路徑建議
// ═══════════════════════════════════════════

/**
 * 產生 FR-CoT 推理提示（根據 task 類型）
 * @param {string} taskType — 'debug'|'refactor'|'feature'|'research'|'decision'
 * @param {string} mode — 'brief'|'normal'|'deep'
 * @returns {string}
 */
export function frcotPrompt(taskType, mode = 'normal') {
  const prompts = {
    debug: `【Debug 推理路徑】\n1. 預期行為是什麼？\n2. 實際行為是什麼？\n3. 差異的根因？\n4. 修復方案？`,
    refactor: `【Refactor 推理路徑】\n1. 當前設計問題？\n2. 目標設計？\n3. 遷移步驟？\n4. 驗證方案？`,
    feature: `【Feature 推理路徑】\n1. 功能目標？\n2. 實作方案？\n3. 依賴與風險？\n4. 測試策略？`,
    research: `【Research 推理路徑】\n1. 研究方向？\n2. 已知資訊？\n3. 待探索方向？\n4. 結論？`,
    decision: `【Decision 推理路徑】\n1. 選項有哪些？\n2. 各選項優缺？\n3. 權衡分析？\n4. 最終決定？`,
  };

  const base = prompts[taskType] || prompts.debug;
  const template = FR_COT_TEMPLATES[mode] || FR_COT_TEMPLATES.normal;
  return `${template.label} 模式\n\n${base}`;
}

export default {
  frcotClassify,
  frcotRecommend,
  frcotGetTemplate,
  frcotFormat,
  frcotCompress,
  frcotPrompt,
};
