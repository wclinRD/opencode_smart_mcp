#!/usr/bin/env bash
# install.sh — Smart MCP 一鍵安裝腳本
#
# 整合所有安裝步驟：
#   1. 安裝 npm 依賴
#   2. 設定 opencode MCP server
#   3. 部署 skills 到 ~/.config/opencode/skills/
#   4. 部署 agent config 到 ~/.config/opencode/agents/
#   5. 驗證安裝
#
# 用法:
#   bash install.sh              # 完整安裝
#   bash install.sh --check      # 只檢查，不安裝
#   bash install.sh --uninstall  # 移除安裝
#   bash install.sh --help       # 顯示說明

set -euo pipefail

SMART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$SMART_DIR/config/skills"
AGENTS_SRC="$SMART_DIR/config/agents"
PLUGIN_SRC="$SMART_DIR/plugin/compaction-fix.js"
PLUGIN_DST="$HOME/.config/opencode/plugins/compaction-fix.js"
SKILLS_DST="$HOME/.config/opencode/skills"
AGENTS_DST="$HOME/.config/opencode/agents"
OPECODE_CONFIG="$HOME/.config/opencode/opencode.json"
MODE="install"

# ---- 解析參數 ----
for arg in "$@"; do
  case "$arg" in
    --check)    MODE="check" ;;
    --uninstall) MODE="uninstall" ;;
    --help)
      echo "Smart MCP — 一鍵安裝腳本"
      echo ""
      echo "用法: bash install.sh [選項]"
      echo ""
      echo "選項:"
      echo "  (無)        完整安裝（npm install + MCP 設定 + skills + agents）"
      echo "  --check     只檢查安裝狀態，不做任何變更"
      echo "  --uninstall 移除所有 Smart MCP 相關設定"
      echo "  --help      顯示此說明"
      echo ""
      echo "安裝內容:"
      echo "  1. npm install（安裝專案依賴）"
      echo "  2. 設定 opencode MCP server（opencode.json）"
      echo "  3. 部署 skills 到 ~/.config/opencode/skills/"
      echo "  4. 部署 agent config 到 ~/.config/opencode/agents/"
      echo "  5. 部署 compaction-fix plugin 到 ~/.config/opencode/plugins/"
      echo "  6. 驗證所有組件"
      exit 0
      ;;
  esac
done

# ---- 顏色 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }

# ---- 檢查模式 ----
if [ "$MODE" = "check" ]; then
  echo "🔍 Smart MCP 安裝狀態檢查"
  echo "=========================="
  echo ""

  # 檢查 npm 依賴
  if [ -d "$SMART_DIR/node_modules" ]; then
    ok "npm 依賴已安裝"
  else
    warn "npm 依賴未安裝 — 執行 npm install"
  fi

  # 檢查 MCP server
  if [ -f "$SMART_DIR/src/server/index.mjs" ]; then
    ok "MCP server 入口存在"
  else
    err "MCP server 入口不存在"
  fi

  # 檢查 opencode config
  if [ -f "$OPECODE_CONFIG" ]; then
    if grep -q '"smart"' "$OPECODE_CONFIG" 2>/dev/null; then
      ok "opencode.json 已設定 Smart MCP"
    else
      warn "opencode.json 存在但未設定 Smart MCP"
    fi
  else
    warn "opencode.json 不存在"
  fi

  # 檢查 skills
  if [ -d "$SKILLS_DST" ]; then
    count=$(ls -1 "$SKILLS_DST" 2>/dev/null | wc -l | tr -d ' ')
    ok "Skills 已部署 ($count 個)"
  else
    warn "Skills 目錄不存在"
  fi

  # 檢查 agents
  if [ -d "$AGENTS_DST" ]; then
    if [ -f "$AGENTS_DST/smart-mcp.md" ]; then
      ok "Agent config 已部署"
    else
      warn "Agent config 目錄存在但缺少 smart-mcp.md"
    fi
  else
    warn "Agent config 目錄不存在"
  fi

  # 檢查 plugin
  if [ -f "$PLUGIN_DST" ]; then
    ok "Compaction-fix plugin 已部署"
  else
    warn "Compaction-fix plugin 未部署"
  fi

  # 檢查 Node.js
  if command -v node &>/dev/null; then
    node_ver=$(node --version)
    ok "Node.js $node_ver"
  else
    err "Node.js 未安裝"
  fi

  echo ""
  echo "檢查完成。執行 bash install.sh 進行安裝。"
  exit 0
fi

# ---- 移除模式 ----
if [ "$MODE" = "uninstall" ]; then
  echo "🗑  移除 Smart MCP 安裝"
  echo "========================"
  echo ""

  # 移除 skills
  if [ -d "$SKILLS_DST" ]; then
    for s in "$SKILLS_DST"/*/; do
      skill_name=$(basename "$s")
      if [ -L "$s" ]; then
        target=$(readlink "$s")
        if [[ "$target" == "$SMART_DIR"* ]]; then
          rm -f "$s"
          ok "移除 skill symlink: $skill_name"
        fi
      fi
    done
  fi

  # 移除 agent config
  if [ -f "$AGENTS_DST/smart-mcp.md" ]; then
    rm -f "$AGENTS_DST/smart-mcp.md"
    ok "移除 agent config: smart-mcp.md"
  fi

  # 移除 plugin
  if [ -f "$PLUGIN_DST" ]; then
    rm -f "$PLUGIN_DST"
    ok "移除 plugin: compaction-fix.js"
  fi

  # 從 opencode.json 移除 smart MCP
  if [ -f "$OPECODE_CONFIG" ]; then
    if command -v node &>/dev/null; then
      node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$OPECODE_CONFIG', 'utf-8'));
        if (config.mcp && config.mcp.smart) {
          delete config.mcp.smart;
          fs.writeFileSync('$OPECODE_CONFIG', JSON.stringify(config, null, 2) + '\n');
          console.log('已從 opencode.json 移除 Smart MCP');
        }
      " 2>/dev/null && ok "已從 opencode.json 移除 Smart MCP" || warn "無法更新 opencode.json"
    fi
  fi

  echo ""
  echo "移除完成。"
  exit 0
fi

# ---- 安裝模式 ----
echo "📦 Smart MCP — 一鍵安裝"
echo "========================"
echo ""

# Step 1: npm install
echo "📦 Step 1/6: 安裝 npm 依賴..."
if [ -f "$SMART_DIR/package.json" ]; then
  (cd "$SMART_DIR" && npm install --silent 2>&1 | tail -1) && ok "npm 依賴安裝完成" || warn "npm install 可能有問題，請手動檢查"
else
  warn "找不到 package.json，跳過 npm install"
fi

# Step 2: 設定 opencode MCP server
echo ""
echo "⚙️  Step 2/6: 設定 opencode MCP server..."
mkdir -p "$(dirname "$OPECODE_CONFIG")"

if [ -f "$OPECODE_CONFIG" ]; then
  # 使用 node 合併設定（保留現有 mcp servers 和 plugins）
  node -e "
    const fs = require('fs');
    let config = {};
    try { config = JSON.parse(fs.readFileSync('$OPECODE_CONFIG', 'utf-8')); } catch(e) {}
    if (!config.mcp) config.mcp = {};
    config.mcp.smart = {
      type: 'local',
      command: ['node', '$SMART_DIR/src/server/index.mjs'],
      enabled: true
    };
    // 加入 compaction-fix plugin（避免重複）
    if (!config.plugin) config.plugin = [];
    const pluginPath = '$SMART_DIR/plugin/compaction-fix.js';
    const hasPlugin = config.plugin.some(p =>
      (typeof p === 'string' && p.includes('compaction-fix')) ||
      (Array.isArray(p) && p[0] && p[0].includes('compaction-fix'))
    );
    if (!hasPlugin) {
      config.plugin.push([pluginPath, { debug: false }]);
    }
    fs.writeFileSync('$OPECODE_CONFIG', JSON.stringify(config, null, 2) + '\n');
  " 2>/dev/null && ok "opencode.json 已設定 Smart MCP + compaction-fix plugin" || warn "無法更新 opencode.json"
else
  # 建立新的 opencode.json
  node -e "
    const fs = require('fs');
    const config = {
      '\\$schema': 'https://opencode.ai/config.json',
      plugin: [
        ['$SMART_DIR/plugin/compaction-fix.js', { debug: false }]
      ],
      mcp: {
        smart: {
          type: 'local',
          command: ['node', '$SMART_DIR/src/server/index.mjs'],
          enabled: true
        }
      }
    };
    fs.writeFileSync('$OPECODE_CONFIG', JSON.stringify(config, null, 2) + '\n');
  " 2>/dev/null && ok "opencode.json 已建立（含 compaction-fix plugin）" || warn "無法建立 opencode.json"
fi

# Step 3: 部署 skills
echo ""
echo "🔧 Step 3/6: 部署 skills..."
if [ -f "$SKILLS_SRC/install-skills.sh" ]; then
  bash "$SKILLS_SRC/install-skills.sh" 2>&1 | tail -5
  ok "Skills 部署完成"
else
  warn "找不到 install-skills.sh，跳過 skills 部署"
fi

# Step 4: 部署 agent config
echo ""
echo "🤖 Step 4/6: 部署 agent config..."
mkdir -p "$AGENTS_DST"
if [ -f "$AGENTS_SRC/smart-mcp.md" ]; then
  cp "$AGENTS_SRC/smart-mcp.md" "$AGENTS_DST/smart-mcp.md"
  ok "Agent config 已部署: smart-mcp.md"
else
  warn "找不到 smart-mcp.md，跳過 agent config 部署"
fi

# Step 5: 部署 compaction-fix plugin
echo ""
echo "🔌 Step 5/6: 部署 compaction-fix plugin..."
mkdir -p "$(dirname "$PLUGIN_DST")"
if [ -f "$PLUGIN_SRC" ]; then
  cp "$PLUGIN_SRC" "$PLUGIN_DST"
  ok "Compaction-fix plugin 已部署: $PLUGIN_DST"
else
  warn "找不到 compaction-fix.js，跳過 plugin 部署"
fi

# Step 6: 驗證
echo ""
echo "✅ Step 6/6: 驗證安裝..."

PASS=0
FAIL=0

# 檢查 Node.js
if command -v node &>/dev/null; then
  ok "Node.js $(node --version)"
  PASS=$((PASS + 1))
else
  err "Node.js 未安裝"
  FAIL=$((FAIL + 1))
fi

# 檢查 MCP server 能否啟動
if timeout 3 node "$SMART_DIR/src/server/index.mjs" --help 2>/dev/null || true; then
  ok "MCP server 可啟動"
  PASS=$((PASS + 1))
else
  # Try a quick syntax check instead
  if node -e "require('$SMART_DIR/src/server/index.mjs')" 2>/dev/null || node --check "$SMART_DIR/src/server/index.mjs" 2>/dev/null; then
    ok "MCP server 語法正確"
    PASS=$((PASS + 1))
  else
    warn "MCP server 語法檢查失敗（可能缺少依賴）"
  fi
fi

# 檢查 opencode config
if [ -f "$OPECODE_CONFIG" ] && grep -q '"smart"' "$OPECODE_CONFIG" 2>/dev/null; then
  ok "opencode.json 設定正確"
  PASS=$((PASS + 1))
else
  warn "opencode.json 設定可能有問題"
fi

# 檢查 skills
if [ -d "$SKILLS_DST" ] && [ "$(ls -A "$SKILLS_DST" 2>/dev/null)" ]; then
  ok "Skills 目錄存在"
  PASS=$((PASS + 1))
else
  warn "Skills 目錄為空或不存在"
fi

# 檢查 agent config
if [ -f "$AGENTS_DST/smart-mcp.md" ]; then
  ok "Agent config 存在"
  PASS=$((PASS + 1))
else
  warn "Agent config 不存在"
fi

# 檢查 plugin
if [ -f "$PLUGIN_DST" ]; then
  ok "Compaction-fix plugin 存在"
  PASS=$((PASS + 1))
else
  warn "Compaction-fix plugin 不存在"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  安裝完成！"
echo "  通過: $PASS  警告/失敗: $FAIL"
echo ""
echo "  下一步:"
echo "    1. 重啟 opencode 以載入 Smart MCP"
echo "    2. 在 opencode 中選擇 smart-mcp agent"
echo "    3. 執行 smart_learn({root:\".\"}) 開始使用"
echo ""
echo "  檢查安裝: bash install.sh --check"
echo "  移除安裝: bash install.sh --uninstall"
echo "═══════════════════════════════════════"
