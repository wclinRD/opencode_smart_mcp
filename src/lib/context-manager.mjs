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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { env } from 'node:process';
import { classifyEntry, summarizeOutput, shouldPrefetchCompact } from '../plugins/core/compact.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_DIR = resolve(homedir(), '.smart', 'context');
// RECOVERY_FILE removed — session isolation via _getRecoveryFilePath()
const RECOVERY_TTL_MS = 1800000; // 30min — Gap #6 fix: 從 24h→4h→30min，避免跨 session context 干擾
const SUBTASK_PROGRESS_FILE = resolve(homedir(), '.smart', 'subtask-progress.json');
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
  // 🆕 擴充模式 — test/assert/validation
  { pattern: /\d+\s*tests?\s*failing?/i, category: 'test', severity: 'high' },
  { pattern: /(?:assertionerror|AssertionError)/i, category: 'error', severity: 'high' },
  { pattern: /(?:Cannot find module|ERR_PACKAGE_PATH)/i, category: 'dependency', severity: 'high' },
  { pattern: /(?:TS\d+|error\s+TS)/i, category: 'error', severity: 'high' },
  { pattern: /(?:invalid|unexpected token|unexpected identifier)/i, category: 'error', severity: 'medium' },
  { pattern: /(?:not a function|is not defined|is not a constructor)/i, category: 'error', severity: 'high' },
  { pattern: /(?:schema|validation)\s+(?:error|fail)/i, category: 'error', severity: 'medium' },
  { pattern: /(?:pending|blocked)\s*(?:task|item|step)?/i, category: 'task', severity: 'low' },
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
    /** @type {string} Shared todo file path (default: ~/.smart/todos.json for bridge with smart_todo plugin) */
    this._todoFile = opts.todoFile || resolve(homedir(), '.smart', 'todos.json');

    /** @type {object|null} */
    this._context = null;
  }

  /** @returns {string|null} Current session ID, or null if no active session */
  getSessionId() {
    return this._context?.sessionId || null;
  }

  /** @returns {string} Per-session recovery context JSON file path */
  _getRecoveryFilePath() {
    const sid = this._context?.sessionId || 'unknown';
    return resolve(homedir(), '.smart', `recovery-context.${sid}.json`);
  }

  /** @returns {string} Per-session recent recovery text file path */
  _getRecentRecoveryFilePath() {
    const sid = this._context?.sessionId || 'unknown';
    return resolve(homedir(), '.smart', `recent-recovery.${sid}.txt`);
  }

  /** @returns {string} Per-session compaction status file path */
  _getCompactionStatusFilePath() {
    const sid = this._context?.sessionId || 'unknown';
    return resolve(homedir(), '.smart', `compaction-status.${sid}.json`);
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
    // 啟動時清理過期 session 殘留檔案（>30min 的孤兒）
    ContextManager._cleanupStaleSessionFiles();

    // Resume existing session
    if (opts.sessionId) {
      const loaded = this._loadFromDisk(opts.sessionId);
      if (loaded) {
        this._context = loaded;
        this._context.metadata.updatedAt = nowISO();
        if (opts.projectRoot) this._context.projectRoot = opts.projectRoot;
        // Ensure todoItems exists on resumed sessions
        if (!this._context.todoItems) this._context.todoItems = [];
        if (!this._context.goalState) this._context.goalState = null;
        // Gap #1/#4 fix: 從共享檔案同步 todo 狀態（file 為 ground truth）
        this._syncTodosFromFile();
        // 從共享檔案同步 active goal（跨 session）
        this._syncGoalFromFile();
        // 從檔案恢復 recovery context（若前次 session 異常中斷）
        this.restoreRecoveryContext();
        // 從共享檔案恢復 subtask progress（跨 session）
        this._restoreSubtaskProgress();
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
      activityLog: [],
      todoItems: [],
      goalState: null,
      lastResult: null,
      metadata: {
        createdAt: nowISO(),
        updatedAt: nowISO(),
        toolCount: 0,
        errorCount: 0,
      },
    };

    this._save();
    // 僅 session resume 時才恢復（line 142），避免跨 session 待辦污染
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
    // 清除 session 專屬檔案（recovery context + recent-recovery + compaction-status）
    this._cleanupSessionFiles();
    return true;
  }

  /** 清除目前 session 的所有專屬檔案（session 結束時呼叫） */
  _cleanupSessionFiles() {
    const files = [
      this._getRecoveryFilePath(),
      this._getRecentRecoveryFilePath(),
      this._getCompactionStatusFilePath(),
    ];
    for (const f of files) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }

  /** 清理過期的孤兒 session 檔案（啟動時呼叫，清除 >30min 的殘留） */
  static _cleanupStaleSessionFiles() {
    try {
      const dir = resolve(homedir(), '.smart');
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter(f =>
        /^recovery-context\..+\.json$/.test(f) ||
        /^recent-recovery\..+\.txt$/.test(f) ||
        /^compaction-status\..+\.json$/.test(f)
      );
      const now = Date.now();
      const TTL = 1800000; // 30min
      for (const f of files) {
        try {
          const fp = resolve(dir, f);
          const stat = statSync(fp);
          if (now - stat.mtimeMs > TTL) {
            unlinkSync(fp);
          }
        } catch {}
      }
    } catch {}
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
    this._context.activityLog = [];
    this._context.lastResult = null;
    this._context.metadata.sessionNote = null;
    this._context.metadata.toolCount = 0;
    this._context.metadata.errorCount = 0;
    delete this._context._autoCompactSummary;
    delete this._context._recoveryContext;
    delete this._context._compactedBackups;
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

    // Phase: Auto-summary — 在清除條目前產生文字摘要
    // 只對 L2/L3（實際移除 entries）產生，L1 不清 entries 不需摘要
    if (level >= 2) {
      const removed = total > keepCount ? history.slice(0, total - keepCount) : [];
      const summaryText = this._generateCompactSummary(removed, level);
      if (summaryText) {
        this._context._autoCompactSummary = summaryText;
        this.addActivityEntry(`📦 ${summaryText}`, 'general');
      }
    }

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

    // Session note (LLM 自主寫入的工作摘要)
    const sessionNote = this._context.metadata?.sessionNote || null;

    // 關鍵決策: 從編輯工具條目中擷取 (fast_apply + sub-tools via smart_run)
    const EDIT_TOOLS = ['fast_apply', 'apply', 'smart_run', 'cross_file_edit', 'rename_safety'];
    const keyDecisions = history
      .filter(e => e.tool && EDIT_TOOLS.some(t => e.tool.includes(t)))
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
      sessionNote,
      activityLog: this._context.activityLog || [],
      autoCompactSummary: this._context._autoCompactSummary || null,
      findings: highFindings,
      keyDecisions,
      recentTools,
      lastErrors,
      todoItems: this.listTodos(),
      goalState: this.getActiveGoalSummary(),
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
      writeFileSync(this._getRecoveryFilePath(), JSON.stringify(rc, null, 2), 'utf-8');
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
      const recFile = this._getRecoveryFilePath();
      if (!existsSync(recFile)) return null;
      const raw = readFileSync(recFile, 'utf-8');
      const rc = JSON.parse(raw);
      // 過期檢查：超過 TTL 的 recovery context 視為無效
      if (rc.compactedAt) {
        const age = Date.now() - new Date(rc.compactedAt).getTime();
        if (age > RECOVERY_TTL_MS) {
          // 過期 → 清除檔案
          try { unlinkSync(recFile); } catch {}
          return null;
        }
      }
      // Session ID 嚴格隔離：recovery context sessionId 必須完全吻合
      // 不同 session 的 recovery context 視為不存在，不繼承任何資料
      if (this._context && this._context.sessionId) {
        const ctxSessionId = this._context.sessionId;
        if (rc.sessionId && rc.sessionId !== ctxSessionId) {
          // 不同 session → 完全丟棄（不保留任何欄位）
          return null;
        }
      }
      if (this._context) {
        this._context._recoveryContext = rc;
      }
      return rc;
    } catch {
      // 檔案損毀 → 清除
      try { unlinkSync(this._getRecoveryFilePath()); } catch {}
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
    // 跨次去重：累積已有文字的 normalised set
    const existing = new Set(
      (this._context.accumulatedFindings || [])
        .map(f => (f.finding || '').toLowerCase().trim().slice(0, 80))
        .filter(Boolean)
    );
    for (const f of findings) {
      if (!f || !f.finding) continue;
      const norm = f.finding.toLowerCase().trim().slice(0, 80);
      if (existing.has(norm)) continue; // 跨次去重
      existing.add(norm);
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
    // Gap #1 fix: 加入前先從 file 同步，確保 id 正確
    this._syncTodosFromFile();
    const added = [];
    for (const text of items) {
      if (!text || typeof text !== 'string') continue;
      const existingIds = this._context.todoItems.map(t => t.id);
      const id = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
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
    this._syncTodosToFile();
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
    // updateTodoStatus 不主動 sync（caller 確保 write 路徑已同步）
    const item = this._context.todoItems.find(t => t.id === id);
    if (!item) return { ok: false, item: null };
    item.status = status;
    item.updatedAt = nowISO();
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();
    this._syncTodosToFile();
    // 完成/取消時清空 subtask progress
    if (status === 'completed' || status === 'cancelled') {
      this._clearSubtaskProgress(id);
    }
    return { ok: true, item };
  }

  /**
   * List all todo items.
   * @returns {Array}
   */
  listTodos() {
    if (!this._context || !this._context.todoItems) return [];
    // listTodos 是純讀取，不主動 sync（caller 應確保 write 時已同步）
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
    // matchTodo 不主動 sync（caller 確保 write 路徑已同步）
    const pending = this._context.todoItems.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (pending.length === 0) return { matched: false, todoId: null, todoText: null };

    const output = (result.output || result.error || '').toLowerCase();
    const fileRef = ((args.file || args.files?.[0] || '') + ' ' + (args.symbol || '')).toLowerCase().trim();
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

      // === 規則 7: 子任務層級比對 + 進度追蹤 ===
      // 若 todo 包含 "→" / "\n" / " - " 表示有子任務，只匹配單一子項不應 complete 整個 todo
      let matchedSubTask = null;
      if (todoText.includes('→') || todoText.includes('\n') || todoText.includes(' - ')) {
        const subTasks = todoText.split(/→|\n| - /).map(s => s.trim()).filter(s => s.length > 3);
        for (const st of subTasks) {
          const stLower = st.toLowerCase();
          if (fileRef && stLower.includes(fileRef)) { score += 3; reasons.push('subtask:' + stLower.slice(0, 20)); matchedSubTask = stLower; break; }
          if (toolSig && stLower.includes(toolSig)) { score += 2; reasons.push('subtaskTool:' + stLower.slice(0, 20)); matchedSubTask = stLower; break; }
        }
      }

      // === 規則 8: LSP 診斷成功後比對錯誤修復 ===
      if (toolSig.includes('lsp') && result.ok) {
        const argFile = (args.file || '').toLowerCase();
        if (argFile && todoText.includes(argFile)) { score += 3; reasons.push('lspFile'); }
        if (output.includes('no diagnostic') || output.includes('0 error')) { score += 2; reasons.push('lspClean'); }
      }

      // === 規則 9a: smart_smart_run sub-tool 名稱比對 ===
      // smart_run 的 args.tool 包含子工具名 (如 cross_file_edit)，比對 todo 是否提及
      if (toolSig === 'smart_run' || toolSig === 'run') {
        const subToolName = (args.tool || '').toLowerCase();
        if (subToolName && todoText.includes(subToolName)) {
          score += 2; reasons.push('subTool:' + subToolName);
        }
        // 若子工具的 args 含 fileRef，也加分
        const subFileRef = ((args.args?.file || args.args?.files?.[0] || '') + ' ' + (args.args?.symbol || '')).toLowerCase().trim();
        if (subFileRef && todoText.includes(subFileRef)) { score += 2; reasons.push('subToolFile'); }
      }

      // === 規則 9b: bash 指令關鍵字比對 ===
      // bash 的 command/description 若與 todo 關鍵字重疊，表示正在執行相關操作
      if (toolSig === 'bash') {
        const bashText = ((args.command || '') + ' ' + (args.description || '')).toLowerCase();
        const todoKeywords = todoText.split(/\s+/).filter(w => w.length > 4);
        for (const kw of todoKeywords) {
          if (bashText.includes(kw)) { score += 1; reasons.push('bashCmd:' + kw); break; }
        }
        // 若 bash 輸出的結果包含成功關鍵字 + todo 關鍵字，加分
        if (result.ok && output) {
          if ((output.includes('done') || output.includes('success') || output.includes('complete'))) {
            for (const kw of todoKeywords) {
              if (output.includes(kw)) { score += 2; reasons.push('bashDone:' + kw); break; }
            }
          }
        }
      }

      // === 規則 10: smart_grep 模式比對（Gap 7 fix） ===
      // grep 搜尋模式若與 todo 關鍵字重疊，表示 LLM 正在調查該議題
      if (toolSig.includes('grep') && args.pattern) {
        const grepPattern = args.pattern.toLowerCase();
        const todoKeywords = todoText.split(/\s+/).filter(w => w.length > 4);
        for (const kw of todoKeywords) {
          if (grepPattern.includes(kw)) {
            score += 1; reasons.push('grepPattern:' + kw); break;
          }
        }
        // 若 grep 的 fileTypes 或 include 與 todo 相關，加分
        if (args.fileTypes && todoText.includes(args.fileTypes)) { score += 1; reasons.push('grepExt'); }
        if (args.include && todoText.includes(args.include.replace(/\*/g, ''))) { score += 1; reasons.push('grepPath'); }
      }

      // === 規則 10: smart_context / smart_think 使用（Gap 7 fix） ===
      // 使用上下文/思考工具本身不完成 todo，但表示 LLM 在該任務上積極工作
      if (toolSig.includes('context') || toolSig.includes('think') || toolSig.includes('deep_think')) {
        const argText = JSON.stringify(args).toLowerCase();
        const todoKeywords = todoText.split(/\s+/).filter(w => w.length > 4);
        for (const kw of todoKeywords) {
          if (argText.includes(kw)) { score += 1; reasons.push('thinkTopic:' + kw); break; }
        }
      }

      // === 檔案層級證據偵測（helper） ===
      const hasFileEvidence = () => {
        const r = reasons.join(' ');
        return r.includes('fileRef') || r.includes('applyFile') ||
               r.includes('testFilePass') || r.includes('lspFile') ||
               r.includes('subtask:');
      };

      // 計算獨立證據數量（去重，避免 keyword:* 多個相同來源 inflate score）
      const uniqueReasonTypes = new Set(reasons.map(r => r.split(':')[0]));
      const uniqueScore = uniqueReasonTypes.size * 2; // 每個獨立證據來源至少 2 分

      // === Sub-task progress tracking ===
      // 若 match 來自 sub-task 且 todo 有子項，追蹤進度但不 auto-complete
      if (matchedSubTask && todo.text.includes('→')) {
        if (!this._context._subtaskProgress) this._context._subtaskProgress = {};
        if (!this._context._subtaskProgress[todo.id]) {
          // 從 todo 文字解析所有子任務
          const allSubTasks = todo.text.split(/→|\n/).map(s => s.trim()).filter(s => s.length > 3);
          this._context._subtaskProgress[todo.id] = {
            total: allSubTasks.length,
            done: {},
            allSubTaskNames: allSubTasks.map(s => s.toLowerCase()),
          };
        }
        this._context._subtaskProgress[todo.id].done[matchedSubTask] = true;
        this._context._subtaskProgress[todo.id].updatedAt = nowISO();
        // 同步寫入共享檔案，跨 session 可恢復
        this._persistSubtaskProgress();

        // 檢查是否所有子任務都已完成
        const progress = this._context._subtaskProgress[todo.id];
        const allDone = progress.allSubTaskNames.every(st => progress.done[st] === true);
        if (!allDone) {
          const doneCount = Object.keys(progress.done).length;
          // 回傳 subtaskOnly 而非 matched:true，讓 caller 不要 auto-complete
          return { matched: false, subTaskOnly: true, todoId: todo.id, todoText: todo.text,
            subTaskProgress: `${doneCount}/${progress.total}`, score, reasons: reasons.join(',') };
        }
        // 所有子任務完成 → 可以 auto-complete
      }

      // === High confidence match (提高至 score >= 5，或 >= 4 且有檔案證據) ===
      if (uniqueScore >= 4 || score >= 5 || (score >= 4 && hasFileEvidence()) || (score >= 3 && hasFileEvidence() && uniqueScore >= 3)) {
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
    // 雙向同步 strategy：file 為 ground truth（smart_todo plugin 直接寫檔），
    // in-memory 若有落後的狀態則更新。
    // 只同步目前 session 的項目（依 sessionId 過濾），避免跨 session 污染。
    // ⚠️ 自動過期：>24h 的 pending 且無 active 狀態的孤兒待辦自動取消
    try {
      const dataFile = this._todoFile;
      if (!existsSync(dataFile)) return;
      const raw = readFileSync(dataFile, 'utf-8');
      const fileItems = JSON.parse(raw);
      if (!Array.isArray(fileItems)) return;

      const currentSessionId = this._context?.sessionId;
      if (!currentSessionId) {
        // 無 session → 清空 memory（不繼承任何項目）
        this._context.todoItems = [];
        return;
      }

      // 只處理目前 session 的項目
      const sessionItems = fileItems.filter(t => t.sessionId === currentSessionId);

      // Auto-expire: cancel pending items >24h old (orphans from old sessions)
      const now = Date.now();
      let hasExpired = false;
      for (const item of sessionItems) {
        if (item.status === 'pending') {
          const created = new Date(item.createdAt).getTime();
          if (now - created > 86400000) { // 24h
            // Only expire if there's no newer active item in the same batch
            const hasActivity = sessionItems.some(t =>
              t.status === 'in_progress' ||
              (t.status === 'completed' &&
               new Date(t.updatedAt || t.createdAt).getTime() > now - 3600000)
            );
            if (!hasActivity) {
              item.status = 'cancelled';
              item.updatedAt = new Date().toISOString();
              hasExpired = true;
            }
          }
        }
      }

      // 有過期項目 → 合併寫回檔案（保留其他 session 資料）
      if (hasExpired) {
        // 在原始 fileItems 中更新過期項目
        const sessionIdMap = new Map(sessionItems.map(t => [t.id, t]));
        const merged = fileItems.map(fi =>
          fi.sessionId === currentSessionId && sessionIdMap.has(fi.id)
            ? sessionIdMap.get(fi.id)
            : fi
        );
        writeFileSync(dataFile, JSON.stringify(merged, null, 2), 'utf-8');
      }

      // 雙向同步：file 的 status 優先（smart_todo plugin 直接寫檔）
      const memItems = this._context.todoItems || [];
      const fileMap = new Map(sessionItems.map(t => [t.id, t]));
      for (let i = 0; i < memItems.length; i++) {
        const fi = fileMap.get(memItems[i].id);
        if (fi && fi.status !== memItems[i].status) {
          memItems[i].status = fi.status;
          memItems[i].updatedAt = fi.updatedAt || fi.createdAt;
        }
      }

      // 補入 file 中有但 in-memory 沒有的項目（只限目前 session）
      const memIds = new Set(memItems.map(t => t.id));
      for (const fi of sessionItems) {
        if (!memIds.has(fi.id)) {
          memItems.push(fi);
        }
      }
    } catch { /* file may not exist, ignore */ }
  }

  _syncTodosToFile() {
    // 合併寫入：保留其他 session 的 todos，只更新目前 session 的項目
    // 每筆加上 sessionId 標記，實現 session 隔離
    if (!this._context || !this._context.todoItems) return;
    try {
      const dataFile = this._todoFile;
      const currentSessionId = this._context.sessionId;

      // 讀取現有檔案（保留其他 session 資料）
      let existing = [];
      if (existsSync(dataFile)) {
        try {
          const raw = readFileSync(dataFile, 'utf-8');
          existing = JSON.parse(raw);
          if (!Array.isArray(existing)) existing = [];
        } catch { existing = []; }
      }

      // 移除目前 session 的舊項目
      const filtered = currentSessionId
        ? existing.filter(t => t.sessionId !== currentSessionId)
        : existing;

      // 加上 sessionId 標記後合併
      const taggedItems = this._context.todoItems.map(t => ({
        ...t,
        sessionId: currentSessionId,
      }));

      const merged = [...filtered, ...taggedItems];
      writeFileSync(dataFile, JSON.stringify(merged, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  /**
   * 從共享的 goals.json 同步 active goal 到 in-memory context。
   * 讓跨 session 的 goal 狀態能自動恢復。
   */
  _syncGoalFromFile() {
    try {
      const goalFile = resolve(homedir(), '.smart', 'goals.json');
      if (existsSync(goalFile)) {
        const raw = readFileSync(goalFile, 'utf-8');
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) return;
        const active = items.find(g => g.status === 'active');
        if (active) {
          this._context.goalState = {
            id: active.id,
            description: active.description,
            condition: active.condition,
            checkCount: active.checkCount || 0,
            turnCount: active.turnCount || 0,
            lastCheckResult: active.lastCheckResult || null,
          };
        } else {
          this._context.goalState = null;
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Get active goal summary for injection into recovery context.
   * @returns {object|null} { id, description, condition, checkCount, turnCount, lastCheckResult }
   */
  getActiveGoalSummary() {
    if (!this._context) return null;
    this._syncGoalFromFile();
    return this._context.goalState || null;
  }

  /**
   * 設定 session note（LLM 在 compaction 前自主寫入的工作摘要）。
   * 後續 formatRecoveryContext 會以此為最優先輸出。
   * @param {string} text - 1-2 句話描述目前在做什麼
   * @returns {boolean}
   */
  setSessionNote(text) {
    if (!this._context) return false;
    if (!text || typeof text !== 'string') return false;
    this._context.metadata.sessionNote = text.slice(0, 500);
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();
    return true;
  }

  /**
   * 記錄活動日誌（自動化，不依賴 LLM）。
   * 在關鍵工具成功/失敗後由 server 自動呼叫。
   * 存活在 context.metadata 中，不隨 toolHistory 被清除。
   * 最多保留 10 筆，超過時自動移除最舊的。
   * @param {string} text - 活動描述（如 "Edited src/file.js"）
   * @param {string} [type] - 類型提示：'edit' | 'test' | 'error' | 'think' | 'search'
   */
  addActivityEntry(text, type) {
    if (!this._context) return false;
    if (!text || typeof text !== 'string') return false;
    if (!this._context.activityLog) this._context.activityLog = [];
    this._context.activityLog.push({
      text: text.slice(0, 200),
      type: type || 'general',
      timestamp: nowISO(),
    });
    // 最多保留 10 筆
    if (this._context.activityLog.length > 10) {
      this._context.activityLog = this._context.activityLog.slice(-10);
    }
    this._context.metadata.updatedAt = nowISO();
    if (this._autoSave) this._save();
    return true;
  }

  /**
   * 每次 subtask 更新時自動呼叫。
   */
  _persistSubtaskProgress() {
    const sp = this._context?._subtaskProgress;
    if (!sp || Object.keys(sp).length === 0) {
      // 無進度 → 清除檔案
      try { if (existsSync(SUBTASK_PROGRESS_FILE)) unlinkSync(SUBTASK_PROGRESS_FILE); } catch {}
      return;
    }
    try {
      ensureDir(resolve(homedir(), '.smart'));
      writeFileSync(SUBTASK_PROGRESS_FILE, JSON.stringify(sp, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  /**
   * 從共享檔案恢復 subtask progress（跨 session）。
   * 在 init() 中自動呼叫。
   */
  _restoreSubtaskProgress() {
    if (!this._context) return;
    try {
      if (!existsSync(SUBTASK_PROGRESS_FILE)) return;
      const raw = readFileSync(SUBTASK_PROGRESS_FILE, 'utf-8');
      const sp = JSON.parse(raw);
      if (typeof sp === 'object' && sp !== null) {
        this._context._subtaskProgress = sp;
      }
    } catch {
      // 檔案損毀 → 清除
      try { unlinkSync(SUBTASK_PROGRESS_FILE); } catch {}
    }
  }

  /**
   * 清空特定 todo 的 subtask progress（完成/取消時呼叫）。
   * @param {number} todoId
   */
  _clearSubtaskProgress(todoId) {
    if (!this._context?._subtaskProgress) return;
    delete this._context._subtaskProgress[todoId];
    this._persistSubtaskProgress();
  }

  /**
   * 規則式自動摘要：掃描被 compact 清除的 tool entries，產出 compact 文字摘要。
   * 零 LLM 成本，純字串組合。
   * @param {Array} entries - 被移除的 toolHistory entries
   * @param {number} level - compact level (1-3)
   * @returns {string|null}
   */
  _generateCompactSummary(entries, level) {
    if (!entries || entries.length === 0) return null;

    const edits = entries.filter(e => e.tool === 'smart_fast_apply' || e.tool === 'smart_edit_chain');
    const tests = entries.filter(e => e.tool === 'smart_test');
    const errors = entries.filter(e => !e.ok);
    const searches = entries.filter(e => e.tool === 'smart_grep' || e.tool === 'smart_exa_search');
    const thinks = entries.filter(e => e.tool === 'smart_think' || e.tool === 'smart_deep_think');

    const parts = [];
    if (edits.length > 0) {
      const files = [];
      for (const e of edits) {
        const a = e.args || {};
        if (a.file) files.push(a.file);
        if (a.chain) for (const c of a.chain) { if (c.file) files.push(c.file); }
      }
      const uniq = [...new Set(files)];
      parts.push(`${edits.length} 次編輯${uniq.length ? ` (${uniq.slice(0, 3).join(', ')}${uniq.length > 3 ? '...' : ''})` : ''}`);
    }
    if (tests.length > 0) parts.push(`${tests.length} 次測試`);
    if (errors.length > 0) {
      const errTools = [...new Set(errors.map(e => e.tool))];
      parts.push(`${errors.length} 個錯誤 (${errTools.join(', ')})`);
    }
    if (searches.length > 0) parts.push(`${searches.length} 次搜尋`);
    if (thinks.length > 0) parts.push(`${thinks.length} 步推理`);

    const allTools = [...new Set(entries.map(e => e.tool))];
    return `📦 ${parts.join(' · ')}（${entries.length} 次呼叫，${allTools.length} 工具）`;
  }

  /** 根據 todo 文字判斷啟發式優先級 */
  _getTodoPriority(text) {
    const t = text.toLowerCase();
    if (/security|vuln|cve|bug|crash|critical|urgent|error|fail/i.test(t)) return 10;
    if (/fix|repair|patch|hotfix/i.test(t)) return 8;
    if (/refactor|rewrite|migrate|restructure/i.test(t)) return 6;
    if (/test|verify|validate|audit|review|check/i.test(t)) return 5;
    if (/add|implement|feature|new|create|build/i.test(t)) return 4;
    if (/update|upgrade|bump|upgrade|improve|enhance|optimize/i.test(t)) return 3;
    if (/doc|docs|readme|comment|annotat/i.test(t)) return 2;
    if (/cleanup|clean|remove|delete|chore/i.test(t)) return 1;
    return 3; // default medium
  }

  formatRecoveryContext() {
    const rc = this.getRecoveryContext();
    if (!rc) return null;

    this._syncTodosFromFile();

    const parts = [];

    // 1) Session note (LLM 自主寫入的工作摘要) — 最優先
    const note = rc.sessionNote;
    if (note) {
      parts.push(`🎯 ${note}`);
      parts.push('');
    }
    // 1-b) Auto compact summary (compaction 自動摘要, 無 session note 時顯示)
    const autoSummary = rc.autoCompactSummary;
    if (autoSummary && !note) {
      parts.push(autoSummary);
      parts.push('');
    }


    // 2) Activity log（自動記錄的活動日誌，不隨 toolHistory 清除）
    const activityLog = rc.activityLog || [];
    if (activityLog.length > 0) {
      // 取最後 5 筆，從舊到新排列
      const recent = activityLog.slice(-5);
      const icons = { edit: '✏️', test: '🧪', error: '❌', think: '💭', search: '🔍', general: '•' };
      for (const entry of recent) {
        const icon = icons[entry.type] || '•';
        parts.push(`${icon} ${entry.text}`);
      }
      parts.push('');
    }
    // 2-b) Key findings (存活於 compaction 的發現, 最多 2 筆)
    const findings = rc.findings || [];
    if (findings.length > 0) {
      for (const f of findings.slice(-2)) {
        if (!f || !f.finding) continue;
        const text = f.finding.length > 120 ? f.finding.slice(0, 120) + '...' : f.finding;
        parts.push(`🔍 ${text}`);
      }
      parts.push('');
    }

    // 3) Active goal (未完成的)
    const goalState = rc.goalState || this.getActiveGoalSummary();
    if (goalState && goalState.lastCheckResult !== 'met') {
      parts.push(`🎯 Goal: ${goalState.description}`);
      parts.push('');
    }

    // 4) Recent files (last 3 unique)
    const edits = rc.keyDecisions || [];
    if (edits.length > 0) {
      const files = [...new Set(edits.map(e => e.file))].slice(0, 3);
      parts.push(`📂 ${files.join(', ')}`);
    }

    // 5) Active todos (pending/in_progress, 最多 3 筆)
    const todos = this.listTodos();
    const activeTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (activeTodos.length > 0) {
      for (const t of activeTodos.slice(0, 3)) {
        const icon = t.status === 'in_progress' ? '⏳' : '☐';
        parts.push(`📝 ${icon} #${t.id}: ${t.text}`);
      }
    }

    // 6) Last error (if any, 最多 1 筆)
    const lastErrors = rc.lastErrors || [];
    if (lastErrors.length > 0) {
      const e = lastErrors[lastErrors.length - 1];
      const preview = e.error.length > 500 ? e.error.slice(0, 500) + '...' : e.error;
      parts.push(`❌ ${e.tool}: ${preview}`);
    }

    // 沒有任何有用資訊 → 不回傳
    if (parts.length === 0) return null;

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
