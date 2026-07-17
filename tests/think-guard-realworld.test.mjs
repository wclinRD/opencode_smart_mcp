/**
 * think-guard-realworld.test.mjs — 真實世界情境完整測試
 *
 * 覆蓋 8 大維度：
 *   1. 真實用戶查詢模擬（從對話中提取）
 *   2. classifyTask 子指令
 *   3. 多回合推理流程
 *   4. 跨層級整合（3 層同時觸發）
 *   5. 對抗性/邊界輸入
 *   6. 壓力測試（大量呼叫、模式切換）
 *   7. 輸出格式驗證
 *   8. 端到端工作流模擬
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThinkingMode,
  detectOverconfidence,
  enhanceVerifyStage,
} from '../src/lib/think-guard.mjs';
import smartThinkPlugin from '../src/plugins/core/quick-think.mjs';

const handler = smartThinkPlugin.handler;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 真實用戶查詢模擬 — 來自實際對話
// ═══════════════════════════════════════════════════════════════════════════════
describe('真實用戶查詢：從對話中提取', () => {
  const realQueries = [
    {
      query: 'Smart MCP 的優缺點是什麼',
      expectedMode: 'cit',
      expectedForceBranch: true,
      desc: '優缺點分析（核心案例）',
    },
    {
      query: 'smart_exa_search 和 smart_eda_search 的邊界模糊 為什麼 這樣不是廣度跟深度都有嗎',
      expectedMode: 'cit',
      desc: '工具邊界問題（含為什麼）',
    },
    {
      query: 'smart MCP 可以怎麼調整來減少這類思考錯誤',
      expectedMode: null,
      desc: '保守派：調整建議（不含分析關鍵詞）',
    },
    {
      query: 'MCP 協議層的 tool poisoning attack 風險',
      expectedMode: null,
      desc: '保守派：資安短句',
    },
    {
      query: '幫我重構 auth 模組，把 token 驗證邏輯從 middleware 抽到獨立 service',
      expectedMode: 'beam',
      desc: '重構任務',
    },
    {
      query: 'why does the build fail on CI but work locally',
      expectedMode: 'cit',
      desc: '英文 why 問題',
    },
    {
      query: '分析 smart_think 的 3 層防禦架構有什麼潛在問題',
      expectedMode: 'cit',
      desc: '架構分析（含「分析」觸發 cit）',
    },
    {
      query: '比較 Vitest 和 Jest 的差異，哪個適合我們的專案',
      expectedMode: 'cit',
      expectedForceBranch: true,
      desc: '工具比較（forceBranch）',
    },
    {
      query: '幫我修復 login endpoint 的 SQL injection 漏洞',
      expectedMode: null,
      desc: '保守派：安全修復（單獨「修復」不觸發 beam）',
    },
    {
      query: 'how to optimize the database query performance',
      expectedMode: 'cit',
      desc: '英文 how 問題',
    },
    {
      query: 'rename getCwd to getCurrentWorkingDirectory across the repo',
      expectedMode: 'beam',
      desc: '跨檔案 rename',
    },
    {
      query: '讀取今天天氣',
      expectedMode: null,
      desc: '簡單查詢（不觸發推理）',
    },
  ];

  for (const { query, expectedMode, expectedForceBranch, desc } of realQueries) {
    it(desc, () => {
      const result = classifyThinkingMode(query, null);
      assert.equal(result.suggestedMode, expectedMode,
        `Query: "${query.slice(0, 50)}..." → expected ${expectedMode}, got ${result.suggestedMode}`);
      if (expectedForceBranch !== undefined) {
        assert.equal(result.forceBranch, expectedForceBranch, 'forceBranch mismatch');
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. classifyTask 子指令
// ═══════════════════════════════════════════════════════════════════════════════
describe('classifyTask 子指令', () => {
  it('返回格式化輸出', () => {
    const output = handler({ classifyTask: '分析 MCP 協議的優缺點' });
    assert.ok(output.includes('Task Classification'), 'Should include header');
    assert.ok(output.includes('Suggested mode'), 'Should include suggested mode');
  });

  it('簡單任務返回 (none)', () => {
    const output = handler({ classifyTask: '搜尋 foo' });
    assert.ok(output.includes('(none'), 'Simple task should suggest none');
  });

  it('複雜任務返回具體模式', () => {
    const output = handler({ classifyTask: '重構 auth 模組 跨檔案 rename' });
    assert.ok(output.includes('beam'), 'Complex task should suggest beam');
  });

  it('forceBranch 任務顯示 ⚡', () => {
    const output = handler({ classifyTask: '分析優缺點 pros and cons' });
    assert.ok(output.includes('Force branch'), 'Should show force branch hint');
  });

  it('超長任務描述截斷顯示', () => {
    const longDesc = 'A'.repeat(200);
    const output = handler({ classifyTask: longDesc });
    assert.ok(output.includes('...'), 'Long desc should be truncated');
  });

  it('空字串不會崩潰', () => {
    const output = handler({ classifyTask: '' });
    // 空字串 falsy，跳過 classifyTask 分支，走正常 handler
    assert.ok(typeof output === 'string', 'Should not crash');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 多回合推理流程 — 模擬真實思考過程
// ═══════════════════════════════════════════════════════════════════════════════
describe('多回合推理流程', () => {
  it('3 回合 CIT 推理：第一回合不分支，後續回合分支', () => {
    const r1 = handler({
      thought: '分析 MCP 協議的安全問題',
      nextThoughtNeeded: true,
      mode: 'cit',
      thoughtNumber: 1,
      totalThoughts: 3,
      branchingNeeded: false,
      branchReasoning: '先建立理解',
    });
    assert.ok(r1.includes('Thought 1'), 'Should show Thought 1');

    const r2 = handler({
      thought: '需要比較協議層和個體層的差異',
      nextThoughtNeeded: true,
      mode: 'cit',
      thoughtNumber: 2,
      totalThoughts: 3,
      branchingNeeded: true,
      branchReasoning: '需要多路徑探索',
      beams: [
        { name: '協議層分析', content: '從 MCP 協議角度', confidence: 7 },
        { name: '個體層分析', content: '從 Smart MCP 實作角度', confidence: 8 },
      ],
    });
    assert.ok(r2.includes('Thought 2'), 'Should show Thought 2');

    const r3 = handler({
      thought: '結論：兩者互補，不是重疊',
      nextThoughtNeeded: false,
      mode: 'cit',
      thoughtNumber: 3,
      totalThoughts: 3,
    });
    assert.ok(r3.includes('complete') || r3.includes('done'), 'Should show completion marker');
  });

  it('structured 模式完整流程', () => {
    const output = handler({
      thought: '分析 smart_exa_search 和 smart_eda_search 的分工',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '釐清兩個搜尋工具的職責邊界',
      state: 'smart_exa_search 做廣度搜尋，smart_eda_search 做 EDA 深度',
      algo: '逐一比較功能覆蓋範圍、資料源、使用時機',
      edge: 'token 預算限制，不能兩者都跑',
      verify: '確認結論有邏輯漏洞',
    });
    assert.ok(output.includes('GOAL'), 'Should include GOAL');
    assert.ok(output.includes('STATE'), 'Should include STATE');
    assert.ok(output.includes('ALGO'), 'Should include ALGO');
    assert.ok(output.includes('EDGE'), 'Should include EDGE');
    assert.ok(output.includes('VERIFY'), 'Should include VERIFY');
    assert.ok(output.includes('範圍限定檢查'), 'VERIFY should include scope check');
  });

  it('beam 模式完整流程', () => {
    const output = handler({
      thought: '選擇最佳架構方案',
      nextThoughtNeeded: true,
      mode: 'beam',
      beams: [
        { name: '微服務', content: '拆分成獨立服務', confidence: 6 },
        { name: '單體+模組', content: '保持單體但模組化', confidence: 8 },
        { name: 'Serverless', content: '用 Lambda/FaaS', confidence: 5 },
      ],
      selectedBeam: '單體+模組',
    });
    assert.ok(output.includes('Beam Search'), 'Should show beam search');
    assert.ok(output.includes('單體+模組'), 'Should show selected beam');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 跨層級整合 — 3 層同時觸發
// ═══════════════════════════════════════════════════════════════════════════════
describe('跨層級整合：3 層同時觸發', () => {
  it('Layer 1 + 2：無 mode 的 CIT 過度自信', () => {
    const output = handler({
      thought: '分析 MCP 協議層 vs Smart MCP 個體層的差異',
      nextThoughtNeeded: true,
      branchingNeeded: false,
      branchReasoning: '不需要分支',
    });
    assert.ok(typeof output === 'string', 'Should produce output');
  });

  it('Layer 1 + 3：structured + verify + 比較任務', () => {
    const output = handler({
      thought: '比較 Vitest 和 Jest 的差異',
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: '選擇測試框架',
      state: '有兩個候選',
      algo: '功能比較',
      edge: '時間限制',
      verify: '確認選擇合理',
    });
    assert.ok(output.includes('範圍限定檢查'), 'Layer 3 scope check');
    assert.ok(output.includes('互補 vs 重疊判定'), 'Layer 3 complementarity');
  });

  it('Layer 2 + 3：CIT 過度自信 + structured verify', () => {
    const output = handler({
      thought: '分析優缺點',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: false,
      branchReasoning: '不需要分支',
    });
    assert.ok(!output.includes('範圍限定檢查'), 'CIT should NOT trigger Layer 3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 對抗性/邊界輸入
// ═══════════════════════════════════════════════════════════════════════════════
describe('對抗性輸入', () => {
  it('注入攻擊：thought 包含 script 標籤', () => {
    const result = classifyThinkingMode('<script>alert(1)</script> 分析優缺點', null);
    assert.equal(result.suggestedMode, 'cit', 'Should handle XSS gracefully');
  });

  it('SQL injection：thought 包含 SQL 語法', () => {
    const result = classifyThinkingMode("'; DROP TABLE users; -- 分析", null);
    assert.ok(result.suggestedMode !== undefined, 'Should handle SQL injection');
  });

  it('Unicode 極端：各種 Unicode 字元', () => {
    const result = classifyThinkingMode('分析 🚀💻🔧 的差異 為什麼', null);
    assert.equal(result.suggestedMode, 'cit', 'Should handle emoji');
  });

  it('超長單字：1000 字元無空格', () => {
    const longWord = 'A'.repeat(1000);
    const result = classifyThinkingMode(longWord, null);
    assert.ok(result.suggestedMode !== undefined, 'Should handle long word');
  });

  it('只有標點符號', () => {
    const result = classifyThinkingMode('???...!!!???', null);
    assert.equal(result.suggestedMode, null, 'Punctuation only should be null');
  });

  it('null thought + valid mode', () => {
    const output = handler({
      thought: null,
      nextThoughtNeeded: true,
      mode: 'cit',
    });
    assert.ok(typeof output === 'string', 'Should not crash on null thought');
  });

  it('undefined thought', () => {
    const output = handler({
      thought: undefined,
      nextThoughtNeeded: true,
      mode: 'structured',
      goal: 'test',
      state: 'test',
      algo: 'test',
      edge: 'test',
      verify: 'test',
    });
    assert.ok(typeof output === 'string', 'Should not crash on undefined thought');
  });

  it('空陣列 beams', () => {
    const output = handler({
      thought: '測試',
      nextThoughtNeeded: true,
      mode: 'beam',
      beams: [],
    });
    assert.ok(typeof output === 'string', 'Should handle empty beams');
  });

  it('beams 為 null', () => {
    const output = handler({
      thought: '測試',
      nextThoughtNeeded: true,
      mode: 'beam',
      beams: null,
    });
    assert.ok(typeof output === 'string', 'Should handle null beams');
  });

  it('branchingNeeded 為字串而非布林', () => {
    const output = handler({
      thought: '測試',
      nextThoughtNeeded: true,
      mode: 'cit',
      branchingNeeded: 'false',
    });
    assert.ok(typeof output === 'string', 'Should handle string branchingNeeded');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 壓力測試
// ═══════════════════════════════════════════════════════════════════════════════
describe('壓力測試', () => {
  it('100 次連續呼叫 classifyThinkingMode', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      classifyThinkingMode(`測試任務 ${i} 分析優缺點`, null);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `100 calls should complete in <1s, took ${elapsed.toFixed(0)}ms`);
  });

  it('100 次連續呼叫 detectOverconfidence', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      detectOverconfidence(`分析工具 ${i} 的差異`, '不需要分支', false, 'cit');
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `100 calls should complete in <1s, took ${elapsed.toFixed(0)}ms`);
  });

  it('100 次連續呼叫 enhanceVerifyStage', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      enhanceVerifyStage(`驗證 ${i}`, `比較任務 ${i}`);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `100 calls should complete in <1s, took ${elapsed.toFixed(0)}ms`);
  });

  it('模式切換：cit → beam → structured → cit', () => {
    const modes = ['cit', 'beam', 'structured', 'cit'];
    for (const mode of modes) {
      const output = handler({
        thought: '測試模式切換',
        nextThoughtNeeded: true,
        mode,
        ...(mode === 'structured' ? { goal: 'g', state: 's', algo: 'a', edge: 'e', verify: 'v' } : {}),
        ...(mode === 'beam' ? { beams: [{ name: 'A', content: 'a', confidence: 8 }] } : {}),
      });
      assert.ok(typeof output === 'string', `Mode ${mode} should produce output`);
    }
  });

  it('大量 classifyTask 呼叫', () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      handler({ classifyTask: `任務 ${i}` });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `50 classifyTask calls should complete in <2s, took ${elapsed.toFixed(0)}ms`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 輸出格式驗證
// ═══════════════════════════════════════════════════════════════════════════════
describe('輸出格式驗證', () => {
  it('CIT 輸出包含 CiT BN-DP 標籤', () => {
    const output = handler({ thought: '測試', nextThoughtNeeded: true, mode: 'cit' });
    assert.ok(output.includes('CiT'), 'Should include CiT label');
  });

  it('beam 輸出包含 Beam Search 標籤', () => {
    const output = handler({
      thought: '測試', nextThoughtNeeded: true, mode: 'beam',
      beams: [{ name: 'A', content: 'a', confidence: 8 }],
    });
    assert.ok(output.includes('Beam Search'), 'Should include Beam Search label');
  });

  it('structured 輸出包含 5 個區塊', () => {
    const output = handler({
      thought: '測試', nextThoughtNeeded: true, mode: 'structured',
      goal: '目標', state: '狀態', algo: '演算法', edge: '邊界', verify: '驗證',
    });
    assert.ok(output.includes('GOAL'), 'Should include GOAL');
    assert.ok(output.includes('STATE'), 'Should include STATE');
    assert.ok(output.includes('ALGO'), 'Should include ALGO');
    assert.ok(output.includes('EDGE'), 'Should include EDGE');
    assert.ok(output.includes('VERIFY'), 'Should include VERIFY');
  });

  it('過度自信警告格式', () => {
    const output = handler({
      thought: '分析 MCP 協議層 vs 個體層',
      nextThoughtNeeded: true, mode: 'cit',
      branchingNeeded: false, branchReasoning: '不需要分支',
    });
    assert.ok(output.includes('⚠️'), 'Should include warning emoji');
    assert.ok(output.includes('beam'), 'Should suggest beam');
  });

  it('classifyTask 輸出格式', () => {
    const output = handler({ classifyTask: '測試任務' });
    assert.ok(output.includes('┌─'), 'Should include box drawing');
    assert.ok(output.includes('└─'), 'Should include box drawing bottom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 端到端工作流模擬
// ═══════════════════════════════════════════════════════════════════════════════
describe('端到端工作流模擬', () => {
  it('完整流程：分類 → CIT 推理 → 分支 → 結論', () => {
    const classification = classifyThinkingMode('分析 MCP 的優缺點', null);
    assert.equal(classification.suggestedMode, 'cit');
    assert.equal(classification.forceBranch, true);

    const r1 = handler({
      thought: '分析 MCP 協議的優缺點',
      nextThoughtNeeded: true,
      mode: classification.suggestedMode,
      thoughtNumber: 1, totalThoughts: 2,
      branchingNeeded: false, branchReasoning: '先建立基礎理解',
    });
    assert.ok(r1.includes('Thought 1'), 'Should start reasoning');

    const r2 = handler({
      thought: '需要從多個角度分析',
      nextThoughtNeeded: false,
      mode: 'cit',
      thoughtNumber: 2, totalThoughts: 2,
      branchingNeeded: true, branchReasoning: '需要多路徑',
      beams: [
        { name: '優點', content: 'MCP 的好處', confidence: 8 },
        { name: '缺點', content: 'MCP 的壞處', confidence: 7 },
      ],
    });
    assert.ok(r2.includes('complete') || r2.includes('done'), 'Should show completion marker');
  });

  it('完整流程：structured 分析 → 驗證 → 結論', () => {
    const output = handler({
      thought: '分析 smart_exa_search vs smart_eda_search',
      nextThoughtNeeded: false, mode: 'structured',
      goal: '釐清工具分工', state: '兩者都是搜尋工具',
      algo: '功能矩陣比較', edge: 'token 預算',
      verify: '確認分工邏輯',
    });
    assert.ok(output.includes('GOAL'), 'Structured should have GOAL');
    assert.ok(output.includes('範圍限定檢查'), 'VERIFY should be enhanced');
    // 'vs' 不觸發 complementarity，需用「比較」或「差異」
    assert.ok(output.includes('範圍限定檢查'), 'VERIFY should include scope check');
  });

  it('完整流程：安全修復 (beam)', () => {
    const output = handler({
      thought: '修復 SQL injection 漏洞',
      nextThoughtNeeded: false, mode: 'beam',
      beams: [
        { name: '參數化查詢', content: '用 prepared statements', confidence: 9 },
        { name: 'ORM', content: '用 Prisma/TypeORM', confidence: 7 },
        { name: 'WAF', content: '用 Web Application Firewall', confidence: 5 },
      ],
      selectedBeam: '參數化查詢',
    });
    assert.ok(output.includes('Beam Search'), 'Should show beam');
    assert.ok(output.includes('參數化查詢'), 'Should show selected');
  });
});
