// ── smart_decompose 整合測試 ──
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeHandler, resetSessionStore } from '../src/cli/decompose.mjs';

// ── Helper ──
function makeSubtask(id, desc, status, tool) {
  return { id, desc, status, ...(tool ? { tool } : {}) };
}

const defaultGoal = 'fix auth.ts null pointer bug';

beforeEach(() => {
  resetSessionStore();
});

describe('decomposeHandler — validation', () => {
  it('empty subtasks → error', () => {
    const r = decomposeHandler({
      goal: 'test',
      subtasks: [],
      currentSubtaskId: 1,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('at least 1 item'));
  });

  it('currentSubtaskId not in subtasks → error', () => {
    const r = decomposeHandler({
      goal: 'test',
      subtasks: [makeSubtask(1, 'step1', 'pending')],
      currentSubtaskId: 99,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('currentSubtaskId not found'));
  });

  it('goal is empty → error', () => {
    const r = decomposeHandler({
      goal: '',
      subtasks: [makeSubtask(1, 'step1', 'pending')],
      currentSubtaskId: 1,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('goal is required'));
  });

  it('11 subtasks → error (max 10)', () => {
    const subtasks = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      desc: `step${i + 1}`,
      status: 'pending',
    }));
    const r = decomposeHandler({
      goal: 'test',
      subtasks,
      currentSubtaskId: 1,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('max 10'));
  });

  it('invalid status → error', () => {
    const r = decomposeHandler({
      goal: 'test',
      subtasks: [{ id: 1, desc: 'step', status: 'invalid' }],
      currentSubtaskId: 1,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('invalid status'));
  });

  it('missing subtask desc → error', () => {
    const r = decomposeHandler({
      goal: 'test',
      subtasks: [{ id: 1, desc: '', status: 'pending' }],
      currentSubtaskId: 1,
      thought: 'thinking',
      nextNeeded: false,
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('needs a desc'));
  });
});

describe('decomposeHandler — progress', () => {
  it('goal + 1 subtask, nextNeeded=false → done', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'confirm bug location', 'done')],
      currentSubtaskId: 1,
      thought: 'found the bug',
      nextNeeded: false,
    });
    assert.equal(r.progress.done, true);
    assert.equal(r.progress.completed, 1);
    assert.equal(r.progress.total, 1);
    assert.ok(r.progress.bar.includes('✅'));
    assert.equal(r.intervention, null);
  });

  it('3 subtasks, step 1 done, step 2 in_progress', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [
        makeSubtask(1, 'locate', 'done'),
        makeSubtask(2, 'analyze', 'in_progress'),
        makeSubtask(3, 'fix', 'pending'),
      ],
      currentSubtaskId: 2,
      thought: 'analyzing root cause',
      nextNeeded: true,
    });
    assert.equal(r.progress.done, false);
    assert.equal(r.progress.completed, 1);
    assert.equal(r.progress.total, 3);
    assert.ok(r.progress.bar.includes('1/3'));
  });

  it('10 subtasks (上限測試) → 正常運作', () => {
    const subtasks = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      desc: `step${i + 1}`,
      status: i === 0 ? 'in_progress' : 'pending',
    }));
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks,
      currentSubtaskId: 1,
      thought: 'starting',
      nextNeeded: true,
    });
    assert.equal(r.progress.total, 10);
    assert.equal(r.error, undefined);
  });
});

describe('decomposeHandler — tool suggestion', () => {
  it('strictness:high + subtask 無 tool → warning', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'find bug', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'looking',
      nextNeeded: true,
      strictness: 'high',
    });
    assert.equal(r.toolSuggestion.level, 'warning');
    assert.ok(r.toolSuggestion.reasoning.includes('未指定 tool'));
  });

  it('strictness:low + subtask 無 tool → null', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'find bug', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'looking',
      nextNeeded: true,
      strictness: 'low',
    });
    assert.equal(r.toolSuggestion, null);
  });

  it('strictness:medium + subtask 無 tool → null (medium 不強制)', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'fixing',
      nextNeeded: true,
      strictness: 'medium',
    });
    assert.equal(r.toolSuggestion, null);
  });

  it('subtask 有 tool → info with suggested tool', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'search code', 'in_progress', 'smart_grep')],
      currentSubtaskId: 1,
      thought: 'searching',
      nextNeeded: true,
      strictness: 'high',
    });
    assert.equal(r.toolSuggestion.level, 'info');
    assert.equal(r.toolSuggestion.suggestedTool, 'smart_grep');
  });
});

describe('decomposeHandler — cycle detection', () => {
  it('同一 subtask 重複 3 次（相似 thought）→ intervention', () => {
    const base = {
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'analyze bug', 'in_progress')],
      currentSubtaskId: 1,
      strictness: 'high', // threshold=2
    };

    // 第 1 次：正常
    decomposeHandler({ ...base, thought: 'looking at the null pointer', nextNeeded: true });
    // 第 2 次：threshold=2（high），觸發檢測，但第1次和第2次不同 → 不會 cycle
    // 讓我們用相似的思想來觸發
    const r2 = decomposeHandler({ ...base, thought: 'looking at the null pointer issue', nextNeeded: true });
    // threshold=2, 2次都相似 → cycle
    assert.equal(r2.intervention?.type, 'cycle');
  });
});

describe('decomposeHandler — output format', () => {
  it('輸出含 box-drawing 格式', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'fixing the bug',
      nextNeeded: true,
    });
    assert.ok(r.thought.includes('┌─ smart_decompose'));
    assert.ok(r.thought.includes('🎯'));
    assert.ok(r.thought.includes('nextNeeded: true'));
  });

  it('nextNeeded:false → completion marker', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'done')],
      currentSubtaskId: 1,
      thought: 'fixed!',
      nextNeeded: false,
    });
    assert.ok(r.thought.includes('nextNeeded: false'));
  });

  it('returns structured fields', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'working',
      nextNeeded: true,
    });
    assert.ok('thought' in r);
    assert.ok('progress' in r);
    assert.ok('toolSuggestion' in r);
    assert.ok('intervention' in r);
    assert.ok('budget' in r);
  });
});

describe('decomposeHandler — thinkingStyle', () => {
  it('disciplined style output is indented', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: '[FACT] found the bug at line 142\n[REASON] missing null check\n[CONCLUSION] add guard',
      nextNeeded: true,
      thinkingStyle: 'disciplined',
    });
    // Thought should be indented with │ │ prefix
    assert.ok(r.thought.includes('│ │ [FACT]'));
    assert.ok(r.thought.includes('│ │ [REASON]'));
    assert.ok(r.thought.includes('│ │ [CONCLUSION]'));
  });
});

describe('decomposeHandler — budget injection', () => {
  it('budget=null when no budget fn injected', () => {
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'working',
      nextNeeded: true,
    });
    // No _getBudgetFn injected → budget=null
    assert.equal(r.budget, null);
  });

  it('mock budget < 40% → warn', () => {
    const mockBudget = { remainingFraction: 0.35 };
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'working',
      nextNeeded: true,
      strictness: 'high',
      _getBudgetFn: () => mockBudget,
    });
    assert.equal(r.budget.level, 'warn');
    assert.ok(r.budget.message.includes('35%'));
  });

  it('mock budget < 20% → critical', () => {
    const mockBudget = { remainingFraction: 0.15 };
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'working',
      nextNeeded: true,
      strictness: 'high',
      _getBudgetFn: () => mockBudget,
    });
    assert.equal(r.budget.level, 'critical');
  });

  it('mock budget > 40% → ok', () => {
    const mockBudget = { remainingFraction: 0.65 };
    const r = decomposeHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'working',
      nextNeeded: true,
      strictness: 'high',
      _getBudgetFn: () => mockBudget,
    });
    assert.equal(r.budget.level, 'ok');
  });
});
