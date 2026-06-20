// tests/security-scan.test.mjs — Phase 25: Security Scanner tests
//
// Tests: scan modes, output formats, false positive filtering, config file

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const CLI = resolve('src/cli/security-scan.mjs');
const ROOT = resolve('.');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(args) {
  try {
    const out = execSync(`node "${CLI}" ${args}`, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout: out, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function countIssues(stdout) {
  const match = stdout.match(/Total: (\d+) issue/i);
  return match ? parseInt(match[1], 10) : 0;
}

function createTempDir() {
  const dir = resolve(tmpdir(), `scan-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Security Scanner — CLI modes', () => {
  it('should scan credentials only', () => {
    const r = run('--scan credentials --format text');
    assert.ok(r.ok, r.stderr);
    assert.ok(r.stdout.includes('Credential Leaks'));
  });

  it('should scan injections only', () => {
    const r = run('--scan injections --format text');
    assert.ok(r.ok, r.stderr);
    assert.ok(r.stdout.includes('Injection Vulnerabilities'));
  });

  it('should scan all by default', () => {
    const r = run('');
    assert.ok(r.ok, r.stderr);
    assert.ok(r.stdout.includes('Security Scan Results'));
    assert.ok(countIssues(r.stdout) > 0);
  });

  it('should return no issues for empty codebase', () => {
    const tmpDir = createTempDir();
    const r = run(`--root "${tmpDir}" --format text`);
    assert.ok(r.ok, r.stderr);
    // No matching files found = no issues
    const hasMsg = r.stdout.includes('No security issues detected') || r.stdout.includes('No matching files found');
    assert.ok(hasMsg, `Expected no issues message in: ${r.stdout.slice(0, 200)}`);
  });
});

describe('Security Scanner — output formats', () => {
  it('should output JSON', () => {
    const r = run('--scan credentials --format json');
    assert.ok(r.ok, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.credentials));
  });

  it('should output Markdown', () => {
    const r = run('--scan credentials --format markdown');
    assert.ok(r.ok, r.stderr);
    assert.ok(r.stdout.includes('# Security Scan Results'));
  });

  it('should output SARIF', () => {
    const r = run('--scan credentials --format sarif');
    assert.ok(r.ok, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.version, '2.1.0');
    assert.ok(parsed.runs[0].results);
  });
});

describe('Security Scanner — false positive filtering', () => {
  it('should ignore findings by label substring', () => {
    const r = run('--scan injections --ignore "Child process usage" --format text');
    assert.ok(r.ok, r.stderr);
    assert.ok(!r.stdout.includes('Child process usage'));
  });

  it('should ignore findings by file:label', () => {
    // Compare unfiltered json vs filtered json
    const rRaw = run('--scan injections --format json');
    assert.ok(rRaw.ok, rRaw.stderr);
    const unfiltered = JSON.parse(rRaw.stdout);
    const unfilteredCount = unfiltered.injections.filter(e =>
      e.file.includes('tests/') && e.findings.some(f => f.label.includes('SQL Injection'))
    ).length;

    const r = run('--scan injections --ignore "tests/*:SQL Injection" --format json');
    assert.ok(r.ok, r.stderr);
    const filtered = JSON.parse(r.stdout);
    const filteredCount = filtered.injections.filter(e =>
      e.file.includes('tests/') && e.findings.some(f => f.label.includes('SQL Injection'))
    ).length;
    assert.ok(unfilteredCount > 0, 'should have SQL Injection findings in tests');
    assert.equal(filteredCount, 0, 'should filter out SQL Injection from tests');
  });

  it('should override severity', () => {
    const r = run('--scan all --severity-override "ReDoS risk (user input in regex):info" --format text');
    assert.ok(r.ok, r.stderr);
    assert.ok(r.stdout.includes('[info] ReDoS'));
  });

  it('should load config file', () => {
    const tmpDir = createTempDir();
    const configPath = join(tmpDir, '.security-scan.json');
    writeFileSync(configPath, JSON.stringify({ ignore: ['Child process usage'] }));
    // Create a small JS file that would trigger Child process usage
    writeFileSync(join(tmpDir, 'test.js'), 'import { execSync } from "node:child_process";\nexecSync("ls");\n');
    const r = run(`--root "${tmpDir}" --scan injections --format text`);
    assert.ok(r.ok, r.stderr);
    assert.ok(!r.stdout.includes('Child process usage'), 'config file should suppress Child process usage');
  });

  it('should use file:label filter', () => {
    const r = run('--scan injections --ignore "src/lib/document-ingester.mjs:Command Injection" --format json');
    assert.ok(r.ok, r.stderr);
    const parsed = JSON.parse(r.stdout);
    const docIngesterFindings = parsed.injections.filter(e =>
      e.file.includes('document-ingester.mjs')
    );
    // All Command Injection findings in document-ingester should be filtered
    const hasCmdInject = docIngesterFindings.some(e =>
      e.findings.some(f => f.label.includes('Command Injection'))
    );
    assert.ok(!hasCmdInject, 'should filter Command Injection in document-ingester.mjs');
  });
});

describe('Security Scanner — severity override', () => {
  it('should downgrade critical/high to low', () => {
    const r = run('--scan injections --severity-override "SQL Injection (dynamic SQL):low" --format json');
    assert.ok(r.ok, r.stderr);
    const parsed = JSON.parse(r.stdout);
    let hasHighSql = false;
    for (const entry of parsed.injections) {
      for (const f of entry.findings) {
        if (f.label.includes('SQL Injection (dynamic SQL)')) {
          if (f.severity === 'low') hasHighSql = true;
        }
      }
    }
    assert.ok(hasHighSql, 'should have SQL Injection severity downgraded to low');
  });
});

describe('Security Scanner — edge cases', () => {
  it('should handle empty ignore list', () => {
    const r = run('--scan all --format text');
    assert.ok(r.ok, r.stderr);
  });

  it('should handle invalid config file gracefully', () => {
    const tmpDir = createTempDir();
    writeFileSync(join(tmpDir, '.security-scan.json'), 'not json');
    const r = run(`--root "${tmpDir}" --format text`);
    assert.ok(r.ok, r.stderr); // should not crash
  });

  it('should handle --fail-on flag', () => {
    // injection scanning has high severity findings → should fail
    try {
      execSync(`node "${CLI}" --scan injections --fail-on high`, { cwd: ROOT, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
      assert.fail('Should have exited with error');
    } catch (e) {
      assert.ok(e.status > 0, `should exit with non-zero code, got ${e.status}`);
      assert.ok(e.stdout.includes('FAIL'), 'output should contain FAIL');
    }
  });
});
