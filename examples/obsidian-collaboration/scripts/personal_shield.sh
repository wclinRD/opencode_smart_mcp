#!/usr/bin/env bash
# personal_shield.sh — 個人資料遮罩守衛
# 功能：確保 60-個人/ 中的私人資料不被暴露給其他 AI 助理
# 使用：bash personal_shield.sh {scan|protect|check|unprotect|status}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
LOG_DIR="$HOME/.config/opencode/logs"
SHIELD_LOG="$LOG_DIR/shield.jsonl"

# 個人目錄
PERSONAL_ZONE="60-個人"

# 敏感詞模式（可自定義）
SENSITIVE_PATTERNS=(
  "password"
  "密碼"
  "api_key"
  "API Key"
  "token"
  "secret"
  "信用卡"
  "身分證"
  "帳號"
)

mkdir -p "$LOG_DIR"

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 記錄事件
log_event() {
  local event_type="$1"
  local target="$2"
  local status="$3"
  local detail="${4:-}"
  echo "{\"ts\":\"$(timestamp)\",\"type\":\"$event_type\",\"target\":\"$target\",\"status\":\"$status\",\"detail\":\"$detail\"}" >> "$SHIELD_LOG"
}

# 掃描敏感資料
scan_sensitive() {
  local file="$1"
  local found=0

  for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    if grep -qi "$pattern" "$file" 2>/dev/null; then
      echo "  ⚠️ 發現敏感詞：$pattern"
      found=1
    fi
  done

  return $found
}

# 命令：scan — 掃描個人目錄
cmd_scan() {
  echo "🔍 掃描個人資料目錄"
  echo "=================="

  local zone_path="$VAULT/$PERSONAL_ZONE"

  if [[ ! -d "$zone_path" ]]; then
    echo "ℹ️ 個人目錄不存在：$PERSONAL_ZONE/"
    return 0
  fi

  echo ""
  echo "📁 $PERSONAL_ZONE/"

  local file_count
  file_count=$(find "$zone_path" -name "*.md" | wc -l | tr -d ' ')
  echo "  📄 頁面數：$file_count"

  # 掃描每個頁面
  local issues=0
  while IFS= read -r -d '' file; do
    local rel_path="${file#$VAULT/}"
    echo ""
    echo "  📄 $rel_path"

    # 檢查是否有保護標記
    if grep -q "personal-protected\|private\|🔒" "$file" 2>/dev/null; then
      echo "    ✅ 已有保護標記"
    else
      echo "    ⚠️ 缺少保護標記"
      issues=$((issues + 1))
    fi

    # 掃描敏感資料
    if scan_sensitive "$file"; then
      issues=$((issues + 1))
    fi
  done < <(find "$zone_path" -name "*.md" -print0 2>/dev/null)

  echo ""
  if [[ $issues -gt 0 ]]; then
    echo "⚠️ 發現 $issues 個潛在問題"
    log_event "scan_issues" "$PERSONAL_ZONE" "warning" "$issues issues"
  else
    echo "✅ 掃描完成，無問題"
    log_event "scan_clean" "$PERSONAL_ZONE" "ok"
  fi
}

# 命令：protect — 為頁面添加保護標記
cmd_protect() {
  local target="${1:-$PERSONAL_ZONE}"
  local zone_path="$VAULT/$target"

  echo "🔒 添加保護標記"
  echo "==============="

  if [[ ! -d "$zone_path" ]]; then
    echo "❌ 目錄不存在：$target"
    return 1
  fi

  local protected=0
  while IFS= read -r -d '' file; do
    if ! grep -q "personal-protected\|private\|🔒" "$file" 2>/dev/null; then
      # 在 frontmatter 中添加保護標記
      if grep -q "^---" "$file" 2>/dev/null; then
        # 有 frontmatter，在第二個 --- 前插入
        sed -i '' '0,/^---$/{/^---$/a\
visibility: private\
tags: [personal, private, 🔒]
}' "$file" 2>/dev/null || \
        sed -i '0,/^---$/{/^---$/a\
visibility: private\
tags: [personal, private, 🔒]
}' "$file" 2>/dev/null
      else
        # 無 frontmatter，在檔案開頭添加
        {
          echo "---"
          echo "visibility: private"
          echo "tags: [personal, private, 🔒]"
          echo "---"
          echo ""
          cat "$file"
        } > "$file.tmp" && mv "$file.tmp" "$file"
      fi

      echo "  ✅ 已保護：${file#$VAULT/}"
      protected=$((protected + 1))
    fi
  done < <(find "$zone_path" -name "*.md" -print0 2>/dev/null)

  echo ""
  echo "✅ 已保護 $protected 個頁面"
  log_event "protect" "$target" "ok" "$protected pages"
}

# 命令：check — 檢查路徑是否在個人區域
cmd_check() {
  local target="$1"

  if [[ "$target" == "$PERSONAL_ZONE"* ]]; then
    echo "🔒 $target 位於個人區域"
    echo "  ⚠️ 此區域為私人資料，不應暴露給其他 AI 助理"

    # 檢查是否有保護標記
    local zone_path="$VAULT/$target"
    if [[ -f "$zone_path" ]]; then
      if grep -q "personal-protected\|private\|🔒" "$zone_path" 2>/dev/null; then
        echo "  ✅ 已有保護標記"
      else
        echo "  ⚠️ 缺少保護標記"
      fi
    fi

    return 0
  else
    echo "✅ $target 不在個人區域"
    return 1
  fi
}

# 命令：unprotect — 移除保護標記（僅限本人）
cmd_unprotect() {
  local target="$1"
  local zone_path="$VAULT/$target"

  echo "🔓 移除保護標記"
  echo "==============="

  if [[ ! -f "$zone_path" ]]; then
    echo "❌ 檔案不存在：$target"
    return 1
  fi

  # 移除 visibility 和 tags 中的 private 標記
  sed -i '' '/^visibility: private$/d' "$zone_path" 2>/dev/null || \
    sed -i '/^visibility: private$/d' "$zone_path" 2>/dev/null

  sed -i '' '/^tags:.*private/d' "$zone_path" 2>/dev/null || \
    sed -i '/^tags:.*private/d' "$zone_path" 2>/dev/null

  echo "✅ 已移除保護標記：$target"
  log_event "unprotect" "$target" "ok"
}

# 命令：status — 查看保護狀態
cmd_status() {
  echo "📊 個人資料保護狀態"
  echo "=================="

  local zone_path="$VAULT/$PERSONAL_ZONE"

  if [[ ! -d "$zone_path" ]]; then
    echo "ℹ️ 個人目錄不存在"
    return 0
  fi

  echo ""
  echo "📁 $PERSONAL_ZONE/"

  local file_count protected_count=0
  file_count=$(find "$zone_path" -name "*.md" | wc -l | tr -d ' ')
  echo "  📄 總頁面數：$file_count"

  # 統計已保護頁面
  while IFS= read -r -d '' file; do
    if grep -q "personal-protected\|private\|🔒" "$file" 2>/dev/null; then
      protected_count=$((protected_count + 1))
    fi
  done < <(find "$zone_path" -name "*.md" -print0 2>/dev/null)

  echo "  🔒 已保護：$protected_count"

  if [[ $file_count -gt 0 && $protected_count -lt $file_count ]]; then
    echo "  ⚠️ 有 $((file_count - protected_count)) 個頁面未保護"
  else
    echo "  ✅ 所有頁面已保護"
  fi

  echo ""
  if [[ -f "$SHIELD_LOG" ]]; then
    echo "📋 最近事件："
    tail -5 "$SHIELD_LOG" | while read -r line; do
      local ts event target
      ts=$(echo "$line" | grep -o '"ts": "[^"]*"' | cut -d'"' -f4)
      event=$(echo "$line" | grep -o '"type": "[^"]*"' | cut -d'"' -f4)
      target=$(echo "$line" | grep -o '"target": "[^"]*"' | cut -d'"' -f4)
      echo "  [$ts] $event → $target"
    done
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
    protect)
      cmd_protect "${1:-$PERSONAL_ZONE}"
      ;;
    check)
      [[ $# -ge 1 ]] || { echo "用法：$0 check <path>"; exit 1; }
      cmd_check "$1"
      ;;
    unprotect)
      [[ $# -ge 1 ]] || { echo "用法：$0 unprotect <path>"; exit 1; }
      cmd_unprotect "$1"
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法：$0 {scan|protect|check|unprotect|status}"
      echo ""
      echo "命令："
      echo "  scan                — 掃描個人目錄"
      echo "  protect [path]      — 添加保護標記"
      echo "  check <path>        — 檢查路徑是否在個人區域"
      echo "  unprotect <path>    — 移除保護標記"
      echo "  status              — 查看保護狀態"
      exit 1
      ;;
  esac
}

main "$@"
