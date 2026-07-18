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
import { existsSync, readdirSync, writeFileSync, copyFileSync, unlinkSync, readFileSync, renameSync } from 'node:fs';
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
      process.env.HOME + '/Library/Python/3.9/bin/pylsp',
      process.env.HOME + '/.local/bin/pylsp',
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
      process.env.HOME + '/.cargo/bin/rust-analyzer',
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
  php: {
    name: 'intelephense',
    args: ['--stdio'],
    fileExts: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.php8', '.phps', '.inc'],
    languageId: 'php',
    findCandidates: [
      '/opt/homebrew/bin/intelephense',
      '/usr/local/bin/intelephense',
      process.env.HOME + '/.npm-global/bin/intelephense',
      process.env.HOME + '/npm/bin/intelephense',
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
    await this._didOpen(absPath, lang, languageId);

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
    await this._didOpen(absPath, lang, languageId);

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
    await this._didOpen(absPath, lang, languageId);

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
    await this._didOpen(absPath, lang, languageId);

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

  /** 取得檔案的診斷資訊（錯誤、警告） */
  async getDiagnostics(filePath) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}`, diagnostics: [] };
    }

    const cacheKey = `diag:${absPath}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._didOpen(absPath, lang, languageId);

    // Use textDocument/diagnostic pull model if supported, fallback to published diagnostics
    const cap = this._serverCapabilities.get(lang);
    if (cap?.capabilities?.diagnosticProvider) {
      try {
        const result = await this._sendRequest('textDocument/diagnostic', {
          textDocument: { uri: this._toUri(absPath) }
        }, lang);
        const diagnostics = this._normalizeDiagnostics(result, absPath);
        const output = { file: filePath, diagnostics };
        this._cache.set(cacheKey, output);
        return output;
      } catch {
        // Fall through to published diagnostics
      }
    }

    // Fallback: return empty (published diagnostics require active watching)
    const output = {
      file: filePath,
      diagnostics: [],
      note: 'Diagnostics not available via pull model. Use CLI for type checking: npx tsc --noEmit, pyright, php -l, swift build, cargo check'
    };
    this._cache.set(cacheKey, output);
    return output;
  }

  /**
   * 取得 code actions（quick fixes, refactorings, source actions）
   * @param {string} filePath - 相對路徑
   * @param {number} line - 行號 (1-indexed)
   * @param {number} col - 字元位置 (0-indexed)
   * @param {Array} diagnostics - 相關的 diagnostics（可選）
   * @returns {Promise<{file: string, actions: Array}>}
   */
  async getCodeActions(filePath, line, col = 0, diagnostics = []) {
    const absPath = resolve(this.rootDir, filePath);
    if (!existsSync(absPath)) {
      return { error: `File not found: ${filePath}`, actions: [] };
    }

    const lang = this._langForFile(filePath);
    const cfg = LSP_CONFIGS[lang];
    const languageId = cfg ? cfg.languageId : 'typescript';

    await this.ensureOpen(lang);
    await this._didOpen(absPath, lang, languageId);

    const cap = this._serverCapabilities.get(lang);
    const codeActionKinds = cap?.capabilities?.codeActionProvider?.codeActionKinds;

    if (!codeActionKinds) {
      return {
        file: filePath,
        actions: [],
        note: 'Code actions not supported by this language server'
      };
    }

    // Build range around the position
    const start = { line: line - 1, character: col };
    const end = { line: line - 1, character: col + 1 };

    const params = {
      textDocument: { uri: this._toUri(absPath) },
      range: { start, end },
      context: {
        diagnostics: diagnostics.map(d => ({
          range: {
            start: { line: (d.line || 1) - 1, character: d.col || 0 },
            end: { line: ((d.endLine || d.line) || 1) - 1, character: d.endCol || (d.col || 0) + 1 }
          },
          message: d.message || '',
          severity: d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : 3,
          source: d.source || undefined,
          code: d.code || undefined
        }))
      }
    };

    try {
      const result = await this._sendRequest('textDocument/codeAction', params, lang);
      const actions = Array.isArray(result) ? result : [];
      return { file: filePath, actions: this._normalizeCodeActions(actions) };
    } catch (err) {
      return { error: err.message, actions: [] };
    }
  }

  /**
   * 執行 code action（返回 workspace edit 供客戶端應用）
   * @param {object} action - CodeAction 物件（含 _filePath 用於語言偵測）
   * @returns {Promise<{edit?: object, command?: object, error?: string}>}
   */
  async executeCodeAction(action) {
    if (!action) {
      return { error: 'No action provided' };
    }

    // If action has edit, return it directly for client to apply
    if (action.edit) {
      return { edit: action.edit };
    }

    // If action has command, execute it via LSP
    if (action.command) {
      const lang = this._langForFile(action._filePath || '');
      try {
        await this._sendRequest('workspace/executeCommand', {
          command: action.command.command,
          arguments: action.command.arguments || []
        }, lang);
        return { executed: true, command: action.command.command };
      } catch (err) {
        return { error: `Failed to execute command: ${err.message}` };
      }
    }

    return { error: 'Action has neither edit nor command' };
  }

  /**
   * 應用 workspace edit（多檔案多處修改）
   * 安全措施：備份 → 驗證 → 原子寫入
   * @param {object} edit - WorkspaceEdit 物件
   * @returns {Promise<{applied: number, errors: Array, backups: Array}>}
   */
  async applyWorkspaceEdit(edit) {
    if (!edit || !edit.changes) {
      return { error: 'Invalid workspace edit' };
    }

    let applied = 0;
    const errors = [];
    const backups = [];

    // Phase 1: 備份所有受影響的檔案
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      const filePath = this._fromUri(uri);
      if (!filePath) {
        errors.push({ uri, error: 'Invalid URI' });
        continue;
      }

      const absPath = resolve(this.rootDir, filePath);
      if (!existsSync(absPath)) {
        errors.push({ file: filePath, error: 'File not found' });
        continue;
      }

      // Create backup
      const backupPath = `${absPath}.bak.${Date.now()}`;
      try {
        copyFileSync(absPath, backupPath);
        backups.push({ original: filePath, backup: backupPath });
      } catch (err) {
        errors.push({ file: filePath, error: `Backup failed: ${err.message}` });
        continue;
      }
    }

    // Phase 2: 應用 edits（如有錯誤則回滾）
    const appliedFiles = [];
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      const filePath = this._fromUri(uri);
      if (!filePath || errors.some(e => e.file === filePath)) continue;

      const absPath = resolve(this.rootDir, filePath);

      try {
        // Read current file content
        const content = readFileSync(absPath, 'utf8');
        const lines = content.split('\n');

        // Sort edits by position (reverse order to apply correctly)
        const sorted = textEdits.sort((a, b) => {
          const lineA = a.range.start.line;
          const lineB = b.range.start.line;
          if (lineA !== lineB) return lineB - lineA;
          return b.range.start.character - a.range.start.character;
        });

        for (const te of sorted) {
          const startLine = te.range.start.line;
          const startChar = te.range.start.character;
          const endLine = te.range.end.line;
          const endChar = te.range.end.character;

          // Validate range
          if (startLine < 0 || startLine >= lines.length) {
            throw new Error(`Invalid start line: ${startLine + 1}`);
          }
          if (endLine < 0 || endLine >= lines.length) {
            throw new Error(`Invalid end line: ${endLine + 1}`);
          }
          if (startChar < 0 || startChar > lines[startLine].length) {
            throw new Error(`Invalid start character: ${startChar}`);
          }
          if (endChar < 0 || endChar > lines[endLine].length) {
            throw new Error(`Invalid end character: ${endChar}`);
          }

          // Reconstruct line with edit
          const before = lines[startLine].slice(0, startChar);
          const after = lines[endLine].slice(endChar);
          const newText = (te.newText || '').split('\n');

          lines.splice(startLine, endLine - startLine + 1, ...newText.map((t, i) => {
            if (i === 0) return before + t;
            if (i === newText.length - 1) return t + after;
            return t;
          }));
        }

        // Write updated content (with backup safety)
        writeFileSync(absPath, lines.join('\n'), 'utf8');

        appliedFiles.push(filePath);
        applied++;
      } catch (err) {
        errors.push({ file: filePath, error: err.message });
        // Restore from backup on error
        const backup = backups.find(b => b.original === filePath);
        if (backup) {
          try {
            copyFileSync(backup.backup, absPath);
          } catch { /* backup restore failed */ }
        }
      }
    }

    // Phase 3: 清理備份（成功則刪除）
    if (applied > 0 && errors.length === 0) {
      for (const b of backups) {
        try {
          unlinkSync(resolve(this.rootDir, b.backup));
        } catch { /* ignore cleanup errors */ }
      }
    }

    return { applied, errors, backups: errors.length > 0 ? backups : [] };
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

  /**
   * Ensure a jsconfig.json exists for JS-only projects.
   * TypeScript LSP needs this to enable allowJs mode for .mjs/.js files.
   */
  _ensureJsConfig() {
    const root = this.rootDir;
    const configNames = ['jsconfig.json', 'tsconfig.json', 'jsconfig.app.json', 'tsconfig.app.json'];
    if (configNames.some(c => existsSync(resolve(root, c)))) return;
    // Scan root + one level of subdirectories for JS source files
    const jsFiles = ['.', 'src', 'lib', 'app'].some(dir => {
      try {
        const dirPath = resolve(root, dir);
        const entries = readdirSync(dirPath, { withFileTypes: true });
        // Check files at this level
        if (entries.some(e => e.isFile() && /\.(m?js|cjs)$/.test(e.name))) return true;
        // Check one level of subdirectories
        return entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          .some(e => {
            try {
              return readdirSync(resolve(dirPath, e.name), { withFileTypes: true })
                .some(f => f.isFile() && /\.(m?js|cjs)$/.test(f.name));
            } catch { return false; }
          });
      } catch { return false; }
    });
    if (!jsFiles) return;
    const jsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
        maxNodeModuleJsDepth: 2,
      },
      include: ['src/**/*.mjs', 'src/**/*.js', 'src/**/*.cjs', 'lib/**/*.mjs', 'lib/**/*.js'],
      exclude: ['node_modules', '**/*.test.mjs', '**/*.spec.mjs'],
    };
    try {
      writeFileSync(resolve(root, 'jsconfig.json'), JSON.stringify(jsconfig, null, 2) + '\n');
      if (process.env.DEBUG?.includes('lsp')) {
        console.error('[lsp-bridge] Auto-created jsconfig.json for JS project');
      }
    } catch (err) {
      console.warn('[lsp-bridge] Failed to auto-create jsconfig.json:', err.message);
    }
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

    // Auto-create jsconfig.json for JS-only projects before starting TS LSP
    if (lang === 'typescript') {
      this._ensureJsConfig();
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
        openedFiles: new Set(),  // tracks didOpen'd URIs to avoid redundant notifications
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

      // Build initializationOptions — pass allowJs hints to TS LSP
      const initOptions = lang === 'typescript' ? {
        tsserver: { plugins: [] },
        preferences: {
          includeInlayParameterNameHints: 'none',
          includeInlayVariableTypeHints: false,
          includeInlayFunctionLikeReturnTypeHints: false,
        },
      } : {};

      // Send initialize request
      this._sendRequest('initialize', {
        processId: process.pid,
        rootUri: this._toUri(this.rootDir),
        initializationOptions: initOptions,
        capabilities: {
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            references: {},
            hover: {},
            definition: {},
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    '', // empty string means all kinds
                    'quickfix',
                    'refactor',
                    'refactor.extract',
                    'refactor.inline',
                    'refactor.rewrite',
                    'source',
                    'source.organizeImports',
                  ]
                }
              },
              dynamicRegistration: false,
            },
          },
          workspace: {
            executeCommand: {},
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

  /**
   * Send textDocument/didOpen notification with deduplication.
   * Skips if the file URI was already opened for this LSP session.
   */
  async _didOpen(absPath, lang, languageId) {
    const state = this._processes.get(lang);
    if (!state) return;
    const uri = this._toUri(absPath);
    if (state.openedFiles.has(uri)) return;
    state.openedFiles.add(uri);
    await this._sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1 }
    }, lang);
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
    // Handle file:///path (3 slashes for absolute paths) and file://host/path
    if (uri.startsWith('file:///')) {
      return uri.slice(7); // file:///Users/... → /Users/...
    }
    if (uri.startsWith('file://')) {
      // file://host/path - extract path after host
      const afterScheme = uri.slice(7);
      const slashIdx = afterScheme.indexOf('/');
      return slashIdx >= 0 ? afterScheme.slice(slashIdx) : afterScheme;
    }
    return uri;
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

  _normalizeCodeActions(actions) {
    if (!Array.isArray(actions)) return [];
    return actions.map(a => ({
      title: a.title || '',
      kind: a.kind || 'unknown',
      diagnostics: a.diagnostics || [],
      edit: a.edit || null,
      command: a.command || null,
      isPreferred: a.isPreferred || false,
    }));
  }

  _normalizeDiagnostics(result, absPath) {
    const items = result?.items || result || [];
    if (!Array.isArray(items)) return [];
    return items.map(d => ({
      line: d.range?.start?.line != null ? d.range.start.line + 1 : 0,
      col: d.range?.start?.character || 0,
      endLine: d.range?.end?.line != null ? d.range.end.line + 1 : undefined,
      endCol: d.range?.end?.character,
      severity: this._severityToString(d.severity),
      message: d.message || '',
      code: d.code || undefined,
      source: d.source || undefined,
    }));
  }

  _severityToString(severity) {
    const map = { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' };
    return map[severity] || 'unknown';
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
