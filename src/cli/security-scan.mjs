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
  { re: /(?:['"`]?(?:slack[_-]?token|discord[_-]?token|github[_-]?token|gitlab[_-]?token)['"`]?\s*[:=]\s*['"`][^'"`\s]{8,})/gi, severity: 'high', label: 'Service Token' },
  { re: /(?:['"`]?(?:jwt|auth[_-]?token|bearer)['"`]?\s*[:=]\s*['"`][^'"`\s]{20,})/gi, severity: 'medium', label: 'JWT/Auth Token' },
  { re: /(?:BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY)/gi, severity: 'high', label: 'Private Key' },
  { re: /(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{36})/g, severity: 'high', label: 'GitHub Token' },
  { re: /(?:sk-[a-zA-Z0-9]{20,})/g, severity: 'high', label: 'OpenAI API Key' },
  { re: /(?:mongodb\+srv:\/\/[^\s'"`,)]+)/g, severity: 'high', label: 'MongoDB Connection String' },
  { re: /(?:postgresql?:\/\/[^\s:]+:[^\s@]+@[^\s'"`,)]+)/g, severity: 'high', label: 'PostgreSQL Connection String' },
  { re: /(?:redis:\/\/[^\s:]+:[^\s@]+@[^\s'"`,)]+)/g, severity: 'high', label: 'Redis Connection String' },
  { re: /(?:-----BEGIN\s+CERTIFICATE-----)/g, severity: 'medium', label: 'Certificate' },
  { re: /(?:password\s*=\s*['"`][^'"`\s]{3,})/gi, severity: 'high', label: 'Password Assignment' },
];

const INJECTION_PATTERNS = [
  // SQL injection
  { re: /(?:execute|query|run)\s*\(\s*[`'"]\s*SELECT/gi, severity: 'high', label: 'SQL Injection (direct query)' },
  { re: /\$\{[\s\S]*?\}\s*\)\s*;/g, severity: 'medium', label: 'Template injection (check for SQL)' },
  { re: /(?:\+\s*['"`]\s*\+\s*(?:req\.|body\.|params\.|query\.))/gi, severity: 'high', label: 'SQL Injection (string concat)' },
  { re: /(?:exec|sp_executesql)\s*\(\s*['"`]/gi, severity: 'high', label: 'SQL Injection (dynamic SQL)' },
  // Cross-site scripting (XSS)
  { re: /(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=/g, severity: 'high', label: 'XSS (direct HTML injection)' },
  { re: /(?:dangerouslySetInnerHTML|v-html|bypassSecurityTrust)/g, severity: 'high', label: 'XSS (bypassing sanitization)' },
  { re: /document\.write\s*\(/g, severity: 'high', label: 'XSS (document.write)' },
  { re: /eval\s*\(/g, severity: 'high', label: 'Code Injection (eval)' },
  { re: /new\s+Function\s*\(/g, severity: 'high', label: 'Code Injection (new Function)' },
  { re: /setTimeout\s*\(\s*['"`]/g, severity: 'medium', label: 'Code Injection (string setTimeout)' },
  { re: /setInterval\s*\(\s*['"`]/g, severity: 'medium', label: 'Code Injection (string setInterval)' },
  // Command injection
  { re: /(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(\s*(?:['"`].*?\+|.+?\$)/g, severity: 'high', label: 'Command Injection' },
  { re: /child_process/g, severity: 'low', label: 'Child process usage (review for injection)' },
  { re: /(?:shell:\s*true)/gi, severity: 'medium', label: 'Shell execution risk' },
  // Path traversal
  { re: /(?:readFileSync|readFile|writeFileSync|writeFile|createReadStream)\s*\(\s*(?:['"`]|req\.|params\.)/g, severity: 'medium', label: 'Path traversal risk (file operations)' },
  // Regular expression injection
  { re: /new\s+RegExp\s*\(\s*(?:['"`]|req\.|params\.)/g, severity: 'low', label: 'ReDoS risk (user input in regex)' },
  // Prototype pollution
  { re: /(?:Object\.assign|\.\.\.)\s*\(?\s*(?:req\.|body\.)/gi, severity: 'medium', label: 'Prototype pollution risk' },
  // Insecure deserialization
  { re: /JSON\.parse\s*\(\s*(?:req\.|body\.)/g, severity: 'low', label: 'JSON parsing of user input' },
];

const DEPENDENCY_ISSUES = [
  { re: /"lodash"\s*:\s*"/g, severity: 'low', label: 'Consider using lodash-es for tree-shaking' },
  { re: /"moment"\s*:\s*"/g, severity: 'low', label: 'Consider using date-fns or dayjs (moment is heavy)' },
  { re: /"gulp"/g, severity: 'low', label: 'Gulp is outdated; consider other build tools' },
  { re: /"bower"/g, severity: 'low', label: 'Bower is deprecated; use npm/yarn/pnpm' },
  { re: /"request"/g, severity: 'low', label: 'Request is deprecated; use node-fetch or axios' },
];

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

function scanAll(files, scanType) {
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

    if ((scanType === 'all' || scanType === 'dependencies') &&
        (filePath.endsWith('package.json') || filePath.endsWith('package-lock.json') || filePath.endsWith('yarn.lock'))) {
      const findings = scanFile(filePath, DEPENDENCY_ISSUES, content);
      if (findings.length > 0) {
        results.dependencies.push({ file: filePath, findings });
      }
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
    }
    i++;
  }

  if (opts.include.length === 0) {
    opts.include = ['**/*.{js,mjs,cjs,jsx,ts,tsx,py,rb,json,yaml,yml,env,toml,ini,cfg}'];
  }
  if (opts.exclude.length === 0) {
    opts.exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/*.min.*', '**/package-lock.json'];
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

  const results = scanAll(files, opts.scan);

  switch (opts.format) {
    case 'json':
      console.log(formatJSON(results));
      break;
    case 'markdown':
      console.log(formatMarkdown(results));
      break;
    case 'text':
    default:
      console.log(formatText(results, opts, color));
      break;
  }
}

main();
