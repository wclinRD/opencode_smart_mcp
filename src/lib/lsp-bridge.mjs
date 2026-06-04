// lsp-bridge.mjs — LSP 統一接入層
//
// 封裝 typescript-language-server / pylsp 等 LSP 的 JSON-RPC 2.0 over stdio 通訊。
// 提供統一的 symbol / references / hover / definition 介面。
//
// 設計原則：
// - lazy-init：首次工具呼叫才啟動 LSP process，不佔用開機資源
// - auto-reconnect：LSP process crash 時自動重啟
// - cache：使用 LRU 快取避免重複 query
// - 先支援 TypeScript，後續擴展 Python/Rust

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
// LSP Bridge class
// ---------------------------------------------------------------------------
export class LspBridge {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir || '.');
    this._process = null;
    this._requestId = 0;
    this._pending = new Map();    // id -> { resolve, reject, timer }
    this._ready = false;
    this._closing = false;
    this._buffer = '';            // accumulated stdout data
    this._cache = new LRUCache(200, 30_000);
    this._serverCapabilities = null;

    // Determine which LSP server to use based on project files
    this._lspCommand = this._detectLanguage();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  get isReady() { return this._ready; }

  /** Ensure LSP process is running (lazy-init) */
  async ensureOpen() {
    if (this._ready && this._process) return;
    if (this._process) {
      try { this._process.kill(); } catch { /* ignore */ }
    }
    await this._start();
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

    await this.ensureOpen();
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId: 'typescript', version: 1 }
    });

    const result = await this._sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: this._toUri(absPath) }
    });

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

    await this.ensureOpen();
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId: 'typescript', version: 1 }
    });

    const result = await this._sendRequest('textDocument/references', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 },
      context: { includeDeclaration: true }
    });

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

    await this.ensureOpen();
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId: 'typescript', version: 1 }
    });

    const result = await this._sendRequest('textDocument/hover', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 }
    });

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

    await this.ensureOpen();
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri: this._toUri(absPath), languageId: 'typescript', version: 1 }
    });

    const result = await this._sendRequest('textDocument/definition', {
      textDocument: { uri: this._toUri(absPath) },
      position: { line: line - 1, character: col || 0 }
    });

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

  /** 優雅關閉 LSP */
  async close() {
    this._closing = true;
    if (this._process) {
      try {
        await this._sendRequest('shutdown');
        await this._sendNotification('exit');
      } catch { /* ignore */ }
      try { this._process.kill(); } catch { /* ignore */ }
      this._process = null;
    }
    this._ready = false;
    this._cache.clear();
    // Reject pending requests
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error('LSP bridge closed'));
      this._pending.delete(id);
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _detectLanguage() {
    // For now, always use TypeScript. Later detect based on files in rootDir.
    const tsServer = this._findTsserver();
    if (!tsServer) {
      console.warn('[lsp-bridge] typescript-language-server not found. Install with: npm i -g typescript-language-server');
      return null;
    }
    return { cmd: tsServer, args: ['--stdio'] };
  }

  _findTsserver() {
    // Try common locations first (fast path, no spawn)
    const candidates = [
      // Global npm (Homebrew)
      '/opt/homebrew/bin/typescript-language-server',
      '/usr/local/bin/typescript-language-server',
      // Local node_modules
      resolve(__dirname, '../../node_modules/.bin/typescript-language-server'),
      // User's global npm
      ...(process.env.HOME ? [
        resolve(process.env.HOME, '.npm-global/bin/typescript-language-server'),
        resolve(process.env.HOME, 'npm/bin/typescript-language-server'),
      ] : []),
    ];

    for (const c of candidates) {
      if (existsSync(c)) return c;
    }

    // Fallback: try resolving via PATH using which (sync)
    try {
      const which = execSync('which typescript-language-server', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (which) return which;
    } catch { /* not in PATH */ }

    return null;
  }

  async _start() {
    if (!this._lspCommand) {
      throw new Error('No LSP server found. Install typescript-language-server: npm i -g typescript-language-server');
    }

    return new Promise((resolve, reject) => {
      const { cmd, args } = this._lspCommand;
      const child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this._process = child;
      this._buffer = '';
      this._requestId = 0;

      child.stdout.on('data', (data) => {
        this._buffer += data.toString();
        this._processBuffer();
      });

      child.stderr.on('data', (data) => {
        // LSP servers often log diagnostics to stderr - suppress in production
        if (process.env.DEBUG?.includes('lsp')) {
          console.error('[lsp-bridge:stderr]', data.toString().trim());
        }
      });

      child.on('error', (err) => {
        console.error('[lsp-bridge] Process error:', err.message);
        this._ready = false;
        reject(err);
      });

      child.on('exit', (code) => {
        if (this._closing) return;
        console.warn(`[lsp-bridge] Process exited with code ${code}, restarting...`);
        this._ready = false;
        this._process = null;
        // Auto-reconnect after 1s
        setTimeout(() => {
          if (!this._closing) this._start().catch(() => {});
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
      }).then((cap) => {
        this._serverCapabilities = cap;
        this._ready = true;
        // Send initialized notification
        this._sendNotification('initialized', {});
        resolve();
      }).catch(reject);
    });
  }

  _sendRequest(method, params = {}) {
    const id = ++this._requestId;
    return new Promise((resolve, reject) => {
      const msg = JSON.stringify({
        jsonrpc: '2.0', id, method,
        params: Object.keys(params).length ? params : undefined
      });

      // Timeout: 30s for LSP operations
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`LSP request ${method} timed out after 30s`));
      }, 30_000);

      this._pending.set(id, { resolve, reject, timer });

      // Content-Length header + message
      const header = `Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n`;
      this._process?.stdin?.write(header + msg);
    });
  }

  _sendNotification(method, params = {}) {
    const msg = JSON.stringify({
      jsonrpc: '2.0', method,
      params: Object.keys(params).length ? params : undefined
    });
    const header = `Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n`;
    if (this._process?.stdin?.writable) {
      this._process.stdin.write(header + msg);
    }
  }

  _processBuffer() {
    // Parse Content-Length headers and JSON-RPC messages
    while (true) {
      const headerMatch = this._buffer.match(/^Content-Length: (\d+)\r\n/m);
      if (!headerMatch) break;

      const contentLen = parseInt(headerMatch[1], 10);
      const headerEnd = this._buffer.indexOf('\r\n\r\n') + 4;
      if (headerEnd < 4) break;

      const bodyStart = headerEnd;
      const bodyEnd = bodyStart + contentLen;
      if (this._buffer.length < bodyEnd) break;

      const body = this._buffer.slice(bodyStart, bodyEnd);
      this._buffer = this._buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(body);
        this._handleMessage(msg);
      } catch (err) {
        if (process.env.DEBUG?.includes('lsp')) {
          console.error('[lsp-bridge] Parse error:', err.message, body.slice(0, 200));
        }
      }
    }
  }

  _handleMessage(msg) {
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      clearTimeout(timer);
      this._pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || 'LSP error'));
      } else {
        resolve(msg.result);
      }
    }
    // Ignore notifications (method field present, no id)
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
    // LSP documentSymbol returns array of SymbolInformation or DocumentSymbol
    const symbols = [];
    const walk = (items, depth = 0) => {
      if (!items) return;
      for (const item of items) {
        if (typeof item !== 'object') continue;
        const name = item.name || '';
        const kind = this._symbolKindToString(item.kind);
        const range = item.selectionRange || item.range || {};
        const symbol = {
          name,
          kind,
          line: range.start?.line != null ? range.start.line + 1 : 0,
          col: range.start?.character || 0,
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
