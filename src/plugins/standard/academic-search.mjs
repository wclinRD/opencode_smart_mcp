// academic-search.mjs → smart_academic_search
// Phase 15.2: Academic literature search plugin integrating OpenAlex, Crossref,
// Semantic Scholar, and Unpaywall APIs. All free, no API key required.
// Integrated from Deep Research Agent (CYC2002tommy/deep-research-agent, MIT).
//
// Usage:
//   smart_academic_search({ query: "urban heat island", source: "openalex" })
//   smart_academic_search({ doi: "10.1038/ncomms14196", source: "crossref" })
//   smart_academic_search({ doi: "10.1038/...", source: "unpaywall" })
//   smart_academic_search({ query: "climate policy", source: "semantic_scholar" })

import https from 'node:https';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_AGENT = 'SmartMCP-AcademicSearch/1.0 (mailto:agent@smart-mcp.dev)';
const DEFAULT_TIMEOUT = 15000;

// MDPI exclusion patterns
const MDPI_PATTERNS = {
  hostOrg: /mdpi/i,
  doiPrefix: '10.3390',
};

// ── HTTP Helpers ─────────────────────────────────────────────────────────────

/**
 * Simple HTTPS GET with timeout.
 */
function httpsGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = DEFAULT_TIMEOUT, headers = {} } = opts;
    const req = https.get(url, { timeout, headers: { 'User-Agent': USER_AGENT, ...headers } }, (res) => {
      // Follow redirects (max 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        const redirectCount = (opts._redirectCount || 0) + 1;
        if (redirectCount > 3) {
          return reject(new Error('Too many redirects'));
        }
        return httpsGet(redirectUrl, { ...opts, _redirectCount: redirectCount })
          .then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ── MDPI Filter ──────────────────────────────────────────────────────────────

function isMDPI(work) {
  const hostOrg = (work.primary_location?.source?.host_organization_name || '').toLowerCase();
  const doi = work.doi || '';
  return MDPI_PATTERNS.hostOrg.test(hostOrg) || doi.includes(MDPI_PATTERNS.doiPrefix);
}

// ── OpenAlex ─────────────────────────────────────────────────────────────────

/**
 * Decode OpenAlex abstract_inverted_index into plain text.
 */
function decodeAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.filter(Boolean).join(' ');
}

/**
 * Search OpenAlex for academic papers.
 * Free, no API key. Rate limit: ~10 req/s (polite: 100-200ms delay).
 */
async function searchOpenAlex(args) {
  const { query, yearFrom, yearTo, perPage = 10, filterMDPI = true, email } = args;

  const params = new URLSearchParams();
  params.set('search', query);
  params.set('per-page', String(Math.min(perPage, 50)));

  // Build filter
  const filters = ['type:article', 'has_abstract:true'];
  if (yearFrom) filters.push(`publication_year:${yearFrom}-${yearTo || new Date().getFullYear()}`);
  params.set('filter', filters.join(','));

  const url = `https://api.openalex.org/works?${params.toString()}`;
  const headers = {};
  if (email) headers['From'] = email;

  const { body } = await httpsGet(url, { headers });
  const data = JSON.parse(body);
  let results = data.results || [];

  // Filter MDPI
  if (filterMDPI) {
    results = results.filter((w) => !isMDPI(w));
  }

  // Format results
  const papers = results.map((work) => ({
    title: work.title || 'Unknown Title',
    authors: (work.authorships || []).map((a) => a.author?.display_name).filter(Boolean).join(', ') || 'Unknown',
    year: work.publication_year || null,
    doi: work.doi || null,
    openalexId: work.id || null,
    journal: work.primary_location?.source?.display_name || 'Unknown',
    citedBy: work.cited_by_count || 0,
    isOA: work.open_access?.is_oa || false,
    abstract: decodeAbstract(work.abstract_inverted_index),
    type: work.type || 'article',
  }));

  return {
    source: 'openalex',
    total: data.meta?.count || results.length,
    returned: papers.length,
    query,
    papers,
  };
}

// ── Crossref ─────────────────────────────────────────────────────────────────

/**
 * Search Crossref for academic papers.
 * Free, no API key. Polite pool: ~50 req/s.
 */
async function searchCrossref(args) {
  const { query, rows = 10 } = args;

  const params = new URLSearchParams();
  params.set('query', query);
  params.set('rows', String(Math.min(rows, 50)));

  const url = `https://api.crossref.org/works?${params.toString()}`;
  const { body } = await httpsGet(url);
  const data = JSON.parse(body);
  const items = data.message?.items || [];

  const papers = items.map((item) => ({
    title: (item.title || ['Unknown'])[0],
    authors: (item.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).join(', ') || 'Unknown',
    year: item['created']?.date_parts?.[0]?.[0] || null,
    doi: item.DOI || null,
    journal: (item['container-title'] || ['Unknown'])[0],
    publisher: item.publisher || null,
    type: item.type || 'journal-article',
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
  }));

  return {
    source: 'crossref',
    total: data.message?.['total-results'] || papers.length,
    returned: papers.length,
    query,
    papers,
  };
}

/**
 * Resolve a single DOI via Crossref API.
 */
async function resolveDOI(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  try {
    const { body, statusCode } = await httpsGet(url);
    if (statusCode !== 200) {
      return { doi, status: 'not_found', statusCode };
    }
    const data = JSON.parse(body);
    const msg = data.message || {};
    return {
      doi,
      status: 'verified',
      title: (msg.title || ['Unknown'])[0],
      authors: (msg.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).join(', '),
      year: msg['created']?.date_parts?.[0]?.[0] || null,
      journal: (msg['container-title'] || ['Unknown'])[0],
      publisher: msg.publisher || null,
      url: `https://doi.org/${doi}`,
    };
  } catch (err) {
    return { doi, status: 'error', error: err.message };
  }
}

// ── Unpaywall ────────────────────────────────────────────────────────────────

/**
 * Check Unpaywall for Open Access versions of a paper.
 * Free, no API key. Requires email for polite pool.
 */
async function checkUnpaywall(args) {
  const { doi, email = 'agent@smart-mcp.dev' } = args;

  if (!doi) {
    return { error: 'DOI is required for Unpaywall lookup' };
  }

  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  try {
    const { body, statusCode } = await httpsGet(url);
    if (statusCode !== 200) {
      return { doi, isOA: false, status: `HTTP ${statusCode}` };
    }
    const data = JSON.parse(body);
    return {
      doi,
      isOA: data.is_oa || false,
      title: data.title || null,
      journal: data.journal_name || null,
      year: data.year || null,
      oaStatus: data.oa_status || 'closed',
      bestOALocation: data.best_oa_location ? {
        url: data.best_oa_location.url || null,
        urlForPdf: data.best_oa_location.url_for_pdf || null,
        hostType: data.best_oa_location.host_type || null,
        license: data.best_oa_location.license || null,
        version: data.best_oa_location.version || null,
      } : null,
      oaLocations: (data.oa_locations || []).map((loc) => ({
        url: loc.url || null,
        urlForPdf: loc.url_for_pdf || null,
        hostType: loc.host_type || null,
      })),
    };
  } catch (err) {
    return { doi, isOA: false, status: 'error', error: err.message };
  }
}

// ── Semantic Scholar ─────────────────────────────────────────────────────────

/**
 * Search Semantic Scholar for academic papers.
 * Free, no API key. Rate limit: ~100 req/5min (use with delay).
 */
async function searchSemanticScholar(args) {
  const { query, limit = 10, yearFrom, yearTo } = args;

  const params = new URLSearchParams();
  params.set('query', query);
  params.set('limit', String(Math.min(limit, 50)));
  params.set('fields', 'title,authors,year,externalIds,url,abstract,venue,citationCount,openAccessPdf');

  if (yearFrom || yearTo) {
    params.set('year', `${yearFrom || ''}-${yearTo || ''}`);
  }

  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;
  const { body } = await httpsGet(url);
  const data = JSON.parse(body);
  const items = data.data || [];

  const papers = items.map((item) => ({
    title: item.title || 'Unknown',
    authors: (item.authors || []).map((a) => a.name).join(', ') || 'Unknown',
    year: item.year || null,
    doi: item.externalIds?.DOI || null,
    semanticScholarId: item.paperId || null,
    journal: item.venue || 'Unknown',
    citedBy: item.citationCount || 0,
    url: item.url || null,
    abstract: item.abstract || null,
    openAccessPdf: item.openAccessPdf?.url || null,
  }));

  return {
    source: 'semantic_scholar',
    total: data.total || papers.length,
    returned: papers.length,
    query,
    papers,
  };
}

// ── Plugin Definition ────────────────────────────────────────────────────────

export default {
  name: 'smart_academic_search',
  category: 'standard',
  description: `Search academic literature across free databases: OpenAlex, Crossref, Semantic Scholar, and Unpaywall.

Sources:
  - openalex: Full-text search with abstracts, MDPI filtering, OA detection
  - crossref: Broad metadata search with DOI resolution
  - semantic_scholar: AI-powered search with citation counts and OA PDF links
  - unpaywall: Check if a specific DOI has an Open Access version available

Operations:
  - source:"openalex" → Search papers by keyword (supports year range, MDPI filter)
  - source:"crossref" → Search papers by keyword or resolve a single DOI
  - source:"semantic_scholar" → AI-powered paper search with citation data
  - source:"unpaywall" → Check OA availability for a specific DOI

Examples:
  { query: "urban heat island vegetation", source: "openalex", yearFrom: 2020 }
  { doi: "10.1038/ncomms14196", source: "crossref" }
  { doi: "10.1038/ncomms14196", source: "unpaywall", email: "user@example.com" }
  { query: "climate policy acceptance", source: "semantic_scholar", limit: 5 }`,

  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['openalex', 'crossref', 'semantic_scholar', 'unpaywall'],
        description: 'Academic database to query (required)',
      },
      query: {
        type: 'string',
        description: 'Search query string (required for openalex, crossref, semantic_scholar)',
      },
      doi: {
        type: 'string',
        description: 'DOI to resolve or check OA status (for crossref single lookup or unpaywall)',
      },
      email: {
        type: 'string',
        description: 'Email for Unpaywall polite pool (recommended)',
      },
      yearFrom: {
        type: 'number',
        description: 'Filter papers from this year (inclusive)',
      },
      yearTo: {
        type: 'number',
        description: 'Filter papers up to this year (inclusive)',
      },
      perPage: {
        type: 'number',
        description: 'Results per page (default: 10, max: 50)',
      },
      limit: {
        type: 'number',
        description: 'Alias for perPage (Semantic Scholar)',
      },
      rows: {
        type: 'number',
        description: 'Alias for perPage (Crossref)',
      },
      filterMDPI: {
        type: 'boolean',
        description: 'Filter out MDPI publications (default: true for OpenAlex)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'markdown'],
        description: 'Output format (default: markdown)',
      },
    },
    required: ['source'],
  },

  handler: async (args) => {
    const { source, format = 'markdown' } = args;

    try {
      let result;

      switch (source) {
        case 'openalex': {
          if (!args.query) return 'Error: query is required for OpenAlex search.';
          result = await searchOpenAlex({
            query: args.query,
            yearFrom: args.yearFrom,
            yearTo: args.yearTo,
            perPage: args.perPage || 10,
            filterMDPI: args.filterMDPI !== false,
            email: args.email,
          });
          break;
        }

        case 'crossref': {
          if (args.doi) {
            result = await resolveDOI(args.doi);
          } else if (args.query) {
            result = await searchCrossref({
              query: args.query,
              rows: args.rows || args.perPage || 10,
            });
          } else {
            return 'Error: query or doi is required for Crossref.';
          }
          break;
        }

        case 'semantic_scholar': {
          if (!args.query) return 'Error: query is required for Semantic Scholar search.';
          result = await searchSemanticScholar({
            query: args.query,
            limit: args.limit || args.perPage || 10,
            yearFrom: args.yearFrom,
            yearTo: args.yearTo,
          });
          break;
        }

        case 'unpaywall': {
          if (!args.doi) return 'Error: doi is required for Unpaywall lookup.';
          result = await checkUnpaywall({
            doi: args.doi,
            email: args.email,
          });
          break;
        }

        default:
          return `Error: unknown source "${source}". Use: openalex, crossref, semantic_scholar, unpaywall.`;
      }

      if (format === 'json') {
        return JSON.stringify(result, null, 2);
      }

      // Format as markdown
      let out = '';

      // Unpaywall single result
      if (source === 'unpaywall') {
        out += `## Unpaywall: ${result.doi}\n\n`;
        out += `| Field | Value |\n|-------|-------|\n`;
        out += `| Open Access | ${result.isOA ? '✅ Yes' : '❌ No'} |\n`;
        out += `| OA Status | ${result.oaStatus || 'N/A'} |\n`;
        if (result.title) out += `| Title | ${result.title} |\n`;
        if (result.journal) out += `| Journal | ${result.journal} |\n`;
        if (result.year) out += `| Year | ${result.year} |\n`;
        if (result.bestOALocation?.urlForPdf) {
          out += `| PDF | ${result.bestOALocation.urlForPdf} |\n`;
        } else if (result.bestOALocation?.url) {
          out += `| URL | ${result.bestOALocation.url} |\n`;
        }
        if (result.bestOALocation?.license) out += `| License | ${result.bestOALocation.license} |\n`;
        return out;
      }

      // Crossref single DOI
      if (source === 'crossref' && args.doi) {
        out += `## DOI Resolution: ${result.doi}\n\n`;
        out += `| Field | Value |\n|-------|-------|\n`;
        out += `| Status | ${result.status} |\n`;
        if (result.title) out += `| Title | ${result.title} |\n`;
        if (result.authors) out += `| Authors | ${result.authors} |\n`;
        if (result.year) out += `| Year | ${result.year} |\n`;
        if (result.journal) out += `| Journal | ${result.journal} |\n`;
        if (result.publisher) out += `| Publisher | ${result.publisher} |\n`;
        if (result.url) out += `| URL | ${result.url} |\n`;
        return out;
      }

      // Search results (openalex, crossref, semantic_scholar)
      out += `## ${source.toUpperCase()} Search Results\n\n`;
      out += `**Query**: "${result.query}" | **Found**: ${result.total} | **Returned**: ${result.returned}\n\n`;

      if (result.papers.length === 0) {
        out += '_No results found._\n';
        return out;
      }

      for (let i = 0; i < result.papers.length; i++) {
        const p = result.papers[i];
        out += `### ${i + 1}. ${p.title}\n\n`;
        out += `| Field | Value |\n|-------|-------|\n`;
        out += `| Authors | ${p.authors} |\n`;
        if (p.year) out += `| Year | ${p.year} |\n`;
        if (p.journal) out += `| Journal | ${p.journal} |\n`;
        if (p.doi) out += `| DOI | [${p.doi}](https://doi.org/${p.doi}) |\n`;
        if (p.citedBy) out += `| Cited By | ${p.citedBy} |\n`;
        if (p.isOA !== undefined) out += `| Open Access | ${p.isOA ? '✅' : '❌'} |\n`;
        if (p.publisher) out += `| Publisher | ${p.publisher} |\n`;
        if (p.url) out += `| URL | ${p.url} |\n`;
        if (p.openAccessPdf) out += `| OA PDF | ${p.openAccessPdf} |\n`;
        if (p.abstract) {
          const shortAbstract = p.abstract.length > 500
            ? p.abstract.substring(0, 500) + '...'
            : p.abstract;
          out += `\n**Abstract**: ${shortAbstract}\n`;
        }
        out += '\n';
      }

      return out;
    } catch (err) {
      return `Error searching ${source}: ${err.message}`;
    }
  },
};