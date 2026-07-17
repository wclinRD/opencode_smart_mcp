import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
  SCOPE_QUESTIONS,
  COMPLEMENTARITY_CHECKLIST,
  DEVILS_ADVOCATE,
} from '../src/lib/think-guard.mjs';

describe('classifyThinkingMode', () => {
  it('suggests beam for refactoring tasks', () => {
    const result = classifyThinkingMode('重構 src/utils.ts 並跨檔案修改');
    assert.equal(result.suggestedMode, 'beam');
    assert.ok(result.reason.includes('重構'));
  });

  it('suggests beam for security fixes', () => {
    const result = classifyThinkingMode('修復 credential 外洩漏洞');
    assert.equal(result.suggestedMode, 'beam');
  });

  it('suggests cit with forceBranch for pros/cons analysis', () => {
    const result = classifyThinkingMode('分析 Smart MCP 的優缺點');
    assert.equal(result.suggestedMode, 'cit');
    assert.equal(result.forceBranch, true);
  });

  it('suggests cit with forceBranch for comparison tasks', () => {
    const result = classifyThinkingMode('比較兩個工具的差異');
    assert.equal(result.suggestedMode, 'cit');
    assert.equal(result.forceBranch, true);
  });

  it('suggests cit for why/how questions', () => {
    const result = classifyThinkingMode('為什麼這個函數會報錯？');
    assert.equal(result.suggestedMode, 'cit');
  });

  it('suggests null for simple search tasks', () => {
    const result = classifyThinkingMode('搜尋 foo');
    assert.equal(result.suggestedMode, null);
  });

  it('suggests cit for long tasks without explicit mode', () => {
    const result = classifyThinkingMode('這是一個比較長的任務描述，用來測試自動建議');
    assert.equal(result.suggestedMode, 'cit');
  });

  it('preserves currentMode when no rule matches', () => {
    const result = classifyThinkingMode('簡單任務', 'beam');
    assert.equal(result.suggestedMode, 'beam');
  });
});

describe('detectOverconfidence', () => {
  it('detects overconfidence when CIT says no branch for comparison task', () => {
    const result = detectOverconfidence(
      '分析 smart_exa_search 和 smart_eda_search 的差異',
      '不需要分支',
      false,
      'cit'
    );
    assert.equal(result.overconfident, true);
    assert.equal(result.suggestedUpgrade, 'beam');
    assert.ok(result.reason.includes('過度自信'));
  });

  it('does NOT trigger for simple tasks', () => {
    const result = detectOverconfidence(
      '查詢天氣',
      '不需要分支',
      false,
      'cit'
    );
    assert.equal(result.overconfident, false);
  });

  it('does NOT trigger when CIT says branching is needed', () => {
    const result = detectOverconfidence(
      '分析優缺點',
      '需要分支',
      true,
      'cit'
    );
    assert.equal(result.overconfident, false);
  });

  it('does NOT trigger for non-CIT modes', () => {
    const result = detectOverconfidence(
      '分析優缺點',
      '',
      false,
      'beam'
    );
    assert.equal(result.overconfident, false);
  });

  it('detects overconfidence for MCP protocol vs individual analysis', () => {
    const result = detectOverconfidence(
      '分析 MCP 協議層 vs Smart MCP 個體的差異',
      '不需要分支',
      false,
      'cit'
    );
    assert.equal(result.overconfident, true);
    assert.ok(result.reason.includes('協議'));
  });
});

describe('enhanceVerifyStage', () => {
  it('adds scope questions to verify text', () => {
    const result = enhanceVerifyStage('檢查結論', '分析任務');
    assert.ok(result.includes('範圍限定檢查'));
    assert.ok(result.includes('適用範圍'));
    assert.ok(result.includes('反向測試'));
  });

  it('adds complementarity checklist when thought mentions comparison', () => {
    const result = enhanceVerifyStage('驗證', '比較兩個工具的差異');
    assert.ok(result.includes('互補 vs 重疊判定'));
    assert.ok(result.includes('資料源是否相同'));
  });

  it('does NOT add complementarity checklist for non-comparison tasks', () => {
    const result = enhanceVerifyStage('驗證', '簡單任務');
    assert.ok(!result.includes('互補 vs 重疊判定'));
  });

  it('preserves original verify text', () => {
    const result = enhanceVerifyStage('我的驗證內容', '任務');
    assert.ok(result.startsWith('我的驗證內容'));
  });
});

describe('constants', () => {
  it('SCOPE_QUESTIONS has 3 items', () => {
    assert.equal(SCOPE_QUESTIONS.length, 3);
  });

  it('COMPLEMENTARITY_CHECKLIST has 4 items', () => {
    assert.equal(COMPLEMENTARITY_CHECKLIST.length, 4);
  });

  it('DEVILS_ADVOCATE has pro and con', () => {
    assert.ok(DEVILS_ADVOCATE.pro);
    assert.ok(DEVILS_ADVOCATE.con);
  });
});
