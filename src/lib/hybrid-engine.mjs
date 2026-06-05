// hybrid-engine.mjs — Hybrid Reasoning Engine
//
// Phase 12: Two-layer intelligence router.
//   Task Classifier → categorizes questions into structure/semantic/change-impact/debug/search
//   Deterministic execution → routes to CKG/LSP/grep tools directly
//   Output merge → combines deterministic results into structured answer
//
// Architecture:
//   smart_hybrid_router (MCP tool)
//     └── hybrid-engine.mjs
//          ├── classifyQuestion()        → { category, confidence, patterns }
//          ├── executeDeterministic()    → { callers, callees, deps, symbols, grep }
//          ├── planPath()                → tool execution plan from classification
//          └── mergeResults()            → structured answer with source trace
//
// Usage:
//   import { executeHybrid } from './hybrid-engine.mjs';
//   const result = await executeHybrid({ question: "...", context: {}, root: "." });

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, extname, basename } from 'node:path';
import { getCkgEngine } from './ckg-engine.mjs';
import { getLspBridge } from './lsp-bridge.mjs';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Task categories the classifier can output */
const CATEGORIES = {
  STRUCTURE: 'structure',
  CHANGE_IMPACT: 'change-impact',
  DEBUG: 'debug',
  SEARCH: 'search',
  SEMANTIC: 'semantic',
  UNKNOWN: 'unknown',
};

/** Classification patterns: regex → category + confidence + tool list */
const CLASSIFIER_PATTERNS = [
  // -- Structure: symbol definitions, types, callers/callees, imports --
  {
    patterns: [
      /who\s+calls/i, /callers?\s+of/i, /callees?\s+of/i, /what\s+calls/i,
      /where\s+is\s+\w+\s+(defined|declared)/i, /how\s+is\s+\w+\s+(defined|declared)/i,
      /what\s+is\s+the\s+(type|kind|signature)\s+of/i, /what\s+(type|kind|signature)\s+of/i,
      /what\s+are\s+the\s+(dependencies|imports|exports)\s+of/i,
      /what\s+(does\s+|is\s+|are\s+)(the\s+)?(dependencies|imports)\s+of/i,
      /find\s+(function|class|interface|type)\s+\w+/i,
      /(\w+)\s+definition/i, /(\w+)\s+signature/i, /(\w+)\s+symbol/i,
      /import\s+(path|chain|graph)/i, /depend(ency|encies)\s+(graph|chain|of)/i,
      /unused\s+(export|import)/i,
      /list\s+(all\s+)?(functions|classes|interfaces|symbols)/i,
      /show\s+(me\s+)?(symbol|function|class|interface)/i,
    ],
    category: CATEGORIES.STRUCTURE,
    confidence: 0.9,
    tools: ['smart_code_query', 'smart_code_ast', 'smart_code_type_infer', 'smart_grep'],
    description: 'Structure query — uses deterministic tools for symbol/type/caller analysis',
  },

  // -- Change Impact: what would break, impact radius, refactoring safety --
  {
    patterns: [
      /what\s+(if\s+I\s+(change|modify|rename|delete|remove|move))/i,
      /impact\s+(radius|analysis|of|area)/i,
      /(change|modify|refactor|rename)\s+\w+\s+(affect|impact|break|influence)/i,
      /what\s+(depends?\s+on|uses?\s+\w+)/i,
      /(downstream|transitive)\s+(effect|impact)/i,
      /would\s+(this|that)\s+(break|affect)/i,
      /what\s+files?\s+(are\s+)?(affected|impacted|touched)/i,
      /safe\s+(to\s+)?(change|delete|remove|rename)/i,
      /refactor\s+(safety|risk|check)/i,
    ],
    category: CATEGORIES.CHANGE_IMPACT,
    confidence: 0.85,
    tools: ['smart_code_query', 'smart_code_impact', 'smart_import_graph', 'smart_grep'],
    description: 'Change impact — uses CKG + LSP + import graph for safety analysis',
  },

  // -- Debug: error analysis, crash investigation, root cause --
  {
    patterns: [
      /(error|exception|fail|crash|bug)\s+(.*)/i,
      /why\s+(did|does|is|are|was)\s+(this|it|the|my)/i,
      /root\s+cause/i, /debug\s+/i, /trace\s+(error|stack|back)/i,
      /what\s+(went\s+wrong|caused|triggered)/i,
      /how\s+to\s+(fix|resolve|solve|repair)/i,
      /(crash|panic|timeout|memory\s+leak)\s+in/i,
      /unexpected\s+(behavior|result|output)/i,
      /(\w+Error|Exception)\b/i,
    ],
    category: CATEGORIES.DEBUG,
    confidence: 0.8,
    tools: ['smart_error_diagnose', 'smart_grep', 'smart_code_query', 'smart_memory_store'],
    description: 'Debug query — uses grep + CKG context + error diagnosis',
  },

  // -- Search: find patterns, locate code, grep-style queries --
  {
    patterns: [
      /find\s+(all\s+)?(occurrence|instance|reference|usage|file)/i,
      /search\s+(for|code|pattern)/i, /where\s+(is|are)\s+(\w+\s+)*(used|referenced)/i,
      /locate\s+/i, /(\w+)\s+usage/i, /(\w+)\s+references?/i,
      /all\s+(\w+)\s+in\s+(project|codebase|file|directory)/i,
      /(file|files?)\s+(containing|with|that\s+have)/i,
      /list\s+(\w+\s+)*files/i,
      /pattern\s+(matching|search|find)/i,
    ],
    category: CATEGORIES.SEARCH,
    confidence: 0.85,
    tools: ['smart_grep', 'smart_code_query', 'smart_github_search', 'smart_exa_search'],
    description: 'Code search + web search — uses grep, CKG, GitHub, and Exa web search for comprehensive searching',
  },

  // -- Semantic: code understanding, explanation, architecture --
  {
    patterns: [
      /what\s+(does|is|are)\s+(this|the|that|a|an)\s+/i,
      /explain\s+/i, /how\s+does\s+(\w+\s+)*work/i,
      /architecture\s+(of|diagram|overview)/i,
      /summarize\s+/i, /describe\s+/i,
      /what\s+(\w+\s+)*(does|is|are|mean)/i,
      /overview\s+of/i, /understand\s+/i,
      /relationship\s+(between|among)/i,
      /design\s+(pattern|decision|rationale)/i,
    ],
    category: CATEGORIES.SEMANTIC,
    confidence: 0.7,
    tools: ['smart_code_query', 'smart_code_ast', 'smart_thinking', 'smart_diagram'],
    description: 'Semantic query — gathers CKG context + LSP data for LLM synthesis',
  },
];

/** Default threshold: below this, go hybrid path */
const HYBRID_THRESHOLD = 0.75;

/** Supported file extensions for direct analysis */
const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go']);

// ---------------------------------------------------------------------------
// Task Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a question into a task category.
 * Returns classification with confidence, matched tools, and matched patterns.
 *
 * @param {string} question - User question
 * @param {object} [context] - Optional context (current file, project type)
 * @returns {{ category: string, confidence: number, tools: string[], patterns: string[], isHybrid: boolean }}
 */
export function classifyQuestion(question, context = {}) {
  if (!question || typeof question !== 'string') {
    return {
      category: CATEGORIES.UNKNOWN,
      confidence: 0,
      tools: [],
      patterns: [],
      isHybrid: true,
    };
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of CLASSIFIER_PATTERNS) {
    let matchedCount = 0;
    const matchedPatterns = [];

    for (const pattern of rule.patterns) {
      if (pattern.test(question)) {
        matchedCount++;
        matchedPatterns.push(pattern.source);
      }
    }

    if (matchedCount > 0) {
      // Score = base confidence + boost per additional match (capped)
      const boost = Math.min((matchedCount - 1) * 0.05, 0.15);
      const score = Math.min(rule.confidence + boost, 0.99);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          category: rule.category,
          confidence: score,
          tools: rule.tools,
          patterns: matchedPatterns,
          description: rule.description,
        };
      }
    }
  }

  if (!bestMatch) {
    return {
      category: CATEGORIES.UNKNOWN,
      confidence: 0.3,
      tools: ['smart_code_query', 'smart_grep', 'smart_thinking'],
      patterns: [],
      isHybrid: true,
    };
  }

  return {
    ...bestMatch,
    isHybrid: bestMatch.confidence < HYBRID_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Tool Execution Plan
// ---------------------------------------------------------------------------

/**
 * Generate an execution plan from a classification.
 * Maps the classified category + tools to actual deterministic functions.
 *
 * @param {object} classification - Result from classifyQuestion()
 * @param {string} question - Original question
 * @param {object} opts - { root: string, files: string[], symbols: string[] }
 * @returns {object} - { plan: [{ id, tool, execute }], parallel: [[ids]] }
 */
export function planPath(classification, question, opts = {}) {
  const root = opts.root || process.cwd();
  const files = opts.files || [];
  const symbols = opts.symbols || extractSymbols(question);

  const plan = [];
  let idCounter = 0;
  const nextId = () => `step_${idCounter++}`;

  switch (classification.category) {
    case CATEGORIES.STRUCTURE: {
      // Determine which structure tool(s) to run
      if (symbols.length > 0) {
        for (const sym of symbols) {
          // If we have a file context, use CKG callers/callees
          if (files.length > 0) {
            plan.push({
              id: nextId(),
              tool: 'ckg_callers',
              description: `Find callers of ${sym}`,
              dependsOn: [],
              execute: async () => {
                const engine = getCkgEngine(root);
                return engine.queryCallers(sym, files[0], { depth: 1 });
              },
            });
            plan.push({
              id: nextId(),
              tool: 'ckg_callees',
              description: `Find callees of ${sym}`,
              dependsOn: [],
              execute: async () => {
                const engine = getCkgEngine(root);
                return engine.queryCallees(sym, files[0], { depth: 1 });
              },
            });
          }
          // Type inference
          plan.push({
            id: nextId(),
            tool: 'lsp_type',
            description: `Get type info for ${sym}`,
            dependsOn: [],
            execute: async () => {
              const bridge = getLspBridge(root);
              return bridge.getHover(sym);
            },
          });
        }
      } else if (files.length > 0) {
        // AST for files
        for (const file of files) {
          plan.push({
            id: nextId(),
            tool: 'lsp_ast',
            description: `Get AST symbols for ${file}`,
            dependsOn: [],
            execute: async () => {
              const bridge = getLspBridge(root);
              return bridge.getSymbols(file);
            },
          });
        }
      }
      // Dependencies
      if (files.length > 0) {
        plan.push({
          id: nextId(),
          tool: 'ckg_deps',
          description: `Get dependency graph for ${files[0]}`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.queryDependencies(files[0]);
          },
        });
      }
      break;
    }

    case CATEGORIES.CHANGE_IMPACT: {
      const impactFiles = files.length > 0 ? files : detectProjectFiles(root, 5);
      for (const file of impactFiles) {
        plan.push({
          id: nextId(),
          tool: 'lsp_impact',
          description: `Impact analysis for ${file}`,
          dependsOn: [],
          execute: async () => {
            const bridge = getLspBridge(root);
            const symbolsList = await bridge.getSymbols(file);
            const result = { file, impacts: [] };

            for (const sym of (symbolsList.symbols || [])) {
              if (!['function', 'class', 'method'].includes(sym.kind)) continue;
              try {
                const refs = await bridge.getReferences(file, sym.line || 1, sym.col || 0);
                const callers = (refs.references || [])
                  .filter(r => r.file !== resolve(root, file))
                  .map(r => relative(root, r.file));
                if (callers.length > 0) {
                  result.impacts.push({ symbol: sym.name, callers });
                }
              } catch { /* skip */ }
            }
            return result;
          },
        });
        plan.push({
          id: nextId(),
          tool: 'ckg_deps',
          description: `Dependency chain for ${file}`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.queryDependencies(file);
          },
        });
      }
      break;
    }

    case CATEGORIES.DEBUG: {
      // Extract error-related info from question
      const errorMatch = question.match(/(\w+Error\b|exception|failed|timeout)/i);
      const errorTerm = errorMatch ? errorMatch[1] : 'error';

      // grep for error patterns
      plan.push({
        id: nextId(),
        tool: 'grep_code',
        description: `Search codebase for "${errorTerm}"`,
        dependsOn: [],
        execute: async () => {
          return simpleGrep(root, errorTerm, { maxResults: 20 });
        },
      });

      // If symbol context available, get CKG info
      if (symbols.length > 0 && files.length > 0) {
        plan.push({
          id: nextId(),
          tool: 'ckg_callers',
          description: `Get context for ${symbols[0]}`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.queryCallers(symbols[0], files[0], { depth: 1 });
          },
        });
      }

      // CKG stats for orientation
      plan.push({
        id: nextId(),
        tool: 'ckg_stats',
        description: 'Get project overview',
        dependsOn: [],
        execute: async () => {
          const engine = getCkgEngine(root);
          return engine.getStats();
        },
      });
      break;
    }

    case CATEGORIES.SEARCH: {
      const searchTerms = extractSearchTerms(question);

      // Parallel: grep + CKG symbol query
      for (const term of searchTerms) {
        plan.push({
          id: nextId(),
          tool: 'grep_code',
          description: `Search for "${term}"`,
          dependsOn: [],
          execute: async () => {
            return simpleGrep(root, term, { maxResults: 30 });
          },
        });
        plan.push({
          id: nextId(),
          tool: 'ckg_symbol',
          description: `Lookup symbol "${term}" in CKG`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.querySymbol(term, {});
          },
        });
      }

      if (files.length > 0) {
        plan.push({
          id: nextId(),
          tool: 'lsp_ast',
          description: `AST for ${files[0]}`,
          dependsOn: [],
          execute: async () => {
            const bridge = getLspBridge(root);
            return bridge.getSymbols(files[0]);
          },
        });
      }
      break;
    }

    case CATEGORIES.SEMANTIC: {
      // Gather rich context for LLM synthesis
      if (files.length > 0) {
        for (const file of files) {
          plan.push({
            id: nextId(),
            tool: 'lsp_ast',
            description: `AST for ${file}`,
            dependsOn: [],
            execute: async () => {
              const bridge = getLspBridge(root);
              return bridge.getSymbols(file);
            },
          });
          plan.push({
            id: nextId(),
            tool: 'ckg_deps',
            description: `Deps for ${file}`,
            dependsOn: [],
            execute: async () => {
              const engine = getCkgEngine(root);
              return engine.queryDependencies(file);
            },
          });
        }
      }

      if (symbols.length > 0 && files.length > 0) {
        plan.push({
          id: nextId(),
          tool: 'ckg_callers',
          description: `Callers of ${symbols[0]}`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.queryCallers(symbols[0], files[0], { depth: 2 });
          },
        });
      }

      // Project overview
      plan.push({
        id: nextId(),
        tool: 'ckg_stats',
        description: 'Project CKG stats',
        dependsOn: [],
        execute: async () => {
          const engine = getCkgEngine(root);
          return engine.getStats();
        },
      });

      // File content for key files
      if (files.length > 0) {
        for (const file of files.slice(0, 3)) {
          plan.push({
            id: nextId(),
            tool: 'file_content',
            description: `Read ${file}`,
            dependsOn: [],
            execute: async () => {
              return readFileContent(root, file, 100);
            },
          });
        }
      }
      break;
    }

    default: // UNKNOWN — gather broad context
    {
      // Hybrid: broad search + CKG stats + symbol lookup
      plan.push({
        id: nextId(),
        tool: 'ckg_stats',
        description: 'Project overview',
        dependsOn: [],
        execute: async () => {
          const engine = getCkgEngine(root);
          return engine.getStats();
        },
      });

      const searchTerms = extractSearchTerms(question);
      for (const term of searchTerms.slice(0, 3)) {
        plan.push({
          id: nextId(),
          tool: 'grep_code',
          description: `Search "${term}"`,
          dependsOn: [],
          execute: async () => simpleGrep(root, term, { maxResults: 15 }),
        });
        plan.push({
          id: nextId(),
          tool: 'ckg_symbol',
          description: `CKG lookup "${term}"`,
          dependsOn: [],
          execute: async () => {
            const engine = getCkgEngine(root);
            return engine.querySymbol(term, {});
          },
        });
      }
      break;
    }
  }

  // Compute parallel groups from dependency graph
  const parallel = computeParallelGroups(plan);

  return { plan, parallel, hasSteps: plan.length > 0 };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute a plan's steps respecting dependency order.
 *
 * @param {{ plan, parallel }} planResult - Output from planPath()
 * @returns {object} - { results: Map<id, output>, duration, errors }
 */
export async function executePlan(planResult) {
  const { plan, parallel } = planResult;
  if (!plan || plan.length === 0) {
    return { results: new Map(), duration: 0, errors: [], empty: true };
  }

  const results = new Map();
  const errors = [];
  const stepMap = new Map(plan.map(s => [s.id, s]));
  const startTime = Date.now();

  for (const group of parallel) {
    const promises = group.map(async (stepId) => {
      const step = stepMap.get(stepId);
      if (!step) return;

      // Check deps are resolved
      const depsOk = (step.dependsOn || []).every(depId => results.has(depId));
      if (!depsOk) {
        results.set(stepId, { error: 'dependency_not_met', value: null });
        return;
      }

      try {
        const output = await step.execute();
        results.set(stepId, { error: null, value: output });
      } catch (err) {
        const errMsg = err.message || String(err);
        errors.push({ step: stepId, tool: step.tool, error: errMsg });
        results.set(stepId, { error: errMsg, value: null });
      }
    });

    await Promise.all(promises);
  }

  return {
    results,
    duration: Date.now() - startTime,
    errors,
    stepCount: plan.length,
  };
}

// ---------------------------------------------------------------------------
// Output Merge
// ---------------------------------------------------------------------------

/**
 * Merge deterministic execution results into structured answer.
 *
 * @param {object} classification - From classifyQuestion()
 * @param {object} execResult - From executePlan()
 * @param {string} question - Original question
 * @returns {object} - Merged output with answer + sources
 */
export function mergeResults(classification, execResult, question) {
  const { results, errors, duration, stepCount } = execResult;
  const sources = [];

  // Collect all tool outputs as sources
  for (const [stepId, result] of results) {
    if (result.value) {
      sources.push({
        type: 'deterministic',
        stepId,
        tool: stepId.split('_')[0] || stepId,
        confidence: 1.0,
        data: result.value,
      });
    } else if (result.error) {
      sources.push({
        type: 'error',
        stepId,
        tool: stepId.split('_')[0] || stepId,
        error: result.error,
      });
    }
  }

  // Build answer summary from sources
  const answerParts = [];

  // CKG stats
  const stats = findResultByTool(results, 'ckg_stats');
  if (stats) {
    answerParts.push(`Project: ${stats.project || 'unknown'} (${stats.nodes || 0} nodes, ${stats.edges || 0} edges, ${stats.files || 0} files)`);
  }

  // Callers / callees
  const callers = findResultByTool(results, 'ckg_callers');
  if (callers) {
    const total = callers.totalCallers || 0;
    if (total > 0) {
      answerParts.push(`Found ${total} caller(s) for ${callers.root?.symbol || 'symbol'}`);
    } else {
      answerParts.push(`No direct callers found for ${callers.root?.symbol || 'symbol'}`);
    }
  }

  const callees = findResultByTool(results, 'ckg_callees');
  if (callees) {
    const total = callees.totalCallees || 0;
    answerParts.push(`Found ${total} callee(s) for ${callees.root?.symbol || 'symbol'}`);
  }

  // Dependencies
  const deps = findResultByTool(results, 'ckg_deps');
  if (deps) {
    answerParts.push(`Dependencies: ${deps.totalImports || 0} import(s), ${deps.totalImporters || 0} importer(s)`);
  }

  // AST symbols
  const asts = findResultsByTool(results, 'lsp_ast');
  for (const ast of asts) {
    if (ast.value?.symbols) {
      answerParts.push(`AST: ${ast.value.symbols.length} symbol(s) in ${ast.value.file || 'file'}`);
    }
  }

  // Symbol lookup
  const symbols = findResultsByTool(results, 'ckg_symbol');
  for (const sym of symbols) {
    if (sym.value && sym.value.length > 0) {
      answerParts.push(`CKG symbol: found ${sym.value.length} match(es)`);
    }
  }

  // Grep results
  const greps = findResultsByTool(results, 'grep_code');
  for (const g of greps) {
    if (g.value?.matches) {
      answerParts.push(`Grep: ${g.value.matches.length} match(es)${g.value.pattern ? ` for "${g.value.pattern}"` : ''}`);
    }
  }

  // Impact analysis
  const impacts = findResultsByTool(results, 'lsp_impact');
  for (const imp of impacts) {
    if (imp.value?.impacts) {
      answerParts.push(`Impact: ${imp.value.impacts.length} symbol(s) in ${imp.value.file} have downstream consumers`);
    }
  }

  // Construct answer
  const answer = answerParts.length > 0
    ? answerParts.join('\n')
    : (() => {
      if (errors.length > 0) {
        return `Analysis completed with ${errors.length} error(s). Some tools were unavailable (CKG/LSP may need initialization).`;
      }
      if (stepCount > 0) {
        return `Analysis complete (${duration}ms, ${stepCount} steps). No specific findings matched your query.`;
      }
      return 'No findings. Try adding file or symbol context for deeper analysis.';
    })();

  // Format sources for readability
  const sourceSummary = sources.slice(0, 10).map(s => ({
    type: s.type,
    tool: s.tool,
    hasData: !!s.data,
    confidence: s.confidence,
  }));

  return {
    answer,
    classification: {
      category: classification.category,
      confidence: classification.confidence,
      isHybrid: classification.isHybrid,
    },
    confidence: sources.length > 0
      ? Math.min(classification.confidence, 0.95)
      : Math.min(classification.confidence * 0.5, 0.5),
    sources: sourceSummary,
    metadata: {
      duration,
      toolsUsed: sources.length,
      toolsErrored: errors.length,
      deterministic: true,
      llm: false,
    },
    _raw: {
      errors,
      stepCount,
      classification,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Execute the full hybrid reasoning pipeline.
 * 1. classify → 2. plan → 3. execute → 4. merge
 *
 * @param {object} opts
 * @param {string} opts.question - The user question
 * @param {string} [opts.root] - Project root (default: cwd)
 * @param {string[]} [opts.files] - Relevant file paths
 * @param {string[]} [opts.symbols] - Relevant symbol names
 * @param {boolean} [opts.forceHybrid] - Skip classification, gather broad context
 * @returns {Promise<object>} Merged result with answer + sources
 */
export async function executeHybrid(opts = {}) {
  const {
    question = '',
    root = process.cwd(),
    files = [],
    symbols = [],
    forceHybrid = false,
  } = opts;

  if (!question) {
    return {
      answer: 'No question provided.',
      classification: { category: 'unknown', confidence: 0, isHybrid: false },
      confidence: 0,
      sources: [],
      metadata: { duration: 0, toolsUsed: 0, toolsErrored: 0 },
    };
  }

  // Step 1: Classify
  const classification = classifyQuestion(question, { files, symbols });

  // Force hybrid mode if requested or below threshold
  if (forceHybrid) {
    classification.category = CATEGORIES.UNKNOWN;
    classification.confidence = 0.3;
    classification.isHybrid = true;
  }

  // Step 2: Plan
  const plan = planPath(classification, question, { root, files, symbols });

  // Step 3: Execute
  const execResult = await executePlan(plan);

  // Step 4: Merge
  const merged = mergeResults(classification, execResult, question);

  return merged;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Extract symbol names from a question (e.g., "who calls foo" → "foo").
 * Looks for words that match common identifier patterns.
 */
export function extractSymbols(question) {
  if (!question || typeof question !== 'string') return [];

  // Common patterns: after "of", "for", "call", "find", "what"
  const patterns = [
    /(?:callers?|callees?|symbol|function|class|type)\s+(?:of\s+|for\s+)?(\w+)/gi,
    /(?:find|locate|search|show|get)\s+(\w+(?:\.\w+)*)/gi,
    /(?:what\s+is|where\s+is|who\s+calls)\s+(\w+(?:\.\w+)*)/gi,
    /(\w+(?:\.\w+)*)\s+(?:definition|signature|type|usage|implementation)/gi,
  ];

  const found = new Set();
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(question)) !== null) {
      const sym = m[1].trim();
      // Filter out common words
      if (sym.length > 1 && !/^(this|that|the|and|or|for|you|your|with|from|how|what|why|when|where)$/i.test(sym)) {
        found.add(sym);
      }
    }
  }

  // If no symbols found by patterns, extract all capitalized/long words as potential symbols
  if (found.size === 0) {
    const words = question.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-zA-Z0-9_]/g, '');
      if (clean.length >= 2 && (/^[A-Z]/.test(clean) || clean.includes('_'))) {
        // Likely a symbol (camelCase, PascalCase, snake_case)
        found.add(clean);
      }
    }
  }

  return [...found];
}

/**
 * Extract search terms from question (for grep/code search).
 */
function extractSearchTerms(question) {
  const symbols = extractSymbols(question);
  if (symbols.length > 0) return symbols;

  // Fallback: take significant words
  const stopWords = new Set([
    'the', 'this', 'that', 'what', 'how', 'why', 'when', 'where',
    'find', 'show', 'list', 'get', 'tell', 'is', 'are', 'was', 'were',
    'does', 'do', 'did', 'has', 'have', 'had', 'can', 'could', 'will',
    'would', 'should', 'may', 'might', 'all', 'any', 'some', 'each',
    'every', 'code', 'file', 'function', 'class', 'method', 'variable',
    'type', 'with', 'from', 'for', 'about', 'please', 'help', 'need',
  ]);

  const words = question.split(/\s+/);
  return words
    .map(w => w.replace(/[^a-zA-Z0-9_]/g, ''))
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5);
}

/**
 * Simple grep implementation that searches file contents.
 * Scans project files for a pattern, returns matches with context.
 */
async function simpleGrep(root, pattern, opts = {}) {
  const maxResults = opts.maxResults || 20;
  const maxFiles = opts.maxFiles || 20;
  const results = { pattern, matches: [], totalMatches: 0, truncated: false };

  try {
    // Use rg (ripgrep) if available, fallback to grep
    const cmd = `rg --no-heading --line-number --max-count 5 --max-files ${maxFiles} -m ${maxResults} "${pattern.replace(/"/g, '\\"')}" "${root}" 2>/dev/null | head -${maxResults * 2}`;

    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000, maxBuffer: 512 * 1024 });
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const sepIndex = line.indexOf(':');
      if (sepIndex === -1) continue;
      const file = line.slice(0, sepIndex);
      const rest = line.slice(sepIndex + 1);
      const lineSep = rest.indexOf(':');
      const lineNum = lineSep > 0 ? parseInt(rest.slice(0, lineSep), 10) : 0;
      const content = lineSep > 0 ? rest.slice(lineSep + 1) : rest;

      results.matches.push({
        file: relative(root, file) || file,
        line: lineNum,
        content: content.trim().slice(0, 200),
      });
    }

    results.totalMatches = results.matches.length;
    if (results.totalMatches >= maxResults) {
      results.truncated = true;
    }
  } catch {
    // ripgrep not available or other error
  }

  return results;
}

/**
 * Detect project files for analysis based on CKG data or directory scan.
 */
function detectProjectFiles(root, maxFiles = 10) {
  const files = [];

  try {
    const engine = getCkgEngine(root);
    const stats = engine.getStats();
    if (stats.status !== 'not_built' && stats.files) {
      // CKG already built — get files from DB
      // Use the un-exported query — fall through to directory scan
    }
  } catch { /* CKG not available */ }

  // Directory scan fallback
  try {
    const walk = (dir, depth = 0) => {
      if (depth > 3 || files.length >= maxFiles) return;
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
        const full = resolve(dir, entry);
        let stat;
        try { stat = statSync(full); } catch { continue; }
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (stat.isFile() && SUPPORTED_EXTS.has(extname(entry))) {
          files.push(relative(root, full));
          if (files.length >= maxFiles) return;
        }
      }
    };
    walk(root);
  } catch { /* scan error */ }

  return files;
}

/**
 * Read beginning of a file for context.
 */
function readFileContent(root, filePath, maxLines = 50) {
  try {
    const full = resolve(root, filePath);
    const content = readFileSync(full, 'utf-8');
    const lines = content.split('\n').slice(0, maxLines);
    return { file: filePath, lines: lines.length, content: lines.join('\n') };
  } catch {
    return { file: filePath, error: 'Could not read file' };
  }
}

/**
 * Find first result by value characteristics matching expected tool type.
 * Uses value structure inspection since step IDs are sequential (step_0, step_1).
 *
 * @param {Map} results - Map<stepId, {error, value}>
 * @param {string} toolType - Expected tool type prefix
 * @returns {object|null} - matched result value, or null
 */
function findResultByTool(results, toolType) {
  for (const [, result] of results) {
    if (!result.value) continue;

    // Check by tool type based on value structure
    const check = toolChecks[toolType];
    if (check && check(result.value)) {
      return result.value;
    }
  }
  return null;
}

/** Value structure checks for each tool type */
const toolChecks = {
  ckg_stats: (v) => v && typeof v.nodes === 'number' && typeof v.edges === 'number',
  ckg_callers: (v) => v && typeof v.totalCallers === 'number' && v.root,
  ckg_callees: (v) => v && typeof v.totalCallees === 'number' && v.root,
  ckg_deps: (v) => v && (typeof v.totalImports === 'number' || typeof v.imports !== 'undefined'),
  ckg_symbol: (v) => v && Array.isArray(v),
  grep_code: (v) => v && Array.isArray(v.matches),
  lsp_ast: (v) => v && v.symbols && Array.isArray(v.symbols),
  lsp_impact: (v) => v && v.impacts && Array.isArray(v.impacts),
  lsp_type: (v) => v && typeof v === 'object' && v !== null,
  file_content: (v) => v && typeof v.content === 'string',
};

/**
 * Find all results by tool type using value structure inspection.
 */
function findResultsByTool(results, toolType) {
  const found = [];
  const check = toolChecks[toolType];

  if (!check) return found;

  for (const [stepId, result] of results) {
    if (result.value && check(result.value)) {
      found.push({ stepId, ...result });
    }
  }
  return found;
}

/**
 * Compute parallel execution groups from dependency graph.
 * Steps without deps run in group 0, then steps whose deps are satisfied, etc.
 */
function computeParallelGroups(plan) {
  if (!plan || plan.length === 0) return [];

  const remaining = new Set(plan.map(s => s.id));
  const completed = new Set();
  const groups = [];

  while (remaining.size > 0) {
    const group = [];
    for (const step of plan) {
      if (!remaining.has(step.id)) continue;
      const depsMet = (step.dependsOn || []).every(d => completed.has(d));
      if (depsMet) group.push(step.id);
    }

    if (group.length === 0) {
      // Circular dependency or isolated step — add remaining all at once
      group.push(...remaining);
    }

    for (const id of group) {
      remaining.delete(id);
      completed.add(id);
    }
    groups.push(group);
  }

  return groups;
}
