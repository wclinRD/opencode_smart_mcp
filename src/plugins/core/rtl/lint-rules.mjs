/**
 * Configurable Lint Rule Engine for RTL
 * 
 * 可配置的 lint 規則，支援：
 * - Naming conventions (snake_case, prefix/suffix)
 * - Style rules (always_comb vs always@*, explicit begin)
 * - Completeness checks (incomplete case/if)
 * - Latch inference detection
 * - Width mismatch
 * - Reset style (async vs sync)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// Built-in Rules
// ═══════════════════════════════════════════════════════════════════════════

const BUILT_IN_RULES = {
  // ── Naming Rules ──────────────────────────────────────────────────────
  'naming-signal-style': {
    id: 'naming-signal-style',
    category: 'naming',
    severity: 'warning',
    description: 'Signal names should follow lower_snake_case',
    regex: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
    appliesTo: ['signal', 'port'],
    fix: 'Rename signal to lower_snake_case',
  },
  'naming-module-style': {
    id: 'naming-module-style',
    category: 'naming',
    severity: 'warning',
    description: 'Module names should follow lower_snake_case',
    regex: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
    appliesTo: ['module'],
    fix: 'Rename module to lower_snake_case',
  },
  'naming-clock-prefix': {
    id: 'naming-clock-prefix',
    category: 'naming',
    severity: 'info',
    description: 'Clock signals should start with clk_ or end with _clk',
    pattern: /^(clk_|_clk$|clock_|_clock$)/,
    appliesTo: ['signal'],
    context: 'clock',
    fix: 'Use clk_ prefix or _clk suffix for clock signals',
  },
  'naming-reset-prefix': {
    id: 'naming-reset-prefix',
    category: 'naming',
    severity: 'info',
    description: 'Reset signals should use rst_n/reset_n convention',
    pattern: /^(rst_n|reset_n|arst_n|rst|reset|arst)$/,
    appliesTo: ['signal'],
    context: 'reset',
    fix: 'Use rst_n or reset_n for active-low reset',
  },
  'naming-prefix-i-o': {
    id: 'naming-prefix-i-o',
    category: 'naming',
    severity: 'warning',
    description: 'Ports should use i_/o_ prefix or no prefix',
    appliesTo: ['port'],
    fix: 'Add i_/o_ prefix to distinguish input/output ports',
  },

  // ── Style Rules ───────────────────────────────────────────────────────
  'style-always-comb': {
    id: 'style-always-comb',
    category: 'style',
    severity: 'warning',
    description: 'Use always_comb instead of always @*',
    pattern: /always\s+@\s*\*/,
    replacement: 'always_comb',
    fix: 'Replace "always @*" with "always_comb"',
  },
  'style-explicit-begin': {
    id: 'style-explicit-begin',
    category: 'style',
    severity: 'warning',
    description: 'if/else/for/while should have explicit begin/end',
    pattern: /\b(if|else|for|while)\s*\(.*?\)\s+(?!begin\b)/,
    fix: 'Add begin/end block after if/else/for/while',
  },
  'style-endif-else': {
    id: 'style-endif-else',
    category: 'style',
    severity: 'info',
    description: 'Avoid empty else blocks',
    pattern: /\belse\s*;\s*$/,
    fix: 'Remove empty else or add logic',
  },

  // ── Completeness Rules ────────────────────────────────────────────────
  'completeness-case': {
    id: 'completeness-case',
    category: 'completeness',
    severity: 'warning',
    description: 'case statement should have default or full coverage',
    pattern: /case\s*\(/,
    check: 'caseCompleteness',
    fix: 'Add default case or full coverage',
  },
  'completeness-if-else': {
    id: 'completeness-if-else',
    category: 'completeness',
    severity: 'warning',
    description: 'if without else may infer latch',
    pattern: /\bif\s*\(/,
    check: 'ifElseCompleteness',
    fix: 'Add else branch or assign default values',
  },

  // ── Latch Rules ───────────────────────────────────────────────────────
  'latch-inference': {
    id: 'latch-inference',
    category: 'latch',
    severity: 'error',
    description: 'Combinational block may infer latch (incomplete assignment)',
    check: 'latchInference',
    fix: 'Add default assignment at top of always_comb block',
  },

  // ── Reset Rules ───────────────────────────────────────────────────────
  'reset-async': {
    id: 'reset-async',
    category: 'reset',
    severity: 'info',
    description: 'Use asynchronous reset (negedge rst_n in sensitivity list)',
    check: 'resetStyle',
    fix: 'Add negedge rst_n to sensitivity list for async reset',
  },
  'reset-sync': {
    id: 'reset-sync',
    category: 'reset',
    severity: 'info',
    description: 'Use synchronous reset (no reset in sensitivity list)',
    check: 'resetStyle',
    fix: 'Remove reset from sensitivity list for sync reset',
  },

  // ── Width Rules ───────────────────────────────────────────────────────
  'width-mismatch': {
    id: 'width-mismatch',
    category: 'width',
    severity: 'warning',
    description: 'Assignment width mismatch may cause truncation',
    check: 'widthMismatch',
    fix: 'Match bit widths or use explicit truncation',
  },

  // ── Sensitivity List Rules ────────────────────────────────────────────
  'sensitivity-complete': {
    id: 'sensitivity-complete',
    category: 'sensitivity',
    severity: 'warning',
    description: 'Sensitivity list may be incomplete (missing signals)',
    check: 'sensitivityCompleteness',
    fix: 'Add missing signals or use always @*',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Rule Categories for Grouping
// ═══════════════════════════════════════════════════════════════════════════

const RULE_CATEGORIES = {
  naming: { name: 'Naming Conventions', icon: '🏷️' },
  style: { name: 'Code Style', icon: '✨' },
  completeness: { name: 'Completeness', icon: '📋' },
  latch: { name: 'Latch Detection', icon: '🔒' },
  reset: { name: 'Reset Style', icon: '🔄' },
  width: { name: 'Width Checks', icon: '📏' },
  sensitivity: { name: 'Sensitivity List', icon: '📡' },
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run lint rules on RTL files
 * @param {string} root - 專案根目錄
 * @param {Object} options - { rules: string[], exclude: string[], severity: string }
 * @returns {Object} Lint results
 */
export function runLintRules(root, options = {}) {
  const { rules: ruleFilter, exclude = [], severity: sevFilter } = options;

  // Load custom rules from .rtl-lint.json if exists
  const customRules = loadCustomRules(root);
  const allRules = { ...BUILT_IN_RULES, ...customRules };

  // Filter rules
  let activeRules = Object.values(allRules);
  if (ruleFilter && ruleFilter.length > 0) {
    activeRules = activeRules.filter(r => ruleFilter.includes(r.id));
  }
  if (sevFilter) {
    activeRules = activeRules.filter(r => r.severity === sevFilter);
  }

  // Scan RTL files
  const rtlFiles = scanRtlFiles(root);
  const violations = [];

  for (const file of rtlFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const fileViolations = checkFile(file, lines, content, activeRules);
      violations.push(...fileViolations);
    } catch {
      // skip unreadable files
    }
  }

  // Group by category
  const byCategory = {};
  for (const v of violations) {
    const cat = v.rule.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(v);
  }

  // Stats
  const stats = {
    totalFiles: rtlFiles.length,
    totalViolations: violations.length,
    bySeverity: {
      error: violations.filter(v => v.rule.severity === 'error').length,
      warning: violations.filter(v => v.rule.severity === 'warning').length,
      info: violations.filter(v => v.rule.severity === 'info').length,
    },
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, vs]) => [cat, vs.length])
    ),
  };

  return {
    ok: true,
    violations,
    byCategory,
    stats,
    rules: activeRules.map(r => ({ id: r.id, category: r.category, severity: r.severity, description: r.description })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// File-level Checking
// ═══════════════════════════════════════════════════════════════════════════

function checkFile(file, lines, content, rules) {
  const violations = [];
  const shortFile = file.replace(/^.*\//, '');

  for (const rule of rules) {
    // Regex-based rules
    if (rule.regex && rule.appliesTo) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

        // Check appliesTo context
        const context = guessContext(trimmed);
        if (rule.appliesTo && !rule.appliesTo.includes(context)) continue;

        if (rule.regex.test(trimmed)) {
          violations.push({
            rule: { id: rule.id, category: rule.category, severity: rule.severity, description: rule.description },
            file: shortFile,
            line: i + 1,
            column: trimmed.search(rule.regex) + 1,
            message: rule.description,
            code: trimmed,
            fix: rule.fix,
          });
        }
      }
    }

    // Pattern-based rules (simple string match)
    if (rule.pattern && !rule.regex && rule.appliesTo) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

        const context = guessContext(trimmed);
        if (rule.appliesTo && !rule.appliesTo.includes(context)) continue;

        if (rule.pattern.test(trimmed)) {
          violations.push({
            rule: { id: rule.id, category: rule.category, severity: rule.severity, description: rule.description },
            file: shortFile,
            line: i + 1,
            column: 0,
            message: rule.description,
            code: trimmed,
            fix: rule.fix,
          });
        }
      }
    }

    // Check-function based rules (complex analysis)
    if (rule.check) {
      const checkFn = CHECK_FUNCTIONS[rule.check];
      if (checkFn) {
        const found = checkFn(lines, content, rule);
        for (const v of found) {
          violations.push({
            rule: { id: rule.id, category: rule.category, severity: rule.severity, description: rule.description },
            file: shortFile,
            ...v,
          });
        }
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════
// Check Functions (complex analysis)
// ═══════════════════════════════════════════════════════════════════════════

const CHECK_FUNCTIONS = {
  // Check if case statement has default
  caseCompleteness(lines, content, rule) {
    const violations = [];
    const caseRe = /case\s*\((\w+)\)/g;
    let match;
    while ((match = caseRe.exec(content))) {
      const caseVar = match[1];
      const startIdx = content.indexOf(match[0]);
      // Find matching endcase
      const endcaseIdx = content.indexOf('endcase', startIdx);
      if (endcaseIdx === -1) continue;
      const caseBody = content.slice(startIdx, endcaseIdx);
      if (!caseBody.includes('default')) {
        const lineNum = content.slice(0, startIdx).split('\n').length;
        violations.push({
          line: lineNum,
          column: 0,
          message: `case(${caseVar}) has no default branch`,
          code: match[0],
          fix: 'Add default: /* do nothing */ or full case coverage',
        });
      }
    }
    return violations;
  },

  // Check if if has else
  ifElseCompleteness(lines, content, rule) {
    const violations = [];
    // Simplified: check for if without else in same scope
    const ifRe = /\bif\s*\([^)]+\)\s*(?:begin[\s\S]*?end|[^;]+;)/g;
    let match;
    while ((match = ifRe.exec(content))) {
      const after = content.slice(match.index + match[0].length, match.index + match[0].length + 50);
      if (!after.trim().startsWith('else')) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        violations.push({
          line: lineNum,
          column: 0,
          message: 'if without else may infer latch',
          code: match[0].slice(0, 60),
          fix: 'Add else branch with default assignment',
        });
      }
    }
    return violations;
  },

  // Detect latch inference (combinational always with incomplete assignments)
  latchInference(lines, content, rule) {
    const violations = [];
    // Find always @* blocks
    const alwaysRe = /always\s+@\s*\*[\s\S]*?end/g;
    let match;
    while ((match = alwaysRe.exec(content))) {
      const block = match[0];
      // Check for if without else or case without default
      const hasIf = /\bif\s*\(/.test(block);
      const hasIfElse = /\bif\s*\([\s\S]*?\)\s*[\s\S]*?\belse\b/.test(block);
      const hasCase = /\bcase[xz]?\s*\(/.test(block);
      const hasDefault = /\bdefault\b/.test(block);

      if ((hasIf && !hasIfElse) || (hasCase && !hasDefault)) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        violations.push({
          line: lineNum,
          column: 0,
          message: 'Combinational block may infer latch (incomplete assignment)',
          code: block.slice(0, 80),
          fix: 'Add default assignment at top of always_comb or complete all branches',
        });
      }
    }
    return violations;
  },

  // Check reset style
  resetStyle(lines, content, rule) {
    const violations = [];
    // Find always @(posedge clk or negedge rst_n) — async
    const asyncRe = /always\s*@\s*\(\s*posedge\s+\w+\s+or\s+negedge\s+(\w+)/g;
    let match;
    while ((match = asyncRe.exec(content))) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      violations.push({
        line: lineNum,
        column: 0,
        message: `Asynchronous reset detected (${match[1]})`,
        code: match[0],
        fix: 'Consider sync reset for better timing closure',
      });
    }
    return violations;
  },

  // Width mismatch (simplified)
  widthMismatch(lines, content, rule) {
    const violations = [];
    // Check for assignment like: assign x = 1'b1; where x is wider
    const assignRe = /\bassign\s+(\w+)\s*=\s*(\d+)'([bdh])(\d+)\s*;/g;
    let match;
    while ((match = assignRe.exec(content))) {
      const width = parseInt(match[2]);
      const val = match[4];
      // If constant is 1 bit but assigned to multi-bit, possible issue
      if (width === 1 && val.length > 1) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        violations.push({
          line: lineNum,
          column: 0,
          message: `Width mismatch: 1-bit constant assigned to wider signal`,
          code: match[0],
          fix: 'Match constant width to signal width',
        });
      }
    }
    return violations;
  },

  // Sensitivity list completeness
  sensitivityCompleteness(lines, content, rule) {
    const violations = [];
    // Find always @(a, b) blocks
    const sensRe = /always\s*@\s*\(([^)]+)\)/g;
    let match;
    while ((match = sensRe.exec(content))) {
      const sensList = match[1].split(',').map(s => s.trim().replace(/^(posedge|negedge)\s+/, ''));
      const blockStart = match.index;
      // Find end of block
      const blockEnd = content.indexOf('end', blockStart + match[0].length);
      if (blockEnd === -1) continue;
      const block = content.slice(blockStart, blockEnd);

      // Find all signals read in block (simplified)
      const readRe = /\b(\w+)\s*(?:<=|=[^=]|==|!=|&&|\|\||[+\-*/])/g;
      const readSignals = new Set();
      let rMatch;
      while ((rMatch = readRe.exec(block))) {
        const sig = rMatch[1];
        if (!['if', 'else', 'case', 'begin', 'end', 'always', 'assign', 'wire', 'reg'].includes(sig)) {
          readSignals.add(sig);
        }
      }

      // Check missing signals
      for (const sig of readSignals) {
        if (!sensList.includes(sig) && !sensList.includes('*')) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          violations.push({
            line: lineNum,
            column: 0,
            message: `Missing "${sig}" in sensitivity list`,
            code: match[0],
            fix: `Add ${sig} to sensitivity list or use always @*`,
          });
          break; // One violation per block is enough
        }
      }
    }
    return violations;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function guessContext(line) {
  if (/\breg\b/.test(line) || /\bwire\b/.test(line)) return 'signal';
  if (/\bmodule\b/.test(line)) return 'module';
  if (/\binput\b/.test(line) || /\boutput\b/.test(line)) return 'port';
  if (/\bposedge\b.*\b(clk|clock)\b/.test(line) || /\bnegedge\b.*\b(clk|clock)\b/.test(line)) return 'clock';
  if (/\bposedge\b.*\b(rst|reset)\b/.test(line) || /\bnegedge\b.*\b(rst|reset)\b/.test(line)) return 'reset';
  return 'unknown';
}

function loadCustomRules(root) {
  const configPath = join(root, '.rtl-lint.json');
  if (!existsSync(configPath)) return {};
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const custom = {};
    if (config.rules && Array.isArray(config.rules)) {
      for (const r of config.rules) {
        if (r.id && r.regex) {
          custom[r.id] = {
            ...r,
            regex: new RegExp(r.regex, r.flags || ''),
          };
        }
      }
    }
    return custom;
  } catch {
    return {};
  }
}

function scanRtlFiles(root) {
  const files = [];
  const exts = new Set(['.v', '.sv', '.vh', '.svh']);
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', 'build', 'dist']);

  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else if (exts.has(extname(entry))) files.push(full);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  walk(root);
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export { BUILT_IN_RULES, RULE_CATEGORIES };
