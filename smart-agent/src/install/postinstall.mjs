// postinstall.mjs — Smart Agent post-install script
//
// Runs after `npm install smart-agent` to:
// 1. Print setup instructions
// 2. Optionally detect project type
// 3. Optionally generate opencode config
//
// Usage: node src/install/postinstall.mjs
//        node src/install/postinstall.mjs --setup-agent  (also install agent definition)

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║         Smart Agent — 安裝完成！              ║
╚══════════════════════════════════════════════╝

Smart Agent 已安裝，為 opencode 提供智能工具策略與工作流自動化。

📋 下一步：

  1. 安裝 Smart MCP agent personality（讓 opencode 懂得用 30+ 工具）：
     node src/install/install-agent.mjs

  2. 確保 smart-mcp 已在 opencode 中配置：
     ${getConfigPath()}

  3. 重啟 opencode

  4. 試試看這些指令（需先註冊 smart-agent MCP tools）：
     • 工具推薦: smart_agent_recommend({ goal: "debug login error" })
     • 自動執行: smart_agent_execute({ goal: "debug login error" })
     • 規劃任務: smart_agent_plan({ goal: "找出所有安全漏洞" })

🔧 自訂選項：
    環境變數 SMART_AGENT_INIT_LEARN=true 可在安裝時自動學習專案慣例

📖 文件：https://github.com/wclinRD/opencode_smart_mcp
`);

  // Optionally run agent setup
  if (process.argv.includes('--setup-agent')) {
    console.log('🔄 Installing agent personality...\n');
    const { installAgent } = await import('./install-agent.mjs');
    await installAgent();
  }
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
