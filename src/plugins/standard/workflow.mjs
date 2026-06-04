export default {
  name: 'smart_workflow',
  category: 'standard',
  description: 'Use when: need to run a multi-tool workflow (debug/refactor/security/research), track step execution, report results, or re-plan after failure. Supports composite templates that orchestrate multiple tools in dependency order. Commands: create (from template) | report (step result) | replan (after failure) | summary (state) | list-templates.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['create', 'report', 'replan', 'summary', 'list-templates'],
        description: 'create (start new workflow from template) | report (record step result) | replan (re-plan after failure) | summary (show workflow state) | list-templates (show available templates)' },
      goal: { type: 'string', description: 'Goal description (for create)' },
      template: { type: 'string', description: 'Workflow template name: debug-flow, refactor-flow, security-flow, research-flow, default-flow (for create)' },
      state: { type: 'string', description: 'Path to workflow state file (for report/replan/summary)' },
      step: { type: 'number', description: 'Step number being reported (for report)' },
      stepStatus: { type: 'string', enum: ['ok', 'fail', 'skip'], description: 'Step execution status (for report, default: ok)' },
      result: { type: 'string', description: 'Step result as JSON string (for report)' },
      error: { type: 'string', description: 'Error message if step failed (for report)' },
      duration: { type: 'number', description: 'Step execution duration in ms (for report)' },
      context: { type: 'string', description: 'Additional context for plan generation (for create/replan)' },
      format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
    },
  },
  cli: 'workflow.mjs',
  mapArgs(a) {
    const cli = [];

    // List-templates command
    if (a.command === 'list-templates') {
      cli.push('list-templates');
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Create command — new workflow from template
    if (a.command === 'create') {
      cli.push('create');
      if (a.goal) cli.push(String(a.goal));
      if (a.template) cli.push('--template', String(a.template));
      if (a.state) cli.push('--state', String(a.state));
      if (a.context) cli.push('--context', String(a.context));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Report command — record step result
    if (a.command === 'report') {
      cli.push('report');
      if (a.state) cli.push('--state', String(a.state));
      if (a.step !== undefined && a.step !== null) cli.push('--step', String(a.step));
      if (a.stepStatus) cli.push('--status', String(a.stepStatus));
      if (a.result) cli.push('--result', String(a.result));
      if (a.error) cli.push('--error', String(a.error));
      if (a.duration) cli.push('--duration', String(a.duration));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Replan command — re-plan after failure
    if (a.command === 'replan') {
      cli.push('replan');
      if (a.state) cli.push('--state', String(a.state));
      if (a.context) cli.push('--context', String(a.context));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    // Summary command — show workflow state
    if (a.command === 'summary') {
      cli.push('summary');
      if (a.state) cli.push('--state', String(a.state));
      if (a.format) cli.push('--format', String(a.format));
      return cli;
    }

    return cli;
  },
};
