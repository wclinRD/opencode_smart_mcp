export default {
  name: 'smart_exa_crawl',
  category: 'search',
  description: 'Crawl web pages and extract their content. Auto-detects static vs JS sites (no need to specify renderer).\n\n'
    + 'Use with options for better results:\n'
    + '  - clean: (recommended) For news, blogs, articles — removes nav/ads/footer, saves 40-60% tokens\n'
    + '  - markdown: For LLM-friendly output — converts to Markdown, preserves structure\n'
    + '  - chunk: For long articles with 5+ sections — splits by heading, saves LLM context\n'
    + '  - crawlee: (advanced) For complex sites — auto-detects static vs JS, retries on failure\n'
    + '  - render: For JS-heavy sites with no visible content — uses Playwright rendering\n\n'
    + 'Do NOT use for: searching the web (use smart_exa_search). Operating a browser (use smart_pw_browser).',
  inputSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'string',
        description: 'URLs to crawl, comma-separated (required)',
      },
      clean: {
        type: 'boolean',
        description: 'Article extraction: removes nav/ads/footer. Use for news, blogs, tutorials. (recommended)',
      },
      markdown: {
        type: 'boolean',
        description: 'Convert to Markdown. Use when the result feeds into an LLM. Saves ~60% tokens vs raw HTML.',
      },
      chunk: {
        type: 'boolean',
        description: 'Split long content by heading. Use when article has 5+ sections. Saves LLM context window.',
      },
      maxChunkSize: {
        type: 'number',
        description: 'Max chars per chunk when --chunk is used (default: 2000)',
      },
      crawlee: {
        type: 'boolean',
        description: 'Adaptive crawl: auto-detects static vs JS-heavy sites. Use for complex sites that might need JS rendering. Requires npm install crawlee.',
      },
      render: {
        type: 'boolean',
        description: 'Render JS-heavy pages with Playwright. Use when content is empty/missing without JS.',
      },
      extended: {
        type: 'boolean',
        description: 'Extended mode — up to 30,000 chars per result. Use for very long documents.',
      },
      maxChars: {
        type: 'number',
        description: 'Max chars per result (crawl default: 8000)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format (default: text)',
      },
      compress: {
        type: 'string',
        enum: ['none', 'caveman'],
        description: 'Compress output to save tokens. "caveman" strips grammar, keeps facts (15-30% token savings). Default: none.',
      },
      compressLevel: {
        type: 'string',
        enum: ['light', 'semantic', 'aggressive', 'ultra'],
        description: 'Caveman compression level. light=stop-words only, semantic=content selection, aggressive=full lemmatization, ultra=abbreviations+arrows (50-70% savings). Default: semantic.',
      },
    },
    required: ['urls'],
  },
  cli: 'exa-search.mjs',
  mapArgs(a) {
    const cli = ['crawl'];
    if (a.urls) {
      const urls = String(a.urls).split(',').map(u => u.trim()).filter(Boolean);
      cli.push(...urls);
    }
    if (a.clean) cli.push('--clean');
    if (a.markdown) cli.push('--markdown');
    if (a.chunk) cli.push('--chunk');
    if (a.maxChunkSize) cli.push('--max-chunk-size', String(a.maxChunkSize));
    if (a.crawlee) cli.push('--crawlee');
    if (a.render) cli.push('--render');
    if (a.extended) cli.push('--extended');
    if (a.maxChars) cli.push('--max-chars', String(a.maxChars));
    if (a.format) cli.push('--format', String(a.format));
    if (a.compress === 'caveman') {
      cli.push('--caveman');
      if (a.compressLevel) cli.push('--caveman-level', String(a.compressLevel));
    }
    cli.push('--no-color');
    return cli;
  },
};
