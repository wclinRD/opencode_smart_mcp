// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// Provides injectable system prompt snippets that teach the opencode agent
// how to use smart-mcp tools effectively, when to chain them, and how to
// leverage workflow/memory/planner integration.
//
// IMPORTANT: opencode prefixes ALL tools from MCP server "smart" with `smart_`.
// So internal `smart_grep` → actual call name `smart_smart_grep`.
// This fragment uses actual exposed names.
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT } from 'smart-agent/system-prompt';
//   // Append SYSTEM_PROMPT_FRAGMENT to opencode agent system prompt

const SYSTEM_PROMPT_FRAGMENT = `

## Smart MCP — Tool Routing (40+ tools)

opencode prefixes MCP server "smart" tools with \`smart_\`. So internal \`smart_grep\` → call as \`smart_smart_grep\`.

### Layer 1: Native Tools (direct call, no router)
- \`smart_smart_grep\` — regex code search (scope + import context)
- \`smart_smart_learn\` — project onboarding (lang, structure, conventions)
- \`smart_smart_think\` — fast reasoning (default mode:"cit" — BN-DP, only branches when uncertain). mode:"beam" for high-risk. mode:"forest" for multi-angle consensus.
- \`smart_smart_deep_think\` — deep analysis (9 templates: analyze/debug/refactor/research/decision/architecture/retrospect/feature/plan_execute)
- \`smart_smart_security\` — security scan (credentials/injection/deps)
- \`smart_smart_test\` — run tests (auto-detects vitest/jest/mocha/ava/node:test)
- \`smart_smart_context\` — session context (summary/findings/reset/budget)
- \`smart_smart_rules\` — project rules discovery (AGENTS.md, .cursorrules, etc.)

### Layer 2: Router Tools (via \`smart_smart_run\`)
Use: \`smart_smart_run({tool:"<name>", args:{...}})\`

**Code**: hybrid_router, arch_overview, import_graph, code_call_graph, code_query(CKG), code_impact, code_ast, code_type_infer, coverage, naming  
**Edit**: fast_apply🥇, edit🥈, patch_gen, cross_file_edit, rename_safety  
**Debug**: error_diagnose, debug, test_suggest  
**Git**: git_context, git_commit, git_review, git_pr  
**Plan**: planner, workflow, compose, memory_store, agent_recommend, agent_plan, agent_execute  
**Doc**: ingest_document(auto-OCR), list_documents, search_docs  
**Browser**: pw_browser(navigate/click/fill/screenshot)  
**Web**: research(quick/deep/exhaustive)  
**Meta**: model_router(T1-T4 routing), impact_flow, integrate  

### Decision Flow
\`\`\`
Task →
  ├─ Native tool fits? → smart_smart_<tool>({...})
  ├─ Router tool fits? → smart_smart_run({tool:"<name>", args:{...}})
  ├─ Unsure?           → smart_smart_run({tool:"hybrid_router", args:{question:"..."}})
  ├─ Need domain skill?→ skill("<skill-name>")
  └─ No smart tool?    → Use built-in
\`\`\`

### Workflow (5+ step tasks)
\`smart_smart_run({tool:"workflow", args:{command:"create", goal:"...", template:"<debug-flow|refactor-flow|security-flow|research-flow|git-flow|default-flow>"}})\`
→ \`dispatch\` → \`replan\` (on fail) → \`summary\`

### Memory
- Search: \`smart_smart_run({tool:"memory_store", args:{command:"search", query:"..."}})\`
- Store: \`smart_smart_run({tool:"memory_store", args:{command:"store", query:"...", resolution:"..."}})\`
- Skill patches auto-extract from findings every 5 calls + on session end
`;

export { SYSTEM_PROMPT_FRAGMENT };
