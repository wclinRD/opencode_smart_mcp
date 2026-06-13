// embedding-cache.mjs — Persistent embedding cache for smart_grep
//
// Caches code chunk embeddings to .smart/grep-embeddings.json.
// Uses mtime checks to invalidate stale cache entries.
// Avoids re-embedding unchanged files across sessions.
//
// Usage:
//   import { loadCache, saveCache, getCachedOrEmbed } from './embedding-cache.mjs';
//   const cache = loadCache(root);
//   const chunks = getCachedOrEmbed(filePath, mtime, cache, embedder);

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chunkCode } from './semantic-search.mjs';

// ---------------------------------------------------------------------------
// Cache structure
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EmbeddingCache
 * @property {string} version - Cache format version
 * @property {Object<string, CacheEntry>} entries - File path -> cache entry
 */

/**
 * @typedef {Object} CacheEntry
 * @property {string} mtime - ISO timestamp of last modification
 * @property {string} contentHash - SHA-256 of file content (first 16 chars)
 * @property {number} chunkCount - Number of chunks
 * @property {Array<ChunkCache>} chunks - Cached chunk data
 */

/**
 * @typedef {Object} ChunkCache
 * @property {string} text - Chunk text
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} type - Chunk type (function/class/block)
 * @property {string} [name] - Symbol name
 */

const CACHE_VERSION = '1.0.0';
const CACHE_DIR = '.smart';
const CACHE_FILE = 'grep-embeddings.json';

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

/**
 * Load the embedding cache from disk.
 *
 * @param {string} root - Project root directory
 * @returns {EmbeddingCache} Cache object (empty if not found)
 */
export function loadCache(root) {
  const cachePath = join(root, CACHE_DIR, CACHE_FILE);
  try {
    if (!existsSync(cachePath)) return createEmptyCache();
    const raw = readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(raw);
    if (cache.version !== CACHE_VERSION) return createEmptyCache();
    return cache;
  } catch {
    return createEmptyCache();
  }
}

/**
 * Save the embedding cache to disk.
 *
 * @param {string} root - Project root directory
 * @param {EmbeddingCache} cache - Cache object
 */
export function saveCache(root, cache) {
  const cacheDir = join(root, CACHE_DIR);
  const cachePath = join(cacheDir, CACHE_FILE);
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Silently fail — cache is optional
  }
}

function createEmptyCache() {
  return { version: CACHE_VERSION, entries: {} };
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/**
 * Get cached chunks for a file, or compute and cache them.
 * Checks mtime and content hash to determine if cache is valid.
 *
 * @param {string} filePath - Absolute file path
 * @param {string} mtime - ISO timestamp from fs.statSync
 * @param {EmbeddingCache} cache - Current cache object
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh=false] - Force re-chunk even if cache valid
 * @returns {{ chunks: Array, fromCache: boolean }} Chunks and cache status
 */
export function getCachedOrEmbed(filePath, mtime, cache, options = {}) {
  const { forceRefresh = false } = options;
  const entry = cache.entries[filePath];

  // Check if cache is valid
  if (!forceRefresh && entry && entry.mtime === mtime) {
    // Verify content hash if available
    if (entry.contentHash) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const currentHash = hashContent(content);
        if (currentHash === entry.contentHash) {
          return { chunks: entry.chunks || [], fromCache: true };
        }
      } catch {
        // File changed or unreadable — re-chunk
      }
    } else {
      // No content hash — trust mtime
      return { chunks: entry.chunks || [], fromCache: true };
    }
  }

  // Cache miss or invalid — compute chunks
  try {
    const content = readFileSync(filePath, 'utf-8');
    const chunks = chunkCode(content, filePath);
    const contentHash = hashContent(content);

    cache.entries[filePath] = {
      mtime,
      contentHash,
      chunkCount: chunks.length,
      chunks: chunks.map(c => ({
        text: c.text,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        name: c.name || undefined,
      })),
    };

    return { chunks, fromCache: false };
  } catch {
    return { chunks: [], fromCache: false };
  }
}

/**
 * Remove stale entries from cache (files that no longer exist).
 *
 * @param {EmbeddingCache} cache - Cache object
 * @returns {number} Number of entries removed
 */
export function cleanStaleEntries(cache) {
  let removed = 0;
  for (const filePath of Object.keys(cache.entries)) {
    try {
      if (!existsSync(filePath)) {
        delete cache.entries[filePath];
        removed++;
      }
    } catch {
      delete cache.entries[filePath];
      removed++;
    }
  }
  return removed;
}

/**
 * Get cache statistics.
 *
 * @param {EmbeddingCache} cache - Cache object
 * @returns {{ version: string, totalEntries: number, totalChunks: number }}
 */
export function getCacheStats(cache) {
  let totalChunks = 0;
  for (const entry of Object.values(cache.entries)) {
    totalChunks += entry.chunkCount || entry.chunks?.length || 0;
  }
  return {
    version: cache.version,
    totalEntries: Object.keys(cache.entries).length,
    totalChunks,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ---------------------------------------------------------------------------
// Quick test
// ---------------------------------------------------------------------------

function main() {
  const cache = createEmptyCache();
  console.log('Empty cache:', getCacheStats(cache));

  // Test with a real file
  const testFile = process.argv[1]; // this file
  try {
    const st = statSync(testFile);
    const result = getCachedOrEmbed(testFile, st.mtime.toISOString(), cache);
    console.log(`\nFile: ${testFile}`);
    console.log(`  Chunks: ${result.chunks.length}, From cache: ${result.fromCache}`);
    console.log(`  Cache stats:`, getCacheStats(cache));

    // Second call should hit cache
    const result2 = getCachedOrEmbed(testFile, st.mtime.toISOString(), cache);
    console.log(`  Second call — From cache: ${result2.fromCache}`);

    // Clean stale
    const removed = cleanStaleEntries(cache);
    console.log(`  Stale removed: ${removed}`);
  } catch (e) {
    console.error('Test failed:', e.message);
  }
}

if (process.argv[1] && process.argv[1].includes('embedding-cache.mjs')) {
  main();
}