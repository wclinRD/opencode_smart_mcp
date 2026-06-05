#!/usr/bin/env node

// cross-file-edit.mjs — Cross-file modification coordinator
//
// Given a change in one file (like a function rename or signature change),
// automatically finds all related files that need corresponding updates
// using the import graph.
//
// Usage:
//   node cross-file-edit.mjs <file-path> <old-pattern> <new-pattern> [options]
//
// Options:
//   --root <path>         Root directory (default: .)
//   --include <glob>      Include file pattern (repeatable)
//   --exclude <glob>      Exclude file pattern (repeatable)
//   --signature <type>    Change type: rename, signature (default: auto)
//   --format <fmt>        Output: text, json, diff (default: text)
//   --dry-run             Only show what would change (default: true)
//   --apply               Actually apply changes (default: false)
//   --context <N>         Lines of context in output (default: 2)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, extname, dirname, basename } from 'node:path';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

const IMPORT_RE = [
  /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+(?:\w+\s+)*\w+\s+from\s+['"]([^'"]+)['"]\s*;?/g,
];

function extractRelativeImports(filePath) {
  const ext = extname(filePath);
  if (!['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(ext)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports = [];
    for (const re of IMPORT_RE) {
      let match;
      while ((match = re.exec(content)) !== null) {
        const raw = match[1].trim();
        if (raw.startsWith('.') || raw.startsWith('..')) imports.push(raw);
      }
    }
    return imports;
  } catch { return []; }
}

function resolveImportPath(importerPath, importSpec) {
  const importerDir = dirname(importerPath);
  const resolved = resolve(importerDir, importSpec);
  const exts = ['.js', '.mjs', '.ts', '.jsx', '.tsx'];
  for (const ext of exts) {
    const candidate = resolved + ext;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of exts) {
    const candidate = resolve(resolved, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildImportGraph(files) {
  const graph = new Map();
  for (const f of files) {
    if (!graph.has(f)) graph.set(f, { imports: new Set(), importedBy: new Set() });
    const relImports = extractRelativeImports(f);
    for (const imp of relImports) {
      const resolved = resolveImportPath(f, imp);
      if (resolved) {
        graph.get(f).imports.add(resolved);
        if (!graph.has(resolved)) graph.set(resolved, { imports: new Set(), importedBy: new Set() });
        graph.get(resolved).importedBy.add(f);
      }
    }
  }
  return graph;
}

function findAffectedFiles(graph, targetFile) {
  // Find all files that import the target (directly or transitively)
  const affected = new Set();
  const queue = [targetFile];
  while (queue.length > 0) {
    const current = queue.shift();
    const entry = graph.get(current);
    if (!entry) continue;
    for (const importer of entry.importedBy) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }
  return [...affected];
}

// ---------------------------------------------------------------------------
// Content analysis
// ---------------------------------------------------------------------------
function findPatternInFile(filePath, pattern) {
  const results = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const re = pattern instanceof RegExp ? pattern : new RegExp(escapeRegex(pattern), 'g');

    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(lines[i])) !== null) {
        results.push({
          line: i + 1,
          column: match.index + 1,
          content: lines[i],
          matchedText: match[0],
        });
      }
    }
    return results;
  } catch { return []; }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyReplacement(filePath, replacements) {
  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch { return false; }

  const lines = content.split('\n');
  let modified = false;

  // Apply in reverse line order to preserve line numbers
  const sorted = [...replacements].sort((a, b) => b.line - a.line || b.column - a.column);
  for (const r of sorted) {
    const idx = r.line - 1;
    if (idx >= 0 && idx < lines.length) {
      const line = lines[idx];
      const before = line.substring(0, r.column - 1);
      const matchText = line.substring(r.column - 1, r.column - 1 + r.oldText.length);
      if (matchText === r.oldText) {
        lines[idx] = before + r.newText + line.substring(r.column - 1 + r.oldText.length);
        modified = true;
      }
    }
  }

  if (modified) {
    writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }
  return modified;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(primaryFile, changes, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color
    ? `${c.bold}Cross-File Edit Analysis${c.reset}`
    : 'Cross-File Edit Analysis');
  out.push('='.repeat(40));
  out.push('');

  for (const [filePath, matches] of Object.entries(changes)) {
    const rel = relative(opts.root, filePath);
    const isPrimary = filePath === primaryFile;
    const prefix = isPrimary ? '★' : ' ';
    if (color) {
      out.push(`${prefix} ${isPrimary ? c.bold + c.green : c.cyan}${rel}${c.reset} (${matches.length} match(es))`);
    } else {
      out.push(`${prefix} ${rel} (${matches.length} match(es))`);
    }

    for (const m of matches) {
      const ctxBefore = opts.context || 2;
      // Show context lines
      // Just show the match line with context indicator
      if (color) {
        out.push(`  ${c.yellow}Ln ${m.line}:${m.column}${c.reset}`);
        if (m.oldContent !== undefined && m.newContent !== undefined) {
          out.push(`  ${c.red}- ${m.oldContent.trim()}${c.reset}`);
          out.push(`  ${c.green}+ ${m.newContent.trim()}${c.reset}`);
        } else {
          out.push(`  ${c.dim}  ${m.content.trim()}${c.reset}`);
        }
      } else {
        out.push(`  Ln ${m.line}:${m.column}`);
        if (m.oldContent !== undefined && m.newContent !== undefined) {
          out.push(`  - ${m.oldContent.trim()}`);
          out.push(`  + ${m.newContent.trim()}`);
        } else {
          out.push(`    ${m.content.trim()}`);
        }
      }
      out.push('');
    }
  }

  if (opts.dryRun && !opts.apply) {
    out.push(color
      ? `${c.dim}Dry run. Use --apply to apply changes.${c.reset}`
      : 'Dry run. Use --apply to apply changes.');
  }

  return out.join('\n');
}

function formatJSON(changes) {
  return JSON.stringify({ files: Object.keys(changes).length, changes }, null, 2);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length < 3 ? 1 : 0);
  }

  const opts = {
    filePath: args[0],
    oldPattern: args[1],
    newPattern: args[2],
    root: '.',
    include: [],
    exclude: [],
    signature: 'auto',
    format: 'text',
    dryRun: true,
    apply: false,
    context: 2,
    color: undefined,
  };

  let i = 3;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--include': opts.include.push(args[++i]); break;
      case '--exclude': opts.exclude.push(args[++i]); break;
      case '--signature': opts.signature = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--apply': opts.apply = true; opts.dryRun = false; break;
      case '--context': opts.context = parseInt(args[++i], 10); break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,mjs,cjs,jsx,ts,tsx}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node cross-file-edit.mjs <file-path> <old-pattern> <new-pattern> [options]

Cross-file modification coordinator.

Arguments:
  file-path             The primary file being modified
  old-pattern           Text or regex pattern to find
  new-pattern           Replacement text

Options:
  --root <path>         Root directory (default: .)
  --include <glob>      Include file pattern (repeatable)
  --exclude <glob>      Exclude file pattern (repeatable)
  --signature <type>    Change type: rename, signature (default: auto)
  --format <fmt>        Output: text, json (default: text)
  --dry-run             Only show what would change (default: true)
  --apply               Actually apply changes (default: false)
  --context <N>         Lines of context (default: 2)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node cross-file-edit.mjs src/utils.js oldFunc newFunc
  node cross-file-edit.mjs src/api.js "oldMethod" "newMethod" --apply
  node cross-file-edit.mjs src/component.jsx "propName" "newPropName" --root ./src
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  const primaryFile = resolve(opts.filePath);
  if (!existsSync(primaryFile)) {
    console.error(`File not found: ${primaryFile}`);
    process.exit(1);
  }

  // Find all project files
  const files = findFiles(root, opts.include, opts.exclude);
  if (files.length === 0) {
    console.log('No matching files found.');
    return;
  }

  // Build import graph
  const graph = buildImportGraph(files);

  // Find affected files (those that import the primary file)
  const affectedFiles = findAffectedFiles(graph, primaryFile);

  // Also include the primary file itself
  const allTargetFiles = [primaryFile, ...affectedFiles].filter(f => files.includes(f) || f === primaryFile);

  // Search for the pattern in all affected files
  const changes = {};
  const oldPattern = opts.oldPattern;

  // Determine if pattern is a regex or literal string
  let searchRe;
  try {
    searchRe = new RegExp(escapeRegex(oldPattern), 'g');
  } catch {
    searchRe = new RegExp(oldPattern, 'g');
  }

  for (const filePath of allTargetFiles) {
    const matches = findPatternInFile(filePath, searchRe);
    if (matches.length > 0) {
      changes[filePath] = matches.map(m => ({
        ...m,
        oldText: oldPattern,
        newText: opts.newPattern,
        oldContent: m.content,
        newContent: m.content.replace(searchRe, opts.newPattern),
      }));
    }
  }

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(changes));
      break;
    case 'text':
    default:
      console.log(formatText(primaryFile, changes, opts, color));
      break;
  }

  // Apply changes
  if (opts.apply) {
    let totalModified = 0;
    for (const [filePath, matches] of Object.entries(changes)) {
      const replacements = matches.map(m => ({
        line: m.line,
        column: m.column,
        oldText: m.oldText,
        newText: m.newText,
      }));
      if (applyReplacement(filePath, replacements)) {
        totalModified++;
      }
    }
    console.log(`\nApplied changes to ${totalModified} file(s).`);
  }
}

main();
