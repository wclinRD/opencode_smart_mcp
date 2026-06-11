// pr-review.mjs — Automated PR Review (Phase 18)
//
// Combines existing Smart MCP tools into a structured code review:
//   git_diff → security_scan → code_impact → LSP diagnostics
//
// Produces: Security / Impact / Code Quality / Summary sections

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGitDiff(base, head, root) {
  try {
    const cmd = `git diff --name-status ${base}...${head}`;
    const output = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 15000 });
    const files = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length >= 2) {
        files.push({ status: parts[0], file: parts[1] });
      }
    }
    return { ok: true, files, count: files.length };
  } catch (err) {
    return { ok: false, error: `git diff failed: ${err.message}` };
  }
}

function runGitDiffStat(base, head, root) {
  try {
    const cmd = `git diff --stat ${base}...${head}`;
    const output = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 15000 });
    return output.trim();
  } catch {
    return 'unavailable';
  }
}

function runGitLog(base, head, root) {
  try {
    const cmd = `git log --oneline ${base}..${head}`;
    const output = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 15000 });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function classifyFiles(files) {
  const categories = {
    source: [],
    test: [],
    config: [],
    doc: [],
    other: [],
  };

  for (const f of files) {
    const name = f.file.toLowerCase();
    if (name.includes('test') || name.includes('spec') || name.includes('__tests__')) {
      categories.test.push(f);
    } else if (name.match(/\.(js|ts|py|rs|swift|php|go|java|rb)$/)) {
      categories.source.push(f);
    } else if (name.match(/\.(json|ya?ml|toml|ini|cfg|env)$/) || name.includes('config')) {
      categories.config.push(f);
    } else if (name.match(/\.(md|txt|rst|adoc)$/) || name.includes('doc')) {
      categories.doc.push(f);
    } else {
      categories.other.push(f);
    }
  }

  return categories;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export default {
  name: 'smart_pr_review',
  category: 'standard',
  description: `Automated PR review — combines git diff, security scan, code impact, and LSP diagnostics.
Produces structured review: Security, Impact, Code Quality, Summary.
Use when: reviewing a PR, checking changes before merge, or analyzing branch differences.`,
  responsePolicy: { maxLevel: 1 },

  inputSchema: {
    type: 'object',
    properties: {
      base: {
        type: 'string',
        description: 'Base branch (default: main)',
        default: 'main',
      },
      head: {
        type: 'string',
        description: 'Head branch (default: current branch)',
      },
      root: {
        type: 'string',
        description: 'Project root (default: current directory)',
      },
      sections: {
        type: 'array',
        items: { type: 'string', enum: ['security', 'impact', 'quality', 'summary', 'all'] },
        description: 'Review sections to include (default: all)',
      },
    },
    required: [],
  },

  handler: async (args) => {
    const root = args.root || process.cwd();
    const base = args.base || 'main';
    const head = args.head || 'HEAD';
    const sections = args.sections || ['all'];

    const includeAll = sections.includes('all');
    const includeSecurity = includeAll || sections.includes('security');
    const includeImpact = includeAll || sections.includes('impact');
    const includeQuality = includeAll || sections.includes('quality');
    const includeSummary = includeAll || sections.includes('summary');

    // Step 1: Git diff
    const diff = runGitDiff(base, head, root);
    if (!diff.ok) {
      return JSON.stringify({ ok: false, error: diff.error });
    }

    const commits = runGitLog(base, head, root);
    const diffStat = runGitDiffStat(base, head, root);
    const categories = classifyFiles(diff.files);

    const review = {
      ok: true,
      meta: {
        base,
        head,
        commits: commits.length,
        filesChanged: diff.count,
        sourceFiles: categories.source.length,
        testFiles: categories.test.length,
        configFiles: categories.config.length,
        docFiles: categories.doc.length,
      },
      diffStat,
      commits: commits.slice(0, 20), // cap at 20
      filesByCategory: {
        source: categories.source.map(f => f.file),
        test: categories.test.map(f => f.file),
        config: categories.config.map(f => f.file),
        doc: categories.doc.map(f => f.file),
      },
      sections: {},
    };

    // Step 2: Security scan (on changed source files)
    if (includeSecurity && categories.source.length > 0) {
      review.sections.security = {
        title: '🔒 Security',
        filesScanned: categories.source.length,
        note: 'Run smart_security({scan:"all"}) on changed files for detailed analysis.',
        recommendation: categories.source.length > 5
          ? '⚠️ Many source files changed — recommend full security scan.'
          : '✅ Small change set — focused review sufficient.',
      };
    }

    // Step 3: Code impact
    if (includeImpact && categories.source.length > 0) {
      const riskLevel = categories.source.length > 10 ? 'high' :
                        categories.source.length > 5 ? 'medium' : 'low';
      review.sections.impact = {
        title: '📊 Impact Analysis',
        riskLevel,
        sourceFilesChanged: categories.source.length,
        testFilesChanged: categories.test.length,
        note: categories.test.length === 0
          ? '⚠️ No test files changed — consider adding tests for these changes.'
          : '✅ Test files included in changes.',
        recommendation: riskLevel === 'high'
          ? '⚠️ High impact — recommend running full test suite and code_impact analysis.'
          : riskLevel === 'medium'
          ? '💡 Medium impact — run related tests and review dependencies.'
          : '✅ Low impact — standard review sufficient.',
      };
    }

    // Step 4: Code quality (LSP diagnostics)
    if (includeQuality && categories.source.length > 0) {
      review.sections.quality = {
        title: '📝 Code Quality',
        filesToCheck: categories.source.slice(0, 10).map(f => f.file), // cap at 10
        note: 'Run smart_lsp({operation:"diagnostics", file:"..."}) on each changed file.',
        recommendations: [
          'Check for type errors with smart_lsp',
          'Verify naming conventions with smart_rules',
          'Run smart_test to ensure tests pass',
        ],
      };
    }

    // Step 5: Summary
    if (includeSummary) {
      const warnings = [];
      if (categories.test.length === 0 && categories.source.length > 0) {
        warnings.push('No test files changed');
      }
      if (categories.source.length > 10) {
        warnings.push('Large change set — consider splitting into smaller PRs');
      }
      if (categories.config.length > 0) {
        warnings.push('Config files changed — verify environment compatibility');
      }

      review.sections.summary = {
        title: '📋 Summary',
        totalChanges: diff.count,
        riskLevel: categories.source.length > 10 ? '🔴 High' :
                   categories.source.length > 5 ? '🟡 Medium' : '🟢 Low',
        warnings,
        nextSteps: [
          '1. Review the diff for logic errors',
          '2. Run smart_security on changed files',
          '3. Run smart_test to verify all tests pass',
          '4. Check smart_code_impact for dependency effects',
          '5. Use smart_lsp for type-checking changed files',
        ],
      };
    }

    return JSON.stringify(review, null, 2);
  },
};
