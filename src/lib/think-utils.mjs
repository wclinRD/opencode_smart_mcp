// ── 共用格式化工具（think-utils）──
// 供 smart_decompose 與 smart_think 共用

/**
 * 產生 ASCII 進度條
 * @param {number} completed
 * @param {number} total
 * @returns {string} e.g. "[██████░░░░] 3/5"
 */
export function formatProgressBar(completed, total) {
  const width = 10;
  const safeTotal = total || 1;
  const filled = Math.floor((completed / safeTotal) * width);
  const empty = width - filled;
  const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
  const done = total > 0 && completed >= total ? ' ✅' : '';
  return `[${bar}] ${completed}/${total}${done}`;
}

/**
 * 格式化目標標題行
 * @param {string} goal
 * @returns {string}
 */
export function formatGoalHeader(goal) {
  return `🎯 ${goal}`;
}

/**
 * 格式化子任務列表
 * @param {Array<{id:number, desc:string, status:string}>} subtasks
 * @param {number} currentId
 * @returns {string[]} formatted lines
 */
export function formatSubtaskList(subtasks, currentId) {
  const markers = { pending: '⬜', in_progress: '🔄', done: '✅', blocked: '❌' };
  return subtasks.map(st => {
    const marker = markers[st.status] || '⬜';
    const current = st.id === currentId ? ' ←' : '';
    return `  ${marker} ${st.id}. ${st.desc}${current}`;
  });
}

/**
 * Cosine similarity between two strings (word-level TF)
 * Lightweight, zero dependencies
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().split(/\W+/).filter(Boolean);
  const wordsB = b.toLowerCase().split(/\W+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const freqA = new Map();
  const freqB = new Map();
  for (const w of wordsA) freqA.set(w, (freqA.get(w) || 0) + 1);
  for (const w of wordsB) freqB.set(w, (freqB.get(w) || 0) + 1);

  let dot = 0, magA = 0, magB = 0;
  for (const [w, c] of freqA) {
    const cB = freqB.get(w) || 0;
    dot += c * cB;
    magA += c * c;
  }
  for (const c of freqB.values()) magB += c * c;

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
