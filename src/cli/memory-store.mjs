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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createVectorizer, hybridSearch } from '../lib/embedding.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_DATA_DIR = join(HOME, '.smart', 'memory');
const MEMORY_FILE = 'resolutions.json';
const MAX_ENTRIES = 5000;

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

function cmdStore(dataDir, errorMsg, options) {
  const memory = loadMemory(dataDir);
  const hash = hashError(errorMsg);
  
  // Check if exact hash exists — update hitCount instead of duplicate
  const existing = exactHashMatch(memory, hash);
  if (existing) {
    existing.hitCount = (existing.hitCount || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    if (options.resolution) existing.resolution = options.resolution;
    if (options.success !== undefined) existing.success = options.success;
    saveMemory(dataDir, memory);
    return { stored: true, updated: true, id: existing.id, hash, hitCount: existing.hitCount };
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
  
  memory.entries.push(entry);
  saveMemory(dataDir, memory);
  
  return { stored: true, updated: false, id: entry.id, hash, category: entry.category };
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
  const threshold = options.threshold != null ? options.threshold : 0.4;
  const limit = options.limit || 10;
  
  if (memory.entries.length === 0) {
    return { found: false, count: 0, entries: [], note: 'Memory store is empty. No past resolutions available.' };
  }
  
  // 1. Exact hash match (fast path)
  const hash = hashError(query);
  const exact = exactHashMatch(memory, hash);
  if (exact) {
    // Bump hitCount
    exact.hitCount = (exact.hitCount || 1) + 1;
    exact.lastSeen = new Date().toISOString();
    saveMemory(dataDir, memory);
    return { found: true, count: 1, entries: [{ ...exact, similarity: 1.0, matchType: 'exact' }], matchType: 'exact' };
  }
  
  // 2. Vector search (if enabled) — hybrid TF-IDF + fuzzy
  if (options.vector) {
    const vectorResults = hybridSearch(query, memory.entries, {
      textKey: 'errorMessage',
      vectorWeight: 0.7,
      topK: limit,
      minScore: options.vectorThreshold != null ? options.vectorThreshold : 0.1,
    });
    if (vectorResults.length > 0) {
      return { found: true, count: vectorResults.length, entries: vectorResults, matchType: 'vector' };
    }
    // Vector returned nothing — fall through to fuzzy
  }
  
  // 3. Fuzzy search (default fallback)
  const results = fuzzySearch(memory, query, threshold, limit);
  if (results.length > 0) {
    return { found: true, count: results.length, entries: results.map(r => ({ ...r, matchType: 'fuzzy' })), matchType: 'fuzzy' };
  }
  
  return { found: false, count: 0, entries: [], matchType: 'none', note: 'No similar past resolution found in memory.' };
}

function cmdList(dataDir, options) {
  const memory = loadMemory(dataDir);
  let entries = [...memory.entries];
  
  if (options.category) {
    entries = entries.filter(e => e.category === options.category);
  }
  
  // Sort by lastSeen descending
  entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  
  const limit = options.limit || 50;
  entries = entries.slice(0, limit);
  
  return { total: memory.entries.length, shown: entries.length, entries: entries.map(e => ({
    id: e.id, type: e.type, category: e.category, errorMessage: e.errorMessage.slice(0, 120),
    resolution: e.resolution ? e.resolution.slice(0, 200) : null,
    success: e.success, hitCount: e.hitCount || 1, lastSeen: e.lastSeen, timestamp: e.timestamp,
    targetSkill: e.type === 'skill_patch' ? e.targetSkill : undefined,
    behaviorChange: e.type === 'skill_patch' ? e.behaviorChange : undefined,
  })) };
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
    return { totalEntries: 0, byCategory: {}, successRate: 0, totalHits: 0 };
  }
  
  const byCategory = {};
  let successes = 0;
  let totalHits = 0;
  
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.success) successes++;
    totalHits += e.hitCount || 1;
  }
  
  return {
    totalEntries: entries.length,
    byCategory,
    successRate: Math.round((successes / entries.length) * 100),
    totalHits,
    avgHitsPerEntry: (totalHits / entries.length).toFixed(1),
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
      break;
    }
    case 'search': {
      if (!result.found) {
        out.push('No matching past resolutions found.');
        return out.join('\n');
      }
      out.push(`Found ${result.count} past resolution(s) (${result.matchType} match):`);
      out.push('');
      for (const e of result.entries) {
        const sim = e.similarity ? ` [${(e.similarity * 100).toFixed(0)}% match]` : '';
        const status = e.success ? '✅' : '❌';
        const vecInfo = (e._vectorScore != null && e._fuzzyScore != null)
          ? ` (vector:${(e._vectorScore * 100).toFixed(0)}% fuzzy:${(e._fuzzyScore * 100).toFixed(0)}%)`
          : '';
        out.push(`  ${status} ${e.id}${sim}${vecInfo}`);
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
      out.push('');
      for (const e of result.entries) {
        const status = e.success ? '✅' : '❌';
        const typeTag = e.type === 'skill_patch' ? ' [skill_patch]' : '';
        out.push(`  ${status} ${e.id}${typeTag}`);
        out.push(`     ${e.category}: ${e.errorMessage.slice(0, 100)}`);
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
      out.push(`  Success:      ${e.success ? '✅ yes' : '❌ no'}`);
      out.push(`  Description:  ${e.errorMessage}`);
      out.push(`  Resolution:   ${e.resolution || '(none recorded)'}`);
      if (e.type === 'skill_patch') {
        out.push(`  Target Skill: ${e.targetSkill || '(not specified)'}`);
        out.push(`  Behavior:     ${e.behaviorChange || '(not specified)'}`);
      }
      if (e.toolsUsed && e.toolsUsed.length > 0) out.push(`  Tools Used:   ${e.toolsUsed.join(', ')}`);
      if (e.filesChanged && e.filesChanged.length > 0) out.push(`  Files:        ${e.filesChanged.join(', ')}`);
      out.push(`  Created:      ${e.timestamp}`);
      out.push(`  Last Seen:    ${e.lastSeen}`);
      out.push(`  Hit Count:    ${e.hitCount || 1}`);
      break;
    }
    case 'confirm': {
      if (result.confirmed) {
        out.push(`Confirmed entry: ${result.id} (total hits: ${result.hitCount}, confirmations: ${result.confirmCount})`);
        out.push(`  Error: ${result.errorMessage.slice(0, 100)}`);
        out.push(`  Weight boosted — future searches will rank this higher.`);
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
  }
  
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node memory-store.mjs <command> [options]

Lightweight memory store for error resolutions with fuzzy search.

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
  -h, --help                 Show this help

Examples:
  node memory-store.mjs store "TypeError: Cannot read property" --resolution "Check null" --tools "grep,debug"
  node memory-store.mjs store "When JS null pointer" --type skill_patch --target-skill debug --behavior-change "Check init first"
  node memory-store.mjs search "cannot read property"
  node memory-store.mjs extract --findings-file ./findings.json --min-frequency 2 --dry-run
  echo '[{"category":"error","finding":"TypeError"}]' | node memory-store.mjs extract
  node memory-store.mjs stats
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  
  const knownCommands = ['store', 'search', 'list', 'get', 'confirm', 'delete', 'stats', 'export', 'extract'];
  const opts = {
    command: knownCommands.includes(args[0]) ? args[0] : null,
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
  };
  
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
    }
    i++;
  }
  
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const dataDir = getDataDir(opts.dataDir);
  let result;
  
  switch (opts.command) {
    case 'store': {
      const errorMsg = opts.commandArgs.join(' ');
      if (!errorMsg) {
        console.error('Error message required for store command');
        process.exit(1);
      }
      result = cmdStore(dataDir, errorMsg, opts);
      break;
    }
    case 'search': {
      const query = opts.commandArgs.join(' ');
      if (!query) {
        console.error('Search query required for search command');
        process.exit(1);
      }
      result = cmdSearch(dataDir, query, opts);
      break;
    }
    case 'list':
      result = cmdList(dataDir, opts);
      break;
    case 'get':
      result = cmdGet(dataDir, opts.commandArgs[0]);
      break;
    case 'confirm':
      result = cmdConfirm(dataDir, opts.commandArgs[0], opts);
      break;
    case 'delete':
      result = cmdDelete(dataDir, opts.commandArgs[0]);
      break;
    case 'stats':
      result = cmdStats(dataDir);
      break;
    case 'export':
      result = cmdExport(dataDir);
      break;
    case 'extract': {
      // Read findings from a file or stdin (pipe)
      let findings;
      if (opts.findingsFile) {
        findings = JSON.parse(readFileSync(opts.findingsFile, 'utf-8'));
      } else {
        try {
          const stdin = readFileSync('/dev/stdin', 'utf-8').trim();
          if (!stdin) {
            console.error('Findings required. Pipe JSON via stdin or use --findings-file');
            process.exit(1);
          }
          findings = JSON.parse(stdin);
        } catch {
          console.error('Failed to read findings from stdin. Pipe JSON or use --findings-file');
          process.exit(1);
        }
      }
      result = cmdExtractSkillPatches(dataDir, findings, {
        minFrequency: opts.minFrequency,
        dryRun: opts.dryRun,
      });
      break;
    }
  }
  
  switch (opts.format) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;
    default:
      console.log(formatText(opts.command, result));
      break;
  }
}

main();
