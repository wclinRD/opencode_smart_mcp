// context-budget.mjs — Context window budget management
//
// Phase 30: Auto-detects LLM model from multiple sources and adjusts
// maxChars accordingly. Supports modern LLMs (128K-1M tokens).
// Excludes metadata (checksum, _optimized, tooltip) from counting.
// Uses multi-tier thresholds: 80% warn → 95% low → 100% critical.
//
// Detection sources (priority order):
//   1. SMART_CONTEXT_BUDGET env var (manual override, e.g. "128000")
//   2. OPENCODE_MODEL / CLAUDE_ZEN_MODEL / ANTHROPIC_MODEL env vars
//   3. opencode.json config file (model field)
//   4. config/agents/smart-mcp.md (model: field in YAML frontmatter)
//   5. Default: 128K tokens (conservative)

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// LLM Model Context Window Registry
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_WINDOWS = {
  'claude-3.5-sonnet':    { tokens: 200000, chars: 800000 },
  'claude-3.5-haiku':     { tokens: 200000, chars: 800000 },
  'claude-3-opus':        { tokens: 200000, chars: 800000 },
  'claude-sonnet-4':      { tokens: 200000, chars: 800000 },
  'claude-opus-4':        { tokens: 200000, chars: 800000 },
  'gpt-4o':               { tokens: 128000, chars: 512000 },
  'gpt-4o-mini':          { tokens: 128000, chars: 512000 },
  'gpt-4-turbo':          { tokens: 128000, chars: 512000 },
  'o1':                   { tokens: 200000, chars: 800000 },
  'o3':                   { tokens: 200000, chars: 800000 },
  'o4-mini':              { tokens: 200000, chars: 800000 },
  'deepseek-v3':          { tokens: 128000, chars: 512000 },
  'deepseek-v4':          { tokens: 128000, chars: 512000 },
  'deepseek-r1':          { tokens: 128000, chars: 512000 },
  'gemini-2.0-flash':     { tokens: 1048576, chars: 4194304 },
  'gemini-2.0-pro':       { tokens: 1048576, chars: 4194304 },
  'gemini-2.5-pro':       { tokens: 1048576, chars: 4194304 },
  'llama-3.1-70b':        { tokens: 128000, chars: 512000 },
  'llama-3.1-405b':       { tokens: 128000, chars: 512000 },
  'opencode/big-pickle':  { tokens: 128000, chars: 512000 },
  'big-pickle':           { tokens: 128000, chars: 512000 },
  'default':              { tokens: 128000, chars: 512000 },
};

const BUDGET_FRACTION = 0.85;
const WARN_THRESHOLD = 0.80;
const LOW_THRESHOLD = 0.95;
const CRITICAL_THRESHOLD = 1.0;

const METADATA_PATTERNS = [
  /^🔐 checksum:/, /^\{$/, /^\s*"_optimized":/, /^\s*"originalSize":/,
  /^\s*"optimizedSize":/, /^\s*"savings":/, /^\s*"cacheKey":/,
  /^\s*"cacheHit":/, /^\s*"tooltip":/, /^\s*"stages":/,
  /^\s*"format":/, /^\s*"level":/, /^---$/, /^📊 Context Budget:/,
];

// ---------------------------------------------------------------------------
// Model Detection
// ---------------------------------------------------------------------------

function matchModel(modelId) {
  const lower = modelId.toLowerCase().trim();
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (key === 'default') continue;
    if (lower === key.toLowerCase()) return key;
  }
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (key === 'default') continue;
    if (lower.includes(key.toLowerCase())) return key;
  }
  const aliases = { 'big-pickle': 'opencode/big-pickle', 'bigpickle': 'opencode/big-pickle' };
  if (aliases[lower]) return aliases[lower];
  return null;
}

function detectModel() {
  const manualTokens = parseInt(process.env.SMART_CONTEXT_BUDGET, 10);
  if (manualTokens > 0) {
    return { modelKey: 'manual', window: { tokens: manualTokens, chars: manualTokens * 4 }, source: 'SMART_CONTEXT_BUDGET' };
  }
  const envVars = ['OPENCODE_MODEL', 'CLAUDE_ZEN_MODEL', 'ANTHROPIC_MODEL', 'OPENAI_MODEL', 'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'LLM_MODEL'];
  for (const varName of envVars) {
    const modelId = process.env[varName];
    if (!modelId) continue;
    const m = matchModel(modelId);
    if (m) return { modelKey: m, window: MODEL_CONTEXT_WINDOWS[m], source: `env:${varName}=${modelId}` };
  }
  try {
    const configPath = join(homedir(), '.config', 'opencode', 'opencode.jsonc');
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const mm = raw.match(/"model"\s*:\s*"([^"]+)"/);
      if (mm) { const m = matchModel(mm[1]); if (m) return { modelKey: m, window: MODEL_CONTEXT_WINDOWS[m], source: `opencode.jsonc:${mm[1]}` }; }
    }
  } catch {}
  try {
    const agentPaths = [join(process.cwd(), 'config', 'agents', 'smart-mcp.md'), join(homedir(), '.config', 'opencode', 'agents', 'smart-mcp.md')];
    for (const agentPath of agentPaths) {
      if (existsSync(agentPath)) {
        const raw = readFileSync(agentPath, 'utf-8');
        const mm = raw.match(/^model:\s*(.+)$/m);
        if (mm) { const m = matchModel(mm[1].trim()); if (m) return { modelKey: m, window: MODEL_CONTEXT_WINDOWS[m], source: `agent:${mm[1].trim()}` }; }
      }
    }
  } catch {}
  return { modelKey: 'default', window: MODEL_CONTEXT_WINDOWS.default, source: 'default' };
}

const _detected = detectModel();
const DEFAULT_MAX_CHARS = Math.round(_detected.window.chars * BUDGET_FRACTION);

// ---------------------------------------------------------------------------
// Metadata exclusion
// ---------------------------------------------------------------------------

function countEffectiveChars(text) {
  if (!text || typeof text !== 'string') return { total: 0, metadata: 0, effective: 0 };
  const lines = text.split('\n');
  const total = text.length;
  let metadata = 0;
  for (const line of lines) {
    for (const pattern of METADATA_PATTERNS) {
      if (pattern.test(line)) { metadata += line.length + 1; break; }
    }
  }
  return { total, metadata, effective: Math.max(0, total - metadata) };
}

// ---------------------------------------------------------------------------
// ContextBudget class
// ---------------------------------------------------------------------------

export class ContextBudget {
  constructor(opts = {}) {
    this._maxChars = opts.maxChars || DEFAULT_MAX_CHARS;
    this._lowThreshold = opts.lowThreshold || LOW_THRESHOLD;
    this._criticalThreshold = opts.criticalThreshold || CRITICAL_THRESHOLD;
    this._totalChars = 0;
    this._effectiveChars = 0;
    this._metadataChars = 0;
    this._callCount = 0;
    this._compressedCount = 0;
    this._savingsChars = 0;
    this._history = [];
    this._structuredCount = 0;
    this._structuredSavingsChars = 0;
    this._freeFormCount = 0;
    this._freeFormTotalChars = 0;
    this._modelKey = _detected.modelKey;
    this._modelTokens = _detected.window.tokens;
    this._detectionSource = _detected.source;
  }

  get modelKey() { return this._modelKey; }
  get modelTokens() { return this._modelTokens; }
  get detectionSource() { return this._detectionSource; }

  track(toolName, outputChars, compressed = false, originalChars = 0, outputText = '') {
    const { effective, metadata } = outputText
      ? countEffectiveChars(outputText)
      : { effective: outputChars, metadata: 0 };
    this._totalChars += outputChars;
    this._effectiveChars += effective;
    this._metadataChars += metadata;
    this._callCount++;
    if (compressed) {
      this._compressedCount++;
      this._savingsChars += Math.max(0, originalChars - outputChars);
    }
    this._history.push({ tool: toolName, chars: outputChars, effectiveChars: effective, metadataChars: metadata, compressed, timestamp: Date.now() });
    if (this._history.length > 200) this._history = this._history.slice(-200);
  }

  reset() {
    this._totalChars = 0; this._effectiveChars = 0; this._metadataChars = 0;
    this._callCount = 0; this._compressedCount = 0; this._savingsChars = 0;
    this._history = [];
    this._structuredCount = 0; this._structuredSavingsChars = 0;
    this._freeFormCount = 0; this._freeFormTotalChars = 0;
  }

  get totalChars() { return this._totalChars; }
  get effectiveChars() { return this._effectiveChars; }
  get metadataChars() { return this._metadataChars; }
  get remaining() { return Math.max(0, this._maxChars - this._effectiveChars); }
  get usedFraction() { return this._maxChars > 0 ? this._effectiveChars / this._maxChars : 0; }
  get remainingFraction() { return Math.max(0, 1 - this.usedFraction); }

  isCritical() { return this.remainingFraction <= this._criticalThreshold; }
  isLow() { return this.remainingFraction <= this._lowThreshold; }
  isWarning() { return this.remainingFraction <= WARN_THRESHOLD; }

  getRecommendedLevel() {
    if (this.isCritical()) return 2;
    if (this.isLow()) return 1;
    return 0;
  }

  getRotWarning() {
    const used = this.usedFraction;
    if (used >= 1.0) {
      return `⚠️ Budget 剩 ${(this.remainingFraction * 100).toFixed(0)}%。強烈建議執行 smart_compact 或開始新的 session`;
    }
    if (used >= 0.95) {
      return `⚡ Budget ${(used * 100).toFixed(1)}%。建議執行 smart_context({command:"clear_tool_results", olderThan:10}) 或 smart_compact`;
    }
    if (used >= 0.80) {
      return `💡 Budget ${(used * 100).toFixed(1)}%。可考慮 smart_context({command:"clear_tool_results", olderThan:10}) 釋放 context 空間`;
    }
    return null;
  }

  trackStructuredThinking(isStructured, outputChars, estimatedFreeFormChars = 0) {
    if (isStructured) {
      this._structuredCount++;
      if (estimatedFreeFormChars > 0) this._structuredSavingsChars += Math.max(0, estimatedFreeFormChars - outputChars);
    } else {
      this._freeFormCount++;
      this._freeFormTotalChars += outputChars;
    }
  }

  getStructuredThinkingStats() {
    const total = this._structuredCount + this._freeFormCount;
    const avgFreeForm = this._freeFormCount > 0 ? Math.round(this._freeFormTotalChars / this._freeFormCount) : 0;
    const savingsPct = avgFreeForm > 0 && this._structuredCount > 0
      ? ((avgFreeForm - (this._structuredSavingsChars / this._structuredCount + avgFreeForm)) / avgFreeForm * 100).toFixed(0) + '%'
      : 'N/A';
    return { structuredCount: this._structuredCount, freeFormCount: this._freeFormCount, totalThinkingCalls: total, savingsChars: this._structuredSavingsChars, avgFreeFormChars: avgFreeForm, savingsPct };
  }

  getStatus() {
    const status = this.isCritical() ? 'critical' : this.isLow() ? 'low' : this.isWarning() ? 'warning' : 'ok';
    const estimatedTokens = Math.round(this._effectiveChars / 4);
    const maxTokens = Math.round(this._maxChars / 4);
    const remainingTokens = Math.round(this.remaining / 4);
    const toolBreakdown = {};
    for (const entry of this._history) {
      if (!toolBreakdown[entry.tool]) toolBreakdown[entry.tool] = { calls: 0, totalChars: 0, effectiveChars: 0, compressed: 0 };
      toolBreakdown[entry.tool].calls++;
      toolBreakdown[entry.tool].totalChars += entry.chars;
      toolBreakdown[entry.tool].effectiveChars += (entry.effectiveChars || entry.chars);
      if (entry.compressed) toolBreakdown[entry.tool].compressed++;
    }
    return {
      status,
      model: { key: this._modelKey, tokens: this._modelTokens, source: this._detectionSource },
      totalChars: this._totalChars, effectiveChars: this._effectiveChars, metadataChars: this._metadataChars,
      maxChars: this._maxChars, remaining: this.remaining,
      usedPct: (this.usedFraction * 100).toFixed(1) + '%', remainingPct: (this.remainingFraction * 100).toFixed(1) + '%',
      estimatedTokens, maxTokens, remainingTokens,
      callCount: this._callCount, compressedCount: this._compressedCount,
      savingsChars: this._savingsChars,
      savingsPct: this._totalChars > 0 ? (this._savingsChars / (this._totalChars + this._savingsChars) * 100).toFixed(1) + '%' : '0%',
      toolBreakdown, structuredThinking: this.getStructuredThinkingStats(),
      rotWarning: this.getRotWarning(),
      recommendation: status === 'critical' ? '⚠️ Context budget critical.' : status === 'low' ? '⚡ Context budget low.' : status === 'warning' ? '💡 Context budget approaching limit.' : '✅ Context budget healthy.',
    };
  }

  decideCompression(outputSize, currentLevel = 0) {
    if (this.isCritical()) {
      return { shouldCompress: true, level: Math.max(currentLevel, outputSize > 500 ? 2 : 1), reason: 'Context budget critical' };
    }
    if (this.isLow() && outputSize > 2000) {
      return { shouldCompress: true, level: Math.max(currentLevel, 1), reason: 'Context budget low' };
    }
    if (this.isWarning() && outputSize > 10000) {
      return { shouldCompress: true, level: Math.max(currentLevel, 1), reason: 'Context budget warning' };
    }
    return { shouldCompress: false, level: currentLevel, reason: 'Budget ok' };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

export function getContextBudget(opts) {
  if (!_instance) _instance = new ContextBudget(opts);
  return _instance;
}

export function resetContextBudget() {
  if (_instance) _instance.reset();
}
