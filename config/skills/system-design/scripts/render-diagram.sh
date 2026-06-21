#!/bin/bash
# ============================================================
# render-diagram.sh — Harness Engineering 機械化圖表渲染
# 
# 用法:
#   cat diagram.d2 | render-diagram.sh output.png
#   render-diagram.sh input.d2 output.svg
#   render-diagram.sh input.d2              # → input.png
#   render-diagram.sh                       # 互動模式
#
# 依賴: d2 (brew install d2)
# 輸出: SVG (預設) / PNG (指定副檔名)
# ============================================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# --- 顏色 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    echo "用法:"
    echo "  cat input.d2 | $SCRIPT_NAME [output]"
    echo "  $SCRIPT_NAME input.d2 [output]"
    echo ""
    echo "參數:"
    echo "  input.d2   d2 source 檔 (省略則從 stdin 讀)"
    echo "  output     輸出檔路徑 (.svg 或 .png, 預設: input.svg 或 diagram.svg)"
    echo ""
    echo "範例:"
    echo "  cat context.d2 | $SCRIPT_NAME diagram.svg"
    echo "  $SCRIPT_NAME container_view.d2 output.png"
    echo "  $SCRIPT_NAME component_view.d2"
    exit 1
}

# --- 確保 d2 已安裝 ---
if ! command -v d2 &>/dev/null; then
    echo -e "${RED}❌ d2 未安裝。請執行: brew install d2${NC}" >&2
    exit 1
fi

# --- 解析參數 ---
INPUT_FILE=""
OUTPUT_FILE=""

if [ $# -ge 1 ] && [ -f "$1" ]; then
    INPUT_FILE="$1"
    shift
fi

if [ $# -ge 1 ]; then
    OUTPUT_FILE="$1"
    shift
fi

# --- 決定輸出格式 ---
if [ -n "$OUTPUT_FILE" ]; then
    EXT="${OUTPUT_FILE##*.}"
    if [ "$EXT" != "svg" ] && [ "$EXT" != "png" ] && [ "$EXT" != "pdf" ]; then
        echo -e "${YELLOW}⚠️  不支援的格式: $EXT，使用 svg${NC}" >&2
        OUTPUT_FILE="${OUTPUT_FILE}.svg"
    fi
else
    if [ -n "$INPUT_FILE" ]; then
        OUTPUT_FILE="${INPUT_FILE%.*}.svg"
    else
        OUTPUT_FILE="diagram.svg"
    fi
fi

# --- 執行渲染 ---
echo -e "${CYAN}🔧 渲染中...${NC}" >&2

if [ -n "$INPUT_FILE" ]; then
    echo -e "  輸入: ${YELLOW}$INPUT_FILE${NC}" >&2
    echo -e "  輸出: ${GREEN}$OUTPUT_FILE${NC}" >&2
    d2 "$INPUT_FILE" "$OUTPUT_FILE"
else
    echo -e "  輸入: ${YELLOW}stdin${NC}" >&2
    echo -e "  輸出: ${GREEN}$OUTPUT_FILE${NC}" >&2
    d2 - "$OUTPUT_FILE"
fi

echo -e "${GREEN}✅ 渲染完成: $OUTPUT_FILE${NC}" >&2
echo "$OUTPUT_FILE"
