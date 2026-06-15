// adr.mjs — smart_adr MCP tool
//
// Architecture Decision Records — record, search, and list project architecture decisions.
// Complements KG memory: KG stores entity-relation structure, ADR stores decision context.
//
// Phase 24: Architecture Decision Records

import { getMemoryDB } from '../../lib/memory-db.mjs';
import { resolve } from 'node:path';
import os from 'node:os';

const DEFAULT_DB_PATH = resolve(os.homedir(), '.smart', 'memory', 'memory.db');

export default {
  name: 'smart_adr',
  description: 'Record, search, and list Architecture Decision Records. Stores why decisions were made (not just what). Complements KG memory.',
  category: 'standard',
  domain: 'memory',
  safetyLevel: 'low',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 0 },

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['record', 'search', 'list', 'get', 'update', 'delete'],
        description: 'Command: record (create), search (find by keyword), list (all ADRs), get (by ID), update (change status), delete'
      },
      title: {
        type: 'string',
        description: 'ADR title (required for record)'
      },
      context: {
        type: 'string',
        description: 'Background and context for the decision'
      },
      decision: {
        type: 'string',
        description: 'The decision that was made (required for record)'
      },
      alternatives: {
        type: 'array',
        items: { type: 'string' },
        description: 'Alternatives that were considered'
      },
      consequences: {
        type: 'string',
        description: 'Consequences of the decision'
      },
      status: {
        type: 'string',
        enum: ['accepted', 'deprecated', 'superseded', 'proposed'],
        description: 'ADR status (default: accepted)'
      },
      query: {
        type: 'string',
        description: 'Search query (for search command)'
      },
      id: {
        type: 'number',
        description: 'ADR ID (for get/update/delete commands)'
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)'
      }
    },
    required: ['command']
  },

  handler: async (args, context) => {
    const { command, title, context: adrContext, decision, alternatives, consequences, status, query, id, limit } = args;

    try {
      const db = getMemoryDB(DEFAULT_DB_PATH);

      switch (command) {
        case 'record': {
          if (!title || !decision) {
            return errorResponse('title and decision are required for record command');
          }
          const result = db.recordADR({ title, context: adrContext, decision, alternatives, consequences, status });
          return okResponse('record', { id: result.id, title, message: `ADR #${result.id} recorded: "${title}"` });
        }

        case 'search': {
          if (!query) {
            return errorResponse('query is required for search command');
          }
          const results = db.searchADR(query, { limit: limit || 20 });
          return okResponse('search', { query, count: results.length, results });
        }

        case 'list': {
          const results = db.listADR({ limit: limit || 50, status: status || null });
          return okResponse('list', { count: results.length, results });
        }

        case 'get': {
          if (!id) return errorResponse('id is required for get command');
          const adr = db.getADR(id);
          if (!adr) return errorResponse(`ADR #${id} not found`);
          return okResponse('get', { result: adr });
        }

        case 'update': {
          if (!id) return errorResponse('id is required for update command');
          if (!status) return errorResponse('status is required for update command');
          db.updateADRStatus(id, status);
          return okResponse('update', { id, status, message: `ADR #${id} status updated to "${status}"` });
        }

        case 'delete': {
          if (!id) return errorResponse('id is required for delete command');
          db.deleteADR(id);
          return okResponse('delete', { id, message: `ADR #${id} deleted` });
        }

        default:
          return errorResponse(`Unknown command: ${command}`);
      }
    } catch (err) {
      return errorResponse(err.message);
    }
  }
};

function okResponse(command, data) {
  return { ok: true, output: JSON.stringify({ ok: true, command, ...data }, null, 2) };
}

function errorResponse(error) {
  return { ok: false, error };
}