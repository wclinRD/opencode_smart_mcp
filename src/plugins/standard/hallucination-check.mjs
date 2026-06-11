// hallucination-check.mjs → smart_hallucination_check
// Phase 6: LLM output hallucination detection tool.
// Rule-based judge that checks LLM output for 6 hallucination types
// using 5 structural checks. Does NOT call external LLM APIs.
//
// Phase 15.3: Added DOI verification mode (mode:"doi") — extracts and verifies
// all DOIs in the output via Crossref/doi.org liveness check.
// Integrated from Deep Research Agent (CYC2002tommy/deep-research-agent, MIT).
//
// Usage:
//   smart_hallucination_check({ output: "...", context: "...", query: "..." })
//   smart_hallucination_check({ output: "...", strictness: 8 })
//   smart_hallucination_check({ output: "...", mode: "doi" })

import https from 'node:https';
import { judgeHallucination, HALLUCINATION_TYPES } from '../../lib/hallucination-judge.mjs';

// ── DOI Extraction & Verification ────────────────────────────────────────────

const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/g;
const DOI_URL_REGEX = /https?:\/\/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/gi;

/**
 * Extract all unique DOIs from text.
 */
function extractDOIs(text) {
  const dois = new Set();

  // Match raw DOIs
  for (const match of text.matchAll(DOI_REGEX)) {
    // Clean trailing punctuation
    let doi = match[0].replace(/[.,;:!?)]+$/, '');
    dois.add(doi);
  }

  // Match doi.org URLs
  for (const match of text.matchAll(DOI_URL_REGEX)) {
    dois.add(match[1]);
  }

  return [...dois];
}

/**
 * Verify a single DOI by checking if doi.org resolves.
 * Uses HEAD request to doi.org (follows redirect to publisher).
 */
function verifyDOI(doi) {
  return new Promise((resolve) => {
    const url = `https://doi.org/${encodeURIComponent(doi)}`;
    const req = https.request(url, {
      method: 'HEAD',
      timeout: 10000,
      headers: {
        'User-Agent': 'SmartMCP-HallucinationCheck/1.0 (mailto:agent@smart-mcp.dev)',
      },
    }, (res) => {
      // doi.org returns 302/303 for valid DOIs, 404 for invalid
      if (res.statusCode === 404) {
        resolve({ doi, status: 'dead', statusCode: 404, detail: 'DOI not found — likely fabricated or incorrect' });
      } else if (res.statusCode >= 200 && res.statusCode < 400) {
        resolve({ doi, status: 'alive', statusCode: res.statusCode, detail: 'DOI resolves successfully' });
      } else if (res.statusCode === 403) {
        resolve({ doi, status: 'restricted', statusCode: 403, detail: 'DOI exists but access is restricted (e.g., MDPI paywall)' });
      } else if (res.statusCode >= 500) {
        resolve({ doi, status: 'server_error', statusCode: res.statusCode, detail: `Publisher server error (${res.statusCode}) — DOI may still be valid` });
      } else {
        resolve({ doi, status: 'unknown', statusCode: res.statusCode, detail: `Unexpected HTTP ${res.statusCode}` });
      }
    });

    req.on('error', (err) => {
      resolve({ doi, status: 'error', detail: `Network error: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ doi, status: 'timeout', detail: 'Request timed out — DOI may still be valid' });
    });

    req.end();
  });
}

/**
 * Run full DOI verification on output text.
 */
async function runDOICheck(output) {
  const dois = extractDOIs(output);

  if (dois.length === 0) {
    return {
      mode: 'doi',
      totalDOIs: 0,
      alive: 0,
      dead: 0,
      restricted: 0,
      error: 0,
      results: [],
      verdict: 'pass',
      summary: 'No DOIs found in the output.',
    };
  }

  // Verify all DOIs in parallel (max 5 concurrent to be polite)
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < dois.length; i += batchSize) {
    const batch = dois.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(verifyDOI));
    results.push(...batchResults);
  }

  const alive = results.filter((r) => r.status === 'alive').length;
  const dead = results.filter((r) => r.status === 'dead').length;
  const restricted = results.filter((r) => r.status === 'restricted').length;
  const errors = results.filter((r) => ['error', 'timeout', 'server_error', 'unknown'].includes(r.status)).length;

  let verdict = 'pass';
  let summary = '';

  if (dead > 0) {
    verdict = 'fail';
    summary = `❌ ${dead} dead DOI(s) found — likely fabricated or incorrect citations.`;
  } else if (restricted > 0 && alive === 0) {
    verdict = 'warn';
    summary = `⚠️ All ${restricted} DOI(s) are restricted (paywalled). Cannot fully verify.`;
  } else if (errors > 0) {
    verdict = 'warn';
    summary = `⚠️ ${errors} DOI(s) could not be verified due to network/server issues.`;
  } else {
    summary = `✅ All ${alive} DOI(s) verified successfully.`;
  }

  return {
    mode: 'doi',
    totalDOIs: dois.length,
    alive,
    dead,
    restricted,
    error: errors,
    results,
    verdict,
    summary,
  };
}

// ── Plugin Definition ────────────────────────────────────────────────────────

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

DOI Verification mode (mode:"doi"):
  Extracts all DOIs from the output and verifies each via doi.org liveness check.
  Dead DOIs (404) = likely fabricated. Restricted (403) = paywalled but may exist.

Returns: { overallScore: 1-10, verdict: "pass"|"warn"|"fail", issues[], summary }

Examples:
  { output: "The bug is in parser.js...", context: "Error at parser.js:42" }
  { output: "...", query: "Why does the parser crash?", strictness: 7 }
  { output: "Smith (2024, doi:10.1234/fake) found...", mode: "doi" }`,

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
      mode: {
        type: 'string',
        enum: ['default', 'doi'],
        description: 'Check mode: "default" (5 structural checks) or "doi" (DOI liveness verification). Default: "default".',
      },
    },
    required: ['output'],
  },

  handler: async (args) => {
    const { output, context, query, toolName, strictness, mode = 'default' } = args;

    if (!output || !output.trim()) {
      return 'Error: output is required. Provide the LLM output text to check.';
    }

    // ── DOI Verification Mode ──────────────────────────────────────────────
    if (mode === 'doi') {
      try {
        const result = await runDOICheck(output);

        let text = '';
        const verdictIcons = { pass: '✅', warn: '⚠️', fail: '❌' };
        text += `## DOI Verification: ${verdictIcons[result.verdict]} ${result.verdict.toUpperCase()}\n\n`;
        text += `${result.summary}\n\n`;

        text += `| Status | Count |\n|--------|-------|\n`;
        text += `| Total DOIs found | ${result.totalDOIs} |\n`;
        text += `| ✅ Alive | ${result.alive} |\n`;
        text += `| ❌ Dead (404) | ${result.dead} |\n`;
        text += `| 🔒 Restricted (403) | ${result.restricted} |\n`;
        text += `| ⚠️ Error/Timeout | ${result.error} |\n`;

        if (result.results.length > 0) {
          text += `\n### DOI Details\n\n`;
          text += `| DOI | Status | Detail |\n`;
          text += `|-----|--------|--------|\n`;
          for (const r of result.results) {
            const icon = r.status === 'alive' ? '✅' : r.status === 'dead' ? '❌' : r.status === 'restricted' ? '🔒' : '⚠️';
            text += `| [${r.doi}](https://doi.org/${r.doi}) | ${icon} ${r.status} | ${r.detail} |\n`;
          }
        }

        // If dead DOIs found, add guidance
        if (result.dead > 0) {
          text += `\n### ⚠️ Action Required\n\n`;
          text += `Dead DOIs indicate **fabricated or incorrect citations**. The LLM may have hallucinated these references.\n`;
          text += `- Delete citations with dead DOIs and rewrite affected claims\n`;
          text += `- Use \`smart_academic_search({ source: "crossref", query: "..." })\` to find real papers\n`;
        }

        return text;
      } catch (err) {
        return `Error running DOI verification: ${err.message}`;
      }
    }

    // ── Default: Structural Hallucination Check ────────────────────────────
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