export default {
  name: 'smart_exa_search',
  category: 'search',
  description: 'Search the web or code/documentation with natural language queries. Returns structured results with URLs and summaries.\n\n'
    + 'Use for:\n'
    + '  - Web search: finding recent articles, docs, news (command: "search")\n'
    + '  - Code search: finding code examples, API usage patterns (command: "code")\n\n'
    + 'Do NOT use for: crawling a specific URL (use smart_exa_crawl). Operating a browser (use smart_pw_browser).',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['search', 'code'],
        description: 'search: web search for information. code: find code examples and docs.',
      },
      query: {
        type: 'string',
        description: 'Search query (required for search/code)',
      },
      numResults: {
        type: 'number',
        description: 'Number of results (default: 10)',
      },
      maxChars: {
        type: 'number',
        description: 'Max chars per result (search/code default: 3000)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
      compress: {
        type: 'string',
        enum: ['none', 'caveman', 'auto'],
        description: 'Compress output to save tokens. "caveman" strips grammar, keeps facts (15-30% token savings). "auto" enables auto-upgrade compression level + auto-increase maxChars. Default: none.',
      },
      compressLevel: {
        type: 'string',
        enum: ['light', 'semantic', 'aggressive', 'ultra'],
        description: 'Caveman compression level. light=stop-words only, semantic=content selection, aggressive=full lemmatization, ultra=abbreviations+arrows (50-70% savings). Default: semantic.',
      },
      // ---- Advanced search options (MCP free tier supported) ----
      searchType: {
        type: 'string',
        enum: ['auto', 'fast', 'instant'],
        description: 'Search type. auto=high quality (recommended), fast=~450ms, instant=~100ms. Default: auto.',
      },
      category: {
        type: 'string',
        enum: ['company', 'people', 'research paper', 'news', 'personal site', 'financial report', 'pdf', 'github'],
        description: 'Filter results by category. company=50M+ company pages, people=1B+ profiles, research paper=100M+ papers, etc.',
      },
      highlights: {
        type: 'boolean',
        description: 'Enable highlights extraction — 10x token efficient excerpts. Recommended for search.',
      },
      includeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only include results from these domains (e.g. ["github.com", "arxiv.org"])',
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude results from these domains',
      },
      startDate: {
        type: 'string',
        description: 'Only results published after this date (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        description: 'Only results published before this date (YYYY-MM-DD)',
      },
    },
    required: ['command'],
  },
  cli: 'exa-search.mjs',
  mapArgs(a) {
    const cli = [];
    if (a.command) cli.push(String(a.command));
    if (a.query) cli.push(String(a.query));
    if (a.numResults) cli.push('--num-results', String(a.numResults));
    if (a.maxChars) cli.push('--max-chars', String(a.maxChars));
    if (a.format) cli.push('--format', String(a.format));
    // Advanced search options
    if (a.searchType) cli.push('--search-type', String(a.searchType));
    if (a.category) cli.push('--category', String(a.category));
    if (a.highlights) cli.push('--highlights');
    if (a.includeDomains) cli.push('--include-domains', JSON.stringify(a.includeDomains));
    if (a.excludeDomains) cli.push('--exclude-domains', JSON.stringify(a.excludeDomains));
    if (a.startDate) cli.push('--start-date', String(a.startDate));
    if (a.endDate) cli.push('--end-date', String(a.endDate));
    if (a.compress === 'caveman' || a.compress === 'auto') {
      cli.push('--caveman');
      if (a.compress === 'auto') {
        cli.push('auto');  // Pass 'auto' as positional arg
      } else if (a.compressLevel) {
        cli.push('--caveman-level', String(a.compressLevel));
      }
    }
    cli.push('--no-color');
    return cli;
  },
};
