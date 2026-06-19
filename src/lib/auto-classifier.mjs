import { resolve } from 'node:path';

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

// ---------------------------------------------------------------------------
// File risk scoring — Sprint 3: differentiate risk levels by file path
// ---------------------------------------------------------------------------

const FILE_RISK_LEVELS = [
  // Critical — system/credential files, NEVER auto-approve
  { patterns: ['.env', '.env.*', 'credentials', 'secrets', 'password', 'id_rsa', 'id_ed25519', '*.pem', '*.key'], level: 'critical', reason: 'Sensitive credentials file' },
  { patterns: ['.ssh/', '/etc/', '/usr/local/etc/', '~/.config/git/'], level: 'critical', reason: 'System-level configuration' },
  // High — user config, git config
  { patterns: ['.gitconfig', '.git-credentials', '.npmrc', '.bazelrc', '.pre-commit-config.yaml'], level: 'high', reason: 'User-level configuration' },
  { patterns: ['.zshenv', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.login'], level: 'high', reason: 'Shell configuration (affects login)' },
  // Medium — project config files
  { patterns: ['/config/', 'config.json', 'config.yaml', 'config.yml', 'config.toml', '.editorconfig', '.gitignore', 'Dockerfile', 'docker-compose', 'Makefile', '.github/'], level: 'medium', reason: 'Project configuration' },
  // Low — source code, tests, docs (default)
  { patterns: [], level: 'low', reason: 'Source code or documentation' },
];

/**
 * Get risk level and reason for a file path.
 * @param {string} filePath
 * @returns {{ level: 'low'|'medium'|'high'|'critical', reason: string }}
 */
function getFileRiskLevel(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { level: 'low', reason: 'Unknown file' };
  }
  const normalized = filePath.replace(/^~/, '').toLowerCase();
  for (const tier of FILE_RISK_LEVELS) {
    for (const pattern of tier.patterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        return { level: tier.level, reason: tier.reason };
      }
    }
  }
  return { level: 'low', reason: 'Source code or documentation' };
}

/**
 * Map risk level to auto-classifier action.
 */
function riskToAction(riskLevel) {
  const map = {
    critical: 'block',
    high: 'gate',
    medium: 'warn',
    low: 'warn',
  };
  return map[riskLevel] || 'warn';
}

/**
 * Check if a file path is inside the project boundary.
 * Simple heuristic: files outside cwd or in node_modules/.git are "outside".
 * @param {string} filePath
 * @param {string} [projectRoot]
 * @returns {boolean}
 */
function isInsideProject(filePath, projectRoot) {
  if (!filePath) return false;
  const abs = filePath.startsWith('/') ? filePath : resolve(process.cwd(), filePath);
  const root = projectRoot || process.cwd();
  if (abs.includes('/node_modules/') || abs.includes('/.git/')) return false;
  if (abs.includes('/tmp/') || abs.includes('/var/')) return false;
  return abs.startsWith(root);
}

// ---------------------------------------------------------------------------
// Context analysis — Sprint 3: extract read files + allow-once from context
// ---------------------------------------------------------------------------

/**
 * Extract recently read file paths from tool history context.
 * @param {object} [context]
 * @returns {string[]}
 */
function getRecentlyReadFiles(context) {
  if (!context || !Array.isArray(context.toolHistory)) return [];
  const readCmds = ['smart_read', 'smart_grep', 'smart_glob', 'smart_lsp'];
  const files = [];
  for (const h of context.toolHistory) {
    if (!readCmds.includes(h.tool)) continue;
    if (h.args) {
      if (h.args.file) files.push(h.args.file);
      if (Array.isArray(h.args.files)) files.push(...h.args.files);
    }
  }
  return [...new Set(files)]; // dedupe
}

/**
 * Extract allow-once paths from context (set by previous "allow once" decisions).
 * @param {object} [context]
 * @returns {Set<string>}
 */
function getAllowedOncePaths(context) {
  if (!context || !context.allowOncePaths) return new Set();
  return new Set(context.allowOncePaths);
}

// ---------------------------------------------------------------------------
// Subagent prompt analysis — Sprint 3: scan for dangerous operations in prompts
// ---------------------------------------------------------------------------

const DANGEROUS_PROMPT_PATTERNS = [
  /\b(rm|delete|remove|destroy)\s+(-rf|--recursive|\/)\b/i,
  /\b(edit|modify|change|update)\s+\.(env|ssh|gitconfig|zshrc|bashrc)\b/i,
  /\b(write|overwrite)\s+(to\s+)?\.(env|ssh)\b/i,
  /\b(install|run|exec|curl|wget)\s+(sudo|as root|--no-check-certificate)\b/i,
  /\b(chmod|chown)\s+777\b/i,
  /\b(rm|delete|remove)\s+.*\*\s*$/i,
];

/**
 * Scan a text prompt for dangerous operations.
 * @param {string} prompt
 * @returns {{ dangerous: boolean, matchedPatterns: string[], riskLevel: 'low'|'medium'|'high'|'critical' }}
 */
function scanPromptForDangerousOps(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { dangerous: false, matchedPatterns: [], riskLevel: 'low' };
  }
  const matched = [];
  for (const pattern of DANGEROUS_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) {
      matched.push(pattern.source);
    }
  }
  if (matched.length === 0) {
    return { dangerous: false, matchedPatterns: [], riskLevel: 'low' };
  }
  const riskLevel = matched.length >= 3 ? 'critical' : matched.length >= 2 ? 'high' : 'medium';
  return { dangerous: true, matchedPatterns: matched, riskLevel };
}

/**
 * Generate actionable alternative message when a tool is blocked.
 * @param {string} toolName
 * @param {string} reason
 * @param {object} [extra]
 * @returns {string}
 */
function buildBlockMessage(toolName, reason, extra = {}) {
  const lines = [reason];
  lines.push('');
  lines.push('  ─ 選項 1: smart_config({set:{mode:"interactive"}}) 切換到互動模式手動編輯');
  if (extra.riskLevel === 'critical' || extra.riskLevel === 'high') {
    lines.push('  ─ 選項 2: 使用較低風險的替代路徑（如 .env.example 或 config/ 下的範本）');
    lines.push('  ─ 選項 3: smart_rules({file:"...") 查看專案對此檔案的規範');
  } else {
    lines.push('  ─ 選項 2: ssr({tool:"error_diagnose", args:{error:"..."}}) 先診断再修改');
    lines.push('  ─ 選項 3: 先 smart_think({mode:"beam"}) 分析影響範圍再編輯');
  }
  if (extra.readFiles && extra.readFiles.length > 0) {
    lines.push('');
    lines.push(`  📖 最近讀過的檔案（已確認安全的編輯目標）:`);
    for (const f of extra.readFiles.slice(0, 3)) {
      lines.push(`     - ${f}`);
    }
  }
  return lines.join('\n');
}

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
// Sprint 3: uses risk scoring + context awareness + allow-once + guided feedback
addRule({
  name: '$defaults:write',
  priority: PRIORITY.CATEGORY_DEFAULT,
  action: 'warn',
  reason: 'auto-approved',
  builtin: true,
  match: (toolName) => toolName === 'smart_fast_apply',
  extraCheck: (toolName, args, context) => {
    const targetFiles = extractTargetFiles(args);
    if (targetFiles.length === 0) return null;

    // Priority 1: Absolute blocked file check (BLOCKED_FILE_PATTERNS)
    for (const f of targetFiles) {
      if (isBlockedFile(f)) {
        return { action: 'block', reason: buildBlockMessage(toolName, `Protected file: ${f}`, { riskLevel: 'critical' }) };
      }
    }

    // Priority 2: File risk scoring per target file
    const readFiles = context ? getRecentlyReadFiles(context) : [];
    const allowedOnce = context ? getAllowedOncePaths(context) : new Set();

    for (const f of targetFiles) {
      const risk = getFileRiskLevel(f);
      const wasRecentlyRead = readFiles.some(rf => rf.includes(f) || f.includes(rf));
      const isAllowedOnce = allowedOnce.has(f);

      // Critical → always block
      if (risk.level === 'critical' && !isAllowedOnce) {
        return { action: 'block', reason: buildBlockMessage(toolName, `High-risk file: ${f} — ${risk.reason}`, { riskLevel: risk.level, readFiles }) };
      }

      // Critical + recently read → downgrade to gate (user may be working on it)
      if (risk.level === 'critical' && isAllowedOnce) {
        return { action: 'warn' };
      }

      // High → gate (unless recently read + project internal)
      if (risk.level === 'high') {
        if (wasRecentlyRead && isInsideProject(f)) {
          return { action: 'warn', reason: 'recently-read project file' };
        }
        return { action: 'gate', reason: buildBlockMessage(toolName, `Protected file: ${f} — ${risk.reason}`, { riskLevel: risk.level, readFiles }) };
      }

      // Medium → gate if outside project
      if (risk.level === 'medium') {
        if (!isInsideProject(f) && !wasRecentlyRead) {
          return { action: 'gate', reason: buildBlockMessage(toolName, `File outside project: ${f}`, { riskLevel: risk.level, readFiles }) };
        }
      }
    }

    // Priority 3: Security context check (existing)
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
          return { action: 'block', reason: buildBlockMessage(toolName, 'Security findings active — use beam search analysis before auto-apply.', { readFiles }) };
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
      // extraCheck can return:
      //   { block: true, reason }     → old-style, map to 'block'
      //   { action: 'block'|'gate'|'warn'|'allow', reason } → new-style Sprint 3
      //   null/undefined              → passthrough, use rule default
      if (rule.extraCheck) {
        const extra = rule.extraCheck(toolName, args, context);
        if (extra && extra.action) {
          return { action: extra.action, reason: extra.reason || rule.reason };
        }
        if (extra && extra.block) {
          return { action: 'block', reason: extra.reason || rule.reason };
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

// Sprint 3 exports — risk scoring, prompt scanning, block messages
export { getFileRiskLevel, scanPromptForDangerousOps, buildBlockMessage };
