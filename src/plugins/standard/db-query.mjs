// db-query.mjs — Database Query Plugin (Phase 17)
//
// smart_db_introspect + smart_db_query MCP tools.
// Read-only SQL access to SQLite and PostgreSQL databases.

import {
  introspectSQLite, querySQLite,
  introspectPostgres, queryPostgres,
  writeSQLite, updateSQLite, deleteSQLite, dryRunSQLite,
  migrateUpSQLite, migrateDownSQLite, migrateStatusSQLite, createMigrationSQLite,
  getFullSchemaSQLite, diffSchema,
} from '../../lib/db-query.mjs';

export default {
  name: 'smart_db',
  category: 'standard',
  description: `Database tools — read, write, migrate, and diff.
Operations:
  introspect — show schema (tables, columns, types)
  query     — run SELECT (read-only)
  write     — INSERT a row (use data object, not raw SQL)
  update    — UPDATE rows (use data + where objects)
  delete    — DELETE rows (requires --confirm; use {} to delete all)
  migrate   — manage schema migrations (create/up/down/status)
  schema-diff — compare schemas between two databases
Supports SQLite (built-in) and PostgreSQL (read-only ops only).
Write/migrate/diff operations: SQLite only (Phase 1).
Safety: parameterized queries (SQL injection safe), --dry-run, --confirm for destructive ops.`,
  responsePolicy: { maxLevel: 1 },

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['introspect', 'query', 'write', 'update', 'delete', 'migrate', 'schema-diff'],
        description: 'Operation to perform',
      },
      connection: {
        type: 'string',
        description: 'SQLite: path to .db file. PostgreSQL: postgresql://user:pass@host/db',
      },
      table: {
        type: 'string',
        description: 'Table name (required for write/update/delete)',
      },
      data: {
        type: 'object',
        description: 'Column-value pairs (required for write, for update)',
      },
      where: {
        type: 'object',
        description: 'WHERE conditions as object, e.g. {id: 42} (required for update, for delete)',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true for destructive operations (delete, migrate down)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without committing',
      },
      // Migration sub-commands
      command: {
        type: 'string',
        enum: ['create', 'up', 'down', 'status'],
        description: 'Migration sub-command (used with operation:"migrate")',
      },
      name: {
        type: 'string',
        description: 'Migration name (used with migrate:create)',
      },
      steps: {
        type: 'number',
        description: 'Steps to roll back (used with migrate:down, default: 1)',
      },
      migrationsDir: {
        type: 'string',
        description: 'Migrations directory (default: "migrations")',
      },
      // Schema diff
      connection2: {
        type: 'string',
        description: 'Second database path (used with schema-diff)',
      },
      // Legacy params
      sql: {
        type: 'string',
        description: 'SQL query (SELECT only, for query operation)',
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
    const {
      operation, connection, sql, engine, limit, timeout,
      table, data, where, confirm, dryRun,
      command, name, steps, migrationsDir, connection2,
    } = args;

    // Auto-detect engine
    const detectedEngine = engine || (
      connection.startsWith('postgresql://') || connection.startsWith('postgres://')
        ? 'postgresql' : 'sqlite'
    );

    try {
      switch (operation) {

        // ── Read-only operations (SQLite + PostgreSQL) ──
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

        // ── Write operations (SQLite only) ──
        case 'write': {
          if (detectedEngine !== 'sqlite') {
            return JSON.stringify({ ok: false, error: 'Write operations only supported for SQLite' });
          }
          if (!table) return JSON.stringify({ ok: false, error: 'table parameter required' });
          if (!data) return JSON.stringify({ ok: false, error: 'data parameter required (column-value pairs)' });

          if (dryRun) {
            const result = dryRunSQLite('insert', connection, table, data, where);
            return JSON.stringify(result, null, 2);
          }

          const result = writeSQLite(connection, table, data);
          return JSON.stringify(result, null, 2);
        }

        case 'update': {
          if (detectedEngine !== 'sqlite') {
            return JSON.stringify({ ok: false, error: 'Update operations only supported for SQLite' });
          }
          if (!table) return JSON.stringify({ ok: false, error: 'table parameter required' });
          if (!data) return JSON.stringify({ ok: false, error: 'data parameter required (column-value pairs to set)' });
          if (!where) return JSON.stringify({ ok: false, error: 'where parameter required (e.g. {id: 42})' });

          if (dryRun) {
            const result = dryRunSQLite('update', connection, table, data, where);
            return JSON.stringify(result, null, 2);
          }

          const result = updateSQLite(connection, table, data, where);
          return JSON.stringify(result, null, 2);
        }

        case 'delete': {
          if (detectedEngine !== 'sqlite') {
            return JSON.stringify({ ok: false, error: 'Delete operations only supported for SQLite' });
          }
          if (!table) return JSON.stringify({ ok: false, error: 'table parameter required' });
          if (where === undefined || where === null) {
            return JSON.stringify({ ok: false, error: 'where parameter required. Use {} to delete all rows.' });
          }

          // Safety: require confirm for DELETE
          if (!confirm) {
            const dryResult = dryRunSQLite('delete', connection, table, where);
            return JSON.stringify({
              ok: false,
              error: 'DELETE requires confirm:true. Use dryRun:true to preview.',
              dryRun: dryResult.ok ? dryResult : undefined,
            });
          }

          if (dryRun) {
            const result = dryRunSQLite('delete', connection, table, where);
            return JSON.stringify(result, null, 2);
          }

          const result = deleteSQLite(connection, table, where);
          return JSON.stringify(result, null, 2);
        }

        // ── Migration operations (SQLite only) ──
        case 'migrate': {
          if (detectedEngine !== 'sqlite') {
            return JSON.stringify({ ok: false, error: 'Migration only supported for SQLite' });
          }

          const migDir = migrationsDir || 'migrations';

          switch (command) {
            case 'create': {
              if (!name) return JSON.stringify({ ok: false, error: 'name parameter required for migrate:create' });
              const result = createMigrationSQLite(connection, name, migDir);
              return JSON.stringify(result, null, 2);
            }

            case 'up': {
              const result = migrateUpSQLite(connection, migDir);
              return JSON.stringify(result, null, 2);
            }

            case 'down': {
              if (!confirm) {
                return JSON.stringify({
                  ok: false,
                  error: 'migrate:down requires confirm:true. This will rollback the last migration.',
                });
              }
              const result = migrateDownSQLite(connection, steps || 1, migDir);
              return JSON.stringify(result, null, 2);
            }

            case 'status': {
              const result = migrateStatusSQLite(connection, migDir);
              return JSON.stringify(result, null, 2);
            }

            default:
              return JSON.stringify({
                ok: false,
                error: 'Migration sub-command required. Use command:"create|up|down|status"',
              });
          }
        }

        // ── Schema diff (SQLite only) ──
        case 'schema-diff': {
          if (detectedEngine !== 'sqlite') {
            return JSON.stringify({ ok: false, error: 'Schema diff only supported for SQLite' });
          }
          if (!connection2) {
            return JSON.stringify({ ok: false, error: 'connection2 parameter required (second database path)' });
          }

          const schemaA = getFullSchemaSQLite(connection);
          if (!schemaA.ok) return JSON.stringify(schemaA, null, 2);

          const schemaB = getFullSchemaSQLite(connection2);
          if (!schemaB.ok) return JSON.stringify(schemaB, null, 2);

          const result = diffSchema(schemaA.schema, schemaB.schema);
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
