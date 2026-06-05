// code-type-infer.mjs → smart_code_type_infer
// 給定檔案 + 位置，使用 LSP hover 取得型別資訊。
// 跨檔案的型別推導依賴 LSP 的型別檢查器。

import { getLspBridge, closeAllLspBridges } from '../../lib/lsp-bridge.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default {
  name: 'smart_code_type_infer',
  category: 'standard',
  description: `Infer type information at a specific code location. Use when: need to know the exact type of a variable/expression, understand complex generic types, or verify type contracts across files.

Uses LSP hover capability. Requires a running TypeScript LSP server.`,
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Target file path' },
      line: { type: 'number', description: 'Line number (1-indexed)' },
      col: { type: 'number', description: 'Column offset (0-indexed, default: 0)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
      root: { type: 'string', description: 'Project root directory (default: .)' },
    },
    required: ['file', 'line'],
  },
  handler: async (args) => {
    try {
      const root = args.root || process.cwd();

      if (!existsSync(resolve(root, args.file))) {
        return `File not found: ${args.file}`;
      }

      const bridge = getLspBridge(root);
      const result = await bridge.getHover(args.file, args.line, args.col || 0);

      if (args.format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      if (result.error) return result.error;
      if (!result.type) {
        return `No type information at ${args.file}:L${args.line}`;
      }

      let text = `Type at ${args.file}:L${args.line}`;
      if (result.range) {
        text += `:C${result.range.start.col}-C${result.range.end.col}`;
      }
      text += '\n' + '─'.repeat(40) + '\n';
      text += result.type;

      return text;
    } finally {
      await closeAllLspBridges();
    }
  },
};
