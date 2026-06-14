// exec.test.mjs — Phase 10.1: Sandbox Execution tests
//
// Tests: smart_exec plugin (language support, execution, safety, timeout, errors)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import
const mod = await import('../src/plugins/standard/exec.mjs');
const plugin = mod.default;

// ---------------------------------------------------------------------------
// Plugin structure
// ---------------------------------------------------------------------------
describe('plugin structure', () => {
  it('has correct name', () => {
    assert.equal(plugin.name, 'smart_exec');
  });

  it('has handler function', () => {
    assert.equal(typeof plugin.handler, 'function');
  });

  it('has inputSchema with required fields', () => {
    assert.ok(plugin.inputSchema);
    // language is optional (auto-detected from code content)
    assert.deepEqual(plugin.inputSchema.required, ['code']);
    assert.ok(plugin.inputSchema.properties.language.enum.includes('bash'));
    assert.ok(plugin.inputSchema.properties.language.enum.includes('node'));
    assert.ok(plugin.inputSchema.properties.language.enum.includes('python'));
    assert.ok(plugin.inputSchema.properties.language.enum.includes('deno'));
  });

  it('has responsePolicy maxLevel 0', () => {
    assert.equal(plugin.responsePolicy.maxLevel, 0);
  });
});

// ---------------------------------------------------------------------------
// Handler: basic execution
// ---------------------------------------------------------------------------
describe('handler: basic execution', () => {
  it('executes node code successfully', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log("hello world");',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello world'));
  });

  it('executes node code with exit code', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'process.exit(42);',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 42);
  });

  it('executes node code with stderr', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.error("error message");',
    }));
    assert.ok(result.ok);
    assert.ok(result.stderr.includes('error message'));
  });

  it('executes python code', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'python',
      code: 'print("hello from python")',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello from python'));
  });

  it('executes bash code', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'bash',
      code: 'echo "hello from bash"',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello from bash'));
  });

  it('executes deno code', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'deno',
      code: 'console.log("hello from deno");',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello from deno'));
  });
});

// ---------------------------------------------------------------------------
// Handler: error cases
// ---------------------------------------------------------------------------
describe('handler: error cases', () => {
  it('rejects unsupported language', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'ruby',
      code: 'puts "hi"',
    }));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Unsupported language'));
  });

  it('rejects missing language', async () => {
    const result = JSON.parse(await plugin.handler({
      code: 'console.log("hi")',
    }));
    assert.equal(result.ok, false);
  });

  it('handles syntax error in node', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'this is not valid javascript!!!',
    }));
    assert.ok(result.ok); // execution itself succeeded
    assert.notEqual(result.exitCode, 0); // but code failed
    assert.ok(result.stderr.length > 0);
  });

  it('handles syntax error in python', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'python',
      code: 'this is not valid python!!!',
    }));
    assert.ok(result.ok);
    assert.notEqual(result.exitCode, 0);
  });
});

// ---------------------------------------------------------------------------
// Handler: timeout
// ---------------------------------------------------------------------------
describe('handler: timeout', () => {
  it('times out on infinite loop', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'while(true){}',
      timeout: 1000,
    }));
    assert.ok(result.ok);
    assert.ok(result.timedOut, `Expected timedOut=true, got ${JSON.stringify(result)}`);
  });

  it('respects custom timeout', async () => {
    const start = Date.now();
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'const start = Date.now(); while(Date.now() - start < 5000){}',
      timeout: 1000,
    }));
    const elapsed = Date.now() - start;
    assert.ok(result.timedOut, `Expected timedOut=true, got exitCode=${result.exitCode}, signal=${result.signal}`);
    assert.ok(elapsed < 4000, `Expected <4000ms, got ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// Handler: sandbox info
// ---------------------------------------------------------------------------
describe('handler: sandbox metadata', () => {
  it('includes sandbox info', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'deno',
      code: 'console.log("hi");',
    }));
    assert.ok(result.sandbox.includes('deno'));
    assert.ok(result.sandbox.includes('max safety'));
  });

  it('includes available languages', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log("hi");',
    }));
    assert.ok(Array.isArray(result.availableLanguages));
    assert.ok(result.availableLanguages.includes('node'));
  });

  it('warns about bash safety', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'bash',
      code: 'echo hi',
    }));
    assert.ok(result.warnings);
    assert.ok(result.warnings.some(w => w.includes('bash')));
  });

  it('warns about write permission', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log("hi");',
      permission: 'write',
    }));
    assert.ok(result.warnings);
    assert.ok(result.warnings.some(w => w.includes('write')));
  });

  it('warns about net permission', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log("hi");',
      permission: 'net',
    }));
    assert.ok(result.warnings);
    assert.ok(result.warnings.some(w => w.includes('network')));
  });
});

// ---------------------------------------------------------------------------
// Handler: output capping
// ---------------------------------------------------------------------------
describe('handler: output capping', () => {
  it('caps stdout at 50000 chars', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log("x".repeat(60000));',
    }));
    assert.ok(result.ok);
    assert.ok(result.stdout.length <= 50000);
  });

  it('caps stderr at 10000 chars', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.error("x".repeat(15000));',
    }));
    assert.ok(result.ok);
    assert.ok(result.stderr.length <= 10000);
  });
});

// ---------------------------------------------------------------------------
// Handler: workdir
// ---------------------------------------------------------------------------
describe('handler: workdir', () => {
  it('executes in specified workdir', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'node',
      code: 'console.log(process.cwd());',
      workdir: '/tmp',
    }));
    assert.ok(result.ok);
    // macOS: /tmp is a symlink to /private/tmp
    assert.ok(result.stdout.includes('/tmp') || result.stdout.includes('/private/tmp'),
      `Expected /tmp in stdout, got: ${result.stdout}`);
  });
});

// ---------------------------------------------------------------------------
// Handler: permission levels
// ---------------------------------------------------------------------------
describe('handler: permission levels', () => {
  it('deno with none permission blocks file read', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'deno',
      code: 'const content = await Deno.readTextFile("/etc/hosts"); console.log(content);',
      permission: 'none',
    }));
    assert.ok(result.ok);
    // Deno should block this with --allow-none
    assert.notEqual(result.exitCode, 0);
  });

  it('deno with read permission allows file read', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'deno',
      code: 'const content = await Deno.readTextFile("/etc/hosts"); console.log("read ok:", content.length, "bytes");',
      permission: 'read',
    }));
    assert.ok(result.ok);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('read ok'));
  });

  it('deno with none permission blocks network', async () => {
    const result = JSON.parse(await plugin.handler({
      language: 'deno',
      code: 'await fetch("http://example.com");',
      permission: 'none',
      timeout: 5000,
    }));
    assert.ok(result.ok);
    assert.notEqual(result.exitCode, 0);
  });
});