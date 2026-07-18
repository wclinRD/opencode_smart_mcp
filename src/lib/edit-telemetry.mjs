/**
 * edit-telemetry.mjs — Lightweight edit telemetry for smart_fast_apply
 *
 * Records edit metadata (format, language, success, retries, duration)
 * to ~/.smart/edit-telemetry.jsonl for analytics.
 *
 * Public API:
 *   recordEdit(entry)  — append one telemetry entry
 *   getEditStats(opts?) — aggregate stats (format, lang, success rates)
 *   clearTelemetry()   — reset telemetry file
 */

import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TELEMETRY_DIR = join(homedir(), '.smart');
const TELEMETRY_FILE = join(TELEMETRY_DIR, 'edit-telemetry.jsonl');

function ensureDir() {
  try { mkdirSync(TELEMETRY_DIR, { recursive: true }); } catch {}
}

/**
 * Record one edit telemetry entry.
 * @param {object} entry
 * @param {string} entry.format     - edit format used (search-replace, block-diff, etc.)
 * @param {string} entry.lang       - file language
 * @param {number} entry.fileLines  - total lines in target file
 * @param {number} entry.editLines  - lines being edited
 * @param {boolean} entry.success   - whether the edit succeeded
 * @param {number} entry.retries    - number of retry attempts (0 = first try)
 * @param {number} entry.durationMs - time taken in ms
 * @param {string} [entry.modelSize] - model size (large/small/micro)
 * @param {string} [entry.error]    - error message if failed
 * @param {string} [entry.phase]    - which phase failed (fuzzy/structural/dmp/lsp)
 */
export function recordEdit(entry) {
  ensureDir();
  const record = {
    ts: Date.now(),
    ...entry,
  };
  try {
    appendFileSync(TELEMETRY_FILE, JSON.stringify(record) + '\n', 'utf-8');
  } catch {}
}

/**
 * Aggregate edit telemetry stats.
 * @param {object} [opts]
 * @param {string} [opts.format] - filter by format
 * @param {string} [opts.lang]   - filter by language
 * @param {number} [opts.since]  - only entries after this timestamp
 * @returns {object} aggregated stats
 */
export function getEditStats(opts = {}) {
  if (!existsSync(TELEMETRY_FILE)) {
    return { total: 0, successRate: 0, avgRetries: 0, byFormat: {}, byLang: {} };
  }

  let lines;
  try {
    lines = readFileSync(TELEMETRY_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  } catch {
    return { total: 0, successRate: 0, avgRetries: 0, byFormat: {}, byLang: {} };
  }

  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Apply filters
  let filtered = entries;
  if (opts.format) filtered = filtered.filter(e => e.format === opts.format);
  if (opts.lang) filtered = filtered.filter(e => e.lang === opts.lang);
  if (opts.since) filtered = filtered.filter(e => e.ts >= opts.since);

  if (filtered.length === 0) {
    return { total: 0, successRate: 0, avgRetries: 0, byFormat: {}, byLang: {} };
  }

  const total = filtered.length;
  const successes = filtered.filter(e => e.success).length;
  const totalRetries = filtered.reduce((s, e) => s + (e.retries || 0), 0);

  // Group by format
  const byFormat = {};
  for (const e of filtered) {
    const f = e.format || 'unknown';
    if (!byFormat[f]) byFormat[f] = { total: 0, success: 0, retries: 0 };
    byFormat[f].total++;
    if (e.success) byFormat[f].success++;
    byFormat[f].retries += (e.retries || 0);
  }
  for (const f of Object.keys(byFormat)) {
    byFormat[f].successRate = byFormat[f].total > 0
      ? Math.round(byFormat[f].success / byFormat[f].total * 100) : 0;
    byFormat[f].avgRetries = byFormat[f].total > 0
      ? (byFormat[f].retries / byFormat[f].total).toFixed(2) : '0';
  }

  // Group by language
  const byLang = {};
  for (const e of filtered) {
    const l = e.lang || 'unknown';
    if (!byLang[l]) byLang[l] = { total: 0, success: 0 };
    byLang[l].total++;
    if (e.success) byLang[l].success++;
  }
  for (const l of Object.keys(byLang)) {
    byLang[l].successRate = byLang[l].total > 0
      ? Math.round(byLang[l].success / byLang[l].total * 100) : 0;
  }

  // Error breakdown
  const errors = {};
  for (const e of filtered.filter(e => !e.success && e.error)) {
    const key = e.error.substring(0, 80);
    errors[key] = (errors[key] || 0) + 1;
  }

  return {
    total,
    successes,
    failures: total - successes,
    successRate: Math.round(successes / total * 100),
    avgRetries: (totalRetries / total).toFixed(2),
    byFormat,
    byLang,
    errors,
    oldestEntry: filtered[0]?.ts,
    newestEntry: filtered[filtered.length - 1]?.ts,
  };
}

/**
 * Clear telemetry file.
 */
export function clearTelemetry() {
  try { writeFileSync(TELEMETRY_FILE, '', 'utf-8'); } catch {}
}
