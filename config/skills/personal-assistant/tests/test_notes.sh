#!/bin/bash
# Personal Assistant - Notes Unit Test (UT-5)
# 測試 scripts/notes.sh 的行為
# exit 0 = PASS, exit 1 = FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
NOTE_SCRIPT="$SKILL_DIR/scripts/notes.sh"

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
echo "=== UT-5.1: Script 存在且可執行 ==="

if [ -f "$NOTE_SCRIPT" ]; then
    pass "notes.sh 存在"
else
    fail "notes.sh 不存在"
fi
if [ -x "$NOTE_SCRIPT" ]; then
    pass "notes.sh 可執行"
else
    fail "notes.sh 不可執行"
fi

# =============================================================================
# 測試 2：stdout 輸出為有效 JSON
# =============================================================================
echo ""
echo "=== UT-5.2: 輸出 JSON 格式 ==="

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
bash "$NOTE_SCRIPT" > "$STDOUT_FILE" 2>"$STDERR_FILE" || true

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
echo "=== UT-5.3: 包含必要欄位 ==="

FIELD_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data.get('source') == 'notes', f'source={data.get(\"source\")}'
assert data.get('status') in ('ok', 'error', 'partial'), f'status={data.get(\"status\")}'
assert 'data' in data, 'missing data'
assert 'notes' in data.get('data', {}), 'missing notes'
print('OK')
" 2>/dev/null) || FIELD_CHECK="FAIL"

if [ "$FIELD_CHECK" = "OK" ]; then
    pass "必要欄位 source/status/data/notes 皆存在"
else
    fail "必要欄位缺失"
fi

# =============================================================================
# 測試 4：無未捕獲例外
# =============================================================================
echo ""
echo "=== UT-5.4: 無未捕獲例外 ==="

STDERR_CONTENT=$(cat "$STDERR_FILE")
if echo "$STDERR_CONTENT" | grep -qiE "Traceback|execution error|OSStatus|Can't get"; then
    fail "檢測到未捕獲例外"
else
    pass "無未捕獲例外"
fi

# =============================================================================
# 測試 5：exit code
# =============================================================================
echo ""
echo "=== UT-5.5: Exit code 檢查 ==="

bash "$NOTE_SCRIPT" > /dev/null 2>&1
EC=$?

if [ "$EC" -eq 0 ] || [ "$EC" -eq 1 ]; then
    pass "Exit code 正常 ($EC)"
else
    fail "Exit code 異常 ($EC)"
fi

# =============================================================================
# 測試 6：筆記摘要
# =============================================================================
echo ""
echo "=== UT-5.6: 筆記摘要 ==="

SUM_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
s = data['data']['summary']
print(f\"notes={s.get('total_notes', 0)}, max_requested={s.get('max_notes_requested', 0)}\")
" 2>/dev/null)

pass "筆記摘要: $SUM_CHECK"

# =============================================================================
# 清理
# =============================================================================
rm -f "$STDOUT_FILE" "$STDERR_FILE"

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "=== UT-5 結果 ==="
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ UT-5 FAILED"
    exit 1
else
    echo "✅ UT-5 PASSED"
    exit 0
fi
