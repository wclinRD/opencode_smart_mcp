/**
 * Action Registry — Map-based dispatch 取代 switch-case
 *
 * 用法：
 *   import { dispatch } from './registry.mjs';
 *   import './index.mjs'; // side-effect: 註冊所有 actions
 *   const result = await dispatch('auto', args);
 */

const actions = new Map();
const aliases = new Map();

/**
 * 註冊 action handler
 * @param {string} name — action 名稱
 * @param {Function} handler — async (args) => { ok, output/error }
 * @param {string[]} [aliasNames] — 別名（如 'papers' → 'paper'）
 */
export function registerAction(name, handler, aliasNames = []) {
  actions.set(name, handler);
  for (const alias of aliasNames) {
    aliases.set(alias, name);
  }
}

/**
 * 派遣 action
 * @param {string} action — action 名稱或別名
 * @param {object} args — 完整的工具參數
 * @returns {{ ok, output?, error? }}
 */
export async function dispatch(action, args = {}) {
  const resolved = aliases.get(action) || action;
  const handler = actions.get(resolved);
  if (!handler) {
    const available = [...new Set([...actions.keys(), ...aliases.keys()])].join(', ');
    return { ok: false, error: `未知 action: ${action}. 可用: ${available}` };
  }
  return handler(args);
}

/**
 * 列出所有已註冊的 action
 */
export function listActions() {
  return [...actions.keys()];
}
