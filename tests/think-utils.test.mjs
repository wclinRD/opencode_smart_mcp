// ── think-utils 單元測試 ──
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatProgressBar,
  formatGoalHeader,
  formatSubtaskList,
  cosineSimilarity,
} from '../src/lib/think-utils.mjs';

describe('formatProgressBar', () => {
  it('0/5 → empty bar', () => {
    assert.equal(formatProgressBar(0, 5), '[░░░░░░░░░░] 0/5');
  });

  it('3/5 → half-filled bar', () => {
    assert.equal(formatProgressBar(3, 5), '[██████░░░░] 3/5');
  });

  it('5/5 → full bar with checkmark', () => {
    assert.equal(formatProgressBar(5, 5), '[██████████] 5/5 ✅');
  });

  it('handles 0 total gracefully', () => {
    assert.equal(formatProgressBar(0, 0), '[░░░░░░░░░░] 0/0');
  });
});

describe('formatGoalHeader', () => {
  it('wraps goal with target emoji', () => {
    assert.equal(formatGoalHeader('fix bug'), '🎯 fix bug');
  });
});

describe('formatSubtaskList', () => {
  const subtasks = [
    { id: 1, desc: 'a', status: 'done' },
    { id: 2, desc: 'b', status: 'in_progress' },
    { id: 3, desc: 'c', status: 'pending' },
    { id: 4, desc: 'd', status: 'blocked' },
  ];

  it('marks current subtask with arrow', () => {
    const lines = formatSubtaskList(subtasks, 2);
    assert.ok(lines[1].includes('←'));
  });

  it('uses correct markers per status', () => {
    const lines = formatSubtaskList(subtasks, 1);
    assert.ok(lines[0].includes('✅'));
    assert.ok(lines[1].includes('🔄'));
    assert.ok(lines[2].includes('⬜'));
    assert.ok(lines[3].includes('❌'));
  });

  it('no arrow when currentId not in list', () => {
    const lines = formatSubtaskList(subtasks, 99);
    for (const l of lines) assert.ok(!l.includes('←'));
  });
});

describe('cosineSimilarity', () => {
  it('identical strings → >0.9', () => {
    const s = 'the quick brown fox jumps over the lazy dog';
    assert.ok(cosineSimilarity(s, s) > 0.9);
  });

  it('completely different strings → <0.3', () => {
    const a = 'the quick brown fox';
    const b = 'xyzzy one two three four five six seven';
    assert.ok(cosineSimilarity(a, b) < 0.3);
  });

  it('empty strings → 0', () => {
    assert.equal(cosineSimilarity('', 'abc'), 0);
    assert.equal(cosineSimilarity('abc', ''), 0);
    assert.equal(cosineSimilarity('', ''), 0);
  });

  it('null/undefined → 0', () => {
    assert.equal(cosineSimilarity(null, 'abc'), 0);
    assert.equal(cosineSimilarity('abc', undefined), 0);
  });

  it('partially overlapping → moderate score', () => {
    const a = 'fix the null pointer bug in auth';
    const b = 'fix the null pointer bug in login';
    const score = cosineSimilarity(a, b);
    assert.ok(score > 0.5 && score < 0.95, `expected moderate, got ${score}`);
  });
});
