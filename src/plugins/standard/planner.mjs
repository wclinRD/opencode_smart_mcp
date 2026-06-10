export default {
  name: 'smart_planner',
  category: 'plan',
  description: 'Use when: need to decompose a goal into steps, track execution state, or re-plan on failure. Supports plan generation + execution state (execute/next/report/replan commands). Use its output as input for smart_deep_think plan_execute template. For full lifecycle: execute → next → report (repeats) → done. On step failure, auto-replans remaining steps.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Natural language goal/description' },
      command: { type: 'string', enum: ['plan', 'execute', 'next', 'report', 'replan', 'analyze', 'list-tasks'], 
        description: 'plan (default, generate plan only) | execute (plan + state file) | next (get next step) | report (record result) | replan (force re-plan) | analyze (tool sequence) | list-tasks (show templates)' },
      tools: { type: 'string', description: 'Comma-separated tool names (for analyze)' },
      context: { type: 'string', description: 'Additional context (e.g. file=src/index.js) for plan/execute/replan' },
      steps: { type: 'number', description: 'Max steps in plan (default: 10)' },
      strict: { type: 'boolean', description: 'Only use tools that exist in registry' },
      state: { type: 'string', description: 'Path to plan state file (for next/report/replan)' },
      step: { type: 'number', description: 'Step number being reported (for report)' },
      stepStatus: { type: 'string', enum: ['ok', 'fail', 'skip'], description: 'Step execution status (for report, default: ok)' },
      result: { type: 'string', description: 'Step result as JSON string (for report)' },
      error: { type: 'string', description: 'Error message if step failed (for report)' },
      duration: { type: 'number', description: 'Step execution duration in ms (for report)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
    },
  },
  cli: 'planner.mjs',
  mapArgs(a) {
    const cli = [];

    // List-tasks command
    if (a.command === 'list-tasks') { cli.push('list-tasks'); return cli; }

    // Analyze command
    if (a.command === 'analyze') {
      cli.push('analyze');
      if (a.tools) cli.push(String(a.tools));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Execute command — plan + state file
    if (a.command === 'execute') {
      cli.push('execute');
      if (a.goal) cli.push(String(a.goal));
      if (a.context) cli.push('--context', String(a.context));
      if (a.steps) cli.push('--steps', String(a.steps));
      if (a.strict) cli.push('--strict');
      if (a.state) cli.push('--state', String(a.state));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Next command — get next runnable step
    if (a.command === 'next') {
      cli.push('next');
      if (a.state) cli.push('--state', String(a.state));
      return cli;
    }

    // Report command — record step result
    if (a.command === 'report') {
      cli.push('report');
      if (a.state) cli.push('--state', String(a.state));
      if (a.step) cli.push('--step', String(a.step));
      if (a.stepStatus) cli.push('--status', String(a.stepStatus));
      if (a.result) cli.push('--result', String(a.result));
      if (a.error) cli.push('--error', String(a.error));
      if (a.duration) cli.push('--duration', String(a.duration));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Replan command — force re-plan
    if (a.command === 'replan') {
      cli.push('replan');
      if (a.state) cli.push('--state', String(a.state));
      if (a.context) cli.push('--context', String(a.context));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Default: plan generation (backward compat)
    if (a.goal) cli.push(String(a.goal));
    if (a.context) cli.push('--context', String(a.context));
    if (a.steps) cli.push('--steps', String(a.steps));
    if (a.strict) cli.push('--strict');
    if (a.format) cli.push('--format', String(a.format));
    return cli;
  },
};
