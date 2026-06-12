// workflow-templates.mjs — smart_workflow MCP tool
//
// Preset workflow templates for common development tasks.
// LLM can list available workflows or run one by name.
//
// Phase 23: Workflow Templates

export default {
  name: 'smart_workflow',
  description: 'List or run preset workflow templates for common tasks (bug-fix, refactor, security-fix, pr-review, new-feature, onboard, doc-analysis).',
  category: 'standard',
  domain: 'plan',
  safetyLevel: 'low',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 0 },

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['list', 'run'],
        description: 'Command: list (show all workflows) or run (execute a workflow by name)'
      },
      name: {
        type: 'string',
        description: 'Workflow name to run (required for run command)'
      },
      context: {
        type: 'object',
        description: 'Additional context for the workflow (e.g., {error: "...", files: [...]})'
      }
    },
    required: ['command']
  },

  handler: async (args, context) => {
    const { command, name, context: workflowContext } = args;

    const workflows = getWorkflowDefinitions();

    switch (command) {
      case 'list': {
        const list = Object.entries(workflows).map(([key, wf]) => ({
          name: key,
          description: wf.description,
          steps: wf.steps.map(s => s.tool),
          estimatedTools: wf.steps.length
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              command: 'list',
              count: list.length,
              workflows: list,
              usage: 'Use smart_workflow({command:"run", name:"<name>", context:{...}}) to execute a workflow.'
            }, null, 2)
          }]
        };
      }

      case 'run': {
        if (!name) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'name parameter is required for run command' }) }],
            isError: true
          };
        }

        const workflow = workflows[name];
        if (!workflow) {
          const available = Object.keys(workflows).join(', ');
          return {
            content: [{ type: 'text', text: JSON.stringify({
              ok: false,
              error: `Unknown workflow: "${name}"`,
              available,
              hint: 'Use smart_workflow({command:"list"}) to see all workflows.'
            }) }],
            isError: true
          };
        }

        // Generate the workflow plan — LLM will execute each step
        const plan = {
          ok: true,
          command: 'run',
          workflow: name,
          description: workflow.description,
          steps: workflow.steps.map((step, i) => ({
            step: i + 1,
            tool: step.tool,
            description: step.description,
            args: step.args ? step.args(workflowContext || {}) : {},
            hint: step.hint || ''
          })),
          instruction: `Execute each step in order. Use the tool and args provided. After each step, evaluate the result before proceeding to the next step.`
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(plan, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown command: ${command}` }) }],
          isError: true
        };
    }
  }
};

// ---------------------------------------------------------------------------
// Workflow Definitions
// ---------------------------------------------------------------------------

function getWorkflowDefinitions() {
  return {
    'bug-fix': {
      description: 'Diagnose and fix a bug — from error to verified fix',
      steps: [
        {
          tool: 'smart_error_diagnose',
          description: 'Diagnose the error',
          args: (ctx) => ({ error: ctx.error || '' }),
          hint: 'Analyze the error message and identify root cause'
        },
        {
          tool: 'smart_debug',
          description: 'Debug the issue',
          args: (ctx) => ({ error: ctx.error || '', context: ctx.context || '' }),
          hint: 'Trace the code path and confirm the root cause'
        },
        {
          tool: 'smart_fast_apply',
          description: 'Apply the fix',
          args: (ctx) => ({ fix: '<<<FIX_PLACEHOLDER>>>' }),
          hint: 'Apply the code change to fix the bug'
        },
        {
          tool: 'smart_test',
          description: 'Run tests to verify',
          args: () => ({}),
          hint: 'Run the test suite to confirm the fix works'
        },
        {
          tool: 'smart_memory_store',
          description: 'Store the solution',
          args: (ctx) => ({ command: 'store', error: ctx.error || '', resolution: '<<<RESOLUTION_PLACEHOLDER>>>' }),
          hint: 'Save the error and fix for future reference'
        }
      ]
    },

    'refactor': {
      description: 'Safely refactor code — analyze dependencies, assess impact, rename, apply, test',
      steps: [
        {
          tool: 'smart_import_graph',
          description: 'Analyze import dependencies',
          args: () => ({}),
          hint: 'Understand which files depend on the code being refactored'
        },
        {
          tool: 'smart_code_impact',
          description: 'Assess change impact',
          args: (ctx) => ({ files: ctx.files || [] }),
          hint: 'Evaluate the blast radius of the refactoring'
        },
        {
          tool: 'smart_rename_safety',
          description: 'Check rename safety',
          args: (ctx) => ({ name: ctx.symbol || '', newName: ctx.newName || '' }),
          hint: 'Verify the rename won\'t break anything'
        },
        {
          tool: 'smart_fast_apply',
          description: 'Apply the refactoring',
          args: () => ({ fix: '<<<REFACTOR_PLACEHOLDER>>>' }),
          hint: 'Apply all the refactoring changes'
        },
        {
          tool: 'smart_test',
          description: 'Run tests to verify',
          args: () => ({}),
          hint: 'Run the full test suite to ensure nothing broke'
        }
      ]
    },

    'security-fix': {
      description: 'Find and fix security vulnerabilities with multi-path analysis',
      steps: [
        {
          tool: 'smart_security',
          description: 'Scan for vulnerabilities',
          args: () => ({ scan: 'all' }),
          hint: 'Run a comprehensive security scan'
        },
        {
          tool: 'smart_think',
          description: 'Multi-path analysis of the fix',
          args: () => ({ mode: 'beam', thought: 'Analyze the security findings and evaluate fix approaches' }),
          hint: 'Use beam search to explore multiple fix strategies'
        },
        {
          tool: 'smart_fast_apply',
          description: 'Apply the security fix',
          args: () => ({ fix: '<<<SECURITY_FIX_PLACEHOLDER>>>' }),
          hint: 'Apply the security patch'
        },
        {
          tool: 'smart_test',
          description: 'Run tests',
          args: () => ({}),
          hint: 'Verify the fix doesn\'t break functionality'
        },
        {
          tool: 'smart_security',
          description: 'Re-scan to confirm fix',
          args: () => ({ scan: 'all' }),
          hint: 'Confirm the vulnerability is resolved'
        }
      ]
    },

    'pr-review': {
      description: 'Automated PR review — diff analysis, security, impact, quality',
      steps: [
        {
          tool: 'smart_git_diff',
          description: 'Get the PR diff',
          args: (ctx) => ({ base: ctx.base || 'main', head: ctx.head || 'HEAD' }),
          hint: 'Get the complete diff for the PR'
        },
        {
          tool: 'smart_security',
          description: 'Security scan changed files',
          args: () => ({ scan: 'all' }),
          hint: 'Check for security issues in the changes'
        },
        {
          tool: 'smart_code_impact',
          description: 'Assess change impact',
          args: (ctx) => ({ files: ctx.files || [] }),
          hint: 'Evaluate how the changes affect the codebase'
        },
        {
          tool: 'smart_lsp',
          description: 'Check for diagnostics',
          args: (ctx) => ({ operation: 'diagnostics', file: ctx.files?.[0] || '' }),
          hint: 'Check for type errors and warnings'
        }
      ]
    },

    'new-feature': {
      description: 'Plan and implement a new feature',
      steps: [
        {
          tool: 'smart_planner',
          description: 'Create implementation plan',
          args: (ctx) => ({ goal: ctx.goal || '' }),
          hint: 'Break down the feature into actionable steps'
        },
        {
          tool: 'smart_arch_overview',
          description: 'Review architecture',
          args: () => ({}),
          hint: 'Understand where the feature fits in the architecture'
        },
        {
          tool: 'smart_think',
          description: 'Design the implementation',
          args: (ctx) => ({ thought: `Design the implementation for: ${ctx.goal || 'new feature'}` }),
          hint: 'Think through the design before coding'
        },
        {
          tool: 'smart_fast_apply',
          description: 'Implement the feature',
          args: () => ({ fix: '<<<FEATURE_CODE_PLACEHOLDER>>>' }),
          hint: 'Write the implementation code'
        },
        {
          tool: 'smart_test',
          description: 'Run tests',
          args: () => ({}),
          hint: 'Verify the feature works correctly'
        }
      ]
    },

    'onboard': {
      description: 'Onboard to a new project — learn structure, conventions, dependencies, tests, security',
      steps: [
        {
          tool: 'smart_learn',
          description: 'Learn project structure',
          args: () => ({}),
          hint: 'Analyze the project: language, structure, conventions'
        },
        {
          tool: 'smart_rules',
          description: 'Check project rules',
          args: () => ({}),
          hint: 'Read AGENTS.md, .cursorrules, and other project conventions'
        },
        {
          tool: 'smart_arch_overview',
          description: 'Architecture overview',
          args: () => ({}),
          hint: 'Get a high-level view of the architecture'
        },
        {
          tool: 'smart_import_graph',
          description: 'Analyze dependencies',
          args: () => ({}),
          hint: 'Understand module dependencies'
        },
        {
          tool: 'smart_test',
          description: 'Run existing tests',
          args: () => ({}),
          hint: 'Verify the test suite works and understand test patterns'
        },
        {
          tool: 'smart_security',
          description: 'Security baseline',
          args: () => ({ scan: 'all' }),
          hint: 'Establish a security baseline'
        }
      ]
    },

    'doc-analysis': {
      description: 'Ingest and analyze a document',
      steps: [
        {
          tool: 'smart_ingest_document',
          description: 'Ingest the document',
          args: (ctx) => ({ path: ctx.path || '' }),
          hint: 'Convert the document to readable text'
        },
        {
          tool: 'smart_search_docs',
          description: 'Search related documents',
          args: (ctx) => ({ query: ctx.topic || '' }),
          hint: 'Find related documents for cross-reference'
        },
        {
          tool: 'smart_deep_think',
          description: 'Deep analysis',
          args: (ctx) => ({ topic: `Analyze document: ${ctx.path || 'unknown'}`, template: 'analyze' }),
          hint: 'Perform deep analysis of the document content'
        }
      ]
    }
  };
}