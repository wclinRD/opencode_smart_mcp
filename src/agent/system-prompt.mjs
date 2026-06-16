// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// MCP 內部版：直接 re-export core/base，保持向後相容。
// 單一事實來源：src/agent/core/system-prompt-base.mjs
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT, buildSystemPrompt } from 'smart-agent/system-prompt';
//
//   // 靜態片段（一直存在 — 文件用途）
//   const base = SYSTEM_PROMPT_FRAGMENT;
//
//   // 動態組裝（啟動時使用 — 有 active plan 才注入 Boulder line）
//   const { prompt, boulderContext } = buildSystemPrompt();
//   // prompt = SYSTEM_PROMPT_BASE + 有 active plan 時附加 Boulder line
//   // boulderContext = getBoulderContext() 的結果（給 core_memory 同步用）

import { SYSTEM_PROMPT_BASE, BOULDER_PROMPT_LINE } from './core/system-prompt-base.mjs';
import { getBoulderContext } from './core/memory-integration-base.mjs';

// 向後相容：純文字片段
export const SYSTEM_PROMPT_FRAGMENT = SYSTEM_PROMPT_BASE;
export { BOULDER_PROMPT_LINE } from './core/system-prompt-base.mjs';

/**
 * 動態組裝 system prompt，條件注入 Boulder continuation directive。
 *
 * - 一律包含 SYSTEM_PROMPT_BASE（靜態文件說明）
 * - 有 active plan 時，在尾部附加 BOULDER_PROMPT_LINE（含 plan 變數展開）
 * - 附加的 boulderContext 可傳給 getBoulderSyncCommands() 做 core_memory 同步
 *
 * @returns {{ prompt: string, boulderContext: object|null }}
 *   prompt: 完整 system prompt 字串
 *   boulderContext: getBoulderContext() 結果（無 active plan 則為 null）
 */
export function buildSystemPrompt() {
  let prompt = SYSTEM_PROMPT_BASE;
  let boulderContext = null;

  try {
    boulderContext = getBoulderContext();
  } catch {
    // DB 不可用 — 略過 Boulder
  }

  if (boulderContext && boulderContext.hasActivePlan) {
    const line = BOULDER_PROMPT_LINE
      .replace('{{name}}', boulderContext.goal || '')
      .replace('{{done}}', boulderContext.progress?.split('/')[0] || '0')
      .replace('{{total}}', boulderContext.progress?.split('/')[1] || '0');

    prompt += '\n\n' + line;
  }

  return { prompt, boulderContext };
}
