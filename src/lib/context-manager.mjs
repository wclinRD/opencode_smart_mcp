#!/usr/bin/env node

// context-manager.mjs — Session context management for Smart MCP tools
//
// Tracks tool call history, findings, and session state across invocations.
// Injected into tool calls via env var (CLI) or args (handler).
// Persisted to ~/.smart/context/ for session recovery.
//
// Context Schema:
//   {
//     sessionId: 'uuid',
//     projectRoot: '/path',
//     toolHistory: [ { tool, args, result, error, duration, timestamp, ok } ],
//     accumulatedFindings: [ { source, finding, category, severity, timestamp } ],
//     lastResult: { tool, summary, ok },
//     metadata: { createdAt, updatedAt, toolCount, errorCount }
//   }

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { env } from 'node:process';
import { classifyEntry, summarizeOutput } from '../plugins/core/compact.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_DIR = resolve(homedir(), '.smart', 'context');
const MAX_HISTORY = 50;
const MAX_FINDINGS = 100;
const MAX_RESULT_LENGTH = 2000;

// P0 MicroCompact: placeholder for cleared tool results
const TOOL_RESULT_PLACEHOLDER = '[MicroCompact: tool result cleared]';
const MICRO_COMPACT_KEEP = 5;     // Keep last N results as-is
const MICRO_COMPACT_LARGE_RESULT = 50000;  // Truncate results >50K chars

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function truncate(str, maxLen) {
  if (!str || typeof str !== 'string') return String(str ?? '');
  return str.length > maxLen ? str.slice(0, maxLen) + '... [truncated]' : str;
}

function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Finding extraction patterns
// ---------------------------------------------------------------------------

const FINDING_PATTERNS = [
  { pattern: /(?:critical|high|medium)\s+severity/i, category: 'security', severity: 'high' },
  { pattern: /(?:credential|password|secret|api[_-]?key|token)\s+(?:found|leak|exposed)/i, category: 'security', severity: 'critical' },
  { pattern: /(?:injection|xss|sqli|path[_-]?traversal)/i, category: 'security', severity: 'high' },
  { pattern: /(?:error|exception|failed|failure|crash)/i, category: 'error', severity: 'high' },
  { pattern: /(?:typeerror|referenceerror|syntaxerror)/i, category: 'error', severity: 'high' },
  { pattern: /(?:timeout|timed out|abort)/i, category: 'error', severity: 'medium' },
  { pattern: /(?:uncovered|untested|missing test)/i, category: 'quality', severity: 'medium' },
  { pattern: /(?:deprecated|deprecation|legacy)/i, category: 'quality', severity: 'low' },
  { pattern: /(?:refactor|duplicate|redundant|complexity)/i, category: 'refactor', severity: 'medium' },
  { pattern: /(?:vulnerability|CVE|outdated|patch)/i, category: 'dependency', severity: 'high' },
  { pattern: /(?:missing dependency|module not found)/i, category: 'dependency', severity: 'high' },
];

function extractFindings(toolName, result) {
  if (!result || typeof result !== 'string') return [];
  const findings = [];
  const seen = new Set();

  for (const fp of FINDING_PATTERNS) {
    const match = result.match(fp.pattern);
    if (match) {
      const key = match[0].toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        source: toolName,
        finding: match[0].length > 120 ? match[0].slice(0, 120) + '...' : match[0],
        category: fp.category,
        severity: fp.severity,
        timestamp: nowISO(),
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  constructor(opts = {}) {
    this._contextDir = opts.contextDir || CONTEXT_DIR;
    this._maxHistory = opts.maxHistory || MAX_HISTORY;
    this._maxFindings = opts.maxFindings || MAX_FINDINGS;
    this._maxResultLength = opts.maxResultLength || MAX_RESULT_LENGTH;
    this._autoSave = opts.autoSave !== false;
    this._extract = opts.extractFindings !== false;

    /** @type {object|null} */
    this._context = null;
  }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  /**
   * Init session — create new or resume existing.
   * @param {object} [opts] - { sessionId?, projectRoot? }
   * @returns {object} context
   */
  init(opts = {}) {
    // Resume existing session
    if (opts.sessionId) {
      const loaded = this._loadFromDisk(opts.sessionId);
      if (loaded) {
        this._context = loaded;
        this._context.metadata.updatedAt = nowISO();
        if (opts.projectRoot) this._context.projectRoot = opts.projectRoot;
        return this._context;
      }
    }

    // Create fresh
    const sessionId = opts.sessionId || randomUUID();
    this._context = {
      sessionId,
      projectRoot: opts.projectRoot || env.PWD || env.CWD || process.cwd(),
      toolHistory: [],
      accumulatedFindings: [],
      lastResult: null,
      metadata: {
        createdAt: nowISO(),
        updatedAt: nowISO(),
        toolCount: 0,
        errorCount: 0,
      },
    };

    this._save();
    return this._context;
  }

  /**
   * Mark current session as cleanly ended.
   * Called from graceful shutdown (SIGINT/SIGTERM).
   * If the process is killed (SIGKILL), this won't run — the absence
   * of this flag on the NEXT session start indicates an interruption.
   */
  markSessionEnd() {
    if (!this._context) return false;
    this._context._sessionEnded = true;
    this._context.metadata.sessionEndedAt = nowISO();
    this._save();
    return true;
  }

  /**
   * Get the previous session (the one immediately before current).
   * Returns full session data, or null if no previous session.
   */
  getPreviousSession() {
    if (!this._context) return null;
    const currentId = this._context.sessionId;
    const allSessions = this.listSessionsSummary();
    const previous = allSessions
      .filter(s => s.sessionId !== currentId)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    if (!previous) return null;
    return this._loadFromDisk(previous.sessionId);
  }

  /**
   * Detect if the previous session was abnormally interrupted.
   *
   * Heuristic:
   *   - Previous session has >= 2 tool calls (something meaningful)
   *   - Previous session was NOT cleanly ended (no markSessionEnd)
   *   - Last tool call exists (session wasn't empty)
   *
   * Returns recovery context object, or null if no interruption detected.
   */
  detectAbnormalEnd() {
    const prev = this.getPreviousSession();
    if (!prev) return null;

    const toolCount = prev.metadata?.toolCount || 0;
    if (toolCount < 2) return null; // nothing meaningful lost

    const history = prev.toolHistory || [];
    const lastEntry = history[history.length - 1];
    const cleanEnd = prev._sessionEnded === true;

    if (cleanEnd) return null; // normal session end

    return {
      interrupted: true,
      sessionId: prev.sessionId,
      toolCount,
      lastTool: lastEntry?.tool || null,
      lastOk: lastEntry?.ok !== false,
      lastTimestamp: lastEntry?.timestamp || prev.metadata?.updatedAt,
      lastError: !lastEntry?.ok ? (lastEntry?.error || null) : null,
      // Best guess: if last tool wasn't ok, that tool was the failure point
      lastToolResult: lastEntry?.ok
        ? (lastEntry?.result ? lastEntry.result.slice(0, 200) : null)
        : (lastEntry?.error ? lastEntry.error.slice(0, 200) : null),
    };
  }

  /** Get a read-only clone of current context. */
  get() {
    return this._context ? JSON.parse(JSON.stringify(this._context)) : null;
  }

  /** Get accumulated findings (thread-safe clone). */
  getFindings() {
    if (!this._context || !this._context.accumulatedFindings) return [];
    return JSON.parse(JSON.stringify(this._context.accumulatedFindings));
  }

  /** Get compact summary for injection (small JSON string). */
  getSummary() {
    if (!this._context) return '';
    const h = this._context.toolHistory;
    const summary = {
      sid: this._context.sessionId,
      n: this._context.metadata.toolCount,
      err: this._context.metadata.errorCount,
      last: h.length > 0 ? h[h.length - 1].tool : null,
      recent: h.slice(-3).map(e => e.tool),
      finds: this._context.accumulatedFindings.length,
    };
    return JSON.stringify(summary);
  }

  /** Reset context (keep sessionId, clear history). */
  reset() {
    if (!this._context) return;
    this._context.toolHistory = [];
    this._context.accumulatedFindings = [];
    this._context.lastResult = null;
    this._context.metadata.toolCount = 0;
    this._context.metadata.errorCount = 0;
    this._context.metadata.updatedAt = nowISO();
    this._save();
  }

  /** Clear current session (does not delete disk). */
  clear() {
    this._context = null;
  }

  /**
   * Phase 14.1: Clear old tool results from history.
   * Removes entries older than `olderThan` turns, with a safety floor of `keepLatest`.
   * Only operates on toolHistory — system prompt / thinking blocks are not stored here.
   *
   * @param {object} [opts]
   * @param {number} [opts.olderThan=10] - Keep only the last N turns, remove everything older
   * @param {number} [opts.keepLatest=2] - Safety floor: always keep at least this many recent entries
   * @returns {{ removed: number, kept: number }}
   */
  clearToolResults({ olderThan = 10, keepLatest = 2 } = {}) {
    if (!this._context || !this._context.toolHistory.length) {
      return { removed: 0, kept: 0 };
    }

    const history = this._context.toolHistory;
    const total = history.length;

    // Calculate how many entries to keep
    // olderThan: keep the last N entries (cap at total — if olderThan >= total, keep all)
    let keepCount = Math.min(olderThan, total);
    // keepLatest: safety floor — at minimum keep this many
    keepCount = Math.max(keepCount, Math.min(keepLatest, total));

    const removeCount = total - keepCount;

    if (removeCount <= 0) {
      return { removed: 0, kept: total };
    }

    // Remove oldest entries (slice from the front)
    this._context.toolHistory = history.slice(-keepCount);
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();

    return { removed: removeCount, kept: keepCount };
  }

  /**
   * P0 MicroCompact: keep last N results as-is, replace older ones with placeholder.
   * Unlike clearToolResults (which removes entries entirely), MicroCompact preserves
   * the entry structure but replaces the result/error text with a short placeholder.
   * This allows the LLM to still see *what tools were called* without the full output.
   *
   * Large results (>50K chars) are truncated to 2KB preview at capture time.
   *
   * Runs on every tool call (auto-triggered from server). Zero LLM cost.
   *
   * @param {object} [opts]
   * @param {number} [opts.keep=5] - Keep last N results as-is
   * @returns {{ cleared: number, kept: number, largeTruncated: number }}
   */
  microCompact({ keep = MICRO_COMPACT_KEEP } = {}) {
    if (!this._context || !this._context.toolHistory.length) {
      return { cleared: 0, kept: 0, largeTruncated: 0 };
    }

    const history = this._context.toolHistory;
    const total = history.length;
    const keepCount = Math.min(keep, total);
    const clearStart = total - keepCount;
    let cleared = 0;
    let largeTruncated = 0;

    for (let i = 0; i < total; i++) {
      const entry = history[i];

      // Keep last `keepCount` entries as-is
      if (i >= clearStart) {
        // Still check for large results
        if (entry.result && entry.result.length > MICRO_COMPACT_LARGE_RESULT) {
          entry.result = entry.result.slice(0, 2000) +
            `\n\n--- [MicroCompact: truncated ${MICRO_COMPACT_LARGE_RESULT}+ chars] ---`;
          entry._microCompacted = 'truncated';
          largeTruncated++;
        }
        continue;
      }

      // Older entries: replace result/error with placeholder
      if (entry.result || entry.error) {
        entry.result = TOOL_RESULT_PLACEHOLDER;
        entry.error = undefined;
        entry._microCompacted = 'cleared';
        cleared++;
      }
    }

    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();

    return { cleared, kept: keepCount, largeTruncated };
  }

  /**
   * Phase 32: Compact tool history using smart classification.
   * Uses classifyEntry() to identify DROP/KEEP_SUMMARY/KEEP entries.
   * DROP entries are removed. KEEP_SUMMARY entries are replaced with summary.
   * Last `protectLast` entries are always preserved (safety).
   * Zero LLM cost — rules-based classification from compact.mjs.
   *
   * @param {object} [opts]
   * @param {number} [opts.protectLast=3] - Never touch last N entries
   * @param {boolean} [opts.summarize=false] - Replace KEEP_SUMMARY output with summary
   * @returns {{ removed: number, summarized: number }}
   */
  compactHistory({ protectLast = 3, summarize = false } = {}) {
    if (!this._context || !this._context.toolHistory.length) {
      return { removed: 0, summarized: 0 };
    }

    const history = this._context.toolHistory;
    const total = history.length;
    const analyzableEnd = total - Math.min(protectLast, total);

    const newHistory = [];
    let removed = 0;
    let summarized = 0;

    for (let i = 0; i < total; i++) {
      // Protected zone: always keep as-is
      if (i >= analyzableEnd) {
        newHistory.push(history[i]);
        continue;
      }

      const action = classifyEntry(history[i]);

      if (action === 'DROP') {
        removed++;  // Don't push → effectively removed
      } else if (action === 'KEEP_SUMMARY' && summarize) {
        newHistory.push({
          ...history[i],
          result: summarizeOutput(history[i]),
          _summarized: true,
        });
        summarized++;
      } else {
        newHistory.push(history[i]);
      }
    }

    this._context.toolHistory = newHistory;
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();

    return { removed, summarized };
  }

  /** Get env vars for CLI tool context injection. */
  getEnv() {
    if (!this._context) return {};
    return {
      SMART_SESSION_ID: this._context.sessionId,
      SMART_TOOL_COUNT: String(this._context.metadata.toolCount),
      SMART_CONTEXT: this.getSummary(),
    };
  }

  /**
   * Add pre-formatted findings directly to accumulated findings.
   * Used by auto memory injection to surface past learnings without a tool call.
   * @param {Array<{source:string, finding:string, category:string, severity:string}>} findings
   */
  addFindings(findings) {
    if (!this._context || !Array.isArray(findings)) return;
    let changed = false;
    for (const f of findings) {
      if (!f || !f.finding) continue;
      this._context.accumulatedFindings.push({
        source: f.source || 'system',
        finding: typeof f.finding === 'string' ? f.finding.slice(0, 300) : String(f.finding).slice(0, 300),
        category: f.category || 'memory',
        severity: f.severity || 'low',
        timestamp: nowISO(),
      });
      changed = true;
      if (this._context.accumulatedFindings.length > this._maxFindings) {
        this._context.accumulatedFindings.shift();
      }
    }
    if (changed && this._autoSave) this._save();
  }

  // -----------------------------------------------------------------------
  // Context injection
  // -----------------------------------------------------------------------

  /**
   * Inject context summary into tool args (for handler-based tools).
   * @param {string} toolName
   * @param {object} args
   * @returns {object} modified args
   */
  inject(toolName, args) {
    if (!this._context) return args;
    const summary = this.getSummary();
    if (!summary) return args;
    return { ...args, _context: summary };
  }

  /**
   * Get tool history for a specific workflowId.
   * @param {string} workflowId
   * @returns {Array} filtered tool history
   */
  getWorkflowHistory(workflowId) {
    if (!this._context || !workflowId) return [];
    return this._context.toolHistory.filter(e => e.workflowId === workflowId);
  }

  /**
   * Get cost/performance summary for a workflow.
   * Computes total tokens (from output length), total time, error rate,
   * and per-tool breakdown from captured tool history.
   * @param {string} workflowId
   * @returns {object|null} { workflowId, totalCalls, totalDurationMs, errorCount, errorRate,
   *   totalOutputChars, toolBreakdown: { name, calls, errors, avgMs, outputChars }[] }
   */
  getWorkflowCost(workflowId) {
    const history = this.getWorkflowHistory(workflowId);
    if (history.length === 0) return null;

    let totalDuration = 0;
    let errorCount = 0;
    let totalOutputChars = 0;
    const byTool = {};

    for (const entry of history) {
      totalDuration += entry.duration || 0;
      if (!entry.ok) errorCount++;
      totalOutputChars += (entry.result || entry.error || '').length;

      const tool = entry.tool;
      if (!byTool[tool]) byTool[tool] = { calls: 0, errors: 0, totalDurationMs: 0, outputChars: 0 };
      byTool[tool].calls++;
      if (!entry.ok) byTool[tool].errors++;
      byTool[tool].totalDurationMs += entry.duration || 0;
      byTool[tool].outputChars += (entry.result || entry.error || '').length;
    }

    const totalCalls = history.length;
    return {
      workflowId,
      totalCalls,
      totalDurationMs: totalDuration,
      avgDurationMs: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      errorCount,
      errorRate: totalCalls > 0 ? Number((errorCount / totalCalls * 100).toFixed(1)) : 0,
      totalOutputChars,
      toolBreakdown: Object.entries(byTool).map(([name, s]) => ({
        name,
        calls: s.calls,
        errors: s.errors,
        avgMs: s.calls > 0 ? Math.round(s.totalDurationMs / s.calls) : 0,
        outputChars: s.outputChars,
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Result capture
  // -----------------------------------------------------------------------

  /**
   * Capture tool call result into context history.
   * @param {string} toolName
   * @param {object} args - original args (before context injection)
   * @param {object} result - { ok, output?, error? }
   * @param {number} durationMs
   * @param {string} [workflowId] - optional workflow association
   */
  capture(toolName, args, result, durationMs, workflowId) {
    if (!this._context) return;

    const entry = {
      tool: toolName,
      args: this._sanitizeArgs(args),
      timestamp: nowISO(),
      duration: durationMs,
      ok: result.ok === true,
    };

    if (workflowId) entry.workflowId = workflowId;

    if (result.ok) {
      const raw = result.output || '';
      // P0: Large result truncation (>50K chars → 2KB preview)
      if (raw.length > MICRO_COMPACT_LARGE_RESULT) {
        entry.result = raw.slice(0, 2000) +
          `\n\n--- [MicroCompact: truncated ${raw.length} chars to 2KB preview] ---`;
        entry._largeTruncated = true;
      } else {
        entry.result = truncate(raw, this._maxResultLength);
      }
    } else {
      entry.error = truncate(result.error || '', this._maxResultLength);
    }

    // FIFO eviction
    this._context.toolHistory.push(entry);
    if (this._context.toolHistory.length > this._maxHistory) {
      this._context.toolHistory = this._context.toolHistory.slice(-this._maxHistory);
    }

    this._context.metadata.toolCount++;
    if (!result.ok) this._context.metadata.errorCount++;
    this._context.metadata.updatedAt = nowISO();

    this._context.lastResult = {
      tool: toolName,
      summary: result.ok
        ? truncate((result.output || '').slice(0, 200), 200)
        : `Error: ${truncate(result.error || '', 200)}`,
      ok: result.ok === true,
    };

    // Extract findings from successful tool output
    if (this._extract && result.ok && result.output) {
      const findings = extractFindings(toolName, result.output);
      for (const f of findings) {
        this._context.accumulatedFindings.push(f);
        if (this._context.accumulatedFindings.length > this._maxFindings) {
          this._context.accumulatedFindings.shift();
        }
      }
    }

    if (this._autoSave) this._save();
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  _save() {
    if (!this._context) return false;
    try {
      ensureDir(this._contextDir);
      writeFileSync(
        resolve(this._contextDir, `${this._context.sessionId}.json`),
        JSON.stringify(this._context, null, 2),
        'utf-8'
      );
      return true;
    } catch (err) {
      console.error(`[context-manager] Save failed: ${err.message}`);
      return false;
    }
  }

  /** Explicit save. */
  save() { return this._save(); }

  /** Load context from disk by sessionId. */
  _loadFromDisk(sessionId) {
    try {
      const fp = resolve(this._contextDir, `${sessionId}.json`);
      if (!existsSync(fp)) return null;
      return JSON.parse(readFileSync(fp, 'utf-8'));
    } catch { return null; }
  }

  /** List persisted session IDs. */
  listSessions() {
    try {
      if (!existsSync(this._contextDir)) return [];
      return readdirSync(this._contextDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch { return []; }
  }

  /** Delete a persisted session. */
  deleteSession(sessionId) {
    try {
      const fp = resolve(this._contextDir, `${sessionId}.json`);
      if (existsSync(fp)) { unlinkSync(fp); return true; }
      return false;
    } catch { return false; }
  }

  /**
   * Merge findings and history from multiple sessions into current context.
   * Duplicate findings (same text) are skipped. Tool history is appended
   * chronologically up to MAX_HISTORY. Metadata counts are aggregated.
   * @param {string[]} sessionIds - Array of session IDs to merge
   * @returns {object} merge result { mergedFindings, mergedCalls, totalToolCount, totalErrorCount }
   */
  mergeSessions(sessionIds) {
    if (!this._context || !sessionIds || sessionIds.length === 0) {
      return { mergedFindings: 0, mergedCalls: 0, totalToolCount: 0, totalErrorCount: 0 };
    }

    let mergedFindings = 0;
    let mergedCalls = 0;
    let totalToolCount = this._context.metadata.toolCount;
    let totalErrorCount = this._context.metadata.errorCount;
    const existingFindings = new Set(
      this._context.accumulatedFindings.map(f => f.finding)
    );

    for (const sid of sessionIds) {
      const loaded = this._loadFromDisk(sid);
      if (!loaded) continue;

      // Merge findings (skip duplicates)
      for (const f of loaded.accumulatedFindings || []) {
        if (!existingFindings.has(f.finding)) {
          this._context.accumulatedFindings.push({
            ...f,
            source: `${f.source}@${sid.slice(0, 8)}`,
          });
          existingFindings.add(f.finding);
          mergedFindings++;
          if (this._context.accumulatedFindings.length > this._maxFindings) {
            this._context.accumulatedFindings.shift();
          }
        }
      }

      // Merge tool history (chronologically, deduplicate by timestamp)
      const history = loaded.toolHistory || [];
      for (const entry of history) {
        entry.sessionSource = sid.slice(0, 8);
        this._context.toolHistory.push(entry);
        mergedCalls++;
        if (entry.ok === false) totalErrorCount++;
        totalToolCount++;
      }

      // Aggregate metadata
      if (loaded.metadata) {
        totalToolCount += loaded.metadata.toolCount || 0;
        totalErrorCount += loaded.metadata.errorCount || 0;
      }
    }

    // Trim history to max
    if (this._context.toolHistory.length > this._maxHistory) {
      this._context.toolHistory = this._context.toolHistory.slice(-this._maxHistory);
    }

    this._context.metadata.toolCount = totalToolCount;
    this._context.metadata.errorCount = totalErrorCount;
    this._context.metadata.updatedAt = nowISO();

    if (this._autoSave) this._save();

    return { mergedFindings, mergedCalls, totalToolCount, totalErrorCount };
  }

  /** List all persisted contexts with metadata (no full history). */
  listSessionsSummary() {
    const sessions = this.listSessions();
    const result = [];
    for (const sid of sessions) {
      try {
        const fp = resolve(this._contextDir, `${sid}.json`);
        const raw = JSON.parse(readFileSync(fp, 'utf-8'));
        result.push({
          sessionId: raw.sessionId,
          projectRoot: raw.projectRoot,
          toolCount: raw.metadata?.toolCount || 0,
          errorCount: raw.metadata?.errorCount || 0,
          createdAt: raw.metadata?.createdAt,
          updatedAt: raw.metadata?.updatedAt,
          lastTool: raw.lastResult?.tool || null,
        });
      } catch { /* skip corrupt */ }
    }
    return result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  _sanitizeArgs(args) {
    if (!args || typeof args !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (k === '_context' || k === '_timeout') continue;
      if (typeof v === 'string' && v.length > 200) out[k] = v.slice(0, 200) + '...';
      else if (typeof v === 'object' && v !== null) out[k] = '[complex]';
      else out[k] = v;
    }
    return out;
  }
}
