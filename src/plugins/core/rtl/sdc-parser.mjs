/**
 * SDC (Synopsys Design Constraints) Parser
 *
 * 解析 .sdc 檔案，提取 timing constraints。
 * 重點：哪些 port 有 constraint、哪些沒有。
 *
 * SDC 語法是 TCL-like，常見指令：
 *   create_clock / create_generated_clock
 *   set_input_delay / set_output_delay
 *   set_clock_groups / set_false_path / set_multicycle_path
 *   set_max_transition / set_min_transition
 *   set_max_fanout / set_max_capacitance
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 從目錄中找所有 .sdc 檔案
 */
export function findSdcFiles(root) {
  const results = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.sdc')) {
        results.push(path.join(root, e.name));
      } else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        results.push(...findSdcFiles(path.join(root, e.name)));
      }
    }
  } catch { /* ignore */ }
  return results;
}

/**
 * 解析單一 SDC 檔案
 * @param {string} sdcPath — SDC 檔案路徑
 * @returns {object} parsed constraints
 */
export function parseSdcFile(sdcPath) {
  const content = fs.readFileSync(sdcPath, 'utf-8');
  return parseSdcContent(content, sdcPath);
}

/**
 * 解析 SDC 內容
 */
export function parseSdcContent(content, source = '<inline>') {
  const result = {
    source,
    clocks: [],          // create_clock definitions
    generatedClocks: [], // create_generated_clock
    inputDelays: [],     // set_input_delay
    outputDelays: [],    // set_output_delay
    clockGroups: [],     // set_clock_groups
    falsePaths: [],      // set_false_path
    multicyclePaths: [], // set_multicycle_path
    maxTransitions: [],  // set_max_transition
    minTransitions: [],  // set_min_transition
    maxFanouts: [],      // set_max_fanout
    maxCapacitance: [],  // set_max_capacitance
    comments: [],        // 註解（可選）
    errors: [],          // 解析錯誤
  };

  // 移除多行註解 /* ... */
  let cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // 移除單行註解 # ...
  const lines = cleaned.split('\n');
  const uncommented = [];
  for (const line of lines) {
    const commentIdx = line.indexOf('#');
    uncommented.push(commentIdx >= 0 ? line.slice(0, commentIdx) : line);
  }
  cleaned = uncommented.join('\n');

  // SDC 指令以換行分隔，每個指令是 command arg1 arg2 ... 格式
  // 處理嵌套括號 [get_ports ...] 和花括號 {...}
  const sdcLines = cleaned.split('\n');
  
  for (const line of sdcLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // 識別指令名稱（第一個 token）
    const cmdMatch = trimmed.match(/^(\w+)\s+(.*)/);
    if (!cmdMatch) continue;
    
    const cmdName = cmdMatch[1].toLowerCase();
    const argsStr = cmdMatch[2];
    const args = parseArgs(argsStr);

    switch (cmdName) {
      case 'create_clock':
        result.clocks.push(parseClock(args, source));
        break;
      case 'create_generated_clock':
        result.generatedClocks.push(parseGeneratedClock(args, source));
        break;
      case 'set_input_delay':
        result.inputDelays.push(parsePortDelay(args, 'input', source));
        break;
      case 'set_output_delay':
        result.outputDelays.push(parsePortDelay(args, 'output', source));
        break;
      case 'set_clock_groups':
        result.clockGroups.push({ args, source });
        break;
      case 'set_false_path':
        result.falsePaths.push({ args, source });
        break;
      case 'set_multicycle_path':
        result.multicyclePaths.push({ args, source });
        break;
      case 'set_max_transition':
        result.maxTransitions.push({ args, source });
        break;
      case 'set_min_transition':
        result.minTransitions.push({ args, source });
        break;
      case 'set_max_fanout':
        result.maxFanouts.push({ args, source });
        break;
      case 'set_max_capacitance':
        result.maxCapacitance.push({ args, source });
        break;
      default:
        // 未識別的指令 — 忽略
        break;
    }
  }

  // 處理無括號的指令（如 current_design）
  const currentDesignMatch = cleaned.match(/current_design\s+(\S+)/);
  if (currentDesignMatch) {
    result.currentDesign = currentDesignMatch[1];
  }

  return result;
}

/**
 * 從 SDC 結果中提取所有被 constraint 的 port 名稱
 * @returns {Set<string>} port 名稱集合（已 normalize）
 */
export function extractConstrainedPorts(parsed) {
  const ports = new Set();

  // 從 input_delay 提取
  for (const d of parsed.inputDelays) {
    for (const p of extractPortsFromArg(d.ports)) {
      ports.add(p);
    }
  }

  // 從 output_delay 提取
  for (const d of parsed.outputDelays) {
    for (const p of extractPortsFromArg(d.ports)) {
      ports.add(p);
    }
  }

  return ports;
}

/**
 * 從 clock 定義中提取 clock port 名稱
 */
export function extractClockPorts(parsed) {
  const clocks = new Set();
  for (const c of parsed.clocks) {
    if (c.port) clocks.add(normalizePortName(c.port));
  }
  return clocks;
}

// ═══════════════════════════════════════════════════════════════════════════
// 內部 helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 解析 SDC 參數（處理嵌套括號、引號、get_ports 等）
 * SDC 格式：command [get_ports {name}] -option value
 */
function parseArgs(argsStr) {
  if (!argsStr) return [];

  const tokens = [];
  let current = '';
  let bracketDepth = 0;
  let braceDepth = 0;
  let inQuote = false;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];

    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (inQuote) {
      current += ch;
    } else if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      bracketDepth--;
      current += ch;
    } else if (ch === '{') {
      braceDepth++;
      current += ch;
    } else if (ch === '}') {
      braceDepth--;
      current += ch;
    } else if (ch === ' ' && bracketDepth === 0 && braceDepth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());

  return tokens;
}

/**
 * 從 SDC 參數中提取 port 名稱
 * 處理格式：
 *   "port_name"
 *   [get_ports "port_name"]
 *   [get_ports {port_name}]
 *   {port_list}
 *   * (wildcard — 表示所有 port)
 */
function extractPortsFromArg(arg) {
  if (!arg) return [];

  // 如果是陣列，逐一處理
  if (Array.isArray(arg)) {
    return arg.flatMap(a => extractPortsFromArg(a));
  }

  // 移除 get_ports / get_clocks wrapper
  // 處理格式：[get_ports name] [get_ports {name}] [get_ports {name[*]}]
  // 只匹配特定的 [get_ports ...] 模式，不影響 port 名稱中的 []
  let cleaned = arg;
  const wrapperMatch = cleaned.match(/^\[(get_ports|get_clocks|get_pins|get_cells)\s+(.*)\]$/);
  if (wrapperMatch) {
    cleaned = wrapperMatch[2];
  }

  // 移除引號和花括號
  cleaned = cleaned.replace(/^["'{]|["'}]$/g, '').trim();

  // * wildcard — 表示所有 port
  if (cleaned === '*') return ['*'];

  // 如果包含空格或多個名稱
  if (cleaned.includes(' ')) {
    return cleaned.split(/\s+/).map(s => normalizePortName(s.replace(/^["']|["']$/g, '')));
  }

  return [normalizePortName(cleaned)];
}

/**
 * Normalize port name（移除層級前綴，只保留最後一段）
 * e.g., "u_top.u_cpu.clk" → "clk"
 */
function normalizePortName(name) {
  // 保留原始名稱（因為 SDC 可能用完整層級路徑）
  return name.replace(/^["']|["']$/g, '');
}

/**
 * 解析 create_clock 參數
 */
function parseClock(args, source) {
  const clock = { port: null, period: null, name: null, source };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-period' && i + 1 < args.length) {
      clock.period = parseFloat(args[++i]);
    } else if (arg === '-name' && i + 1 < args.length) {
      clock.name = args[++i].replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('[') || arg.includes('get_ports') || arg.includes('get_clocks')) {
      const ports = extractPortsFromArg(arg);
      if (ports.length > 0) clock.port = ports[0];
    } else if (!arg.startsWith('-')) {
      // 可能是直接的 port 名稱
      clock.port = arg.replace(/^["']|["']$/g, '');
    }
  }

  return clock;
}

/**
 * 解析 create_generated_clock 參數
 */
function parseGeneratedClock(args, source) {
  const gc = { port: null, sourcePin: null, masterClock: null, name: null, source };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-source' && i + 1 < args.length) {
      gc.sourcePin = args[++i];
    } else if (arg === '-master_clock' && i + 1 < args.length) {
      gc.masterClock = args[++i].replace(/^["']|["']$/g, '');
    } else if (arg === '-name' && i + 1 < args.length) {
      gc.name = args[++i].replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('[') || arg.includes('get_ports')) {
      const ports = extractPortsFromArg(arg);
      if (ports.length > 0) gc.port = ports[0];
    } else if (!arg.startsWith('-') && !arg.startsWith('[')) {
      gc.port = arg.replace(/^["']|["']$/g, '');
    }
  }

  return gc;
}

/**
 * 解析 set_input_delay / set_output_delay 參數
 */
function parsePortDelay(args, direction, source) {
  const delay = { delay: null, clock: null, ports: [], source, direction };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-clock' && i + 1 < args.length) {
      const clockArg = args[++i];
      // 移除 [get_clocks ...] wrapper
      delay.clock = clockArg
        .replace(/\[get_clocks\s+/g, '')
        .replace(/\]/g, '')
        .replace(/^["'{]|["'}]$/g, '')
        .trim();
    } else if (arg === '-max' || arg === '-min') {
      delay.constraintType = arg;
    } else if (arg.startsWith('[') || arg.includes('get_ports')) {
      delay.ports = extractPortsFromArg(arg);
    } else if (!arg.startsWith('-') && delay.delay === null) {
      // 數字：delay 值
      const num = parseFloat(arg);
      if (!isNaN(num)) {
        delay.delay = num;
      } else {
        // 可能是 clock 名稱（不帶 -clock flag）
        delay.clock = arg.replace(/^["']|["']$/g, '');
      }
    } else if (!arg.startsWith('-') && delay.delay !== null) {
      // 已有 delay，這個可能是 port
      delay.ports = extractPortsFromArg(arg);
    }
  }

  return delay;
}

/**
 * 分析所有 SDC 檔案，回傳整合結果
 * @param {string} root — 專案根目錄
 * @param {string[]} sdcPaths — 可選的 SDC 檔案路徑（不傳則自動掃描）
 * @returns {object} merged constraints
 */
export function analyzeSdc(root, sdcPaths = null) {
  const files = sdcPaths || findSdcFiles(root);
  const allParsed = [];

  for (const f of files) {
    try {
      allParsed.push(parseSdcFile(f));
    } catch (e) {
      allParsed.push({ source: f, errors: [e.message] });
    }
  }

  // 合併所有 clock 定義
  const allClocks = allParsed.flatMap(p => p.clocks || []);
  const allGenClocks = allParsed.flatMap(p => p.generatedClocks || []);
  const allInputDelays = allParsed.flatMap(p => p.inputDelays || []);
  const allOutputDelays = allParsed.flatMap(p => p.outputDelays || []);

  // 所有被 constraint 的 port
  const constrainedInput = extractConstrainedPorts({ inputDelays: allInputDelays, outputDelays: [] });
  const constrainedOutput = extractConstrainedPorts({ inputDelays: [], outputDelays: allOutputDelays });
  const allConstrained = extractConstrainedPorts({ inputDelays: allInputDelays, outputDelays: allOutputDelays });
  const clockPorts = extractClockPorts({ clocks: allClocks });

  return {
    files: files,
    totalFiles: files.length,
    clocks: allClocks,
    generatedClocks: allGenClocks,
    clockPorts: [...clockPorts],
    inputDelays: allInputDelays,
    outputDelays: allOutputDelays,
    constrainedInputPorts: [...constrainedInput],
    constrainedOutputPorts: [...constrainedOutput],
    allConstrainedPorts: [...allConstrained],
    summary: {
      clockCount: allClocks.length,
      generatedClockCount: allGenClocks.length,
      inputDelayCount: allInputDelays.length,
      outputDelayCount: allOutputDelays.length,
      constrainedInputCount: constrainedInput.size,
      constrainedOutputCount: constrainedOutput.size,
    },
    errors: allParsed.flatMap(p => p.errors || []),
  };
}
