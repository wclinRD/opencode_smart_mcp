// system-prompt.mjs — Smart Agent system prompt fragments for opencode
//
// npm 套件版：import core/base，保持向後相容。
// 單一事實來源：src/agent/core/system-prompt-base.mjs
// 發布時 build script 會將 import 路徑從 ../../src/agent/core/ 改為 ./core/
//
// Usage:
//   import { SYSTEM_PROMPT_FRAGMENT } from 'smart-agent/system-prompt';

import { SYSTEM_PROMPT_BASE } from '../../../src/agent/core/system-prompt-base.mjs';

export const SYSTEM_PROMPT_FRAGMENT = SYSTEM_PROMPT_BASE;