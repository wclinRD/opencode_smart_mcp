// ── smart_decompose_think 整合測試 ──
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeThinkHandler } from '../src/cli/decompose-think.mjs';

import {
  parseThought,
  suggestToolByTask,
  checkConfidence,
  checkSkippedTool,
  getTemplatePrompt,
  sanitizeP2Args,
} from '../src/lib/decompose-think-analysis.mjs';

import {
  trackToolCalls,
  buildToolResultContext,
  activeToolSuggest,
  detectCycleP2,
  resetSessionStoreP2,
} from '../src/lib/decompose-think-tracking.mjs';

// ── Helpers ──
function makeSubtask(id, desc, status, tool) {
  return { id, desc, status, ...(tool ? { tool } : {}) };
}

const defaultGoal = 'fix auth.ts null pointer bug';

beforeEach(() => {
  resetSessionStoreP2();
});

// ═══════════════════════════════════════════
// A1: parseThought
// ═══════════════════════════════════════════

describe('parseThought', () => {
  it('null/undefined → default safe values', () => {
    const r = parseThought(null);
    assert.equal(r.hasUncertainty, false);
    assert.equal(r.hasHighConfidence, false);
    assert.deepEqual(r.mentionedTools, []);
  });

  it('detects uncertainty patterns', () => {
    const r = parseThought('maybe the bug is in auth.ts');
    assert.equal(r.hasUncertainty, true);
  });

  it('detects confidence patterns', () => {
    const r = parseThought('definitely a null pointer at line 142');
    assert.equal(r.hasHighConfidence, true);
  });

  it('detects tool mentions', () => {
    const r = parseThought('should use smart_grep to find it');
    assert.ok(r.mentionedTools.includes('smart_grep'));
  });

  it('detects XML tool calls', () => {
    const r = parseThought('<tool_call><function=smart_grep></tool_call>');
    assert.equal(r.xmlToolCalls.length, 1);
  });

  it('detects FR-CoT brief reasoning', () => {
    const r = parseThought('Function: smart_grep / Key args: pattern="X"');
    assert.equal(r.reasoningBudget, 'brief');
  });

  it('detects deep reasoning (300+ words)', () => {
    const longText = Array(350).fill('word').join(' ');
    const r = parseThought(longText);
    assert.equal(r.reasoningBudget, 'deep');
  });
});

// ═══════════════════════════════════════════
// A2: suggestToolByTask
// ═══════════════════════════════════════════

describe('suggestToolByTask', () => {
  it('debug: find bug → smart_grep', () => {
    const r = suggestToolByTask('find the bug', 'debug');
    assert.equal(r.tool, 'smart_grep');
  });

  it('debug: fix error → smart_fast_apply', () => {
    const r = suggestToolByTask('fix the error', 'debug');
    assert.equal(r.tool, 'smart_fast_apply');
  });

  it('debug: root cause → smart_lsp', () => {
    const r = suggestToolByTask('what is the root cause', 'debug');
    assert.equal(r.tool, 'smart_lsp');
  });

  it('refactor: check import → import_graph', () => {
    const r = suggestToolByTask('check dependencies', 'refactor');
    assert.equal(r.tool, 'smart_run');
    assert.equal(r.args.tool, 'import_graph');
  });

  it('search: research topic → smart_exa_search', () => {
    const r = suggestToolByTask('research the API', 'search');
    assert.equal(r.tool, 'smart_exa_search');
  });

  it('no match → null', () => {
    const r = suggestToolByTask('write documentation', 'generic');
    assert.equal(r, null);
  });

  it('null desc → null', () => {
    assert.equal(suggestToolByTask(null, 'debug'), null);
  });
});

// ═══════════════════════════════════════════
// A3: checkConfidence
// ═══════════════════════════════════════════

describe('checkConfidence', () => {
  it('high confidence + no tools → overconfidence', () => {
    const parsed = { hasHighConfidence: true, hasUncertainty: false };
    const r = checkConfidence(parsed, [], 'high');
    assert.equal(r.type, 'overconfidence');
  });

  it('high confidence + has tools → null', () => {
    const parsed = { hasHighConfidence: true };
    const tools = [{ tool: 'smart_grep', status: 'done' }];
    assert.equal(checkConfidence(parsed, tools, 'high'), null);
  });

  it('strictness=low → null', () => {
    const parsed = { hasHighConfidence: true };
    assert.equal(checkConfidence(parsed, [], 'low'), null);
  });

  it('no high confidence → null', () => {
    const parsed = { hasHighConfidence: false };
    assert.equal(checkConfidence(parsed, [], 'high'), null);
  });
});

// ═══════════════════════════════════════════
// A4: checkSkippedTool
// ═══════════════════════════════════════════

describe('checkSkippedTool', () => {
  it('prev suggestion + not executed → skipped_tool', () => {
    const prevSugg = { suggestedTool: 'smart_grep', suggestedArgs: {} };
    const r = checkSkippedTool([], prevSugg);
    assert.equal(r.type, 'skipped_tool');
    assert.ok(r.message.includes('smart_grep'));
  });

  it('prev suggestion + executed → null', () => {
    const prevSugg = { suggestedTool: 'smart_grep', suggestedArgs: {} };
    const tools = [{ tool: 'smart_grep', status: 'done' }];
    assert.equal(checkSkippedTool(tools, prevSugg), null);
  });

  it('no prev suggestion → null', () => {
    assert.equal(checkSkippedTool([], null), null);
  });
});

// ═══════════════════════════════════════════
// A5: getTemplatePrompt
// ═══════════════════════════════════════════

describe('getTemplatePrompt', () => {
  it('debug template contains debug keywords', () => {
    const r = getTemplatePrompt('debug');
    assert.ok(r.includes('除錯任務'));
  });

  it('refactor template contains refactor keywords', () => {
    const r = getTemplatePrompt('refactor');
    assert.ok(r.includes('重構任務'));
  });

  it('search template contains search keywords', () => {
    const r = getTemplatePrompt('search');
    assert.ok(r.includes('搜尋任務'));
  });

  it('generic template is default', () => {
    const r = getTemplatePrompt('generic');
    assert.ok(r.includes('任務分解'));
  });

  it('unknown template falls back to generic', () => {
    const r = getTemplatePrompt('nonexistent');
    assert.ok(r.includes('任務分解'));
  });
});

// ═══════════════════════════════════════════
// A6: sanitizeP2Args
// ═══════════════════════════════════════════

describe('sanitizeP2Args', () => {
  it('null/undefined args → safe defaults', () => {
    const r = sanitizeP2Args(null);
    assert.deepEqual(r.toolCalls, []);
    assert.equal(r.roundType, 'think');
    assert.equal(r.template, 'generic');
  });

  it('first call when toolCalls empty → _isFirstCall=true', () => {
    const r = sanitizeP2Args({ goal: 'test', toolCalls: [] });
    assert.equal(r._isFirstCall, true);
  });

  it('existing toolCalls → not first call', () => {
    const r = sanitizeP2Args({ goal: 'test', toolCalls: [{ tool: 'grep', status: 'done' }] });
    assert.equal(r._isFirstCall, false);
  });

  it('roundType auto-correction: think with done tools → tool_result', () => {
    const r = sanitizeP2Args({
      roundType: 'think',
      toolCalls: [{ tool: 'grep', status: 'done' }],
    });
    assert.equal(r.roundType, 'tool_result');
  });

  it('roundType auto-correction: tool_result without done → think', () => {
    const r = sanitizeP2Args({
      roundType: 'tool_result',
      toolCalls: [{ tool: 'grep', status: 'pending' }],
    });
    assert.equal(r.roundType, 'think');
  });

  it('filters invalid toolCalls entries', () => {
    const r = sanitizeP2Args({ toolCalls: [null, { tool: 'grep', status: 'done' }, undefined] });
    assert.equal(r.toolCalls.length, 1);
  });
});

// ═══════════════════════════════════════════
// B1: trackToolCalls
// ═══════════════════════════════════════════

describe('trackToolCalls', () => {
  it('identifies new completed calls', () => {
    const prev = [{ tool: 'smart_grep', status: 'pending' }];
    const curr = [{ tool: 'smart_grep', status: 'done', result: 'found it' }];
    const r = trackToolCalls(curr, prev, null);
    assert.equal(r.newCalls.length, 1);
    assert.equal(r.completedCalls.length, 1);
  });

  it('no changes when same state', () => {
    const prev = [{ tool: 'smart_grep', status: 'done' }];
    const curr = [{ tool: 'smart_grep', status: 'done' }];
    const r = trackToolCalls(curr, prev, null);
    assert.equal(r.newCalls.length, 0);
  });

  it('empty arrays → empty results', () => {
    const r = trackToolCalls([], [], null);
    assert.equal(r.newCalls.length, 0);
    assert.equal(r.completedCalls.length, 0);
  });
});

// ═══════════════════════════════════════════
// B2: buildToolResultContext
// ═══════════════════════════════════════════

describe('buildToolResultContext', () => {
  it('returns formatted context for last done tool', () => {
    const tools = [
      { tool: 'smart_grep', status: 'done', result: 'found at line 142' },
    ];
    const r = buildToolResultContext(tools);
    assert.ok(r.includes('smart_grep'));
    assert.ok(r.includes('found at line 142'));
  });

  it('returns null when no done tools', () => {
    const tools = [{ tool: 'smart_grep', status: 'pending' }];
    assert.equal(buildToolResultContext(tools), null);
  });

  it('returns null for empty array', () => {
    assert.equal(buildToolResultContext([]), null);
  });
});

// ═══════════════════════════════════════════
// B3: activeToolSuggest
// ═══════════════════════════════════════════

describe('activeToolSuggest', () => {
  it('priority 1: skipped_tool → returns skipped tool', () => {
    const r = activeToolSuggest({
      parsed: { hasUncertainty: false, hasHighConfidence: false },
      currentSubtask: { id: 1, desc: 'test' },
      toolCalls: [],
      prevSuggestion: { suggestedTool: 'smart_grep', suggestedArgs: {} },
    });
    assert.equal(r.trigger, 'skipped_tool');
  });

  it('priority 2: overconfidence → smart_grep', () => {
    const r = activeToolSuggest({
      parsed: { hasHighConfidence: true, hasUncertainty: false },
      currentSubtask: { id: 1, desc: 'test' },
      toolCalls: [],
      strictness: 'high',
    });
    assert.equal(r.trigger, 'overconfidence');
  });

  it('priority 3: uncertainty → smart_grep', () => {
    const r = activeToolSuggest({
      parsed: { hasUncertainty: true, hasHighConfidence: false },
      currentSubtask: { id: 1, desc: 'test' },
      toolCalls: [],
    });
    assert.equal(r.trigger, 'uncertainty');
  });

  it('priority 4: task_affinity → matched tool', () => {
    const r = activeToolSuggest({
      parsed: { hasUncertainty: false, hasHighConfidence: false },
      currentSubtask: { id: 1, desc: 'find the bug' },
      toolCalls: [],
      template: 'debug',
    });
    assert.equal(r.trigger, 'task_affinity');
    assert.equal(r.suggestedTool, 'smart_grep');
  });

  it('no match + strictness=low → null', () => {
    const r = activeToolSuggest({
      parsed: { hasUncertainty: false, hasHighConfidence: false },
      currentSubtask: { id: 1, desc: 'write docs' },
      toolCalls: [],
      strictness: 'low',
    });
    assert.equal(r, null);
  });

  it('null parsed → null', () => {
    assert.equal(activeToolSuggest({ parsed: null, currentSubtask: { id: 1 } }), null);
  });
});

// ═══════════════════════════════════════════
// B4: detectCycleP2
// ═══════════════════════════════════════════

describe('detectCycleP2', () => {
  it('no cycle on first call', () => {
    const r = detectCycleP2('test1', 1, 'looking at the bug', 'high');
    assert.equal(r, null);
  });

  it('detects cycle on repeated similar thoughts (high strictness=2)', () => {
    detectCycleP2('test2', 1, 'looking at the null pointer', 'high');
    const r = detectCycleP2('test2', 1, 'looking at the null pointer issue', 'high');
    assert.equal(r.type, 'cycle');
  });

  it('different session IDs are isolated', () => {
    detectCycleP2('sessA', 1, 'same thought', 'high');
    const r = detectCycleP2('sessB', 1, 'same thought', 'high');
    assert.equal(r, null); // different session
  });
});

// ═══════════════════════════════════════════
// 整合測試: decomposeThinkHandler
// ═══════════════════════════════════════════

describe('decomposeThinkHandler — validation', () => {
  it('empty subtasks → error', () => {
    const r = decomposeThinkHandler({
      goal: 'test', subtasks: [], currentSubtaskId: 1,
      thought: 'thinking', nextNeeded: false,
    });
    assert.ok(r.error);
  });

  it('empty goal → error', () => {
    const r = decomposeThinkHandler({
      goal: '', subtasks: [makeSubtask(1, 'step', 'pending')],
      currentSubtaskId: 1, thought: 'thinking', nextNeeded: false,
    });
    assert.ok(r.error);
  });
});

describe('decomposeThinkHandler — basic output', () => {
  it('basic call returns formatted thought with header', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'locate bug', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'looking at null pointer',
      nextNeeded: true,
    });
    assert.ok(r.thought.includes('smart_decompose_think'));
    assert.ok(r.thought.includes('🎯'));
    assert.ok(r.thought.includes('nextNeeded: true'));
    assert.ok('progress' in r);
    assert.ok('toolSuggestion' in r);
    assert.ok('intervention' in r);
  });

  it('shows first-call marker', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'fixing',
      nextNeeded: true,
    });
    assert.ok(r.thought.includes('首次呼叫'));
  });

  it('template=debug shows debug prompt', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'fixing',
      nextNeeded: true,
      template: 'debug',
    });
    assert.ok(r.thought.includes('除錯任務'));
  });

  it('with existing toolCalls → no first-call marker', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'analyze', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'analyzing',
      nextNeeded: true,
      toolCalls: [{ tool: 'smart_grep', status: 'done', result: 'line 142' }],
    });
    assert.ok(!r.thought.includes('首次呼叫'));
  });

  it('roundType=tool_result shows tool result context', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'analyze result', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'looking at grep output',
      nextNeeded: true,
      toolCalls: [{ tool: 'smart_grep', status: 'done', result: 'found at line 142' }],
      roundType: 'tool_result',
    });
    assert.ok(r.thought.includes('工具結果'));
  });

  it('uncertainty triggers tool suggestion', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'find bug', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'maybe the bug is in auth.ts',
      nextNeeded: true,
    });
    assert.equal(r.toolSuggestion.trigger, 'uncertainty');
  });

  it('nextNeeded=false shows completion', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'fix', 'done')],
      currentSubtaskId: 1,
      thought: 'fixed!',
      nextNeeded: false,
    });
  });

  it('strictness=high + no signal → null', () => {
    const r = decomposeThinkHandler({
      goal: defaultGoal,
      subtasks: [makeSubtask(1, 'finalize the module', 'in_progress')],
      currentSubtaskId: 1,
      thought: 'everything looks fine',
      nextNeeded: true,
    });
    // no uncertainty, no high confidence, no task match → null
    assert.equal(r.toolSuggestion, null);
  });
});