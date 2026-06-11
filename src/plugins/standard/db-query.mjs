// db-query.mjs — Database Query Plugin (Phase 17)
//
// smart_db_introspect + smart_db_query MCP tools.
// Read-only SQL access to SQLite and PostgreSQL databases.

import { introspectSQLite, querySQLite, introspectPostgres, queryPostgres } from '../../lib/db-query.mjs';

export default {
  name: 'smart_db',
  category: 'standard',
  description: `Database query tools — read-only SQL access.
Operations: introspect (schema), query (SELECT only).
Supports SQLite (built-in) and PostgreSQL (optional pg npm).
Safety: read-only, timeout 10s, row limit 1000, DDL/DML blocked.
Use when: need to explore database schema, verify data, or answer data questions.`,
  responsePolicy: { maxLevel: 1 },

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['introspect', 'query'],
        description: 'introspect = show schema, query = run SELECT',
      },
      connection: {
        type: 'string',
        description: 'SQLite: path to .db file. PostgreSQL: postgresql://user:pass@host/db',
      },
      sql: {
        type: 'string',
        description: 'SQL query (SELECT only, required for query operation)',
      },
      engine: {
        type: 'string',
        enum: ['sqlite', 'postgresql'],
        description: 'Database engine (auto-detected if not specified)',
      },
      limit: {
        type: 'number',
        description: 'Max rows (default: 1000)',
      },
      timeout: {
        type: 'number',
        description: 'Query timeout in ms (default: 10000)',
      },
    },
    required: ['operation', 'connection'],
  },

  handler: async (args) => {
    const { operation, connection, sql, engine, limit, timeout } = args;

    // Auto-detect engine
    const detectedEngine = engine || (
      connection.startsWith('postgresql://') || connection.startsWith('postgres://')
        ? 'postgresql' : 'sqlite'
    );

    try {
      switch (operation) {
        case 'introspect': {
          if (detectedEngine === 'postgresql') {
            const result = await introspectPostgres(connection);
            return JSON.stringify(result, null, 2);
          }
          const result = introspectSQLite(connection);
          return JSON.stringify(result, null, 2);
        }

        case 'query': {
          if (!sql) {
            return JSON.stringify({ ok: false, error: 'sql parameter required for query operation' });
          }

          if (detectedEngine === 'postgresql') {
            const result = await queryPostgres(connection, sql, { limit, timeout });
            return JSON.stringify(result, null, 2);
          }
          const result = querySQLite(connection, sql, { limit, timeout });
          return JSON.stringify(result, null, 2);
        }

        default:
          return JSON.stringify({ ok: false, error: `Unknown operation: ${operation}` });
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  },
};
