// ckg-engine.mjs — Code Knowledge Graph Engine
//
// Persistent SQLite-based project code understanding graph.
// Builds nodes (symbols: functions, classes, files, variables, etc.)
// and edges (calls, imports, extends, implements, contains, defines).
//
// Uses Node.js built-in node:sqlite (DatabaseSync) — zero dependencies.
// ⚠ Requires Node >= 26 (node:sqlite added in Node 26). On older Node, skip CKG.
// Builds on LSP bridge from Phase 10 for symbol/reference analysis.
//
// Schema:
//   projects      — project roots + metadata
//   nodes         — code symbols (function/class/file/...)
//   edges         — relationships (calls/imports/extends/...)
//   facts         — additional node properties
//   file_versions — file content tracking for incremental updates
//
// API:
//   class CkgEngine
//     constructor(root, { dbDir, lspBridge } = {})
//     async build()                   — Full project scan
//     async incrementalUpdate(file)   — Single file re-scan
//     async watch(root, {debounceMs, onUpdate})
//     queryCallers(symbol, file, opts)
//     queryCallees(symbol, file, opts)
//     queryDependencies(file)
//     queryUnusedExports()
//     querySymbol(name, file, kind)
//   getCkgEngine(root) — Singleton management

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, basename, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { homedir } from 'node:os';
import { getLspBridge } from './lsp-bridge.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CKG_DIR = resolve(homedir(), '.smart', 'ckg');
const NODE_KINDS = new Set([
  'file', 'module', 'namespace', 'package', 'class', 'method', 'property',
  'field', 'constructor', 'enum', 'interface', 'function', 'variable',
  'constant', 'struct', 'type-parameter',
]);
const EDGE_KINDS = new Set([
  'calls', 'imports', 'extends', 'implements', 'defines', 'parameterOf',
  'returnTypeOf', 'contains',
]);
const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.py', '.pyw', '.swift']);
const STALE_DAYS = 30; // keep stale nodes for 30 days before hard deletion
const DEFAULT_DEPTH = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute MD5 hash of file content */
function hashContent(content) {
  return createHash('md5').update(content, 'utf8').digest('hex');
}

/** Get a stable project ID from root path */
function projectHash(root) {
  return createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16);
}

/** Check if file extension is supported */
function isSupportedFile(file) {
  const ext = extname(file).toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

/** Check if path should be skipped (node_modules, .git, dist, etc.) */
function shouldSkipDir(name) {
  return ['node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    '.smart', '.opencode', '.agents', '__pycache__', '.cache'].includes(name);
}

/** Parse Rust use/mod declarations */
function parseRustImports(content) {
  const imports = [];
  // use statements: use crate::module::Item;  or  use std::collections::HashMap;
  const useRe = /^use\s+([^;]+);/gm;
  let m;
  while ((m = useRe.exec(content)) !== null) {
    const path = m[1].trim();
    // Extract the crate-relative path, convert dots to slashes later
    imports.push({ source: path, type: 'use', raw: m[0].trim() });
  }

  // mod declarations (local modules): mod foo;
  const modRe = /^mod\s+(\w+)\s*;/gm;
  while ((m = modRe.exec(content)) !== null) {
    imports.push({ source: `./${m[1].trim()}`, type: 'mod', raw: m[0].trim() });
  }

  // mod with block: mod foo { ... } — skip these, they're inline
  return imports;
}

/** Parse Python import statements */
function parsePythonImports(content) {
  const imports = [];
  // import X, import X.Y.Z
  const importRe = /^import\s+([\w\s,]+)/gm;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      // Only keep relative-style imports (starts with lowercase or dot)
      const parts = name.split('.');
      if (parts[0] && !parts[0].startsWith('_') && parts[0] === parts[0].toLowerCase()) {
        // Could be stdlib or third-party — skip non-local
        continue;
      }
      // Dot-based relative import
      if (name.startsWith('.')) {
        imports.push({ source: name, type: 'import', raw: m[0].trim() });
      }
    }
  }

  // from X import Y (including relative)
  const fromRe = /^from\s+([.\w]+)\s+import\s+(.+)/gm;
  while ((m = fromRe.exec(content)) !== null) {
    const modulePath = m[1].trim();
    // Only track local imports (starting with .) or project-relative
    if (modulePath.startsWith('.')) {
      imports.push({ source: modulePath, type: 'from-import', raw: m[0].trim() });
    }
    // For non-relative imports, skip (stdlib or third-party)
  }

  return imports;
}

/** Parse Swift import statements */
function parseSwiftImports(content) {
  const imports = [];
  // import statements: import Foundation, import struct Foo.Bar, import class MyClass
  // Use [^\S\n] to stay on same line (no newline crossing)
  const importRe = /^import[^\S\n]+(?:(\w+)[^\S\n]+)?(\w+(?:\.\w+)*)/gm;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const modulePath = m[2];
    imports.push({ source: modulePath, type: 'import', raw: m[0].trim() });
  }

  // @_exported import (re-export)
  const exportRe = /@_exported[^\S\n]+import[^\S\n]+(?:(\w+)[^\S\n]+)?(\w+(?:\.\w+)*)/gm;
  while ((m = exportRe.exec(content)) !== null) {
    imports.push({ source: m[2], type: 'reexport', raw: m[0].trim() });
  }

  return imports;
}

/** Parse import statements from file content (JS/TS) */
function parseJsImports(content) {
  const imports = [];

  // ES module imports: import ... from '...'
  const esmRe = /import\s+(?:\s*\{[^}]*\}\s*|\s*\*\s*as\s+\w+\s*|\s*\w+\s*(?:,\s*\{[^}]*\})?\s*)?from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = esmRe.exec(content)) !== null) {
    imports.push({ source: m[1].trim(), type: 'esm', raw: m[0].trim() });
  }

  // Dynamic import()
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRe.exec(content)) !== null) {
    imports.push({ source: m[1].trim(), type: 'dynamic', raw: m[0].trim() });
  }

  // require()
  const requireRe = /(?:const|let|var|import)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(content)) !== null) {
    imports.push({ source: m[1].trim(), type: 'require', raw: m[0].trim() });
  }

  // export ... from '...'
  const exportRe = /export\s+(?:\{[^}]*\}|\*\s+from)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = exportRe.exec(content)) !== null) {
    imports.push({ source: m[1].trim(), type: 'reexport', raw: m[0].trim() });
  }

  return imports;
}

/** Parse imports based on file extension */
function parseImports(content, filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.rs') return parseRustImports(content);
  if (ext === '.py' || ext === '.pyw') return parsePythonImports(content);
  if (ext === '.swift') return parseSwiftImports(content);
  return parseJsImports(content);
}

/** Resolve import source to an actual file path */
function resolveImportSource(source, importerFile, projectRoot) {
  if (!source.startsWith('.') && !source.startsWith('/')) {
    return null; // bare specifier (npm/crate/module) — skip
  }
  const dir = dirname(resolve(projectRoot, importerFile));
  const ext = extname(importerFile).toLowerCase();

  // Try exact, then extension candidates based on language
  const candidates = [resolve(dir, source)];

  if (ext === '.rs') {
    // Rust: .rs extension + mod.rs pattern
    candidates.push(
      resolve(dir, source + '.rs'),
      resolve(dir, source, 'mod.rs'),
    );
  } else if (ext === '.swift') {
    // Swift: .swift extension only
    candidates.push(
      resolve(dir, source + '.swift'),
    );
  } else if (ext === '.py' || ext === '.pyw') {
    // Python: .py extension + __init__.py pattern (dots → path)
    const pySource = source.replace(/\./g, '/');
    candidates.push(
      resolve(dir, pySource + '.py'),
      resolve(dir, pySource, '__init__.py'),
    );
  } else {
    // JS/TS: try extensions + index files
    candidates.push(
      resolve(dir, source + '.ts'),
      resolve(dir, source + '.tsx'),
      resolve(dir, source + '.js'),
      resolve(dir, source + '.mjs'),
      resolve(dir, source + '.cjs'),
      resolve(dir, source, 'index.ts'),
      resolve(dir, source, 'index.tsx'),
      resolve(dir, source, 'index.js'),
      resolve(dir, source, 'index.mjs'),
    );
  }
  for (const c of candidates) {
    if (existsSync(c) && isSupportedFile(c)) {
      return relative(projectRoot, c);
    }
  }
  return null; // couldn't resolve
}

// ---------------------------------------------------------------------------
// LRU Cache (same pattern as LSP bridge)
// ---------------------------------------------------------------------------
class QueryCache {
  constructor(maxSize = 500, ttlMs = 60_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this._map = new Map();
  }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    if (this._map.size >= this.maxSize) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, { value, ts: Date.now() });
  }
  invalidate(key) { this._map.delete(key); }
  clear() { this._map.clear(); }
}

// ---------------------------------------------------------------------------
// CkgEngine
// ---------------------------------------------------------------------------
export class CkgEngine {
  /**
   * @param {string} projectRoot - Absolute path to project root
   * @param {object} [opts]
   * @param {string} [opts.dbDir] - Directory for SQLite DB (default: ~/.smart/ckg/)
   * @param {object} [opts.lspBridge] - Shared LspBridge instance
   */
  constructor(projectRoot, opts = {}) {
    this.projectRoot = resolve(projectRoot || '.');
    this._dbDir = opts.dbDir || CKG_DIR;
    this._bridge = opts.lspBridge || null; // lazy-init
    // Configurable cache: env CKG_CACHE_SIZE (default 5000), CKG_CACHE_AGE ms (default 60000)
    const cacheSize = parseInt(process.env.CKG_CACHE_SIZE || '5000', 10);
    const cacheAge  = parseInt(process.env.CKG_CACHE_AGE  || '60000', 10);
    this._cache = new QueryCache(cacheSize, cacheAge);
    this._db = null;
    this._projectId = null;
    this._buildInProgress = false;
    this._watchers = [];
  }

  // -----------------------------------------------------------------------
  // Database lifecycle
  // -----------------------------------------------------------------------

  /** Get database instance (open if needed) */
  _getDb() {
    if (this._db) return this._db;
    mkdirSync(this._dbDir, { recursive: true });
    const dbPath = resolve(this._dbDir, `${projectHash(this.projectRoot)}.db`);
    this._db = new DatabaseSync(dbPath);
    this._db.exec('PRAGMA journal_mode=WAL');
    this._db.exec('PRAGMA synchronous=NORMAL');
    this._db.exec('PRAGMA foreign_keys=ON');
    this._ensureSchema();
    this._ensureProject();
    return this._db;
  }

  /** Create tables if they don't exist */
  _ensureSchema() {
    const db = this._db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL UNIQUE,
        name TEXT,
        language TEXT DEFAULT 'typescript',
        file_count INTEGER DEFAULT 0,
        node_count INTEGER DEFAULT 0,
        edge_count INTEGER DEFAULT 0,
        built_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file TEXT NOT NULL,
        range_start_line INTEGER,
        range_start_col INTEGER,
        range_end_line INTEGER,
        range_end_col INTEGER,
        signature TEXT,
        exported INTEGER DEFAULT 0,
        stale INTEGER DEFAULT 0,
        stale_reason TEXT,
        content_hash TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        metadata TEXT,
        stale INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (from_node_id) REFERENCES nodes(id),
        FOREIGN KEY (to_node_id) REFERENCES nodes(id)
      );

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (node_id) REFERENCES nodes(id)
      );

      CREATE TABLE IF NOT EXISTS file_versions (
        file TEXT NOT NULL,
        project_id INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        node_count INTEGER DEFAULT 0,
        scanned_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (file, project_id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      -- Indices
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_stale ON nodes(stale);
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
      CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
      CREATE INDEX IF NOT EXISTS idx_facts_node ON facts(node_id);

      -- Full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name, signature, file,
        content='nodes', content_rowid='id',
        tokenize='unicode61'
      );
    `);
  }

  /** Ensure project record exists */
  _ensureProject() {
    const db = this._db;
    const root = this.projectRoot;
    const name = basename(root);
    let row = db.prepare('SELECT id FROM projects WHERE root = ?').get(root);
    if (!row) {
      db.prepare('INSERT INTO projects (root, name) VALUES (?, ?)').run(root, name);
      row = db.prepare('SELECT id FROM projects WHERE root = ?').get(root);
    }
    this._projectId = row.id;
  }

  // -----------------------------------------------------------------------
  // LSP bridge access
  // -----------------------------------------------------------------------

  _getBridge() {
    if (!this._bridge) {
      this._bridge = getLspBridge(this.projectRoot);
    }
    return this._bridge;
  }

  // -----------------------------------------------------------------------
  // Build — Full project scan
  // -----------------------------------------------------------------------

  /**
   * Full project build: find all supported files, analyze symbols and edges.
   * Skips files whose content hash hasn't changed.
   * @param {object} [opts]
   * @param {boolean} [opts.force=false] - Force rebuild all files
   * @param {function} [opts.onProgress] - Progress callback (file, index, total)
   * @returns {Promise<{files: number, nodes: number, edges: number, duration: string}>}
   */
  /** Build CKG from scratch for the entire project */
  async build(opts = {}) {
    const startTime = Date.now();
    this._buildInProgress = true;
    const db = this._getDb();
    const bridge = this._getBridge();
    const force = opts.force === true;
    const buildReferences = opts.buildReferences === true;
    const onProgress = opts.onProgress || (() => {});

    // Find all supported files (or use provided list)
    const allFiles = opts.files || this._findProjectFiles();
    const totalFiles = allFiles.length;
    let totalNodes = 0;
    let totalEdges = 0;
    let scannedCount = 0;

    // Pre-mark all nodes as stale (will unmark as we scan)
    // This handles deleted files automatically
    if (force) {
      db.prepare('UPDATE nodes SET stale = 1 WHERE project_id = ?').run(this._projectId);
      db.prepare('UPDATE edges SET stale = 1 WHERE project_id = ?').run(this._projectId);
    }

    // Concurrency config
    // When buildReferences is true, force serial processing (concurrency=1)
    // to avoid LSP race: cross-file references need prior files indexed first.
    const rawConcurrency = parseInt(process.env.CKG_BUILD_CONCURRENCY || '20', 10);
    const CONCURRENCY = buildReferences ? 1 : Math.max(1, rawConcurrency);

    // Process files in concurrent chunks (improves throughput by overlapping LSP wait times)
    for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
      const chunk = allFiles.slice(i, i + CONCURRENCY);
      const chunkEnd = Math.min(i + CONCURRENCY, totalFiles);
      onProgress(chunk[0], chunkEnd, totalFiles);

      const chunkResults = await Promise.all(
        chunk.map(file => this._processSingleFileBuild(file, db, bridge, force, buildReferences))
      );

      for (const r of chunkResults) {
        if (!r) continue;
        scannedCount += r.scanned ? 1 : 0;
        totalNodes += r.nodes || 0;
        totalEdges += r.edges || 0;
      }
    }

    // Clean up stale nodes older than STALE_DAYS
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'DELETE FROM nodes WHERE project_id = ? AND stale = 1 AND updated_at < ?'
    ).run(this._projectId, staleCutoff);
    db.prepare(
      'DELETE FROM edges WHERE id IN (SELECT e.id FROM edges e JOIN nodes n ON e.from_node_id = n.id WHERE n.project_id = ? AND n.stale = 1)'
    ).run(this._projectId);

    // Update project stats
    const nodeCount = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ? AND stale = 0').get(this._projectId).c;
    const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges e JOIN nodes n ON e.from_node_id = n.id WHERE n.project_id = ? AND n.stale = 0').get(this._projectId).c;
    db.prepare(
      'UPDATE projects SET file_count = ?, node_count = ?, edge_count = ?, built_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?'
    ).run(totalFiles, nodeCount, edgeCount, this._projectId);

    this._buildInProgress = false;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      files: totalFiles,
      scanned: scannedCount,
      nodes: nodeCount,
      edges: edgeCount,
      duration: `${duration}s`,
    };
  }

  /**
   * Process a single file during build: read + LSP + transaction-batched SQL.
   * Designed for concurrent execution with multiple files.
   *
   * Phases:
   *   1. Read file + hash (sync, fast)
   *   2. LSP getSymbols (async, bottleneck — shared across concurrent files)
   *   3. LSP getReferences if buildReferences (async, outside transaction)
   *   4. All SQL wrapped in single db.transaction() for atomic per-file commit
   */
  async _processSingleFileBuild(file, db, bridge, force, buildReferences) {
    const absPath = resolve(this.projectRoot, file);

    // Phase 1: Read file + hash (sync, fast)
    let content;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      return null; // file may have been deleted
    }
    const hash = hashContent(content);

    // Phase 2: LSP document symbols (async, main bottleneck)
    let symbols = [];
    try {
      const symResult = await bridge.getSymbols(file);
      symbols = symResult.symbols || [];
    } catch {
      return null; // LSP may fail for some files
    }

    // Phase 3 (optional): Pre-fetch references via LSP (async, outside tx)
    let refData = [];
    if (buildReferences) {
      const functionNodes = symbols.filter(s =>
        s.kind === 'function' || s.kind === 'method' || s.kind === 'class'
      );
      for (const sym of functionNodes) {
        try {
          const refResult = await bridge.getReferences(file, sym.line, sym.col || 0);
          const refs = (refResult.references || [])
            .filter(ref => relative(this.projectRoot, ref.file) !== file);
          refData.push({ sym, refs });
        } catch {
          // skip symbol if LSP reference lookup fails
        }
      }
    }

    // Phase 4: All SQL in single explicit transaction (sync, atomic per file)
    // node:sqlite has no db.transaction() — use manual SAVEPOINT for safety
    db.exec('SAVEPOINT file_tx');
    try {
      // Check if unchanged (skip if same hash, unless force rebuild)
      if (!force) {
        const existing = db.prepare(
          'SELECT content_hash FROM file_versions WHERE file = ? AND project_id = ?'
        ).get(file, this._projectId);
        if (existing && existing.content_hash === hash) {
          db.prepare('UPDATE nodes SET stale = 0 WHERE project_id = ? AND file = ?').run(this._projectId, file);
          db.exec('RELEASE file_tx');
          return { scanned: true, nodes: 0, edges: 0 };
        }
      }

      // Remove old data for this file (FK-safe order)
      db.prepare('DELETE FROM edges WHERE from_node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
      db.prepare('DELETE FROM edges WHERE to_node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
      db.prepare('DELETE FROM facts WHERE node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
      db.prepare('DELETE FROM nodes WHERE project_id = ? AND file = ?').run(this._projectId, file);
      db.prepare('DELETE FROM file_versions WHERE file = ? AND project_id = ?').run(file, this._projectId);

      // Create nodes for this file's symbols
      const nodeIds = this._createFileNodes(file, symbols, hash);
      let edgeCount = 0;

      // Parse imports and create import edges
      const imports = parseImports(content, file);
      for (const imp of imports) {
        const targetFile = resolveImportSource(imp.source, file, this.projectRoot);
        if (targetFile && targetFile !== file) {
          let targetNode = db.prepare(
            'SELECT id FROM nodes WHERE project_id = ? AND file = ? AND kind = ? LIMIT 1'
          ).get(this._projectId, targetFile, 'file');
          if (!targetNode) {
            const r = db.prepare(
              'INSERT INTO nodes (project_id, name, kind, file, exported, stale, content_hash) VALUES (?, ?, ?, ?, ?, 0, ?)'
            ).run(this._projectId, basename(targetFile), 'file', targetFile, 1, '');
            targetNode = { id: Number(r.lastInsertRowid) };
          }
          if (targetNode && nodeIds.fileNodeId) {
            db.prepare(
              'INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, ?, ?)'
            ).run(this._projectId, nodeIds.fileNodeId, targetNode.id, 'imports',
              JSON.stringify({ source: imp.source, type: imp.type }));
            edgeCount++;
          }
        }
      }

      // Insert pre-fetched reference edges
      // Direction: caller → callee-definition
      // (queryCallers/queryUsagePatterns query WHERE to_node_id = ? AND kind = 'calls')
      // Resolves caller to the containing function node (not just file node)
      // for actionable refactoring plans.
      for (const { sym, refs } of refData) {
        const defNode = db.prepare(
          'SELECT id FROM nodes WHERE project_id = ? AND file = ? AND name = ? AND kind = ? AND stale = 0 LIMIT 1'
        ).get(this._projectId, file, sym.name, sym.kind);
        if (!defNode) continue;

        for (const ref of refs) {
          const refRel = relative(this.projectRoot, ref.file);
          if (refRel === file) continue;
          const refLine = ref.line;

          // Find containing function node in caller file (range-based)
          // Uses range_start_line <= refLine and end_line >= refLine (or unknown)
          let callerNode = db.prepare(
            `SELECT id, name, kind FROM nodes
             WHERE project_id = ? AND file = ? AND stale = 0
               AND kind IN ('function','method','class','constructor')
               AND range_start_line IS NOT NULL AND range_start_line <= ?
               AND (range_end_line IS NULL OR range_end_line >= ?)
             ORDER BY range_start_line DESC
             LIMIT 1`
          ).get(this._projectId, refRel, refLine, refLine);

          // Fallback: file-level node if no containing function found
          if (!callerNode) {
            callerNode = db.prepare(
              'SELECT id, name, kind FROM nodes WHERE project_id = ? AND file = ? AND kind = ? LIMIT 1'
            ).get(this._projectId, refRel, 'file');
          }
          if (!callerNode) {
            const r = db.prepare(
              'INSERT INTO nodes (project_id, name, kind, file, exported, stale, content_hash) VALUES (?, ?, ?, ?, ?, 0, ?)'
            ).run(this._projectId, basename(refRel), 'file', refRel, 1, '');
            callerNode = { id: Number(r.lastInsertRowid), name: basename(refRel), kind: 'file' };
          }
          db.prepare(
            'INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, ?, ?)'
          ).run(this._projectId, callerNode.id, defNode.id, 'calls',
            JSON.stringify({ file: refRel, line: refLine, col: ref.col, callerName: callerNode.name, callerKind: callerNode.kind }));
          edgeCount++;
        }
      }

      // Update file version
      db.prepare(
        'INSERT OR REPLACE INTO file_versions (file, project_id, content_hash, node_count) VALUES (?, ?, ?, ?)'
      ).run(file, this._projectId, hash, nodeIds.length);

      db.exec('RELEASE file_tx');
      return { scanned: true, nodes: nodeIds.length, edges: edgeCount };
    } catch (txErr) {
      // Rollback on error — file-level isolation preserved
      db.exec('ROLLBACK TO file_tx');
      return null;
    }
  }

  /** Find all supported project files */
  _findProjectFiles() {
    const results = [];
    const walkDir = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (shouldSkipDir(entry.name)) continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const relPath = relative(this.projectRoot, fullPath);
          if (isSupportedFile(fullPath)) {
            results.push(relPath);
          }
        }
      }
    };
    walkDir(this.projectRoot);
    return results;
  }

  /** Create nodes for all symbols in a file, return created node IDs */
  _createFileNodes(file, symbols, contentHash) {
    const db = this._getDb();
    const projectId = this._projectId;
    const now = new Date().toISOString();
    const nodeIds = [];
    let fileNodeId = null;

    // Create file node first
    const fileStmt = db.prepare(
      'INSERT INTO nodes (project_id, name, kind, file, exported, stale, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)'
    );
    const fileResult = fileStmt.run(projectId, basename(file), 'file', file, 1, contentHash, now, now);
    fileNodeId = Number(fileResult.lastInsertRowid);
    nodeIds.fileNodeId = fileNodeId;

    // Create symbol nodes
    const symStmt = db.prepare(
      `INSERT INTO nodes (project_id, name, kind, file, range_start_line, range_start_col,
        range_end_line, range_end_col, signature, exported, stale, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    );

    const walkSymbols = (symbols, parentId = null) => {
      for (const sym of symbols) {
        const symResult = symStmt.run(
          projectId, sym.name, sym.kind, file,
          sym.line || null, sym.col || null,
          sym.end_line || null, sym.end_col || null,
          sym.signature || sym.name,
          sym.kind === 'function' || sym.kind === 'class' ? 1 : 0,
          contentHash, now, now
        );
        const nodeId = Number(symResult.lastInsertRowid);

        nodeIds.push(nodeId);

        // Create "contains" edge from file to this symbol
        if (fileNodeId) {
          db.prepare(
            'INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, ?, ?)'
          ).run(projectId, fileNodeId, nodeId, 'contains',
            JSON.stringify({ line: sym.line, kind: sym.kind }));
        }

        // If this symbol has a parent, create contains edge
        if (parentId) {
          db.prepare(
            'INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, ?, ?)'
          ).run(projectId, parentId, nodeId, 'contains',
            JSON.stringify({ line: sym.line }));
        }

        if (sym.children) {
          walkSymbols(sym.children, nodeId);
        }
      }
    };
    walkSymbols(symbols);

    return nodeIds;
  }

  // -----------------------------------------------------------------------
  // Incremental update — single file re-analysis
  // -----------------------------------------------------------------------

  /**
   * Re-analyze a single file. Removes old nodes/edges for this file,
   * re-scans with LSP, recreates nodes and edges.
   * @param {string} file - File path (relative to project root)
   * @returns {Promise<{updated: boolean, nodes: number, edges: number}>}
   */
  async incrementalUpdate(file) {
    const db = this._getDb();
    const bridge = this._getBridge();
    const absPath = resolve(this.projectRoot, file);

    if (!existsSync(absPath)) {
      // File was deleted — mark nodes as stale
      db.prepare('UPDATE nodes SET stale = 1, stale_reason = ? WHERE project_id = ? AND file = ?')
        .run('file deleted', this._projectId, file);
      db.prepare('DELETE FROM file_versions WHERE file = ? AND project_id = ?').run(file, this._projectId);
      return { updated: true, nodes: 0, edges: 0 };
    }

    if (!isSupportedFile(file)) {
      return { updated: false, nodes: 0, edges: 0 };
    }

    // Read file
    let content;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      return { updated: false, nodes: 0, edges: 0 };
    }
    const hash = hashContent(content);

    // Check if actually changed
    const existing = db.prepare(
      'SELECT content_hash FROM file_versions WHERE file = ? AND project_id = ?'
    ).get(file, this._projectId);
    if (existing && existing.content_hash === hash) {
      return { updated: false, nodes: 0, edges: 0 };
    }

    // Remove old data for this file (edges first to avoid FK constraints)
    db.prepare('DELETE FROM edges WHERE from_node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
    db.prepare('DELETE FROM edges WHERE to_node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
    db.prepare('DELETE FROM facts WHERE node_id IN (SELECT id FROM nodes WHERE project_id = ? AND file = ?)').run(this._projectId, file);
    db.prepare('DELETE FROM nodes WHERE project_id = ? AND file = ?').run(this._projectId, file);
    db.prepare('DELETE FROM file_versions WHERE file = ? AND project_id = ?').run(file, this._projectId);

    // Get symbols from LSP
    let symbols = [];
    try {
      const symResult = await bridge.getSymbols(file);
      symbols = symResult.symbols || [];
    } catch {
      return { updated: true, nodes: 0, edges: 0 };
    }

    // Create nodes
    const nodeIds = this._createFileNodes(file, symbols, hash);

    // Parse imports and create edges
    const imports = parseImports(content, file);
    let edgeCount = 0;
    for (const imp of imports) {
      const targetFile = resolveImportSource(imp.source, file, this.projectRoot);
      if (targetFile && targetFile !== file && nodeIds.fileNodeId) {
        let targetNode = db.prepare(
          'SELECT id FROM nodes WHERE project_id = ? AND file = ? AND kind = ? LIMIT 1'
        ).get(this._projectId, targetFile, 'file');
        if (!targetNode) {
          const r = db.prepare(
            'INSERT INTO nodes (project_id, name, kind, file, exported, stale, content_hash) VALUES (?, ?, ?, ?, ?, 0, ?)'
          ).run(this._projectId, basename(targetFile), 'file', targetFile, 1, '');
          targetNode = { id: Number(r.lastInsertRowid) };
        }
        if (targetNode) {
          db.prepare(
            'INSERT INTO edges (project_id, from_node_id, to_node_id, kind, metadata) VALUES (?, ?, ?, ?, ?)'
          ).run(this._projectId, nodeIds.fileNodeId, targetNode.id, 'imports',
            JSON.stringify({ source: imp.source, type: imp.type }));
          edgeCount++;
        }
      }
    }

    // Update file version
    db.prepare(
      'INSERT OR REPLACE INTO file_versions (file, project_id, content_hash, node_count) VALUES (?, ?, ?, ?)'
    ).run(file, this._projectId, hash, nodeIds.length);

    // Update project stats
    const nodeCount = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ? AND stale = 0').get(this._projectId).c;
    const totalEdgeCount = db.prepare(
      'SELECT COUNT(*) as c FROM edges e JOIN nodes n ON e.from_node_id = n.id WHERE n.project_id = ? AND n.stale = 0'
    ).get(this._projectId).c;
    db.prepare(
      'UPDATE projects SET node_count = ?, edge_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(nodeCount, totalEdgeCount, this._projectId);

    // Invalidate relevant cache entries
    this._cache.clear();

    return { updated: true, nodes: nodeIds.length, edges: edgeCount };
  }

  // -----------------------------------------------------------------------
  // File watching
  // -----------------------------------------------------------------------

  /**
   * Watch project files for changes and auto-update CKG.
   * @param {string} root - Project root to watch
   * @param {object} [opts]
   * @param {number} [opts.debounceMs=500] - Debounce delay
   * @param {function} [opts.onUpdate] - Callback on update (result)
   * @returns {() => void} - Unwatch function
   */
  watch(root, opts = {}) {
    const debounceMs = opts.debounceMs || 500;
    const onUpdate = opts.onUpdate || (() => {});
    const pending = new Map();

    const doUpdate = async (filePath) => {
      const relPath = relative(this.projectRoot, filePath);
      if (!isSupportedFile(relPath) || shouldSkipDir(basename(dirname(relPath)))) return;
      try {
        const result = await this.incrementalUpdate(relPath);
        if (result.updated) {
          onUpdate(result);
        }
      } catch (err) {
        // silent — LSP might not be ready
      }
    };

    const watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Debounce
      if (pending.has(filename)) clearTimeout(pending.get(filename));
      pending.set(filename, setTimeout(() => {
        pending.delete(filename);
        doUpdate(filename);
      }, debounceMs));
    });

    this._watchers.push(watcher);
    return () => {
      watcher.close();
      const idx = this._watchers.indexOf(watcher);
      if (idx >= 0) this._watchers.splice(idx, 1);
    };
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Query callers of a symbol.
   * @param {string} symbol - Symbol name (function/class/variable)
   * @param {string} file - File containing the symbol
   * @param {object} [opts]
   * @param {number} [opts.depth=2] - Recursion depth
   * @param {boolean} [opts.includeStale=false]
   * @returns {object} Call chain
   */
  queryCallers(symbol, file, opts = {}) {
    const db = this._getDb();
    const depth = opts.depth || DEFAULT_DEPTH;
    const staleFilter = opts.includeStale ? '' : 'AND n.stale = 0';

    const cacheKey = `callers:${file}:${symbol}:${depth}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    // Find node by name + file
    const node = db.prepare(
      `SELECT id, name, kind, file, range_start_line as line, signature FROM nodes n
       WHERE n.project_id = ? AND n.name = ? AND n.file = ? ${staleFilter}
       LIMIT 1`
    ).get(this._projectId, symbol, file);

    if (!node) {
      const result = { root: { symbol, file }, callers: [], depth, totalCallers: 0 };
      this._cache.set(cacheKey, result);
      return result;
    }

    // Get direct callers (edges where this node is the target)
    const callers = db.prepare(
      `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
       FROM edges e
       JOIN nodes n ON e.from_node_id = n.id
       WHERE e.to_node_id = ? AND e.kind = 'calls' ${staleFilter}
       ORDER BY n.file, n.name`
    ).all(node.id);

    // Recursive caller tracking for depth > 1
    const getCallerChain = (nodeId, currentDepth) => {
      if (currentDepth >= depth) return [];
      const deeper = db.prepare(
        `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
         FROM edges e
         JOIN nodes n ON e.from_node_id = n.id
         WHERE e.to_node_id = ? AND e.kind = 'calls' ${staleFilter}
         ORDER BY n.file, n.name`
      ).all(nodeId);
      return deeper.map(c => ({
        ...c,
        callers: getCallerChain(c.id, currentDepth + 1),
      }));
    };

    const enriched = callers.map(c => ({
      ...c,
      callers: getCallerChain(c.id, 1),
    }));

    const result = {
      root: { symbol, file, line: node.line, signature: node.signature },
      callers: enriched,
      depth,
      totalCallers: callers.length,
    };

    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Query callees of a symbol (what does this function call).
   * @param {string} symbol - Symbol name
   * @param {string} file - File containing the symbol
   * @param {object} [opts]
   * @param {number} [opts.depth=2]
   * @param {boolean} [opts.includeStale=false]
   * @returns {object} Callee chain
   */
  queryCallees(symbol, file, opts = {}) {
    const db = this._getDb();
    const depth = opts.depth || DEFAULT_DEPTH;
    const staleFilter = opts.includeStale ? '' : 'AND n.stale = 0';

    const cacheKey = `callees:${file}:${symbol}:${depth}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const node = db.prepare(
      `SELECT id, name, kind, file, range_start_line as line, signature FROM nodes n
       WHERE n.project_id = ? AND n.name = ? AND n.file = ? ${staleFilter}
       LIMIT 1`
    ).get(this._projectId, symbol, file);

    if (!node) {
      const result = { root: { symbol, file }, callees: [], depth, totalCallees: 0 };
      this._cache.set(cacheKey, result);
      return result;
    }

    const callees = db.prepare(
      `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
       FROM edges e
       JOIN nodes n ON e.to_node_id = n.id
       WHERE e.from_node_id = ? AND e.kind = 'calls' ${staleFilter}
       ORDER BY n.file, n.name`
    ).all(node.id);

    const getCalleeChain = (nodeId, currentDepth) => {
      if (currentDepth >= depth) return [];
      const deeper = db.prepare(
        `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
         FROM edges e
         JOIN nodes n ON e.to_node_id = n.id
         WHERE e.from_node_id = ? AND e.kind = 'calls' ${staleFilter}
         ORDER BY n.file, n.name`
      ).all(nodeId);
      return deeper.map(c => ({
        ...c,
        callees: getCalleeChain(c.id, currentDepth + 1),
      }));
    };

    const enriched = callees.map(c => ({
      ...c,
      callees: getCalleeChain(c.id, 1),
    }));

    const result = {
      root: { symbol, file, line: node.line, signature: node.signature },
      callees: enriched,
      depth,
      totalCallees: callees.length,
    };

    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Analyze usage patterns of an API across the codebase.
   * Finds all callers and classifies each into a usage pattern type.
   *
   * Pattern types:
   *   direct-call     — simple function/method call
   *   event-handler   — called from on* / handle* function
   *   class-method    — called from a class method
   *   module-init     — called at module top-level / init scope
   *   factory         — called from a function that creates/returns objects
   *   property-access — accessed as property (obj.api)
   *
   * @param {string} symbol - API symbol name
   * @param {string} file - File containing the API definition
   * @param {object} [opts]
   * @param {boolean} [opts.includeStale=false]
   * @returns {object} { symbol, file, totalUsages, patterns, usages }
   */
  queryUsagePatterns(symbol, file, opts = {}) {
    const db = this._getDb();
    const staleFilter = opts.includeStale ? '' : 'AND n.stale = 0';

    const cacheKey = `patterns:${file}:${symbol}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    // Find API node
    const apiNode = db.prepare(
      `SELECT id, name, kind, file, range_start_line as line, signature FROM nodes n
       WHERE n.project_id = ? AND n.name = ? AND n.file = ? ${staleFilter}
       LIMIT 1`
    ).get(this._projectId, symbol, file);

    if (!apiNode) {
      const result = { symbol, file, totalUsages: 0, patterns: [], inducedPatterns: [], usages: [] };
      this._cache.set(cacheKey, result);
      return result;
    }

    // Get all callers WITH edge metadata (contains reference line for source-level analysis)
    const callerRows = db.prepare(
      `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature,
              e.metadata
       FROM edges e
       JOIN nodes n ON e.from_node_id = n.id
       WHERE e.to_node_id = ? AND e.kind = 'calls' ${staleFilter}
       ORDER BY n.file, n.name`
    ).all(apiNode.id);

    if (callerRows.length === 0) {
      // No direct callers — check for property access patterns
      // (e.g., obj.method where 'method' is the symbol)
      const propUsages = db.prepare(
        `SELECT DISTINCT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
         FROM edges e
         JOIN nodes n ON e.from_node_id = n.id
         WHERE e.to_node_id = ? AND e.kind = 'contains' ${staleFilter}
           AND (n.kind = 'property' OR n.kind = 'field')
         ORDER BY n.file, n.name`
      ).all(apiNode.id);

      if (propUsages.length === 0) {
        const result = { symbol, file, totalUsages: 0, patterns: [], inducedPatterns: [], usages: [] };
        this._cache.set(cacheKey, result);
        return result;
      }

      // Property access usages
      const usages = propUsages.map(pu => ({
        caller: { name: pu.name, kind: pu.kind, file: pu.file, line: pu.line, signature: pu.signature || '' },
        pattern: 'property-access',
        confidence: 0.7,
      }));

      const result = {
        symbol,
        file,
        totalUsages: usages.length,
        patterns: [{ type: 'property-access', count: usages.length, description: 'Accessed as property/member' }],
        inducedPatterns: [],
        usages,
      };
      this._cache.set(cacheKey, result);
      return result;
    }

    // Build pattern classification for each caller
    const usages = [];
    const patternCounts = {};

    for (const caller of callerRows) {
      let pattern = 'direct-call';

      // Parse edge metadata to get the exact reference line
      let refLine = null;
      try {
        const meta = JSON.parse(caller.metadata || '{}');
        refLine = meta.line || null;
      } catch { /* ignore malformed metadata */ }

      // Determine the wrapper/context around this caller
      const container = db.prepare(
        `SELECT n.name, n.kind FROM edges e
         JOIN nodes n ON e.from_node_id = n.id
         WHERE e.to_node_id = ? AND e.kind = 'contains' AND n.stale = 0
         LIMIT 1`
      ).get(caller.id);

      const callerName = caller.name || '';
      const callerKind = caller.kind || '';

      // ---- Pattern classification (priority-ordered) ----

      // 1. Event-listener: target used as callback argument
      //    e.g. `emitter.on('click', targetFn)` or `button.addEventListener('click', handler)`
      if (refLine) {
        const contextText = this._readSourceContext(caller.file, refLine, 2);
        if (contextText) {
          const listenerPattern = /\.\s*(on|addEventListener|subscribe|listen|watch|observe)\s*\(/;
          if (listenerPattern.test(contextText) && new RegExp(`\\b${this._escapeRegex(symbol)}\\b`).test(contextText)) {
            pattern = 'event-listener';
          }
        }
      }

      // 2. Class method
      if (pattern === 'direct-call') {
        if (callerKind === 'method' || (container && container.kind === 'class')) {
          pattern = 'class-method';
        }
      }

      // 3. Event handler (caller is handler, target is called within)
      if (pattern === 'direct-call') {
        if (/^(on|handle|before|after|_on|_handle)/i.test(callerName)) {
          pattern = 'event-handler';
        }
      }

      // 4. Factory (caller creates things)
      if (pattern === 'direct-call') {
        if (/^(create|build|make|factory|construct|new)/i.test(callerName)) {
          pattern = 'factory';
        }
      }

      // 5. Module init
      if (pattern === 'direct-call') {
        if (callerKind === 'constant' || callerKind === 'variable' || callerKind === 'file' || callerKind === 'module') {
          const calledInInit = db.prepare(
            `SELECT COUNT(*) as cnt FROM edges e
             JOIN nodes n ON e.from_node_id = n.id
             WHERE e.to_node_id = ? AND (n.kind = 'module' OR n.kind = 'file')
             ${staleFilter}`
          ).get(caller.id);
          if (calledInInit && calledInInit.cnt > 0) {
            pattern = 'module-init';
          }
        }
      }

      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;

      usages.push({
        caller: {
          name: callerName,
          kind: callerKind,
          file: caller.file,
          line: caller.line,
          signature: caller.signature || '',
          container: container ? { name: container.name, kind: container.kind } : null,
        },
        pattern,
        confidence: pattern === 'direct-call' ? 0.6 : 0.8,
      });
    }

    // ---- Induced patterns: higher-level patterns derived from aggregate data ----
    const inducedPatterns = [];

    // 1. If >50% of usages are event-listener, induce that the symbol IS an event listener
    const listenerCount = patternCounts['event-listener'] || 0;
    if (listenerCount > 0 && listenerCount / usages.length >= 0.5) {
      inducedPatterns.push({
        type: 'event-listener',
        confidence: +(listenerCount / usages.length).toFixed(2),
        description: `Primarily used as event listener/callback (${listenerCount}/${usages.length} usages)`,
      });
    }

    // 2. Factory return type inference
    if (/^(create|build|make|factory|construct|new)/i.test(symbol)) {
      const returnType = this._inferReturnType(apiNode.signature);
      inducedPatterns.push({
        type: 'factory',
        confidence: 0.7,
        returnType: returnType || null,
        description: `Factory function${returnType ? ` (creates \`${returnType}\`)` : ''}`,
      });
    }

    // 3. Utility/helper induction: many callers across diverse patterns
    if (usages.length >= 3) {
      const uniqueCallers = new Set(usages.map(u => u.caller.name)).size;
      if (uniqueCallers >= 3 && Object.keys(patternCounts).length >= 2) {
        inducedPatterns.push({
          type: 'utility',
          confidence: 0.6,
          description: `General utility/helper — used by ${uniqueCallers} different callers across ${Object.keys(patternCounts).length} pattern types`,
        });
      }
    }

    // Build pattern summary
    const patternLabels = {
      'direct-call': 'Direct function/method call',
      'event-handler': 'Called from event handler (on*/handle*)',
      'event-listener': 'Used as event listener/callback argument',
      'class-method': 'Called from a class method',
      'module-init': 'Called at module initialization scope',
      'factory': 'Called from a factory/create function',
      'property-access': 'Accessed as property/member',
    };

    const patterns = Object.entries(patternCounts).map(([type, count]) => ({
      type,
      count,
      description: patternLabels[type] || type,
    }));

    patterns.sort((a, b) => b.count - a.count);

    const result = {
      symbol,
      file,
      totalUsages: usages.length,
      patterns,
      inducedPatterns,
      usages,
    };

    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Infer return type from a function signature.
   * e.g. `createUser(name: string): User` → `User`
   */
  _inferReturnType(signature) {
    if (!signature) return null;
    const match = signature.match(/[:(]\s*(\w+(?:<[^>]+>)?)\s*$/);
    return match ? match[1] : null;
  }

  /**
   * Read a few lines of source context around a reference line.
   * Returns joined text or null if file not found/readable.
   */
  _readSourceContext(relFile, refLine, radius = 2) {
    try {
      const absPath = resolve(this.projectRoot, relFile);
      if (!existsSync(absPath)) return null;
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, refLine - 1 - radius);
      const end = Math.min(lines.length, refLine - 1 + radius + 1);
      return lines.slice(start, end).join(' ');
    } catch {
      return null;
    }
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Query strategy/interace patterns.
   * Detects:
   *   1. Polymorphism — same-named functions across files (e.g. multiple `save()` implementations)
   *   2. Shared-interface — functions called by the same callers (strategy pattern)
   * @param {string} symbol - Symbol name
   * @param {string} file - File containing this symbol
   * @param {object} [opts]
   * @param {boolean} [opts.includeStale=false]
   * @returns {object} { symbol, file, strategies: [] }
   */
  queryStrategyPatterns(symbol, file, opts = {}) {
    const db = this._getDb();
    const staleFilter = opts.includeStale ? '' : 'AND n.stale = 0';

    const cacheKey = `strategy:${file}:${symbol}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const apiNode = db.prepare(
      `SELECT id, name, kind, file, signature FROM nodes n
       WHERE n.project_id = ? AND n.name = ? AND n.file = ? ${staleFilter}
       LIMIT 1`
    ).get(this._projectId, symbol, file);

    if (!apiNode) {
      const result = { symbol, file, strategies: [] };
      this._cache.set(cacheKey, result);
      return result;
    }

    const strategies = [];

    // Strategy 1: Same-named symbols in other files (polymorphism / duck typing)
    const sameName = db.prepare(
      `SELECT n.name, n.kind, n.file, n.signature, n.exported
       FROM nodes n
       WHERE n.project_id = ? AND n.name = ? AND n.file != ? ${staleFilter}
         AND n.kind IN ('function','method','class')
       ORDER BY n.file`
    ).all(this._projectId, symbol, file);

    if (sameName.length > 0) {
      strategies.push({
        type: 'polymorphism',
        confidence: 0.7,
        description: `Same name "${symbol}" found in ${sameName.length} other file(s) — possible polymorphic implementations`,
        implementations: sameName.map(c => ({
          name: c.name, kind: c.kind, file: c.file,
          signature: c.signature || '',
          exported: !!c.exported,
        })),
      });
    }

    // Strategy 2: Symbols sharing the same callers (used interchangeably via interface)
    const callerIds = db.prepare(
      `SELECT DISTINCT e.from_node_id as id FROM edges e
       WHERE e.to_node_id = ? AND e.kind = 'calls' ${staleFilter}`
    ).all(apiNode.id).map(r => r.id);

    if (callerIds.length > 0) {
      const ph = callerIds.map(() => '?').join(',');
      const minShared = Math.min(2, callerIds.length);
      const sharedCallers = db.prepare(
        `SELECT n.name, n.kind, n.file, n.signature, COUNT(*) as sharedCallers
         FROM edges e
         JOIN nodes n ON e.to_node_id = n.id
         WHERE e.from_node_id IN (${ph})
           AND e.kind = 'calls'
           AND NOT (n.name = ? AND n.file = ?)
           ${staleFilter}
         GROUP BY n.name, n.kind, n.file, n.signature
         HAVING sharedCallers >= ?
         ORDER BY sharedCallers DESC
         LIMIT 20`
      ).all(...callerIds, symbol, file, minShared);

      if (sharedCallers.length > 0) {
        strategies.push({
          type: 'shared-interface',
          confidence: 0.5,
          description: `Symbols called by the same callers as "${symbol}" — potential strategy/interface pattern`,
          implementations: sharedCallers.map(c => ({
            name: c.name, kind: c.kind, file: c.file,
            signature: c.signature || '',
            sharedCallers: c.sharedCallers,
          })),
        });
      }
    }

    const result = { symbol, file, strategies };
    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Query dependency structure of a file.
   * @param {string} file - File path
   * @returns {object} Dependencies (imports from, imported by)
   */
  queryDependencies(file) {
    const db = this._getDb();
    const staleFilter = 'AND n.stale = 0';

    const cacheKey = `deps:${file}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    // Find file node
    const fileNode = db.prepare(
      `SELECT id, name FROM nodes n WHERE n.project_id = ? AND n.file = ? AND n.kind = 'file' ${staleFilter} LIMIT 1`
    ).get(this._projectId, file);

    if (!fileNode) {
      const result = { file, imports: [], importedBy: [], totalImports: 0, totalImporters: 0 };
      this._cache.set(cacheKey, result);
      return result;
    }

    // What this file imports (outgoing edges with kind='imports')
    const imports = db.prepare(
      `SELECT DISTINCT n.file as target, n.name as target_name, e.metadata
       FROM edges e
       JOIN nodes n ON e.to_node_id = n.id
       WHERE e.from_node_id = ? AND e.kind = 'imports' ${staleFilter}
       ORDER BY n.file`
    ).all(fileNode.id).map(r => ({
      file: r.target,
      name: r.target_name,
      specifier: r.metadata ? JSON.parse(r.metadata).source : null,
    }));

    // What imports this file (incoming edges)
    const importedBy = db.prepare(
      `SELECT DISTINCT n.file as source, n.name as source_name
       FROM edges e
       JOIN nodes n ON e.from_node_id = n.id
       JOIN nodes tn ON e.to_node_id = tn.id
       WHERE tn.file = ? AND tn.kind = 'file' AND e.kind = 'imports' ${staleFilter}
       ORDER BY n.file`
    ).all(file);

    const result = {
      file,
      imports,
      importedBy,
      totalImports: imports.length,
      totalImporters: importedBy.length,
    };

    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Find unused exports in the project.
   * @returns {Array} Unused exported symbols
   */
  queryUnusedExports() {
    const db = this._getDb();
    const staleFilter = 'AND n.stale = 0';

    const cacheKey = 'unused-exports';
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    // Find exported symbols that have no incoming call/import edges
    const unused = db.prepare(
      `SELECT n.id, n.name, n.kind, n.file, n.range_start_line as line, n.signature
       FROM nodes n
       WHERE n.project_id = ? AND n.exported = 1 AND n.stale = 0
         AND n.kind IN ('function', 'class', 'interface', 'type', 'constant', 'variable')
         AND n.id NOT IN (
           SELECT DISTINCT e.to_node_id FROM edges e
           WHERE e.kind IN ('calls', 'imports') AND e.stale = 0
         )
       ORDER BY n.file, n.name
       LIMIT 200`
    ).all(this._projectId);

    // Also exclude symbols that are only referenced within their own file
    // (We'll use a simpler heuristic: exported symbols only referenced by their file)
    // Actually the edge table tracks cross-file references, so any symbol
    // referenced within the same file won't appear as an edge. And symbols
    // referenced by other files will have incoming edges. So this is correct.

    this._cache.set(cacheKey, unused);
    return unused;
  }

  /**
   * Query a symbol by name.
   * @param {string} name - Symbol name
   * @param {object} [opts]
   * @param {string} [opts.file] - Filter by file
   * @param {string} [opts.kind] - Filter by kind (function, class, etc.)
   * @param {boolean} [opts.includeStale=false]
   * @returns {Array} Matching symbols
   */
  querySymbol(name, opts = {}) {
    const db = this._getDb();
    let sql = 'SELECT id, name, kind, file, range_start_line as line, signature, exported FROM nodes WHERE project_id = ? AND name = ?';
    const params = [this._projectId, name];
    const conditions = [];

    if (opts.file) { conditions.push('file = ?'); params.push(opts.file); }
    if (opts.kind) { conditions.push('kind = ?'); params.push(opts.kind); }
    if (!opts.includeStale) { conditions.push('stale = 0'); }
    if (conditions.length) sql += ' AND ' + conditions.join(' AND ');
    sql += ' ORDER BY file, kind';

    return db.prepare(sql).all(...params);
  }

  /**
   * Get project stats.
   * @returns {object} Project statistics
   */
  getStats() {
    const db = this._getDb();
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(this._projectId);
    if (!proj) return { status: 'not_built' };

    const activeNodes = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ? AND stale = 0').get(this._projectId).c;
    const staleNodes = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ? AND stale = 1').get(this._projectId).c;
    const edgeCount = db.prepare(
      'SELECT COUNT(*) as c FROM edges e JOIN nodes n ON e.from_node_id = n.id WHERE n.project_id = ? AND n.stale = 0'
    ).get(this._projectId).c;
    const kindBreakdown = db.prepare(
      'SELECT kind, COUNT(*) as count FROM nodes WHERE project_id = ? AND stale = 0 GROUP BY kind ORDER BY count DESC'
    ).all(this._projectId);

    return {
      project: proj.name,
      root: proj.root,
      files: proj.file_count,
      nodes: activeNodes,
      stale: staleNodes,
      edges: edgeCount,
      builtAt: proj.built_at,
      kindBreakdown: kindBreakdown.reduce((acc, r) => { acc[r.kind] = r.count; return acc; }, {}),
    };
  }

  // -----------------------------------------------------------------------
  // Close / Cleanup
  // -----------------------------------------------------------------------

  /** Close database and stop watchers */
  async close() {
    // Stop all watchers
    for (const w of this._watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this._watchers = [];

    // Close database
    if (this._db) {
      try { this._db.close(); } catch { /* ignore */ }
      this._db = null;
    }
    this._cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------
const _instances = new Map();

/**
 * Get or create a CkgEngine for a project root.
 * @param {string} rootDir - Project root directory
 * @returns {CkgEngine}
 */
export function getCkgEngine(rootDir) {
  const key = rootDir || process.cwd();
  if (!_instances.has(key)) {
    _instances.set(key, new CkgEngine(key));
  }
  return _instances.get(key);
}

/**
 * Close all CKG engine instances (call on shutdown).
 */
export async function closeAllCkgEngines() {
  for (const [key, engine] of _instances) {
    try { await engine.close(); } catch { /* ignore */ }
    _instances.delete(key);
  }
}
