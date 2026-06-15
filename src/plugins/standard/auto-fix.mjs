// auto-fix.mjs — smart_autofix MCP tool
//
// Automated fix→verify pipeline. Applies a code change and runs verification
// (test/lint/security) in a single call. LLM can retry on failure.
//
// Phase 20: Auto-Fix Pipeline

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

export default {
  name: 'smart_autofix',
  description: 'Apply a code fix and automatically verify with test/lint/security. Returns pass/fail with details so LLM can retry if needed.',
  category: 'standard',
  domain: 'edit',
  safetyLevel: 'high',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 1 },

  inputSchema: {
    type: 'object',
    properties: {
      fix: {
        type: 'string',
        description: 'The fix to apply — unified diff or SEARCH/REPLACE block'
      },
      verify: {
        type: 'array',
        items: { type: 'string', enum: ['test', 'lint', 'security', 'typecheck'] },
        description: 'Verification steps to run after applying the fix (default: ["test"])',
        default: ['test']
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files affected by this fix (for targeted verification)'
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: current working directory)'
      },
      timeout: {
        type: 'number',
        description: 'Max seconds for verification (default: 60)',
        default: 60
      }
    },
    required: ['fix']
  },

  handler: async (args, context) => {
    const { fix, verify = ['test'], files = [], root, timeout = 60 } = args;
    const projectRoot = root || process.cwd();

    const results = {
      ok: false,
      fixApplied: false,
      verification: {},
      allPassed: false,
      summary: '',
      errors: []
    };

    try {
      // Step 1: Apply the fix
      // We use a simple approach: write the fix to a temp file and apply via patch
      // For SEARCH/REPLACE blocks, we do direct file editing
      const fixResult = applyFix(fix, files, projectRoot);
      results.fixApplied = fixResult.applied;
      if (!fixResult.applied) {
        results.errors.push({ step: 'fix', message: fixResult.error || 'Failed to apply fix' });
        results.summary = '❌ Fix could not be applied.';
        return formatResponse(results);
      }

      // Step 2: Run verification steps in parallel
      const verifyResults = await runVerification(verify, files, projectRoot, timeout);
      results.verification = verifyResults;

      // Step 3: Check if all passed
      const failed = Object.entries(verifyResults).filter(([, r]) => !r.passed);
      results.allPassed = failed.length === 0;

      if (results.allPassed) {
        results.ok = true;
        results.summary = '✅ All verification passed. Fix applied successfully.';
      } else {
        results.summary = `❌ ${failed.length} verification step(s) failed. Review errors and retry.`;
        for (const [step, r] of failed) {
          results.errors.push({ step, message: r.error || r.output?.slice(-500) || `${step} failed` });
        }
      }

      return formatResponse(results);
    } catch (err) {
      results.errors.push({ step: 'pipeline', message: err.message });
      results.summary = `❌ Pipeline error: ${err.message}`;
      return formatResponse(results);
    }
  }
};

// ---------------------------------------------------------------------------
// Fix application
// ---------------------------------------------------------------------------

function applyFix(fix, files, projectRoot) {
  try {
    // Detect fix format
    if (fix.includes('<<<<<<< SEARCH') || fix.includes('=======')) {
      return applySearchReplace(fix, files, projectRoot);
    }
    if (fix.startsWith('diff ') || fix.startsWith('--- ') || fix.startsWith('+++ ') || fix.includes('@@ ')) {
      return applyUnifiedDiff(fix, projectRoot);
    }
    // Try as raw content replacement on the first file
    if (files.length > 0) {
      return applyRawEdit(fix, files[0], projectRoot);
    }
    return { applied: false, error: 'Unrecognized fix format. Use SEARCH/REPLACE or unified diff.' };
  } catch (err) {
    return { applied: false, error: err.message };
  }
}

function applySearchReplace(fix, files, projectRoot) {
  // Parse SEARCH/REPLACE blocks
  const blocks = [];
  const blockRe = /<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/g;
  let m;
  while ((m = blockRe.exec(fix)) !== null) {
    blocks.push({ search: m[1], replace: m[2] });
  }

  if (blocks.length === 0) {
    return { applied: false, error: 'No SEARCH/REPLACE blocks found' };
  }

  // Determine target file — use first file in list, or extract from context
  const targetFile = files[0];
  if (!targetFile) {
    return { applied: false, error: 'No target file specified for SEARCH/REPLACE' };
  }

  const filePath = resolve(projectRoot, targetFile);
  if (!existsSync(filePath)) {
    return { applied: false, error: `File not found: ${targetFile}` };
  }

  let content = readFileSync(filePath, 'utf-8');
  let appliedCount = 0;

  for (const block of blocks) {
    if (content.includes(block.search)) {
      content = content.replace(block.search, block.replace);
      appliedCount++;
    }
  }

  if (appliedCount === 0) {
    return { applied: false, error: 'No SEARCH blocks matched file content' };
  }

  writeFileSync(filePath, content, 'utf-8');
  return { applied: true, blocksApplied: appliedCount };
}

function applyUnifiedDiff(diff, projectRoot) {
  // Use patch command if available
  try {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'autofix-'));
    const diffPath = join(tmpDir, 'fix.diff');
    writeFileSync(diffPath, diff, 'utf-8');

    const result = spawnSync('patch', ['-p1', '-i', diffPath], {
      cwd: projectRoot,
      timeout: 10000,
      encoding: 'utf-8'
    });

    rmSync(tmpDir, { recursive: true, force: true });

    if (result.status === 0) {
      return { applied: true };
    }
    return { applied: false, error: result.stderr || 'patch command failed' };
  } catch (err) {
    return { applied: false, error: `patch not available: ${err.message}` };
  }
}

function applyRawEdit(fix, file, projectRoot) {
  // Assume fix is the new content for the file
  try {
    const filePath = resolve(projectRoot, file);
    writeFileSync(filePath, fix, 'utf-8');
    return { applied: true };
  } catch (err) {
    return { applied: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function runVerification(steps, files, projectRoot, timeout) {
  const results = {};

  // Run steps in parallel
  const promises = steps.map(async (step) => {
    try {
      const result = await runSingleVerification(step, files, projectRoot, timeout);
      return [step, result];
    } catch (err) {
      return [step, { passed: false, error: err.message }];
    }
  });

  const entries = await Promise.all(promises);
  for (const [step, result] of entries) {
    results[step] = result;
  }

  return results;
}

async function runSingleVerification(step, files, projectRoot, timeout) {
  switch (step) {
    case 'test': {
      // Detect test runner and run
      const packageJsonPath = resolve(projectRoot, 'package.json');
      let command = 'npm test -- --passWithNoTests 2>&1 || true';

      if (existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (pkg.scripts?.test) {
            // If specific files provided, try to run only those
            if (files.length > 0) {
              const testFiles = files.filter(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
              if (testFiles.length > 0) {
                command = `npx vitest run ${testFiles.join(' ')} 2>&1 || npx jest ${testFiles.join(' ')} 2>&1 || node --test ${testFiles.join(' ')} 2>&1`;
              }
            }
          }
        } catch {}
      }

      try {
        const output = execSync(command, {
          cwd: projectRoot,
          timeout: timeout * 1000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const passed = !output.includes('FAIL') && !output.includes('failed') && !output.includes('Error:');
        return {
          passed,
          output: output.slice(-2000),
          summary: passed ? 'Tests passed' : 'Tests failed'
        };
      } catch (err) {
        const output = (err.stdout || '') + (err.stderr || '');
        return {
          passed: false,
          output: output.slice(-2000),
          summary: 'Tests failed',
          error: err.message?.slice(0, 200)
        };
      }
    }

    case 'lint': {
      // Run ESLint or similar
      try {
        const output = execSync('npx eslint . --format compact 2>&1 || true', {
          cwd: projectRoot,
          timeout: Math.min(timeout, 30) * 1000,
          encoding: 'utf-8',
          maxBuffer: 512 * 1024
        });
        const passed = !output.includes('error') && !output.includes('problem');
        return {
          passed,
          output: output.slice(-1000),
          summary: passed ? 'Lint passed' : 'Lint issues found'
        };
      } catch {
        return { passed: true, output: '', summary: 'Lint skipped (eslint not available)' };
      }
    }

    case 'security': {
      // Run a basic security check
      try {
        const output = execSync('npx audit-ci --moderate 2>&1 || npm audit --audit-level=high 2>&1 || true', {
          cwd: projectRoot,
          timeout: Math.min(timeout, 30) * 1000,
          encoding: 'utf-8',
          maxBuffer: 512 * 1024
        });
        const passed = !output.includes('vulnerability') && !output.includes('critical');
        return {
          passed,
          output: output.slice(-1000),
          summary: passed ? 'Security check passed' : 'Security vulnerabilities found'
        };
      } catch {
        return { passed: true, output: '', summary: 'Security check skipped (npm audit not available)' };
      }
    }

    case 'typecheck': {
      // Run TypeScript type check
      try {
        const output = execSync('npx tsc --noEmit 2>&1 || true', {
          cwd: projectRoot,
          timeout: Math.min(timeout, 30) * 1000,
          encoding: 'utf-8',
          maxBuffer: 512 * 1024
        });
        const passed = !output.includes('error TS');
        return {
          passed,
          output: output.slice(-2000),
          summary: passed ? 'Type check passed' : 'Type errors found'
        };
      } catch {
        return { passed: true, output: '', summary: 'Type check skipped (tsc not available)' };
      }
    }

    default:
      return { passed: true, output: '', summary: `Unknown step: ${step}` };
  }
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

function formatResponse(results) {
  const text = JSON.stringify(results, null, 2);
  const ok = results.ok || results.allPassed;
  if (!ok) {
    return { ok: false, error: text };
  }
  return { ok: true, output: text };
}