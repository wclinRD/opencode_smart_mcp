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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_DIR = resolve(homedir(), '.smart', 'context');
const MAX_HISTORY = 50;
const MAX_FINDINGS = 100;
const MAX_RESULT_LENGTH = 2000;

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

  /** Get a read-only clone of current context. */
  get() {
    return this._context ? JSON.parse(JSON.stringify(this._context)) : null;
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

  /** Get env vars for CLI tool context injection. */
  getEnv() {
    if (!this._context) return {};
    return {
      SMART_SESSION_ID: this._context.sessionId,
      SMART_TOOL_COUNT: String(this._context.metadata.toolCount),
      SMART_CONTEXT: this.getSummary(),
    };
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
      entry.result = truncate(result.output || '', this._maxResultLength);
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
