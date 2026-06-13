#!/usr/bin/env node

// memory-store.mjs — Lightweight JSON memory store for error resolutions + skill patches
//
// Stores past error resolutions and skill-level behavior improvements.
// Supports fuzzy search for similar cases. Used by error-diagnose to avoid
// re-diagnosing the same error, and by Phase 7 skill-level learning to
// aggregate reusable behavior patterns.
//
// Usage:
//   node memory-store.mjs store <error-message> [options]
//   node memory-store.mjs search <error-message>
//   node memory-store.mjs list [--category <cat>] [--limit <N>]
//   node memory-store.mjs get <id>
//   node memory-store.mjs delete <id>
//   node memory-store.mjs stats
//   node memory-store.mjs export [--format json]
//   node memory-store.mjs extract [--findings-file <path>] [--min-frequency <N>] [--dry-run]
//
// Skill Patch (Phase 7) Usage:
//   node memory-store.mjs store "trigger condition" \
//     --type skill_patch \
//     --target-skill <skill_name> \
//     --behavior-change "what to do differently"
//
// Auto-extract skill patches from accumulated findings:
//   echo '[{"category":"error","finding":"TypeError: ...","source":"smart_test"}]' \
//     | node memory-store.mjs extract --min-frequency 2
//
// Options:
//   --resolution <text>   How the error was fixed (for store)
//   --type <type>         Entry type: "error" (default) or "skill_patch"
//   --target-skill <s>    Target skill name (for type:skill_patch)
//   --behavior-change <t> Behavior improvement (for type:skill_patch)
//   --tools <list>        Comma-separated tool names used
//   --files <list>        Comma-separated file paths changed
//   --category <cat>      Error category: build/runtime/test/permission/path/network/lint/git/unknown
//   --type <type>         Entry type: "error" (default) or "skill_patch"
//   --target-skill <name> Target skill name (for skill_patch type)
//   --behavior-change <text> What to do differently (for skill_patch type)
//   --success <bool>      Whether the resolution was successful (default: true)
//   --format <fmt>        Output: text, json (default: text)
//   --data-dir <path>     Override data directory
//   --limit <N>           Max results (default: 10)
//   --threshold <N>       Fuzzy match threshold 0-1 (default: 0.4)
//   -h, --help            Show help

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createVectorizer, hybridSearch, getSentenceEmbedding, tryLoadSentenceModel, isSentenceModelAvailable } from '../lib/embedding.mjs';
import { MemoryDB, getMemoryDB } from '../lib/memory-db.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';

// Project root (for seed-memory discovery)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_DATA_DIR = join(HOME, '.smart', 'memory');
const MEMORY_FILE = 'resolutions.json';
const MAX_ENTRIES = 5000;

// Lifecycle management constants (Layers 1-3)
const HIT_DECAY_DAYS = 30;        // Layer 2: days without hits before hitCount decays
const HIT_DECAY_RATE = 0.5;       // Layer 2: hitCount multiplier per decay period
const ARCHIVE_DAYS = 90;          // Layer 2: auto-archive after this many idle days
const ARCHIVE_HIT_THRESHOLD = 1;  // Layer 2: max hitCount for auto-archive

// Phase 19: Cross-agent memory — agent ID detection
const AGENT_ALIASES = {
  'claude-code': ['claude', 'claude-code', 'claude_code'],
  'opencode': ['opencode', 'open-code', 'open_code'],
  'codex': ['codex', 'codex-cli', 'codex_cli'],
  'copilot': ['copilot', 'github-copilot', 'github_copilot'],
  'hermes': ['hermes'],
  'pi': ['pi', 'pi-agent'],
};

/**
 * Detect the current agent ID from environment variables.
 * Checks SMART_AGENT_ID env var first, then common agent-specific env vars.
 * @returns {string} agent ID or "unknown"
 */
function detectAgentId() {
  // Explicit override
  if (process.env.SMART_AGENT_ID) return process.env.SMART_AGENT_ID;

  // Claude Code
  if (process.env.CLAUDE_CODE || process.env.ANTHROPIC_API_KEY) return 'claude-code';

  // OpenCode
  if (process.env.OPENCODE_CONFIG || process.env.OPENCODE_HOME) return 'opencode';

  // Codex
  if (process.env.CODEX_HOME || process.env.CODEX_API_KEY) return 'codex';

  // GitHub Copilot
  if (process.env.COPILOT_HOME || process.env.GITHUB_COPILOT) return 'copilot';

  // Hermes
  if (process.env.HERMES_HOME) return 'hermes';

  // Pi
  if (process.env.PI_HOME) return 'pi';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Data management
// ---------------------------------------------------------------------------

function getDataDir(override) {
  return override ? resolve(override) : DEFAULT_DATA_DIR;
}

function ensureDataDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getMemoryPath(dir) {
  return resolve(dir, MEMORY_FILE);
}

function loadMemory(dir) {
  const path = getMemoryPath(dir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* fall through */ }
  }
  return { version: 1, entries: [] };
}

function saveMemory(dir, memory) {
  ensureDataDir(dir);
  writeFileSync(getMemoryPath(dir), JSON.stringify(memory, null, 2), 'utf-8');
}

/**
 * Run memory lifecycle management (Layers 1-3) before returning results.
 *
 * Layer 1 — Auto-cleanup stale bug fixes:
 *   Entries with filesChanged[] get each file's mtime checked. If ALL files
 *   were modified AFTER the entry was created (fix applied), the entry is stale
 *   and auto-removed. Skipped for confirmedAt entries and keep=always.
 *
 * Layer 2 — Hit count decay + auto-archive:
 *   hitCount decays exponentially after HIT_DECAY_DAYS of inactivity (×0.5 per
 *   period). Entries idle > ARCHIVE_DAYS with hitCount < ARCHIVE_HIT_THRESHOLD
 *   are tagged status:"archived" — excluded from default search/list.
 *
 * Layer 3 — TTL expiration:
 *   Entries with expiresAt past current time are removed.
 *
 * @param {object} memory — The memory store object (mutated in place)
 * @returns {{staleRemoved:number, archived:number, expiredRemoved:number, hitCountDecayed:number}}
 */
function runLifecycle(memory) {
  const result = { staleRemoved: 0, archived: 0, expiredRemoved: 0, hitCountDecayed: 0 };
  const now = Date.now();

  // ── Layer 1 & 3: Remove stale bug fixes and expired entries ──────────
  memory.entries = memory.entries.filter(entry => {
    // Layer 3: TTL expiration
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
      result.expiredRemoved++;
      return false;
    }

    // Layer 1: Stale bug fix detection (filesChanged mtime check)
    if (entry.filesChanged && entry.filesChanged.length > 0 && entry.success !== false) {
      if (entry.confirmedAt && entry.confirmedAt.length > 0) return true; // user confirmed → keep
      if (entry.keep === 'always') return true;

      const entryTime = new Date(entry.timestamp).getTime();
      let allChanged = true;

      for (const filePath of entry.filesChanged) {
        try {
          const s = statSync(filePath);
          if (s.mtimeMs <= entryTime) { allChanged = false; break; }
        } catch {
          // File deleted or moved — counts as "resolved", continue checking
          continue;
        }
      }

      if (allChanged) { result.staleRemoved++; return false; }
    }

    return true;
  });

  // ── Layer 2: Decay hitCount + auto-archive ───────────────────────────
  for (const entry of memory.entries) {
    if (entry.keep === 'always') continue;

    const lastSeen = new Date(entry.lastSeen || entry.timestamp).getTime();
    const daysSince = (now - lastSeen) / (1000 * 60 * 60 * 24);

    // Decay hitCount after prolonged inactivity
    if (daysSince > HIT_DECAY_DAYS && (entry.hitCount || 1) <= 2) {
      const periods = Math.floor(daysSince / HIT_DECAY_DAYS);
      const decayed = (entry.hitCount || 1) * Math.pow(HIT_DECAY_RATE, periods);
      entry.hitCount = Math.max(Math.round(decayed * 10) / 10, 0.1);
      result.hitCountDecayed++;
    }

    // Auto-archive old low-value entries
    if (entry.status !== 'archived' && daysSince > ARCHIVE_DAYS && (entry.hitCount || 1) < ARCHIVE_HIT_THRESHOLD) {
      entry.status = 'archived';
      result.archived++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hashing & fuzzy matching
// ---------------------------------------------------------------------------

function hashError(msg) {
  // Normalize: lowercase, collapse whitespace, remove numbers
  const normalized = msg.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  // Use single row optimization for small strings
  if (m === 0) return n;
  if (n === 0) return m;
  
  // For very long strings, use early termination
  if (m > 500 || n > 500) {
    return normalizedSimilarity(a, b);
  }
  
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insert
        prev[j] + 1,            // delete
        prev[j - 1] + cost      // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function normalizedSimilarity(a, b) {
  // For long strings, compare word overlap instead of character edit distance
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

function textSimilarity(a, b) {
  // Returns 0-1 score (1 = identical)
  const aNorm = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const bNorm = b.toLowerCase().replace(/\s+/g, ' ').trim();
  
  if (aNorm === bNorm) return 1;
  
  // Check substring match first (fast path for contained errors)
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) {
    return 0.8 + (Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length)) * 0.2;
  }
  
  // Word overlap for longer strings
  const wordsA = new Set(aNorm.split(/\W+/).filter(Boolean));
  const wordsB = new Set(bNorm.split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const jaccard = intersection / (wordsA.size + wordsB.size - intersection);
  
  // Boost by significant keyword matches (common error patterns)
  const errorKeywords = ['error', 'fail', 'exception', 'undefined', 'null', 'type', 'syntax', 'reference', 'module', 'cannot', 'not found', 'timeout', 'permission', 'denied', 'assert'];
  const aKeywords = errorKeywords.filter(k => aNorm.includes(k));
  const bKeywords = errorKeywords.filter(k => bNorm.includes(k));
  const keywordBonus = aKeywords.length > 0 && bKeywords.length > 0
    ? aKeywords.filter(k => bKeywords.includes(k)).length / Math.max(aKeywords.length, bKeywords.length) * 0.2
    : 0;
  
  return Math.min(jaccard + keywordBonus, 1);
}

function exactHashMatch(memory, hash) {
  return memory.entries.find(e => e.hash === hash) || null;
}

function fuzzySearch(memory, query, threshold, limit) {
  const results = [];
  for (const entry of memory.entries) {
    const score = textSimilarity(query, entry.errorMessage);
    if (score >= threshold) {
      results.push({ ...entry, similarity: Math.round(score * 100) / 100 });
    }
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Auto-categorize error
// ---------------------------------------------------------------------------

const CATEGORY_PATTERNS = [
  { cat: 'build', patterns: [/syntaxerror/i, /unexpected token/i, /module not found/i, /cannot find module/i, /ts\d+/i, /referenceerror/i, /typeerror/i, /cannot read property/i, /cannot read properties/i] },
  { cat: 'runtime', patterns: [/typeerror/i, /referenceerror/i, /rangeerror/i, /cannot read/i, /is not defined/i, /is not a function/i, /cannot set property/i] },
  { cat: 'test', patterns: [/assertionerror/i, /assert.*fail/i, /expect.*received/i, /test.*timeout/i, /exceeded.*timeout/i] },
  { cat: 'permission', patterns: [/eacces/i, /eperm/i, /permission denied/i, /not permitted/i] },
  { cat: 'path', patterns: [/enoent/i, /no such file/i, /does not exist/i, /not found/i] },
  { cat: 'network', patterns: [/econnrefused/i, /econnreset/i, /enetunreach/i, /fetch failed/i, /network error/i, /enotfound/i] },
  { cat: 'lint', patterns: [/no-unused/i, /no-console/i, /prefer-const/i, /no-var/i, /no-explicit-any/i, /eslint/i] },
  { cat: 'git', patterns: [/merge conflict/i, /conflict/i, /automatic merge failed/i, /not a git repository/i] },
];

function categorizeError(msg) {
  for (const { cat, patterns } of CATEGORY_PATTERNS) {
    for (const re of patterns) {
      if (re.test(msg)) return cat;
    }
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function parseTTL(ttlStr) {
  if (!ttlStr) return null;
  const match = ttlStr.match(/^(\d+)\s*(d|day|days|h|hour|hours|m|min|mins|minute|minutes)?$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'd').toLowerCase()[0];
  const multipliers = { d: 86400000, h: 3600000, m: 60000 };
  return Date.now() + num * (multipliers[unit] || 86400000);
}

function cmdStore(dataDir, errorMsg, options) {
  const memory = loadMemory(dataDir);
  
  // Run lifecycle before storing (clean up stale entries)
  const lifecycle = runLifecycle(memory);
  
  const hash = hashError(errorMsg);
  
  // Check if exact hash exists — update hitCount instead of duplicate
  const existing = exactHashMatch(memory, hash);
  if (existing) {
    existing.hitCount = (existing.hitCount || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    if (options.resolution) existing.resolution = options.resolution;
    if (options.success !== undefined) existing.success = options.success;
    // Layer 3: update keep if provided
    if (options.keep) existing.keep = options.keep;
    // Update TTL: only if explicitly provided (don't clear existing TTL)
    if (options.ttl) {
      existing.expiresAt = new Date(parseTTL(options.ttl)).toISOString();
    }
    saveMemory(dataDir, memory);
    return { stored: true, updated: true, id: existing.id, hash, hitCount: existing.hitCount, lifecycle };
  }
  
  // Enforce max entries — remove oldest low-value entries
  if (memory.entries.length >= MAX_ENTRIES) {
    memory.entries.sort((a, b) => (a.hitCount || 1) - (b.hitCount || 1) || a.timestamp.localeCompare(b.timestamp));
    memory.entries = memory.entries.slice(-Math.floor(MAX_ENTRIES * 0.8)); // remove bottom 20%
  }
  
  const entryType = options.type || 'error';
  const entry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    hash,
    errorMessage: errorMsg,
    type: entryType,
    category: entryType === 'skill_patch' ? 'skill_patch' : (options.category || categorizeError(errorMsg)),
    resolution: options.resolution || null,
    toolsUsed: options.tools ? options.tools.split(',').map(s => s.trim()).filter(Boolean) : [],
    filesChanged: options.files ? options.files.split(',').map(s => s.trim()).filter(Boolean) : [],
    success: options.success !== undefined ? options.success : true,
    timestamp: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    hitCount: 1,
  };

  // Skill-patch specific fields
  if (entryType === 'skill_patch') {
    entry.targetSkill = options.targetSkill || null;
    entry.behaviorChange = options.behaviorChange || null;
  }

  // Layer 3: Manual lifecycle override
  if (options.keep === 'always') {
    entry.keep = 'always';
  }
  if (options.ttl) {
    const expiresAt = parseTTL(options.ttl);
    if (expiresAt) {
      entry.expiresAt = new Date(expiresAt).toISOString();
      entry.status = 'temporary';
    }
  }
  
  memory.entries.push(entry);
  saveMemory(dataDir, memory);
  
  return { stored: true, updated: false, id: entry.id, hash, category: entry.category, lifecycle };
}

// ---------------------------------------------------------------------------
// Auto-extraction: findings → skill_patches
// ---------------------------------------------------------------------------

/**
 * Map finding categories to target skills.
 */
const FINDING_TO_SKILL = {
  security: 'security',
  error: 'debug',
  quality: 'refactor',
  refactor: 'refactor',
  dependency: 'test',
};

/**
 * Behavior change templates per category.
 * {trigger} is replaced with the finding's core pattern matched text.
 */
const BEHAVIOR_CHANGE_TEMPLATES = {
  security: (trigger) => `Always scan for '${trigger}' before committing — verify with smart_security and never commit credentials`,
  error: (trigger) => `When seeing '${trigger}', first check variable initialization and add error boundaries before deep tracing`,
  quality: (trigger) => `Before merging, check for '${trigger}' patterns — address technical debt before it accumulates`,
  refactor: (trigger) => `When refactoring near '${trigger}', use import_graph first to map all callers before making changes`,
  dependency: (trigger) => `When '${trigger}' appears, run a full dependency audit and update affected packages`,
};

/**
 * Auto-extract skill patches from accumulated findings.
 * Groups findings by category, and for categories with enough occurrences,
 * generates a reusable skill_patch.
 *
 * @param {string} dataDir - Memory store directory
 * @param {Array} findings - Array of finding objects [{source, finding, category, severity}]
 * @param {object} [options]
 * @param {number} [options.minFrequency=2] - Minimum occurrences to trigger a skill_patch
 * @param {string} [options.format] - Output format
 * @param {boolean} [options.dryRun] - If true, don't actually store, just return what would be stored
 * @returns {object} { extracted: number, patches: Array<{skill, trigger, behavior, finding}> }
 */
function cmdExtractSkillPatches(dataDir, findings, options = {}) {
  // Cross-session extraction: query SQLite DB for repeated error patterns
  if (options.crossSession) {
    try {
      const { db } = openDB(dataDir, false);
      const minFreq = options.minFrequency || 3;

      const patterns = db.db.prepare(`
        SELECT error_message, resolution, COUNT(*) as cnt
        FROM entries
        WHERE type = 'error' AND (status IS NULL OR status = 'active')
        GROUP BY hash
        HAVING cnt >= ?
        ORDER BY cnt DESC
        LIMIT 20
      `).all(minFreq);

      const patches = [];
      for (const p of patterns) {
        if (!p.error_message) continue;
        const targetSkill = FINDING_TO_SKILL[categorizeError(p.error_message)] || 'debug';
        const query = `When ${(p.error_message || '').slice(0, 60)}`;
        const behaviorChange = `When seeing '${(p.error_message || '').slice(0, 40)}', check known resolutions first`;

        const existing = db.db.prepare(
          "SELECT id FROM entries WHERE type = 'skill_patch' AND error_message = ?"
        ).get(query);

        if (existing) {
          db.db.prepare("UPDATE entries SET hit_count = COALESCE(hit_count, 0) + 1, last_seen = datetime('now') WHERE id = ?").run(existing.id);
          patches.push({ id: existing.id, trigger: p.error_message, skipped: true });
          continue;
        }

        const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        db.db.prepare(`
          INSERT INTO entries (id, hash, type, category, error_message, behavior_change, target_skill, hit_count)
          VALUES (?, ?, 'skill_patch', 'skill_patch', ?, ?, ?, 1)
        `).run(id, hashError(query), query, behaviorChange, targetSkill);

        patches.push({ id, trigger: p.error_message, skipped: false });
      }

      if (options.dryRun) return { extracted: patches.filter(p => !p.skipped).length, total: patches.length, patches, dryRun: true };
      return { extracted: patches.filter(p => !p.skipped).length, total: patches.length, patches };
    } catch (e) {
      return { extracted: 0, patches: [], note: `Cross-session extraction error: ${e.message}` };
    }
  }

  if (!findings || !Array.isArray(findings) || findings.length === 0) {
    return { extracted: 0, patches: [], note: 'No findings to extract from.' };
  }

  const minFreq = options.minFrequency || 2;
  const memory = loadMemory(dataDir);

  // 1. Group findings by category — count total occurrences, dedup text for sample
  const groups = {};
  for (const f of findings) {
    if (!f.category || !f.finding) continue;
    const key = f.category;
    if (!groups[key]) groups[key] = { count: 0, seenTexts: new Set(), firstFinding: null };
    groups[key].count++;
    const dedupKey = f.finding.toLowerCase().slice(0, 80);
    if (!groups[key].seenTexts.has(dedupKey)) {
      groups[key].seenTexts.add(dedupKey);
      if (!groups[key].firstFinding) groups[key].firstFinding = f;
    }
  }

  // 2. For each category with count >= minFreq, generate a skill_patch
  const patches = [];
  for (const [category, info] of Object.entries(groups)) {
    if (info.count < minFreq) continue;

    const targetSkill = FINDING_TO_SKILL[category];
    if (!targetSkill) continue; // skip unmapped categories

    // Derive trigger condition from the finding text
    const finding = info.firstFinding;
    const trigger = finding.finding.length > 80
      ? finding.finding.slice(0, 80) + '...'
      : finding.finding;

    // Generate behavior change
    const behaviorChange = BEHAVIOR_CHANGE_TEMPLATES[category]
      ? BEHAVIOR_CHANGE_TEMPLATES[category](trigger)
      : `When '${trigger}' appears, investigate and document the pattern`;

    // Build query (trigger condition)
    const query = `When ${trigger}`;

    // Check if similar skill_patch already exists
    const existingPatch = memory.entries.find(e =>
      e.type === 'skill_patch' &&
      e.targetSkill === targetSkill &&
      e.errorMessage.toLowerCase().includes(trigger.toLowerCase().slice(0, 40))
    );

    if (existingPatch) {
      // Boost existing hitCount instead of duplicating
      existingPatch.hitCount = (existingPatch.hitCount || 1) + 1;
      existingPatch.lastSeen = new Date().toISOString();
      patches.push({
        id: existingPatch.id,
        skill: targetSkill,
        trigger: query,
        behavior: behaviorChange,
        finding: trigger,
        skipped: true,
        reason: 'Similar patch already exists (hitCount boosted)',
      });
      continue;
    }

    if (options.dryRun) {
      patches.push({
        id: null,
        skill: targetSkill,
        trigger: query,
        behavior: behaviorChange,
        finding: trigger,
        skipped: false,
      });
      continue;
    }

    // Store the skill_patch (inline into local memory to avoid stale overwrite)
    const hash = hashError(query);
    const entry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      hash,
      errorMessage: query,
      type: 'skill_patch',
      category: 'skill_patch',
      targetSkill,
      behaviorChange,
      resolution: null,
      toolsUsed: finding.source ? [finding.source] : [],
      filesChanged: [],
      success: true,
      timestamp: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      hitCount: 1,
    };
    memory.entries.push(entry);

    patches.push({
      id: entry.id,
      skill: targetSkill,
      trigger: query,
      behavior: behaviorChange,
      finding: trigger,
      skipped: false,
    });
  }

  // 3. Save all at once (single write, no stale overwrite)
  if (!options.dryRun) {
    saveMemory(dataDir, memory);
  }

  return {
    extracted: patches.filter(p => !p.skipped).length,
    boosted: patches.filter(p => p.skipped).length,
    patches,
  };
}

function cmdSearch(dataDir, query, options) {
  const memory = loadMemory(dataDir);
  
  // Run lifecycle before search (return clean results)
  const lifecycle = runLifecycle(memory);
  
  const threshold = options.threshold != null ? options.threshold : 0.4;
  const limit = options.limit || 10;
  
  if (memory.entries.length === 0) {
    return { found: false, count: 0, entries: [], note: 'Memory store is empty. No past resolutions available.', lifecycle };
  }
  
  // Filter out archived entries by default (Layer 2)
  const searchPool = options.includeArchived
    ? memory.entries
    : memory.entries.filter(e => e.status !== 'archived');
  
  if (searchPool.length === 0) {
    return { found: false, count: 0, entries: [], note: 'No active entries found. Use --include-archived to search archived entries.', lifecycle };
  }
  
  // 1. Exact hash match (fast path)
  const hash = hashError(query);
  const exact = exactHashMatch({ entries: searchPool }, hash);
  if (exact) {
    // Bump hitCount
    exact.hitCount = (exact.hitCount || 1) + 1;
    exact.lastSeen = new Date().toISOString();
    saveMemory(dataDir, memory);
    return { found: true, count: 1, entries: [{ ...exact, similarity: 1.0, matchType: 'exact' }], matchType: 'exact', lifecycle };
  }
  
  // 2. Vector search (if enabled) — hybrid TF-IDF + fuzzy
  if (options.vector) {
    const vectorResults = hybridSearch(query, searchPool, {
      textKey: 'errorMessage',
      vectorWeight: 0.7,
      topK: limit,
      minScore: options.vectorThreshold != null ? options.vectorThreshold : 0.1,
    });
    if (vectorResults.length > 0) {
      return { found: true, count: vectorResults.length, entries: vectorResults, matchType: 'vector', lifecycle };
    }
    // Vector returned nothing — fall through to fuzzy
  }
  
  // 3. Fuzzy search (default fallback)
  const results = fuzzySearch({ entries: searchPool }, query, threshold, limit);
  if (results.length > 0) {
    return { found: true, count: results.length, entries: results.map(r => ({ ...r, matchType: 'fuzzy' })), matchType: 'fuzzy', lifecycle };
  }
  
  return { found: false, count: 0, entries: [], matchType: 'none', note: 'No similar past resolution found in memory.', lifecycle };
}

function cmdList(dataDir, options) {
  const memory = loadMemory(dataDir);
  
  // Run lifecycle before listing
  const lifecycle = runLifecycle(memory);
  
  let entries = [...memory.entries];
  
  // Filter out archived entries by default (Layer 2)
  if (!options.includeArchived) {
    entries = entries.filter(e => e.status !== 'archived');
  }
  
  if (options.category) {
    entries = entries.filter(e => e.category === options.category);
  }
  
  // Sort by lastSeen descending
  entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  
  const limit = options.limit || 50;
  entries = entries.slice(0, limit);
  
  return { total: memory.entries.length, shown: entries.length, entries: entries.map(e => ({
    id: e.id, type: e.type, category: e.category, status: e.status || 'active',
    errorMessage: e.errorMessage.slice(0, 120),
    resolution: e.resolution ? e.resolution.slice(0, 200) : null,
    success: e.success, hitCount: e.hitCount || 1, lastSeen: e.lastSeen, timestamp: e.timestamp,
    targetSkill: e.type === 'skill_patch' ? e.targetSkill : undefined,
    behaviorChange: e.type === 'skill_patch' ? e.behaviorChange : undefined,
  })), lifecycle };
}

function cmdGet(dataDir, id) {
  const memory = loadMemory(dataDir);
  const entry = memory.entries.find(e => e.id === id);
  if (!entry) return { found: false, error: `No entry with id '${id}'` };
  return { found: true, entry };
}

function cmdDelete(dataDir, id) {
  const memory = loadMemory(dataDir);
  const idx = memory.entries.findIndex(e => e.id === id);
  if (idx === -1) return { deleted: false, error: `No entry with id '${id}'` };
  const removed = memory.entries.splice(idx, 1)[0];
  saveMemory(dataDir, memory);
  return { deleted: true, id: removed.id, errorMessage: removed.errorMessage };
}

function cmdConfirm(dataDir, id, options) {
  const memory = loadMemory(dataDir);
  const entry = memory.entries.find(e => e.id === id);
  if (!entry) return { confirmed: false, error: `No entry with id '${id}'` };

  // --miss: increment missCount (near-miss tracking, no hit boost)
  if (options.miss) {
    entry.missCount = (entry.missCount || 0) + 1;
    entry.lastSeen = new Date().toISOString();
    saveMemory(dataDir, memory);
    return { confirmed: true, id: entry.id, miss: true, missCount: entry.missCount, errorMessage: entry.errorMessage };
  }

  // --auto: lightweight touch (skip +2 boost, just +1 and update lastSeen)
  if (options.auto) {
    entry.hitCount = (entry.hitCount || 1) + 1;
    entry.lastSeen = new Date().toISOString();
    saveMemory(dataDir, memory);
    return { confirmed: true, id: entry.id, auto: true, hitCount: entry.hitCount, errorMessage: entry.errorMessage };
  }

  // Boost hitCount more than a regular search (+2 instead of +1)
  entry.hitCount = (entry.hitCount || 1) + 2;
  entry.lastSeen = new Date().toISOString();
  entry.confirmedAt = entry.confirmedAt || [];
  entry.confirmedAt.push(new Date().toISOString());
  // Track what tools validated this confirmation
  if (options.tools) {
    const newTools = options.tools.split(',').map(s => s.trim()).filter(Boolean);
    for (const t of newTools) {
      if (!entry.toolsUsed.includes(t)) entry.toolsUsed.push(t);
    }
  }
  // Update resolution if provided
  if (options.resolution) entry.resolution = options.resolution;

  saveMemory(dataDir, memory);
  return {
    confirmed: true, id: entry.id, hitCount: entry.hitCount,
    confirmCount: entry.confirmedAt.length, errorMessage: entry.errorMessage,
  };
}

function cmdStats(dataDir) {
  const memory = loadMemory(dataDir);
  const entries = memory.entries;
  if (entries.length === 0) {
    return { totalEntries: 0, byCategory: {}, successRate: 0, totalHits: 0, archivedCount: 0, temporaryCount: 0 };
  }
  
  const byCategory = {};
  let successes = 0;
  let totalHits = 0;
  let archivedCount = 0;
  let temporaryCount = 0;
  
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.success) successes++;
    totalHits += e.hitCount || 1;
    if (e.status === 'archived') archivedCount++;
    if (e.status === 'temporary') temporaryCount++;
  }
  
  return {
    totalEntries: entries.length,
    byCategory,
    successRate: Math.round((successes / entries.length) * 100),
    totalHits,
    avgHitsPerEntry: (totalHits / entries.length).toFixed(1),
    archivedCount,
    temporaryCount,
    oldestEntry: entries.reduce((a, b) => a.timestamp < b.timestamp ? a : b).timestamp,
    newestEntry: entries.reduce((a, b) => a.timestamp > b.timestamp ? a : b).timestamp,
  };
}

function cmdExport(dataDir) {
  const memory = loadMemory(dataDir);
  return memory;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatText(command, result) {
  const out = [];
  
  switch (command) {
    case 'store': {
      if (result.updated) {
        out.push(`Updated existing entry ${result.id} (hit #${result.hitCount})`);
      } else {
        out.push(`Stored new entry ${result.id}`);
        out.push(`  Category: ${result.category}`);
        out.push(`  Hash:     ${result.hash}`);
      }
      // Show lifecycle summary
      if (result.lifecycle) {
        const L = result.lifecycle;
        const parts = [];
        if (L.staleRemoved > 0) parts.push(`${L.staleRemoved} stale fix(es) cleaned`);
        if (L.archived > 0) parts.push(`${L.archived} archived`);
        if (L.expiredRemoved > 0) parts.push(`${L.expiredRemoved} expired`);
        if (L.hitCountDecayed > 0) parts.push(`${L.hitCountDecayed} hitCount(s) decayed`);
        if (parts.length > 0) out.push(`♻ Lifecycle: ${parts.join(', ')}.`);
      }
      break;
    }
    case 'search': {
      if (!result.found) {
        out.push('No matching past resolutions found.');
        // Show lifecycle summary even on no-match
        if (result.lifecycle) {
          const L = result.lifecycle;
          const parts = [];
          if (L.staleRemoved > 0) parts.push(`${L.staleRemoved} stale fix(es) cleaned`);
          if (L.archived > 0) parts.push(`${L.archived} archived`);
          if (L.expiredRemoved > 0) parts.push(`${L.expiredRemoved} expired`);
          if (L.hitCountDecayed > 0) parts.push(`${L.hitCountDecayed} hitCount(s) decayed`);
          if (parts.length > 0) out.push(`♻ Lifecycle: ${parts.join(', ')}.`);
        }
        return out.join('\n');
      }
      out.push(`Found ${result.count} past resolution(s) (${result.matchType} match):`);
      // Show lifecycle summary
      if (result.lifecycle) {
        const L = result.lifecycle;
        const parts = [];
        if (L.staleRemoved > 0) parts.push(`${L.staleRemoved} stale fix(es) cleaned`);
        if (L.archived > 0) parts.push(`${L.archived} archived`);
        if (L.expiredRemoved > 0) parts.push(`${L.expiredRemoved} expired`);
        if (L.hitCountDecayed > 0) parts.push(`${L.hitCountDecayed} hitCount(s) decayed`);
        if (parts.length > 0) out.push(`♻ Lifecycle: ${parts.join(', ')}.`);
      }
      out.push('');
      for (const e of result.entries) {
        const sim = e.similarity ? ` [${(e.similarity * 100).toFixed(0)}% match]` : '';
        const status = e.success ? '✅' : '❌';
        const archTag = e.status === 'archived' ? ' 📦' : '';
        const tempTag = e.status === 'temporary' ? ' ⏳' : '';
        const vecInfo = (e._vectorScore != null && e._fuzzyScore != null)
          ? ` (vector:${(e._vectorScore * 100).toFixed(0)}% fuzzy:${(e._fuzzyScore * 100).toFixed(0)}%)`
          : '';
        out.push(`  ${status} ${e.id}${sim}${archTag}${tempTag}`);
        out.push(`     Error: ${(e.errorMessage || '').slice(0, 120)}`);
        if (e.resolution) out.push(`     Fix:   ${e.resolution.slice(0, 200)}`);
        if (e.toolsUsed && e.toolsUsed.length > 0) out.push(`     Tools: ${e.toolsUsed.join(', ')}`);
        out.push(`     Last:  ${e.lastSeen.slice(0, 10)} (${e.hitCount || 1} hits)`);
        out.push('');
      }
      break;
    }
    case 'list': {
      out.push(`Memory entries (${result.shown}/${result.total}):`);
      // Show lifecycle summary
      if (result.lifecycle) {
        const L = result.lifecycle;
        const parts = [];
        if (L.staleRemoved > 0) parts.push(`${L.staleRemoved} stale fix(es) cleaned`);
        if (L.archived > 0) parts.push(`${L.archived} archived`);
        if (L.expiredRemoved > 0) parts.push(`${L.expiredRemoved} expired`);
        if (L.hitCountDecayed > 0) parts.push(`${L.hitCountDecayed} hitCount(s) decayed`);
        if (parts.length > 0) out.push(`♻ Lifecycle: ${parts.join(', ')}.`);
      }
      out.push('');
      for (const e of result.entries) {
        const success = e.success ? '✅' : '❌';
        const typeTag = e.type === 'skill_patch' ? ' [skill_patch]' : '';
        const archTag = e.status === 'archived' ? ' 📦' : '';
        const tempTag = e.status === 'temporary' ? ' ⏳' : '';
        out.push(`  ${success} ${e.id}${typeTag}${archTag}${tempTag}`);
        out.push(`     ${e.category}: ${e.errorMessage.slice(0, 100)}`);
        if (e.status && e.status !== 'active') {
          out.push(`     Status: ${e.status}`);
        }
        if (e.type === 'skill_patch' && e.targetSkill) {
          out.push(`     Skill: ${e.targetSkill}`);
        }
        out.push(`     Hits: ${e.hitCount} | Last: ${e.lastSeen.slice(0, 10)}`);
        out.push('');
      }
      break;
    }
    case 'get': {
      if (!result.found) {
        out.push(`Error: ${result.error}`);
        break;
      }
      const e = result.entry;
      const typeTag = e.type === 'skill_patch' ? ' [skill_patch]' : '';
      out.push(`Entry: ${e.id}${typeTag}`);
      out.push(`  Type:         ${e.type || 'error'}`);
      out.push(`  Category:     ${e.category}`);
      out.push(`  Status:       ${e.status || 'active'}${e.keep === 'always' ? ' (kept)' : ''}`);
      out.push(`  Success:      ${e.success ? '✅ yes' : '❌ no'}`);
      out.push(`  Description:  ${e.errorMessage}`);
      out.push(`  Resolution:   ${e.resolution || '(none recorded)'}`);
      if (e.type === 'skill_patch') {
        out.push(`  Target Skill: ${e.targetSkill || '(not specified)'}`);
        out.push(`  Behavior:     ${e.behaviorChange || '(not specified)'}`);
      }
      if (e.toolsUsed && e.toolsUsed.length > 0) out.push(`  Tools Used:   ${e.toolsUsed.join(', ')}`);
      if (e.filesChanged && e.filesChanged.length > 0) out.push(`  Files:        ${e.filesChanged.join(', ')}`);
      if (e.expiresAt) out.push(`  Expires At:   ${e.expiresAt}`);
      if (e.confirmedAt && e.confirmedAt.length > 0) out.push(`  Confirmed:    ${e.confirmedAt.length} time(s)`);
      out.push(`  Created:      ${e.timestamp}`);
      out.push(`  Last Seen:    ${e.lastSeen}`);
      out.push(`  Hit Count:    ${e.hitCount || 1}`);
      break;
    }
    case 'confirm': {
      if (result.confirmed) {
        if (result.miss) {
          out.push(`Miss entry: ${result.id} (total misses: ${result.missCount})`);
          out.push(`  Error: ${result.errorMessage.slice(0, 100)}`);
        } else if (result.auto) {
          out.push(`Touched entry: ${result.id} (total hits: ${result.hitCount})`);
          out.push(`  Error: ${result.errorMessage.slice(0, 100)}`);
        } else {
          out.push(`Confirmed entry: ${result.id} (total hits: ${result.hitCount}, confirmations: ${result.confirmCount})`);
          out.push(`  Error: ${result.errorMessage.slice(0, 100)}`);
          out.push(`  Weight boosted — future searches will rank this higher.`);
        }
      } else {
        out.push(`Error: ${result.error}`);
      }
      break;
    }
    case 'delete': {
      if (result.deleted) {
        out.push(`Deleted entry: ${result.id}`);
        out.push(`  Error: ${result.errorMessage.slice(0, 100)}`);
      } else {
        out.push(`Error: ${result.error}`);
      }
      break;
    }
    case 'stats': {
      out.push('Memory Store Statistics');
      out.push('='.repeat(40));
      out.push(`  Total Entries:  ${result.totalEntries}`);
      out.push(`  Total Hits:     ${result.totalHits}`);
      out.push(`  Avg Hits/Entry: ${result.avgHitsPerEntry}`);
      out.push(`  Success Rate:   ${result.successRate}%`);
      if (result.archivedCount > 0) out.push(`  Archived:       ${result.archivedCount}`);
      if (result.temporaryCount > 0) out.push(`  Temporary:      ${result.temporaryCount}`);
      out.push('');
      if (result.byCategory) {
        out.push('  By Category:');
        for (const [cat, count] of Object.entries(result.byCategory).sort((a, b) => b[1] - a[1])) {
          const bar = '█'.repeat(Math.min(count, 30));
          out.push(`    ${cat.padEnd(12)} ${String(count).padEnd(5)} ${bar}`);
        }
      }
      out.push('');
      out.push(`  Oldest: ${result.oldestEntry?.slice(0, 10) || '-'}`);
      out.push(`  Newest: ${result.newestEntry?.slice(0, 10) || '-'}`);
      break;
    }
    case 'extract': {
      const noun = result.dryRun ? 'Would extract' : 'Extracted';
      out.push(`${noun} ${result.extracted} skill patch(es)${result.boosted > 0 ? `, boosted ${result.boosted} existing` : ''}`);
      out.push('');
      for (const p of result.patches) {
        const icon = p.skipped ? '↻' : '✦';
        const idStr = p.skipped ? `(hitCount++)` : p.id ? p.id.slice(0, 24) + '...' : '(preview)';
        out.push(`  ${icon} [${p.skill}] ${p.trigger.slice(0, 80)}`);
        out.push(`     ${idStr} → ${p.behavior.slice(0, 120)}`);
      }
      break;
    }
    case 'quality': {
      if (result.error) {
        out.push(`Error: ${result.error}`);
        break;
      }
      out.push('Memory Quality Dashboard');
      out.push('='.repeat(40));
      out.push(`  Total Entries:      ${result.totalEntries}`);
      out.push(`  Active:             ${result.activeEntries}`);
      out.push(`  Archived:           ${result.archived}`);
      out.push('');
      out.push('  Hit Rate Summary:');
      out.push(`    With Hits:        ${result.hitRateSummary.entriesWithHits}`);
      out.push(`    With Misses:      ${result.hitRateSummary.entriesWithMisses}`);
      out.push(`    Zero Hits:        ${result.hitRateSummary.zeroHitCount} (${result.hitRateSummary.zeroHitRatio}%)`);
      out.push(`  Conflicts:          ${result.conflictCount}`);
      out.push('');
      if (result.worstHitRates && result.worstHitRates.length > 0) {
        out.push('  Worst Hit Rates (bottom 5):');
        for (const r of result.worstHitRates) {
          out.push(`    ${r.hitRate}%  hits=${r.hits} misses=${r.misses}  ${r.errorMessage}`);
        }
        out.push('');
      }
      if (result.mostValuable && result.mostValuable.length > 0) {
        out.push('  Most Valuable (top 5 by hits):');
        for (const v of result.mostValuable) {
          out.push(`    ${v.hitCount} hits  ${v.errorMessage}`);
        }
        out.push('');
      }
      if (result.cleanupCandidates && result.cleanupCandidates.length > 0) {
        out.push('  Cleanup Candidates (zero hits, not kept):');
        for (const c of result.cleanupCandidates) {
          out.push(`    ${c.created_at ? c.created_at.slice(0, 10) : '?'}  ${c.errorMessage}`);
        }
      }
      break;
    }
  }
  
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// SQLite backend (--db mode)
// ---------------------------------------------------------------------------

/**
 * Normalize a MemoryDB entry (snake_case SQLite) → camelCase (JSON interface)
 * so existing formatText() works unchanged.
 */
function normalizeDBEntry(e) {
  if (!e) return null;
  return {
    id: e.id,
    hash: e.hash,
    errorMessage: e.error_message ?? e.errorMessage,
    type: e.type ?? 'error',
    category: e.category,
    status: e.status ?? 'active',
    resolution: e.resolution,
    toolsUsed: e.tools_used ? (typeof e.tools_used === 'string' ? e.tools_used.split(',').filter(s => s.trim()) : e.tools_used) : [],
    filesChanged: e.files_changed ? (typeof e.files_changed === 'string' ? e.files_changed.split(',').filter(s => s.trim()) : e.files_changed) : [],
    success: e.success === 1 || e.success === true,
    hitCount: e.hit_count ?? e.hitCount ?? 1,
    keep: e.keep,
    expiresAt: e.expires_at ?? e.expiresAt,
    targetSkill: e.target_skill ?? e.targetSkill,
    behaviorChange: e.behavior_change ?? e.behaviorChange,
    confirmedAt: e.confirmed_at
      ? (Array.isArray(e.confirmed_at) ? e.confirmed_at : e.confirmed_at.split(',').filter(Boolean))
      : (Array.isArray(e.confirmedAt) ? e.confirmedAt : []),
    timestamp: e.created_at ?? e.timestamp ?? e.last_seen ?? new Date().toISOString(),
    lastSeen: e.last_seen ?? e.lastSeen ?? e.created_at ?? new Date().toISOString(),
  };
}

/**
 * Open (or get singleton) MemoryDB for a data directory.
 */
function openDB(dataDir, semantic) {
  const dbPath = join(dataDir, 'memory.db');
  const db = getMemoryDB(dbPath);

  // Migrate existing JSON data on first use
  const jsonPath = join(dataDir, 'resolutions.json');
  let migration = null;
  if (existsSync(jsonPath)) {
    migration = db.migrateFromJSON(jsonPath);
  }

  // Auto-seed project knowledge base on first (empty) DB
  // This ensures critical skill_patches survive across machine setups
  if (db.countEntries() === 0) {
    const seedPath = resolve(PROJECT_ROOT, 'config', 'seed-memory.json');
    if (existsSync(seedPath)) {
      const seed = db.migrateFromJSON(seedPath);
      if (seed && seed.migrated > 0) {
        console.error(`📚 Seeded ${seed.migrated} knowledge entry/ies from config/seed-memory.json`);
      }
    }
  }

  return { db, migration };
}

async function cmdStoreDB(db, errorMsg, opts) {
  const hash = hashError(errorMsg);

  const existing = db.getEntryByHash(hash);
  if (existing) {
    db.touchEntry(existing.id);
    const updates = {};
    if (opts.resolution) updates.resolution = opts.resolution;
    if (opts.success !== undefined) updates.success = opts.success ? 1 : 0;
    if (Object.keys(updates).length > 0) db.updateEntry(existing.id, updates);
    const lifecycle = db.runLifecycle();
    return { stored: true, updated: true, id: existing.id, hash, hitCount: (existing.hit_count || 1) + 1, lifecycle };
  }

  const entry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    hash,
    error_message: errorMsg,
    type: opts.type || 'error',
    category: opts.type === 'skill_patch' ? 'skill_patch' : (opts.category || categorizeError(errorMsg)),
    resolution: opts.resolution || null,
    tools_used: opts.tools ? opts.tools.split(',').map(s => s.trim()).filter(Boolean).join(',') : null,
    files_changed: opts.files ? opts.files.split(',').map(s => s.trim()).filter(Boolean).join(',') : null,
    success: opts.success !== undefined ? opts.success : true,
    hit_count: 1,
    keep: opts.keep === 'always' ? 'always' : null,
    expires_at: opts.ttl ? new Date(parseTTL(opts.ttl)).toISOString() : null,
    // Phase 19: Cross-agent memory — auto-detect or use explicit agent_id
    agent_id: opts.agent || detectAgentId(),
  };

  if (opts.type === 'skill_patch') {
    entry.target_skill = opts.targetSkill || null;
    entry.behavior_change = opts.behaviorChange || null;
  }

  const inserted = db.insertEntry(entry);

  // Auto-embed if --semantic (ensure model loaded first)
  if (opts.semantic) {
    if (!isSentenceModelAvailable()) {
      await tryLoadSentenceModel().catch(() => {});
    }
    const emb = await getSentenceEmbedding(errorMsg).catch(() => null);
    if (emb) {
      db.storeEmbedding(inserted.id, emb);
    }
  }

  const lifecycle = db.runLifecycle();
  return { stored: true, updated: false, id: inserted.id, hash, category: entry.category, lifecycle };
}

async function cmdSearchDB(db, query, opts) {
  const lifecycle = db.runLifecycle();

  const total = db.countEntries();
  if (total === 0) {
    return { found: false, count: 0, entries: [], note: 'Memory store is empty. No past resolutions available.', lifecycle };
  }

  // 1. Exact hash match (fast path)
  const hash = hashError(query);
  const exact = db.getEntryByHash(hash);
  if (exact) {
    db.touchEntry(exact.id);
    const e = normalizeDBEntry(exact);
    return { found: true, count: 1, entries: [{ ...e, similarity: 1.0, matchType: 'exact' }], matchType: 'exact', lifecycle };
  }

  const limit = opts.limit || 10;

  // 2. Hybrid search via RRF (FTS5 BM25 + vector ANN)
  //    Only runs when --semantic is set with a loaded sentence model.
  //    Falls through to FTS5-only if model/embedding unavailable.
  if (opts.semantic) {
    // Ensure model is loaded (tryLoadSentenceModel may still be warming up
    // from openDB's fire-and-forget; await explicitly here)
    if (!isSentenceModelAvailable()) {
      await tryLoadSentenceModel().catch(() => null);
    }
    if (isSentenceModelAvailable()) {
      const emb = await getSentenceEmbedding(query).catch(() => null);
      if (emb) {
        const hybridResults = db.searchHybrid(query, emb, { limit, agent_id: opts.agent !== 'all' ? (opts.agent || detectAgentId()) : null });
        if (hybridResults.length > 0) {
          const entries = hybridResults.map(r => {
            const norm = normalizeDBEntry(r);
            norm.similarity = r._rrfScore;
            norm.matchType = 'hybrid';
            return norm;
          });
          return { found: true, count: entries.length, entries, matchType: 'hybrid', lifecycle };
        }
      }
    }
    // Embedding unavailable → fall through to FTS5 BM25
  }

  // 3. FTS5 BM25 search (always synchronous, great quality even alone)
  const ftsResults = db.searchFTS(query, limit * 2);
  if (ftsResults.length > 0) {
    const entries = ftsResults.slice(0, limit).map((e, i) => {
      const norm = normalizeDBEntry(e);
      norm.similarity = Math.round((1 - (i / limit) * 0.4) * 100) / 100;
      norm.matchType = 'fts';
      return norm;
    });
    return { found: true, count: entries.length, entries, matchType: 'fts', lifecycle };
  }

  return { found: false, count: 0, entries: [], matchType: 'none', note: 'No similar past resolution found in memory.', lifecycle };
}

function cmdListDB(db, opts) {
  const lifecycle = db.runLifecycle();
  const total = db.countEntries();
  const entries = db.listEntries({
    category: opts.category || undefined,
    includeArchived: opts.includeArchived,
    limit: opts.limit || 50,
  });
  const shown = entries.map(e => {
    const norm = normalizeDBEntry(e);
    return {
      id: norm.id, type: norm.type, category: norm.category, status: norm.status || 'active',
      errorMessage: (norm.errorMessage || '').slice(0, 120),
      resolution: norm.resolution ? norm.resolution.slice(0, 200) : null,
      success: norm.success, hitCount: norm.hitCount,
      lastSeen: norm.lastSeen, timestamp: norm.timestamp,
      targetSkill: norm.type === 'skill_patch' ? norm.targetSkill : undefined,
      behaviorChange: norm.type === 'skill_patch' ? norm.behaviorChange : undefined,
    };
  });

  return { total, shown: shown.length, entries: shown, lifecycle };
}

function cmdGetDB(db, id) {
  const entry = db.getEntry(id);
  if (!entry) return { found: false, error: `No entry with id '${id}'` };
  return { found: true, entry: normalizeDBEntry(entry) };
}

function cmdDeleteDB(db, id) {
  const entry = db.getEntry(id);
  if (!entry) return { deleted: false, error: `No entry with id '${id}'` };
  db.deleteEntry(id);
  return { deleted: true, id, errorMessage: entry.error_message || entry.errorMessage };
}

function cmdConfirmDB(db, id, opts) {
  const entry = db.getEntry(id);
  if (!entry) return { confirmed: false, error: `No entry with id '${id}'` };

  // --miss: increment missCount via incrementMissCount
  if (opts.miss) {
    db.incrementMissCount(id);
    return { confirmed: true, id, miss: true, missCount: (entry.miss_count || 0) + 1, errorMessage: entry.error_message || entry.errorMessage };
  }

  // --auto: lightweight touch via touchEntry (does +1 hit + last_seen)
  if (opts.auto) {
    db.touchEntry(id);
    return { confirmed: true, id, auto: true, hitCount: (entry.hit_count || 1) + 1, errorMessage: entry.error_message || entry.errorMessage };
  }

  // +2 hits (+1 from touchEntry, +1 bonus for explicit confirmation)
  db.touchEntry(id);
  const updates = {
    hit_count: (entry.hit_count || 1) + 2,
    confirmed_at: entry.confirmed_at
      ? entry.confirmed_at + ',' + new Date().toISOString()
      : new Date().toISOString(),
  };
  if (opts.tools) {
    const newTools = opts.tools.split(',').map(s => s.trim()).filter(Boolean);
    const existing = entry.tools_used ? entry.tools_used.split(',').filter(Boolean) : [];
    const merged = [...new Set([...existing, ...newTools])];
    updates.tools_used = merged.join(',');
  }
  if (opts.resolution) updates.resolution = opts.resolution;

  db.updateEntry(id, updates);
  return {
    confirmed: true, id, hitCount: updates.hit_count,
    confirmCount: (entry.confirmed_at || '').split(',').filter(Boolean).length + 1,
    errorMessage: entry.error_message || entry.errorMessage,
  };
}

function cmdStatsDB(db) {
  const stats = db.stats();
  const entries = db.listEntries({ includeArchived: true, limit: 999999 });
  const byCategory = {};
  let successes = 0, totalHits = 0;
  let oldest = null, newest = null;
  for (const e of entries) {
    const cat = e.category || 'unknown';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (e.success === 1 || e.success === true) successes++;
    totalHits += e.hit_count || 1;
    if (!oldest || e.created_at < oldest) oldest = e.created_at;
    if (!newest || e.created_at > newest) newest = e.created_at;
  }
  return {
    totalEntries: stats.total,
    byCategory,
    successRate: stats.total > 0 ? Math.round((successes / stats.total) * 100) : 0,
    totalHits,
    avgHitsPerEntry: stats.total > 0 ? (totalHits / stats.total).toFixed(1) : '0',
    archivedCount: stats.archivedCount,
    temporaryCount: stats.temporaryCount,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

function cmdExportDB(db) {
  const entries = db.listEntries({ includeArchived: true, limit: 999999 });
  return { version: 1, entries: entries.map(normalizeDBEntry) };
}

function cmdQualityDB(db) {
  const stats = db.stats();
  const entries = db.listEntries({ includeArchived: true, limit: 999999 });

  const total = entries.length;
  const withMissCount = entries.filter(e => (e.miss_count || 0) > 0).length;
  const withHitCount = entries.filter(e => (e.hit_count || 0) > 0).length;
  const zeroHit = entries.filter(e => (e.hit_count || 0) === 0 && e.keep !== 'always').length;
  const archived = entries.filter(e => e.status === 'archived').length;

  // Hit rate per entry: hit / (hit + miss)
  const hitRates = entries
    .filter(e => (e.hit_count || 0) > 0 || (e.miss_count || 0) > 0)
    .map(e => ({
      id: e.id,
      hitRate: (e.hit_count || 0) / ((e.hit_count || 0) + (e.miss_count || 0)),
      hits: e.hit_count || 0,
      misses: e.miss_count || 0,
      errorMessage: (e.error_message || '').slice(0, 80),
    }))
    .sort((a, b) => a.hitRate - b.hitRate);

  // Conflict analysis: entries with same hash but different resolutions
  const hashGroups = {};
  for (const e of entries) {
    if (!e.hash) continue;
    if (!hashGroups[e.hash]) hashGroups[e.hash] = [];
    hashGroups[e.hash].push(e);
  }
  const conflicts = Object.values(hashGroups).filter(group => {
    if (group.length < 2) return false;
    const resolutions = group.filter(e => e.resolution).map(e => e.resolution);
    if (resolutions.length < 2) return false;
    for (let i = 0; i < resolutions.length; i++) {
      for (let j = i + 1; j < resolutions.length; j++) {
        const sim = textSimilarity(resolutions[i], resolutions[j]);
        if (sim < 0.6) return true;
      }
    }
    return false;
  });

  // Top 5 most valuable (highest hitCount)
  const mostValuable = [...entries]
    .filter(e => (e.hit_count || 0) > 0)
    .sort((a, b) => (b.hit_count || 0) - (a.hit_count || 0))
    .slice(0, 5)
    .map(e => ({
      id: e.id,
      hitCount: e.hit_count,
      errorMessage: (e.error_message || '').slice(0, 80),
      resolution: (e.resolution || '').slice(0, 100),
    }));

  // Top 5 cleanup candidates (zero hit, not keep=always, not archived)
  const cleanupCandidates = [...entries]
    .filter(e => (e.hit_count || 0) === 0 && e.keep !== 'always' && e.status !== 'archived')
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .slice(0, 5)
    .map(e => ({
      id: e.id,
      created_at: e.created_at,
      errorMessage: (e.error_message || '').slice(0, 80),
    }));

  return {
    totalEntries: total,
    archived,
    activeEntries: total - archived,
    hitRateSummary: {
      entriesWithHits: withHitCount,
      entriesWithMisses: withMissCount,
      zeroHitCount: zeroHit,
      zeroHitRatio: total > 0 ? Math.round((zeroHit / total) * 100) : 0,
    },
    conflictCount: conflicts.length,
    worstHitRates: hitRates.slice(0, 5).map(r => ({ ...r, hitRate: Math.round(r.hitRate * 100) })),
    mostValuable,
    cleanupCandidates,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node memory-store.mjs <command> [options]

Lightweight memory store for error resolutions with fuzzy search.
Auto-lifecycle: stale bug fixes (filesChanged mtime check), hitCount decay,
auto-archive, and TTL expiration.

Commands:
  store <error-message>      Store a new resolution or skill_patch
  search <error-message>     Find similar past resolutions
  list                       List stored entries
  get <id>                   Get entry details by ID
  confirm <id>               Confirm a resolution was effective (boosts weight)
  delete <id>                Delete an entry
  stats                      Show memory statistics
  export                     Export all entries as JSON
  extract                    Auto-generate skill_patches from findings (pipe JSON stdin)
  quality                    Memory health dashboard (requires --db)

Options:
  --resolution <text>        How the error was fixed (for store)
  --type <type>              Entry type: "error" (default) or "skill_patch" (for store)
  --target-skill <name>      Target skill name (for type:skill_patch)
  --behavior-change <text>   What to do differently (for type:skill_patch)
  --tools <list>             Comma-separated tools used (for store)
  --files <list>             Comma-separated files changed (for store)
  --category <cat>           Filter by category (for list)
  --success <bool>           Whether resolution was successful (default: true)
  --format <fmt>             Output: text, json (default: text)
  --data-dir <path>          Override data directory
  --limit <N>                Max results (default: 10 for search, 50 for list)
  --threshold <N>            Fuzzy match threshold 0-1 (default: 0.4)
  --vector                   Use hybrid vector search (TF-IDF + fuzzy, better for semantic matching)
  --vector-threshold <N>     Vector match threshold 0-1 (default: 0.1)
  --findings-file <path>     Path to findings JSON (for extract)
  --min-frequency <N>        Min occurrences to trigger patch (default: 2, for extract)
  --dry-run                  Preview without storing (for extract)
  --ttl <duration>           Auto-expire after duration (e.g. 7d, 30d, 1h) (for store)
  --keep always              Prevent auto-cleanup for this entry (for store)
  --include-archived         Include archived entries in search/list results
  --db                       Use SQLite backend (MemoryDB) instead of JSON
  --semantic                 Enable semantic search via @huggingface/transformers (implies --db)
  -h, --help                 Show this help

Examples:
  node memory-store.mjs store "TypeError: Cannot read property" --resolution "Check null" --tools "grep,debug"
  node memory-store.mjs store "When JS null pointer" --type skill_patch --target-skill debug --behavior-change "Check init first"
  node memory-store.mjs store "Temp debug note" --ttl 7d
  node memory-store.mjs store "Permanent rule" --keep always
  node memory-store.mjs search "cannot read property"
  node memory-store.mjs search "old fix" --include-archived
  node memory-store.mjs --db search "fts5 full text search"
  node memory-store.mjs --db --semantic search "semantic search via embeddings"
  node memory-store.mjs extract --findings-file ./findings.json --min-frequency 2 --dry-run
  echo '[{"category":"error","finding":"TypeError"}]' | node memory-store.mjs extract
  node memory-store.mjs stats
`);
}

/**
 * Global flags that can appear before the command name.
 */
const GLOBAL_FLAGS = new Set(['--db', '--semantic', '--data-dir', '--format', '--help', '-h']);

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  
  const knownCommands = ['store', 'search', 'list', 'get', 'confirm', 'delete', 'stats', 'export', 'extract', 'quality'];
  const opts = {
    command: null,
    commandArgs: [],
    dataDir: null,
    format: 'text',
    type: 'error',
    targetSkill: null,
    behaviorChange: null,
    resolution: null,
    tools: null,
    files: null,
    category: null,
    success: undefined,
    limit: null,
    threshold: null,
    vector: false,
    vectorThreshold: null,
    findingsFile: null,
    minFrequency: 2,
    dryRun: false,
    ttl: null,
    keep: null,
    includeArchived: false,
    auto: false,
    crossSession: false,
    db: false,
    semantic: false,
  };

  // Phase 1: Consume global flags before the command name
  let idx = 0;
  while (idx < rawArgs.length) {
    const arg = rawArgs[idx];
    if (GLOBAL_FLAGS.has(arg)) {
      switch (arg) {
        case '--db': opts.db = true; break;
        case '--semantic': opts.semantic = true; break;
        case '--data-dir': opts.dataDir = rawArgs[++idx]; break;
        case '--format': opts.format = rawArgs[++idx]; break;
        case '--help': case '-h': printHelp(); process.exit(0);
      }
      idx++;
    } else {
      break;
    }
  }

  // Remaining args: command + its flags
  const args = rawArgs.slice(idx);
  if (args.length === 0) {
    console.error('Command required. Usage: memory-store.mjs [global-flags] <command> [options]');
    process.exit(1);
  }

  opts.command = knownCommands.includes(args[0]) ? args[0] : null;
  
  if (!opts.command) {
    console.error(`Unknown command: ${args[0]}`);
    console.error(`Valid commands: ${knownCommands.join(', ')}`);
    process.exit(1);
  }
  
  // Collect positional arguments
  let i = 1;
  if (['store', 'search'].includes(opts.command)) {
    // Collect all positional args until first flag
    const positional = [];
    while (i < args.length && !args[i].startsWith('--')) {
      positional.push(args[i]);
      i++;
    }
    opts.commandArgs = positional;
  } else if (['get', 'confirm', 'delete'].includes(opts.command)) {
    if (args.length < 2) {
      console.error(`Usage: memory-store.mjs ${opts.command} <id>`);
      process.exit(1);
    }
    opts.commandArgs = [args[1]];
    i = 2;
  }
  
  while (i < args.length) {
    switch (args[i]) {
      case '--data-dir': opts.dataDir = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--type': opts.type = args[++i]; break;
      case '--target-skill': opts.targetSkill = args[++i]; break;
      case '--behavior-change': opts.behaviorChange = args[++i]; break;
      case '--resolution': opts.resolution = args[++i]; break;
      case '--tools': opts.tools = args[++i]; break;
      case '--files': opts.files = args[++i]; break;
      case '--category': opts.category = args[++i]; break;
      case '--success': opts.success = args[++i] === 'true'; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--threshold': opts.threshold = parseFloat(args[++i]); break;
      case '--vector': opts.vector = true; break;
      case '--vector-threshold': opts.vectorThreshold = parseFloat(args[++i]); break;
      case '--findings-file': opts.findingsFile = args[++i]; break;
      case '--min-frequency': opts.minFrequency = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--ttl': opts.ttl = args[++i]; break;
      case '--keep': opts.keep = args[++i]; break;
      case '--include-archived': opts.includeArchived = true; break;
      case '--agent': opts.agent = args[++i]; break;
      case '--auto': opts.auto = true; break;
      case '--miss': opts.miss = true; break;
      case '--cross-session': opts.crossSession = true; break;
      case '--db': opts.db = true; break;
      case '--semantic': opts.semantic = true; break;
    }
    i++;
  }
  
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const dataDir = getDataDir(opts.dataDir);
  const useDB = opts.db || opts.semantic;
  let result;

  // ── SQLite backend (--db or --semantic) ─────────────────────────────
  if (useDB) {
    const { db, migration } = openDB(dataDir, opts.semantic);
    if (migration && migration.migrated > 0) {
      console.error(`📀 Migrated ${migration.migrated} entries from JSON (${migration.skipped} skipped via hash dedup)`);
    }

    switch (opts.command) {
      case 'store': {
        const errorMsg = opts.commandArgs.join(' ');
        if (!errorMsg) { console.error('Error message required for store command'); process.exit(1); }
        result = await cmdStoreDB(db, errorMsg, opts);
        break;
      }
      case 'search': {
        const query = opts.commandArgs.join(' ');
        if (!query) { console.error('Search query required for search command'); process.exit(1); }
        result = await cmdSearchDB(db, query, opts);
        break;
      }
      case 'list':  result = cmdListDB(db, opts); break;
      case 'get':   result = cmdGetDB(db, opts.commandArgs[0]); break;
      case 'confirm': result = cmdConfirmDB(db, opts.commandArgs[0], opts); break;
      case 'delete': result = cmdDeleteDB(db, opts.commandArgs[0]); break;
      case 'stats': result = cmdStatsDB(db); break;
      case 'quality': result = cmdQualityDB(db); break;
      case 'export': result = cmdExportDB(db); break;
      case 'extract':
        result = cmdExtractSkillPatches(dataDir, readFindings(opts), {
          minFrequency: opts.minFrequency, dryRun: opts.dryRun,
          crossSession: opts.crossSession,
        });
        break;
      default:
        console.error(`Unknown command: ${opts.command}`);
        process.exit(1);
    }

    switch (opts.format) {
      case 'json': console.log(JSON.stringify(result, null, 2)); break;
      default:     console.log(formatText(opts.command, result)); break;
    }
    return;
  }

  // ── JSON backend (default) ─────────────────────────────────────────
  switch (opts.command) {
    case 'store': {
      const errorMsg = opts.commandArgs.join(' ');
      if (!errorMsg) { console.error('Error message required for store command'); process.exit(1); }
      result = cmdStore(dataDir, errorMsg, opts);
      break;
    }
    case 'search': {
      const query = opts.commandArgs.join(' ');
      if (!query) { console.error('Search query required for search command'); process.exit(1); }
      result = cmdSearch(dataDir, query, opts);
      break;
    }
    case 'list':  result = cmdList(dataDir, opts); break;
    case 'get':   result = cmdGet(dataDir, opts.commandArgs[0]); break;
    case 'confirm': result = cmdConfirm(dataDir, opts.commandArgs[0], opts); break;
    case 'delete': result = cmdDelete(dataDir, opts.commandArgs[0]); break;
    case 'stats': result = cmdStats(dataDir); break;
    case 'quality': result = { error: 'quality command requires --db (SQLite backend)' };
    case 'export': result = cmdExport(dataDir); break;
    case 'extract':
      result = cmdExtractSkillPatches(dataDir, readFindings(opts), {
        minFrequency: opts.minFrequency, dryRun: opts.dryRun,
        crossSession: opts.crossSession,
      });
      break;
  }
  
  switch (opts.format) {
    case 'json': console.log(JSON.stringify(result, null, 2)); break;
    default:     console.log(formatText(opts.command, result)); break;
  }
}

/**
 * Read findings from --findings-file or stdin.
 * Extracted to avoid duplication between JSON and SQLite dispatch paths.
 */
function readFindings(opts) {
  if (opts.findingsFile) {
    return JSON.parse(readFileSync(opts.findingsFile, 'utf-8'));
  }
  const stdin = readFileSync('/dev/stdin', 'utf-8').trim();
  return stdin ? JSON.parse(stdin) : [];
}

main().catch(err => { console.error(err.message); process.exit(1); });
