#!/usr/bin/env node

// ts-helper.mjs — TypeScript project analysis and assistance
//
// Analyzes TypeScript projects for common issues and best practices:
//   - tsconfig.json analysis and recommendations
//   - Unused export detection (tree-shaking waste)
//   - Type definition analysis
//   - ESM/CJS compatibility checking
//
// Usage:
//   node ts-helper.mjs <command> [options]
//
// Commands:
//   check-config     Analyze tsconfig.json for best practices
//   check-unused     Detect potentially unused exports
//   analyze          Full project analysis (all checks)
//
// Options:
//   --root <path>         Root directory (default: .)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node ts-helper.mjs check-config
//   node ts-helper.mjs check-unused --root ./src
//   node ts-helper.mjs analyze --format json

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename, extname, relative } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function findFiles(root, exts) {
  const results = [];
  function walk(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(fullPath);
        } else if (entry.isFile() && exts.includes(extname(entry.name))) {
          results.push(fullPath);
        }
      }
    } catch { /* skip unreadable */ }
  }
  walk(root);
  return results;
}

// ---------------------------------------------------------------------------
// tsconfig analysis
// ---------------------------------------------------------------------------

function analyzeTSConfig(root) {
  const configPaths = ['tsconfig.json', 'tsconfig.app.json'];
  const results = { found: false, path: null, recommendations: [] };

  for (const cp of configPaths) {
    const fullPath = resolve(root, cp);
    if (existsSync(fullPath)) {
      results.found = true;
      results.path = cp;
      const content = readFileSafe(fullPath);
      if (content) {
        try {
          // Parse tsconfig (strip comments)
          const jsonStr = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
          const config = JSON.parse(jsonStr);
          const compilerOptions = config.compilerOptions || {};

          results.config = {
            target: compilerOptions.target || 'Not set',
            module: compilerOptions.module || 'Not set',
            strict: compilerOptions.strict || false,
            strictNullChecks: compilerOptions.strictNullChecks || false,
            jsx: compilerOptions.jsx || 'Not set',
            outDir: compilerOptions.outDir || 'Not set',
            rootDir: compilerOptions.rootDir || 'Not set',
            declaration: compilerOptions.declaration || false,
            sourceMap: compilerOptions.sourceMap || false,
            esModuleInterop: compilerOptions.esModuleInterop || false,
            skipLibCheck: compilerOptions.skipLibCheck || false,
            forceConsistentCasingInFileNames: compilerOptions.forceConsistentCasingInFileNames || false,
            resolveJsonModule: compilerOptions.resolveJsonModule || false,
          };

          // Recommendations
          if (!compilerOptions.strict) {
            results.recommendations.push({
              priority: 'high',
              setting: 'strict',
              message: 'Enable strict mode for better type safety: "strict": true',
            });
          }
          if (!compilerOptions.strictNullChecks && !compilerOptions.strict) {
            results.recommendations.push({
              priority: 'high',
              setting: 'strictNullChecks',
              message: 'Enable strictNullChecks to catch null/undefined errors at compile time',
            });
          }
          if (!compilerOptions.declaration && !config.include?.some(i => i.includes('test'))) {
            results.recommendations.push({
              priority: 'medium',
              setting: 'declaration',
              message: 'Enable declaration generation for better library support: "declaration": true',
            });
          }
          if (!compilerOptions.sourceMap) {
            results.recommendations.push({
              priority: 'medium',
              setting: 'sourceMap',
              message: 'Enable source maps for better debugging experience',
            });
          }
          if (!compilerOptions.esModuleInterop) {
            results.recommendations.push({
              priority: 'medium',
              setting: 'esModuleInterop',
              message: 'Enable esModuleInterop for better CommonJS compatibility',
            });
          }
          if (!compilerOptions.forceConsistentCasingInFileNames) {
            results.recommendations.push({
              priority: 'low',
              setting: 'forceConsistentCasingInFileNames',
              message: 'Enable forceConsistentCasingInFileNames to prevent cross-platform casing issues',
            });
          }
          if (!compilerOptions.skipLibCheck && findFiles(root, ['.d.ts']).length > 50) {
            results.recommendations.push({
              priority: 'low',
              setting: 'skipLibCheck',
              message: 'Consider enabling skipLibCheck to speed up type checking in large projects',
            });
          }
        } catch (e) {
          results.parseError = e.message;
        }
      }
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Unused export detection (simple heuristic)
// ---------------------------------------------------------------------------

function analyzeUnusedExports(root) {
  const results = { scanned: 0, exports: [], potentiallyUnused: [], summary: null };

  const tsFiles = findFiles(root, ['.ts', '.tsx']);
  results.scanned = tsFiles.length;

  // Collect all exports and all imports
  const allExports = []; // { name, file, line }
  const allImports = new Set();

  for (const file of tsFiles) {
    const content = readFileSafe(file);
    if (!content) continue;

    const lines = content.split('\n');
    const relPath = relative(root, file).replace(/\\/g, '/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // export function/class/const/interface/type
      const exportMatch = line.match(/^export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/);
      if (exportMatch) {
        allExports.push({ name: exportMatch[1], file: relPath, line: i + 1, isDefault: line.includes('export default') });
      }

      // export { ... }
      const namedExportMatch = line.match(/^export\s+\{\s*([^}]+)\s*\}/);
      if (namedExportMatch) {
        const names = namedExportMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
        for (const name of names) {
          if (name) allExports.push({ name, file: relPath, line: i + 1, isDefault: false });
        }
      }

      // import statements
      const importMatch = line.match(/import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from/);
      if (importMatch) {
        const names = (importMatch[1] || importMatch[2] || '').split(',').map(s => s.trim().split(/\s+as\s+/)[1]?.trim() || s.trim().split(/\s+as\s+/)[0]?.trim());
        for (const name of names) {
          if (name) allImports.add(name);
        }
      }

      // import * as ...
      const namespaceImport = line.match(/import\s+\*\s+as\s+(\w+)/);
      if (namespaceImport) {
        allImports.add(namespaceImport[1]);
      }
    }
  }

  // Find potentially unused exports (exported but never imported by other files)
  for (const exp of allExports) {
    if (!allImports.has(exp.name) && !exp.name.startsWith('_')) {
      results.potentiallyUnused.push(exp);
    }
  }

  results.exports = allExports;
  results.summary = {
    totalFiles: tsFiles.length,
    totalExports: allExports.length,
    potentiallyUnused: results.potentiallyUnused.length,
  };

  return results;
}

// ---------------------------------------------------------------------------
// ESM/CJS compatibility check
// ---------------------------------------------------------------------------

function analyzeModuleCompatibility(root) {
  const results = { packageType: null, hasESM: false, hasCJS: false, issues: [] };

  // Check package.json type field
  const pkgPath = resolve(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSafe(pkgPath) || '{}');
    results.packageType = pkg.type || 'commonjs';

    // Check for exports field
    if (pkg.exports) {
      results.hasExportsField = true;
    }
  }

  // Check for .mjs / .cjs files
  const mjsFiles = findFiles(root, ['.mjs', '.mts']);
  const cjsFiles = findFiles(root, ['.cjs', '.cts']);
  results.hasESM = mjsFiles.length > 0;
  results.hasCJS = cjsFiles.length > 0;

  // Detect mixed usage
  if (results.packageType === 'module' && cjsFiles.length > 0) {
    results.issues.push({
      severity: 'warning',
      message: `Package is type: "module" but ${cjsFiles.length} .cjs files found (this is valid CJS in ESM package)`,
    });
  }

  if (results.packageType === 'commonjs' && mjsFiles.length > 0) {
    results.issues.push({
      severity: 'info',
      message: `Package is type: "commonjs" but ${mjsFiles.length} .mjs files found (ES modules in CJS package)`,
    });
  }

  // Check tsconfig module setting
  const tsConfig = analyzeTSConfig(root);
  if (tsConfig.found && tsConfig.config) {
    const moduleSetting = tsConfig.config.module;
    if (moduleSetting === 'CommonJS' && results.packageType === 'module') {
      results.issues.push({
        severity: 'warning',
        message: `tsconfig module is "CommonJS" but package.json type is "module"`,
      });
    }
    if (moduleSetting === 'ESNext' || moduleSetting === 'ES2020' || moduleSetting === 'NodeNext') {
      results.esmConfig = true;
    }
  }

  results.summary = {
    packageType: results.packageType,
    hasESM: results.hasESM,
    hasCJS: results.hasCJS,
    issues: results.issues.length,
  };

  return results;
}

// ---------------------------------------------------------------------------
// Analyze command
// ---------------------------------------------------------------------------

function cmdAnalyze(root) {
  const config = analyzeTSConfig(root);
  const unused = analyzeUnusedExports(root);
  const modules = analyzeModuleCompatibility(root);

  const recommendations = [];

  // Config recommendations
  for (const r of config.recommendations) {
    recommendations.push({ ...r, category: 'tsconfig' });
  }

  // Unused exports
  if (unused.summary.potentiallyUnused > 10) {
    recommendations.push({
      priority: 'medium',
      category: 'exports',
      message: `${unused.summary.potentiallyUnused} potentially unused exports found. Consider auditing and removing them.`,
    });
  }

  // Module issues
  for (const issue of modules.issues) {
    recommendations.push({
      priority: issue.severity === 'warning' ? 'medium' : 'low',
      category: 'modules',
      message: issue.message,
    });
  }

  // Missing tsconfig
  if (!config.found) {
    recommendations.push({
      priority: 'high',
      category: 'tsconfig',
      message: 'No tsconfig.json found. Create one to enable TypeScript proper configuration.',
    });
  }

  return {
    tsconfig: config,
    unusedExports: unused,
    moduleCompatibility: modules,
    recommendations,
    summary: {
      configFound: config.found,
      strictMode: config.config?.strict || false,
      totalExports: unused.summary.totalExports,
      potentiallyUnused: unused.summary.potentiallyUnused,
      moduleType: modules.packageType,
      recommendations: recommendations.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatText(command, result, opts, color) {
  const c = COLORS;
  const out = [];

  const heading = (text) => color ? `${c.bold}${c.blue}${text}${c.reset}` : text;
  const good = (text) => color ? `${c.green}${text}${c.reset}` : text;
  const warn = (text) => color ? `${c.yellow}${text}${c.reset}` : text;
  const bad = (text) => color ? `${c.red}${text}${c.reset}` : text;

  switch (command) {
    case 'check-config': {
      out.push(heading('TypeScript Config Analysis'));
      out.push('='.repeat(40));
      if (!result.found) {
        out.push(`  ${bad('No tsconfig.json found')}`);
        break;
      }
      out.push(`  File:        ${result.path}`);
      if (result.config) {
        out.push(`  Target:      ${result.config.target}`);
        out.push(`  Module:      ${result.config.module}`);
        out.push(`  Strict:      ${result.config.strict ? good('✅') : warn('❌')}`);
        out.push(`  Declaration: ${result.config.declaration ? good('✅') : warn('❌')}`);
        out.push(`  SourceMap:   ${result.config.sourceMap ? good('✅') : warn('❌')}`);
        out.push(`  JSX:         ${result.config.jsx}`);
      }
      if (result.recommendations.length > 0) {
        out.push('');
        out.push(heading('Recommendations'));
        for (const r of result.recommendations) {
          const icon = r.priority === 'high' ? bad('🔴') : r.priority === 'medium' ? warn('🟡') : '💡';
          out.push(`  ${icon} ${r.message}`);
        }
      }
      break;
    }
    case 'check-unused': {
      out.push(heading('Export Analysis'));
      out.push('='.repeat(40));
      out.push(`  Scanned:     ${result.scanned} files`);
      out.push(`  Exports:     ${result.summary.totalExports}`);
      out.push(`  Potentially Unused: ${result.summary.potentiallyUnused > 0 ? warn(result.summary.potentiallyUnused.toString()) : good('0')}`);
      if (result.potentiallyUnused.length > 0) {
        out.push('');
        out.push(heading('Potentially Unused Exports'));
        for (const exp of result.potentiallyUnused.slice(0, 20)) {
          out.push(`  ${warn('?')} ${exp.name} (${exp.file}:${exp.line})`);
        }
        if (result.potentiallyUnused.length > 20) {
          out.push(`  ${warn(`... and ${result.potentiallyUnused.length - 20} more`)}`);
        }
      }
      break;
    }
    case 'analyze': {
      out.push(heading('TypeScript Project Analysis'));
      out.push('='.repeat(40));
      out.push('');
      out.push(heading('Config'));
      out.push(`  Config:      ${result.summary.configFound ? good(result.tsconfig.path) : bad('not found')}`);
      out.push(`  Strict Mode: ${result.summary.strictMode ? good('✅') : warn('❌')}`);
      out.push('');
      out.push(heading('Exports'));
      out.push(`  Total:       ${result.summary.totalExports}`);
      out.push(`  Unused:      ${result.summary.potentiallyUnused > 0 ? warn(String(result.summary.potentiallyUnused)) : good('0 ✨')}`);
      out.push('');
      out.push(heading('Modules'));
      out.push(`  Package Type: ${result.summary.moduleType}`);
      if (result.moduleCompatibility.issues.length > 0) {
        for (const issue of result.moduleCompatibility.issues) {
          const icon = issue.severity === 'warning' ? warn('⚠️') : '💡';
          out.push(`  ${icon} ${issue.message}`);
        }
      }
      out.push('');
      if (result.recommendations.length > 0) {
        out.push(heading('Recommendations'));
        for (const r of result.recommendations) {
          const icon = r.priority === 'high' ? bad('🔴') : r.priority === 'medium' ? warn('🟡') : '💡';
          out.push(`  ${icon} [${r.category}] ${r.message}`);
        }
      }
      break;
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node ts-helper.mjs <command> [options]

TypeScript project analysis and assistance tool.

Commands:
  check-config     Analyze tsconfig.json for best practices
  check-unused     Detect potentially unused exports
  analyze          Full project analysis (all checks)

Options:
  --root <path>         Root directory (default: .)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node ts-helper.mjs check-config
  node ts-helper.mjs check-unused
  node ts-helper.mjs analyze --format json
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownCommands = ['check-config', 'check-unused', 'analyze'];
  const opts = {
    command: knownCommands.includes(args[0]) ? args[0] : null,
    root: '.',
    format: 'text',
    color: undefined,
  };

  if (!opts.command) {
    console.error(`Unknown command: ${args[0]}`);
    console.error(`Valid commands: ${knownCommands.join(', ')}`);
    process.exit(1);
  }

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--no-color': opts.color = false; break;
      case '--color': opts.color = true; break;
    }
    i++;
  }

  return opts;
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
    case 'check-config':
      result = analyzeTSConfig(root);
      break;
    case 'check-unused':
      result = analyzeUnusedExports(root);
      break;
    case 'analyze':
      result = cmdAnalyze(root);
      break;
  }

  switch (opts.format) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'markdown':
      console.log(formatText(opts.command, result, opts, false));
      break;
    case 'text':
    default:
      console.log(formatText(opts.command, result, opts, color));
      break;
  }
}

main();
