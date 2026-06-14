// build-agent.mjs — 發布前自動打包 core/ 並修正 import 路徑
//
// 開發時 smart-agent 的 import 路徑是 ../../../src/agent/core/
// 發布時需要把 core/ 複製到 smart-agent/src/agent/core/ 並改為 ./core/
//
// Usage: node scripts/build-agent.mjs

import { cpSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CORE_SRC = resolve(ROOT, '..', 'src', 'agent', 'core');
const CORE_DEST = resolve(ROOT, 'src', 'agent', 'core');
const AGENT_DIR = resolve(ROOT, 'src', 'agent');

// Step 1: 複製 core/ 到 smart-agent 內部
console.log('📦 Copying core/ to smart-agent...');
if (!existsSync(CORE_SRC)) {
  console.error(`❌ Core source not found: ${CORE_SRC}`);
  process.exit(1);
}
cpSync(CORE_SRC, CORE_DEST, { recursive: true });
console.log(`✅ Core copied: ${CORE_SRC} → ${CORE_DEST}`);

// Step 2: 修正 import 路徑
const files = readdirSync(AGENT_DIR).filter(f => f.endsWith('.mjs'));
for (const file of files) {
  const filePath = resolve(AGENT_DIR, file);
  let content = readFileSync(filePath, 'utf-8');

  if (content.includes("../../../src/agent/core/")) {
    content = content.replace(/\.\.\/\.\.\/\.\.\/src\/agent\/core\//g, './core/');
    writeFileSync(filePath, content, 'utf-8');
    console.log(`🔧 Fixed imports: ${file}`);
  }
}

console.log('🎉 Build complete! smart-agent is ready for publish.');