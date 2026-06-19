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
import { classifyEntry, summarizeOutput, shouldPrefetchCompact } from '../plugins/core/compact.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_DIR = resolve(homedir(), '.smart', 'context');
const RECOVERY_FILE = resolve(homedir(), '.smart', 'recovery-context.json');
const RECOVERY_TTL_MS = 86400000; // 24h — 超過此期限的 recovery context 視為過期
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
        // Ensure todoItems exists on resumed sessions
        if (!this._context.todoItems) this._context.todoItems = [];
        // 從檔案恢復 recovery context（若前次 session 異常中斷）
        this.restoreRecoveryContext();
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
      todoItems: [],
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
   * Phase 14.1: Clear old tool results from history (含備份)。
   * Removes entries older than `olderThan` turns, with a safety floor of `keepLatest`.
   * 移除前先備份 KEEP 等級的條目到 _compactedBackups（支援 P4 自動回填）。
   * Only operates on toolHistory — system prompt / thinking blocks are not stored here.
   *
   * @param {object} [opts]
   * @param {number} [opts.olderThan=10] - Keep only the last N turns, remove everything older
   * @param {number} [opts.keepLatest=2] - Safety floor: always keep at least this many recent entries
   * @returns {{ removed: number, kept: number, backedUp: number }}
   */
  clearToolResults({ olderThan = 10, keepLatest = 2 } = {}) {
    if (!this._context || !this._context.toolHistory.length) {
      return { removed: 0, kept: 0, backedUp: 0 };
    }

    const history = this._context.toolHistory;
    const total = history.length;

    // Calculate how many entries to keep
    let keepCount = Math.min(olderThan, total);
    keepCount = Math.max(keepCount, Math.min(keepLatest, total));

    const removeCount = total - keepCount;

    if (removeCount <= 0) {
      return { removed: 0, kept: total, backedUp: 0 };
    }

    // 備份被移除的 KEEP 等級條目 (P4 自動回填用)
    const removed = history.slice(0, total - keepCount);
    const keepableRemoved = removed.filter(e => {
      // 保留決策/編輯類 output
      const keepTools = new Set(['smart_fast_apply', 'smart_think', 'smart_deep_think',
        'error_diagnose', 'debug', 'planner', 'edit', 'write', 'cross_file_edit']);
      return keepTools.has(e.tool) || e.result?.length > 500;
    });

    if (keepableRemoved.length > 0) {
      if (!this._context._compactedBackups) this._context._compactedBackups = [];
      for (const entry of keepableRemoved) {
        this._context._compactedBackups.push({
          backedUpAt: nowISO(),
          tool: entry.tool,
          args: entry.args,
          result: (entry.result && entry.result.length > 100) ? entry.result.slice(0, 500) : entry.result,
          ok: entry.ok,
          timestamp: entry.timestamp,
        });
      }
      // 限制備份數量 (最多 20 筆)
      if (this._context._compactedBackups.length > 20) {
        this._context._compactedBackups = this._context._compactedBackups.slice(-20);
      }
    }

    // Remove oldest entries (slice from the front)
    this._context.toolHistory = history.slice(-keepCount);
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();

    return { removed: removeCount, kept: keepCount, backedUp: keepableRemoved.length };
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
   * P2 FullCompact: 深度結構化壓縮 + Context Collapse。
   *
   * 比 microCompact 更積極: 從 findings 產生結構化摘要 recovery context，
   * 然後清除所有舊 tool history 條目，只保留最近 N 筆。
   *
   * 三層 progressive 壓縮 (由 server 端依據 budget 選擇 level):
   *   level=1 (>75%): keep 5, 保留前生成摘要 (微壓縮)
   *   level=2 (>85%): keep 3, 產生結構化 recovery context, 清除舊條目
   *   level=3 (>95%): keep 2, 緊急壓縮, 只留摘要 + 最後 N 筆
   *
   * @param {object} [opts]
   * @param {number} [opts.level=1] - 壓縮等級 1-3
   * @returns {{ level: number, recoveryContext: object|null, cleared: number, kept: number }}
   */
  fullCompact({ level = 1 } = {}) {
    if (!this._context || !this._context.toolHistory.length) {
      return { level, recoveryContext: null, cleared: 0, kept: 0 };
    }

    // 產生 recovery context (結構化摘要)
    const recoveryContext = this.generateRecoveryContext();
    this._context._lastCompact = {
      level,
      timestamp: nowISO(),
      toolCount: this._context.metadata.toolCount,
    };

    // 依據 level 決定保留筆數
    const keepMap = { 1: 5, 2: 3, 3: 2 };
    const keep = keepMap[level] || 5;

    const history = this._context.toolHistory;
    const total = history.length;
    const keepCount = Math.min(keep, total);

    // Level 2/3: 移除舊條目前先備份 (P4 自動回填)
    if (level >= 2) {
      // 備份被移除的條目 (只備份 KEEP 等級的)
      const removed = history.slice(0, total - keepCount);
      const keepableRemoved = removed.filter(e => {
        const cls = e._microCompacted !== 'cleared' ? 'KEEP' : 'DROP';
        return cls === 'KEEP' || e.tool === 'smart_fast_apply' || e.tool === 'smart_think';
      });

      if (!this._context._compactedBackups) this._context._compactedBackups = [];
      for (const entry of keepableRemoved) {
        this._context._compactedBackups.push({
          backedUpAt: nowISO(),
          tool: entry.tool,
          args: entry.args,
          result: (entry.result && entry.result.length > 100) ? entry.result.slice(0, 500) : entry.result,
          ok: entry.ok,
          timestamp: entry.timestamp,
        });
      }
      // 限制備份數量 (最多 20 筆)
      if (this._context._compactedBackups.length > 20) {
        this._context._compactedBackups = this._context._compactedBackups.slice(-20);
      }

      this._context.toolHistory = history.slice(-keepCount);
      const cleared = total - keepCount;
      this._context.metadata.updatedAt = nowISO();
      if (this._autoSave) this._save();
      return { level, recoveryContext, cleared, kept: keepCount, backups: keepableRemoved.length };
    }

    // Level 1: 同 microCompact (保留完整條目結構, 只清結果)
    return {
      level,
      recoveryContext,
      ...this.microCompact({ keep }),
    };
  }

  /**
   * P4: 列出所有 compacted 備份條目摘要。
   * @returns {Array<{index: number, tool: string, ok: boolean, timestamp: string, preview: string}>}
   */
  listCompactedBackups() {
    const backups = this._context?._compactedBackups || [];
    return backups.map((b, i) => ({
      index: i,
      tool: b.tool,
      ok: b.ok,
      timestamp: b.timestamp,
      preview: b.result ? (b.result.slice(0, 120) + (b.result.length > 120 ? '...' : '')) : '(no result)',
    }));
  }

  /**
   * P4: 從 compacted 備份中讀取特定條目。
   * @param {number|string} index - 備份索引或 'last'/'first'
   * @returns {object|null} 備份條目 (含 tool, args, result, timestamp)
   */
  readCompactedEntry(index) {
    const backups = this._context?._compactedBackups || [];
    if (backups.length === 0) return null;

    if (index === 'last') return backups[backups.length - 1];
    if (index === 'first') return backups[0];
    if (typeof index === 'number' && index >= 0 && index < backups.length) return backups[index];
    return null;
  }

  /**
   * P4: 將特定 compacted 備份條目恢復到 toolHistory 末尾。
   * 方便 LLM 在需要時取回被壓縮的舊結果。
   * @param {number|string} index - 備份索引
   * @returns {{ ok: boolean, entry: object|null }}
   */
  restoreCompactedEntry(index) {
    if (!this._context) return { ok: false, entry: null };
    const entry = this.readCompactedEntry(index);
    if (!entry) return { ok: false, entry: null };

    // 重建條目並附加到 history 末尾
    const restored = {
      tool: entry.tool,
      args: entry.args || {},
      result: entry.result || '[restored from compacted backup]',
      ok: entry.ok,
      timestamp: nowISO(),
      _restored: true,
      _originalTimestamp: entry.timestamp,
    };

    this._context.toolHistory.push(restored);
    if (this._context.toolHistory.length > this._maxHistory) {
      this._context.toolHistory = this._context.toolHistory.slice(-this._maxHistory);
    }
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();

    return { ok: true, entry: restored };
  }

  /**
   * 從 accumulatedFindings + toolHistory 產生結構化 recovery context。
   * 供 fullCompact 使用 — 摘要關鍵決策、錯誤、工具呼叫模式。
   * @returns {object} { summary, findings, recentTools, keyDecisions }
   */
  _generateRecoveryContext() {
    if (!this._context) return null;

    const findings = this._context.accumulatedFindings || [];
    const history = this._context.toolHistory || [];

    // 摘要: 工具呼叫統計
    const totalCalls = this._context.metadata.toolCount || 0;
    const errorCount = this._context.metadata.errorCount || 0;
    const uniqueTools = new Set(history.map(e => e.tool)).size;

    // 關鍵決策: 從 fast_apply 條目中擷取
    const keyDecisions = history
      .filter(e => e.tool && (e.tool.includes('fast_apply') || e.tool.includes('apply')))
      .slice(-5)
      .map(e => {
        const args = e.args || {};
        return {
          tool: e.tool,
          file: args.file || args.files?.[0] || '?',
          ok: e.ok,
          timestamp: e.timestamp,
        };
      });

    // 高優先級 findings
    const highFindings = findings
      .filter(f => f.severity === 'critical' || f.severity === 'high')
      .slice(-10)
      .map(f => ({
        source: f.source,
        finding: f.finding,
        category: f.category,
        severity: f.severity,
      }));

    // 最近工具呼叫 (最多 5筆)
    const recentTools = history.slice(-5).map(e => ({
      tool: e.tool,
      ok: e.ok,
      duration: e.duration,
      timestamp: e.timestamp,
    }));

    // 最近錯誤 (最多 2 筆，含原始錯誤訊息)
    const lastErrors = history
      .filter(e => !e.ok && e.error && e.error.length > 10)
      .slice(-2)
      .map(e => ({
        tool: e.tool,
        error: e.error.length > 500 ? e.error.slice(0, 500) + '... [truncated]' : e.error,
        duration: e.duration,
        timestamp: e.timestamp,
      }));

    return {
      summary: { totalCalls, errorCount, uniqueTools },
      findings: highFindings,
      keyDecisions,
      recentTools,
      lastErrors,
      todoItems: this.listTodos(),
      compactedAt: nowISO(),
    };
  }

  /**
   * 產生並儲存結構化 recovery context（公開版本）。
   * 呼叫 _generateRecoveryContext() 並存入 _context._recoveryContext，
   * 供 autoManageContext / formatRecoveryContext / fullCompact 等使用。
   * @returns {object|null} { summary, findings, recentTools, keyDecisions }
   */
  generateRecoveryContext() {
    const rc = this._generateRecoveryContext();
    if (this._context) {
      this._context._recoveryContext = rc;
      this._context._lastCompact = {
        level: 0,
        timestamp: nowISO(),
        toolCount: this._context.metadata.toolCount,
      };
      // 自動持久化 — 確保跨 session 可恢復
      this._persistRecoveryContext();
    }
    return rc;
  }

  /**
   * 將 recovery context 寫入 ~/.smart/recovery-context.json。
   * 確保 server restart 或 session 切換後仍可恢復。
   * 由 generateRecoveryContext 自動呼叫，也可手動觸發。
   * @returns {boolean}
   */
  _persistRecoveryContext() {
    const rc = this._context?._recoveryContext;
    if (!rc) return false;
    try {
      ensureDir(resolve(homedir(), '.smart'));
      writeFileSync(RECOVERY_FILE, JSON.stringify(rc, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error(`[context-manager] Recovery persist failed: ${err.message}`);
      return false;
    }
  }

  /**
   * 從 ~/.smart/recovery-context.json 恢復 recovery context。
   * 僅恢復 24 小時內的 context（避免過期資料干擾）。
   * 在 init() 時自動呼叫。
   * @returns {object|null}
   */
  restoreRecoveryContext() {
    try {
      if (!existsSync(RECOVERY_FILE)) return null;
      const raw = readFileSync(RECOVERY_FILE, 'utf-8');
      const rc = JSON.parse(raw);
      // 過期檢查：超過 24 小時的 recovery context 視為無效
      if (rc.compactedAt) {
        const age = Date.now() - new Date(rc.compactedAt).getTime();
        if (age > RECOVERY_TTL_MS) {
          // 過期 → 清除檔案
          try { unlinkSync(RECOVERY_FILE); } catch {}
          return null;
        }
      }
      if (this._context) {
        this._context._recoveryContext = rc;
      }
      return rc;
    } catch {
      // 檔案損毀 → 清除
      try { unlinkSync(RECOVERY_FILE); } catch {}
      return null;
    }
  }

  /**
   * 取得 recovery context (若 generateRecoveryContext / fullCompact 曾執行過)。
   * 用於 session resume 或 context 重建。
   * @returns {object|null}
   */
  getRecoveryContext() {
    return this._context?._recoveryContext || null;
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
  // Todo management
  // -----------------------------------------------------------------------

  /**
   * Add one or more todo items.
   * @param {string|string[]} items - Item text or array of texts
   * @returns {{ added: number, items: Array }}
   */
  addTodo(items) {
    if (!this._context) return { added: 0, items: [] };
    if (!Array.isArray(items)) items = [String(items)];
    const added = [];
    for (const text of items) {
      if (!text || typeof text !== 'string') continue;
      const id = this._context.todoItems.length + 1;
      this._context.todoItems.push({
        id,
        text: text.slice(0, 200),
        status: 'pending',
        createdAt: nowISO(),
      });
      added.push({ id, text: text.slice(0, 200), status: 'pending' });
    }
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();
    return { added: added.length, items: added };
  }

  /**
   * Mark a todo item as completed.
   * @param {number} id - Todo item id
   * @returns {{ ok: boolean, item: object|null }}
   */
  doneTodo(id) {
    return this.updateTodoStatus(id, 'completed');
  }

  /**
   * Update todo item status.
   * @param {number} id - Todo item id
   * @param {string} status - 'pending' | 'in_progress' | 'completed' | 'cancelled'
   * @returns {{ ok: boolean, item: object|null }}
   */
  updateTodoStatus(id, status) {
    if (!this._context || !this._context.todoItems) return { ok: false, item: null };
    const item = this._context.todoItems.find(t => t.id === id);
    if (!item) return { ok: false, item: null };
    item.status = status;
    item.updatedAt = nowISO();
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();
    return { ok: true, item };
  }

  /**
   * List all todo items.
   * @returns {Array}
   */
  listTodos() {
    if (!this._context || !this._context.todoItems) return [];
    return this._context.todoItems.map(t => ({ ...t }));
  }

  /**
   * Auto-detect if a tool call completed a todo item.
   * Rules-based matching: tool name + file args + output heuristics.
   * Zero LLM cost.
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   * @returns {{ matched: boolean, todoId: number|null, todoText: string|null }}
   */
  matchTodo(toolName, args, result) {
    if (!this._context || !this._context.todoItems) return { matched: false, todoId: null, todoText: null };
    const pending = this._context.todoItems.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (pending.length === 0) return { matched: false, todoId: null, todoText: null };

    const output = (result.output || result.error || '').toLowerCase();
    const fileRef = ((args.file || args.files?.[0] || '') + ' ' + (args.symbol || '')).toLowerCase();
    const toolSig = toolName.replace('smart_', '');
    const fileExt = fileRef.match(/\.(\w+)$/)?.[1] || '';

    for (const todo of pending) {
      const todoText = todo.text.toLowerCase();
      let score = 0;
      let reasons = [];

      // === 規則 1: 工具名比對 ===
      if (todoText.includes(toolSig)) { score += 2; reasons.push('toolName'); }

      // === 規則 2: 檔案路徑比對 ===
      if (fileRef && todoText.includes(fileRef)) { score += 3; reasons.push('fileRef'); }
      // 2b: todo 包含檔案副檔名（如 ".ts"）且 fileRef 也包含
      if (fileExt && todoText.includes('.' + fileExt) && fileRef.includes('.' + fileExt)) { score += 1; reasons.push('extMatch'); }

      // === 規則 3: fast_apply 成功 + 輸出含完成關鍵字 ===
      // 不給無條件 applyOk 分數 — 只有 output 明確確認才計分 (避免任何 edit 都 match)
      if (toolSig.includes('fast_apply') && result.ok) {
        if (output.includes('applied') || output.includes('✅') || output.includes('success')) { score += 1; reasons.push('applyDone'); }
        // 若也有檔案路徑比對，額外加分 (同一檔案的編輯高度相關)
        if (fileRef && todoText.includes(fileRef)) { score += 2; reasons.push('applyFile'); }
      }

      // === 規則 4: test 成功 ===
      if (toolSig.includes('test') && result.ok) {
        if (output.includes('pass')) {
          // 檢查 test include pattern 是否與 todo 相關
          const testPattern = ((args.include || '') + ' ' + (args.file || '')).toLowerCase();
          const hasFileContext = testPattern && todoText.includes(testPattern);
          score += hasFileContext ? 3 : 1; reasons.push(hasFileContext ? 'testFilePass' : 'testPass');
        }
        if (output.includes('all pass') || output.includes('100%')) { score += 2; reasons.push('testAllPass'); }
      }

      // === 規則 5: 動作動詞比對 ===
      // todo 以 fix/add/refactor/implement/update/remove 開頭 → 比對工具行為
      const actionVerbs = ['fix', 'add', 'refactor', 'implement', 'update', 'remove', 'delete', 'create', 'setup'];
      for (const v of actionVerbs) {
        if (todoText.startsWith(v) && (toolSig.includes(v) || toolSig.includes('fast_apply'))) {
          score += 2; reasons.push('action:' + v); break;
        }
      }

      // === 規則 6: 輸出含 todo 關鍵字 ===
      // 當輸出中明確提到 todo 的獨特子字串（>4 chars）時
      const todoKeywords = todoText.split(/\s+/).filter(w => w.length > 4);
      for (const kw of todoKeywords) {
        if (output.includes(kw)) { score += 2; reasons.push('keyword:' + kw); break; }
      }

      // === 規則 7: 子任務層級比對 ===
      // 若 todo 包含 "→" 或 "- " 表示有子任務，比對正在處理的子項目
      if (todoText.includes('→') || todoText.includes('\n') || todoText.includes(' - ')) {
        const subTasks = todoText.split(/→|\n| - /).map(s => s.trim()).filter(s => s.length > 3);
        for (const st of subTasks) {
          const stLower = st.toLowerCase();
          if (fileRef && stLower.includes(fileRef)) { score += 3; reasons.push('subtask:' + stLower.slice(0, 20)); break; }
          if (toolSig && stLower.includes(toolSig)) { score += 2; reasons.push('subtaskTool:' + stLower.slice(0, 20)); break; }
        }
      }

      // === 規則 8: LSP 診斷成功後比對錯誤修復 ===
      if (toolSig.includes('lsp') && result.ok) {
        const argFile = (args.file || '').toLowerCase();
        if (argFile && todoText.includes(argFile)) { score += 3; reasons.push('lspFile'); }
        if (output.includes('no diagnostic') || output.includes('0 error')) { score += 2; reasons.push('lspClean'); }
      }

      // === 檔案層級證據偵測（helper） ===
      const hasFileEvidence = () => {
        const r = reasons.join(' ');
        return r.includes('fileRef') || r.includes('applyFile') ||
               r.includes('testFilePass') || r.includes('lspFile') ||
               r.includes('subtask:');
      };

      // === High confidence match ===
      // threshold 4: 至少兩個獨立證據
      // 或 score >= 3 且有檔案層級證據（編輯同一檔案、測試含檔名等高度可信情境）
      if (score >= 4 || (score >= 3 && hasFileEvidence())) {
        return { matched: true, todoId: todo.id, todoText: todo.text, score, reasons: reasons.join(',') };
      }

      // === Borderline: score >= 3 但無檔案證據 → 回傳資訊供 LLM fallback ===
      if (score >= 3) {
        return { matched: false, borderline: true, todoId: todo.id, todoText: todo.text, score, reasons: reasons.join(',') };
      }
    }

    // === No match: score < 3 ===
    return { matched: false, todoId: null, todoText: null, borderline: false };
  }

  /**
   * Format recovery context as injectable text for the LLM.
   * Called after fullCompact to remind the LLM what to continue.
   * Includes: tool summary, pending todos, recent edits.
   * @returns {string|null} Formatted text, or null if nothing to inject
   */
  _syncTodosFromFile() {
    // Sync todo items from shared file (~/.smart/todos.json)
    // so the smart_todo plugin and contextManager stay in sync.
    try {
      const dataFile = resolve(homedir(), '.smart', 'todos.json');
      if (existsSync(dataFile)) {
        const raw = readFileSync(dataFile, 'utf-8');
        this._context.todoItems = JSON.parse(raw);
      }
    } catch { /* file may not exist, ignore */ }
  }

  formatRecoveryContext() {
    const rc = this.getRecoveryContext();
    if (!rc) return null;

    // Sync with shared file so smart_todo plugin changes are visible
    this._syncTodosFromFile();

    const parts = [];
    parts.push('📋 [Recovery Context]');

    // Summary
    const s = rc.summary || {};
    parts.push(`   ${s.totalCalls || 0} calls, ${s.errorCount || 0} errors, ${s.uniqueTools || 0} tools`);

    // Pending todos
    const todos = this.listTodos();
    const activeTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const doneTodos = todos.filter(t => t.status === 'completed');
    if (todos.length > 0) {
      parts.push('   📝 Todos:');
      for (const t of todos) {
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '⏳' : t.status === 'cancelled' ? '❌' : '☐';
        parts.push(`      ${icon} ${t.id}. ${t.text}`);
      }
    }

    // Recent edits
    const edits = rc.keyDecisions || [];
    if (edits.length > 0) {
      const files = [...new Set(edits.map(e => e.file))];
      parts.push(`   📂 Edited: ${files.join(', ')}`);
    }

    // Active findings
    const findings = rc.findings || [];
    if (findings.length > 0) {
      parts.push(`   🔍 Issues: ${findings.map(f => f.severity + ':' + f.category).join(', ')}`);
    }

    // Last errors — 原始錯誤訊息（非 pattern 摘要）
    const lastErrors = rc.lastErrors || [];
    if (lastErrors.length > 0) {
      parts.push('   ❌ Recent errors:');
      for (const e of lastErrors) {
        const errPreview = e.error.length > 120 ? e.error.slice(0, 120) + '...' : e.error;
        parts.push(`      [${e.tool}] ${errPreview}`);
      }
    }

    // Resume directive — 列出所有 active todos，不只第一個
    if (activeTodos.length > 0) {
      const continueItems = activeTodos.map((t, i) =>
        `     ${i + 1}. todo #${t.id} — "${t.text}"`
      );
      parts.push(`   ▶️ Continue (${activeTodos.length} pending):`);
      parts.push(...continueItems);
    }

    return parts.join('\n');
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

    // P5: Prefetch Compact — 低價值條目在 capture 當下就預壓縮
    // 不讓它進 context (value 0 → drop, value 1 → preview)
    if (this._prefetchCompact !== false) {
      const verdict = shouldPrefetchCompact(entry);
      if (verdict.compress) {
        if (verdict.action === 'drop') {
          entry.result = '[Prefetch: low-value result compacted]';
          entry.error = undefined;
          entry._prefetchCompacted = 'dropped';
        } else if (verdict.action === 'preview') {
          const full = entry.result || '';
          entry.result = full.length > 200
            ? full.slice(0, 200) + `\n\n--- [Prefetch: preview — ${full.length} chars total] ---`
            : full;
          entry._prefetchCompacted = 'preview';
        }
      }
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
