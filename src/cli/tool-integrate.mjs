#!/usr/bin/env node

// tool-integrate.mjs — OpenCode tool integration and management
//
// Manages plugins, MCP servers, and provides smart git workflow support.
//
// Usage:
//   node tool-integrate.mjs <command> [options]
//
// Commands:
//   list                  List available tools and plugins
//   suggest-commit        Analyze changes and suggest commit scope
//   generate-pr           Generate PR description from changes
//   diagnose              Parse terminal error output and suggest fix
//   mcp <action>          Manage MCP servers (list, add, remove)
//
// Options:
//   --root <path>         Root directory (default: .)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

import { readFileSync, statSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function git(args, cwd) {
  try {
    return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return '';
  }
}

function isGitRepo(root) {
  try { execSync('git rev-parse --git-dir', { cwd: root, stdio: 'pipe' }); return true; }
  catch { return false; }
}

function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function cmdList(root) {
  const tools = [];
  const dayDir = resolve(root);

  // List all .mjs tools in the day directory
  if (existsSync(dayDir)) {
    try {
      const entries = readdirSync(dayDir);
      for (const entry of entries) {
        if (entry.endsWith('.mjs') && !entry.startsWith('_') && !entry.startsWith('.')) {
          const filePath = resolve(dayDir, entry);
          const st = statSync(filePath);
          // Read first few lines for description
          const content = readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0]?.replace('#!/usr/bin/env node', '').trim();
          const descLine = content.split('\n').find(l => l.trim().startsWith('//') && !l.includes('Usage'));
          const description = (descLine || firstLine || '').replace(/\/\//g, '').trim();

          tools.push({
            name: entry.replace('.mjs', ''),
            file: entry,
            description: description || 'OpenCode enhancement tool',
            size: st.size,
            modified: st.mtime,
          });
        }
      }
    } catch { /* ignore */ }
  }

  return tools;
}

function cmdSuggestCommit(root) {
  if (!isGitRepo(root)) return { error: 'Not a git repository' };

  const diff = git(['diff', '--stat', '--no-color'], root);
  const staged = git(['diff', '--cached', '--stat', '--no-color'], root);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
  const log = git(['log', '--oneline', '-5'], root);

  // Analyze changes
  const changedFiles = [];
  const diffStat = (diff + '\n' + staged).split('\n').filter(Boolean);
  for (const line of diffStat) {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)/);
    if (match) {
      changedFiles.push({ file: match[1].trim(), changes: parseInt(match[2], 10) });
    }
  }

  // Categorize files
  const categories = { feat: [], fix: [], refactor: [], docs: [], test: [], chore: [], other: [] };
  for (const f of changedFiles) {
    const name = f.file.toLowerCase();
    if (name.includes('test') || name.includes('spec')) categories.test.push(f);
    else if (name.includes('doc') || name.endsWith('.md')) categories.docs.push(f);
    else if (name.includes('config') || name.includes('json') || name.includes('lock')) categories.chore.push(f);
    else if (f.changes > 20) categories.feat.push(f);
    else if (f.changes > 5) categories.refactor.push(f);
    else categories.fix.push(f);
  }

  // Generate scope suggestion
  const activeCategories = Object.entries(categories)
    .filter(([, files]) => files.length > 0)
    .map(([cat, files]) => `${cat}(${files.length})`);

  let scope = '';
  const mainFiles = changedFiles.slice(0, 3).map(f => f.file.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, ''));
  if (mainFiles.length === 1) scope = mainFiles[0];
  else if (mainFiles.length > 1) scope = mainFiles.join('-');

  return {
    branch,
    recentCommits: log.trim().split('\n').filter(Boolean).slice(0, 5),
    changedFiles,
    categories: Object.fromEntries(Object.entries(categories).filter(([, v]) => v.length > 0)),
    suggestedScope: scope,
    suggestedType: activeCategories[0]?.split('(')[0] || 'chore',
    suggestedMessage: `${activeCategories[0]?.split('(')[0] || 'chore'}${scope ? `(${scope})` : ''}: update ${changedFiles.length} file(s)`,
  };
}

function cmdGeneratePR(root) {
  if (!isGitRepo(root)) return { error: 'Not a git repository' };

  const baseBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
  const diff = git(['diff', 'HEAD~1', '--stat', '--no-color'], root);
  const diffContent = git(['diff', 'HEAD~1', '--no-color'], root);
  const log = git(['log', 'HEAD~5..HEAD', '--oneline', '--no-color'], root);

  // Parse commits
  const commits = log.trim().split('\n').filter(Boolean).map(line => {
    const [hash, ...msg] = line.split(' ');
    return { hash, message: msg.join(' ') };
  });

  // Parse changed files
  const files = diff.trim().split('\n').filter(Boolean).map(line => {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)/);
    return match ? { file: match[1].trim(), changes: parseInt(match[2], 10) } : null;
  }).filter(Boolean);

  // Generate description
  const changedTypes = new Set();
  for (const f of files) {
    if (f.file.includes('test') || f.file.includes('spec')) changedTypes.add('test');
    else if (f.file.includes('doc') || f.file.endsWith('.md')) changedTypes.add('docs');
    else changedTypes.add('code');
  }

  return {
    baseBranch,
    commits,
    files,
    summary: `${files.length} file(s) changed across ${commits.length} commit(s)`,
    description: [
      `## Changes`,
      ``,
      `This PR includes ${files.length} file(s) changed across ${commits.length} commit(s).`,
      ``,
      `### Files Changed`,
      ``,
      ...files.map(f => `- \`${f.file}\` (${f.changes} changes)`),
      ``,
      `### Commits`,
      ``,
      ...commits.map(c => `- ${c.hash} ${c.message}`),
      ``,
      `### Checklist`,
      ``,
      `- [ ] Tests pass`,
      `- [ ] Code reviewed`,
      `- [ ] Documentation updated`,
    ].join('\n'),
  };
}

function cmdDiagnose(errorText) {
  // Common terminal error patterns with fix suggestions
  const patterns = [
    { re: /command not found/i, suggestion: 'Check if the command is installed and in PATH' },
    { re: /module not found/i, suggestion: 'Run npm install to install dependencies' },
    { re: /Cannot find module/i, suggestion: 'Check import path or run npm install' },
    { re: /port.*already in use/i, suggestion: 'Kill the process using the port or change the port number' },
    { re: /permission denied/i, suggestion: 'Check file permissions or run with appropriate privileges' },
    { re: /no such file/i, suggestion: 'Check file path and ensure the file exists' },
    { re: /not a command/i, suggestion: 'Verify the command syntax and options' },
    { re: /unexpected token/i, suggestion: 'Check for syntax errors in the file, missing brackets/parentheses' },
    { re: /is not defined/i, suggestion: 'Check for typos or missing imports' },
    { re: /cannot read property/i, suggestion: 'Add null/undefined checks before accessing properties' },
    { re: /npm ERR!/i, suggestion: 'Try deleting node_modules and package-lock.json, then run npm install again' },
    { re: /ERR! code ENOENT/i, suggestion: 'A required file or directory was not found' },
    { re: /ERR! code EEXIST/i, suggestion: 'A file or directory already exists' },
    { re: /network.*error/i, suggestion: 'Check your network connection or proxy settings' },
    { re: /timeout/i, suggestion: 'Increase timeout value or check network connectivity' },
  ];

  const results = [];
  for (const { re, suggestion } of patterns) {
    if (re.test(errorText)) {
      results.push({ matched: errorText.match(re)[0], suggestion });
    }
  }

  return results.length > 0 ? { diagnostics: results } : {
    diagnostics: [{
      matched: 'Unknown error',
      suggestion: 'Review the error output for clues. Try searching the error message online.',
    }],
  };
}

function cmdMCP(action, args) {
  const mcpDir = resolve(process.env.HOME || process.env.USERPROFILE || '.', '.opencode', 'mcp');
  const configFile = resolve(process.env.HOME || process.env.USERPROFILE || '.', '.opencode', 'opencode.jsonc');

  switch (action) {
    case 'list': {
      if (!existsSync(mcpDir)) return { servers: [] };
      try {
        const servers = readdirSync(mcpDir).filter(e => !e.startsWith('.'));
        return { servers };
      } catch { return { servers: [] }; }
    }
    case 'add': {
      const name = args[0];
      const command = args.slice(1).join(' ');
      if (!name || !command) return { error: 'Usage: mcp add <name> <command>' };
      if (!existsSync(mcpDir)) mkdirSafe(mcpDir);
      const config = { name, command, type: 'mcp' };
      writeFileSync(resolve(mcpDir, `${name}.json`), JSON.stringify(config, null, 2));
      return { success: true, message: `MCP server '${name}' added` };
    }
    case 'remove': {
      const name = args[0];
      if (!name) return { error: 'Usage: mcp remove <name>' };
      const target = resolve(mcpDir, `${name}.json`);
      if (existsSync(target)) {
        try { require('fs').unlinkSync(target); } catch { /* ignore */ }
        return { success: true, message: `MCP server '${name}' removed` };
      }
      return { error: `MCP server '${name}' not found` };
    }
    default:
      return { error: `Unknown MCP action: ${action}. Use: list, add, remove` };
  }
}

function mkdirSafe(dir) {
  try { require('fs').mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function formatText(command, result, opts, color) {
  const c = COLORS;
  const out = [];

  switch (command) {
    case 'list': {
      out.push(color ? `${c.bold}Available Tools${c.reset}` : 'Available Tools');
      out.push('='.repeat(40));
      out.push('');
      if (result.length === 0) {
        out.push('No tools found.');
      } else {
        for (const tool of result) {
          if (color) {
            out.push(`  ${c.cyan}${tool.name}${c.reset}`);
            out.push(`    ${c.dim}${tool.description}${c.reset}`);
            out.push(`    File: ${tool.file} (${(tool.size / 1024).toFixed(1)} KB)`);
          } else {
            out.push(`  ${tool.name}`);
            out.push(`    ${tool.description}`);
          }
          out.push('');
        }
        out.push(`Total: ${result.length} tool(s)`);
      }
      break;
    }
    case 'suggest-commit': {
      if (result.error) {
        out.push(`Error: ${result.error}`);
        break;
      }
      out.push(color ? `${c.bold}Commit Scope Suggestion${c.reset}` : 'Commit Scope Suggestion');
      out.push('='.repeat(40));
      out.push('');
      out.push(color ? `  Branch: ${c.yellow}${result.branch}${c.reset}` : `  Branch: ${result.branch}`);
      out.push(`  Suggested: ${result.suggestedMessage}`);
      out.push('');
      out.push('  Changed files:');
      for (const f of result.changedFiles) {
        out.push(`    ${f.file} (${f.changes} changes)`);
      }
      out.push('');
      if (result.recentCommits && result.recentCommits.length > 0) {
        out.push('  Recent commits:');
        for (const c of result.recentCommits) {
          out.push(`    ${c}`);
        }
      }
      break;
    }
    case 'generate-pr': {
      if (result.error) {
        out.push(`Error: ${result.error}`);
        break;
      }
      out.push(color ? `${c.bold}PR Description${c.reset}` : 'PR Description');
      out.push('='.repeat(40));
      out.push('');
      out.push(result.description);
      break;
    }
    case 'diagnose': {
      out.push(color ? `${c.bold}Error Diagnostics${c.reset}` : 'Error Diagnostics');
      out.push('='.repeat(40));
      out.push('');
      for (const d of result.diagnostics) {
        out.push(color
          ? `  ${c.red}⚠${c.reset} ${d.matched}`
          : `  ⚠ ${d.matched}`);
        out.push(`    ${color ? c.green + d.suggestion + c.reset : d.suggestion}`);
        out.push('');
      }
      break;
    }
    case 'mcp': {
      if (result.error) {
        out.push(`Error: ${result.error}`);
      } else if (result.servers) {
        out.push('MCP Servers:');
        for (const s of result.servers) {
          out.push(`  ${s.replace('.json', '')}`);
        }
      } else if (result.success) {
        out.push(color ? `${c.green}${result.message}${c.reset}` : result.message);
      }
      break;
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const opts = {
    command: args[0],
    commandArgs: args.slice(1).filter(a => !a.startsWith('--')),
    root: '.',
    format: 'text',
    color: undefined,
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--color': opts.color = true; break;
      case '--no-color': opts.color = false; break;
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node tool-integrate.mjs <command> [options]

OpenCode tool integration and management.

Commands:
  list                  List available tools and plugins
  suggest-commit        Analyze changes and suggest commit scope
  generate-pr           Generate PR description from changes
  diagnose <text>       Parse terminal error output and suggest fix
  mcp list              List MCP servers
  mcp add <name> <cmd>  Add an MCP server
  mcp remove <name>     Remove an MCP server

Options:
  --root <path>         Root directory (default: .)
  --format <fmt>        Output: text, json, markdown (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node tool-integrate.mjs list
  node tool-integrate.mjs suggest-commit
  node tool-integrate.mjs generate-pr
  node tool-integrate.mjs diagnose "npm ERR! module not found"
  node tool-integrate.mjs mcp list
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const root = resolve(opts.root);
  const color = useColor(opts);

  let result;

  switch (opts.command) {
    case 'list':
      result = cmdList(root);
      break;
    case 'suggest-commit':
      result = cmdSuggestCommit(root);
      break;
    case 'generate-pr':
      result = cmdGeneratePR(root);
      break;
    case 'diagnose':
      result = cmdDiagnose(opts.commandArgs.join(' '));
      break;
    case 'mcp':
      result = cmdMCP(opts.commandArgs[0], opts.commandArgs.slice(1));
      break;
    default:
      console.error(`Unknown command: ${opts.command}`);
      printHelp();
      process.exit(1);
  }

  switch (opts.format) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'markdown':
      // Just format as text with markdown-compatible output
      console.log(formatText(opts.command, result, opts, false));
      break;
    case 'text':
    default:
      console.log(formatText(opts.command, result, opts, color));
      break;
  }
}

main();
