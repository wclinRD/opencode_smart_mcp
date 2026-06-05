#!/usr/bin/env node

// rename-safety.mjs — Multi-file rename safety checker
//
// Analyzes all references to a symbol across the project and produces
// a safe rename plan, detecting conflicts and shadowing issues.
//
// Usage:
//   node rename-safety.mjs <old-name> <new-name> [options]
//
// Options:
//   --root <path>         Root directory to analyze (default: .)
//   --include <glob>      Include file pattern (repeatable)
//   --exclude <glob>      Exclude file pattern (repeatable)
//   --dry-run             Only show what would be renamed (default: true)
//   --apply               Actually perform the rename (default: false)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname, dirname, basename } from 'node:path';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Rename analysis
// ---------------------------------------------------------------------------
function buildWordBoundaryRegex(name) {
  // Match the name as a whole word (not part of another identifier)
  return new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, 'g');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function analyzeSymbolReferences(files, oldName, newName) {
  const references = []; // { file, line, column, context, isDefinition, isConflict }
  const definitions = [];
  const conflicts = [];
  const fileSet = new Set();

  const wordBoundaryRe = buildWordBoundaryRegex(oldName);
  const newNameRe = buildWordBoundaryRegex(newName);

  for (const filePath of files) {
    let content;
    try { content = readFileSync(filePath, 'utf-8'); }
    catch { continue; }

    const lines = content.split('\n');
    const fileRefs = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if new name already exists on this line (potential conflict)
      const hasNewName = newNameRe.test(line);

      wordBoundaryRe.lastIndex = 0;
      let match;
      while ((match = wordBoundaryRe.exec(line)) !== null) {
        const isDef = isDefinitionLine(line, match.index, oldName);
        const conflict = hasNewName && !isDef;

        const ref = {
          file: filePath,
          relFile: relative(process.cwd(), filePath),
          line: i + 1,
          column: match.index + 1,
          context: extractContext(line, match.index, oldName.length),
          isDefinition: isDef,
          isConflict: !isDef && hasNewName,
        };

        fileRefs.push(ref);
        fileSet.add(filePath);

        if (isDef) definitions.push(ref);
        if (ref.isConflict) conflicts.push(ref);
      }
    }

    references.push(...fileRefs);
  }

  return {
    references,
    definitions,
    conflicts,
    totalFiles: fileSet.size,
    totalReferences: references.length,
    totalDefinitions: definitions.length,
    totalConflicts: conflicts.length,
  };
}

function isDefinitionLine(line, matchIndex, name) {
  const before = line.substring(Math.max(0, matchIndex - 20), matchIndex).trim();
  // Check for common definition patterns
  const definitionPatterns = [
    /(?:const|let|var|function|class|interface|type|enum)\s*$/,
    /(?:import\s+)\w+\s*,\s*\{?\s*$/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*$/,
    /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:readonly\s+)?\w+\s*$/,
    /\bdef\s+$/,
    /\bval\s+$/,
    /\bvar\s+$/,
    /\bval\s+\w+\s*:\s*$/,
    /^\s*(\w+\.)*\w+\s*[=:]\s*$/,
    /^\s*set\s+/,
    /^\s*get\s+/,
    /^\s*async\s+/,
    /\bin\s+\w+\s*,\s*$/,
    /{:s*$/,
  ];

  for (const pattern of definitionPatterns) {
    if (pattern.test(before)) return true;
  }

  // Check if this is a named export like `export { foo }` (not a definition)
  if (/^\s*export\s+\{/.test(line)) return false;

  return false;
}

function extractContext(line, index, nameLength) {
  const before = line.substring(0, index);
  const match = line.substring(index, index + nameLength);
  const after = line.substring(index + nameLength);
  return { before, match, after };
}

function checkFileConflicts(files, newName) {
  // Check if renaming would conflict with existing symbols
  const wordRe = buildWordBoundaryRegex(newName);
  const conflicts = [];

  for (const filePath of files) {
    let content;
    try { content = readFileSync(filePath, 'utf-8'); }
    catch { continue; }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      wordRe.lastIndex = 0;
      if (wordRe.test(lines[i])) {
        conflicts.push({
          file: filePath,
          line: i + 1,
          context: lines[i].trim().substring(0, 100),
        });
      }
    }
  }

  return conflicts;
}

function generateRenamePlan(oldName, newName, analysis) {
  const plan = [];

  // Group by file
  const byFile = {};
  for (const ref of analysis.references) {
    if (!byFile[ref.relFile]) byFile[ref.relFile] = [];
    byFile[ref.relFile].push(ref);
  }

  for (const [file, refs] of Object.entries(byFile)) {
    plan.push({
      file,
      changes: refs.map(r => ({
        line: r.line,
        column: r.column,
        oldName,
        newName,
        isDefinition: r.isDefinition,
        isConflict: r.isConflict,
      })),
      safe: refs.every(r => !r.isConflict),
    });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(oldName, newName, analysis, plan, opts, color) {
  const c = COLORS;
  const lines = [];

  lines.push(color
    ? `${c.bold}Rename Analysis:${c.reset} ${c.red}'${oldName}'${c.reset} → ${c.green}'${newName}'${c.reset}`
    : `Rename Analysis: '${oldName}' → '${newName}'`);
  lines.push('='.repeat(50));
  lines.push('');

  lines.push(color
    ? `${c.bold}Summary${c.reset}`
    : 'Summary');
  lines.push(`  Files affected: ${analysis.totalFiles}`);
  lines.push(`  Total references: ${analysis.totalReferences}`);
  lines.push(`  Definitions found: ${analysis.totalDefinitions}`);
  lines.push(`  Conflicts detected: ${analysis.totalConflicts}`);
  lines.push('');

  if (analysis.totalConflicts > 0) {
    lines.push(color
      ? `${c.bold}${c.red}⚠ Conflicts detected!${c.reset}`
      : '⚠ Conflicts detected!');
    lines.push('');
    for (const conflict of analysis.conflicts) {
      if (color) {
        lines.push(`  ${c.red}${conflict.relFile}:${conflict.line}:${conflict.column}${c.reset}`);
        lines.push(`    ${c.dim}New name '${newName}' already in use${c.reset}`);
        lines.push(`    ${conflict.context.before}${c.bgRed}${c.bold}${conflict.context.match}${c.reset}${conflict.context.after}`);
      } else {
        lines.push(`  ${conflict.relFile}:${conflict.line}:${conflict.column}`);
        lines.push(`    New name '${newName}' already in use`);
        lines.push(`    ${conflict.context.before}${conflict.context.match}${conflict.context.after}`);
      }
    }
    lines.push('');
  }

  // Rename plan by file
  lines.push(color
    ? `${c.bold}Rename Plan${c.reset}`
    : 'Rename Plan');

  const sortedPlan = plan.sort((a, b) => a.file.localeCompare(b.file));
  for (const entry of sortedPlan) {
    const safe = entry.safe ? `${c.green}✓${c.reset}` : `${c.red}⚠${c.reset}`;
    if (color) {
      lines.push(`  ${safe} ${c.cyan}${entry.file}${c.reset} (${entry.changes.length} change(s))`);
    } else {
      lines.push(`  ${entry.safe ? '✓' : '⚠'} ${entry.file} (${entry.changes.length} change(s))`);
    }
    for (const change of entry.changes) {
      if (color) {
        const def = change.isDefinition ? `${c.yellow}[def]${c.reset}` : '';
        const conflict = change.isConflict ? `${c.red}[conflict]${c.reset}` : '';
        lines.push(`    Ln ${change.line}:${change.column} ${def}${conflict}`);
      } else {
        const def = change.isDefinition ? '[def]' : '';
        const conflict = change.isConflict ? '[conflict]' : '';
        lines.push(`    Ln ${change.line}:${change.column} ${def}${conflict}`);
      }
    }
  }
  lines.push('');

  if (opts.dryRun && !opts.apply) {
    lines.push(color
      ? `${c.dim}This is a dry run. Use --apply to perform the rename.${c.reset}`
      : 'This is a dry run. Use --apply to perform the rename.');
  }

  return lines.join('\n');
}

function formatJSON(oldName, newName, analysis, plan) {
  return JSON.stringify({
    oldName,
    newName,
    summary: {
      totalFiles: analysis.totalFiles,
      totalReferences: analysis.totalReferences,
      totalDefinitions: analysis.totalDefinitions,
      totalConflicts: analysis.totalConflicts,
    },
    conflicts: analysis.conflicts,
    plan,
  }, null, 2);
}

function formatMarkdown(oldName, newName, analysis, plan) {
  const lines = [];
  lines.push(`# Rename Analysis: \`${oldName}\` → \`${newName}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Files affected**: ${analysis.totalFiles}`);
  lines.push(`- **Total references**: ${analysis.totalReferences}`);
  lines.push(`- **Definitions**: ${analysis.totalDefinitions}`);
  lines.push(`- **Conflicts**: ${analysis.totalConflicts}`);
  lines.push('');

  if (analysis.totalConflicts > 0) {
    lines.push('## ⚠ Conflicts');
    lines.push('');
    for (const conflict of analysis.conflicts) {
      lines.push(`- \`${conflict.relFile}:${conflict.line}:${conflict.column}\``);
      lines.push(`  - New name \`${newName}\` already in use`);
      lines.push(`  - \`${conflict.context.before}${conflict.context.match}${conflict.context.after}\``);
    }
    lines.push('');
  }

  lines.push('## Rename Plan');
  lines.push('');
  const sortedPlan = plan.sort((a, b) => a.file.localeCompare(b.file));
  for (const entry of sortedPlan) {
    const safe = entry.safe ? '✓' : '⚠';
    lines.push(`### ${safe} \`${entry.file}\``);
    lines.push('');
    lines.push(`Changes: ${entry.changes.length}`);
    lines.push('');
    for (const change of entry.changes) {
      const def = change.isDefinition ? ' (definition)' : '';
      const conflict = change.isConflict ? ' ⚠ conflict' : '';
      lines.push(`- Line ${change.line}:${change.column}${def}${conflict}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Apply rename
// ---------------------------------------------------------------------------
function applyRename(plan) {
  const filesModified = [];

  for (const entry of plan) {
    if (!entry.safe) continue;

    const absPath = resolve(entry.file);
    let content;
    try { content = readFileSync(absPath, 'utf-8'); }
    catch { continue; }

    const lines = content.split('\n');
    let modified = false;

    for (const change of entry.changes) {
      const idx = change.line - 1;
      if (idx >= 0 && idx < lines.length) {
        const line = lines[idx];
        const before = line.substring(0, change.column - 1);
        const after = line.substring(change.column - 1 + change.oldName.length);
        // Verify old name is still there
        if (line.substring(change.column - 1, change.column - 1 + change.oldName.length) === change.oldName) {
          lines[idx] = before + change.newName + after;
          modified = true;
        }
      }
    }

    if (modified) {
      writeFileSync(absPath, lines.join('\n'), 'utf-8');
      filesModified.push(entry.file);
    }
  }

  return filesModified;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const opts = {
    oldName: args[0],
    newName: args[1],
    root: '.',
    include: [],
    exclude: [],
    dryRun: true,
    apply: false,
    format: 'text',
    color: undefined,
  };

  let i = 2;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--include': opts.include.push(args[++i]); break;
      case '--exclude': opts.exclude.push(args[++i]); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--apply': opts.apply = true; opts.dryRun = false; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,py,rb,rs,java,kt,go,php}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/__pycache__/**', '**/package-lock.json'];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node rename-safety.mjs <old-name> <new-name> [options]

Multi-file rename safety checker with conflict detection.

Arguments:
  old-name              The existing symbol name to rename
  new-name              The new symbol name

Options:
  --root <path>         Root directory to analyze (default: .)
  --include <glob>      Include file pattern (repeatable)
  --exclude <glob>      Exclude file pattern (repeatable)
  --dry-run             Only show what would be renamed (default: true)
  --apply               Actually perform the rename (default: false)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node rename-safety.mjs oldFunc newFunc
  node rename-safety.mjs OldComponent NewComponent --root ./src
  node rename-safety.mjs snake_case_var camelCaseVar --apply
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  const files = findFiles(root, opts.include, opts.exclude);

  if (files.length === 0) {
    console.log('No matching files found.');
    return;
  }

  // Analyze references
  const analysis = analyzeSymbolReferences(files, opts.oldName, opts.newName);

  // Generate rename plan
  const plan = generateRenamePlan(opts.oldName, opts.newName, analysis);

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(opts.oldName, opts.newName, analysis, plan));
      break;
    case 'markdown':
      console.log(formatMarkdown(opts.oldName, opts.newName, analysis, plan));
      break;
    case 'text':
    default:
      console.log(formatText(opts.oldName, opts.newName, analysis, plan, opts, color));
      break;
  }

  // Apply rename
  if (opts.apply && analysis.totalConflicts === 0) {
    const modified = applyRename(plan);
    if (modified.length > 0) {
      console.log(`\nRenamed in ${modified.length} file(s):`);
      for (const f of modified) {
        console.log(`  ✓ ${f}`);
      }
    }
  } else if (opts.apply && analysis.totalConflicts > 0) {
    console.log('\nCannot apply rename: conflicts detected. Resolve conflicts first.');
  }
}

main();
