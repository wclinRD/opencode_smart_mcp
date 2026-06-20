// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// 發布版：import core/ 保持向後相容。
// 單一事實來源：src/agent/core/（根目錄），由 build-agent.mjs 同步至此
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT } from 'smart-agent/system-prompt';

import { SYSTEM_PROMPT_BASE } from './core/system-prompt-base.mjs';

export const SYSTEM_PROMPT_FRAGMENT = SYSTEM_PROMPT_BASE;