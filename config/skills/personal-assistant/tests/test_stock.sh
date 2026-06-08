#!/bin/bash
# Personal Assistant - Stock Unit Test (UT-1)
# 測試 scripts/stock.sh 的行為
# exit 0 = PASS, exit 1 = FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
STOCK_SCRIPT="$SKILL_DIR/scripts/stock.sh"

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
echo "=== UT-1.1: Script 存在且可執行 ==="

if [ -f "$STOCK_SCRIPT" ]; then
    pass "stock.sh 存在"
else
    fail "stock.sh 不存在 ($STOCK_SCRIPT)"
fi

if [ -x "$STOCK_SCRIPT" ]; then
    pass "stock.sh 可執行"
else
    fail "stock.sh 不可執行，執行: chmod +x $STOCK_SCRIPT"
fi

# =============================================================================
# 測試 2：基本執行（輸出為有效 JSON）
# =============================================================================
echo ""
echo "=== UT-1.2: 基本執行（輸出 JSON 格式）==="

OUTPUT=$(bash "$STOCK_SCRIPT" 2>/dev/null) || true

if echo "$OUTPUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    pass "輸出為有效 JSON"
else
    fail "輸出非有效 JSON: $(echo "$OUTPUT" | head -c 200)"
fi

# =============================================================================
# 測試 3：含 source 欄位
# =============================================================================
echo ""
echo "=== UT-1.3: 包含必要欄位 ==="

if echo "$OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data.get('source') == 'stock', f'source={data.get(\"source\")}'
assert data.get('status') in ('ok', 'error', 'partial'), f'status={data.get(\"status\")}'
assert 'layer' in data, 'missing layer'
assert 'timestamp' in data, 'missing timestamp'
print('OK')
" 2>/dev/null; then
    pass "必要欄位 source/status/layer/timestamp 皆存在"
else
    fail "必要欄位缺失"
fi

# =============================================================================
# 測試 4：台股查詢
# =============================================================================
echo ""
echo "=== UT-1.4: 台股查詢（2330.TW）==="

TW_CHECK=$(echo "$OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stocks = data.get('data', {}).get('taiwan_stocks', [])
if not stocks:
    print('NO_STOCKS')
    sys.exit(0)
for s in stocks:
    if '2330' in s.get('symbol', ''):
        if s.get('price'):
            print(f\"OK: price={s['price']}\")
        else:
            print(f\"NO_PRICE: {s.get('error', 'unknown')}\")
        sys.exit(0)
print('NOT_FOUND')
" 2>/dev/null) || TW_CHECK="PARSE_ERROR"

case "$TW_CHECK" in
    OK:*)
        pass "台股 2330 查詢成功 ($TW_CHECK)"
        ;;
    NO_PRICE:*)
        fail "台股 2330 查詢無價格資訊"
        ;;
    NO_STOCKS)
        fail "無台股資料回傳"
        ;;
    NOT_FOUND)
        fail "未找到 2330 股票"
        ;;
    *)
        fail "台股查詢失敗: $TW_CHECK"
        ;;
esac

# =============================================================================
# 測試 5：美股查詢
# =============================================================================
echo ""
echo "=== UT-1.5: 美股查詢（AAPL）==="

US_CHECK=$(echo "$OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stocks = data.get('data', {}).get('us_stocks', [])
if not stocks:
    print('NO_STOCKS')
    sys.exit(0)
for s in stocks:
    if 'AAPL' in s.get('symbol', ''):
        if s.get('price'):
            print(f\"OK: price={s['price']}\")
        else:
            print(f\"NO_PRICE: {s.get('error', 'unknown')}\")
        sys.exit(0)
print('NOT_FOUND')
" 2>/dev/null) || US_CHECK="PARSE_ERROR"

case "$US_CHECK" in
    OK:*)
        pass "美股 AAPL 查詢成功 ($US_CHECK)"
        ;;
    NO_PRICE:*)
        fail "美股 AAPL 查詢無價格資訊"
        ;;
    NO_STOCKS)
        fail "無美股資料回傳"
        ;;
    NOT_FOUND)
        fail "未找到 AAPL 股票"
        ;;
    *)
        fail "美股查詢失敗: $US_CHECK"
        ;;
esac

# =============================================================================
# 測試 6：exit code 不為 crash
# =============================================================================
echo ""
echo "=== UT-1.6: Exit code 檢查 ==="

bash "$STOCK_SCRIPT" > /dev/null 2>&1
EC=$?

if [ "$EC" -eq 0 ] || [ "$EC" -eq 1 ]; then
    pass "Exit code 正常 ($EC)"
else
    fail "Exit code 異常 ($EC)，不應為 127/255"
fi

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "=== UT-1 結果 ==="
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ UT-1 FAILED"
    exit 1
else
    echo "✅ UT-1 PASSED"
    exit 0
fi
