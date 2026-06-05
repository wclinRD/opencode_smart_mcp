#!/usr/bin/env node

// rs-helper.mjs — Rust project analysis and assistance
//
// Analyzes Rust projects for common issues and best practices:
//   - cargo check integration (compilation errors)
//   - cargo clippy integration (lint warnings)
//   - Cargo.toml dependency analysis
//   - cargo fmt --check formatting
//
// Usage:
//   node rs-helper.mjs <command> [options]
//
// Commands:
//   check            Run cargo check (compile errors)
//   clippy           Run cargo clippy (lint warnings)
//   analyze          Analyze Cargo.toml and project structure
//   fmt              Run cargo fmt --check (formatting)
//
// Options:
//   --root <path>         Root directory (default: .)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node rs-helper.mjs check
//   node rs-helper.mjs clippy --root ./crates/foo
//   node rs-helper.mjs analyze --format json

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function runCmd(cmd, cwd) {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
    return { error: null, stdout, stderr: '' };
  } catch (e) {
    return { error: e.message, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function findCargoToml(root) {
  const cargoFile = resolve(root, 'Cargo.toml');
  if (existsSync(cargoFile)) return cargoFile;
  // Try parent directories
  let dir = root;
  for (let i = 0; i < 5; i++) {
    const parent = resolve(dir, '..');
    const parentCargo = resolve(parent, 'Cargo.toml');
    if (existsSync(parentCargo)) return parentCargo;
    dir = parent;
  }
  return null;
}

function parseCargoToml(content) {
  const result = {
    name: 'unknown',
    version: '0.0.0',
    edition: '2021',
    deps: [],
    devDeps: [],
    buildDeps: [],
    features: [],
    targets: [],
  };

  // Parse [package] section
  const pkgName = content.match(/^name\s*=\s*"([^"]+)"/m);
  if (pkgName) result.name = pkgName[1];
  const pkgVer = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (pkgVer) result.version = pkgVer[1];
  const edition = content.match(/^edition\s*=\s*"([^"]+)"/m);
  if (edition) result.edition = edition[1];

  // Parse [dependencies]
  const depSection = content.match(/^\[dependencies\]\s*\n([\s\S]*?)(?:\n\[|$)/m);
  if (depSection) {
    const lines = depSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const line of lines) {
      const simple = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (simple) {
        result.deps.push({ name: simple[1], version: simple[2], features: [] });
        continue;
      }
      const complex = line.match(/^(\w+)\s*=\s*\{([^}]+)\}/);
      if (complex) {
        const dep = { name: complex[1], version: '?', features: [], optional: false };
        const attrs = complex[2].split(',').map(s => s.trim());
        for (const attr of attrs) {
          const v = attr.match(/version\s*=\s*"([^"]+)"/);
          if (v) dep.version = v[1];
          if (attr.includes('optional = true')) dep.optional = true;
          const f = attr.match(/features\s*=\s*\[([^\]]+)\]/);
          if (f) dep.features = f[1].split(',').map(s => s.trim().replace(/"/g, ''));
        }
        result.deps.push(dep);
      }
    }
  }

  // Parse [dev-dependencies]
  const devDepSection = content.match(/^\[dev-dependencies\]\s*\n([\s\S]*?)(?:\n\[|$)/m);
  if (devDepSection) {
    const lines = devDepSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const line of lines) {
      const m = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (m) result.devDeps.push({ name: m[1], version: m[2] });
    }
  }

  // Parse [features]
  const featSection = content.match(/^\[features\]\s*\n([\s\S]*?)(?:\n\[|$)/m);
  if (featSection) {
    const lines = featSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const line of lines) {
      const m = line.match(/^(\w+)\s*=\s*\[([^\]]*)\]/);
      if (m) result.features.push({ name: m[1], deps: m[2].split(',').map(s => s.trim().replace(/"/g, '')) });
    }
  }

  // Detect bin/lib targets
  if (content.includes('[lib]')) result.targets.push('lib');
  if (content.match(/\[\[bin\]\]/)) result.targets.push('bin');
  // Auto-detect: if no explicit targets, check for src/main.rs or src/lib.rs
  if (result.targets.length === 0) {
    if (content.includes('name = "') && !content.includes('[lib]')) result.targets.push('bin');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdCheck(root) {
  const result = { cargoFile: null, success: false, errors: [], warnings: [], summary: null };

  const cargoFile = findCargoToml(root);
  if (!cargoFile) {
    result.error = 'No Cargo.toml found';
    return result;
  }
  result.cargoFile = cargoFile;

  const res = runCmd('cargo check --message-format=short 2>&1', dirname(cargoFile));
  if (res.error && !res.stdout && !res.stderr) {
    result.error = `Failed to run cargo check: ${res.error}`;
    return result;
  }

  const output = res.stdout || res.stderr || '';
  result.output = output;

  // Parse output for errors and warnings
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.includes(': error[') || line.match(/^error\[/)) {
      result.errors.push(line.trim());
    } else if (line.includes(': warning[') || line.match(/^warning\[/)) {
      result.warnings.push(line.trim());
    }
  }

  // Check for "error: could not compile"
  if (output.includes('could not compile')) {
    result.success = false;
    const statusMatch = output.match(/error: could not compile `([^`]+)`/);
    result.status = `could not compile ${statusMatch ? statusMatch[1] : 'unknown'}`;
  } else if (output.includes('Finished') && output.includes('warning')) {
    result.success = true;
    result.status = 'compiled with warnings';
  } else if (output.includes('Finished') && !output.includes('error')) {
    result.success = true;
    result.status = 'compiled successfully';
  }

  // Extract summary
  const summaryMatch = output.match(/(\d+) errors?, (\d+) warnings?/);
  if (summaryMatch) {
    result.summary = { errors: parseInt(summaryMatch[1]), warnings: parseInt(summaryMatch[2]) };
  } else {
    result.summary = { errors: result.errors.length, warnings: result.warnings.length };
  }

  return result;
}

function cmdClippy(root) {
  const result = { cargoFile: null, success: false, warnings: [], errors: [], summary: null };

  const cargoFile = findCargoToml(root);
  if (!cargoFile) {
    result.error = 'No Cargo.toml found';
    return result;
  }
  result.cargoFile = cargoFile;

  const res = runCmd('cargo clippy --message-format=short 2>&1', dirname(cargoFile));
  if (res.error && !res.stdout && !res.stderr) {
    result.error = `Failed to run cargo clippy: ${res.error}`;
    return result;
  }

  const output = res.stdout || res.stderr || '';
  result.output = output;

  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.includes('error:') || line.includes(': error[')) {
      result.errors.push(line.trim());
    } else if (line.includes('warning:') || line.includes(': warning[') || line.match(/^warning: /)) {
      // Filter out the "generated N warnings" lines
      if (!line.match(/^(generated|Finished|Checking|Compiling)/i)) {
        result.warnings.push(line.trim());
      }
    }
  }

  result.success = result.errors.length === 0;
  result.summary = { errors: result.errors.length, warnings: result.warnings.length };

  return result;
}

function cmdAnalyze(root) {
  const result = { cargoFile: null, package: null, structure: {}, issues: [], recommendations: [] };

  const cargoFile = findCargoToml(root);
  if (!cargoFile) {
    result.error = 'No Cargo.toml found';
    return result;
  }
  result.cargoFile = cargoFile;

  const content = readFileSafe(cargoFile);
  if (!content) {
    result.error = 'Could not read Cargo.toml';
    return result;
  }

  result.package = parseCargoToml(content);

  // Detect src/ structure
  const srcDir = resolve(dirname(cargoFile), 'src');
  if (existsSync(srcDir)) {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    result.structure.sourceFiles = entries.filter(e => e.isFile() && e.name.endsWith('.rs')).map(e => e.name);
    result.structure.subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    result.structure.totalRsFiles = result.structure.sourceFiles.length;
  }

  // Check for common issues
  if (result.package.deps.length > 30) {
    result.recommendations.push({
      priority: 'medium', category: 'deps',
      message: `High dependency count (${result.package.deps.length}). Consider auditing unused deps with cargo-udeps.`,
    });
  }

  if (result.package.edition === '2015' || result.package.edition === '2018') {
    result.recommendations.push({
      priority: 'medium', category: 'modernization',
      message: `Using old edition (${result.package.edition}). Consider migrating to 2021.`,
    });
  }

  // Check for test directory
  if (!result.structure.sourceFiles?.includes('main.rs') && !result.structure.sourceFiles?.includes('lib.rs')) {
    result.issues.push({ type: 'warning', message: 'No src/main.rs or src/lib.rs found' });
  }

  // Suggest clippy
  result.recommendations.push({
    priority: 'low', category: 'tooling',
    message: 'Run `cargo clippy` for additional lint checks beyond rustc.',
  });

  return result;
}

function cmdFmt(root) {
  const result = { cargoFile: null, success: false, diff: null, errors: [] };

  const cargoFile = findCargoToml(root);
  if (!cargoFile) {
    result.error = 'No Cargo.toml found';
    return result;
  }
  result.cargoFile = cargoFile;

  const res = runCmd('cargo fmt --check 2>&1', dirname(cargoFile));
  if (res.error && !res.stdout && !res.stderr) {
    result.error = `Failed to run cargo fmt: ${res.error}`;
    return result;
  }

  const output = res.stdout || res.stderr || '';
  if (output.includes('Formatting check failed')) {
    result.success = false;
    result.diff = output;
    // Extract file names from diff
    const fileMatches = output.matchAll(/^Diff in (\S+) at/gm);
    for (const m of fileMatches) {
      result.errors.push(m[1]);
    }
  } else if (output.includes('nothing to do') || output.trim() === '') {
    result.success = true;
  } else {
    result.success = true;
    result.diff = output;
  }

  return result;
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
    case 'check': {
      out.push(heading('Rust Check (cargo check)'));
      out.push('='.repeat(40));
      if (result.error) { out.push(`  ${bad(result.error)}`); break; }
      out.push(`  Status:   ${result.success ? good('OK') : bad('FAIL')}`);
      if (result.status) out.push(`  Detail:   ${result.status}`);
      if (result.summary) {
        out.push(`  Errors:   ${result.summary.errors > 0 ? bad(String(result.summary.errors)) : '0'}`);
        out.push(`  Warnings: ${result.summary.warnings > 0 ? warn(String(result.summary.warnings)) : '0'}`);
      }
      if (result.errors.length > 0) {
        out.push('');
        out.push(heading('Errors'));
        for (const err of result.errors.slice(0, 15)) {
          out.push(`  ${bad('✗')} ${err}`);
        }
        if (result.errors.length > 15) out.push(`  ${warn(`... and ${result.errors.length - 15} more`)}`);
      }
      if (result.warnings.length > 0) {
        out.push('');
        out.push(heading('Warnings'));
        for (const w of result.warnings.slice(0, 10)) {
          out.push(`  ${warn('⚠')} ${w}`);
        }
        if (result.warnings.length > 10) out.push(`  ${warn(`... and ${result.warnings.length - 10} more`)}`);
      }
      break;
    }
    case 'clippy': {
      out.push(heading('Rust Clippy'));
      out.push('='.repeat(40));
      if (result.error) { out.push(`  ${bad(result.error)}`); break; }
      out.push(`  Status:   ${result.success ? good('OK') : bad('ISSUES')}`);
      if (result.summary) {
        out.push(`  Errors:   ${result.summary.errors > 0 ? bad(String(result.summary.errors)) : '0'}`);
        out.push(`  Warnings: ${result.summary.warnings > 0 ? warn(String(result.summary.warnings)) : '0'}`);
      }
      if (result.warnings.length > 0) {
        out.push('');
        out.push(heading('Warnings'));
        for (const w of result.warnings.slice(0, 20)) {
          out.push(`  ${warn('⚠')} ${w}`);
        }
        if (result.warnings.length > 20) out.push(`  ${warn(`... and ${result.warnings.length - 20} more`)}`);
      }
      break;
    }
    case 'analyze': {
      out.push(heading('Rust Project Analysis'));
      out.push('='.repeat(40));
      if (result.error) { out.push(`  ${bad(result.error)}`); break; }
      if (result.package) {
        const pkg = result.package;
        out.push(`  Package:  ${pkg.name} v${pkg.version}`);
        out.push(`  Edition:  ${pkg.edition}`);
        out.push(`  Targets:  ${pkg.targets.length > 0 ? pkg.targets.join(', ') : 'bin'}`);
        out.push(`  Deps:     ${pkg.deps.length} (${pkg.devDeps.length} dev, ${pkg.buildDeps.length} build)`);
        out.push(`  Features: ${pkg.features.length}`);
      }
      if (result.structure) {
        out.push(`  Rust files: ${result.structure.totalRsFiles || 0}`);
      }
      if (result.issues.length > 0) {
        out.push('');
        out.push(heading('Issues'));
        for (const issue of result.issues) {
          out.push(`  ${warn('⚠')} ${issue.message}`);
        }
      }
      if (result.recommendations.length > 0) {
        out.push('');
        out.push(heading('Recommendations'));
        for (const r of result.recommendations) {
          const icon = r.priority === 'high' ? bad('🔴') : r.priority === 'medium' ? warn('🟡') : '💡';
          out.push(`  ${icon} [${r.category}] ${r.message}`);
        }
      }
      break;
    }
    case 'fmt': {
      out.push(heading('Rust Format (cargo fmt --check)'));
      out.push('='.repeat(40));
      if (result.error) { out.push(`  ${bad(result.error)}`); break; }
      if (result.success) {
        out.push(`  ${good('All files formatted correctly ✨')}`);
      } else {
        out.push(`  ${bad('Formatting issues found')}`);
        for (const f of result.errors) {
          out.push(`  ${warn('⚠')} ${f}`);
        }
        out.push('');
        out.push(`  Run ${c.bold}cargo fmt${c.reset} to fix formatting.`);
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
Usage: node rs-helper.mjs <command> [options]

Rust project analysis and assistance tool.

Commands:
  check            Run cargo check (compile errors)
  clippy           Run cargo clippy (lint warnings)
  analyze          Analyze Cargo.toml and project structure
  fmt              Run cargo fmt --check (formatting)

Options:
  --root <path>         Root directory (default: .)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node rs-helper.mjs check
  node rs-helper.mjs analyze --format json
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownCommands = ['check', 'clippy', 'analyze', 'fmt'];
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
    case 'check':
      result = cmdCheck(root);
      break;
    case 'clippy':
      result = cmdClippy(root);
      break;
    case 'analyze':
      result = cmdAnalyze(root);
      break;
    case 'fmt':
      result = cmdFmt(root);
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
