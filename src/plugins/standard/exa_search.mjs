export default {
  name: 'smart_exa_search',
  category: 'search',
  description: 'Use when: need to search the web for current information, read webpage content as clean markdown, or find code/docs examples. Supports batch URL crawling. Use for researching APIs, debugging with docs, finding recent articles.',
  inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['search', 'crawl', 'code'], description: 'search/crawl/code' }, query: { type: 'string', description: 'Search query (req for search/code)' }, urls: { type: 'string', description: 'URLs to crawl, comma-separated' }, numResults: { type: 'number', description: 'Num results (default: 10)' }, maxChars: { type: 'number', description: 'Max chars/result (default: 3000)' }, format: { type: 'string', enum: ['text', 'json'], description: 'Output format' } }, required: ['command'] },
  cli: 'exa-search.mjs',
  mapArgs(a) { const cli = []; if (a.command) cli.push(String(a.command)); if (a.command === 'crawl') { if (a.urls) { const urls = String(a.urls).split(',').map(u => u.trim()).filter(Boolean); cli.push(...urls); } } else if (a.query) cli.push(String(a.query)); if (a.numResults) cli.push('--num-results', String(a.numResults)); if (a.maxChars) cli.push('--max-chars', String(a.maxChars)); if (a.format) cli.push('--format', String(a.format)); cli.push('--no-color'); return cli; },
};
