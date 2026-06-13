// smart-read.mjs → smart_read (via smart_smart_run router)
// Phase 23: Enhanced progressive file reading
//
// 七種模式：
//   auto       — 依檔案大小自動選模式（新預設！<50 full, 50-300 sig, >300 outline）
//   outline    — 只看檔案結構函式/類別/變數宣告（5-20 lines for a 500-line file）
//   signatures — 結構 + 簽名行 + 行範圍（10-40 lines）
//   symbol     — 只抽取特定 symbol 的完整 body（精準定位）
//   range      — 讀取指定行範圍（startLine/endLine）
//   full       — 傳統完整讀取（fallback），支援 offset/limit 分頁
//   batch      — 一次讀取多個檔案
//
// 輸出格式：
//   text     — 完整人類可讀（含 emoji + 分隔線 + tip）🥇 default
//   compact  — Token 最小化輸出（無 emoji、無裝飾）🥈
//   json     — 結構化資料
//
// 路由原則（更新版）：
//   - 了解檔案結構 → auto（新預設！自動選最佳模式）
//   - 了解檔案結構（強制）→ outline
//   - 需要簽名細節   → signatures
//   - 需要特定函式實作內容 → symbol
//   - 需要某段行範圍 → range
//   - 需要完整內容   → full
//   - 一次看多個檔案 → batch

import { SmartReader, detectLanguage, getDomainEntry, hashContent } from '../../lib/smart-read.mjs';

export default {
  name: 'smart_read',
  category: 'standard',
  description: `Progressive file reader — saves 60-80% read tokens vs raw read.

  🥇 auto      — Smart mode selection by file size (<50 full, 50-300 sig, >300 outline) ← default
  📋 outline   — File structure: function/class/variable declarations with line numbers
  📝 signatures — Structure + signature text + line ranges (lineStart-lineEnd)
  🔍 symbol    — Extract a specific symbol's full body (by name)
  📏 range     — Read a specific line range (startLine/endLine)
  📄 full      — Traditional full read, supports offset/limit paging
  📚 batch     — Read multiple files in one call (files:["f1.ts","f2.ts"])

  Output formats: text (default), compact (no emoji/dividers), json

  Examples:
    { file:"src/auth.ts" }
      → auto-detect: <50 lines (full), 50-300 (signatures), >300 (outline)

    { mode:"range", file:"src/auth.ts", startLine:10, endLine:30 }
      → Lines 10-30 with line numbers, plus content checksum

    { mode:"batch", files:["src/a.ts","src/b.ts"] }
      → Reads both files in one call, each auto-modulated

    { mode:"full", file:"src/auth.ts", offset:1, limit:100, format:"compact" }
      → Minimal token output, no decorative characters`,
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (relative to root or absolute)',
      },
      mode: {
        type: 'string',
        enum: ['auto', 'outline', 'signatures', 'symbol', 'range', 'full', 'batch', 'list'],
        description: 'Read mode (default: auto)',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name to extract (required for mode:symbol)',
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
  responsePolicy: { maxLevel: 0 }, // Lossless — symbol body must be exact
  handler: async (args) => {
    try {
      const format = args.format || 'text';
      const reader = new SmartReader();

      // Batch mode: pass files array
      const readOpts = args.mode === 'batch'
        ? {
            filePath: args.file,
            mode: 'batch',
            files: args.files,
            root: args.root,
            entryMode: args.entryMode,
          }
        : {
            filePath: args.file,
            mode: args.mode || 'auto',
            symbol: args.symbol,
            root: args.root,
            offset: args.offset,
            limit: args.limit,
            startLine: args.startLine,
            endLine: args.endLine,
            lang: args.lang,
            numbered: args.numbered,
          };

      const result = await reader.read(readOpts);

      if (format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      if (format === 'compact') {
        return formatCompact(result, args);
      }

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
            // Show first/last few lines
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
  }

  // Token-saving tip (only in text mode)
  if (mode === 'outline' || mode === 'signatures') {
    text += `\n${'─'.repeat(60)}`;
    text += `\n💡 Tip: use mode:"symbol" + symbol:"name" for a specific function.`;
    text += `\n   use mode:"full" for traditional read.`;
    text += `\n   use mode:"range" for a line range.`;
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

    default:
      return `[${result.mode}] ${file} (${lang}, ${total} lines)\n${result.data || ''}`;
  }
}
