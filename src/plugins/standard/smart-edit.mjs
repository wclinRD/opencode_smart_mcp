// smart-edit.mjs → smart_edit (via smart_smart_run router)
// Exact string replacement with dry-run + nextCommand support.
// Direct replacement for opencode's built-in `edit` tool.
//
// 使用情境：
//   LLM 需要編輯檔案時，取代「read → edit → read verify」三步驟，
//   改為「smart_edit(dry-run) → 確認 → smart_edit(apply)」兩步驟。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { cwd } from 'node:process';

export default {
  name: 'smart_edit',
  category: 'standard',
  description: 'Use when: need to edit a file with exact string replacement. Supports dry-run (default), exact matching, regex mode, and multi-file editing. Returns nextCommand for LLM to directly apply changes.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'File path to edit (required)' },
      oldString: { type: 'string', description: 'Text to find and replace (exact match by default, regex if regex=true)' },
      newString: { type: 'string', description: 'Replacement text' },
      files: { type: 'array', items: { type: 'string' }, description: 'Multiple files to edit (alternative to file)' },
      regex: { type: 'boolean', description: 'Use regex matching instead of exact (default: false)' },
      apply: { type: 'boolean', description: 'Apply changes (default: false — dry run)' },
      root: { type: 'string', description: 'Project root (default: current dir)' },
      format: { type: 'string', enum: ['json', 'text'], description: 'Output format (default: json — includes nextCommand)' },
    },
    required: ['oldString', 'newString'],
  },
  handler: async (args) => {
    try {
      const root = resolve(args.root || cwd());
      const format = args.format || 'json';
      const isRegex = !!args.regex;
      const apply = !!args.apply;

      // Collect target files
      const targetFiles = [];
      if (args.file) {
        targetFiles.push(resolve(root, args.file));
      }
      if (args.files && Array.isArray(args.files)) {
        for (const f of args.files) {
          targetFiles.push(resolve(root, f));
        }
      }

      if (targetFiles.length === 0) {
        return JSON.stringify({
          status: 'error',
          error: 'No files specified. Provide file or files parameter.',
        }, null, 2);
      }

      // Verify files exist
      const validFiles = targetFiles.filter(f => existsSync(f));
      if (validFiles.length === 0) {
        return JSON.stringify({
          status: 'error',
          error: `File(s) not found: ${targetFiles.map(f => relative(root, f)).join(', ')}`,
        }, null, 2);
      }

      // Process each file
      const fileResults = {};
      let totalMatches = 0;
      let totalModified = 0;

      for (const filePath of validFiles) {
        const content = readFileSync(filePath, 'utf-8');
        const relPath = relative(root, filePath);
        let newContent;
        let matches = [];

        if (isRegex) {
          // Regex mode
          try {
            const re = new RegExp(args.oldString, 'g');
            let match;
            while ((match = re.exec(content)) !== null) {
              matches.push({
                index: match.index,
                length: match[0].length,
                matchedText: match[0],
              });
            }
            newContent = content.replace(re, args.newString);
          } catch (regexErr) {
            fileResults[relPath] = {
              status: 'error',
              error: `Invalid regex: ${regexErr.message}`,
            };
            continue;
          }
        } else {
          // Exact match mode
          const searchStr = args.oldString;
          let startIdx = 0;
          while (true) {
            const idx = content.indexOf(searchStr, startIdx);
            if (idx === -1) break;
            matches.push({
              index: idx,
              length: searchStr.length,
              matchedText: searchStr,
            });
            startIdx = idx + searchStr.length;
          }
          // Exact replacement
          // Split at each occurrence and join
          const parts = content.split(searchStr);
          if (parts.length > 1) {
            newContent = parts.join(args.newString);
          } else {
            newContent = content;
          }
        }

        const modified = newContent !== content;

        fileResults[relPath] = {
          status: modified ? (apply ? 'applied' : 'pending') : 'unchanged',
          file: relPath,
          matches: matches.length,
          modified,
          lines: content.split('\n').length,
          ...(modified && !apply ? {
            diff: generateDiffPreview(content, newContent, matches),
          } : {}),
        };

        totalMatches += matches.length;

        if (modified && apply) {
          writeFileSync(filePath, newContent, 'utf-8');
          fileResults[relPath].status = 'applied';
          totalModified++;
        }
      }

      const result = {
        status: apply ? 'applied' : 'dry-run',
        summary: {
          files: validFiles.length,
          filesWithMatches: Object.values(fileResults).filter(r => r.matches > 0).length,
          totalMatches,
          totalModified,
        },
        files: fileResults,
      };

      // Add nextCommand for LLM
      if (!apply && totalMatches > 0) {
        result.nextCommand = {
          tool: 'smart_edit',
          args: {
            ...args,
            apply: true,
            format: 'json',
          },
          description: `Apply ${totalMatches} change(s) across ${Object.values(fileResults).filter(r => r.modified).length} file(s)`,
        };
      }

      if (format === 'text') {
        return formatTextOutput(result);
      }

      return JSON.stringify(result, null, 2);
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: err.message,
      }, null, 2);
    }
  },
};

/**
 * Generate a diff preview showing context around changes.
 */
function generateDiffPreview(oldContent, newContent, matches) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const preview = [];
  const contextLines = 2;

  // Collect unique line ranges around matches
  const changedLines = new Set();
  for (const m of matches) {
    // Find what line this match is on
    let lineNum = 1;
    let charCount = 0;
    for (let i = 0; i < oldLines.length; i++) {
      charCount += oldLines[i].length + 1; // +1 for newline
      if (charCount > m.index) {
        lineNum = i + 1;
        break;
      }
    }
    for (let l = Math.max(1, lineNum - contextLines); l <= Math.min(oldLines.length, lineNum + contextLines); l++) {
      changedLines.add(l);
    }
  }

  if (changedLines.size === 0) return '';

  const sortedLines = [...changedLines].sort((a, b) => a - b);
  let prevLine = 0;
  for (const line of sortedLines) {
    if (prevLine > 0 && line > prevLine + 1) {
      preview.push('  ...');
    }
    const oldLine = oldLines[line - 1] || '';
    const newLine = newLines[line - 1] || '';
    if (oldLine !== newLine) {
      preview.push(`- ${oldLine}`);
      preview.push(`+ ${newLine}`);
    } else {
      preview.push(`  ${oldLine}`);
    }
    prevLine = line;
  }

  return preview.join('\n');
}

/**
 * Format as human-readable text.
 */
function formatTextOutput(result) {
  if (result.status === 'error') return `Error: ${result.error}`;

  let text = `Edit result: ${result.status}\n`;
  text += '─'.repeat(50) + '\n';

  if (result.summary) {
    text += `${result.summary.filesWithMatches} file(s) with ${result.summary.totalMatches} match(es)\n`;
    if (result.summary.totalModified > 0) {
      text += `${result.summary.totalModified} file(s) modified\n`;
    }
  }

  for (const [relPath, fileResult] of Object.entries(result.files)) {
    text += `\n${relPath}: ${fileResult.status} (${fileResult.matches} matches)\n`;
    if (fileResult.diff) {
      text += fileResult.diff + '\n';
    }
  }

  if (result.nextCommand) {
    text += `\nNext: ${result.nextCommand.description}`;
  }

  return text;
}
