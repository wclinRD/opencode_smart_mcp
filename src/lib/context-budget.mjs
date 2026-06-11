// context-budget.mjs — Context window budget management
//
// Tracks cumulative tool output sent to the LLM and auto-compresses
// when approaching context window limits. Prevents the 50-70k token
// context overflow that causes LLM truncation and edit failures.
//
// Architecture:
//   - Budget tracker: counts cumulative output chars per session
//   - Auto-compress: when budget is low, increases compression level
//   - Warning system: exposes budget status to LLM via smart_context
//
// Usage:
//   import { ContextBudget } from './context-budget.mjs';
//   const budget = new ContextBudget({ maxChars: 40000 });
//   budget.track(outputSize);
//   if (budget.isLow()) { /* compress more aggressively */ }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 200_000;   // ~50k tokens (4 chars/token avg)
const LOW_THRESHOLD = 0.5;           // 50% remaining = "low"
const CRITICAL_THRESHOLD = 0.2;      // 20% remaining = "critical"
const WARN_THRESHOLD = 0.7;          // 70% remaining = "warning"

// ---------------------------------------------------------------------------
// ContextBudget class
// ---------------------------------------------------------------------------

export class ContextBudget {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxChars=40000] - max cumulative output chars
   * @param {number} [opts.lowThreshold=0.5] - fraction of max that triggers "low"
   * @param {number} [opts.criticalThreshold=0.2] - fraction that triggers "critical"
   */
  constructor(opts = {}) {
    this._maxChars = opts.maxChars || DEFAULT_MAX_CHARS;
    this._lowThreshold = opts.lowThreshold || LOW_THRESHOLD;
    this._criticalThreshold = opts.criticalThreshold || CRITICAL_THRESHOLD;
    this._totalChars = 0;
    this._callCount = 0;
    this._compressedCount = 0;
    this._savingsChars = 0;
    this._history = []; // [{ tool, chars, compressed, timestamp }]
  }

  // -----------------------------------------------------------------------
  // Tracking
  // -----------------------------------------------------------------------

  /**
   * Track a tool output being sent to the LLM.
   * @param {string} toolName
   * @param {number} outputChars - size of output being sent
   * @param {boolean} [compressed=false] - whether output was compressed
   * @param {number} [originalChars] - original size before compression
   */
  track(toolName, outputChars, compressed = false, originalChars = 0) {
    this._totalChars += outputChars;
    this._callCount++;
    if (compressed) {
      this._compressedCount++;
      this._savingsChars += Math.max(0, originalChars - outputChars);
    }
    this._history.push({
      tool: toolName,
      chars: outputChars,
      compressed,
      timestamp: Date.now(),
    });

    // Keep history bounded
    if (this._history.length > 100) {
      this._history = this._history.slice(-100);
    }
  }

  /**
   * Reset budget for a new session.
   */
  reset() {
    this._totalChars = 0;
    this._callCount = 0;
    this._compressedCount = 0;
    this._savingsChars = 0;
    this._history = [];
  }

  // -----------------------------------------------------------------------
  // Budget queries
  // -----------------------------------------------------------------------

  /** Total chars sent so far */
  get totalChars() { return this._totalChars; }

  /** Remaining budget in chars */
  get remaining() { return Math.max(0, this._maxChars - this._totalChars); }

  /** Fraction of budget used (0-1) */
  get usedFraction() {
    return this._maxChars > 0 ? this._totalChars / this._maxChars : 0;
  }

  /** Fraction of budget remaining (0-1) */
  get remainingFraction() {
    return Math.max(0, 1 - this.usedFraction);
  }

  // -----------------------------------------------------------------------
  // Status checks
  // -----------------------------------------------------------------------

  /** Budget is critically low — must compress aggressively */
  isCritical() {
    return this.remainingFraction <= this._criticalThreshold;
  }

  /** Budget is low — should compress */
  isLow() {
    return this.remainingFraction <= this._lowThreshold;
  }

  /** Budget is approaching limit — warn the LLM */
  isWarning() {
    return this.remainingFraction <= WARN_THRESHOLD;
  }

  // -----------------------------------------------------------------------
  // Compression guidance
  // -----------------------------------------------------------------------

  /**
   * Get recommended compression level based on budget status.
   * @returns {number} 0 (none), 1 (lossless), 2 (lossy)
   */
  getRecommendedLevel() {
    if (this.isCritical()) return 2;  // lossy summarization
    if (this.isLow()) return 1;       // lossless compression
    return 0;                          // no compression needed
  }

  /**
   * Phase 14.4: Context Rot Warning — threshold-specific actionable advice.
   * Returns null when budget is healthy (≥ 50% remaining).
   * @returns {string|null} e.g. "💡 Budget 65.2%。可考慮 smart_context({command:'clear_tool_results', olderThan:10})"
   */
  getRotWarning() {
    const used = this.usedFraction;
    if (used >= 0.9) {
      return `⚠️ Budget 剩 ${(this.remainingFraction * 100).toFixed(0)}%。強烈建議執行 smart_compact 或開始新的 session`;
    }
    if (used >= 0.7) {
      return `⚡ Budget ${(used * 100).toFixed(1)}%。建議執行 smart_context({command:"clear_tool_results", olderThan:10}) 或 smart_compact`;
    }
    if (used >= 0.5) {
      return `💡 Budget ${(used * 100).toFixed(1)}%。可考慮 smart_context({command:"clear_tool_results", olderThan:10}) 釋放 context 空間`;
    }
    return null;
  }

  /**
   * Get budget status for LLM consumption.
   * @returns {object}
   */
  getStatus() {
    const status = this.isCritical() ? 'critical'
      : this.isLow() ? 'low'
      : this.isWarning() ? 'warning'
      : 'ok';

    // Token estimation: ~4 chars per token (conservative)
    const estimatedTokens = Math.round(this._totalChars / 4);
    const maxTokens = Math.round(this._maxChars / 4);
    const remainingTokens = Math.round(this.remaining / 4);

    // Per-tool breakdown: aggregate savings by tool name
    const toolBreakdown = {};
    for (const entry of this._history) {
      if (!toolBreakdown[entry.tool]) {
        toolBreakdown[entry.tool] = { calls: 0, totalChars: 0, compressed: 0 };
      }
      toolBreakdown[entry.tool].calls++;
      toolBreakdown[entry.tool].totalChars += entry.chars;
      if (entry.compressed) toolBreakdown[entry.tool].compressed++;
    }

    return {
      status,
      totalChars: this._totalChars,
      maxChars: this._maxChars,
      remaining: this.remaining,
      usedPct: (this.usedFraction * 100).toFixed(1) + '%',
      remainingPct: (this.remainingFraction * 100).toFixed(1) + '%',
      estimatedTokens,
      maxTokens,
      remainingTokens,
      callCount: this._callCount,
      compressedCount: this._compressedCount,
      savingsChars: this._savingsChars,
      savingsPct: this._totalChars > 0
        ? (this._savingsChars / (this._totalChars + this._savingsChars) * 100).toFixed(1) + '%'
        : '0%',
      toolBreakdown,
      rotWarning: this.getRotWarning(),
      recommendation: status === 'critical'
        ? '⚠️ Context budget critical. Use format:"full" sparingly. Prefer smart_grep over read for large files. Use hashline for edits.'
        : status === 'low'
        ? '⚡ Context budget low. Consider summarizing previous outputs before proceeding.'
        : status === 'warning'
        ? '💡 Context budget approaching limit. Be mindful of large tool outputs.'
        : '✅ Context budget healthy.',
    };
  }

  // -----------------------------------------------------------------------
  // Auto-compress decision
  // -----------------------------------------------------------------------

  /**
   * Decide whether to auto-compress an output based on budget + output size.
   * @param {number} outputSize - size of the output about to be sent
   * @param {number} [currentLevel=0] - tool's declared responsePolicy maxLevel
   * @returns {{ shouldCompress: boolean, level: number, reason: string }}
   */
  decideCompression(outputSize, currentLevel = 0) {
    // Critical: always compress, force L2 if output is large
    if (this.isCritical()) {
      if (outputSize > 500) {
        return { shouldCompress: true, level: Math.max(currentLevel, 2), reason: 'Context budget critical' };
      }
      return { shouldCompress: true, level: Math.max(currentLevel, 1), reason: 'Context budget critical' };
    }

    // Low: compress large outputs
    if (this.isLow() && outputSize > 2000) {
      return { shouldCompress: true, level: Math.max(currentLevel, 1), reason: 'Context budget low' };
    }

    // Warning: compress very large outputs
    if (this.isWarning() && outputSize > 10000) {
      return { shouldCompress: true, level: Math.max(currentLevel, 1), reason: 'Context budget warning' };
    }

    return { shouldCompress: false, level: currentLevel, reason: 'Budget ok' };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

export function getContextBudget(opts) {
  if (!_instance) {
    _instance = new ContextBudget(opts);
  }
  return _instance;
}

export function resetContextBudget() {
  if (_instance) _instance.reset();
}