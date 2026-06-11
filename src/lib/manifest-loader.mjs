// manifest-loader.mjs — Manifest generation, loading, and validation
//
// Phase 15 P1: Single source of truth for tool metadata.
// Generates manifest.json from plugin definitions, or loads existing one.
//
// Usage:
//   import { generateManifest, loadManifest, validateManifest } from './manifest-loader.mjs';
//   const manifest = await generateManifest({ pluginsDir, outputPath });
//   const loaded = loadManifest(manifestPath);

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Safety level inference from tool characteristics
// ---------------------------------------------------------------------------

const SAFETY_HEURISTICS = [
  // Critical: tools that modify files or execute code
  { pattern: /fast.apply|edit|cross.file|rename/i, level: 'high', reason: 'modifies source files' },
  { pattern: /exec|sandbox|run/i, level: 'critical', reason: 'executes arbitrary code' },
  { pattern: /git.commit|git.pr|git.push/i, level: 'high', reason: 'modifies git history' },
  // High: tools that produce security-sensitive output
  { pattern: /security|vuln/i, level: 'high', reason: 'security analysis' },
  // Medium: tools that read but don't modify
  { pattern: /grep|search|query|find|list/i, level: 'low', reason: 'read-only search' },
  { pattern: /learn|arch.overview|import.graph/i, level: 'low', reason: 'read-only analysis' },
  { pattern: /test|coverage/i, level: 'low', reason: 'test execution' },
  { pattern: /think|reason/i, level: 'low', reason: 'reasoning only' },
  { pattern: /lsp|hover|definition|diagnostics/i, level: 'low', reason: 'code intelligence' },
  { pattern: /ingest|document|docx/i, level: 'medium', reason: 'document processing' },
  { pattern: /browser|playwright/i, level: 'medium', reason: 'browser automation' },
];

function inferSafetyLevel(toolName) {
  for (const h of SAFETY_HEURISTICS) {
    if (h.pattern.test(toolName)) return h.level;
  }
  return 'medium'; // conservative default
}

// ---------------------------------------------------------------------------
// Domain inference from tool name
// ---------------------------------------------------------------------------

const DOMAIN_PATTERNS = [
  { pattern: /grep|search|find/i, domain: 'search' },
  { pattern: /security|vuln/i, domain: 'security' },
  { pattern: /test|coverage/i, domain: 'test' },
  { pattern: /debug|error.diagnose/i, domain: 'debug' },
  { pattern: /fast.apply|edit|cross.file|rename|patch/i, domain: 'edit' },
  { pattern: /git/i, domain: 'git' },
  { pattern: /learn|arch.overview|import.graph|code.impact|code.query|code.ast/i, domain: 'analyze' },
  { pattern: /think|reason/i, domain: 'reasoning' },
  { pattern: /lsp|hover|definition|diagnostics|symbols/i, domain: 'lsp' },
  { pattern: /ingest|document|docx|list.doc/i, domain: 'document' },
  { pattern: /browser|playwright/i, domain: 'browser' },
  { pattern: /planner|plan/i, domain: 'plan' },
  { pattern: /memory/i, domain: 'memory' },
  { pattern: /report|diagram/i, domain: 'report' },
  { pattern: /crawl|scrape/i, domain: 'crawl' },
  { pattern: /academic|research|peer.review/i, domain: 'academic' },
  { pattern: /obsidian|wiki/i, domain: 'wiki' },
  { pattern: /hallucination/i, domain: 'quality' },
  { pattern: /compact/i, domain: 'context' },
  { pattern: /compose|workflow/i, domain: 'workflow' },
  { pattern: /router|recommend/i, domain: 'routing' },
  { pattern: /py.helper|ts.helper|rs.helper|php/i, domain: 'lang' },
];

function inferDomain(toolName) {
  for (const d of DOMAIN_PATTERNS) {
    if (d.pattern.test(toolName)) return d.domain;
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Quality gate inference from tool name
// ---------------------------------------------------------------------------

const QUALITY_GATE_RULES = [
  {
    tool: 'smart_fast_apply',
    gates: [{
      prerequisite: 'smart_security',
      condition: 'smart_think mode:beam after security scan',
      message: 'Security fix requires multi-path analysis first. Run smart_think({mode:"beam"}) before applying fixes.',
    }],
  },
  {
    tool: 'smart_cross_file_edit',
    gates: [{
      prerequisite: 'smart_import_graph',
      condition: 'import_graph called in this session',
      message: 'Cross-file edit requires import dependency analysis first. Run ssr({tool:"import_graph"}).',
    }],
  },
];

function inferQualityGates(toolName) {
  const match = QUALITY_GATE_RULES.find(r => r.tool === toolName);
  return match ? match.gates : [];
}

// ---------------------------------------------------------------------------
// Manifest generation from plugin definitions
// ---------------------------------------------------------------------------

/**
 * Generate manifest.json from all loaded plugin definitions.
 * @param {object} options
 * @param {Map} options.toolMap - Map of toolName → plugin definition
 * @param {string} [options.outputPath] - If provided, write manifest.json to this path
 * @returns {object} The generated manifest
 */
export function generateManifest({ toolMap, outputPath }) {
  const tools = [];

  for (const [name, def] of toolMap) {
    const safetyLevel = inferSafetyLevel(name);
    const domain = inferDomain(name);

    tools.push({
      name,
      description: def.description || '',
      category: def.category || 'standard',
      domain,
      safetyLevel,
      routingRules: {
        autoRoute: def.category === 'standard', // core tools are direct-call
        interceptorRequired: safetyLevel === 'critical',
        directCall: def.category === 'core',
        triggerKeywords: [], // populated from hybrid-engine DOMAIN_MAP
      },
      interceptorRules: [],
      qualityGates: inferQualityGates(name),
      responsePolicy: def.responsePolicy || { maxLevel: 0 },
      inputSchema: def.inputSchema || { type: 'object', properties: {} },
    });
  }

  // Sort: core first, then alphabetically
  tools.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'core' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tools,
    autoRoute: { enabled: true },
    interceptor: { enabled: false, defaultAction: 'allow' },
  };

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Manifest loading and validation
// ---------------------------------------------------------------------------

/**
 * Load and validate a manifest.json file.
 * @param {string} manifestPath - Path to manifest.json
 * @returns {object} { ok, manifest?, error? }
 */
export function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `Manifest not found: ${manifestPath}` };
  }

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Cannot read manifest: ${err.message}` };
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }

  const validation = validateManifest(manifest);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return { ok: true, manifest };
}

/**
 * Validate a manifest object against basic structural rules.
 * Does NOT require JSON Schema library — lightweight structural check.
 * @param {object} manifest
 * @returns {object} { ok, error? }
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, error: 'Manifest must be an object' };
  }
  if (!manifest.version || typeof manifest.version !== 'number') {
    return { ok: false, error: 'Manifest must have numeric version' };
  }
  if (!Array.isArray(manifest.tools)) {
    return { ok: false, error: 'Manifest.tools must be an array' };
  }
  if (manifest.tools.length === 0) {
    return { ok: false, error: 'Manifest.tools must not be empty' };
  }

  const names = new Set();
  for (const tool of manifest.tools) {
    if (!tool.name || typeof tool.name !== 'string') {
      return { ok: false, error: 'Each tool must have a string name' };
    }
    if (names.has(tool.name)) {
      return { ok: false, error: `Duplicate tool name: ${tool.name}` };
    }
    names.add(tool.name);
    if (!tool.category || !['core', 'standard'].includes(tool.category)) {
      return { ok: false, error: `Tool ${tool.name}: category must be 'core' or 'standard'` };
    }
  }

  return { ok: true };
}

/**
 * Look up a tool in the manifest by name.
 * @param {object} manifest
 * @param {string} toolName
 * @returns {object|null} Tool entry or null
 */
export function findTool(manifest, toolName) {
  return manifest.tools.find(t => t.name === toolName) || null;
}

/**
 * Get all tools matching a domain.
 * @param {object} manifest
 * @param {string} domain
 * @returns {object[]}
 */
export function getToolsByDomain(manifest, domain) {
  return manifest.tools.filter(t => t.domain === domain);
}

/**
 * Get all tools that support auto-routing.
 * @param {object} manifest
 * @returns {object[]}
 */
export function getAutoRoutableTools(manifest) {
  return manifest.tools.filter(t => t.routingRules?.autoRoute);
}