// auto-classifier.mjs — Tool safety classification for Auto Mode
//
// Determines whether a tool call should be auto-allowed, warned, or blocked
// based on tool type, target files, and session context.
//
// Classification levels:
//   allow  → execute without LLM notification
//   warn   → execute but annotate result "[Auto Mode] auto-approved"
//   block  → reject with explanation
//   gate   → reject, requires interactive mode (security/prerequisite gates)

// ---------------------------------------------------------------------------
// Read-only tools — always safe to auto-approve
// ---------------------------------------------------------------------------
const READ_TOOLS = new Set([
  'smart_read', 'smart_grep', 'smart_glob',
  'smart_lsp', 'smart_context', 'smart_rules',
  'smart_exa_search', 'smart_exa_crawl', 'smart_github_search',
  'smart_compact', 'smart_hallucination_check',
  'smart_think', 'smart_deep_think',
  'smart_learn', 'smart_codebase_index',
  'smart_security',   // read-only scan
]);

// ---------------------------------------------------------------------------
// Non-destructive tools — also safe
// ---------------------------------------------------------------------------
const NEUTRAL_TOOLS = new Set([
  'smart_run', 'smart_academic_search', 'smart_academic_review',
  'smart_docx_generate', 'smart_config', 'smart_smart_config',
  'smart_smart_compact',
]);

// ---------------------------------------------------------------------------
// Write-type tools — auto-approve but annotate
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set([
  'smart_fast_apply',
]);

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

// ---------------------------------------------------------------------------
// Session-aware dangerous patterns
// ---------------------------------------------------------------------------

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

  // blocks format
  if (Array.isArray(args.blocks)) {
    for (const b of args.blocks) {
      if (b.file) files.push(b.file);
    }
  }
  // changes format (hashline)
  if (Array.isArray(args.changes)) {
    for (const c of args.changes) {
      if (c.file) files.push(c.file);
    }
  }
  // whole format
  if (args.whole && args.whole.file) {
    files.push(args.whole.file);
  }
  // flat syntax
  if (args.file) files.push(args.file);

  return files;
}

// ---------------------------------------------------------------------------
// Main classification API
// ---------------------------------------------------------------------------

/**
 * Classify a tool call for auto-mode decision.
 * @param {string} toolName - full tool name (e.g. "smart_fast_apply")
 * @param {object} args - tool arguments
 * @param {object} [context] - optional session context
 * @param {Array} [context.toolHistory] - recent tool history
 * @returns {{ action: 'allow'|'warn'|'block'|'gate', reason?: string }}
 */
export function classifyTool(toolName, args, context) {
  // 1. Read tools → always allow
  if (READ_TOOLS.has(toolName)) {
    return { action: 'allow' };
  }

  // 2. Neutral tools → always allow
  if (NEUTRAL_TOOLS.has(toolName)) {
    return { action: 'allow' };
  }

  // 3. Write tools → check target files
  if (WRITE_TOOLS.has(toolName)) {
    const targetFiles = extractTargetFiles(args);

    // Blocked file check
    for (const f of targetFiles) {
      if (isBlockedFile(f)) {
        return {
          action: 'block',
          reason: `Protected file: ${f}. Switch to interactive mode to edit this file.`,
        };
      }
    }

    // Security context check: if recent security scan found issues, gate
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
          return {
            action: 'gate',
            reason: 'Security findings active — use beam search analysis before auto-apply. Switch to interactive mode or run smart_think({mode:"beam", ...}) first.',
          };
        }
      }
    }

    // Safe write → auto-approve with annotation
    return { action: 'warn', reason: 'auto-approved' };
  }

  // 4. Unknown tools → gate (require interactive)
  return {
    action: 'gate',
    reason: `Tool ${toolName} not classified for auto mode. Switch to interactive mode.`,
  };
}

/**
 * Get human-readable tool summary for status display.
 */
export function getClassificationSummary() {
  return {
    read: [...READ_TOOLS].sort(),
    neutral: [...NEUTRAL_TOOLS].sort(),
    write: [...WRITE_TOOLS].sort(),
    blockedPatterns: BLOCKED_FILE_PATTERNS,
  };
}

/**
 * Override tool classification at runtime.
 * Returns true if override was applied.
 */
export function setToolClassification(toolName, category) {
  // Remove from all sets first
  READ_TOOLS.delete(toolName);
  NEUTRAL_TOOLS.delete(toolName);
  WRITE_TOOLS.delete(toolName);

  // Add to target set
  switch (category) {
    case 'read': READ_TOOLS.add(toolName); return true;
    case 'neutral': NEUTRAL_TOOLS.add(toolName); return true;
    case 'write': WRITE_TOOLS.add(toolName); return true;
    default: return false;
  }
}
