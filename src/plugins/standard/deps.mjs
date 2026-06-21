// deps.mjs → smart_deps (via smart_smart_run router)
// Dependency audit tool — minimal wrapper around npm audit/outdated.
//
// Usage:
//   ssr({tool:"deps", args:{command:"audit", root:"."}})
//   ssr({tool:"deps", args:{command:"outdated", root:"."}})
//   ssr({tool:"deps", args:{command:"analyze", root:"."}})
//
// Targets: Node.js projects (npm). Extendable to other ecosystems.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hasPackageJson(root) {
  return existsSync(resolve(root, 'package.json'));
}

function safeExec(cmd, root) {
  try {
    const out = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out.trim() };
  } catch (err) {
    return {
      ok: false,
      output: err.stdout?.toString()?.trim() || '',
      error: err.stderr?.toString()?.trim() || err.message,
      exitCode: err.status,
    };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Run npm audit and report vulnerabilities.
 */
function auditDeps(root) {
  if (!hasPackageJson(root)) {
    return { ok: false, error: 'No package.json found in project root' };
  }

  const result = safeExec('npm audit --json', root);
  if (!result.ok && result.exitCode !== 1) {
    // npm audit exits 1 when vulnerabilities found — that's expected
    return { ok: false, error: `npm audit failed: ${result.error}`, exitCode: result.exitCode };
  }

  try {
    const data = JSON.parse(result.output);
    const vulnerabilities = data.vulnerabilities || {};
    const metadata = data.metadata || {};

    const summary = {
      totalDeps: metadata.totalDependencies || 0,
      vulnerabilities: metadata.vulnerabilities || { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      totalCount: Object.values(metadata.vulnerabilities || {}).reduce((a, b) => a + b, 0),
    };

    const details = Object.entries(vulnerabilities).map(([pkg, info]) => ({
      package: pkg,
      severity: info.severity,
      via: info.via?.filter(v => typeof v === 'object')?.map(v => v.title || v.source) || [],
      fixAvailable: info.fixAvailable === true || (typeof info.fixAvailable === 'object' && info.fixAvailable !== null),
      range: info.range,
    })).sort((a, b) => {
      const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    });

    return { ok: true, summary, details, hasIssues: details.length > 0 };
  } catch (parseErr) {
    return { ok: false, error: `Failed to parse npm audit output: ${parseErr.message}` };
  }
}

/**
 * Check for outdated packages.
 */
function outdatedDeps(root) {
  if (!hasPackageJson(root)) {
    return { ok: false, error: 'No package.json found in project root' };
  }

  const result = safeExec('npm outdated --json', root);
  if (!result.ok) {
    if (result.exitCode === 1 && result.output) {
      // npm outdated exits 1 + outputs valid JSON when packages are outdated
      try {
        const data = JSON.parse(result.output);
        return parseOutdated(data);
      } catch {
        return { ok: false, error: `npm outdated failed: ${result.error}` };
      }
    }
    if (result.exitCode === 1 && !result.output) {
      // Exit 1 with no output means no outdated packages (npm behavior varies)
      return { ok: true, packages: [], summary: 'All packages are up to date' };
    }
    return { ok: false, error: `npm outdated failed: ${result.error}` };
  }

  if (!result.output) {
    return { ok: true, packages: [], summary: 'All packages are up to date' };
  }

  try {
    const data = JSON.parse(result.output);
    return parseOutdated(data);
  } catch {
    return { ok: true, packages: [], summary: 'All packages are up to date' };
  }
}

function parseOutdated(data) {
  const packages = Object.entries(data).map(([name, info]) => ({
    name,
    current: info.current,
    wanted: info.wanted,
    latest: info.latest,
    type: (info.type || 'dependency').replace('dependencies', ''),
    url: info.homepage || '',
    major: info.current !== info.latest,
  })).sort((a, b) => {
    if (a.major !== b.major) return a.major ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    packages,
    count: packages.length,
    majorCount: packages.filter(p => p.major).length,
  };
}

/**
 * Analyze dependency structure from package.json.
 */
function analyzeDeps(root) {
  if (!hasPackageJson(root)) {
    return { ok: false, error: 'No package.json found in project root' };
  }

  try {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
    const deps = Object.keys(pkg.dependencies || {}).length;
    const devDeps = Object.keys(pkg.devDependencies || {}).length;
    const peerDeps = Object.keys(pkg.peerDependencies || {}).length;

    // Check lock file size as proxy for total dependency tree
    let lockSize = 0;
    const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    for (const lf of lockFiles) {
      const lfPath = resolve(root, lf);
      if (existsSync(lfPath)) {
        const stat = readFileSync(lfPath);
        lockSize = stat.length;
        break;
      }
    }

    return {
      ok: true,
      summary: {
        name: pkg.name || '(unnamed)',
        version: pkg.version || '0.0.0',
        dependencies: deps,
        devDependencies: devDeps,
        peerDependencies: peerDeps,
        total: deps + devDeps + peerDeps,
        lockFileSizeKB: Math.round(lockSize / 1024),
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to analyze dependencies: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
export default {
  name: 'deps',
  category: 'standard',
  description: `Dependency audit tool — audit security, check outdated packages, analyze structure.
Commands:
  audit   — npm audit wrapper, returns vulnerability report with severity breakdown
  outdated — npm outdated wrapper, lists out-of-date packages
  analyze — reads package.json, reports dependency count and lock file size
Use when: need to check for vulnerable deps, review outdated packages, understand dep structure.`,

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['audit', 'outdated', 'analyze'],
        description: 'audit = security audit, outdated = outdated packages, analyze = dep structure',
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: current working directory)',
      },
    },
    required: ['command'],
  },

  handler: async (args) => {
    const root = args.root || process.cwd();
    const command = args.command;

    let result;
    switch (command) {
      case 'audit':
        result = auditDeps(resolve(root));
        break;
      case 'outdated':
        result = outdatedDeps(resolve(root));
        break;
      case 'analyze':
        result = analyzeDeps(resolve(root));
        break;
      default:
        return JSON.stringify({ ok: false, error: `Unknown command: ${command}` });
    }

    return JSON.stringify(result, null, 2);
  },
};
