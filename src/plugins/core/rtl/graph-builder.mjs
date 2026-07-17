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

// ── slang JSON → DesignGraph ──────────────────────────────────────────────

function buildFromSlang(json) {
  const modules = new Map();
  const parentMap = new Map();

  // slang --json output 格式：{ design: { top: [...], modules: [...] } }
  // 實際格式可能不同，需要根據 slang 版本調整
  const design = json.design || json;

  // 如果 slang 輸出是 flat module list
  if (Array.isArray(design)) {
    for (const mod of design) {
      if (mod.type !== 'module' && mod.kind !== 'module') continue;
      const info = convertSlangModule(mod);
      modules.set(info.name, info);
    }
  } else if (design.modules) {
    for (const mod of design.modules) {
      const info = convertSlangModule(mod);
      modules.set(info.name, info);
    }
  }

  // 建構 parentMap + 找 top
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

function convertSlangModule(mod) {
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

  const instances = (mod.instances || mod.instances || []).map(inst => ({
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
 * 取得完整設計分析
 */
export function analyzeDesign(graph) {
  return {
    stats: graph.stats,
    topModules: graph.topModules,
    modules: [...graph.modules.values()].map(m => ({
      name: m.name,
      file: m.file,
      ports: m.ports.length,
      instances: m.instances.length,
      isTop: m.isTop,
    })),
    parentMap: Object.fromEntries(graph.parentMap),
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
