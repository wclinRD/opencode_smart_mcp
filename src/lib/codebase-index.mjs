// codebase-index.mjs — Persistent codebase symbol index
//
// SQLite-backed index of project symbols (functions, classes, exports)
// with pre-computed import graph and dependency relationships.
//
// Inspired by Aider's repo map — gives LLM a structured overview of the
// codebase without repeated grep/read calls.
//
// Phase 19: Codebase Index

import Database from 'better-sqlite3';
import { existsSync, readFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    language TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    last_indexed TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);

  CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('function','class','method','variable','export','interface','type','enum','trait','struct','impl','module')),
    line INTEGER,
    signature TEXT,
    exported INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
  CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
  CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    import_path TEXT NOT NULL,
    import_type TEXT DEFAULT 'module',
    resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
  CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_file_id);

  CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    callee_name TEXT NOT NULL,
    callee_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_deps_caller ON dependencies(caller_symbol_id);
  CREATE INDEX IF NOT EXISTS idx_deps_callee ON dependencies(callee_name);
`;

// ---------------------------------------------------------------------------
// Language-specific symbol extractors (regex-based, zero native deps)
// ---------------------------------------------------------------------------

/**
 * Extract symbols from JavaScript/TypeScript source
 */
function extractJSSymbols(source, filePath) {
  const symbols = [];
  const imports = [];
  const deps = [];

  // Function declarations: function name(...) or async function name(...)
  const funcRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = funcRe.exec(source)) !== null) {
    const exported = /export\s+/.test(m[0]);
    symbols.push({ name: m[1], kind: 'function', line: lineAt(source, m.index), signature: `function ${m[1]}(${m[2]})`, exported });
  }

  // Arrow functions assigned to const/let/var: const name = (...) => {...} or const name = async (...) => {...}
  const arrowRe = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
  while ((m = arrowRe.exec(source)) !== null) {
    const exported = /export\s+/.test(m[0]);
    symbols.push({ name: m[1], kind: 'function', line: lineAt(source, m.index), signature: `${m[1]}(${m[2]}) =>`, exported });
  }

  // Class declarations: class Name {...} or export class Name {...}
  const classRe = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  while ((m = classRe.exec(source)) !== null) {
    const exported = /export\s+/.test(m[0]);
    symbols.push({ name: m[1], kind: 'class', line: lineAt(source, m.index), signature: `class ${m[1]}`, exported });
  }

  // Method declarations inside classes (simplified): methodName(...) {
  const methodRe = /^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm;
  while ((m = methodRe.exec(source)) !== null) {
    const name = m[1];
    if (!['if','for','while','switch','catch','try','else','return','throw','new','delete','typeof','instanceof'].includes(name)) {
      symbols.push({ name, kind: 'method', line: lineAt(source, m.index), signature: `${name}(${m[2]})`, exported: false });
    }
  }

  // Interface/type declarations
  const ifaceRe = /(?:export\s+)?(?:interface|type)\s+(\w+)/g;
  while ((m = ifaceRe.exec(source)) !== null) {
    const exported = /export\s+/.test(m[0]);
    symbols.push({ name: m[1], kind: m[0].includes('interface') ? 'interface' : 'type', line: lineAt(source, m.index), signature: `${m[0].includes('interface') ? 'interface' : 'type'} ${m[1]}`, exported });
  }

  // Enum declarations
  const enumRe = /(?:export\s+)?enum\s+(\w+)/g;
  while ((m = enumRe.exec(source)) !== null) {
    const exported = /export\s+/.test(m[0]);
    symbols.push({ name: m[1], kind: 'enum', line: lineAt(source, m.index), signature: `enum ${m[1]}`, exported });
  }

  // Export declarations: export { foo, bar } or export default name
  const exportNamedRe = /export\s*\{\s*([^}]+)\}/g;
  while ((m = exportNamedRe.exec(source)) !== null) {
    const names = m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '').trim());
    for (const name of names) {
      if (name && name !== 'default') {
        symbols.push({ name, kind: 'export', line: lineAt(source, m.index), signature: `export { ${name} }`, exported: true });
      }
    }
  }

  const exportDefaultRe = /export\s+default\s+(?:function\s+)?(\w+)?/g;
  while ((m = exportDefaultRe.exec(source)) !== null) {
    if (m[1]) {
      symbols.push({ name: m[1], kind: 'export', line: lineAt(source, m.index), signature: `export default ${m[1]}`, exported: true });
    }
  }

  // Import statements: import ... from '...'
  const importRe = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(source)) !== null) {
    imports.push({ import_path: m[1], import_type: 'module' });
  }

  // Dynamic imports: import('...')
  const dynImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynImportRe.exec(source)) !== null) {
    imports.push({ import_path: m[1], import_type: 'dynamic' });
  }

  // require() calls
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(source)) !== null) {
    imports.push({ import_path: m[1], import_type: 'require' });
  }

  // Extract caller-callee dependencies (simplified: function calls within function bodies)
  for (const sym of symbols.filter(s => s.kind === 'function' || s.kind === 'method')) {
    const callRe = /(\w+)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(source)) !== null) {
      const callee = cm[1];
      if (callee !== sym.name && !['if','for','while','switch','catch','try','require','console','JSON','Math','Object','Array','String','Number','Boolean','Promise','Error','Map','Set','WeakMap','WeakSet','Symbol','parseInt','parseFloat','isNaN','isFinite','setTimeout','setInterval','clearTimeout','clearInterval','Buffer','process','global','undefined','null','true','false','this','super','new','return','throw','typeof','instanceof','delete','void','import','export','default','async','await','yield','let','const','var','function','class','extends','implements','interface','type','enum','namespace','module','declare','abstract','static','public','private','protected','readonly'].includes(callee)) {
        deps.push({ caller: sym.name, callee });
      }
    }
  }

  return { symbols, imports, deps };
}

/**
 * Extract symbols from Python source
 */
function extractPythonSymbols(source, filePath) {
  const symbols = [];
  const imports = [];
  const deps = [];

  // Function definitions: def name(...):
  const funcRe = /^\s*def\s+(\w+)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(source)) !== null) {
    const indent = source.lastIndexOf('\n', m.index) >= 0 ? m.index - source.lastIndexOf('\n', m.index) - 1 : 0;
    const isMethod = indent > 0;
    symbols.push({ name: m[1], kind: isMethod ? 'method' : 'function', line: lineAt(source, m.index), signature: `def ${m[1]}(${m[2]})`, exported: !m[1].startsWith('_') });
  }

  // Class definitions: class Name:
  const classRe = /^\s*class\s+(\w+)/gm;
  while ((m = classRe.exec(source)) !== null) {
    symbols.push({ name: m[1], kind: 'class', line: lineAt(source, m.index), signature: `class ${m[1]}`, exported: !m[1].startsWith('_') });
  }

  // Import statements
  const importFromRe = /from\s+(\S+)\s+import\s+(.+)/g;
  while ((m = importFromRe.exec(source)) !== null) {
    imports.push({ import_path: m[1], import_type: 'from' });
  }

  const importRe = /^import\s+(\S+)/gm;
  while ((m = importRe.exec(source)) !== null) {
    imports.push({ import_path: m[1], import_type: 'import' });
  }

  return { symbols, imports, deps };
}

/**
 * Extract symbols from Rust source
 */
function extractRustSymbols(source, filePath) {
  const symbols = [];
  const imports = [];
  const deps = [];

  // Function definitions: fn name(...)
  const funcRe = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let m;
  while ((m = funcRe.exec(source)) !== null) {
    const isPub = /pub/.test(m[0]);
    symbols.push({ name: m[1], kind: 'function', line: lineAt(source, m.index), signature: `fn ${m[1]}(${m[2]})`, exported: isPub });
  }

  // Struct definitions
  const structRe = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?struct\s+(\w+)/g;
  while ((m = structRe.exec(source)) !== null) {
    const isPub = /pub/.test(m[0]);
    symbols.push({ name: m[1], kind: 'struct', line: lineAt(source, m.index), signature: `struct ${m[1]}`, exported: isPub });
  }

  // Trait definitions
  const traitRe = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?trait\s+(\w+)/g;
  while ((m = traitRe.exec(source)) !== null) {
    const isPub = /pub/.test(m[0]);
    symbols.push({ name: m[1], kind: 'trait', line: lineAt(source, m.index), signature: `trait ${m[1]}`, exported: isPub });
  }

  // Enum definitions
  const enumRe = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?enum\s+(\w+)/g;
  while ((m = enumRe.exec(source)) !== null) {
    const isPub = /pub/.test(m[0]);
    symbols.push({ name: m[1], kind: 'enum', line: lineAt(source, m.index), signature: `enum ${m[1]}`, exported: isPub });
  }

  // impl blocks
  const implRe = /impl\s+(?:(\w+)\s+for\s+)?(\w+)/g;
  while ((m = implRe.exec(source)) !== null) {
    const traitName = m[1];
    const typeName = m[2];
    symbols.push({ name: typeName, kind: 'impl', line: lineAt(source, m.index), signature: traitName ? `impl ${traitName} for ${typeName}` : `impl ${typeName}`, exported: false });
  }

  // mod declarations
  const modRe = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?mod\s+(\w+)/g;
  while ((m = modRe.exec(source)) !== null) {
    const isPub = /pub/.test(m[0]);
    symbols.push({ name: m[1], kind: 'module', line: lineAt(source, m.index), signature: `mod ${m[1]}`, exported: isPub });
  }

  // use statements
  const useRe = /use\s+(.+?);/g;
  while ((m = useRe.exec(source)) !== null) {
    imports.push({ import_path: m[1].trim(), import_type: 'use' });
  }

  return { symbols, imports, deps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineAt(source, index) {
  return source.substring(0, index).split('\n').length;
}

function detectLanguage(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
    '.py': 'python', '.pyi': 'python',
    '.rs': 'rust',
  };
  return map[ext] || null;
}

/**
 * Simple recursive file walker — finds all files matching extensions.
 * More reliable than globSync across Node versions.
 */
function walkFiles(rootDir, { includeExts, excludeDirs = ['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next'] } = {}) {
  const results = [];
  const absRoot = resolve(rootDir);

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (includeExts.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(absRoot);
  return results;
}

const DEFAULT_INCLUDE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.pyi', '.rs']);

function extractSymbols(source, filePath) {
  const lang = detectLanguage(filePath);
  if (!lang) return { symbols: [], imports: [], deps: [] };

  switch (lang) {
    case 'javascript':
    case 'typescript':
      return extractJSSymbols(source, filePath);
    case 'python':
      return extractPythonSymbols(source, filePath);
    case 'rust':
      return extractRustSymbols(source, filePath);
    default:
      return { symbols: [], imports: [], deps: [] };
  }
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function resolveImportPath(importPath, fromFile, projectRoot) {
  // Relative imports
  if (importPath.startsWith('.')) {
    const fromDir = dirname(fromFile);
    const resolved = resolve(fromDir, importPath);
    // Try with extensions
    for (const ext of ['.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '/index.js', '/index.ts', '/index.mjs', '/__init__.py', '.rs/mod.rs']) {
      const candidate = resolved + ext;
      if (existsSync(candidate)) return candidate;
    }
    // Try without extension
    if (existsSync(resolved)) return resolved;
    return null;
  }
  // Package imports — can't resolve without node_modules analysis
  return null;
}

// ---------------------------------------------------------------------------
// Main Index Class
// ---------------------------------------------------------------------------

let _index = null;

export class CodebaseIndex {
  constructor(dbPath) {
    this.dbPath = dbPath;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // --- Build ---

  buildIndex(projectRoot, { includeExts = DEFAULT_INCLUDE_EXTS, excludeDirs } = {}) {
    const startTime = Date.now();
    const absRoot = resolve(projectRoot);

    // Clear existing data
    this.db.exec('DELETE FROM dependencies');
    this.db.exec('DELETE FROM imports');
    this.db.exec('DELETE FROM symbols');
    this.db.exec('DELETE FROM files');

    const files = walkFiles(absRoot, { includeExts, excludeDirs });
    const insertFile = this.db.prepare('INSERT INTO files (path, hash, language, size) VALUES (?, ?, ?, ?)');
    const insertSymbol = this.db.prepare('INSERT INTO symbols (file_id, name, kind, line, signature, exported) VALUES (?, ?, ?, ?, ?, ?)');
    const insertImport = this.db.prepare('INSERT INTO imports (file_id, import_path, import_type) VALUES (?, ?, ?)');
    const insertDep = this.db.prepare('INSERT INTO dependencies (caller_symbol_id, callee_name) VALUES (?, ?)');

    const transaction = this.db.transaction(() => {
      for (const filePath of files) {
        const relPath = relative(absRoot, filePath);
        const lang = detectLanguage(filePath);
        if (!lang) continue;

        try {
          const content = readFileSync(filePath, 'utf-8');
          const hash = hashContent(content);
          const size = statSync(filePath).size;

          const fileResult = insertFile.run(relPath, hash, lang, size);
          const fileId = fileResult.lastInsertRowid;

          const { symbols, imports, deps } = extractSymbols(content, filePath);

          for (const sym of symbols) {
            insertSymbol.run(fileId, sym.name, sym.kind, sym.line, sym.signature || null, sym.exported ? 1 : 0);
          }

          for (const imp of imports) {
            insertImport.run(fileId, imp.import_path, imp.import_type);
          }

          // Resolve imports to file IDs
          for (const imp of imports) {
            const resolved = resolveImportPath(imp.import_path, filePath, absRoot);
            if (resolved) {
              const relResolved = relative(absRoot, resolved);
              const resolvedFile = this.db.prepare('SELECT id FROM files WHERE path = ?').get(relResolved);
              if (resolvedFile) {
                this.db.prepare('UPDATE imports SET resolved_file_id = ? WHERE file_id = ? AND import_path = ?').run(resolvedFile.id, fileId, imp.import_path);
              }
            }
          }

          // Store dependencies
          for (const dep of deps) {
            // Find the caller symbol ID
            const callerSym = this.db.prepare('SELECT id FROM symbols WHERE file_id = ? AND name = ?').get(fileId, dep.caller);
            if (callerSym) {
              insertDep.run(callerSym.id, dep.callee);
            }
          }
        } catch (err) {
          // Skip files that can't be read (binary, encoding issues, etc.)
          continue;
        }
      }
    });

    transaction();

    const elapsed = Date.now() - startTime;
    const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    const symbolCount = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get().count;
    const importCount = this.db.prepare('SELECT COUNT(*) as count FROM imports').get().count;

    return { files: fileCount, symbols: symbolCount, imports: importCount, elapsedMs: elapsed };
  }

  // --- Update (incremental) ---

  updateIndex(projectRoot, { includeExts = DEFAULT_INCLUDE_EXTS, excludeDirs } = {}) {
    const absRoot = resolve(projectRoot);
    const files = walkFiles(absRoot, { includeExts, excludeDirs });

    let added = 0, updated = 0, removed = 0;

    // Check existing files
    const existingFiles = this.db.prepare('SELECT id, path, hash FROM files').all();
    const existingMap = new Map(existingFiles.map(f => [f.path, f]));

    const currentPaths = new Set(files.map(f => relative(absRoot, f)));

    // Remove deleted files
    for (const [path, file] of existingMap) {
      if (!currentPaths.has(path)) {
        this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
        removed++;
      }
    }

    // Add/update files
    const insertFile = this.db.prepare('INSERT INTO files (path, hash, language, size) VALUES (?, ?, ?, ?)');
    const updateFile = this.db.prepare('UPDATE files SET hash = ?, size = ?, last_indexed = datetime(\'now\') WHERE id = ?');
    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    const deleteImports = this.db.prepare('DELETE FROM imports WHERE file_id = ?');
    const insertSymbol = this.db.prepare('INSERT INTO symbols (file_id, name, kind, line, signature, exported) VALUES (?, ?, ?, ?, ?, ?)');
    const insertImport = this.db.prepare('INSERT INTO imports (file_id, import_path, import_type) VALUES (?, ?, ?)');

    const transaction = this.db.transaction(() => {
      for (const filePath of files) {
        const relPath = relative(absRoot, filePath);
        const lang = detectLanguage(filePath);
        if (!lang) continue;

        try {
          const content = readFileSync(filePath, 'utf-8');
          const hash = hashContent(content);
          const size = statSync(filePath).size;

          const existing = existingMap.get(relPath);

          if (existing) {
            // Check if changed
            if (existing.hash === hash) continue; // unchanged

            // Update
            updateFile.run(hash, size, existing.id);
            deleteSymbols.run(existing.id);
            deleteImports.run(existing.id);
            updated++;

            const { symbols, imports } = extractSymbols(content, filePath);
            for (const sym of symbols) {
              insertSymbol.run(existing.id, sym.name, sym.kind, sym.line, sym.signature || null, sym.exported ? 1 : 0);
            }
            for (const imp of imports) {
              insertImport.run(existing.id, imp.import_path, imp.import_type);
            }
          } else {
            // New file
            const result = insertFile.run(relPath, hash, lang, size);
            const fileId = result.lastInsertRowid;
            added++;

            const { symbols, imports } = extractSymbols(content, filePath);
            for (const sym of symbols) {
              insertSymbol.run(fileId, sym.name, sym.kind, sym.line, sym.signature || null, sym.exported ? 1 : 0);
            }
            for (const imp of imports) {
              insertImport.run(fileId, imp.import_path, imp.import_type);
            }
          }
        } catch (err) {
          continue;
        }
      }
    });

    transaction();

    return { added, updated, removed };
  }

  // --- Query ---

  querySymbol(name, { limit = 20, kind = null } = {}) {
    let sql = `
      SELECT s.name, s.kind, s.line, s.signature, s.exported, f.path as file_path, f.language
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
    `;
    const params = [`%${name}%`];

    if (kind) {
      sql += ' AND s.kind = ?';
      params.push(kind);
    }

    sql += ' ORDER BY s.exported DESC, s.name ASC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  getImportGraph() {
    const rows = this.db.prepare(`
      SELECT f1.path as from_file, f2.path as to_file, i.import_type
      FROM imports i
      JOIN files f1 ON i.file_id = f1.id
      LEFT JOIN files f2 ON i.resolved_file_id = f2.id
      ORDER BY f1.path
    `).all();

    // Group by from_file
    const graph = {};
    for (const row of rows) {
      if (!graph[row.from_file]) graph[row.from_file] = [];
      graph[row.from_file].push({
        import: row.to_file || row.import_path || '(unresolved)',
        type: row.import_type
      });
    }
    return graph;
  }

  getCallGraph(symbolName) {
    return this.db.prepare(`
      SELECT DISTINCT d.callee_name as callee, f.path as file_path, cs.line as line
      FROM dependencies d
      JOIN symbols s ON d.caller_symbol_id = s.id
      LEFT JOIN symbols cs ON cs.name = d.callee_name
      LEFT JOIN files f ON cs.file_id = f.id
      WHERE s.name = ?
      ORDER BY d.callee_name
    `).all(symbolName);
  }

  // --- Repo Map ---

  generateRepoMap({ maxSymbols = 200 } = {}) {
    const files = this.db.prepare('SELECT id, path, language FROM files ORDER BY path').all();
    const lines = [];
    lines.push(`# Repository Map — ${files.length} files indexed`);
    lines.push('');

    for (const file of files) {
      const symbols = this.db.prepare(
        'SELECT name, kind, line, signature, exported FROM symbols WHERE file_id = ? ORDER BY line LIMIT ?',
      ).all(file.id, 50);

      if (symbols.length === 0) continue;

      lines.push(`## ${file.path} (${file.language})`);

      for (const sym of symbols) {
        const prefix = sym.exported ? '📤 ' : '  ';
        const kindIcon = {
          'function': 'ƒ', 'method': 'm', 'class': 'C', 'variable': 'v',
          'export': '→', 'interface': 'I', 'type': 'T', 'enum': 'E',
          'trait': 'Tr', 'struct': 'S', 'impl': 'Im', 'module': 'M'
        }[sym.kind] || '?';
        lines.push(`${prefix}${kindIcon} ${sym.name}${sym.signature ? ': ' + sym.signature : ''} (L${sym.line})`);
      }
      lines.push('');
    }

    // Add import graph summary
    const importCount = this.db.prepare('SELECT COUNT(*) as count FROM imports WHERE resolved_file_id IS NOT NULL').get().count;
    lines.push(`---`);
    lines.push(`${importCount} resolved imports across ${files.length} files.`);

    return lines.join('\n');
  }

  // --- Stats ---

  getStats() {
    return {
      files: this.db.prepare('SELECT COUNT(*) as count FROM files').get().count,
      symbols: this.db.prepare('SELECT COUNT(*) as count FROM symbols').get().count,
      imports: this.db.prepare('SELECT COUNT(*) as count FROM imports').get().count,
      resolvedImports: this.db.prepare('SELECT COUNT(*) as count FROM imports WHERE resolved_file_id IS NOT NULL').get().count,
      dependencies: this.db.prepare('SELECT COUNT(*) as count FROM dependencies').get().count,
      byLanguage: this.db.prepare('SELECT language, COUNT(*) as count FROM files GROUP BY language ORDER BY count DESC').all(),
      byKind: this.db.prepare('SELECT kind, COUNT(*) as count FROM symbols GROUP BY kind ORDER BY count DESC').all(),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = resolve(os.homedir(), '.smart', 'codebase-index.db');

export function getCodebaseIndex(dbPath = DEFAULT_DB_PATH) {
  if (!_index) {
    _index = new CodebaseIndex(dbPath);
  }
  return _index;
}

export function resetCodebaseIndex() {
  if (_index) {
    _index.close();
    _index = null;
  }
}