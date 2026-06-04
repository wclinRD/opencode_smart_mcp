#!/usr/bin/env node

// tool-stats.mjs — Tool usage statistics tracker
//
// Tracks and analyzes tool usage patterns:
//   - Records tool calls with name, args, duration, success/failure
//   - Computes success rates and average durations
//   - Generates usage reports and recommendations
//
// Usage:
//   node tool-stats.mjs <command> [options]
//
// Commands:
//   record <name> [--duration <ms>] [--success <bool>] [--args <json>]
//                         Record a tool usage entry
//   report              Generate usage statistics report
//   trends              Show usage trends over time
//   recommendations     Suggest tool/strategy improvements
//
// Options:
//   --root <path>         Root directory (default: .)
//   --data-dir <path>     Stats data directory (default: .opencode/stats)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --days <N>            Analyze last N days (default: 30)
//   --top <N>             Show top N tools (default: 10)
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node tool-stats.mjs record diagram.mjs --duration 1200 --success true
//   node tool-stats.mjs report --days 7
//   node tool-stats.mjs recommendations
//   node tool-stats.mjs trends --format json

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Data management
// ---------------------------------------------------------------------------

function getDataDir(root) {
  return resolve(root, '.opencode', 'stats');
}

function ensureDataDir(root) {
  const dir = getDataDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getStatsPath(root) {
  return resolve(getDataDir(root), 'tool-usage.json');
}

function loadStats(root) {
  const path = getStatsPath(root);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* fall through */ }
  }
  return { entries: [], lastUpdated: null };
}

function saveStats(root, stats) {
  const dir = ensureDataDir(root);
  const path = resolve(dir, 'tool-usage.json');
  stats.lastUpdated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(stats, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Record command
// ---------------------------------------------------------------------------

function cmdRecord(root, name, options) {
  const stats = loadStats(root);

  const entry = {
    tool: name,
    timestamp: new Date().toISOString(),
    duration: options.duration || null,
    success: options.success !== undefined ? options.success : null,
    args: options.args || null,
    session: options.session || null,
  };

  stats.entries.push(entry);
  saveStats(root, stats);

  return { recorded: true, totalEntries: stats.entries.length, entry };
}

// ---------------------------------------------------------------------------
// Report command
// ---------------------------------------------------------------------------

function cmdReport(root, opts) {
  const stats = loadStats(root);
  const entries = stats.entries;
  const days = opts.days || 30;
  const top = opts.top || 10;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);
  const tools = {};

  for (const e of recent) {
    if (!tools[e.tool]) {
      tools[e.tool] = { name: e.tool, calls: 0, successes: 0, failures: 0, totalDuration: 0 };
    }
    tools[e.tool].calls++;
    if (e.success === true) tools[e.tool].successes++;
    if (e.success === false) tools[e.tool].failures++;
    if (e.duration) tools[e.tool].totalDuration += e.duration;
  }

  const toolList = Object.values(tools)
    .map(t => ({
      ...t,
      successRate: t.calls > 0 ? ((t.successes / t.calls) * 100).toFixed(1) : '0.0',
      avgDuration: t.calls > 0 && t.totalDuration > 0 ? (t.totalDuration / t.calls).toFixed(0) : '-',
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, top);

  const totalCalls = recent.length;
  const totalSuccesses = recent.filter(e => e.success === true).length;
  const totalFailures = recent.filter(e => e.success === false).length;
  const totalDuration = recent.reduce((s, e) => s + (e.duration || 0), 0);

  return {
    period: `${days} days`,
    totalEntries: entries.length,
    recentEntries: recent.length,
    tools: toolList,
    summary: {
      totalCalls,
      totalSuccesses,
      totalFailures,
      totalDuration,
      overallSuccessRate: totalCalls > 0 ? ((totalSuccesses / totalCalls) * 100).toFixed(1) : '0.0',
      uniqueTools: Object.keys(tools).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Trends command
// ---------------------------------------------------------------------------

function cmdTrends(root, opts) {
  const stats = loadStats(root);
  const entries = stats.entries;
  const days = opts.days || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);

  // Group by day
  const byDay = {};
  for (const e of recent) {
    const day = e.timestamp.slice(0, 10);
    if (!byDay[day]) byDay[day] = { calls: 0, successes: 0, failures: 0 };
    byDay[day].calls++;
    if (e.success === true) byDay[day].successes++;
    if (e.success === false) byDay[day].failures++;
  }

  const dailyTrend = Object.entries(byDay)
    .map(([date, data]) => ({
      date,
      ...data,
      successRate: data.calls > 0 ? ((data.successes / data.calls) * 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Tool trends
  const toolTrends = {};
  for (const e of recent) {
    if (!toolTrends[e.tool]) toolTrends[e.tool] = { calls: 0, firstSeen: e.timestamp, lastSeen: e.timestamp };
    toolTrends[e.tool].calls++;
    if (e.timestamp < toolTrends[e.tool].firstSeen) toolTrends[e.tool].firstSeen = e.timestamp;
    if (e.timestamp > toolTrends[e.tool].lastSeen) toolTrends[e.tool].lastSeen = e.timestamp;
  }

  return {
    period: `${days} days`,
    totalEntries: entries.length,
    recentEntries: recent.length,
    dailyTrend,
    toolTrends: Object.entries(toolTrends)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.calls - a.calls),
    summary: {
      daysWithData: Object.keys(byDay).length,
      avgCallsPerDay: (recent.length / Math.max(Object.keys(byDay).length, 1)).toFixed(1),
    },
  };
}

// ---------------------------------------------------------------------------
// Recommendations command
// ---------------------------------------------------------------------------

function cmdRecommendations(root, opts) {
  const stats = loadStats(root);
  const entries = stats.entries;
  const days = opts.days || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);

  const recommendations = [];

  // Find tools with low success rates
  const toolStats = {};
  for (const e of recent) {
    if (!toolStats[e.tool]) toolStats[e.tool] = { calls: 0, successes: 0, failures: 0, durations: [] };
    toolStats[e.tool].calls++;
    if (e.success === true) toolStats[e.tool].successes++;
    if (e.success === false) toolStats[e.tool].failures++;
    if (e.duration) toolStats[e.tool].durations.push(e.duration);
  }

  for (const [tool, stats] of Object.entries(toolStats)) {
    if (stats.calls >= 3 && stats.successes / stats.calls < 0.6) {
      recommendations.push({
        type: 'warning',
        tool,
        message: `Low success rate (${((stats.successes / stats.calls) * 100).toFixed(0)}%)`,
        details: `Failed ${stats.failures}/${stats.calls} times. Consider checking tool prerequisites or usage patterns.`,
      });
    }

    if (stats.durations.length >= 3) {
      const avg = stats.durations.reduce((s, d) => s + d, 0) / stats.durations.length;
      const max = Math.max(...stats.durations);
      if (max > avg * 3) {
        recommendations.push({
          type: 'info',
          tool,
          message: `High duration variance (avg: ${avg.toFixed(0)}ms, max: ${max}ms)`,
          details: 'Some calls are significantly slower than others. Consider timeout settings.',
        });
      }
    }
  }

  // General recommendations
  if (recent.length === 0) {
    recommendations.push({
      type: 'info',
      tool: 'system',
      message: 'No tool usage data recorded yet',
      details: 'Start using tools to generate usage statistics and recommendations.',
    });
  }

  if (recent.length < 10 && recent.length > 0) {
    recommendations.push({
      type: 'info',
      tool: 'system',
      message: 'Low data volume for meaningful analysis',
      details: `Only ${recent.length} entries in the last ${days} days. More data needed for accurate recommendations.`,
    });
  }

  // ── Trend analysis: compare first half vs second half of period ──
  if (recent.length >= 10) {
    const midPoint = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, midPoint);
    const secondHalf = recent.slice(midPoint);

    const firstStats = {};
    const secondStats = {};
    for (const e of firstHalf) {
      if (!firstStats[e.tool]) firstStats[e.tool] = { calls: 0, successes: 0 };
      firstStats[e.tool].calls++;
      if (e.success === true) firstStats[e.tool].successes++;
    }
    for (const e of secondHalf) {
      if (!secondStats[e.tool]) secondStats[e.tool] = { calls: 0, successes: 0 };
      secondStats[e.tool].calls++;
      if (e.success === true) secondStats[e.tool].successes++;
    }

    for (const [tool, s] of Object.entries(secondStats)) {
      const f = firstStats[tool];
      if (!f || f.calls < 3 || s.calls < 3) continue;
      const firstRate = f.successes / f.calls;
      const secondRate = s.successes / s.calls;
      if (firstRate - secondRate > 0.2) {
        recommendations.push({
          type: 'warning',
          tool,
          message: `Declining success rate (${Math.round(firstRate * 100)}% → ${Math.round(secondRate * 100)}%)`,
          details: `Success rate dropped ${Math.round((firstRate - secondRate) * 100)}% between first half and second half of the period. Investigate recent changes or usage patterns.`,
        });
      }
      if (secondRate - firstRate > 0.2) {
        recommendations.push({
          type: 'info',
          tool,
          message: `Improving success rate (${Math.round(firstRate * 100)}% → ${Math.round(secondRate * 100)}%)`,
          details: `Success rate improved ${Math.round((secondRate - firstRate) * 100)}%. Changes are working well.`,
        });
      }
    }
  }

  // ── Task type recommendations ──
  const taskToolStats = {};
  for (const e of recent) {
    const task = inferTaskType(e.tool);
    if (!taskToolStats[task]) taskToolStats[task] = { calls: 0, successes: 0, tools: new Set() };
    taskToolStats[task].calls++;
    if (e.success === true) taskToolStats[task].successes++;
    taskToolStats[task].tools.add(e.tool);
  }

  for (const [task, s] of Object.entries(taskToolStats)) {
    if (s.calls >= 5 && s.successes / s.calls < 0.5) {
      recommendations.push({
        type: 'warning',
        tool: `task:${task}`,
        message: `Low success rate for "${task}" tasks (${Math.round((s.successes / s.calls) * 100)}%)`,
        details: `Consider reviewing the toolchain for ${task} tasks. Only ${Math.round((s.successes / s.calls) * 100)}% of ${s.calls} ${task} calls succeeded.`,
      });
    }
  }

  // Check for tools that could be alternatives
  const grepUsage = toolStats['grep'] || toolStats['Grep'] || { calls: 0, failures: 0 };
  const smartGrepUsage = toolStats['smart_grep'] || toolStats['smartGrep'] || { calls: 0 };
  if (grepUsage.calls > 5 && grepUsage.failures / grepUsage.calls > 0.3 && smartGrepUsage.calls < 3) {
    recommendations.push({
      type: 'suggestion',
      tool: 'smart_grep',
      message: 'grep has high failure rate',
      details: 'Consider using smart_grep for semantic-aware searching with better context.',
    });
  }

  return {
    period: `${days} days`,
    totalEntries: entries.length,
    recentEntries: recent.length,
    recommendations,
    summary: {
      total: recommendations.length,
      warnings: recommendations.filter(r => r.type === 'warning').length,
      suggestions: recommendations.filter(r => r.type === 'suggestion').length,
      infos: recommendations.filter(r => r.type === 'info').length,
    },
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatText(command, result, opts, color) {
  const c = COLORS;
  const out = [];

  const heading = (text) => color ? `${c.bold}${c.blue}${text}${c.reset}` : text;
  const good = (text) => color ? `${c.green}${text}${c.reset}` : text;
  const warn = (text) => color ? `${c.yellow}${text}${c.reset}` : text;
  const bad = (text) => color ? `${c.red}${text}${c.reset}` : text;

  switch (command) {
    case 'record': {
      out.push(heading('Record Tool Usage'));
      out.push('='.repeat(40));
      out.push(`  Tool:       ${result.entry.tool}`);
      out.push(`  Duration:   ${result.entry.duration || '-'}ms`);
      out.push(`  Success:    ${result.entry.success !== null ? (result.entry.success ? good('yes') : bad('no')) : '-'}`);
      out.push(`  Total:      ${result.totalEntries} entries`);
      break;
    }
    case 'report': {
      out.push(heading('Tool Usage Report'));
      out.push(`Period: Last ${result.period}`);
      out.push('='.repeat(40));
      out.push('');
      out.push(heading('Summary'));
      out.push(`  Total Calls:   ${result.summary.totalCalls}`);
      out.push(`  Success Rate:  ${parseFloat(result.summary.overallSuccessRate) > 80 ? good(`${result.summary.overallSuccessRate}%`) : warn(`${result.summary.overallSuccessRate}%`)}`);
      out.push(`  Unique Tools:  ${result.summary.uniqueTools}`);
      out.push(`  Total Time:    ${(result.summary.totalDuration / 1000).toFixed(1)}s`);
      out.push('');
      out.push(heading(`Top ${result.tools.length} Tools`));
      out.push(`  ${'Tool'.padEnd(25)} ${'Calls'.padEnd(8)} ${'Success'.padEnd(10)} ${'Avg Time'}`);
      for (const t of result.tools) {
        const rate = parseFloat(t.successRate);
        const rateStr = rate >= 80 ? good(`${t.successRate}%`) : rate >= 50 ? warn(`${t.successRate}%`) : bad(`${t.successRate}%`);
        out.push(`  ${t.name.padEnd(25)} ${String(t.calls).padEnd(8)} ${rateStr.padEnd(10)} ${t.avgDuration}ms`);
      }
      break;
    }
    case 'trends': {
      out.push(heading('Usage Trends'));
      out.push(`Period: Last ${result.period}`);
      out.push('='.repeat(40));
      out.push('');
      out.push(heading('Daily Activity'));
      for (const day of result.dailyTrend) {
        const bar = '█'.repeat(Math.min(day.calls, 40));
        const rate = parseFloat(day.successRate);
        const rateStr = rate >= 80 ? good(day.successRate + '%') : rate >= 50 ? warn(day.successRate + '%') : bad(day.successRate + '%');
        out.push(`  ${day.date} ${bar} ${day.calls} calls (${rateStr})`);
      }
      out.push('');
      out.push(heading('Tool Trends'));
      for (const t of result.toolTrends.slice(0, 10)) {
        out.push(`  ${t.name.padEnd(25)} ${String(t.calls).padEnd(6)} calls | last: ${t.lastSeen.slice(0, 10)}`);
      }
      break;
    }
    case 'recommendations': {
      out.push(heading('Recommendations'));
      out.push(`Period: Last ${result.period}`);
      out.push('='.repeat(40));
      if (result.recommendations.length === 0) {
        out.push(`  ${good('✅ No recommendations — everything looks good!')}`);
      } else {
        for (const r of result.recommendations) {
          const icon = r.type === 'warning' ? bad('⚠️') : r.type === 'suggestion' ? warn('💡') : 'ℹ️';
          out.push(`  ${icon} [${r.tool}] ${r.message}`);
          out.push(`     ${r.details}`);
          out.push('');
        }
      }
      out.push(heading('Summary'));
      out.push(`  ${result.summary.warnings > 0 ? bad(`${result.summary.warnings} warnings`) : good('0 warnings')} | ${result.summary.suggestions > 0 ? warn(`${result.summary.suggestions} suggestions`) : good('0 suggestions')}${result.summary.infos ? ` | ${result.summary.infos} infos` : ''}`);
      break;
    }
    case 'patterns': {
      out.push(heading('Tool Pattern Analysis'));
      out.push(`Period: Last ${result.period}`);
      out.push('='.repeat(40));
      out.push('');
      out.push(heading('Task Breakdown'));
      for (const t of result.taskBreakdown) {
        const rate = t.successRate;
        const rateStr = rate >= 80 ? good(`${rate}%`) : rate >= 50 ? warn(`${rate}%`) : bad(`${rate}%`);
        out.push(`  ${t.task.padEnd(14)} ${String(t.calls).padEnd(6)} calls  ${rateStr}  (${t.uniqueTools} tools)`);
      }
      if (result.bestCombos.length > 0) {
        out.push('');
        out.push(heading('Best Tool Combinations'));
        for (const c of result.bestCombos.slice(0, 10)) {
          const rate = c.successRate;
          const rateStr = rate >= 80 ? good(`${rate}%`) : rate >= 50 ? warn(`${rate}%`) : bad(`${rate}%`);
          out.push(`  ${c.combo.padEnd(40)} ${String(c.uses).padEnd(4)} uses  ${rateStr}`);
        }
      }
      if (result.topTools.worst.length > 0) {
        out.push('');
        out.push(heading('Tools Needing Attention'));
        for (const t of result.topTools.worst) {
          out.push(`  ${bad('⚠')} ${t.name.padEnd(25)} ${t.rate}% success (${t.calls} calls)`);
        }
      }
      out.push('');
      out.push(heading('Summary'));
      out.push(`  ${result.sessionsFound} sessions | ${result.totalEntries} calls | ${result.taskBreakdown.length} task types`);
      break;
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Pattern analysis command
// ---------------------------------------------------------------------------

/**
 * Infer task type from tool name.
 */
function inferTaskType(toolName) {
  const t = toolName.toLowerCase();
  if (t.includes('grep') || t.includes('search') || t.includes('glob')) return 'search';
  if (t.includes('debug') || t.includes('error') || t.includes('diagnose')) return 'debug';
  if (t.includes('security') || t.includes('scan')) return 'security';
  if (t.includes('test') || t.includes('coverage')) return 'test';
  if (t.includes('rename') || t.includes('cross') || t.includes('edit')) return 'refactor';
  if (t.includes('import') || t.includes('graph') || t.includes('learn')) return 'analysis';
  if (t.includes('git')) return 'git';
  if (t.includes('diagram') || t.includes('report')) return 'documentation';
  if (t.includes('py') || t.includes('ts') || t.includes('helper')) return 'language';
  if (t.includes('store') || t.includes('memory')) return 'memory';
  if (t.includes('planner') || t.includes('workflow')) return 'planning';
  return 'other';
}

function cmdPatterns(root, opts) {
  const stats = loadStats(root);
  const entries = stats.entries;
  const days = opts.days || 30;
  const top = opts.top || 15;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);

  if (recent.length === 0) {
    return { period: `${days} days`, totalEntries: 0, patterns: [], summary: { message: 'No data in period' } };
  }

  // 1. Group by session or time proximity (within 5 min = same task)
  const sorted = [...recent].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const sessions = [];
  let currentSession = { start: sorted[0].timestamp, tools: new Set(), successes: 0, failures: 0, entries: [] };

  for (const e of sorted) {
    const timeDiff = Math.abs(new Date(e.timestamp) - new Date(currentSession.start)) / 1000 / 60;
    if (timeDiff > 5) {
      // New session
      sessions.push(currentSession);
      currentSession = { start: e.timestamp, tools: new Set(), successes: 0, failures: 0, entries: [] };
    }
    currentSession.tools.add(e.tool);
    if (e.success === true) currentSession.successes++;
    if (e.success === false) currentSession.failures++;
    currentSession.entries.push(e);
  }
  sessions.push(currentSession);

  // 2. Analyze tool combinations
  const comboStats = {};
  for (const session of sessions) {
    if (session.tools.size < 2) continue; // need at least 2 tools for a combo
    const toolList = [...session.tools].sort();
    for (let i = 0; i < toolList.length; i++) {
      for (let j = i + 1; j < toolList.length; j++) {
        const key = `${toolList[i]} + ${toolList[j]}`;
        if (!comboStats[key]) {
          comboStats[key] = { tool1: toolList[i], tool2: toolList[j], uses: 0, successes: 0, failures: 0 };
        }
        comboStats[key].uses++;
        if (session.failures === 0) comboStats[key].successes++;
        else comboStats[key].failures++;
      }
    }
  }

  // 3. Per-tool success by inferred task type
  const taskToolStats = {};
  for (const e of recent) {
    const task = inferTaskType(e.tool);
    if (!taskToolStats[task]) taskToolStats[task] = { calls: 0, successes: 0, failures: 0, tools: new Set() };
    taskToolStats[task].calls++;
    if (e.success === true) taskToolStats[task].successes++;
    if (e.success === false) taskToolStats[task].failures++;
    taskToolStats[task].tools.add(e.tool);
  }

  // 4. Best/worst performing tools
  const toolPerf = {};
  for (const e of recent) {
    if (!toolPerf[e.tool]) toolPerf[e.tool] = { calls: 0, successes: 0, failures: 0 };
    toolPerf[e.tool].calls++;
    if (e.success === true) toolPerf[e.tool].successes++;
    if (e.success === false) toolPerf[e.tool].failures++;
  }

  const toolList = Object.entries(toolPerf)
    .map(([name, s]) => ({ name, ...s, rate: s.calls > 0 ? s.successes / s.calls : 0 }))
    .filter(t => t.calls >= 3)
    .sort((a, b) => b.rate - a.rate);

  const bestTools = toolList.slice(0, 5);
  const worstTools = toolList.filter(t => t.rate < 0.6).slice(0, 5);

  // 5. Best combos
  const bestCombos = Object.entries(comboStats)
    .map(([combo, s]) => ({ combo, ...s, rate: s.uses > 0 ? s.successes / s.uses : 0 }))
    .filter(c => c.uses >= 2)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, top);

  return {
    period: `${days} days`,
    totalEntries: recent.length,
    sessionsFound: sessions.length,
    taskBreakdown: Object.entries(taskToolStats)
      .map(([task, s]) => ({
        task,
        calls: s.calls,
        successRate: s.calls > 0 ? Math.round((s.successes / s.calls) * 100) : 0,
        uniqueTools: s.tools.size,
      }))
      .sort((a, b) => b.calls - a.calls),
    bestCombos: bestCombos.map(c => ({
      combo: c.combo,
      uses: c.uses,
      successRate: Math.round(c.rate * 100),
    })),
    topTools: {
      best: bestTools.map(t => ({ name: t.name, rate: Math.round(t.rate * 100), calls: t.calls })),
      worst: worstTools.map(t => ({ name: t.name, rate: Math.round(t.rate * 100), calls: t.calls })),
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node tool-stats.mjs <command> [options]

Tool usage statistics tracker and analyzer.

Commands:
  record <name>   Record a tool usage entry
  report          Generate usage statistics report
  trends          Show usage trends over time
  recommendations Suggest tool/strategy improvements
  patterns        Analyze tool combination effectiveness

Options:
  --root <path>         Root directory (default: .)
  --data-dir <path>     Stats data directory (default: .opencode/stats)
  --duration <ms>       Duration in milliseconds (for record)
  --success <bool>      Whether the tool call succeeded (for record)
  --args <json>         Tool arguments as JSON string (for record)
  --session <id>        Session identifier (for record)
  --format <fmt>        Output: text, json, markdown (default: text)
  --days <N>            Analyze last N days (default: 30)
  --top <N>             Show top N tools (default: 10)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node tool-stats.mjs record diagram.mjs --duration 1200 --success true
  node tool-stats.mjs report --days 7
  node tool-stats.mjs recommendations
  node tool-stats.mjs trends --format json
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownCommands = ['record', 'report', 'trends', 'recommendations', 'patterns'];
  const opts = {
    command: knownCommands.includes(args[0]) ? args[0] : null,
    commandArgs: [],
    root: '.',
    format: 'text',
    duration: null,
    success: undefined,
    args: null,
    session: null,
    days: 30,
    top: 10,
    color: undefined,
  };

  if (!opts.command) {
    console.error(`Unknown command: ${args[0]}`);
    console.error(`Valid commands: ${knownCommands.join(', ')}`);
    process.exit(1);
  }

  // Collect positional args (name for record)
  let i = 1;
  if (opts.command === 'record') {
    if (args.length < 2) {
      console.error('Usage: tool-stats.mjs record <tool-name> [options]');
      process.exit(1);
    }
    opts.commandArgs.push(args[1]);
    i = 2;
  }

  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--duration': opts.duration = parseInt(args[++i], 10); break;
      case '--success': opts.success = args[++i] === 'true' || args[++i] === '1'; break;
      case '--args': opts.args = args[++i]; break;
      case '--session': opts.session = args[++i]; break;
      case '--days': opts.days = parseInt(args[++i], 10); break;
      case '--top': opts.top = parseInt(args[++i], 10); break;
      case '--no-color': opts.color = false; break;
      case '--color': opts.color = true; break;
    }
    i++;
  }

  // Fix the --success issue (double increment)
  // Re-parse args more carefully
  i = opts.command === 'record' ? 2 : 1;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--success') {
      const val = args[i + 1];
      opts.success = val === 'true' || val === '1';
    }
    i++;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  let result;
  switch (opts.command) {
    case 'record': {
      const name = opts.commandArgs[0];
      if (!name) {
        console.error('Tool name required for record command');
        process.exit(1);
      }
      result = cmdRecord(root, name, opts);
      break;
    }
    case 'report':
      result = cmdReport(root, opts);
      break;
    case 'trends':
      result = cmdTrends(root, opts);
      break;
    case 'recommendations':
      result = cmdRecommendations(root, opts);
      break;
    case 'patterns':
      result = cmdPatterns(root, opts);
      break;
  }

  switch (opts.format) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'markdown':
      console.log(formatText(opts.command, result, opts, false));
      break;
    case 'text':
    default:
      console.log(formatText(opts.command, result, opts, color));
      break;
  }
}

main();
