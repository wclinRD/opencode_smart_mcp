// code-impact.mjs → smart_code_impact
// 影響半徑分析：給定 git diff 或檔案列表 + 符號，分析改動影響哪些下游模組。
// 使用 LSP references + call-graph 交叉比對。

import { getLspBridge, closeAllLspBridges } from '../../lib/lsp-bridge.mjs';
import { getCodebaseIndex } from '../../lib/codebase-index.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse a simple git diff to extract changed files and line ranges.
 */
function parseDiff(diffText) {
  if (!diffText || typeof diffText !== 'string') return [];

  const changes = [];
  const lines = diffText.split('\n');
  let currentFile = null;

  for (const line of lines) {
    const fileMatch = line.match(/^--- a\/(.+)/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    const toFileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (toFileMatch) {
      currentFile = toFileMatch[1];
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      changes.push({
        file: currentFile,
        startLine: parseInt(hunkMatch[1], 10),
        lineCount: parseInt(hunkMatch[2] || '1', 10),
      });
    }
  }
  return changes;
}

/**
 * Get file symbols for analysis
 */
async function getFileSymbols(bridge, file) {
  try {
    const result = await bridge.getSymbols(file);
    return result.symbols || [];
  } catch {
    return [];
  }
}

export default {
  name: 'smart_code_impact',
  category: 'standard',
  description: `Analyze impact radius of code changes. Use when: planning a refactor, need to know what depends on a function/module, or want to assess risk before making changes.

Supports both git-diff input and direct file+symbol queries. Uses LSP references + call-graph to trace transitive impact. Conservative over-approximation for dynamic languages.`,
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of file paths to analyze impact for (alternative to diff)',
      },
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Symbol names to trace (default: all exported symbols in files)',
      },
      diff: { type: 'string', description: 'Git diff text to parse for changes' },
      depth: { type: 'number', description: 'Impact depth (1-3, default: 1). depth=1=direct, depth=2=transitive' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: [],
  },
  handler: async (args) => {
    const root = args.root || process.cwd();
    const depth = Math.min(args.depth || 1, 3);

    // Step 1: Determine what changed
    let changedFiles = [];
    let targetSymbols = args.symbols || [];

    if (args.diff) {
      changedFiles = parseDiff(args.diff);
    } else if (args.files && args.files.length > 0) {
      changedFiles = args.files.map(f => ({ file: f, startLine: 0, lineCount: 0 }));
    } else {
      return 'Provide either "diff" (git diff text) or "files" (array of file paths).';
    }

    if (changedFiles.length === 0) {
      return 'No changes detected.';
    }

    // Try codebase index first (zero LSP cost)
    let useIndex = false;
    let index = null;
    try {
      index = getCodebaseIndex();
      const stats = index.getStats();
      useIndex = stats.files > 0;
    } catch { /* index not available, fallback to LSP */ }

    const directImpacts = [];
    const visited = new Set();

    if (useIndex) {
      // --- Codebase index path (fast, zero LSP) ---
      for (const change of changedFiles) {
        const file = change.file;

        // Get symbols that changed in this file
        const symbols = targetSymbols.length > 0
          ? targetSymbols.map(s => ({ name: s }))
          : index.getSymbolsByFile(file);

        // File-level: reverse import lookup
        const importers = index.getReverseImports(file);
        if (importers.length > 0 && symbols.length === 0) {
          directImpacts.push({
            changedFile: file,
            symbol: '(file)',
            impacted: importers.map(i => ({ file: i.from_file, line: 0, confidence: 'medium', source: 'codebase-index' })),
          });
        }

        // Symbol-level: caller lookup
        for (const sym of symbols) {
          if (!sym.name) continue;
          const callers = index.getCallers(sym.name)
            .filter(c => c.file_path !== file)
            .map(c => ({ file: c.file_path, line: c.line || 0, confidence: 'high', source: 'codebase-index' }));

          if (callers.length > 0) {
            directImpacts.push({
              changedFile: file,
              symbol: sym.name,
              impacted: callers,
            });
          }
        }
      }
    } else {
      // --- LSP path (fallback) ---
      const bridge = getLspBridge(root);
      try {
        for (const change of changedFiles) {
          const file = change.file;
          if (!existsSync(resolve(root, file))) continue;

          const symbols = targetSymbols.length > 0
            ? targetSymbols.map(s => ({ name: s }))
            : await getFileSymbols(bridge, file);

          for (const sym of symbols) {
            if (!sym.name) continue;
            try {
              const refs = await bridge.getReferences(file, sym.line || 1, sym.col || 0);
              const callers = (refs.references || [])
                .filter(r => r.file !== resolve(root, file))
                .map(r => ({ file: r.file, line: r.line, confidence: 'high', source: 'lsp' }));

              if (callers.length > 0) {
                directImpacts.push({
                  changedFile: file,
                  symbol: sym.name,
                  impacted: callers,
                });
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        // Close LSP after use
      }
    }

    // Step 3: Compute transitive impacts if depth > 1 (always uses LSP for precision)
    let transitiveImpacts = [];
    if (depth > 1) {
      const bridge = getLspBridge(root);
      try {
        for (const impact of directImpacts) {
          for (const caller of impact.impacted) {
            const key = `${caller.file}`;
            if (visited.has(key)) continue;
            visited.add(key);

            if (!existsSync(resolve(root, caller.file))) continue;
            const callerSymbols = await getFileSymbols(bridge, caller.file);
            for (const csym of callerSymbols) {
              if (csym.kind !== 'function' && csym.kind !== 'class') continue;
              try {
                const refs = await bridge.getReferences(caller.file, csym.line || 1, csym.col || 0);
                const transitive = (refs.references || [])
                  .filter(r => r.file !== resolve(root, caller.file))
                  .map(r => ({ file: r.file, line: r.line }));

                if (transitive.length > 0) {
                  transitiveImpacts.push({
                    via: caller.file,
                    symbol: csym.name,
                    impacted: transitive,
                  });
                }
              } catch { /* skip */ }
            }
          }
        }
      } finally {
        await closeAllLspBridges();
      }
    } else if (!useIndex) {
      // Only close LSP if we opened it and aren't doing transitive analysis
      await closeAllLspBridges();
    }

    // Step 4: De-duplicate
    const allImpactedFiles = new Set();
    for (const di of directImpacts) {
      for (const imp of di.impacted) allImpactedFiles.add(imp.file);
    }
    for (const ti of transitiveImpacts) {
      for (const imp of ti.impacted) allImpactedFiles.add(imp.file);
    }

    const output = {
      direct: directImpacts,
      transitive: transitiveImpacts,
      totalFiles: allImpactedFiles.size,
      totalSymbols: directImpacts.length,
      depth,
      confidence: useIndex ? 'high (codebase-index)' : depth <= 1 ? 'high' : 'medium',
      source: useIndex ? 'codebase-index' : 'lsp',
    };

    if (args.format === 'json') {
      return JSON.stringify(output, null, 2);
    }

    // Text format
    let text = `Impact Analysis (depth=${depth})\n`;
    text += '─'.repeat(50) + '\n';

    if (directImpacts.length === 0) {
      text += 'No downstream impacts detected. Safe to modify.\n';
      return text;
    }

    text += `\n⚠️  ${allImpactedFiles.size} file(s) potentially impacted:\n\n`;

    for (const di of directImpacts) {
      text += `  ${di.symbol} changed in ${di.changedFile}\n`;
      for (const imp of di.impacted) {
        const shortFile = imp.file.replace(root, '').replace(/^\//, '');
        text += `    ← ${shortFile}:L${imp.line}\n`;
      }
      text += '\n';
    }

    if (transitiveImpacts.length > 0) {
      text += `\nTransitive impacts (depth ${depth}):\n`;
      for (const ti of transitiveImpacts) {
        const shortVia = ti.via.replace(root, '').replace(/^\//, '');
        text += `  via ${shortVia} → ${ti.symbol}\n`;
        for (const imp of ti.impacted) {
          const shortFile = imp.file.replace(root, '').replace(/^\//, '');
          text += `    ← ${shortFile}:L${imp.line}\n`;
        }
      }
    }

    text += `\nConfidence: ${output.confidence} (source: ${output.source})`;
    return text;
  },
};
