export default {
  name: 'smart_exa_crawl',
  category: 'search',
  responsePolicy: { maxLevel: 1 }, // L1 lossless compression (whitespace/formatting)
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
        enum: ['none', 'caveman', 'auto'],
        description: 'Compress output to save tokens. "caveman" strips grammar, keeps facts (15-30% token savings). "auto" enables auto-upgrade compression level + auto-increase maxChars. Default: none.',
      },
      compressLevel: {
        type: 'string',
        enum: ['light', 'semantic', 'aggressive', 'ultra'],
        description: 'Caveman compression level. light=stop-words only, semantic=content selection, aggressive=full lemmatization, ultra=abbreviations+arrows (50-70% savings). Default: semantic.',
      },
      // ---- Curl-like advanced options ----
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Custom HTTP headers as key-value pairs. E.g. {"Authorization": "Bearer xxx", "X-Token": "yyy"}. Merged with defaults.',
      },
      cookie: {
        type: 'string',
        description: 'Cookie string (curl -b). E.g. "session=abc123; token=xyz". Sent in Cookie header.',
      },
      referer: {
        type: 'string',
        description: 'Referer header (curl -e). Bypasses hotlink protection. E.g. "https://example.com/source-page".',
      },
      userAgent: {
        type: 'string',
        description: 'Custom User-Agent string (curl -A). Overrides default Smart-MCP UA.',
      },
      retry: {
        type: 'number',
        description: 'Max retry attempts on 429/502/503/504 (curl --retry). Default: 0 (no retry).',
      },
      retryDelay: {
        type: 'number',
        description: 'Delay between retries in ms (curl --retry-delay). Default: 1000. Uses exponential backoff.',
      },
      timeout: {
        type: 'number',
        description: 'Transfer timeout in ms (curl --max-time). Default: 15000.',
      },
      connectTimeout: {
        type: 'number',
        description: 'Connection timeout in ms (curl --connect-timeout). Default: 5000.',
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow HTTP redirects (curl -L). Default: true.',
      },
      maxRedirects: {
        type: 'number',
        description: 'Max redirect hops (curl --max-redirs). Default: 10. Set 0 to disable.',
      },
      proxy: {
        type: 'string',
        description: 'HTTP/HTTPS/SOCKS5 proxy URL (curl -x). E.g. "http://proxy:8080" or "socks5://proxy:1080".',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'PATCH'],
        description: 'HTTP method (curl -X). Default: GET.',
      },
      body: {
        type: 'string',
        description: 'Request body for POST/PUT/PATCH (curl -d). Sent as-is with Content-Type: application/json.',
      },
      auth: {
        type: 'string',
        description: 'Basic auth "user:pass" (curl -u). Encoded to Base64 Authorization header.',
      },
      resolve: {
        type: 'string',
        description: 'DNS override "domain:port:ip" (curl --resolve). E.g. "example.com:443:1.2.3.4".',
      },
      headersOnly: {
        type: 'boolean',
        description: 'Only fetch response headers, skip body (curl -I). Useful for checking status/content-type.',
      },
      insecure: {
        type: 'boolean',
        description: 'Skip TLS certificate verification (curl -k). Use only for testing.',
      },
      // ---- Advanced search options (for search-then-crawl workflow) ----
      searchType: {
        type: 'string',
        enum: ['auto', 'fast', 'instant'],
        description: 'Search type when used with search-then-crawl.',
      },
      category: {
        type: 'string',
        enum: ['company', 'people', 'research paper', 'news', 'personal site', 'financial report', 'pdf', 'github'],
        description: 'Filter by category.',
      },
      highlights: {
        type: 'boolean',
        description: 'Enable highlights extraction.',
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
    if (a.searchType) cli.push('--search-type', String(a.searchType));
    if (a.category) cli.push('--category', String(a.category));
    if (a.highlights) cli.push('--highlights');
    // Curl-like advanced options
    if (a.headers) {
      for (const [k, v] of Object.entries(a.headers)) {
        cli.push('--header', `${k}: ${v}`);
      }
    }
    if (a.cookie) cli.push('--cookie', String(a.cookie));
    if (a.referer) cli.push('--referer', String(a.referer));
    if (a.userAgent) cli.push('--user-agent', String(a.userAgent));
    if (a.retry != null) cli.push('--retry', String(a.retry));
    if (a.retryDelay != null) cli.push('--retry-delay', String(a.retryDelay));
    if (a.timeout != null) cli.push('--max-time', String(a.timeout));
    if (a.connectTimeout != null) cli.push('--connect-timeout', String(a.connectTimeout));
    if (a.followRedirects === false) cli.push('--no-follow');
    if (a.maxRedirects != null) cli.push('--max-redirs', String(a.maxRedirects));
    if (a.proxy) cli.push('--proxy', String(a.proxy));
    if (a.method) cli.push('--method', String(a.method));
    if (a.body) cli.push('--body', String(a.body));
    if (a.auth) cli.push('--auth', String(a.auth));
    if (a.resolve) cli.push('--resolve', String(a.resolve));
    if (a.headersOnly) cli.push('--headers-only');
    if (a.insecure) cli.push('--insecure');
    if (a.noCache) cli.push('--no-cache');
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
