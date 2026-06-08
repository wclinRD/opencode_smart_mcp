#!/usr/bin/env bash
# install-skills.sh — 將 Smart MCP 的 skills 部署到 ~/.config/opencode/skills/
#
# 用法:
#   bash install-skills.sh              # symlink 模式（預設，與專案保持同步）
#   bash install-skills.sh --copy       # copy 模式（一次性複製，獨立管理）
#   bash install-skills.sh --list       # 列出將被安裝的 skills
#   bash install-skills.sh --help       # 顯示說明
#
# 安裝位置:
#   skills 來源:  <SMART_DIR>/config/skills/
#   部署目標:    ~/.config/opencode/skills/

set -euo pipefail

# ---- 路徑 ----
SMART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILLS_SRC="$SMART_DIR/config/skills"
SKILLS_DST="$HOME/.config/opencode/skills"
MODE="symlink"

# ---- 解析參數 ----
for arg in "$@"; do
  case "$arg" in
    --copy)   MODE="copy" ;;
    --list)   MODE="list" ;;
    --help)
      echo "Smart MCP Skills Installer"
      echo ""
      echo "用法: bash install-skills.sh [選項]"
      echo ""
      echo "選項:"
      echo "  --copy    用複製取代 symlink（獨立管理，不受專案更新影響）"
      echo "  --list    只列出將被安裝的 skills，不做任何操作"
      echo "  --help    顯示此說明"
      echo ""
      echo "預設行為：建立 symlink，讓 ~/.config/opencode/skills/ 與此專案同步"
      exit 0
      ;;
  esac
done

# ---- 檢查來源目錄 ----
if [ ! -d "$SKILLS_SRC" ]; then
  echo "[錯誤] 找不到 skills 來源目錄: $SKILLS_SRC"
  echo "請確認你是在 smart-mcp 專案目錄下執行此腳本。"
  exit 1
fi

# ---- 收集 skills（排除已知非 skill 檔案） ----
SKILLS=()
while IFS= read -r entry; do
  name=$(basename "$entry")
  # 跳過非 skill 目錄的檔案
  [ "$name" = "install-skills.sh" ] && continue
  [ "$name" = "README.md" ] && continue
  [ "$name" = ".DS_Store" ] && continue
  SKILLS+=("$name")
done < <(find "$SKILLS_SRC" -maxdepth 1 -type d -not -path "$SKILLS_SRC" | sort)
# 也加入 standalone .md skills
while IFS= read -r entry; do
  name=$(basename "$entry")
  [ "$name" = "install-skills.sh" ] && continue
  [ "$name" = "README.md" ] && continue
  SKILLS+=("$name")
done < <(find "$SKILLS_SRC" -maxdepth 1 -type f -name "*.md" | sort)

# ---- --list 模式 ----
if [ "$MODE" = "list" ]; then
  echo "🔧 Smart MCP 可安裝的 Skills (${#SKILLS[@]}):"
  echo ""
  for s in "${SKILLS[@]}"; do
    echo "  • $s"
  done
  echo ""
  echo "安裝目標: $SKILLS_DST"
  exit 0
fi

# ---- 確保目標目錄存在 ----
mkdir -p "$SKILLS_DST"

# ---- 安裝 ----
INSTALLED=0
SKIPPED=0
FAILED=0

echo "📦 安裝 Smart MCP Skills 到 $SKILLS_DST"
echo "   模式: $MODE"
echo ""

for s in "${SKILLS[@]}"; do
  src="$SKILLS_SRC/$s"
  dst="$SKILLS_DST/$s"

  # 檢查是否已存在
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    # 如果已是同一個來源的 symlink，跳過
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
      echo "  ✓ $s (已安裝，版本相同)"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    # 備份已存在的
    echo "  ⚠ $s 已存在於目標目錄，備份為 ${s}.bak.$(date +%s)"
    mv "$dst" "${dst}.bak.$(date +%s)"
  fi

  # 安裝
  if [ "$MODE" = "copy" ]; then
    if cp -R "$src" "$dst" 2>/dev/null; then
      echo "  ✓ $s (已複製)"
      INSTALLED=$((INSTALLED + 1))
    else
      echo "  ✗ $s (複製失敗)"
      FAILED=$((FAILED + 1))
    fi
  else
    if ln -sf "$src" "$dst" 2>/dev/null; then
      echo "  ✓ $s (已建立 symlink → $src)"
      INSTALLED=$((INSTALLED + 1))
    else
      echo "  ✗ $s (symlink 建立失敗)"
      FAILED=$((FAILED + 1))
    fi
  fi
done

# ---- 總結 ----
echo ""
echo "═══════════════════════════════════════"
echo "  安裝完成!"
echo "  新安裝: $INSTALLED  略過: $SKIPPED  失敗: $FAILED"
echo ""
if [ "$MODE" = "symlink" ]; then
  echo "  symlink 模式：skills 會與專案保持同步。"
  echo "  更新專案後執行 git pull，skills 自動更新。"
  echo "  若要改為獨立管理，執行:"
  echo "    bash install-skills.sh --copy"
fi
echo "═══════════════════════════════════════"
