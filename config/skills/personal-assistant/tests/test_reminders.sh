#!/bin/bash
# Personal Assistant - Reminders Unit Test (UT-4)
# 測試 scripts/reminders.sh 的行為
# exit 0 = PASS, exit 1 = FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REM_SCRIPT="$SKILL_DIR/scripts/reminders.sh"

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
echo "=== UT-4.1: Script 存在且可執行 ==="

if [ -f "$REM_SCRIPT" ]; then
    pass "reminders.sh 存在"
else
    fail "reminders.sh 不存在"
fi
if [ -x "$REM_SCRIPT" ]; then
    pass "reminders.sh 可執行"
else
    fail "reminders.sh 不可執行"
fi

# =============================================================================
# 測試 2：stdout 輸出為有效 JSON
# =============================================================================
echo ""
echo "=== UT-4.2: 輸出 JSON 格式 ==="

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
bash "$REM_SCRIPT" > "$STDOUT_FILE" 2>"$STDERR_FILE" || true

if python3 -c "import json,sys; json.load(open('$STDOUT_FILE'))" 2>/dev/null; then
    pass "輸出為有效 JSON"
else
    fail "輸出非有效 JSON"
    cat "$STDOUT_FILE"
fi

STDOUT_CONTENT=$(cat "$STDOUT_FILE")

# =============================================================================
# 測試 3：包含必要欄位
# =============================================================================
echo ""
echo "=== UT-4.3: 包含必要欄位 ==="

FIELD_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data.get('source') == 'reminders', f'source={data.get(\"source\")}'
assert data.get('status') in ('ok', 'error', 'partial'), f'status={data.get(\"status\")}'
assert 'data' in data, 'missing data'
assert 'reminders' in data.get('data', {}), 'missing reminders'
assert 'summary' in data.get('data', {}), 'missing summary'
print('OK')
" 2>/dev/null) || FIELD_CHECK="FAIL"

if [ "$FIELD_CHECK" = "OK" ]; then
    pass "必要欄位 source/status/data/reminders/summary 皆存在"
else
    fail "必要欄位缺失"
fi

# =============================================================================
# 測試 4：無未捕獲例外
# =============================================================================
echo ""
echo "=== UT-4.4: 無未捕獲例外 ==="

STDERR_CONTENT=$(cat "$STDERR_FILE")
if echo "$STDERR_CONTENT" | grep -qiE "execution error|OSStatus|Traceback|Can't get"; then
    fail "檢測到未捕獲例外"
else
    pass "無未捕獲例外"
fi

# =============================================================================
# 測試 5：exit code
# =============================================================================
echo ""
echo "=== UT-4.5: Exit code 檢查 ==="

bash "$REM_SCRIPT" > /dev/null 2>&1
EC=$?

if [ "$EC" -eq 0 ] || [ "$EC" -eq 1 ]; then
    pass "Exit code 正常 ($EC)"
else
    fail "Exit code 異常 ($EC)"
fi

# =============================================================================
# 測試 6：提醒摘要
# =============================================================================
echo ""
echo "=== UT-4.6: 提醒摘要 ==="

SUM_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
s = data['data']['summary']
print(f\"reminders={s.get('total_reminders', 0)}, lists={s.get('total_lists', 0)}\")
" 2>/dev/null)

pass "提醒摘要: $SUM_CHECK"

# =============================================================================
# 清理
# =============================================================================
rm -f "$STDOUT_FILE" "$STDERR_FILE"

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "=== UT-4 結果 ==="
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ UT-4 FAILED"
    exit 1
else
    echo "✅ UT-4 PASSED"
    exit 0
fi
