#!/usr/bin/env bash
# tag_taxonomy.sh — 分類法管理器
# 功能：管理標籤分類法，確保標籤一致性
# 使用：bash tag_taxonomy.sh {scan|normalize|suggest|status}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
TAXONOMY_DIR="$VAULT/80-索引"
TAXONOMY_FILE="$TAXONOMY_DIR/_標籤分類法.md"
LOG_DIR="$HOME/.config/opencode/logs"
TAXONOMY_LOG="$LOG_DIR/tag_taxonomy.log"

mkdir -p "$TAXONOMY_DIR" "$LOG_DIR"

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 命令：scan — 掃描所有標籤
cmd_scan() {
  echo "🔍 掃描標籤使用情況"
  echo "=================="

  # 收集所有標籤
  local all_tags
  all_tags=$(grep -rh "tags:" "$VAULT" --include="*.md" 2>/dev/null | \
    grep -oE "tags?:\s*\[.*?\]|tags?:\s*.*" | \
    sed 's/tags\?:\s*\[//;s/\]//;s/tags\?:\s*//' | \
    tr ',' '\n' | \
    sed 's/^ *//;s/ *$//' | \
    grep -v '^$' | \
    sort)

  if [[ -z "$all_tags" ]]; then
    echo "ℹ️ 未找到標籤"
    return 0
  fi

  # 統計標籤使用頻率
  echo ""
  echo "📊 標籤使用統計："
  echo "$all_tags" | uniq -c | sort -rn | head -20 | while read -r count tag; do
    echo "  $tag：$count 次"
  done

  # 檢測相似標籤（可能是拼寫錯誤）
  echo ""
  echo "⚠️ 可能的相似標籤："
  local prev_tag=""
  echo "$all_tags" | while read -r tag; do
    if [[ -n "$prev_tag" ]]; then
      # 簡單相似性檢查（前3字元相同）
      if [[ "${tag:0:3}" == "${prev_tag:0:3}" && "$tag" != "$prev_tag" ]]; then
        echo "  - $prev_tag vs $tag"
      fi
    fi
    prev_tag="$tag"
  done

  echo ""
  echo "📊 總計：$(echo "$all_tags" | wc -l | tr -d ' ') 個唯一標籤"
  echo "$(timestamp) - 掃描標籤完成" >> "$TAXONOMY_LOG"
}

# 命令：normalize — 標準化標籤
cmd_normalize() {
  echo "🔧 標準化標籤"
  echo "============"

  # 定義標準化規則
  declare -A normalize_rules=(
    ["AI"]="ai"
    ["ai"]="ai"
    ["人工智慧"]="ai"
    ["機器學習"]="machine-learning"
    ["machine learning"]="machine-learning"
    ["Machine Learning"]="machine-learning"
    ["deep learning"]="deep-learning"
    ["Deep Learning"]="deep-learning"
    ["安全性"]="security"
    ["security"]="security"
    ["Security"]="security"
  )

  local normalized=0

  for file in "$VAULT"/**/*.md; do
    [[ -f "$file" ]] || continue

    local changed=0
    local content
    content=$(cat "$file")

    for old_tag in "${!normalize_rules[@]}"; do
      local new_tag="${normalize_rules[$old_tag]}"
      if echo "$content" | grep -q "$old_tag"; then
        content=$(echo "$content" | sed "s/$old_tag/$new_tag/g")
        changed=1
        normalized=$((normalized + 1))
      fi
    done

    if [[ $changed -eq 1 ]]; then
      echo "$content" > "$file"
      echo "  ✅ 標準化：${file#$VAULT/}"
    fi
  done

  echo ""
  echo "✅ 標準化 $normalized 個標籤"
  echo "$(timestamp) - 標準化 $normalized 個標籤" >> "$TAXONOMY_LOG"
}

# 命令：suggest — 建議新標籤
cmd_suggest() {
  local content="$1"

  echo "💡 標籤建議"
  echo "=========="

  # 基於內容關鍵詞建議標籤
  local suggestions=()

  if echo "$content" | grep -qi "AI\|machine learning\|neural"; then
    suggestions+=("ai" "machine-learning")
  fi

  if echo "$content" | grep -qi "security\|安全\|隱私"; then
    suggestions+=("security" "privacy")
  fi

  if echo "$content" | grep -qi "database\|資料庫\|SQL"; then
    suggestions+=("database" "data")
  fi

  if echo "$content" | grep -qi "API\|REST\|GraphQL"; then
    suggestions+=("api" "web")
  fi

  if echo "$content" | grep -qi "docker\|kubernetes\|部署"; then
    suggestions+=("devops" "deployment")
  fi

  if [[ ${#suggestions[@]} -gt 0 ]]; then
    echo "基於內容，建議標籤："
    printf '  - %s\n' "${suggestions[@]}"
  else
    echo "ℹ️ 無特定標籤建議"
  fi
}

# 命令：status — 查看分類法狀態
cmd_status() {
  echo "📊 標籤分類法狀態"
  echo "================"

  if [[ -f "$TAXONOMY_FILE" ]]; then
    echo "✅ 分類法文件已建立"
    echo "  📄 位置：$TAXONOMY_FILE"
  else
    echo "ℹ️ 分類法文件尚未建立"
  fi

  echo ""
  echo "📊 標籤使用統計："

  # 統計使用中的標籤
  local active_tags
  active_tags=$(grep -rh "tags:" "$VAULT" --include="*.md" 2>/dev/null | \
    grep -oE "tags?:\s*\[.*?\]|tags?:\s*.*" | \
    sed 's/tags\?:\s*\[//;s/\]//;s/tags\?:\s*//' | \
    tr ',' '\n' | \
    sed 's/^ *//;s/ *$//' | \
    grep -v '^$' | \
    sort -u | \
    wc -l | tr -d ' ')

  echo "  🏷️ 使用中標籤：$active_tags 個"

  # 統計文件數
  local doc_count
  doc_count=$(find "$VAULT" -name "*.md" | wc -l | tr -d ' ')
  echo "  📄 文件總數：$doc_count 個"

  echo ""
  if [[ -f "$TAXONOMY_LOG" ]]; then
    echo "📋 最近操作："
    tail -3 "$TAXONOMY_LOG"
  fi
}

# 主程式
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    scan)
      cmd_scan
      ;;
    normalize)
      cmd_normalize
      ;;
    suggest)
      [[ $# -ge 1 ]] || { echo "用法：$0 suggest <content>"; exit 1; }
      cmd_suggest "$1"
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法：$0 {scan|normalize|suggest|status}"
      echo ""
      echo "命令："
      echo "  scan              — 掃描標籤使用情況"
      echo "  normalize         — 標準化標籤"
      echo "  suggest <content> — 建議新標籤"
      echo "  status            — 查看分類法狀態"
      exit 1
      ;;
  esac
}

main "$@"
