#!/usr/bin/env node

// security-scan.mjs — Security vulnerability scanner
//
// Scans the codebase for common security issues:
// - Credential/secret patterns (API keys, tokens, passwords)
// - Injection vulnerabilities (SQL, XSS, command injection)
// - Dependency security issues
//
// Usage:
//   node security-scan.mjs [options]
//
// Options:
//   --root <path>         Root directory to scan (default: .)
//   --include <glob>      Include file pattern (repeatable)
//   --exclude <glob>      Exclude file pattern (repeatable)
//   --scan <type>         Scan type: all, credentials, injections, dependencies (default: all)
//   --format <fmt>        Output: text, json, markdown, sarif (default: text)
//   --fail-on <level>     Exit with error if issues at this level: low, medium, high (default: none)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, relative, extname } from 'node:path';
import { COLORS, useColor, globToRegex, matchGlob, findFiles } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Security patterns
// ---------------------------------------------------------------------------
const CREDENTIAL_PATTERNS = [
  { re: /(?:['"`]?(?:api[_-]?key|apikey|api_key)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'API Key' },
  { re: /(?:['"`]?(?:secret|token|password|passwd)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Secret/Token/Password' },
  { re: /(?:['"`]?(?:access[_-]?key|access_key|secret[_-]?key|secret_key)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Access/Secret Key' },
  { re: /(?:['"`]?(?:aws[_-]?(?:access|secret))['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'AWS Credential' },
  // Google Cloud
  { re: /(?:['"`]?(?:gcp[_-]?service[_-]?account|google[_-]?credential|gcloud[_-]?key)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'GCP Service Account' },
  { re: /(?:AIza[0-9A-Za-z_-]{35})/g, severity: 'high', label: 'GCP API Key' },
  // Azure
  { re: /(?:['"`]?(?:azure[_-]?(?:key|secret|conn[_-]?string|connection[_-]?string))['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Azure Key/Secret' },
  { re: /(?:AccountKey=[a-zA-Z0-9+\\/]{86})/g, severity: 'high', label: 'Azure Storage Key' },
  // Stripe
  { re: /(?:sk_live_[0-9a-zA-Z]{24,})/g, severity: 'high', label: 'Stripe Live Secret Key' },
  { re: /(?:pk_live_[0-9a-zA-Z]{24,})/g, severity: 'medium', label: 'Stripe Live Publishable Key' },
  // Other services
  { re: /(?:['"`]?(?:slack[_-]?token|discord[_-]?token|github[_-]?token|gitlab[_-]?token)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Service Token' },
  { re: /(?:['"`]?(?:npm[_-]?token|npm_token|registry[_-]?auth)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'NPM Token' },
  { re: /(?:['"`]?(?:heroku[_-]?(?:api[_-]?key|token))['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Heroku API Key' },
  { re: /(?:['"`]?(?:docker[_-]?(?:hub[_-]?token|password|config))['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Docker Credential' },
  { re: /(?:['"`]?(?:jwt|auth[_-]?token|bearer)['"`]?\s*[:=]\s*['"`][^'"`\s]{20,})/gi, severity: 'medium', label: 'JWT/Auth Token' },
  { re: /(?:BEGIN\s+(?:RSA|DSA|EC|OPENSSH|SSH2\s+ENCRYPTED)\s+PRIVATE\s+KEY)/gi, severity: 'high', label: 'Private Key' },
  { re: /(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36})/g, severity: 'high', label: 'GitHub Token' },
  { re: /(?:sk-[a-zA-Z0-9]{20,})/g, severity: 'high', label: 'OpenAI API Key' },
  { re: /(?:xox[abp]-[a-zA-Z0-9]{10,}-[a-zA-Z0-9]{10,}-[a-zA-Z0-9]{10,}-[a-f0-9]{12})/g, severity: 'high', label: 'Slack Token' },
  { re: /(?:mongodb\+srv:\/\/[^\s'"`,)]+)/g, severity: 'high', label: 'MongoDB Connection String' },
  { re: /(?:postgresql?:\/\/[^\s:]+:[^\s@]+@[^\s'"`,)]+)/g, severity: 'high', label: 'PostgreSQL Connection String' },
  { re: /(?:redis:\/\/[^\s:]+:[^\s@]+@[^\s'"`,)]+)/g, severity: 'high', label: 'Redis Connection String' },
  { re: /(?:mysql:\/\/[^\s:]+:[^\s@]+@[^\s'"`,)]+)/g, severity: 'high', label: 'MySQL Connection String' },
  { re: /(?:-----BEGIN\s+CERTIFICATE-----)/g, severity: 'medium', label: 'Certificate' },
  { re: /(?:password\s*=\s*['"`][^'"`\s]{3,})/gi, severity: 'high', label: 'Password Assignment' },
  { re: /(?:-----BEGIN\s+PGP\s+(PUBLIC|PRIVATE)\s+KEY\s+BLOCK-----)/gi, severity: 'medium', label: 'PGP Key' },
  { re: /(?:\b(?:export|set)\s+[A-Z_]+=(?:(?:['"])[^'"]{8,}['"])?)/g, severity: 'low', label: 'Env Variable (may contain secret)' },
];

const INJECTION_PATTERNS = [
  // SQL injection
  { re: /(?:execute|query|run)\s*\(\s*[`'“]\s*SELECT/gi, severity: "high", label: "SQL Injection (direct query)" },
  { re: /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*\$\{[^}]+\}/gis, severity: "high", label: "SQL Injection (template literal in SQL)" },
  { re: /(?:\+\s*[\x60\x27\u201C]\s*\+\s*(?:req\.|body\.|params\.|query\.))/gi, severity: "high", label: "SQL Injection (string concat)" },
  { re: /(?:exec|sp_executesql)\s*\(\s*[\x60\x27\u201C]/gi, severity: "high", label: "SQL Injection (dynamic SQL)" },
  // NoSQL injection
  { re: /$where\s*:/gi, severity: "high", label: "NoSQL Injection ($where)" },
  { re: /$regex\s*:\s*[\x60\x27\u201C][^\x60\x27\u201C]+[\x60\x27\u201C]\s*,/gi, severity: "high", label: "NoSQL Injection ($regex)" },
  { re: /$ne\s*:/gi, severity: "medium", label: "NoSQL Injection ($ne)" },
  // SSTI (Server-Side Template Injection)
  { re: /render\s*\(\s*[\x60\x27\u201C][^\x60\x27\u201C]*\$\{/gi, severity: "high", label: "SSTI (template injection in render)" },
  { re: /(?:res\.render|res\.renderFile)\s*\([^)]*\+/gi, severity: "high", label: "SSTI (concatenation in render)" },
  { re: /(?:eval\s*\(|new\s+Function\s*\()/g, severity: "high", label: "Code Injection (eval/new Function)" },
  // XSS
  { re: /(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=/g, severity: "high", label: "XSS (direct HTML injection)" },
  { re: /(?:dangerouslySetInnerHTML|v-html|bypassSecurityTrust)/g, severity: "high", label: "XSS (bypassing sanitization)" },
  { re: /document\.write\s*\(/g, severity: "high", label: "XSS (document.write)" },
  { re: /setTimeout\s*\(\s*[\x60\x27\u201C]/g, severity: "medium", label: "Code Injection (string setTimeout)" },
  { re: /setInterval\s*\(\s*[\x60\x27\u201C]/g, severity: "medium", label: "Code Injection (string setInterval)" },
  // Command injection
  { re: /(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(\s*(?:[\x60\x27\u201C].*?\+|.+?\$)/g, severity: "high", label: "Command Injection" },
  { re: /child_process/g, severity: "low", label: "Child process usage (review for injection)" },
  { re: /(?:shell:\s*true)/gi, severity: "medium", label: "Shell execution risk" },
  // SSRF (Server-Side Request Forgery)
  { re: /(?:fetch|axios\.get|axios\.post|request|got)\s*\(\s*(?:req\.|body\.|params\.|query\.)/gi, severity: "high", label: "SSRF (user-controlled URL fetch)" },
  { re: /(?:http\.get|http\.request|https\.get|https\.request)\s*\([^)]*(?:req\.|body\.|params\.)/gi, severity: "high", label: "SSRF (user-controlled HTTP request)" },
  // XXE (XML External Entity)
  { re: /(?:libxml|libxmljs|sax|saxjs)\s*\./gi, severity: "medium", label: "XXE risk (XML parser)" },
  { re: /(?:parseString|parseXml|parseXML)\s*\(/gi, severity: "medium", label: "XXE risk (XML parsing)" },
  // Path traversal
  { re: /(?:readFileSync|readFile|writeFileSync|writeFile|createReadStream)\s*\(\s*(?:[\x60\x27\u201C]|req\.|params\.)/g, severity: "medium", label: "Path traversal risk (file operations)" },
  // Prototype pollution
  { re: /(?:Object\.assign|\.\.\.)\s*\(?\s*(?:req\.|body\.)/gi, severity: "medium", label: "Prototype pollution risk" },
  // ReDoS
  { re: /new\s+RegExp\s*\(\s*(?:[\x60\x27\u201C]|req\.|params\.)/g, severity: "low", label: "ReDoS risk (user input in regex)" },
  // Insecure deserialization
  { re: /JSON\.parse\s*\(\s*(?:req\.|body\.)/g, severity: "low", label: "JSON parsing of user input" },
];

// DEPENDENCY_ISSUES — static pattern checks (low severity hints)
const DEPENDENCY_ISSUES = [
  { re: /"lodash"\s*:\s*"/g, severity: "low", label: "Consider using lodash-es for tree-shaking" },
  { re: /"moment"\s*:\s*"/g, severity: "low", label: "Consider using date-fns or dayjs (moment is heavy)" },
  { re: /"gulp"/g, severity: "low", label: "Gulp is outdated; consider other build tools" },
  { re: /"bower"/g, severity: "low", label: "Bower is deprecated; use npm/yarn/pnpm" },
  { re: /"request"/g, severity: "low", label: "Request is deprecated; use node-fetch or axios" },
];

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// False positive filtering — whitelist + severity override
// ---------------------------------------------------------------------------

// Format: "label-glob" (global) or "file-glob:label-glob" (per-file)
function parsePatternFilter(patterns) {
  return patterns.map(p => {
    const colon = p.indexOf(":");
    if (colon > 0 && !p.includes("://")) { // avoid matching URLs
      return { filePattern: p.slice(0, colon), labelPattern: p.slice(colon + 1) };
    }
    return { filePattern: null, labelPattern: p };
  });
}

function matchesFilter(item, filter) {
  if (filter.filePattern) {
    const fp = filter.filePattern.replace(/\*/g, ".*");
    try { if (!new RegExp(fp, "i").test(item.file)) return false; }
    catch { if (!item.file.includes(filter.filePattern)) return false; }
  }
  if (filter.labelPattern) {
    // If pattern contains glob chars (*), treat as regex
    if (filter.labelPattern.includes("*")) {
      const lp = filter.labelPattern.replace(/\*/g, ".*");
      try { if (!new RegExp("^" + lp + "$", "i").test(item.finding.label)) return false; }
      catch { if (!item.finding.label.includes(filter.labelPattern)) return false; }
    } else {
      // Plain text: substring match (more intuitive for labels)
      if (!item.finding.label.toLowerCase().includes(filter.labelPattern.toLowerCase())) return false;
    }
  }
  return true;
}

function applyFilters(results, opts) {
  const ignorePats = parsePatternFilter(opts.ignore || []);
  const overrideMap = (opts.severityOverrides || []).reduce((m, o) => {
    const colon = o.indexOf(":");
    if (colon > 0) m[o.slice(0, colon)] = o.slice(colon + 1);
    return m;
  }, {});

  const filtered = { credentials: [], injections: [], dependencies: [] };

  for (const [catKey, items] of Object.entries(results)) {
    for (const entry of items) {
      const keepFindings = entry.findings.filter(f => {
        const item = { file: entry.file, finding: f };

        // Check ignore patterns
        for (const pat of ignorePats) {
          if (matchesFilter(item, pat)) return false;
        }

        // Check severity override
        if (overrideMap[f.label]) {
          f.severity = overrideMap[f.label];
        }

        return true;
      });
      if (keepFindings.length > 0) {
        filtered[catKey].push({ file: entry.file, findings: keepFindings });
      }
    }
  }

  return filtered;
}

function loadConfig(root) {
  const configPath = resolve(root, ".security-scan.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch { return {}; }
}

// npm audit integration
// ---------------------------------------------------------------------------
function runNpmAudit(root) {
  const findings = [];
  try {
    const auditJson = execSync("npm audit --json", { cwd: root, encoding: "utf-8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    const audit = JSON.parse(auditJson);
    if (audit.vulnerabilities) {
      for (const [pkg, info] of Object.entries(audit.vulnerabilities)) {
        const severity = info.severity === "critical" ? "high" : info.severity;
        const via = info.via || [];
        const advisories = via.filter(v => typeof v === "object").map(v => v.title || v.source || "").join(", ");
        findings.push({
          line: 0,
          column: 0,
          severity: severity === "info" ? "low" : severity,
          label: `npm ${pkg}@${info.range}: ${advisories || info.severity} (${info.via?.length || 0} advisory)`,
          match: `${pkg} (${info.range}) — CVEs: ${advisories || "unknown"}`,
        });
      }
    }
    return findings;
  } catch (e) {
    if (e.message && e.message.includes("ENOENT")) return findings; // no package.json
    if (e.stdout && e.stdout.includes("ENOENT")) return findings;
    // audit may fail if no package.json or network issue — silently skip
    return findings;
  }
}

// ---------------------------------------------------------------------------
// Scanning engine
// ---------------------------------------------------------------------------
function scanFile(filePath, patterns, content) {
  const findings = [];
  const ext = extname(filePath).toLowerCase();
  // Skip binary-like files
  if (['.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) return findings;

  const lines = content.split('\n');

  for (const pattern of patterns) {
    let match;
    let count = 0;
    while ((match = pattern.re.exec(content)) !== null && count < 500) {
      count++;
      const lineNum = content.substring(0, match.index).split('\n').length;
      const lineContent = lines[lineNum - 1]?.trim() || '';

      // Skip matches in comments
      if (isInComment(lineContent, ext, pattern.re)) continue;

      findings.push({
        line: lineNum,
        column: match.index - content.lastIndexOf('\n', match.index),
        severity: pattern.severity,
        label: pattern.label,
        match: lineContent.substring(0, 120),
      });
    }
  }

  return findings;
}

function isInComment(line, ext, regex) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  return false;
}

function scanAll(files, scanType, opts) {
  const results = {
    credentials: [],
    injections: [],
    dependencies: [],
  };

  for (const filePath of files) {
    let content;
    try { content = readFileSync(filePath, 'utf-8'); }
    catch { continue; }

    if (scanType === 'all' || scanType === 'credentials') {
      const findings = scanFile(filePath, CREDENTIAL_PATTERNS, content);
      if (findings.length > 0) {
        results.credentials.push({ file: filePath, findings });
      }
    }

    if (scanType === 'all' || scanType === 'injections') {
      const findings = scanFile(filePath, INJECTION_PATTERNS, content);
      if (findings.length > 0) {
        results.injections.push({ file: filePath, findings });
      }
    }

    if ((scanType === "all" || scanType === "dependencies") &&
        (filePath.endsWith("package.json") || filePath.endsWith("package-lock.json") || filePath.endsWith("yarn.lock"))) {
      const findings = scanFile(filePath, DEPENDENCY_ISSUES, content);
      if (findings.length > 0) {
        results.dependencies.push({ file: filePath, findings });
      }
    }
  }

  // Run npm audit for dependency vulnerability detection
  if (scanType === "all" || scanType === "dependencies") {
    const npmAuditFindings = runNpmAudit(opts.root);
    if (npmAuditFindings.length > 0) {
      results.dependencies.push({ file: "npm audit", findings: npmAuditFindings });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function formatText(results, opts, color) {
  const c = COLORS;
  const out = [];
  let totalIssues = 0;

  out.push(color ? `${c.bold}Security Scan Results${c.reset}` : 'Security Scan Results');
  out.push('='.repeat(50));
  out.push('');

  const categories = [
    { key: 'credentials', label: 'Credential Leaks', severityColor: c.red },
    { key: 'injections', label: 'Injection Vulnerabilities', severityColor: c.yellow },
    { key: 'dependencies', label: 'Dependency Issues', severityColor: c.dim },
  ];

  for (const cat of categories) {
    const items = results[cat.key];
    if (items.length === 0) continue;

    const fileCount = items.length;
    const findingCount = items.reduce((s, f) => s + f.findings.length, 0);
    totalIssues += findingCount;

    out.push(color
      ? `${c.bold}${cat.severityColor}${cat.label}${c.reset} (${findingCount} issue(s) in ${fileCount} file(s))`
      : `${cat.label} (${findingCount} issue(s) in ${fileCount} file(s))`);
    out.push('-'.repeat(40));

    for (const entry of items) {
      const relFile = relative(opts.root, entry.file);
      for (const f of entry.findings) {
        const sevColor = f.severity === 'high' ? c.red : f.severity === 'medium' ? c.yellow : c.dim;
        if (color) {
          out.push(`  ${sevColor}[${f.severity}]${c.reset} ${c.cyan}${f.label}${c.reset}`);
          out.push(`    ${c.dim}${relFile}:${f.line}${c.reset}`);
          out.push(`    ${f.match}`);
        } else {
          out.push(`  [${f.severity}] ${f.label}`);
          out.push(`    ${relFile}:${f.line}`);
          out.push(`    ${f.match}`);
        }
        out.push('');
      }
    }
  }

  if (totalIssues === 0) {
    out.push(color ? `${c.green}No security issues detected.${c.reset}` : 'No security issues detected.');
  } else {
    out.push(color
      ? `${c.bold}Total: ${c.yellow}${totalIssues}${c.reset} issue(s) found.`
      : `Total: ${totalIssues} issue(s) found.`);
  }

  return out.join('\n');
}

function formatJSON(results) {
  return JSON.stringify(results, null, 2);
}

function formatMarkdown(results) {
  const out = [];
  out.push('# Security Scan Results');
  out.push('');

  let totalIssues = 0;

  const categories = [
    { key: 'credentials', label: 'Credential Leaks' },
    { key: 'injections', label: 'Injection Vulnerabilities' },
    { key: 'dependencies', label: 'Dependency Issues' },
  ];

  for (const cat of categories) {
    const items = results[cat.key];
    if (items.length === 0) continue;

    const findingCount = items.reduce((s, f) => s + f.findings.length, 0);
    totalIssues += findingCount;

    out.push(`## ${cat.label}`);
    out.push('');
    out.push(`| Severity | File | Line | Detail |`);
    out.push(`|----------|------|------|--------|`);

    for (const entry of items) {
      for (const f of entry.findings) {
        out.push(`| ${f.severity} | \`${entry.file}\` | ${f.line} | ${f.label}: \`${f.match}\` |`);
      }
    }
    out.push('');
  }

  if (totalIssues === 0) {
    out.push('✅ No security issues detected.');
  } else {
    out.push(`**Total**: ${totalIssues} issue(s) found.`);
  }

  return out.join('\n');
}


function formatSarif(results, opts) {
  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/openc2-schema/main/schema.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "smart-security-scan", version: "1.0.0", informationUri: "https://github.com/wclinRD/opencode_smart_mcp" } },
      results: [],
    }],
  };
  const sevMap = { high: "error", medium: "warning", low: "note" };
  const catLabels = { credentials: "CredentialLeak", injections: "InjectionVulnerability", dependencies: "DependencyIssue" };
  for (const [catKey, items] of Object.entries(results)) {
    if (items.length === 0) continue;
    for (const entry of items) {
      for (const f of entry.findings) {
        sarif.runs[0].results.push({
          ruleId: f.label,
          level: sevMap[f.severity] || "warning",
          message: { text: f.match || f.label },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: entry.file },
              region: { startLine: f.line || 1, startColumn: f.column || 1 },
            },
          }],
          properties: { severity: f.severity, category: catLabels[catKey] || "Other" },
        });
      }
    }
  }
  return JSON.stringify(sarif, null, 2);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const opts = {
    root: '.',
    include: [],
    exclude: [],
    scan: 'all',
    format: 'text',
    failOn: null,
    color: undefined,
    ignore: [],
    severityOverrides: [],
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--include': opts.include.push(args[++i]); break;
      case '--exclude': opts.exclude.push(args[++i]); break;
      case '--scan': opts.scan = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--fail-on': opts.failOn = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
      case '--ignore': opts.ignore.push(args[++i]); break;
      case '--severity-override': opts.severityOverrides.push(args[++i]); break;
    }
    i++;
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,mjs,cjs,jsx,ts,tsx,py,rb,json,yaml,yml,env,toml,ini,cfg}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/*.min.*', '**/package-lock.json'];
  }

  // Load config file and merge (CLI flags override config)
  const config = loadConfig(opts.root);
  if (config.ignore) {
    opts.ignore = [...new Set([...config.ignore, ...opts.ignore])];
  }
  if (config.severityOverrides) {
    const configOverrides = Object.entries(config.severityOverrides).map(([k, v]) => k + ":" + v);
    opts.severityOverrides = [...new Set([...configOverrides, ...opts.severityOverrides])];
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node security-scan.mjs [options]

Security vulnerability scanner.

Options:
  --root <path>         Root directory (default: .)
  --include <glob>      Include file pattern (repeatable)
  --exclude <glob>      Exclude file pattern (repeatable)
  --scan <type>         Scan type: all, credentials, injections, dependencies
  --format <fmt>        Output: text, json, markdown, sarif (default: text)
  --fail-on <level>     Exit with error if issues at this level: low, medium, high
  --ignore <pattern>    Ignore findings by label or "file:label" (repeatable)
  --severity-override <l:s> Override severity: "label:severity" (repeatable)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node security-scan.mjs
  node security-scan.mjs --scan credentials
  node security-scan.mjs --format json
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  const files = findFiles(root, opts.include, opts.exclude);
  if (files.length === 0) {
    console.log('No matching files found.');
    return;
  }

  let results = scanAll(files, opts.scan, opts);

  // Apply false positive filters
  if (opts.ignore.length > 0 || opts.severityOverrides.length > 0) {
    results = applyFilters(results, opts);
  }

  // --fail-on check
  if (opts.failOn) {
    const sevOrder = { high: 3, medium: 2, low: 1 };
    const threshold = sevOrder[opts.failOn];
    let failCount = 0;
    for (const items of Object.values(results)) {
      for (const entry of items) {
        for (const f of entry.findings) {
          if ((sevOrder[f.severity] || 0) >= threshold) failCount++;
        }
      }
    }
    if (failCount > 0) {
      console.log(`FAIL: ${failCount} issue(s) at >= ${opts.failOn} severity`);
      process.exit(1);
    }
  }

  switch (opts.format) {
    case 'json':
      console.log(formatJSON(results));
      break;
    case 'markdown':
      console.log(formatMarkdown(results));
      break;
    case 'sarif':
      console.log(formatSarif(results, opts));
      break;
    case 'text':
    default:
      console.log(formatText(results, opts, color));
      break;
  }
}

main();
