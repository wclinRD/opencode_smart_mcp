#!/usr/bin/env node

// utils.mjs — Shared utilities for smart CLI tools
//
// Provides common functions used across all tools:
//   - COLORS, useColor()    — ANSI color support
//   - globToRegex(), matchGlob() — Glob pattern matching
//   - findFiles()           — Recursive file discovery
//   - readFileSafe()        — Safe file reader
//   - formatDuration()      — Human-readable timing

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// ---------------------------------------------------------------------------
// ANSI color constants
// ---------------------------------------------------------------------------

export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
};

/**
 * Determine whether to use ANSI color output.
 * @param {{ color?: boolean }} opts
 * @returns {boolean}
 */
export function useColor(opts) {
  if (opts.color === true) return true;
  if (opts.color === false) return false;
  return process.stdout.isTTY;
}

// ---------------------------------------------------------------------------
// Glob pattern matching
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a regular expression.
 * Supports: *, **, ?, {a,b}, [abc], and escape chars.
 * @param {string} pattern
 * @returns {string} regex source string (needs ^...$ wrapping)
 */
export function globToRegex(pattern) {
  let i = 0, len = pattern.length, result = '';
  while (i < len) {
    const ch = pattern[i];
    if (ch === '\\') { result += '\\' + (pattern[i + 1] || ''); i += 2; }
    else if (ch === '*') {
      if (i + 1 < len && pattern[i + 1] === '*') {
        if (i + 2 < len && (pattern[i + 2] === '/' || pattern[i + 2] === '\\')) {
          result += '(.*[/\\\\])?'; i += 3;
        } else { result += '.*'; i += 2; }
      } else { result += '[^/\\\\]*'; i += 1; }
    } else if (ch === '?') { result += '[^/\\\\]'; i += 1; }
    else if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) { result += ch; i += 1; }
      else {
        const alts = pattern.slice(i + 1, end).split(',').map(s => s.trim());
        result += '(' + alts.map(a => a.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end + 1;
      }
    } else if (ch === '[') {
      const end = pattern.indexOf(']', i);
      if (end === -1) { result += '\\' + ch; i += 1; }
      else { result += pattern.slice(i, end + 1); i = end + 1; }
    } else if ('+^$.()|'.includes(ch)) { result += '\\' + ch; i += 1; }
    else { result += ch; i += 1; }
  }
  return `^${result}$`;
}

/**
 * Test whether a string matches a glob pattern.
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
export function matchGlob(pattern, str) {
  try { return new RegExp(globToRegex(pattern)).test(str); }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively find files matching include/exclude glob patterns.
 * @param {string} rootDir
 * @param {string[]} includePatterns glob patterns for inclusion
 * @param {string[]} excludePatterns glob patterns for exclusion
 * @param {object} [opts]
 * @param {boolean} [opts.skipHidden] skip dot-files (default: true)
 * @param {string[]} [opts.skipDirs] directory names to skip (default: ['node_modules'])
 * @returns {string[]} absolute file paths
 */
export function findFiles(rootDir, includePatterns, excludePatterns = [], opts = {}) {
  const skipHidden = opts.skipHidden !== false;
  const skipDirs = opts.skipDirs || ['node_modules'];
  const results = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (skipHidden && entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = relative(rootDir, fullPath);
        if (excludePatterns.some(p => matchGlob(p, rel))) continue;
        if (includePatterns.length === 0 || includePatterns.some(p => matchGlob(p, rel)))
          results.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return results;
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read a file safely, returning null on error.
 * @param {string} path
 * @returns {string | null}
 */
export function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format milliseconds as human-readable string.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}
