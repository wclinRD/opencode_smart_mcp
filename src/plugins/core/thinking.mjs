import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deepAnalyze,
  startDynamicSession,
  execStateCommand,
} from '../../cli/thinking.mjs';

export default {
  name: 'smart_thinking',
  category: 'think',
  description: 'Use when: need structured reasoning — analyzing complex problems, debugging, making decisions, researching, or planning. Supports 9 templates (debug/refactor/feature/research/decision/analyze/plan_execute/retrospect/architecture) + 3 modes (static/iterative/dynamic). Avoid when: need quick answer to simple question (use quick-think instead).',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic/question to analyze (required for static/dynamic modes)' },
      template: { type: 'string', enum: ['debug', 'refactor', 'feature', 'research', 'decision', 'analyze', 'plan_execute', 'retrospect', 'architecture'], description: 'Thinking template (default: analyze)' },
      steps: { type: 'number', description: 'Steps (default: 5)' },
      format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format for static mode (default: text)' },
      plan: { type: 'string', description: 'JSON plan string (from planner) for plan_execute context' },
      planStep: { type: 'number', description: 'Focus on specific plan step (1-indexed)' },
      iterative: { type: 'boolean', description: 'Interactive mode: one step at a time with prompts' },
      // Dynamic multi-step reasoning mode
      dynamic: { type: 'boolean', description: 'Start dynamic reasoning session (state-file based multi-round). Use with topic + optional template.' },
      state: { type: 'string', description: 'State file path for dynamic mode (default: ~/.smart/thinking-state.json)' },
      record: { type: 'string', description: 'Record result for step: "idx:result" format, e.g. "2:The error is TypeError"' },
      advance: { type: 'boolean', description: 'Advance to next thinking step after recording result' },
      branch: { type: 'string', description: 'Select branch path by name after completing a step (e.g. "hypothesis-confirmed", "needs-deeper")' },
      finish: { type: 'boolean', description: 'Mark thinking session complete, show full summary' },
      status: { type: 'boolean', description: 'Show current thinking state without advancing' },
      cancel: { type: 'boolean', description: 'Cancel the thinking session' },
      restore: { type: 'string', description: 'Load and display saved state file (shorthand for status)' },
    },
    required: [],
  },
  cli: 'thinking.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.topic) cli.push(String(a.topic));
    if (a.template) cli.push('--template', String(a.template));
    if (a.steps) cli.push('--steps', String(a.steps));
    if (a.format) cli.push('--format', String(a.format));
    if (a.iterative) cli.push('--iterative');
    if (a.dynamic) cli.push('--dynamic');
    if (a.plan) cli.push('--plan', String(a.plan));
    if (a.planStep) cli.push('--plan-step', String(a.planStep));
    if (a.state) cli.push('--state', String(a.state));
    if (a.record) cli.push('--record', String(a.record));
    if (a.advance) cli.push('--advance');
    if (a.branch) cli.push('--branch', String(a.branch));
    if (a.finish) cli.push('--finish');
    if (a.status) cli.push('--status');
    if (a.cancel) cli.push('--cancel');
    if (a.restore) cli.push('--restore', String(a.restore));
    cli.push('--no-color');
    return cli;
  },
  /** Direct handler — no process spawn overhead. Falls through to CLI for iterative mode. */
  handler(args) {
    // Parse plan JSON string if provided
    let planObj = null;
    if (args.plan) {
      try {
        planObj = JSON.parse(args.plan);
      } catch { /* ignore parse errors, pass raw string */ }
    }

    const defaultStatePath = resolve(process.env.HOME || '.', '.smart', 'thinking-state.json');

    // Helper: ensure state file exists for mutation commands
    function requireState(sp) {
      if (!existsSync(sp)) {
        throw new Error(`No active thinking session. Start one with --dynamic or check --state path: ${sp}`);
      }
      return sp;
    }

    // --restore: load and display saved state
    if (args.restore) {
      const result = execStateCommand(args.restore, { type: 'restore' });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --cancel: cancel session
    if (args.cancel) {
      const sp = requireState(args.state || defaultStatePath);
      const result = execStateCommand(sp, { type: 'cancel' });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --record: record step result
    if (args.record) {
      const sp = requireState(args.state || defaultStatePath);
      // Parse "idx:result" format
      const recordStr = String(args.record);
      const colonIdx = recordStr.indexOf(':');
      let index, result;
      if (colonIdx > 0 && !isNaN(parseInt(recordStr.slice(0, colonIdx), 10))) {
        index = parseInt(recordStr.slice(0, colonIdx), 10);
        result = recordStr.slice(colonIdx + 1);
      } else {
        index = parseInt(recordStr, 10);
        result = '';
      }
      // Convert 1-indexed user input to 0-indexed internal
      const zeroIndex = index - 1;
      const r = execStateCommand(sp, {
        type: 'record',
        index: zeroIndex,
        result,
        advance: args.advance ?? true,
      });
      if (r.error) throw new Error(r.error);

      // --finish combined: after recording, also mark session complete and show summary
      if (args.finish) {
        const finishResult = execStateCommand(sp, { type: 'finish' });
        if (finishResult.error) throw new Error(finishResult.error);
        return finishResult.output;
      }

      return r.output;
    }

    // --advance alone (without --record): advance to next step
    if (args.advance && !args.record) {
      const sp = requireState(args.state || defaultStatePath);
      const result = execStateCommand(sp, { type: 'advance' });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --branch: select branch path
    if (args.branch) {
      const sp = requireState(args.state || defaultStatePath);
      const result = execStateCommand(sp, { type: 'branch', branchName: String(args.branch) });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --finish: mark complete, show summary
    if (args.finish) {
      const sp = requireState(args.state || defaultStatePath);
      const result = execStateCommand(sp, { type: 'finish' });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --status: show current state
    if (args.status) {
      const sp = args.state || defaultStatePath;
      if (!existsSync(sp)) {
        return 'No active thinking session. Start one with --dynamic.';
      }
      const result = execStateCommand(sp, { type: 'status' });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // --dynamic: start new dynamic session
    if (args.dynamic) {
      if (!args.topic) {
        throw new Error('--dynamic requires a topic.');
      }
      const result = startDynamicSession({
        topic: String(args.topic),
        template: args.template || 'analyze',
        state: args.state || undefined,
        plan: planObj || undefined,
      });
      if (result.error) throw new Error(result.error);
      return result.output;
    }

    // Iterative mode — cannot handle in-process, fall through to CLI
    if (args.iterative) {
      return null; // Signals smart-mcp to fall back to CLI spawn
    }

    // Default: static deep analysis
    const result = deepAnalyze({
      topic: args.topic || (planObj ? (planObj.goal || '') : '') || '',
      template: args.template || 'analyze',
      steps: args.steps || 5,
      format: args.format || 'text',
      plan: planObj || undefined,
      planStep: args.planStep,
    });
    if (result.error) throw new Error(result.error);
    return result.output;
  },
};
