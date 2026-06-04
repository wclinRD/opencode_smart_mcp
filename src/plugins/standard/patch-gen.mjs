// patch-gen.mjs → smart_patch_gen
// 根據分析結果自動產生修復 patch / edit 指令。
// 橋接分析工具 (error_diagnose/debug/thinking) 與編輯工具 (cross_file_edit)。
//
// Phase 8: 程式碼生成輔助 — 閉環「分析→修復」循環。
//
// 使用流程:
//   error_diagnose → patch_gen(preview) → 人審查 → cross_file_edit(apply)
//
// 安全設計:
//   - 預設 preview (只顯示變更計畫，不執行)
//   - 單/雙檔案變更: 自動 preview
//   - 3+ 檔案: 須 `apply: true` 明確授權

// ---------------------------------------------------------------------------
// Pattern matchers — 從常見工具輸出萃取變更資訊
// ---------------------------------------------------------------------------

// 檔案 + 行號 — 支援 "in src/file.js:42" 或 "file: src/file.js" 多種格式
// 必須包含 . 或 / 才視為有效路徑，避免誤匹配單字 (group1=file, group2=line)
const RE_FILE_LINE = /(?:in|at|file|path)\s*:?\s*([^\s:]+(?:\.[a-zA-Z0-9]+))(?::(\d+))?/gi;

// 關鍵字引導的變更描述（僅用於含檔案路徑的完整句子）
const RE_CHANGE = /(?:change|replace|fix|update|modify|rename)\s+[`"']?(\S+?) [`"']?(?:to|with|into|->|=>)\s+[`"']?(.+?)(?:\.|,|;|\s+(?:in|at|for|on|by)|$)/gi;

// suggestion 列表: "- file:line description"
const RE_SUGGEST = /[-*]\s+(\S+?)(?::(\d+))?\s*[:=─]\s*(.+)/gi;

// 常見錯誤訊息中的路徑 — 支援 "Error: details" 與 "Error in file"
const RE_ERROR_PATH = /(?:Error|error|Cannot find|not found)\s*:?\s*(.+?)(?:\s|$)/gi;

// 修復建議 prefix: "Fix: do X" / "Suggestion: change Y"
const RE_FIX_DESC = /(?:Fix|Suggestion|Resolution|Patch|Repair):\s*(.+)/gi;

// ---------------------------------------------------------------------------
// Core: 從文字萃取變更單元
// ---------------------------------------------------------------------------

function extractChanges(content, sourceHint) {
  const changes = [];
  const seen = new Set();

  // 嘗試所有 pattern
  const tryPattern = (re, extractor) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const item = extractor(m);
      if (item && item.file && !seen.has(item.file + item.pattern)) {
        seen.add(item.file + item.pattern);
        changes.push(item);
      }
    }
  };

  // Pattern 1: file:line change description
  tryPattern(RE_SUGGEST, m => ({
    file: m[1],
    line: m[2] ? parseInt(m[2], 10) : undefined,
    pattern: m[3].trim(),
    description: m[3].trim(),
  }));

  // Pattern 2: "change X to Y"
  tryPattern(RE_CHANGE, m => ({
    file: m[1].includes('.') ? m[1] : undefined,
    pattern: m[1],
    replacement: m[2].trim(),
    description: `Change \`${m[1]}\` to \`${m[2].trim()}\``,
  }));

  // Pattern 3: file:line location
  tryPattern(RE_FILE_LINE, m => ({
    file: m[1],
    line: m[2] ? parseInt(m[2], 10) : undefined,
    pattern: undefined,
    description: `Location: ${m[1]}${m[2] ? ' line ' + m[2] : ''}`,
  }));

  // 根據 sourceHint 加強解析
  if (sourceHint === 'error_diagnose') {
    const fixMatch = RE_FIX_DESC.exec(content);
    if (fixMatch) {
      // 如果已有 file 資訊，附加修復描述
      if (changes.length > 0 && !changes[0].description.includes(fixMatch[1])) {
        changes[0].description = fixMatch[1].trim();
      } else if (changes.length === 0) {
        changes.push({
          file: undefined,
          description: fixMatch[1].trim(),
        });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDiff(changes) {
  if (changes.length === 0) return 'No changes extracted.';

  let text = '';
  for (const c of changes) {
    text += '─── Patch ───\n';
    if (c.file) text += `  File:    ${c.file}\n`;
    if (c.line) text += `  Line:    ${c.line}\n`;
    if (c.pattern) text += `  Target:  ${c.pattern}\n`;
    if (c.replacement) text += `  Replace: ${c.replacement}\n`;
    if (c.description) text += `  Reason:  ${c.description}\n`;
    text += '\n';
  }
  return text.trim();
}

function formatText(changes, fileGroups) {
  if (changes.length === 0) return 'No changes extracted from input.\n\nTip: Provide more structured analysis output with file paths and suggested changes.';

  let text = `Patch Plan (${changes.length} change(s) across ${fileGroups.size} file(s))\n`;
  text += '─'.repeat(50) + '\n\n';

  for (const [file, items] of fileGroups) {
    text += `  File: ${file}\n`;
    for (const item of items) {
      if (item.line) text += `    L${item.line}: `;
      else text += `    `;
      text += `${item.description || item.pattern || '(general)'}\n`;
    }
    text += '\n';
  }

  if (fileGroups.size > 2) {
    text += `⚠️  Multi-file change (${fileGroups.size} files). Set apply=true to apply.\n`;
  } else {
    text += `Preview only. Set preview=false and apply=true to apply.\n`;
  }

  return text.trim();
}

function planTextFormat(changes) {
  const groups = new Map();
  for (const c of changes) {
    const file = c.file || '(unknown)';
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(c);
  }
  return formatText(changes, groups);
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_patch_gen',
  category: 'standard',
  description: `Generate edit patches from analysis tool output.

Bridges the gap between analysis (error_diagnose/debug/thinking) and action (cross_file_edit).

Input: analysis output text from any smart-mcp tool.
Output: structured patch plan with file paths, line numbers, and change descriptions.

Safety:
  - preview=true (default): shows changes without applying
  - 3+ files require explicit apply=true to proceed

Integration:
  error_diagnose → patch_gen(preview) → review → cross_file_edit(apply)

Examples:
  { source: "error_diagnose", content: "..." }
  { source: "debug", content: "Fix: rename foo to bar in src/app.js", file: "src/app.js" }
  { source: "thinking", content: "...", preview: false, apply: true }

Phase 8: Completes the "analyze → fix" loop.`,
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Analysis output text to extract patches from (required)' },
      source: { type: 'string', enum: ['error_diagnose', 'debug', 'thinking', 'manual', 'auto'], description: 'Source tool hint — improves parsing accuracy (default: auto)' },
      file: { type: 'string', description: 'Optional explicit target file (when content lacks file paths)' },
      line: { type: 'number', description: 'Optional explicit line number' },
      pattern: { type: 'string', description: 'Optional explicit target text pattern to replace' },
      replacement: { type: 'string', description: 'Optional explicit replacement text' },
      preview: { type: 'boolean', description: 'Preview mode (default: true). Shows patch plan without applying.' },
      apply: { type: 'boolean', description: 'Actually apply changes via cross_file_edit (default: false, requires explicit opt-in for 3+ files)' },
      format: { type: 'string', enum: ['text', 'json', 'diff'], description: 'Output format (default: text)' },
    },
    required: ['content'],
  },
  handler: async (args) => {
    const content = args.content || '';
    const sourceHint = args.source || 'auto';
    const format = args.format || 'text';
    const preview = args.preview !== false; // default true
    const apply = args.apply === true;

    // 1. 萃取變更
    const changes = extractChanges(content, sourceHint);

    // 2. 套用明確指定的 file/pattern/replacement（覆蓋自動推測）
    // 如果有明確的 pattern/replacement，不論自動萃取結果如何都加入
    if (args.file) {
      const existing = changes.find(c => c.file === args.file);
      if (existing && (args.pattern || args.replacement)) {
        // 更新既有 entry
        if (args.pattern) existing.pattern = args.pattern;
        if (args.replacement) existing.replacement = args.replacement;
        if (args.line != null) existing.line = args.line;
        existing.description = args.replacement
          ? `Change \`${args.pattern || '…'}\` to \`${args.replacement}\``
          : (existing.description || undefined);
      } else if (!existing) {
        // 無對應 file 的既有 entry → 新增
        changes.push({
          file: args.file,
          line: args.line,
          pattern: args.pattern,
          replacement: args.replacement,
          description: args.replacement
            ? `Change \`${args.pattern || '…'}\` to \`${args.replacement}\``
            : (args.pattern ? `Update at ${args.file}` : undefined),
        });
      }
    }

    // 3. 分組
    const fileGroups = new Map();
    for (const c of changes) {
      const f = c.file || '(unknown)';
      if (!fileGroups.has(f)) fileGroups.set(f, []);
      fileGroups.get(f).push(c);
    }

    const multiFile = fileGroups.size > 2;

    // 4. 安全閘門
    if (apply && multiFile && !args._confirmed) {
      // 需要使用者確認 — 回傳 preview + 要求確認
      const previewText = formatText(changes, fileGroups);
      return `${previewText}\n\n⚠️  Multi-file change requires confirmation. Re-run with apply=true and _confirmed=true to apply.`;
    }

    // 5. 產出
    if (format === 'json') {
      return JSON.stringify({
        changes,
        totalChanges: changes.length,
        totalFiles: fileGroups.size,
        multiFile,
        safeToApply: !multiFile,
        generated: new Date().toISOString(),
      }, null, 2);
    }

    if (format === 'diff') {
      return formatDiff(changes);
    }

    // text format (default)
    const previewText = preview ? formatText(changes, fileGroups) : planTextFormat(changes);

    if (apply) {
      // Generate instructions regardless of preview mode
      const instructions = changes
        .filter(c => c.file && c.pattern && c.replacement)
        .map(c => `  cross_file_edit({ file: "${c.file}", pattern: "${c.pattern}", replacement: "${c.replacement}", apply: true })`);
      if (instructions.length > 0) {
        return `${previewText}\n\n─── Apply Instructions ───\n${instructions.join('\n')}`;
      }
      return `${previewText}\n\nNote: Changes lack specific pattern/replacement pairs. Manual edit required.`;
    }

    return previewText;
  },
};
