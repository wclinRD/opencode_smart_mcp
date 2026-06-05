// context-integration.test.mjs — Integration tests for context in MCP server
//
// Tests that the context layer is properly integrated with the MCP server:
//   - smart_context tool is listed in tools/list
//   - smart_context responds to get/summary/history/reset commands
//   - Context is auto-initialized when tools are called
//   - smart/health returns context info
//   - smart/context endpoint works
//
// Run: node --test tests/context-integration.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const SERVER_PATH = resolve(import.meta.dirname, '../src/server/index.mjs');
const REQ_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// MCP client helper — connects to server via stdio
// ---------------------------------------------------------------------------

class MCPClient {
  constructor() {
    this._proc = null;
    this._readline = null;
    this._pending = new Map();
    this._nextId = 1;
    this._buffer = '';
  }

  start() {
    return new Promise((resolvePromise, reject) => {
      this._proc = spawn('node', [SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, DEBUG: '' }, // no debug noise
      });

      let started = false;

      this._proc.stdout.on('data', (chunk) => {
        this._buffer += chunk.toString();
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop() || ''; // keep partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            const id = msg.id;
            if (id != null && this._pending.has(id)) {
              this._pending.get(id)(msg);
              this._pending.delete(id);
            }
          } catch {
            // Ignore non-JSON output (debug logs, etc.)
          }
        }

        if (!started) {
          started = true;
          resolvePromise();
        }
      });

      this._proc.stderr.on('data', () => { /* ignore debug output */ });
      this._proc.on('error', reject);

      // Safety timeout
      setTimeout(() => { if (!started) { started = true; resolvePromise(); } }, 1000);
    });
  }

  async send(method, params = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, REQ_TIMEOUT);

      this._pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      const req = { jsonrpc: '2.0', id, method, params };
      this._proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  async callTool(name, args = {}) {
    const resp = await this.send('tools/call', { name, arguments: args });
    if (resp.error) throw new Error(resp.error.message + ': ' + JSON.stringify(resp.error.data));
    return resp.result;
  }

  stop() {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Context integration with MCP server', () => {
  let client;

  before(async () => {
    client = new MCPClient();
    await client.start();
    // Initialize session
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
  });

  after(() => {
    if (client) client.stop();
  });

  it('smart_context appears in tools/list', async () => {
    const result = await client.send('tools/list');
    const tools = result.result.tools;
    const contextTool = tools.find(t => t.name === 'smart_context');
    assert.ok(contextTool, 'smart_context should be in tools list');
    assert.ok(contextTool.description, 'should have description');
    assert.ok(contextTool.inputSchema, 'should have schema');
    assert.equal(contextTool.inputSchema.properties.command.type, 'string');
  });

  it('smart_context get returns session info', async () => {
    const result = await client.callTool('smart_context', { command: 'get' });
    const text = result.content[0].text;
    assert.ok(typeof text === 'string');
    const parsed = JSON.parse(text);
    assert.ok(parsed.sessionId, 'should have sessionId');
    assert.ok('historyCount' in parsed);
    assert.ok('findingCount' in parsed);
    assert.ok('recentCalls' in parsed);
  });

  it('smart_context summary returns compact string', async () => {
    const result = await client.callTool('smart_context', { command: 'summary' });
    const text = result.content[0].text;
    assert.ok(typeof text === 'string');
    // Should be valid JSON
    const parsed = JSON.parse(text);
    assert.ok('sid' in parsed);
    assert.ok('n' in parsed);
    assert.ok('err' in parsed);
  });

  it('smart_context history returns empty when no tools called', async () => {
    const result = await client.callTool('smart_context', { command: 'history' });
    const text = result.content[0].text;
    // Either "No tool history." or valid JSON array
    assert.ok(text === 'No tool history.' || Array.isArray(JSON.parse(text)));
  });

  it('smart_context findings returns empty initially', async () => {
    const result = await client.callTool('smart_context', { command: 'findings' });
    const text = result.content[0].text;
    assert.ok(text === 'No findings yet.' || Array.isArray(JSON.parse(text)));
  });

  it('smart_context inject returns env/args info', async () => {
    const result = await client.callTool('smart_context', { command: 'inject' });
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok('env' in parsed);
    assert.ok('args' in parsed);
    assert.ok('hint' in parsed);
    assert.ok(parsed.env.SMART_SESSION_ID);
    assert.ok(parsed.env.SMART_CONTEXT);
  });

  it('smart_context sessions returns list of persisted sessions', async () => {
    const result = await client.callTool('smart_context', { command: 'sessions' });
    const text = result.content[0].text;
    // Either "No persisted sessions." or valid JSON array
    if (text !== 'No persisted sessions.') {
      const parsed = JSON.parse(text);
      assert.ok(Array.isArray(parsed));
      if (parsed.length > 0) {
        assert.ok('sessionId' in parsed[0]);
        assert.ok('toolCount' in parsed[0]);
      }
    }
  });

  it('smart_context unknown command returns help', async () => {
    const result = await client.callTool('smart_context', { command: 'bogus' });
    const text = result.content[0].text;
    assert.ok(text.includes('Unknown command'));
    assert.ok(text.includes('get'));
  });

  it('smart_context reset resets session', async () => {
    const result = await client.callTool('smart_context', { command: 'reset' });
    const text = result.content[0].text;
    assert.ok(text.includes('Session reset'));
    assert.ok(text.includes('SessionId:'));
  });

  it('smart/health endpoint returns context info', async () => {
    const result = await client.send('smart/health');
    assert.ok(result.result.status === 'ok');
    assert.ok('context' in result.result);
    assert.ok(result.result.context !== null);
    assert.ok(result.result.context.sessionId);
    assert.ok('toolCount' in result.result.context);
  });

  it('smart/context endpoint works', async () => {
    const result = await client.send('smart/context', { command: 'summary' });
    assert.ok(result.result.summary);
    const parsed = JSON.parse(result.result.summary);
    assert.ok('sid' in parsed);
  });

  it('calling a real tool populates context history', async () => {
    // use smart_run help as a safe no-side-effect tool call
    const before = await client.callTool('smart_context', { command: 'summary' });
    const beforeParsed = JSON.parse(before.content[0].text);
    const beforeCount = beforeParsed.n;

    await client.callTool('smart_run', { tool: 'help', args: {} });

    // Check count went up by 1
    const after = await client.callTool('smart_context', { command: 'summary' });
    const afterParsed = JSON.parse(after.content[0].text);
    assert.equal(afterParsed.n, beforeCount + 1, 'tool call should increment count');
  });

  it('context persists across tool calls in sequence', async () => {
    const sid1 = (await client.callTool('smart_context', { command: 'get' }));
    const sid1Parsed = JSON.parse(sid1.content[0].text).sessionId;

    // The sessionId should remain the same
    const sid2 = (await client.callTool('smart_context', { command: 'get' }));
    const sid2Parsed = JSON.parse(sid2.content[0].text).sessionId;
    assert.equal(sid1Parsed, sid2Parsed, 'sessionId should persist across calls');

    // History should be growing
    const count1 = sid1Parsed;
    const hist = await client.callTool('smart_context', { command: 'history' });
    const histText = hist.content[0].text;
    if (histText !== 'No tool history.') {
      const parsed = JSON.parse(histText);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length > 0);
    }
  });
});
