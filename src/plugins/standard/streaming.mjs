// streaming.mjs — smart_progress MCP tool + progress utility
//
// Provides progress reporting for long-running tools.
// Tools can call reportProgress() to send incremental updates.
// Phase 21: Streaming Progress

// ---------------------------------------------------------------------------
// Progress state (in-memory, per-session)
// ---------------------------------------------------------------------------

const _progressStates = new Map();

/**
 * Start tracking progress for a task.
 * @param {string} taskId - Unique task identifier
 * @param {string} label - Human-readable label
 * @param {number} total - Total units of work
 */
export function startProgress(taskId, label, total = 100) {
  _progressStates.set(taskId, {
    taskId,
    label,
    total,
    current: 0,
    status: 'running',
    startedAt: new Date().toISOString(),
    messages: [],
    errors: []
  });
}

/**
 * Report progress for a task.
 * @param {string} taskId - Task identifier
 * @param {number} current - Current progress value
 * @param {string} [message] - Optional status message
 */
export function reportProgress(taskId, current, message) {
  const state = _progressStates.get(taskId);
  if (!state) return;

  state.current = Math.min(current, state.total);
  if (message) {
    state.messages.push({ time: new Date().toISOString(), message });
  }
}

/**
 * Report an error for a task (doesn't stop the task).
 */
export function reportProgressError(taskId, error) {
  const state = _progressStates.get(taskId);
  if (!state) return;

  state.errors.push({ time: new Date().toISOString(), error: String(error).slice(0, 500) });
}

/**
 * Complete a progress task.
 */
export function completeProgress(taskId, status = 'completed') {
  const state = _progressStates.get(taskId);
  if (!state) return;

  state.status = status;
  state.current = state.total;
  state.completedAt = new Date().toISOString();
}

/**
 * Get current progress state.
 */
export function getProgress(taskId) {
  return _progressStates.get(taskId) || null;
}

/**
 * Get all active progress states.
 */
export function getAllProgress() {
  return Array.from(_progressStates.values());
}

/**
 * Clear a progress task.
 */
export function clearProgress(taskId) {
  _progressStates.delete(taskId);
}

/**
 * Clear all completed tasks older than N minutes.
 */
export function cleanupProgress(olderThanMinutes = 30) {
  const cutoff = Date.now() - olderThanMinutes * 60000;
  for (const [id, state] of _progressStates) {
    if (state.status !== 'running' && new Date(state.completedAt || state.startedAt).getTime() <= cutoff) {
      _progressStates.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Progress wrapper for async operations
// ---------------------------------------------------------------------------

/**
 * Wrap an async operation with progress tracking.
 * Calls onProgress(current, total, message) periodically.
 *
 * @param {Function} fn - Async function that receives (report) callback
 * @param {Object} options - { taskId, label, total, onProgress }
 */
export async function withProgress(fn, { taskId, label, total = 100, onProgress } = {}) {
  const id = taskId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  startProgress(id, label || id, total);

  const report = (current, message) => {
    reportProgress(id, current, message);
    if (onProgress) {
      onProgress({ taskId: id, current, total, message, percentage: Math.round((current / total) * 100) });
    }
  };

  try {
    const result = await fn(report);
    completeProgress(id, 'completed');
    return result;
  } catch (err) {
    reportProgressError(id, err.message);
    completeProgress(id, 'failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MCP Plugin — smart_progress
// ---------------------------------------------------------------------------

export default {
  name: 'smart_progress',
  description: 'Check progress of long-running tasks. View active tasks, their completion percentage, and recent messages.',
  category: 'standard',
  domain: 'plan',
  safetyLevel: 'low',
  routingRules: { autoRoute: true, interceptorRequired: false, directCall: true },
  qualityGates: [],
  responsePolicy: { maxLevel: 0 },

  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['status', 'all', 'clear'],
        description: 'Command: status (check one task), all (list all tasks), clear (remove completed tasks)'
      },
      taskId: {
        type: 'string',
        description: 'Task ID to check (for status command)'
      }
    },
    required: ['command']
  },

  handler: async (args, context) => {
    const { command, taskId } = args;

    switch (command) {
      case 'status': {
        if (!taskId) {
          return { ok: false, error: 'taskId is required for status command' };
        }

        const state = getProgress(taskId);
        if (!state) {
          return { ok: true, output: JSON.stringify({ ok: true, command: 'status', taskId, found: false, message: 'No progress tracked for this task.' }) };
        }

        return { ok: true, output: JSON.stringify({
              ok: true,
              command: 'status',
              task: {
                ...state,
                percentage: state.total > 0 ? Math.round((state.current / state.total) * 100) : 0,
                recentMessages: state.messages.slice(-5)
              }
            }, null, 2) };
      }

      case 'all': {
        const all = getAllProgress();
        const tasks = all.map(s => ({
          taskId: s.taskId,
          label: s.label,
          status: s.status,
          percentage: s.total > 0 ? Math.round((s.current / s.total) * 100) : 0,
          current: s.current,
          total: s.total,
          errors: s.errors.length,
          startedAt: s.startedAt
        }));

        return { ok: true, output: JSON.stringify({
              ok: true,
              command: 'all',
              count: tasks.length,
              active: tasks.filter(t => t.status === 'running').length,
              tasks
            }, null, 2) };
      }

      case 'clear': {
        cleanupProgress(0); // Clear all completed immediately
        return { ok: true, output: JSON.stringify({ ok: true, command: 'clear', message: 'Completed tasks cleared.' }) };
      }

      default:
        return { ok: false, error: `Unknown command: ${command}` };
    }
  }
};