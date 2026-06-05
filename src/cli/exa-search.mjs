#!/usr/bin/env node

// exa-search.mjs — Exa Web Search & Crawl CLI
//
// Dual-mode: REST API (with EXA_API_KEY) or MCP free tier (no key required)
// - With key: calls https://api.exa.ai directly (full speed, no rate limit)
// - Without key: calls https://mcp.exa.ai/mcp via JSON-RPC (free tier, rate-limited)
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
const hasApiKey = !!EXA_API_KEY;

const API_BASE = 'https://api.exa.ai';
// Include ?tools= to enable non-default tools (get_code_context_exa, etc.)
const MCP_TOOLS_PARAM = 'web_search_exa,get_code_context_exa,web_fetch_exa';
const MCP_BASE = `https://mcp.exa.ai/mcp?tools=${MCP_TOOLS_PARAM}`;

// MCP tool mapping for free tier fallback
const MCP_TOOLS = {
  search: 'web_search_exa',
  crawl:  'web_fetch_exa',
  code:   'get_code_context_exa',
};

// ---------------------------------------------------------------------------
// Helpers — REST API mode
// ---------------------------------------------------------------------------

function getKey() {
  if (!EXA_API_KEY) {
    console.error('Error: EXA_API_KEY environment variable is not set.');
    console.error('Set it with: export EXA_API_KEY=your_key_here');
    console.error('Fallback: using free MCP tier (rate-limited).');
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
// Helpers — MCP free tier mode
// ---------------------------------------------------------------------------

/**
 * Parse SSE (Server-Sent Events) response and extract JSON-RPC messages
 * Exa MCP uses Streamable HTTP transport → returns SSE responses
 */
function parseSseResponse(text) {
  // SSE format: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n');
  const events = [];
  let currentEvent = null;
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData += line.slice(6);
    } else if (line === '' && currentData) {
      // End of event
      try {
        events.push(JSON.parse(currentData));
      } catch { /* skip malformed */ }
      currentData = '';
      currentEvent = null;
    }
  }
  // Handle trailing data
  if (currentData) {
    try { events.push(JSON.parse(currentData)); } catch { /* skip */ }
  }
  return events;
}

/**
 * Call Exa MCP server via JSON-RPC (free tier, no API key needed)
 * Handles both JSON and SSE (Streamable HTTP) responses.
 */
async function mcpToolCall(tool, args) {
  const resp = await fetch(MCP_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) {
      throw new Error('Exa free tier rate limit exceeded. Try again later or set EXA_API_KEY for higher limits.');
    }
    throw new Error(`Exa MCP error (${resp.status}): ${text}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const rawText = await resp.text();

  let data;
  if (contentType.includes('text/event-stream')) {
    // SSE response — parse events, find the result event
    const events = parseSseResponse(rawText);
    data = events.find(e => e.id === '1') || events[0] || {};
  } else {
    // JSON response
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Exa MCP error: unexpected response format.\n${rawText.slice(0, 500)}`);
    }
  }

  if (data.error) {
    throw new Error(`Exa MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  // Extract text content from MCP response
  const result = data.result || {};
  const text = (result.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
  return text;
}

/**
 * Unified dispatch for MCP free tier mode
 * Maps CLI commands → MCP tool calls
 */
async function callMcp(command, cmdArgs, opts) {
  const tool = MCP_TOOLS[command];
  if (!tool) throw new Error(`Unknown command: ${command}`);

  let mcpArgs = {};

  switch (command) {
    case 'search':
    case 'code': {
      if (cmdArgs.length === 0) throw new Error(`${command} requires a query`);
      const query = cmdArgs.join(' ');
      mcpArgs = {
        query,
        numResults: opts.numResults || (command === 'code' ? 8 : 10),
      };
      break;
    }
    case 'crawl': {
      if (cmdArgs.length === 0) throw new Error('crawl requires at least one URL');
      const urls = cmdArgs.filter(u => u && !u.startsWith('--'));
      if (urls.length === 0) throw new Error('crawl requires at least one URL');
      // web_fetch_exa accepts array of URLs; pass as JSON string for safety
      mcpArgs = {
        urls,
        maxCharacters: opts.maxChars || 3000,
      };
      break;
    }
  }

  const text = await mcpToolCall(tool, mcpArgs);

  if (opts.format === 'json') {
    return JSON.stringify({ mode: 'free', tool, args: mcpArgs, results: text }, null, 2);
  }
  return text;
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
  const mode = hasApiKey ? 'REST API (full speed)' : 'MCP free tier (rate-limited)';
  console.log(`
Usage: node exa-search.mjs <command> [options]

Exa Web Search & Crawl Tool
Mode: ${mode}
${!hasApiKey ? 'Set EXA_API_KEY for full speed, no rate limits.' : ''}

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

    if (hasApiKey) {
      // REST API mode (requires EXA_API_KEY)
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
    } else {
      // Free tier MCP mode (no key needed, IP rate-limited)
      output = await callMcp(command, cmdArgs, opts);
    }

    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
