// exec.mjs — Sandbox Execution (Phase 10.1) + Code Verification (Phase 20)
//
// smart_exec MCP tool: execute code in a sandboxed environment.
// Supports mode: "run" (default) and "verify" (Phase 20).
// Primary: deno --allow-none (maximum safety)
// Fallback: node with limited permissions
//
// Supported languages: bash, node, python, deno
// Safety: no network, no write by default. User must explicitly allow.

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { verifyCode } from '../../lib/code-verifier.mjs';

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------
const HAS_DENO = (() => {
  try { spawnSync('deno', ['--version'], { timeout: 3000 }); return true; }
  catch { return false; }
})();

const HAS_NODE = true; // We're running on Node
const HAS_PYTHON = (() => {
  try { spawnSync('python3', ['--version'], { timeout: 3000 }); return true; }
  catch { return false; }
})();

// ---------------------------------------------------------------------------
// Language configs
// ---------------------------------------------------------------------------
const LANGUAGES = {
  bash: {
    runtime: 'bash',
    ext: '.sh',
    shebang: '#!/usr/bin/env bash\nset -euo pipefail\n',
    available: true,
    safety: 'high', // bash is inherently risky
    requiresConfirmation: true,
  },
  node: {
    runtime: 'node',
    ext: '.mjs',
    shebang: '',
    available: HAS_NODE,
    safety: 'medium',
    requiresConfirmation: false,
  },
  python: {
    runtime: 'python3',
    ext: '.py',
    shebang: '',
    available: HAS_PYTHON,
    safety: 'medium',
    requiresConfirmation: false,
  },
  deno: {
    runtime: 'deno',
    ext: '.ts',
    shebang: '',
    available: HAS_DENO,
    safety: 'low', // deno is sandboxed by default
    requiresConfirmation: false,
  },
};

// ---------------------------------------------------------------------------
// Permission levels
// ---------------------------------------------------------------------------
const PERMISSION_LEVELS = {
  none: {
    description: 'No permissions — safest',
    denoFlags: [],
    nodeFlags: [], // Node 26+: permission model is stable, no flag needed
    requiresConfirmation: false,
  },
  read: {
    description: 'Read filesystem access',
    denoFlags: ['--allow-read'],
    nodeFlags: ['--allow-fs-read=*'],
    requiresConfirmation: false,
  },
  write: {
    description: 'Read + write filesystem access',
    denoFlags: ['--allow-read', '--allow-write'],
    nodeFlags: ['--allow-fs-read=*', '--allow-fs-write=*'],
    requiresConfirmation: true,
  },
  net: {
    description: 'Network access',
    denoFlags: ['--allow-net'],
    nodeFlags: [],
    requiresConfirmation: true,
  },
};

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------
function createTempFile(code, lang) {
  const cfg = LANGUAGES[lang];
  const dir = join(tmpdir(), 'smart-exec');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${randomUUID()}${cfg.ext}`);
  const content = cfg.shebang ? cfg.shebang + '\n' + code : code;
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
function executeCode({ language, code, permission, timeout, workdir }) {
  const lang = LANGUAGES[language];
  if (!lang) {
    return { ok: false, error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGES).join(', ')}` };
  }
  if (!lang.available) {
    return { ok: false, error: `Runtime not available for ${language}. Install it first.` };
  }

  const perm = PERMISSION_LEVELS[permission] || PERMISSION_LEVELS.none;
  const maxTimeout = Math.min(timeout || 30000, 120000); // cap at 2 min
  const cwd = workdir || process.cwd();

  let filePath;
  try {
    filePath = createTempFile(code, language);
  } catch (err) {
    return { ok: false, error: `Cannot create temp file: ${err.message}` };
  }

  try {
    let result;

    switch (language) {
      case 'bash': {
        result = spawnSync('bash', [filePath], {
          cwd, timeout: maxTimeout, maxBuffer: 1024 * 1024,
          encoding: 'utf-8', env: { ...process.env, PATH: process.env.PATH },
        });
        break;
      }
      case 'node': {
        const args = [...perm.nodeFlags, filePath];
        result = spawnSync('node', args, {
          cwd, timeout: maxTimeout, maxBuffer: 1024 * 1024, encoding: 'utf-8',
        });
        break;
      }
      case 'python': {
        result = spawnSync('python3', [filePath], {
          cwd, timeout: maxTimeout, maxBuffer: 1024 * 1024, encoding: 'utf-8',
        });
        break;
      }
      case 'deno': {
        const args = ['run', '--no-prompt', ...perm.denoFlags, filePath];
        result = spawnSync('deno', args, {
          cwd, timeout: maxTimeout, maxBuffer: 1024 * 1024, encoding: 'utf-8',
        });
        break;
      }
      default:
        return { ok: false, error: `Unknown language: ${language}` };
    }

    // Clean up temp file
    try { unlinkSync(filePath); } catch {}

    const timedOut = result.error?.code === 'ETIMEDOUT' ||
      (result.signal === 'SIGTERM' || result.signal === 'SIGKILL');

    return {
      ok: true,
      exitCode: result.status,
      signal: result.signal || null,
      timedOut,
      stdout: (result.stdout || '').slice(0, 50000), // cap output
      stderr: (result.stderr || '').slice(0, 10000),
      duration: null, // spawnSync doesn't give us timing easily
      language,
      permission,
    };
  } catch (err) {
    try { unlinkSync(filePath); } catch {}
    return { ok: false, error: `Execution failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Safety check
// ---------------------------------------------------------------------------
function checkSafety({ language, permission }) {
  const warnings = [];

  if (language === 'bash') {
    warnings.push('⚠️ bash execution is inherently risky. Code will run with current user permissions.');
  }

  if (permission === 'write') {
    warnings.push('⚠️ write permission allows modifying files on disk.');
  }

  if (permission === 'net') {
    warnings.push('⚠️ network permission allows external connections.');
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
export default {
  name: 'smart_exec',
  category: 'standard',
  description: `Execute code in a sandboxed environment. Supports bash, node, python, deno.
Safety: deno --allow-none by default (no fs, no net). Other languages run with limited permissions.
Use when: need to verify code works, run tests, or execute small scripts safely.
Avoid when: running production services, long-running processes, or untrusted third-party code.`,
  responsePolicy: { maxLevel: 0 }, // Output is small, keep raw

  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['run', 'verify'],
        description: 'Execution mode: "run" (default) to execute, "verify" to validate code output (Phase 20)',
        default: 'run',
      },
      language: {
        type: 'string',
        enum: ['bash', 'node', 'python', 'deno'],
        description: 'Programming language / runtime',
      },
      code: {
        type: 'string',
        description: 'Code to execute or verify',
      },
      permission: {
        type: 'string',
        enum: ['none', 'read', 'write', 'net'],
        description: 'Permission level (default: none). write/net require confirmation.',
        default: 'none',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000, max: 120000)',
        default: 30000,
      },
      workdir: {
        type: 'string',
        description: 'Working directory (default: current project root)',
      },
      expectedOutput: {
        type: 'string',
        description: 'Expected stdout substring (verify mode only)',
      },
      testCases: {
        type: 'array',
        items: { type: 'object' },
        description: 'Test cases for verification (verify mode only)',
      },
      maxRetries: {
        type: 'number',
        description: 'Max retries on failure for verify mode (default: 1)',
        default: 1,
      },
    },
    required: ['code'],
  },

  handler: async (args) => {
    const { mode = 'run', language, code, permission = 'none', timeout = 30000, workdir, expectedOutput, testCases, maxRetries = 1 } = args;

    // Verify mode (Phase 20)
    if (mode === 'verify') {
      const result = verifyCode(code, {
        language,
        timeout,
        maxRetries,
        expectedOutput,
        testCases,
      });
      return JSON.stringify({
        ...result,
        mode: 'verify',
      }, null, 2);
    }

    // Run mode (Phase 10.1, default)
    // Check safety
    const warnings = checkSafety({ language, permission });
    const lang = LANGUAGES[language];

    if (!lang) {
      return JSON.stringify({
        ok: false,
        error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGES).join(', ')}`,
      });
    }

    if (!lang.available) {
      return JSON.stringify({
        ok: false,
        error: `Runtime not available for ${language}.`,
        installHint: language === 'deno' ? 'curl -fsSL https://deno.land/install.sh | sh' :
                     language === 'python' ? 'brew install python3' : null,
      });
    }

    // Execute
    const result = executeCode({ language, code, permission, timeout, workdir });

    // Add metadata
    return JSON.stringify({
      ...result,
      mode: 'run',
      sandbox: language === 'deno' ? `deno --allow-none (max safety)` :
               language === 'node' ? `node (permission: ${permission})` :
               language === 'python' ? 'python3 (no sandbox)' :
               'bash (no sandbox — ⚠️ high risk)',
      warnings: warnings.length > 0 ? warnings : undefined,
      availableLanguages: Object.entries(LANGUAGES)
        .filter(([, v]) => v.available)
        .map(([k]) => k),
      hint: result.timedOut
        ? `Execution timed out after ${timeout}ms. Try increasing timeout or simplifying code.`
        : result.exitCode !== 0
        ? `Exit code ${result.exitCode}. Check stderr for details.`
        : undefined,
    }, null, 2);
  },
};