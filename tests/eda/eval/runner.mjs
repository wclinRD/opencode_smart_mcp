/**
 * EDA Benchmark Runner
 * Phase 14.8: 執行 benchmark 測試集，產出評估報告
 *
 * 用法：
 *   node tests/eda/eval/runner.mjs [--suite tool|troubleshoot|flow|academic|abbreviation|all] [--verbose]
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateQuery, aggregateMetrics } from './metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = join(__dirname, '..', 'benchmark');

// ── Benchmark Suite 載入 ───────────────────────────────────────────────

const SUITES = {
  tool:          { file: 'tool-100.json',          label: 'Tool Lookup (100)' },
  troubleshoot:  { file: 'troubleshoot-50.json',   label: 'Troubleshoot (50)' },
  flow:          { file: 'flow-50.json',            label: 'Cell Flow (50)' },
  academic:      { file: 'academic-50.json',        label: 'Academic Papers (50)' },
  abbreviation:  { file: 'abbreviation-50.json',    label: 'Abbreviation (50)' },
};

async function loadSuite(name) {
  const spec = SUITES[name];
  if (!spec) throw new Error(`Unknown suite: ${name}. Available: ${Object.keys(SUITES).join(', ')}`);
  const raw = await readFile(join(BENCHMARK_DIR, spec.file), 'utf8');
  return { ...spec, queries: JSON.parse(raw) };
}

// ── 模擬搜尋結果（Off-Mode 模式）─────────────────────────────────────
// 在 off-line 模式下，用本地資料庫做 keyword matching 模擬搜尋結果
// 用於驗證 benchmark 結構正確性 + metrics 函式邏輯

import { EDA_TOOL_INDEX } from '../../../src/plugins/core/eda/data/tools.mjs';
import { EDA_ABBREV_DICT } from '../../../src/plugins/core/eda/data/abbreviations.mjs';
import { CELL_FLOW_STAGES } from '../../../src/plugins/core/eda/data/flow.mjs';

/**
 * Off-line 模擬搜尋：用本地資料庫做 keyword matching
 * @param {string} query
 * @param {string} suiteName
 * @returns {{ results: string[], action: string }}
 */
function mockSearch(query, suiteName) {
  const q = query.toLowerCase();
  const results = [];
  let action = 'tool';

  // 1. 嘗試匹配 EDA_TOOL_INDEX
  for (const [key, info] of Object.entries(EDA_TOOL_INDEX)) {
    const searchStr = `${key} ${info.name} ${info.desc} ${info.category} ${info.alt || ''}`.toLowerCase();
    const words = q.split(/\s+/);
    if (words.some(w => searchStr.includes(w))) {
      results.push(`${info.name} (${key}): ${info.desc}`);
    }
  }

  // 2. 嘗試匹配縮寫字典
  for (const [abbr, entry] of Object.entries(EDA_ABBREV_DICT)) {
    if (q.includes(abbr.toLowerCase())) {
      results.push(`${entry.full} (${abbr}): vendor=${entry.vendor || 'N/A'}, category=${entry.category || 'N/A'}`);
    }
  }

  // 3. 嘗試匹配 flow stages
  for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
    const searchStr = `${key} ${stage.name} ${stage.desc}`.toLowerCase();
    const words = q.split(/\s+/);
    if (words.some(w => searchStr.includes(w))) {
      results.push(`${stage.name}: ${stage.desc}`);
    }
  }

  // 4. Suite-specific 動作推斷
  if (suiteName === 'troubleshoot') {
    action = 'troubleshoot';
  } else if (suiteName === 'flow') {
    if (q.includes('lec') || q.includes('equivalence')) action = 'lec';
    else if (q.includes('eco') || q.includes('change order')) action = 'eco';
    else if (q.includes('dft') || q.includes('scan') || q.includes('atpg') || q.includes('bist')) action = 'dft';
    else if (q.includes('fpga')) action = 'fpga';
    else action = 'flow';
  } else if (suiteName === 'academic') {
    action = 'paper';
  } else if (suiteName === 'abbreviation') {
    action = 'auto';
  } else {
    // tool suite — 用工具名稱推斷 action
    if (q.includes('dft') || q.includes('scan chain')) action = 'dft';
    else if (q.includes('lec') || q.includes('equivalence')) action = 'lec';
    else if (q.includes('eco')) action = 'eco';
    else if (q.includes('fpga') && !q.includes('vs')) action = 'fpga';
    else if (q.includes('flow') || q.includes('steps')) action = 'flow';
    else action = 'tool';
  }

  return { results: results.slice(0, 10), action };
}

// ── Runner 主程式 ─────────────────────────────────────────────────────

/**
 * 執行單一 suite 的 benchmark
 * @param {string} suiteName
 * @param {object} opts
 * @returns {object} 評估結果
 */
export async function runSuite(suiteName, opts = {}) {
  const { verbose = false } = opts;
  const suite = await loadSuite(suiteName);
  
  const evaluations = [];
  const failures = [];

  for (const query of suite.queries) {
    const { results, action } = mockSearch(query.query, suiteName);
    
    const eval_ = evaluateQuery({
      results,
      expectedKeywords: query.expectedKeywords,
      predictedAction: action,
      expectedAction: query.expectedAction,
    });

    evaluations.push(eval_);

    // 記錄失敗案例
    if (!eval_.actionMatch || eval_.keywordHitRate < 0.5) {
      failures.push({
        id: query.id,
        query: query.query,
        actionMatch: eval_.actionMatch,
        keywordHitRate: eval_.keywordHitRate,
        expectedAction: query.expectedAction,
        predictedAction: action,
      });
    }

    if (verbose) {
      const status = eval_.actionMatch && eval_.keywordHitRate >= 0.5 ? '✅' : '❌';
      console.log(`  ${status} [${query.id}] "${query.query}" → action=${action} (hit=${(eval_.keywordHitRate * 100).toFixed(0)}%)`);
    }
  }

  const metrics = aggregateMetrics(evaluations);

  return {
    suite: suite.label,
    count: metrics.count,
    metrics,
    failures,
  };
}

/**
 * 執行全部 suite
 */
export async function runAll(opts = {}) {
  const results = {};
  for (const name of Object.keys(SUITES)) {
    results[name] = await runSuite(name, opts);
  }
  return results;
}

/**
 * 列印評估報告
 */
export function printReport(results) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         EDA Benchmark Evaluation Report              ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const allMetrics = [];

  for (const [name, result] of Object.entries(results)) {
    const m = result.metrics;
    allMetrics.push(m);
    
    console.log(`━━━ ${result.suite} ━━━`);
    console.log(`  Queries:          ${m.count}`);
    console.log(`  Recall@5:         ${(m.avgRecallAt5 * 100).toFixed(1)}%  ${m.recallAt5Pass ? '✅' : '❌'} (≥80%)`);
    console.log(`  Precision@5:      ${(m.avgPrecisionAt5 * 100).toFixed(1)}%`);
    console.log(`  MRR:              ${(m.avgMRR * 100).toFixed(1)}%  ${m.mrrPass ? '✅' : '❌'} (≥60%)`);
    console.log(`  NDCG@5:           ${(m.avgNDCGAt5 * 100).toFixed(1)}%`);
    console.log(`  Keyword Hit Rate: ${(m.avgKeywordHitRate * 100).toFixed(1)}%  ${m.keywordHitRatePass ? '✅' : '❌'} (≥90%)`);
    console.log(`  Action Accuracy:  ${(m.actionAccuracy * 100).toFixed(1)}%  ${m.actionAccuracyPass ? '✅' : '❌'} (≥85%)`);
    console.log(`  Failures:         ${result.failures.length}`);
    console.log('');
  }

  // 總體報告
  if (allMetrics.length > 1) {
    const totalN = allMetrics.reduce((a, m) => a + m.count, 0);
    const weighted = (fn) => allMetrics.reduce((a, m) => a + fn(m) * m.count, 0) / totalN;

    console.log('━━━ Overall ━━━');
    console.log(`  Total Queries:    ${totalN}`);
    console.log(`  Recall@5:         ${(weighted(m => m.avgRecallAt5) * 100).toFixed(1)}%`);
    console.log(`  MRR:              ${(weighted(m => m.avgMRR) * 100).toFixed(1)}%`);
    console.log(`  NDCG@5:           ${(weighted(m => m.avgNDCGAt5) * 100).toFixed(1)}%`);
    console.log(`  Keyword Hit Rate: ${(weighted(m => m.avgKeywordHitRate) * 100).toFixed(1)}%`);
    console.log(`  Action Accuracy:  ${(weighted(m => m.actionAccuracy) * 100).toFixed(1)}%`);
    console.log('');
  }
}

// ── CLI 入口 ──────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes('runner.mjs')) {
  const args = process.argv.slice(2);
  const suiteIdx = args.indexOf('--suite');
  const suiteName = suiteIdx >= 0 ? args[suiteIdx + 1] : 'all';
  const verbose = args.includes('--verbose');

  try {
    if (suiteName === 'all') {
      const results = await runAll({ verbose });
      printReport(results);
    } else {
      const result = await runSuite(suiteName, { verbose });
      printReport({ [suiteName]: result });
    }
  } catch (err) {
    console.error('Benchmark runner error:', err.message);
    process.exit(1);
  }
}
