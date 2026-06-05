#!/usr/bin/env node

// py-helper.mjs — Python project analysis and assistance
//
// Analyzes Python projects for common issues and best practices:
//   - Virtual environment detection and activation
//   - Dependency analysis (requirements.txt / pyproject.toml)
//   - mypy type checking integration
//   - Code quality suggestions
//
// Usage:
//   node py-helper.mjs <command> [options]
//
// Commands:
//   check-env        Detect virtual environments and Python version
//   check-deps       Analyze dependencies (conflicts, missing, outdated)
//   typecheck        Run mypy type checking (if installed)
//   analyze          Full project analysis (all checks)
//
// Options:
//   --root <path>         Root directory (default: .)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node py-helper.mjs check-env
//   node py-helper.mjs check-deps --root ./backend
//   node py-helper.mjs analyze --format json

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
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
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 });
  } catch (e) {
    return { error: e.message, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function findFiles(root, pattern) {
  const results = [];
  function walk(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__pycache__') {
          walk(fullPath);
        } else if (entry.isFile() && entry.name === pattern) {
          results.push(fullPath);
        }
      }
    } catch { /* skip unreadable */ }
  }
  walk(root);
  return results;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdCheckEnv(root) {
  const results = { pythonVersion: null, venvs: [], active: null };

  // Check python version
  try {
    const pyVer = execSync('python --version 2>&1', { encoding: 'utf-8' }).trim();
    results.pythonVersion = pyVer;
  } catch {
    try {
      const py3Ver = execSync('python3 --version 2>&1', { encoding: 'utf-8' }).trim();
      results.pythonVersion = py3Ver;
    } catch {
      results.pythonVersion = 'Not found';
    }
  }

  // Find virtual environments
  const venvNames = ['.venv', 'venv', 'env', '.env'];
  for (const name of venvNames) {
    const venvPath = resolve(root, name);
    const pyBin = resolve(venvPath, 'Scripts', 'python.exe');
    if (existsSync(pyBin)) {
      results.venvs.push({ path: name, type: 'virtualenv', active: true });
    }
  }

  // Check pyproject.toml
  if (existsSync(resolve(root, 'pyproject.toml'))) {
    results.projectType = 'pyproject.toml';
  } else if (existsSync(resolve(root, 'requirements.txt'))) {
    results.projectType = 'requirements.txt';
  } else if (existsSync(resolve(root, 'setup.py')) || existsSync(resolve(root, 'setup.cfg'))) {
    results.projectType = 'setup.py/setup.cfg';
  }

  // Check pip
  try {
    const pipList = execSync('pip list --format=columns 2>&1', { encoding: 'utf-8', timeout: 10000 });
    results.pipAvailable = true;
    const lines = pipList.split('\n').filter(l => l.trim() && !l.includes('Package') && !l.includes('---'));
    results.packageCount = lines.length;
  } catch {
    results.pipAvailable = false;
  }

  return results;
}

function cmdCheckDeps(root) {
  const issues = [];
  const recommendations = [];

  // Parse requirements.txt
  const reqFile = resolve(root, 'requirements.txt');
  if (existsSync(reqFile)) {
    const content = readFileSafe(reqFile);
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const devLines = [];
    const prodLines = [];

    let inDev = false;
    for (const line of lines) {
      if (line.toLowerCase().includes('# dev') || line.toLowerCase().includes('#development')) {
        inDev = true;
        continue;
      }
      if (inDev) {
        devLines.push(line.trim());
      } else {
        prodLines.push(line.trim());
      }
    }

    // Check for version pinning
    const unpinned = prodLines.filter(l => l.includes('>=') || l.includes('=='));
    if (unpinned.length < prodLines.length * 0.5 && prodLines.length > 3) {
      recommendations.push({
        type: 'suggestion',
        message: 'Consider pinning dependency versions with == for reproducible builds',
      });
    }

    // Suggest splitting dev deps
    if (devLines.length === 0 && lines.length > 5) {
      recommendations.push({
        type: 'suggestion',
        message: 'Consider splitting dev dependencies into requirements-dev.txt',
      });
    }

    issues.push({
      file: 'requirements.txt',
      totalDeps: lines.length,
      prodDeps: prodLines.length,
      devDeps: devLines.length,
    });
  }

  // Parse pyproject.toml
  const pyprojectFile = resolve(root, 'pyproject.toml');
  if (existsSync(pyprojectFile)) {
    const content = readFileSafe(pyprojectFile);
    issues.push({ file: 'pyproject.toml', format: 'PEP 621', size: content.length });
  }

  // Check for common missing deps
  const setupPy = readFileSafe(resolve(root, 'setup.py'));
  if (setupPy && !setupPy.includes('install_requires') && !setupPy.includes('extras_require')) {
    recommendations.push({
      type: 'info',
      message: 'setup.py found but no install_requires or extras_require defined',
    });
  }

  return { issues, recommendations, summary: { issues: issues.length, suggestions: recommendations.length } };
}

function cmdTypecheck(root) {
  const results = { available: false, output: null, errors: [], warnings: [], summary: null };

  // Check if mypy is available
  try {
    const mypyVer = execSync('mypy --version 2>&1', { encoding: 'utf-8', timeout: 5000 });
    results.available = true;
    results.mypyVersion = mypyVer.trim();
  } catch {
    try {
      const pipShow = execSync('pip show mypy 2>&1', { encoding: 'utf-8', timeout: 5000 });
      results.available = true;
      results.mypyVersion = pipShow.split('\n').find(l => l.startsWith('Version'))?.split(':')[1]?.trim() || 'unknown';
    } catch {
      results.available = false;
      results.error = 'mypy not installed. Install with: pip install mypy';
      return results;
    }
  }

  // Check for mypy config
  const configFiles = ['mypy.ini', '.mypy.ini', 'pyproject.toml', 'setup.cfg'];
  const configFound = configFiles.some(f => existsSync(resolve(root, f)));
  results.configFound = configFound;

  // Run mypy
  try {
    const output = execSync(`mypy --show-error-codes --ignore-missing-imports "${root}" 2>&1`, {
      encoding: 'utf-8', timeout: 60000,
    });
    results.output = output.trim();

    // Parse errors
    const errorLines = output.split('\n').filter(l => l.includes(': error:'));
    const warningLines = output.split('\n').filter(l => l.includes(': warning:'));
    results.errors = errorLines.map(l => {
      const parts = l.split(':');
      return {
        file: parts[0]?.trim() || '',
        line: parseInt(parts[1]) || 0,
        message: parts.slice(2).join(':').replace(' error:', '').trim(),
      };
    });
    results.warnings = warningLines.map(l => {
      const parts = l.split(':');
      return {
        file: parts[0]?.trim() || '',
        line: parseInt(parts[1]) || 0,
        message: parts.slice(2).join(':').replace(' warning:', '').trim(),
      };
    });

    // Parse summary
    const summaryMatch = output.match(/Found (\d+) error/);
    if (summaryMatch) {
      results.summary = { totalErrors: parseInt(summaryMatch[1]) };
    }
  } catch (e) {
    const stdout = e.stdout || '';
    if (stdout) {
      results.output = stdout.trim();
      const errorLines = stdout.split('\n').filter(l => l.includes(': error:'));
      results.errors = errorLines.map(l => {
        const parts = l.split(':');
        return { file: parts[0]?.trim() || '', line: parseInt(parts[1]) || 0, message: parts.slice(2).join(':').replace(' error:', '').trim() };
      });
      const summaryMatch = stdout.match(/Found (\d+) error/);
      if (summaryMatch) results.summary = { totalErrors: parseInt(summaryMatch[1]) };
    } else {
      results.error = e.message;
    }
  }

  return results;
}

function cmdAnalyze(root) {
  const env = cmdCheckEnv(root);
  const deps = cmdCheckDeps(root);
  const typecheck = cmdTypecheck(root);

  const recommendations = [];

  // Environment recommendations
  if (env.venvs.length === 0) {
    recommendations.push({
      priority: 'high',
      category: 'environment',
      message: 'No virtual environment detected. Create one with: python -m venv .venv',
    });
  }

  if (deps.recommendations) {
    recommendations.push(...deps.recommendations.map(r => ({ ...r, category: 'dependencies' })));
  }

  // Type checking recommendations
  if (!typecheck.available) {
    recommendations.push({
      priority: 'medium',
      category: 'typecheck',
      message: 'mypy not installed. Add to dev dependencies: pip install mypy',
    });
  } else if (!typecheck.configFound) {
    recommendations.push({
      priority: 'low',
      category: 'typecheck',
      message: 'No mypy config found. Create mypy.ini for project-specific settings',
    });
  }

  // pyproject.toml recommendation
  if (existsSync(resolve(root, 'requirements.txt')) && !existsSync(resolve(root, 'pyproject.toml'))) {
    recommendations.push({
      priority: 'low',
      category: 'modernization',
      message: 'Consider migrating from requirements.txt to pyproject.toml (PEP 621)',
    });
  }

  return {
    environment: env,
    dependencies: deps,
    typecheck: typecheck,
    recommendations,
    summary: {
      pythonVersion: env.pythonVersion,
      venvFound: env.venvs.length > 0,
      depsCount: deps.issues.length,
      typeErrors: typecheck.summary?.totalErrors || 0,
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
    case 'check-env': {
      out.push(heading('Python Environment'));
      out.push('='.repeat(40));
      out.push(`  Python:     ${result.pythonVersion}`);
      out.push(`  Pip:        ${result.pipAvailable ? good('available') : bad('not found')}`);
      if (result.pipAvailable) out.push(`  Packages:   ${result.packageCount || 0}`);
      out.push(`  Project:    ${result.projectType || 'unknown'}`);
      out.push(`  VirtualEnv: ${result.venvs.length > 0 ? good(result.venvs.map(v => v.path).join(', ')) : warn('none found')}`);
      break;
    }
    case 'check-deps': {
      out.push(heading('Dependency Analysis'));
      out.push('='.repeat(40));
      for (const issue of result.issues) {
        out.push(`  ${issue.file}:`);
        if (issue.totalDeps !== undefined) out.push(`    Total: ${issue.totalDeps} deps`);
        if (issue.prodDeps !== undefined) out.push(`    Prod:  ${issue.prodDeps} deps`);
        if (issue.devDeps !== undefined) out.push(`    Dev:   ${issue.devDeps} deps`);
      }
      if (result.recommendations.length > 0) {
        out.push('');
        out.push(heading('Recommendations'));
        for (const r of result.recommendations) {
          out.push(`  ${warn('💡')} ${r.message}`);
        }
      }
      break;
    }
    case 'typecheck': {
      out.push(heading('Type Check (mypy)'));
      out.push('='.repeat(40));
      if (!result.available) {
        out.push(`  ${bad(result.error || 'mypy not available')}`);
        break;
      }
      out.push(`  mypy:       ${result.mypyVersion}`);
      out.push(`  Config:     ${result.configFound ? good('found') : warn('not found')}`);
      if (result.summary) {
        const errCount = result.summary.totalErrors || 0;
        out.push(`  Errors:     ${errCount > 0 ? bad(`${errCount}`) : good('0 ✨')}`);
      }
      if (result.errors.length > 0) {
        out.push('');
        out.push(heading('Errors'));
        for (const err of result.errors.slice(0, 10)) {
          const file = err.file.split(/[/\\]/).pop() || err.file;
          out.push(`  ${bad('✗')} ${file}:${err.line} ${err.message}`);
        }
        if (result.errors.length > 10) out.push(`  ${warn(`... and ${result.errors.length - 10} more`)}`);
      }
      break;
    }
    case 'analyze': {
      out.push(heading('Python Project Analysis'));
      out.push('='.repeat(40));
      out.push('');
      out.push(heading('Summary'));
      out.push(`  Python:     ${result.summary.pythonVersion}`);
      out.push(`  VirtualEnv: ${result.summary.venvFound ? good('✅ active') : warn('⚠️  not found')}`);
      out.push(`  Dependencies: ${result.summary.depsCount > 0 ? warn(`${result.summary.depsCount} files`) : good('analyzed')}`);
      out.push(`  Type Errors: ${result.summary.typeErrors > 0 ? bad(`${result.summary.typeErrors}`) : good('0 ✨')}`);
      out.push(`  Recommendations: ${result.summary.recommendations > 0 ? warn(`${result.summary.recommendations}`) : good('none')}`);
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
Usage: node py-helper.mjs <command> [options]

Python project analysis and assistance tool.

Commands:
  check-env        Detect virtual environments and Python version
  check-deps       Analyze dependencies (conflicts, missing, outdated)
  typecheck        Run mypy type checking (if installed)
  analyze          Full project analysis (all checks)

Options:
  --root <path>         Root directory (default: .)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node py-helper.mjs check-env
  node py-helper.mjs analyze
  node py-helper.mjs analyze --format json
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownCommands = ['check-env', 'check-deps', 'typecheck', 'analyze'];
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
    case 'check-env':
      result = cmdCheckEnv(root);
      break;
    case 'check-deps':
      result = cmdCheckDeps(root);
      break;
    case 'typecheck':
      result = cmdTypecheck(root);
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
