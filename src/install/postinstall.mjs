// postinstall.mjs — Smart Agent post-install script
//
// Runs after `npm install smart-agent` to:
// 1. Install/update companion skills to ~/.config/opencode/skills/
// 2. Install compaction-fix plugin to ~/.config/opencode/plugins/
// 3. Print setup instructions
//
// Usage: node src/install/postinstall.mjs

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

async function main() {
  // ---- Step 1: 安裝 skills ----
  const installScript = resolve(PROJECT_ROOT, 'config/skills/install-skills.sh');
  if (existsSync(installScript)) {
    console.log('\n🔧 正在安裝 companion skills ...\n');
    const result = spawnSync('bash', [installScript, '--copy'], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      timeout: 15_000,
    });
    if (result.status === 0) {
      console.log('✅ Companion skills 安裝完成！');
    } else {
      console.log('⚠️  skills 安裝未完成（可之後手動執行: bash config/skills/install-skills.sh）');
    }
  }

  // ---- Step 2: 安裝 compaction-fix plugin ----
  const pluginSrc = resolve(PROJECT_ROOT, 'plugin/compaction-fix.js');
  const pluginDstDir = resolve(homedir(), '.config', 'opencode', 'plugins');
  const pluginDst = resolve(pluginDstDir, 'compaction-fix.js');

  if (existsSync(pluginSrc)) {
    console.log('\n🔌 正在安裝 compaction-fix plugin ...\n');
    mkdirSync(pluginDstDir, { recursive: true });
    copyFileSync(pluginSrc, pluginDst);
    console.log(`✅ Compaction-fix plugin 已安裝到 ${pluginDst}`);
  } else {
    console.log('⚠️  找不到 compaction-fix.js，跳過 plugin 安裝');
  }

  // ---- Step 2: 顯示指引 ----
  console.log(`
╔══════════════════════════════════════════════╗
║         Smart Agent — 安裝完成！              ║
╚══════════════════════════════════════════════╝

Smart Agent 已安裝，為 opencode 提供智能工具策略與工作流自動化。

📋 下一步：

  1. 確保 smart-mcp 已在 opencode 中配置：
     ${getConfigPath()}

  2. 確保 skills 已正確連結：
     ls -la ~/.config/opencode/skills/ | head -20

  3. 重啟 opencode

  4. 試試看這些指令：
     • 工具推薦: smart_agent_recommend({ goal: "debug login error" })
     • 自動執行: smart_agent_execute({ goal: "debug login error" })
     • 規劃任務: smart_agent_plan({ goal: "找出所有安全漏洞" })

🔧 自訂選項：
     環境變數 SMART_AGENT_INIT_LEARN=true 可在安裝時自動學習專案慣例
     手動安裝 skills: bash config/skills/install-skills.sh

📖 文件：https://github.com/wclinRD/opencode_smart_mcp
`);
}

function getConfigPath() {
  const configDir = resolve(homedir(), '.config', 'opencode');
  if (existsSync(configDir)) {
    const jsonc = resolve(configDir, 'opencode.jsonc');
    const json = resolve(configDir, 'opencode.json');
    if (existsSync(jsonc)) return jsonc;
    if (existsSync(json)) return json;
  }
  return '~/.config/opencode/opencode.jsonc';
}

main().catch(console.error);
