// memory-integration.mjs — Smart Agent memory auto-integration
//
// npm 套件版：import core/base，保持向後相容。
// 單一事實來源：src/agent/core/memory-integration-base.mjs
// 發布時 build script 會將 import 路徑從 ../../src/agent/core/ 改為 ./core/
//
// Usage:
//   import { shouldRemember, buildStoreCommand, formatMemoryResult } from 'smart-agent/memory-integration';

export * from '../../../src/agent/core/memory-integration-base.mjs';