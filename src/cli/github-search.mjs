#!/usr/bin/env node

// github-search.mjs — GitHub Code Search CLI
//
// Searches public GitHub repositories for code using the GitHub REST API.
// Supports authentication via GITHUB_TOKEN env var for higher rate limits.
//
// Usage:
//   node github-search.mjs <query> [options]
//
// Options:
//   --repo <name>         Filter by repository (e.g., "facebook/react")
//   --path <path>         Filter by file path (e.g., "src/")
//   --language <lang>     Filter by language (can specify multiple)
//   --match-case          Case-sensitive search
//   --match-words         Match whole words only
//   --max-results <n>     Maximum results (default: 10, max: 100)
//   --format <fmt>        Output: text, json (default: text)
//   --no-color            Disable color output
//   -h, --help            Show this help

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API_BASE = 'https://api.github.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build GitHub search query from parameters.
 */
function buildQuery(params) {
  const parts = [params.query];

  if (params.repo) {
    parts.push(`repo:${params.repo}`);
  }
  if (params.path) {
    parts.push(`path:${params.path}`);
  }
  if (params.language && params.language.length > 0) {
    for (const lang of params.language) {
      parts.push(`language:${lang}`);
    }
  }

  return parts.join(' ');
}

/**
 * Perform GitHub search API request.
 */
async function githubSearch(query, opts) {
  const url = `${API_BASE}/search/code?q=${encodeURIComponent(query)}&per_page=${Math.min(opts.maxResults || 10, 100)}`;

  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'opencode-smart',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const resp = await fetch(url, { headers });

  if (resp.status === 403) {
    const remaining = resp.headers.get('X-RateLimit-Remaining');
    const resetTime = resp.headers.get('X-RateLimit-Reset');
    const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toLocaleTimeString() : 'unknown';
    return {
      error: true,
      message: `Rate limited. ${remaining === '0' ? `Try again after ${resetDate}` : 'Try authenticating with GITHUB_TOKEN'}`,
      rateLimited: true,
    };
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API error (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return data;
}

// ---------------------------------------------------------------------------
// Fetch file content for context
// ---------------------------------------------------------------------------

async function fetchFileContent(url) {
  try {
    const headers = { Accept: 'application/vnd.github.v3.raw', 'User-Agent': 'opencode-smart' };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const resp = await fetch(url, { headers });
    if (resp.ok) {
      const text = await resp.text();
      const lines = text.split('\n');
      // Return first 20 lines as context
      return lines.slice(0, 20).join('\n');
    }
  } catch { /* silent */ }
  return null;
}

// ---------------------------------------------------------------------------
// Format results
// ---------------------------------------------------------------------------

function formatResults(data, opts) {
  if (data.error) {
    return `⚠ Rate limited: ${data.message}`;
  }

  const items = data.items || [];

  if (opts.format === 'json') {
    const output = {
      totalCount: data.total_count,
      results: items.map(item => ({
        repo: item.repository ? item.repository.full_name : 'unknown',
        file: item.path,
        url: item.html_url,
        language: item.repository ? item.repository.language : null,
      })),
    };
    return JSON.stringify(output, null, 2);
  }

  const lines = [];
  lines.push(`GitHub Code Search Results (${data.total_count} total matches)`);
  lines.push('='.repeat(60));
  lines.push('');

  if (items.length === 0) {
    lines.push('No results found.');
    return lines.join('\n');
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const repo = item.repository ? item.repository.full_name : 'unknown';
    const fileUrl = item.html_url;
    const lang = item.repository ? item.repository.language || 'Unknown' : 'Unknown';

    lines.push(`${i + 1}. ${item.path}`);
    lines.push(`   Repo: ${repo}  [${lang}]`);
    lines.push(`   URL:  ${fileUrl}`);

    // Show text matches if available
    if (item.text_matches && item.text_matches.length > 0) {
      for (const match of item.text_matches.slice(0, 3)) {
        if (match.fragment) {
          const fragment = match.fragment.replace(/\s+/g, ' ').trim().substring(0, 200);
          lines.push(`   > ${fragment}`);
        }
      }
    }

    lines.push('');
  }

  lines.push(`Showing ${items.length} of ${data.total_count} result(s)`);

  if (!GITHUB_TOKEN) {
    lines.push('');
    lines.push('ℹ Set GITHUB_TOKEN for higher rate limits and private repo access.');
  }

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

  const params = {
    query: '',
    repo: '',
    path: '',
    language: [],
    matchCase: false,
    matchWords: false,
    maxResults: 10,
    format: 'text',
  };

  let i = 0;
  const queryParts = [];

  while (i < args.length) {
    switch (args[i]) {
      case '--repo':
        params.repo = args[++i] || '';
        break;
      case '--path':
        params.path = args[++i] || '';
        break;
      case '--language':
      case '--lang':
        params.language.push(args[++i] || '');
        break;
      case '--match-case':
        params.matchCase = true;
        break;
      case '--match-words':
        params.matchWords = true;
        break;
      case '--max-results':
      case '--max':
        params.maxResults = parseInt(args[++i], 10) || 10;
        break;
      case '--format':
        params.format = args[++i];
        break;
      case '--no-color':
        // no-op
        break;
      default:
        if (!args[i].startsWith('--')) {
          queryParts.push(args[i]);
        }
        break;
    }
    i++;
  }

  params.query = queryParts.join(' ');

  if (!params.query) {
    console.error('Error: Search query is required.');
    process.exit(1);
  }

  return params;
}

function printHelp() {
  console.log(`
Usage: node github-search.mjs <query> [options]

GitHub Code Search

Search public GitHub repositories for code, with filtering options.

Arguments:
  query                 Search query (code pattern to find)

Options:
  --repo <name>         Filter by repository (e.g., "facebook/react")
  --path <path>         Filter by file path (e.g., "src/components/")
  --language <lang>     Filter by language (repeatable: --language ts --language js)
  --match-case          Case-sensitive search
  --match-words         Match whole words only
  --max-results <n>     Maximum results (default: 10, max: 100)
  --format <fmt>        Output: text, json (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node github-search.mjs useState
  node github-search.mjs "Express.js middleware" --language ts
  node github-search.mjs "ErrorBoundary" --repo "facebook/react" --language tsx
  node github-search.mjs async function --language python --max 5
  node github-search.mjs "(?s)try {.*await" --repo vercel/ai --format json
`);
}

async function main() {
  const params = parseArgs();
  const query = buildQuery(params);

  try {
    const data = await githubSearch(query, params);
    const output = formatResults(data, params);
    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
