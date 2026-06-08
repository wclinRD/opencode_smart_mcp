#!/bin/bash
# Personal Assistant - System Unit Test (UT-3)
# 測試 scripts/system.sh 的行為
# exit 0 = PASS, exit 1 = FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
SYS_SCRIPT="$SKILL_DIR/scripts/system.sh"

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
echo "=== UT-3.1: Script 存在且可執行 ==="

if [ -f "$SYS_SCRIPT" ]; then
    pass "system.sh 存在"
else
    fail "system.sh 不存在"
fi

if [ -x "$SYS_SCRIPT" ]; then
    pass "system.sh 可執行"
else
    fail "system.sh 不可執行"
fi

# =============================================================================
# 測試 2：stdout 輸出為有效 JSON
# =============================================================================
echo ""
echo "=== UT-3.2: 輸出 JSON 格式 ==="

STDOUT_FILE=$(mktemp)
bash "$SYS_SCRIPT" > "$STDOUT_FILE" 2>/dev/null || true

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
echo "=== UT-3.3: 包含必要欄位 ==="

FIELD_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data.get('source') == 'system', f'source={data.get(\"source\")}'
assert data.get('status') == 'ok', f'status={data.get(\"status\")}'
assert 'data' in data, 'missing data'
d = data['data']
assert 'disk' in d, 'missing disk'
assert 'battery' in d, 'missing battery'
assert 'network' in d, 'missing network'
assert 'memory' in d, 'missing memory'
print('OK')
" 2>/dev/null) || FIELD_CHECK="FAIL"

if [ "$FIELD_CHECK" = "OK" ]; then
    pass "必要欄位 source/status/data 皆存在，含 disk/battery/network/memory"
else
    fail "必要欄位缺失"
fi

# =============================================================================
# 測試 4：磁碟資訊
# =============================================================================
echo ""
echo "=== UT-3.4: 磁碟資訊 ==="

DISK_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
d = data['data']['disk']
if d.get('usage_percent'):
    print(f\"OK: {d.get('usage_percent')} used, available={d.get('available')}\")
else:
    print(f\"NO_DATA: {d}\")
" 2>/dev/null)

case "$DISK_CHECK" in
    OK:*)
        pass "磁碟資訊: $DISK_CHECK"
        ;;
    *)
        fail "磁碟資訊不足: $DISK_CHECK"
        ;;
esac

# =============================================================================
# 測試 5：網路資訊
# =============================================================================
echo ""
echo "=== UT-3.5: 網路資訊 ==="

NET_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
n = data['data']['network']
if 'connected' in n:
    status = 'connected' if n['connected'] else 'disconnected'
    print(f\"OK: {status}, ip={n.get('local_ip', '?')}\")
else:
    print(f\"NO_DATA: {n}\")
" 2>/dev/null)

case "$NET_CHECK" in
    OK:*)
        pass "網路資訊: $NET_CHECK"
        ;;
    *)
        fail "網路資訊不足: $NET_CHECK"
        ;;
esac

# =============================================================================
# 測試 6：記憶體資訊
# =============================================================================
echo ""
echo "=== UT-3.6: 記憶體資訊 ==="

MEM_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
m = data['data']['memory']
if m.get('total_gb'):
    print(f\"OK: {m.get('total_gb')}GB total, {m.get('usage_percent')}% used\")
else:
    print(f\"NO_DATA: {m}\")
" 2>/dev/null)

case "$MEM_CHECK" in
    OK:*)
        pass "記憶體資訊: $MEM_CHECK"
        ;;
    *)
        fail "記憶體資訊不足: $MEM_CHECK"
        ;;
esac

# =============================================================================
# 測試 7：電池資訊
# =============================================================================
echo ""
echo "=== UT-3.7: 電池資訊 ==="

BATT_CHECK=$(echo "$STDOUT_CONTENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
b = data['data']['battery']
# 桌面 Mac 可能無電池
if b.get('status') == 'no_battery':
    print('NO_BATTERY')
else:
    print(f\"OK: {b.get('percent', '?')}, {b.get('status', '?')}\")
" 2>/dev/null)

case "$BATT_CHECK" in
    OK:*)
        pass "電池資訊: $BATT_CHECK"
        ;;
    NO_BATTERY)
        pass "無電池（桌面 Mac，正常）"
        ;;
    *)
        fail "電池資訊不足: $BATT_CHECK"
        ;;
esac

# =============================================================================
# 測試 8：Exit code
# =============================================================================
echo ""
echo "=== UT-3.8: Exit code 檢查 ==="

bash "$SYS_SCRIPT" > /dev/null 2>&1
EC=$?

if [ "$EC" -eq 0 ]; then
    pass "Exit code 正常 ($EC)"
else
    fail "Exit code 異常 ($EC)"
fi

# =============================================================================
# 清理
# =============================================================================
rm -f "$STDOUT_FILE"

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "=== UT-3 結果 ==="
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ UT-3 FAILED"
    exit 1
else
    echo "✅ UT-3 PASSED"
    exit 0
fi
