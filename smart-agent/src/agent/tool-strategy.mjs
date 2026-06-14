// tool-strategy.mjs — Smart Agent tool recommendation engine
//
// npm 套件版：import core/base，保持向後相容。
// 單一事實來源：src/agent/core/tool-strategy-base.mjs
// 發布時 build script 會將 import 路徑從 ../../src/agent/core/ 改為 ./core/
//
// Usage:
//   import { recommendTools, buildToolChain } from 'smart-agent/tool-strategy';

export * from '../../../src/agent/core/tool-strategy-base.mjs';