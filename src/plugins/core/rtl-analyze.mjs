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
  findFloatSignals,
} from './rtl/graph-builder.mjs';
import {
  formatHierarchyText, formatPortsText, formatAnalyzeText,
  formatHierarchyMermaid, formatHierarchyMarkdown, formatAnalyzeMarkdown,
  formatHierarchyDot,
  formatSignalsText, formatTraceText, formatCheckText,
  formatFloatMermaid, formatFloatDot,
  formatLintText, formatLintMarkdown,
} from './rtl/format.mjs';
import { analyzeSdc } from './rtl/sdc-parser.mjs';
import { analyzeCdc } from './rtl/cdc-detector.mjs';
import { runLintRules, BUILT_IN_RULES, RULE_CATEGORIES } from './rtl/lint-rules.mjs';
import { analyzeSynth, detectYosys } from './rtl/synth.mjs';

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
        enum: ['analyze', 'hierarchy', 'ports', 'signals', 'trace', 'check', 'lint', 'cdc', 'rules', 'synth', 'list', 'parsers'],
        description: '分析動作。analyze=全面分析，hierarchy=module tree，ports=port list，signals=signal 宣告，trace=signal 追蹤，check=基本檢查（unconnected/width/float），lint=SDC constraint 驗證，cdc=Clock Domain Crossing 偵測，rules=可配置 lint 規則，synth=Synthesis 資源分析，list=列出所有 module，parsers=偵測可用 parser',
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
        enum: ['text', 'json', 'markdown', 'mermaid', 'dot'],
        description: '輸出格式（default: text）。dot=Graphviz DOT 格式',
      },
      filelist: {
        type: 'string',
        description: 'Verilog file list 路徑（default: 自動掃描）',
      },
      sdc: {
        type: 'string',
        description: 'SDC constraint 檔案路徑（lint 使用，default: 自動掃描 .sdc）',
      },
      rules: {
        type: 'array',
        items: { type: 'string' },
        description: '要執行的 lint 規則 ID 列表（rules 使用，default: 全部）',
      },
      severity: {
        type: 'string',
        enum: ['error', 'warning', 'info'],
        description: '過濾 severity（rules 使用）',
      },
      technology: {
        type: 'string',
        enum: ['generic', 'asic', 'fpga'],
        description: 'Synthesis 技術（synth 使用，default: generic）',
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
    const sdcFile = args.sdc || null;

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
        return handleCommand(command, fallbackGraph, { ...parseResult, ...fallbackResult, parser: 'regex-fallback (slang AST 格式不支援，已自動降級)' }, target, signal, format, root, sdcFile, args);
      }
    }

    return handleCommand(command, graph, parseResult, target, signal, format, root, sdcFile, args);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 內部：command 處理
// ═══════════════════════════════════════════════════════════════════════════

function handleCommand(command, graph, parseResult, target, signal, format, root = ".", sdcFile = null, args = {}) {
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
          : format === 'dot'
            ? formatHierarchyDot(hierarchy)
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
      const floatSignals = findFloatSignals(graph);
      const checkResult = { unconnected, widthMismatches, floatSignals };
      output = format === 'mermaid'
        ? formatFloatMermaid(floatSignals)
        : format === 'dot'
          ? formatFloatDot(floatSignals)
          : format === 'json'
            ? JSON.stringify(checkResult, null, 2)
            : formatCheckText(checkResult);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        stats: {
          unconnectedCount: unconnected.count,
          widthMismatchCount: widthMismatches.count,
          floatSignalCount: floatSignals.noLoadCount + floatSignals.noDriverCount,
        },
      };
    }


    case 'lint': {
      // 取得 top-level ports
      const designAnalysis = analyzeDesign(graph);
      const topLevelPorts = designAnalysis.topLevelPorts || [];

      // 解析 SDC files
      const sdcResult = analyzeSdc(root, sdcFile ? [sdcFile] : null);

      // 比對：哪些 top-level port 缺少 constraint
      const constrainedSet = new Set(sdcResult.allConstrainedPorts);
      const clockSet = new Set(sdcResult.clockPorts);

      const unconstrainedInputs = [];
      const unconstrainedOutputs = [];
      const fixes = [];

      // 取得第一個 clock name（用於 SDC template）
      const defaultClock = sdcResult.clocks.length > 0
        ? (sdcResult.clocks[0].name || sdcResult.clocks[0].port || 'clk')
        : 'clk';

      for (const port of topLevelPorts) {
        const name = port.name;
        if (port.direction === 'input') {
          if (!constrainedSet.has(name) && !clockSet.has(name)) {
            unconstrainedInputs.push(port);
            // 生成 SDC fix 建議
            const bus = port.width > 1 ? `[${port.name}[*]]` : `[get_ports ${port.name}]`;
            fixes.push({
              port: name,
              direction: 'input',
              width: port.width,
              module: port.module,
              suggestedSdc: `set_input_delay -clock ${defaultClock} 0.0 ${bus}  # TODO: 調整 delay 值`,
              reason: '缺少 input delay constraint',
            });
          }
        } else {
          if (!constrainedSet.has(name)) {
            unconstrainedOutputs.push(port);
            // 生成 SDC fix 建議
            const bus = port.width > 1 ? `[${port.name}[*]]` : `[get_ports ${port.name}]`;
            fixes.push({
              port: name,
              direction: 'output',
              width: port.width,
              module: port.module,
              suggestedSdc: `set_output_delay -clock ${defaultClock} 0.0 ${bus}  # TODO: 調整 delay 值`,
              reason: '缺少 output delay constraint',
            });
          }
        }
      }

      // 偵測 name mismatch（SDC 有類似名稱但不完全一致）
      const sdcAllPorts = new Set([
        ...sdcResult.constrainedInputPorts,
        ...sdcResult.constrainedOutputPorts,
        ...sdcResult.clockPorts,
      ]);
      for (const port of topLevelPorts) {
        const name = port.name;
        if (sdcAllPorts.has(name)) continue;
        // 搜尋 SDC 中是否有「很像」的名稱
        for (const sdcPort of sdcAllPorts) {
          if (isSimilarName(name, sdcPort)) {
            fixes.push({
              port: name,
              direction: port.direction,
              width: port.width,
              module: port.module,
              suggestedSdc: null,
              reason: `SDC 中有類似名稱 "${sdcPort}"，可能是 port 名稱不一致（SDC: ${sdcPort} vs RTL: ${name}）`,
              mismatch: { sdc: sdcPort, rtl: name },
            });
          }
        }
      }

      const lintResult = {
        sdcFiles: sdcResult.files,
        sdcSummary: sdcResult.summary,
        clocks: sdcResult.clocks,
        topLevelPortCount: topLevelPorts.length,
        unconstrainedInputs,
        unconstrainedOutputs,
        totalUnconstrained: unconstrainedInputs.length + unconstrainedOutputs.length,
        totalConstrained: constrainedSet.size + clockSet.size,
        fixes,
      };

      output = format === 'json'
        ? JSON.stringify(lintResult, null, 2)
        : format === 'markdown'
          ? formatLintMarkdown(lintResult)
          : formatLintText(lintResult);

      return {
        ok: true,
        output,
        parser: parseResult.parser,
        lintResult,
      };
    }

    case 'cdc': {
      const cdcResult = analyzeCdc(root);
      if (!cdcResult.ok) {
        return { ok: false, error: cdcResult.error };
      }
      output = format === 'json'
        ? JSON.stringify(cdcResult, null, 2)
        : formatCdcText(cdcResult);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        stats: cdcResult.stats,
      };
    }

    case 'rules': {
      const rulesFilter = args.rules || null;
      const sevFilter = args.severity || null;
      const lintResult = runLintRules(root, { rules: rulesFilter, severity: sevFilter });
      output = format === 'json'
        ? JSON.stringify(lintResult, null, 2)
        : formatRulesText(lintResult);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        stats: lintResult.stats,
      };
    }

    case 'synth': {
      const synthOptions = {
        top: target,
        technology: args.technology || 'generic',
      };
      const synthResult = analyzeSynth(root, synthOptions);
      output = format === 'json'
        ? JSON.stringify(synthResult, null, 2)
        : formatSynthText(synthResult);
      return {
        ok: true,
        output,
        parser: parseResult.parser,
        yosys: synthResult.yosys,
      };
    }

    default:
      return { ok: false, error: `未知 command: ${command}. 可用: analyze, hierarchy, ports, signals, trace, check, lint, cdc, rules, synth, list, parsers` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 內部格式化
// ═══════════════════════════════════════════════════════════════════════════

function formatCdcText(result) {
  const { clockDomains, crossings, synchronizers, stats } = result;
  const lines = ['⏱️  CDC (Clock Domain Crossing) Report', '━'.repeat(35), ''];

  lines.push(`🕐 Clock Domains (${stats.clockDomainCount}):`);
  for (const d of clockDomains) {
    lines.push(`  • ${d.displayName} — ${d.file}:${d.line}`);
  }
  lines.push('');

  if (crossings.length === 0) {
    lines.push('✅ No clock domain crossings detected');
  } else {
    lines.push(`🔀 Crossings (${stats.crossingCount}):`);
    for (const c of crossings) {
      const risk = c.risk === 'high' ? '🔴' : '🟢';
      lines.push(`  ${risk} ${c.source} (${c.sourceDomain}) → ${c.dest} (${c.destDomain})`);
      if (c.suggestion) {
        lines.push(`     💡 Suggestion: Add 2-FF synchronizer`);
      }
    }
  }

  lines.push('');
  lines.push(`📊 Summary: ${stats.synchronizedCount} synchronized, ${stats.unsynchronizedCount} unsynchronized`);

  return lines.join('\n');
}

function formatRulesText(result) {
  const { violations, stats, rules } = result;
  const lines = ['🔍 RTL Lint Report', '━'.repeat(18), ''];

  lines.push(`📋 Rules Active: ${rules.length}`);
  lines.push(`📊 Files: ${stats.totalFiles}`);
  lines.push(`❌ Errors: ${stats.bySeverity.error}  ⚠️ Warnings: ${stats.bySeverity.warning}  ℹ️ Info: ${stats.bySeverity.info}`);
  lines.push('');

  if (violations.length === 0) {
    lines.push('✅ No violations found');
  } else {
    // Group by category
    const byCat = {};
    for (const v of violations) {
      const cat = v.rule.category;
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(v);
    }

    for (const [cat, vs] of Object.entries(byCat)) {
      const catInfo = RULE_CATEGORIES[cat] || { name: cat, icon: '📋' };
      lines.push(`${catInfo.icon} ${catInfo.name} (${vs.length}):`);
      for (const v of vs.slice(0, 10)) {
        const sev = v.rule.severity === 'error' ? '❌' : v.rule.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`  ${sev} ${v.file}:${v.line} — ${v.message}`);
      }
      if (vs.length > 10) lines.push(`  ... and ${vs.length - 10} more`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatSynthText(result) {
  const lines = ['⚙️  Synthesis Report', '━'.repeat(19), ''];

  if (!result.ok) {
    lines.push(`❌ ${result.error}`);
    if (result.suggestion) lines.push(`💡 ${result.suggestion}`);
    return lines.join('\n');
  }

  if (result.yosys) {
    lines.push('🔧 Yosys Synthesis (actual)');
    lines.push(`  Top Module: ${result.topModule || 'auto'}`);
    lines.push(`  Technology: ${result.technology}`);
    lines.push('');
    lines.push('📊 Utilization:');
    if (result.utilization) {
      lines.push(`  Modules: ${result.utilization.modules || 0}`);
      lines.push(`  Cells: ${result.cellCount}`);
      lines.push(`  Wires: ${result.wireCount}`);
    }
    if (result.stats?.cellTypes) {
      lines.push('  Cell Types:');
      for (const [type, count] of Object.entries(result.stats.cellTypes)) {
        lines.push(`    ${type}: ${count}`);
      }
    }
  } else {
    lines.push('📏 Fallback Analysis (no Yosys)');
    lines.push(`  Total Regs: ${result.totalRegs}`);
    lines.push(`  Total Wires: ${result.totalWires}`);
    lines.push(`  Total Ports: ${result.totalPorts}`);
    lines.push(`  Estimated LUTs: ${result.estimatedLuts}`);
  }

  return lines.join('\n');
}

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


// ═══════════════════════════════════════════════════════════════════════════
// 內部：name similarity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 判斷兩個 port 名稱是否「很像」（可能是 naming mismatch）
 */
function isSimilarName(a, b) {
  if (a === b) return false;
  const normalize = (s) => s.replace(/^_+|_+$/g, '').toLowerCase();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;

  // 常見縮寫對照表
  const abbrevMap = {
    'rst': 'reset', 'reset': 'rst',
    'clk': 'clock', 'clock': 'clk',
    'addr': 'address', 'address': 'addr',
    'valid': 'vld', 'vld': 'valid',
    'ready': 'rdy', 'rdy': 'ready',
    'enable': 'en', 'en': 'enable',
    'din': 'data_in', 'dout': 'data_out',
    'wdata': 'write_data', 'rdata': 'read_data',
  };

  for (const [short, long] of Object.entries(abbrevMap)) {
    const re = new RegExp(`^${short}$|^${short}_|_${short}_|_${short}$`);
    if (na.replace(re, long) === nb) return true;
    if (nb.replace(re, long) === na) return true;
  }

  // Levenshtein distance（允許 2 個字元差異）
  const dist = levenshtein(na, nb);
  if (Math.max(na.length, nb.length) > 3 && dist <= 2) return true;

  return false;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)
      );
    }
  }
  return dp[m][n];
}
