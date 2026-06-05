// impact-engine.mjs — Change-Impact Pipeline Engine
//
// Builds on CKG + LSP to provide full change-impact analysis:
//   git diff → changed symbols → CKG call graph propagation → test prediction
//
// Compared to smart_code_impact (LSP-only), this engine:
// - Uses CKG for fast, persistent graph traversal (no LSP latency)
// - Adds test prediction (which tests cover impacted code)
// - Provides structured output ready for workflow consumption
// - Falls back to LSP when CKG data is unavailable or stale
//
// Dependencies:
//   - CKG engine (ckg-engine.mjs) for graph queries
//   - LSP bridge (lsp-bridge.mjs) for fallback
//
// API:
//   class ImpactEngine
//     constructor(root, { ckgEngine, lspBridge } = {})
//     parseDiff(diffText) → { changes }
//     getChangedSymbols(changes) → { symbols }
//     propagateImpact(symbols, depth) → { direct, transitive, stats }
//     predictTests(impactResult) → { tests }
//     analyzeImpact({ diff, files, symbols, depth, predictTests }) → { full result }

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { getCkgEngine } from './ckg-engine.mjs';
import { getLspBridge } from './lsp-bridge.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default impact analysis depth */
const DEFAULT_DEPTH = 2;

/** Maximum allowed depth */
const MAX_DEPTH = 3;

/** Test file patterns for prediction */
const TEST_PATTERNS = [
  /\.test\.(js|ts|jsx|tsx|mjs)$/,
  /\.spec\.(js|ts|jsx|tsx|mjs)$/,
  /\.(test|spec)\.(js|ts)$/,
  /__tests__\//,
  /__test__\//,
  /test\//,
  /tests\//,
  /spec\//,
];

// ---------------------------------------------------------------------------
// ImpactEngine
// ---------------------------------------------------------------------------

export class ImpactEngine {
  /**
   * @param {string} root - Project root path
   * @param {object} [opts]
   * @param {object} [opts.ckgEngine] - External CKG engine instance
   * @param {object} [opts.lspBridge] - External LSP bridge instance
   */
  constructor(root, opts = {}) {
    this.root = resolve(root || '.');
    this._ckg = opts.ckgEngine || null;
    this._lsp = opts.lspBridge || null;
  }

  // -----------------------------------------------------------------------
  // Lazy init helpers
  // -----------------------------------------------------------------------

  /** @returns {object} CKG engine (lazy init) */
  _getCkg() {
    if (!this._ckg) {
      try { this._ckg = getCkgEngine(this.root); }
      catch { this._ckg = null; }
    }
    return this._ckg;
  }

  /** @returns {object} LSP bridge (lazy init) */
  _getLsp() {
    if (!this._lsp) {
      try { this._lsp = getLspBridge(this.root); }
      catch { this._lsp = null; }
    }
    return this._lsp;
  }

  // -----------------------------------------------------------------------
  // 1. Diff parsing
  // -----------------------------------------------------------------------

  /**
   * Parse git diff text to extract changed files and line ranges.
   * Enhanced from code-impact.mjs parseDiff with per-file change list.
   * @param {string} diffText - git diff output
   * @returns {object[]} [{ file, startLine, lineCount, isNew, isDeleted }]
   */
  parseDiff(diffText) {
    if (!diffText || typeof diffText !== 'string') return [];

    const changes = [];
    const lines = diffText.split('\n');
    let currentFile = null;
    let currentIsNew = false;
    let currentIsDeleted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track file headers
      const newFileMatch = line.match(/^--- a\/(.+)/);
      if (newFileMatch) {
        currentFile = newFileMatch[1];
        currentIsNew = false;
        currentIsDeleted = false;
        continue;
      }
      const toFileMatch = line.match(/^\+\+\+ b\/(.+)/);
      if (toFileMatch) {
        currentFile = toFileMatch[1];
        continue;
      }

      // Detect new/deleted files
      if (line.startsWith('new file mode')) currentIsNew = true;
      if (line.startsWith('deleted file mode')) currentIsDeleted = true;

      // Hunk headers
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch && currentFile) {
        changes.push({
          file: currentFile,
          startLine: parseInt(hunkMatch[1], 10),
          lineCount: parseInt(hunkMatch[2] || '1', 10),
          isNew: currentIsNew,
          isDeleted: currentIsDeleted,
        });
      }
    }

    return changes;
  }

  // -----------------------------------------------------------------------
  // 2. Changed symbol identification
  // -----------------------------------------------------------------------

  /**
   * Identify symbols affected by the parsed changes.
   * Uses CKG first (fast), falls back to LSP documentSymbol.
   * @param {object[]} changes - Output of parseDiff()
   * @returns {object[]} [{ file, symbol, kind, line, signature }]
   */
  async getChangedSymbols(changes) {
    const result = [];
    const fileCache = new Map(); // file → CKG symbols[]

    for (const change of changes) {
      const filePath = resolve(this.root, change.file);
      if (!existsSync(filePath)) continue;

      // Try CKG first
      const ckg = this._getCkg();
      let symbols = [];

      if (ckg) {
        if (!fileCache.has(change.file)) {
          const symbolsInFile = this._getFileSymbolsFromCkg(ckg, change.file);
          fileCache.set(change.file, symbolsInFile);
        }
        symbols = fileCache.get(change.file) || [];
      }

      // Fallback to LSP if CKG had no symbols
      if (symbols.length === 0) {
        symbols = await this._getFileSymbolsFromLsp(change.file);
        if (symbols.length > 0) {
          fileCache.set(change.file, symbols);
        }
      }

      // Filter symbols overlapping with change hunks
      for (const sym of symbols) {
        if (sym.line === undefined || sym.line === null) continue;

        // Check if symbol overlaps with any hunk
        const inHunk = this._symbolOverlapsHunk(sym.line, sym.endLine || sym.line, change);
        if (inHunk) {
          result.push({
            file: change.file,
            symbol: sym.name,
            kind: sym.kind,
            line: sym.line,
            signature: sym.signature || '',
          });
        }
      }
    }

    return result;
  }

  /**
   * Get exported symbols for a file from CKG.
   * Accesses internal CKG state (same package, intentional coupling).
   * @param {object} ckg - CKG engine
   * @param {string} file - File path relative to root
   * @returns {object[]}
   */
  _getFileSymbolsFromCkg(ckg, file) {
    try {
      const db = ckg._getDb();
      if (!db) return [];
      // _projectId is a regular property (not truly private), accessible to internal consumers
      const projectId = ckg._projectId;
      if (!projectId) return [];

      return db.prepare(
        `SELECT n.name, n.kind, n.range_start_line as line, n.range_end_line as endLine, n.signature
         FROM nodes n
         WHERE n.project_id = ? AND n.file = ? AND n.stale = 0
           AND n.kind IN ('function', 'class', 'method', 'interface', 'type',
                          'variable', 'constant', 'enum', 'constructor')
         ORDER BY n.range_start_line`
      ).all(projectId, file);
    } catch {
      return [];
    }
  }

  /**
   * Get file symbols from LSP bridge.
   * @param {string} file - Relative file path
   * @returns {Promise<object[]>}
   */
  async _getFileSymbolsFromLsp(file) {
    try {
      const lsp = this._getLsp();
      if (!lsp) return [];

      const fullPath = resolve(this.root, file);
      const result = await lsp.getSymbols(fullPath);
      return (result.symbols || []).map(s => ({
        name: s.name,
        kind: s.kind,
        line: s.line,
        endLine: s.endLine || s.line,
        signature: s.signature || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check if a symbol line range overlaps with a change hunk.
   * @param {number} symLine - Symbol start line
   * @param {number} symEndLine - Symbol end line
   * @param {object} hunk - { startLine, lineCount }
   * @returns {boolean}
   */
  _symbolOverlapsHunk(symLine, symEndLine, hunk) {
    const hunkStart = hunk.startLine;
    const hunkEnd = hunkStart + hunk.lineCount;
    // Overlap: symbol range intersects hunk range
    return symLine <= hunkEnd && symEndLine >= hunkStart;
  }

  // -----------------------------------------------------------------------
  // 3. Impact propagation
  // -----------------------------------------------------------------------

  /**
   * Propagate impact from changed symbols through the call graph.
   * Uses CKG queryCallers for fast graph traversal.
   * Falls back to LSP references when CKG unavailable.
   *
   * @param {object[]} symbols - Output of getChangedSymbols()
   * @param {number} [depth=2] - Propagation depth (1-3)
   * @returns {object} { direct, transitive, stats }
   */
  async propagateImpact(symbols, depth = DEFAULT_DEPTH) {
    depth = Math.min(Math.max(1, depth), MAX_DEPTH);
    const direct = [];
    const transitive = [];
    const visited = new Set();
    const allImpactedFiles = new Set();

    const ckg = this._getCkg();
    const lsp = this._getLsp();

    for (const sym of symbols) {
      let callersResult = null;

      // Try CKG first
      if (ckg) {
        try {
          callersResult = ckg.queryCallers(sym.symbol, sym.file, { depth: Math.max(depth, 2) });
        } catch { callersResult = null; }
      }

      if (callersResult && callersResult.totalCallers > 0) {
        // CKG path — extract structured callers
        const impacted = this._flattenCallerTree(callersResult.callers);
        for (const imp of impacted) {
          allImpactedFiles.add(imp.file);
        }
        direct.push({
          changedFile: sym.file,
          symbol: sym.symbol,
          kind: sym.kind,
          line: sym.line,
          impacted,
          source: 'ckg',
        });
      } else if (lsp) {
        // LSP fallback — use references
        try {
          const refs = await lsp.getReferences(sym.file, sym.line, 0);
          const impacted = (refs.references || [])
            .filter(r => r.file !== resolve(this.root, sym.file))
            .map(r => ({
              file: r.file,
              line: r.line,
              depth: 1,
            }));
          for (const imp of impacted) {
            allImpactedFiles.add(imp.file);
          }
          direct.push({
            changedFile: sym.file,
            symbol: sym.symbol,
            kind: sym.kind,
            line: sym.line,
            impacted,
            source: 'lsp',
          });
        } catch { /* skip */ }
      }
    }

    // Transitive propagation (depth > 1): find callers of impacted files
    if (depth > 1 && (ckg || lsp)) {
      for (const impact of direct) {
        for (const caller of impact.impacted) {
          const key = `${caller.file}:${caller.line}`;
          if (visited.has(key)) continue;
          visited.add(key);

          // Get symbols in impacted file
          let callerSymbols = [];
          if (ckg) {
            callerSymbols = this._getFileSymbolsFromCkg(ckg, relative(this.root, caller.file));
          }
          if (callerSymbols.length === 0 && lsp) {
            callerSymbols = await this._getFileSymbolsFromLsp(relative(this.root, caller.file));
          }

          for (const csym of callerSymbols) {
            if (csym.kind !== 'function' && csym.kind !== 'class' && csym.kind !== 'method') continue;

            if (ckg) {
              try {
                const deeper = ckg.queryCallers(csym.name, relative(this.root, caller.file), { depth: 1 });
                if (deeper.totalCallers > 0) {
                  const impacted = this._flattenCallerTree(deeper.callers);
                  transitive.push({
                    via: caller.file,
                    viaLine: caller.line,
                    symbol: csym.name,
                    impacted,
                    source: 'ckg',
                  });
                  for (const imp of impacted) allImpactedFiles.add(imp.file);
                }
              } catch { /* skip */ }
            } else if (lsp) {
              try {
                const refs = await lsp.getReferences(caller.file, csym.line || 1, 0);
                const impacted = (refs.references || [])
                  .filter(r => r.file !== caller.file)
                  .map(r => ({ file: r.file, line: r.line }));
                if (impacted.length > 0) {
                  transitive.push({
                    via: caller.file,
                    viaLine: caller.line,
                    symbol: csym.name,
                    impacted,
                    source: 'lsp',
                  });
                  for (const imp of impacted) allImpactedFiles.add(imp.file);
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    }

    // Stats
    const totalDirectSymbols = direct.reduce((s, d) => s + d.impacted.length, 0);
    const totalTransitive = transitive.reduce((s, t) => s + t.impacted.length, 0);

    return {
      direct,
      transitive,
      stats: {
        totalImpactedFiles: allImpactedFiles.size,
        totalDirectSymbols,
        totalTransitiveSymbols: totalTransitive,
        depth,
        confidence: ckg
          ? (depth <= 1 ? 'high' : 'medium')
          : (depth <= 1 ? 'medium' : 'low'),
        source: ckg ? 'ckg' : (lsp ? 'lsp' : 'none'),
      },
    };
  }

  /**
   * Flatten recursive caller tree into flat list.
   * @param {object[]} callers - Recursive caller tree
   * @returns {object[]} [{ file, line, name, depth }]
   */
  _flattenCallerTree(callers, currentDepth = 1) {
    const result = [];
    for (const c of callers) {
      result.push({ file: c.file, line: c.line, name: c.name, depth: currentDepth });
      if (c.callers && c.callers.length > 0) {
        result.push(...this._flattenCallerTree(c.callers, currentDepth + 1));
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // 4. Test prediction
  // -----------------------------------------------------------------------

  /**
   * Predict which test files exercise impacted code paths.
   * Uses heuristics:
   *   1. Test files that import impacted files (via CKG dependencies)
   *   2. Test files sharing directory with impacted files
   *   3. Test file names matching changed symbol names
   *
   * @param {object} impactResult - Result from propagateImpact()
   * @returns {object[]} [{ file, name, relevance: 'high'|'medium'|'low', reason }]
   */
  async predictTests(impactResult) {
    const tests = [];
    const seen = new Set();

    // Collect all impacted files
    const impactedFiles = new Set();
    for (const d of impactResult.direct) {
      for (const imp of d.impacted) impactedFiles.add(imp.file);
    }
    for (const t of impactResult.transitive) {
      for (const imp of t.impacted) impactedFiles.add(imp.file);
    }

    const ckg = this._getCkg();
    const root = this.root;

    // Heuristic 1: Test files that import impacted files (via CKG)
    if (ckg) {
      for (const impFile of impactedFiles) {
        try {
          const relFile = relative(root, impFile);
          // Find who imports this file
          const deps = ckg.queryDependencies(relFile);
          for (const importer of deps.importedBy) {
            if (this._isTestFile(importer.source || importer.file)) {
              const key = importer.file.replace(root, '');
              if (!seen.has(key)) {
                seen.add(key);
                tests.push({
                  file: importer.file,
                  name: importer.file.split('/').pop() || importer.file,
                  relevance: 'high',
                  reason: `Imports impacted file ${relFile}`,
                });
              }
            }
          }
        } catch { /* skip */ }
      }
    }

    // Heuristic 2: Test files in same directory as impacted files
    for (const impFile of impactedFiles) {
      const dir = impFile.replace(/\/[^/]+$/, '');
      // We can't glob here, but we can note that test files in this
      // directory may need attention (indicated in the reason field)
      const dirKey = `dir:${dir}`;
      if (!seen.has(dirKey)) {
        seen.add(dirKey);
        // Collect impacted symbols for reason
        const impactedSymbols = impactResult.direct
          .filter(d => d.impacted.some(i => i.file === impFile))
          .map(d => d.symbol);
        // Only add if we haven't already added the file itself
        if (impactedSymbols.length > 0) {
          tests.push({
            file: dir,
            name: dir.split('/').pop() || dir,
            relevance: 'medium',
            reason: `Directory contains impacted file ${relative(root, impFile)} (symbols: ${impactedSymbols.slice(0, 3).join(', ')})`,
          });
        }
      }
    }

    // Heuristic 3: Test files with names matching changed symbols
    const changedSymbols = new Set(
      impactResult.direct.map(d => d.symbol.toLowerCase())
    );
    for (const impFile of impactedFiles) {
      const basename = impFile.split('/').pop()?.replace(/\.\w+$/, '')?.toLowerCase();
      if (basename && changedSymbols.has(basename)) {
        const key = `sym:${basename}`;
        if (!seen.has(key)) {
          seen.add(key);
          tests.push({
            file: impFile,
            name: basename,
            relevance: 'medium',
            reason: `Filename matches changed symbol '${basename}'`,
          });
        }
      }
    }

    // Heuristic 4: CKG test coverage map (function-level precision)
    // Uses tested_by edges from CKG to find exact tests covering impacted symbols.
    if (ckg) {
      const impactedSymbols = new Map(); // relFile → Set<symbolName>
      for (const d of impactResult.direct) {
        for (const imp of d.impacted) {
          if (!impactedSymbols.has(imp.file)) impactedSymbols.set(imp.file, new Set());
          impactedSymbols.get(imp.file).add(d.symbol);
        }
      }

      for (const [impFile, symbols] of impactedSymbols) {
        // Normalize path separators (CKG always uses forward slashes)
        const relFile = relative(root, impFile).replace(/\\/g, '/');
        for (const symbol of symbols) {
          try {
            const cov = ckg.queryTestCoverage(symbol, relFile);
            if (cov.totalTests === 0) continue;

            // Deterministic matches → high relevance
            for (const t of cov.deterministic) {
              const key = `ckg-det:${t.testFile}:${t.testBlock}`;
              if (!seen.has(key)) {
                seen.add(key);
                tests.push({
                  file: resolve(root, t.testFile),
                  name: t.testBlock,
                  relevance: 'high',
                  reason: `CKG coverage: ${symbol} → ${t.testBlock} (deterministic, ${(t.confidence * 100).toFixed(0)}%)`,
                });
              }
            }

            // Speculative matches → medium relevance
            for (const t of cov.speculative) {
              const key = `ckg-spec:${t.testFile}:${t.testBlock}`;
              if (!seen.has(key)) {
                seen.add(key);
                tests.push({
                  file: resolve(root, t.testFile),
                  name: t.testBlock,
                  relevance: 'medium',
                  reason: `CKG coverage: ${symbol} → ${t.testBlock} (${t.matchType}, ${(t.confidence * 100).toFixed(0)}%)`,
                });
              }
            }
          } catch { /* skip if CKG query fails */ }
        }
      }
    }

    // Sort by relevance
    const rank = { high: 0, medium: 1, low: 2 };
    tests.sort((a, b) => rank[a.relevance] - rank[b.relevance]);

    return tests;
  }

  /**
   * Check if a file path matches test patterns.
   * @param {string} filePath
   * @returns {boolean}
   */
  _isTestFile(filePath) {
    return TEST_PATTERNS.some(p => p.test(filePath));
  }

  // -----------------------------------------------------------------------
  // 5. Full pipeline
  // -----------------------------------------------------------------------

  /**
   * Full change-impact analysis pipeline.
   *
   * @param {object} opts
   * @param {string} [opts.diff] - git diff text
   * @param {string[]} [opts.files] - File paths to analyze (alternative to diff)
   * @param {string[]} [opts.symbols] - Specific symbols to trace
   * @param {number} [opts.depth=2] - Impact propagation depth (1-3)
   * @param {boolean} [opts.predictTests=true] - Whether to predict affected tests
   * @returns {object} {
   *   changes, symbols, impact: { direct, transitive, stats },
   *   testPrediction: [...], summary
   * }
   */
  async analyzeImpact(opts = {}) {
    const depth = Math.min(opts.depth ?? DEFAULT_DEPTH, MAX_DEPTH);
    const doPredictTests = opts.predictTests !== false;

    // Step 1: Parse diff or use explicit file list
    let changes = [];
    let changedSymbols = [];

    if (opts.diff) {
      changes = this.parseDiff(opts.diff);
      if (changes.length === 0) {
        return { changes: [], symbols: [], impact: { direct: [], transitive: [], stats: { totalImpactedFiles: 0, totalDirectSymbols: 0, totalTransitiveSymbols: 0, depth, confidence: 'high', source: 'none' } }, testPrediction: [], summary: 'No changes detected in diff.' };
      }
      changedSymbols = await this.getChangedSymbols(changes);
    } else if (opts.files && opts.files.length > 0) {
      changes = opts.files.map(f => ({ file: f, startLine: 0, lineCount: 0 }));
      const ckg = this._getCkg();
      if (opts.symbols && opts.symbols.length > 0) {
        changedSymbols = opts.symbols.map(s => {
          // Find which file this symbol belongs to (first match)
          const file = opts.files.find(f => {
            if (ckg) {
              try {
                const result = ckg.queryCallers(s, relative(this.root, f), { depth: 1 });
                return result.totalCallers > 0 || result.root?.file;
              } catch { return false; }
            }
            return false;
          }) || opts.files[0];
          return { file: relative(this.root, resolve(this.root, file)), symbol: s, kind: 'unknown', line: 0 };
        });
      } else {
        changedSymbols = await this.getChangedSymbols(changes);
      }
    } else {
      return { changes: [], symbols: [], impact: { direct: [], transitive: [], stats: { totalImpactedFiles: 0, totalDirectSymbols: 0, totalTransitiveSymbols: 0, depth, confidence: 'high', source: 'none' } }, testPrediction: [], summary: 'Provide either "diff" (git diff text) or "files" (array of file paths).' };
    }

    // Step 2: Propagate impact
    const impact = await this.propagateImpact(changedSymbols, depth);

    // Step 3: Predict tests (optional)
    let testPrediction = [];
    if (doPredictTests && impact.stats.totalImpactedFiles > 0) {
      testPrediction = await this.predictTests(impact);
    }

    // Build summary
    const summaryText = this._buildSummary(changes, changedSymbols, impact, testPrediction);

    return {
      changes: changes.map(c => ({ file: c.file, startLine: c.startLine, lineCount: c.lineCount })),
      symbols: changedSymbols,
      impact,
      testPrediction,
      summary: summaryText,
    };
  }

  /**
   * Build human-readable summary.
   * @private
   */
  _buildSummary(changes, symbols, impact, tests) {
    if (impact.stats.totalImpactedFiles === 0) {
      return 'No downstream impact detected. Safe to modify.';
    }

    const hasTransitive = impact.stats.totalTransitiveSymbols > 0;
    let text = '';

    // ⚠️ WARNING banner — visible signal for refactoring risk
    text += `${'═'.repeat(56)}\n`;
    text += `  ⚠️  IMPACT WARNING: ${impact.stats.totalImpactedFiles} downstream module(s) affected\n`;
    if (hasTransitive) {
      text += `  ⚠️  Includes ${impact.stats.totalTransitiveSymbols} transitive call(s) — cascading changes may apply\n`;
    }
    text += `${'═'.repeat(56)}\n`;

    text += `\nImpact Analysis (depth=${impact.stats.depth}, source=${impact.stats.source}, confidence=${impact.stats.confidence})\n`;
    text += `${'─'.repeat(50)}\n`;

    text += `\nChanges: ${changes.length} file(s), ${symbols.length} symbol(s) modified\n`;

    // List changed symbols with their downstream callers
    for (const sym of symbols) {
      text += `  • ${sym.symbol} (${sym.kind}) @ ${sym.file}:${sym.line}\n`;
      const affected = impact.direct.find(d => d.symbol === sym.symbol);
      if (affected && affected.impacted.length > 0) {
        for (const imp of affected.impacted.slice(0, 5)) {
          const shortFile = imp.file.replace(this.root, '').replace(/^\//, '');
          text += `    ← ${shortFile}:L${imp.line}\n`;
        }
        if (affected.impacted.length > 5) {
          text += `    ... and ${affected.impacted.length - 5} more\n`;
        }
      }
    }

    text += `\n${impact.stats.totalImpactedFiles} file(s) potentially impacted\n`;
    text += `   ${impact.stats.totalDirectSymbols} direct call(s), ${impact.stats.totalTransitiveSymbols} transitive call(s)\n`;

    if (tests && tests.length > 0) {
      const detCount = tests.filter(t => t.relevance === 'high').length;
      const specCount = tests.filter(t => t.relevance === 'medium').length;
      text += `\nAffected tests: ${tests.length} (${detCount} deterministic, ${specCount} speculative)\n`;
      for (const t of tests.slice(0, 8)) {
        text += `  [${t.relevance}] ${t.name}: ${t.reason}\n`;
      }
      if (tests.length > 8) {
        text += `  ... and ${tests.length - 8} more\n`;
      }
    }

    return text;
  }
}
