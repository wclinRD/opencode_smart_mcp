// smart-read.mjs → smart_read (native tool, direct call — no router)
// Phase 24: Session cache + explain + project map
//
// 九種模式：
//   auto       — 依檔案大小自動選模式（<50 full, 50-300 sig, >300 outline）
//   outline    — 檔案結構函式/類別/變數宣告
//   signatures — 結構 + 簽名行 + 行範圍
//   symbol     — 只抽取特定 symbol 的完整 body
//   explain    — symbol + imports + callers 一次取得 🆕
//   range      — 指定行範圍（startLine/endLine）+ checksum
//   full       — 傳統完整讀取，支援 offset/limit 分頁
//   batch      — 一次讀取多個檔案
//   project    — 專案符號地圖（<500 tokens）🆕
//
// 輸出格式：text / compact / json
//
// Session Memory Cache（🆕）：同一 session 內未更改檔案零磁碟讀取
//
// 路由原則：
//   - 快速了解專案   → project（全新！一次看整個 codebase）
//   - 了解檔案結構   → auto（預設）
//   - 需要特定函式   → symbol
//   - 需函式+依賴   → explain（取代 symbol→grep imports→grep callers）
//   - 需要行範圍     → range
//   - 一次看多檔     → batch

import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { SmartReader, hashContent } from '../../lib/smart-read.mjs';

// =========================================================================
// Session Memory Cache — 零磁碟重複讀取
// =========================================================================

const _readCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 500;

function getCacheKey(filePath, opts) {
  const mode = opts.mode || 'auto';
  let key = `${filePath}|${mode}`;
  if (mode === 'symbol' || mode === 'explain') key += `|${opts.symbol || ''}`;
  if (mode === 'range') key += `|${opts.startLine || 1}-${opts.endLine || ''}`;
  if (mode === 'full') key += `|${opts.offset || 1}-${opts.limit || ''}`;
  return key;
}

function cacheWrap(reader, filePath, opts) {
  const key = getCacheKey(filePath, opts);
  try {
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      const cached = _readCache.get(key);
      if (cached && cached.mtime === stat.mtimeMs && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.result;
      }
    }
  } catch { /* ignore perms issues */ }

  // Cache miss: read fresh (async or sync)
  const raw = reader.read(opts);
  if (raw instanceof Promise) {
    return raw.then(result => {
      if (result?._imageContent) return result; // don't cache images (too large)
      storeInCache(key, filePath, result);
      return result;
    });
  }
  if (raw?._imageContent) return raw; // don't cache images
  storeInCache(key, filePath, raw);
  return raw;
}

function storeInCache(key, filePath, result) {
  try {
    if (existsSync(filePath) && result?.status === 'ok') {
      const stat = statSync(filePath);
      _readCache.set(key, { mtime: stat.mtimeMs, result, timestamp: Date.now() });
      // Evict oldest entries when over limit (FIFO — simplest, no LRU overhead)
      if (_readCache.size > MAX_CACHE_ENTRIES) {
        const entries = [..._readCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toEvict = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
        for (const [k] of toEvict) _readCache.delete(k);
      }
    }
  } catch { /* ignore */ }
}

// =========================================================================
// Plugin Export
// =========================================================================

export default {
  name: 'smart_read',
  category: 'core',
  description: `Progressive file reader — FULLY replaces raw read (text + dirs + images).
  Session cache: same file unchanged = zero disk reads.

  🥇 auto      — Smart mode by file size (<50 full, 50-300 sig, >300 outline)
  📋 outline   — Structure: function/class/variable declarations + line numbers
  📝 signatures — Structure + signature text + line ranges
  🔍 symbol    — Extract specific symbol full body (by name)
  🧠 explain   — Symbol + imports + callers in one call
  📏 range     — Specific line range (startLine/endLine) + checksum
  📄 full      — Traditional full read, offset/limit paging
  📚 batch     — Read multiple files in one call
  🗺  project   — Project symbol map <500 tokens
  🖼  image     — PNG/JPG/GIF/WebP returned as viewable attachment
  📁 directory  — Auto-detected, returns sorted listing

  Output: text (default), compact, json
  Session cache: repeat reads = zero disk I/O`,

  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (relative to root or absolute)',
      },
      mode: {
        type: 'string',
        enum: ['auto', 'outline', 'signatures', 'symbol', 'explain', 'range', 'full', 'batch', 'list', 'project', 'image'],
        description: 'Read mode (default: auto)',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name (required for mode:symbol | explain)',
      },
      root: {
        type: 'string',
        description: 'Project root (default: cwd)',
      },
      offset: {
        type: 'number',
        description: 'Starting line (1-indexed, for full mode)',
      },
      limit: {
        type: 'number',
        description: 'Max lines to read (for full/range mode)',
      },
      startLine: {
        type: 'number',
        description: 'Start line (1-indexed, for range mode)',
      },
      endLine: {
        type: 'number',
        description: 'End line (1-indexed, inclusive, for range mode)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths for batch mode',
      },
      depth: {
        type: 'number',
        description: 'Max depth for project mode (default: 4)',
      },
      maxFiles: {
        type: 'number',
        description: 'Max files for project mode (default: 40)',
      },
      lang: {
        type: 'string',
        description: 'Force language (auto-detect if not provided)',
      },
      format: {
        type: 'string',
        enum: ['text', 'compact', 'json'],
        description: 'Output format (default: text)',
      },
      numbered: {
        type: 'boolean',
        description: 'Include line numbers (full/range mode, default: true)',
      },
    },
  },
  responsePolicy: { maxLevel: 0 },
  handler: async (args) => {
    try {
      const format = args.format || 'text';
      const root = args.root || cwd();
      const reader = new SmartReader();

      // Project mode: no file parameter needed
      if (args.mode === 'project') {
        const result = await reader.read({ filePath: root, mode: 'project', depth: args.depth, maxFiles: args.maxFiles });
        if (result._imageContent) return result;
        if (format === 'json') return JSON.stringify(result, null, 2);
        if (format === 'compact') return formatCompact(result, args);
        return formatOutput(result, args);
      }

      // Batch mode (with session cache via batch cache key)
      if (args.mode === 'batch') {
        // Build batch cache key from all files + root
        const batchFiles = args.files || [];
        const batchKey = `batch|${root}|${batchFiles.join(',')}`;
        const cached = _readCache.get(batchKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.result;

        const result = await reader.readBatch({
          filePath: args.file,
          mode: 'batch',
          files: args.files,
          root,
          entryMode: args.entryMode,
        });
        if (result.status === 'ok') {
          _readCache.set(batchKey, { mtime: Date.now(), result, timestamp: Date.now() });
        }
        if (result._imageContent) return result;
        if (format === 'json') return JSON.stringify(result, null, 2);
        if (format === 'compact') return formatCompact(result, args);
        return formatOutput(result, args);
      }

      // Standard file modes (with session cache)
      if (!args.file) {
        return JSON.stringify({ status: 'error', error: 'file parameter required', mode: args.mode || 'auto' }, null, 2);
      }

      const filePath = resolve(root, args.file);

      // Resolve auto mode at plugin level so cacheWrap gets concrete mode
      // (the lib's auto-mode recursion bypasses the session cache)
      let resolvedMode = args.mode || 'auto';
      if (resolvedMode === 'auto' && existsSync(filePath)) {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          const content = readFileSync(filePath, 'utf-8');
          const totalLines = content.split('\n').length;
          if (totalLines < 50) resolvedMode = 'full';
          else if (totalLines < 300) resolvedMode = 'signatures';
          else resolvedMode = 'outline';
        }
      }

      const readOpts = {
        filePath: args.file,
        mode: resolvedMode,
        symbol: args.symbol,
        root,
        offset: args.offset,
        limit: args.limit,
        startLine: args.startLine,
        endLine: args.endLine,
        lang: args.lang,
        numbered: args.numbered,
      };

      // Session cache: skip disk read if file unchanged
      const result = await cacheWrap(reader, filePath, readOpts);

      // Image content — return raw _imageContent for server to construct MCP image response
      if (result._imageContent) return result;

      if (format === 'json') return JSON.stringify(result, null, 2);
      if (format === 'compact') return formatCompact(result, args);
      return formatOutput(result, args);
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: err.message,
        mode: args.mode || 'auto',
        file: args.file,
      }, null, 2);
    }
  },
};

// =========================================================================
// Output Formatters
// =========================================================================

/**
 * Format smart_read output as human-readable text (default).
 */
function formatOutput(result, args) {
  if (result.status === 'error') {
    return `╳ smart_read error\n${'─'.repeat(50)}\nFile: ${result.file}\nMode: ${result.mode}\nError: ${result.error}\n`;
  }

  let text = '';
  const mode = result.mode;
  const file = result.file;

  switch (mode) {
    case 'outline': {
      text = `📋 Outline: ${file} (${result.lang}, ${result.totalLines} total, ~${result.lines} out)\n`;
      text += `${'─'.repeat(60)}\n`;
      if (!result.data || result.data.length === 0) {
        text += '(no declarations found)\n';
        return text;
      }
      let lastType = '';
      for (const entry of result.data) {
        if (entry.type !== lastType) {
          text += `\n  ${entry.type}s:\n`;
          lastType = entry.type;
        }
        text += `    ${entry.name}  :${entry.line}\n`;
      }
      break;
    }

    case 'signatures': {
      text = `📝 Signatures: ${file} (${result.lang}, ${result.totalLines} total, ~${result.lines} out)\n`;
      text += `${'─'.repeat(60)}\n`;
      if (!result.data || result.data.length === 0) {
        text += '(no declarations found)\n';
        return text;
      }
      for (const entry of result.data) {
        const range = entry.lineStart === entry.lineEnd
          ? `:${entry.lineStart}`
          : `:${entry.lineStart}-${entry.lineEnd}`;
        text += `\n  ${entry.type} ${entry.name} ${range}\n`;
        if (entry.signature) {
          for (const sigLine of entry.signature.split('\n')) {
            text += `    ${sigLine}\n`;
          }
        }
      }
      break;
    }

    case 'symbol': {
      if (!result.data) {
        return `🔍 Symbol not found: ${args.symbol} in ${file}\n`;
      }
      text = `🔍 Symbol: ${result.data.name} (${result.data.type}) in ${file}\n`;
      text += `    Line: ${result.data.lineStart}-${result.data.lineEnd}\n`;
      text += `${'─'.repeat(60)}\n`;
      text += result.data.body;
      text += '\n';
      break;
    }

    case 'range': {
      text = `📏 ${file} (${result.totalLines} total, showing ${result.offset}-${result.limit})\n`;
      text += `${'─'.repeat(60)}\n`;
      text += result.data;
      if (result.checksum) {
        text += `\n${'─'.repeat(60)}`;
        text += `\n🔐 checksum: ${result.checksum}`;
      }
      break;
    }

    case 'full': {
      text = `📄 ${file} (${result.lang}, ${result.totalLines} total`;
      if (result.offset) text += `, showing ${result.offset}-${result.offset + result.lines - 1}`;
      text += `)\n`;
      text += `${'─'.repeat(60)}\n`;
      text += result.data;
      if (result.totalLines > result.lines) {
        text += `\n${'─'.repeat(60)}`;
        text += `\n... ${result.totalLines - result.lines} more lines. Use offset/limit to read more.\n`;
      }
      if (result.checksum) {
        text += `\n🔐 checksum: ${result.checksum}`;
      }
      break;
    }

    case 'list': {
      if (result.isDirectory) {
        text = `📁 ${file}/\n${'─'.repeat(60)}\n`;
        for (const entry of (result.data || [])) {
          text += `  ${entry}\n`;
        }
        text += `\n${result.totalEntries} entries`;
      } else {
        text = `📄 ${file}\n${'─'.repeat(60)}\n`;
      }
      return text;
    }

    case 'batch': {
      text = `📚 Batch read: ${result.okCount}/${result.totalFiles} files ok\n`;
      text += `${'─'.repeat(60)}\n`;
      for (const r of (result.results || [])) {
        text += `\n${r.status === 'ok' ? '✅' : '╳'} ${r.file} (${r.mode}, ${r.lines || 0} lines)\n`;
        if (r.status === 'ok') {
          if (Array.isArray(r.data)) {
            text += `     ${r.data.length} declarations\n`;
          } else if (typeof r.data === 'string') {
            const lines = r.data.split('\n');
            const preview = lines.length <= 6 ? r.data : lines.slice(0, 3).join('\n') + '\n     ...\n';
            text += `     ${preview.replace(/\n/g, '\n     ')}\n`;
          }
        } else {
          text += `     Error: ${r.error}\n`;
        }
      }
      return text;
    }

    // ── Explain: symbol + imports + callers ──
    case 'explain': {
      if (!result.data) {
        return `🧠 Symbol not found: ${args.symbol} in ${file}\n`;
      }
      const d = result.data;
      text = `🧠 ${d.name} (${d.type}) in ${file}\n`;
      text += `    Line ${d.lineStart}-${d.lineEnd}\n`;
      text += `${'─'.repeat(60)}\n`;

      // Imports section
      if (d.imports && d.imports.length > 0) {
        text += `\n  Imports:\n`;
        for (const imp of d.imports) {
          text += `    :${imp.line}  ${imp.text}\n`;
        }
      }

      // Body
      text += `\n  Body:\n`;
      text += `${'─'.repeat(40)}\n`;
      text += d.body + '\n';

      // Callers section
      if (d.callers && d.callers.length > 0) {
        text += `\n  Callers in this file:\n`;
        for (const c of d.callers) {
          text += `    :${c.line}  ${c.text}\n`;
        }
      } else {
        text += `\n  (no internal callers found)\n`;
      }
      break;
    }

    // ── Project map ──
    case 'project': {
      text = `🗺  Project map: ${result.file}\n`;
      text += `${'─'.repeat(60)}\n`;
      text += `  ${result.mappedFiles}/${result.totalFiles} code files, ~${result.estimatedTokens} tokens\n\n`;
      for (const entry of (result.data || [])) {
        text += `  📄 ${entry.file} (${entry.lang})\n`;
        for (const sym of entry.symbols) {
          text += `    ${sym}\n`;
        }
        text += '\n';
      }
      if (result.totalFiles > result.mappedFiles) {
        text += `  ... ${result.totalFiles - result.mappedFiles} more files (use depth/maxFiles to expand)\n`;
      }
      return text;
    }
  }

  // Token-saving tip
  if (mode === 'outline' || mode === 'signatures') {
    text += `\n${'─'.repeat(60)}`;
    text += `\n💡 Tip: mode:"symbol" for a specific function.`;
    text += `\n   mode:"explain" for symbol + imports + callers.`;
    text += `\n   mode:"project" for whole-repo map.`;
  }

  return text;
}

/**
 * Format smart_read output in compact mode (zero decorative chars, minimal tokens).
 * Suitable for token-budget-tight contexts.
 */
function formatCompact(result, args) {
  if (result.status === 'error') {
    return `[error] ${result.file}: ${result.error}`;
  }

  const file = result.file;
  const lang = result.lang || '?';
  const total = result.totalLines || 0;

  switch (result.mode) {
    case 'outline': {
      if (!result.data || result.data.length === 0) return `[outline] ${file} -- empty`;
      const lines = result.data.map(e => `  ${e.type} ${e.name} :${e.line}`);
      return `[outline] ${file} (${lang}, ${total} lines, ${result.data.length} decls)\n${lines.join('\n')}`;
    }

    case 'signatures': {
      if (!result.data || result.data.length === 0) return `[sig] ${file} -- empty`;
      const lines = result.data.map(e => {
        const r = e.lineStart === e.lineEnd ? `:${e.lineStart}` : `:${e.lineStart}-${e.lineEnd}`;
        return `  ${e.type} ${e.name} ${r}\n    ${(e.signature || '').replace(/\n/g, '\n    ')}`;
      });
      return `[sig] ${file} (${lang}, ${total} lines, ${result.data.length} decls)\n${lines.join('\n')}`;
    }

    case 'symbol': {
      if (!result.data) return `[symbol] ${file} -- not found: ${args.symbol}`;
      return `[symbol] ${file} -- ${result.data.name} (${result.data.type}) L${result.data.lineStart}-${result.data.lineEnd}\n${result.data.body}`;
    }

    case 'range': {
      const label = result.offset ? ` L${result.offset}-${result.limit}` : '';
      const ck = result.checksum ? ` | cksum:${result.checksum}` : '';
      return `[range] ${file}${label} (${result.lines} lines)${ck}\n${result.data}`;
    }

    case 'full': {
      const label = result.offset ? ` L${result.offset}-${result.offset + result.lines - 1}` : '';
      const ck = result.checksum ? ` | cksum:${result.checksum}` : '';
      const more = result.totalLines > result.lines ? ` | +${result.totalLines - result.lines} more` : '';
      return `[full] ${file}${label} (${result.lines}/${total} lines)${ck}${more}\n${result.data}`;
    }

    case 'list': {
      if (result.isDirectory) {
        return `[list] ${file}/\n  ${(result.data || []).join('\n  ')}\n  (${result.totalEntries} entries)`;
      }
      return `[list] ${file}`;
    }

    case 'batch': {
      const parts = (result.results || []).map(r =>
        `${r.status === 'ok' ? '+' : '-'} ${r.file} (${r.mode}, ${r.lines || 'err'} lines)`
      );
      return `[batch] ${result.okCount}/${result.totalFiles} ok\n${parts.join('\n')}`;
    }

    case 'explain': {
      if (!result.data) return `[explain] ${file} -- not found: ${args.symbol}`;
      const d = result.data;
      let out = `[explain] ${file} -- ${d.name} (${d.type}) L${d.lineStart}-${d.lineEnd}`;
      if (d.imports && d.imports.length > 0) {
        out += `\n  imports: ${d.imports.map(i => i.text).join('; ')}`;
      }
      out += `\n${d.body}`;
      if (d.callers && d.callers.length > 0) {
        out += `\n  callers: ${d.callers.map(c => `${c.text} (:${c.line})`).join('; ')}`;
      }
      return out;
    }

    case 'project': {
      if (!result.data || result.data.length === 0) return `[project] ${result.file} -- empty`;
      const lines = result.data.map(e =>
        `  ${e.file} (${e.lang}): ${e.symbols.join(', ')}`
      );
      return `[project] ${result.file} (${result.mappedFiles}/${result.totalFiles} files, ~${result.estimatedTokens} tok)\n${lines.join('\n')}`;
    }

    default:
      return `[${result.mode}] ${file} (${lang}, ${total} lines)\n${result.data || ''}`;
  }
}
