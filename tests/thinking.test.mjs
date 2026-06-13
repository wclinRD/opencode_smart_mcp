// thinking.test.mjs — Phase 0 tests for thinking.mjs
//
// Tests the 4 exported functions:
//   quickThought / quickThink  — conversational reasoning
//   deepAnalyze                — structured template analysis
//   startDynamicSession        — multi-step stateful sessions
//   execStateCommand           — state management (record/advance/branch/finish)
//
// Run: node --test tests/thinking.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Import the module under test
import {
  quickThought,
  quickThink,
  deepAnalyze,
  startDynamicSession,
  execStateCommand,
} from '../src/cli/thinking.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_STATE_DIR = resolve(tmpdir(), 'smart-test-' + Date.now());

function testStatePath(name = 'test-state.json') {
  if (!existsSync(TEST_STATE_DIR)) {
    mkdirSync(TEST_STATE_DIR, { recursive: true });
  }
  return resolve(TEST_STATE_DIR, name);
}

function cleanupState(path) {
  try { unlinkSync(path); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests: quickThought / quickThink
// ---------------------------------------------------------------------------

describe('quickThought / quickThink', () => {

  it('returns done when nextThoughtNeeded=false', () => {
    const result = quickThought({
      thought: 'This is my reasoning step.',
      nextThoughtNeeded: false,
      thoughtNumber: 1,
      totalThoughts: 1,
    });
    assert.ok(result.done);
    assert.equal(typeof result.output, 'string');
    assert.ok(result.output.includes('This is my reasoning step.'));
    assert.ok(result.output.includes('1/1'));
  });

  it('returns not done when nextThoughtNeeded=true', () => {
    const result = quickThought({
      thought: 'Still analyzing...',
      nextThoughtNeeded: true,
      thoughtNumber: 1,
      totalThoughts: 3,
    });
    assert.equal(result.done, false);
    assert.ok(result.output.includes('Still analyzing...'));
  });

  it('includes revision marker when isRevision=true', () => {
    const result = quickThought({
      thought: 'Revised analysis',
      nextThoughtNeeded: false,
      thoughtNumber: 2,
      totalThoughts: 3,
      isRevision: true,
      revisesThought: 1,
    });
    assert.ok(result.output.includes('Revising'));
    assert.ok(result.output.includes('Revision of thought 1'));
  });

  it('includes branch marker when branchFromThought set', () => {
    const result = quickThought({
      thought: 'Branch exploration',
      nextThoughtNeeded: true,
      thoughtNumber: 3,
      totalThoughts: 5,
      branchFromThought: 2,
      branchId: 'alt-approach',
    });
    assert.ok(result.output.includes('Branch from thought 2'));
    assert.ok(result.output.includes('alt-approach'));
  });

  it('includes hypothesis section when hypothesis provided', () => {
    const result = quickThought({
      thought: 'Testing hypothesis',
      nextThoughtNeeded: false,
      thoughtNumber: 1,
      totalThoughts: 1,
      hypothesis: 'The bug is in the parser',
    });
    assert.ok(result.output.includes('Hypothesis'));
    assert.ok(result.output.includes('The bug is in the parser'));
  });

  it('includes verification section with auto-verdict', () => {
    const result = quickThought({
      thought: 'Verifying',
      nextThoughtNeeded: false,
      thoughtNumber: 2,
      totalThoughts: 3,
      verification: 'Confirmed: root cause is null pointer',
    });
    assert.ok(result.output.includes('Verification'));
  });

  it('includes template guidance when template provided', () => {
    const result = quickThought({
      thought: 'Debug step',
      nextThoughtNeeded: true,
      thoughtNumber: 1,
      totalThoughts: 5,
      template: 'debug',
    });
    assert.ok(result.output.includes('Debug Analysis guidance'));
    assert.ok(result.output.includes('Step 1: Error Classification'));
  });

  it('supports adjustTotalThoughts', () => {
    const result = quickThought({
      thought: 'Need more steps',
      nextThoughtNeeded: true,
      thoughtNumber: 3,
      totalThoughts: 3,
      adjustTotalThoughts: 6,
    });
    assert.ok(result.output.includes('was 3, now 6'));
    assert.equal(result.totalThoughts, 6);
  });

  it('supports needsMoreThoughts', () => {
    const result = quickThought({
      thought: 'Not enough info',
      nextThoughtNeeded: false,
      thoughtNumber: 3,
      totalThoughts: 3,
      needsMoreThoughts: true,
    });
    assert.ok(result.output.includes('More reasoning needed'));
  });

  it('quickThink is alias for quickThought', () => {
    const a = quickThought({ thought: 'test', nextThoughtNeeded: false });
    const b = quickThink({ thought: 'test', nextThoughtNeeded: false });
    assert.equal(a.output, b.output);
    assert.equal(a.done, b.done);
  });

  it('handles empty thought gracefully', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: false,
    });
    assert.ok(result.done);
    assert.equal(typeof result.output, 'string');
  });

  // ── Beam Search mode tests ──

  it('beam mode shows all paths with confidence scores', () => {
    const result = quickThought({
      thought: 'Beam reasoning summary',
      nextThoughtNeeded: false,
      mode: 'beam',
      beams: [
        { name: 'Path A', content: 'Memory issue analysis...', confidence: 7 },
        { name: 'Path B', content: 'Race condition analysis...', confidence: 3 },
        { name: 'Path C', content: 'Null pointer analysis...', confidence: 8 },
      ],
      selectedBeam: 'Path C',
    });
    assert.ok(result.output.includes('Beam Search'));
    assert.ok(result.output.includes('Path A'));
    assert.ok(result.output.includes('Path B'));
    assert.ok(result.output.includes('Path C'));
    assert.ok(result.output.includes('confidence: 7/10'));
    assert.ok(result.output.includes('confidence: 8/10'));
    assert.ok(result.output.includes('[Selected: Path C]'));
    assert.ok(result.output.includes('Null pointer analysis...'));
    assert.ok(result.output.includes('Beam Summary'));
    assert.ok(result.output.includes('Best: Path C'));
  });

  it('beam mode fallback when beams not provided', () => {
    const result = quickThought({
      thought: 'Multi-path analysis...',
      nextThoughtNeeded: false,
      mode: 'beam',
    });
    assert.ok(result.output.includes('Beam Search'));
    assert.ok(result.output.includes('Multiple reasoning paths'));
    assert.ok(result.output.includes('Multi-path analysis...'));
  });

  it('beam mode with single beam selects it automatically', () => {
    const result = quickThought({
      thought: 'Single path analysis',
      nextThoughtNeeded: false,
      mode: 'beam',
      beams: [
        { name: 'Path A', content: 'The only path', confidence: 9 },
      ],
      selectedBeam: 'Path A',
    });
    assert.ok(result.output.includes('The only path'));
    assert.ok(result.output.includes('Best: Path A'));
  });

  it('beam mode with equal confidence still selects best', () => {
    const result = quickThought({
      thought: 'Equal confidence test',
      nextThoughtNeeded: false,
      mode: 'beam',
      beams: [
        { name: 'Approach 1', content: 'First approach', confidence: 6 },
        { name: 'Approach 2', content: 'Second approach', confidence: 6 },
        { name: 'Approach 3', content: 'Third approach', confidence: 7 },
      ],
      selectedBeam: 'Approach 3',
    });
    assert.ok(result.output.includes('Best: Approach 3'));
    assert.ok(result.output.includes('confidence: 7/10'));
  });

  // ── CiT mode tests ──

  it('cit mode chain (branchingNeeded=false) shows BN-DP assessment + chain label', () => {
    const result = quickThought({
      thought: 'Root cause already clear from stack trace — no need to branch.',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: false,
      branchReasoning: 'Error trace points to unique location, single path sufficient',
    });
    assert.ok(result.output.includes('CiT BN-DP'));
    assert.ok(result.output.includes('Branch: NO'));
    assert.ok(result.output.includes('chain'));
    assert.ok(result.output.includes('single path sufficient'));
    assert.ok(result.output.includes('[Chain]'));
    assert.ok(result.output.includes('Root cause already clear'));
    // Should NOT show beam/branch markers
    assert.equal(result.output.includes('Branching ('), false);
    assert.equal(result.output.includes('Beam Search'), false);
  });

  it('cit mode branch (branchingNeeded=true) shows BN-DP + branching paths', () => {
    const result = quickThought({
      thought: 'Need to explore multiple hypotheses.',
      nextThoughtNeeded: false,
      mode: 'cit',
      branchingNeeded: true,
      branchReasoning: 'Multiple possible root causes — null pointer, race condition, or config issue',
      beams: [
        { name: 'Null pointer', content: 'Null check missing in parser...', confidence: 8 },
        { name: 'Race condition', content: 'Concurrent access to shared state...', confidence: 5 },
      ],
      selectedBeam: 'Null pointer',
    });
    assert.ok(result.output.includes('CiT BN-DP'));
    assert.ok(result.output.includes('Branch: YES'));
    assert.ok(result.output.includes('Multiple possible root causes'));
    assert.ok(result.output.includes('Branching (2 paths)'));
    assert.ok(result.output.includes('Null pointer'));
    assert.ok(result.output.includes('Race condition'));
    assert.ok(result.output.includes('[Selected: Null pointer]'));
    assert.ok(result.output.includes('Null check missing in parser...'));
    assert.ok(result.output.includes('Branch Summary'));
    assert.ok(result.output.includes('Best: Null pointer (8/10)'));
  });

  it('cit mode chain with no branchingNeeded defaults to chain view', () => {
    const result = quickThought({
      thought: 'Single path analysis continues...',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: false,
    });
    assert.ok(result.output.includes('CiT BN-DP'));
    assert.ok(result.output.includes('Branch: NO'));
    assert.ok(result.output.includes('[Chain]'));
  });

  it('cit mode with branching but no beams falls back to thought', () => {
    const result = quickThought({
      thought: 'Branching analysis without structured beams...',
      nextThoughtNeeded: false,
      mode: 'cit',
      branchingNeeded: true,
      branchReasoning: 'Testing fallback',
    });
    assert.ok(result.output.includes('CiT BN-DP'));
    assert.ok(result.output.includes('Branch: YES'));
    assert.ok(result.output.includes('Testing fallback'));
    // Should still show the thought content
    assert.ok(result.output.includes('Branching analysis without structured beams...'));
  });

  it('beam mode still works unchanged after cit additions', () => {
    const result = quickThought({
      thought: 'Classic beam search',
      nextThoughtNeeded: false,
      mode: 'beam',
      beams: [
        { name: 'Path X', content: 'Path X content', confidence: 9 },
      ],
      selectedBeam: 'Path X',
    });
    assert.ok(result.output.includes('Beam Search'));
    assert.ok(result.output.includes('Path X'));
    assert.equal(result.output.includes('CiT BN-DP'), false);
  });

  // ── Forest-of-Thought mode tests ──

  it('forest mode shows multiple trees with branches and consensus', () => {
    const result = quickThought({
      thought: 'Forest summary',
      nextThoughtNeeded: false,
      mode: 'forest',
      trees: [
        {
          name: 'Static Analysis',
          branches: [
            { name: 'Null pointer', content: 'Null check missing...', confidence: 8 },
            { name: 'Memory leak', content: 'Alloc without free...', confidence: 4 },
          ],
          selectedBranch: 'Null pointer',
        },
        {
          name: 'Dynamic Analysis',
          branches: [
            { name: 'Race condition', content: 'Concurrent access...', confidence: 6 },
          ],
          selectedBranch: 'Race condition',
        },
      ],
      consensus: {
        conclusion: 'Null pointer in parser is root cause',
        agreeingTrees: ['Static Analysis', 'Dynamic Analysis'],
        totalTrees: 2,
        confidence: 8,
        primaryTree: 'Static Analysis',
      },
    });
    assert.ok(result.output.includes('Forest-of-Thought'));
    assert.ok(result.output.includes('2 trees'));
    assert.ok(result.output.includes('Static Analysis'));
    assert.ok(result.output.includes('Dynamic Analysis'));
    assert.ok(result.output.includes('Null pointer'));
    assert.ok(result.output.includes('Race condition'));
    assert.ok(result.output.includes('Forest Consensus'));
    assert.ok(result.output.includes('Null pointer in parser'));
    assert.ok(result.output.includes('2/2 trees'));
    assert.ok(result.output.includes('8/10'));
  });

  it('forest mode fallback when no trees provided', () => {
    const result = quickThought({
      thought: 'Raw forest reasoning...',
      nextThoughtNeeded: false,
      mode: 'forest',
    });
    assert.ok(result.output.includes('Forest-of-Thought'));
    assert.ok(result.output.includes('Multiple reasoning trees'));
    assert.ok(result.output.includes('Raw forest reasoning...'));
  });

  it('forest mode single tree with multiple branches', () => {
    const result = quickThought({
      thought: 'Single tree forest',
      nextThoughtNeeded: true,
      mode: 'forest',
      trees: [
        {
          name: 'Root Cause Analysis',
          branches: [
            { name: 'Config issue', content: 'Wrong env variable...', confidence: 7 },
            { name: 'Network timeout', content: 'DNS resolution fails...', confidence: 5 },
            { name: 'Auth error', content: 'Token expired...', confidence: 3 },
          ],
          selectedBranch: 'Config issue',
        },
      ],
      consensus: {
        conclusion: 'Config issue is most likely',
        agreeingTrees: ['Root Cause Analysis'],
        totalTrees: 1,
        confidence: 7,
      },
    });
    assert.ok(result.output.includes('Forest-of-Thought'));
    assert.ok(result.output.includes('1 trees, 3 branches'));
    assert.ok(result.output.includes('Config issue'));
    assert.ok(result.output.includes('Network timeout'));
    assert.ok(result.output.includes('Auth error'));
    assert.ok(result.output.includes('Forest Consensus'));
    assert.ok(result.output.includes('1/1 trees'));
  });

  it('forest mode with large tree count formatting', () => {
    const result = quickThought({
      thought: 'Multi-tree analysis',
      nextThoughtNeeded: false,
      mode: 'forest',
      trees: [
        { name: 'Tree 1: Logs', branches: [{ name: 'Error A', content: '...', confidence: 6 }], selectedBranch: 'Error A' },
        { name: 'Tree 2: Metrics', branches: [{ name: 'Spike B', content: '...', confidence: 8 }], selectedBranch: 'Spike B' },
        { name: 'Tree 3: Code', branches: [{ name: 'Bug C', content: '...', confidence: 7 }], selectedBranch: 'Bug C' },
      ],
      consensus: {
        conclusion: 'Bug C with supporting evidence from Metrics',
        agreeingTrees: ['Tree 2: Metrics', 'Tree 3: Code'],
        totalTrees: 3,
        confidence: 9,
      },
    });
    assert.ok(result.output.includes('3 trees'));
    assert.ok(result.output.includes('2/3 trees'));
    assert.ok(result.output.includes('Bug C with supporting'));
  });

  // ── Structured Thinking mode tests (Phase 16) ──

  it('structured mode shows all 5 sections (GOAL/STATE/ALGO/EDGE/VERIFY)', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: false,
      mode: 'structured',
      goal: '找出 login API 的 null pointer 錯誤',
      state: '錯誤發生在 auth.ts:142，stack trace 指向 parseToken()',
      algo: '1. 檢查 parseToken() 的 null check\n2. 追蹤呼叫鏈\n3. 確認修復方案',
      edge: '不影響其他 API endpoint，只改 auth.ts',
      verify: '修復後跑 smart_test 確認 login flow 正常',
    });
    assert.ok(result.output.includes('Structured Thinking'));
    assert.ok(result.output.includes('GOAL:'));
    assert.ok(result.output.includes('找出 login API 的 null pointer 錯誤'));
    assert.ok(result.output.includes('STATE:'));
    assert.ok(result.output.includes('auth.ts:142'));
    assert.ok(result.output.includes('ALGO:'));
    assert.ok(result.output.includes('parseToken()'));
    assert.ok(result.output.includes('EDGE:'));
    assert.ok(result.output.includes('不影響其他 API endpoint'));
    assert.ok(result.output.includes('VERIFY:'));
    assert.ok(result.output.includes('smart_test'));
  });

  it('structured mode with partial fields works correctly', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '簡單任務',
      state: '已知資訊',
      // algo, edge, verify omitted
    });
    assert.ok(result.output.includes('Structured Thinking'));
    assert.ok(result.output.includes('GOAL:'));
    assert.ok(result.output.includes('STATE:'));
    // Should NOT show empty sections
    assert.equal(result.output.includes('ALGO:'), false);
    assert.equal(result.output.includes('EDGE:'), false);
    assert.equal(result.output.includes('VERIFY:'), false);
  });

  it('structured mode with supplementary thought appends free-form', () => {
    const result = quickThought({
      thought: '補充說明：這個問題也可能跟 race condition 有關',
      nextThoughtNeeded: false,
      mode: 'structured',
      goal: 'Debug null pointer',
      state: 'auth.ts:142',
    });
    assert.ok(result.output.includes('Structured Thinking'));
    assert.ok(result.output.includes('[Supplementary]'));
    assert.ok(result.output.includes('race condition'));
  });

  it('structured mode fallback when no structured fields provided', () => {
    const result = quickThought({
      thought: 'Free-form fallback thinking...',
      nextThoughtNeeded: false,
      mode: 'structured',
      // No goal/state/algo/edge/verify
    });
    assert.ok(result.output.includes('Structured Thinking (free-form fallback)'));
    assert.ok(result.output.includes('Free-form fallback thinking...'));
  });

  it('structured mode output is more compact than equivalent free-form', () => {
    // Simulate a realistic verbose free-form thought (LLM-style with scaffolding)
    const freeFormThought = [
      'Let me think about this carefully.',
      '',
      'First, I need to understand what the error is. The error appears to be a null pointer exception. Let me trace through the code to understand where it occurs.',
      '',
      'Looking at the stack trace, the error occurs in the auth.ts file at line 142. The function that seems to be causing the issue is parseToken(). This is likely because the token being passed to parseToken() is null or undefined.',
      '',
      'I should check if there is a null check before the parseToken() call. If there is no null check, that would explain why we are getting a null pointer exception.',
      '',
      'The fix should be straightforward: add a null check before calling parseToken(). This should be isolated to the auth.ts file and should not affect other API endpoints since parseToken() is only called from within auth.ts.',
      '',
      'After implementing the fix, I will need to verify it works. I should run the test suite, particularly the login flow tests, to make sure everything still works correctly.',
      '',
      'In conclusion, the root cause is a missing null check in parseToken() at auth.ts:142. The fix is to add a null check. The impact is limited to auth.ts. Verification will be done via smart_test.',
    ].join('\n');
    const freeFormResult = quickThought({
      thought: freeFormThought,
      nextThoughtNeeded: false,
    });
    const structuredResult = quickThought({
      thought: '',
      nextThoughtNeeded: false,
      mode: 'structured',
      goal: 'Fix null pointer in auth.ts:142 parseToken()',
      state: 'Stack trace points to parseToken(), null check missing',
      algo: 'Add null check in parseToken()',
      edge: 'Isolated to auth.ts, no other endpoints affected',
      verify: 'Run smart_test on login flow',
    });
    // Structured output should be significantly shorter
    assert.ok(structuredResult.output.length < freeFormResult.output.length,
      `Structured (${structuredResult.output.length} chars) should be shorter than free-form (${freeFormResult.output.length} chars)`);
    // Should save at least 50%
    const savings = (1 - structuredResult.output.length / freeFormResult.output.length) * 100;
    assert.ok(savings >= 50, `Expected >=50% savings, got ${savings.toFixed(1)}%`);
  });

  it('structured mode with template guidance still works', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: 'Debug the crash',
      state: 'Crash in production',
      template: 'debug',
    });
    assert.ok(result.output.includes('Structured Thinking'));
    assert.ok(result.output.includes('Debug Analysis guidance'));
  });

  it('structured mode with nextThoughtNeeded=true shows continue indicator', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: 'Ongoing analysis',
    });
    assert.ok(result.output.includes('Continue reasoning'));
  });

  it('structured mode with nextThoughtNeeded=false shows complete indicator', () => {
    const result = quickThought({
      thought: '',
      nextThoughtNeeded: false,
      mode: 'structured',
      goal: 'Final analysis',
    });
    assert.ok(result.output.includes('Reasoning complete'));
  });
});

// ---------------------------------------------------------------------------
// Tests: deepAnalyze
// ---------------------------------------------------------------------------

describe('deepAnalyze', () => {

  it('returns error when no topic and no plan', () => {
    const result = deepAnalyze({ template: 'analyze', steps: 3 });
    assert.equal(result.type, 'error');
  });

  it('returns text format by default', () => {
    const result = deepAnalyze({
      topic: 'Why is the API slow?',
      template: 'debug',
      steps: 3,
    });
    assert.equal(result.type, 'static');
    assert.ok(result.output.includes('Debug Analysis'));
    assert.ok(result.output.includes('Why is the API slow?'));
    assert.ok(result.output.includes('Step 1/3'));
  });

  it('returns markdown format', () => {
    const result = deepAnalyze({
      topic: 'Test topic',
      template: 'analyze',
      steps: 2,
      format: 'markdown',
    });
    assert.ok(result.output.includes('# General Analysis'));
    assert.ok(result.output.includes('## Step'));
  });

  it('returns JSON format', () => {
    const result = deepAnalyze({
      topic: 'JSON test',
      template: 'decision',
      steps: 2,
      format: 'json',
    });
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.template, 'Decision Analysis');
    assert.equal(parsed.topic, 'JSON test');
    assert.ok(Array.isArray(parsed.steps));
  });

  it('supports all 9 templates', () => {
    const templates = ['debug', 'refactor', 'feature', 'research', 'decision',
      'analyze', 'plan_execute', 'retrospect', 'architecture'];
    for (const t of templates) {
      const result = deepAnalyze({ topic: `Testing ${t}`, template: t, steps: 2 });
      assert.equal(result.type, 'static', `Template ${t} should produce static output`);
      assert.ok(result.output.length > 0, `Template ${t} should produce non-empty output`);
    }
  });

  it('returns error for unknown template', () => {
    const result = deepAnalyze({
      topic: 'test',
      template: 'nonexistent',
    });
    assert.equal(result.type, 'error');
  });
});

// ---------------------------------------------------------------------------
// Tests: startDynamicSession + execStateCommand
// ---------------------------------------------------------------------------

describe('startDynamicSession and execStateCommand', () => {
  const statePaths = [];

  after(() => {
    for (const p of statePaths) cleanupState(p);
  });

  it('starts a dynamic session with default state path', () => {
    const sp = testStatePath('session-1.json');
    statePaths.push(sp);
    const result = startDynamicSession({
      topic: 'Should we use SQL or NoSQL?',
      template: 'decision',
      state: sp,
    });
    assert.ok(result.output);
    assert.ok(result.state);
    assert.equal(result.state.topic, 'Should we use SQL or NoSQL?');
    assert.equal(result.state.template, 'decision');
    assert.equal(result.state.currentStepIndex, 0);
    assert.ok(result.state.steps.length > 0);
    assert.ok(existsSync(sp));
  });

  it('--status returns current state info', () => {
    const sp = testStatePath('session-status.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const result = execStateCommand(sp, { type: 'status' });
    assert.ok(result.output);
    assert.ok(result.state);
    assert.equal(result.state.template, 'analyze');
  });

  it('--record stores result and advances', () => {
    const sp = testStatePath('session-record.json');
    statePaths.push(sp);
    const session = startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const step0 = session.state.steps[0];
    const recordResult = execStateCommand(sp, {
      type: 'record',
      index: 0,
      result: 'The context is about performance optimization',
      advance: true,
    });
    assert.ok(recordResult.output);
    assert.ok(!recordResult.error);

    // Verify state file updated
    const statusResult = execStateCommand(sp, { type: 'status' });
    assert.ok(statusResult.state.steps[0].completed);
    assert.equal(statusResult.state.steps[0].result, 'The context is about performance optimization');
  });

  it('--branch selects a branch path', () => {
    const sp = testStatePath('session-branch.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const branchResult = execStateCommand(sp, {
      type: 'branch',
      branchName: 'hypothesis-confirmed',
    });
    assert.ok(branchResult.output);
    assert.ok(!branchResult.error);
  });

  it('--cancel cancels session', () => {
    const sp = testStatePath('session-cancel.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const cancelResult = execStateCommand(sp, { type: 'cancel' });
    assert.ok(cancelResult.output.includes('cancelled'));
    assert.ok(cancelResult.state.cancelled);
  });

  it('--finish marks session complete with summary', () => {
    const sp = testStatePath('session-finish.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    // Record all steps first
    const stateData = JSON.parse(readFileSync(sp, 'utf8'));
    for (let i = 0; i < stateData.steps.length; i++) {
      execStateCommand(sp, { type: 'record', index: i, result: `Result ${i + 1}`, advance: true });
    }

    const finishResult = execStateCommand(sp, { type: 'finish' });
    assert.ok(finishResult.output);
    assert.ok(finishResult.state.completed);
    assert.ok(finishResult.output.includes('Complete'));
  });

  it('returns error for invalid step index in record', () => {
    const sp = testStatePath('session-invalid.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const result = execStateCommand(sp, { type: 'record', index: 999, result: 'x' });
    assert.ok(result.error);
  });

  it('returns error for unknown command type', () => {
    const sp = testStatePath('session-unknown-cmd.json');
    statePaths.push(sp);
    startDynamicSession({ topic: 'test', template: 'analyze', state: sp });

    const result = execStateCommand(sp, { type: 'nonexistent' });
    assert.ok(result.error);
  });
});

// ---------------------------------------------------------------------------
// Tests: deepAnalyze with plan integration
// ---------------------------------------------------------------------------

describe('deepAnalyze with plan', () => {

  it('integrates plan context into steps', () => {
    const plan = {
      goal: 'Fix login bug',
      steps: [
        { id: 1, description: 'Reproduce the bug', tool: 'smart_test' },
        { id: 2, description: 'Find root cause', tool: 'smart_debug' },
        { id: 3, description: 'Apply fix', tool: 'cross_file_edit' },
      ],
    };
    const result = deepAnalyze({
      plan,
      template: 'plan_execute',
      steps: 3,
    });
    assert.ok(result.output);
    assert.ok(result.output.includes('Plan Context'));
    assert.ok(result.output.includes('Reproduce the bug'));
  });

  it('focuses on specific plan step when planStep provided', () => {
    const plan = {
      goal: 'Refactor parser',
      steps: [
        { id: 1, description: 'Analyze current code', tool: 'smart_grep' },
        { id: 2, description: 'Design new structure', tool: 'smart_think' },
      ],
    };
    const result = deepAnalyze({
      plan,
      template: 'refactor',
      steps: 3,
      planStep: 2,
    });
    assert.ok(result.output);
    assert.ok(result.output.includes('Plan Context'));
    // Should reference step 2
    assert.ok(result.output.includes('Design new structure'));
  });
});
