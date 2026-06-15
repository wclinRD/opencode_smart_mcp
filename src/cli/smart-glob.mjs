#!/usr/bin/env node
/**
 * smart_glob — Enhanced glob tool (Phase 1: backward-compatible core)
 *
 * Replaces OpenCode's built-in glob with ripgrep-backed file discovery.
 * Default behavior matches built-in glob exactly:
 *   - pattern (required): glob pattern
 *   - path (optional):   root directory
 *   - Output: absolute path list, max 100 entries
 *
 * Usage:
 *   node smart-glob.mjs <pattern> [--path <dir>] [--no-color]
 */

import { spawnSync } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_RESULTS = 100;
const RG_TIMEOUT = 30_000; // 30s timeout for rg

// ── Parse CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const pattern = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--path' && i + 1 < args.length) {
    flags.path = args[++i];
  } else if (args[i] === '--no-color') {
    // accepted, no-op
  }
}

// ── Validate ───────────────────────────────────────────────────────────
if (!pattern) {
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
const rgArgs = ['--files', '--glob', pattern, '--no-messages'];

// ── Execute rg ─────────────────────────────────────────────────────────
const result = spawnSync('rg', rgArgs, {
  cwd,
  encoding: 'utf-8',
  timeout: RG_TIMEOUT,
  maxBuffer: 10 * 1024 * 1024, // 10MB
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
  // rg returns 1 when no files found — that's not an error for us
  if (result.status !== 1 || result.stdout.trim()) {
    process.stderr.write(result.stderr || `Error: rg exited with status ${result.status}\n`);
    process.exit(result.status);
  }
}

// ── Process output ─────────────────────────────────────────────────────
// Convert to absolute paths to match built-in glob behavior
// resolve() handles both absolute and relative --path; normalize() removes
// trailing slashes, ./ segments, and // duplicates for consistency
let files = result.stdout
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(f => normalize(resolve(cwd, f)));

// ── Truncate if needed ─────────────────────────────────────────────────
const total = files.length;
const truncated = total > MAX_RESULTS;
if (truncated) {
  files = files.slice(0, MAX_RESULTS);
}

// ── Output ─────────────────────────────────────────────────────────────
if (files.length === 0) {
  process.stdout.write('No files found\n');
} else {
  process.stdout.write(files.join('\n') + '\n');
  if (truncated) {
    process.stdout.write(`\n[Showing ${MAX_RESULTS} of ${total} results. Use offset/limit for pagination.]\n`);
  }
}