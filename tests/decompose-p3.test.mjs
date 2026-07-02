// ── P2.3 XML + Dual Format + Semantic + Bug Resilience 測試 ──
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// J: XML
import {
  parseXMLToolCalls,
  extractToolNames,
  validateToolCall,
  validateToolCalls,
  formatXMLToolCall,
  subtaskToXMLCall,
  parseCoETags,
  hasXMLToolCalls,
} from '../src/lib/decompose-xml.mjs';

// K: Dual Format
import {
  chooseDualMode,
  formatCoE,
  formatTextCoT,
  coeToText,
  textToCoE,
  summarizeCoE,
} from '../src/lib/decompose-dual.mjs';

// L: Semantic
import {
  detectSemanticSignals,
  signalRecommendations,
  semanticAnalysis,
} from '../src/lib/decompose-semantic.mjs';

// M: Resilience
import {
  classifyError,
  recoveryPlan,
  shouldGiveUp,
  getFallback,
  fallbackDecision,
  safeExecute,
} from '../src/lib/decompose-resilience.mjs';

// ═══════════════════════════════════════════
// J: XML Tool Call
// ═══════════════════════════════════════════

describe('parseXMLToolCalls (J1)', () => {
  it('null/undefined → []', () => {
    assert.deepEqual(parseXMLToolCalls(null), []);
    assert.deepEqual(parseXMLToolCalls(undefined), []);
  });

  it('no tool calls → []', () => {
    assert.deepEqual(parseXMLToolCalls('just thinking'), []);
  });

  it('parses single tool call', () => {
    const thought = '<tool_call><name>smart_grep</name><arguments>{"pattern":"foo"}</arguments></tool_call>';
    const calls = parseXMLToolCalls(thought);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'smart_grep');
    assert.deepEqual(calls[0].args, { pattern: 'foo' });
  });

  it('parses multiple tool calls', () => {
    const thought = '<tool_call><name>smart_grep</name><arguments>{"p":"a"}</arguments></tool_call> text <tool_call><name>smart_read</name><arguments>{"file":"b"}</arguments></tool_call>';
    const calls = parseXMLToolCalls(thought);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'smart_grep');
    assert.equal(calls[1].name, 'smart_read');
  });

  it('lenient JSON fallback', () => {
    const thought = '<tool_call><name>smart_grep</name><arguments>{pattern:"foo"}</arguments></tool_call>';
    const calls = parseXMLToolCalls(thought);
    assert.equal(calls.length, 1);
    // should have parsed or have _error
    assert.ok(calls[0].args.pattern === 'foo' || calls[0].args._error);
  });
});

describe('extractToolNames', () => {
  it('extracts names from XML', () => {
    const thought = '<tool_call><name>smart_grep</name><arguments>{}</arguments></tool_call>';
    assert.deepEqual(extractToolNames(thought), ['smart_grep']);
  });

  it('empty → []', () => {
    assert.deepEqual(extractToolNames(''), []);
  });
});

describe('validateToolCall (J2)', () => {
  it('valid tool → valid', () => {
    const r = validateToolCall({ name: 'smart_grep', args: { pattern: 'x' } });
    assert.equal(r.valid, true);
  });

  it('missing name → invalid', () => {
    const r = validateToolCall({ args: {} });
    assert.equal(r.valid, false);
  });

  it('unknown non-smart tool → invalid', () => {
    const r = validateToolCall({ name: 'unknown_tool', args: {} });
    assert.equal(r.valid, false);
  });

  it('smart_ prefix tools pass', () => {
    const r = validateToolCall({ name: 'smart_custom_123', args: {} });
    assert.equal(r.valid, true);
  });

  it('missing args → invalid', () => {
    const r = validateToolCall({ name: 'smart_grep' });
    assert.equal(r.valid, false);
  });
});

describe('validateToolCalls', () => {
  it('batch validates', () => {
    const r = validateToolCalls([
      { name: 'smart_grep', args: {} },
      { name: 'bad_tool', args: {} },
    ]);
    assert.equal(r.valid.length, 1);
    assert.equal(r.invalid.length, 1);
  });

  it('not array → error', () => {
    const r = validateToolCalls(null);
    assert.ok(r.errors.length > 0);
  });
});

describe('formatXMLToolCall (J3)', () => {
  it('formats correct XML', () => {
    const xml = formatXMLToolCall('smart_grep', { pattern: 'x' });
    assert.ok(xml.includes('<tool_call>'));
    assert.ok(xml.includes('<name>smart_grep</name>'));
    assert.ok(xml.includes('"pattern"'));
  });
});

describe('subtaskToXMLCall', () => {
  it('generates call from subtask', () => {
    const xml = subtaskToXMLCall({ id: 1, tool: 'smart_grep', toolArgs: { p: 'x' } });
    assert.ok(xml.includes('smart_grep'));
  });

  it('no tool → null', () => {
    assert.equal(subtaskToXMLCall({ id: 1 }), null);
  });
});

describe('parseCoETags (J4)', () => {
  it('extracts CoE tags', () => {
    const r = parseCoETags('<thought>think</thought>\n<response>respond</response>');
    assert.equal(r.thought, 'think');
    assert.equal(r.response, 'respond');
    assert.equal(r.mode, 'coe');
  });

  it('no tags → text-cot mode', () => {
    const r = parseCoETags('plain text');
    assert.equal(r.mode, 'text-cot');
  });

  it('null → empty', () => {
    const r = parseCoETags(null);
    assert.equal(r.mode, 'text-cot');
  });
});

describe('hasXMLToolCalls', () => {
  it('detects tool calls', () => {
    assert.equal(hasXMLToolCalls('<tool_call><name>test</name></tool_call>'), true);
  });

  it('no calls → false', () => {
    assert.equal(hasXMLToolCalls('no calls'), false);
  });
});

// ═══════════════════════════════════════════
// K: Dual Format
// ═══════════════════════════════════════════

describe('chooseDualMode (K1)', () => {
  it('needsToolCall → coe', () => {
    const r = chooseDualMode({ needsToolCall: true });
    assert.equal(r.mode, 'coe');
  });

  it('high confidence + simple → coe', () => {
    const r = chooseDualMode({ confidence: 9, thoughtLength: 50, taskType: 'general' });
    assert.equal(r.mode, 'coe');
  });

  it('low confidence → text-cot', () => {
    const r = chooseDualMode({ confidence: 3, thoughtLength: 200 });
    assert.equal(r.mode, 'text-cot');
  });

  it('research → text-cot', () => {
    const r = chooseDualMode({ taskType: 'research', thoughtLength: 300 });
    assert.equal(r.mode, 'text-cot');
  });
});

describe('formatCoE (K2)', () => {
  it('formats thought+response', () => {
    const r = formatCoE('think this', 'respond that');
    assert.ok(r.includes('<thought>'));
    assert.ok(r.includes('<response>'));
    assert.ok(r.includes('think this'));
    assert.ok(r.includes('respond that'));
  });

  it('thought only', () => {
    const r = formatCoE('just think');
    assert.ok(r.includes('<thought>'));
    assert.ok(!r.includes('<response>'));
  });
});

describe('formatTextCoT', () => {
  it('returns text as-is', () => {
    assert.equal(formatTextCoT('hello'), 'hello');
  });
});

describe('coeToText (K3)', () => {
  it('strips CoE tags', () => {
    assert.equal(coeToText('<thought>think</thought>'), 'think');
  });

  it('null → empty', () => {
    assert.equal(coeToText(null), '');
  });
});

describe('textToCoE', () => {
  it('wraps in thought tags', () => {
    assert.ok(textToCoE('hello').includes('<thought>'));
  });
});

describe('summarizeCoE (K4)', () => {
  it('short text stays as-is', () => {
    assert.equal(summarizeCoE('hello', 100), 'hello');
  });

  it('long text truncated', () => {
    const r = summarizeCoE('a'.repeat(300), 10);
    assert.equal(r.length, 13); // 10 + '...'
  });
});

// ═══════════════════════════════════════════
// L: Semantic Signal
// ═══════════════════════════════════════════

describe('detectSemanticSignals (L2)', () => {
  it('null → empty', () => {
    const r = detectSemanticSignals(null);
    assert.equal(r.signals.length, 0);
  });

  it('detects uncertainty', () => {
    const r = detectSemanticSignals('maybe this is the bug');
    assert.ok(r.signals.some(s => s.type === 'uncertainty'));
  });

  it('detects confidence', () => {
    const r = detectSemanticSignals('definitely the root cause');
    assert.ok(r.signals.some(s => s.type === 'confidence'));
  });

  it('detects error', () => {
    const r = detectSemanticSignals('there is an error in auth.ts');
    assert.ok(r.signals.some(s => s.type === 'error'));
  });

  it('detects conclusion', () => {
    const r = detectSemanticSignals('therefore the fix is to add null check');
    assert.ok(r.signals.some(s => s.type === 'conclusion'));
  });

  it('detects tool_intent', () => {
    const r = detectSemanticSignals('should use smart_grep to find the pattern');
    assert.ok(r.signals.some(s => s.type === 'tool_intent'));
  });

  it('filter specific signals', () => {
    const r = detectSemanticSignals('maybe error', { signals: ['uncertainty'] });
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].type, 'uncertainty');
  });

  it('returns topSignal', () => {
    const r = detectSemanticSignals('maybe the error is here');
    assert.ok(r.topSignal);
  });
});

describe('signalRecommendations', () => {
  it('makes recommendations based on signals', () => {
    const recs = signalRecommendations([{ type: 'uncertainty', weight: 0.8, matchCount: 1 }]);
    assert.ok(recs.length > 0);
  });

  it('empty signals → []', () => {
    assert.deepEqual(signalRecommendations([]), []);
  });
});

describe('semanticAnalysis (L3)', () => {
  it('runs full analysis', () => {
    const r = semanticAnalysis('maybe error here');
    assert.ok(Array.isArray(r.signals));
    assert.ok(Array.isArray(r.recommendations));
    assert.ok(r.topSignal);
  });
});

// ═══════════════════════════════════════════
// M: Bug Resilience
// ═══════════════════════════════════════════

describe('classifyError (M1)', () => {
  it('parse error → retry-lenient', () => {
    const r = classifyError('JSON.parse error: Unexpected token');
    assert.equal(r.category, 'parse');
    assert.equal(r.strategy, 'retry-lenient');
  });

  it('timeout → retry-backoff', () => {
    const r = classifyError('timeout occurred');
    assert.equal(r.strategy, 'retry-backoff');
  });

  it('LSP error → degrade-grep', () => {
    const r = classifyError('LSP bridge error');
    assert.equal(r.strategy, 'degrade-grep');
  });

  it('empty → unknown retry', () => {
    const r = classifyError('');
    assert.equal(r.matched, false);
    assert.equal(r.strategy, 'retry');
  });

  it('auth error → stop', () => {
    const r = classifyError('401 unauthorized');
    assert.equal(r.strategy, 'stop');
  });
});

describe('recoveryPlan (M2)', () => {
  it('plan has action and message', () => {
    const r = recoveryPlan({ category: 'tool', strategy: 'retry-backoff' }, { tool: 'smart_grep' });
    assert.ok(r.action);
    assert.ok(r.message);
  });
});

describe('shouldGiveUp', () => {
  it('retries exceeded', () => {
    assert.equal(shouldGiveUp(3, 3), true);
    assert.equal(shouldGiveUp(2, 3), false);
  });
});

describe('getFallback (M3)', () => {
  it('LSP fallback chain', () => {
    assert.equal(getFallback('smart_lsp', 0), 'smart_grep');
  });

  it('unknown tool → null', () => {
    assert.equal(getFallback('unknown_tool'), null);
  });
});

describe('fallbackDecision', () => {
  it('no retry → no fallback', () => {
    const r = fallbackDecision('smart_lsp', 0);
    assert.equal(r.shouldFallback, false);
  });

  it('after retry → fallback', () => {
    const r = fallbackDecision('smart_lsp', 2);
    assert.equal(r.shouldFallback, true);
    // retryCount=2 => level=1 => smart_read
    assert.equal(r.fallbackTool, 'smart_read');
  });
});

describe('safeExecute (M4)', () => {
  it('successful fn → ok', async () => {
    const r = await safeExecute(async () => 'result', { toolName: 'test' });
    assert.equal(r.ok, true);
    assert.equal(r.result, 'result');
  });

  it('failing fn with retries → error', async () => {
    let count = 0;
    const r = await safeExecute(async () => {
      count++;
      throw new Error('fail');
    }, { maxRetries: 1, toolName: 'test' });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
});

// ═══════════════════════════════════════════
// 總計統計
// ═══════════════════════════════════════════
// J1-J4: 16 tests
// K1-K4: 10 tests
// L1-L3:  9 tests
// M1-M4: 10 tests
// Total: 45 tests
