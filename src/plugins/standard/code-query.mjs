// code-query.mjs → smart_code_query
// 查詢程式碼知識圖譜（CKG）。
// 包裝 ckg-engine.mjs 的查詢功能為 MCP tool。
//
// 查詢類型：
//   build            — 全量掃描建立 CKG
//   update           — 增量更新單一檔案
//   callers          — 誰呼叫了某函式
//   callees          — 某函式呼叫了誰
//   usage-patterns   — API 使用模式分析（CKG-based refactoring assistant）
//   dependencies     — 檔案依賴結構
//   unused-exports   — 未使用的導出
//   symbol           — 查詢符號定義
//   stats            — CKG 統計資訊

import { getCkgEngine } from '../../lib/ckg-engine.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatCallers(result) {
  const { root, callers, depth, totalCallers } = result;
  let text = `Callers of ${root.symbol} in ${root.file}\n`;
  text += '─'.repeat(50) + '\n';

  if (totalCallers === 0) {
    text += 'No callers found.\n';
    return text;
  }

  text += `${totalCallers} direct caller(s)\n\n`;

  const walk = (items, indent = '') => {
    for (const c of items) {
      text += `${indent}← ${c.file}:L${c.line}  ${c.name} (${c.kind})\n`;
      if (c.signature && c.signature !== c.name) {
        text += `${indent}   signature: ${c.signature}\n`;
      }
      if (c.callers && c.callers.length > 0) {
        walk(c.callers, indent + '  ');
      }
    }
  };
  walk(callers);
  return text;
}

function formatCallees(result) {
  const { root, callees, depth, totalCallees } = result;
  let text = `Callees of ${root.symbol} in ${root.file}\n`;
  text += '─'.repeat(50) + '\n';

  if (totalCallees === 0) {
    text += 'No callees found (may need AST-level analysis).\n';
    return text;
  }

  text += `${totalCallees} direct callee(s)\n\n`;

  const walk = (items, indent = '') => {
    for (const c of items) {
      text += `${indent}→ ${c.file}:L${c.line}  ${c.name} (${c.kind})\n`;
      if (c.callees && c.callees.length > 0) {
        walk(c.callees, indent + '  ');
      }
    }
  };
  walk(callees);
  return text;
}

function formatUsagePatterns(result) {
  if (result.totalUsages === 0) {
    return `No usages found for ${result.symbol} in ${result.file}.\nThe API may not be indexed or has no callers.`;
  }

  let text = `Usage patterns for ${result.symbol} in ${result.file}\n`;
  text += '─'.repeat(55) + '\n';
  text += `${result.totalUsages} total usage(s)\n`;

  // Induced patterns (high-level)
  if (result.inducedPatterns && result.inducedPatterns.length > 0) {
    text += '\n🔍 Induced patterns:\n';
    for (const ip of result.inducedPatterns) {
      const bar = Math.round(ip.confidence * 100);
      text += `  ╰ ${ip.type.padEnd(18)} confidence: ${bar}%  ${ip.description}\n`;
    }
  }

  // Pattern summary
  text += '\nPattern breakdown:\n';
  for (const p of result.patterns) {
    const bar = '█'.repeat(Math.max(1, Math.round(p.count / result.totalUsages * 20)));
    text += `  ${p.type.padEnd(17)} ${String(p.count).padStart(3)} ${bar}  ${p.description}\n`;
  }

  text += '\nAll usages:\n';
  const fileGroups = {};
  for (const u of result.usages) {
    if (!fileGroups[u.caller.file]) fileGroups[u.caller.file] = [];
    fileGroups[u.caller.file].push(u);
  }

  for (const [f, usages] of Object.entries(fileGroups)) {
    text += `\n  ${f}:\n`;
    for (const u of usages) {
      const ctx = u.caller.container
        ? ` (in ${u.caller.container.name}:${u.caller.container.kind})`
        : '';
      text += `    L${String(u.caller.line).padStart(4)}  [${u.pattern.padEnd(15)}] ${u.caller.name}${ctx}\n`;
    }
  }

  return text;
}

function formatStrategyPatterns(result) {
  if (result.strategies.length === 0) {
    return `No strategy/interace patterns found for ${result.symbol} in ${result.file}.`;
  }

  let text = `Strategy/Interface patterns for ${result.symbol} in ${result.file}\n`;
  text += '─'.repeat(55) + '\n';

  for (const s of result.strategies) {
    text += `\n📐 ${s.type} (confidence: ${Math.round(s.confidence * 100)}%)\n`;
    text += `   ${s.description}\n`;
    for (const impl of s.implementations) {
      const detail = impl.sharedCallers
        ? ` (sharedCallers: ${impl.sharedCallers})`
        : impl.exported ? ' (exported)' : '';
      text += `   ╰ ${impl.file}`;
      if (impl.name) text += ` → ${impl.name}`;
      if (impl.signature) text += ` ${impl.signature}`;
      text += `${detail}\n`;
    }
  }

  return text;
}

function formatDependencies(result) {
  let text = `Dependencies for ${result.file}\n`;
  text += '─'.repeat(50) + '\n';

  text += `\nImports (${result.totalImports}):\n`;
  if (result.imports.length === 0) {
    text += '  (none)\n';
  } else {
    for (const imp of result.imports) {
      const spec = imp.specifier ? ` (${imp.specifier})` : '';
      text += `  → ${imp.file}${spec}\n`;
    }
  }

  text += `\nImported by (${result.totalImporters}):\n`;
  if (result.importedBy.length === 0) {
    text += '  (none — not imported by other files)\n';
  } else {
    for (const imp of result.importedBy) {
      text += `  ← ${imp.file}\n`;
    }
  }

  return text;
}

function formatUnusedExports(unused) {
  let text = `Unused Exports (${unused.length})\n`;
  text += '─'.repeat(50) + '\n';

  if (unused.length === 0) {
    text += 'No unused exports found!\n';
    return text;
  }

  for (const sym of unused) {
    text += `  ${sym.kind} ${sym.name}  ${sym.file}:L${sym.line}\n`;
    if (sym.signature && sym.signature !== sym.name) {
      text += `    signature: ${sym.signature}\n`;
    }
  }
  text += `\nTip: These symbols are exported but never imported by other files.\n`;
  return text;
}

function formatSymbols(symbols) {
  if (symbols.length === 0) {
    return 'No matching symbols found.';
  }

  let text = `Symbols (${symbols.length} found)\n`;
  text += '─'.repeat(50) + '\n';

  for (const sym of symbols) {
    text += `  ${sym.kind} ${sym.name}  ${sym.file}:L${sym.line}\n`;
    if (sym.signature && sym.signature !== sym.name) {
      text += `    signature: ${sym.signature}\n`;
    }
    text += `    ${sym.exported ? 'exported' : 'internal'}\n`;
  }

  return text;
}

function formatBuildResult(result) {
  let text = `CKG Build Complete\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Files:     ${result.files}\n`;
  if (result.scanned) text += `  Scanned:   ${result.scanned}\n`;
  text += `  Nodes:     ${result.nodes}\n`;
  text += `  Edges:     ${result.edges}\n`;
  text += `  Duration:  ${result.duration}\n`;
  return text;
}

function formatUpdateResult(result) {
  if (!result.updated) {
    return 'File unchanged, skipped.';
  }
  let text = `CKG Update Complete\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Updated:  true\n`;
  text += `  Nodes:    ${result.nodes}\n`;
  text += `  Edges:    ${result.edges}\n`;
  return text;
}

function formatStats(stats) {
  if (stats.status === 'not_built') {
    return 'CKG not built yet. Run query=build first.';
  }
  let text = `CKG Statistics\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Project:  ${stats.project}\n`;
  text += `  Files:    ${stats.files}\n`;
  text += `  Nodes:    ${stats.nodes}\n`;
  text += `  Edges:    ${stats.edges}\n`;
  text += `  Stale:    ${stats.stale}\n`;
  text += `  Built:    ${stats.builtAt || 'N/A'}\n`;

  if (stats.kindBreakdown && Object.keys(stats.kindBreakdown).length > 0) {
    text += `\n  Node types:\n`;
    for (const [kind, count] of Object.entries(stats.kindBreakdown)) {
      text += `    ${kind}: ${count}\n`;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Test Coverage formatters
// ---------------------------------------------------------------------------

function formatTestCoverage(result) {
  if (result.totalTests === 0) {
    return `No test coverage found for ${result.symbol} in ${result.file}.`;
  }

  let text = `Test Coverage: ${result.symbol} (${result.file})\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Total tests: ${result.totalTests}\n`;

  if (result.deterministic.length > 0) {
    text += `\n  ✓ Deterministic (import + name match):\n`;
    for (const t of result.deterministic) {
      text += `    • ${t.testBlock}\n`;
      text += `      File: ${t.testFile}:${t.line}\n`;
      text += `      Confidence: ${(t.confidence * 100).toFixed(0)}%\n`;
    }
  }

  if (result.speculative.length > 0) {
    text += `\n  ? Speculative:\n`;
    for (const t of result.speculative) {
      text += `    • ${t.testBlock}\n`;
      text += `      File: ${t.testFile}:${t.line}\n`;
      text += `      Match: ${t.matchType} (${(t.confidence * 100).toFixed(0)}%)\n`;
    }
  }

  return text;
}

function formatTestCoverageFile(result) {
  let text = `File Coverage: ${result.file}\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Functions: ${result.totalFunctions}\n`;
  text += `  Covered:   ${result.coveredFunctions}\n`;
  text += `  Coverage:  ${result.coveragePct}%\n`;

  if (result.functions.length > 0) {
    text += `\n  Per-function:\n`;
    for (const fn of result.functions) {
      const icon = fn.covered ? '✓' : ' ';
      text += `  ${icon} ${fn.name} (${fn.kind})`;
      if (fn.covered) {
        text += ` — ${fn.totalTests} test(s)`;
        if (fn.deterministic > 0) text += `, ${fn.deterministic} deterministic`;
        if (fn.speculative > 0) text += `, ${fn.speculative} speculative`;
      }
      text += '\n';
    }
  }

  return text;
}

function formatBuildCoverage(result) {
  let text = `CKG Coverage Build\n`;
  text += '─'.repeat(50) + '\n';
  text += `  Test files:  ${result.testFiles}\n`;
  text += `  Test blocks: ${result.testBlocks}\n`;
  text += `  Edges:       ${result.edges}\n`;
  text += `  Deterministic: ${result.deterministic}\n`;
  text += `  Speculative:   ${result.speculative}\n`;
  text += `  Duration:    ${result.duration}\n`;
  return text;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_code_query',
  category: 'standard',
  description: `Query Code Knowledge Graph (CKG) — persistent project-wide code analysis.

Queries:
  build            — Full project scan (creates CKG database)
  update           — Incremental update for a single file
  callers          — Who calls a symbol (with depth control)
  callees          — What a symbol calls
  dependencies     — Import structure of a file
  unused-exports   — Find exported symbols not imported by other files
  symbol           — Look up symbol definitions
  stats            — CKG statistics

Phase 11: Builds on LSP bridge to create a persistent SQLite-based knowledge graph.
CKG is stored at ~/.smart/ckg/ and persists across sessions.

Phase C.2: Test Coverage Map — CKG records which tests cover which functions.
  - test-coverage         — Query which tests cover a specific source function
  - test-coverage-file    — Query coverage map for an entire source file
  - build-coverage        — Build/rebuild test coverage map (call after build)

Examples:
  { query: "build", root: "." }
  { query: "callers", symbol: "foo", file: "src/foo.ts", depth: 2 }
  { query: "unused-exports", root: "." }
  { query: "dependencies", file: "src/bar.ts" }
  { query: "test-coverage", symbol: "add", file: "src/math.ts" }
  { query: "build-coverage", root: "." }`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        enum: ['build', 'update', 'callers', 'callees', 'usage-patterns', 'strategy-patterns', 'dependencies', 'unused-exports', 'symbol', 'stats', 'test-coverage', 'test-coverage-file', 'build-coverage'],
        description: 'Query type',
      },
      symbol: { type: 'string', description: 'Symbol name (for callers/callees/symbol queries)' },
      file: { type: 'string', description: 'File path (for update/callers/callees/dependencies/symbol)' },
      kind: { type: 'string', description: 'Symbol kind filter (for symbol query): function, class, interface, type, variable, etc.' },
      depth: { type: 'number', description: 'Recursion depth 1-3 (default: 2, for callers/callees)' },
      includeStale: { type: 'boolean', description: 'Include stale/outdated nodes (default: false)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
      onProgress: { type: 'boolean', description: 'Show build progress (default: false)' },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const root = args.root || process.cwd();
    const query = args.query;
    const format = args.format || 'text';
    const engine = getCkgEngine(root);

    try {
      let result;

      switch (query) {
        // -- Build --
        case 'build': {
          const onProgress = args.onProgress
            ? (file, i, total) => {}  // progress handled by the CLI
            : undefined;
          result = await engine.build({ force: args.force, onProgress });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatBuildResult(result);
        }

        // -- Incremental update --
        case 'update': {
          if (!args.file) return 'file is required for update query.';
          if (!existsSync(resolve(root, args.file))) {
            return `File not found: ${args.file}`;
          }
          result = await engine.incrementalUpdate(args.file);
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatUpdateResult(result);
        }

        // -- Callers --
        case 'callers': {
          if (!args.symbol || !args.file) {
            return 'symbol and file are required for callers query.';
          }
          result = engine.queryCallers(args.symbol, args.file, {
            depth: Math.min(args.depth || 2, 3),
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatCallers(result);
        }

        // -- Callees --
        case 'callees': {
          if (!args.symbol || !args.file) {
            return 'symbol and file are required for callees query.';
          }
          result = engine.queryCallees(args.symbol, args.file, {
            depth: Math.min(args.depth || 2, 3),
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatCallees(result);
        }

        // -- Usage patterns --
        case 'usage-patterns': {
          if (!args.symbol || !args.file) {
            return 'symbol and file are required for usage-patterns query.';
          }
          result = engine.queryUsagePatterns(args.symbol, args.file, {
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatUsagePatterns(result);
        }

        // -- Strategy/interface patterns --
        case 'strategy-patterns': {
          if (!args.symbol || !args.file) {
            return 'symbol and file are required for strategy-patterns query.';
          }
          result = engine.queryStrategyPatterns(args.symbol, args.file, {
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatStrategyPatterns(result);
        }

        // -- Dependencies --
        case 'dependencies': {
          if (!args.file) return 'file is required for dependencies query.';
          result = engine.queryDependencies(args.file);
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatDependencies(result);
        }

        // -- Unused exports --
        case 'unused-exports': {
          result = engine.queryUnusedExports();
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatUnusedExports(result);
        }

        // -- Symbol lookup --
        case 'symbol': {
          if (!args.symbol) return 'symbol is required for symbol query.';
          result = engine.querySymbol(args.symbol, {
            file: args.file,
            kind: args.kind,
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatSymbols(result);
        }

        // -- Stats --
        case 'stats': {
          result = engine.getStats();
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatStats(result);
        }

        // -- Test coverage (single symbol) --
        case 'test-coverage': {
          if (!args.symbol || !args.file) {
            return 'symbol and file are required for test-coverage query.';
          }
          result = engine.queryTestCoverage(args.symbol, args.file, {
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatTestCoverage(result);
        }

        // -- Test coverage (entire file) --
        case 'test-coverage-file': {
          if (!args.file) return 'file is required for test-coverage-file query.';
          result = engine.queryTestCoverageForFile(args.file, {
            includeStale: args.includeStale,
          });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatTestCoverageFile(result);
        }

        // -- Build test coverage map --
        case 'build-coverage': {
          result = engine.buildTestCoverage({ force: args.force });
          if (format === 'json') return JSON.stringify(result, null, 2);
          return formatBuildCoverage(result);
        }

        default:
          return `Unknown query type: "${query}". Supported: build, update, callers, callees, usage-patterns, strategy-patterns, dependencies, unused-exports, symbol, stats, test-coverage, test-coverage-file, build-coverage`;
      }
    } catch (err) {
      return `CKG error: ${err.message}`;
    }
  },
};
