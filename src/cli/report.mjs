#!/usr/bin/env node

// report.mjs — HTML report generator
//
// Generates self-contained HTML reports from tool output.
// Supports test results, security scans, coverage analysis, and more.
//
// Usage:
//   node report.mjs <type> [options]
//
// Types:
//   test             Generate test report from smart_test output
//   security         Generate security report from smart_security output
//   coverage         Generate coverage report from coverage-check output
//   custom           Generate report from custom JSON input
//
// Options:
//   --root <path>         Root directory (default: .)
//   --input <file>        Read input from JSON file (or stdin)
//   --title <text>        Report title
//   --output <file>       Output file path (default: report-<type>-<timestamp>.html)
//   --theme <theme>       Theme: light, dark, auto (default: light)
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node test-runner.mjs --format json | node report.mjs test
//   node security-scan.mjs --format json | node report.mjs security --title "Security Audit"
//   node report.mjs coverage --input coverage.json --theme dark

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function relativePath(root, filePath) {
  const rel = filePath.replace(root.replace(/\\/g, '/'), '').replace(/^[/\\]/, '');
  return rel || basename(filePath);
}

// ---------------------------------------------------------------------------
// HTML template (self-contained, no external dependencies)
// ---------------------------------------------------------------------------

function htmlTemplate({ title, head, body, theme = 'light' }) {
  const isDark = theme === 'dark';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: ${isDark ? '#1a1a2e' : '#ffffff'};
    --surface: ${isDark ? '#16213e' : '#f8f9fa'};
    --surface2: ${isDark ? '#0f3460' : '#e9ecef'};
    --text: ${isDark ? '#e0e0e0' : '#212529'};
    --text2: ${isDark ? '#a0a0b0' : '#6c757d'};
    --border: ${isDark ? '#2a2a4a' : '#dee2e6'};
    --primary: ${isDark ? '#4da6ff' : '#0d6efd'};
    --success: ${isDark ? '#2ecc71' : '#198754'};
    --warning: ${isDark ? '#f39c12' : '#ffc107'};
    --danger: ${isDark ? '#e74c3c' : '#dc3545'};
    --info: ${isDark ? '#3498db' : '#0dcaf0'};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    padding: 20px;
  }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.8em; margin-bottom: 8px; color: var(--primary); }
  .subtitle { color: var(--text2); margin-bottom: 24px; font-size: 0.9em; }
  .summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px; margin-bottom: 32px;
  }
  .summary-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px; text-align: center;
  }
  .summary-card .value {
    font-size: 2em; font-weight: bold; margin-bottom: 4px;
  }
  .summary-card .label {
    font-size: 0.85em; color: var(--text2);
  }
  .summary-card.pass .value { color: var(--success); }
  .summary-card.fail .value { color: var(--danger); }
  .summary-card.warn .value { color: var(--warning); }
  .summary-card.info .value { color: var(--info); }
  .section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 16px; overflow: hidden;
  }
  .section-header {
    padding: 12px 16px; font-weight: 600; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center;
    background: var(--surface2); user-select: none;
  }
  .section-header:hover { opacity: 0.85; }
  .section-body { padding: 16px; }
  .section-body.hidden { display: none; }
  table {
    width: 100%; border-collapse: collapse; font-size: 0.9em;
  }
  th, td {
    padding: 8px 12px; text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th { background: var(--surface2); font-weight: 600; }
  tr:hover { background: var(--surface2); opacity: 0.7; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 0.8em; font-weight: 600;
  }
  .badge.pass { background: var(--success); color: #fff; }
  .badge.fail { background: var(--danger); color: #fff; }
  .badge.warn { background: var(--warning); color: #000; }
  .badge.info { background: var(--info); color: #000; }
  .code {
    font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    font-size: 0.85em; background: ${isDark ? '#0d1117' : '#f4f4f4'};
    padding: 8px 12px; border-radius: 4px; overflow-x: auto;
    white-space: pre-wrap; word-break: break-all;
  }
  .finding { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .finding:last-child { border-bottom: none; }
  .finding .file { font-family: monospace; font-size: 0.9em; }
  .finding .line { color: var(--text2); font-size: 0.85em; }
  .finding .desc { margin-top: 4px; }
  .timestamp { color: var(--text2); font-size: 0.85em; margin-top: 32px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a2e; --surface: #16213e; --surface2: #0f3460;
      --text: #e0e0e0; --text2: #a0a0b0; --border: #2a2a4a; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">Generated on ${new Date().toLocaleString()}</div>
  ${head}
  ${body}
  <div class="timestamp">Report generated by opencode report.mjs</div>
</div>
<script>
  document.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => {
      h.nextElementSibling.classList.toggle('hidden');
    });
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

function generateTestReport(data, opts) {
  const { results = [], summary = {}, duration = 0 } = data;
  const total = results.length;
  const passed = results.filter(r => r.status === 'pass' || r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'fail' || r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skip' || r.status === 'skipped').length;

  const head = `
  <div class="summary-grid">
    <div class="summary-card ${passed === total && total > 0 ? 'pass' : 'fail'}">
      <div class="value">${passed}/${total}</div>
      <div class="label">Passed</div>
    </div>
    <div class="summary-card ${failed > 0 ? 'fail' : 'info'}">
      <div class="value">${failed}</div>
      <div class="label">Failed</div>
    </div>
    <div class="summary-card info">
      <div class="value">${skipped}</div>
      <div class="label">Skipped</div>
    </div>
    <div class="summary-card info">
      <div class="value">${duration ? (duration / 1000).toFixed(2) + 's' : '-'}</div>
      <div class="label">Duration</div>
    </div>
  </div>`;

  let body = '';
  if (failed > 0) {
    const failedTests = results.filter(r => r.status === 'fail' || r.status === 'failed');
    body += `
  <div class="section">
    <div class="section-header" style="color: var(--danger);">
      <span>❌ Failed Tests (${failed})</span>
      <span>▼</span>
    </div>
    <div class="section-body">`;
    for (const t of failedTests) {
      body += `
      <div class="finding">
        <div class="file">${escapeHtml(t.name || t.test || 'Unknown')}</div>
        <div class="desc">${escapeHtml(t.error || t.message || 'No error details')}</div>
      </div>`;
    }
    body += `
    </div>
  </div>`;
  }

  if (results.length > 0) {
    body += `
  <div class="section">
    <div class="section-header">
      <span>📋 All Tests (${results.length})</span>
      <span>▼</span>
    </div>
    <div class="section-body">
    <table>
      <thead><tr><th>Status</th><th>Test</th><th>Duration</th><th>Message</th></tr></thead>
      <tbody>`;
    for (const t of results) {
      const status = (t.status === 'pass' || t.status === 'passed') ? 'pass' : 'fail';
      const dur = t.duration ? `${(t.duration / 1000).toFixed(2)}s` : '-';
      body += `
        <tr>
          <td><span class="badge ${status}">${escapeHtml(t.status)}</span></td>
          <td>${escapeHtml(t.name || t.test || 'Unknown')}</td>
          <td>${dur}</td>
          <td>${escapeHtml(t.message || '')}</td>
        </tr>`;
    }
    body += `
      </tbody>
    </table>
    </div>
  </div>`;
  }

  return { title: opts.title || 'Test Report', head, body };
}

function generateSecurityReport(data, opts) {
  const { findings = [], summary = {} } = data;
  // Also support different formats: { results: [...], vulnerabilities: [...] }
  const items = findings.length > 0 ? findings
    : data.results || data.vulnerabilities || [];

  const critical = items.filter(f => (f.severity || '').toLowerCase() === 'critical').length;
  const high = items.filter(f => (f.severity || '').toLowerCase() === 'high').length;
  const medium = items.filter(f => (f.severity || '').toLowerCase() === 'medium').length;
  const low = items.filter(f => (f.severity || '').toLowerCase() === 'low' || (f.severity || '').toLowerCase() === 'info').length;

  const head = `
  <div class="summary-grid">
    <div class="summary-card ${critical > 0 ? 'fail' : 'info'}">
      <div class="value">${critical}</div>
      <div class="label">Critical</div>
    </div>
    <div class="summary-card ${high > 0 ? 'fail' : 'info'}">
      <div class="value">${high}</div>
      <div class="label">High</div>
    </div>
    <div class="summary-card ${medium > 0 ? 'warn' : 'info'}">
      <div class="value">${medium}</div>
      <div class="label">Medium</div>
    </div>
    <div class="summary-card info">
      <div class="value">${low}</div>
      <div class="label">Low / Info</div>
    </div>
  </div>`;

  let body = '';
  if (items.length > 0) {
    body += `
  <div class="section">
    <div class="section-header">
      <span>🔍 Findings (${items.length})</span>
      <span>▼</span>
    </div>
    <div class="section-body">
    <table>
      <thead><tr><th>Severity</th><th>File</th><th>Line</th><th>Description</th></tr></thead>
      <tbody>`;
    for (const f of items) {
      const sev = (f.severity || 'info').toLowerCase();
      const sevClass = sev === 'critical' || sev === 'high' ? 'fail' : sev === 'medium' ? 'warn' : 'info';
      const filePath = f.file || f.path || f.location || '';
      body += `
        <tr>
          <td><span class="badge ${sevClass}">${escapeHtml(sev)}</span></td>
          <td class="file">${escapeHtml(relativePath(opts.root, filePath))}</td>
          <td>${f.line || f.lineNumber || '-'}</td>
          <td>${escapeHtml(f.message || f.description || f.rule || '')}</td>
        </tr>`;
    }
    body += `
      </tbody>
    </table>
    </div>
  </div>`;
  }

  return { title: opts.title || 'Security Report', head, body };
}

function generateCoverageReport(data, opts) {
  const { issues = [], file = '', summary = {} } = data;
  const items = issues.length > 0 ? issues : data.findings || data.results || [];

  const total = items.length;
  const threshold = opts.threshold || data.threshold || 80;

  const head = `
  <div class="summary-grid">
    <div class="summary-card ${total === 0 ? 'pass' : 'warn'}">
      <div class="value">${total}</div>
      <div class="label">Issues Found</div>
    </div>
    <div class="summary-card info">
      <div class="value">${threshold}%</div>
      <div class="label">Threshold</div>
    </div>
  </div>`;

  let body = '';
  if (file) {
    body += `
  <div class="section">
    <div class="section-header"><span>📄 Analyzed File</span></div>
    <div class="section-body"><div class="code">${escapeHtml(file)}</div></div>
  </div>`;
  }

  if (items.length > 0) {
    body += `
  <div class="section">
    <div class="section-header">
      <span>⚠️ Coverage Gaps (${items.length})</span>
      <span>▼</span>
    </div>
    <div class="section-body">`;
    for (const item of items) {
      const desc = item.description || item.message || item.issue || '';
      const location = item.line ? `Line ${item.line}` : item.type || '';
      body += `
      <div class="finding">
        <div class="file">${escapeHtml(location)}</div>
        <div class="desc">${escapeHtml(desc)}</div>
      </div>`;
    }
    body += `
    </div>
  </div>`;
  }

  return { title: opts.title || 'Coverage Report', head, body };
}

function generateCustomReport(data, opts) {
  const { summary = {}, sections = [], items = [] } = data;

  let head = '';
  if (summary && Object.keys(summary).length > 0) {
    const cards = Object.entries(summary).map(([key, value]) => `
    <div class="summary-card info">
      <div class="value">${escapeHtml(String(value))}</div>
      <div class="label">${escapeHtml(key)}</div>
    </div>`).join('');
    head = `<div class="summary-grid">${cards}</div>`;
  }

  let body = '';
  if (sections.length > 0) {
    for (const section of sections) {
      body += `
  <div class="section">
    <div class="section-header">
      <span>${escapeHtml(section.title || 'Section')}</span>
      <span>▼</span>
    </div>
    <div class="section-body">
      ${section.content ? `<div class="code">${escapeHtml(section.content)}</div>` : ''}
      ${section.items ? section.items.map(i =>
        `<div class="finding"><div class="file">${escapeHtml(i.title || i.name || '')}</div><div class="desc">${escapeHtml(i.description || i.value || '')}</div></div>`
      ).join('\n') : ''}
    </div>
  </div>`;
    }
  }

  if (items.length > 0) {
    body += `
  <div class="section">
    <div class="section-header">
      <span>📋 Items (${items.length})</span>
      <span>▼</span>
    </div>
    <div class="section-body">
    <table>
      <thead><tr>${Object.keys(items[0]).map(k => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
      <tbody>${items.map(item =>
        `<tr>${Object.values(item).map(v => `<td>${escapeHtml(String(v))}</td>`).join('')}</tr>`
      ).join('\n')}
      </tbody>
    </table>
    </div>
  </div>`;
  }

  return { title: opts.title || 'Custom Report', head, body };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node report.mjs <type> [options]

HTML report generator for smart outputs.

Types:
  test             Generate test report from smart_test output
  security         Generate security report from smart_security output
  coverage         Generate coverage report from coverage-check output
  custom           Generate report from custom JSON input

Options:
  --root <path>         Root directory (default: .)
  --input <file>        Read input from JSON file (or stdin)
  --title <text>        Report title
  --output <file>       Output file path
  --theme <theme>       Theme: light, dark, auto (default: light)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node test-runner.mjs --format json | node report.mjs test
  node security-scan.mjs --format json | node report.mjs security
  node report.mjs coverage --input coverage.json --theme dark
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownTypes = ['test', 'security', 'coverage', 'custom'];
  const opts = {
    type: knownTypes.includes(args[0]) ? args[0] : null,
    root: '.',
    input: null,
    title: '',
    output: null,
    theme: 'light',
    color: undefined,
  };

  if (!opts.type) {
    console.error(`Unknown report type: ${args[0]}`);
    console.error(`Valid types: ${knownTypes.join(', ')}`);
    process.exit(1);
  }

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--input': opts.input = args[++i]; break;
      case '--title': opts.title = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--theme': opts.theme = args[++i]; break;
      case '--no-color': opts.color = false; break;
      case '--color': opts.color = true; break;
    }
    i++;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const color = useColor(opts);
  const root = resolve(opts.root);

  // Read input
  let rawInput;
  if (opts.input) {
    const content = readFileSafe(resolve(root, opts.input));
    if (!content) {
      console.error(`Cannot read input file: ${opts.input}`);
      process.exit(1);
    }
    rawInput = content;
  } else if (!process.stdin.isTTY) {
    rawInput = await readStdin();
  }

  if (!rawInput || !rawInput.trim()) {
    console.error('No input provided. Use --input <file> or pipe data to stdin.');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(rawInput);
  } catch (e) {
    console.error(`Invalid JSON input: ${e.message}`);
    process.exit(1);
  }

  // Generate report
  let reportData;
  switch (opts.type) {
    case 'test':
      reportData = generateTestReport(data, opts);
      break;
    case 'security':
      reportData = generateSecurityReport(data, opts);
      break;
    case 'coverage':
      reportData = generateCoverageReport(data, opts);
      break;
    case 'custom':
      reportData = generateCustomReport(data, opts);
      break;
  }

  const html = htmlTemplate({
    title: reportData.title,
    head: reportData.head,
    body: reportData.body,
    theme: opts.theme,
  });

  // Output
  const outputPath = opts.output || `report-${opts.type}-${timestamp()}.html`;
  const fullPath = resolve(root, outputPath);
  writeFileSync(fullPath, html, 'utf-8');
  console.log(`✅ Report generated: ${outputPath}`);

  if (color) {
    const c = COLORS;
    console.log(`${c.dim}Open with: ${c.cyan}${fullPath}${c.reset}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
