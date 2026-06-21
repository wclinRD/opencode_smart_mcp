// semantic-cache.mjs — Semantic Cache Router (Phase 27)
//
// Embedding-based caching for LLM routing decisions.
// Caches goal→toolChain mappings for fast reuse on similar tasks.
//
// Usage:
//   import { SemanticCache } from './semantic-cache.mjs';
//   const cache = new SemanticCache();
//
//   // Store a cache entry
//   await cache.set('debug login error', ['smart_grep', 'smart_lsp', 'smart_fast_apply']);
//
//   // Look up
//   const results = await cache.get('debug user auth');
//   // => [{ goal, toolChain, score }, ...]

import crypto from 'node:crypto';
import { getMemoryDB } from './memory-db.mjs';

export class SemanticCache {
  /**
   * Cache a goal→toolChain mapping.
   * @param {string} goal
   * @param {string[]} toolChain
   * @param {Float32Array} [embedding]
   */
  async set(goal, toolChain, embedding) {
    try {
      const db = getMemoryDB();
      const emb = embedding || null;
      const embBlob = emb ? Buffer.from(emb.buffer) : null;
      db.cacheGoal(goal, JSON.stringify(toolChain), embBlob);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Look up a goal in the semantic cache.
   * @param {string} goal
   * @param {object} [options]
   * @param {number} [options.threshold=0.85]
   * @returns {Promise<Array<{goal: string, toolChain: string[], score: number}>>}
   */
  async get(goal, options = {}) {
    const { threshold = 0.85 } = options;
    try {
      const db = getMemoryDB();
      const results = db.searchCache(goal, threshold);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Update cache hit/success stats.
   * @param {string} goal
   * @param {boolean} success
   */
  async recordHit(goal, success) {
    try {
      const db = getMemoryDB();
      const hash = this.#quickHash(goal);
      db.updateCacheStats(hash, success);
    } catch {
      // Best-effort
    }
  }

  /**
   * Quick hash for stats lookup.
   * @private
   */
  #quickHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
  }
}
