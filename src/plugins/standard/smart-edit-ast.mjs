// smart-edit-ast.mjs → smart_edit_ast (via smart_smart_run router)
// Phase 22: AST-aware editing — 比 smart_edit 更精確的編輯工具
//
// 三種模式：
//   content-match — 上下文感知取代（比 exact string match 更容錯）
//   block-boundary — 行區塊編輯（在指定行區間 insert/replace/delete）
//   symbol-edit — 在特定 symbol body 內編輯（結合 smart_read 定位）
//
// 路由原則：
//   - 知道精確文字 → smart_edit（更輕量）
//   - 需要 context 感知 → smart_edit_ast content-match（更容錯）
//   - 精確行區間編輯 → smart_edit_ast block-boundary
//   - 對特定函式/類別內操作 → smart_edit_ast symbol-edit

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { cwd } from 'node:process';
import { extractSymbol } from '../../lib/smart-read.mjs';

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_edit_ast',
  category: 'standard',
  description: `AST-aware code editor — more precise than smart_edit.

  🥇 content-match — Context-aware replacement (whitespace-tolerant, shows surrounding code)
  🥈 block-boundary — Line-range editing (insert/replace/delete at line boundaries)
  🥉 symbol-edit — Edit within a specific symbol body (uses smart_read to locate)

  Examples:
    { mode: "content-match", file: "src/auth.ts", match: "function login", replace: "function login(credentials)" }
    { mode: "block-boundary", file: "src/auth.ts", action: "replace", startLine: 10, endLine: 15, text: "new code here" }
    { mode: "symbol-edit", file: "src/auth.ts", symbol: "authenticate", action: "append", text: "  console.log('called');" }`,
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (relative to root or absolute)',
      },
      mode: {
        type: 'string',
        enum: ['content-match', 'block-boundary', 'symbol-edit'],
        description: 'Edit mode (default: content-match)',
      },
      // content-match mode
      match: {
        type: 'string',
        description: 'Content to match (context-aware, trim-tolerant)',
      },
      replace: {
        type: 'string',
        description: 'Replacement content (for content-match mode)',
      },
      // block-boundary mode
      action: {
        type: 'string',
        enum: ['insert-before', 'insert-after', 'replace', 'delete'],
        description: 'Block action (for block-boundary mode)',
      },
      startLine: {
        type: 'number',
        description: 'Start line (1-indexed, for block-boundary mode)',
      },
      endLine: {
        type: 'number',
        description: 'End line (inclusive, for block-boundary replace/delete)',
      },
      text: {
        type: 'string',
        description: 'Text to insert (for block-boundary insert/replace)',
      },
      // symbol-edit mode
      symbol: {
        type: 'string',
        description: 'Symbol name to edit within (for symbol-edit mode)',
      },
      root: {
        type: 'string',
        description: 'Project root (default: cwd)',
      },
      apply: {
        type: 'boolean',
        description: 'Apply changes (default: false — dry run with diff)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
    },
    required: ['file'],
  },
  responsePolicy: { maxLevel: 0 }, // Lossless — edits must be exact
  handler: async (args) => {
    try {
      const root = resolve(args.root || cwd());
      const filePath = resolve(root, args.file);
      const mode = args.mode || 'content-match';
      const format = args.format || 'text';
      const apply = !!args.apply;

      if (!existsSync(filePath)) {
        return errorResult(`File not found: ${args.file}`, format, mode);
      }

      const original = readFileSync(filePath, 'utf-8');
      const lines = original.split('\n');

      let result;

      switch (mode) {
        case 'content-match':
          result = handleContentMatch(original, lines, args, filePath, root);
          break;
        case 'block-boundary':
          result = handleBlockBoundary(original, lines, args, filePath, root);
          break;
        case 'symbol-edit':
          result = handleSymbolEdit(original, lines, args, filePath, root);
          break;
        default:
          return errorResult(`Unknown mode: ${mode}`, format, mode);
      }

      // Apply if requested
      if (result.status === 'ok' && apply && result.modified !== false) {
        writeFileSync(filePath, result.content, 'utf-8');
        result.status = 'applied';
      }

      if (format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      return formatOutput(result, args);
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: err.message,
        mode: args.mode || 'content-match',
        file: args.file,
      }, null, 2);
    }
  },
};

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

/**
 * Content-match mode: context-aware replacement
 * Tolerant of whitespace differences, shows AST context.
 */
function handleContentMatch(original, lines, args, filePath, root) {
  if (!args.match) {
    return { status: 'error', error: 'match parameter required for content-match mode', mode: 'content-match' };
  }

  const searchStr = args.match.trim();
  const replacement = args.replace || '';
  const relPath = relative(root, filePath);

  // Try exact match first
  let idx = original.indexOf(searchStr);
  let matchedText = searchStr;

  // Try flexible matching (trim each line)
  if (idx === -1) {
    const originalLines = original.split('\n');
    const searchLines = searchStr.split('\n').map(l => l.trim());

    for (let i = 0; i < originalLines.length - searchLines.length + 1; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (originalLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Calculate exact index
        idx = 0;
        for (let k = 0; k < i; k++) {
          idx += originalLines[k].length + 1; // +1 for newline
        }
        // Build the exact matched text
        matchedText = lines.slice(i, i + searchLines.length).join('\n');
        break;
      }
    }
  }

  if (idx === -1) {
    return { status: 'error', error: `Content not found: "${searchStr.substring(0, 60)}..."`, mode: 'content-match' };
  }

  // Build context
  const matchLineNum = original.substring(0, idx).split('\n').length;
  const contextStart = Math.max(0, matchLineNum - 3);
  const contextEnd = Math.min(lines.length, matchLineNum + searchStr.split('\n').length + 3);
  const contextLines = lines.slice(contextStart, contextEnd);

  const newContent = original.replace(matchedText, replacement);
  const modified = newContent !== original;
  const relPathResolved = relative(root, filePath);

  return {
    status: modified ? 'ok' : 'unchanged',
    mode: 'content-match',
    file: relPathResolved,
    matchLine: matchLineNum,
    modified,
    lines: lines.length,
    diff: modified ? generateSimpleDiff(original, newContent) : '',
    content: newContent,
    context: {
      before: contextLines.slice(0, matchLineNum - contextStart).join('\n'),
      after: contextLines.slice(matchLineNum - contextStart + searchStr.split('\n').length).join('\n'),
    },
  };
}

/**
 * Block-boundary mode: edit at exact line boundaries
 */
function handleBlockBoundary(original, lines, args, filePath, root) {
  const action = args.action || 'replace';
  const relPath = relative(root, filePath);

  if (action === 'replace' || action === 'delete') {
    const startLine = args.startLine || 1;
    const endLine = args.endLine || startLine;

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      return {
        status: 'error',
        error: `Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`,
        mode: 'block-boundary',
      };
    }

    let newContent;
    if (action === 'replace') {
      const before = lines.slice(0, startLine - 1).join('\n');
      const after = lines.slice(endLine).join('\n');
      const middle = before.length > 0 && after.length > 0 ? '\n' : '';
      newContent = before + middle + (args.text || '') + (after.length > 0 ? '\n' + after : '');
    } else {
      // delete
      const before = lines.slice(0, startLine - 1).join('\n');
      const after = lines.slice(endLine).join('\n');
      newContent = before + (before.length > 0 && after.length > 0 ? '\n' : '') + after;
    }

    const modified = newContent !== original;

    return {
      status: modified ? 'ok' : 'unchanged',
      mode: 'block-boundary',
      file: relPath,
      action,
      startLine,
      endLine,
      modified,
      lines: lines.length,
      diff: modified ? generateSimpleDiff(original, newContent) : '',
      content: newContent,
    };
  }

  // insert-before or insert-after
  const targetLine = args.startLine || 1;
  if (targetLine < 1 || targetLine > lines.length) {
    return {
      status: 'error',
      error: `Invalid line: ${targetLine} (file has ${lines.length} lines)`,
      mode: 'block-boundary',
    };
  }

  const insertText = args.text || '';
  let newContent;
  if (action === 'insert-before') {
    const before = lines.slice(0, targetLine - 1).join('\n');
    const after = lines.slice(targetLine - 1).join('\n');
    newContent = before + (before.length > 0 ? '\n' : '') + insertText + '\n' + after;
  } else {
    // insert-after
    const before = lines.slice(0, targetLine).join('\n');
    const after = lines.slice(targetLine).join('\n');
    newContent = before + '\n' + insertText + (after.length > 0 ? '\n' + after : '');
  }

  const modified = newContent !== original;

  return {
    status: modified ? 'ok' : 'unchanged',
    mode: 'block-boundary',
    file: relPath,
    action,
    targetLine,
    modified,
    lines: lines.length,
    diff: modified ? generateSimpleDiff(original, newContent) : '',
    content: newContent,
  };
}

/**
 * Symbol-edit mode: find symbol via AST and edit within its body.
 */
function handleSymbolEdit(original, lines, args, filePath, root) {
  if (!args.symbol) {
    return { status: 'error', error: 'symbol parameter required for symbol-edit mode', mode: 'symbol-edit' };
  }
  if (!args.text && args.action !== 'delete') {
    return { status: 'error', error: 'text parameter required for symbol-edit mode', mode: 'symbol-edit' };
  }

  const lang = detectLang(filePath);
  const relPath = relative(root, filePath);

  // Find the symbol using smart-read logic (imported statically above)
  const symbolData = extractSymbol(original, lang, args.symbol);

  if (!symbolData) {
    return {
      status: 'error',
      error: `Symbol "${args.symbol}" not found in ${relPath}`,
      mode: 'symbol-edit',
    };
  }

  const action = args.action || 'append';

  // Within the symbol body, apply the edit
  const bodyStart = symbolData.lineStart - 1; // 0-indexed
  const bodyEnd = symbolData.lineEnd - 1; // 0-indexed (exclusive)

  let newContent;

  switch (action) {
    case 'append': {
      // Append at end of symbol body (before closing brace)
      const bodyLines = lines.slice(bodyStart, bodyEnd);
      // Find the last non-empty line
      let insertPos = bodyEnd;
      // For brace-delimited, insert before closing brace
      if (symbolData.type !== 'function' && symbolData.type !== 'class') {
        // generic: append after body end - 1 (before closing)
        insertPos = bodyEnd - 1;
      }

      const before = lines.slice(0, insertPos).join('\n');
      const after = lines.slice(insertPos).join('\n');
      newContent = before + '\n' + args.text + '\n' + after;
      break;
    }

    case 'prepend': {
      // Add at beginning of body (after signature line)
      const bodyFirstLine = bodyStart + 1; // first line after signature
      const before = lines.slice(0, bodyFirstLine).join('\n');
      const after = lines.slice(bodyFirstLine).join('\n');
      newContent = before + '\n' + args.text + '\n' + after;
      break;
    }

    case 'replace-body': {
      // Replace entire body
      if (bodyEnd <= bodyStart + 1) {
        // No body to replace
        const before = lines.slice(0, bodyStart).join('\n');
        const after = lines.slice(bodyStart).join('\n');
        newContent = before + '\n' + args.text + '\n' + after;
      } else {
        const before = lines.slice(0, bodyStart).join('\n');
        const after = lines.slice(bodyEnd).join('\n');
        newContent = before + '\n' + args.text + '\n' + after;
      }
      break;
    }

    case 'delete': {
      // Delete the entire symbol
      const before = lines.slice(0, bodyStart).join('\n');
      const after = lines.slice(bodyEnd).join('\n');
      newContent = before + (before.length > 0 && after.length > 0 ? '\n' : '') + after;
      break;
    }

    default:
      return { status: 'error', error: `Unknown action: ${action}`, mode: 'symbol-edit' };
  }

  const modified = newContent !== original;

  return {
    status: modified ? 'ok' : 'unchanged',
    mode: 'symbol-edit',
    file: relPath,
    symbol: args.symbol,
    action,
    symbolLine: symbolData.lineStart,
    modified,
    lines: lines.length,
    diff: modified ? generateSimpleDiff(original, newContent) : '',
    content: newContent,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



/**
 * Detect language from file extension.
 */
function detectLang(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.java': 'java',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp',
  };
  return map[ext] || 'unknown';
}

/**
 * Simple unified diff generator.
 */
function generateSimpleDiff(original, modified) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const diff = [];
  const maxLen = Math.max(origLines.length, modLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (i >= origLines.length) {
      diff.push(`+ ${modLines[i]}`);
    } else if (i >= modLines.length) {
      diff.push(`- ${origLines[i]}`);
    } else if (origLines[i] !== modLines[i]) {
      diff.push(`- ${origLines[i]}`);
      diff.push(`+ ${modLines[i]}`);
    }
  }

  // Only show context around changes (up to 3 lines)
  if (diff.length <= 20) return diff.join('\n');

  // Truncate to first 15 and last 5
  return diff.slice(0, 15).join('\n') + '\n  ...\n' + diff.slice(-5).join('\n');
}

/**
 * Format error result.
 */
function errorResult(error, format, mode) {
  const result = { status: 'error', error, mode };
  return format === 'json' ? JSON.stringify(result, null, 2) : `Error: ${error}`;
}

/**
 * Format output as human-readable text.
 */
function formatOutput(result, args) {
  if (result.status === 'error') {
    return `⚠️  smart_edit_ast error\nMode: ${result.mode}\nError: ${result.error}`;
  }

  let text = `✏️  smart_edit_ast: ${result.status}\n`;
  text += `${'─'.repeat(60)}\n`;
  text += `File: ${result.file}\n`;
  text += `Mode: ${result.mode}\n`;

  if (result.matchLine) text += `Match line: ${result.matchLine}\n`;
  if (result.symbol) text += `Symbol: ${result.symbol} (line ${result.symbolLine})\n`;
  if (result.action) text += `Action: ${result.action}\n`;
  if (result.startLine) text += `Range: ${result.startLine}-${result.endLine || ''}\n`;

  text += `Modified: ${result.modified ? '✅ yes' : '❌ no'}\n`;

  if (result.diff) {
    text += `\n${'─'.repeat(60)}\nDiff:\n${result.diff}\n`;
  }

  if (result.context) {
    if (result.context.before) {
      text += `\nBefore:\n${result.context.before.split('\n').slice(-3).join('\n')}\n`;
    }
    if (result.context.after) {
      text += `\nAfter:\n${result.context.after.split('\n').slice(0, 3).join('\n')}\n`;
    }
  }

  if (!args.apply && result.modified) {
    text += `\n${'─'.repeat(60)}`;
    text += `\n💡 This is a dry run. Pass apply:true to apply the change.`;
  }

  return text;
}
