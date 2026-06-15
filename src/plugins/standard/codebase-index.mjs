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
      strategy: {
        type: 'string',
        enum: ['hash', 'git'],
        description: 'Update strategy: "hash" reads all files (default), "git" uses git diff --name-only (5-50x faster for large projects). Only used with command:"update"'
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
    const { command, root, symbol, kind, limit, include, exclude, strategy } = args;
    const projectRoot = root || process.cwd();

    try {
      const index = getCodebaseIndex();

      switch (command) {
        case 'build': {
          const result = index.buildIndex(projectRoot, { include, exclude });
          return {
            ok: true,
            output: JSON.stringify({
              ok: true,
              command: 'build',
              ...result,
              message: `Indexed ${result.files} files with ${result.symbols} symbols in ${result.elapsedMs}ms`
            }, null, 2)
          };
        }

        case 'update': {
          const opts = { include, exclude };
          if (strategy) opts.strategy = strategy;
          const result = index.updateIndex(projectRoot, opts);
          return {
            ok: true,
            output: JSON.stringify({
              ok: true,
              command: 'update',
              strategy: result.strategy || (strategy || 'hash'),
              ...result,
              message: `Updated (${result.strategy || 'hash'}): ${result.added} added, ${result.updated} changed, ${result.removed} removed`
            }, null, 2)
          };
        }

        case 'query': {
          if (!symbol) {
            return { ok: false, error: 'symbol parameter is required for query command' };
          }
          const results = index.querySymbol(symbol, { limit: limit || 20, kind: kind || null });
          return {
            ok: true,
            output: JSON.stringify({
              ok: true,
              command: 'query',
              query: symbol,
              count: results.length,
              results
            }, null, 2)
          };
        }

        case 'map': {
          const map = index.generateRepoMap({ maxSymbols: limit || 200 });
          return { ok: true, output: map };
        }

        case 'stats': {
          const stats = index.getStats();
          return {
            ok: true,
            output: JSON.stringify({
              ok: true,
              command: 'stats',
              ...stats
            }, null, 2)
          };
        }

        default:
          return { ok: false, error: `Unknown command: ${command}` };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};
