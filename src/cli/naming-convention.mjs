#!/usr/bin/env node

// naming-convention.mjs — Project naming convention inference engine
//
// Scans source files to detect naming patterns (camelCase, PascalCase,
// snake_case, UPPER_CASE, kebab-case) and reports the dominant conventions
// used in the project.
//
// Usage:
//   node naming-convention.mjs [options]
//
// Options:
//   --root <path>         Root directory to analyze (default: .)
//   --include <glob>      Include file pattern (repeatable)
//   --exclude <glob>      Exclude file pattern (repeatable)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --min-samples <N>     Minimum samples for a convention to be reported (default: 2)
//   --verbose             Show all detected identifiers
//   --files-only          Only analyze file naming, not identifiers
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, extname, basename } from 'node:path';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Naming convention detection
// ---------------------------------------------------------------------------
const CONVENTION_PATTERNS = [
  {
    name: 'camelCase',
    re: /^[a-z][a-zA-Z0-9]*$/,
    description: 'variables, functions, methods',
    priority: 1,
  },
  {
    name: 'PascalCase',
    re: /^[A-Z][a-zA-Z0-9]*$/,
    description: 'classes, types, interfaces, components',
    priority: 2,
  },
  {
    name: 'snake_case',
    re: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
    description: 'Python/Ruby style variables and functions',
    priority: 3,
  },
  {
    name: 'UPPER_CASE',
    re: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
    description: 'constants, environment variables, enums',
    priority: 4,
  },
  {
    name: 'SCREAMING_SNAKE',
    re: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/,
    description: 'constants with multiple words',
    priority: 5,
  },
  {
    name: 'kebab-case',
    re: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    description: 'file names, URLs, CSS classes',
    priority: 6,
  },
  {
    name: 'hungarian',
    re: /^(str|n|b|arr|obj|fn|e|i|s|o|f|is|has|can|should|will)\w+$/i,
    description: 'Hungarian notation prefix',
    priority: 7,
  },
  {
    name: '_private',
    re: /^_(?!_)[a-z]\w*$/,
    description: 'private members (underscore prefix)',
    priority: 8,
  },
  {
    name: '__dunder',
    re: /^__\w+__$/,
    description: 'Python dunder methods',
    priority: 9,
  },
];

// Patterns for extracting identifiers from different languages
const IDENTIFIER_PATTERNS = {
  'javascript-typescript': {
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    patterns: [
      // Variable declarations
      /(?:const|let|var)\s+(\w+)\s*[=:;]/g,
      // Function declarations
      /(?:async\s+)?function\s+(\w+)/g,
      // Class declarations
      /class\s+(\w+)/g,
      // Arrow function assignments
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
      // Exports
      /export\s+(?:default\s+)?(?:function|class)\s+(\w+)/g,
      // Interface / type
      /(?:interface|type)\s+(\w+)/g,
      // Parameters
      /(?:function|\([^)]*\))\s*\(([^)]*)\)/g,
      // Object methods
      /(\w+)\s*\([^)]*\)\s*\{/g,
      // Method shorthand in classes
      /^\s*(\w+)\s*\([^)]*\)\s*\{/gm,
    ],
  },
  python: {
    exts: ['.py'],
    patterns: [
      /(?:async\s+)?def\s+(\w+)/g,
      /class\s+(\w+)/g,
      /(\w+)\s*=\s*(?:['"]|[\(\[])/g,
      /from\s+\S+\s+import\s+(\w+)/g,
      /import\s+(\w+)/g,
    ],
  },
  ruby: {
    exts: ['.rb'],
    patterns: [
      /(?:def|class|module)\s+(\w+(?:[?!])?)/g,
      /@{1,2}(\w+)/g,
      /\$(\w+)/g,
      /(\w+)\s*=\s*(?!do\b|unless\b|if\b)/g,
    ],
  },
  java: {
    exts: ['.java', '.kt'],
    patterns: [
      /class\s+(\w+)/g,
      /interface\s+(\w+)/g,
      /enum\s+(\w+)/g,
      /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:\w+(?:<[^>]*>)?\s+)(\w+)\s*\(/g,
      /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(\w+(?:\[\])?)\s+(\w+)/g,
    ],
  },
};

function detectLanguage(ext) {
  for (const [lang, config] of Object.entries(IDENTIFIER_PATTERNS)) {
    if (config.exts.includes(ext.toLowerCase())) return lang;
  }
  return null;
}

function extractIdentifiers(content, lang) {
  const identifiers = new Set();
  const config = IDENTIFIER_PATTERNS[lang];
  if (!config) return identifiers;

  const stringRe = /(['"`])(?:(?!\1|\\).|\\.)*\1/g;
  const commentRe = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
  // Remove strings and comments before scanning
  let clean = content.replace(stringRe, '').replace(commentRe, '');

  for (const re of config.patterns) {
    let match;
    while ((match = re.exec(clean)) !== null) {
      let name = match[1];
      // Filter out non-identifier noise (numbers, common keywords)
      if (name && /^[a-zA-Z_][\w]*$/.test(name) && !isKeyword(name, lang)) {
        // Split parameter lists
        if (name.includes(',') || name.includes(')')) continue;
        identifiers.add(name);
      }
    }
  }
  return identifiers;
}

const JS_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'this', 'super', 'class', 'extends', 'import',
  'export', 'default', 'from', 'as', 'const', 'let', 'var', 'function',
  'async', 'await', 'yield', 'of', 'in', 'true', 'false', 'null', 'undefined',
  'get', 'set', 'static', 'public', 'private', 'protected', 'readonly',
  'abstract', 'implements', 'interface', 'type', 'enum', 'namespace',
  'module', 'declare', 'global', 'keyof', 'infer', 'satisfies',
]);

const PY_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
  'with', 'as', 'def', 'class', 'return', 'yield', 'import', 'from',
  'raise', 'pass', 'break', 'continue', 'and', 'or', 'not', 'is',
  'in', 'True', 'False', 'None', 'self', 'cls', 'lambda', 'global',
  'nonlocal', 'assert', 'del', 'print',
]);

function isKeyword(name, lang) {
  if (lang === 'javascript-typescript') return JS_KEYWORDS.has(name);
  if (lang === 'python') return PY_KEYWORDS.has(name);
  return false;
}

function detectConvention(name) {
  for (const conv of CONVENTION_PATTERNS) {
    if (conv.re.test(name)) return conv.name;
  }
  return 'other';
}

function analyzeFileNaming(files) {
  const conventions = {};
  let total = 0;

  for (const filePath of files) {
    const name = basename(filePath);
    // Remove extension(s) for analysis
    const nameWithoutExt = name.replace(/\.[^.]+$/, '');
    const conv = detectConvention(nameWithoutExt);

    if (conv !== 'other') {
      if (!conventions[conv]) conventions[conv] = [];
      conventions[conv].push(name);
      total++;
    }
  }

  return { conventions, total };
}

function analyzeIdentifierNaming(files) {
  const conventions = {};
  let total = 0;
  const allIdentifiers = {};

  for (const filePath of files) {
    const ext = extname(filePath);
    const lang = detectLanguage(ext);
    if (!lang) continue;

    let content;
    try { content = readFileSync(filePath, 'utf-8'); }
    catch { continue; }

    const identifiers = extractIdentifiers(content, lang);
    for (const id of identifiers) {
      const conv = detectConvention(id);
      if (conv !== 'other') {
        if (!conventions[conv]) conventions[conv] = { count: 0, samples: [] };
        conventions[conv].count++;
        if (conventions[conv].samples.length < 10) {
          conventions[conv].samples.push(id);
        }
        if (!allIdentifiers[conv]) allIdentifiers[conv] = [];
        if (allIdentifiers[conv].length < 100) {
          allIdentifiers[conv].push(id);
        }
        total++;
      }
    }
  }

  return { conventions, total, allIdentifiers };
}

function computeConfidence(counts, total) {
  if (total === 0) return { dominant: 'none', confidence: 0, distribution: {} };

  const distribution = {};
  let maxCount = 0;
  let dominant = 'none';

  for (const [name, data] of Object.entries(counts)) {
    const pct = (data.count / total) * 100;
    distribution[name] = { count: data.count, percentage: Math.round(pct * 10) / 10, samples: data.samples };
    if (data.count > maxCount) {
      maxCount = data.count;
      dominant = name;
    }
  }

  const dominantPct = distribution[dominant]?.percentage || 0;
  const confidence = dominantPct > 80 ? 'high' : dominantPct > 60 ? 'medium' : 'low';

  // Sort distribution by count descending
  const sorted = Object.entries(distribution)
    .sort(([, a], [, b]) => b.count - a.count)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  return { dominant, confidence, distribution: sorted };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatText(fileNaming, identifierNaming, opts, color) {
  const c = COLORS;
  const lines = [];

  lines.push(color
    ? `${c.bold}${c.blue}Naming Convention Analysis${c.reset}`
    : 'Naming Convention Analysis');
  lines.push('='.repeat(40));
  lines.push('');

  // File naming
  lines.push(color ? `${c.bold}File Naming${c.reset}` : 'File Naming');
  lines.push('-'.repeat(30));
  if (fileNaming.total === 0) {
    lines.push('  No files with recognized naming conventions.');
  } else {
    for (const [conv, files] of Object.entries(fileNaming.conventions)) {
      const pct = ((files.length / fileNaming.total) * 100).toFixed(1);
      const convDef = CONVENTION_PATTERNS.find(c => c.name === conv);
      const desc = convDef ? ` (${convDef.description})` : '';
      if (color) {
        lines.push(`  ${c.yellow}${conv}${c.reset}${c.dim}${desc}${c.reset}: ${files.length} files (${pct}%)`);
      } else {
        lines.push(`  ${conv}${desc}: ${files.length} files (${pct}%)`);
      }
      if (opts.verbose) {
        for (const f of files.slice(0, 5)) {
          lines.push(`    └─ ${f}`);
        }
        if (files.length > 5) lines.push(`    └─ ... and ${files.length - 5} more`);
      }
    }
  }
  lines.push('');

  // Identifier naming
  lines.push(color ? `${c.bold}Identifier Naming${c.reset}` : 'Identifier Naming');
  lines.push('-'.repeat(30));
  if (identifierNaming.total === 0) {
    lines.push('  No identifiers found.');
  } else {
    const identifiers = identifierNaming.conventions;
    const total = identifierNaming.total;
    const { dominant, confidence, distribution } = computeConfidence(identifiers, total);

    if (color) {
      lines.push(`  Dominant convention: ${c.bold}${c.green}${dominant}${c.reset} (confidence: ${confidence})`);
    } else {
      lines.push(`  Dominant convention: ${dominant} (confidence: ${confidence})`);
    }
    lines.push('');

    for (const [conv, data] of Object.entries(distribution)) {
      const convDef = CONVENTION_PATTERNS.find(c => c.name === conv);
      const desc = convDef ? ` (${convDef.description})` : '';
      const bar = '█'.repeat(Math.round(data.percentage / 5));
      if (color) {
        const pctColor = data.percentage > 50 ? c.green : data.percentage > 20 ? c.yellow : c.dim;
        lines.push(`  ${c.bold}${conv}${c.reset}${c.dim}${desc}${c.reset}`);
        lines.push(`    ${pctColor}${bar}${c.reset} ${c.bold}${data.count}${c.reset} (${data.percentage}%)`);
      } else {
        lines.push(`  ${conv}${desc}`);
        lines.push(`    ${bar} ${data.count} (${data.percentage}%)`);
      }
      if (opts.verbose && data.samples.length > 0) {
        lines.push(`    samples: ${data.samples.slice(0, 8).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatJSON(fileNaming, identifierNaming) {
  const identifiers = identifierNaming.conventions;
  const total = identifierNaming.total;
  const { dominant, confidence, distribution } = computeConfidence(identifiers, total);

  return JSON.stringify({
    fileNaming: {
      total: fileNaming.total,
      conventions: Object.fromEntries(
        Object.entries(fileNaming.conventions).map(([k, v]) => [k, { count: v.length, files: v }])
      ),
    },
    identifierNaming: {
      total,
      dominant,
      confidence,
      distribution,
    },
  }, null, 2);
}

function formatMarkdown(fileNaming, identifierNaming) {
  const lines = [];

  lines.push('# Naming Convention Analysis');
  lines.push('');

  // File naming
  lines.push('## File Naming');
  lines.push('');
  if (fileNaming.total === 0) {
    lines.push('No files with recognized naming conventions.');
  } else {
    lines.push('| Convention | Count | Percentage |');
    lines.push('|------------|-------|------------|');
    for (const [conv, files] of Object.entries(fileNaming.conventions)) {
      const pct = ((files.length / fileNaming.total) * 100).toFixed(1);
      lines.push(`| \`${conv}\` | ${files.length} | ${pct}% |`);
    }
  }
  lines.push('');

  // Identifier naming
  lines.push('## Identifier Naming');
  lines.push('');
  const identifiers = identifierNaming.conventions;
  const total = identifierNaming.total;
  const { dominant, confidence, distribution } = computeConfidence(identifiers, total);

  lines.push(`- **Dominant convention**: \`${dominant}\``);
  lines.push(`- **Confidence**: ${confidence}`);
  lines.push('');

  lines.push('| Convention | Count | Percentage |');
  lines.push('|------------|-------|------------|');
  for (const [conv, data] of Object.entries(distribution)) {
    lines.push(`| \`${conv}\` | ${data.count} | ${data.percentage}% |`);
  }
  lines.push('');

  // Samples
  lines.push('## Samples');
  lines.push('');
  for (const [conv, data] of Object.entries(distribution)) {
    if (data.samples && data.samples.length > 0) {
      lines.push(`### ${conv}`);
      lines.push('');
      for (const sample of data.samples.slice(0, 10)) {
        lines.push(`- \`${sample}\``);
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
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const opts = {
    root: '.',
    include: [],
    exclude: [],
    format: 'text',
    minSamples: 2,
    verbose: false,
    filesOnly: false,
    color: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--include': opts.include.push(args[++i]); break;
      case '--exclude': opts.exclude.push(args[++i]); break;
      case '--format': opts.format = args[++i]; break;
      case '--min-samples': opts.minSamples = parseInt(args[++i], 10); break;
      case '--verbose': opts.verbose = true; break;
      case '--files-only': opts.filesOnly = true; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,py,rb,rs,java,kt,go,php}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/__pycache__/**'];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node naming-convention.mjs [options]

Project naming convention inference engine.

Options:
  --root <path>         Root directory to analyze (default: .)
  --include <glob>      Include file pattern (default: **/*.{js,mjs,cjs,jsx,ts,...})
  --exclude <glob>      Exclude file pattern (repeatable)
  --format <fmt>        Output: text, json, markdown (default: text)
  --min-samples <N>     Minimum samples for a convention to be reported (default: 2)
  --verbose             Show all detected identifiers
  --files-only          Only analyze file naming, not identifiers
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node naming-convention.mjs
  node naming-convention.mjs --root ./src --verbose
  node naming-convention.mjs --format markdown
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

  // File naming analysis
  const fileNaming = analyzeFileNaming(files);

  // Identifier naming analysis
  let identifierNaming = { conventions: {}, total: 0 };
  if (!opts.filesOnly) {
    identifierNaming = analyzeIdentifierNaming(files);
  }

  // Output
  switch (opts.format) {
    case 'json':
      console.log(formatJSON(fileNaming, identifierNaming));
      break;
    case 'markdown':
      console.log(formatMarkdown(fileNaming, identifierNaming));
      break;
    case 'text':
    default:
      console.log(formatText(fileNaming, identifierNaming, opts, color));
      break;
  }
}

main();
