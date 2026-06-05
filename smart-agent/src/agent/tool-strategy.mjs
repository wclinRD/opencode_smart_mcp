// tool-strategy.mjs — Smart Agent tool recommendation engine
//
// Automatically recommends optimal tool(s) and tool chains for a given task.
// Uses pattern matching on the goal description, enriched with context.
//
// Usage:
//   import { recommendTools, buildToolChain } from 'smart-agent/tool-strategy';
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
    patterns: [/understand|explore|learn|analyze.*codebase|document|onboard/i],
    primary: 'smart_learn',
    alternatives: ['smart_import_graph', 'smart_grep', 'smart_naming'],
    chain: ['smart_learn', 'smart_import_graph', 'smart_grep', 'smart_diagram'],
    reason: 'Codebase exploration: learn project structure → analyze dependency graph → search key patterns → generate architecture diagram',
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
    alternatives: ['smart_github_search', 'smart_thinking'],
    chain: ['smart_exa_search', 'smart_github_search', 'smart_thinking', 'smart_report'],
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
    alternatives: ['smart_thinking', 'smart_debug'],
    chain: ['smart_grep', 'smart_debug', 'smart_thinking', 'smart_cross_file_edit', 'smart_test'],
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

  // Filter out recently used tools if context suggests avoiding repeats
  let chain = [...match.chain];
  if (context.recentTools && context.recentTools.length > 0) {
    // Move recently used tools to end of chain (don't skip, just reorder)
    const recent = new Set(context.recentTools);
    const used = chain.filter(t => recent.has(t));
    const unused = chain.filter(t => !recent.has(t));
    chain = [...unused, ...used];
  }

  return {
    primary: match.primary,
    alternatives: match.alternatives,
    chain,
    reason: match.reason,
    matchScore: match.score,
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
