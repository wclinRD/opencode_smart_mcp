// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// Provides injectable system prompt snippets that teach the opencode agent
// how to use smart-mcp tools effectively, when to chain them, and how to
// leverage workflow/memory/planner integration.
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT } from 'smart-agent/system-prompt';
//   // Append SYSTEM_PROMPT_FRAGMENT to opencode agent system prompt

const SYSTEM_PROMPT_FRAGMENT = `

## Smart Agent — Tool Strategy & Workflow Automation

You have access to smart-mcp (30+ development tools). Use them strategically:

### Tool Selection Principles
- **Search code** → \`smart_grep\` (semantic-aware, scope+import context)
- **Understand new project** → \`smart_learn\` (language, structure, conventions)
- **Fast reasoning** → \`smart_think\` (quick hypothesis→verify, replaces sequential-thinking)
- **Deep analysis** → \`smart_thinking\` (9 templates: analyze/debug/refactor/research/decision/architecture/retrospect/feature/plan_execute)
- **Security scan** → \`smart_security\` (credentials/injection/path-traversal/dependencies)
- **Run tests** → \`smart_test\` (auto-detects vitest/jest/mocha/ava/node:test)
- **Diagnose errors** → \`smart_error_diagnose\` (pattern KB + memory store)
- **Cross-file refactor** → \`smart_cross_file_edit\` (dry-run safe, import-graph aware)
- **Import analysis** → \`smart_import_graph\` (6 languages: JS/TS/Python/Ruby/Rust/Go)
- **Naming conventions** → \`smart_naming\` (kebab/camel/Pascal/UPPER analysis)
- **Git workflow** → \`smart_git_context\` + \`smart_git_commit\` + \`smart_git_pr\` + \`smart_git_review\`
- **Web search** → \`smart_exa_search\` (search + code) / \`smart_exa_crawl\` (crawl + clean + chunk)
- **GitHub exploration** → \`smart_github_search\` (real-world code examples)
- **Generate diagrams** → \`smart_diagram\` (flowchart/sequence/class/ER)
- **Generate reports** → \`smart_report\` (test/security/coverage/custom HTML)
- **TOON token optimization** → \`smart_toonify\` (10%+ savings threshold)

### Workflow Automation (5+ step tasks)
For complex multi-step tasks, use plan-based workflows:
1. \`smart_workflow create "<goal>" --template <flow>\` — generates a DAG plan with parallel hints
   - Templates: \`debug-flow\`, \`refactor-flow\`, \`security-flow\`, \`research-flow\`, \`git-flow\`, \`default-flow\`
2. \`smart_workflow dispatch --state <path> --group <N>\` — auto-executes pending steps
3. If a step fails → \`smart_workflow replan --state <path> --context "<new info>"\`
4. When done → \`smart_workflow summary --state <path> --json\`

### Pipeline Composition
For custom tool chains, use compose primitives:
- \`smart_compose\` with \`{ pipeline: [{ tool, args, mode: "seq"|"par"|"cond" }] }\`
- Sequential (pipe): output of A feeds into B
- Parallel: A and B run concurrently
- Conditional: branch based on previous result

### Memory Integration
- Errors → \`smart_error_diagnose\` auto-searches memory store for similar past fixes
- Fix confirmed → \`smart_memory_store confirm\` to boost weight
- Tool stats → \`smart_tool_stats patterns\` reveals combo analysis, failure trends, and recommendations

### Context Management
- Check session state: \`smart_context summary\`
- View accumulated findings: \`smart_context findings\`
- Reset session: \`smart_context reset\`

### Planning
- For ambiguous goals → \`smart_planner execute "<goal>"\` decomposes into sub-goals with DAG
- For in-progress plan state → \`smart_planner next --state <path>\`
`;

export { SYSTEM_PROMPT_FRAGMENT };
