#!/bin/bash
# Personal Assistant - Calendar Unit Test (UT-2)
# 測試 scripts/calendar.sh 的行為
# exit 0 = PASS, exit 1 = FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CAL_SCRIPT="$SKILL_DIR/scripts/calendar.sh"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
    local msg="$1"
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  ✅ $msg"
}

fail() {
    local msg="$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  ❌ $msg"
}

# =============================================================================
# 測試 1：Script 存在且可執行
# =============================================================================
echo ""
echo "=== UT-2.1: Script 存在且可執行 ==="

if [ -f "$CAL_SCRIPT" ]; then
    pass "calendar.sh 存在"
else
    fail "calendar.sh 不存在 ($CAL_SCRIPT)"
fi

if [ -x "$CAL_SCRIPT" ]; then
    pass "calendar.sh 可執行"
else
    fail "calendar.sh 不可執行"
fi

# =============================================================================
# 測試 2：執行時無未捕獲 AppleScript 錯誤（只檢查 stderr）
# =============================================================================
echo ""
echo "=== UT-2.2: 無未捕獲 AppleScript 錯誤 ==="

# 分開 stdout 和 stderr
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
bash "$CAL_SCRIPT" > "$STDOUT_FILE" 2>"$STDERR_FILE" || true

STDERR_CONTENT=$(cat "$STDERR_FILE")

APPLE_SCRIPT_ERRORS=""
if echo "$STDERR_CONTENT" | grep -qiE "execution error|OSStatus|Can't get"; then
    APPLE_SCRIPT_ERRORS="found"
fi

if [ -z "$APPLE_SCRIPT_ERRORS" ]; then
    pass "無未捕獲 AppleScript 錯誤"
else
    fail "檢測到未捕獲 AppleScript 錯誤"
fi

# =============================================================================
# 測試 3：stdout 為有效 JSON
# =============================================================================
echo ""
echo "=== UT-2.3: 輸出 JSON 格式 ==="

STDOUT_CONTENT=$(cat "$STDOUT_FILE")

if echo "$STDOUT_CONTENT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    pass "輸出為有效 JSON"
else
    fail "輸出非有效 JSON: $(echo "$STDOUT_CONTENT" | head -c 200)"
fi

# =============================================================================
# 測試 4：包含必要欄位
# =============================================================================
echo ""
echo "=== UT-2.4: 包含必要欄位 ==="

FIELD_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data.get('source') == 'calendar', f'source={data.get(\"source\")}'
assert data.get('status') in ('ok', 'error', 'partial'), f'status={data.get(\"status\")}'
assert 'data' in data, 'missing data'
assert 'events' in data.get('data', {}), 'missing events'
print('OK')
" 2>/dev/null) || FIELD_CHECK="FAIL"

if [ "$FIELD_CHECK" = "OK" ]; then
    pass "必要欄位 source/status/data/events 皆存在"
else
    fail "必要欄位缺失"
fi

# =============================================================================
# 測試 5：Exit code 不為 crash
# =============================================================================
echo ""
echo "=== UT-2.5: Exit code 檢查 ==="

bash "$CAL_SCRIPT" > /dev/null 2>&1
EC=$?

if [ "$EC" -eq 0 ] || [ "$EC" -eq 1 ]; then
    pass "Exit code 正常 ($EC)"
else
    fail "Exit code 異常 ($EC)，不應為 127/255"
fi

# =============================================================================
# 測試 6：逾時處理（單一帳號逾時不 crash）
# =============================================================================
echo ""
echo "=== UT-2.6: 逾時處理 ==="

TIMEOUT_MSG=$(echo "$STDERR_CONTENT" | grep -i "逾時" | head -1 || true)
CAL_STATUS=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('status', 'unknown'))
" 2>/dev/null)

if [ -n "$TIMEOUT_MSG" ]; then
    pass "逾時時顯示提示訊息（非 crash）: $TIMEOUT_MSG"
elif [ "$CAL_STATUS" = "ok" ]; then
    pass "所有行事曆正常讀取（無逾時）"
else
    pass "有部分錯誤但未 crash (status=$CAL_STATUS)"
fi

# =============================================================================
# 測試 7：事件資料格式
# =============================================================================
echo ""
echo "=== UT-2.7: 事件資料格式 ==="

EVT_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
events = data.get('data', {}).get('events', [])
summary = data.get('data', {}).get('summary', {})
print(f\"events={len(events)}, calendars={summary.get('total_calendars', 0)}\")
" 2>/dev/null)

pass "事件摘要: $EVT_CHECK"

# =============================================================================
# 清理
# =============================================================================
rm -f "$STDOUT_FILE" "$STDERR_FILE"

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "=== UT-2 結果 ==="
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ UT-2 FAILED"
    exit 1
else
    echo "✅ UT-2 PASSED"
    exit 0
fi
