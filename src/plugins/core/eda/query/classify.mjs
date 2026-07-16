// ── Query Intelligence — 查詢分類器 ──────────────────────────────────────
// Phase 12: 自動分類查詢類型，選擇最佳搜尋策略
// 參考：EDA-Copilot (TODAES'25) — 4類分類器，+4.96% accuracy
//
// 6 類分類器：
//   TOOL_ISSUE  — "DC compile error", "Vivado crash"
//   PDK_LOOKUP  — "SKY130 standard cell", "GF180 PDK"
//   ACADEMIC    — "recent papers on ML P&R", "DAC 2025"
//   FLOW_GUIDE  — "how to set up DFT", "P&R flow steps"
//   TOOL_DOCS   — "Vivado constraint syntax", "DC compile command"
//   GENERAL     — fallback，balanced search

import { EDA_ABBREV_DICT } from '../data/abbreviations.mjs';

// ═══ 分類定義 ═══════════════════════════════════════════════════════════

export const QUERY_TYPES = {
  TOOL_ISSUE: 'tool_issue',   // 工具問題診斷
  PDK_LOOKUP: 'pdk_lookup',   // PDK/Cell Library 查詢
  ACADEMIC:   'academic',      // 學術論文/研究
  FLOW_GUIDE: 'flow_guide',    // Cell Flow 流程指引
  TOOL_DOCS:  'tool_docs',     // 工具文件/指令
  GENERAL:    'general',       // 一般查詢
};

// ═══ 分類規則（pattern-based，零 LLM cost）═════════════════════════════

const CLASSIFICATION_RULES = [
  // ── TOOL_ISSUE：問題診斷 ──
  {
    type: QUERY_TYPES.TOOL_ISSUE,
    patterns: [
      /\berror\b/i, /\bfail(?:ed|ure|ing)?\b/i, /\bcrash\b/i, /\bbug\b/i,
      /\bproblem\b/i, /\bissue\b/i, /\bviolation\b/i, /\bwarning\b/i,
      /\bnot\s+work/i, /\bdoesn.t\s+work/i, /\bcannot\b/i, /\bcan.t\b/i,
      /\bfix\b/i, /\bresolve\b/i, /\bsolution\b/i, /\bworkaround\b/i,
      /\bsegfault\b/i, /\bcore\s+dump/i, /\btimeout\b/i, /\bobsolete\b/i,
      /\bdeprecat/i, /\bcompat/i, /\bsegmentation/i,
      // 問題診斷關鍵字（中英）
      /\b問題\b/, /\b錯誤\b/, /\b失敗\b/, /\b修正\b/, /\b解決\b/,
      /\b報錯\b/, /\b異常\b/, /\b崩潰\b/,
    ],
    weight: 1.0,
  },

  // ── PDK_LOOKUP：PDK/Cell Library ──
  {
    type: QUERY_TYPES.PDK_LOOKUP,
    patterns: [
      /\bpdk\b/i, /\bcell\s+lib/i, /\bstandard\s+cell/i, /\bleaf\s+cell/i,
      /\bmacro\s+cell/i, /\btechnology\s+node/i, /\bprocess\s+node/i,
      /\bnm\b.*(?:pdk|cell|process)/i, /\bsky\d+/i, /\basap\d+/i,
      /\bgf\d+/i, /\bnangate/i, /\bfoundry/i,
      /\bfinfet\b/i, /\bmosfet\b/i, /\btransistor\b/i,
      /\bliberty\b/i, /\.lib\b/i, /\bnldm\b/i, /\bcharacteri/i,
      // PDK 查詢（中英）
      /\b製程套件\b/, /\b元件庫\b/, /\b標準單元\b/,
    ],
    weight: 1.0,
  },

  // ── ACADEMIC：學術論文 ──
  {
    type: QUERY_TYPES.ACADEMIC,
    patterns: [
      /\bpaper\b/i, /\barticle\b/i, /\bjournal\b/i, /\bconference\b/i,
      /\bsurvey\b/i, /\bliterature\b/i, /\breference\b/i, /\bcitation\b/i,
      /\bIEEE\b/, /\bACM\b/, /\bDAC\b/, /\bICCAD\b/, /\bDATE\b/,
      /\bASP-DAC\b/, /\bGLSVLSI\b/, /\bISQED\b/, /\bISSCC\b/,
      /\bISCA\b/, /\bMICRO\b/, /\bHPCA\b/, /\bASPLOS\b/,
      /\b(?:arxiv|doi|pubmed|scholar)\b/i,
      /\brecent\s+(?:papers?|research|work)/i,
      /\bstate\s+of\s+the\s+art/i, /\bSOTA\b/,
      /\b(?:published|proposed|introduced)\s+(?:in|by)/i,
      // 學術查詢（中英）
      /\b論文\b/, /\b研究\b/, /\b學術\b/, /\b發表\b/, /\b期刊\b/,
      /\b會議\b/, /\b研討會\b/,
    ],
    weight: 1.0,
  },

  // ── FLOW_GUIDE：Cell Flow 流程指引 ──
  {
    type: QUERY_TYPES.FLOW_GUIDE,
    patterns: [
      /\bhow\s+to\b/i, /\bstep\s+by\s+step/i, /\bworkflow\b/i, /\bflow\b/i,
      /\bprocess\b/i, /\bprocedure\b/i, /\bguide\b/i, /\btutorial\b/i,
      /\bsetup\b/i, /\bconfigure\b/i, /\bmethodology\b/i, /\bbest\s+practice\b/i,
      /\bpipeline\b/i, /\brun(?:ning)?\s+.*\bflow\b/i,
      // Cell flow 階段
      /\bsynthesis\b/i, /\bplacement\b/i, /\brouting\b/i, /\bCTS\b/,
      /\bfloorplan/i, /\bP&R\b/, /\bplace\s+and\s+route/i,
      /\boptimi/i, /\btiming\s+closure/i, /\bclock\s+tree/i,
      /\bDFT\b/i, /\btest\s+pattern/i, /\bscan\s+chain/i,
      // 流程指引（中英）
      /\b如何\b/, /\b流程\b/, /\b步驟\b/, /\b方法\b/, /\b操作\b/,
      /\b設定\b/, /\b配置\b/, /\b指引\b/,
    ],
    weight: 1.0,
  },

  // ── TOOL_DOCS：工具文件/指令 ──
  {
    type: QUERY_TYPES.TOOL_DOCS,
    patterns: [
      /\bcommand\b/i, /\bsyntax\b/i, /\boption\b/i, /\bflag\b/i,
      /\bargument\b/i, /\bparameter\b/i, /\bsetting\b/i, /\bconfig\b/i,
      /\bconstraint\b/i, /\bsdc\b/i, /\bTCL\b/i, /\bscript\b/i,
      /\bmanual\b/i, /\bdocumentation\b/i, /\breference\s+man/i,
      /\buser\s+guide/i, /\bhelp\b/i, /\bman\s+page/i,
      // 工具文件（中英）
      /\b指令\b/, /\b語法\b/, /\b參數\b/, /\b選項\b/, /\b文件\b/,
      /\b手冊\b/, /\b說明\b/,
    ],
    weight: 1.0,
  },
];

// ═══ 來源權重矩陣 ═══════════════════════════════════════════════════════

export const CATEGORY_SOURCE_WEIGHTS = {
  [QUERY_TYPES.TOOL_ISSUE]: {
    community: 1.0,   // 最高：社群有最多問題討論
    github: 0.8,      // issue tracker
    faq: 0.9,         // FAQ 索引
    web: 0.6,         // 一般搜尋
    scholar: 0.2,     // 學術低
    openalex: 0.2,
    exa: 0.5,
    maxResults: 8,
  },
  [QUERY_TYPES.PDK_LOOKUP]: {
    github: 1.0,      // PDK 專案在 GitHub
    web: 0.8,
    community: 0.6,
    faq: 0.3,
    scholar: 0.5,     // PDK 論文
    openalex: 0.5,
    exa: 0.7,
    maxResults: 5,
  },
  [QUERY_TYPES.ACADEMIC]: {
    scholar: 1.0,     // 學術最高
    openalex: 0.9,
    exa: 0.8,
    web: 0.5,
    community: 0.3,
    github: 0.4,
    faq: 0.1,
    maxResults: 10,
  },
  [QUERY_TYPES.FLOW_GUIDE]: {
    web: 1.0,         // 流程指南多在文件/部落格
    community: 0.8,
    github: 0.6,
    faq: 0.7,
    scholar: 0.4,
    openalex: 0.3,
    exa: 0.7,
    maxResults: 8,
  },
  [QUERY_TYPES.TOOL_DOCS]: {
    web: 0.9,         // 廠商文件
    github: 0.8,      // 範例腳本
    community: 0.7,
    faq: 0.8,
    scholar: 0.2,
    openalex: 0.2,
    exa: 0.6,
    maxResults: 8,
  },
  [QUERY_TYPES.GENERAL]: {
    web: 0.8,
    community: 0.7,
    github: 0.7,
    faq: 0.5,
    scholar: 0.6,
    openalex: 0.6,
    exa: 0.8,
    maxResults: 10,
  },
};

// ═══ 核心分類函式 ═══════════════════════════════════════════════════════

/**
 * 分類 EDA 查詢類型
 * @param {string} query - 原始查詢
 * @returns {{ type: string, confidence: number, scores: Object, weights: Object }}
 */
export function classifyQuery(query) {
  if (!query || typeof query !== 'string') {
    return {
      type: QUERY_TYPES.GENERAL,
      confidence: 0.5,
      scores: {},
      weights: CATEGORY_SOURCE_WEIGHTS[QUERY_TYPES.GENERAL],
    };
  }

  const q = query.toLowerCase();
  const scores = {};

  // 計算每個類型的匹配分數
  for (const rule of CLASSIFICATION_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(query)) {
        score += rule.weight;
        pattern.lastIndex = 0; // reset regex state
      }
    }
    scores[rule.type] = score;
  }

  // 找到最高分類型
  let bestType = QUERY_TYPES.GENERAL;
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // 計算信心度（0-1）
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? bestScore / totalScore : 0.5;

  return {
    type: bestType,
    confidence: Math.min(confidence, 1.0),
    scores,
    weights: CATEGORY_SOURCE_WEIGHTS[bestType],
  };
}

/**
 * 根據分類結果調整搜尋參數
 * @param {string} query - 原始查詢
 * @param {Object} args - 原始參數
 * @returns {{ query: string, maxResults: number, sourceWeights: Object, classification: Object }}
 */
export function optimizeSearch(query, args = {}) {
  const classification = classifyQuery(query);

  // 高信心（>0.6）：直接路由，可能用展開查詢
  // 低信心（<=0.6）：調整權重，保留原始查詢
  const optimized = {
    query,
    maxResults: args.maxResults || classification.weights.maxResults || 10,
    sourceWeights: { ...classification.weights },
    classification,
  };

  // 高信心時，可以補充特定來源的搜尋詞
  if (classification.confidence > 0.6) {
    if (classification.type === QUERY_TYPES.TOOL_ISSUE) {
      optimized.query = `${query} EDA troubleshooting solution`;
    } else if (classification.type === QUERY_TYPES.ACADEMIC) {
      optimized.query = `${query} VLSI ASIC survey`;
    } else if (classification.type === QUERY_TYPES.PDK_LOOKUP) {
      optimized.query = `${query} PDK cell library`;
    }
  }

  return optimized;
}
