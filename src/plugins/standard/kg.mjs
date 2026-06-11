// kg.mjs — Knowledge Graph Memory (Phase 16)
//
// Structured entity-relation memory on top of memory-db.mjs.
// Complements semantic memory (vector+BM25) with structured knowledge.
//
// Tools: smart_kg_create_entities, smart_kg_create_relations,
//   smart_kg_search_nodes, smart_kg_open_nodes, smart_kg_read_graph,
//   smart_kg_delete_entities, smart_kg_delete_observations, smart_kg_delete_relations

import { getMemoryDB } from '../../lib/memory-db.mjs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = process.env.SMART_MEMORY_PATH || resolve(homedir(), '.smart/memory/memory.db');

function getDB() {
  return getMemoryDB(DB_PATH);
}

export default {
  name: 'smart_kg',
  category: 'standard',
  description: `Knowledge Graph memory — structured entity-relation storage.
Operations: create_entities, create_relations, search_nodes, open_nodes, read_graph, delete_entities, delete_observations, delete_relations.
Use when: need to remember structured relationships (who works on what, which module depends on which, etc.).
Complements semantic memory (smart_memory_store) which is better for similarity search.`,
  responsePolicy: { maxLevel: 0 },

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create_entities', 'create_relations', 'search_nodes', 'open_nodes', 'read_graph', 'delete_entities', 'delete_observations', 'delete_relations', 'add_observations'],
        description: 'KG operation to perform',
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            observations: { type: 'array', items: { type: 'string' } },
          },
          required: ['name'],
        },
        description: 'Entities for create_entities',
      },
      relations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            relationType: { type: 'string' },
          },
          required: ['from', 'to', 'relationType'],
        },
        description: 'Relations for create_relations / delete_relations',
      },
      query: {
        type: 'string',
        description: 'Search query for search_nodes',
      },
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Entity names for open_nodes / delete_entities',
      },
      entityName: {
        type: 'string',
        description: 'Entity name for delete_observations / add_observations',
      },
      observations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Observations for delete_observations / add_observations',
      },
      limit: {
        type: 'number',
        description: 'Max results for search_nodes (default: 20)',
      },
    },
    required: ['operation'],
  },

  handler: async (args) => {
    const dbPath = args._dbPath || DB_PATH;
    const db = getMemoryDB(dbPath);
    const { operation } = args;

    try {
      switch (operation) {
        case 'create_entities': {
          if (!args.entities || !Array.isArray(args.entities)) {
            return JSON.stringify({ ok: false, error: 'entities array required' });
          }
          const result = db.createEntities(args.entities);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'create_relations': {
          if (!args.relations || !Array.isArray(args.relations)) {
            return JSON.stringify({ ok: false, error: 'relations array required' });
          }
          const result = db.createRelations(args.relations);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'search_nodes': {
          if (!args.query) {
            return JSON.stringify({ ok: false, error: 'query required' });
          }
          const nodes = db.searchNodes(args.query, args.limit || 20);
          return JSON.stringify({ ok: true, nodes, count: nodes.length });
        }

        case 'open_nodes': {
          if (!args.names || !Array.isArray(args.names)) {
            return JSON.stringify({ ok: false, error: 'names array required' });
          }
          const result = db.openNodes(args.names);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'read_graph': {
          const result = db.readGraph();
          return JSON.stringify({
            ok: true,
            ...result,
            entityCount: result.entities.length,
            relationCount: result.relations.length,
          });
        }

        case 'delete_entities': {
          if (!args.names || !Array.isArray(args.names)) {
            return JSON.stringify({ ok: false, error: 'names array required' });
          }
          const result = db.deleteEntities(args.names);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'delete_observations': {
          if (!args.entityName || !args.observations) {
            return JSON.stringify({ ok: false, error: 'entityName and observations required' });
          }
          const result = db.deleteObservations(args.entityName, args.observations);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'add_observations': {
          if (!args.entityName || !args.observations) {
            return JSON.stringify({ ok: false, error: 'entityName and observations required' });
          }
          const result = db.addObservations(args.entityName, args.observations);
          return JSON.stringify({ ok: true, ...result });
        }

        case 'delete_relations': {
          if (!args.relations || !Array.isArray(args.relations)) {
            return JSON.stringify({ ok: false, error: 'relations array required' });
          }
          const result = db.deleteRelations(args.relations);
          return JSON.stringify({ ok: true, ...result });
        }

        default:
          return JSON.stringify({ ok: false, error: `Unknown operation: ${operation}` });
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  },
};
