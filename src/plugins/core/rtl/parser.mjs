/**
 * RTL Parser — 智能偵測 + 多層降級
 *
 * 優先級：slang（完整 elaboration）→ tree-sitter-verilog（語法解析）→ 純文字 regex（fallback）
 *
 * 使用方式：
 *   import { parseRTL, getParserInfo, discoverFiles } from './parser.mjs';
 *   const result = await parseRTL('/path/to/rtl', { filelist: 'filelist.f' });
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, extname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════

const RTL_EXTENSIONS = new Set(['.v', '.sv', '.vh', '.svh', '.vhd', '.vhdl']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', 'build', 'output', 'sim', 'tb']);

// ═══════════════════════════════════════════════════════════════════════════
// Parser 偵測
// ═══════════════════════════════════════════════════════════════════════════

function tryExec(cmd, timeout = 5000) {
  try { return execSync(cmd, { encoding: 'utf-8', timeout }).trim(); }
  catch { return null; }
}

/**
 * 偵測可用的 parser
 * @returns {Array<{name, available, version, path}>}
 */
export function detectParsers() {
  const parsers = [];

  // 1. slang — 嘗試 PATH + ~/bin
  for (const candidate of ['slang', `${process.env.HOME}/bin/slang`]) {
    const ver = tryExec(`${candidate} --version`);
    if (ver) {
      parsers.push({ name: 'slang', available: true, version: ver, path: candidate });
      break;
    }
  }
  if (!parsers.find(p => p.name === 'slang')) {
    parsers.push({ name: 'slang', available: false, version: null, path: null });
  }

  // 2. verilator (輔助 lint)
  const verVer = tryExec('verilator --version');
  parsers.push({
    name: 'verilator',
    available: !!verVer,
    version: verVer,
    path: verVer ? 'verilator' : null,
  });

  // 3. tree-sitter-verilog (嘗試動態 import)
  // 同步检测，不 await
  let tsAvailable = false;
  try { require.resolve('tree-sitter-verilog'); tsAvailable = true; } catch { /* ignore */ }
  parsers.push({
    name: 'tree-sitter-verilog',
    available: tsAvailable,
    version: tsAvailable ? 'native' : null,
    path: tsAvailable ? 'node_modules' : null,
  });

  return parsers;
}

/**
 * 取得最佳可用 parser 資訊（含安裝建議）
 */
export function getParserInfo() {
  const parsers = detectParsers();
  const best = parsers.find(p => p.available);
  const suggestions = [];

  if (!best) {
    suggestions.push('安裝 slang（推薦）：https://github.com/MikePopoloski/slang#building');
    suggestions.push('或安裝 tree-sitter-verilog：npm install tree-sitter-verilog');
  } else if (best.name === 'tree-sitter-verilog') {
    suggestions.push('安裝 slang 可獲得完整 elaboration 功能：https://github.com/MikePopoloski/slang#building');
  }

  return {
    parsers,
    best: best || { name: 'regex-fallback', available: true, version: 'built-in', path: null },
    suggestions,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// File Discovery
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 從 filelist.f 解析檔案清單
 */
function parseFilelist(filelistPath) {
  if (!existsSync(filelistPath)) return [];
  const content = readFileSync(filelistPath, 'utf-8');
  const files = [];
  const dir = resolve(filelistPath, '..');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // 處理 -f 遞迴 include
    if (trimmed.startsWith('-f ')) {
      const subPath = resolve(dir, trimmed.slice(3).trim().replace(/^"|"$/g, ''));
      files.push(...parseFilelist(subPath));
      continue;
    }

    // 跳過 +incdir, +define 等 directive
    if (trimmed.startsWith('+')) continue;

    const absPath = resolve(dir, trimmed.replace(/^"|"$/g, ''));
    if (existsSync(absPath)) files.push(absPath);
  }
  return files;
}

/**
 * 自動掃描 RTL 檔案
 * @param {string} root - 根目錄
 * @param {object} opts - { filelist, extensions }
 * @returns {string[]} 檔案路徑陣列
 */
export function discoverFiles(root, opts = {}) {
  const { filelist, extensions = RTL_EXTENSIONS } = opts;
  const rootDir = resolve(root);

  // 優先使用 filelist
  if (filelist) {
    const flPath = resolve(rootDir, filelist);
    return parseFilelist(flPath);
  }

  // 遞迴掃描
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (extensions.has(extname(entry.name).toLowerCase())) {
          files.push(join(dir, entry.name));
        }
      }
    }
  }
  walk(rootDir);
  return files.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// Parser 執行
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 使用 slang 執行 elaboration，回傳 JSON AST
 * slang v11+: --ast-json <file> (output to file, not stdout)
 */
function parseWithSlang(files, root, slangPath = 'slang') {
  const tmpFile = join(tmpdir(), `slang-ast-${Date.now()}.json`);
  try {
    const fileArgs = files.map(f => `"${f}"`).join(' ');
    // slang v11+: --ast-json <file> dumps compiled AST
    const cmd = `${slangPath} --ast-json "${tmpFile}" ${fileArgs}`;
    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: root,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const jsonStr = readFileSync(tmpFile, 'utf-8');
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`slang 解析失敗: ${err.message}`);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Regex fallback — 純文字解析最基礎的 module + port
 */
function parseWithRegex(files, root) {
  const modules = [];

  for (const filePath of files) {
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }
    const relPath = relative(root, filePath);
    const lines = content.split('\n');

    // 匹配 module/macromodule 定義
    const moduleRegex = /\b(module|macromodule)\s+(\w+)/g;
    let match;
    while ((match = moduleRegex.exec(content)) !== null) {
      const name = match[2];
      const startLine = content.slice(0, match.index).split('\n').length;

      // 找到 module body 的 port list
      const ports = extractPortsRegex(content, match.index, name);

      // 提取 instantiation（簡化版）
      const instances = extractInstancesRegex(content, name);

      modules.push({
        name,
        file: relPath,
        line: startLine,
        ports,
        instances,
        isTop: false, // 後續計算
      });
    }
  }

  // 計算 top module（沒有被其他 module instantiate 的）
  const instantiated = new Set();
  for (const mod of modules) {
    for (const inst of mod.instances) {
      instantiated.add(inst.module);
    }
  }
  for (const mod of modules) {
    mod.isTop = !instantiated.has(mod.name);
  }

  return { modules, parser: 'regex-fallback' };
}

/**
 * 從 module 定義中提取 port（regex fallback）
 */
function extractPortsRegex(content, matchStart, moduleName) {
  const ports = [];

  // 找 module 定義後的 (
  let parenStart = content.indexOf('(', matchStart);
  if (parenStart === -1 || parenStart > matchStart + 200) return ports;

  // 找到配對的 )
  let depth = 1;
  let i = parenStart + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') depth--;
    i++;
  }
  const portStr = content.slice(parenStart + 1, i - 1);

  // 按逗號分割
  for (const part of portStr.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[tokens.length - 1]?.replace(/;$/, '');
    if (!name || !/^[a-zA-Z_]\w*$/.test(name)) continue;

    const isInput = /\binput\b/.test(trimmed);
    const isOutput = /\boutput\b/.test(trimmed);
    const isInOut = /\binout\b/.test(trimmed);
    const direction = isInOut ? 'inout' : isInput ? 'input' : isOutput ? 'output' : 'unknown';
    const width = extractWidth(trimmed);

    ports.push({ name, direction, width, bus: width > 1 ? `[${width-1}:0]` : null });
  }

  // 如果 port list 裡沒有 direction（ANSI 前風格），往 module body 找
  if (ports.length > 0 && ports.every(p => p.direction === 'unknown')) {
    const bodyStart = i;
    const endIdx = findModuleEnd(content, bodyStart);
    const body = content.slice(bodyStart, endIdx);

    for (const port of ports) {
      // 在 body 裡找 input/output/inout + port name
      const dirRegex = new RegExp(`\\b(input|output|inout)\\b[^;]*\\b${port.name}\\b`);
      const dirMatch = body.match(dirRegex);
      if (dirMatch) {
        port.direction = dirMatch[1];
        port.width = extractWidth(dirMatch[0]);
        port.bus = port.width > 1 ? `[${port.width-1}:0]` : null;
      }
    }
  }

  return ports;
}

/**
 * 找到 module body 的結束位置
 */
function findModuleEnd(content, start) {
  let depth = 0;
  let inModule = false;
  for (let i = start; i < content.length; i++) {
    if (content.slice(i).match(/\bendmodule\b/)) return i;
  }
  return content.length;
}

/**
 * 從 module body 中提取 instantiation（regex fallback）
 */
function extractInstancesRegex(content, moduleName) {
  const instances = [];
  // 匹配 module_name  instance_name (
  const instRegex = /\b(\w+)\s+(\w+)\s*(#\s*\([^)]*\))?\s*\(/g;
  let match;

  // 排除 module/macromodule/if/else/always 等關鍵字
  const KEYWORDS = new Set(['module', 'macromodule', 'if', 'else', 'for', 'while', 'always', 'initial', 'assign', 'case', 'begin', 'end', 'function', 'task', 'generate', 'endgenerate', 'genvar', 'integer', 'real', 'time', 'wire', 'reg', 'logic', 'tri', 'supply', 'output', 'input', 'inout']);

  while ((match = instRegex.exec(content)) !== null) {
    const modName = match[1];
    const instName = match[2];
    if (KEYWORDS.has(modName)) continue;
    if (modName === moduleName) continue; // 不包含自身
    // 簡單過濾：instance name 不要是 keyword
    if (KEYWORDS.has(instName)) continue;

    const line = content.slice(0, match.index).split('\n').length;
    instances.push({ module: modName, name: instName, line });
  }
  return instances;
}

/**
 * 從 port 宣告字串中提取寬度
 */
function extractWidth(decl) {
  const m = decl.match(/\[(\d+)\s*:\s*(\d+)\]/);
  if (m) return parseInt(m[1]) - parseInt(m[2]) + 1;
  const m2 = decl.match(/\[(\d+)\]/);
  if (m2) return parseInt(m2[1]);
  return 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// 主要 API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 解析 RTL 專案
 * @param {string} root - RTL 專案根目錄
 * @param {object} opts - { filelist, forceParser }
 * @returns {{ ok, data, parser, warnings, fileCount }}
 */
export async function parseRTL(root, opts = {}) {
  const warnings = [];

  // 1. 檔案發現
  const files = discoverFiles(root, opts);
  if (files.length === 0) {
    return { ok: false, error: `在 ${root} 找不到 RTL 檔案（.v/.sv/.vhd）`, parser: null, warnings };
  }

  // 2. 選擇 parser
  const parsers = detectParsers();
  const slangInfo = parsers.find(p => p.name === 'slang' && p.available);

  let data;
  let parserName;

  const force = opts.forceParser;

  if (force === 'slang' || (!force && slangInfo)) {
    try {
      data = parseWithSlang(files, root, slangInfo?.path || 'slang');
      // 驗證 slang 結果是否有有效的 module 資料
      const hasValidData = data && (
        (data.definitions && data.definitions.length > 0) ||
        (data.modules && data.modules.length > 0) ||
        (Array.isArray(data) && data.length > 0)
      );
      if (hasValidData) {
        parserName = 'slang';
      } else {
        warnings.push('slang 回傳空結果，降級到 regex-fallback');
        data = parseWithRegex(files, root);
        parserName = 'regex-fallback';
      }
    } catch (err) {
      warnings.push(`slang 解析失敗，降級到 regex-fallback: ${err.message}`);
      data = parseWithRegex(files, root);
      parserName = 'regex-fallback';
    }
  } else {
    if (!slangInfo) {
      warnings.push('未找到 slang，使用 regex fallback（功能受限）');
      warnings.push('建議安裝 slang 以獲得完整 elaboration 功能');
    }
    data = parseWithRegex(files, root);
    parserName = 'regex-fallback';
  }

  return { ok: true, data, parser: parserName, warnings, fileCount: files.length };
}