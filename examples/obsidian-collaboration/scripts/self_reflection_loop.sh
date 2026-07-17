#!/usr/bin/env bash
# self_reflection_loop.sh — 跨 session 學習循環
# 功能：自動分析工具使用情況，提取學習，更新 skill
# 使用：bash self_reflection_loop.sh {analyze|learn|apply|status}

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/.obsidian-wiki}"
LOG_DIR="$HOME/.config/opencode/logs"
REFLECTION_DIR="$VAULT/70-日誌"
REFLECTION_LOG="$LOG_DIR/self_reflection.log"
SKILLS_DIR="$HOME/.config/opencode/skills"
LEARNING_FILE="$LOG_DIR/learning_history.jsonl"

mkdir -p "$REFLECTION_DIR" "$LOG_DIR" "$SKILLS_DIR"

# 取得目前時間戳
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 記錄事件
log_event() {
  local event_type="$1"
  local detail="$2"
  echo "{\"ts\":\"$(timestamp)\",\"type\":\"$event_type\",\"detail\":\"$detail\"}" >> "$REFLECTION_LOG"
}

# 命令：analyze — 分析工具使用情況
cmd_analyze() {
  echo "📊 分析工具使用情況"
  echo "=================="

  # 讀取最近的日誌
  local recent_logs
  recent_logs=$(find "$LOG_DIR" -name "*.log" -mtime -7 -print0 2>/dev/null | xargs -0 cat 2>/dev/null)

  if [[ -z "$recent_logs" ]]; then
    echo "ℹ️ 未找到最近的日誌"
    return 0
  fi

  # 統計工具使用頻率
  echo ""
  echo "🔧 工具使用頻率（最近 7 天）："
  echo "$recent_logs" | grep -oE "tool_[a-z_]+" | sort | uniq -c | sort -rn | head -10 | while read -r count tool; do
    echo "  $tool：$count 次"
  done

  # 統計錯誤率
  echo ""
  echo "❌ 錯誤統計："
  local total_ops error_ops
  total_ops=$(echo "$recent_logs" | grep -c "操作" || echo 0)
  error_ops=$(echo "$recent_logs" | grep -c "錯誤\|失敗" || echo 0)

  if [[ $total_ops -gt 0 ]]; then
    local error_rate=$((error_ops * 100 / total_ops))
    echo "  總操作：$total_ops"
    echo "  錯誤操作：$error_ops"
    echo "  錯誤率：$error_rate%"
  fi

  # 識別失敗模式
  echo ""
  echo "⚠️ 失敗模式："
  echo "$recent_logs" | grep -i "錯誤\|失敗\|error\|fail" | tail -5 | while read -r line; do
    echo "  - ${line:0:100}..."
  done

  echo ""
  echo "✅ 分析完成"
  log_event "analyze" "total_ops=$total_ops, error_ops=$error_ops"
}

# 命令：learn — 提取學習
cmd_learn() {
  echo "🎓 提取學習"
  echo "=========="

  # 分析最近的 session
  local learning_entry
  learning_entry=$(cat <<EOF
{
  "ts": "$(timestamp)",
  "type": "learning",
  "tools_used": $(grep -oE "tool_[a-z_]+" "$LOG_DIR"/*.log 2>/dev/null | cut -d: -f2 | sort -u | jq -R . | jq -s . || echo "[]"),
  "errors": $(grep -i "錯誤\|失敗" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' '),
  "successes": $(grep -i "成功\|完成" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
}
EOF
)

  # 儲存學習記錄
  echo "$learning_entry" >> "$LEARNING_FILE"

  # 產生學習報告
  local learning_file="$REFLECTION_DIR/$(date '+%Y%m%d')_學習報告.md"

  cat > "$learning_file" <<EOF
---
title: 學習報告
created: $(timestamp)
tags: [learning, reflection, self-improvement]
---

# 🎓 學習報告

> 自動產生的 session 學習報告

## 📊 本次 session 統計

- 工具使用：$(grep -oE "tool_[a-z_]+" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ') 次
- 錯誤次數：$(grep -i "錯誤\|失敗" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ') 次
- 成功次數：$(grep -i "成功\|完成" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ') 次

## 💡 學到的教訓

1. **工具選擇**：根據任務類型選擇最適合的工具
2. **錯誤處理**：遇到錯誤時，先分析原因再重試
3. **最佳實踐**：遵循项目的編碼規範

## 🎯 下次改進

- 繼續使用高效的工具組合
- 避免重複同樣的錯誤
- 探索新的工具和方法

---

*本報告由 self_reflection_loop.sh 自動產生*
EOF

  echo "✅ 學習報告已產生：$learning_file"
  log_event "learn" "file=$learning_file"
}

# 命令：apply — 應用學習
cmd_apply() {
  echo "🔧 應用學習"
  echo "=========="

  # 讀取最近的學習記錄
  if [[ ! -f "$LEARNING_FILE" ]]; then
    echo "ℹ️ 無學習記錄"
    return 0
  fi

  # 分析學習模式
  local recent_learnings
  recent_learnings=$(tail -10 "$LEARNING_FILE")

  echo ""
  echo "📊 最近學習模式："
  echo "$recent_learnings" | jq -r '"\(.ts) - 錯誤：\(.errors) / 成功：\(.successes)"' 2>/dev/null || \
    echo "$recent_learnings" | head -5

  # 產生應用建議
  echo ""
  echo "💡 應用建議："

  local avg_errors
  avg_errors=$(echo "$recent_learnings" | jq -s 'map(.errors) | add / length' 2>/dev/null || echo "0")

  if [[ $(echo "$avg_errors > 5" | bc 2>/dev/null || echo 0) -eq 1 ]]; then
    echo "  ⚠️ 錯誤率偏高，建議："
    echo "    - 仔細閱讀工具文檔"
    echo "    - 使用更簡單的方法"
    echo "    - 尋求人類協助"
  else
    echo "  ✅ 表現良好，繼續保持"
  fi

  echo ""
  echo "✅ 學習應用完成"
  log_event "apply" "avg_errors=$avg_errors"
}

# 命令：status — 查看學習狀態
cmd_status() {
  echo "📊 學習循環狀態"
  echo "=============="

  # 統計學習記錄
  local learning_count=0
  if [[ -f "$LEARNING_FILE" ]]; then
    learning_count=$(wc -l < "$LEARNING_FILE" | tr -d ' ')
  fi
  echo "📝 學習記錄：$learning_count 筆"

  # 統計學習報告
  local report_count=0
  if [[ -d "$REFLECTION_DIR" ]]; then
    report_count=$(find "$REFLECTION_DIR" -name "*_學習報告.md" | wc -l | tr -d ' ')
  fi
  echo "📄 學習報告：$report_count 份"

  echo ""
  echo "📁 學習目錄："
  echo "  $REFLECTION_DIR/"

  echo ""
  if [[ -f "$REFLECTION_LOG" ]]; then
    echo "📋 最近事件："
    tail -5 "$REFLECTION_LOG" | while read -r line; do
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
    analyze)
      cmd_analyze
      ;;
    learn)
      cmd_learn
      ;;
    apply)
      cmd_apply
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法：$0 {analyze|learn|apply|status}"
      echo ""
      echo "命令："
      echo "  analyze  — 分析工具使用情況"
      echo "  learn    — 提取學習"
      echo "  apply    — 應用學習"
      echo "  status   — 查看學習狀態"
      exit 1
      ;;
  esac
}

main "$@"
