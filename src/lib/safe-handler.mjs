// safe-handler.mjs — Auto-wrap plugin handlers with try-catch + structured error format.
//
// Ensures every plugin handler:
//   1. Never throws (uncaught exceptions → structured error)
//   2. Returns a consistent error format
//   3. String errors that look like errors are flagged for isError treatment
//
// Usage in loader.mjs:
//   import { wrapHandler } from '../lib/safe-handler.mjs';
//   def.handler = wrapHandler(def.handler, def.name);
//
// invokeTool checks isStructuredError() on handler output to route through isError path.

/**
 * Wrap a plugin handler with safety net + structured error format.
 * On error, returns the structured JSON string (does NOT throw),
 * so the handler promise resolves with the error text.
 * invokeTool should use isStructuredError() to detect this and route via isError: true.
 *
 * @param {Function|null} handler - The original async handler(args) => string
 * @param {string} toolName - Tool name for error messages
 * @returns {Function} Wrapped handler
 */
export function wrapHandler(handler, toolName) {
  if (typeof handler !== 'function') return handler;

  return async function safeHandler(args) {
    try {
      const result = await handler(args);

      // Catch: handler returned an error-looking string but didn't throw.
      if (typeof result === 'string' && isErrorString(result)) {
        return formatStructuredError({
          message: result.replace(/^❌\s*Error\s*/i, '').replace(/^Error[\s:]*/i, '').trim(),
          retryable: guessRetryable(result),
          toolName,
        });
      }

      return result;
    } catch (err) {
      // Handler threw — wrap in structured error
      return formatStructuredError({
        message: err.message || String(err),
        retryable: guessRetryable(err.message || ''),
        toolName,
      });
    }
  };
}

/**
 * Detect if a string is a structured error from wrapHandler.
 * invokeTool uses this to route the response through isError: true.
 *
 * @param {string} str - Handler output
 * @returns {boolean}
 */
export function isStructuredError(str) {
  if (typeof str !== 'string') return false;
  if (!str.startsWith('{')) return false;
  // Must contain our marker fields
  return str.includes('"error"') && str.includes('"retryable"') && str.includes('"suggested_action"');
}

/**
 * Format a structured error for LLM consumption.
 * The JSON format makes it easy for the LLM to parse retryable/suggested_action.
 */
function formatStructuredError({ message, retryable, toolName }) {
  const errorObj = {
    error: message,
    retryable,
    suggested_action: retryable
      ? `Retry the operation. If it fails again, try with different input or check the tool's requirements.`
      : `Check the input parameters and try again. Use describe("${toolName}") to review the tool schema.`,
    tool: toolName,
  };
  return JSON.stringify(errorObj, null, 2);
}

/**
 * Detect if a string looks like an error (even if handler didn't throw).
 */
function isErrorString(str) {
  // Match common error prefixes (covers: "Error:", "Error reading", "❌ Error", etc.)
  if (/^(Error[\s:]|❌\s*Error)/i.test(str)) return true;
  if (/^Failed:/i.test(str)) return true;
  if (/^Invalid/i.test(str)) return true;
  if (/^Cannot/i.test(str)) return true;
  if (/^Unable to/i.test(str)) return true;
  if (/^Missing required/i.test(str)) return true;
  if (/^Not found/i.test(str)) return true;
  if (/^Permission denied/i.test(str)) return true;
  return false;
}

/**
 * Guess whether an error is likely retryable based on its message.
 */
function guessRetryable(msg) {
  const lower = (msg || '').toLowerCase();
  // Non-retryable patterns
  if (lower.includes('not found')) return false;
  if (lower.includes('permission denied')) return false;
  if (lower.includes('eacces')) return false;
  if (lower.includes('enoent')) return false;
  if (lower.includes('invalid')) return false;
  if (lower.includes('missing required')) return false;
  if (lower.includes('syntax')) return false;
  if (lower.includes('parse')) return false;
  if (lower.includes('unknown')) return false;
  // Retryable patterns
  if (lower.includes('timeout')) return true;
  if (lower.includes('timed out')) return true;
  if (lower.includes('econnrefused')) return true;
  if (lower.includes('connection refused')) return true;
  if (lower.includes('network')) return true;
  if (lower.includes('eagain')) return true;
  if (lower.includes('busy')) return true;
  if (lower.includes('temporarily')) return true;
  // Default: non-retryable (safer assumption — won't cause infinite retry loops)
  return false;
}
