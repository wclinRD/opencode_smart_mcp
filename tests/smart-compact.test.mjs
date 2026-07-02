// smart-compact.test.mjs — Phase 14.2 Smart Compact Tool tests
//
// Tests the rules-based tool history classifier:
//   - Classification rules (DROP / KEEP_SUMMARY / KEEP)
//   - Safety: last 3 turns protected
//   - Recovery context extraction
//   - Token savings estimation
//   - Edge cases (empty history, unknown tools)
//
// Run: node --test tests/smart-compact.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the plugin's handler directly
import compactPlugin from '../src/plugins/core/compact.mjs';

const { handler } = compactPlugin;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(tool, ok = true, output = '') {
  return { tool, ok, result: ok ? output : undefined, error: ok ? undefined : output, timestamp: new Date().toISOString() };
}

function call(args) {
  const result = handler(args);
  return JSON.parse(result);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('smart_compact — classification rules', () => {
  it('classifies smart_grep as DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'found 5 matches')] });
    assert.equal(r.toolCallsToDrop.length, 1);
    assert.equal(r.toolOutputsToSummarize.length, 0);
    assert.ok(r.estimatedTokensSaved > 0);
  });

  it('classifies smart_lsp as DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_lsp', true, 'symbol: foo()')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('classifies smart_test as DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_test', true, '5 passed, 0 failed')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('classifies smart_learn as DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_learn', true, 'Project: Node.js')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('classifies import_graph as DROP', () => {
    const r = call({ toolHistory: [makeEntry('import_graph', true, '{}')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('classifies code_impact as DROP', () => {
    const r = call({ toolHistory: [makeEntry('code_impact', true, 'analysis complete')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('classifies smart_security as KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_security', true, 'CRITICAL: 2 issues, HIGH: 3 issues')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1);
    assert.ok(r.toolOutputsToSummarize[0].summary.includes('critical'));
  });

  it('classifies smart_ingest_document as KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_ingest_document', true, '{"title":"contract.pdf","format":"pdf"}')] });
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('classifies git_commit as KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('git_commit', true, 'Committed: fix bug')] });
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('classifies git_pr as KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('git_pr', true, 'PR #42 created')] });
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('classifies smart_think as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_think', true, 'reasoning...')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });

  it('classifies smart_deep_think as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_deep_think', true, 'analysis...')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });

  it('classifies smart_fast_apply as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_fast_apply', true, 'patch applied')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });

  it('classifies edit as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('edit', true, 'file modified')] });
    assert.equal(r.toolCallsToDrop.length, 0);
  });

  it('classifies error_diagnose as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('error_diagnose', true, 'root cause: null pointer')] });
    assert.equal(r.toolCallsToDrop.length, 0);
  });

  it('classifies debug as KEEP', () => {
    const r = call({ toolHistory: [makeEntry('debug', true, 'breakpoint hit')] });
    assert.equal(r.toolCallsToDrop.length, 0);
  });

  it('classifies unknown tool as KEEP (conservative)', () => {
    const r = call({ toolHistory: [makeEntry('some_unknown_tool', true, 'output')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Safety: last 3 turns protection
// ---------------------------------------------------------------------------

describe('smart_compact — safety (last 3 turns protected)', () => {
  it('protects last 3 entries from analysis', () => {
    const history = [
      makeEntry('smart_grep', true, 'match 1'),       // 0: DROP
      makeEntry('smart_grep', true, 'match 2'),       // 1: DROP
      makeEntry('smart_grep', true, 'match 3'),       // 2: DROP
      makeEntry('smart_grep', true, 'match 4'),       // 3: DROP
      makeEntry('smart_think', true, 'thinking...'),  // 4: KEEP (protected)
      makeEntry('smart_fast_apply', true, 'applied'), // 5: KEEP (protected)
      makeEntry('edit', true, 'edited'),              // 6: KEEP (protected)
    ];
    const r = call({ toolHistory: history });
    // Only first 4 entries (0-3) are analyzable, all are DROP
    assert.equal(r.analyzed, 4);
    assert.equal(r.protected, 3);
    assert.equal(r.toolCallsToDrop.length, 4);
    // Indices should be 0, 1, 2, 3
    assert.deepEqual(r.toolCallsToDrop.sort(), [0, 1, 2, 3]);
  });

  it('protects last 3 even when they would be DROP', () => {
    const history = [
      makeEntry('smart_grep', true, 'match 1'),  // 0: DROP
      makeEntry('smart_grep', true, 'match 2'),  // 1: DROP
      makeEntry('smart_grep', true, 'match 3'),  // 2: DROP (protected)
      makeEntry('smart_grep', true, 'match 4'),  // 3: DROP (protected)
      makeEntry('smart_grep', true, 'match 5'),  // 4: DROP (protected)
    ];
    const r = call({ toolHistory: history });
    // Only first 2 entries (0-1) are analyzable
    assert.equal(r.analyzed, 2);
    assert.equal(r.protected, 3);
    assert.equal(r.toolCallsToDrop.length, 2);
    assert.deepEqual(r.toolCallsToDrop.sort(), [0, 1]);
  });

  it('all analyzable when history <= 3 (no protection needed)', () => {
    const history = [
      makeEntry('smart_grep', true, 'match 1'),
      makeEntry('smart_grep', true, 'match 2'),
    ];
    const r = call({ toolHistory: history });
    // With 2 entries (≤ 3), all are analyzable — no protection needed
    assert.equal(r.analyzed, 2);
    assert.equal(r.protected, 0);
    assert.equal(r.toolCallsToDrop.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Recovery context
// ---------------------------------------------------------------------------

describe('smart_compact — recovery context', () => {
  it('includes goal in recovery context', () => {
    const r = call({
      toolHistory: [makeEntry('smart_grep', true, 'found')],
      currentGoal: 'Fix the login bug',
    });
    assert.equal(r.recoveryContext.goal, 'Fix the login bug');
  });

  it('includes todos in recovery context', () => {
    const r = call({
      toolHistory: [makeEntry('smart_grep', true, 'found')],
      currentTodos: [{ content: 'Fix bug', status: 'in_progress' }],
    });
    assert.equal(r.recoveryContext.activeTasks.length, 1);
    assert.equal(r.recoveryContext.activeTasks[0].content, 'Fix bug');
  });

  it('extracts key findings from error entries', () => {
    const history = [
      makeEntry('smart_grep', true, 'found'),
      makeEntry('smart_test', false, 'Error: timeout after 30s'),
      makeEntry('smart_security', true, 'CRITICAL: credential leak in config.js'),
      makeEntry('smart_think', true, 'analyzing...'),
    ];
    const r = call({ toolHistory: history });
    assert.ok(r.recoveryContext.keyFindings.length >= 1);
    const findings = r.recoveryContext.keyFindings.join(' ');
    assert.ok(findings.includes('timeout') || findings.includes('credential'));
  });

  it('extracts open questions from failed entries', () => {
    const history = [
      makeEntry('smart_test', false, 'Test failed: assertion error at line 42'),
      makeEntry('smart_grep', true, 'found'),
      makeEntry('smart_think', true, 'thinking...'),
    ];
    const r = call({ toolHistory: history });
    assert.ok(r.recoveryContext.openQuestions.length >= 1);
    assert.ok(r.recoveryContext.openQuestions[0].includes('smart_test'));
  });

  it('caps keyFindings at 8', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push(makeEntry(`tool_${i}`, false, `Error: issue ${i} occurred`));
    }
    const r = call({ toolHistory: history });
    assert.ok(r.recoveryContext.keyFindings.length <= 8);
  });

  it('caps openQuestions at 3', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push(makeEntry(`tool_${i}`, false, `Error: issue ${i}`));
    }
    const r = call({ toolHistory: history });
    assert.ok(r.recoveryContext.openQuestions.length <= 3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('smart_compact — edge cases', () => {
  it('handles empty toolHistory', () => {
    const r = call({ toolHistory: [] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
    assert.equal(r.estimatedTokensSaved, 0);
    assert.ok(r.note.includes('No tool history'));
  });

  it('handles missing toolHistory (not provided)', () => {
    const r = call({});
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.estimatedTokensSaved, 0);
  });

  it('handles entries with no output', () => {
    const history = [
      makeEntry('smart_grep', true, ''),
      makeEntry('smart_security', true, ''),
    ];
    const r = call({ toolHistory: history });
    // smart_grep is DROP even with empty output
    assert.equal(r.toolCallsToDrop.length, 1);
    // smart_security is KEEP_SUMMARY with empty summary
    assert.equal(r.toolOutputsToSummarize.length, 1);
    assert.ok(r.toolOutputsToSummarize[0].summary.includes('empty'));
  });

  it('handles mixed history with all types', () => {
    const history = [
      makeEntry('smart_grep', true, 'found 3 matches'),
      makeEntry('smart_security', true, 'CRITICAL: 1 issue\nHIGH: 2 issues'),
      makeEntry('smart_think', true, 'reasoning step 1'),
      makeEntry('smart_lsp', true, 'symbol: foo()'),
      makeEntry('git_commit', true, 'commit abc123'),
      makeEntry('smart_fast_apply', true, 'patch applied'),
      makeEntry('edit', true, 'file changed'),
      makeEntry('unknown_tool', true, 'some output'),
    ];
    const r = call({ toolHistory: history });
    // analyzable: first 5 (8 total - 3 protected)
    assert.equal(r.analyzed, 5);
    assert.equal(r.protected, 3);
    // DROP: smart_grep (idx 0), smart_lsp (idx 3) = 2
    // KEEP_SUMMARY: smart_security (idx 1), git_commit (idx 4) = 2
    // KEEP: smart_think (idx 2) = 1
    assert.equal(r.toolCallsToDrop.length, 2);
    assert.equal(r.toolOutputsToSummarize.length, 2);
    assert.ok(r.estimatedTokensSaved > 0);
  });

  it('includes per-tool breakdown', () => {
    const history = [
      makeEntry('smart_grep', true, 'a'),
      makeEntry('smart_grep', true, 'b'),
      makeEntry('smart_security', true, 'c'),
      makeEntry('smart_think', true, 'd'),
    ];
    const r = call({ toolHistory: history });
    assert.ok(r.breakdown);
    assert.equal(r.breakdown['smart_grep'].action, 'DROP');
    assert.equal(r.breakdown['smart_grep'].count, 1); // only 1 analyzable (other is protected)
  });

  it('note reflects findings', () => {
    const r1 = call({ toolHistory: [makeEntry('smart_grep', true, 'found')] });
    assert.ok(r1.note.includes('droppable'));

    const r2 = call({ toolHistory: [makeEntry('smart_think', true, 'thinking')] });
    assert.ok(r2.note.includes('No entries can be safely dropped'));
  });
});

// ---------------------------------------------------------------------------
// P5: Content-aware classification patterns (Round 5 enhancement)
// ---------------------------------------------------------------------------

describe('smart_compact — content-aware patterns', () => {

  // ── Upgrade patterns ──

  it('upgrades error output to KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'TypeError: cannot read property')] });
    assert.equal(r.toolCallsToDrop.length, 0, 'error output should not be dropped');
  });

  it('upgrades security findings to KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'vulnerability found in dep: CVE-2024-1234')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('upgrades test failure to KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_test', true, 'failed 2, passed 3')] });
    assert.equal(r.toolCallsToDrop.length, 0, 'test failure should not be dropped');
  });

  it('upgrades file-change stats to KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, '5 files changed')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('upgrades deprecated pattern to KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'deprecated: will be removed in v3')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });

  it('upgrades ✅ completion to KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, '✅ done - refactored auth')] });
    assert.equal(r.toolCallsToDrop.length, 0, 'completion marker should preserve output');
  });

  it('upgrades LSP diagnostics — error count is KEEP (generic error upgrade wins)', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, '3 errors, 5 warnings found')] });
    assert.equal(r.toolCallsToDrop.length, 0, 'error diagnostic should not be dropped');
    // KEEP (from error pattern) > KEEP_SUMMARY (from diagnostic count) — correct
  });

  it('upgrades LSP warnings without error to KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, '5 warnings, 2 problems found')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1, 'warnings/problems should be summarized');
  });

  // ── Downgrade patterns ──

  it('downgrades no-matches result to DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_security', true, 'No matches found. 0 results.')] });
    assert.equal(r.toolCallsToDrop.length, 1, 'empty security scan should be dropped');
  });

  it('downgrades git no-change to DROP', () => {
    const r = call({ toolHistory: [makeEntry('git_status', true, 'nothing to commit, working tree clean')] });
    assert.equal(r.toolCallsToDrop.length, 1, 'no-op git status should be dropped');
  });

  it('downgrades empty security to DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_security', true, '0 vulnerabilities, 0 issues')] });
    assert.equal(r.toolCallsToDrop.length, 1, 'empty security scan should be dropped');
  });

  it('downgrades no-data result to DROP', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'no data available')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  it('downgrades very short reply to DROP for base DROP tools', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'ok')] });
    assert.equal(r.toolCallsToDrop.length, 1);
  });

  // ── Priority: upgrade before downgrade ──

  it('upgrade takes priority over downgrade (error > no-match)', () => {
    const r = call({ toolHistory: [makeEntry('smart_test', true, 'Error: failed 2 tests. No matches.')] });
    assert.equal(r.toolCallsToDrop.length, 0, 'error should win over no-match');
  });

  it('upgrade takes priority over short output', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, '✅ done')] });
    assert.equal(r.toolCallsToDrop.length, 0, '✅ marker should preserve even short output');
  });

  // ── Base tool classification preserved when no content trigger ──

  it('neutral DROP tool remains DROP without content triggers', () => {
    const r = call({ toolHistory: [makeEntry('smart_grep', true, 'found 3 function call sites')] });
    assert.equal(r.toolCallsToDrop.length, 1);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });

  it('neutral KEEP tool remains KEEP', () => {
    const r = call({ toolHistory: [makeEntry('smart_think', true, 'considering two approaches for auth')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 0);
  });

  it('neutral KEEP_SUMMARY tool remains KEEP_SUMMARY', () => {
    const r = call({ toolHistory: [makeEntry('smart_rules', true, 'Project uses tabs for indentation')] });
    assert.equal(r.toolCallsToDrop.length, 0);
    assert.equal(r.toolOutputsToSummarize.length, 1);
  });
});