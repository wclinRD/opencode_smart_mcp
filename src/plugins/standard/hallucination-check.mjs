// hallucination-check.mjs → smart_hallucination_check
// Phase 6: LLM output hallucination detection tool.
// Rule-based judge that checks LLM output for 6 hallucination types
// using 5 structural checks. Does NOT call external LLM APIs.
//
// Usage:
//   smart_hallucination_check({ output: "...", context: "...", query: "..." })
//   smart_hallucination_check({ output: "...", strictness: 8 })

import { judgeHallucination, HALLUCINATION_TYPES } from '../../lib/hallucination-judge.mjs';

export default {
  name: 'smart_hallucination_check',
  category: 'standard',
  responsePolicy: { maxLevel: 0 }, // Check results must not be compressed
  description: `Check LLM output for hallucinations (fabrication, misattribution, unfaithful, self-contradiction, off-topic, confident-refusal).

Runs 5 structural checks:
  1. Factual — are mentioned identifiers present in context?
  2. Consistency — are there internal contradictions?
  3. Groundedness — can conclusions be traced to context?
  4. Off-topic — does output address the query?
  5. Confidence — overconfident language without evidence?

Returns: { overallScore: 1-10, verdict: "pass"|"warn"|"fail", issues[], summary }

Examples:
  { output: "The bug is in parser.js...", context: "Error at parser.js:42" }
  { output: "...", query: "Why does the parser crash?", strictness: 7 }`,

  inputSchema: {
    type: 'object',
    properties: {
      output: {
        type: 'string',
        description: 'LLM output text to check for hallucinations (required)',
      },
      context: {
        type: 'string',
        description: 'Original tool output or context to verify against',
      },
      query: {
        type: 'string',
        description: 'Original user question for off-topic detection',
      },
      toolName: {
        type: 'string',
        description: 'Tool that produced the output (for context)',
      },
      strictness: {
        type: 'number',
        description: 'Strictness 1-10, higher = more sensitive (default: 5)',
      },
    },
    required: ['output'],
  },

  handler: async (args) => {
    const { output, context, query, toolName, strictness } = args;

    if (!output || !output.trim()) {
      return 'Error: output is required. Provide the LLM output text to check.';
    }

    try {
      const result = judgeHallucination({
        output,
        context: context || '',
        query: query || '',
        toolName: toolName || '',
        strictness: strictness || 5,
      });

      // Build formatted output
      let text = '';

      // Verdict header
      const verdictIcons = { pass: '✅', warn: '⚠️', fail: '❌' };
      text += `## Hallucination Check: ${verdictIcons[result.verdict]} ${result.verdict.toUpperCase()} (${result.overallScore}/10)\n\n`;
      text += `${result.summary}\n\n`;

      // Detailed checks
      text += `### Checks\n\n`;
      text += `| # | Check | Score | Status | Detail |\n`;
      text += `|---|-------|-------|--------|--------|\n`;
      for (let i = 0; i < result.checks.length; i++) {
        const c = result.checks[i];
        const icon = c.passed ? '✅' : '❌';
        text += `| ${i + 1} | ${c.type} | ${c.score}/10 | ${icon} | ${c.detail} |\n`;
      }

      // Issues
      if (result.issues.length > 0) {
        text += `\n### Issues Found (${result.issues.length})\n\n`;
        for (const issue of result.issues) {
          text += `- **${issue.type}** [${issue.severity}]: ${issue.detail}\n`;
        }
      }

      // Hallucination type reference
      text += `\n### Hallucination Types Reference\n\n`;
      text += `| Type | Description | Severity |\n`;
      text += `|------|-------------|----------|\n`;
      for (const [key, info] of Object.entries(HALLUCINATION_TYPES)) {
        text += `| ${info.name} | ${info.description} | ${info.severity} |\n`;
      }

      return text;
    } catch (err) {
      return `Error running hallucination check: ${err.message}`;
    }
  },
};