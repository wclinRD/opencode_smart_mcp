/**
 * smart_rtl_analyze — RTL 程式碼理解引擎
 *
 * 解析 Verilog/SystemVerilog 設計，產出 module hierarchy、port list、
 * instantiation map。支援多層降級（slang → regex fallback）。
 *
 * 跟 smart_eda_search 的差異：
 *   - smart_rtl_analyze：理解「你的設計」（解析你的 RTL code）
 *   - smart_eda_search：搜尋「EDA 知識」（從外部來源找資料）
 */

import { parseRTL, detectParsers, getParserInfo } from './rtl/parser.mjs';
import {
  buildGraph, getHierarchy, getModulePorts, analyzeDesign, listModules,
  getModuleSignals, traceSignal, findUnconnectedPorts, findWidthMismatches,
} from './rtl/graph-builder.mjs';
import {
  formatHierarchyText, formatPortsText, formatAnalyzeText,
  formatHierarchyMermaid, formatHierarchyMarkdown, formatAnalyzeMarkdown,
  formatSignalsText, formatTraceText, formatCheckText,
} from './rtl/format.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// Plugin Export
// ═══════════════════════════════════════════════════════════════════════════

export default {
  name: 'smart_rtl_analyze',
  category: 'analyze',
  description:
    '[code] [rtl] EDA 領域 RTL 程式碼理解引擎。解析 Verilog/SystemVerilog 設計，'
    + '產出 module hierarchy、port list、instantiation map。'
    + '支援多層降級：slang（完整 elaboration）→ regex fallback。'
    + '跟 smart_eda_search 互補：eda_search 搜尋 EDA 知識，rtl_analyze 理解你的設計。',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['analyze', 'hierarchy', 'ports', 'signals', 'trace', 'check', 'list', 'parsers'],
        description: '分析動作。analyze=全面分析，hierarchy=module tree，ports=port list，signals=signal 宣告，trace=signal 追蹤，check=基本檢查（unconnected/width），list=列出所有 module，parsers=偵測可用 parser',
      },
      signal: {
        type: 'string',
        description: '要追蹤的 signal 名稱（trace 使用）',
      },
      root: {
        type: 'string',
        description: 'RTL 專案根目錄（default: .）',
      },
      target: {
        type: 'string',
        description: '目標 module 名稱（hierarchy/ports 使用）',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'markdown', 'mermaid'],
        description: '輸出格式（default: text）',
      },
      filelist: {
        type: 'string',
        description: 'Verilog file list 路徑（default: 自動掃描）',
      },
    },
  },

  async handler(args = {}) {
    const command = String(args.command || 'analyze').toLowerCase();
    const root = String(args.root || '.');
    const target = args.target || null;
    const signal = args.signal || null;
    const format = String(args.format || 'text').toLowerCase();
    const filelist = args.filelist || null;

    // 特殊命令：不需 parse
    if (command === 'parsers') {
      const info = getParserInfo();
      const actions = generateParserActions(info);
      return {
        ok: true,
        output: formatParsers(info, format),
        parserInfo: info,
        needsAction: actions.length > 0,
        actions,  // LLM 可程式化處理的 action 陣列
      };
    }

    // 其他命令需要 parse
    const parseResult = await parseRTL(root, { filelist });
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const graph = buildGraph(parseResult.data, parseResult.parser);
    let output;

    // 如果 slang 結果為空，自動降級到 regex fallback
    if (graph.stats.moduleCount === 0 && parseResult.parser === 'slang') {
      const fallbackResult = await parseRTL(root, { filelist, forceParser: 'regex' });
      if (fallbackResult.ok) {
        const fallbackGraph = buildGraph(fallbackResult.data, 'regex-fallback');
        return handleCommand(command, fallbackGraph, { ...parseResult, ...fallbackResult, parser: 'regex-fallback (slang AST 格式不支援，已自動降級)' }, target, signal, format);
      }
    }

    return handleCommand(command, graph, parseResult, target, signal, format);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 內部：command 處理
// ═══════════════════════════════════════════════════════════════════════════

function handleCommand(command, graph, parseResult, target, signal, format) {
  let output;

  switch (command) {
    case 'analyze': {
      const analysis = analyzeDesign(graph);
      output = format === 'markdown'
        ? formatAnalyzeMarkdown(analysis)
        : format === 'json'
          ? JSON.stringify(analysis, null, 2)
          : formatAnalyzeText(analysis);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        warnings: parseResult.warnings,
        stats: graph.stats,
      };
    }

    case 'hierarchy': {
      const hierarchy = getHierarchy(graph, target);
      output = format === 'markdown'
        ? formatHierarchyMarkdown(hierarchy)
        : format === 'mermaid'
          ? formatHierarchyMermaid(hierarchy)
          : format === 'json'
            ? JSON.stringify(hierarchy, null, 2)
            : formatHierarchyText(hierarchy);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        warnings: parseResult.warnings,
      };
    }

    case 'ports': {
      if (!target) {
        return { ok: false, error: 'ports 命令需要指定 target（module 名稱）' };
      }
      const portInfo = getModulePorts(graph, target);
      output = format === 'json'
        ? JSON.stringify(portInfo, null, 2)
        : formatPortsText(portInfo);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
      };
    }

    case 'list': {
      const modules = listModules(graph);
      output = format === 'json'
        ? JSON.stringify(modules, null, 2)
        : `📦 Modules (${modules.length}):\n${modules.map(m => `  • ${m}`).join('\n')}`;
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        modules,
      };
    }

    case 'signals': {
      if (!target) {
        return { ok: false, error: 'signals 命令需要指定 target（module 名稱）' };
      }
      const signalInfo = getModuleSignals(graph, target);
      output = format === 'json'
        ? JSON.stringify(signalInfo, null, 2)
        : formatSignalsText(signalInfo);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
      };
    }

    case 'trace': {
      if (!signal) {
        return { ok: false, error: 'trace 命令需要指定 signal（signal 名稱）' };
      }
      const traceInfo = traceSignal(graph, signal, target);
      output = format === 'json'
        ? JSON.stringify(traceInfo, null, 2)
        : formatTraceText(traceInfo);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
      };
    }

    case 'check': {
      const unconnected = findUnconnectedPorts(graph);
      const widthMismatches = findWidthMismatches(graph);
      const checkResult = { unconnected, widthMismatches };
      output = format === 'json'
        ? JSON.stringify(checkResult, null, 2)
        : formatCheckText(checkResult);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        stats: {
          unconnectedCount: unconnected.count,
          widthMismatchCount: widthMismatches.count,
        },
      };
    }

    default:
      return { ok: false, error: `未知 command: ${command}. 可用: analyze, hierarchy, ports, signals, trace, check, list, parsers` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 內部格式化
// ═══════════════════════════════════════════════════════════════════════════

function formatParsers(info, format) {
  if (format === 'json') return JSON.stringify(info, null, 2);

  const lines = ['🔧 RTL Parser Status', '━'.repeat(19), ''];
  for (const p of info.parsers) {
    const icon = p.available ? '✅' : '❌';
    const ver = p.version ? ` (${p.version})` : '';
    lines.push(`  ${icon} ${p.name}${ver}`);
  }

  if (info.suggestions.length > 0) {
    lines.push('');
    lines.push('💡 建議：');
    for (const s of info.suggestions) {
      lines.push(`  • ${s}`);
    }
  }

  return lines.join('\n');
}

/**
 * 產生結構化的 parser安裝 actions（供 LLM 程式化處理）
 */
function generateParserActions(info) {
  const actions = [];
  const isMac = process.platform === 'darwin';

  // 檢查 slang（必要）
  const slang = info.parsers.find(p => p.name === 'slang');
  if (!slang?.available) {
    actions.push({
      tool: 'bash',
      command: isMac
        ? 'brew install slang'
        : 'cd /tmp && git clone https://github.com/MikePopoloski/slang.git && cd slang && mkdir build && cd build && cmake .. && make -j$(nproc) && sudo cp slang /usr/local/bin/',
      reason: 'slang 是 RTL 解析的核心 parser，缺少時只能使用 regex fallback（功能受限）',
      priority: 'high',
      installUrl: 'https://github.com/MikePopoloski/slang#building',
      fallbackAvailable: true,  // 有 regex fallback，不會完全壞掉
    });
  }

  // 檢查 verilator（可選）
  const verilator = info.parsers.find(p => p.name === 'verilator');
  if (!verilator?.available) {
    actions.push({
      tool: 'bash',
      command: isMac ? 'brew install verilator' : 'sudo apt install -y verilator',
      reason: 'verilator 用於 lint check（可選，不影響核心功能）',
      priority: 'low',
      installUrl: 'https://www.veripool.org/verilator/',
      fallbackAvailable: false,  // 無 fallback，但不影響核心
    });
  }

  // 檢查 tree-sitter-verilog（可選 fallback）
  const ts = info.parsers.find(p => p.name === 'tree-sitter-verilog');
  if (!ts?.available) {
    actions.push({
      tool: 'bash',
      command: 'npm install tree-sitter-verilog',
      reason: 'tree-sitter-verilog 是輕量 fallback，用於 code navigation（可選）',
      priority: 'low',
      installUrl: 'https://github.com/tree-sitter/tree-sitter-verilog',
      fallbackAvailable: false,
    });
  }

  return actions;
}
