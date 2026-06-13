// concurrency-gate.mjs — Weight-based concurrency control for MCP tools
//
// Prevents resource contention by limiting concurrent tool execution.
// Light tools (grep, read, lsp) get priority over heavy tools (arch_overview, codebase_index).
// Uses adaptive profiling: actual execution times feed back into scheduling decisions.
//
// Architecture:
//   Handler tools (<100ms) → bypass gate, execute immediately
//   CLI tools (spawn)       → go through gate, queued if overweight
//
// Integration:
//   import { getConcurrencyGate } from '../lib/concurrency-gate.mjs';
//   const gate = getConcurrencyGate();

// ---------------------------------------------------------------------------
// Tool weight profiles — based on CPU/IO intensity and typical duration
// ---------------------------------------------------------------------------

const TOOL_PROFILES = {
  // 🟢 Lightweight (<1s, low resource) — weight 1-2
  smart_grep:            { weight: 1, avgMs: 500,   category: 'search' },
  smart_read:            { weight: 1, avgMs: 200,   category: 'io' },
  smart_glob:            { weight: 1, avgMs: 300,   category: 'search' },
  smart_lsp:             { weight: 1, avgMs: 500,   category: 'analysis' },
  smart_think:           { weight: 1, avgMs: 1000,  category: 'reasoning' },
  smart_context:         { weight: 1, avgMs: 100,   category: 'meta' },
  smart_rules:           { weight: 1, avgMs: 200,   category: 'meta' },
  smart_compact:         { weight: 1, avgMs: 300,   category: 'meta' },
  smart_fast_apply:      { weight: 2, avgMs: 1000,  category: 'edit' },
  smart_edit:            { weight: 2, avgMs: 500,   category: 'edit' },
  smart_hallucination_check: { weight: 2, avgMs: 2000, category: 'verify' },

  // 🟡 Medium (1-5s) — weight 3-4
  smart_test:            { weight: 3, avgMs: 5000,  category: 'test' },
  smart_security:        { weight: 3, avgMs: 3000,  category: 'security' },
  smart_learn:           { weight: 3, avgMs: 3000,  category: 'analysis' },
  smart_deep_think:      { weight: 3, avgMs: 5000,  category: 'reasoning' },
  smart_exa_search:      { weight: 2, avgMs: 3000,  category: 'search' },
  smart_github_search:   { weight: 2, avgMs: 3000,  category: 'search' },
  smart_cross_file_edit: { weight: 3, avgMs: 2000,  category: 'edit' },
  smart_academic_search: { weight: 3, avgMs: 4000,  category: 'research' },
  smart_academic_review: { weight: 3, avgMs: 4000,  category: 'research' },
  smart_docx_generate:   { weight: 3, avgMs: 3000,  category: 'doc' },

  // 🔴 Heavy (5-30s) — weight 5-8
  smart_arch_overview:   { weight: 8, avgMs: 15000, category: 'analysis' },
  smart_codebase_index:  { weight: 8, avgMs: 20000, category: 'analysis' },
  smart_import_graph:    { weight: 6, avgMs: 8000,  category: 'analysis' },
  smart_code_impact:     { weight: 6, avgMs: 10000, category: 'analysis' },
  smart_impact_flow:     { weight: 8, avgMs: 15000, category: 'analysis' },
  smart_exa_crawl:       { weight: 5, avgMs: 10000, category: 'search' },
  smart_code_call_graph: { weight: 6, avgMs: 8000,  category: 'analysis' },
  smart_code_query:      { weight: 5, avgMs: 5000,  category: 'analysis' },
  smart_refactor_plan:   { weight: 6, avgMs: 10000, category: 'refactor' },
  smart_autofix:         { weight: 7, avgMs: 15000, category: 'auto' },
  smart_pr_review:       { weight: 7, avgMs: 15000, category: 'review' },
  smart_agent_execute:   { weight: 8, avgMs: 20000, category: 'auto' },
  smart_workflow:        { weight: 7, avgMs: 15000, category: 'auto' },
  smart_research:        { weight: 6, avgMs: 12000, category: 'research' },
};

const DEFAULT_PROFILE = { weight: 3, avgMs: 3000, category: 'unknown' };

// ---------------------------------------------------------------------------
// ConcurrencyGate
// ---------------------------------------------------------------------------

export class ConcurrencyGate {
  /**
   * @param {number} maxWeight - Maximum total weight of concurrent tools (default: 10)
   */
  constructor(maxWeight = 10) {
    this.maxWeight = maxWeight;
    this.currentWeight = 0;
    this.waitQueue = [];
    this.activeTools = new Map();  // toolName → { weight, startTime, requestId }
    this.adaptiveProfiles = new Map(); // toolName → { weight, avgMs, samples }
    this.totalQueued = 0;    // lifetime counter
    this.totalExecuted = 0;  // lifetime counter
    this.totalRejected = 0;  // lifetime counter
  }

  // -----------------------------------------------------------------------
  // Profile lookup (adaptive > static > default)
  // -----------------------------------------------------------------------

  /**
   * Get the profile for a tool. Prefers adaptive profile (learned from actual
   * execution times) over static profile.
   */
  getProfile(toolName) {
    const base = toolName.startsWith('smart_') ? toolName : `smart_${toolName}`;
    return this.adaptiveProfiles.get(base) || TOOL_PROFILES[base] || DEFAULT_PROFILE;
  }

  // -----------------------------------------------------------------------
  // Admission control
  // -----------------------------------------------------------------------

  /**
   * Try to acquire a concurrency slot.
   * @param {string} toolName
   * @param {string} [requestId] - For tracing
   * @returns {{ allowed: true, weight: number } | { allowed: false, position: number, waitMs: number }}
   */
  tryAcquire(toolName, requestId) {
    const profile = this.getProfile(toolName);
    const name = toolName.startsWith('smart_') ? toolName : `smart_${toolName}`;

    if (this.currentWeight + profile.weight <= this.maxWeight) {
      this.currentWeight += profile.weight;
      this.activeTools.set(name, {
        weight: profile.weight,
        startTime: Date.now(),
        requestId: requestId || null,
      });
      this.totalExecuted++;
      return { allowed: true, weight: profile.weight };
    }

    // Calculate estimated wait time based on active tools
    const now = Date.now();
    let waitMs = 0;
    for (const [, info] of this.activeTools) {
      const elapsed = now - info.startTime;
      const remaining = Math.max(0, (this.getProfile(name).avgMs) - elapsed);
      waitMs += remaining;
    }

    const position = this.waitQueue.length + 1;
    return { allowed: false, position, waitMs };
  }

  /**
   * Enqueue a tool request. Returns a Promise that resolves with the weight
   * when a slot becomes available.
   * @param {string} toolName
   * @param {string} [requestId]
   * @returns {Promise<number>} - resolves with weight
   */
  enqueue(toolName, requestId) {
    const profile = this.getProfile(toolName);
    const name = toolName.startsWith('smart_') ? toolName : `smart_${toolName}`;

    this.totalQueued++;

    return new Promise((resolve) => {
      const entry = {
        toolName: name,
        weight: profile.weight,
        requestId: requestId || null,
        enqueuedAt: Date.now(),
        resolve,
      };

      // Insert sorted by weight (lightest first) to prevent starvation
      const insertIdx = this.waitQueue.findIndex(e => e.weight > entry.weight);
      if (insertIdx === -1) {
        this.waitQueue.push(entry);
      } else {
        this.waitQueue.splice(insertIdx, 0, entry);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Release
  // -----------------------------------------------------------------------

  /**
   * Release a concurrency slot after tool completion.
   * @param {string} toolName
   * @param {number} weight - The weight that was acquired
   * @param {number} [actualDurationMs] - Actual execution time (for adaptive profiling)
   */
  release(toolName, weight, actualDurationMs) {
    const name = toolName.startsWith('smart_') ? toolName : `smart_${toolName}`;

    this.currentWeight = Math.max(0, this.currentWeight - weight);
    this.activeTools.delete(name);

    // Adaptive profiling: update avgMs based on actual execution time
    if (actualDurationMs != null && actualDurationMs > 0) {
      this._updateAdaptiveProfile(name, actualDurationMs);
    }

    // Process queue — promote waiting tools that now fit
    this._processQueue();
  }

  // -----------------------------------------------------------------------
  // Adaptive profiling
  // -----------------------------------------------------------------------

  /**
   * Update the adaptive profile for a tool using exponential moving average.
   * After 10+ samples, the adaptive profile replaces the static one.
   */
  _updateAdaptiveProfile(toolName, actualMs) {
    const existing = this.adaptiveProfiles.get(toolName);
    const staticProfile = TOOL_PROFILES[toolName] || DEFAULT_PROFILE;

    if (!existing) {
      this.adaptiveProfiles.set(toolName, {
        weight: staticProfile.weight,
        avgMs: actualMs,
        samples: 1,
      });
      return;
    }

    // EMA: 70% old, 30% new — smooths out spikes
    existing.avgMs = existing.avgMs * 0.7 + actualMs * 0.3;
    existing.samples++;

    // After 10 samples, adjust weight if actual duration differs significantly
    if (existing.samples >= 10) {
      const ratio = existing.avgMs / (staticProfile.avgMs || 1000);
      if (ratio > 2.0) {
        existing.weight = Math.min(10, staticProfile.weight + 2);
      } else if (ratio < 0.5) {
        existing.weight = Math.max(1, staticProfile.weight - 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Queue processing
  // -----------------------------------------------------------------------

  /**
   * Process the wait queue — promote entries that now fit within the budget.
   */
  _processQueue() {
    // Try to promote as many as possible (sorted by weight, lightest first)
    let promoted = 0;
    for (let i = 0; i < this.waitQueue.length; i++) {
      const entry = this.waitQueue[i];
      if (this.currentWeight + entry.weight <= this.maxWeight) {
        this.waitQueue.splice(i, 1);
        i--; // adjust index after removal
        this.currentWeight += entry.weight;
        this.activeTools.set(entry.toolName, {
          weight: entry.weight,
          startTime: Date.now(),
          requestId: entry.requestId,
        });
        this.totalExecuted++;
        entry.resolve(entry.weight);
        promoted++;
      }
      // Since queue is sorted by weight, if current doesn't fit, heavier ones won't either
    }
    return promoted;
  }

  // -----------------------------------------------------------------------
  // Status & debugging
  // -----------------------------------------------------------------------

  /**
   * Get current gate status for monitoring/debugging.
   */
  getStatus() {
    const now = Date.now();
    return {
      budget: {
        used: this.currentWeight,
        max: this.maxWeight,
        available: this.maxWeight - this.currentWeight,
        utilizationPercent: Math.round((this.currentWeight / this.maxWeight) * 100),
      },
      active: [...this.activeTools.entries()].map(([name, info]) => ({
        tool: name,
        weight: info.weight,
        runningMs: now - info.startTime,
        requestId: info.requestId,
      })),
      queue: {
        length: this.waitQueue.length,
        tools: this.waitQueue.map(e => ({
          tool: e.toolName,
          weight: e.weight,
          waitingMs: now - e.enqueuedAt,
        })),
      },
      stats: {
        totalExecuted: this.totalExecuted,
        totalQueued: this.totalQueued,
        totalRejected: this.totalRejected,
      },
      adaptiveProfiles: [...this.adaptiveProfiles.entries()]
        .filter(([, p]) => p.samples >= 5)
        .map(([name, p]) => ({
          tool: name,
          samples: p.samples,
          avgMs: Math.round(p.avgMs),
          weight: p.weight,
        })),
    };
  }

  /**
   * Reset all statistics (keep adaptive profiles).
   */
  resetStats() {
    this.totalQueued = 0;
    this.totalExecuted = 0;
    this.totalRejected = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Get or create the singleton ConcurrencyGate instance.
 * @param {number} [maxWeight] - Only used on first call
 * @returns {ConcurrencyGate}
 */
export function getConcurrencyGate(maxWeight) {
  if (!_instance) {
    _instance = new ConcurrencyGate(maxWeight);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetConcurrencyGate() {
  _instance = null;
}