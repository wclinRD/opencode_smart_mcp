// smart-read.mjs — 漸進式檔案讀取引擎
//
// 八種模式減少 60-80% file read token：
//   auto       — 依檔案大小自動選擇最佳模式
//   outline    — 檔案結構輪廓（function/class/const 宣告）
//   signatures — 比 outline 多包含 signature 行（+line range）
//   symbol     — 只抽取特定 symbol 的完整 body
//   explain    — symbol body + imports + callers 一次取得
//   range      — 指定行範圍讀取（startLine/endLine）
//   full       — 傳統完整讀取（fallback）
//   batch      — 一次讀取多個檔案
//
// 支援語言偵測（extension-based），針對 JS/TS/Python/Go/Rust 有最佳化 pattern。
// 其他語言以通用 pattern 作為 fallback。

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { extname, resolve, relative, basename, join } from 'node:path';
import { cwd } from 'node:process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Language-specific extraction patterns
// ---------------------------------------------------------------------------

/**
 * Language detection from file extension.
 */
export function detectLanguage(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    '.js':    'javascript',
    '.jsx':   'javascript',
    '.mjs':   'javascript',
    '.cjs':   'javascript',
    '.ts':    'typescript',
    '.tsx':   'typescript',
    '.mts':   'typescript',
    '.cts':   'typescript',
    '.py':    'python',
    '.pyw':   'python',
    '.go':    'go',
    '.rs':    'rust',
    '.rb':    'ruby',
    '.php':   'php',
    '.java':  'java',
    '.swift': 'swift',
    '.kt':    'kotlin',
    '.scala': 'scala',
    '.rs':    'rust',
    '.c':     'c',
    '.h':     'c',
    '.cpp':   'cpp',
    '.hpp':   'cpp',
    '.cc':    'cpp',
    '.cxx':   'cpp',
    '.cs':    'csharp',
    '.vue':   'vue',
    '.svelte':'svelte',
    '.astro': 'astro',
  };
  return map[ext] || 'unknown';
}

// ---------------------------------------------------------------------------
// Image file support
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
]);

const IMAGE_MIME_TYPES = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.avif': 'image/avif',
};

export function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function readImageAsBase64(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
  const raw = readFileSync(filePath);
  const data = raw.toString('base64');
  return { data, mimeType };
}

/**
 * Get declaration pattern list for a given language.
 * Each pattern: { re, type, nameGroup?, signatureGroup? }
 */
export function getPatternsForLanguage(lang) {
  const universal = [
    // Handle `exports.X =`, `module.exports.X =`
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/gm,       type: 'variable',  nameGroup: 1 },
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:async\s+)?\(/gm, type: 'function', nameGroup: 1 },
  ];

  const groups = {
    javascript: [
      ...universal,
      { re: /^(?:export\s+)?(?:async\s+)?function\s+(?:\*\s+)?(\w+)/gm,  type: 'function',  nameGroup: 1 },
      { re: /^(?:export\s+)?class\s+(\w+)/gm,                             type: 'class',     nameGroup: 1 },
      { re: /^(?:export\s+)?default\s+(?:async\s+)?function\s+(\w+)/gm,   type: 'function',  nameGroup: 1 },
      { re: /^(?:export\s+)?default\s+class\s+(\w+)/gm,                   type: 'class',     nameGroup: 1 },
    ],
    typescript: [
      { re: /^(?:export\s+)?(?:async\s+)?function\s+(?:\*\s+)?(\w+)/gm,       type: 'function',  nameGroup: 1 },
      { re: /^(?:export\s+)?class\s+(\w+)/gm,                                   type: 'class',     nameGroup: 1 },
      { re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,                  type: 'class',     nameGroup: 1 },
      { re: /^(?:export\s+)?interface\s+(\w+)/gm,                               type: 'interface', nameGroup: 1 },
      { re: /^(?:export\s+)?type\s+(\w+)\s*[:=]/gm,                             type: 'type',      nameGroup: 1 },
      { re: /^(?:export\s+)?enum\s+(\w+)/gm,                                    type: 'enum',      nameGroup: 1 },
      { re: /^(?:export\s+)?default\s+(?:async\s+)?function\s+(\w+)/gm,        type: 'function',  nameGroup: 1 },
      { re: /^(?:export\s+)?default\s+class\s+(\w+)/gm,                        type: 'class',     nameGroup: 1 },
      ...universal,
    ],
    python: [
      { re: /^async\s+def\s+(\w+)/gm,         type: 'function', nameGroup: 1 },
      { re: /^def\s+(\w+)/gm,                  type: 'function', nameGroup: 1 },
      { re: /^class\s+(\w+)/gm,                type: 'class',    nameGroup: 1 },
      { re: /^@(?:property|staticmethod|classmethod)/gm, type: 'decorator' },
    ],
    go: [
      { re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm,            type: 'function',  nameGroup: 1 },
      { re: /^func\s+(?:\([^)]+\)\s+)?\((\w+)/gm,          type: 'function',  nameGroup: 1 },
      { re: /^type\s+(\w+)\s+struct/gm,                     type: 'struct',    nameGroup: 1 },
      { re: /^type\s+(\w+)\s+interface/gm,                  type: 'interface', nameGroup: 1 },
      { re: /^type\s+(\w+)\s*=/gm,                          type: 'type',      nameGroup: 1 },
    ],
    rust: [
      { re: /^fn\s+(\w+)/gm,                                type: 'function',  nameGroup: 1 },
      { re: /^struct\s+(\w+)/gm,                             type: 'struct',    nameGroup: 1 },
      { re: /^impl(?:\s*<[^>]+>)?\s+(\w+)/gm,               type: 'impl',      nameGroup: 1 },
      { re: /^trait\s+(\w+)/gm,                              type: 'trait',     nameGroup: 1 },
      { re: /^enum\s+(\w+)/gm,                               type: 'enum',      nameGroup: 1 },
      { re: /^type\s+(\w+)\s*=/gm,                           type: 'type',      nameGroup: 1 },
      { re: /^const\s+(\w+)\s*:/gm,                          type: 'constant',  nameGroup: 1 },
      { re: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,        type: 'function',  nameGroup: 1 },
    ],
    // For other languages, use generic patterns
  };

  return groups[lang] || [
    // Universal fallback
    { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,               type: 'function', nameGroup: 1 },
    { re: /^(?:export\s+)?class\s+(\w+)/gm,                                type: 'class',    nameGroup: 1 },
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/gm,            type: 'variable', nameGroup: 1 },
    { re: /^def\s+(\w+)/gm,                                                type: 'function', nameGroup: 1 },
    { re: /^class\s+(\w+)/gm,                                              type: 'class',    nameGroup: 1 },
    { re: /^func\s+(?:\w+\s+)?(\w+)/gm,                                    type: 'function', nameGroup: 1 },
    { re: /^fn\s+(\w+)/gm,                                                 type: 'function', nameGroup: 1 },
    { re: /^type\s+(\w+)\s*(?:[:=]|struct|interface)/gm,                  type: 'type',     nameGroup: 1 },
  ];
}

// ---------------------------------------------------------------------------
// Line-based parsers
// ---------------------------------------------------------------------------

/**
 * Parse file content into a structured list of declarations.
 * Returns array of { name, type, lineStart, lineEnd, signature, body? }
 * lineStart/lineEnd are 1-indexed.
 */
export function parseDeclarations(content, lang) {
  const lines = content.split('\n');
  const declarations = [];
  const patterns = getPatternsForLanguage(lang);

  // Track which lines already belong to a declaration (prevent overlap)
  const claimedLines = new Set();

  for (const pattern of patterns) {
    if (pattern.re === undefined) continue;

    // Reset regex lastIndex
    pattern.re.lastIndex = 0;

    let match;
    while ((match = pattern.re.exec(content)) !== null) {
      // Calculate line number from match position
      const matchStart = match.index;
      const lineNum = getLineNumber(content, matchStart);

      if (claimedLines.has(lineNum)) continue;
      claimedLines.add(lineNum);

      const name = pattern.nameGroup ? match[pattern.nameGroup] : (match[1] || '');
      const signature = extractSignature(lines, lineNum, lang);
      const lineEnd = findBodyEnd(lines, lineNum, lang);

      declarations.push({
        name,
        type: pattern.type,
        lineStart: lineNum,
        lineEnd: lineEnd || lineNum + 1,
        signature: signature || match[0],
      });
    }
  }

  // Sort by line number
  declarations.sort((a, b) => a.lineStart - b.lineStart);

  // Deduplicate by name + type (take first occurrence)
  const seen = new Set();
  const unique = [];
  for (const decl of declarations) {
    const key = `${decl.name}:${decl.type}:${decl.lineStart}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(decl);
    }
  }

  return unique;
}

/**
 * Extract the body of a specific symbol by name.
 * Returns { name, type, lineStart, lineEnd, signature, body } or null.
 */
export function extractSymbol(content, lang, symbolName) {
  const declarations = parseDeclarations(content, lang);

  // Exact match first
  const exact = declarations.find(d => d.name === symbolName);
  if (exact) {
    const lines = content.split('\n');
    const body = lines.slice(exact.lineStart - 1, exact.lineEnd).join('\n');
    return { ...exact, body };
  }

  // Fuzzy: case-insensitive
  const fuzzy = declarations.find(d => d.name.toLowerCase() === symbolName.toLowerCase());
  if (fuzzy) {
    const lines = content.split('\n');
    const body = lines.slice(fuzzy.lineStart - 1, fuzzy.lineEnd).join('\n');
    return { ...fuzzy, body };
  }

  return null;
}

/**
 * Generate a file outline (list of declarations with line numbers).
 */
export function generateOutline(content, lang) {
  const decls = parseDeclarations(content, lang);
  return decls.map(d => ({
    name: d.name,
    type: d.type,
    line: d.lineStart,
  }));
}

/**
 * Generate signatures (declarations with signature text + line range).
 */
export function generateSignatures(content, lang) {
  const decls = parseDeclarations(content, lang);
  return decls.map(d => ({
    name: d.name,
    type: d.type,
    lineStart: d.lineStart,
    lineEnd: d.lineEnd,
    signature: d.signature,
  }));
}

/**
 * Read full file content.
 */
export function readFull(filePath) {
  return readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Get 1-indexed line number from a character position in content.
 */
function getLineNumber(content, pos) {
  let line = 1;
  for (let i = 0; i < pos && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Extract the signature line of a declaration.
 */
function extractSignature(lines, lineNum, lang) {
  const idx = lineNum - 1;
  if (idx < 0 || idx >= lines.length) return '';
  const line = lines[idx];

  // For Python, collect decorators before the def/class
  if (lang === 'python') {
    let sigLines = [];
    let i = idx;
    // Go backwards to collect decorators
    while (i > 0 && lines[i - 1].trimStart().startsWith('@')) {
      i--;
    }
    for (let j = i; j <= idx; j++) {
      sigLines.push(lines[j]);
    }
    return sigLines.join('\n');
  }

  return line;
}

/**
 * Find the end line of a declaration body.
 * For brace-delimited languages: track brace depth.
 * For Python (indentation-based): track indentation.
 */
function findBodyEnd(lines, startLine, lang) {
  const idx = startLine - 1;
  if (idx < 0 || idx >= lines.length) return startLine;

  const startContent = lines[idx];

  // Python: indentation-based
  if (lang === 'python') {
    // Handle decorators: skip forward to the actual def/class
    let defIdx = idx;
    while (defIdx < lines.length && lines[defIdx].trimStart().startsWith('@')) {
      defIdx++;
    }
    if (defIdx >= lines.length) return startLine;
    const defLine = lines[defIdx];
    const indent = defLine.search(/\S/); // indentation of def/class
    if (indent === -1) return startLine;

    // Find body start (first line after def with greater indentation)
    let bodyStart = defIdx + 1;
    while (bodyStart < lines.length) {
      const trimmed = lines[bodyStart];
      if (trimmed.trim() === '' || trimmed.trimStart().startsWith('#')) {
        bodyStart++;
        continue;
      }
      const lineIndent = trimmed.search(/\S/);
      if (lineIndent <= indent) {
        // No body or empty body
        return defIdx + 1;
      }
      break;
    }

    // Find body end (first line with same or less indentation)
    for (let i = bodyStart + 1; i < lines.length; i++) {
      const trimmed = lines[i];
      if (trimmed.trim() === '') continue;
      if (trimmed.trimStart().startsWith('#')) continue;
      const lineIndent = trimmed.search(/\S/);
      if (lineIndent <= indent) {
        return i; // End of body (exclusive)
      }
    }
    return lines.length; // Body goes to end of file
  }

  // Braces: Js/Ts/Go/Rust/C/C++/Java/Swift/Kotlin/Scala
  const braceLangs = new Set([
    'javascript', 'typescript', 'go', 'rust', 'java', 'swift',
    'kotlin', 'scala', 'c', 'cpp', 'csharp', 'php',
    'vue', 'svelte', 'astro',
  ]);

  if (braceLangs.has(lang)) {
    // Find opening brace — could be on same line or next lines
    let braceDepth = 0;
    let foundOpen = false;
    let startFrom = idx;

    while (startFrom < lines.length && !foundOpen) {
      const line = lines[startFrom];
      for (const ch of line) {
        if (ch === '{') {
          braceDepth++;
          foundOpen = true;
          break;
        }
      }
      if (!foundOpen) startFrom++;
    }

    if (!foundOpen) return startLine + 1; // No braces found, single-line

    // Track depth from the open brace
    // Count braces on the startFrom line from the first { position
    let lineText = lines[startFrom];
    let braceStarted = false;
    for (const ch of lineText) {
      if (ch === '{' && !braceStarted) {
        braceStarted = true;
        // Don't count this first brace (already accounted)
        continue;
      }
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    if (braceDepth <= 0) return startFrom + 1; // Balanced on same line: exclusive end

    // Continue scanning subsequent lines
    for (let i = startFrom + 1; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) {
        return i + 1; // Return 1-indexed end line (exclusive: line after closing brace)
      }
    }

    return lines.length; // Unclosed brace — goes to end
  }

  // For unknown languages: try brace matching as fallback
  let braceCount = 0;
  let foundAnyBrace = false;
  for (let i = idx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceCount++; foundAnyBrace = true; }
      if (ch === '}') { braceCount--; }
    }
    if (foundAnyBrace && braceCount <= 0) {
      return i + 1;
    }
  }

  return startLine + 1;
}

/**
 * List directory contents (replaces raw read for directories).
 * Returns entries with trailing `/` for subdirectories.
 */
function listDirectory(dirPath, root, opts) {
  const relPath = relative(root, dirPath);
  const entries = readdirSync(dirPath);

  // Sort: directories first, then files, both alphabetical
  const items = entries
    .map(name => {
      const full = resolve(dirPath, name);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { /* ignore */ }
      return { name: isDir ? name + '/' : name, isDir };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    status: 'ok',
    mode: 'list',
    file: relPath || '.',
    isDirectory: true,
    totalEntries: items.length,
    data: items.map(i => i.name),
    lines: items.length,
  };
}

// ---------------------------------------------------------------------------
// Import and caller extraction (for explain mode)
// ---------------------------------------------------------------------------

/**
 * Get import pattern regexes per language.
 */
function getImportPatterns(lang) {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return [
        /^import\s+/,
        /^const\s+\w+\s*=\s*require\(/,
        /^(?:import|export)\s+.*\s+from\s+/,
        /^export\s+\*\s+from/,
      ];
    case 'python':
      return [
        /^import\s+/,
        /^from\s+\S+\s+import\s+/,
      ];
    case 'go':
      return [/^import\s+(?!"|`)/];
    case 'rust':
      return [/^use\s+/];
    default:
      return [
        /^import\s+/,
        /^use\s+/,
        /^from\s+/,
        /^require/,
      ];
  }
}

/**
 * Extract import statements from the first N lines of a file.
 * Returns [{ line, text }].
 */
export function extractImports(content, lang) {
  const lines = content.split('\n');
  const patterns = getImportPatterns(lang);
  const maxLines = Math.min(lines.length, 80);
  const imports = [];
  for (let i = 0; i < maxLines; i++) {
    const line = lines[i];
    for (const re of patterns) {
      if (re.test(line)) {
        imports.push({ line: i + 1, text: line.trim() });
        break;
      }
    }
  }
  return imports;
}

/**
 * Extract callers of a symbol within the same file (excluding symbol's own body).
 * Returns [{ line, text }].
 */
export function extractCallers(content, symbolData, _lang) {
  const lines = content.split('\n');
  const symbolName = symbolData.name;
  const defLine = symbolData.lineStart;
  const endLine = symbolData.lineEnd;
  const callers = [];

  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\s*\\(`, 'g');

  for (let i = 0; i < lines.length; i++) {
    // Skip symbol's own definition body
    if (i >= defLine - 1 && i < endLine) continue;

    const trimmed = lines[i].trim();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    re.lastIndex = 0;
    if (re.test(lines[i])) {
      callers.push({ line: i + 1, text: trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed });
    }
  }

  return callers;
}

// ---------------------------------------------------------------------------
// Content hash for integrity verification
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of file content.
 * Returns hex string for integrity verification (edits can confirm they're
 * editing the same content the LLM read).
 */
export function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Project Map — 專案符號地圖
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.pyw', '.go', '.rs', '.rb', '.php', '.java', '.swift',
  '.kt', '.scala', '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.cs',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'vendor', 'target', '.opencode']);

/**
 * Build a compact project symbol map.
 * Walks directory tree, extracts top-level symbols per code file.
 * Returns { status, mode, file, totalFiles, mappedFiles, estimatedTokens, data }
 */
export function buildProjectMap(root, opts = {}) {
  const maxDepth = opts.depth || 4;
  const maxFiles = opts.maxFiles || 40;
  const maxTotalLines = opts.maxTotalLines || 500;
  const entries = [];
  let totalLines = 0;
  let filesScanned = 0;

  function walk(dir, depth) {
    if (depth > maxDepth || entries.length >= maxFiles || totalLines >= maxTotalLines) return;
    let list;
    try { list = readdirSync(dir); } catch { return; }

    for (const name of list) {
      if (entries.length >= maxFiles || totalLines >= maxTotalLines) break;
      if (name.startsWith('.')) continue;

      const full = join(dir, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
      } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(name).toLowerCase())) {
        filesScanned++;
        try {
          const content = readFileSync(full, 'utf-8');
          const lang = detectLanguage(full);
          const outline = generateOutline(content, lang);
          const relPath = relative(root, full);
          const syms = outline.slice(0, 8).map(s => `${s.name}:${s.line}`);
          if (outline.length > 8) syms.push(`…+${outline.length - 8} more`);

          const lineCount = syms.length + 1;
          if (totalLines + lineCount <= maxTotalLines) {
            entries.push({ file: relPath, lang, symbols: syms, totalDecls: outline.length });
            totalLines += lineCount;
          }
        } catch { /* unreadable file, skip */ }
      }
    }
  }

  walk(root, 0);
  entries.sort((a, b) => a.file.localeCompare(b.file));

  return {
    status: 'ok',
    mode: 'project',
    file: relative(cwd(), root) || '.',
    totalFiles: filesScanned,
    mappedFiles: entries.length,
    estimatedTokens: totalLines * 3,
    data: entries,
  };
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export class SmartReader {
  constructor(options = {}) {
    this._options = options;
  }

  /**
   * Read a file with progressive detail.
   *
   * @param {object} opts
   * @param {string} opts.filePath - Absolute or relative path (or files[] for batch)
   * @param {string} [opts.mode='auto'] - 'auto'|'outline'|'signatures'|'symbol'|'range'|'full'|'batch'
   * @param {string} [opts.symbol] - Symbol name (required for mode:'symbol')
   * @param {string} [opts.root] - Project root (for relative paths)
   * @param {number} [opts.maxLines] - Max lines for full mode (default: 2000)
   * @param {number} [opts.offset] - Line offset for full mode (1-indexed)
   * @param {number} [opts.limit] - Line limit for full mode
   * @param {string} [opts.lang] - Force language (auto-detect if not provided)
   * @param {number} [opts.startLine] - Start line for range mode (1-indexed)
   * @param {number} [opts.endLine] - End line for range mode (1-indexed, inclusive)
   * @param {string[]} [opts.files] - File paths for batch mode
   * @param {object} [opts.thresholds] - Auto-mode thresholds: {full, signatures}
   * @returns {{ status, mode, file, lang, lines, totalLines, data, error?, checksum? }}
   */
  async read(opts) {
    const root = opts.root || cwd();
    const mode = opts.mode || 'auto';

    // ── Batch mode: read multiple files ──
    if (mode === 'batch') {
      return this.readBatch(opts);
    }

    // ── Project mode: build symbol map ──
    if (mode === 'project') {
      const projectRoot = opts.filePath ? resolve(root, opts.filePath) : root;
      return buildProjectMap(projectRoot, opts);
    }

    const filePath = resolve(root, opts.filePath);

    if (!existsSync(filePath)) {
      return {
        status: 'error',
        error: `File not found: ${opts.filePath}`,
        mode,
        file: opts.filePath,
      };
    }

    // Handle directory paths
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return listDirectory(filePath, root, opts);
    }

    // Handle image files — return base64 + mimeType for MCP image content
    if (isImageFile(filePath)) {
      const img = readImageAsBase64(filePath);
      return {
        _imageContent: true,
        status: 'ok',
        mode: 'image',
        file: opts.filePath,
        data: img.data,
        mimeType: img.mimeType,
        sizeBytes: stat.size,
      };
    }

    const content = readFull(filePath);
    const totalLines = content.split('\n').length;
    const lang = opts.lang || detectLanguage(filePath);

    const result = {
      status: 'ok',
      mode,
      file: opts.filePath,
      lang,
      totalLines,
    };

    try {
      switch (mode) {
        // ── Auto: select best mode by file size ──
        case 'auto': {
          const thresholds = opts.thresholds || {};
          const fullThreshold = thresholds.full ?? 50;
          const sigThreshold = thresholds.signatures ?? 300;
          const autoMode = totalLines < fullThreshold ? 'full'
            : totalLines < sigThreshold ? 'signatures'
            : 'outline';
          // Re-call with determined mode (OS cache makes re-read negligible)
          return this.read({ ...opts, mode: autoMode });
        }

        // ── Outline: function/class/variable declarations ──
        case 'outline': {
          const outline = generateOutline(content, lang);
          const lines = countLinesForOutline(outline);
          result.data = outline;
          result.lines = lines;
          break;
        }

        // ── Signatures: outline + signature lines + ranges ──
        case 'signatures': {
          const signatures = generateSignatures(content, lang);
          const lines = countLinesForSignatures(signatures);
          result.data = signatures;
          result.lines = lines;
          break;
        }

        // ── Symbol: extract one symbol's full body ──
        case 'symbol': {
          if (!opts.symbol) {
            return { ...result, status: 'error', error: 'symbol name required for symbol mode' };
          }
          const symbolData = extractSymbol(content, lang, opts.symbol);
          if (!symbolData) {
            return { ...result, status: 'error', error: `Symbol "${opts.symbol}" not found`, data: null };
          }
          const lines = content.split('\n');
          const symbolLines = lines.slice(symbolData.lineStart - 1, symbolData.lineEnd);
          const lineCount = symbolLines.length;
          result.data = symbolData;
          result.lines = lineCount;
          break;
        }

        // ── Explain: symbol + imports + callers ──
        case 'explain': {
          if (!opts.symbol) {
            return { ...result, status: 'error', error: 'symbol name required for explain mode' };
          }
          const symbolData = extractSymbol(content, lang, opts.symbol);
          if (!symbolData) {
            return { ...result, status: 'error', error: `Symbol "${opts.symbol}" not found` };
          }
          // Extract dependencies
          const imports = extractImports(content, lang);
          const callers = extractCallers(content, symbolData, lang);
          result.data = {
            name: symbolData.name,
            type: symbolData.type,
            lineStart: symbolData.lineStart,
            lineEnd: symbolData.lineEnd,
            signature: symbolData.signature,
            body: symbolData.body,
            imports,
            callers,
          };
          result.lines = (symbolData.body || '').split('\n').length + imports.length + callers.length;
          break;
        }

        // ── Range: read specific line range ──
        case 'range': {
          const lines = content.split('\n');
          const startLine = opts.startLine || 1;
          const endLine = opts.endLine || Math.min(startLine + 100, lines.length);
          const clampEnd = Math.min(endLine, lines.length);
          const slice = lines.slice(startLine - 1, clampEnd);
          const numbered = opts.numbered !== false;
          result.data = numbered
            ? slice.map((line, i) => `${startLine + i}: ${line}`).join('\n')
            : slice.join('\n');
          result.lines = slice.length;
          result.offset = startLine;
          result.limit = clampEnd;
          result.numbered = numbered;
          result.checksum = hashContent(slice.join('\n'));
          break;
        }

        // ── List: show directory or file info ──
        case 'list': {
          if (!stat.isDirectory()) {
            result.data = [{ name: basename(filePath), type: 'file', size: stat.size }];
            result.lines = 1;
          }
          break;
        }

        // ── Full: traditional complete read ──
        case 'full': {
          const lines = content.split('\n');
          const offset = opts.offset || 1;
          const limit = opts.limit || lines.length;
          const maxLines = opts.maxLines || 2000;
          const numbered = opts.numbered !== false;

          const slice = lines.slice(offset - 1, offset - 1 + Math.min(limit, maxLines));
          result.data = numbered
            ? slice.map((line, i) => `${offset + i}: ${line}`).join('\n')
            : slice.join('\n');
          result.lines = slice.length;
          result.offset = offset;
          result.limit = Math.min(limit, maxLines);
          result.numbered = numbered;
          result.checksum = hashContent(content);
          break;
        }

        default: {
          return { ...result, status: 'error', error: `Unknown mode: ${mode}. Use auto|outline|signatures|symbol|explain|range|full|batch|list|project` };
        }
      }
    } catch (err) {
      return { ...result, status: 'error', error: err.message };
    }

    return result;
  }

  /**
   * Batch read multiple files in one call.
   * Each entry in opts.files can be a string (path) or object ({filePath, mode?, symbol?, ...}).
   * Results ordered same as input; error entries included per-file.
   */
  async readBatch(opts) {
    const entries = opts.files || (opts.filePath ? [opts.filePath] : []);
    if (entries.length === 0) {
      return {
        status: 'error',
        mode: 'batch',
        error: 'No files specified. Use files:["file1","file2"] or set mode differently.',
        results: [],
      };
    }

    const results = [];
    for (const entry of entries) {
      const entryOpts = typeof entry === 'string'
        ? { filePath: entry, mode: opts.entryMode || opts.mode || 'auto', root: opts.root }
        : { ...entry, root: opts.root };

      const r = await this.read(entryOpts);
      results.push(r);
    }

    const okCount = results.filter(r => r.status === 'ok').length;
    return {
      status: 'ok',
      mode: 'batch',
      file: opts.filePath || entries.join(', '),
      totalFiles: entries.length,
      okCount,
      errorCount: entries.length - okCount,
      results,
    };
  }
}

// ---------------------------------------------------------------------------
// Line count estimates for token-aware reporting
// ---------------------------------------------------------------------------

function countLinesForOutline(outline) {
  // Each entry: "  name (type) :line" = ~3 lines output per entry
  return outline.length * 3 + 2;
}

function countLinesForSignatures(signatures) {
  // Each entry: "  name (type) :lineN-lineM" + signature = variable
  let total = 2;
  for (const s of signatures) {
    const sigLines = (s.signature || '').split('\n').length;
    total += 2 + sigLines;
  }
  return total;
}

// ---------------------------------------------------------------------------
// SmartReadPlugin integration helper
// ---------------------------------------------------------------------------

/**
 * Register smart_read into the hybrid-engine DOMAIN_MAP.
 */
export function getDomainEntry() {
  return {
    name: 'smart_read',
    description: 'Progressive file reading: outline, signatures, symbol, or full',
    tools: ['smart_read'],
    confidence: 1.0,
  };
}

export default SmartReader;
