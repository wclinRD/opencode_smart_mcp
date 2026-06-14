// tool-strategy.mjs — Smart Agent tool recommendation engine
//
// MCP 內部版：直接 re-export core/base，保持向後相容。
// 單一事實來源：src/agent/core/tool-strategy-base.mjs
//
// Usage:
//   import { recommendTools, buildToolChain } from 'smart-agent/tool-strategy';

export * from './core/tool-strategy-base.mjs';