#!/usr/bin/env node
/**
 * smart_glob — Enhanced glob tool (Phase 2: advanced options)
 *
 * Replaces OpenCode's built-in glob with ripgrep-backed file discovery.
 * Default behavior matches built-in glob exactly:
 *   - pattern (required): glob pattern
 *   - path (optional):   root directory
 *   - Output: absolute path list, max 100 entries
 *
 * New options:
 *   --depth <N>       Max directory traversal depth
 *   --max-files <N>   Max results (default: 100)
 *   --exclude <glob>  Exclude patterns (repeatable)
 *   --type <ext>      Filter by file extension (comma-separated)
 *   --sort <method>   Sort: name (default), size, mtime
 *
 * Usage:
 *   node smart-glob.mjs <pattern> [--path <dir>] [--depth N] [--max-files N] [--exclude <glob>] [--type <ext>] [--sort <method>] [--no-color]
 */

import { spawnSync } from 'node:child_process';
import { resolve, normalize, extname } from 'node:path';
import { existsSync, statSync } from 'node:fs';

// ── Constants ──────────────────────────────────────────────────────────
const DEFAULT_MAX_RESULTS = 100;
const RG_TIMEOUT = 30_000; // 30s timeout for rg

// ── Parse CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const patternRaw = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--path' && i + 1 < args.length) {
    flags.path = args[++i];
  } else if (args[i] === '--depth' && i + 1 < args.length) {
    flags.depth = parseInt(args[++i], 10);
  } else if (args[i] === '--max-files' && i + 1 < args.length) {
    flags.maxFiles = parseInt(args[++i], 10);
  } else if (args[i] === '--exclude' && i + 1 < args.length) {
    if (!flags.exclude) flags.exclude = [];
    flags.exclude.push(args[++i]);
  } else if (args[i] === '--type' && i + 1 < args.length) {
    flags.type = args[++i];
  } else if (args[i] === '--sort' && i + 1 < args.length) {
    flags.sort = args[++i];
  } else if (args[i] === '--format' && i + 1 < args.length) {
    flags.format = args[++i];
  } else if (args[i] === '--no-color') {
    // accepted, no-op
  }
}

// Support comma-separated patterns: "*.ts,*.tsx" → ["*.ts", "*.tsx"]
const patterns = patternRaw ? patternRaw.split(',').map(p => p.trim()).filter(Boolean) : [];

const maxResults = flags.maxFiles || DEFAULT_MAX_RESULTS;

// ── Validate ───────────────────────────────────────────────────────────
if (patterns.length === 0) {
  process.stderr.write('Error: pattern is required\n');
  process.exit(1);
}

// ── Resolve working directory ──────────────────────────────────────────
const cwd = flags.path ? resolve(flags.path) : process.cwd();
if (flags.path && !existsSync(cwd)) {
  process.stderr.write(`Error: path not found: ${flags.path}\n`);
  process.exit(1);
}

// ── Check ripgrep availability ─────────────────────────────────────────
// Provide a clear error message instead of cryptic ENOENT
const rgCheck = spawnSync('rg', ['--version'], { encoding: 'utf-8', timeout: 5000 });
if (rgCheck.error && rgCheck.error.code === 'ENOENT') {
  process.stderr.write('Error: ripgrep (rg) is required by smart_glob but not found.\n');
  process.stderr.write('Install it with: brew install ripgrep   # macOS\n');
  process.stderr.write('                apt install ripgrep     # Debian/Ubuntu\n');
  process.stderr.write('                cargo install ripgrep   # via Rust\n');
  process.exit(1);
}

// ── Build rg command ───────────────────────────────────────────────────
// rg --files lists all non-ignored files, output order matches built-in glob
// For multiple patterns, run rg once per pattern and merge+deduplicate
function buildRgArgs(pattern) {
  const rgArgs = ['--files', '--glob', pattern, '--no-messages'];
  if (flags.depth !== undefined && !isNaN(flags.depth)) {
    rgArgs.push('--max-depth', String(flags.depth));
  }
  if (flags.exclude && flags.exclude.length > 0) {
    for (const ex of flags.exclude) {
      rgArgs.push('--glob', `!${ex}`);
    }
  }
  if (flags.type) {
    const types = flags.type.split(',').map(t => t.trim().toLowerCase());
    for (const t of types) {
      rgArgs.push('--type', t);
    }
  }
  return rgArgs;
}

// ── Execute rg (single or multiple patterns) ───────────────────────────
let files = [];
for (const pat of patterns) {
  const rgArgs = buildRgArgs(pat);
  const result = spawnSync('rg', rgArgs, {
    cwd,
    encoding: 'utf-8',
    timeout: RG_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      process.stderr.write(`Error: search timed out after ${RG_TIMEOUT / 1000}s\n`);
    } else {
      process.stderr.write(`Error: ${result.error.message}\n`);
    }
    process.exit(1);
  }

  if (result.status !== 0 && result.status !== null) {
    if (result.status === 2) {
      process.stderr.write(`Error: invalid glob pattern "${pat}"\n`);
      process.stderr.write(`Tip: Check for unclosed brackets [], unmatched quotes, or special characters.\n`);
      process.exit(2);
    } else if (result.status !== 1 || result.stdout.trim()) {
      process.stderr.write(result.stderr || `Error: rg exited with status ${result.status}\n`);
      process.exit(result.status);
    }
  }

  const batch = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(f => normalize(resolve(cwd, f)));
  files.push(...batch);
}

// Deduplicate across patterns
const seen = new Set();
files = files.filter(f => {
  if (seen.has(f)) return false;
  seen.add(f);
  return true;
});

// ── Type extension filter (post-process for multi-extension) ───────────
// rg --type only supports single type, so we filter here for "js,ts" etc.
if (flags.type && flags.type.includes(',')) {
  const extensions = flags.type.split(',').map(t => `.${t.trim().toLowerCase()}`);
  files = files.filter(f => extensions.includes(extname(f).toLowerCase()));
}

// ── Sort if requested ──────────────────────────────────────────────────
if (flags.sort && flags.sort !== 'name') {
  const sortMethod = flags.sort;
  files.sort((a, b) => {
    try {
      if (sortMethod === 'size') {
        const statA = statSync(a);
        const statB = statSync(b);
        return statB.size - statA.size; // largest first
      } else if (sortMethod === 'mtime') {
        const statA = statSync(a);
        const statB = statSync(b);
        return statB.mtimeMs - statA.mtimeMs; // newest first
      }
    } catch {
      // If stat fails, keep original order
    }
    return 0;
  });
}

// ── Truncate if needed ─────────────────────────────────────────────────
const total = files.length;
const truncated = total > maxResults;
if (truncated) {
  files = files.slice(0, maxResults);
}

// ── Output ─────────────────────────────────────────────────────────────
if (flags.format === 'json') {
  // JSON output: structured metadata per file
  const entries = files.map(f => {
    const entry = { path: f };
    try {
      const stat = statSync(f);
      entry.size = stat.size;
      entry.mtime = new Date(stat.mtimeMs).toISOString();
    } catch {
      // stat may fail for broken symlinks
    }
    return entry;
  });
  const output = { total: entries.length, truncated, files: entries };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} else if (files.length === 0) {
  process.stdout.write('No files found\n');
} else {
  process.stdout.write(files.join('\n') + '\n');
  if (truncated) {
    process.stdout.write(`\n[Showing ${maxResults} of ${total} results. Use offset/limit for pagination.]\n`);
  }
}