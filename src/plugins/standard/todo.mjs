// todo.mjs → smart_todo
//
// Todo list management for Smart MCP.
// Items are persisted to ~/.smart/todos.json.
// The server's formatRecoveryContext() reads contextManager.todoItems
// to inject pending todo info after compaction.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = resolve(homedir(), '.smart');
const DATA_FILE = resolve(DATA_DIR, 'todos.json');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadTodos() {
  try {
    if (!existsSync(DATA_FILE)) return [];
    const raw = readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

function saveTodos(todos) {
  try {
    ensureDir(DATA_DIR);
    writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[todo] Save failed: ${err.message}`);
  }
}

function formatList(todos) {
  if (todos.length === 0) return '📋 No todos. Use `smart_todo({command:"add", items:["task"]})` to create one.';
  const lines = ['📋 Todo List:'];
  for (const t of todos) {
    const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '⏳' : t.status === 'cancelled' ? '❌' : '☐';
    lines.push(`  ${icon} #${t.id} ${t.text}`);
  }
  return lines.join('\n');
}

export default {
  name: 'smart_todo',
  category: 'standard',
  responsePolicy: { maxLevel: 1 },
  description: 'Manage todo items. Commands: add (one or more items), done (mark completed), list (show all), update (set status). Todos persist across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['add', 'done', 'list', 'update'],
        description: 'Command: add (add items), done (mark id completed), list (show all), update (set status)',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Items to add (required for command=add)',
      },
      id: {
        type: 'number',
        description: 'Todo item id (required for done/update)',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status (required for command=update)',
      },
    },
    required: ['command'],
  },

  handler(args) {
    const { command, items, id, status } = args;
    let todos = loadTodos();
    let nextId = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;

    switch (command) {
      case 'add': {
        if (!items || !Array.isArray(items) || items.length === 0) {
          return 'Error: command=add requires items array (e.g. items:["task1","task2"])';
        }
        const added = [];
        for (const text of items) {
          if (!text || typeof text !== 'string') continue;
          const todo = {
            id: nextId++,
            text: text.slice(0, 200),
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          todos.push(todo);
          added.push(todo);
        }
        saveTodos(todos);
        return `✅ Added ${added.length} todo(s).\n` + formatList(todos);
      }

      case 'done': {
        if (id === undefined || id === null) {
          return 'Error: command=done requires id (e.g. id:1)';
        }
        const idx = todos.findIndex(t => t.id === id);
        if (idx === -1) return `Error: todo #${id} not found. Use "list" to see all items.`;
        todos[idx].status = 'completed';
        todos[idx].updatedAt = new Date().toISOString();
        saveTodos(todos);
        return `✅ Todo #${id} "${todos[idx].text}" marked done.\n` + formatList(todos);
      }

      case 'update': {
        if (id === undefined || id === null) {
          return 'Error: command=update requires id';
        }
        if (!status || !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
          return 'Error: command=update requires status (pending|in_progress|completed|cancelled)';
        }
        const uidx = todos.findIndex(t => t.id === id);
        if (uidx === -1) return `Error: todo #${id} not found.`;
        todos[uidx].status = status;
        todos[uidx].updatedAt = new Date().toISOString();
        saveTodos(todos);
        return `✅ Todo #${id} updated to "${status}".\n` + formatList(todos);
      }

      case 'list':
      default:
        return formatList(todos);
    }
  },
};
