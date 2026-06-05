// lsp-bridge.mjs — LSP 統一接入層 (v2, 多語言)
//
// 封裝 typescript-language-server / rust-analyzer / sourcekit-lsp 等 LSP 的 JSON-RPC 2.0 over stdio 通訊。
// 提供統一的 symbol / references / hover / definition 介面。
// 支援多語言：TypeScript、Rust、Python、Swift。
//
// 設計原則：
// - lazy-init：首次工具呼叫才啟動 LSP process，不佔用開機資源
// - auto-reconnect：LSP process crash 時自動重啟
// - cache：使用 LRU 快取避免重複 query
// - 多語言支援：依檔案副檔名自動選擇對應 LSP server

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------
class LRUCache {
  constructor(maxSize = 100, ttlMs = 60_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this._map = new Map();
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    // LRU: move to end
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this._map.size >= this.maxSize) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, { value, ts: Date.now() });
  }

  invalidate(key) { this._map.delete(key); }
  clear() { this._map.clear(); }
}

// ---------------------------------------------------------------------------
// LSP 語言設定
// ---------------------------------------------------------------------------

const LSP_CONFIGS = {
  typescript: {
    name: 'typescript-language-server',
    args: ['--stdio'],
    fileExts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    languageId: 'typescript',
    findCandidates: [
      '/opt/homebrew/bin/typescript-language-server',
      '/usr/local/bin/typescript-language-server',
    ],
    env: {},
  },
  python: {
    name: 'pylsp',
    args: [],
    fileExts: ['.py', '.pyw'],
    languageId: 'python',
    findCandidates: [
      '/Users/wclin/Library/Python/3.9/bin/pylsp',
      '/usr/local/bin/pylsp',
      '/opt/homebrew/bin/pylsp',
    ],
    env: {},
  },
  rust: {
    name: 'rust-analyzer',
    args: [],
    fileExts: ['.rs'],
    languageId: 'rust',
    findCandidates: [
      '/Users/wclin/.cargo/bin/rust-analyzer',
      '/usr/local/bin/rust-analyzer',
      '/opt/homebrew/bin/rust-analyzer',
    ],
    env: {},
  },
  swift: {
    name: 'sourcekit-lsp',
    args: [],
    fileExts: ['.swift'],
    languageId: 'swift',
    findCandidates: [
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp',
      '/usr/bin/sourcekit-lsp',
      '/usr/local/bin/sourcekit-lsp',
    ],
    env: {},
  },
};

/**
 * Get LSP config for a file extension.
 * @param {string} ext - File extension (e.g. '.ts', '.rs')
 * @returns {object|null} LSP config or null if unsupported
 */
function getLspConfigForFile(ext) {
  for (const [lang, cfg] of Object.entries(LSP_CONFIGS)) {
    if (cfg.fileExts.includes(ext)) return { lang, ...cfg };
  }
  return null;
}

// ---------------------------------------------------------------------------
// LSP Bridge class (v2 - 多語言支援)
// ---------------------------------------------------------------------------
export class LspBridge {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir || '.');
    this._processes = new Map();   // lang -> { process, requestId, pending, buffer, ready }
    this._closing = false;
    this._cache = new LRUCache(200, 30_000);
    this._serverCapabilities = new Map();
    this._restartCounts = new Map();
    this._startErrors = new Map();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  get isReady() { return this._processes.size > 0; }

  /**
   * Detect language for a given file path.
   * @param {string} filePath
   * @returns {string} Language name
   */
  _langForFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    for (const [lang, cfg] of Object.entries(LSP_CONFIGS)) {
      if (cfg.fileExts.includes(ext)) return lang;
    }
    return 'typescript'; // default
  }

  /**
   * Get or lazily initialize LSP process for a given language.
   * @param {string} lang - Language name (typescript, rust)
   */
  async ensureOpen(lang) {
    if (!lang) lang = 'typescript';
    const existing = this._processes.get(lang);
    if (existing && existing.ready) return;

    const errState = this._startErrors.get(lang);
    if (errState) throw errState;

    try {
      await this._start(lang);
    } catch (err) {
      this._startErrors.set(lang, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /** 取得檔案中的符號列表 */
  async getSymbols(filePath) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}`, symbols: [] };
    }

    const cacheKey = `symbols:${absPath}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId, version: 1 }
    }, lang);

    const result = await this._sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: this._toUri(absPath) }
    }, lang);

    const symbols = this._normalizeSymbols(result);
    const output = { file: filePath, symbols };
    this._cache.set(cacheKey, output);
    return output;
  }

  /** 取得符號的 reference 列表（誰引用了它） */
  async getReferences(filePath, line, col) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}`, references: [] };
    }

    const cacheKey = `refs:${absPath}:${line}:${col}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId, version: 1 }
    }, lang);

    const result = await this._sendRequest('textDocument/references', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 },
      context: { includeDeclaration: true }
    }, lang);

    const refs = (result || []).map(r => ({
      file: this._fromUri(r.uri),
      line: r.range.start.line + 1,
      col: r.range.start.character
    }));
    const output = { file: filePath, references: refs };
    this._cache.set(cacheKey, output);
    return output;
  }

  /** 取得符號的 hover 資訊（型別 + 文件） */
  async getHover(filePath, line, col) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}` };
    }

    const cacheKey = `hover:${absPath}:${line}:${col}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId, version: 1 }
    }, lang);

    const result = await this._sendRequest('textDocument/hover', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 }
    }, lang);

    const output = {
      file: filePath,
      type: result?.contents?.value || '',
      range: result?.range ? {
        start: { line: result.range.start.line + 1, col: result.range.start.character },
        end: { line: result.range.end.line + 1, col: result.range.end.character }
      } : undefined
    };
    this._cache.set(cacheKey, output);
    return output;
  }

  /** 取得符號的定義位置 */
  async getDefinition(filePath, line, col) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}` };
    }

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId, version: 1 }
    }, lang);

    const result = await this._sendRequest('textDocument/definition', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 }
    }, lang);

    if (!result || result.length === 0) {
      return { file: filePath, definition: null };
    }
    const def = result[0];
    return {
      file: this._fromUri(def.uri),
      line: def.range.start.line + 1,
      col: def.range.start.character
    };
  }

  /** 優雅關閉所有 LSP process */
  async close() {
    this._closing = true;
    for (const [lang, state] of this._processes) {
      try {
        await this._sendRequest('shutdown', {}, lang);
        await this._sendNotification('exit', {}, lang);
      } catch { /* ignore */ }
      try {
        state.process.kill();
        // On Windows, force-kill the process tree to clean up cmd.exe wrappers
        if (process.platform === 'win32' && state.process.pid) {
          try {
            execFileSync('taskkill', ['/T', '/F', '/PID', String(state.process.pid)],
              { stdio: 'ignore' });
          } catch { /* process already dead */ }
        }
      } catch { /* ignore */ }
    }
    this._processes.clear();
    this._cache.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _findLspServer(lang) {
    const cfg = LSP_CONFIGS[lang];
    if (!cfg) return null;

    // Try candidates from config first
    for (const c of cfg.findCandidates) {
      if (existsSync(c)) return c;
    }

    // Try local node_modules
    const local = resolve(__dirname, '../../node_modules/.bin', cfg.name);
    if (existsSync(local)) {
      // On Windows, skip Unix shell scripts (no .cmd/.exe extension) — cannot spawn
      if (process.platform !== 'win32' || local.endsWith('.cmd') || local.endsWith('.exe')) {
        return local;
      }
      // Try .cmd wrapper (npm creates these on Windows)
      const localCmd = local + '.cmd';
      if (existsSync(localCmd)) return localCmd;
    }

    // Try user's npm global
    if (process.env.HOME) {
      const homeDir = resolve(process.env.HOME, 'npm/bin', cfg.name);
      if (existsSync(homeDir)) return homeDir;
    }

    // Fallback: resolve via PATH (cross-platform: which on Unix, where on Windows)
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const pathResult = execFileSync(whichCmd, [cfg.name], { shell: false, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pathResult) {
        // where.exe may return multiple matches; take the first line
        const firstMatch = pathResult.split('\n')[0].trim();
        if (firstMatch) return firstMatch;
      }
    } catch { /* not in PATH */ }

    return null;
  }

  async _start(lang) {
    const cfg = LSP_CONFIGS[lang];
    if (!cfg) {
      throw new Error(`Unsupported language: ${lang}`);
    }

    const prevCount = this._restartCounts.get(lang) || 0;
    if (prevCount > 3) {
      throw new Error(`${cfg.name} unavailable after ${prevCount - 1} restart attempts`);
    }

    let serverPath = this._findLspServer(lang);
    if (!serverPath) {
      throw new Error(`${cfg.name} not found. Install with your package manager.`);
    }

    // On Windows, npm .bin scripts are .cmd files; spawn needs explicit extension
    if (process.platform === 'win32') {
      const ext = '.cmd';
      if (!serverPath.endsWith(ext) && !serverPath.endsWith('.exe') && existsSync(serverPath + ext)) {
        serverPath += ext;
      }
    }

    return new Promise((resolve, reject) => {
      // On Windows, .cmd wrappers from npm require shell intervention
      const isWinCmd = process.platform === 'win32' && serverPath.endsWith('.cmd');
      const child = isWinCmd
        ? spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `"${serverPath}"`, ...cfg.args], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...cfg.env },
          })
        : spawn(serverPath, cfg.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...cfg.env },
          });

      const state = {
        process: child,
        requestId: 0,
        pending: new Map(),
        buffer: '',
        ready: false,
      };
      this._processes.set(lang, state);

      child.stdout.on('data', (data) => {
        state.buffer += data.toString();
        this._processBuffer(lang);
      });

      child.stderr.on('data', (data) => {
        if (process.env.DEBUG?.includes('lsp')) {
          console.error(`[lsp-bridge:${lang}:stderr]`, data.toString().trim());
        }
      });

      child.on('error', (err) => {
        console.error(`[lsp-bridge:${lang}] Process error:`, err.message);
        state.ready = false;
        this._processes.delete(lang);
        reject(err);
      });

      child.on('exit', (code) => {
        if (this._closing) return;
        const count = (this._restartCounts.get(lang) || 0) + 1;
        this._restartCounts.set(lang, count);
        if (count > 3) {
          console.warn(`[lsp-bridge:${lang}] Exited with code ${code}, giving up after 3 retries`);
          this._processes.delete(lang);
          return;
        }
        console.warn(`[lsp-bridge:${lang}] Exited with code ${code}, restarting (${count}/3)...`);
        this._processes.delete(lang);
        setTimeout(() => {
          if (!this._closing) this._start(lang).catch(() => {});
        }, 1000);
      });

      // Send initialize request
      this._sendRequest('initialize', {
        processId: process.pid,
        rootUri: this._toUri(this.rootDir),
        capabilities: {
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            references: {},
            hover: {},
            definition: {},
          }
        }
      }, lang).then((cap) => {
        this._serverCapabilities.set(lang, cap);
        state.ready = true;
        this._restartCounts.delete(lang);
        this._startErrors.delete(lang);
        this._sendNotification('initialized', {}, lang);
        resolve();
      }).catch((err) => {
        reject(err);
      });
    });
  }

  _sendRequest(method, params = {}, lang = 'typescript') {
    const state = this._processes.get(lang);
    if (!state) {
      return Promise.reject(new Error(`LSP not started for language: ${lang}`));
    }

    const id = ++state.requestId;
    return new Promise((resolve, reject) => {
      const msg = JSON.stringify({
        jsonrpc: '2.0', id, method,
        params: Object.keys(params).length ? params : undefined
      });

      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out after 30s (${lang})`));
      }, 30_000);

      state.pending.set(id, { resolve, reject, timer });

      const header = `Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n`;
      state.process.stdin.write(header + msg);
    });
  }

  _sendNotification(method, params = {}, lang = 'typescript') {
    const state = this._processes.get(lang);
    if (!state) return;

    const msg = JSON.stringify({
      jsonrpc: '2.0', method,
      params: Object.keys(params).length ? params : undefined
    });
    const header = `Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n`;
    if (state.process.stdin.writable) {
      state.process.stdin.write(header + msg);
    }
  }

  _processBuffer(lang) {
    const state = this._processes.get(lang);
    if (!state) return;

    while (true) {
      const headerMatch = state.buffer.match(/^Content-Length: (\d+)\r\n/m);
      if (!headerMatch) break;

      const contentLen = parseInt(headerMatch[1], 10);
      const headerEnd = state.buffer.indexOf('\r\n\r\n') + 4;
      if (headerEnd < 4) break;

      const bodyStart = headerEnd;
      const bodyEnd = bodyStart + contentLen;
      if (state.buffer.length < bodyEnd) break;

      const body = state.buffer.slice(bodyStart, bodyEnd);
      state.buffer = state.buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(body);
        this._handleMessage(msg, lang);
      } catch (err) {
        if (process.env.DEBUG?.includes('lsp')) {
          console.error(`[lsp-bridge:${lang}] Parse error:`, err.message, body.slice(0, 200));
        }
      }
    }
  }

  _handleMessage(msg, lang) {
    const state = this._processes.get(lang);
    if (!state) return;

    if (msg.id != null && state.pending.has(msg.id)) {
      const { resolve, reject, timer } = state.pending.get(msg.id);
      clearTimeout(timer);
      state.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || 'LSP error'));
      } else {
        resolve(msg.result);
      }
    }
  }

  _toUri(absPath) {
    return `file://${absPath}`;
  }

  _fromUri(uri) {
    if (!uri) return '';
    return uri.startsWith('file://') ? uri.slice(7) : uri;
  }

  _normalizeSymbols(result) {
    if (!result) return [];
    const symbols = [];
    const walk = (items, depth = 0) => {
      if (!items) return;
      for (const item of items) {
        if (typeof item !== 'object') continue;
        const name = item.name || '';
        const kind = this._symbolKindToString(item.kind);
        const selRange = item.selectionRange || item.range || {};
        const fullRange = item.range || {};
        const symbol = {
          name,
          kind,
          line: selRange.start?.line != null ? selRange.start.line + 1 : 0,
          col: selRange.start?.character || 0,
          end_line: fullRange.end?.line != null ? fullRange.end.line + 1 : undefined,
          end_col: fullRange.end?.character,
          signature: name,
        };
        if (item.children && depth < 5) {
          symbol.children = [];
          walk(item.children, depth + 1);
        }
        symbols.push(symbol);
      }
    };
    walk(result);
    return symbols;
  }

  _symbolKindToString(kind) {
    const map = {
      1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class',
      6: 'method', 7: 'property', 8: 'field', 9: 'constructor',
      10: 'enum', 11: 'interface', 12: 'function', 13: 'variable',
      14: 'constant', 15: 'string', 16: 'number', 17: 'boolean',
      18: 'array', 19: 'object', 20: 'key', 21: 'null',
      22: 'enum-member', 23: 'struct', 24: 'event', 25: 'operator',
      26: 'type-parameter',
    };
    return map[kind] || 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------
const _instances = new Map();

/**
 * Get or create an LspBridge instance for the given root directory.
 * This ensures all code tools share the same LSP process.
 */
export function getLspBridge(rootDir) {
  const key = rootDir || process.cwd();
  if (!_instances.has(key)) {
    _instances.set(key, new LspBridge(key));
  }
  return _instances.get(key);
}

/**
 * Close all LSP bridge instances (call on shutdown).
 */
export async function closeAllLspBridges() {
  for (const [key, bridge] of _instances) {
    try { await bridge.close(); } catch { /* ignore */ }
    _instances.delete(key);
  }
}
