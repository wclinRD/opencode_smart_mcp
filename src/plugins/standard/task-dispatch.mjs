// task-dispatch.mjs — Smart Task Dispatcher
//
// Generates properly formatted task() calls with Smart MCP routing rules
// pre-injected. Tracks usage statistics for observability.
//
// The MCP server cannot call task() directly (it's a native OpenCode tool),
// so this tool serves as a template generator: it returns a ready-to-call
// task() block that the LLM can execute.
//
// Usage:
//   smart_run(tool: "task_dispatch", args: { task: "fix login bug" })
//   smart_run(tool: "task_dispatch", args: { task: "research auth", type: "explore" })
//
// Output: formatted task() call with routing rules, plus tracking info.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stats file path — shared across sessions
const STATS_DIR = join(homedir(), '.smart');
const STATS_PATH = join(STATS_DIR, 'task-dispatch-stats.json');
if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });

// Load or init stats
function loadStats() {
  try {
    if (existsSync(STATS_PATH)) {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    }
  } catch { /* fall through */ }
  return { totalDispatches: 0, byType: {}, recentTasks: [] };
}

function saveStats(stats) {
  try {
    writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  } catch { /* best effort */ }
}

// Routing injection templates by subagent type
const ROUTING_INJECTIONS = {
  'mcp-agent': `[Smart MCP Routing — injected by parent]
工具優先順序：smart_smart_read > smart_smart_lsp > smart_smart_grep > 原生 read/grep
編輯用 smart_smart_fast_apply（取代 write+edit）
不確定工具 → smart_smart_run({tool:"hybrid_router", args:{question:"..."}})
修復前跑 smart_smart_think({mode:"cit", branchingNeeded:false, thought:"..."})
查專案慣例 → smart_smart_rules({file:"..."})`,

  'general': `[Smart MCP Routing — injected by parent]
工具優先順序：smart_smart_read > smart_smart_lsp > smart_smart_grep > 原生 read/grep
編輯用 smart_smart_fast_apply（取代 write+edit，直接呼叫）
不確定工具 → smart_smart_run({tool:"hybrid_router", args:{question:"..."}})
安全修復前必須跑 smart_smart_think({mode:"beam"})
查專案慣例 → smart_smart_rules({file:"..."})`,

  'explore': `[Smart MCP Routing — injected by parent]
你只有基礎工具（read/grep/glob/bash/webfetch/websearch），無 Smart MCP 工具。
需要 MCP 工具時回報主代理，由主代理用 task() 開 mcp-agent 或 general 子代理。`,

  'explorer': `[Smart MCP Routing — injected by parent]
你只有基礎工具（read/grep/glob/bash），無 Smart MCP 工具。
需要 MCP 工具時回報主代理，由主代理用 task() 開 mcp-agent 或 general 子代理。`,
};

const SUBAGENT_DESCRIPTIONS = {
  'mcp-agent': '有 Smart MCP 工具 + 內建路由規則（推薦）',
  'general': '有完整工具存取，需手動注入路由規則',
  'explore': '僅基礎工具，適用快速檔案探索',
  'explorer': '僅基礎工具，最輕量探索',
};

const SUBAGENT_TOOL_COUNTS = {
  'mcp-agent': '11 個 MCP 工具 + 4 個原生工具',
  'general': '全部工具',
  'explore': '6 個原生工具',
  'explorer': '5 個原生工具',
};

export default {
  name: 'smart_task_dispatch',
  category: 'standard',
  description: 'Smart Task Dispatcher — generates a formatted task() call with Smart MCP routing rules pre-injected. Use when you need to dispatch work to a subagent and want consistent routing injection + usage tracking. Returns a ready-to-execute task() block. Tracks dispatch statistics across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description for the subagent (what to do, what to return)',
      },
      type: {
        type: 'string',
        enum: ['mcp-agent', 'general', 'explore', 'explorer'],
        description: 'Subagent type (default: mcp-agent). mcp-agent = MCP tools + built-in routing (recommended). general = full tools, manual routing. explore = native tools only, fast exploration.',
      },
      context: {
        type: 'string',
        description: 'Optional context about the codebase, prior work, or constraints',
      },
      verify: {
        type: 'string',
        description: 'Optional verification instructions (e.g., "run npm test" or "check lint")',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'call'],
        description: 'Output format (default: text)',
      },
    },
    required: ['task'],
  },

  async handler(args) {
    const { task, type = 'mcp-agent', context, verify, format = 'text' } = args;

    // Validate subagent type exists
    if (!ROUTING_INJECTIONS[type]) {
      return `❌ Unknown subagent type "${type}". Available: ${Object.keys(ROUTING_INJECTIONS).join(', ')}`;
    }

    // Track usage
    const stats = loadStats();
    stats.totalDispatches++;
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    stats.recentTasks.unshift({ task: task.slice(0, 80), type, timestamp: new Date().toISOString() });
    if (stats.recentTasks.length > 50) stats.recentTasks.length = 50;
    saveStats(stats);

    // Build routing injection
    const routing = ROUTING_INJECTIONS[type];

    // Build the task prompt
    let prompt = `${routing}\n\n${task}`;
    if (context) prompt += `\n\n**Context**: ${context}`;
    if (verify) prompt += `\n\n**Verification**: ${verify}`;
    prompt += `\n\n只回傳最終結果給主代理，不要保留中間過程到回報中。`;

    // Build the description (short)
    const description = task.slice(0, 60) + (task.length > 60 ? '...' : '');

    // Build the task() call
    const taskCall = `task({
  description: "${description.replace(/"/g, '\\"')}",
  prompt: "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
  subagent_type: "${type}"
})`;

    // Build stats summary
    const statLine = `📊 Task Dispatch Stats: ${stats.totalDispatches} total | ${Object.entries(stats.byType).map(([t, n]) => `${t}: ${n}`).join(' | ')}`;

    if (format === 'json') {
      return JSON.stringify({
        subagentType: type,
        typeDescription: SUBAGENT_DESCRIPTIONS[type],
        availableTools: SUBAGENT_TOOL_COUNTS[type],
        taskCall,
        stats: {
          totalDispatches: stats.totalDispatches,
          byType: stats.byType,
        },
        instructions: 'Execute the taskCall above to dispatch work to the subagent.',
      }, null, 2);
    }

    if (format === 'call') {
      // Return ONLY the task() call for programmatic use
      return taskCall;
    }

    // Default: text format with explanation
    return [
      `## 🚀 Task Dispatch — ${description}`,
      ``,
      `**Subagent**: \`${type}\` — ${SUBAGENT_DESCRIPTIONS[type]}`,
      `**Available tools**: ${SUBAGENT_TOOL_COUNTS[type]}`,
      ``,
      `### Executable task() call`,
      `Copy and execute the following:`,
      `\`\`\`javascript`,
      taskCall,
      `\`\`\``,
      ``,
      `${statLine}`,
      ``,
      `💡 Tip: Use type="mcp-agent" (default) for most tasks. Use "explore" for quick file searches (no MCP overhead).`,
    ].join('\n');
  },
};
