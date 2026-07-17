/**
 * Graph Builder — 將 parser 輸出轉換為結構化查詢圖
 *
 * 支援兩種 parser 輸出：
 *   1. slang JSON（完整 elaboration，有完整 instantiation tree）
 *   2. regex-fallback（基本 module + port，簡化 instantiation）
 *
 * 統一輸出格式供 Query Engine 使用
 */

// ═══════════════════════════════════════════════════════════════════════════
// 資料結構
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PortInfo
 * @property {string} name
 * @property {'input'|'output'|'inout'|'unknown'} direction
 * @property {number} width - bit width
 * @property {string|null} bus - e.g. "[31:0]" or null for 1-bit
 * @property {string|null} type - data type (logic, reg, wire, etc.)
 */

/**
 * @typedef {Object} InstanceInfo
 * @property {string} name - instance name
 * @property {string} module - module type name
 * @property {number} line - source line
 * @property {Object<string,string>} portMap - .port(signal) mapping
 */

/**
 * @typedef {Object} ModuleInfo
 * @property {string} name
 * @property {string} file - source file (relative)
 * @property {number} line
 * @property {PortInfo[]} ports
 * @property {InstanceInfo[]} instances
 * @property {boolean} isTop
 */

/**
 * @typedef {Object} DesignGraph
 * @property {Map<string,ModuleInfo>} modules - name → ModuleInfo
 * @property {string[]} topModules
 * @property {Map<string,string[]>} parentMap - module → parents (who instantiates it)
 * @property {Object} stats
 */

// ═══════════════════════════════════════════════════════════════════════════
// Graph 建構
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 從 parser 輸出建構統一的 DesignGraph
 * @param {object} parserOutput - parseRTL() 的 data 欄位
 * @param {string} parser - parser 類型 ('slang' | 'regex-fallback')
 * @returns {DesignGraph}
 */
export function buildGraph(parserOutput, parser = 'regex-fallback') {
  if (parser === 'slang') {
    return buildFromSlang(parserOutput);
  }
  return buildFromRegex(parserOutput);
}

// ── slang v11 JSON → DesignGraph ─────────────────────────────────────────
//
// slang v11 AST 結構：
//   design.members[] → CompilationUnit | Instance (top)
//   Instance.body.members[] → Port | Net | Variable | Instance | ...
//   Instance.connections[] → { port: Port, expr: Expression } (child instances)
//
// 關鍵：connections 只出現在 child instance，top Instance 沒有

function buildFromSlang(json) {
  const modules = new Map();
  const parentMap = new Map();

  const design = json.design || json;
  const members = design.members || [];

  // 找 top Instance (kind === 'Instance' 在 design.members 裡)
  const topInstance = members.find(m => m.kind === 'Instance');
  if (!topInstance) {
    // fallback: 如果找不到 Instance，嘗試 flat module list
    return buildFromSlangFlat(json);
  }

  // 從 top Instance recursive 建構 module tree
  traverseInstance(topInstance, null, modules, parentMap);

  // 建構 topModules
  const allModuleNames = new Set(modules.keys());
  const instantiated = new Set();
  for (const [, mod] of modules) {
    for (const inst of mod.instances) {
      instantiated.add(inst.module);
    }
  }

  const topModules = [...allModuleNames].filter(n => !instantiated.has(n));

  // 標記 isTop
  for (const name of topModules) {
    const mod = modules.get(name);
    if (mod) mod.isTop = true;
  }

  return {
    modules,
    topModules,
    parentMap,
    stats: computeStats(modules),
  };
}

// recursive traverse Instance tree
function traverseInstance(instanceNode, parentModuleName, modules, parentMap) {
  const instanceName = instanceNode.name || 'unknown';
  const body = instanceNode.body || {};
  const bodyMembers = body.members || [];

  // 取得 module name (from body.name)
  const moduleName = body.name || instanceName;

  // 如果 module 已經建構過，跳過（避免重複）
  if (modules.has(moduleName)) {
    // 但還是要記錄 parentMap
    if (parentModuleName) {
      if (!parentMap.has(moduleName)) parentMap.set(moduleName, []);
      if (!parentMap.get(moduleName).includes(parentModuleName)) {
        parentMap.get(moduleName).push(parentModuleName);
      }
    }
    return;
  }

  // 從 body members 提取 ports, signals, child instances
  const ports = [];
  const signals = [];
  const childInstances = [];

  for (const member of bodyMembers) {
    if (member.kind === 'Port') {
      ports.push(extractPort(member));
    } else if (member.kind === 'Net' || member.kind === 'Variable') {
      signals.push(extractSignal(member));
    } else if (member.kind === 'Instance') {
      childInstances.push(member);
    }
  }

  // 從 connections 提取 portMap (child instances 的 port mapping)
  // connections 在 Instance 級別，不在 body 裡
  const instanceConnections = instanceNode.connections || [];
  const portMap = extractPortMap(instanceConnections);

  // 建構 module info
  const modInfo = {
    name: moduleName,
    file: body.file || 'unknown',
    line: body.startLine || 0,
    ports,
    signals,
    instances: [], // 稍後填入
    portMap,       // top-level port mapping (如果有)
    isTop: false,
  };

  modules.set(moduleName, modInfo);

  // 記錄 parentMap
  if (parentModuleName) {
    if (!parentMap.has(moduleName)) parentMap.set(moduleName, []);
    if (!parentMap.get(moduleName).includes(parentModuleName)) {
      parentMap.get(moduleName).push(parentModuleName);
    }
  }

  // recursive traverse child instances
  for (const childInst of childInstances) {
    const childModuleName = childInst.body?.name || childInst.name || 'unknown';

    // 記錄 instance info
    modInfo.instances.push({
      name: childInst.name || 'unknown',
      module: childModuleName,
      line: childInst.body?.startLine || 0,
      portMap: extractPortMap(childInst.connections || []),
    });

    // recursive
    traverseInstance(childInst, moduleName, modules, parentMap);
  }
}

// 提取 Port info
function extractPort(portNode) {
  const typeStr = portNode.type || '';
  const { width, bus } = parseTypeWidth(typeStr);

  return {
    name: portNode.name || 'unknown',
    direction: normalizeDirection(portNode.direction || 'unknown'),
    width,
    bus,
    type: typeStr,
  };
}

// 提取 Signal (Net/Variable) info
function extractSignal(signalNode) {
  const typeStr = signalNode.type || signalNode.netType?.type || '';
  const { width, bus } = parseTypeWidth(typeStr);

  return {
    name: signalNode.name || 'unknown',
    type: typeStr,
    kind: signalNode.kind, // 'Net' or 'Variable'
    width,
    bus,
  };
}

// 從 connections 陣列提取 portMap
function extractPortMap(connections) {
  const portMap = {};
  for (const conn of connections) {
    const portName = conn.port?.name;
    if (!portName) continue;

    const expr = conn.expr;
    if (!expr) {
      portMap[portName] = '(unconnected)';
      continue;
    }

    // 根據 expression 類型提取連接的 signal
    portMap[portName] = extractExpressionString(expr);
  }
  return portMap;
}

// 從 Expression 提取可讀字串
function extractExpressionString(expr) {
  if (!expr) return '(empty)';

  switch (expr.kind) {
    case 'NamedValue': {
      // 直接連接到某個 signal
      const sym = expr.symbol || '';
      // symbol 格式: "6072364897304 reg_rdata1" → 取後半
      const parts = sym.split(' ');
      return parts.length > 1 ? parts[1] : sym;
    }
    case 'RangeSelect': {
      // instr[14:11] 格式
      const base = extractExpressionString(expr.value);
      const left = expr.left?.constant || expr.left?.value || '?';
      const right = expr.right?.constant || expr.right?.value || '?';
      return `${base}[${left}:${right}]`;
    }
    case 'Assignment': {
      // output port: .result(alu_result)
      const left = extractExpressionString(expr.left);
      return left;
    }
    case 'Conversion': {
      return extractExpressionString(expr.operand);
    }
    case 'IntegerLiteral': {
      return expr.constant || expr.value || '?';
    }
    case 'Concatenation': {
      const elems = (expr.operands || []).map(extractExpressionString);
      return `{${elems.join(', ')}}`;
    }
    default:
      return `(${expr.kind})`;
  }
}

// 從 type 字串解析 width
function parseTypeWidth(typeStr) {
  if (!typeStr) return { width: 1, bus: null };

  // match "logic[31:0]" or "reg[4:0]" etc.
  const m = typeStr.match(/\[(\d+):(\d+)\]/);
  if (m) {
    const msb = parseInt(m[1]);
    const lsb = parseInt(m[2]);
    return { width: msb - lsb + 1, bus: `[${msb}:${lsb}]` };
  }

  return { width: 1, bus: null };
}

// fallback: flat module list (for older slang versions)
function buildFromSlangFlat(json) {
  const modules = new Map();
  const parentMap = new Map();

  const design = json.design || json;
  if (Array.isArray(design)) {
    for (const mod of design) {
      if (mod.type !== 'module' && mod.kind !== 'module') continue;
      const info = convertSlangModuleLegacy(mod);
      modules.set(info.name, info);
    }
  } else if (design.modules) {
    for (const mod of design.modules) {
      const info = convertSlangModuleLegacy(mod);
      modules.set(info.name, info);
    }
  }

  const allModuleNames = new Set(modules.keys());
  const instantiated = new Set();
  for (const [, mod] of modules) {
    for (const inst of mod.instances) {
      instantiated.add(inst.module);
      if (!parentMap.has(inst.module)) parentMap.set(inst.module, []);
      parentMap.get(inst.module).push(mod.name);
    }
  }

  const topModules = [...allModuleNames].filter(n => !instantiated.has(n));

  return {
    modules,
    topModules,
    parentMap,
    stats: computeStats(modules),
  };
}

function convertSlangModuleLegacy(mod) {
  const name = mod.name || mod.moduleName || 'unknown';
  const file = mod.file || mod.sourceFile || 'unknown';
  const line = mod.line || mod.startLine || 0;

  const ports = (mod.ports || mod.portList || []).map(p => ({
    name: p.name || 'unknown',
    direction: normalizeDirection(p.direction || p.portDirection || 'unknown'),
    width: computeWidth(p),
    bus: formatBus(p),
    type: p.type || p.dataType || null,
  }));

  const instances = (mod.instances || []).map(inst => ({
    name: inst.name || inst.instanceName || 'unknown',
    module: inst.module || inst.moduleName || inst.type || 'unknown',
    line: inst.line || inst.startLine || 0,
    portMap: inst.portMap || inst.connections || {},
  }));

  return { name, file, line, ports, instances, isTop: false };
}

// ── regex fallback → DesignGraph ──────────────────────────────────────────

function buildFromRegex(regexOutput) {
  const modules = new Map();
  const parentMap = new Map();

  for (const mod of regexOutput.modules || []) {
    modules.set(mod.name, mod);
  }

  // 建構 parentMap
  const instantiated = new Set();
  for (const [, mod] of modules) {
    for (const inst of mod.instances) {
      instantiated.add(inst.module);
      if (!parentMap.has(inst.module)) parentMap.set(inst.module, []);
      parentMap.get(inst.module).push(mod.name);
    }
  }

  // 標記 top module
  for (const [, mod] of modules) {
    mod.isTop = !instantiated.has(mod.name);
  }

  const topModules = [...modules.values()].filter(m => m.isTop).map(m => m.name);

  return {
    modules,
    topModules,
    parentMap,
    stats: computeStats(modules),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 查詢 API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 取得完整的 module hierarchy tree
 * @param {DesignGraph} graph
 * @param {string} [targetModule] - 指定起始 module（預設 top）
 * @returns {object} tree structure
 */
export function getHierarchy(graph, targetModule = null) {
  const startModules = targetModule
    ? [targetModule]
    : graph.topModules;

  if (startModules.length === 0) {
    return { error: '找不到 top module', trees: [] };
  }

  function buildTree(modName, visited = new Set()) {
    if (visited.has(modName)) return { name: modName, cycle: true };
    visited.add(modName);

    const mod = graph.modules.get(modName);
    if (!mod) return { name: modName, unknown: true };

    return {
      name: modName,
      file: mod.file,
      line: mod.line,
      ports: mod.ports.length,
      children: mod.instances.map(inst => ({
        ...buildTree(inst.module, new Set(visited)),
        instanceName: inst.name,
      })),
    };
  }

  return {
    trees: startModules.map(name => buildTree(name)),
    maxDepth: computeMaxDepth(graph, startModules[0]),
  };
}

/**
 * 取得指定 module 的 port list
 */
export function getModulePorts(graph, moduleName) {
  const mod = graph.modules.get(moduleName);
  if (!mod) return { error: `找不到 module: ${moduleName}` };
  return {
    name: mod.name,
    file: mod.file,
    line: mod.line,
    ports: mod.ports,
    portCount: mod.ports.length,
    inputs: mod.ports.filter(p => p.direction === 'input'),
    outputs: mod.ports.filter(p => p.direction === 'output'),
    inouts: mod.ports.filter(p => p.direction === 'inout'),
  };
}

/**
 * 取得指定 module 的所有 signal 宣告（wire/reg/variable）
 * @param {DesignGraph} graph
 * @param {string} moduleName
 * @returns {object} signal list
 */
export function getModuleSignals(graph, moduleName) {
  const mod = graph.modules.get(moduleName);
  if (!mod) return { error: `找不到 module: ${moduleName}` };

  const signals = mod.signals || [];
  return {
    name: mod.name,
    file: mod.file,
    signals,
    signalCount: signals.length,
    nets: signals.filter(s => s.kind === 'Net'),
    variables: signals.filter(s => s.kind === 'Variable'),
  };
}

/**
 * 追蹤 signal 從 source 到 sink 的路徑
 * @param {DesignGraph} graph
 * @param {string} signalName - 要追蹤的 signal 名稱
 * @param {string} [startModule] - 起始 module（預設 top）
 * @returns {object} trace path
 */
export function traceSignal(graph, signalName, startModule = null) {
  const traces = [];
  const visited = new Set();

  // 從 top module 開始搜尋
  const startModules = startModule
    ? [startModule]
    : graph.topModules;

  if (startModules.length === 0) {
    return { error: '找不到 top module', traces: [] };
  }

  // recursive 追蹤 signal
  function traceInModule(moduleName, path = []) {
    if (visited.has(moduleName)) return;
    visited.add(moduleName);

    const mod = graph.modules.get(moduleName);
    if (!mod) return;

    // 檢查這個 module 的 port connection
    for (const inst of mod.instances) {
      const portMap = inst.portMap || {};

      // 檢查每個 port connection
      for (const [portName, connectedSignal] of Object.entries(portMap)) {
        if (!connectedSignal) continue;

        // 檢查是否連接到目標 signal
        const baseSignal = connectedSignal.split('[')[0]; // 移除 range select
        if (baseSignal === signalName) {
          traces.push({
            module: moduleName,
            instance: inst.name,
            instanceModule: inst.module,
            port: portName,
            connectedTo: connectedSignal,
            line: inst.line,
          });
        }

        // 遞迴到子 module
        traceInModule(inst.module, [...path, `${moduleName}.${inst.name}`]);
      }
    }

    // 檢查 module 的 signal 宣告
    const modSignals = mod.signals || [];
    for (const sig of modSignals) {
      if (sig.name === signalName) {
        traces.push({
          module: moduleName,
          declaration: true,
          type: sig.kind,
          bus: sig.bus,
        });
      }
    }
  }

  for (const startMod of startModules) {
    traceInModule(startMod);
  }

  return {
    signalName,
    traces,
    traceCount: traces.length,
  };
}

/**
 * 找出所有 unconnected ports（有 port 但沒連接）
 * @param {DesignGraph} graph
 * @returns {object} unconnected ports list
 */
export function findUnconnectedPorts(graph) {
  const unconnected = [];

  for (const [moduleName, mod] of graph.modules) {
    for (const inst of mod.instances) {
      const portMap = inst.portMap || {};

      // 檢查 module 的 port 定義
      const instMod = graph.modules.get(inst.module);
      if (!instMod) continue;

      for (const port of instMod.ports) {
        const connected = portMap[port.name];
        if (!connected || connected === '(unconnected)') {
          unconnected.push({
            module: moduleName,
            instance: inst.name,
            instanceModule: inst.module,
            port: port.name,
            direction: port.direction,
            width: port.width,
            line: inst.line,
          });
        }
      }
    }
  }

  return {
    unconnected,
    count: unconnected.length,
  };
}

/**
 * 找出 float signals（有 driver 無 load / 有 load 無 driver）
 * @param {DesignGraph} graph
 * @returns {object} float signals list
 */
export function findFloatSignals(graph) {
  const noLoad = [];   // 有 driver 無 load
  const noDriver = []; // 有 load 無 driver

  for (const [moduleName, mod] of graph.modules) {
    // 收集所有 port connection 中用到的 signal
    const signalsWithDriver = new Set();
    const signalsWithLoad = new Set();

    // 收集 module 的 port names（避免把 port 當成 internal signal 檢查）
    const portNames = new Set(mod.ports.map(p => p.name));

    for (const inst of mod.instances) {
      const portMap = inst.portMap || {};
      const instMod = graph.modules.get(inst.module);

      for (const [portName, connectedSignal] of Object.entries(portMap)) {
        if (!connectedSignal || connectedSignal === '(unconnected)') continue;

        const baseSignal = connectedSignal.split('[')[0];

        // 找到對應的 port direction
        const port = instMod?.ports.find(p => p.name === portName);
        if (!port) continue;

        if (port.direction === 'input') {
          // input port → connected signal is driving into the instance → signal has a load
          signalsWithLoad.add(baseSignal);
        } else if (port.direction === 'output') {
          // output port → connected signal receives data from the instance → signal has a driver
          signalsWithDriver.add(baseSignal);
        } else if (port.direction === 'inout') {
          signalsWithDriver.add(baseSignal);
          signalsWithLoad.add(baseSignal);
        }
      }
    }

    // 也把 top-level port 納入考量（top module 的 input port 由外部驅動）
    if (mod.isTop) {
      for (const port of mod.ports) {
        if (port.direction === 'input') {
          // top-level input: 由外部驅動 → 有 driver
          signalsWithDriver.add(port.name);
        } else if (port.direction === 'output') {
          // top-level output: 被外部消費 → 有 load
          signalsWithLoad.add(port.name);
        } else if (port.direction === 'inout') {
          signalsWithDriver.add(port.name);
          signalsWithLoad.add(port.name);
        }
      }
    }

    // 檢查 module 內宣告的 signal（跳過 port，port 由外部連接）
    for (const sig of (mod.signals || [])) {
      const name = sig.name;
      if (portNames.has(name)) continue; // port 不是 internal signal

      if (signalsWithDriver.has(name) && !signalsWithLoad.has(name)) {
        noLoad.push({
          module: moduleName,
          signal: name,
          type: sig.kind,
          bus: sig.bus,
          reason: 'declared but never used as a load',
        });
      } else if (!signalsWithDriver.has(name) && signalsWithLoad.has(name)) {
        noDriver.push({
          module: moduleName,
          signal: name,
          type: sig.kind,
          bus: sig.bus,
          reason: 'consumed but never driven',
        });
      } else if (!signalsWithDriver.has(name) && !signalsWithLoad.has(name)) {
        // 宣告了但完全沒用到（也沒 driver 也沒 load）
        noLoad.push({
          module: moduleName,
          signal: name,
          type: sig.kind,
          bus: sig.bus,
          reason: 'declared but not connected to any port',
        });
      }
    }
  }

  return {
    noLoad,
    noDriver,
    noLoadCount: noLoad.length,
    noDriverCount: noDriver.length,
  };
}

/**
 * 找出 width mismatch 的 ports
 * @param {DesignGraph} graph
 * @returns {object} width mismatch list
 */
export function findWidthMismatches(graph) {
  const mismatches = [];

  for (const [moduleName, mod] of graph.modules) {
    for (const inst of mod.instances) {
      const portMap = inst.portMap || {};

      const instMod = graph.modules.get(inst.module);
      if (!instMod) continue;

      for (const port of instMod.ports) {
        const connected = portMap[port.name];
        if (!connected || connected === '(unconnected)') continue;

        // 嘗試解析連接 signal 的 width
        const connectedWidth = parseSignalWidth(connected);
        if (connectedWidth !== null && connectedWidth !== port.width) {
          mismatches.push({
            module: moduleName,
            instance: inst.name,
            port: port.name,
            portWidth: port.width,
            connectedSignal: connected,
            connectedWidth,
            line: inst.line,
          });
        }
      }
    }
  }

  return {
    mismatches,
    count: mismatches.length,
  };
}

// 輔助：從 signal 字串解析 width
function parseSignalWidth(signalStr) {
  if (!signalStr) return null;

  // match "signal[31:0]" pattern
  const m = signalStr.match(/\[(\d+):(\d+)\]/);
  if (m) {
    const msb = parseInt(m[1]);
    const lsb = parseInt(m[2]);
    return msb - lsb + 1;
  }

  return null; // 無法解析
}

/**
 * 取得完整設計分析
 */
export function analyzeDesign(graph) {
  const floatSignals = findFloatSignals(graph);

  // 收集 top-level ports（所有 top module 的 input/output port）
  const topLevelPorts = [];
  for (const topName of graph.topModules) {
    const topMod = graph.modules.get(topName);
    if (topMod) {
      for (const port of topMod.ports) {
        topLevelPorts.push({
          name: port.name,
          direction: port.direction,
          width: port.width || 1,
          module: topName,
          file: topMod.file,
        });
      }
    }
  }

  return {
    stats: { ...graph.stats, floatSignals: floatSignals.noLoadCount + floatSignals.noDriverCount },
    topModules: graph.topModules,
    topLevelPorts,
    modules: [...graph.modules.values()].map(m => ({
      name: m.name,
      file: m.file,
      ports: m.ports.length,
      instances: m.instances.length,
      isTop: m.isTop,
    })),
    parentMap: Object.fromEntries(graph.parentMap),
    floatSignals,
  };
}

/**
 * 列出所有 module 名稱
 */
export function listModules(graph) {
  return [...graph.modules.keys()].sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// 統計
// ═══════════════════════════════════════════════════════════════════════════

function computeStats(modules) {
  let totalPorts = 0;
  let totalInstances = 0;
  let totalInputs = 0;
  let totalOutputs = 0;

  for (const [, mod] of modules) {
    totalPorts += mod.ports.length;
    totalInstances += mod.instances.length;
    totalInputs += mod.ports.filter(p => p.direction === 'input').length;
    totalOutputs += mod.ports.filter(p => p.direction === 'output').length;
  }

  return {
    moduleCount: modules.size,
    totalPorts,
    totalInstances,
    totalInputs,
    totalOutputs,
    topModuleCount: [...modules.values()].filter(m => m.isTop).length,
  };
}

function computeMaxDepth(graph, startModule, depth = 0, visited = new Set()) {
  if (!startModule || visited.has(startModule)) return depth;
  visited.add(startModule);

  const mod = graph.modules.get(startModule);
  if (!mod || mod.instances.length === 0) return depth;

  let maxChild = depth;
  for (const inst of mod.instances) {
    const childDepth = computeMaxDepth(graph, inst.module, depth + 1, new Set(visited));
    if (childDepth > maxChild) maxChild = childDepth;
  }
  return maxChild;
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具函式
// ═══════════════════════════════════════════════════════════════════════════

function normalizeDirection(dir) {
  const d = String(dir).toLowerCase();
  // slang v11 uses 'In'/'Out'/'InOut' (capitalized)
  if (d === 'in' || d === 'input') return 'input';
  if (d === 'out' || d === 'output') return 'output';
  if (d === 'inout') return 'inout';
  // fallback: check contains
  if (d.includes('input') && !d.includes('output')) return 'input';
  if (d.includes('output')) return 'output';
  if (d.includes('inout')) return 'inout';
  return 'unknown';
}

function computeWidth(port) {
  if (port.width) return port.width;
  if (port.range) {
    const m = String(port.range).match(/(\d+)\s*:\s*(\d+)/);
    if (m) return parseInt(m[1]) - parseInt(m[2]) + 1;
  }
  if (port.msb !== undefined && port.lsb !== undefined) {
    return port.msb - port.lsb + 1;
  }
  return 1;
}

function formatBus(port) {
  const w = computeWidth(port);
  if (w <= 1) return null;
  if (port.range) return `[${port.range}]`;
  return `[${w - 1}:0]`;
}
