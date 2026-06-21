// tool-strategy.mjs — Smart Agent tool recommendation engine
//
// Automatically recommends optimal tool(s) and tool chains for a given task.
// Uses pattern matching on the goal description, enriched with context.
//
// Usage:
//   import { recommendTools, buildToolChain } from 'smart-agent/tool-strategy';

import crypto from 'node:crypto';
import { getMemoryDB } from '../../lib/memory-db.mjs';
//   const rec = recommendTools('debug login error');
//   // => { primary: 'smart_grep', alternatives: [...], reason: '...' }
//   const chain = buildToolChain('refactor user authentication');
//   // => [{ tool, args, dependsOn, reason }, ...]

// ---------------------------------------------------------------------------
// Task pattern definitions
// Each pattern maps a goal keyword set to recommended tools.
// ---------------------------------------------------------------------------

const TASK_PATTERNS = [
  {
    patterns: [/debug|error|exception|fail|trace|stack/i, /crash|panic|throw/i],
    primary: 'smart_grep',
    alternatives: ['smart_error_diagnose', 'smart_debug', 'smart_memory_store'],
    chain: ['smart_memory_store', 'smart_grep', 'smart_error_diagnose', 'smart_debug', 'smart_cross_file_edit', 'smart_test'],
    reason: 'Error debugging: search memory for past fixes → grep code for error patterns → diagnose against KB → deep debug → apply fix → verify with tests',
  },
  {
    patterns: [/refactor|reorganize|restructur/i, /clean\s*up|simplify|deduplicate/i],
    primary: 'smart_learn',
    alternatives: ['smart_import_graph', 'smart_naming', 'smart_rename_safety'],
    chain: ['smart_learn', 'smart_import_graph', 'smart_naming', 'smart_rename_safety', 'smart_cross_file_edit', 'smart_test'],
    reason: 'Refactoring: learn project conventions → analyze dependencies → check naming → safety-check renames → apply changes → verify',
  },
  {
    patterns: [/rename|rename.*file|move.*symbol/i],
    primary: 'smart_rename_safety',
    alternatives: ['smart_import_graph', 'smart_cross_file_edit'],
    chain: ['smart_import_graph', 'smart_rename_safety', 'smart_cross_file_edit', 'smart_test'],
    reason: 'Renaming: first check import dependencies → safety-check the rename → apply → verify',
  },
  {
    patterns: [/security|vulnerability|credential|password|secret|injection|xss|sql\s*inject/i],
    primary: 'smart_security',
    alternatives: ['smart_grep'],
    chain: ['smart_security', 'smart_security', 'smart_grep', 'smart_cross_file_edit', 'smart_test'],
    reason: 'Security audit: scan credentials → scan injections → grep high-risk patterns → fix → verify',
  },
  {
    patterns: [/read|view|show|display|open.*file|file.*content|look\s*at/i],
    primary: 'smart_read',
    alternatives: ['smart_grep', 'smart_learn'],
    chain: ['smart_read', 'smart_grep', 'smart_learn'],
    reason: 'File reading: read target file with progressive detail (auto/outline/symbol/range/full) → search patterns → learn context',
  },
  {
    patterns: [/understand|explore|learn|analyze.*codebase|document|onboard/i],
    primary: 'smart_learn',
    alternatives: ['smart_read', 'smart_import_graph', 'smart_grep', 'smart_naming'],
    chain: ['smart_learn', 'smart_read', 'smart_import_graph', 'smart_grep', 'smart_diagram'],
    reason: 'Codebase exploration: learn project structure → read key files → analyze dependency graph → search patterns → generate diagram',
  },
  {
    patterns: [/test|coverage|uncovered|test\s*case/i],
    primary: 'smart_test',
    alternatives: ['smart_coverage', 'smart_test_suggest'],
    chain: ['smart_test', 'smart_coverage', 'smart_test_suggest'],
    reason: 'Testing: run existing tests → check coverage gaps → suggest new test cases',
  },
  {
    patterns: [/\bgit\b|\bcommit\b|\bpr\b|\bpull\.request\b|\breview\b|\bstaged\b/i],
    primary: 'smart_git_context',
    alternatives: ['smart_git_commit', 'smart_git_pr', 'smart_git_review'],
    chain: ['smart_git_context', 'smart_git_commit', 'smart_git_pr', 'smart_git_review'],
    reason: 'Git workflow: analyze git state → commit with auto-message → generate PR → review changes',
  },
  {
    patterns: [/research|search.*web|find.*(library|api|example)|how\s*to/i],
    primary: 'smart_exa_search',
    alternatives: ['smart_github_search', 'smart_deep_think'],
    chain: ['smart_exa_search', 'smart_github_search', 'smart_deep_think', 'smart_report'],
    reason: 'Research: search the web → find real code examples → synthesize findings → generate report',
  },
  {
    patterns: [/diagram|flowchart|sequence|architecture.*(diagram|chart)/i],
    primary: 'smart_diagram',
    alternatives: ['smart_import_graph', 'smart_report'],
    chain: ['smart_import_graph', 'smart_diagram', 'smart_report'],
    reason: 'Diagram generation: analyze dependencies → generate Mermaid diagram → produce report',
  },
  {
    patterns: [/optimize|performance|slow|bottleneck|profile/i],
    primary: 'smart_grep',
    alternatives: ['smart_deep_think', 'smart_debug'],
    chain: ['smart_grep', 'smart_debug', 'smart_deep_think', 'smart_cross_file_edit', 'smart_test'],
    reason: 'Performance optimization: search for perf-sensitive patterns → analyze → deep think → optimize → verify',
  },
  {
    patterns: [/dependenc(y|ies)|import|module|package/i],
    primary: 'smart_import_graph',
    alternatives: ['smart_learn'],
    chain: ['smart_import_graph', 'smart_learn', 'smart_diagram'],
    reason: 'Dependency analysis: map import graph → learn project conventions → visualize architecture',
  },
  {
    patterns: [/install|setup|configur(e|ation)|deploy|docker/i],
    primary: 'smart_learn',
    alternatives: ['smart_grep'],
    chain: ['smart_learn', 'smart_grep', 'smart_exa_search'],
    reason: 'Setup/Configuration: learn project setup → search for config patterns → research best practices',
  },
];

// Phase 26: Feedback-adjusted weights (loaded lazily)
let _feedbackWeights = null;
let _lastFeedbackLoad = 0;



/**
 * Load feedback weights lazily (cache for 60s).
 */
function _loadFeedbackWeights() {
  const now = Date.now();
  if (_feedbackWeights && now - _lastFeedbackLoad < 60000) return _feedbackWeights;
  _feedbackWeights = {};
  try {
    const db = getMemoryDB();
    for (const pattern of TASK_PATTERNS) {
      const primary = pattern.primary;
      const stats = db.getRecommendationStats(primary);
      if (stats.total >= 3) {
        _feedbackWeights[primary] = stats.rate;
      }
    }
  } catch {
    // Memory DB not available — use default weights
  }
  _lastFeedbackLoad = now;
  return _feedbackWeights;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recommend the best tool(s) for a given goal.
 * @param {string} goal - Task description
 * @param {object} [context] - Optional context (workflow state, history, etc.)
 * @param {Array<string>} [context.recentTools] - Tools already used recently
 * @param {string} [context.workflowStatus] - Current workflow status if any
 * @returns {{ primary: string, alternatives: string[], chain: string[], reason: string, matchScore: number }}
 */
export function recommendTools(goal, context = {}) {
  // Phase 27: Check semantic cache first (fastest path, O(1) for exact match)
  try {
    const db = getMemoryDB();
    const cached = db.searchCache(goal, 0.85);
    if (cached.length > 0) {
      const best = cached[0];
      // Update hit stats
      const hash = crypto.createHash('sha256').update(goal).digest('hex').substring(0, 16);
      db.updateCacheStats(hash, true);
      // Bump hit_count for the cached goal too
      const cachedHash = crypto.createHash('sha256').update(best.goal).digest('hex').substring(0, 16);
      db.updateCacheStats(cachedHash, true);
      return {
        primary: best.toolChain[0] || 'smart_think',
        alternatives: best.toolChain.slice(1),
        chain: best.toolChain,
        reason: `Cache hit (${best.exact ? 'exact' : 'semantic'}, score: ${best.score}): past goal "${best.goal}"`,
        matchScore: best.score,
      };
    }
  } catch {
    // Semantic cache not available — fall through to regex matching
  }

  const match = matchTaskPattern(goal);

  if (!match) {
    return {
      primary: 'smart_think',
      alternatives: ['smart_grep', 'smart_learn'],
      chain: ['smart_think', 'smart_planner', 'smart_workflow'],
      reason: 'Unclear goal: use smart_think to reason about the task, then plan with smart_planner, or execute with smart_workflow',
      matchScore: 0,
    };
  }

  // Phase 26: Apply feedback-based weight adjustment
  let adjustedScore = match.score;
  try {
    const weights = _loadFeedbackWeights();
    const w = weights[match.primary];
    if (w !== undefined) {
      if (w < 0.3) adjustedScore *= 0.5;
      else if (w > 0.8) adjustedScore *= 1.2;
    }
  } catch {
    // Best-effort
  }

  // Filter out recently used tools if context suggests avoiding repeats
  let chain = [...match.chain];
  if (context.recentTools && context.recentTools.length > 0) {
    // Move recently used tools to end of chain (don't skip, just reorder)
    const recent = new Set(context.recentTools);
    const used = chain.filter(t => recent.has(t));
    const unused = chain.filter(t => !recent.has(t));
    chain = [...unused, ...used];
  }

  // Phase 26: Track last recommendation for server feedback comparison
  try {
    global.__lastRecommendation = {
      primary: match.primary,
      chain,
      alternatives: match.alternatives,
      timestamp: Date.now(),
    };
  } catch {
    // Best-effort
  }

  // Phase 27: Auto-cache regex match result for future semantic lookups
  try {
    const db = getMemoryDB();
    const chainJson = JSON.stringify(chain);
    // Only cache if not already cached (avoid unnecessary writes)
    const existing = db.searchCache(goal, 1.0);
    if (existing.length === 0 || !existing.some(e => e.exact)) {
      db.cacheGoal(goal, chainJson);
    }
  } catch {
    // Best-effort
  }

  return {
    primary: match.primary,
    alternatives: match.alternatives,
    chain,
    reason: match.reason,
    matchScore: Math.min(1, adjustedScore),
  };
}

/**
 * Build a complete tool chain for a given goal with dependency metadata.
 * @param {string} goal - Task description
 * @returns {Array<{ tool: string, dependsOn: number[], reason: string }>}
 */
export function buildToolChain(goal) {
  const match = matchTaskPattern(goal);
  if (!match) {
    return [
      { tool: 'smart_think', dependsOn: [], reason: 'Analyze goal and decompose into sub-tasks' },
      { tool: 'smart_planner', dependsOn: [0], reason: 'Generate execution plan from analysis' },
      { tool: 'smart_workflow', dependsOn: [1], reason: 'Execute generated plan' },
    ];
  }

  return match.chain.map((tool, i) => ({
    tool,
    dependsOn: i > 0 ? [i - 1] : [],
    reason: i === 0
      ? `Start with ${tool} for "${goal}"`
      : `Follow up with ${tool}`,
  }));
}

/**
 * Explain a recommendation in natural language.
 * @param {{ primary: string, alternatives: string[], chain: string[], reason: string, matchScore: number }} rec
 * @returns {string}
 */
export function explainRecommendation(rec) {
  let msg = `**Recommended**: \`${rec.primary}\``;
  if (rec.alternatives.length > 0) {
    msg += `\n**Alternatives**: ${rec.alternatives.map(t => `\`${t}\``).join(', ')}`;
  }
  msg += `\n**Tool chain**: ${rec.chain.map(t => `\`${t}\``).join(' → ')}`;
  msg += `\n**Reason**: ${rec.reason}`;
  msg += `\n**Confidence**: ${rec.matchScore > 0.8 ? 'High' : rec.matchScore > 0.5 ? 'Medium' : 'Low'}`;
  return msg;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchTaskPattern(goal) {
  let best = null;
  let bestScore = 0;

  for (const entry of TASK_PATTERNS) {
    let score = 0;
    for (const re of entry.patterns) {
      if (re.test(goal)) {
        score += 1 / entry.patterns.length;
      }
    }
    // Bonus for matching multiple patterns in the same entry
    if (score > 0) {
      // Count individual regex matches for finer granularity
      let detailScore = 0;
      for (const re of entry.patterns) {
        const matches = goal.match(re);
        if (matches) detailScore += matches.length;
      }
      score = Math.min(1, score + detailScore * 0.1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = { ...entry, score };
    }
  }

  return best;
}
