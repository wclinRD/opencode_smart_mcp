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
    cli.push('--no-color');
    return cli;
  },
};
