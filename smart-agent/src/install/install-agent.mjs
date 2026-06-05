// install-agent.mjs — Agent definition installer for opencode
//
// Automatically installs the smart-mcp agent definition file and
// configures opencode to use it as the default agent.
//
// Usage:
//   node src/install/install-agent.mjs
//   # or imported:
//   import { installAgent } from 'smart-agent/install/install-agent';
//   await installAgent({ smartMcpPath: '/path/to/opencode_smart_mcp' });

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTS_DIR = resolve(homedir(), '.config', 'opencode', 'agents');
const AGENT_FILE = resolve(AGENTS_DIR, 'smart-mcp.md');
const CONFIG_DIR = resolve(homedir(), '.config', 'opencode');
const CONFIG_PATH = resolve(CONFIG_DIR, 'opencode.jsonc');
const MEMORY_DIR = resolve(homedir(), '.smart', 'memory');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the smart-mcp agent definition and configure opencode.
 * @param {object} [options]
 * @param {string} [options.smartMcpPath] - Path to smart-mcp root (auto-detected if omitted)
 * @param {boolean} [options.dryRun] - If true, only print what would be done
 * @returns {{ agentInstalled: boolean, configUpdated: boolean, memoryReady: boolean }}
 */
export async function installAgent(options = {}) {
  const smartMcpPath = options.smartMcpPath || resolveSmartMcpPath();
  const dryRun = options.dryRun || false;

  const result = { agentInstalled: false, configUpdated: false, memoryReady: false };

  // -----------------------------------------------------------------------
  // Step 1: Copy agent definition file
  // -----------------------------------------------------------------------
  const sourceAgent = resolve(smartMcpPath, 'config', 'agents', 'smart-mcp.md');
  if (!existsSync(sourceAgent)) {
    console.error(`❌ Agent definition not found: ${sourceAgent}`);
    console.error('   Make sure config/agents/smart-mcp.md exists in the smart-mcp project.');
    return result;
  }

  if (dryRun) {
    console.log(`📋 Would copy: ${sourceAgent} → ${AGENT_FILE}`);
  } else {
    if (!existsSync(AGENTS_DIR)) {
      mkdirSync(AGENTS_DIR, { recursive: true });
    }
    copyFileSync(sourceAgent, AGENT_FILE);
    console.log(`✅ Agent definition installed: ${AGENT_FILE}`);
  }
  result.agentInstalled = true;

  // -----------------------------------------------------------------------
  // Step 2: Update opencode config
  // -----------------------------------------------------------------------
  if (dryRun) {
    console.log(`📋 Would update: ${CONFIG_PATH} (set default_agent to "smart-mcp")`);
  } else {
    const serverPath = resolve(smartMcpPath, 'src', 'server', 'index.mjs');
    const config = readOrCreateConfig(CONFIG_PATH, serverPath);
    config.default_agent = 'smart-mcp';

    // Ensure MCP server entry exists
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.smart) {
      config.mcp.smart = {
        type: 'local',
        command: ['node', serverPath],
        enabled: true,
      };
    }

    writeConfig(CONFIG_PATH, config);
    console.log(`✅ Config updated: ${CONFIG_PATH} (default_agent = "smart-mcp")`);
  }
  result.configUpdated = true;

  // -----------------------------------------------------------------------
  // Step 3: Ensure memory directory
  // -----------------------------------------------------------------------
  if (dryRun) {
    console.log(`📋 Would create: ${MEMORY_DIR}`);
  } else {
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
      console.log(`✅ Memory directory created: ${MEMORY_DIR}`);
    } else {
      console.log(`✅ Memory directory exists: ${MEMORY_DIR}`);
    }
  }
  result.memoryReady = true;

  return result;
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     Smart MCP — Agent Installation                       ║
╚══════════════════════════════════════════════════════════╝
`);

  const result = await installAgent({ dryRun: process.argv.includes('--dry-run') });

  if (result.agentInstalled && result.configUpdated && result.memoryReady) {
    console.log(`
🎉 Smart MCP agent is ready!

Summary:
  ✅ Agent definition: ~/.config/opencode/agents/smart-mcp.md
  ✅ Default agent : smart-mcp
  ✅ Memory dir    : ~/.smart/memory/

Next step:
  ▶ Restart opencode to start using the smart-mcp agent personality.
`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveSmartMcpPath() {
  // Try to find the smart-mcp project root relative to this script
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),        // smart-agent root → sibling of opencode_smart_mcp
    resolve(homedir(), 'opencode', 'opencode_smart_mcp'),                       // $HOME/opencode/opencode_smart_mcp
    resolve(process.cwd()),                                                      // current working directory
  ];

  for (const candidate of candidates) {
    // Check for the config/agents directory
    const agentPath = resolve(candidate, 'config', 'agents', 'smart-mcp.md');
    if (existsSync(agentPath)) return candidate;

    // Check for server entry
    const serverPath = resolve(candidate, 'src', 'server', 'index.mjs');
    if (existsSync(serverPath)) return candidate;
  }

  // Fallback: assume we're inside the repo
  return process.cwd();
}

function readOrCreateConfig(configPath, serverPath) {
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      // Handle JSONC (strip comments)
      const clean = raw
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      return JSON.parse(clean);
    }
  } catch (e) {
    console.warn(`⚠️  Could not parse existing config, creating new one: ${e.message}`);
  }

  return {
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'smart-mcp',
    mcp: {
      smart: {
        type: 'local',
        command: ['node', serverPath],
        enabled: true,
      },
    },
  };
}

function writeConfig(configPath, config) {
  // Preserve JSONC format if existing file uses it
  const isJsonc = existsSync(configPath) && configPath.endsWith('.jsonc');
  const content = JSON.stringify(config, null, 2) + '\n';

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(configPath, content, 'utf-8');
}

// Run if executed directly
main().catch(console.error);
