#!/usr/bin/env node

// toonify.mjs — Token optimization CLI using TOON format
//
// Wraps toonify-mcp (https://github.com/PCIRCLE-AI/toonify-mcp)
// to optimize structured data (JSON, CSV, YAML) for LLM token efficiency.
//
// Usage:
//   node toonify.mjs optimize <content> [options]
//   node toonify.mjs optimize --file <path> [options]
//   node toonify.mjs stats
//   node toonify.mjs cache-stats
//   node toonify.mjs clear-cache
//   node toonify.mjs cleanup-cache
//   node toonify.mjs count <text>
//
// Options:
//   --tool-name <name>  Tool name for metadata (default: "smart")
//   --format <fmt>      Output: text, json (default: text)
//   --no-color          Disable color output
//   -h, --help          Show this help

import { createRequire } from 'module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the installed toonify-mcp package
const TOONIFY_PATH = resolve('/Users/wclin/toonify-mcp');
const require = createRequire(TOONIFY_PATH);

// ---------------------------------------------------------------------------
// Dynamically import toonify-mcp modules
// ---------------------------------------------------------------------------

let TokenOptimizer;
let MetricsCollector;

async function loadToonify() {
  if (!TokenOptimizer) {
    const optMod = await import(resolve(TOONIFY_PATH, 'dist/optimizer/token-optimizer.js'));
    TokenOptimizer = optMod.TokenOptimizer;
  }
  if (!MetricsCollector) {
    const metMod = await import(resolve(TOONIFY_PATH, 'dist/metrics/metrics-collector.js'));
    MetricsCollector = metMod.MetricsCollector;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdOptimize(content, opts) {
  await loadToonify();
  const optimizer = new TokenOptimizer();
  try {
    const result = await optimizer.optimize(content, {
      toolName: opts.toolName || 'smart',
      size: content.length,
    });

    if (opts.format === 'json') {
      return JSON.stringify(result, null, 2);
    }

    const lines = [];
    const { optimize } = require('../../package.json');
    lines.push('📦 TOON Token Optimization');
    lines.push('='.repeat(50));

    if (result.optimized) {
      const pct = result.savings?.percentage?.toFixed(1) || '?';
      const savedTokens = result.savings?.tokens || 0;
      lines.push('');
      lines.push(`  ✅ Optimized!`);
      lines.push(`  Original tokens:     ${result.originalTokens?.toLocaleString() || '?'}`);
      lines.push(`  Optimized tokens:    ${result.optimizedTokens?.toLocaleString() || '?'}`);
      lines.push(`  Savings:             ${savedTokens.toLocaleString()} tokens (${pct}%)`);
      lines.push(`  Format:              ${result.format || 'unknown'}`);
      if (result.savings?.withCaching) {
        lines.push(`  Cache bonus:         ${result.savings.withCaching.toLocaleString()} tokens`);
      }
      lines.push('');
      lines.push('Optimized content:');
      lines.push('─'.repeat(50));
      lines.push(result.optimizedContent || '(empty)');
    } else {
      lines.push('');
      lines.push(`  ⚠ Not optimized`);
      lines.push(`  Reason: ${result.reason || 'Unknown'}`);
      if (result.originalTokens) {
        lines.push(`  Tokens: ${result.originalTokens.toLocaleString()}`);
      }
    }
    return lines.join('\n');
  } finally {
    optimizer.destroy();
  }
}

async function cmdStats(opts) {
  await loadToonify();
  const metrics = new MetricsCollector();
  const stats = await metrics.getStats();

  if (opts.format === 'json') {
    return JSON.stringify(stats, null, 2);
  }

  const lines = [];
  lines.push('📊 Token Optimization Stats');
  lines.push('='.repeat(50));
  lines.push('');
  lines.push(`  Total Requests:       ${stats.totalRequests}`);
  lines.push(`  Optimized:            ${stats.optimizedRequests}`);
  lines.push(`  Tokens Before:        ${(stats.tokensBeforeOptimization || 0).toLocaleString()}`);
  lines.push(`  Tokens After:         ${(stats.tokensAfterOptimization || 0).toLocaleString()}`);
  lines.push(`  Total Savings:        ${(stats.totalSavings || 0).toLocaleString()}`);
  lines.push(`  Avg Savings:          ${(stats.averageSavingsPercentage || 0).toFixed(1)}%`);
  if (stats.cacheHits !== undefined) {
    lines.push(`  Cache Hits:           ${stats.cacheHits}`);
    lines.push(`  Cache Misses:         ${stats.cacheMisses}`);
    lines.push(`  Cache Hit Rate:       ${((stats.cacheHitRate || 0) * 100).toFixed(1)}%`);
  }
  return lines.join('\n');
}

async function cmdCacheStats(opts) {
  await loadToonify();
  const optimizer = new TokenOptimizer();
  try {
    const stats = optimizer.getCacheStats();

    if (opts.format === 'json') {
      return JSON.stringify(stats, null, 2);
    }

    const lines = [];
    lines.push('🗃️  Cache Statistics');
    lines.push('='.repeat(50));
    lines.push('');
    if (stats.resultCache) {
      lines.push('Result Cache:');
      lines.push(`  Size:   ${stats.resultCache.size || 0}`);
      lines.push(`  Max:    ${stats.resultCache.maxSize || '?'}`);
      lines.push(`  Hits:   ${stats.resultCache.hits || 0}`);
      lines.push(`  Misses: ${stats.resultCache.misses || 0}`);
    }
    if (stats.promptCache) {
      lines.push('');
      lines.push('Prompt Cache:');
      lines.push(`  ${JSON.stringify(stats.promptCache)}`);
    }
    return lines.join('\n');
  } finally {
    optimizer.destroy();
  }
}

async function cmdClearCache(opts) {
  await loadToonify();
  const optimizer = new TokenOptimizer();
  try {
    optimizer.clearResultCache();
    return '✅ Optimization result cache cleared.';
  } finally {
    optimizer.destroy();
  }
}

async function cmdCleanupCache(opts) {
  await loadToonify();
  const optimizer = new TokenOptimizer();
  try {
    const count = optimizer.cleanupExpiredCache();
    return `✅ Cleaned up ${count} expired cache entries.`;
  } finally {
    optimizer.destroy();
  }
}

async function cmdCount(text, opts) {
  await loadToonify();
  const optimizer = new TokenOptimizer();
  try {
    const tokens = optimizer.countTokens(text);

    if (opts.format === 'json') {
      return JSON.stringify({ text: text.substring(0, 100), tokens }, null, 2);
    }

    const chars = text.length;
    return `📝 Token Count: ${tokens.toLocaleString()} tokens (${chars.toLocaleString()} chars)`;
  } finally {
    optimizer.destroy();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const cmdArgs = [];
  const opts = {
    toolName: 'smart',
    format: 'text',
  };

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '--tool-name':
        opts.toolName = args[++i] || 'smart';
        break;
      case '--file':
      case '-f':
        opts.file = args[++i];
        break;
      case '--format':
        opts.format = args[++i];
        break;
      case '--no-color':
        // no-op
        break;
      default:
        if (!args[i].startsWith('--')) {
          cmdArgs.push(args[i]);
        }
        break;
    }
    i++;
  }

  return { command, args: cmdArgs, opts };
}

function printHelp() {
  console.log(`
Usage: node toonify.mjs <command> [options]

Token Optimization Tool (TOON format)

Commands:
  optimize <content>    Optimize structured content (JSON/CSV/YAML)
  optimize --file <p>   Optimize content from file
  stats                 Show optimization statistics
  cache-stats           Show cache statistics
  clear-cache           Clear optimization result cache
  cleanup-cache         Clean up expired cache entries
  count <text>          Count tokens in text

Options:
  --tool-name <name>    Tool name for metadata tracking (default: smart)
  --format <fmt>        Output: text, json (default: text)
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node toonify.mjs optimize '{"key": "value"}'
  node toonify.mjs optimize --file data.json --format json
  node toonify.mjs stats
  node toonify.mjs count "Hello, world! This is a test."
`);
}

async function main() {
  const { command, args: cmdArgs, opts } = parseArgs();

  try {
    let output;
    switch (command) {
      case 'optimize': {
        let content = cmdArgs.join(' ');
        if (opts.file) {
          content = readFileSync(resolve(opts.file), 'utf-8');
        }
        if (!content) {
          // Try reading from stdin
          const stdin = await new Promise((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', (chunk) => { data += chunk; });
            process.stdin.on('end', () => resolve(data));
          });
          content = stdin.trim();
        }
        if (!content) {
          console.error('Error: No content to optimize. Provide content as argument, --file, or pipe stdin.');
          process.exit(1);
        }
        output = await cmdOptimize(content, opts);
        break;
      }
      case 'stats':
        output = await cmdStats(opts);
        break;
      case 'cache-stats':
        output = await cmdCacheStats(opts);
        break;
      case 'clear-cache':
        output = await cmdClearCache(opts);
        break;
      case 'cleanup-cache':
        output = await cmdCleanupCache(opts);
        break;
      case 'count':
        if (cmdArgs.length === 0) {
          console.error('Error: count requires text argument.');
          process.exit(1);
        }
        output = await cmdCount(cmdArgs.join(' '), opts);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
