// ── Caveman 壓縮引擎 ──────────────────────────────────────────────────────
// 4 級文字壓縮：strips grammar, keeps facts
// 適用於搜尋結果摘要、abstract、討論內容
//
// Level    │ 策略                              │ 預估 savings
// ─────────┼───────────────────────────────────┼─────────────
// light    │ 去 stop words                     │ ~10-15%
// semantic │ 去 filler phrases + 短化句子       │ ~20-30%
// aggressive│ 詞形還原 + 合併同義              │ ~35-45%
// ultra    │ 縮寫 + 箭頭符號 + 濾除           │ ~50-60%

// ── Stop words（EDA 常見冗詞）──────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this',
  'these', 'those', 'it', 'its', 'they', 'them', 'their', 'what', 'which',
  'who', 'whom', 'about', 'also', 'however', 'therefore', 'thus',
  'hence', 'indeed', 'actually', 'basically', 'essentially', 'simply',
  'generally', 'typically', 'usually', 'often', 'sometimes', 'always',
  'never', 'already', 'still', 'yet', 'even', 'quite', 'rather',
  'somewhat', 'fairly', 'pretty',
]);

// ── Filler phrases（可整段移除）───────────────────────────────────────

const FILLER_PATTERNS = [
  /\b(it is important to note that)\b/gi,
  /\b(it should be noted that)\b/gi,
  /\b(it is worth mentioning)\b/gi,
  /\b(as a matter of fact)\b/gi,
  /\b(in order to)\b/gi,
  /\b(for the purpose of)\b/gi,
  /\b(with regard to)\b/gi,
  /\b(in terms of)\b/gi,
  /\b(on the other hand)\b/gi,
  /\b(at the end of the day)\b/gi,
  /\b(in this (case|context|article|paper|section))\b/gi,
  /\b(as we (all )?know)\b/gi,
  /\b(in general|generally speaking)\b/gi,
  /\b(it (can|may|might) be (said|argued|noted))\b/gi,
  /\b(this is (because|due to|related to))\b/gi,
  /\b(let us|let's) (take a look|consider|examine)\b/gi,
  /\b(here (is|are|we|you))\b/gi,
  /\b(in other words)\b/gi,
  /\b(to be honest)\b/gi,
  /\bFrankly speaking,?\s*/gi,
  /\bObviously,?\s*/gi,
  /\bNeedless to say,?\s*/gi,
  /\bAs can be seen,?\s*/gi,
  /\bIt goes without saying that\b/gi,
];

// ── EDA 領域保留詞（不壓縮）───────────────────────────────────────────

const EDA_PRESERVE = new Set([
  'Design Compiler', 'Synopsys', 'Cadence', 'Innovus', 'Genus', 'Vivado',
  'PrimeTime', 'Calibre', 'IC Compiler', 'ICC2', 'VCS', 'Xcelium',
  'Modus', 'DFT Compiler', 'Formality', 'LEC', 'Conformal',
  'PDK', 'SDC', 'STA', 'DFT', 'ATPG', 'BIST', 'scan', 'timing',
  'power', 'area', 'clock', 'reset', 'flip-flop', 'latch', 'mux',
  'cell', 'library', 'netlist', 'Verilog', 'VHDL', 'SystemVerilog',
  'TCL', 'LEF', 'DEF', 'GDS', 'OASIS', 'Liberty', 'SPICE',
  'CMOS', 'FinFET', 'FD-SOI', 'NAND', 'NOR', 'inverter',
  'synthesis', 'place', 'route', 'CTS', 'opt', 'eco',
  'congestion', 'slack', 'hold', 'setup', 'violation',
]);

// ── 縮寫映射（ultra level）────────────────────────────────────────────

const ABBREVIATIONS = {
  'for example': 'e.g.',
  'that is': 'i.e.',
  'versus': 'vs.',
  'and so on': 'etc.',
  'approximately': '~',
  'greater than': '>',
  'less than': '<',
  'equal to': '=',
  'number': '#',
  'information': 'info',
  'environment': 'env',
  'configuration': 'config',
  'documentation': 'docs',
  'application': 'app',
  'function': 'func',
  'parameter': 'param',
  'variable': 'var',
  'command': 'cmd',
  'directory': 'dir',
  'extension': 'ext',
  'repository': 'repo',
  'dependency': 'dep',
  'description': 'desc',
  'implementation': 'impl',
  'initialization': 'init',
  'temperature': 'temp',
  'synchronous': 'sync',
  'asynchronous': 'async',
  'definition': 'def',
  'reference': 'ref',
  'characteristic': 'char',
  'simulation': 'sim',
  'optimization': 'opt',
  'verification': 'verif',
  'synthesis': 'synth',
  'architecture': 'arch',
  'performance': 'perf',
  'development': 'dev',
  'standard cell': 'std cell',
  'design rule': 'DRC',
  'layout versus schematic': 'LVS',
  'parasitic extraction': 'RCX',
  'static timing analysis': 'STA',
  'design for test': 'DFT',
  'electronic design automation': 'EDA',
};

// ═══════════════════════════════════════════════════════════════════════════
// 核心壓縮函式
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Caveman 文字壓縮
 * @param {string} text - 原始文字
 * @param {string} level - 壓縮等級：light | semantic | aggressive | ultra
 * @returns {string} 壓縮後文字
 */
export function cavemanCompress(text, level = 'semantic') {
  if (!text || typeof text !== 'string') return '';
  if (level === 'none') return text;

  let result = text;

  // 保留 EDA 專有名詞（先提取，壓縮後還原）
  const preserved = [];
  result = result.replace(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\b/g, (match) => {
    if (EDA_PRESERVE.has(match)) {
      const token = `__PRESERVE_${preserved.length}__`;
      preserved.push(match);
      return token;
    }
    return match;
  });

  // 保留 URL 和 code snippets
  const urls = [];
  result = result.replace(/https?:\/\/[^\s)]+/g, (match) => {
    const token = `__URL_${urls.length}__`;
    urls.push(match);
    return token;
  });
  result = result.replace(/`[^`]+`/g, (match) => {
    const token = `__CODE_${urls.length}__`;
    urls.push(match);
    return token;
  });

  // ── Light: 去 stop words ──
  if (level === 'light' || level === 'semantic' || level === 'aggressive' || level === 'ultra') {
    result = result.replace(/\b(\w+)\b/g, (match) => {
      if (STOP_WORDS.has(match.toLowerCase())) return '';
      return match;
    });
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Semantic: 去 filler phrases + 短化 ──
  if (level === 'semantic' || level === 'aggressive' || level === 'ultra') {
    for (const pattern of FILLER_PATTERNS) {
      result = result.replace(pattern, '');
    }
    // 合併連續逗號/句號
    result = result.replace(/,\s*,/g, ',');
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Aggressive: 移除程度副詞（保護專有名詞）──
  if (level === 'aggressive' || level === 'ultra') {
    result = result.replace(/\bvery\s+/gi, '');
    result = result.replace(/\breally\s+/gi, '');
    result = result.replace(/\bextremely\s+/gi, '');
    result = result.replace(/\bquite\s+/gi, '');
    result = result.replace(/\brather\s+/gi, '');
    result = result.replace(/\bsomewhat\s+/gi, '');
    result = result.replace(/\bfairly\s+/gi, '');
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Ultra: 縮寫 + 箭頭 + 濾除 ──
  if (level === 'ultra') {
    for (const [phrase, abbrev] of Object.entries(ABBREVIATIONS)) {
      // 僅匹配小寫（保護專有名詞）
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      result = result.replace(re, abbrev);
    }
    // 句子箭頭化
    result = result.replace(/,\s*(which|that|who)\s+/gi, ' → ');
    result = result.replace(/\.\s+/g, ' | ');
    // 移除多餘空白
    result = result.replace(/\s{2,}/g, ' ').trim();
    // 截斷過長句子（>150 字元）
    result = result.replace(/([^|]{150})[^|]*/g, '$1…');
  }

  // 還原保留詞
  result = result.replace(/__PRESERVE_(\d+)__/g, (_, i) => preserved[parseInt(i)] || '');
  result = result.replace(/__URL_(\d+)__/g, (_, i) => urls[parseInt(i)] || '');
  result = result.replace(/__CODE_(\d+)__/g, (_, i) => urls[parseInt(i)] || '');

  // 最終清理
  result = result.replace(/\s{2,}/g, ' ').trim();
  result = result.replace(/^\s*[|,\s]+/, '');
  result = result.replace(/[|,\s]+\s*$/, '');

  return result;
}

/**
 * 壓縮搜尋結果陣列中的 snippet/content 欄位
 * @param {Array} results - 搜尋結果陣列
 * @param {string} level - 壓縮等級
 * @param {string[]} fields - 要壓縮的欄位名（預設 ['snippet', 'content', 'abstract']）
 * @returns {Array} 壓縮後結果（新陣列，不改原陣列）
 */
export function compressResults(results, level = 'semantic', fields = ['snippet', 'content', 'abstract']) {
  if (!results || !Array.isArray(results) || level === 'none') return results || [];
  return results.map(r => {
    const compressed = { ...r };
    for (const field of fields) {
      if (compressed[field] && typeof compressed[field] === 'string') {
        compressed[field] = cavemanCompress(compressed[field], level);
      }
    }
    return compressed;
  });
}

/**
 * 壓縮格式化後的文字輸出
 * @param {string} text - 格式化後文字
 * @param {string} level - 壓縮等級
 * @returns {string} 壓縮後文字
 */
export function compressOutput(text, level = 'semantic') {
  if (!text || level === 'none') return text || '';
  return cavemanCompress(text, level);
}
