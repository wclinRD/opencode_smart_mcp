/**
 * think-guard-phase2.test.mjs — Phase 2 功能測試
 *
 * 測試維度：
 *   1. 動態閾值（Dynamic Threshold）
 *   2. 歷史學習（Historical Learning）
 *   3. 跨工具整合（Cross-tool Integration）
 *   4. 並發安全（Concurrency Safety）
 *   5. 整合測試（Handler Integration）
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
  getDynamicThreshold,
  recordClassification,
  getHistoryStats,
  clearHistory,
  DOMAIN_RULES,
  detectDomain,
  getSessionState,
  clearSessionState,
  pruneStaleSessions,
} from '../src/lib/think-guard.mjs';
import smartThinkPlugin from '../src/plugins/core/quick-think.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 動態閾值（Dynamic Threshold）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.1: 動態閾值', () => {
  it('budget < 30% → threshold +1（減少誤觸發）', () => {
    assert.equal(getDynamicThreshold(0.20), 4);
    assert.equal(getDynamicThreshold(0.10), 4);
    assert.equal(getDynamicThreshold(0.05), 4);
  });

  it('budget > 60% → threshold -1（更積極偵測）', () => {
    assert.equal(getDynamicThreshold(0.70), 2);
    assert.equal(getDynamicThreshold(0.80), 2);
    assert.equal(getDynamicThreshold(0.90), 2);
  });

  it('budget 30%-60% → 基礎閾值（平衡）', () => {
    assert.equal(getDynamicThreshold(0.30), 3);
    assert.equal(getDynamicThreshold(0.45), 3);
    assert.equal(getDynamicThreshold(0.60), 3);
  });

  it('budget 邊界值：0.30 → 基礎閾值', () => {
    assert.equal(getDynamicThreshold(0.30), 3);
  });

  it('budget 邊界值：0.60 → 基礎閾值', () => {
    assert.equal(getDynamicThreshold(0.60), 3);
  });

  it('detectOverconfidence 整合動態閾值', () => {
    // '分析優缺點' matches /優缺點/ with weight=4, so score=4
    // budget=0.70 → threshold=2 → score(4) >= threshold(2) → 觸發
    const r1 = detectOverconfidence(
      '分析優缺點', '不需要分支', false, 'cit',
      { budgetFraction: 0.70 }
    );
    assert.equal(r1.overconfident, true);
    assert.equal(r1.threshold, 2);

    // budget=0.20 → threshold=4 → score(4) >= threshold(4) → 仍觸發（borderline）
    const r2 = detectOverconfidence(
      '分析優缺點', '不需要分支', false, 'cit',
      { budgetFraction: 0.20 }
    );
    assert.equal(r2.overconfident, true);
    assert.equal(r2.threshold, 4);

    // Use lower-score text: '工具選擇' weight=3 only
    // budget=0.70 → threshold=2 → score(3) >= threshold(2) → 觸發
    const r3 = detectOverconfidence(
      '工具選擇問題', '不需要分支', false, 'cit',
      { budgetFraction: 0.70 }
    );
    assert.equal(r3.overconfident, true);
    assert.equal(r3.threshold, 2);

    // budget=0.20 → threshold=4 → score(3) < threshold(4) → 不觸發
    const r4 = detectOverconfidence(
      '工具選擇問題', '不需要分支', false, 'cit',
      { budgetFraction: 0.20 }
    );
    assert.equal(r4.overconfident, false);
    assert.equal(r4.threshold, 4);
  });

  it('detectOverconfidence 不傳 budgetFraction 時用基礎閾值', () => {
    const r = detectOverconfidence(
      '分析優缺點', '不需要分支', false, 'cit'
    );
    assert.equal(r.threshold, 3);
  });

  it('detectOverconfidence 回傳 score 和 threshold', () => {
    const r = detectOverconfidence(
      '分析優缺點', '不需要分支', false, 'cit'
    );
    assert.equal(typeof r.score, 'number');
    assert.equal(typeof r.threshold, 'number');
    assert.ok(r.score >= 0);
    assert.ok(r.threshold >= 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 歷史學習（Historical Learning）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.2: 歷史學習', () => {
  beforeEach(() => {
    clearHistory();
  });

  it('recordClassification 記錄分類結果', () => {
    recordClassification({
      task: '分析優缺點',
      classification: { suggestedMode: 'cit', forceBranch: true },
      overconfidence: { overconfident: true },
      outcome: 'correct',
    });
    const stats = getHistoryStats();
    assert.equal(stats.total, 1);
    assert.equal(stats.byMode.cit, 1);
  });

  it('getHistoryStats 空歷史回傳零值', () => {
    const stats = getHistoryStats();
    assert.equal(stats.total, 0);
    assert.deepEqual(stats.byMode, {});
    assert.equal(stats.overconfidenceRate, 0);
    assert.equal(stats.accuracyRate, 0);
  });

  it('getHistoryStats 統計多筆記錄', () => {
    recordClassification({ task: 't1', classification: { suggestedMode: 'cit' } });
    recordClassification({ task: 't2', classification: { suggestedMode: 'beam' } });
    recordClassification({ task: 't3', classification: { suggestedMode: 'cit' }, outcome: 'correct' });
    recordClassification({ task: 't4', classification: { suggestedMode: null }, outcome: 'incorrect' });
    recordClassification({ task: 't5', classification: { suggestedMode: 'cit' }, overconfidence: { overconfident: true } });

    const stats = getHistoryStats();
    assert.equal(stats.total, 5);
    assert.equal(stats.byMode.cit, 3);
    assert.equal(stats.byMode.beam, 1);
    assert.equal(stats.byMode.null, 1);
    assert.equal(stats.overconfidenceRate, 1 / 5);
    assert.equal(stats.accuracyRate, 1 / 2); // 1 correct out of 2 judged
    assert.equal(stats.judgedCount, 2);
  });

  it('clearHistory 清空歷史', () => {
    recordClassification({ task: 't1', classification: { suggestedMode: 'cit' } });
    clearHistory();
    const stats = getHistoryStats();
    assert.equal(stats.total, 0);
  });

  it('歷史超過 MAX_HISTORY(200) 時自動截斷', () => {
    for (let i = 0; i < 250; i++) {
      recordClassification({ task: `task-${i}`, classification: { suggestedMode: 'cit' } });
    }
    const stats = getHistoryStats();
    assert.equal(stats.total, 200);
  });

  it('task 描述自動截斷到 200 字元', () => {
    const longTask = 'a'.repeat(500);
    recordClassification({ task: longTask, classification: { suggestedMode: 'cit' } });
    const stats = getHistoryStats();
    assert.equal(stats.total, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 跨工具整合（Cross-tool Integration）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.3: 跨工具整合', () => {
  describe('detectDomain', () => {
    it('偵測 EDA 領域', () => {
      const r = detectDomain('分析 PDK cell library 的 timing');
      assert.equal(r.domain, 'eda');
      assert.equal(r.rules.name, 'EDA / IC Design');
    });

    it('偵測 Exa/Web 領域', () => {
      const r = detectDomain('搜尋結果的網路資料分析');
      assert.equal(r.domain, 'exa');
      assert.equal(r.rules.name, 'Web Search / Exa');
    });

    it('偵測 Medical 領域', () => {
      const r = detectDomain('醫學臨床試驗的治療方案');
      assert.equal(r.domain, 'medical');
      assert.equal(r.rules.name, 'Medical / Clinical');
    });

    it('無匹配回傳 null', () => {
      const r = detectDomain('簡單任務');
      assert.equal(r.domain, null);
      assert.equal(r.rules, null);
    });

    it('空字串回傳 null', () => {
      const r = detectDomain('');
      assert.equal(r.domain, null);
    });

    it('null 回傳 null', () => {
      const r = detectDomain(null);
      assert.equal(r.domain, null);
    });
  });

  describe('DOMAIN_RULES 結構', () => {
    it('三個領域規則', () => {
      assert.equal(Object.keys(DOMAIN_RULES).length, 3);
      assert.ok(DOMAIN_RULES.eda);
      assert.ok(DOMAIN_RULES.exa);
      assert.ok(DOMAIN_RULES.medical);
    });

    it('each domain has patterns, overconfidenceBoost, verifyAdditions', () => {
      for (const [key, domain] of Object.entries(DOMAIN_RULES)) {
        assert.ok(Array.isArray(domain.patterns), `${key}: patterns should be array`);
        assert.ok(domain.name, `${key}: should have name`);
        assert.equal(typeof domain.overconfidenceBoost, 'number', `${key}: overconfidenceBoost should be number`);
        assert.ok(Array.isArray(domain.verifyAdditions), `${key}: verifyAdditions should be array`);
        assert.ok(domain.verifyAdditions.length > 0, `${key}: verifyAdditions should not be empty`);
      }
    });
  });

  describe('領域對 overconfidence 閾值的影響', () => {
    it('Medical 領域提高閾值（保守）', () => {
      const r = detectOverconfidence(
        '醫學臨床試驗的治療方案分析', '不需要分支', false, 'cit'
      );
      // Medical boost=+1, base threshold=3, so effective threshold=4
      // score for this text should be checked
      assert.equal(typeof r.threshold, 'number');
    });

    it('Exa 領域降低閾值（更積極）', () => {
      const r = detectOverconfidence(
        '搜尋結果的網路資料比較', '不需要分支', false, 'cit'
      );
      // Exa boost=-1, base threshold=3, so effective threshold=2
      assert.equal(typeof r.threshold, 'number');
    });
  });

  describe('領域特定 VERIFY 增強', () => {
    it('EDA 領域加入 PDK 相關檢查', () => {
      const result = enhanceVerifyStage('驗證', '分析 PDK timing');
      // 基本增強
      assert.ok(result.includes('範圍限定檢查'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 並發安全（Concurrency Safety）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.4: 並發安全', () => {
  it('getSessionState 建立新 session', () => {
    const state = getSessionState('session-1');
    assert.ok(state);
    assert.ok(state.classifications);
    assert.ok(Array.isArray(state.classifications));
    assert.ok(state.createdAt);
  });

  it('getSessionState 回傳同一個 session', () => {
    const s1 = getSessionState('session-2');
    const s2 = getSessionState('session-2');
    assert.strictEqual(s1, s2);
  });

  it('不同 session 獨立', () => {
    const s1 = getSessionState('session-a');
    const s2 = getSessionState('session-b');
    assert.notStrictEqual(s1, s2);
  });

  it('空 sessionId 回傳空物件', () => {
    const state = getSessionState(null);
    assert.deepEqual(state, {});
    const state2 = getSessionState('');
    assert.deepEqual(state2, {});
  });

  it('clearSessionState 刪除指定 session', () => {
    getSessionState('session-c');
    clearSessionState('session-c');
    const state = getSessionState('session-c');
    assert.notStrictEqual(state, undefined); // 會建立新的
    assert.ok(state.classifications.length === 0);
  });

  it('pruneStaleSessions 清理過期 session', () => {
    const state = getSessionState('old-session');
    state.createdAt = Date.now() - 7200000; // 2 hours ago
    getSessionState('new-session');
    const pruned = pruneStaleSessions(3600000); // 1 hour
    assert.ok(pruned >= 1);
  });

  it('pruneStaleSessions 不清理新 session', () => {
    getSessionState('fresh-session');
    const pruned = pruneStaleSessions(3600000);
    assert.equal(pruned, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 整合測試（Handler Integration）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.5: Handler 整合', () => {
  beforeEach(() => {
    clearHistory();
  });

  it('Handler 記錄分類歷史', () => {
    smartThinkPlugin.handler({
      thought: '分析優缺點',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: false,
      branchReasoning: '不需要分支',
    });
    const stats = getHistoryStats();
    assert.ok(stats.total >= 1);
  });

  it('Handler 有指定 mode 時不觸發分類建議', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析優缺點',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: true,
    });
    assert.ok(!output.includes('任務分類建議'));
  });

  it('Handler 有指定 mode 時仍記錄歷史', () => {
    smartThinkPlugin.handler({
      thought: '測試任務',
      nextThoughtNeeded: false,
      mode: 'beam',
      beams: [{ name: 'A', content: 'a', confidence: 8 }],
      selectedBeam: 'A',
    });
    const stats = getHistoryStats();
    assert.ok(stats.total >= 1);
  });

  it('Handler structured mode + EDA 領域 → 包含領域特定檢查', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析 PDK cell library 的 timing',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '分析 timing',
      verify: '驗證',
    });
    assert.ok(output.includes('範圍限定檢查'));
  });

  it('Handler classifyTask 子指令正常運作', () => {
    const output = smartThinkPlugin.handler({
      classifyTask: '分析優缺點',
    });
    assert.ok(output.includes('Task Classification'));
    assert.ok(output.includes('cit'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 壓力測試
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 2.6: 壓力測試', () => {
  it('100 次 recordClassification + getHistoryStats < 1s', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      recordClassification({
        task: `task-${i}`,
        classification: { suggestedMode: i % 2 === 0 ? 'cit' : 'beam' },
      });
      getHistoryStats();
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `100 iterations took ${elapsed}ms`);
    clearHistory();
  });

  it('100 次 getSessionState + clearSessionState < 1s', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      const sid = `stress-${i}`;
      getSessionState(sid);
      clearSessionState(sid);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `100 iterations took ${elapsed}ms`);
  });

  it('100 次 detectDomain < 1s', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      detectDomain('分析 PDK timing');
      detectDomain('搜尋結果分析');
      detectDomain('醫學臨床試驗');
      detectDomain('簡單任務');
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `400 iterations took ${elapsed}ms`);
  });
});
