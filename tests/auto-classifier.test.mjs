// auto-classifier.test.mjs — Auto Mode classifier unit tests
//
// Tests:
//   1. Read tools → allow
//   2. Write tools → warn (auto-approved)
//   3. Blocked file patterns → block
//   4. Security context check → block when security scan found without beam
//   5. Unknown tools → gate
//   6. Neutral tools → allow
//   7. Dynamic rule add/remove
//   8. Override classification
//
// Run: node --test tests/auto-classifier.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let classifyTool, addRule, removeRule, listRules, getClassificationSummary;
let setToolClassification, removeToolClassification;

before(async () => {
  const mod = await import('../src/lib/auto-classifier.mjs');
  classifyTool = mod.classifyTool;
  addRule = mod.addRule;
  removeRule = mod.removeRule;
  listRules = mod.listRules;
  getClassificationSummary = mod.getClassificationSummary;
  setToolClassification = mod.setToolClassification;
  removeToolClassification = mod.removeToolClassification;
});

// Track test rules for cleanup
const testRuleNames = [];

function addTestRule(opts) {
  const id = addRule(opts);
  testRuleNames.push(opts.name || id);
  return id;
}

after(() => {
  for (const name of testRuleNames) {
    try { removeRule(name); } catch { /* ok */ }
  }
});

describe('Auto Classifier — tool classification', () => {

  // --- Read tools ---
  it('should allow smart_read', () => {
    const result = classifyTool('smart_read');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_grep', () => {
    const result = classifyTool('smart_grep');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_lsp', () => {
    const result = classifyTool('smart_lsp');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_glob', () => {
    const result = classifyTool('smart_glob');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_exa_search', () => {
    const result = classifyTool('smart_exa_search');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_context', () => {
    const result = classifyTool('smart_context');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_think', () => {
    const result = classifyTool('smart_think');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_deep_think', () => {
    const result = classifyTool('smart_deep_think');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_learn', () => {
    const result = classifyTool('smart_learn');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_security', () => {
    const result = classifyTool('smart_security');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_hallucination_check', () => {
    const result = classifyTool('smart_hallucination_check');
    assert.equal(result.action, 'allow');
  });

  // --- Neutral tools ---
  it('should allow smart_config (neutral)', () => {
    const result = classifyTool('smart_config');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_run (neutral)', () => {
    const result = classifyTool('smart_run');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_hook (neutral)', () => {
    const result = classifyTool('smart_hook');
    assert.equal(result.action, 'allow');
  });

  it('should allow smart_compact (neutral)', () => {
    const result = classifyTool('smart_compact');
    assert.equal(result.action, 'allow');
  });

  // --- Write tools ---
  it('should warn on smart_fast_apply', () => {
    const result = classifyTool('smart_fast_apply');
    assert.equal(result.action, 'warn');
    assert.equal(result.reason, 'auto-approved');
  });

  // --- Unknown tools ---
  it('should gate unknown tool', () => {
    const result = classifyTool('smart_unknown_tool_xyz');
    assert.equal(result.action, 'gate');
    assert.ok(result.reason);
  });

  it('should gate raw tool name', () => {
    const result = classifyTool('some_random_command');
    assert.equal(result.action, 'gate');
  });
});

describe('Auto Classifier — blocked file patterns', () => {

  it('should block write to .zshenv', () => {
    const result = classifyTool('smart_fast_apply', { file: '.zshenv' });
    assert.equal(result.action, 'block');
    assert.ok(result.reason.includes('Protected file'));
  });

  it('should block write to .zshrc', () => {
    const result = classifyTool('smart_fast_apply', { file: '/home/user/.zshrc' });
    assert.equal(result.action, 'block');
    assert.ok(result.reason.includes('Protected file'));
  });

  it('should block write to .bashrc', () => {
    const result = classifyTool('smart_fast_apply', { file: '.bashrc' });
    assert.equal(result.action, 'block');
  });

  it('should block write to .npmrc', () => {
    const result = classifyTool('smart_fast_apply', { file: '.npmrc' });
    assert.equal(result.action, 'block');
  });

  it('should block write to .git/config', () => {
    const result = classifyTool('smart_fast_apply', { file: '.git/config' });
    assert.equal(result.action, 'block');
  });

  it('should allow write to normal project file', () => {
    const result = classifyTool('smart_fast_apply', { file: 'src/app.ts' });
    assert.equal(result.action, 'warn'); // warn, not block
  });

  it('should block write via blocks array', () => {
    const result = classifyTool('smart_fast_apply', {
      blocks: [{ file: '.zshenv' }, { file: 'src/main.ts' }],
    });
    assert.equal(result.action, 'block');
    assert.ok(result.reason.includes('Protected file'));
  });

  it('should block write via whole.file', () => {
    const result = classifyTool('smart_fast_apply', {
      whole: { file: '~/.ssh/id_rsa' },
    });
    assert.equal(result.action, 'block');
  });

  it('should block write to /etc/passwd', () => {
    const result = classifyTool('smart_fast_apply', { file: '/etc/passwd' });
    assert.equal(result.action, 'block');
  });

  it('should not block non-blocked file via blocks array', () => {
    const result = classifyTool('smart_fast_apply', {
      blocks: [{ file: 'src/main.ts' }, { file: 'src/utils.ts' }],
    });
    assert.equal(result.action, 'warn');
  });
});

describe('Auto Classifier — security context check', () => {

  it('should block write when recent security scan found without beam', () => {
    const context = {
      toolHistory: [
        { tool: 'smart_security', ok: true, timestamp: new Date().toISOString() },
      ],
    };
    const result = classifyTool('smart_fast_apply', { file: 'src/app.ts' }, context);
    assert.equal(result.action, 'block');
    assert.ok(result.reason.includes('Security findings'));
  });

  it('should allow write when beam search follows security scan', () => {
    const baseTime = Date.now() - 10000;
    const context = {
      toolHistory: [
        { tool: 'smart_security', ok: true, timestamp: new Date(baseTime).toISOString() },
        { tool: 'smart_think', args: { mode: 'beam' }, ok: true, timestamp: new Date(baseTime + 1000).toISOString() },
      ],
    };
    const result = classifyTool('smart_fast_apply', { file: 'src/app.ts' }, context);
    assert.equal(result.action, 'warn'); // already analyzed with beam
  });

  it('should not block write when no security scan', () => {
    const context = { toolHistory: [] };
    const result = classifyTool('smart_fast_apply', { file: 'src/app.ts' }, context);
    assert.equal(result.action, 'warn');
  });

  it('should not block read tools even with security scan', () => {
    const context = {
      toolHistory: [
        { tool: 'smart_security', ok: true, timestamp: new Date().toISOString() },
      ],
    };
    const result = classifyTool('smart_read', { file: '.git/config' }, context);
    assert.equal(result.action, 'allow'); // read is always allow
  });
});

describe('Auto Classifier — dynamic rule management', () => {

  it('should add and match a custom rule', () => {
    const id = addRule({
      name: 'test:custom-tool',
      priority: 100,
      action: 'allow',
      match: (name) => name === 'custom_tool_v2',
    });
    testRuleNames.push(id);

    const match = classifyTool('custom_tool_v2');
    assert.equal(match.action, 'allow');

    // Unknown tool still gates
    const unk = classifyTool('some_other_tool');
    assert.equal(unk.action, 'gate');
  });

  it('should remove a rule by id', () => {
    const id = addRule({
      name: 'test:remove-me',
      priority: 100,
      action: 'allow',
      match: (name) => name === 'temp_tool',
    });
    testRuleNames.push(id);

    assert.equal(classifyTool('temp_tool').action, 'allow');

    const removed = removeRule(id);
    assert.equal(removed, true);

    // After removal, it falls through to unknown → gate
    assert.equal(classifyTool('temp_tool').action, 'gate');
  });

  it('should remove a rule by name', () => {
    addRule({
      name: 'test:remove-by-name',
      priority: 100,
      action: 'block',
      match: (name) => name === 'evil_tool',
    });
    testRuleNames.push('test:remove-by-name');

    assert.equal(classifyTool('evil_tool').action, 'block');

    const removed = removeRule('test:remove-by-name');
    assert.equal(removed, true);

    assert.equal(classifyTool('evil_tool').action, 'gate');
  });

  it('listRules should return all registered rules', () => {
    const rules = listRules();
    assert.ok(Array.isArray(rules));
    assert.ok(rules.length >= 5); // at least 5 built-in rules

    // Check structure
    const readRule = rules.find(r => r.name === '$defaults:read');
    assert.ok(readRule);
    assert.equal(readRule.builtin, true);
    assert.equal(readRule.action, 'allow');

    const writeRule = rules.find(r => r.name === '$defaults:write');
    assert.ok(writeRule);
    assert.equal(writeRule.action, 'warn');
    assert.equal(writeRule.builtin, true);
  });
});

describe('Auto Classifier — getClassificationSummary', () => {

  it('should return summary with all action categories', () => {
    const summary = getClassificationSummary();
    assert.ok(Array.isArray(summary.allow));
    assert.ok(Array.isArray(summary.warn));
    assert.ok(Array.isArray(summary.block)); // block is empty
    assert.ok(Array.isArray(summary.gate));
    assert.ok(Array.isArray(summary.blockedPatterns));

    // Should have at least the known categories
    assert.ok(summary.allow.includes('$defaults:read'));
    assert.ok(summary.allow.includes('$defaults:neutral'));
    assert.ok(summary.warn.includes('$defaults:write'));
    assert.ok(summary.gate.includes('$defaults:unknown'));
  });
});

describe('Auto Classifier — override classification', () => {

  it('setToolClassification should add override rule', () => {
    // smart_think is normally allow, let's test with a fake tool
    const ok = setToolClassification('my_test_tool', 'read');
    assert.equal(ok, true);

    const result = classifyTool('my_test_tool');
    assert.equal(result.action, 'allow');

    removeToolClassification('my_test_tool');
  });

  it('removeToolClassification should remove override rule', () => {
    setToolClassification('temp_test_tool', 'read');
    const hasOverride = classifyTool('temp_test_tool');
    assert.equal(hasOverride.action, 'allow');

    const removed = removeToolClassification('temp_test_tool');
    assert.equal(removed, true);

    const after = classifyTool('temp_test_tool');
    assert.equal(after.action, 'gate'); // falls to unknown
  });

  it('should reject invalid category', () => {
    const ok = setToolClassification('test_tool_invalid', 'invalid_cat');
    assert.equal(ok, false);
  });
});
// ============================================================
// Sprint 3 tests — risk scoring, context awareness, prompt scanning
// ============================================================

describe('Auto Classifier — Sprint 3: file risk scoring', () => {

  let getFileRiskLevel;

  before(async () => {
    const mod = await import('../src/lib/auto-classifier.mjs');
    getFileRiskLevel = mod.getFileRiskLevel;
  });

  it('should classify src/app.ts as low risk', () => {
    const risk = getFileRiskLevel('src/app.ts');
    assert.equal(risk.level, 'low');
  });

  it('should classify .env as critical risk', () => {
    const risk = getFileRiskLevel('.env');
    assert.equal(risk.level, 'critical');
  });

  it('should classify .env.prod as critical risk', () => {
    const risk = getFileRiskLevel('.env.prod');
    assert.equal(risk.level, 'critical');
  });

  it('should classify config.json as medium risk', () => {
    const risk = getFileRiskLevel('config/config.json');
    assert.equal(risk.level, 'medium');
  });

  it('should classify .gitignore as medium risk', () => {
    const risk = getFileRiskLevel('.gitignore');
    assert.equal(risk.level, 'medium');
  });

  it('should classify .npmrc as high risk', () => {
    const risk = getFileRiskLevel('.npmrc');
    assert.equal(risk.level, 'high');
  });

  it('should classify .ssh/id_rsa as critical risk', () => {
    const risk = getFileRiskLevel('~/.ssh/id_rsa');
    assert.equal(risk.level, 'critical');
  });

  it('should classify Dockerfile as medium risk', () => {
    const risk = getFileRiskLevel('Dockerfile');
    assert.equal(risk.level, 'medium');
  });
});

describe('Auto Classifier — Sprint 3: prompt scanning', () => {

  let scanPromptForDangerousOps;

  before(async () => {
    const mod = await import('../src/lib/auto-classifier.mjs');
    scanPromptForDangerousOps = mod.scanPromptForDangerousOps;
  });

  it('should flag rm -rf as dangerous', () => {
    const result = scanPromptForDangerousOps('run rm -rf /');
    assert.equal(result.dangerous, true);
    assert.ok(result.matchedPatterns.length >= 1);
  });

  it('should flag edit .env as dangerous', () => {
    const result = scanPromptForDangerousOps('edit .env');
    assert.equal(result.dangerous, true);
  });

  it('should flag chmod 777 as dangerous', () => {
    const result = scanPromptForDangerousOps('chmod 777 /some/file');
    assert.equal(result.dangerous, true);
  });

  it('should not flag safe prompt', () => {
    const result = scanPromptForDangerousOps('refactor the auth module');
    assert.equal(result.dangerous, false);
    assert.equal(result.riskLevel, 'low');
  });

  it('should not flag empty prompt', () => {
    const result = scanPromptForDangerousOps('');
    assert.equal(result.dangerous, false);
  });
});

describe('Auto Classifier — Sprint 3: risk-based classification', () => {

  it('should block write to .env (critical risk)', () => {
    const result = classifyTool('smart_fast_apply', { file: '.env' });
    assert.equal(result.action, 'block');
    assert.ok(result.reason.includes('High-risk file'));
  });

  it('should block write to credentials file', () => {
    const result = classifyTool('smart_fast_apply', { file: 'config/credentials.json' });
    assert.equal(result.action, 'block');
  });

  it('should block write to .npmrc (blocked pattern + high risk)', () => {
    const result = classifyTool('smart_fast_apply', { file: '.npmrc' });
    assert.equal(result.action, 'block');
  });

  it('should warn on write to src/app.ts (low risk)', () => {
    const result = classifyTool('smart_fast_apply', { file: 'src/app.ts' });
    assert.equal(result.action, 'warn');
  });
});

describe('Auto Classifier — Sprint 3: context-aware classification', () => {

  it('should downgrade medium-risk file to warn when recently read', () => {
    const context = {
      toolHistory: [
        { tool: 'smart_read', args: { file: 'config/settings.json' }, ok: true, timestamp: new Date().toISOString() },
      ],
    };
    const result = classifyTool('smart_fast_apply', { file: 'config/settings.json' }, context);
    assert.equal(result.action, 'warn');
  });

  it('should allow-once critical file when in allowOncePaths', () => {
    const context = {
      allowOncePaths: ['.env'],
    };
    const result = classifyTool('smart_fast_apply', { file: '.env' }, context);
    assert.equal(result.action, 'warn');
  });
});

describe('Auto Classifier — Sprint 3: buildBlockMessage', () => {

  let buildBlockMessage;

  before(async () => {
    const mod = await import('../src/lib/auto-classifier.mjs');
    buildBlockMessage = mod.buildBlockMessage;
  });

  it('should include interactive mode option', () => {
    const msg = buildBlockMessage('smart_fast_apply', 'Test reason');
    assert.ok(msg.includes('smart_config'));
    assert.ok(msg.includes('interactive'));
  });

  it('should include read files when provided', () => {
    const msg = buildBlockMessage('smart_fast_apply', 'Test', { readFiles: ['src/app.ts', 'src/auth.ts'] });
    assert.ok(msg.includes('src/app.ts'));
    assert.ok(msg.includes('src/auth.ts'));
  });

  it('should suggest alternative paths for critical risk', () => {
    const msg = buildBlockMessage('smart_fast_apply', 'Test', { riskLevel: 'critical' });
    assert.ok(msg.includes('.env.example'));
  });
});