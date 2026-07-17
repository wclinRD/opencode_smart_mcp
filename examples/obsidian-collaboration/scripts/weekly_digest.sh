#!/usr/bin/env bash
# weekly_digest.sh — 週報產生器
# 功能：自動產生本週知識更新摘要
# 使用：bash weekly_digest.sh [weeks_back]

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
DIGEST_DIR="$VAULT/70-日誌/72-週-月回顧"
LOG_DIR="$HOME/.config/opencode/logs"
DIGEST_LOG="$LOG_DIR/weekly_digest.log"

weeks_back="${1:-0}"
target_date=$(date -v-"${weeks_back}"w '+%Y年%m月第%W週' 2>/dev/null || date -d "-${weeks_back} weeks" '+%Y年%m月第%W週' 2>/dev/null || echo "本週")
file_date=$(date -v-"${weeks_back}"w '+%Y%m%d' 2>/dev/null || date -d "-${weeks_back} weeks" '+%Y%m%d' 2>/dev/null || date '+%Y%m%d')

mkdir -p "$DIGEST_DIR" "$LOG_DIR"

echo "📊 產生週報：$target_date"
echo "========================="

# 掃描本週修改的頁面
echo ""
echo "🔍 掃描本週知識更新..."

modified_files=()
while IFS= read -r -d '' file; do
  modified_files+=("$file")
done < <(find "$VAULT" -name "*.md" -mtime -7 -print0 2>/dev/null)

echo "  📄 本週修改頁面：${#modified_files[@]} 個"

# 分類統計
new_pages=0
updated_pages=0
robot_pages=0
personal_pages=0

for file in "${modified_files[@]}"; do
  rel="${file#$VAULT/}"
  if [[ "$rel" == 10-感知層/* ]]; then
    robot_pages=$((robot_pages + 1))
  elif [[ "$rel" == 60-個人/* ]]; then
    personal_pages=$((personal_pages + 1))
  fi

  # 檢查是否為新建頁面（7天內建立）
  if [[ $(find "$file" -mtime -7 -print 2>/dev/null | wc -l | tr -d ' ') -gt 0 ]]; then
    new_pages=$((new_pages + 1))
  else
    updated_pages=$((updated_pages + 1))
  fi
done

# 產生週報
digest_file="$DIGEST_DIR/${file_date}_週報.md"

cat > "$digest_file" <<EOF
# 📊 本週知識更新摘要 — $target_date

> 自動產生於 $(date '+%Y-%m-%d %H:%M:%S')

## 📈 更新統計

| 指標 | 數量 |
|------|------|
| 總修改頁面 | ${#modified_files[@]} |
| 新建頁面 | $new_pages |
| 更新頁面 | $updated_pages |
| 機器人專區 | $robot_pages |
| 個人資料 | $personal_pages |

## 📝 更新內容

### 新建頁面
EOF

# 列出新建頁面
new_count=0
for file in "${modified_files[@]}"; do
  rel="${file#$VAULT/}"
  if [[ $(find "$file" -mtime -7 -print 2>/dev/null | wc -l | tr -d ' ') -gt 0 ]]; then
    echo "- [[${rel%.md}]]" >> "$digest_file"
    new_count=$((new_count + 1))
    if [[ $new_count -ge 10 ]]; then
      echo "- ... 更多" >> "$digest_file"
      break
    fi
  fi
done

if [[ $new_count -eq 0 ]]; then
  echo "- （本週無新建頁面）" >> "$digest_file"
fi

cat >> "$digest_file" <<'EOF'

### 更新頁面
EOF

# 列出更新頁面
update_count=0
for file in "${modified_files[@]}"; do
  rel="${file#$VAULT/}"
  if [[ $(find "$file" -mtime -7 -print 2>/dev/null | wc -l | tr -d ' ') -eq 0 ]]; then
    echo "- [[${rel%.md}]]" >> "$digest_file"
    update_count=$((update_count + 1))
    if [[ $update_count -ge 10 ]]; then
      echo "- ... 更多" >> "$digest_file"
      break
    fi
  fi
done

if [[ $update_count -eq 0 ]]; then
  echo "- （本週無更新頁面）" >> "$digest_file"
fi

cat >> "$digest_file" <<EOF

## 🏷️ 熱門標籤

EOF

# 統計熱門標籤
echo "📊 統計熱門標籤..."
grep -rh "tags:" "$VAULT" --include="*.md" 2>/dev/null | \
  grep -oE "tags?:\s*\[.*?\]" | \
  sed 's/tags\?:\s*\[//;s/\]//' | \
  tr ',' '\n' | \
  sed 's/^ *//;s/ *$//' | \
  sort | uniq -c | sort -rn | head -10 | \
  while read -r count tag; do
    if [[ -n "$tag" ]]; then
      echo "- **$tag**：$count 次" >> "$digest_file"
    fi
  done

cat >> "$digest_file" <<EOF

## 💡 本週洞察

- 本週共更新 ${#modified_files[@]} 個頁面
- 機器人專區貢獻 $robot_pages 個頁面
- 個人資料區更新 $personal_pages 個頁面

---

*本週報由 weekly_digest.sh 自動產生*
EOF

echo ""
echo "✅ 週報已產生：$digest_file"
echo "📄 共 ${#modified_files[@]} 個頁面更新"
echo ""
echo "💡 查看週報："
echo "   cat \"$digest_file\""

# 記錄到日誌
echo "$(date '+%Y-%m-%d %H:%M:%S') - 產生週報：$target_date（${#modified_files[@]} 個頁面）" >> "$DIGEST_LOG"
