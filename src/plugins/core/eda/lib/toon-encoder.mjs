// ── TOON Encoder/Decoder ───────────────────────────────────────────────
// Tree-Object-Optimized Notation — lossless JSON 壓縮
// 參考：TokenSeive SmartCrusher TOON format
// Token 節省：~40-60%（152 tokens → 63 tokens）
//
// 原理：JSON 的 key 名稱在 schema 固定時是冗餘的。
// TOON 用三角括號 `<key1,key2>` 標記 key 順序，值直接排列。
// Decoder 用 schema 或 key 順序還原完整 JSON。
//
// 格式：
//   原始 JSON:  {"name":"DC","vendor":"Synopsys","category":"tool"}
//   TOON:       <name,vendor,category>DC,Synopsys,tool
//
// 陣列：
//   原始 JSON:  [{"name":"DC"},{"name":"PT"}]
//   TOON:       [<name,vendor,category>DC,Synopsys,tool|PT,Synopsys,tool]
//
// 巢狀物件：
//   原始 JSON:  {"tools":[{"name":"DC"}]}
//   TOON:       <tools<name>>DC

/**
 * TOON 編碼：將 JSON 物件轉為 TOON 格式
 * @param {any} obj - 要編碼的物件
 * @returns {string} TOON 格式字串
 */
export function encodeToon(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    // 陣列：如果所有元素是相同結構，用壓縮格式
    if (typeof obj[0] === 'object' && obj[0] !== null && !Array.isArray(obj[0])) {
      const keys = Object.keys(obj[0]);
      const header = '<' + keys.join(',') + '>';
      const rows = obj.map(item =>
        keys.map(k => encodeToon(item[k])).join(',')
      );
      return header + rows.join('|');
    }
    return '[' + obj.map(encodeToon).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    const header = '<' + keys.join(',') + '>';
    const values = keys.map(k => encodeToon(obj[k])).join('');
    return header + values;
  }
  return JSON.stringify(obj);
}

/**
 * TOON 解碼：將 TOON 格式還原為 JSON 物件
 * @param {string} toon - TOON 格式字串
 * @returns {any} 還原的 JSON 物件
 */
export function decodeToon(toon) {
  if (!toon || typeof toon !== 'string') return null;
  toon = toon.trim();

  // 空值
  if (toon === '' || toon === 'null') return null;
  if (toon === '[]') return [];
  if (toon === '{}') return {};

  // 陣列格式 [item1,item2,...]
  if (toon.startsWith('[') && toon.endsWith(']')) {
    const inner = toon.slice(1, -1);
    if (!inner) return [];
    // 檢查是否有 TOON header（壓縮陣列）
    const headerMatch = inner.match(/^<([^>]+)>(.+)/);
    if (headerMatch) {
      const keys = headerMatch[1].split(',');
      const rest = headerMatch[2];
      const rows = rest.split('|').filter(Boolean);
      return rows.map(row => {
        const values = smartSplit(row, keys.length);
        const obj = {};
        keys.forEach((k, i) => { obj[k] = parseToonValue(values[i]); });
        return obj;
      });
    }
    // 一般陣列
    return smartSplit(inner, Infinity).map(parseToonValue);
  }

  // 物件格式 <key1,key2>val1val2
  if (toon.startsWith('<')) {
    const headerEnd = toon.indexOf('>');
    if (headerEnd === -1) return parseToonValue(toon);
    const keys = toon.slice(1, headerEnd).split(',');
    const rest = toon.slice(headerEnd + 1);

    // 嵌套物件：header 中包含子物件
    if (keys.length === 1 && keys[0].includes('<')) {
      // 複雜嵌套，退回 JSON 解析
      return parseToonValue(toon);
    }

    // 檢查 rest 是否包含巢狀 TOON
    const values = [];
    let remaining = rest;
    for (let i = 0; i < keys.length; i++) {
      if (remaining.startsWith('<')) {
        // 嵌套物件
        const nested = extractNextToon(remaining);
        values.push(nested.value);
        remaining = nested.rest;
      } else if (remaining.startsWith('[')) {
        // 嵌套陣列
        const arr = extractNextArray(remaining);
        values.push(arr.value);
        remaining = arr.rest;
      } else {
        // 原值
        const val = extractNextValue(remaining);
        values.push(val.value);
        remaining = val.rest;
      }
    }

    const obj = {};
    keys.forEach((k, i) => { obj[k] = parseToonValue(values[i]); });
    return obj;
  }

  // 其他：嘗試 JSON 解析
  try { return JSON.parse(toon); } catch { return toon; }
}

// ── 內部輔助函式 ──────────────────────────────────────────────────────

function parseToonValue(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (!isNaN(v) && v !== '') return Number(v);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  // 嘗試 JSON 解析
  try { return JSON.parse(v); } catch { return v; }
}

function smartSplit(s, maxParts) {
  // 用逗號分隔但跳過引號內的逗號
  const parts = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < s.length && parts.length < maxParts; i++) {
    const c = s[i];
    if (c === '"') { inQuote = !inQuote; current += c; }
    else if (c === ',' && !inQuote) { parts.push(current); current = ''; }
    else { current += c; }
  }
  if (current || parts.length < maxParts) parts.push(current);
  return parts;
}

function extractNextToon(s) {
  // 找到對應的 >
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') depth++;
    if (s[i] === '>') { depth--; if (depth === 0) { return { value: s.slice(0, i + 1), rest: s.slice(i + 1) }; } }
  }
  return { value: s, rest: '' };
}

function extractNextArray(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') depth++;
    if (s[i] === ']') { depth--; if (depth === 0) { return { value: s.slice(0, i + 1), rest: s.slice(i + 1) }; } }
  }
  return { value: s, rest: '' };
}

function extractNextValue(s) {
  // Skip leading delimiter (comma, pipe)
  if (s && (s[0] === ',' || s[0] === '|')) s = s.slice(1);
  // 找到下一個 , 或 < 或 [ 或結尾
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && (c === ',' || c === '<' || c === '[')) {
      return { value: s.slice(0, i), rest: s.slice(i) };
    }
  }
  return { value: s, rest: '' };
}

/**
 * 計算 TOON 編碼的 token 節省比例
 * @param {any} obj - 原始物件
 * @returns {{ original: number, toon: number, savings: number }}
 */
export function toonStats(obj) {
  const original = JSON.stringify(obj).length;
  const toon = encodeToon(obj).length;
  return {
    original,
    toon,
    savings: Math.round((1 - toon / original) * 100),
  };
}
