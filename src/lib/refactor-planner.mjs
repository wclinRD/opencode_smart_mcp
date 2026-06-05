// refactor-planner.mjs — Migration plan generator for CKG-based refactoring assistant
//
// Takes CKG usage pattern analysis and generates a structured, ordered migration plan.
// Part of Phase C.1: CKG-based refactoring assistant.
//
// API:
//   generateMigrationPlan(usageResult, opts) → { steps, summary, warnings }
//   estimateDifficulty(usageResult)           → { score, label, reason }

import { relative, resolve, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize file path for comparison */
function normPath(p) { return p.replace(/\\/g, '/'); }

/** Score migration difficulty from 1 (trivial) to 10 (very hard) */
export function estimateDifficulty(usageResult) {
  const { totalUsages, patterns } = usageResult;
  if (!totalUsages) return { score: 0, label: 'none', reason: 'No usages found' };

  let base = 0;

  // Factor 1: volume
  if (totalUsages <= 3) base += 2;
  else if (totalUsages <= 10) base += 4;
  else if (totalUsages <= 30) base += 6;
  else base += 8;

  // Factor 2: pattern diversity
  const patternCount = patterns.length;
  if (patternCount > 1) {
    base += Math.min(patternCount * 0.5, 2);
  }

  // Factor 3: event-handler patterns are harder (need callbacks)
  const eventCount = (patterns.find(p => p.type === 'event-handler')?.count || 0);
  if (eventCount > 0) base += 1;

  // Factor 4: class-method patterns may need interface changes
  const classCount = (patterns.find(p => p.type === 'class-method')?.count || 0);
  if (classCount > 0) base += 1;

  const score = Math.min(Math.round(base), 10);

  const labels = {
    1: 'trivial', 2: 'easy', 3: 'straightforward',
    4: 'moderate', 5: 'moderate', 6: 'moderate',
    7: 'complex', 8: 'complex', 9: 'very-complex', 10: 'very-complex',
  };

  let reason;
  if (score <= 2) reason = `Only ${totalUsages} simple usage(s)`;
  else if (score <= 4) reason = `${totalUsages} usages across ${new Set(usageResult.usages.map(u => u.caller.file)).size} file(s)`;
  else if (score <= 6) reason = `${totalUsages} usages with mixed patterns (${patterns.map(p => `${p.type}: ${p.count}`).join(', ')})`;
  else reason = `Large migration: ${totalUsages} usages across multiple files and patterns`;

  return { score, label: labels[score] || 'unknown', reason };
}

// ---------------------------------------------------------------------------
// Migration Plan Generation
// ---------------------------------------------------------------------------

/**
 * Generate a structured migration plan from CKG usage pattern analysis.
 *
 * @param {object} usageResult - Output of CkgEngine.queryUsagePatterns()
 * @param {object} [opts]
 * @param {string} [opts.newApi]      - Name of the replacement API (optional)
 * @param {string} [opts.newSignature] - New signature / usage pattern (optional)
 * @param {string} [opts.goal]        - Migration goal description (optional)
 * @param {number} [opts.safetyThreshold=5] - Warn if more than N files affected
 * @param {string[]} [opts.excludeFiles]  - Files to exclude from migration
 * @returns {object} { steps, summary, warnings }
 */
export function generateMigrationPlan(usageResult, opts = {}) {
  const { symbol, file, totalUsages, usages, patterns } = usageResult;
  const safetyThreshold = opts.safetyThreshold ?? 5;
  const excludeSet = new Set((opts.excludeFiles || []).map(f => normPath(f)));

  if (!totalUsages || !usages || usages.length === 0) {
    return {
      steps: [],
      summary: {
        symbol,
        file,
        totalUsages: 0,
        filesAffected: 0,
        difficulty: estimateDifficulty(usageResult),
      },
      warnings: [`No usages found for ${symbol}. API may not be indexed.`],
      api: { symbol, file },
    };
  }

  // Group usages by file
  const fileGroups = {};
  for (const u of usages) {
    const f = normPath(u.caller.file);
    if (excludeSet.has(f)) continue;
    if (!fileGroups[f]) fileGroups[f] = [];
    fileGroups[f].push(u);
  }

  const filesAffected = Object.keys(fileGroups).length;
  const warnings = [];

  // Safety gate
  if (filesAffected > safetyThreshold) {
    warnings.push(
      `Migration affects ${filesAffected} files (threshold: ${safetyThreshold}). ` +
      `Requires explicit confirmation before proceeding.`
    );
  }

  // Check for high-risk patterns
  const highRiskPatterns = patterns.filter(p =>
    p.type === 'event-handler' || p.type === 'factory'
  );
  for (const p of highRiskPatterns) {
    warnings.push(`Pattern "${p.type}" (${p.count} usages) may require API signature changes.`);
  }

  // Build steps — ordered by dependency and risk
  const steps = [];
  let stepNum = 0;

  // Step 1: Documentation / understanding
  stepNum++;
  steps.push({
    step: stepNum,
    action: 'analyze',
    title: `Analyze ${symbol} usage`,
    description: `Review all ${totalUsages} usages of ${symbol} across ${filesAffected} files. ` +
      `Patterns: ${patterns.map(p => `${p.type}(${p.count})`).join(', ')}.`,
    affectedFiles: Object.keys(fileGroups),
    details: patterns.map(p => `  ${p.count}x ${p.type} — ${p.description}`),
  });

  // Step 2: Simple direct replacements (per file)
  const directFiles = Object.entries(fileGroups)
    .filter(([, us]) => us.every(u => u.pattern === 'direct-call'))
    .map(([f]) => f);

  if (directFiles.length > 0) {
    stepNum++;
    steps.push({
      step: stepNum,
      action: 'replace',
      title: `Update direct calls in ${directFiles.length} file(s)`,
      description: `Simple search-and-replace of ${symbol} calls` +
        (opts.newApi ? ` to ${opts.newApi}` : '') +
        (opts.newSignature ? ` with new signature: ${opts.newSignature}` : ''),
      affectedFiles: directFiles,
      usages: directFiles.flatMap(f => fileGroups[f].map(u => ({
        file: f,
        line: u.caller.line,
        caller: u.caller.name,
        pattern: u.pattern,
      }))),
    });
  }

  // Step 3: Module init patterns (need import changes)
  const initFiles = Object.entries(fileGroups)
    .filter(([, us]) => us.some(u => u.pattern === 'module-init'))
    .map(([f]) => f);

  if (initFiles.length > 0) {
    stepNum++;
    steps.push({
      step: stepNum,
      action: 'modify-init',
      title: `Update module initialization in ${initFiles.length} file(s)`,
      description: `Module-scope ${symbol} usage requires import and init changes`,
      affectedFiles: initFiles,
      usages: initFiles.flatMap(f => fileGroups[f].filter(u => u.pattern === 'module-init').map(u => ({
        file: f,
        line: u.caller.line,
        caller: u.caller.name,
      }))),
    });
  }

  // Step 4: Class method patterns (may need interface changes)
  const classFiles = Object.entries(fileGroups)
    .filter(([, us]) => us.some(u => u.pattern === 'class-method'))
    .map(([f]) => f);

  if (classFiles.length > 0) {
    stepNum++;
    steps.push({
      step: stepNum,
      action: 'update-class',
      title: `Update class method calls in ${classFiles.length} file(s)`,
      description: `Class method usage of ${symbol} may need interface/type updates`,
      affectedFiles: classFiles,
      risk: 'medium',
      usages: classFiles.flatMap(f => fileGroups[f].filter(u => u.pattern === 'class-method').map(u => ({
        file: f,
        line: u.caller.line,
        caller: u.caller.name,
        container: u.caller.container,
      }))),
    });
  }

  // Step 5: Event handler patterns (high risk)
  const eventFiles = Object.entries(fileGroups)
    .filter(([, us]) => us.some(u => u.pattern === 'event-handler'))
    .map(([f]) => f);

  if (eventFiles.length > 0) {
    stepNum++;
    steps.push({
      step: stepNum,
      action: 'update-handler',
      title: `Update event handlers in ${eventFiles.length} file(s)`,
      description: `Event handler usages of ${symbol} (on* / handle* functions) may need callback signature alignment`,
      affectedFiles: eventFiles,
      risk: 'high',
      usages: eventFiles.flatMap(f => fileGroups[f].filter(u => u.pattern === 'event-handler').map(u => ({
        file: f,
        line: u.caller.line,
        caller: u.caller.name,
      }))),
    });
  }

  // Step 6: Factory patterns (medium risk)
  const factoryFiles = Object.entries(fileGroups)
    .filter(([, us]) => us.some(u => u.pattern === 'factory'))
    .map(([f]) => f);

  if (factoryFiles.length > 0) {
    stepNum++;
    steps.push({
      step: stepNum,
      action: 'update-factory',
      title: `Update factory/creator functions in ${factoryFiles.length} file(s)`,
      description: `Factory/creator functions using ${symbol} may need return type adjustments`,
      affectedFiles: factoryFiles,
      risk: 'medium',
      usages: factoryFiles.flatMap(f => fileGroups[f].filter(u => u.pattern === 'factory').map(u => ({
        file: f,
        line: u.caller.line,
        caller: u.caller.name,
      }))),
    });
  }

  // Step 7: Validation / test run
  stepNum++;
  steps.push({
    step: stepNum,
    action: 'verify',
    title: 'Verify migration',
    description: 'Run tests and type check to ensure migration is complete',
    affectedFiles: Object.keys(fileGroups),
  });

  const difficulty = estimateDifficulty(usageResult);

  return {
    api: { symbol, file, newApi: opts.newApi || null, newSignature: opts.newSignature || null },
    steps,
    summary: {
      symbol,
      file,
      totalUsages,
      filesAffected,
      difficulty,
      goal: opts.goal || `Migrate usages of ${symbol}`,
    },
    warnings,
  };
}
