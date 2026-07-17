#!/usr/bin/env bash
# permission_guard.sh — 進出控制守門人
# 功能：控制 AI 助理的進出許可權，所有進出需經人類同意
# 使用：bash permission_guard.sh {enter|exit|approve|status}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
LOG_DIR="$HOME/.config/opencode/logs"
PERM_FILE="$LOG_DIR/permissions.jsonl"
REQ_DIR="$LOG_DIR/permission_requests"

mkdir -p "$LOG_DIR" "$REQ_DIR"

# 生成唯一請求 ID
gen_req_id() {
  echo "req_$(date +%s)_$(shuf -i 1000-9999 -n1)"
}

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 記錄事件
log_event() {
  local event_type="$1"
  local agent="$2"
  local action="$3"
  local status="${4:-pending}"
  echo "{\"ts\":\"$(timestamp)\",\"type\":\"$event_type\",\"agent\":\"$agent\",\"action\":\"$action\",\"status\":\"$status\"}" >> "$PERM_FILE"
}

# 命令：enter — 機器人請求進入
cmd_enter() {
  local agent="$1"
  local target_dir="$2"
  local reason="${3:-無}"
  local req_id
  req_id=$(gen_req_id)

  echo "🔐 進出控制：$agent 請求進入 $target_dir"
  echo ""
  echo "  請求 ID：$req_id"
  echo "  目標目錄：$target_dir"
  echo "  理由：$reason"
  echo "  狀態：⏳ 等待人類審核"
  echo ""
  echo "審核命令：bash permission_guard.sh approve $req_id"
  echo ""

  # 建立請求檔案
  cat > "$REQ_DIR/$req_id.json" <<EOF
{
  "id": "$req_id",
  "agent": "$agent",
  "target_dir": "$target_dir",
  "reason": "$reason",
  "status": "pending",
  "created_at": "$(timestamp)"
}
EOF

  log_event "enter_request" "$agent" "$target_dir" "pending"
  echo "$req_id"
}

# 命令：approve — 人類批准請求
cmd_approve() {
  local req_id="$1"
  local req_file="$REQ_DIR/$req_id.json"

  if [[ ! -f "$req_file" ]]; then
    echo "❌ 找不到請求：$req_id"
    return 1
  fi

  local agent
  agent=$(grep -o '"agent": "[^"]*"' "$req_file" | cut -d'"' -f4)
  local target_dir
  target_dir=$(grep -o '"target_dir": "[^"]*"' "$req_file" | cut -d'"' -f4)

  # 更新請求狀態
  sed -i '' "s/\"status\": \"pending\"/\"status\": \"approved\"/" "$req_file" 2>/dev/null || \
    sed -i "s/\"status\": \"pending\"/\"status\": \"approved\"/" "$req_file" 2>/dev/null

  log_event "enter_approved" "$agent" "$target_dir" "approved"
  echo "✅ 已批准：$agent 進入 $target_dir"
}

# 命令：exit — 機器人離開
cmd_exit() {
  local agent="$1"
  log_event "exit" "$agent" "manual" "completed"
  echo "🚪 $agent 已離開"
}

# 命令：status — 查看目前狀態
cmd_status() {
  echo "📊 進出控制狀態"
  echo "================"

  if [[ -f "$PERM_FILE" ]]; then
    echo ""
    echo "最近記錄（最新 10 筆）："
    tail -10 "$PERM_FILE" | while read -r line; do
      local ts agent action status
      ts=$(echo "$line" | grep -o '"ts": "[^"]*"' | cut -d'"' -f4)
      agent=$(echo "$line" | grep -o '"agent": "[^"]*"' | cut -d'"' -f4)
      action=$(echo "$line" | grep -o '"action": "[^"]*"' | cut -d'"' -f4)
      status=$(echo "$line" | grep -o '"status": "[^"]*"' | cut -d'"' -f4)
      echo "  [$ts] $agent → $action ($status)"
    done
  else
    echo "  （尚無記錄）"
  fi

  echo ""
  echo "待審核請求："
  local pending_count=0
  for f in "$REQ_DIR"/*.json; do
    [[ -f "$f" ]] || continue
    if grep -q '"status": "pending"' "$f"; then
      pending_count=$((pending_count + 1))
      local rid ragent rdir
      rid=$(basename "$f" .json)
      ragent=$(grep -o '"agent": "[^"]*"' "$f" | cut -d'"' -f4)
      rdir=$(grep -o '"target_dir": "[^"]*"' "$f" | cut -d'"' -f4)
      echo "  [$rid] $ragent → $rdir"
    fi
  done
  if [[ $pending_count -eq 0 ]]; then
    echo "  （無待審核請求）"
  fi
}

# 主程式
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    enter)
      [[ $# -ge 2 ]] || { echo "用法：$0 enter <agent> <target_dir> [reason]"; exit 1; }
      cmd_enter "$1" "$2" "${3:-無}"
      ;;
    approve)
      [[ $# -ge 1 ]] || { echo "用法：$0 approve <request_id>"; exit 1; }
      cmd_approve "$1"
      ;;
    exit)
      [[ $# -ge 1 ]] || { echo "用法：$0 exit <agent>"; exit 1; }
      cmd_exit "$1"
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法：$0 {enter|exit|approve|status}"
      echo ""
      echo "命令："
      echo "  enter   <agent> <target_dir> [reason]  — 機器人請求進入"
      echo "  approve <request_id>                     — 人類批准請求"
      echo "  exit    <agent>                          — 機器人離開"
      echo "  status                                   — 查看目前狀態"
      exit 1
      ;;
  esac
}

main "$@"
