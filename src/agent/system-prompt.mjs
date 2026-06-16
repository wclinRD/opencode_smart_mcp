// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// MCP 內部版：直接 re-export core/base，保持向後相容。
// 單一事實來源：src/agent/core/system-prompt-base.mjs
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT } from 'smart-agent/system-prompt';

import { SYSTEM_PROMPT_BASE, BOULDER_PROMPT_LINE } from './core/system-prompt-base.mjs';

export const SYSTEM_PROMPT_FRAGMENT = SYSTEM_PROMPT_BASE;
export { BOULDER_PROMPT_LINE } from './core/system-prompt-base.mjs';