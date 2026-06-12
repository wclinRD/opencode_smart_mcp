#!/usr/bin/env node

/**
 * import-graph.mjs — Cross-file import dependency analyzer
 *
 * Scans a project directory and builds a dependency graph from
 * import/require statements across multiple languages.
 *
 * Usage:
 *   node import-graph.mjs [--root <path>] [--format <json|dot|text|markdown>]
 *     [--include <glob>] [--exclude <glob>] [--depth <number>]
 *     [--focus <file-path>] [--no-externals]
 *
 * Examples:
 *   node import-graph.mjs --root ./src --format text
 *   node import-graph.mjs --root . --format dot --no-externals | dot -Tsvg > graph.svg
 *   node import-graph.mjs --format json --depth 2
 */

import { readFileSync, statSync, existsSync as fsExists } from 'node:fs';
import { resolve, relative, extname, basename, dirname, sep } from 'node:path';
import { globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';
import { getCodebaseIndex } from '../lib/codebase-index.mjs';

// ---------------------------------------------------------------------------
// Language-specific import pattern matchers
// ---------------------------------------------------------------------------
const LANGUAGE_MATCHERS = [
  {
    name: 'javascript-typescript',
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    matchers: [
      // import ... from '...'
      /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/g,
      // import('...')
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // require('...')
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // export ... from '...'
      /export\s+(?:\w+\s+)*\w+\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    ],
  },
  {
    name: 'python',
    exts: ['.py'],
    matchers: [
      // import foo; import foo.bar
      /^import\s+([\w.]+)/gm,
      // from foo import bar
      /^from\s+([\w.]+)\s+import/gm,
    ],
  },
  {
    name: 'ruby',
    exts: ['.rb'],
    matchers: [
      // require 'foo'
      /require\s+['"]([^'"]+)['"]/g,
      // require_relative 'foo'
      /require_relative\s+['"]([^'"]+)['"]/g,
      // require_dependency 'foo' (Rails)
      /require_dependency\s+['"]([^'"]+)['"]/g,
    ],
  },
  {
    name: 'rust',
    exts: ['.rs'],
    matchers: [
      // use foo::bar;
      /^use\s+([\w:]+)/gm,
      // extern crate foo;
      /^extern\s+crate\s+(\w+)/gm,
    ],
  },
  {
    name: 'go',
    exts: ['.go'],
    matchers: [
      // import "foo/bar"
      /^import\s+["]([^"]+)["]/gm,
      // import alias "foo/bar"
      /^import\s+\w+\s+["]([^"]+)["]/gm,
      // import ( "foo" )
      /^\t["]([^"]+)["]/gm,
    ],
  },
  {
    name: 'java',
    exts: ['.java', '.kt'],
    matchers: [
      // import foo.bar;
      /^import\s+(?:static\s+)?([\w.*]+)\s*;/gm,
    ],
  },
  {
    name: 'php',
    exts: ['.php'],
    matchers: [
      // use Foo\Bar;
      /^use\s+([\w\\]+)/gm,
      // include / require
      /(?:include|require)(?:_once)?\s+['"]([^'"]+)['"]\s*;/g,
    ],
  },
  {
    name: 'c-cpp',
    exts: ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx'],
    matchers: [
      // #include "foo.h"
      /#include\s+["]([^"]+)["]/g,
      // #include <foo.h>
      /#include\s+[<]([^>]+)[>]/g,
    ],
  },
];

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------
function getCommentRanges(content, lang) {
  // Find ranges [start, end) of comments in the content
  const ranges = [];
  const newlineRanges = []; // track string content to avoid matching inside strings

  if (lang === 'python') {
    // Handle Python: # comments, ''' and """ strings
    const strRe = /'''[\s\S]*?'''|"""[\s\S]*?"""|'[^']*'|"[^"]*"/g;
    let m;
    while ((m = strRe.exec(content)) !== null) {
      newlineRanges.push([m.index, m.index + m[0].length]);
    }
    const commentRe = /#.*$/gm;
    while ((m = commentRe.exec(content)) !== null) {
      if (!newlineRanges.some(([s, e]) => m.index >= s && m.index < e)) {
        ranges.push([m.index, m.index + m[0].length]);
      }
    }
  } else {
    // C-family: // comments, /* */ comments, protect strings
    const strRe = /(['"`])(?:(?!\1|\\).|\\.)*\1/g;
    let m;
    while ((m = strRe.exec(content)) !== null) {
      newlineRanges.push([m.index, m.index + m[0].length]);
    }
    // Single-line comments
    const slRe = /\/\/.*$/gm;
    while ((m = slRe.exec(content)) !== null) {
      if (!newlineRanges.some(([s, e]) => m.index >= s && m.index < e)) {
        ranges.push([m.index, m.index + m[0].length]);
      }
    }
    // Multi-line comments
    const mlRe = /\/\*[\s\S]*?\*\//g;
    while ((m = mlRe.exec(content)) !== null) {
      if (!newlineRanges.some(([s, e]) => m.index >= s && m.index < e)) {
        ranges.push([m.index, m.index + m[0].length]);
      }
    }
  }

  return ranges;
}

function isInRanges(pos, ranges) {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

function extractImports(filePath) {
  const ext = extname(filePath).toLowerCase();
  const matcherDef = LANGUAGE_MATCHERS.find((m) => m.exts.includes(ext));
  if (!matcherDef) return [];

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  // Pre-compute comment ranges to filter out matches inside comments
  const commentRanges = getCommentRanges(content, matcherDef.name);

  const imports = [];
  for (const matcher of matcherDef.matchers) {
    let match;
    // Reset lastIndex for global regexes
    matcher.lastIndex = 0;
    while ((match = matcher.exec(content)) !== null) {
      // Skip matches inside comments to avoid false positives
      if (isInRanges(match.index, commentRanges)) continue;
      const rawPath = match[1].trim();
      if (rawPath) {
        imports.push({ raw: rawPath, match: match[0].trim() });
      }
    }
  }
  return imports;
}

// ---------------------------------------------------------------------------
// Path resolution (relative to absolute)
// ---------------------------------------------------------------------------
function resolveImport(importerPath, importSpec, rootDir) {
  // If it's a relative path
  if (importSpec.startsWith('.') || importSpec.startsWith('..')) {
    const importerDir = dirname(importerPath);
    const resolved = resolve(importerDir, importSpec);
    // Try common extensions
    const exts = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.json'];
    for (const ext of [extname(importSpec) || '', ...exts]) {
      const candidate = ext ? resolved.slice(0, -extname(importSpec).length) + ext : resolved + ext;
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* not found */ }
    }
    // Try index files
    for (const ext of exts) {
      const candidate = resolve(resolved, `index${ext}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* not found */ }
    }
    return null; // could not resolve
  }

  // External package / built-in — return as-is (relative to root)
  if (importSpec.startsWith(rootDir)) return importSpec;
  return relative(rootDir, importSpec) || importSpec;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------
function analyze(rootDir, options = {}) {
  const {
    include = ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,rb,rs,go,java,kt,php,c,h,cpp,hpp,cc,cxx}'],
    exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/__pycache__/**'],
    depth = Infinity,
    focus = null,
    noExternals = false,
  } = options;

  rootDir = resolve(rootDir);
  const files = findFiles(rootDir, include, exclude);

  // Build graph
  const nodes = new Map(); // path -> { path, file, imports: [], importedBy: [] }
  const externalImports = new Map(); // name -> { name, importedBy: [] }

  for (const filePath of files) {
    const relPath = relative(rootDir, filePath);
    const impMod = nodes.get(relPath) || { path: relPath, file: filePath, imports: [], importedBy: [] };
    nodes.set(relPath, impMod);

    const imports = extractImports(filePath);
    for (const { raw } of imports) {
      const resolved = resolveImport(filePath, raw, rootDir);
      if (resolved && existsSync(resolved)) {
        const targetRel = relative(rootDir, resolved);
        if (!nodes.has(targetRel)) {
          nodes.set(targetRel, { path: targetRel, file: resolved, imports: [], importedBy: [] });
        }
        // Add edge
        if (!impMod.imports.includes(targetRel)) {
          impMod.imports.push(targetRel);
        }
        const targetMod = nodes.get(targetRel);
        if (!targetMod.importedBy.includes(relPath)) {
          targetMod.importedBy.push(relPath);
        }
      } else {
        // External / unresolved
        if (!noExternals) {
          const pkgName = raw.startsWith('.') ? raw : raw.split('/')[0].startsWith('@')
            ? raw.split('/').slice(0, 2).join('/')
            : raw.split('/')[0];
          if (!externalImports.has(pkgName)) {
            externalImports.set(pkgName, { name: pkgName, importedBy: [] });
          }
          externalImports.get(pkgName).importedBy.push(relPath);
        }
      }
    }
  }

  // Focus filtering
  let filteredNodes = [...nodes.values()];
  if (focus) {
    const focusRel = relative(rootDir, resolve(rootDir, focus));
    const focusMod = nodes.get(focusRel);
    if (focusMod) {
      // Get all reachable nodes within depth
      const visited = new Set();
      const queue = [{ path: focusRel, dist: 0 }];
      while (queue.length > 0) {
        const { path: p, dist } = queue.shift();
        if (visited.has(p) || dist > depth) continue;
        visited.add(p);
        const mod = nodes.get(p);
        if (mod) {
          for (const imp of mod.imports) {
            if (!visited.has(imp)) queue.push({ path: imp, dist: dist + 1 });
          }
          for (const impBy of mod.importedBy) {
            if (!visited.has(impBy)) queue.push({ path: impBy, dist: dist + 1 });
          }
        }
      }
      filteredNodes = [...visited].map((p) => nodes.get(p)).filter(Boolean);
    }
  }

  // Sort by path
  filteredNodes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: rootDir,
    totalFiles: files.length,
    analyzedFiles: filteredNodes.length,
    nodes: filteredNodes,
    externals: [...externalImports.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Index-based analysis (using codebase index)
// ---------------------------------------------------------------------------
function analyzeFromIndex(rootDir, options = {}) {
  const {
    depth = Infinity,
    focus = null,
    noExternals = false,
  } = options;

  rootDir = resolve(rootDir);
  const index = getCodebaseIndex();
  const stats = index.getStats();

  // Get all files and build nodes
  const rows = index.db.prepare('SELECT id, path FROM files ORDER BY path').all();
  const nodes = new Map();
  for (const row of rows) {
    const filePath = resolve(rootDir, row.path);
    nodes.set(row.path, { path: row.path, file: filePath, imports: [], importedBy: [] });
  }

  // Get import edges
  const edges = index.db.prepare(`
    SELECT f1.path as from_file, f2.path as to_file
    FROM imports i
    JOIN files f1 ON i.file_id = f1.id
    LEFT JOIN files f2 ON i.resolved_file_id = f2.id
    WHERE i.resolved_file_id IS NOT NULL
    ORDER BY f1.path
  `).all();

  for (const edge of edges) {
    const from = nodes.get(edge.from_file);
    const to = nodes.get(edge.to_file);
    if (from && to) {
      if (!from.imports.includes(edge.to_file)) from.imports.push(edge.to_file);
      if (!to.importedBy.includes(edge.from_file)) to.importedBy.push(edge.from_file);
    }
  }

  // External packages
  const externalImports = new Map();
  if (!noExternals) {
    const extRows = index.db.prepare(`
      SELECT f.path as from_file, i.import_path
      FROM imports i
      JOIN files f ON i.file_id = f.id
      WHERE i.resolved_file_id IS NULL
    `).all();

    for (const row of extRows) {
      const raw = row.import_path;
      const pkgName = raw.startsWith('.') ? raw : raw.split('/')[0].startsWith('@')
        ? raw.split('/').slice(0, 2).join('/')
        : raw.split('/')[0];
      if (!externalImports.has(pkgName)) {
        externalImports.set(pkgName, { name: pkgName, importedBy: [] });
      }
      if (!externalImports.get(pkgName).importedBy.includes(row.from_file)) {
        externalImports.get(pkgName).importedBy.push(row.from_file);
      }
    }
  }

  // Focus filtering
  let filteredNodes = [...nodes.values()];
  if (focus) {
    const focusRel = relative(rootDir, resolve(rootDir, focus));
    const focusMod = nodes.get(focusRel);
    if (focusMod) {
      const visited = new Set();
      const queue = [{ path: focusRel, dist: 0 }];
      while (queue.length > 0) {
        const { path: p, dist } = queue.shift();
        if (visited.has(p) || dist > depth) continue;
        visited.add(p);
        const mod = nodes.get(p);
        if (mod) {
          for (const imp of mod.imports) {
            if (!visited.has(imp)) queue.push({ path: imp, dist: dist + 1 });
          }
          for (const impBy of mod.importedBy) {
            if (!visited.has(impBy)) queue.push({ path: impBy, dist: dist + 1 });
          }
        }
      }
      filteredNodes = [...visited].map((p) => nodes.get(p)).filter(Boolean);
    }
  }

  filteredNodes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: rootDir,
    totalFiles: stats.files,
    analyzedFiles: filteredNodes.length,
    nodes: filteredNodes,
    externals: [...externalImports.values()].sort((a, b) => a.name.localeCompare(b.name)),
    source: 'codebase-index',
  };
}

function existsSync(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(result) {
  const lines = [];
  lines.push(`Import Graph Analysis`);
  lines.push(`====================`);
  lines.push(`Root: ${result.root}`);
  lines.push(`Total files scanned: ${result.totalFiles}`);
  lines.push(`Files in graph: ${result.analyzedFiles}`);
  if (result.externals.length > 0) {
    lines.push(`External packages: ${result.externals.length}`);
  }
  lines.push('');

  for (const node of result.nodes) {
    lines.push(`📄 ${node.path}`);
    if (node.imports.length > 0) {
      for (const imp of node.imports) {
        lines.push(`  └─→ ${imp}`);
      }
    } else {
      lines.push(`  (no internal imports)`);
    }
    if (node.importedBy.length > 0) {
      lines.push(`  (imported by: ${node.importedBy.length} files)`);
    }
    lines.push('');
  }

  if (result.externals.length > 0) {
    lines.push(`External Dependencies`);
    lines.push(`---------------------`);
    for (const ext of result.externals) {
      const files = ext.importedBy.slice(0, 5);
      const more = ext.importedBy.length > 5 ? ` ... and ${ext.importedBy.length - 5} more` : '';
      lines.push(`  📦 ${ext.name} (used by ${ext.importedBy.length} files)`);
      for (const f of files) {
        lines.push(`      └─ ${f}`);
      }
      if (more) lines.push(more);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatJSON(result) {
  return JSON.stringify(result, null, 2);
}

function formatDOT(result) {
  const lines = [];
  lines.push('digraph ImportGraph {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded, fontname="monospace"];');
  lines.push('  edge [arrowhead=vee, color="#666666"];');
  lines.push('');

  // Nodes
  for (const node of result.nodes) {
    const label = node.path.replace(/\\/g, '/');
    const escapedLabel = label.replace(/"/g, '\\"');
    const fillColor = node.importedBy.length === 0 && node.imports.length > 0
      ? '"#d4e8d4"' // greenish — source
      : node.importedBy.length > 0 && node.imports.length === 0
        ? '"#e8d4d4"' // reddish — sink
        : '"#e8e8e8"'; // gray
    lines.push(`  "${escapedLabel}" [label="${escapedLabel}", fillcolor=${fillColor}, style="filled,rounded"];`);
  }

  // External nodes
  if (result.externals.length > 0) {
    lines.push('');
    lines.push('  // External packages');
    for (const ext of result.externals) {
      lines.push(`  "ext:${ext.name}" [label="${ext.name}", shape=cylinder, fillcolor="#fff2cc", style=filled];`);
    }
  }

  // Edges (internal)
  lines.push('');
  lines.push('  // Internal dependencies');
  const edgeSet = new Set();
  for (const node of result.nodes) {
    for (const imp of node.imports) {
      const from = node.path.replace(/\\/g, '/').replace(/"/g, '\\"');
      const to = imp.replace(/\\/g, '/').replace(/"/g, '\\"');
      const key = `${from}|${to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        lines.push(`  "${from}" -> "${to}";`);
      }
    }
  }

  // Edges (external)
  if (result.externals.length > 0) {
    lines.push('');
    lines.push('  // External dependencies');
    for (const ext of result.externals) {
      for (const importer of ext.importedBy) {
        const from = importer.replace(/\\/g, '/').replace(/"/g, '\\"');
        lines.push(`  "${from}" -> "ext:${ext.name}" [style=dashed, color="#999999"];`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function formatMarkdown(result) {
  const lines = [];
  lines.push('# Import Dependency Graph');
  lines.push('');
  lines.push(`- **Root**: \`${result.root}\``);
  lines.push(`- **Files scanned**: ${result.totalFiles}`);
  lines.push(`- **Files in graph**: ${result.analyzedFiles}`);
  if (result.externals.length > 0) {
    lines.push(`- **External packages**: ${result.externals.length}`);
  }
  lines.push('');

  for (const node of result.nodes) {
    lines.push(`## \`${node.path}\``);
    lines.push('');
    if (node.imports.length > 0) {
      lines.push('**Imports:**');
      for (const imp of node.imports) {
        lines.push(`- \`${imp}\``);
      }
    }
    if (node.importedBy.length > 0) {
      lines.push('');
      lines.push(`**Imported by:** ${node.importedBy.length} file(s)`);
      for (const impBy of node.importedBy) {
        lines.push(`- \`${impBy}\``);
      }
    }
    if (node.imports.length === 0 && node.importedBy.length === 0) {
      lines.push('*(no dependencies)*');
    }
    lines.push('');
  }

  if (result.externals.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## External Dependencies');
    lines.push('');
    for (const ext of result.externals) {
      lines.push(`### \`${ext.name}\``);
      lines.push('');
      lines.push(`Used by ${ext.importedBy.length} file(s):`);
      for (const importer of ext.importedBy) {
        lines.push(`- \`${importer}\``);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        opts.root = args[++i];
        break;
      case '--format':
        opts.format = args[++i];
        break;
      case '--include':
        opts.include = [args[++i]];
        break;
      case '--exclude':
        opts.exclude = [args[++i]];
        break;
      case '--depth':
        opts.depth = parseInt(args[++i], 10);
        break;
      case '--focus':
        opts.focus = args[++i];
        break;
      case '--no-externals':
        opts.noExternals = true;
        break;
      case '--use-index':
        opts.useIndex = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node import-graph.mjs [options]

Options:
  --root <path>        Root directory to analyze (default: .)
  --format <fmt>       Output format: json, dot, text, markdown (default: text)
  --include <glob>     Include file pattern (default: **/*.{js,jsx,ts,...})
  --exclude <glob>     Exclude file pattern (default: **/node_modules/**, ...)
  --depth <number>     Max depth for focus mode (default: infinite)
  --focus <path>       Focus on a specific file's neighborhood
   --no-externals       Exclude external package references
   --use-index          Use pre-built codebase index (faster, requires smart_codebase_index build)
   -h, --help           Show this help
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const opts = parseArgs();
const root = opts.root || '.';
const format = opts.format || 'text';

let result;
if (opts.useIndex) {
  try {
    result = analyzeFromIndex(root, opts);
  } catch (e) {
    console.error(`Codebase index not available: ${e.message}. Run 'smart_codebase_index build' first.`);
    process.exit(1);
  }
} else {
  result = analyze(root, opts);
}

switch (format) {
  case 'json':
    console.log(formatJSON(result));
    break;
  case 'dot':
    console.log(formatDOT(result));
    break;
  case 'markdown':
    console.log(formatMarkdown(result));
    break;
  case 'text':
  default:
    console.log(formatText(result));
    break;
}
