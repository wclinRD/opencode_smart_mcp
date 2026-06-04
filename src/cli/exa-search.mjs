#!/usr/bin/env node

// exa-search.mjs — Exa Web Search & Crawl CLI
//
// Uses Exa API (https://exa.ai) for web search, content crawling,
// and code search.
//
// Usage:
//   node exa-search.mjs search <query> [options]
//   node exa-search.mjs crawl <url> [url...]
//   node exa-search.mjs code <query> [options]
//
// Options:
//   --num-results <n>     Number of results (default: 10)
//   --max-chars <n>       Max characters per result (default: 3000)
//   --format <fmt>        Output: text, json (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

const EXA_API_KEY = process.env.EXA_API_KEY || '';

const API_BASE = 'https://api.exa.ai';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getKey() {
  if (!EXA_API_KEY) {
    console.error('Error: EXA_API_KEY environment variable is not set.');
    console.error('Set it with: export EXA_API_KEY=your_key_here');
    process.exit(1);
  }
  return EXA_API_KEY;
}

async function exaFetch(endpoint, body) {
  const key = getKey();
  const url = `${API_BASE}${endpoint}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Exa API error (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Web search
 */
async function cmdSearch(query, opts) {
  const body = {
    query,
    numResults: opts.numResults || 10,
    type: 'keyword',
    contents: {
      text: { maxCharacters: opts.maxChars || 3000 },
    },
  };

  const data = await exaFetch('/search', body);
  const results = data.results || [];

  if (opts.format === 'json') {
    return JSON.stringify({ query, results }, null, 2);
  }

  const lines = [];
  lines.push(`Search results for: "${query}"`);
  lines.push('='.repeat(60));
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title || 'Untitled'}`);
    lines.push(`   URL: ${r.url}`);
    if (r.author) lines.push(`   Author: ${r.author}`);
    if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
    if (r.text) {
      const snippet = r.text.replace(/\s+/g, ' ').trim().substring(0, 250);
      lines.push(`   ${snippet}${snippet.length >= 250 ? '...' : ''}`);
    }
    lines.push('');
  }
  lines.push(`Total: ${results.length} result(s)`);
  return lines.join('\n');
}

/**
 * Crawl / read URLs
 */
async function cmdCrawl(urls, opts) {
  if (!urls || urls.length === 0) {
    return 'Error: At least one URL is required.\nUsage: node exa-search.mjs crawl <url> [url...]';
  }

  const body = {
    urls: urls.map(u => ({ url: u, text: { maxCharacters: opts.maxChars || 3000 } })),
  };

  const data = await exaFetch('/contents', body);
  const results = data.results || [];

  if (opts.format === 'json') {
    return JSON.stringify({ urls, results }, null, 2);
  }

  const lines = [];
  for (const r of results) {
    lines.push(`URL: ${r.url}`);
    lines.push('-'.repeat(60));
    if (r.text) {
      lines.push(r.text);
    } else {
      lines.push('(No content retrieved)');
    }
    lines.push('');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Code search
 */
async function cmdCode(query, opts) {
  const body = {
    query,
    numResults: opts.numResults || 8,
    type: 'keyword',
    category: 'code',
    contents: {
      text: { maxCharacters: opts.maxChars || 3000 },
    },
  };

  const data = await exaFetch('/search', body);
  const results = data.results || [];

  if (opts.format === 'json') {
    return JSON.stringify({ query, results }, null, 2);
  }

  const lines = [];
  lines.push(`Code search results for: "${query}"`);
  lines.push('='.repeat(60));
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title || 'Untitled'}`);
    lines.push(`   URL: ${r.url}`);
    if (r.text) {
      const snippet = r.text.replace(/\s+/g, ' ').trim().substring(0, 300);
      lines.push(`   ${snippet}${snippet.length >= 300 ? '...' : ''}`);
    }
    lines.push('');
  }
  lines.push(`Total: ${results.length} result(s)`);
  return lines.join('\n');
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

  const command = args[0];
  const cmdArgs = [];
  const opts = {
    numResults: 10,
    maxChars: 3000,
    format: 'text',
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--num-results':
      case '--num':
        opts.numResults = parseInt(args[++i], 10) || 10;
        break;
      case '--max-chars':
      case '--chars':
        opts.maxChars = parseInt(args[++i], 10) || 3000;
        break;
      case '--format':
        opts.format = args[++i];
        break;
      case '--no-color':
        // no-op, kept for interface parity
        break;
      default:
        if (!args[i].startsWith('--')) {
          cmdArgs.push(args[i]);
        }
        break;
    }
    i++;
  }

  return { command, args: cmdArgs, opts };
}

function printHelp() {
  console.log(`
Usage: node exa-search.mjs <command> [options]

Exa Web Search & Crawl Tool

Commands:
  search <query>        Web search
  crawl <url> [url...]  Read webpage content
  code <query>          Code/documentation search

Options:
  --num-results <n>     Number of results (default: 10)
  --max-chars <n>       Max characters per result (default: 3000)
  --format <fmt>        Output: text, json (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node exa-search.mjs search "React Server Components"
  node exa-search.mjs crawl https://example.com/docs
  node exa-search.mjs code "Python fastapi middleware"
  node exa-search.mjs search "latest AI news" --num-results 5
`);
}

async function main() {
  const { command, args: cmdArgs, opts } = parseArgs();

  try {
    let output;
    switch (command) {
      case 'search':
        if (cmdArgs.length === 0) {
          console.error('Error: search requires a query.');
          process.exit(1);
        }
        output = await cmdSearch(cmdArgs.join(' '), opts);
        break;
      case 'crawl':
        output = await cmdCrawl(cmdArgs, opts);
        break;
      case 'code':
        if (cmdArgs.length === 0) {
          console.error('Error: code search requires a query.');
          process.exit(1);
        }
        output = await cmdCode(cmdArgs.join(' '), opts);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
