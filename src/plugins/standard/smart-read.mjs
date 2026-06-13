// smart-read.mjs → smart_read (via smart_smart_run router)
// Phase 21: Progressive file reading — 取代 raw read，省 60-80% read token
//
// 四種模式：
//   outline    — 只看檔案結構函式/類別/變數宣告（5-20 lines for a 500-line file）
//   signatures — 結構 + 簽名行 + 行範圍（10-40 lines）
//   symbol     — 只抽取特定 symbol 的完整 body（精準定位）
//   full       — 傳統完整讀取（fallback），支援 offset/limit 分頁
//
// 路由原則：
//   - 了解檔案結構 → outline（最省 token）
//   - 需要簽名細節 → signatures
//   - 需要特定函式實作內容 → symbol
//   - 需要完整內容 → full

import { SmartReader, detectLanguage, getDomainEntry } from '../../lib/smart-read.mjs';

export default {
  name: 'smart_read',
  category: 'standard',
  description: `Progressive file reader — saves 60-80% read tokens vs raw read.

  🥇 outline    — File structure: function/class/variable declarations with line numbers
  🥈 signatures — Structure + signature text + line ranges (lineStart-lineEnd)
  🥉 symbol     — Extract a specific symbol's full body (by name)
  📄 full       — Traditional full read (fallback), supports offset/limit paging

  Examples:
    { mode: "outline", file: "src/auth.ts" }
      → Lists all functions, classes, interfaces with line numbers

    { mode: "signatures", file: "src/auth.ts" }
      → Same as outline but includes function signature text

    { mode: "symbol", file: "src/auth.ts", symbol: "authenticate" }
      → Returns only the authenticate() function body

    { mode: "full", file: "src/auth.ts", offset: 1, limit: 100 }
      → Traditional read with paging`,
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (relative to root or absolute)',
      },
      mode: {
        type: 'string',
        enum: ['outline', 'signatures', 'symbol', 'full'],
        description: 'Read mode (default: outline)',
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
        description: 'Max lines to read (for full mode, default: 2000)',
      },
      lang: {
        type: 'string',
        description: 'Force language (auto-detect if not provided)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
    },
    required: ['file'],
  },
  responsePolicy: { maxLevel: 0 }, // Lossless — symbol body must be exact
  handler: async (args) => {
    try {
      const format = args.format || 'text';
      const reader = new SmartReader();
      const result = await reader.read({
        filePath: args.file,
        mode: args.mode || 'outline',
        symbol: args.symbol,
        root: args.root,
        offset: args.offset,
        limit: args.limit,
        lang: args.lang,
      });

      if (format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      return formatOutput(result, args);
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: err.message,
        mode: args.mode || 'outline',
        file: args.file,
      }, null, 2);
    }
  },
};

/**
 * Format smart_read output as human-readable text.
 */
function formatOutput(result, args) {
  if (result.status === 'error') {
    let text = `⚠️  smart_read error\n`;
    text += `${'─'.repeat(50)}\n`;
    text += `File: ${result.file}\n`;
    text += `Mode: ${result.mode}\n`;
    text += `Error: ${result.error}\n`;
    return text;
  }

  let text = '';
  const mode = result.mode;
  const file = result.file;

  switch (mode) {
    case 'outline': {
      text = `📋 Outline: ${file} (${result.lang}, ${result.totalLines} total lines, ~${result.lines} output lines)\n`;
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
      text = `📝 Signatures: ${file} (${result.lang}, ${result.totalLines} total lines, ~${result.lines} output lines)\n`;
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
        text = `🔍 Symbol not found: ${args.symbol} in ${file}\n`;
        return text;
      }
      text = `🔍 Symbol: ${result.data.name} (${result.data.type}) in ${file}\n`;
      text += `    Line: ${result.data.lineStart}-${result.data.lineEnd}\n`;
      text += `${'─'.repeat(60)}\n`;
      text += result.data.body;
      text += '\n';
      break;
    }

    case 'full': {
      text = `📄 ${file} (${result.lang}, ${result.totalLines} total lines`;
      if (result.offset) text += `, showing ${result.offset}-${result.offset + result.lines - 1}`;
      text += `)\n`;
      text += `${'─'.repeat(60)}\n`;
      text += result.data;
      if (result.totalLines > result.lines) {
        text += `\n${'─'.repeat(60)}`;
        text += `\n... ${result.totalLines - result.lines} more lines. Use offset/limit to read more.\n`;
      }
      break;
    }
  }

  // Token-saving tip
  if (mode === 'outline' || mode === 'signatures') {
    text += `\n${'─'.repeat(60)}`;
    text += `\n💡 Tip: use mode:"symbol" + symbol:"name" to read a specific function body.`;
    text += `\n   use mode:"full" for the traditional full read.`;
  }

  return text;
}
