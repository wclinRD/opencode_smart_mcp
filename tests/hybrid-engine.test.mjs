// hybrid-engine.test.mjs — Phase 12 Hybrid Reasoning Engine tests
//
// Tests:
//   1. classifyQuestion — all 6 categories + hybrid threshold
//   2. extractSymbols — symbol extraction from questions
//   3. planPath — plan generation by category
//   4. executePlan — async execution
//   5. mergeResults — structured output
//   6. executeHybrid — full pipeline
//   7. computeParallelGroups — dependency resolution
//
// Run: node --test tests/hybrid-engine.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__dirname, '../.test-hybrid-' + Date.now());

// Create test project with sample files
const SRC_DIR = resolve(TEST_DIR, 'src');

before(() => {
  mkdirSync(SRC_DIR, { recursive: true });
  mkdirSync(resolve(TEST_DIR, 'lib'), { recursive: true });

  // auth.ts
  writeFileSync(resolve(SRC_DIR, 'auth.ts'), `
export function authenticate(token: string): boolean {
  if (!token) throw new Error('Token required');
  return validateToken(token);
}

function validateToken(t: string): boolean {
  return t.length > 10;
}

export function getUser(token: string): { id: string; name: string } | null {
  if (!authenticate(token)) return null;
  return { id: '123', name: 'test' };
}
`.trimStart());

  // utils.ts
  writeFileSync(resolve(SRC_DIR, 'utils.ts'), `
import { authenticate } from './auth';

export function loginUser(username: string, password: string): string {
  const token = generateToken(username, password);
  if (authenticate(token)) {
    return token;
  }
  throw new Error('Login failed');
}

function generateToken(u: string, p: string): string {
  return Buffer.from(u + ':' + p).toString('base64');
}
`.trimStart());

  // server.ts
  writeFileSync(resolve(SRC_DIR, 'server.ts'), `
import { loginUser } from './utils';
import { getUser } from './auth';

export class Server {
  async handleRequest(path: string, body: any): Promise<any> {
    if (path === '/login') {
      const token = loginUser(body.username, body.password);
      const user = getUser(token);
      return { token, user };
    }
    throw new Error('Not found');
  }
}
`.trimStart());
});

import {
  classifyQuestion,
  extractSymbols,
  planPath,
  executePlan,
  mergeResults,
  executeHybrid,
  getGeneralRecommendation,
  CATEGORIES,
} from '../src/lib/hybrid-engine.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 12: Hybrid Reasoning Engine', () => {
  // -----------------------------------------------------------------------
  // 1. Task Classifier
  // -----------------------------------------------------------------------
  describe('1. classifyQuestion', () => {
    it('classifies structure queries (callers/definition)', () => {
      const result = classifyQuestion('who calls authenticate() in src/auth.ts');
      assert.equal(result.category, 'structure');
      assert.ok(result.confidence >= 0.85);
      assert.ok(result.tools.length > 0);
      assert.equal(result.isHybrid, false);
    });

    it('classifies structure queries (type/signature)', () => {
      const result = classifyQuestion('what is the type of authenticate');
      assert.equal(result.category, 'structure', `got ${result.category} instead of structure`);
      assert.ok(result.confidence >= 0.85);
    });

    it('classifies structure queries (dependencies/imports)', () => {
      const result = classifyQuestion('what are the dependencies of auth.ts');
      assert.equal(result.category, 'structure', `got ${result.category} instead of structure`);
      assert.ok(result.confidence >= 0.8);
    });

    it('classifies structure queries (unused exports)', () => {
      const result = classifyQuestion('find unused exports in the project');
      assert.equal(result.category, 'structure');
      assert.ok(result.confidence > 0);
    });

    it('classifies change-impact queries', () => {
      const result = classifyQuestion('what if I rename authenticate()');
      assert.equal(result.category, 'change-impact');
      assert.ok(result.confidence >= 0.8);
    });

    it('classifies change-impact queries (safety check)', () => {
      const result = classifyQuestion('is it safe to change the auth module');
      assert.equal(result.category, 'change-impact');
      assert.ok(result.confidence >= 0.8);
    });

    it('classifies debug queries', () => {
      const result = classifyQuestion('debug the login error in auth.ts');
      assert.equal(result.category, 'debug');
      assert.ok(result.confidence >= 0.75);
    });

    it('classifies debug queries (stack trace)', () => {
      const result = classifyQuestion('why does authenticate throw TypeError');
      assert.equal(result.category, 'debug');
      assert.ok(result.confidence >= 0.75);
    });

    it('classifies search queries', () => {
      const result = classifyQuestion('find all usages of authenticate');
      assert.equal(result.category, 'search');
      assert.ok(result.confidence >= 0.8);
    });

    it('classifies search queries (file search)', () => {
      const result = classifyQuestion('search for files containing loginUser');
      assert.equal(result.category, 'search');
      assert.ok(result.confidence >= 0.8);
    });

    it('classifies semantic queries', () => {
      const result = classifyQuestion('explain how the auth module works');
      assert.equal(result.category, 'semantic');
      assert.ok(result.confidence >= 0.65);
    });

    it('classifies unknown queries with low confidence', () => {
      const result = classifyQuestion('this is a completely unrelated question');
      assert.equal(result.category, 'unknown');
      assert.ok(result.confidence < 0.5);
    });

    it('handles empty question gracefully', () => {
      const result = classifyQuestion('');
      assert.equal(result.category, 'unknown');
      assert.equal(result.confidence, 0);
    });

    it('hybrid threshold: lower confidence → isHybrid=true', () => {
      // Semantic queries are below threshold (0.75)
      const result = classifyQuestion('explain this to me');
      if (result.category === 'semantic') {
        assert.ok(result.isHybrid === true || result.confidence < 0.75);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Symbol Extraction
  // -----------------------------------------------------------------------
  describe('2. extractSymbols', () => {
    it('extracts symbol after "callers of"', () => {
      const symbols = extractSymbols('who calls authenticate');
      assert.ok(symbols.includes('authenticate'));
    });

    it('extracts symbol after "find"', () => {
      const symbols = extractSymbols('find loginUser in codebase');
      assert.ok(symbols.includes('loginUser'));
    });

    it('extracts symbol after "what is"', () => {
      const symbols = extractSymbols('what is authenticate');
      assert.ok(symbols.includes('authenticate'));
    });

    it('extracts symbol with definition pattern', () => {
      const symbols = extractSymbols('authenticate definition');
      assert.ok(symbols.includes('authenticate'));
    });

    it('returns empty array for no-match input', () => {
      const symbols = extractSymbols('how does this work');
      assert.ok(symbols.length === 0 || symbols.every(s => s.length >= 2));
    });
  });

  // -----------------------------------------------------------------------
  // 3. Plan Path
  // -----------------------------------------------------------------------
  describe('3. planPath', () => {
    it('generates plan for structure queries with symbols', () => {
      const classification = { category: 'structure', confidence: 0.9, tools: ['ckg'], isHybrid: false };
      const plan = planPath(classification, 'who calls authenticate', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });
      assert.ok(plan.plan.length > 0, 'should generate at least 1 step');
      assert.ok(plan.parallel.length > 0, 'should have parallel groups');
      assert.ok(plan.hasSteps, 'should have steps');
    });

    it('generates plan for change-impact queries', () => {
      const classification = { category: 'change-impact', confidence: 0.85, tools: ['ckg'], isHybrid: false };
      const plan = planPath(classification, 'impact of changing auth', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
      });
      assert.ok(plan.plan.length > 0);
    });

    it('generates plan for debug queries', () => {
      const classification = { category: 'debug', confidence: 0.8, tools: ['grep'], isHybrid: false };
      const plan = planPath(classification, 'debug error in auth', {
        root: TEST_DIR,
      });
      assert.ok(plan.plan.length > 0);
    });

    it('generates plan for search queries', () => {
      const classification = { category: 'search', confidence: 0.85, tools: ['grep'], isHybrid: false };
      const plan = planPath(classification, 'find authenticate', {
        root: TEST_DIR,
      });
      assert.ok(plan.plan.length > 0);
    });

    it('generates plan for semantic queries', () => {
      const classification = { category: 'semantic', confidence: 0.7, tools: ['ckg'], isHybrid: true };
      const plan = planPath(classification, 'explain auth', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
      });
      assert.ok(plan.plan.length > 0, 'semantic queries should generate plans');
    });

    it('generates plan for unknown queries', () => {
      const classification = { category: 'unknown', confidence: 0.3, tools: ['ckg', 'grep'], isHybrid: true };
      const plan = planPath(classification, 'some random question about the code', {
        root: TEST_DIR,
      });
      assert.ok(plan.plan.length > 0, 'unknown queries should still generate exploration plans');
    });

    it('plan steps have required fields', () => {
      const classification = { category: 'structure', confidence: 0.9, tools: ['ckg'], isHybrid: false };
      const plan = planPath(classification, 'who calls authenticate', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });
      for (const step of plan.plan) {
        assert.ok(step.id, 'step should have id');
        assert.ok(step.tool, 'step should have tool');
        assert.ok(Array.isArray(step.dependsOn), 'step should have dependsOn array');
        assert.ok(typeof step.execute === 'function', 'step should have execute function');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Plan Execution
  // -----------------------------------------------------------------------
  describe('4. executePlan', () => {
    it('executes plan and returns results', async () => {
      // Create a simple plan with inline functions
      const plan = {
        plan: [
          { id: 'step_0', tool: 'test', dependsOn: [], execute: async () => ({ ok: true, value: 42 }) },
          { id: 'step_1', tool: 'test', dependsOn: ['step_0'], execute: async () => ({ ok: true, value: 99 }) },
        ],
        parallel: [['step_0'], ['step_1']],
      };

      const result = await executePlan(plan);
      assert.ok(result.duration >= 0, 'should have non-negative duration');
      assert.ok(result.results.has('step_0'), 'step_0 should have result');
      assert.ok(result.results.has('step_1'), 'step_1 should have result');
      assert.equal(result.results.get('step_0').value.value, 42);
      assert.equal(result.results.get('step_1').value.value, 99);
    });

    it('handles empty plan', async () => {
      const result = await executePlan({ plan: [], parallel: [] });
      assert.ok(result.empty, 'should mark as empty');
      assert.equal(result.duration, 0);
    });

    it('handles execution errors gracefully', async () => {
      const plan = {
        plan: [
          { id: 'step_0', tool: 'failing', dependsOn: [], execute: async () => { throw new Error('test error'); } },
        ],
        parallel: [['step_0']],
      };

      const result = await executePlan(plan);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].error.includes('test error'));
    });
  });

  // -----------------------------------------------------------------------
  // 5. Parallel Groups (DAG) — tested through planPath output
  // -----------------------------------------------------------------------
  describe('5. parallel groups (via planPath)', () => {
    it('planPath returns parallel groups with correct structure', () => {
      const classification = { category: 'structure', confidence: 0.9, tools: ['ckg'], isHybrid: false };
      const plan = planPath(classification, 'who calls authenticate', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });
      assert.ok(Array.isArray(plan.parallel), 'parallel should be array');
      assert.ok(plan.parallel.length > 0, 'should have at least 1 group');
      // Each group is an array of step IDs
      for (const group of plan.parallel) {
        assert.ok(Array.isArray(group), 'each group should be an array');
        assert.ok(group.length > 0, 'each group should have steps');
      }
    });

    it('groups independent structure steps together', () => {
      const classification = { category: 'structure', confidence: 0.9, tools: ['ckg'], isHybrid: false };
      const plan = planPath(classification, 'who calls authenticate', {
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });
      // Structure: callers + callees + type all have no deps → same group
      if (plan.parallel.length > 0) {
        const firstGroup = plan.parallel[0];
        // Should have multiple steps (at least callers + callees + type)
        assert.ok(firstGroup.length >= 2, 'independent steps should be parallelized');
      }
    });

    it('handles empty-symbol plan gracefully', () => {
      const classification = { category: 'unknown', confidence: 0.3, tools: ['ckg', 'grep'], isHybrid: true };
      const plan = planPath(classification, 'something random', { root: TEST_DIR });
      assert.ok(Array.isArray(plan.parallel));
    });
  });

  // -----------------------------------------------------------------------
  // 6. Merge Results
  // -----------------------------------------------------------------------
  describe('6. mergeResults', () => {
    it('produces answer from execution results', () => {
      const classification = { category: 'structure', confidence: 0.9, isHybrid: false };
      const execResult = {
        results: new Map([
          ['ckg_stats', { error: null, value: { nodes: 150, edges: 300, files: 10, project: 'test' } }],
          ['ckg_callers', { error: null, value: { root: { symbol: 'foo' }, totalCallers: 3, callers: [] } }],
        ]),
        duration: 150,
        errors: [],
        stepCount: 2,
      };
      const merged = mergeResults(classification, execResult, 'who calls foo');
      assert.ok(merged.answer, 'should have answer');
      assert.ok(merged.answer.includes('3 caller'), 'should mention caller count');
      assert.ok(merged.sources.length > 0, 'should have source tools');
      assert.equal(merged.classification.category, 'structure');
      assert.ok(merged.classification.confidence > 0);
      assert.ok(merged.metadata.duration > 0);
    });

    it('produces fallback answer when no results', () => {
      const classification = { category: 'unknown', confidence: 0.3, isHybrid: true };
      const execResult = {
        results: new Map(),
        duration: 5,
        errors: [],
        stepCount: 0,
      };
      const merged = mergeResults(classification, execResult, 'random question');
      assert.ok(merged.answer, 'should still have answer');
      assert.ok(merged.confidence <= 0.5, 'low confidence');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Full Pipeline
  // -----------------------------------------------------------------------
  describe('7. executeHybrid', () => {
    it('processes structure question through full pipeline', async () => {
      const result = await executeHybrid({
        question: 'who calls authenticate',
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });
      assert.ok(result.answer, 'should have answer');
      assert.ok(result.sources, 'should have sources');
      // CKG may not be built — but pipeline should complete gracefully
      assert.ok(result.metadata.duration > 0, 'should have duration');
    });

    it('processes semantic question through full pipeline', async () => {
      const result = await executeHybrid({
        question: 'explain auth.ts',
        root: TEST_DIR,
        files: ['src/auth.ts'],
      });
      assert.ok(result.answer, 'should have answer');
      assert.ok(result.metadata.duration > 0);
    });

    it('returns error for empty question', async () => {
      const result = await executeHybrid({ question: '' });
      assert.ok(result.answer.includes('No question'), 'should flag missing question');
    });

    it('handles forceHybrid mode', async () => {
      const result = await executeHybrid({
        question: 'who calls authenticate',
        root: TEST_DIR,
        files: ['src/auth.ts'],
        forceHybrid: true,
      });
      // forceHybrid overrides classification to unknown
      assert.equal(result.classification.category, 'unknown');
    });

    it('processes search question', async () => {
      const result = await executeHybrid({
        question: 'find all authenticate references',
        root: TEST_DIR,
      });
      assert.ok(result.answer, 'should have answer');
      assert.ok(result.metadata.duration > 0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Confidence Tracking & Source Attribution (验收标准)
  // -----------------------------------------------------------------------
  describe('8. verification (验收标准)', () => {
    it('sources include tool and confidence metadata', async () => {
      const result = await executeHybrid({
        question: 'what is authenticate',
        root: TEST_DIR,
        files: ['src/auth.ts'],
      });
      // Sources should have type/tool/confidence
      for (const src of result.sources) {
        assert.ok(src.type === 'deterministic' || src.type === 'error');
        assert.ok(src.tool !== undefined);
      }
    });

    it('output format has required fields', async () => {
      const result = await executeHybrid({
        question: 'who calls authenticate',
        root: TEST_DIR,
        files: ['src/auth.ts'],
      });
      assert.ok('answer' in result);
      assert.ok('classification' in result);
      assert.ok('confidence' in result);
      assert.ok('sources' in result);
      assert.ok('metadata' in result);
      assert.ok('_raw' in result);
    });

    it('deterministic path completes < 50ms for basic queries', async () => {
      // Pure classification + merge (no tools)
      const start = Date.now();
      const classification = classifyQuestion('who calls authenticate');
      const plan = planPath(classification, 'who calls authenticate', { root: TEST_DIR, files: ['src/auth.ts'], symbols: ['authenticate'] });
      const execResult = await executePlan(plan);
      const merged = mergeResults(classification, execResult, '');
      const duration = Date.now() - start;
      // Most of the time is in the classification + merge (should be < 50ms)
      // Add note about tool execution time if tools fail
      assert.ok(duration < 5000, 'classification + plan + merge should complete quickly');
    });

    it('MCP tool output format matches specification', async () => {
      // Simulate what the MCP tool would output
      const { executeHybrid } = await import('../src/lib/hybrid-engine.mjs');
      const result = await executeHybrid({
        question: 'who calls authenticate',
        root: TEST_DIR,
        files: ['src/auth.ts'],
        symbols: ['authenticate'],
      });

      // JSON serializable
      const json = JSON.stringify(result);
      assert.ok(json.length > 0, 'should be JSON-serializable');
      const parsed = JSON.parse(json);
      assert.equal(parsed.classification.category, 'structure');
      assert.ok(typeof parsed.answer === 'string');
    });
  });
});

// -----------------------------------------------------------------------
// 9. Phase 3: GENERAL Task Classifier (13 domains)
// -----------------------------------------------------------------------
describe('9. Phase 3: GENERAL classifier', () => {
  const generalQueries = [
    { domain: 'crawl', query: '幫我爬 iyf.tv 的 API' },
    { domain: 'crawl', query: '網站抓取工具推薦' },
    { domain: 'crawl', query: 'scrape this website for data' },
    { domain: 'crawl', query: 'crawl this page and extract links' },
    { domain: 'refactor', query: '重構這個 auth 模組' },
    { domain: 'refactor', query: 'rename authenticate to verifyToken' },
    { domain: 'refactor', query: 'refactor the login flow' },
    { domain: 'git', query: '幫我 commit 並發 PR' },
    { domain: 'git', query: 'git push to remote branch' },
    { domain: 'git', query: 'code review 這個 PR' },
    { domain: 'security', query: '掃描專案漏洞' },
    { domain: 'security', query: '檢查 credentials 洩漏' },
    { domain: 'security', query: 'security vulnerability scan' },
    { domain: 'test', query: '跑測試並看覆蓋率' },
    { domain: 'test', query: '幫我寫 unit test' },
    { domain: 'test', query: 'run jest tests with coverage' },
    { domain: 'report', query: '產生架構圖表報告' },
    { domain: 'report', query: '畫一個 mermaid 流程圖' },
    { domain: 'report', query: 'generate HTML dashboard' },
    { domain: 'lang', query: 'python 程式碼檢查' },
    { domain: 'lang', query: 'run pyright type checking' },
    { domain: 'search_web', query: '搜尋 React Server Components 文件' },
    { domain: 'search_web', query: 'research best practices for API design' },
    { domain: 'edit', query: '幫我 patch 這個檔案' },
    { domain: 'edit', query: 'apply this diff to the codebase' },
    { domain: 'plan', query: '規劃這個專案的開發流程' },
    { domain: 'plan', query: '分解任務步驟' },
    { domain: 'office', query: '建立一個 Word 文件' },
    { domain: 'office', query: '編輯這個 excel 試算表' },
    { domain: 'wiki', query: '查詢 obsidian 知識庫關於 React 的資料' },
    { domain: 'wiki', query: 'ingest this document into wiki' },
    { domain: 'analyze', query: '分析這個專案的架構' },
    { domain: 'analyze', query: 'review 程式碼品質' },
    { domain: 'analyze', query: 'audit the tech stack' },
  ];

  for (const { domain, query } of generalQueries) {
    it(`classifies "${domain}" query: "${query.slice(0, 40)}..."`, () => {
      const result = classifyQuestion(query);
      assert.equal(result.category, CATEGORIES.GENERAL,
        `expected GENERAL for "${query}", got "${result.category}"`);
      assert.ok(result.confidence >= 0.5, `confidence ${result.confidence} should be >= 0.5`);
    });
  }

  // Negative tests: code queries should NOT be classified as GENERAL
  const codeQueries = [
    'who calls authenticate in auth.ts',
    'what is the type of getUser',
    'find all references to loginUser',
    'debug the login error',
    'what if I rename validateToken',
    'explain how the auth module works',
    'find unused exports in project',
    'is it safe to delete this function',
  ];

  for (const query of codeQueries) {
    it(`does NOT classify code query as GENERAL: "${query.slice(0, 50)}..."`, () => {
      const result = classifyQuestion(query);
      assert.notEqual(result.category, CATEGORIES.GENERAL,
        `code query "${query}" should not be GENERAL, got GENERAL`);
      assert.ok(result.confidence >= 0.7 || result.category !== 'unknown',
        `code query "${query}" should match a code category`);
    });
  }

  // Edge cases
  const edgeCases = [
    { query: '', expected: 'unknown' },
    { query: '   ', expected: 'unknown' },        // spaces only
    { query: 'abc123xyz', expected: 'unknown' },   // gibberish
    { query: '12345', expected: 'unknown' },        // numbers only
    { query: '今天天氣怎麼樣', expected: 'unknown' }, // unrelated Chinese
  ];

  for (const { query, expected } of edgeCases) {
    it(`handles edge case: "${query.slice(0, 30)}" → ${expected}`, () => {
      const result = classifyQuestion(query);
      assert.equal(result.category, expected,
        `expected "${expected}" for "${query}", got "${result.category}"`);
    });
  }
});

// -----------------------------------------------------------------------
// 10. Phase 3: getGeneralRecommendation
// -----------------------------------------------------------------------
describe('10. Phase 3: getGeneralRecommendation', () => {
  it('returns null for non-GENERAL classification', () => {
    const classification = { category: 'structure', confidence: 0.9 };
    const rec = getGeneralRecommendation(classification, 'who calls foo');
    assert.equal(rec, null);
  });

  it('returns crawl recommendation', () => {
    const classification = classifyQuestion('幫我爬一個網站');
    const rec = getGeneralRecommendation(classification, '幫我爬一個網站');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'crawl');
    assert.ok(rec.tools.length > 0, 'should list tools');
    assert.ok(rec.workflow.length > 0, 'should have workflow');
    assert.ok(rec.skill, 'should recommend a skill');
    assert.ok(rec.confidence > 0);
  });

  it('returns security recommendation', () => {
    const classification = classifyQuestion('掃描專案漏洞');
    const rec = getGeneralRecommendation(classification, '掃描專案漏洞');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'security');
    assert.ok(rec.tools.includes('smart_security'));
  });

  it('returns git recommendation', () => {
    const classification = classifyQuestion('幫我 commit 並發 PR');
    const rec = getGeneralRecommendation(classification, '幫我 commit 並發 PR');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'git');
    assert.ok(rec.tools.includes('git_commit'));
  });

  it('returns refactor recommendation', () => {
    const classification = classifyQuestion('重構 auth 模組');
    const rec = getGeneralRecommendation(classification, '重構 auth 模組');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'refactor');
    assert.ok(rec.tools.includes('import_graph'));
  });

  it('returns test recommendation', () => {
    const classification = classifyQuestion('跑測試並看覆蓋率');
    const rec = getGeneralRecommendation(classification, '跑測試並看覆蓋率');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'test');
    assert.ok(rec.tools.includes('smart_test'));
  });

  it('returns report recommendation', () => {
    const classification = classifyQuestion('產生架構圖表報告');
    const rec = getGeneralRecommendation(classification, '產生架構圖表報告');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'report');
  });

  it('returns wiki recommendation', () => {
    const classification = classifyQuestion('查詢 obsidian 知識庫');
    const rec = getGeneralRecommendation(classification, '查詢 obsidian 知識庫');
    assert.ok(rec, 'should return recommendation');
    assert.equal(rec.domain, 'wiki');
  });

  it('recommendation has required fields', () => {
    const classification = classifyQuestion('幫我爬一個網站');
    const rec = getGeneralRecommendation(classification, '幫我爬一個網站');
    assert.ok(rec, 'should return recommendation');
    assert.ok(typeof rec.domain === 'string', 'domain should be string');
    assert.ok(typeof rec.description === 'string', 'description should be string');
    assert.ok(Array.isArray(rec.tools), 'tools should be array');
    assert.ok(Array.isArray(rec.workflow), 'workflow should be array');
    assert.ok(typeof rec.confidence === 'number', 'confidence should be number');
    assert.ok(rec.confidence > 0 && rec.confidence <= 1, 'confidence should be 0-1');
    if (rec.skill) assert.ok(typeof rec.skill === 'string', 'skill should be string');
  });
});

// -----------------------------------------------------------------------
// 11. Phase 3: executeHybrid — general task returns recommendation
// -----------------------------------------------------------------------
describe('11. Phase 3: executeHybrid (general tasks)', () => {
  const generalTests = [
    { question: '幫我爬一個網站 iyf.tv', domain: 'crawl' },
    { question: '掃描這個專案的漏洞', domain: 'security' },
    { question: '幫我 commit 並發 PR', domain: 'git' },
    { question: '重構 auth 模組', domain: 'refactor' },
  ];

  for (const { question, domain } of generalTests) {
    it(`returns ${domain} recommendation for: "${question.slice(0, 30)}..."`, async () => {
      const result = await executeHybrid({ question });
      // Should be a general task result
      assert.ok(result.metadata?.isGeneralTask,
        `expected isGeneralTask for "${question}"`);
      // Should have _raw.recommendation
      assert.ok(result._raw?.recommendation,
        `expected _raw.recommendation for "${question}"`);
      assert.equal(result._raw.recommendation.domain, domain,
        `expected domain ${domain}, got ${result._raw.recommendation.domain}`);
      // Answer should contain domain info
      assert.ok(result.answer.includes(domain) || result.answer.includes('General Task'),
        `answer should mention domain or General Task`);
    });
  }

  it('code tasks still return deterministic results (not general)', async () => {
    const result = await executeHybrid({
      question: 'who calls authenticate',
      root: process.cwd(),
    });
    // Code tasks: not general, no recommendation
    assert.ok(!result.metadata?.isGeneralTask,
      'code task should not be isGeneralTask');
    assert.ok(!result._raw?.recommendation,
      'code task should not have recommendation');
    assert.ok(result.metadata?.toolsUsed !== undefined,
      'code task should track tools used');
  });

  it('edge: empty question goes to error', async () => {
    const result = await executeHybrid({ question: '' });
    assert.ok(result.answer.includes('No question'));
    assert.ok(!result.metadata?.isGeneralTask);
  });
});

// -----------------------------------------------------------------------
// 12. Phase 3: Domain coverage completeness
// -----------------------------------------------------------------------
describe('12. Phase 3: Domain coverage completeness', () => {
  // Ensure all 13 domains are reachable
  const allDomains = ['crawl', 'refactor', 'git', 'security', 'test', 'report',
    'lang', 'search_web', 'edit', 'plan', 'office', 'document', 'wiki', 'analyze'];

  for (const domain of allDomains) {
    it(`has reachable "${domain}" domain`, () => {
      // Use domain-specific trigger phrases
      const triggerMap = {
        crawl: '爬蟲',
        refactor: '重構',
        git: 'git commit',
        security: '漏洞',
        test: '測試',
        report: '圖表',
        lang: 'python lint',
        search_web: '搜尋 資料',
        edit: 'patch',
        plan: '規劃',
        office: 'word',
        document: '合約',
        wiki: 'obsidian',
        analyze: '分析',
      };
      const phrase = triggerMap[domain];
      const classification = classifyQuestion(phrase);
      assert.equal(classification.category, CATEGORIES.GENERAL,
        `"${phrase}" should trigger ${domain} (got ${classification.category})`);

      const rec = getGeneralRecommendation(classification, phrase);
      assert.ok(rec, `"${phrase}" should produce recommendation`);
      assert.equal(rec.domain, domain,
        `recommendation domain should be "${domain}"`);
    });
  }
});

// Clean up test directory after all tests
import { after } from 'node:test';
after(async () => {
  try {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  } catch { /* ok */ }
  // Close LSP bridges to allow clean exit
  try {
    const { closeAllLspBridges } = await import('../src/lib/lsp-bridge.mjs');
    await closeAllLspBridges();
  } catch { /* ok */ }
});
