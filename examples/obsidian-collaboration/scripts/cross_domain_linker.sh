#!/usr/bin/env bash
# cross_domain_linker.sh — 跨域整合索引器
# 功能：建立跨分區的知識地圖，整合分散的知識節點
# 使用：bash cross_domain_linker.sh {scan|rebuild|index|status}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
LOG_DIR="$HOME/.config/opencode/logs"
INDEX_LOG="$LOG_DIR/cross_domain.jsonl"
INDEX_DIR="$VAULT/80-索引"

# 跨域關聯關鍵詞
DOMAIN_KEYWORDS=(
  "AI: artificial intelligence, 機器學習, deep learning, neural"
  "安全: security, 隱私, encryption, 認證"
  "系統: system, architecture, 設計模式, microservice"
  "資料: data, database, SQL, NoSQL"
  "網路: network, API, REST, GraphQL"
  "前端: frontend, UI, UX, React, Vue"
  "後端: backend, server, Node.js, Python"
  "DevOps: CI/CD, Docker, Kubernetes, 部署"
)

mkdir -p "$LOG_DIR" "$INDEX_DIR"

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 記錄事件
log_event() {
  local event_type="$1"
  local detail="$2"
  echo "{\"ts\":\"$(timestamp)\",\"type\":\"$event_type\",\"detail\":\"$detail\"}" >> "$INDEX_LOG"
}

# 從頁面提取標籤
extract_tags() {
  local file="$1"
  grep -oE "tags?:\s*\[.*?\]|tags?:\s*.*" "$file" 2>/dev/null | head -5
}

# 從頁面提取連結
extract_links() {
  local file="$1"
  grep -oE "\[\[.*?\]\]" "$file" 2>/dev/null | head -10
}

# 命令：scan — 掃描所有分區
cmd_scan() {
  echo "🔍 掃描跨域知識節點"
  echo "=================="

  local total_files=0
  local total_links=0
  local domains=()

  # 掃描所有目錄
  for dir in "$VAULT"/*/; do
    [[ -d "$dir" ]] || continue
    local dir_name
    dir_name=$(basename "$dir")

    # 跳過特殊目錄
    [[ "$dir_name" == "80-索引" || "$dir_name" == "85-機器人索引" || "$dir_name" == "89-記憶體" || "$dir_name" == "88-儀表板" ]] && continue

    echo ""
    echo "📁 $dir_name/"

    local file_count=0
    local link_count=0

    while IFS= read -r -d '' file; do
      file_count=$((file_count + 1))
      total_files=$((total_files + 1))

      # 統計連結
      local links
      links=$(grep -c "\[\[" "$file" 2>/dev/null || echo 0)
      link_count=$((link_count + links))
      total_links=$((total_links + links))

      # 檢查是否為跨域頁面
      local rel_path="${file#$VAULT/}"
      for keyword_group in "${DOMAIN_KEYWORDS[@]}"; do
        local domain="${keyword_group%%:*}"
        local keywords="${keyword_group#*:}"

        IFS=',' read -ra kw_array <<< "$keywords"
        for kw in "${kw_array[@]}"; do
          kw=$(echo "$kw" | xargs)  # trim
          if grep -qi "$kw" "$file" 2>/dev/null; then
            domains+=("$domain:$rel_path")
            break
          fi
        done
      done
    done < <(find "$dir" -name "*.md" -print0 2>/dev/null)

    echo "  📄 頁面：$file_count | 🔗 連結：$link_count"
  done

  echo ""
  echo "📊 掃描摘要"
  echo "=========="
  echo "  📄 總頁面數：$total_files"
  echo "  🔗 總連結數：$total_links"
  echo "  🌐 跨域節點：${#domains[@]}"

  # 統計跨域分佈
  if [[ ${#domains[@]} -gt 0 ]]; then
    echo ""
    echo "📈 跨域分佈："
    local unique_domains
    unique_domains=$(printf '%s\n' "${domains[@]}" | cut -d: -f1 | sort | uniq -c | sort -rn)
    echo "$unique_domains" | while read -r count domain; do
      echo "  $domain：$count 個頁面"
    done
  fi

  log_event "scan" "files=$total_files, links=$total_links, cross_domain=${#domains[@]}"
}

# 命令：rebuild — 重建跨域索引
cmd_rebuild() {
  echo "🔄 重建跨域索引"
  echo "=============="

  # 建立主索引頁面
  local index_file="$INDEX_DIR/_跨域知識地圖.md"

  cat > "$index_file" <<EOF
---
title: 跨域知識地圖
created: $(timestamp)
tags: [index, cross-domain, map]
---

# 🗺️ 跨域知識地圖

> 自動產生的跨分區知識整合索引

## 📊 知識分佈

| 分區 | 頁面數 | 連結數 | 跨域連結 |
|------|--------|--------|----------|
EOF

  # 統計每個分區
  for dir in "$VAULT"/*/; do
    [[ -d "$dir" ]] || continue
    local dir_name
    dir_name=$(basename "$dir")

    [[ "$dir_name" == "80-索引" || "$dir_name" == "85-機器人索引" || "$dir_name" == "89-記憶體" || "$dir_name" == "88-儀表板" ]] && continue

    local file_count link_count cross_links
    file_count=$(find "$dir" -name "*.md" | wc -l | tr -d ' ')
    link_count=$(grep -r "\[\[" "$dir" --include="*.md" 2>/dev/null | wc -l | tr -d ' ')
    cross_links=$(grep -r "\[\[" "$dir" --include="*.md" 2>/dev/null | grep -v "$dir_name" | wc -l | tr -d ' ')

    echo "| $dir_name | $file_count | $link_count | $cross_links |" >> "$index_file"
  done

  cat >> "$index_file" <<'EOF'

## 🌐 跨域主題

### AI 與機器學習
EOF

  # 建立主題索引
  for keyword_group in "${DOMAIN_KEYWORDS[@]}"; do
    local domain="${keyword_group%%:*}"
    local keywords="${keyword_group#*:}"

    echo "" >> "$index_file"
    echo "### $domain" >> "$index_file"
    echo "" >> "$index_file"

    IFS=',' read -ra kw_array <<< "$keywords"
    for kw in "${kw_array[@]}"; do
      kw=$(echo "$kw" | xargs)
      # 搜尋包含關鍵詞的頁面
      local matches
      matches=$(grep -rl "$kw" "$VAULT" --include="*.md" 2>/dev/null | head -5 | while read -r f; do
        local rel="${f#$VAULT/}"
        echo "- [[${rel%.md}]]"
      done)

      if [[ -n "$matches" ]]; then
        echo "**$kw：**" >> "$index_file"
        echo "$matches" >> "$index_file"
      fi
    done
  done

  echo ""
  echo "✅ 跨域索引已重建：$index_file"
  log_event "rebuild" "index_file=$index_file"
}

# 命令：index — 顯示跨域索引
cmd_index() {
  echo "📊 跨域知識索引"
  echo "=============="

  local index_file="$INDEX_DIR/_跨域知識地圖.md"

  if [[ -f "$index_file" ]]; then
    echo ""
    head -50 "$index_file"
    echo ""
    echo "... (完整內容見 $index_file)"
  else
    echo "ℹ️ 索引尚未建立，請先執行 rebuild"
  fi
}

# 命令：status — 查看跨域狀態
cmd_status() {
  echo "📊 跨域整合狀態"
  echo "=============="

  local index_file="$INDEX_DIR/_跨域知識地圖.md"

  if [[ -f "$index_file" ]]; then
    echo "✅ 索引已建立"
    echo "  📄 位置：$index_file"
    echo "  📅 建立時間：$(stat -f %Sm "$index_file" 2>/dev/null || stat -c %y "$index_file" 2>/dev/null)"
  else
    echo "ℹ️ 索引尚未建立"
  fi

  echo ""
  echo "📁 跨域分區："
  local dir_count=0
  for dir in "$VAULT"/*/; do
    [[ -d "$dir" ]] || continue
    local dir_name
    dir_name=$(basename "$dir")

    [[ "$dir_name" == "80-索引" || "$dir_name" == "85-機器人索引" || "$dir_name" == "89-記憶體" || "$dir_name" == "88-儀表板" ]] && continue

    dir_count=$((dir_count + 1))
    local file_count
    file_count=$(find "$dir" -name "*.md" | wc -l | tr -d ' ')
    echo "  $dir_name/：$file_count 個頁面"
  done

  echo ""
  echo "📊 總計：$dir_count 個分區"

  if [[ -f "$INDEX_LOG" ]]; then
    echo ""
    echo "📋 最近事件："
    tail -3 "$INDEX_LOG" | while read -r line; do
      local ts event
      ts=$(echo "$line" | grep -o '"ts": "[^"]*"' | cut -d'"' -f4)
      event=$(echo "$line" | grep -o '"type": "[^"]*"' | cut -d'"' -f4)
      echo "  [$ts] $event"
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
    rebuild)
      cmd_rebuild
      ;;
    index)
      cmd_index
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法：$0 {scan|rebuild|index|status}"
      echo ""
      echo "命令："
      echo "  scan      — 掃描跨域知識節點"
      echo "  rebuild   — 重建跨域索引"
      echo "  index     — 顯示跨域索引"
      echo "  status    — 查看跨域狀態"
      exit 1
      ;;
  esac
}

main "$@"
