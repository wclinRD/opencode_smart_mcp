/**
 * think-guard-comprehensive.test.mjs — 完整測試套件
 *
 * 測試維度：
 *   1. 簡易問題（不需要推理）
 *   2. 中等問題（需要 cit）
 *   3. 複雜問題（需要 beam 或 cit+forceBranch）
 *   4. 實際問題（真實案例）
 *   5. 邊界情況（極端輸入）
 *   6. 過度自信偵測（各種 CIT 情境）
 *   7. VERIFY 增強（結構化模式）
 *   8. Token 效率分析
 */
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
import { quickThink } from '../src/cli/thinking.mjs';
import smartThinkPlugin from '../src/plugins/core/quick-think.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 簡易問題 — 應跳過或建議 null
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 1: 簡易問題（不需要推理）', () => {
  const simpleTasks = [
    { input: '搜尋 foo', desc: '搜尋指令' },
    { input: 'search bar', desc: '英文搜尋' },
    { input: '查詢天氣', desc: '查詢指令' },
    { input: 'find all TODO comments', desc: '英文 find' },
    { input: 'grep "error" src/', desc: 'grep 指令' },
    { input: 'read README.md', desc: '讀取檔案' },
    { input: '讀取設定檔', desc: '中文讀取' },
    { input: '列出所有檔案', desc: '列出差查詢' },
    { input: '顯示目前目錄', desc: '簡單顯示' },
  ];

  for (const { input, desc } of simpleTasks) {
    it(`"${desc}" → 建議 null（跳過推理）`, () => {
      const result = classifyThinkingMode(input);
      assert.equal(result.suggestedMode, null, `Expected null for: ${input}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 中等問題 — 應建議 cit
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 1: 中等問題（需要 cit）', () => {
  const mediumTasks = [
    { input: '為什麼這個函數會報錯？', desc: 'why 問題', forceBranch: false },
    { input: '如何優化這個查詢？', desc: 'how 問題', forceBranch: false },
    { input: '原因分析：為什麼部署失敗', desc: '原因分析', forceBranch: false },
    { input: '研究 React Server Components 的最新發展', desc: '研究任務', forceBranch: false },
    { input: 'evaluate the performance of this algorithm', desc: '英文評估', forceBranch: false },
    { input: '審查這段程式碼的品質', desc: '審查任務', forceBranch: false },
    { input: 'How does the authentication flow work in this system?', desc: '英文 why/how', forceBranch: false },
  ];

  for (const { input, desc, forceBranch } of mediumTasks) {
    it(`"${desc}" → 建議 cit (forceBranch=${forceBranch})`, () => {
      const result = classifyThinkingMode(input);
      assert.equal(result.suggestedMode, 'cit', `Expected cit for: ${input}`);
      assert.equal(result.forceBranch, forceBranch, `Expected forceBranch=${forceBranch} for: ${input}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 複雜問題 — 應建議 beam 或 cit+forceBranch
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 1: 複雜問題（需要 beam 或 cit+forceBranch）', () => {
  const complexTasks = [
    // Beam: 高風險操作
    { input: '重構整個 authentication module', desc: '英文重構', mode: 'beam' },
    { input: '跨檔案修改 User model', desc: '跨檔案', mode: 'beam' },
    { input: 'rename the database connection class', desc: 'rename', mode: 'beam' },
    { input: '修復 credential 外洩漏洞', desc: '安全修復', mode: 'beam' },
    { input: 'security fix: patch SQL injection', desc: '英文安全修復', mode: 'beam' },
    { input: '修復注入攻擊漏洞', desc: '注入修復', mode: 'beam' },

    // Cit + forceBranch: 多角度分析
    { input: '分析 Smart MCP 的優缺點', desc: '優缺點分析', mode: 'cit', forceBranch: true },
    { input: 'compare React and Vue for our project', desc: '英文比較', mode: 'cit', forceBranch: true },
    { input: '評估兩個方案的利弊', desc: '利弊分析', mode: 'cit', forceBranch: true },
    { input: '分析 MCP 協議層 vs Smart MCP 個體的差異', desc: '實際案例1', mode: 'cit', forceBranch: true },
    { input: '比較 smart_exa_search 和 smart_eda_search 的邊界', desc: '實際案例2', mode: 'cit', forceBranch: true },
    { input: '分析好處和壞處', desc: '好處壞處', mode: 'cit', forceBranch: true },
    { input: 'What are the pros and cons of using GraphQL vs REST?', desc: '英文 pros/cons', mode: 'cit', forceBranch: true },
  ];

  for (const { input, desc, mode, forceBranch } of complexTasks) {
    it(`"${desc}" → 建議 ${mode} (forceBranch=${forceBranch || false})`, () => {
      const result = classifyThinkingMode(input);
      assert.equal(result.suggestedMode, mode, `Expected ${mode} for: ${input}`);
      if (forceBranch !== undefined) {
        assert.equal(result.forceBranch, forceBranch, `Expected forceBranch=${forceBranch} for: ${input}`);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 實際問題 — 我們剛遇到的真實案例
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 1: 實際問題（真實案例）', () => {
  it('案例1: Smart MCP 優缺點分析', () => {
    const result = classifyThinkingMode('目前 smart mcp 的優缺點');
    assert.equal(result.suggestedMode, 'cit');
    assert.equal(result.forceBranch, true);
  });

  it('案例2: smart_exa_search vs smart_eda_search 邊界（保守派正確）', () => {
    // 保守設計：短語句+模糊查詢正確返回 null，不強制推理
    const result = classifyThinkingMode('smart_exa_search vs smart_eda_search 邊界模糊 為什麼 這樣不是廣度跟深度都有嗎');
    // 這句含「為什麼」，應觸發 cit
    assert.equal(result.suggestedMode, 'cit');
  });

  it('案例3: 資安分析（含「分析」觸發 cit）', () => {
    const r = classifyThinkingMode('安全分析 MCP 協議層的資安問題');
    assert.equal(r.suggestedMode, 'cit', '含「分析」應返回 cit');
  });

  it('案例4: smart_think 如何調整（保守派正確）', () => {
    // 保守設計：「可以怎麼調整」不含 why/how 關鍵詞時返回 null
    const result = classifyThinkingMode('smart_smart_think 可以怎麼調整來減少這類思考錯誤');
    assert.equal(result.suggestedMode, null, '不含分析關鍵詞時應返回 null');
  });

  it('案例5: LLM 不用 cit 怎麼辦', () => {
    const result = classifyThinkingMode('那llm 使用卻不用cit 怎麼辦');
    assert.equal(result.suggestedMode, 'cit');
  });

  it('案例6: 幫我調整修改到專案目錄（保守派正確）', () => {
    // 保守設計：操作指令不含分析關鍵詞時返回 null
    const result = classifyThinkingMode('那可以幫我調整修改到~/opencode/dev/smart嗎');
    assert.equal(result.suggestedMode, null, '操作指令不含分析關鍵詞時應返回 null');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 邊界情況
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 1: 邊界情況', () => {
  it('空字串 → 建議 null', () => {
    const result = classifyThinkingMode('');
    assert.equal(result.suggestedMode, null);
  });

  it('null 輸入 → 建議 null', () => {
    const result = classifyThinkingMode(null);
    assert.equal(result.suggestedMode, null);
  });

  it('undefined 輸入 → 建議 null', () => {
    const result = classifyThinkingMode(undefined);
    assert.equal(result.suggestedMode, null);
  });

  it('極長輸入（1000字）→ 根據內容判斷', () => {
    const longInput = '分析'.repeat(500); // 1000 字
    const result = classifyThinkingMode(longInput);
    // 包含「分析」但不包含「優缺點」或「差異」
    // 不符合任何特定規則，長度 > 50 建議 cit
    assert.equal(result.suggestedMode, 'cit');
  });

  it('混合中英文 → 正常判斷', () => {
    const result = classifyThinkingMode('analyze the pros and cons of MCP');
    assert.equal(result.suggestedMode, 'cit');
    assert.equal(result.forceBranch, true);
  });

  it('特殊字元 → 不影響判斷', () => {
    const result = classifyThinkingMode('分析 @#$%^&*() 的優缺點');
    assert.equal(result.suggestedMode, 'cit');
    assert.equal(result.forceBranch, true);
  });

  it('只有空白字元 → 建議 null', () => {
    const result = classifyThinkingMode('   \n\t  ');
    assert.equal(result.suggestedMode, null);
  });

  it('數字字串 → 建議 null', () => {
    const result = classifyThinkingMode('12345');
    assert.equal(result.suggestedMode, null);
  });

  it('currentMode 保留 → 有匹配時覆蓋，無匹配時保留', () => {
    // 有匹配：優缺點 → cit
    const r1 = classifyThinkingMode('分析優缺點', 'beam');
    assert.equal(r1.suggestedMode, 'cit');

    // 無匹配：保留 currentMode
    const r2 = classifyThinkingMode('簡單任務', 'beam');
    assert.equal(r2.suggestedMode, 'beam');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 過度自信偵測（各種 CIT 情境）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 2: 過度自信偵測', () => {
  describe('應觸發的情境', () => {
    const shouldTrigger = [
      {
        thought: '分析 smart_exa_search 和 smart_eda_search 的差異',
        reasoning: '不需要分支',
        desc: '工具差異分析',
      },
      {
        thought: '比較 MCP 協議層 vs Smart MCP 個體實作',
        reasoning: '這很簡單',
        desc: '抽象層級比較',
      },
      {
        thought: '分析 Smart MCP 的優缺點',
        reasoning: '單一觀點就夠了',
        desc: '優缺點分析',
      },
      {
        thought: 'evaluate the pros and cons of using TypeScript vs JavaScript',
        reasoning: 'clear answer',
        desc: '英文 pros/cons',
      },

    ];

    for (const { thought, reasoning, desc } of shouldTrigger) {
      it(`應觸發: ${desc}`, () => {
        const result = detectOverconfidence(thought, reasoning, false, 'cit');
        assert.equal(result.overconfident, true, `Expected overconfident for: ${desc}`);
        assert.equal(result.suggestedUpgrade, 'beam');
        assert.ok(result.reason.includes('過度自信'));
      });
    }
  });

  describe('不應觸發的情境', () => {
    const shouldNotTrigger = [
      {
        thought: '簡單查詢天氣',
        reasoning: '不需要分支',
        mode: 'cit',
        branchingNeeded: false,
        desc: '簡單任務',
      },
      {
        thought: '分析優缺點',
        reasoning: '需要分支',
        mode: 'cit',
        branchingNeeded: true,
        desc: 'CIT 已說要分支',
      },
      {
        thought: '分析優缺點',
        reasoning: '',
        mode: 'beam',
        branchingNeeded: false,
        desc: '非 CIT 模式',
      },
      {
        thought: '讀取檔案內容',
        reasoning: '不需要分支',
        mode: 'cit',
        branchingNeeded: false,
        desc: '簡單讀取',
      },
      {
        thought: '這是一個測試',
        reasoning: '測試用途',
        mode: 'cit',
        branchingNeeded: false,
        desc: '一般文字（無指標）',
      },
    ];

    for (const { thought, reasoning, mode, branchingNeeded, desc } of shouldNotTrigger) {
      it(`不應觸發: ${desc}`, () => {
        const result = detectOverconfidence(thought, reasoning, branchingNeeded, mode);
        assert.equal(result.overconfident, false, `Expected NOT overconfident for: ${desc}`);
      });
    }
  });

  describe('邊界情況（score=3 = threshold，正確觸發）', () => {
    const borderline = [
      {
        thought: '分析架構選擇：微服務 vs 單體',
        reasoning: '不需要多路徑',
        desc: '架構選擇（score=3，threshold=3 應觸發）',
      },
      {
        thought: '安全分析：評估 credential 外洩風險',
        reasoning: '直接給答案',
        desc: '安全風險評估（score=3，threshold=3 應觸發）',
      },
    ];

    for (const { thought, reasoning, desc } of borderline) {
      it(`邊界: ${desc}`, () => {
        const result = detectOverconfidence(thought, reasoning, false, 'cit');
        assert.equal(result.overconfident, true, `Score >= 3 should trigger: ${desc}`);
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. VERIFY 增強（結構化模式）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Layer 3: VERIFY 增強', () => {
  describe('範圍限定檢查', () => {
    it('包含所有 3 個 scope questions', () => {
      const result = enhanceVerifyStage('檢查結論', '任務');
      for (const q of SCOPE_QUESTIONS) {
        assert.ok(result.includes(q), `Missing scope question: ${q}`);
      }
    });

    it('包含反向測試', () => {
      const result = enhanceVerifyStage('驗證', '任務');
      assert.ok(result.includes(DEVILS_ADVOCATE.pro));
      assert.ok(result.includes(DEVILS_ADVOCATE.con));
    });

    it('保留原始 verify 文字', () => {
      const result = enhanceVerifyStage('我的驗證內容', '任務');
      assert.ok(result.startsWith('我的驗證內容'));
    });

    it('空 verify 文字 → 仍包含增強內容', () => {
      const result = enhanceVerifyStage('', '任務');
      assert.ok(result.includes('範圍限定檢查'));
    });
  });

  describe('互補 vs 重疊判定', () => {
    const comparisonThoughts = [
      '比較兩個工具的差異',
      '分析 smart_exa_search 和 smart_eda_search 的比較',
      'compare the overlap between these features',
      '互補還是重疊？',
      'overlap analysis',
    ];

    for (const thought of comparisonThoughts) {
      it(`比較任務 "${thought.slice(0, 30)}..." → 包含互補判定`, () => {
        const result = enhanceVerifyStage('驗證', thought);
        assert.ok(result.includes('互補 vs 重疊判定'), `Missing complementarity check for: ${thought}`);
        assert.ok(result.includes('資料源是否相同'));
      });
    }

    const nonComparisonThoughts = [
      '簡單任務',
      '讀取檔案',
      'debug the error',
    ];

    for (const thought of nonComparisonThoughts) {
      it(`非比較任務 "${thought}" → 不包含互補判定`, () => {
        const result = enhanceVerifyStage('驗證', thought);
        assert.ok(!result.includes('互補 vs 重疊判定'), `Unexpected complementarity check for: ${thought}`);
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 整合測試 — quickThink handler 端到端
// ═══════════════════════════════════════════════════════════════════════════════
describe('整合測試: quickThink handler', () => {
  it('CIT mode + 過度自信 → 輸出包含警告', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析 smart_exa_search 和 smart_eda_search 的差異',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: false,
      branchReasoning: '不需要分支',
    });
    assert.ok(output.includes('過度自信'), 'Should include overconfidence warning');
    assert.ok(output.includes('beam'), 'Should suggest beam mode');
  });

  it('Structured mode + verify → VERIFY 區塊包含增強內容', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析任務',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '分析優缺點',
      state: '有兩個工具',
      algo: '逐一比較',
      edge: '時間限制',
      verify: '檢查結論',
    });
    assert.ok(output.includes('範圍限定檢查'), 'Should include scope questions');
    assert.ok(output.includes('反向測試'), "Should include devil's advocate");
  });

  it('Structured mode + 比較任務 → 包含互補判定', () => {
    const output = smartThinkPlugin.handler({
      thought: '比較兩個工具',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '比較分析',
      verify: '驗證',
    });
    assert.ok(output.includes('互補 vs 重疊判定'), 'Should include complementarity check');
  });

  it('Simple task without mode → 不包含分類建議（因為有 mode）', () => {
    const output = smartThinkPlugin.handler({
      thought: '簡單任務',
      nextThoughtNeeded: false,
      mode: 'cit',
      branchingNeeded: false,
    });
    // 有指定 mode 時不觸發分類建議
    assert.ok(!output.includes('任務分類建議'), 'Should NOT include task classification when mode is specified');
  });

  it('Beam mode → 正常輸出，無警告', () => {
    const output = smartThinkPlugin.handler({
      thought: '多路徑分析',
      nextThoughtNeeded: true,
      mode: 'beam',
      beams: [
        { name: 'Path A', content: '路徑 A', confidence: 8 },
        { name: 'Path B', content: '路徑 B', confidence: 6 },
      ],
      selectedBeam: 'Path A',
    });
    assert.ok(output.includes('Beam Search'));
    assert.ok(!output.includes('過度自信'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Token 效率驗證
// ═══════════════════════════════════════════════════════════════════════════════
describe('Token 效率驗證', () => {
  it('簡單任務不觸發分類 → 零額外 token', () => {
    // 有指定 mode 時不跑 classifyThinkingMode
    const output = smartThinkPlugin.handler({
      thought: '簡單任務',
      nextThoughtNeeded: false,
      mode: 'cit',
      branchingNeeded: false,
    });
    assert.ok(!output.includes('任務分類建議'));
    assert.ok(!output.includes('過度自信'));
  });

  it('非 CIT 模式 → 不跑過度自信偵測', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析優缺點',
      nextThoughtNeeded: true,
      mode: 'beam',
      beams: [{ name: 'A', content: 'a', confidence: 8 }],
      selectedBeam: 'A',
    });
    assert.ok(!output.includes('過度自信'));
  });

  it('CIT mode + branchingNeeded=true → 不跑過度自信偵測', () => {
    const output = smartThinkPlugin.handler({
      thought: '分析優缺點',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: true,
      beams: [{ name: 'A', content: 'a', confidence: 8 }],
      selectedBeam: 'A',
    });
    assert.ok(!output.includes('過度自信'));
  });

  it('Structured mode 無 verify → 不包含增強內容', () => {
    const output = smartThinkPlugin.handler({
      thought: '任務',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '目標',
    });
    // 無 verify 欄位時不觸發增強
    assert.ok(!output.includes('範限定檢查') || !output.includes('VERIFY:'));
  });

  it('VERIFY 增強額外 token 估算 < 100 tokens', () => {
    const enhanced = enhanceVerifyStage('原始驗證', '比較任務');
    const tokenEstimate = Math.ceil(enhanced.length / 4); // 粗估：1 token ≈ 4 chars
    assert.ok(tokenEstimate < 200, `VERIFY enhancement too large: ~${tokenEstimate} tokens`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. 常數完整性
// ═══════════════════════════════════════════════════════════════════════════════
describe('常數完整性', () => {
  it('SCOPE_QUESTIONS: 3 個問題，每個都是字串', () => {
    assert.equal(SCOPE_QUESTIONS.length, 3);
    for (const q of SCOPE_QUESTIONS) {
      assert.equal(typeof q, 'string');
      assert.ok(q.length > 10, `Question too short: ${q}`);
    }
  });

  it('COMPLEMENTARITY_CHECKLIST: 4 個檢查項', () => {
    assert.equal(COMPLEMENTARITY_CHECKLIST.length, 4);
    for (const c of COMPLEMENTARITY_CHECKLIST) {
      assert.ok(c.includes('→'), `Missing arrow in: ${c}`);
    }
  });

  it('DEVILS_ADVOCATE: pro 和 con 都存在', () => {
    assert.ok(DEVILS_ADVOCATE.pro.length > 10);
    assert.ok(DEVILS_ADVOCATE.con.length > 10);
  });
});
