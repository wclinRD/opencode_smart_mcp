// model-router.mjs — Multi-Model Orchestration Engine
//
// Phase 14: Dynamic task-to-tier router with cost tracking + degradation.
//
// Architecture:
//   smart_model_router (MCP tool)
//     └── model-router.mjs
//          ├── Tier 1 (deterministic $0)     → CKG/LSP/grep tools
//          ├── Tier 2 (local small model)     → $0.001/call
//          ├── Tier 3 (medium model API)      → $0.01/call
//          └── Tier 4 (strongest model API)    → $0.05/call
//
//   Provider plugin system:
//     registerProvider('tier-2-local', {...})  → local model adapter
//     registerProvider('tier-3-api', {...})    → API provider adapter
//
//   Auto-degradation:
//     API unavailable → fallback to local → fallback to deterministic
//
// Usage:
//   import { routeTask, getCostReport, registerProvider } from './model-router.mjs';
//   const result = await routeTask({ task: '...', tier: 'auto', context: {} });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tier definitions with estimated cost per call */
export const TIERS = {
  T1: { id: 1, name: 'deterministic', costPerCall: 0, latency: '50-200ms', description: 'CKG/LSP/grep — zero cost, instant' },
  T2: { id: 2, name: 'local-small',    costPerCall: 0.001, latency: '500-2000ms', description: 'Local small model (e.g. Llama 3B)' },
  T3: { id: 3, name: 'medium-api',     costPerCall: 0.01, latency: '2-8s', description: 'Medium model API (e.g. GPT-4o-mini)' },
  T4: { id: 4, name: 'strong-api',     costPerCall: 0.05, latency: '5-30s', description: 'Strongest model API (e.g. Claude Opus)' },
};

/** Task categories that can be routed — extends hybrid-engine classification */
export const TASK_TIERS = {
  'structure':       TIERS.T1,  // "who calls foo()" → CKG, $0
  'change-impact':   TIERS.T1,  // "what breaks if..." → impact analysis, $0
  'debug-grep':      TIERS.T1,  // "find error X" → grep, $0
  'search':          TIERS.T1,  // "find references" → grep, $0
  'type-query':      TIERS.T1,  // "what is type of X" → LSP, $0
  'symbol-query':    TIERS.T1,  // "define X" → AST/CKG, $0
  'completion':      TIERS.T2,  // "complete this code" → local model
  'simple-qna':      TIERS.T2,  // "what does this do?" → local model
  'semantic-code':   TIERS.T3,  // "explain architecture" → medium API
  'code-gen':        TIERS.T3,  // "generate test for X" → medium API
  'complex-debug':   TIERS.T3,  // "root cause of crash" → medium API
  'refactor':        TIERS.T4,  // "refactor this module" → strongest model
  'architecture':    TIERS.T4,  // "design review" → strongest model
  'complex-gen':     TIERS.T4,  // "build feature X" → strongest model
};

/** Default degradation chain: T4 → T3 → T2 → T1 */
const DEFAULT_DEGRADATION = [TIERS.T4, TIERS.T3, TIERS.T2, TIERS.T1];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Accumulated cost tracker (session-level) */
let cumulativeCost = 0;

/** Call counter per tier */
const callCounters = { 1: 0, 2: 0, 3: 0, 4: 0 };

/** Latency accumulator per tier (ms) */
const latencyTotals = { 1: 0, 2: 0, 3: 0, 4: 0 };

/** Registered providers: Map<providerName, ProviderAdapter> */
const registeredProviders = new Map();

/** Default providers: keyed by tier name */
const defaultProviders = new Map();

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ProviderAdapter
 * @property {string} name - Provider name
 * @property {number} tier - Tier ID (1-4)
 * @property {function} execute - async (task, context) => { output, cost, latency }
 * @property {function} [healthCheck] - async () => boolean
 * @property {number} [costPerCall] - Override default tier cost
 */

/**
 * Register a model provider.
 *
 * @param {string} name - Unique provider name
 * @param {ProviderAdapter} adapter - Provider adapter
 */
export function registerProvider(name, adapter) {
  if (!name || !adapter || typeof adapter.execute !== 'function') {
    throw new Error(`Invalid provider: ${name} must have an execute function`);
  }
  registeredProviders.set(name, adapter);
}

/**
 * Get all registered providers for a given tier.
 *
 * @param {number} tierId - Tier ID (1-4)
 * @returns {ProviderAdapter[]}
 */
export function getProvidersForTier(tierId) {
  const providers = [];
  for (const [, adapter] of registeredProviders) {
    if (adapter.tier === tierId) providers.push(adapter);
  }
  return providers;
}

// ---------------------------------------------------------------------------
// Tier Classification
// ---------------------------------------------------------------------------

/**
 * Classify a task into a tier based on task type/tool name.
 *
 * @param {string} taskType - Task category (e.g. 'structure', 'refactor')
 * @param {object} [opts] - Optional hints
 * @param {number} [opts.overrideTier] - Force specific tier
 * @returns {{ tier: object, confidence: number }}
 */
export function classifyTask(taskType, opts = {}) {
  // Override: force a specific tier
  if (opts.overrideTier) {
    const tier = Object.values(TIERS).find(t => t.id === opts.overrideTier);
    if (tier) return { tier, confidence: 1.0, source: 'override' };
  }

  // Classify by task type
  const mapped = TASK_TIERS[taskType];
  if (mapped) {
    return { tier: mapped, confidence: 0.95, source: 'task-type' };
  }

  // Fallback: simple heuristics
  const lower = taskType.toLowerCase();

  if (/^(grep|find|search|where|list|show)\b/.test(lower)) {
    return { tier: TIERS.T1, confidence: 0.9, source: 'heuristic' };
  }
  if (/^(explain|what|describe|summarize)\b/.test(lower)) {
    return { tier: TIERS.T2, confidence: 0.7, source: 'heuristic' };
  }
  if (/^(refactor|redesign|rewrite|migrate)\b/.test(lower)) {
    return { tier: TIERS.T4, confidence: 0.8, source: 'heuristic' };
  }
  if (/^(debug|fix|resolve|crash)\b/.test(lower)) {
    return { tier: TIERS.T3, confidence: 0.7, source: 'heuristic' };
  }

  // Unknown: route to T3 (medium) as safe default
  return { tier: TIERS.T3, confidence: 0.5, source: 'default' };
}

/**
 * Suggest the most cost-effective tier for a given tool name.
 * Used by agent to determine whether to call a tool directly vs via LLM.
 *
 * @param {string} toolName - e.g. 'smart_grep', 'smart_deep_think'
 * @returns {number} Tier ID (1-4)
 */
export function suggestTierForTool(toolName) {
  const name = toolName.toLowerCase().replace(/^smart_/, '');

  // Tier 1: deterministic tools (zero cost)
  const t1Tools = [
    'grep', 'code_ast', 'code_call_graph', 'code_type_infer',
    'code_impact', 'code_query', 'import_graph', 'naming',
    'rename_safety', 'coverage', 'security', 'git_context',
    'git_commit', 'git_review', 'test',
  ];
  if (t1Tools.some(t => name.includes(t) || name === t)) return 1;

  // Tier 2: local small model tasks
  const t2Tools = [
    'py_helper', 'ts_helper', 'rs_helper', 'test_suggest',
  ];
  if (t2Tools.some(t => name.includes(t) || name === t)) return 2;

  // Tier 3: medium complexity
  const t3Tools = [
    'error_diagnose', 'debug', 'diagram', 'report',
    'exa_search', 'exa_crawl', 'github_search', 'toonify',
  ];
  if (t3Tools.some(t => name.includes(t) || name === t)) return 3;

  // Tier 4: complex reasoning
  const t4Tools = [
    'think', 'thinking', 'learn', 'cross_file_edit',
    'compose', 'workflow', 'planner', 'hybrid_router', 'research',
  ];
  if (t4Tools.some(t => name.includes(t) || name === t)) return 4;

  // Unknown tool: default to T3
  return 3;
}

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

/**
 * Track a completed call for cost and latency accounting.
 *
 * @param {number} tierId - Tier ID
 * @param {number} cost - Actual cost in dollars
 * @param {number} latency - Actual latency in ms
 */
export function trackCall(tierId, cost, latency) {
  if (!tierId || tierId < 1 || tierId > 4) return;
  callCounters[tierId] = (callCounters[tierId] || 0) + 1;
  cumulativeCost += cost;
  latencyTotals[tierId] = (latencyTotals[tierId] || 0) + latency;
}

/**
 * Get current cost report.
 *
 * @param {object} [opts]
 * @param {'text'|'json'} [opts.format='json']
 * @returns {object}
 */
export function getCostReport(opts = {}) {
  const format = opts.format || 'json';

  const tierBreakdown = {};
  for (const [, tier] of Object.entries(TIERS)) {
    const count = callCounters[tier.id] || 0;
    tierBreakdown[tier.name] = {
      calls: count,
      totalCost: (count * tier.costPerCall),
      avgLatency: count > 0 ? Math.round((latencyTotals[tier.id] || 0) / count) : 0,
    };
  }

  const report = {
    cumulativeCost: Math.round(cumulativeCost * 10000) / 10000,
    totalCalls: Object.values(callCounters).reduce((a, b) => a + b, 0),
    tierBreakdown,
    byTier: {
      t1: callCounters[1] || 0,
      t2: callCounters[2] || 0,
      t3: callCounters[3] || 0,
      t4: callCounters[4] || 0,
    },
  };

  if (format === 'text') {
    let text = `📊 Cost Report\n${'─'.repeat(40)}\n`;
    text += `Total Calls:   ${report.totalCalls}\n`;
    text += `Cumulative:    $${report.cumulativeCost.toFixed(4)}\n\n`;
    text += `By Tier:\n`;
    for (const [name, data] of Object.entries(tierBreakdown)) {
      text += `  ${name.padEnd(16)} ${String(data.calls).padStart(4)} calls  $${data.totalCost.toFixed(4)}  avg ${data.avgLatency}ms\n`;
    }
    text += `\nEstimated savings vs all-T4: ~${((report.totalCalls * TIERS.T4.costPerCall - cumulativeCost) * 100 / Math.max(report.totalCalls * TIERS.T4.costPerCall, 0.01)).toFixed(0)}%`;
    return text;
  }

  return report;
}

/**
 * Reset cost tracking (for testing).
 */
export function resetCostTracking() {
  cumulativeCost = 0;
  for (const k of [1, 2, 3, 4]) {
    callCounters[k] = 0;
    latencyTotals[k] = 0;
  }
}

// ---------------------------------------------------------------------------
// Degradation Strategy
// ---------------------------------------------------------------------------

/**
 * Get the degradation fallback chain for a given tier.
 * T4 → T3 → T2 → T1 by default.
 *
 * @param {object} startTier - Starting tier object from TIERS
 * @returns {object[]} Ordered fallback tiers
 */
export function getDegradationChain(startTier) {
  const chain = [];
  let found = false;

  for (const tier of DEFAULT_DEGRADATION) {
    if (tier.id === startTier.id) found = true;
    if (found) chain.push(tier);
  }

  // If start tier wasn't in chain, return full chain
  if (chain.length === 0) return [...DEFAULT_DEGRADATION];

  return chain;
}

/**
 * Attempt to route a task with degradation fallback.
 * Tries the target tier first, falls back through degradation chain on failure.
 *
 * @param {object} opts
 * @param {string} opts.task - The task description
 * @param {object} opts.targetTier - Target tier from TIERS
 * @param {Function} opts.executor - async (tier) => { output, cost, latency }
 * @param {Function} [opts.healthCheck] - async (tier) => boolean
 * @returns {Promise<{ output: any, tier: object, degraded: boolean, fallbackChain: string[] }>}
 */
export async function routeWithDegradation(opts) {
  const { task, targetTier, executor, healthCheck } = opts;
  const chain = getDegradationChain(targetTier);
  const fallbackChain = [];
  let lastError = null;

  for (const tier of chain) {
    // Health check if available
    if (healthCheck) {
      try {
        const healthy = await healthCheck(tier);
        if (!healthy) {
          fallbackChain.push(`${tier.name} (unhealthy)`);
          continue;
        }
      } catch {
        fallbackChain.push(`${tier.name} (health-check-failed)`);
        continue;
      }
    }

    try {
      const result = await executor(tier);
      trackCall(tier.id, result.cost || 0, result.latency || 0);
      return {
        output: result.output,
        tier: tier.name,
        degraded: fallbackChain.length > 0,
        fallbackChain,
        cost: result.cost || 0,
        latency: result.latency || 0,
        error: null,
      };
    } catch (err) {
      lastError = err.message || String(err);
      fallbackChain.push(`${tier.name} (${lastError.slice(0, 50)})`);
    }
  }

  // All tiers failed
  return {
    output: null,
    tier: targetTier.name,
    degraded: true,
    fallbackChain,
    cost: 0,
    latency: 0,
    error: `All tiers failed. Chain: ${fallbackChain.join(' → ')}. Last error: ${lastError}`,
  };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Route a task to the most appropriate tier and execute it.
 *
 * @param {object} opts
 * @param {string} opts.task - Task description or type
 * @param {string|number} [opts.tier='auto'] - Target tier: 'auto' | 1-4 | 'T1'-'T4'
 * @param {object} [opts.context] - Task context for executor
 * @param {Function} [opts.executor] - async (tier, context) => result
 * @param {Function} [opts.healthCheck] - async (tier) => boolean
 * @param {boolean} [opts.trackOnly=false] - Only classify + track, don't execute
 * @returns {Promise<object>} Routing result
 */
export async function routeTask(opts = {}) {
  const {
    task = '',
    tier = 'auto',
    context = {},
    executor,
    healthCheck,
    trackOnly = false,
  } = opts;

  // Step 1: Determine target tier
  let targetTier;
  let classification;

  if (tier === 'auto') {
    // Auto-classify from task type
    const taskType = context.taskType || task;
    classification = classifyTask(taskType);
    targetTier = classification.tier;
  } else if (typeof tier === 'number' && tier >= 1 && tier <= 4) {
    targetTier = Object.values(TIERS).find(t => t.id === tier);
    classification = { tier: targetTier, confidence: 1.0, source: 'explicit' };
  } else if (typeof tier === 'string' && tier.startsWith('T')) {
    const id = parseInt(tier[1], 10);
    targetTier = Object.values(TIERS).find(t => t.id === id);
    classification = { tier: targetTier, confidence: 1.0, source: 'explicit' };
  } else {
    // Default: T3
    targetTier = TIERS.T3;
    classification = { tier: targetTier, confidence: 0.5, source: 'default' };
  }

  if (!targetTier) {
    return { error: `Invalid tier: ${tier}`, classification: null };
  }

  // Step 2: Track only (no execution)
  if (trackOnly) {
    return {
      classification,
      suggestedTier: targetTier,
      estimatedCost: targetTier.costPerCall,
      message: `Task "${task.slice(0, 60)}" classified as ${targetTier.name} ($${targetTier.costPerCall}/call)`,
    };
  }

  // Step 3: Execute with degradation
  if (executor) {
    const result = await routeWithDegradation({
      task,
      targetTier,
      executor,
      healthCheck,
    });
    return {
      ...result,
      classification,
    };
  }

  // No executor — return routing info only
  return {
    classification,
    suggestedTier: targetTier,
    estimatedCost: targetTier.costPerCall,
    message: `Task classified as ${targetTier.name}. Provide executor to execute.`,
  };
}

// ---------------------------------------------------------------------------
// Built-in: Cost Savings Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate cost savings of routing vs all-T4 baseline.
 *
 * @param {object} callPattern - { tierId: callCount } over a period
 * @returns {object} Savings estimate
 */
export function estimateSavings(callPattern = {}) {
  const baseline = {
    t1: callPattern.t1 || 0,
    t2: callPattern.t2 || 0,
    t3: callPattern.t3 || 0,
    t4: callPattern.t4 || 0,
  };

  const totalCalls = baseline.t1 + baseline.t2 + baseline.t3 + baseline.t4;
  if (totalCalls === 0) {
    return { totalCalls: 0, allT4Cost: 0, actualCost: 0, savingsPercent: 0 };
  }

  const allT4Cost = totalCalls * TIERS.T4.costPerCall;

  const actualCost =
    baseline.t1 * TIERS.T1.costPerCall +
    baseline.t2 * TIERS.T2.costPerCall +
    baseline.t3 * TIERS.T3.costPerCall +
    baseline.t4 * TIERS.T4.costPerCall;

  const savings = allT4Cost - actualCost;
  const savingsPercent = allT4Cost > 0 ? (savings / allT4Cost) * 100 : 0;

  return {
    totalCalls,
    allT4Cost,
    actualCost,
    savings,
    savingsPercent: Math.round(savingsPercent * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Utility: Suggest optimal route from a question
// ---------------------------------------------------------------------------

/**
 * From a natural language question, suggest the optimal tier + tool.
 *
 * @param {string} question - User's question
 * @returns {{ tier: number, tierName: string, estimatedCost: number, tool: string, reasoning: string }}
 */
export function suggestRoute(question) {
  if (!question) {
    return { tier: 3, tierName: 'medium-api', estimatedCost: 0.01, tool: 'smart_deep_think', reasoning: 'No question provided, defaulting to medium' };
  }

  const lower = question.toLowerCase();

  // Structure queries → T1 deterministic
  if (/who calls|callers? of|callees? of|what calls|where is .* defined|what is .* type|import path|dependencies of|unused export/i.test(lower)) {
    return { tier: 1, tierName: 'deterministic', estimatedCost: 0, tool: 'smart_code_query', reasoning: 'Structure query → deterministic CKG/LSP, zero cost' };
  }

  // Change impact → T1 deterministic
  if (/what if i change|impact radius|would .* break|safe to (change|delete)|refactor safety/i.test(lower)) {
    return { tier: 1, tierName: 'deterministic', estimatedCost: 0, tool: 'smart_code_impact', reasoning: 'Impact analysis → deterministic pipeline, zero cost' };
  }

  // Simple Q&A → T2 local
  if (/what does (this|it|that|the) .* (do|mean)|explain (this|how|what)|how does .* work/i.test(lower)) {
    return { tier: 2, tierName: 'local-small', estimatedCost: 0.001, tool: 'local-model', reasoning: 'Simple Q&A → local small model, low cost' };
  }

  // Debug → T3 medium
  if (/error|exception|crash|bug|fail(ed|ure)?|why (did|does|is|are)|root cause|debug|fix/i.test(lower)) {
    return { tier: 3, tierName: 'medium-api', estimatedCost: 0.01, tool: 'smart_error_diagnose', reasoning: 'Debug pattern → medium API for root cause analysis' };
  }

  // Refactor → T4 strong
  if (/refactor|rewrite|redesign|migrate|convert (to|from)|restructure/i.test(lower)) {
    return { tier: 4, tierName: 'strong-api', estimatedCost: 0.05, tool: 'smart_think', reasoning: 'Refactor/redesign → strongest model required' };
  }

  // Complex generation → T4 strong
  if (/generate|create|build|implement|write .* (function|class|module|component)/i.test(lower)) {
    return { tier: 4, tierName: 'strong-api', estimatedCost: 0.05, tool: 'smart_think', reasoning: 'Code generation → strongest model for quality' };
  }

  // Default → T3
  return { tier: 3, tierName: 'medium-api', estimatedCost: 0.01, tool: 'smart_deep_think', reasoning: 'General query → medium API as default' };
}
