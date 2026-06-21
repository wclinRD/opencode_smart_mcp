#!/usr/bin/env node

// contextual-grep.mjs — Enhanced grep with context and cross-file awareness
//
// Searches files with regex patterns and presents results enriched with
// surrounding context, file metadata, and import-graph cross-references.
//
// Usage:
//   node contextual-grep.mjs <pattern> [options]
//
// Options:
//   --root <path>         Root directory to search (default: .)
//   --include <glob>      Include file pattern (default: **/*.{js,jsx,ts,tsx,...})
//   --exclude <glob>      Exclude file pattern (default: **/node_modules/**, ...)
//   --context <N>         Lines of context before and after each match (default: 3)
//   --before <N>          Lines of context before each match
//   --after <N>           Lines of context after each match
//   --with-imports        Show import graph context for matched files
//   --format <fmt>        Output format: text, json, markdown (default: text)
//   --color               Force color output
//   --no-color            Disable color output
//   --ignore-case         Case-insensitive search
//   --max-matches <N>     Maximum matches per file (default: 100)
//   --files-only          Only show file names, not matched lines
//   -h, --help            Show this help

import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, extname, dirname, sep } from 'node:path';
import { globToRegex, matchGlob, findFiles, COLORS, useColor } from '../lib/utils.mjs';
import { rankResults, applyRerankSignals } from '../lib/bm25.mjs';
import { detectQueryType } from '../lib/query-detector.mjs';
import { semanticSearch } from '../lib/semantic-search.mjs';
import { hybridRank } from '../lib/hybrid-search.mjs';
import { loadCache, saveCache, getCachedOrEmbed } from '../lib/embedding-cache.mjs';
import { fitToBudget, compressLevel } from '../lib/token-budget.mjs';

// ---------------------------------------------------------------------------
// Scope detection — find enclosing function/class/block for a line
// ---------------------------------------------------------------------------
const SCOPE_PATTERNS = {
  'javascript-typescript': {
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    // Match definition lines
    definitions: [
      /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
      /^(?:export\s+)?(?:async\s+)?\(?\s*(?:\w+\s*,\s*)*\w*\s*\)?\s*=>\s*{/,
      /^(?:export\s+)?class\s+\w+/,
      /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\(|=>)/,
      /^(?:export\s+)?(?:default\s+)?(?:function|class)\s/,
      /^\s*(?:async\s+)?\w+\s*\([\s\S]*?\)\s*{/,
      /^\s*(?:get|set)\s+\w+\s*\(/,
      /^\s*interface\s+\w+/,
      /^\s*(?:abstract\s+)?class\s+\w+/,
    ],
    // End markers (dedent-based)
  },
  python: {
    exts: ['.py'],
    definitions: [
      /^\s*(?:async\s+)?def\s+\w+/,
      /^\s*class\s+\w+/,
      /^\s*@\w+/,
    ],
  },
  ruby: {
    exts: ['.rb'],
    definitions: [
      /^\s*(?:def|class|module)\s+\w+/,
    ],
  },
};

function detectLanguage(ext) {
  for (const [lang, config] of Object.entries(SCOPE_PATTERNS)) {
    if (config.exts.includes(ext.toLowerCase())) return lang;
  }
  return null;
}

function getEnclosingScope(lines, targetLine) {
  // Returns the name and range of the function/class that contains targetLine
  const stack = []; // { name, indent, startLine, type }
  let lastSignificant = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Pop stack when dedent occurs
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      if (i > targetLine && stack[stack.length - 1].startLine <= targetLine) {
        return stack[stack.length - 1];
      }
      stack.pop();
    }

    // Check for definition lines across all languages
    for (const patterns of Object.values(SCOPE_PATTERNS)) {
      for (const re of patterns.definitions) {
        const match = trimmed.match(re);
        if (match) {
          const name = match[0].replace(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?/, '').trim();
          stack.push({ name, indent, startLine: i, type: 'function' });
          break;
        }
      }
    }

    // Track brace-based scope for C-family
    if (trimmed.endsWith('{')) {
      // This is a block start, but we already handle via definitions
      lastSignificant = { line: i, indent };
    }
  }

  // Return the innermost scope that contains targetLine
  let best = null;
  for (const scope of stack) {
    if (scope.startLine <= targetLine && scope.startLine > (best ? best.startLine : -1)) {
      best = scope;
    }
  }
  return best;
}

function extractFileStructure(content, ext) {
  // Extract module-level symbols: functions, classes, const/let/var exports
  const lines = content.split('\n');
  const symbols = [];
  const lang = detectLanguage(ext);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    let match;
    // JS/TS patterns — only module-level (indent 0)
    if (lang === 'javascript-typescript') {
      if (lines[i].startsWith(' ') || lines[i].startsWith('\t')) continue;
      if ((match = trimmed.match(/^(?:export\s+default\s+)?(?:async\s+)?function\s+(\w+)/)) ||
          (match = trimmed.match(/^(?:export\s+)?class\s+(\w+)/)) ||
          (match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/)) ||
          (match = trimmed.match(/^\s*interface\s+(\w+)/)) ||
          (match = trimmed.match(/^\s*type\s+(\w+)\s*=/)) ||
          (match = trimmed.match(/^(?:export\s+)?enum\s+(\w+)/))) {
        symbols.push({ line: i + 1, name: match[1], kind: 'definition' });
      }
    } else if (lang === 'python') {
      if (lines[i].startsWith(' ') || lines[i].startsWith('\t')) continue;
      if ((match = trimmed.match(/^\s*(?:async\s+)?def\s+(\w+)/)) ||
          (match = trimmed.match(/^\s*class\s+(\w+)/))) {
        symbols.push({ line: i + 1, name: match[1], kind: 'definition' });
      }
    }
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// The search engine
// ---------------------------------------------------------------------------
function searchFiles(files, regex, opts) {
  const results = [];
  const maxMatches = opts.maxMatches || 100;

  for (const filePath of files) {
    let content;
    try { content = readFileSync(filePath, 'utf-8'); }
    catch { continue; }

    const lines = content.split('\n');
    const fileResults = [];
    let matchCount = 0;
    regex.lastIndex = 0;

    // ── countOnly mode: just count matches per file ──
    if (opts.countOnly) {
      for (let i = 0; i < lines.length; i++) {
        const lineRegex = new RegExp(regex.source, regex.flags.replace('g', '') + 'g');
        let match;
        while ((match = lineRegex.exec(lines[i])) !== null) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        results.push({
          file: filePath,
          relFile: relative(opts.root || '.', filePath),
          matchCount,
        });
      }
      continue;
    }

    // ── invert mode: collect lines that do NOT match ──
    if (opts.invert) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Use non-global regex for test() to avoid stateful lastIndex issues
        const lineRegex = new RegExp(regex.source, regex.flags.replace('g', ''));
        if (!lineRegex.test(line)) {
          matchCount++;
          fileResults.push({
            line: i + 1,
            column: 1,
            matchLength: line.length,
            matchedText: line.substring(0, 200),
            lineContent: line,
            contextBefore: lines.slice(Math.max(0, i - opts.before), i),
            contextAfter: lines.slice(i + 1, Math.min(lines.length, i + 1 + opts.after)),
          });
          if (matchCount >= maxMatches) break;
        }
      }
      if (fileResults.length > 0) {
        let fileInfo;
        try {
          const st = statSync(filePath);
          fileInfo = { size: st.size, modified: st.mtime.toISOString(), lines: lines.length };
        } catch { fileInfo = {}; }
        results.push({
          file: filePath,
          relFile: relative(opts.root || '.', filePath),
          ...fileInfo,
          matches: fileResults,
        });
      }
      continue;
    }

    // ── normal mode: collect matching lines ──
    // Check for multi-line regex
    const isMultiLine = regex.source.includes('\\n') || regex.source.includes('\\s\\S');

    if (isMultiLine) {
      // Multi-line: search entire content
      let match;
      while ((match = regex.exec(content)) !== null) {
        matchCount++;
        const lineNum = content.substring(0, match.index).split('\n').length;
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const lineEnd = content.indexOf('\n', match.index);
        const lineContent = lineEnd === -1
          ? content.substring(lineStart)
          : content.substring(lineStart, lineEnd);

        fileResults.push({
          line: lineNum,
          column: match.index - lineStart + 1,
          matchLength: match[0].length,
          matchedText: match[0].substring(0, 200),
          lineContent,
          contextBefore: content.substring(Math.max(0, lineStart - 100), lineStart).split('\n').slice(-opts.before),
          contextAfter: content.substring(lineEnd !== -1 ? lineEnd + 1 : content.length).split('\n').slice(0, opts.after),
          isMultiLine: true,
        });
        if (matchCount >= maxMatches) break;
      }
    } else {
      // Single-line: search per line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineRegex = new RegExp(regex.source, regex.flags.replace('g', '') + 'g');
        let match;
        while ((match = lineRegex.exec(line)) !== null) {
          matchCount++;
          fileResults.push({
            line: i + 1,
            column: match.index + 1,
            matchLength: match[0].length,
            matchedText: match[0],
            lineContent: line,
            contextBefore: lines.slice(Math.max(0, i - opts.before), i),
            contextAfter: lines.slice(i + 1, Math.min(lines.length, i + 1 + opts.after)),
          });
          if (matchCount >= maxMatches) break;
        }
        if (matchCount >= maxMatches) break;
      }
    }

    // Attach scope info to each match
    if (opts.withScope && fileResults.length > 0) {
      for (const match of fileResults) {
        const scope = getEnclosingScope(lines, match.line - 1);
        if (scope) {
          match.scopeName = scope.name;
          match.scopeStartLine = scope.startLine + 1;
        }
      }
    }

    if (fileResults.length > 0) {
      let fileInfo;
      try {
        const st = statSync(filePath);
        fileInfo = {
          size: st.size,
          modified: st.mtime.toISOString(),
          lines: lines.length,
        };
      } catch { fileInfo = {}; }

      // Attach file structure overview
      let structure = null;
      if (opts.withStructure) {
        structure = extractFileStructure(content, extname(filePath));
      }

      results.push({
        file: filePath,
        relFile: relative(opts.root || '.', filePath),
        ...fileInfo,
        structure,
        matches: fileResults,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Import graph integration (lightweight)
// ---------------------------------------------------------------------------
const LANGUAGE_MATCHERS = [
  {
    name: 'javascript-typescript',
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    matchers: [
      /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /export\s+(?:\w+\s+)*\w+\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    ],
  },
  {
    name: 'python', exts: ['.py'],
    matchers: [
      /^import\s+([\w.]+)/gm,
      /^from\s+([\w.]+)\s+import/gm,
    ],
  },
  {
    name: 'ruby', exts: ['.rb'],
    matchers: [
      /require\s+['"]([^'"]+)['"]/g,
      /require_relative\s+['"]([^'"]+)['"]/g,
    ],
  },
  {
    name: 'rust', exts: ['.rs'],
    matchers: [
      /^use\s+([\w:]+)/gm,
      /^extern\s+crate\s+(\w+)/gm,
    ],
  },
  {
    name: 'go', exts: ['.go'],
    matchers: [
      /^import\s+["]([^"]+)["]/gm,
      /^\t["]([^"]+)["]/gm,
    ],
  },
  {
    name: 'java', exts: ['.java', '.kt'],
    matchers: [
      /^import\s+(?:static\s+)?([\w.*]+)\s*;/gm,
    ],
  },
  {
    name: 'php', exts: ['.php'],
    matchers: [
      /^use\s+([\w\\]+)/gm,
      /(?:include|require)(?:_once)?\s+['"]([^'"]+)['"]\s*;/g,
    ],
  },
  {
    name: 'c-cpp', exts: ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx'],
    matchers: [
      /#include\s+["]([^"]+)["]/g,
      /#include\s+[<]([^>]+)[>]/g,
    ],
  },
];

function getCommentRanges(content, lang) {
  const ranges = [];
  const stringRanges = [];
  if (lang === 'python') {
    const strRe = /'''[\s\S]*?'''|"""[\s\S]*?"""|'[^']*'|"[^"]*"/g;
    let m;
    while ((m = strRe.exec(content)) !== null) stringRanges.push([m.index, m.index + m[0].length]);
    const commentRe = /#.*$/gm;
    while ((m = commentRe.exec(content)) !== null) {
      if (!stringRanges.some(([s, e]) => m.index >= s && m.index < e)) ranges.push([m.index, m.index + m[0].length]);
    }
  } else {
    const strRe = /(['"`])(?:(?!\1|\\).|\\.)*\1/g;
    let m;
    while ((m = strRe.exec(content)) !== null) stringRanges.push([m.index, m.index + m[0].length]);
    const slRe = /\/\/.*$/gm;
    while ((m = slRe.exec(content)) !== null) {
      if (!stringRanges.some(([s, e]) => m.index >= s && m.index < e)) ranges.push([m.index, m.index + m[0].length]);
    }
    const mlRe = /\/\*[\s\S]*?\*\//g;
    while ((m = mlRe.exec(content)) !== null) {
      if (!stringRanges.some(([s, e]) => m.index >= s && m.index < e)) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

function isInRanges(pos, ranges) {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

function extractImports(filePath) {
  const ext = extname(filePath).toLowerCase();
  const matcherDef = LANGUAGE_MATCHERS.find(m => m.exts.includes(ext));
  if (!matcherDef) return [];
  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch { return []; }
  const commentRanges = getCommentRanges(content, matcherDef.name);
  const imports = [];
  for (const matcher of matcherDef.matchers) {
    matcher.lastIndex = 0;
    let match;
    while ((match = matcher.exec(content)) !== null) {
      if (isInRanges(match.index, commentRanges)) continue;
      const rawPath = match[1].trim();
      if (rawPath) imports.push(rawPath);
    }
  }
  return imports;
}

function getImportContext(filePath, rootDir) {
  const relPath = relative(rootDir, filePath);
  const imports = extractImports(filePath);
  return { path: relPath, imports };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(results, opts, color) {
  const lines = [];
  const c = COLORS;

  if (results.length === 0) {
    return color
      ? `${c.yellow}No matches found.${c.reset}`
      : 'No matches found.';
  }

  // ── countOnly mode: simple file:count output ──
  if (opts.countOnly) {
    const totalCount = results.reduce((sum, r) => sum + (r.matchCount || 0), 0);
    lines.push(color
      ? `${c.bold}${c.green}${results.length} file(s), ${totalCount} total match(es)${c.reset}`
      : `${results.length} file(s), ${totalCount} total match(es)`);
    for (const r of results) {
      lines.push(color
        ? `  ${c.blue}${r.relFile}${c.reset}${c.dim}: ${r.matchCount}${c.reset}`
        : `  ${r.relFile}: ${r.matchCount}`);
    }
    return lines.join('\n');
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
  lines.push(color
    ? `${c.bold}${c.green}${results.length} file(s), ${totalMatches} match(es)${c.reset}`
    : `${results.length} file(s), ${totalMatches} match(es)`);
  lines.push('');

  for (const fileResult of results) {
    if (color) {
      lines.push(`${c.bold}${c.blue}━━━ ${fileResult.relFile}${c.reset} ${c.dim}(${fileResult.lines} lines, ${fileResult.size} bytes)${c.reset}`);
      if (fileResult.imports && fileResult.imports.length > 0) {
        lines.push(`  ${c.dim}imports: ${fileResult.imports.join(', ')}${c.reset}`);
      }
      if (fileResult.importedBy && fileResult.importedBy.length > 0) {
        const shown = fileResult.importedBy.slice(0, 5);
        const more = fileResult.importedBy.length > 5 ? ` ... and ${fileResult.importedBy.length - 5} more` : '';
        lines.push(`  ${c.dim}imported by: ${shown.join(', ')}${more}${c.reset}`);
      }
      if (fileResult.structure && fileResult.structure.length > 0 && fileResult.structure.length <= 20) {
        const structStr = fileResult.structure.map(s => `${c.yellow}${s.name}${c.reset}${c.dim}:${s.line}${c.reset}`).join(', ');
        lines.push(`  ${c.dim}symbols: ${structStr}${c.reset}`);
      }
    } else {
      lines.push(`━━━ ${fileResult.relFile} (${fileResult.lines} lines, ${fileResult.size} bytes)`);
      if (fileResult.imports && fileResult.imports.length > 0) {
        lines.push(`  imports: ${fileResult.imports.join(', ')}`);
      }
      if (fileResult.importedBy && fileResult.importedBy.length > 0) {
        const shown = fileResult.importedBy.slice(0, 5);
        const more = fileResult.importedBy.length > 5 ? ` ... and ${fileResult.importedBy.length - 5} more` : '';
        lines.push(`  imported by: ${shown.join(', ')}${more}`);
      }
      if (fileResult.structure && fileResult.structure.length > 0 && fileResult.structure.length <= 20) {
        lines.push(`  symbols: ${fileResult.structure.map(s => `${s.name}:${s.line}`).join(', ')}`);
      }
    }

    for (const match of fileResult.matches) {
      lines.push('');
      // Show enclosing scope if available
      if (match.scopeName && color) {
        lines.push(`  ${c.magenta}∈ ${match.scopeName}${c.reset} ${c.dim}(line ${match.scopeStartLine})${c.reset}`);
      } else if (match.scopeName) {
        lines.push(`  ∈ ${match.scopeName} (line ${match.scopeStartLine})`);
      }
      // Context before
      for (let i = 0; i < match.contextBefore.length; i++) {
        const lineNum = match.line - match.contextBefore.length + i;
        if (color) {
          lines.push(`  ${c.dim}${String(lineNum).padStart(6, ' ')} ${match.contextBefore[i]}${c.reset}`);
        } else {
          lines.push(`  ${String(lineNum).padStart(6, ' ')} ${match.contextBefore[i]}`);
        }
      }
      // Matched line
      const lineNumStr = String(match.line).padStart(6, ' ');
      if (color) {
        const beforeMatch = match.lineContent.substring(0, match.column - 1);
        const matchedText = match.lineContent.substring(match.column - 1, match.column - 1 + match.matchLength);
        const afterMatch = match.lineContent.substring(match.column - 1 + match.matchLength);
        lines.push(`  ${c.bold}${lineNumStr}${c.reset} ${beforeMatch}${c.bgRed}${c.bold}${matchedText}${c.reset}${afterMatch}`);
      } else {
        lines.push(`  ${lineNumStr} ${match.lineContent}`);
      }
      // Context after
      for (let i = 0; i < match.contextAfter.length; i++) {
        const lineNum = match.line + i + 1;
        if (lineNum <= fileResult.lines) {
          if (color) {
            lines.push(`  ${c.dim}${String(lineNum).padStart(6, ' ')} ${match.contextAfter[i]}${c.reset}`);
          } else {
            lines.push(`  ${String(lineNum).padStart(6, ' ')} ${match.contextAfter[i]}`);
          }
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatJSON(results) {
  return JSON.stringify(results, null, 2);
}

function formatMarkdown(results, opts) {
  const lines = [];

  if (results.length === 0) {
    return '# Search Results\n\nNo matches found.\n';
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
  lines.push(`# Grep Results: \`${opts.pattern}\``);
  lines.push('');
  lines.push(`- **Files matched**: ${results.length}`);
  lines.push(`- **Total matches**: ${totalMatches}`);
  lines.push(`- **Root**: \`${opts.root || '.'}\``);
  lines.push('');

  for (const fileResult of results) {
    lines.push(`## \`${fileResult.relFile}\``);
    lines.push('');
    lines.push(`- **Size**: ${fileResult.size} bytes`);
    lines.push(`- **Lines**: ${fileResult.lines}`);
    if (fileResult.imports && fileResult.imports.length > 0) {
      lines.push(`- **Imports**: ${fileResult.imports.join(', ')}`);
    }
    if (fileResult.importedBy && fileResult.importedBy.length > 0) {
      const shown = fileResult.importedBy.slice(0, 10);
      const more = fileResult.importedBy.length > 10 ? ` (and ${fileResult.importedBy.length - 10} more)` : '';
      lines.push(`- **Imported by**: ${shown.join(', ')}${more}`);
    }
    if (fileResult.structure && fileResult.structure.length > 0 && fileResult.structure.length <= 20) {
      lines.push(`- **Symbols**: ${fileResult.structure.map(s => `\`${s.name}\` (line ${s.line})`).join(', ')}`);
    }
    lines.push('');

    for (const match of fileResult.matches) {
      if (match.scopeName) {
        lines.push(`> ∈ **${match.scopeName}** (line ${match.scopeStartLine})`);
      }
      lines.push('```text');
      for (let i = 0; i < match.contextBefore.length; i++) {
        lines.push(`  ${String(match.line - match.contextBefore.length + i).padStart(6, ' ')} ${match.contextBefore[i]}`);
      }
      lines.push(`> ${String(match.line).padStart(6, ' ')} ${match.lineContent}`);
      for (let i = 0; i < match.contextAfter.length; i++) {
        const ln = match.line + i + 1;
        if (ln <= fileResult.lines) {
          lines.push(`  ${String(ln).padStart(6, ' ')} ${match.contextAfter[i]}`);
        }
      }
      lines.push('```');
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
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const opts = {
    pattern: args[0],
    context: 3,
    before: 3,
    after: 3,
    root: '.',
    include: [],
    exclude: [],
    format: 'text',
    maxMatches: 100,
    filesOnly: false,
    rank: 'bm25',       // default: BM25 ranking enabled
    queryDetect: true,  // default: query type detection enabled
    semantic: false,    // default: semantic search disabled
    semanticWeight: undefined, // auto-detect from query type
    budget: 0,          // token budget (0 = no limit)
    compress: 'L2',     // compression level: L0, L1, L2 (default: no compression)
  };
  let i = 1;

  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--include': opts.include.push(args[++i]); break;
      case '--exclude': opts.exclude.push(args[++i]); break;
      case '--context':
        opts.context = parseInt(args[++i], 10);
        opts.before = opts.after = opts.context;
        break;
      case '--before': opts.before = parseInt(args[++i], 10); break;
      case '--after': opts.after = parseInt(args[++i], 10); break;
      case '--with-imports': opts.withImports = true; break;
      case '--with-scope': opts.withScope = true; break;
      case '--with-structure': opts.withStructure = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
      case '--ignore-case': opts.ignoreCase = true; break;
      case '--max-matches': opts.maxMatches = parseInt(args[++i], 10); break;
      case '--files-only': opts.filesOnly = true; break;
      case '--rank': opts.rank = args[++i]; break;
      case '--no-rank': opts.rank = 'none'; break;
      case '--query-detect': opts.queryDetect = true; break;
      case '--no-query-detect': opts.queryDetect = false; break;
      case '--semantic': opts.semantic = true; break;
      case '--semantic-weight': opts.semanticWeight = parseFloat(args[++i]); break;
      case '--budget': opts.budget = parseInt(args[++i], 10); break;
      case '--compress': opts.compress = args[++i]; break;
      case '--invert': opts.invert = true; break;
      case '--count-only': opts.countOnly = true; break;
      case '--file-types': opts.fileTypes = args[++i]; break;
      default: break;
    }
    i++;
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,rb,rs,go,java,kt,php,c,h,cpp,hpp,cc,cxx,json,yaml,yml,md,html,css,scss,sass}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/__pycache__/**', '**/*.min.*', '**/package-lock.json'];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node contextual-grep.mjs <pattern> [options]

Enhanced grep with context windows and cross-file awareness.

Options:
  --root <path>         Root directory to search (default: .)
  --include <glob>      Include file pattern (repeatable)
  --exclude <glob>      Exclude file pattern (repeatable)
  --context <N>         Lines of context before and after (default: 3)
  --before <N>          Lines of context before each match
  --after <N>           Lines of context after each match
  --with-imports        Show import context for matched files
  --with-scope          Show enclosing function/class scope for each match
  --with-structure      Show file symbol structure overview
  --format <fmt>        Output: text, json, markdown (default: text)
  --color               Force color output
   --budget <N>          Token budget — greedily fit top results within N tokens
   --compress <L0|L1|L2> Compression level: L0=signature only, L1=+context+scope, L2=full (default)
   --no-color            Disable color output
   --ignore-case         Case-insensitive search
  --max-matches <N>     Max matches per file (default: 100)
  --files-only          Only show filenames, not matches
  --rank <mode>         Ranking mode: bm25 (default), none
  --no-rank             Disable ranking (equivalent to --rank none)
  --query-detect        Enable query type detection (default: on)
  --no-query-detect     Disable query type detection
  --semantic            Enable hybrid semantic search (BM25 + TF-IDF fusion)
  --semantic-weight <N> Custom semantic weight 0.0-1.0 (auto-detected from query type)
  --invert              Invert match — show lines that do NOT match (like grep -v)
  --count-only          Only show match counts per file (like grep -c)
  --file-types <exts>   File type filter: "all" for any file, or comma-separated extensions like ".txt,.log,.md"
  -h, --help            Show this help

Examples:
  node contextual-grep.mjs "function\\s+\\w+" --context 5
  node contextual-grep.mjs "import.*from" --root ./src --format json
  node contextual-grep.mjs "TODO|FIXME" --with-imports --color
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const opts = parseArgs();
const color = useColor(opts);

// Build regex
let regexSource = opts.pattern;
let regexFlags = 'g';
if (opts.ignoreCase) regexFlags += 'i';
let regex;
try { regex = new RegExp(regexSource, regexFlags); }
catch (e) {
  console.error(`Invalid regex: ${e.message}`);
  process.exit(1);
}

// Handle fileTypes override
if (opts.fileTypes) {
  if (opts.fileTypes === 'all') {
    opts.include = ['**/*'];
  } else {
    // Build glob from comma-separated extensions: ".txt,.log,.md" → "**/*.{txt,log,md}"
    const exts = opts.fileTypes.split(',').map(e => e.trim().replace(/^\./, ''));
    opts.include = [`**/*.{${exts.join(',')}}`];
  }
}

// Find files
const root = resolve(opts.root);
const files = findFiles(root, opts.include, opts.exclude);
const totalFiles = files.length;

// Search
const results = searchFiles(files, regex, opts);

// Query type detection
let queryType = null;
if (opts.queryDetect) {
  queryType = detectQueryType(opts.pattern);
}

// BM25 ranking (skip for countOnly — results have matchCount not matches)
if (!opts.countOnly && opts.rank !== 'none' && results.length > 0) {
  rankResults(results, opts.pattern);
  applyRerankSignals(results, opts.pattern);
}

// Hybrid semantic search (skip for countOnly — different result structure)
if (!opts.countOnly && opts.semantic && results.length > 0) {
  const cache = loadCache(root);
  const allChunks = [];

  for (const fileResult of results) {
    try {
      const st = statSync(fileResult.file);
      const { chunks } = getCachedOrEmbed(fileResult.file, st.mtime.toISOString(), cache);
      if (chunks.length > 0) {
        for (const chunk of chunks) {
          allChunks.push({ ...chunk, file: fileResult.file, relFile: fileResult.relFile });
        }
      }
    } catch { /* skip unreadable files */ }
  }

  if (allChunks.length > 0) {
    const semanticResults = semanticSearch(opts.pattern, allChunks, { topK: Math.min(allChunks.length, 50) });
    const hybridResults = hybridRank(results, semanticResults, queryType?.type || 'symbol', {
      semanticWeight: opts.semanticWeight,
    });
    results.length = 0;
    results.push(...hybridResults.filter(r => r.matches && r.matches.length > 0));
  }

  // Save cache for next run
  try { saveCache(root, cache); } catch { /* optional */ }
}

// Enrich with import context if requested (skip for countOnly — different result structure)
if (!opts.countOnly && opts.withImports) {
  // Build full import graph for reverse lookup
  const importGraph = new Map(); // filePath -> { imports: [], importedBy: [] }
  for (const filePath of files) {
    const relPath = relative(root, filePath);
    if (!importGraph.has(relPath)) {
      importGraph.set(relPath, { path: relPath, imports: [], importedBy: [] });
    }
    const fileImports = getImportContext(filePath, root);
    for (const imp of fileImports.imports || []) {
      // Resolve the import path locally
      const importerDir = dirname(filePath);
      const resolved = resolve(importerDir, imp);
      try {
        if (statSync(resolved).isFile()) {
          const targetRel = relative(root, resolved);
          if (!importGraph.has(targetRel)) {
            importGraph.set(targetRel, { path: targetRel, imports: [], importedBy: [] });
          }
          importGraph.get(targetRel).importedBy.push(relPath);
        }
      } catch { /* not local */ }
    }
  }

  for (const r of results) {
    const relPath = relative(root, r.file);
    r.imports = getImportContext(r.file, root);
    const graphEntry = importGraph.get(relPath);
    if (graphEntry && graphEntry.importedBy.length > 0) {
      r.importedBy = graphEntry.importedBy;
    }
  }
}

// Token budget compression (before output)
if (opts.budget > 0 && !opts.countOnly && results.length > 0) {
  const budgeted = fitToBudget(results, opts.budget, opts.compress, { color });
  if (opts.format === 'text') {
    console.log(budgeted.text);
    process.exit(0);
  }
} else if (opts.compress !== 'L2' && !opts.countOnly && results.length > 0 && opts.format === 'text') {
  const compressed = compressLevel(results, opts.compress, { color });
  console.log(compressed.join('\n'));
  process.exit(0);
}

// Output
switch (opts.format) {
  case 'json':
    const jsonOutput = {
      root,
      totalFiles,
      matches: results.length,
      totalMatches: results.reduce((s, r) => s + r.matches.length, 0),
      results,
    };
    if (queryType) {
      jsonOutput.queryType = queryType;
    }
    console.log(formatJSON(jsonOutput));
    break;
  case 'markdown':
    console.log(formatMarkdown(results, opts));
    break;
  case 'text':
  default:
    console.log(formatText(results, opts, color));
    break;
}
