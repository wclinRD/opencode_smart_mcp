// memory-integration.mjs — Smart Agent memory auto-integration
//
// MCP 內部版：直接 re-export core/base，保持向後相容。
// 單一事實來源：src/agent/core/memory-integration-base.mjs
//
// Usage:
//   import { shouldRemember, buildStoreCommand, formatMemoryResult } from 'smart-agent/memory-integration';

export { getBoulderContext } from './core/memory-integration-base.mjs';
export * from './core/memory-integration-base.mjs';