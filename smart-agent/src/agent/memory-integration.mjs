// memory-integration.mjs — Smart Agent memory auto-integration
//
// 發布版：re-export from core/。
// 單一事實來源：src/agent/core/（根目錄），由 build-agent.mjs 同步至此
//
// Usage:
//   import { shouldRemember, buildStoreCommand, formatMemoryResult } from 'smart-agent/memory-integration';

export * from './core/memory-integration-base.mjs';