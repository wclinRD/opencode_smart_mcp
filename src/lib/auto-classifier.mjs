// auto-classifier.mjs — Rule-based tool safety classification for Auto Mode
//
// Sprint 2B upgrade: replaces hardcoded Sets with a priority-ordered rule engine.
// Supports exact-match rules, glob-pattern rules, $defaults category fallbacks,
// dynamic security-context checks, and runtime rule add/remove.
//
// Classification actions:
//   allow  → execute without LLM notification
//   warn   → execute but annotate result "[Auto Mode] auto-approved"
//   block  → reject with explanation
//   gate   → reject, requires interactive mode (security/prerequisite gates)

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

let _ruleIdCounter = 0;
const _rules = [];

// Priority levels (lower = higher priority)
const PRIORITY = {
  BLOCKED_FILE:    50,   // Protected file check — highest
  EXACT_TOOL:     100,   // Exact tool name match
  PATTERN_TOOL:   200,   // Glob/wildcard tool name match
  CATEGORY_DEFAULT: 500, // $defaults — fallback by category
  UNKNOWN:        999,   // Unknown tool fallback
};

// ---------------------------------------------------------------------------
// Protected file patterns — NEVER auto-approve writes to these
// ---------------------------------------------------------------------------

const BLOCKED_FILE_PATTERNS = [
  '.zshenv', '.zshrc', '.bashrc', '.bash_profile', '.bash_login',
  '.profile', '.login',
  '.gitconfig', '.git-credentials', '.git/config',
  '.npmrc', '.bazelrc', '.pre-commit-config.yaml',
  '.ssh/', 'id_rsa', 'id_ed25519',
  '/etc/', '/usr/local/etc/',
  '~/.config/git/',
];

/**
 * Check if a file path matches any blocked pattern.
 */
function isBlockedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/^~/, '');
  return BLOCKED_FILE_PATTERNS.some(pattern =>
    normalized.includes(pattern)
  );
}

/**
 * Extract target files from smart_fast_apply args.
 */
function extractTargetFiles(args) {
  const files = [];
  if (!args) return files;
  if (Array.isArray(args.blocks)) {
    for (const b of args.blocks) { if (b.file) files.push(b.file); }
  }
  if (Array.isArray(args.changes)) {
    for (const c of args.changes) { if (c.file) files.push(c.file); }
  }
  if (args.whole && args.whole.file) files.push(args.whole.file);
  if (args.file) files.push(args.file);
  return files;
}

// ---------------------------------------------------------------------------
// Rule API
// ---------------------------------------------------------------------------

/**
 * Add a classification rule.
 * Rules are evaluated in priority order (lower = first).
 *
 * @param {object} rule
 * @param {string} rule.name - unique rule name
 * @param {number} rule.priority - priority (lower = higher). Prefer PRIORITY constants.
 * @param {'allow'|'warn'|'block'|'gate'} rule.action - classification outcome
 * @param {function} rule.match - (toolName, args, context) => boolean | null
 * @param {string} [rule.reason] - explanation for block/gate actions
 * @param {boolean} [rule.builtin=false] - whether this is a built-in rule
 * @param {function} [rule.extraCheck] - optional (toolName, args, context) => { block?: bool, reason?: string } | null
 * @returns {string} rule id
 */
export function addRule(rule) {
  const id = `rule-${++_ruleIdCounter}`;
  _rules.push({
    id,
    name: rule.name || id,
    priority: rule.priority ?? PRIORITY.UNKNOWN,
    action: rule.action || 'gate',
    match: rule.match || (() => false),
    reason: rule.reason || '',
    builtin: rule.builtin === true,
    extraCheck: rule.extraCheck || null,
  });
  // Sort by priority ascending
  _rules.sort((a, b) => a.priority - b.priority);
  return id;
}

/**
 * Remove a rule by id or name.
 * @param {string} idOrName
 * @returns {boolean} whether a rule was removed
 */
export function removeRule(idOrName) {
  const idx = _rules.findIndex(r => r.id === idOrName || r.name === idOrName);
  if (idx >= 0) {
    _rules.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * List all registered rules.
 */
export function listRules() {
  return _rules.map(r => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    action: r.action,
    reason: r.reason,
    builtin: r.builtin,
  }));
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

// $defaults: read category — catch-all for read-like tools
addRule({
  name: '$defaults:read',
  priority: PRIORITY.CATEGORY_DEFAULT,
  action: 'allow',
  builtin: true,
  match: (toolName) =>
    toolName.startsWith('smart_read') ||
    toolName.startsWith('smart_grep') ||
    toolName.startsWith('smart_glob') ||
    toolName.startsWith('smart_exa_') ||
    toolName === 'smart_lsp' ||
    toolName === 'smart_context' ||
    toolName === 'smart_rules' ||
    toolName === 'smart_compact' ||
    toolName === 'smart_think' ||
    toolName === 'smart_deep_think' ||
    toolName === 'smart_learn' ||
    toolName === 'smart_codebase_index' ||
    toolName === 'smart_security' ||
    toolName === 'smart_hallucination_check',
});

// $defaults: neutral category — non-destructive utilities
addRule({
  name: '$defaults:neutral',
  priority: PRIORITY.CATEGORY_DEFAULT,
  action: 'allow',
  builtin: true,
  match: (toolName) =>
    toolName === 'smart_run' ||
    toolName === 'smart_config' ||
    toolName === 'smart_smart_config' ||
    toolName === 'smart_smart_compact' ||
    toolName === 'smart_hook' ||
    toolName.startsWith('smart_academic_') ||
    toolName === 'smart_docx_generate',
});

// $defaults: write category — tools that modify files
addRule({
  name: '$defaults:write',
  priority: PRIORITY.CATEGORY_DEFAULT,
  action: 'warn',
  reason: 'auto-approved',
  builtin: true,
  match: (toolName) => toolName === 'smart_fast_apply',
  extraCheck: (toolName, args, context) => {
    const targetFiles = extractTargetFiles(args);
    // Blocked file check
    for (const f of targetFiles) {
      if (isBlockedFile(f)) {
        return { block: true, reason: `Protected file: ${f}. Switch to interactive mode to edit this file.` };
      }
    }
    // Security context check
    if (context && context.toolHistory) {
      const recentScans = context.toolHistory
        .filter(h => h.tool === 'smart_security' && h.ok)
        .slice(-2);
      if (recentScans.length > 0) {
        const latestScan = new Date(recentScans[recentScans.length - 1].timestamp).getTime();
        const hasBeamAfter = context.toolHistory.some(h =>
          h.tool === 'smart_think' && h.args?.mode === 'beam' && h.ok &&
          new Date(h.timestamp).getTime() > latestScan
        );
        if (!hasBeamAfter) {
          return { block: true, reason: 'Security findings active — use beam search analysis before auto-apply. Switch to interactive mode or run smart_think({mode:"beam", ...}) first.' };
        }
      }
    }
    return null;
  },
});

// $defaults: unknown tools — gate
addRule({
  name: '$defaults:unknown',
  priority: PRIORITY.UNKNOWN,
  action: 'gate',
  builtin: true,
  match: () => true, // catch-all
  reason: 'Tool not classified for auto mode',
});

// ---------------------------------------------------------------------------
// Main classification API
// ---------------------------------------------------------------------------

/**
 * Classify a tool call for auto-mode decision.
 * Iterates rules in priority order, returns first match.
 * @param {string} toolName - full tool name
 * @param {object} args - tool arguments
 * @param {object} [context] - optional session context
 * @returns {{ action: 'allow'|'warn'|'block'|'gate', reason?: string }}
 */
export function classifyTool(toolName, args, context) {
  for (const rule of _rules) {
    try {
      if (!rule.match(toolName, args, context)) continue;

      // Run extraCheck for this rule (e.g. blocked file, security context)
      if (rule.extraCheck) {
        const extra = rule.extraCheck(toolName, args, context);
        if (extra && extra.block) {
          return { action: 'block', reason: extra.reason };
        }
      }

      return { action: rule.action, reason: rule.reason || undefined };
    } catch {
      // Rule match error — skip to next rule
      continue;
    }
  }
  // Fallback (shouldn't reach here due to catch-all)
  return { action: 'gate', reason: `Tool ${toolName} not classified for auto mode.` };
}

// ---------------------------------------------------------------------------
// Management utilities
// ---------------------------------------------------------------------------

/**
 * Get human-readable classification summary.
 */
export function getClassificationSummary() {
  const summary = { allow: [], warn: [], block: [], gate: [], blockedPatterns: BLOCKED_FILE_PATTERNS };
  for (const rule of _rules) {
    if (!summary[rule.action]) summary[rule.action] = [];
    summary[rule.action].push(rule.name);
  }
  return summary;
}

/**
 * Override a tool's classification at runtime.
 * Adds a high-priority rule before the $defaults.
 * Returns true if override was applied.
 */
export function setToolClassification(toolName, category) {
  const actionMap = { read: 'allow', neutral: 'allow', write: 'warn' };
  const action = actionMap[category];
  if (!action) return false;

  addRule({
    name: `override:${toolName}`,
    priority: PRIORITY.EXACT_TOOL,
    action,
    builtin: false,
    match: (name) => name === toolName,
  });
  return true;
}

/**
 * Remove a runtime override for a tool.
 */
export function removeToolClassification(toolName) {
  return removeRule(`override:${toolName}`);
}
