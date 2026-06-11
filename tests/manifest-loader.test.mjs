// manifest-loader.test.mjs — Phase 15 P1: Manifest generation, loading, validation
//
// Tests: generateManifest, loadManifest, validateManifest, findTool, getToolsByDomain, getAutoRoutableTools

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import because manifest-loader uses ES modules
let generateManifest, loadManifest, validateManifest, findTool, getToolsByDomain, getAutoRoutableTools;

// ---------------------------------------------------------------------------
// Setup: import the module (top-level await)
// ---------------------------------------------------------------------------
const mod = await import('../src/lib/manifest-loader.mjs');
generateManifest = mod.generateManifest;
loadManifest = mod.loadManifest;
validateManifest = mod.validateManifest;
findTool = mod.findTool;
getToolsByDomain = mod.getToolsByDomain;
getAutoRoutableTools = mod.getAutoRoutableTools;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToolMap(tools) {
  const map = new Map();
  for (const t of tools) {
    map.set(t.name, {
      name: t.name,
      description: t.description || '',
      category: t.category || 'standard',
      responsePolicy: t.responsePolicy || { maxLevel: 0 },
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    });
  }
  return map;
}

function tmpManifestPath() {
  return resolve(tmpdir(), `manifest-test-${randomUUID()}.json`);
}

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------
describe('generateManifest', () => {
  it('generates manifest from toolMap', () => {
    const toolMap = makeToolMap([
      { name: 'smart_grep', category: 'core', description: 'Search code' },
      { name: 'smart_test', category: 'core', description: 'Run tests' },
      { name: 'smart_fast_apply', category: 'standard', description: 'Apply patches' },
    ]);
    const manifest = generateManifest({ toolMap });

    assert.equal(manifest.version, 1);
    assert.ok(manifest.generatedAt);
    assert.equal(manifest.tools.length, 3);
    assert.equal(manifest.autoRoute.enabled, true);
    assert.equal(manifest.interceptor.enabled, false);
  });

  it('sorts core tools before standard', () => {
    const toolMap = makeToolMap([
      { name: 'z_standard', category: 'standard' },
      { name: 'a_core', category: 'core' },
      { name: 'b_standard', category: 'standard' },
    ]);
    const manifest = generateManifest({ toolMap });

    assert.equal(manifest.tools[0].category, 'core');
    assert.equal(manifest.tools[0].name, 'a_core');
    assert.equal(manifest.tools[1].category, 'standard');
    assert.equal(manifest.tools[2].category, 'standard');
  });

  it('sorts alphabetically within category', () => {
    const toolMap = makeToolMap([
      { name: 'smart_zeta', category: 'core' },
      { name: 'smart_alpha', category: 'core' },
    ]);
    const manifest = generateManifest({ toolMap });

    assert.equal(manifest.tools[0].name, 'smart_alpha');
    assert.equal(manifest.tools[1].name, 'smart_zeta');
  });

  it('infers safety levels correctly', () => {
    const toolMap = makeToolMap([
      { name: 'smart_grep', category: 'core' },
      { name: 'smart_security', category: 'core' },
      { name: 'smart_fast_apply', category: 'standard' },
      { name: 'smart_exec', category: 'standard' },
    ]);
    const manifest = generateManifest({ toolMap });

    const grep = findTool(manifest, 'smart_grep');
    const security = findTool(manifest, 'smart_security');
    const apply = findTool(manifest, 'smart_fast_apply');
    const exec = findTool(manifest, 'smart_exec');

    assert.equal(grep.safetyLevel, 'low');
    assert.equal(security.safetyLevel, 'high');
    assert.equal(apply.safetyLevel, 'high');
    assert.equal(exec.safetyLevel, 'critical');
  });

  it('infers domains correctly', () => {
    const toolMap = makeToolMap([
      { name: 'smart_grep', category: 'core' },
      { name: 'smart_security', category: 'core' },
      { name: 'smart_git_commit', category: 'standard' },
      { name: 'smart_ingest_document', category: 'standard' },
    ]);
    const manifest = generateManifest({ toolMap });

    assert.equal(findTool(manifest, 'smart_grep').domain, 'search');
    assert.equal(findTool(manifest, 'smart_security').domain, 'security');
    assert.equal(findTool(manifest, 'smart_git_commit').domain, 'git');
    assert.equal(findTool(manifest, 'smart_ingest_document').domain, 'document');
  });

  it('sets routing rules: core = directCall, standard = autoRoute', () => {
    const toolMap = makeToolMap([
      { name: 'smart_grep', category: 'core' },
      { name: 'smart_fast_apply', category: 'standard' },
    ]);
    const manifest = generateManifest({ toolMap });

    const grep = findTool(manifest, 'smart_grep');
    const apply = findTool(manifest, 'smart_fast_apply');

    assert.equal(grep.routingRules.directCall, true);
    assert.equal(grep.routingRules.autoRoute, false);
    assert.equal(apply.routingRules.directCall, false);
    assert.equal(apply.routingRules.autoRoute, true);
  });

  it('adds quality gates for high-risk tools', () => {
    const toolMap = makeToolMap([
      { name: 'smart_fast_apply', category: 'standard' },
      { name: 'smart_cross_file_edit', category: 'standard' },
      { name: 'smart_grep', category: 'core' },
    ]);
    const manifest = generateManifest({ toolMap });

    const apply = findTool(manifest, 'smart_fast_apply');
    const cross = findTool(manifest, 'smart_cross_file_edit');
    const grep = findTool(manifest, 'smart_grep');

    assert.ok(apply.qualityGates.length > 0);
    assert.equal(apply.qualityGates[0].prerequisite, 'smart_security');
    assert.ok(cross.qualityGates.length > 0);
    assert.equal(cross.qualityGates[0].prerequisite, 'smart_import_graph');
    assert.equal(grep.qualityGates.length, 0);
  });

  it('writes to file when outputPath provided', () => {
    const tmpPath = tmpManifestPath();
    const toolMap = makeToolMap([{ name: 'smart_grep', category: 'core' }]);

    generateManifest({ toolMap, outputPath: tmpPath });
    assert.ok(existsSync(tmpPath));

    const loaded = loadManifest(tmpPath);
    assert.ok(loaded.ok);
    assert.equal(loaded.manifest.tools.length, 1);

    unlinkSync(tmpPath);
  });

  it('handles empty toolMap', () => {
    const toolMap = new Map();
    const manifest = generateManifest({ toolMap });

    assert.equal(manifest.tools.length, 0);
    assert.equal(manifest.version, 1);
  });
});

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------
describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    const result = validateManifest({
      version: 1,
      tools: [{ name: 'smart_grep', category: 'core' }],
    });
    assert.ok(result.ok);
  });

  it('rejects non-object', () => {
    assert.equal(validateManifest(null).ok, false);
    assert.equal(validateManifest('string').ok, false);
    assert.equal(validateManifest(42).ok, false);
  });

  it('rejects missing version', () => {
    assert.equal(validateManifest({ tools: [] }).ok, false);
  });

  it('rejects non-numeric version', () => {
    assert.equal(validateManifest({ version: '1', tools: [] }).ok, false);
  });

  it('rejects non-array tools', () => {
    assert.equal(validateManifest({ version: 1, tools: 'not-array' }).ok, false);
  });

  it('rejects empty tools array', () => {
    assert.equal(validateManifest({ version: 1, tools: [] }).ok, false);
  });

  it('rejects tool without name', () => {
    assert.equal(validateManifest({
      version: 1,
      tools: [{ category: 'core' }],
    }).ok, false);
  });

  it('rejects duplicate tool names', () => {
    assert.equal(validateManifest({
      version: 1,
      tools: [
        { name: 'smart_grep', category: 'core' },
        { name: 'smart_grep', category: 'standard' },
      ],
    }).ok, false);
  });

  it('rejects invalid category', () => {
    assert.equal(validateManifest({
      version: 1,
      tools: [{ name: 'smart_grep', category: 'invalid' }],
    }).ok, false);
  });
});

// ---------------------------------------------------------------------------
// loadManifest
// ---------------------------------------------------------------------------
describe('loadManifest', () => {
  it('loads valid manifest from file', () => {
    const tmpPath = tmpManifestPath();
    writeFileSync(tmpPath, JSON.stringify({
      version: 1,
      tools: [{ name: 'smart_grep', category: 'core' }],
    }));

    const result = loadManifest(tmpPath);
    assert.ok(result.ok);
    assert.equal(result.manifest.version, 1);
    assert.equal(result.manifest.tools.length, 1);

    unlinkSync(tmpPath);
  });

  it('returns error for missing file', () => {
    const result = loadManifest('/nonexistent/path/manifest.json');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });

  it('returns error for invalid JSON', () => {
    const tmpPath = tmpManifestPath();
    writeFileSync(tmpPath, '{invalid json');

    const result = loadManifest(tmpPath);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Invalid JSON'));

    unlinkSync(tmpPath);
  });

  it('returns error for invalid manifest structure', () => {
    const tmpPath = tmpManifestPath();
    writeFileSync(tmpPath, JSON.stringify({ version: 1, tools: [] }));

    const result = loadManifest(tmpPath);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not be empty'));

    unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// findTool
// ---------------------------------------------------------------------------
describe('findTool', () => {
  const manifest = {
    version: 1,
    tools: [
      { name: 'smart_grep', category: 'core', domain: 'search' },
      { name: 'smart_test', category: 'core', domain: 'test' },
    ],
  };

  it('finds existing tool', () => {
    const tool = findTool(manifest, 'smart_grep');
    assert.ok(tool);
    assert.equal(tool.domain, 'search');
  });

  it('returns null for missing tool', () => {
    assert.equal(findTool(manifest, 'nonexistent'), null);
  });
});

// ---------------------------------------------------------------------------
// getToolsByDomain
// ---------------------------------------------------------------------------
describe('getToolsByDomain', () => {
  const manifest = {
    version: 1,
    tools: [
      { name: 'smart_grep', category: 'core', domain: 'search' },
      { name: 'smart_github_search', category: 'standard', domain: 'search' },
      { name: 'smart_test', category: 'core', domain: 'test' },
    ],
  };

  it('returns all tools in a domain', () => {
    const searchTools = getToolsByDomain(manifest, 'search');
    assert.equal(searchTools.length, 2);
    assert.equal(searchTools[0].name, 'smart_grep');
    assert.equal(searchTools[1].name, 'smart_github_search');
  });

  it('returns empty array for unknown domain', () => {
    assert.deepEqual(getToolsByDomain(manifest, 'unknown'), []);
  });
});

// ---------------------------------------------------------------------------
// getAutoRoutableTools
// ---------------------------------------------------------------------------
describe('getAutoRoutableTools', () => {
  const manifest = {
    version: 1,
    tools: [
      { name: 'smart_grep', category: 'core', routingRules: { autoRoute: false } },
      { name: 'smart_fast_apply', category: 'standard', routingRules: { autoRoute: true } },
      { name: 'smart_planner', category: 'standard', routingRules: { autoRoute: true } },
    ],
  };

  it('returns only auto-routable tools', () => {
    const autoTools = getAutoRoutableTools(manifest);
    assert.equal(autoTools.length, 2);
    assert.equal(autoTools[0].name, 'smart_fast_apply');
    assert.equal(autoTools[1].name, 'smart_planner');
  });
});

// ---------------------------------------------------------------------------
// Integration: real manifest from loader
// ---------------------------------------------------------------------------
describe('integration: real manifest', () => {
  let manifest;

  before(async () => {
    // The loader was already imported at module level (via manifest-loader import chain)
    // Re-import to get the fully loaded manifest
    const loader = await import('../src/server/loader.mjs');
    // Wait a tick for top-level await to complete
    await new Promise(r => setTimeout(r, 100));
    manifest = loader.toolManifest;
    if (!manifest || !manifest.tools) {
      // Fallback: load from disk
      const { loadManifest: lm } = await import('../src/lib/manifest-loader.mjs');
      const result = lm(resolve(__dirname, '../config/tools/manifest.json'));
      if (result.ok) manifest = result.manifest;
    }
  });

  it('has 50+ tools', () => {
    assert.ok(manifest && manifest.tools, 'Manifest not loaded');
    assert.ok(manifest.tools.length >= 50, `Expected >=50 tools, got ${manifest.tools?.length}`);
  });

  it('has core tools', () => {
    const coreTools = manifest.tools.filter(t => t.category === 'core');
    assert.ok(coreTools.length >= 3, `Expected >=3 core tools, got ${coreTools.length}`);
  });

  it('all tools have valid safety levels', () => {
    const validLevels = ['low', 'medium', 'high', 'critical'];
    for (const tool of manifest.tools) {
      assert.ok(validLevels.includes(tool.safetyLevel), `${tool.name}: invalid safetyLevel ${tool.safetyLevel}`);
    }
  });

  it('all tools have domains', () => {
    for (const tool of manifest.tools) {
      assert.ok(tool.domain, `${tool.name}: missing domain`);
      assert.equal(typeof tool.domain, 'string');
    }
  });

  it('all tools have routingRules', () => {
    for (const tool of manifest.tools) {
      assert.ok(tool.routingRules, `${tool.name}: missing routingRules`);
      assert.equal(typeof tool.routingRules.directCall, 'boolean');
      assert.equal(typeof tool.routingRules.autoRoute, 'boolean');
    }
  });

  it('quality-gated tools have valid prerequisites', () => {
    const gated = manifest.tools.filter(t => t.qualityGates?.length > 0);
    assert.ok(gated.length >= 2, `Expected >=2 gated tools, got ${gated.length}`);
    for (const tool of gated) {
      for (const gate of tool.qualityGates) {
        assert.ok(gate.prerequisite, `${tool.name}: gate missing prerequisite`);
        assert.ok(gate.message, `${tool.name}: gate missing message`);
      }
    }
  });

  it('manifest file exists on disk', () => {
    const manifestPath = resolve(__dirname, '../config/tools/manifest.json');
    assert.ok(existsSync(manifestPath), `Manifest file not found: ${manifestPath}`);
  });
});