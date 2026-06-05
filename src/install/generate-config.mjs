// generate-config.mjs — Smart Agent configuration generator
//
// Generates an opencode.json configuration file that connects
// opencode to the smart-mcp server. Handles cross-platform paths.
//
// Usage:
//   import { generateOpencodeConfig } from 'smart-agent/install/generate-config';
//   await generateOpencodeConfig();
//   // Writes ~/.config/opencode/opencode.jsonc

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = resolve(homedir(), '.config', 'opencode');
const CONFIG_PATH_JSONC = resolve(CONFIG_DIR, 'opencode.jsonc');

const DEFAULT_CONFIG_TEMPLATE = {
  $schema: 'https://opencode.ai/config.json',
  default_agent: 'smart',
  mcp: {
    smart: {
      type: 'local',
      command: null, // Will be filled in
      enabled: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate opencode config pointing to a smart-mcp installation.
 * @param {object} [options]
 * @param {string} [options.smartMcpPath] - Path to smart-mcp root directory
 * @param {string} [options.outputPath] - Output config path (default: ~/.config/opencode/opencode.jsonc)
 * @param {boolean} [options.merge] - Merge with existing config instead of overwriting
 * @returns {{ configPath: string, serverPath: string }}
 */
export function generateOpencodeConfig(options = {}) {
  const smartMcpPath = options.smartMcpPath || resolveSmartMcpPath();
  const outputPath = options.outputPath || CONFIG_PATH_JSONC;

  // Resolve the server entry point
  const serverPath = resolve(smartMcpPath, 'src', 'server', 'index.mjs');
  if (!existsSync(serverPath)) {
    throw new Error(
      `smart-mcp server not found at ${serverPath}\n` +
      `Please install smart-mcp first or specify smartMcpPath option.`
    );
  }

  let config = { ...DEFAULT_CONFIG_TEMPLATE };
  config.mcp.smart.command = ['node', serverPath];

  // Optionally merge with existing config
  if (options.merge && existsSync(outputPath)) {
    try {
      const existing = JSON.parse(readFileSync(outputPath, 'utf-8'));
      config = {
        ...existing,
        ...config,
        mcp: { ...existing.mcp, ...config.mcp },
      };
    } catch {
      // If existing config is malformed, overwrite
    }
  }

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write config
  writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  return { configPath: outputPath, serverPath };
}

/**
 * Ensure the memory directory exists.
 * @param {string} [dataDir] - Custom data directory (default: ~/.smart)
 * @returns {string} Path to memory directory
 */
export function ensureMemoryDir(dataDir) {
  const smartDir = dataDir || resolve(homedir(), '.smart');
  const memoryDir = resolve(smartDir, 'memory');

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  return memoryDir;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveSmartMcpPath() {
  // Try common locations
  const candidates = [
    // Relative to this package
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'smart-mcp'),
    // Global install
    resolve(homedir(), 'opencode', 'opencode_smart_mcp'),
    // Current directory parent
    resolve(process.cwd(), '..', 'opencode_smart_mcp'),
    // Smart package side-by-side
    resolve(process.cwd(), '..', 'smart-mcp'),
  ];

  for (const candidate of candidates) {
    const serverPath = resolve(candidate, 'src', 'server', 'index.mjs');
    if (existsSync(serverPath)) {
      return candidate;
    }
  }

  // Fallback: assume sibling directory
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'opencode_smart_mcp');
}
