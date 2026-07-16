/**
 * hdl-kgraph — HDL Knowledge Graph wrapper
 *
 * 封裝 hdl-kgraph CLI 工具，提供 design 結構查詢能力。
 * hdl-kgraph 是 Python 專案：pip install 'hdl-kgraph[mcp]'
 *
 * 使用方式：使用者需先在 HDL 專案目錄執行 `hdl-kgraph build` 建立 graph.db，
 * 本模組偵測到 graph.db 後自動提供 KG 查詢。
 *
 * 9 個 MCP tools（read-only）：
 *   find_module, get_hierarchy, who_instantiates, port_map,
 *   impact_of_change, clock_domains, find_signal_drivers,
 *   uvm_topology, search_nodes
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

// hdl-kgraph CLI 工具名稱
const KGRAPH_CMD = 'hdl-kgraph';

// 快取：可用性偵測結果（session 內只偵測一次）
let _available = null;
let _graphDbPath = null;

/**
 * 偵測 hdl-kgraph CLI 是否可用
 * @param {string} cwd — 目前工作目錄（用來尋找 .hdl-kgraph/graph.db）
 * @returns {Promise<{available: boolean, graphDb?: string}>}
 */
export async function detectHdlKgraph(cwd = process.cwd()) {
  if (_available !== null) return { available: _available, graphDb: _graphDbPath };

  // 檢查 CLI 是否存在
  try {
    await execFileAsync(KGRAPH_CMD, ['--version'], { timeout: 5000 });
  } catch {
    _available = false;
    return { available: false };
  }

  // 檢查 graph.db 是否存在（多個候選路徑）
  const candidates = [
    join(cwd, '.hdl-kgraph', 'graph.db'),
    join(cwd, 'graph.db'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _available = true;
      _graphDbPath = p;
      return { available: true, graphDb: p };
    }
  }

  // CLI 可用但無 graph.db
  _available = true;
  return { available: true };
}

/**
 * 呼叫 hdl-kgraph CLI 工具
 * @param {string} tool — 工具名稱（find_module, get_hierarchy, etc.）
 * @param {Object} args — 工具參數
 * @param {Object} options — 選項
 * @param {string} options.cwd — 工作目錄
 * @param {string} options.db — graph.db 路徑
 * @param {number} options.timeout — 超時 ms（預設 10000）
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
export async function queryKGraph(tool, args = {}, options = {}) {
  const { cwd = process.cwd(), db, timeout = 10000 } = options;

  // 構建 CLI 參數
  const cliArgs = ['tools', tool];
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== '') {
      cliArgs.push(`--${k}`, String(v));
    }
  }
  if (db) cliArgs.push('--db', db);

  try {
    const { stdout } = await execFileAsync(KGRAPH_CMD, cliArgs, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
    });
    const data = JSON.parse(stdout);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 查詢 design 層級結構
 */
export async function getHierarchy(top = null, depth = 3, options = {}) {
  const args = {};
  if (top) args.top = top;
  args.depth = depth;
  return queryKGraph('get_hierarchy', args, options);
}

/**
 * 查詢模組資訊
 */
export async function findModule(name, options = {}) {
  return queryKGraph('find_module', { name, limit: 10 }, options);
}

/**
 * 查詢誰實例化了某個模組
 */
export async function whoInstantiates(name, options = {}) {
  return queryKGraph('who_instantiates', { name, limit: 20 }, options);
}

/**
 * 查詢 port map
 */
export async function portMap(module, instance = null, options = {}) {
  const args = { module };
  if (instance) args.instance = instance;
  return queryKGraph('port_map', args, options);
}

/**
 * 查詢變更影響
 */
export async function impactOfChange(target, options = {}) {
  return queryKGraph('impact_of_change', { target, max_depth: 3, limit: 20 }, options);
}

/**
 * 查詢 clock domains
 */
export async function clockDomains(options = {}) {
  return queryKGraph('clock_domains', {}, options);
}

/**
 * 查詢 signal drivers
 */
export async function findSignalDrivers(signal, module = null, options = {}) {
  const args = { signal, limit: 10 };
  if (module) args.module = module;
  return queryKGraph('find_signal_drivers', args, options);
}

/**
 * 查詢 UVM topology
 */
export async function uvmTopology(options = {}) {
  return queryKGraph('uvm_topology', {}, options);
}

/**
 * 通用搜尋
 */
export async function searchNodes(name, kinds = null, options = {}) {
  const args = { name, limit: 20 };
  if (kinds) args.kinds = kinds;
  return queryKGraph('search_nodes', args, options);
}

/**
 * 格式化 KG 查詢結果為 Markdown
 */
export function formatKgResult(data, tool) {
  if (!data) return '';

  // 響應式格式化：根據工具類型選擇最佳呈現
  const items = data.items || data.results || [];
  const total = data.total || items.length;

  if (items.length === 0) return '';

  let out = '';

  switch (tool) {
    case 'get_hierarchy': {
      out += `🏗️ **Design Hierarchy** (${total} nodes)\n\n`;
      for (const item of items.slice(0, 20)) {
        const indent = '  '.repeat(item.depth || 0);
        const icon = item.kind === 'module' ? '📦' : '📄';
        out += `${indent}${icon} **${item.name || item.unit}**`;
        if (item.file) out += ` \`${item.file}\``;
        if (item.ports) out += ` (${item.ports} ports)`;
        out += '\n';
      }
      break;
    }
    case 'find_module': {
      for (const item of items) {
        out += `📦 **${item.name}**\n`;
        if (item.file) out += `  檔案：\`${item.file}\`\n`;
        if (item.ports !== undefined) out += `  Ports：${item.ports}\n`;
        if (item.parameters !== undefined) out += `  Parameters：${item.parameters}\n`;
        if (item.instantiations !== undefined) out += `  實例化：${item.instantiations}\n`;
        out += '\n';
      }
      break;
    }
    case 'who_instantiates': {
      out += `🔍 **${items.length} locations** instantiate this module:\n\n`;
      for (const item of items.slice(0, 15)) {
        out += `- \`${item.file || '?'}\`: `;
        out += `**${item.instance || item.name}**`;
        if (item.line) out += ` (line ${item.line})`;
        out += '\n';
      }
      break;
    }
    case 'impact_of_change': {
      out += `⚠️ **Impact Analysis** (${total} affected units)\n\n`;
      for (const item of items.slice(0, 15)) {
        const icon = item.severity === 'high' ? '🔴' : item.severity === 'medium' ? '🟡' : '🟢';
        out += `${icon} **${item.name || item.unit}**`;
        if (item.reason) out += ` — ${item.reason}`;
        out += '\n';
      }
      break;
    }
    case 'clock_domains': {
      const domains = items;
      out += `🕐 **Clock Domains** (${domains.length})\n\n`;
      for (const d of domains) {
        out += `- **${d.name}**`;
        if (d.signals) out += ` (${d.signals} signals)`;
        if (d.cdc_suspects) out += ` ⚠️ ${d.cdc_suspects} CDC suspects`;
        out += '\n';
      }
      break;
    }
    case 'uvm_topology': {
      out += `🧪 **UVM Topology** (${total} components)\n\n`;
      for (const item of items.slice(0, 15)) {
        out += `- **${item.name}** (${item.role || item.kind})`;
        if (item.file) out += ` \`${item.file}\``;
        out += '\n';
      }
      break;
    }
    case 'port_map': {
      out += `🔌 **Port Map** (${items.length} ports)\n\n`;
      for (const item of items) {
        out += `- **${item.port}**: ${item.direction || ''} ${item.type || ''}`;
        if (item.connection) out += ` → ${item.connection}`;
        out += '\n';
      }
      break;
    }
    case 'find_signal_drivers': {
      out += `⚡ **Signal Drivers** (${items.length})\n\n`;
      for (const item of items) {
        out += `- **${item.signal || item.name}**`;
        if (item.module) out += ` in \`${item.module}\``;
        if (item.type) out += ` (${item.type})`;
        out += '\n';
      }
      break;
    }
    default: {
      // search_nodes 或其他
      out += `🔍 **Search Results** (${total})\n\n`;
      for (const item of items.slice(0, 15)) {
        const icon = item.kind === 'module' ? '📦' : item.kind === 'signal' ? '⚡' : item.kind === 'class' ? '🧪' : '📄';
        out += `${icon} **${item.name}** (${item.kind || 'unknown'})`;
        if (item.file) out += ` \`${item.file}\``;
        out += '\n';
      }
    }
  }

  return out;
}

/**
 * 根據查詢內容自動選擇最佳 KG 工具
 * @returns {{tool: string, args: Object} | null}
 */
export function matchKgTool(query) {
  const q = query.toLowerCase();

  // 層級查詢
  if (q.includes('hierarchy') || q.includes('hierarch') || q.includes('層級') || q.includes('top module') || q.includes('top-level')) {
    const topMatch = q.match(/(?:top|module)\s+(\w+)/i);
    return { tool: 'get_hierarchy', args: { top: topMatch?.[1], depth: 3 } };
  }

  // 模組查詢
  if (q.includes('module') || q.includes('find') || q.includes('模組')) {
    const nameMatch = q.match(/(?:module|find|搜尋)\s+(\w+)/i);
    if (nameMatch) return { tool: 'find_module', args: { name: nameMatch[1] } };
  }

  // 實例化查詢
  if (q.includes('instantiat') || q.includes('instance') || q.includes('實例') || q.includes('誰用') || q.includes('who use')) {
    const nameMatch = q.match(/(\w+)/g)?.find(w => w.length > 2 && !['who', 'use', 'instantiat', 'instance', 'the', 'is'].includes(w.toLowerCase()));
    if (nameMatch) return { tool: 'who_instantiates', args: { name: nameMatch } };
  }

  // 變更影響
  if (q.includes('impact') || q.includes('change') || q.includes('影響') || q.includes('break') || q.includes('影響')) {
    const targetMatch = q.match(/(?:impact|change|影響|break)\s+(?:of\s+)?(\w+)/i);
    if (targetMatch) return { tool: 'impact_of_change', args: { target: targetMatch[1] } };
  }

  // Clock domain / CDC
  if (q.includes('clock') || q.includes('cdc') || q.includes('domain') || q.includes('時脈')) {
    return { tool: 'clock_domains', args: {} };
  }

  // UVM
  if (q.includes('uvm') || q.includes('testbench') || q.includes('tb')) {
    return { tool: 'uvm_topology', args: {} };
  }

  // Port map
  if (q.includes('port') || q.includes('portmap') || q.includes('連接')) {
    const moduleMatch = q.match(/(?:port|portmap|連接)\s+(?:of\s+)?(\w+)/i);
    if (moduleMatch) return { tool: 'port_map', args: { module: moduleMatch[1] } };
  }

  // Signal driver
  if (q.includes('signal') || q.includes('driver') || q.includes('訊號') || q.includes('驅動')) {
    const signalMatch = q.match(/(?:signal|driver|訊號|驅動)\s+(\w+)/i);
    if (signalMatch) return { tool: 'find_signal_drivers', args: { signal: signalMatch[1] } };
  }

  return null;
}
