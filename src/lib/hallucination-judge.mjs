// hallucination-judge.mjs — LLM output hallucination detection engine
//
// Rule-based judge that checks LLM output for 6 hallucination types
// using 5 structural checks. Does NOT call external LLM APIs —
// produces a structured checklist for the LLM to self-verify.
//
// Architecture:
//   - 6 hallucination types: fabrication, misattribution, unfaithful,
//     self-contradiction, off-topic, confident-refusal
//   - 5 structural checks: factual, consistency, groundedness,
//     off-topic, confidence
//   - Scoring: 1-10 per check → overallScore → verdict (pass/warn/fail)
//
// Usage:
//   import { judgeHallucination } from './hallucination-judge.mjs';
//   const result = judgeHallucination({
//     output: "The bug is in parser.js line 42...",
//     context: "Error: TypeError at parser.js:42",
//     query: "Why does the parser crash?",
//     toolName: "smart_error_diagnose",
//     strictness: 5,
//   });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hallucination type definitions */
const HALLUCINATION_TYPES = {
  fabrication: {
    name: 'Fabrication',
    description: '編造不存在的函式/檔案/API',
    severity: 'high',
  },
  misattribution: {
    name: 'Misattribution',
    description: '錯誤歸因（說 A 函式造成 B 錯誤）',
    severity: 'high',
  },
  unfaithful: {
    name: 'Unfaithful',
    description: '偏離使用者問題或工具結果',
    severity: 'medium',
  },
  'self-contradiction': {
    name: 'Self-contradiction',
    description: '前後矛盾',
    severity: 'medium',
  },
  'off-topic': {
    name: 'Off-topic',
    description: '答非所問',
    severity: 'low',
  },
  'confident-refusal': {
    name: 'Confident Refusal',
    description: '過度自信的錯誤否定',
    severity: 'medium',
  },
};

// ---------------------------------------------------------------------------
// Pattern definitions for each check
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate absolute/overconfident language.
 * High match count → possible confident-refusal hallucination.
 */
const ABSOLUTE_PATTERNS = [
  /\b(definitely|absolutely|certainly|undoubtedly)\b/gi,
  /\b(must be|has to be|can only be|it is always)\b/gi,
  /\b(100%|guaranteed|cannot possibly|impossible)\b/gi,
  /\b(no way|never happens|does not exist)\b/gi,
  /\b(the only (way|cause|reason|solution))\b/gi,
];

/**
 * Patterns that indicate hedging/uncertainty (counter-balance to absolute).
 */
const HEDGING_PATTERNS = [
  /\b(may be|might be|could be|possibly|perhaps)\b/gi,
  /\b(likely|probably|seems|appears|suggests)\b/gi,
  /\b(I think|I believe|in my opinion|it is possible)\b/gi,
  /\b(not sure|unclear|uncertain|needs investigation)\b/gi,
];

/**
 * Patterns for extracting code identifiers from text.
 * Matches: function names, file paths, API endpoints, class names.
 */
const IDENTIFIER_PATTERNS = [
  // File paths: src/foo/bar.js, /path/to/file, foo/bar.ts
  /(?:^|\s|`|['"])((?:\.{0,2}\/)?[\w./-]+\.[a-z]{2,5})(?:$|\s|`|['".,;:()])/gm,
  // Function calls: foo(), foo.bar(), foo.bar.baz()
  /\b([a-z_]\w*(?:\.[a-z_]\w*)*)\s*\(/gi,
  // Class names: PascalCase identifiers
  /\b([A-Z][a-zA-Z0-9_]{2,})\b/g,
  // API endpoints: /api/v1/foo, /users/:id
  /(['"])(\/[\w/-]+)\1/g,
];

/**
 * Patterns for cause-effect attribution.
 * "X causes Y", "due to X", "because of X", "X leads to Y"
 */
const ATTRIBUTION_PATTERNS = [
  /\b(caused by|causes?|due to|because of|results? from|triggered by)\s+(.+?)(?:[.,;]|$)/gi,
  /\b(leads? to|results? in|produces?|generates?)\s+(.+?)(?:[.,;]|$)/gi,
  /\b(the (?:root cause|source|origin|reason) is)\s+(.+?)(?:[.,;]|$)/gi,
  /\b(is (?:caused|triggered|introduced) by)\s+(.+?)(?:[.,;]|$)/gi,
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Extract unique code identifiers from text.
 * @param {string} text
 * @returns {Set<string>}
 */
function extractIdentifiers(text) {
  const ids = new Set();
  for (const pattern of IDENTIFIER_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = (match[1] || match[2] || '').trim();
      if (id.length > 1 && !/^\d+$/.test(id)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Count matches of regex patterns in text.
 * @param {string} text
 * @param {RegExp[]} patterns
 * @returns {number}
 */
function countPatternMatches(text, patterns) {
  let count = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Compute keyword overlap ratio between two texts.
 * @param {string} text1
 * @param {string} text2
 * @returns {number} 0-1 overlap ratio
 */
function keywordOverlap(text1, text2) {
  if (!text1 || !text2) return 0;
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap / Math.min(words1.size, words2.size);
}

/**
 * Check if two sentences contradict each other.
 * Simple heuristic: look for negation of the same subject.
 * @param {string[]} sentences
 * @returns {{found: boolean, detail: string}[]}
 */
function detectContradictions(sentences) {
  const contradictions = [];
  const subjects = new Map(); // subject → [{sentence, polarity}]

  for (const sent of sentences) {
    const s = sent.trim();
    if (s.length < 10) continue;

    // Extract subject (first noun phrase)
    const subjectMatch = s.match(/^(the\s+)?([a-z_]\w*(?:\s+[a-z_]\w*){0,2})/i);
    if (!subjectMatch) continue;
    const subject = subjectMatch[2].toLowerCase();

    // Determine polarity
    const isNegative = /\b(not?|no|never|doesn't|don't|isn't|aren't|won't|can't|cannot)\b/i.test(s);
    const polarity = isNegative ? 'negative' : 'positive';

    if (subjects.has(subject)) {
      const prev = subjects.get(subject);
      if (prev.polarity !== polarity) {
        contradictions.push({
          found: true,
          detail: `Contradiction on "${subject}": "${prev.sentence.slice(0, 80)}..." vs "${s.slice(0, 80)}..."`,
        });
      }
    }
    subjects.set(subject, { sentence: s, polarity });
  }

  return contradictions;
}

// ---------------------------------------------------------------------------
// Core check functions
// ---------------------------------------------------------------------------

/**
 * Check 1: Factual — are mentioned identifiers present in context?
 * @param {string} output
 * @param {string} context
 * @returns {{passed: boolean, score: number, detail: string, issues: object[]}}
 */
function factualCheck(output, context) {
  const outputIds = extractIdentifiers(output);
  const contextIds = extractIdentifiers(context || '');

  const issues = [];
  let fabricated = 0;

  for (const id of outputIds) {
    // Skip common words and short identifiers
    if (id.length < 3 || /^(the|and|for|not|but|are|was|has|had|can|will|with|from|this|that|have|been)$/i.test(id)) {
      continue;
    }
    if (!contextIds.has(id) && context) {
      fabricated++;
      issues.push({
        type: 'fabrication',
        detail: `Identifier "${id}" appears in output but not in tool context`,
        severity: 'high',
      });
    }
  }

  // Score: 10 = no fabrications, 0 = many fabrications
  const totalChecked = Math.max(outputIds.size, 1);
  const score = Math.max(0, Math.round(10 * (1 - fabricated / totalChecked)));

  return {
    passed: fabricated === 0,
    score,
    detail: fabricated === 0
      ? 'All mentioned identifiers found in context'
      : `${fabricated} identifier(s) not found in context (${outputIds.size} total)`,
    issues,
  };
}

/**
 * Check 2: Consistency — are there internal contradictions?
 * @param {string} output
 * @returns {{passed: boolean, score: number, detail: string, issues: object[]}}
 */
function consistencyCheck(output) {
  const sentences = output.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
  const contradictions = detectContradictions(sentences);

  const score = contradictions.length === 0 ? 10
    : Math.max(0, 10 - contradictions.length * 3);

  return {
    passed: contradictions.length === 0,
    score,
    detail: contradictions.length === 0
      ? 'No internal contradictions detected'
      : `${contradictions.length} contradiction(s) found`,
    issues: contradictions.map(c => ({
      type: 'self-contradiction',
      detail: c.detail,
      severity: 'medium',
    })),
  };
}

/**
 * Check 3: Groundedness — can conclusions be traced to context?
 * @param {string} output
 * @param {string} context
 * @returns {{passed: boolean, score: number, detail: string, issues: object[]}}
 */
function groundednessCheck(output, context) {
  if (!context) {
    return {
      passed: true,
      score: 10,
      detail: 'No context provided; groundedness check skipped',
      issues: [],
    };
  }

  // Extract key claims from output (sentences with attribution patterns)
  const claims = [];
  for (const pattern of ATTRIBUTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(output)) !== null) {
      claims.push(match[0].trim());
    }
  }

  if (claims.length === 0) {
    return {
      passed: true,
      score: 10,
      detail: 'No cause-effect claims to verify',
      issues: [],
    };
  }

  // Check if each claim's key terms appear in context
  const issues = [];
  for (const claim of claims) {
    const claimWords = claim.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const contextLower = context.toLowerCase();
    const foundWords = claimWords.filter(w => contextLower.includes(w));
    const ratio = foundWords.length / Math.max(claimWords.length, 1);

    if (ratio < 0.3) {
      issues.push({
        type: 'unfaithful',
        detail: `Claim "${claim.slice(0, 80)}..." has low groundedness (${Math.round(ratio * 100)}% terms in context)`,
        severity: 'medium',
      });
    }
  }

  const score = issues.length === 0 ? 10
    : Math.max(0, Math.round(10 * (1 - issues.length / claims.length)));

  return {
    passed: issues.length === 0,
    score,
    detail: issues.length === 0
      ? 'All claims grounded in context'
      : `${issues.length}/${claims.length} claim(s) not grounded in context`,
    issues,
  };
}

/**
 * Check 4: Off-topic — does output address the query?
 * @param {string} output
 * @param {string} query
 * @returns {{passed: boolean, score: number, detail: string, issues: object[]}}
 */
function offTopicCheck(output, query) {
  if (!query) {
    return {
      passed: true,
      score: 10,
      detail: 'No query provided; off-topic check skipped',
      issues: [],
    };
  }

  const overlap = keywordOverlap(output, query);
  const score = Math.round(overlap * 10);

  return {
    passed: overlap >= 0.3,
    score,
    detail: overlap >= 0.3
      ? `Good keyword overlap with query (${Math.round(overlap * 100)}%)`
      : `Low keyword overlap with query (${Math.round(overlap * 100)}%) — may be off-topic`,
    issues: overlap < 0.3 ? [{
      type: 'off-topic',
      detail: `Output has only ${Math.round(overlap * 100)}% keyword overlap with query`,
      severity: 'low',
    }] : [],
  };
}

/**
 * Check 5: Confidence — overconfident language without evidence?
 * @param {string} output
 * @returns {{passed: boolean, score: number, detail: string, issues: object[]}}
 */
function confidenceCheck(output) {
  const absoluteCount = countPatternMatches(output, ABSOLUTE_PATTERNS);
  const hedgingCount = countPatternMatches(output, HEDGING_PATTERNS);

  // High absolute + low hedging = overconfident
  const confidenceRatio = absoluteCount / Math.max(hedgingCount, 1);

  let score, detail, passed;
  if (absoluteCount === 0) {
    score = 10;
    detail = 'No absolute/overconfident language detected';
    passed = true;
  } else if (confidenceRatio > 3) {
    score = Math.max(0, 10 - absoluteCount);
    detail = `${absoluteCount} absolute statement(s) with little hedging (ratio ${confidenceRatio.toFixed(1)}:1) — may be overconfident`;
    passed = false;
  } else {
    score = Math.max(0, 10 - Math.floor(absoluteCount / 2));
    detail = `${absoluteCount} absolute statement(s), balanced by ${hedgingCount} hedging phrase(s)`;
    passed = true;
  }

  return {
    passed,
    score,
    detail,
    issues: !passed ? [{
      type: 'confident-refusal',
      detail: `${absoluteCount} absolute/overconfident statement(s) with only ${hedgingCount} hedging phrase(s)`,
      severity: 'medium',
    }] : [],
  };
}

// ---------------------------------------------------------------------------
// Main judge function
// ---------------------------------------------------------------------------

/**
 * Judge LLM output for hallucinations.
 *
 * @param {object} opts
 * @param {string} opts.output - LLM output text to check
 * @param {string} [opts.context] - Original tool output / context
 * @param {string} [opts.query] - Original user query
 * @param {string} [opts.toolName] - Tool that produced the output
 * @param {number} [opts.strictness=5] - Strictness 1-10 (higher = more sensitive)
 * @returns {{
 *   checks: Array<{type: string, passed: boolean, score: number, detail: string}>,
 *   overallScore: number,
 *   verdict: 'pass'|'warn'|'fail',
 *   issues: Array<{type: string, detail: string, severity: string}>,
 *   summary: string,
 * }}
 */
export function judgeHallucination(opts = {}) {
  const {
    output: rawOutput = '',
    context = '',
    query = '',
    toolName = '',
    strictness = 5,
  } = opts;

  // Type safety: coerce non-string output to string
  const output = typeof rawOutput === 'string' ? rawOutput : String(rawOutput || '');

  if (!output || output.trim().length === 0) {
    return {
      checks: [],
      overallScore: 10,
      verdict: 'pass',
      issues: [],
      summary: 'Empty output — nothing to check.',
    };
  }

  // Run all 5 checks
  const checks = [
    { type: 'factual', ...factualCheck(output, context) },
    { type: 'consistency', ...consistencyCheck(output) },
    { type: 'groundedness', ...groundednessCheck(output, context) },
    { type: 'off-topic', ...offTopicCheck(output, query) },
    { type: 'confidence', ...confidenceCheck(output) },
  ];

  // Collect all issues
  const allIssues = [];
  for (const check of checks) {
    if (check.issues) {
      allIssues.push(...check.issues);
    }
  }

  // Calculate overall score (weighted average)
  // Factual and groundedness are most important
  const weights = {
    factual: 3,
    consistency: 2,
    groundedness: 3,
    'off-topic': 1,
    confidence: 1,
  };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const check of checks) {
    const w = weights[check.type] || 1;
    weightedSum += check.score * w;
    totalWeight += w;
  }
  const overallScore = Math.round(weightedSum / totalWeight);

  // Adjust for strictness
  const adjustedScore = Math.max(1, Math.min(10,
    overallScore - Math.floor((strictness - 5) * 0.5)
  ));

  // Determine verdict
  let verdict;
  if (adjustedScore >= 7) {
    verdict = 'pass';
  } else if (adjustedScore >= 4) {
    verdict = 'warn';
  } else {
    verdict = 'fail';
  }

  // Build summary
  const failedChecks = checks.filter(c => !c.passed);
  let summary;
  if (failedChecks.length === 0) {
    summary = `✅ All checks passed (score: ${adjustedScore}/10). Output appears grounded and consistent.`;
  } else if (verdict === 'warn') {
    summary = `⚠️ ${failedChecks.length} check(s) flagged: ${failedChecks.map(c => c.type).join(', ')}. Score: ${adjustedScore}/10. Review recommended.`;
  } else {
    summary = `❌ ${failedChecks.length} check(s) failed: ${failedChecks.map(c => c.type).join(', ')}. Score: ${adjustedScore}/10. Output likely contains hallucinations.`;
  }

  return {
    checks,
    overallScore: adjustedScore,
    verdict,
    issues: allIssues,
    summary,
  };
}

/**
 * Quick check: is this a high-risk tool that should trigger hallucination detection?
 * @param {string} toolName
 * @returns {boolean}
 */
export function isHighRiskOutput(toolName) {
  const HIGH_RISK_TOOLS = [
    'smart_security',
    'smart_error_diagnose',
    'smart_deep_think',
    'smart_ingest_document',
    'smart_report',
  ];
  return HIGH_RISK_TOOLS.includes(toolName);
}

export { HALLUCINATION_TYPES };