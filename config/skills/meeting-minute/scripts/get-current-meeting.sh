#!/bin/bash
# get-current-meeting.sh
# 查詢 macOS Calendar 取得當前進行的會議或即將開始的會議
# 使用 Swift EventKit（比 AppleScript 快 10x+ 且不 hang）
#
# 依賴：EventKit 權限（首次執行時系統會彈出授權對話框）
#
# Usage: $0 [--lookahead MINUTES]

LOOKAHEAD_MINUTES=30

while [[ $# -gt 0 ]]; do
    case $1 in
        --lookahead)
            LOOKAHEAD_MINUTES="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--lookahead MINUTES]"
            echo "  --lookahead  查詢範圍（分鐘），預設 30"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
swift "$SCRIPT_DIR/get-current-events.swift" --lookahead "$LOOKAHEAD_MINUTES" 2>/dev/null
