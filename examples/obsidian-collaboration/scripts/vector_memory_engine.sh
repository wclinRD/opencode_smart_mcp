#!/usr/bin/env bash
# vector_memory_engine.sh — 向量記憶體引擎
# 功能：管理向量記憶體，提供相似性搜尋和知識圖譜
# 使用：bash vector_memory_engine.sh {init|store|search|status|export}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
MEMORY_DIR="$VAULT/89-記憶體"
MEMORY_INDEX="$MEMORY_DIR/_向量索引.md"
MEMORY_DB="$MEMORY_DIR/memory.db"
LOG_DIR="$HOME/.config/opencode/logs"
MEMORY_LOG="$LOG_DIR/vector_memory.jsonl"

mkdir -p "$MEMORY_DIR" "$LOG_DIR"

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 記錄事件
log_event() {
  local event_type="$1"
  local detail="$2"
  echo "{\"ts\":\"$(timestamp)\",\"type\":\"$event_type\",\"detail\":\"$detail\"}" >> "$MEMORY_LOG"
}

# 命令：init — 初始化向量記憶體
cmd_init() {
  echo "🧠 初始化向量記憶體引擎"
  echo "======================"

  # 建立目錄結構
  mkdir -p "$MEMORY_DIR" \
           "$MEMORY_DIR/texts" \
           "$MEMORY_DIR/embeddings" \
           "$MEMORY_DIR/index"

  # 建立索引頁面
  if [[ ! -f "$MEMORY_INDEX" ]]; then
    cat > "$MEMORY_INDEX" <<EOF
---
title: 向量記憶體索引
created: $(timestamp)
tags: [memory, vector, index]
---

# 🧠 向量記憶體索引

> 向量記憶體的索引和說明

## 📊 記憶體統計

| 類型 | 數量 | 最後更新 |
|------|------|----------|
| 文字記憶 | 0 | - |
| 向量索引 | 0 | - |

## 🔍 搜尋方法

1. **語意搜尋**：使用向量相似性找尋相關知識
2. **關鍵詞搜尋**：使用 BM25 找尋精確匹配
3. **混合搜尋**：結合兩種方法

## 📝 記憶格式

每個記憶包含：
- **ID**：唯一識別碼
- **文字**：原始知識內容
- **向量**：語意向量表示
- **元資料**：標籤、來源、時間等
EOF
    echo "✅ 建立索引頁面：$MEMORY_INDEX"
  fi

  # 建立 SQLite 資料庫（如果不存在）
  if [[ ! -f "$MEMORY_DB" ]]; then
    if command -v sqlite3 &>/dev/null; then
      sqlite3 "$MEMORY_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT,
  tags TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  vector BLOB,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
SQL
      echo "✅ 建立 SQLite 資料庫：$MEMORY_DB"
    else
      echo "⚠️ sqlite3 未安裝，使用純文字模式"
    fi
  fi

  echo ""
  echo "✅ 向量記憶體引擎初始化完成"
  log_event "init" "database=$MEMORY_DB"
}

# 命令：store — 儲存記憶
cmd_store() {
  local content="$1"
  local source="${2:-manual}"
  local tags="${3:-}"
  local memory_id="mem_$(date +%s)_$(shuf -i 1000-9999 -n1)"

  echo "💾 儲存記憶"
  echo "=========="

  # 儲存到 SQLite
  if [[ -f "$MEMORY_DB" ]] && command -v sqlite3 &>/dev/null; then
    sqlite3 "$MEMORY_DB" "INSERT INTO memories (id, content, source, tags, created_at, updated_at) VALUES ('$memory_id', '$content', '$source', '$tags', '$(timestamp)', '$(timestamp)');"
    echo "✅ 儲存到資料庫：$memory_id"
  fi

  # 儲存到文字檔案
  local text_file="$MEMORY_DIR/texts/$memory_id.md"
  cat > "$text_file" <<EOF
---
id: $memory_id
source: $source
tags: $tags
created: $(timestamp)
---

$content
EOF
  echo "✅ 儲存到文字：$text_file"

  # 更新索引
  update_index

  log_event "store" "id=$memory_id, source=$source"
  echo "$memory_id"
}

# 命令：search — 搜尋記憶
cmd_search() {
  local query="$1"
  local limit="${2:-10}"

  echo "🔍 搜尋記憶：$query"
  echo "================="

  # 使用 grep 進行文字搜尋
  echo ""
  echo "📝 文字搜尋結果："
  grep -rl "$query" "$MEMORY_DIR/texts/" --include="*.md" 2>/dev/null | head -"$limit" | while read -r file; do
    local rel="${file#$MEMORY_DIR/texts/}"
    local preview
    preview=$(head -20 "$file" | grep -v "^---" | grep -v "^#" | head -3)
    echo "  - $rel"
    echo "    $preview"
  done

  # 使用 SQLite 進行進階搜尋
  if [[ -f "$MEMORY_DB" ]] && command -v sqlite3 &>/dev/null; then
    echo ""
    echo "📊 資料庫搜尋結果："
    sqlite3 "$MEMORY_DB" "SELECT id, substr(content, 1, 100), source, created_at FROM memories WHERE content LIKE '%$query%' LIMIT $limit;" 2>/dev/null | while IFS='|' read -r id content source created; do
      echo "  - [$id] $content..."
      echo "    來源：$source | 時間：$created"
    done
  fi

  log_event "search" "query=$query"
}

# 命令：status — 查看記憶體狀態
cmd_status() {
  echo "📊 向量記憶體狀態"
  echo "================"

  # 統計文字記憶
  local text_count=0
  if [[ -d "$MEMORY_DIR/texts" ]]; then
    text_count=$(find "$MEMORY_DIR/texts" -name "*.md" | wc -l | tr -d ' ')
  fi
  echo "📝 文字記憶：$text_count 筆"

  # 統計資料庫記錄
  local db_count=0
  if [[ -f "$MEMORY_DB" ]] && command -v sqlite3 &>/dev/null; then
    db_count=$(sqlite3 "$MEMORY_DB" "SELECT COUNT(*) FROM memories;" 2>/dev/null || echo 0)
  fi
  echo "🗄️ 資料庫記錄：$db_count 筆"

  echo ""
  echo "📁 記憶體目錄："
  echo "  $MEMORY_DIR/"
  ls -la "$MEMORY_DIR/" 2>/dev/null | grep -E "^d" | awk '{print "    " $NF}'

  echo ""
  if [[ -f "$MEMORY_LOG" ]]; then
    echo "📋 最近事件："
    tail -5 "$MEMORY_LOG" | while read -r line; do
      local ts event
      ts=$(echo "$line" | grep -o '"ts": "[^"]*"' | cut -d'"' -f4)
      event=$(echo "$line" | grep -o '"type": "[^"]*"' | cut -d'"' -f4)
      echo "  [$ts] $event"
    done
  fi
}

# 命令：export — 匯出記憶體
cmd_export() {
  local format="${1:-json}"

  echo "📤 匯出向量記憶體"
  echo "================"

  local export_file="$MEMORY_DIR/export_$(date +%Y%m%d_%H%M%S).$format"

  if [[ "$format" == "json" ]]; then
    # 匯出為 JSON
    echo "[" > "$export_file"
    local first=1
    while IFS= read -r -d '' file; do
      if [[ $first -eq 0 ]]; then
        echo "," >> "$export_file"
      fi
      first=0

      local content
      content=$(cat "$file")
      echo "  {" >> "$export_file"
      echo "    \"file\": \"$(basename "$file")\"," >> "$export_file"
      echo "    \"content\": $(echo "$content" | jq -Rs . 2>/dev/null || echo "\"$content\"")" >> "$export_file"
      echo "  }" >> "$export_file"
    done < <(find "$MEMORY_DIR/texts" -name "*.md" -print0 2>/dev/null)
    echo "]" >> "$export_file"
  else
    # 匯出為 Markdown
    echo "# 向量記憶體匯出" > "$export_file"
    echo "" >> "$export_file"
    echo "匯出時間：$(timestamp)" >> "$export_file"
    echo "" >> "$export_file"

    while IFS= read -r -d '' file; do
      echo "## $(basename "$file" .md)" >> "$export_file"
      echo "" >> "$export_file"
      cat "$file" >> "$export_file"
      echo "" >> "$export_file"
    done < <(find "$MEMORY_DIR/texts" -name "*.md" -print0 2>/dev/null)
  fi

  echo "✅ 匯出完成：$export_file"
  log_event "export" "format=$format, file=$export_file"
}

# 更新索引
update_index() {
  if [[ -f "$MEMORY_INDEX" ]] && [[ -d "$MEMORY_DIR/texts" ]]; then
    local text_count
    text_count=$(find "$MEMORY_DIR/texts" -name "*.md" | wc -l | tr -d ' ')

    # 更新統計表
    sed -i '' "s/| 文字記憶 | [0-9]* |.*|/| 文字記憶 | $text_count | $(date '+%Y-%m-%d') |/" "$MEMORY_INDEX" 2>/dev/null || \
      sed -i "s/| 文字記憶 | [0-9]* |.*|/| 文字記憶 | $text_count | $(date '+%Y-%m-%d') |/" "$MEMORY_INDEX" 2>/dev/null
  fi
}

# 主程式
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    init)
      cmd_init
      ;;
    store)
      [[ $# -ge 1 ]] || { echo "用法：$0 store <content> [source] [tags]"; exit 1; }
      cmd_store "$1" "${2:-manual}" "${3:-}"
      ;;
    search)
      [[ $# -ge 1 ]] || { echo "用法：$0 search <query> [limit]"; exit 1; }
      cmd_search "$1" "${2:-10}"
      ;;
    status)
      cmd_status
      ;;
    export)
      cmd_export "${1:-json}"
      ;;
    *)
      echo "用法：$0 {init|store|search|status|export}"
      echo ""
      echo "命令："
      echo "  init                    — 初始化向量記憶體"
      echo "  store <content> [src]   — 儲存記憶"
      echo "  search <query> [limit]  — 搜尋記憶"
      echo "  status                  — 查看記憶體狀態"
      echo "  export [format]         — 匯出記憶體"
      exit 1
      ;;
  esac
}

main "$@"
