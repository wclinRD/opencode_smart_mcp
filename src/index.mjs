// index.mjs — Smart Agent main entry point
//
// Aggregates and re-exports all smart-agent modules.
// Provides a unified API for programmatic use.
//
// Usage:
//   import smart from 'smart-agent';
//   const rec = smart.recommendTools('debug login error');
//   console.log(smart.explainRecommendation(rec));

export { SYSTEM_PROMPT_FRAGMENT } from './agent/system-prompt.mjs';
export { recommendTools, buildToolChain, explainRecommendation } from './agent/tool-strategy.mjs';
export {
  selectTemplate,
  planAutoExecute,
  getDispatchCommand,
  getReplanCommand,
  getSummaryCommand,
  shouldReplan,
  extractFindings,
} from './agent/workflow-strategy.mjs';
export {
  shouldRemember,
  buildStoreCommand,
  formatMemoryResult,
} from './agent/memory-integration.mjs';
export {
  planAndExecute,
  analyzePlan,
  determineNextAction,
  needsPlanning,
} from './agent/planner-integration.mjs';
