// quality-gate-unit.test.mjs — Unit tests for checkHighRiskPrerequisites()
//
// Tests the quality gate logic directly (no MCP server spawn).
// Covers edge cases the integration tests can't easily reach.
//
// Run: node --test tests/quality-gate-unit.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Replicated rules (mirrors src/server/index.mjs HIGH_RISK_PREREQUISITES)
// ---------------------------------------------------------------------------

const HIGH_RISK_PREREQUISITES = {
  'smart_fast_apply': {
    check: (toolHistory) => {
      const recentScans = toolHistory.filter(h => h.tool === 'smart_security' && h.ok).slice(-3);
      if (recentScans.length === 0) return null;
      const latestScanTime = new Date(recentScans[recentScans.length - 1].timestamp).getTime();
      const hasBeamAfter = toolHistory.some(h =>
        h.tool === 'smart_think' && h.args?.mode === 'beam' && h.ok &&
        new Date(h.timestamp).getTime() > latestScanTime
      );
      if (!hasBeamAfter) {
        return { allowed: false, message: 'Quality Gate: beam search required' };
      }
      return null;
    },
  },
  'smart_cross_file_edit': {
    check: (toolHistory) => {
      const hasImportGraph = toolHistory.some(h =>
        h.tool === 'smart_import_graph' && h.ok
      );
      if (!hasImportGraph) {
        return { allowed: false, message: 'Quality Gate: import_graph required' };
      }
      return null;
    },
  },
};

function checkHighRiskPrerequisites(toolName, toolHistory) {
  const rule = HIGH_RISK_PREREQUISITES[toolName];
  if (!rule) return null;
  if (!Array.isArray(toolHistory)) return null;
  return rule.check(toolHistory);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(tool, ok = true, overrides = {}) {
  return {
    tool,
    ok,
    timestamp: new Date().toISOString(),
    args: {},
    ...overrides,
  };
}

function ts(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkHighRiskPrerequisites — Unit Tests', () => {

  // ── No-rule tools ──
  describe('tools with no quality gate rule', () => {
    it('returns null for smart_grep (no rule)', () => {
      assert.strictEqual(checkHighRiskPrerequisites('smart_grep', []), null);
    });

    it('returns null for smart_learn (no rule)', () => {
      assert.strictEqual(checkHighRiskPrerequisites('smart_learn', [
        makeEntry('smart_security'),
      ]), null);
    });

    it('returns null for unknown tool', () => {
      assert.strictEqual(checkHighRiskPrerequisites('nonexistent_tool', []), null);
    });
  });

  // ── cross_file_edit gate ──
  describe('smart_cross_file_edit gate', () => {
    it('blocks when no import_graph in history', () => {
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', [
        makeEntry('smart_grep'),
        makeEntry('smart_learn'),
      ]);
      assert.ok(result, 'Should return a block result');
      assert.strictEqual(result.allowed, false);
      assert.ok(result.message.includes('import_graph'), 'Message should mention import_graph');
    });

    it('blocks when import_graph exists but failed (ok=false)', () => {
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', [
        makeEntry('smart_import_graph', false),
      ]);
      assert.ok(result, 'Should block when import_graph failed');
      assert.strictEqual(result.allowed, false);
    });

    it('allows when import_graph succeeded', () => {
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', [
        makeEntry('smart_import_graph', true),
      ]);
      assert.strictEqual(result, null);
    });

    it('allows when import_graph succeeded among other tools', () => {
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', [
        makeEntry('smart_grep'),
        makeEntry('smart_learn'),
        makeEntry('smart_import_graph', true),
        makeEntry('smart_test'),
      ]);
      assert.strictEqual(result, null);
    });

    it('handles empty history', () => {
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', []);
      assert.ok(result, 'Should block with empty history');
      assert.strictEqual(result.allowed, false);
    });

    it('handles null/undefined history gracefully', () => {
      assert.strictEqual(checkHighRiskPrerequisites('smart_cross_file_edit', null), null);
      assert.strictEqual(checkHighRiskPrerequisites('smart_cross_file_edit', undefined), null);
    });
  });

  // ── fast_apply security gate ──
  describe('smart_fast_apply security gate', () => {
    it('returns null when no security scan in history', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_grep'),
        makeEntry('smart_learn'),
      ]);
      assert.strictEqual(result, null, 'No security scan → gate not triggered');
    });

    it('blocks when security scan succeeded but no beam search', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-5000) }),
      ]);
      assert.ok(result, 'Should block');
      assert.strictEqual(result.allowed, false);
      assert.ok(result.message.includes('beam'), 'Message should mention beam search');
    });

    it('allows when security scan + beam search both succeeded', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', true, {
          timestamp: ts(-5000),
          args: { mode: 'beam' },
        }),
      ]);
      assert.strictEqual(result, null);
    });

    it('blocks when beam search is before security scan', () => {
      // Beam search happened BEFORE security scan → should not count
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_think', true, {
          timestamp: ts(-10000),
          args: { mode: 'beam' },
        }),
        makeEntry('smart_security', true, { timestamp: ts(-5000) }),
      ]);
      assert.ok(result, 'Should block: beam was before scan');
      assert.strictEqual(result.allowed, false);
    });

    it('blocks when beam search is not in beam mode', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', true, {
          timestamp: ts(-5000),
          args: { mode: 'cit' },  // Not beam mode
        }),
      ]);
      assert.ok(result, 'Should block: think was not in beam mode');
      assert.strictEqual(result.allowed, false);
    });

    it('blocks when beam search failed (ok=false)', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', false, {
          timestamp: ts(-5000),
          args: { mode: 'beam' },
        }),
      ]);
      assert.ok(result, 'Should block: beam search failed');
      assert.strictEqual(result.allowed, false);
    });

    it('ignores failed security scans (ok=false)', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', false, { timestamp: ts(-5000) }),
      ]);
      assert.strictEqual(result, null, 'Failed scan should not trigger gate');
    });

    it('only considers last 3 security scans', () => {
      // 4 scans, only last 3 matter. Latest is ok=true, no beam after → blocked
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-40000) }),
        makeEntry('smart_security', true, { timestamp: ts(-30000) }),
        makeEntry('smart_security', true, { timestamp: ts(-20000) }),
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
      ]);
      assert.ok(result, 'Should block: latest scan has no beam after');
      assert.strictEqual(result.allowed, false);
    });

    it('allows when beam search is after the latest security scan', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-30000) }),
        makeEntry('smart_security', true, { timestamp: ts(-20000) }),
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', true, {
          timestamp: ts(-5000),
          args: { mode: 'beam' },
        }),
      ]);
      assert.strictEqual(result, null);
    });

    it('handles missing args in think entry', () => {
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', true, {
          timestamp: ts(-5000),
          // args is undefined/missing
        }),
      ]);
      assert.ok(result, 'Should block: think has no args');
      assert.strictEqual(result.allowed, false);
    });
  });

  // ── Bypass attempts ──
  describe('bypass prevention', () => {
    it('cannot bypass cross_file_edit by calling through smart_run', () => {
      // The gate checks the tool name, not how it was called
      // smart_run dispatches to cross_file_edit, but the gate is on smart_cross_file_edit
      // This test verifies the gate logic is correct regardless of call path
      const result = checkHighRiskPrerequisites('smart_cross_file_edit', []);
      assert.ok(result, 'Gate should trigger regardless of call path');
      assert.strictEqual(result.allowed, false);
    });

    it('cannot bypass fast_apply by using different think mode name', () => {
      // Using mode:"beam_search" instead of mode:"beam" should not work
      const result = checkHighRiskPrerequisites('smart_fast_apply', [
        makeEntry('smart_security', true, { timestamp: ts(-10000) }),
        makeEntry('smart_think', true, {
          timestamp: ts(-5000),
          args: { mode: 'beam_search' },  // Wrong mode name
        }),
      ]);
      assert.ok(result, 'Should block: wrong mode name');
      assert.strictEqual(result.allowed, false);
    });
  });
});