#!/usr/bin/env node

// learn-adapt.mjs — Project convention learning & adaptation engine
//
// Analyzes project patterns over time to build a convention profile,
// remembers user preferences, and helps clarify ambiguous requests.
//
// Usage:
//   node learn-adapt.mjs <command> [options]
//
// Commands:
//   extract               Extract project conventions into a profile
//   show                  Show learned conventions
//   preferences           Manage user preferences
//   clarify <request>     Clarify an ambiguous request with guided questions
//
// Options:
//   --root <path>         Root directory (default: .)
//   --store <path>        Convention store file (default: .opencode-conventions.json)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname, dirname, basename } from 'node:path';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Convention extraction
// ---------------------------------------------------------------------------
const CONVENTION_PATTERNS = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
  UPPER_CASE: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
  kebabCase: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
};

function detectConvention(name) {
  for (const [conv, re] of Object.entries(CONVENTION_PATTERNS)) {
    if (re.test(name)) return conv;
  }
  return 'other';
}

function extractConventions(root, files) {
  const conventions = {
    naming: { file: {}, variable: {}, function: {}, class: {} },
    imports: { commonjs: 0, esm: 0, mixed: false },
    testing: { hasTests: false, framework: null, pattern: null },
    structure: { src: false, test: false, lib: false, app: false },
    languages: new Set(),
    exports: { default: 0, named: 0 },
  };

  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();
    const rel = relative(root, filePath);
    const name = basename(filePath);

    // File naming
    const fileConv = detectConvention(name.replace(/\.[^.]+$/, ''));
    conventions.naming.file[fileConv] = (conventions.naming.file[fileConv] || 0) + 1;

    // Language detection
    if (['.js', '.mjs', '.cjs'].includes(ext)) conventions.languages.add('javascript');
    if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) conventions.languages.add('typescript');
    if (ext === '.py') conventions.languages.add('python');
    if (ext === '.rb') conventions.languages.add('ruby');
    if (ext === '.rs') conventions.languages.add('rust');
    if (ext === '.go') conventions.languages.add('go');
    if (['.java', '.kt'].includes(ext)) conventions.languages.add('jvm');

    // Directory structure
    const dirs = rel.split(/[/\\]/);
    if (dirs.includes('src')) conventions.structure.src = true;
    if (dirs.includes('test') || dirs.includes('tests') || dirs.includes('__tests__')) {
      conventions.structure.test = true;
    }
    if (dirs.includes('lib')) conventions.structure.lib = true;
    if (dirs.includes('app')) conventions.structure.app = true;

    // Testing detection
    if (name.includes('.test.') || name.includes('.spec.') || name.startsWith('test_')) {
      conventions.testing.hasTests = true;
      if (name.endsWith('.test.js') || name.endsWith('.test.mjs')) conventions.testing.framework = 'node';
      if (name.endsWith('.spec.ts')) conventions.testing.framework = 'jest';
      if (name.endsWith('.test.ts')) conventions.testing.framework = 'jest';
    }

    // Analyze content for deeper conventions
    try {
      const content = readFileSync(filePath, 'utf-8');

      // Import style
      if (content.includes('import ') && (content.includes('from ') || content.includes("'"))) {
        conventions.imports.esm++;
      }
      if (content.includes('require(')) {
        conventions.imports.commonjs++;
      }

      // Export style
      const defaultExports = (content.match(/export\s+default/g) || []).length;
      const namedExports = (content.match(/export\s+(?:const|function|class|let|var|interface|type)/g) || []).length;
      conventions.exports.default += defaultExports;
      conventions.exports.named += namedExports;

      // Identifier naming (top level)
      const lines = content.split('\n');
      for (const line of lines) {
        // Functions
        let match = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (match) {
          const conv = detectConvention(match[1]);
          conventions.naming.function[conv] = (conventions.naming.function[conv] || 0) + 1;
        }
        // Classes
        match = line.match(/(?:export\s+)?class\s+(\w+)/);
        if (match) {
          const conv = detectConvention(match[1]);
          conventions.naming.class[conv] = (conventions.naming.class[conv] || 0) + 1;
        }
        // Variable declarations
        match = line.match(/(?:const|let|var)\s+(\w+)\s*[=:]/);
        if (match) {
          const conv = detectConvention(match[1]);
          conventions.naming.variable[conv] = (conventions.naming.variable[conv] || 0) + 1;
        }
      }
    } catch { /* skip binary or unreadable */ }
  }

  conventions.languages = [...conventions.languages];
  conventions.imports.mixed = conventions.imports.commonjs > 0 && conventions.imports.esm > 0;

  return conventions;
}

function findDominant(obj) {
  let max = 0, dominant = 'none';
  for (const [key, val] of Object.entries(obj)) {
    if (val > max) { max = val; dominant = key; }
  }
  return { dominant, confidence: max > 0 ? Math.round((max / Object.values(obj).reduce((a, b) => a + b, 0)) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Store management
// ---------------------------------------------------------------------------
function loadStore(storePath) {
  try {
    if (existsSync(storePath)) {
      return JSON.parse(readFileSync(storePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { conventions: null, preferences: {}, lastAnalyzed: null };
}

function saveStore(storePath, data) {
  try {
    writeFileSync(storePath, JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Clarify engine
// ---------------------------------------------------------------------------
function clarifyRequest(request) {
  const ambiguities = [];

  // Check for common ambiguous patterns
  if (/it|this|that|those/.test(request) && !/[A-Z][a-z]+/.test(request)) {
    ambiguities.push({
      question: 'What specific component or file are you referring to?',
      options: ['A specific function', 'A file', 'The entire project', 'Something else'],
    });
  }

  if (/\b(add|create|make|build|new)\b/i.test(request) && !/name|called|for/.test(request)) {
    ambiguities.push({
      question: 'What should the new item be named?',
      hint: 'e.g., "Create a utility function called formatDate"',
    });
  }

  if (/\b(change|update|modify|edit)\b/i.test(request) && !/to|into|with/.test(request)) {
    ambiguities.push({
      question: 'What is the desired change?',
      hint: 'e.g., "Change the color from red to blue"',
    });
  }

  if (/\bfix\b/i.test(request) && !/error|bug|issue|problem/.test(request)) {
    ambiguities.push({
      question: 'What specific issue needs fixing? Do you have an error message?',
      hint: 'e.g., "Fix the TypeError in the login handler"',
    });
  }

  if (/\b(test|testing)\b/i.test(request) && !/for|of|unit|integration|e2e/.test(request)) {
    ambiguities.push({
      question: 'What type of tests do you want?',
      options: ['Unit tests', 'Integration tests', 'End-to-end tests', 'All of the above'],
    });
  }

  if (request.split(' ').length < 3) {
    ambiguities.push({
      question: 'Can you provide more details about what you need?',
      hint: 'e.g., "Add input validation to the registration form" rather than "Add validation"',
    });
  }

  return {
    request,
    ambiguities,
    totalAmbiguities: ambiguities.length,
    needsClarification: ambiguities.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function formatExtract(conventions, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color ? `${c.bold}Project Convention Profile${c.reset}` : 'Project Convention Profile');
  out.push('='.repeat(50));
  out.push('');

  // Languages
  out.push(color ? `${c.bold}Languages${c.reset}` : 'Languages');
  out.push(`  ${conventions.languages.join(', ') || 'N/A'}`);
  out.push('');

  // Directory structure
  out.push(color ? `${c.bold}Directory Structure${c.reset}` : 'Directory Structure');
  const struct = conventions.structure;
  const has = [];
  if (struct.src) has.push('src/'); if (struct.test) has.push('test/');
  if (struct.lib) has.push('lib/'); if (struct.app) has.push('app/');
  out.push(`  ${has.join(', ') || 'flat structure'}`);
  out.push('');

  // Import style
  out.push(color ? `${c.bold}Module System${c.reset}` : 'Module System');
  const imp = conventions.imports;
  out.push(`  ESM imports: ${imp.esm}`);
  out.push(`  CommonJS requires: ${imp.commonjs}`);
  out.push(`  Mixed: ${imp.mixed ? 'Yes' : 'No'}`);
  out.push('');

  // Naming conventions
  out.push(color ? `${c.bold}Naming Conventions${c.reset}` : 'Naming Conventions');
  for (const [category, data] of Object.entries(conventions.naming)) {
    const total = Object.values(data).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const { dominant, confidence } = findDominant(data);
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    if (color) {
      out.push(`  ${c.cyan}${label}${c.reset}: ${dominant} (${confidence}% confidence, ${total} samples)`);
    } else {
      out.push(`  ${label}: ${dominant} (${confidence}% confidence, ${total} samples)`);
    }
  }
  out.push('');

  // Exports
  out.push(color ? `${c.bold}Export Style${c.reset}` : 'Export Style');
  out.push(`  Default exports: ${conventions.exports.default}`);
  out.push(`  Named exports: ${conventions.exports.named}`);
  out.push('');

  // Testing
  out.push(color ? `${c.bold}Testing${c.reset}` : 'Testing');
  if (conventions.testing.hasTests) {
    out.push(`  Framework: ${conventions.testing.framework || 'unknown'}`);
  } else {
    out.push(`  No tests detected`);
  }
  out.push('');

  // Recommendations
  out.push(color ? `${c.bold}Recommendations${c.reset}` : 'Recommendations');
  const recs = generateRecommendations(conventions);
  if (recs.length === 0) {
    out.push('  No recommendations at this time.');
  } else {
    for (const rec of recs) {
      out.push(`  ${color ? c.yellow + '💡' + c.reset : '💡'} ${rec}`);
    }
  }

  return out.join('\n');
}

function generateRecommendations(conventions) {
  const recs = [];

  if (conventions.imports.mixed) {
    recs.push('Project uses both ESM and CommonJS imports. Consider standardizing on one module system.');
  }
  if (!conventions.structure.test) {
    recs.push('No test directory found. Consider adding a test/ or __tests__/ directory.');
  }
  if (conventions.structure.src && !conventions.structure.test) {
    recs.push('src/ directory detected but no corresponding test/ directory.');
  }
  if (conventions.exports.default > 0 && conventions.exports.named > 0) {
    // Mixed is fine, no recommendation needed
  }

  return recs;
}

function formatShow(store, opts, color) {
  const c = COLORS;
  if (!store.conventions) {
    return 'No conventions stored. Run "extract" first.';
  }
  return formatExtract(store.conventions, opts, color);
}

function formatPreferences(store, opts, color) {
  const c = COLORS;
  const out = [];
  out.push(color ? `${c.bold}User Preferences${c.reset}` : 'User Preferences');
  out.push('='.repeat(40));
  out.push('');

  const prefs = store.preferences || {};
  const keys = Object.keys(prefs);
  if (keys.length === 0) {
    out.push('No preferences stored yet.');
  } else {
    for (const [key, value] of Object.entries(prefs)) {
      out.push(`  ${key}: ${value}`);
    }
  }
  out.push('');
  out.push('Set preferences by editing the store file directly.');
  return out.join('\n');
}

function formatClarify(result, opts, color) {
  const c = COLORS;
  const out = [];

  out.push(color ? `${c.bold}Request Clarification${c.reset}` : 'Request Clarification');
  out.push('='.repeat(40));
  out.push('');

  out.push(`  Request: "${result.request}"`);
  out.push('');

  if (!result.needsClarification) {
    out.push('  ✅ This request seems clear enough to proceed.');
    return out.join('\n');
  }

  out.push(`  Found ${result.totalAmbiguities} ambiguous area(s):`);
  out.push('');

  for (let i = 0; i < result.ambiguities.length; i++) {
    const amb = result.ambiguities[i];
    out.push(`  ${i + 1}. ${amb.question}`);
    if (amb.options) {
      for (const opt of amb.options) {
        out.push(`     - ${opt}`);
      }
    }
    if (amb.hint) {
      out.push(`     ${c.dim || ''}Hint: ${amb.hint}${c.dim || ''}`);
    }
    out.push('');
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const opts = {
    command: args[0],
    commandArgs: args.slice(1).filter(a => !a.startsWith('--')),
    root: '.',
    store: resolve(process.cwd(), '.opencode-conventions.json'),
    format: 'text',
    color: undefined,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--store': opts.store = resolve(opts.root, args[++i]); break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node learn-adapt.mjs <command> [options]

Project convention learning and adaptation engine.

Commands:
  extract               Extract project conventions into a profile
  show                  Show learned conventions from store
  preferences           Show stored user preferences
  clarify <request>     Clarify an ambiguous request

Options:
  --root <path>         Root directory (default: .)
  --store <path>        Convention store file
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node learn-adapt.mjs extract
  node learn-adapt.mjs show
  node learn-adapt.mjs clarify "add a new component"
  node learn-adapt.mjs extract --format markdown
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  let result;

  switch (opts.command) {
    case 'extract': {
      const files = findFiles(root,
        ['**/*.{js,mjs,cjs,jsx,ts,tsx,py,rb,rs,java,kt,go,php}'],
        ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
      );
      const conventions = extractConventions(root, files);

      // Save to store
      const store = loadStore(opts.store);
      store.conventions = conventions;
      store.lastAnalyzed = new Date().toISOString();
      saveStore(opts.store, store);

      result = conventions;
      console.log(formatExtract(conventions, opts, color));
      console.log(color
        ? `\n${COLORS.dim}Profile saved to: ${opts.store}${COLORS.reset}`
        : `\nProfile saved to: ${opts.store}`);
      return;
    }
    case 'show': {
      const store = loadStore(opts.store);
      console.log(formatShow(store, opts, color));
      return;
    }
    case 'preferences': {
      const store = loadStore(opts.store);
      console.log(formatPreferences(store, opts, color));
      return;
    }
    case 'clarify': {
      const request = opts.commandArgs.join(' ') || '';
      if (!request) {
        console.error('Please provide a request to clarify.');
        process.exit(1);
      }
      result = clarifyRequest(request);
      console.log(formatClarify(result, opts, color));
      return;
    }
    default:
      console.error(`Unknown command: ${opts.command}`);
      printHelp();
      process.exit(1);
  }

  if (opts.format === 'json' && result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

main();
