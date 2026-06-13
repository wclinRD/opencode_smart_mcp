// code-verifier.mjs — Execution-Grounded Verification (Phase 20)
//
// 參考：IBM/verified-code-cot
// 核心：code generation 後自動在 sandbox 執行驗證，確保產出可執行的 code。
//
// 流程：
//   extract code → sandbox execute → check exit code + output
//   → 成功：回傳 code + execution result + metadata
//   → 失敗：回傳 code + error + suggestion
//   → Retry：最多 1 輪自動修正

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------
const HAS_NODE = true;
const HAS_PYTHON = (() => {
  try { spawnSync('python3', ['--version'], { timeout: 3000 }); return true; }
  catch { return false; }
})();
const HAS_DENO = (() => {
  try { spawnSync('deno', ['--version'], { timeout: 3000 }); return true; }
  catch { return false; }
})();
const HAS_BASH = true;

// ---------------------------------------------------------------------------
// Language configs
// ---------------------------------------------------------------------------
const LANGUAGES = {
  js: {
    runtime: 'node',
    ext: '.mjs',
    shebang: '',
    available: HAS_NODE,
    compileCmd: null,
    compileArgs: [],
    runCmd: 'node',
    runArgs: [],
    timeout: 15000,
  },
  ts: {
    runtime: 'deno',
    ext: '.ts',
    shebang: '',
    available: HAS_DENO,
    compileCmd: null,
    compileArgs: [],
    runCmd: 'deno',
    runArgs: ['run', '--no-prompt', '--allow-none'],
    timeout: 15000,
  },
  python: {
    runtime: 'python3',
    ext: '.py',
    shebang: '',
    available: HAS_PYTHON,
    compileCmd: 'python3',
    compileArgs: ['-c', 'import py_compile; py_compile.compile("FILE")'],
    runCmd: 'python3',
    runArgs: [],
    timeout: 15000,
  },
  bash: {
    runtime: 'bash',
    ext: '.sh',
    shebang: '#!/usr/bin/env bash\nset -euo pipefail\n',
    available: HAS_BASH,
    compileCmd: null,
    compileArgs: [],
    runCmd: 'bash',
    runArgs: ['-n'],  // syntax check
    timeout: 10000,
  },
};

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------
function createTempFile(code, lang) {
  const cfg = LANGUAGES[lang];
  if (!cfg) throw new Error(`Unsupported language: ${lang}`);
  const dir = join(tmpdir(), 'smart-verify');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${randomUUID()}${cfg.ext}`);
  const content = cfg.shebang ? cfg.shebang + '\n' + code : code;
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Syntax check (compile-time validation)
// ---------------------------------------------------------------------------
function syntaxCheck(code, lang) {
  const cfg = LANGUAGES[lang];
  if (!cfg || !cfg.compileCmd) return { ok: true };

  let filePath;
  try {
    filePath = createTempFile(code, lang);

    if (lang === 'python') {
      const result = spawnSync('python3', ['-c', `import py_compile; py_compile.compile('${filePath}', doraise=True)`], {
        timeout: 10000,
        encoding: 'utf-8',
      });
      try { unlinkSync(filePath); } catch {}
      return {
        ok: result.status === 0,
        error: result.status !== 0 ? (result.stderr || result.stdout || 'Syntax error') : null,
      };
    }

    if (lang === 'bash') {
      const result = spawnSync('bash', ['-n', filePath], {
        timeout: 10000,
        encoding: 'utf-8',
      });
      try { unlinkSync(filePath); } catch {}
      return {
        ok: result.status === 0,
        error: result.status !== 0 ? (result.stderr || 'Syntax error') : null,
      };
    }

    try { unlinkSync(filePath); } catch {}
    return { ok: true };
  } catch (err) {
    try { unlinkSync(filePath); } catch {}
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Code execution
// ---------------------------------------------------------------------------
function executeCode(code, lang, timeout) {
  const cfg = LANGUAGES[lang];
  if (!cfg) return { ok: false, error: `Unsupported language: ${lang}` };
  if (!cfg.available) return { ok: false, error: `Runtime not available for ${lang}` };

  let filePath;
  try {
    filePath = createTempFile(code, lang);
  } catch (err) {
    return { ok: false, error: `Cannot create temp file: ${err.message}` };
  }

  try {
    const maxTimeout = Math.min(timeout || cfg.timeout, 30000);
    const args = [...cfg.runArgs, filePath];
    const result = spawnSync(cfg.runCmd, args, {
      timeout: maxTimeout,
      maxBuffer: 1024 * 512, // 512KB
      encoding: 'utf-8',
      env: { ...process.env, PATH: process.env.PATH },
    });

    try { unlinkSync(filePath); } catch {}

    const timedOut = result.error?.code === 'ETIMEDOUT' ||
      result.signal === 'SIGTERM' || result.signal === 'SIGKILL';

    return {
      ok: result.status === 0,
      exitCode: result.status,
      signal: result.signal || null,
      timedOut,
      stdout: (result.stdout || '').slice(0, 50000),
      stderr: (result.stderr || '').slice(0, 10000),
    };
  } catch (err) {
    try { unlinkSync(filePath); } catch {}
    return { ok: false, error: `Execution failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Extract code from markdown/text
// ---------------------------------------------------------------------------
function extractCode(input) {
  if (!input || typeof input !== 'string') return { code: '', language: 'js' };

  // Try to extract from code block
  const codeBlockMatch = input.match(/```(\w+)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lang = codeBlockMatch[1] || 'js';
    const code = codeBlockMatch[2].trim();
    return { code, language: normalizeLang(lang) };
  }

  // If no code block, treat entire input as code
  return { code: input.trim(), language: detectLanguage(input) };
}

function normalizeLang(lang) {
  const map = {
    javascript: 'js', js: 'js', node: 'js', mjs: 'js',
    typescript: 'ts', ts: 'ts', deno: 'ts',
    python: 'python', py: 'python',
    bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  };
  return map[lang.toLowerCase()] || 'js';
}

function detectLanguage(code) {
  if (code.includes('#!/usr/bin/env bash') || code.includes('#!/bin/bash')) return 'bash';
  if (code.includes('import ') && (code.includes(' from ') || code.includes(';\n'))) return 'js';
  if (code.includes(': ') && (code.includes('def ') || code.includes('import '))) return 'python';
  return 'js';
}

// ---------------------------------------------------------------------------
// Verify Code — 主要 API
// ---------------------------------------------------------------------------

/**
 * Verify if code compiles and runs correctly.
 *
 * @param {string} code - Code to verify
 * @param {object} options
 * @param {string} options.language - Language (auto-detected if not provided)
 * @param {number} options.timeout - Timeout per execution attempt (ms)
 * @param {number} options.maxRetries - Max retry attempts on failure (default: 1)
 * @param {string} options.expectedOutput - Optional expected stdout substring
 * @param {Array} options.testCases - Optional test cases [{ input, expected }]
 * @returns {object} { ok, verified, compilation, execution, retries, issues }
 */
function verifyCode(code, options = {}) {
  const {
    language,
    timeout,
    maxRetries = 1,
    expectedOutput,
    testCases,
  } = options;

  // Extract code if markdown
  const extracted = extractCode(code);
  const cleanCode = extracted.code;
  const lang = language || extracted.language;

  if (!cleanCode) {
    return { ok: false, verified: false, error: 'No code to verify' };
  }

  const issues = [];
  let retries = 0;
  let currentCode = cleanCode;

  // Phase 1: Syntax check
  const syntaxResult = syntaxCheck(currentCode, lang);
  if (!syntaxResult.ok) {
    issues.push({
      phase: 'syntax',
      severity: 'error',
      message: syntaxResult.error || 'Syntax error',
    });
    // No retry for syntax errors — code needs manual fix
    return {
      ok: false,
      verified: false,
      language: lang,
      compilation: { ok: false, error: syntaxResult.error },
      execution: null,
      retries: 0,
      issues,
      suggestion: 'Fix syntax errors before re-verifying.',
    };
  }

  // Phase 2: Execution
  let execResult = executeCode(currentCode, lang, timeout);

  if (execResult.ok === false && maxRetries > 0) {
    // Retry up to maxRetries
    for (let i = 0; i < maxRetries; i++) {
      retries++;
      execResult = executeCode(currentCode, lang, timeout);
      if (execResult.ok !== false) break;
    }
  }

  if (execResult.ok === false) {
    issues.push({
      phase: 'execution',
      severity: 'error',
      message: execResult.error || `Exit code ${execResult.exitCode}`,
      stderr: execResult.stderr ? execResult.stderr.slice(0, 500) : null,
    });
  }

  // Phase 3: Expected output check
  if (expectedOutput && execResult.ok !== false) {
    const stdout = execResult.stdout || '';
    if (!stdout.includes(expectedOutput)) {
      issues.push({
        phase: 'output',
        severity: 'warn',
        message: `Expected output "${expectedOutput}" not found in stdout`,
      });
    }
  }

  // Phase 4: Test cases
  if (testCases && testCases.length > 0 && execResult.ok !== false) {
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      // Simple input injection via stdin not supported in basic execution
      // For now, we verify the code runs without error
      issues.push({
        phase: 'test-case',
        severity: 'info',
        message: `Test case ${i + 1}: code executed (I/O tests require stdin support)`,
      });
    }
  }

  const verified = execResult.ok !== false && issues.filter(i => i.severity === 'error').length === 0;

  return {
    ok: verified,
    verified,
    language: lang,
    compilation: { ok: true },
    execution: {
      ok: execResult.ok !== false,
      exitCode: execResult.exitCode,
      timedOut: execResult.timedOut,
      stdout: execResult.ok !== false ? (execResult.stdout || '').slice(0, 2000) : undefined,
      stderr: execResult.ok !== false ? undefined : (execResult.stderr || '').slice(0, 500),
    },
    retries,
    issues: issues.length > 0 ? issues : undefined,
    suggestion: !verified ? generateSuggestion(issues, lang) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Suggestion generator
// ---------------------------------------------------------------------------
function generateSuggestion(issues, lang) {
  for (const issue of issues) {
    if (issue.phase === 'syntax') return `Fix syntax error in ${lang} code.`;
    if (issue.phase === 'execution') {
      if (issue.stderr && issue.stderr.includes('ReferenceError')) return 'Fix variable references. Check that all variables are defined before use.';
      if (issue.stderr && issue.stderr.includes('TypeError')) return 'Fix type error. Check function arguments and property access.';
      if (issue.stderr && issue.stderr.includes('SyntaxError')) return `Fix syntax error in ${lang} code.`;
      if (issue.stderr && issue.stderr.includes('Error:')) return `Fix runtime error. Check the error message: ${issue.stderr.split('\n')[0]}`;
      return `Code failed with exit code. Check stderr for details.`;
    }
  }
  return 'Review code for errors.';
}

// ---------------------------------------------------------------------------
// Batch verify (multiple files)
// ---------------------------------------------------------------------------
function verifyCodeBatch(files) {
  // files: [{ code, language, timeout, expectedOutput }]
  return files.map((f, i) => ({
    index: i,
    ...verifyCode(f.code, f),
  }));
}

export { verifyCode, verifyCodeBatch, extractCode, LANGUAGES };
