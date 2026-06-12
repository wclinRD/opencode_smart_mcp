// codebase-index.mjs — smart_codebase_index MCP tool
//
// Persistent codebase symbol index with build/update/query/map commands.
// Phase 19: Codebase Index

import { getCodebaseIndex } from '../../lib/codebase-index.mjs';

export default {
  name: 'smart_codebase_index',
  description: 'Persistent codebase symbol index — build, update, query symbols, or generate a repo map.',
  category: 'standard',
  domain: 'analyze',
  safetyLevel: 'low',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 1 },

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['build', 'update', 'query', 'map', 'stats'],
        description: 'Command: build (full scan), update (incremental), query (search symbols), map (repo map), stats (index statistics)'
      },
      root: {
        type: 'string',
        description: 'Project root directory (default: current working directory)'
      },
      symbol: {
        type: 'string',
        description: 'Symbol name to search for (for query command)'
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'method', 'variable', 'export', 'interface', 'type', 'enum', 'trait', 'struct', 'impl', 'module'],
        description: 'Filter by symbol kind (for query command)'
      },
      limit: {
        type: 'number',
        description: 'Max results for query (default: 20)'
      },
      include: {
        type: 'string',
        description: 'Glob pattern for files to include (default: **/*.{js,mjs,cjs,ts,tsx,jsx,py,pyi,rs})'
      },
      exclude: {
        type: 'string',
        description: 'Glob pattern for files to exclude (default: **/node_modules/**)'
      }
    },
    required: ['command']
  },

  handler: async (args, context) => {
    const { command, root, symbol, kind, limit, include, exclude } = args;
    const projectRoot = root || process.cwd();

    try {
      const index = getCodebaseIndex();

      switch (command) {
        case 'build': {
          const result = index.buildIndex(projectRoot, { include, exclude });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                command: 'build',
                ...result,
                message: `Indexed ${result.files} files with ${result.symbols} symbols in ${result.elapsedMs}ms`
              }, null, 2)
            }]
          };
        }

        case 'update': {
          const result = index.updateIndex(projectRoot, { include, exclude });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                command: 'update',
                ...result,
                message: `Updated: ${result.added} added, ${result.updated} changed, ${result.removed} removed`
              }, null, 2)
            }]
          };
        }

        case 'query': {
          if (!symbol) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'symbol parameter is required for query command' }) }],
              isError: true
            };
          }
          const results = index.querySymbol(symbol, { limit: limit || 20, kind: kind || null });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                command: 'query',
                query: symbol,
                count: results.length,
                results
              }, null, 2)
            }]
          };
        }

        case 'map': {
          const map = index.generateRepoMap({ maxSymbols: limit || 200 });
          return {
            content: [{
              type: 'text',
              text: map
            }]
          };
        }

        case 'stats': {
          const stats = index.getStats();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                command: 'stats',
                ...stats
              }, null, 2)
            }]
          };
        }

        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown command: ${command}` }) }],
            isError: true
          };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true
      };
    }
  }
};