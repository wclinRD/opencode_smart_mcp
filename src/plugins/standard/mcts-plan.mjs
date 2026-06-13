// mcts-plan.mjs — MCTS Tool Planning MCP Tool (Phase 17)
//
// smart_mcts_plan — 使用蒙地卡羅樹搜尋最佳工具鏈
// 適用於 5+ 步驟的複雜 multi-step 任務

import { MCTSPlanner } from '../../lib/mcts-planner.mjs';

export default {
  name: 'smart_mcts_plan',
  category: 'standard',
  description: `MCTS-based tool planning — uses Monte Carlo Tree Search to find the optimal tool chain for complex multi-step tasks.
Use when: task requires 5+ steps, involves multiple files/tools, or static routing is uncertain.
Avoid when: simple tasks with clear tool mappings (use smart_agent_recommend instead).`,

  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Task goal description',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Available tools to consider (default: all standard tools)',
      },
      context: {
        type: 'object',
        description: 'Task context { workdir, args, previousResults }',
        additionalProperties: true,
      },
      maxIterations: {
        type: 'number',
        description: 'Max MCTS iterations (default: 100)',
        default: 100,
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 30000)',
        default: 30000,
      },
      useFallback: {
        type: 'boolean',
        description: 'Fall back to static matching if MCTS times out (default: true)',
        default: true,
      },
    },
    required: ['goal'],
  },

  handler: async (args) => {
    const {
      goal,
      tools: userTools,
      context = {},
      maxIterations = 100,
      timeout = 30000,
      useFallback = true,
    } = args;

    // Define the default tool pool (key MCTS tools)
    const defaultToolPool = [
      { name: 'smart_grep', description: 'Search code with regex', inputSchema: { properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
      { name: 'smart_learn', description: 'Understand project structure, tech stack, deps', inputSchema: { properties: { root: { type: 'string' } } } },
      { name: 'smart_lsp', description: 'Type-aware code understanding: hover, definition, references', inputSchema: { properties: { operation: { type: 'string' }, file: { type: 'string' } }, required: ['operation'] } },
      { name: 'smart_security', description: 'Scan for credentials, injection, deps vulnerabilities', inputSchema: { properties: { scan: { type: 'string' } } } },
      { name: 'smart_test', description: 'Discover and run project tests', inputSchema: { properties: { include: { type: 'string' } } } },
      { name: 'smart_deep_think', description: 'Deep structured analysis with 10 templates', inputSchema: { properties: { topic: { type: 'string' }, template: { type: 'string' } }, required: ['topic'] } },
      { name: 'smart_import_graph', description: 'Import dependency graph analysis', inputSchema: { properties: { root: { type: 'string' } } } },
      { name: 'smart_code_impact', description: 'Change impact analysis from git diff or file+symbol', inputSchema: { properties: { file: { type: 'string' } } } },
      { name: 'smart_error_diagnose', description: 'Diagnose error messages against pattern KB', inputSchema: { properties: { error: { type: 'string' } }, required: ['error'] } },
      { name: 'smart_fast_apply', description: 'Apply LLM patches (unified-diff / SEARCH-REPLACE)', inputSchema: { properties: { patch: { type: 'string' } }, required: ['patch'] } },
      { name: 'smart_edit', description: 'Simple string replacement edits', inputSchema: { properties: { oldString: { type: 'string' }, newString: { type: 'string' } }, required: ['oldString', 'newString'] } },
      { name: 'smart_cross_file_edit', description: 'Cross-file edits with import graph awareness', inputSchema: { properties: { file: { type: 'string' }, pattern: { type: 'string' } }, required: ['file'] } },
      { name: 'smart_rename_safety', description: 'Safe symbol renaming across files', inputSchema: { properties: { name: { type: 'string' }, newName: { type: 'string' } }, required: ['name', 'newName'] } },
      { name: 'smart_git_context', description: 'Understand git status and history', inputSchema: { properties: { root: { type: 'string' } } } },
      { name: 'smart_git_commit', description: 'Create a git commit', inputSchema: { properties: { message: { type: 'string' } }, required: ['message'] } },
      { name: 'smart_memory_store', description: 'Store and search past error resolutions', inputSchema: { properties: { command: { type: 'string' }, query: { type: 'string' } }, required: ['command'] } },
      { name: 'smart_planner', description: 'Break down complex goals into steps', inputSchema: { properties: { goal: { type: 'string' } }, required: ['goal'] } },
      { name: 'smart_exa_search', description: 'Web search via Exa API', inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'smart_ingest_document', description: 'Read PDF/DOCX/XLSX/PPTX/HTML documents', inputSchema: { properties: { path: { type: 'string' } }, required: ['path'] } },
      { name: 'smart_workflow', description: 'Execute predefined tool chain workflows', inputSchema: { properties: { command: { type: 'string' }, name: { type: 'string' } }, required: ['command'] } },
      { name: 'smart_agent_recommend', description: 'Recommend tools for a task description', inputSchema: { properties: { goal: { type: 'string' } }, required: ['goal'] } },
      { name: 'smart_academic_search', description: 'Search academic literature', inputSchema: { properties: { source: { type: 'string' }, query: { type: 'string' } }, required: ['source'] } },
      { name: 'smart_hallucination_check', description: 'Verify LLM output for hallucinations', inputSchema: { properties: { output: { type: 'string' } }, required: ['output'] } },
      { name: 'smart_docx_generate', description: 'Generate APA 7th formatted DOCX', inputSchema: { properties: { title: { type: 'string' } }, required: ['title'] } },
      { name: 'smart_rules', description: 'Query project rules files', inputSchema: { properties: { file: { type: 'string' } } } },
      { name: 'smart_context', description: 'Manage session context and budget', inputSchema: { properties: { command: { type: 'string' } }, required: ['command'] } },
      { name: 'smart_think', description: 'Quick conversational reasoning (default mode: cit)', inputSchema: { properties: { thought: { type: 'string' }, mode: { type: 'string' } }, required: ['thought'] } },
    ];

    // Filter to user-specified tools if provided
    const availableTools = userTools && userTools.length > 0
      ? defaultToolPool.filter(t => userTools.includes(t.name))
      : defaultToolPool;

    const planner = new MCTSPlanner({
      maxIterations,
      timeout,
      availableTools,
    });

    try {
      const result = await planner.search({
        goal,
        availableTools,
        context,
        executeTool: null, // MCTS runs pre/post evaluation without actual execution
      });

      // If no path found or score too low, try fallback
      if ((!result.path || result.path.length === 0 || result.score < 0.2) && useFallback) {
        const fallback = MCTSPlanner.fallbackRecommendation(goal, availableTools.map(t => t.name));
        return JSON.stringify({
          ok: true,
          method: result.iterations > 0 ? 'mcts-fallback' : 'static-fallback',
          plan: fallback.path,
          score: fallback.score,
          mctsResult: result,
          fallbackReason: result.iterations === 0 ? 'timeout' : 'low-score',
        }, null, 2);
      }

      // Format the path with tool descriptions
      const enrichedPath = (result.path || []).map(step => {
        const toolDef = availableTools.find(t => t.name === step.tool);
        return {
          tool: step.tool,
          description: toolDef ? toolDef.description : '',
          args: step.args || {},
          confidence: Math.round(step.score * 100) / 100,
        };
      });

      return JSON.stringify({
        ok: true,
        method: result.converged ? 'mcts-converged' : 'mcts-max-iterations',
        plan: enrichedPath,
        score: Math.round(result.score * 100) / 100,
        iterations: result.iterations,
        converged: result.converged,
        elapsed: result.elapsed,
        stats: result.stats,
        fallbackStep: result.stats?.note || null,
      }, null, 2);
    } catch (err) {
      if (useFallback) {
        const fallback = MCTSPlanner.fallbackRecommendation(goal, availableTools.map(t => t.name));
        return JSON.stringify({
          ok: true,
          method: 'error-fallback',
          error: err.message,
          plan: fallback.path,
          score: fallback.score,
        }, null, 2);
      }
      return JSON.stringify({
        ok: false,
        error: `MCTS planning failed: ${err.message}`,
      }, null, 2);
    }
  },
};
