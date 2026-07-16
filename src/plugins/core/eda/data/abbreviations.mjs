/**
 * EDA 領域縮寫展開 + 模式規則
 * 純資料從 abbreviations.json 載入；RegExp/函式保留在此
 *
 * Phase 11: 新增 EDA_ABBREV_DICT（250+ 結構化縮寫，含 vendor/category）
 * 參考：Ask-EDA (IBM) 249 組 + 業界補充
 */

import abbrJson from './abbreviations.json' with { type: 'json' };
export const EDA_ABBREV_DICT = abbrJson.EDA_ABBREV_DICT;
export const EDA_ABBREVIATIONS = abbrJson.EDA_ABBREVIATIONS;

// 模式規則：自動展開常見詞綴變化（RegExp，不可 JSON 化）
export const PATTERN_RULES = [
  { pattern: /\bmux\b/gi, expand: 'multiplexer' },
  { pattern: /\bdemux\b/gi, expand: 'demultiplexer' },
  { pattern: /\breg\b/gi, expand: 'register' },
  { pattern: /\bregs\b/gi, expand: 'registers' },
  { pattern: /\bflop\b/gi, expand: 'flip flop' },
  { pattern: /\bflops\b/gi, expand: 'flip flops' },
  { pattern: /\bclk\b/gi, expand: 'clock' },
  { pattern: /\brst\b/gi, expand: 'reset' },
  { pattern: /\ben\b(?!\w)/gi, expand: 'enable' },
  { pattern: /\bsel\b(?!\w)/gi, expand: 'select' },
  { pattern: /\blat\b/gi, expand: 'latch' },
  { pattern: /\bdec\b/gi, expand: 'decoder' },
  { pattern: /\benc\b/gi, expand: 'encoder' },
  { pattern: /\barb\b/gi, expand: 'arbiter' },
  { pattern: /\bctrl\b/gi, expand: 'controller' },
  { pattern: /\bgen\b/gi, expand: 'generator' },
  { pattern: /\bsync\b/gi, expand: 'synchronizer' },
  { pattern: /\basync\b/gi, expand: 'asynchronous' },
  { pattern: /\bcomb\b/gi, expand: 'combinational' },
  { pattern: /\bseq\b/gi, expand: 'sequential' },
  { pattern: /\bbuf\b/gi, expand: 'buffer' },
  { pattern: /\binv\b/gi, expand: 'inverter' },
  { pattern: /\bnand\b/gi, expand: 'nand gate' },
  { pattern: /\bnor\b/gi, expand: 'nor gate' },
  { pattern: /\bxor\b/gi, expand: 'xor gate' },
  { pattern: /\bxnor\b/gi, expand: 'xnor gate' },
];

// ── Phase 11: 查詢縮寫展開函式 ───────────────────────────────────────

export function expandAbbreviations(query) {
  const words = query.split(/\s+/);
  const found = [];
  const expanded = words.map(w => {
    const clean = w.toLowerCase().replace(/[^a-z0-9&]/g, '');
    const match = EDA_ABBREV_DICT[clean];
    if (match) {
      found.push({ abbr: w, full: match.full, vendor: match.vendor });
      return match.full;
    }
    return w;
  });
  return { expanded: expanded.join(' '), abbreviations: found };
}

export function lookupAbbreviation(abbr) {
  return EDA_ABBREV_DICT[abbr.toLowerCase().replace(/[^a-z0-9&]/g, '')] || null;
}
