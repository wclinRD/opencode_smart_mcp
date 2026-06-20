#!/usr/bin/env node
// build-agent.mjs — Pre-publish build script for smart-agent npm package
//
// 1. Copies src/agent/core/*.mjs → smart-agent/src/agent/core/
//    (single source of truth: root src/agent/core/)
// 2. Verifies import paths in smart-agent/src/agent/*.mjs use ./core/
// 3. Runs tests to confirm everything works
//
// Usage:
//   node scripts/build-agent.mjs          # build (copy + verify)
//   node scripts/build-agent.mjs --test   # build + run tests
//   node scripts/build-agent.mjs --check  # verify only, no copy

import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const MONOREPO_CORE = resolve(PROJECT_ROOT, '..', 'src', 'agent', 'core');
const PACKAGE_CORE = resolve(PROJECT_ROOT, 'src', 'agent', 'core');
const PACKAGE_WRAPPERS = resolve(PROJECT_ROOT, 'src', 'agent');

function log(msg) { console.log(`[build-agent] ${msg}`); }

function copyCore() {
  log(`Copying core files from ${relative(PROJECT_ROOT, MONOREPO_CORE)} → src/agent/core/`);

  if (!existsSync(MONOREPO_CORE)) {
    console.error(`[build-agent] ERROR: Source core/ not found at ${MONOREPO_CORE}`);
    process.exit(1);
  }

  mkdirSync(PACKAGE_CORE, { recursive: true });

  const files = readdirSync(MONOREPO_CORE).filter(f => f.endsWith('.mjs'));
  for (const file of files) {
    const src = resolve(MONOREPO_CORE, file);
    const dst = resolve(PACKAGE_CORE, file);
    let content = readFileSync(src, 'utf-8');

    // Rewrite: ../../lib/memory-db.mjs → ../../../../src/lib/memory-db.mjs
    // (correct for both monorepo dev and as peerDep of smart-mcp)
    content = content.replaceAll(
      `from '../../lib/memory-db.mjs'`,
      `from '../../../../src/lib/memory-db.mjs'`
    );

    writeFileSync(dst, content, 'utf-8');
    log(`  ✅ ${file} (rewrote ../../lib/ → ../../../../src/lib/ if needed)`);
  }

  log(`Copied ${files.length} core files`);
  return files;
}

function verifyImports() {
  log('Verifying import paths use ./core/ ...');
  let allOk = true;

  const wrappers = readdirSync(PACKAGE_WRAPPERS).filter(f => f.endsWith('.mjs') && f !== 'index.mjs');
  for (const file of wrappers) {
    const content = readFileSync(resolve(PACKAGE_WRAPPERS, file), 'utf-8');
    // Check for problematic cross-boundary imports
    if (content.includes('../../../src/agent/core/')) {
      console.error(`  ❌ ${file}: still has ../../../src/agent/core/ import!`);
      allOk = false;
    } else if (content.includes('./core/')) {
      log(`  ✅ ${file}: uses ./core/`);
    } else {
      log(`  ⚠️  ${file}: no core/ import found (may not need one)`);
    }
  }

  // Also check package entry point
  const entryPoint = resolve(PROJECT_ROOT, 'src', 'index.mjs');
  if (existsSync(entryPoint)) {
    const indexContent = readFileSync(entryPoint, 'utf-8');
    if (indexContent.includes('./core/')) {
      log(`  ✅ src/index.mjs: uses ./core/`);
    }
  }

  return allOk;
}

async function runTests() {
  log('Running smart-agent tests...');
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('node', ['--test', 'tests/*.test.mjs'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    timeout: 60_000,
  });
  return result.status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--check') ? 'check' : args.includes('--test') ? 'test' : 'build';

  log(`Mode: ${mode}`);

  if (mode !== 'check') {
    copyCore();
  }

  const importsOk = verifyImports();
  if (!importsOk) {
    console.error('[build-agent] ❌ Import path verification failed!');
    process.exit(1);
  }

  if (mode === 'test') {
    const testsOk = await runTests();
    if (!testsOk) {
      console.error('[build-agent] ❌ Tests failed!');
      process.exit(1);
    }
    log('✅ All tests passed');
  }

  if (mode === 'check') {
    log('✅ All imports verified: ready for publish');
  } else {
    log(`✅ Build complete: ${mode === 'test' ? 'copied + verified + tests passed' : 'copied + verified'}`);
  }
}

main().catch(err => {
  console.error('[build-agent] Fatal error:', err);
  process.exit(1);
});
