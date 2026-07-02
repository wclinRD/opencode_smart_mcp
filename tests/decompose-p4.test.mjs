import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── P2.4 測試：FR-CoT + Tool Necessity + Cross-Validation ──

// ═══ N: FR-CoT ═══
import {
  frcotClassify,
  frcotRecommend,
  frcotGetTemplate,
  frcotFormat,
  frcotCompress,
  frcotPrompt,
} from '../src/lib/decompose-frcot.mjs';

describe('frcotClassify (N1)', () => {
  it('short → brief', () => assert.equal(frcotClassify(20), 'brief'));
  it('medium → normal', () => assert.equal(frcotClassify(100), 'normal'));
  it('long → deep', () => assert.equal(frcotClassify(500), 'deep'));
  it('boundary: 30 → normal', () => assert.equal(frcotClassify(30), 'normal'));
  it('boundary: 300 → deep', () => assert.equal(frcotClassify(300), 'deep'));
});

describe('frcotRecommend (N1)', () => {
  it('low token + high confidence → brief', () => {
    assert.equal(frcotRecommend({ tokenCount: 30, confidence: 8, complexity: 1 }), 'brief');
  });
  it('high token → deep', () => {
    assert.equal(frcotRecommend({ tokenCount: 300 }), 'deep');
  });
  it('low confidence → deep', () => {
    assert.equal(frcotRecommend({ confidence: 3 }), 'deep');
  });
  it('high complexity → deep', () => {
    assert.equal(frcotRecommend({ complexity: 5 }), 'deep');
  });
  it('default → normal', () => {
    assert.equal(frcotRecommend({}), 'normal');
  });
  it('many rounds + low confidence → deep', () => {
    assert.equal(frcotRecommend({ roundCount: 5, confidence: 4 }), 'deep');
  });
});

describe('frcotGetTemplate (N2)', () => {
  it('brief template', () => {
    const t = frcotGetTemplate('brief');
    assert.equal(t.label, '⚡ Brief');
    assert.equal(t.maxTokens, 150);
  });
  it('normal template', () => {
    const t = frcotGetTemplate('normal');
    assert.equal(t.label, '📋 Normal');
    assert.equal(t.maxTokens, 300);
  });
  it('deep template', () => {
    const t = frcotGetTemplate('deep');
    assert.equal(t.label, '🔬 Deep');
    assert.equal(t.maxTokens, 600);
  });
  it('unknown → normal', () => {
    assert.equal(frcotGetTemplate('unknown').label, '📋 Normal');
  });
});

describe('frcotFormat (N3)', () => {
  it('formats brief mode', () => {
    const r = frcotFormat('fix bug', 'null pointer', 'add check', { mode: 'brief' });
    assert.match(r, /⚡ Brief/);
    assert.match(r, /fix bug/);
  });
  it('formats normal mode', () => {
    const r = frcotFormat('fix bug', 'null pointer', 'add check');
    assert.match(r, /📋 Normal/);
  });
  it('empty returns empty', () => {
    assert.equal(frcotFormat('', '', ''), '');
  });
});

describe('frcotCompress (N3)', () => {
  it('short text stays as-is', () => {
    assert.equal(frcotCompress('short text'), 'short text');
  });
  it('long text truncated', () => {
    const long = 'line1\n\n\nline2\nline3\nline4\nlastline';
    const r = frcotCompress(long);
    assert.match(r, /\.\.\./);
  });
  it('null → empty', () => { assert.equal(frcotCompress(null), ''); });
});

describe('frcotPrompt (N4)', () => {
  it('generates debug prompt', () => {
    const r = frcotPrompt('debug');
    assert.match(r, /Debug/);
  });
  it('generates refactor prompt', () => {
    const r = frcotPrompt('refactor');
    assert.match(r, /Refactor/);
  });
  it('generates feature prompt', () => {
    const r = frcotPrompt('feature');
    assert.match(r, /Feature/);
  });
  it('generates research prompt', () => {
    const r = frcotPrompt('research');
    assert.match(r, /Research/);
  });
  it('generates decision prompt', () => {
    const r = frcotPrompt('decision');
    assert.match(r, /Decision/);
  });
  it('unknown → debug', () => {
    assert.match(frcotPrompt('unknown'), /Debug/);
  });
});

// ═══ O: Tool Necessity ═══
import {
  calcToolNecessity,
  calcBatchNecessity,
  filterNecessaryTools,
  necessitySummary,
} from '../src/lib/decompose-necessity.mjs';

describe('calcToolNecessity (O1)', () => {
  it('null subtask → 0', () => {
    const r = calcToolNecessity(null);
    assert.equal(r.score, 0);
  });
  it('empty desc → 0', () => {
    const r = calcToolNecessity({});
    assert.equal(r.score, 0);
  });
  it('find pattern → smart_grep suggested', () => {
    const r = calcToolNecessity({ desc: 'find the auth module' });
    assert.ok(r.score >= 5);
    assert.equal(r.suggestedTool, 'smart_grep');
  });
  it('edit pattern → smart_fast_apply', () => {
    const r = calcToolNecessity({ desc: 'fix the login bug' });
    assert.equal(r.suggestedTool, 'smart_fast_apply');
  });
  it('test pattern → smart_test', () => {
    const r = calcToolNecessity({ desc: 'run the test suite' });
    assert.equal(r.suggestedTool, 'smart_test');
  });
  it('has evidence → lower score', () => {
    const r = calcToolNecessity({ desc: 'find the bug', evidence: 'already found it' });
    assert.ok(r.score < 7);
  });
  it('has tool specified → bonus', () => {
    const r = calcToolNecessity({ desc: 'some text', tool: 'smart_lsp' });
    assert.ok(r.score >= 2);
  });
});

describe('calcBatchNecessity (O1)', () => {
  it('batch processes', () => {
    const r = calcBatchNecessity([
      { id: 1, desc: 'find the bug' },
      { id: 2, desc: 'fix the bug' },
    ]);
    assert.equal(r.length, 2);
    assert.ok(r[0].necessity);
    assert.ok(r[1].necessity);
  });
  it('non-array → []', () => {
    assert.deepEqual(calcBatchNecessity(null), []);
  });
});

describe('filterNecessaryTools (O2)', () => {
  it('filters by threshold', () => {
    const scored = [
      { id: 1, necessity: { score: 8 } },
      { id: 2, necessity: { score: 3 } },
    ];
    const r = filterNecessaryTools(scored, 5);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 1);
  });
  it('non-array → []', () => {
    assert.deepEqual(filterNecessaryTools(null), []);
  });
});

describe('necessitySummary (O2)', () => {
  it('generates summary', () => {
    const scored = [
      { id: 1, necessity: { score: 8, suggestedTool: 'smart_grep' } },
      { id: 2, necessity: { score: 2 } },
    ];
    const r = necessitySummary(scored);
    assert.match(r, /必要工具/);
  });
  it('empty → no tasks', () => {
    assert.equal(necessitySummary([]), 'no tasks');
  });
});

// ═══ P: Cross-Validation ═══
import {
  crossValidate,
  detectConflicts,
  validationReport,
} from '../src/lib/decompose-crossval.mjs';

describe('crossValidate (P1)', () => {
  it('empty nodes → no issues', () => {
    const r = crossValidate([]);
    assert.equal(r.score, 100);
    assert.deepEqual(r.issues, []);
  });
  it('null nodes → no issues', () => {
    const r = crossValidate(null);
    assert.equal(r.score, 100);
  });
  it('detects missing child', () => {
    const nodes = [
      { id: 0, desc: 'goal' },
      { id: 1, desc: 'step 1', children: [99] },
    ];
    const r = crossValidate(nodes);
    assert.ok(r.issues.length > 0);
    assert.ok(r.issues.some(i => i.type === 'missing_child'));
  });
  it('detects missing evidence', () => {
    const nodes = [
      { id: 0, desc: 'goal' },
      { id: 1, desc: 'step 1', status: 'done', evidence: '' },
    ];
    const r = crossValidate(nodes);
    assert.ok(r.issues.some(i => i.type === 'missing_evidence'));
  });
  it('detects goal alignment issues', () => {
    const nodes = [
      { id: 0, desc: 'Implement login feature' },
      { id: 1, desc: 'buy milk' },
    ];
    const r = crossValidate(nodes);
    // node #1 doesn't share words with goal
    assert.ok(r.issues.some(i => i.type === 'goal_alignment'));
  });
  it('returns score deduction', () => {
    const nodes = [
      { id: 0, desc: 'goal' },
      { id: 1, desc: 'some node', children: [999] },
    ];
    const r = crossValidate(nodes);
    assert.ok(r.score < 100);
  });
  it('detects tool mismatch', () => {
    const nodes = [
      { id: 0, desc: 'goal' },
      { id: 1, desc: 'find it', status: 'done', tool: 'smart_grep' },
    ];
    const tracking = { tools: { 1: 'smart_read' } };
    const r = crossValidate(nodes, tracking);
    assert.ok(r.issues.some(i => i.type === 'tool_mismatch'));
  });
});

describe('detectConflicts (P2)', () => {
  it('empty → no conflicts', () => {
    assert.deepEqual(detectConflicts([]), []);
  });
  it('detects duplicates', () => {
    const subtasks = [
      { id: 1, desc: 'fix login bug', children: [], parents: [] },
      { id: 2, desc: 'fix login bug', children: [], parents: [] },
    ];
    const r = detectConflicts(subtasks);
    assert.ok(r.some(i => i.type === 'duplicate'));
  });
  it('detects circular dependency', () => {
    const subtasks = [
      { id: 1, desc: 'step 1', children: [2], parents: [2] },
      { id: 2, desc: 'step 2', children: [1], parents: [1] },
    ];
    const r = detectConflicts(subtasks);
    assert.ok(r.some(i => i.type === 'circular'));
  });
  it('no conflicts for clean', () => {
    const subtasks = [
      { id: 1, desc: 'step 1', children: [2], parents: [] },
      { id: 2, desc: 'step 2', children: [], parents: [1] },
    ];
    assert.equal(detectConflicts(subtasks).length, 0);
  });
});

describe('validationReport (P3)', () => {
  it('generates report', () => {
    const r = crossValidate([
      { id: 0, desc: 'goal' },
      { id: 1, desc: 'step 1', children: [999] },
    ]);
    const report = validationReport(r);
    assert.match(report, /Cross-Validation Report/);
    assert.match(report, /Score/);
  });
  it('null → fallback', () => {
    assert.equal(validationReport(null), 'no validation data');
  });
});
