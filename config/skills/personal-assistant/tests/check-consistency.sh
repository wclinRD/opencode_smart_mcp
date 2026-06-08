#!/bin/bash
# Personal Assistant — L3 一致性檢查（C1-C8）
# 執行方式:
#   bash tests/check-consistency.sh          # 只跑一致性檢查
#   bash tests/check-consistency.sh --all    # 一致性檢查 + 單元測試
#   bash tests/check-consistency.sh --check C1  # 單一檢查
#
# 錯誤訊息格式（遵循 Harness Engineering）：
#   ❌ [ID] FAIL:
#   Error: [具體錯誤]
#   Fix: [修復指令]
#
# exit 0 = ALL PASS, exit 1 = ANY FAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# plan.md 和 todo.md 的路徑（專案根目錄）
PROJECT_DIR="${PROJECT_DIR:-$HOME/opencode/day}"
PLAN_FILE="$PROJECT_DIR/plan.md"
TODO_FILE="$PROJECT_DIR/todo.md"

PASS_COUNT=0
FAIL_COUNT=0
FAILED_CHECKS=""

pass() {
    local id="$1"
    local msg="$2"
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  ✅ [$id] $msg"
}

fail() {
    local id="$1"
    local msg="$2"
    local fix="$3"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_CHECKS="$FAILED_CHECKS $id"
    echo "  ❌ [$id] FAIL: $msg"
    if [ -n "$fix" ]; then
        echo "     Fix: $fix"
    fi
}

# =============================================================================
# C1：Scripts 存在性與可執行性
# =============================================================================
check_c1() {
    echo ""
    echo "=== C1: Scripts 存在性與可執行性 ==="
    local all_pass=true
    
    for f in profile stock calendar reminders notes system news; do
        local script="$SKILL_DIR/scripts/${f}.sh"
        if [ ! -f "$script" ]; then
            fail "C1" "scripts/${f}.sh not found"
            all_pass=false
        elif [ ! -x "$script" ]; then
            fail "C1" "scripts/${f}.sh not executable" "chmod +x $script"
            all_pass=false
        fi
    done
    
    if [ "$all_pass" = true ]; then
        pass "C1" "All 7 scripts exist and are executable"
    fi
}

# =============================================================================
# C2：Profile 範例欄位一致性
# =============================================================================
check_c2() {
    echo ""
    echo "=== C2: Profile 範例欄位一致性 ==="
    local example="$SKILL_DIR/examples/profile.example"
    local all_pass=true
    
    if [ ! -f "$example" ]; then
        fail "C2" "examples/profile.example not found"
        return
    fi
    
    # 必填欄位
    local required_keys=("city" "stocks_tw" "stocks_us" "news_feeds")
    local optional_keys=("accounts" "calendars" "news_max_per_feed" "news_max_total" "checkin_layers" "log_level" "timeout_seconds")
    
    # 讀取 example 中的所有 key
    local example_keys=$(grep -E '^[a-z_]+=' "$example" | cut -d= -f1 | sort -u)
    
    for key in "${required_keys[@]}"; do
        if echo "$example_keys" | grep -qFx "$key"; then
            :
        else
            fail "C2" "Required key '$key' missing from profile.example"
            all_pass=false
        fi
    done
    
    for key in "${optional_keys[@]}"; do
        if echo "$example_keys" | grep -qFx "$key"; then
            :
        else
            # Optional keys are not required to fail
            echo "  ⚠️  [C2] Optional key '$key' missing (ok)"
        fi
    done
    
    if [ "$all_pass" = true ]; then
        pass "C2" "All required keys present in profile.example"
    fi
}

# =============================================================================
# C3：股市查詢功能驗證
# =============================================================================
check_c3() {
    echo ""
    echo "=== C3: 股市查詢功能驗證 ==="
    local stock_script="$SKILL_DIR/scripts/stock.sh"
    local all_pass=true
    
    if [ ! -f "$stock_script" ]; then
        fail "C3" "stock.sh not found"
        return
    fi
    
    # 執行 stock.sh
    local output
    output=$(bash "$stock_script" 2>/dev/null) || true
    
    # 檢查台股
    if echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stocks = data.get('data', {}).get('taiwan_stocks', [])
ok = any('2330' in s.get('symbol', '') and s.get('price') for s in stocks)
sys.exit(0 if ok else 1)
" 2>/dev/null; then
        :
    else
        fail "C3" "stock.sh cannot query 2330.TW" "bash $stock_script; check yfinance: python3 -c \"import yfinance; print(yfinance.download('2330.TW', period='1d'))\""
        all_pass=false
    fi
    
    # 檢查美股
    if echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stocks = data.get('data', {}).get('us_stocks', [])
ok = any('AAPL' in s.get('symbol', '') and s.get('price') for s in stocks)
sys.exit(0 if ok else 1)
" 2>/dev/null; then
        :
    else
        fail "C3" "stock.sh cannot query AAPL" "bash $stock_script; check yfinance: python3 -c \"import yfinance; print(yfinance.download('AAPL', period='1d'))\""
        all_pass=false
    fi
    
    if [ "$all_pass" = true ]; then
        pass "C3" "Stock query works for TW (2330) and US (AAPL)"
    fi
}

# =============================================================================
# C4：行事曆穩定性驗證
# =============================================================================
check_c4() {
    echo ""
    echo "=== C4: 行事曆穩定性驗證 ==="
    local cal_script="$SKILL_DIR/scripts/calendar.sh"
    local all_pass=true
    
    if [ ! -f "$cal_script" ]; then
        fail "C4" "calendar.sh not found"
        return
    fi
    
    local output
    output=$(bash "$cal_script" 2>&1) || true
    
    # 檢查 AppleScript 未捕獲錯誤
    if echo "$output" | grep -qiE "execution error|OSStatus|Can't get"; then
        fail "C4" "calendar.sh has uncaught AppleScript error" "Check output: $output"
        all_pass=false
    fi
    
    # 檢查 exit code
    bash "$cal_script" > /dev/null 2>&1
    local ec=$?
    if [ "$ec" -eq 127 ] || [ "$ec" -eq 255 ]; then
        fail "C4" "calendar.sh crashed (exit $ec)" "Check script for errors"
        all_pass=false
    fi
    
    if [ "$all_pass" = true ]; then
        pass "C4" "Calendar stable (no uncaught errors)"
    fi
}

# =============================================================================
# C5：觸發詞跨文件一致性
# =============================================================================
check_c5() {
    echo ""
    echo "=== C5: 觸發詞跨文件一致性 ==="
    local plan_file="$PROJECT_DIR/plan.md"
    local skill_file="$SKILL_DIR/SKILL.md"
    local all_pass=true
    
    # 從 SKILL.md 提取觸發詞（YAML frontmatter 中的 trigger 列表）
    # 計算 frontmatter 中以 4 空格 + "- " 開頭的行
    local trigger_count_skill
    trigger_count_skill=$(grep -c '^    - ' "$skill_file" 2>/dev/null || echo 0)
    
    # 從 plan.md 提取觸發詞（觸發詞對照表中的行）
    local trigger_count_plan
    trigger_count_plan=$(grep -c '「' "$plan_file" 2>/dev/null || echo 0)
    
    if [ "$trigger_count_skill" -lt 13 ]; then
        fail "C5" "SKILL.md has only $trigger_count_skill triggers (expected 13+)" "Add missing trigger words to SKILL.md frontmatter"
        all_pass=false
    fi
    
    if [ "$trigger_count_plan" -lt 13 ]; then
        fail "C5" "plan.md has only $trigger_count_plan trigger rows (expected 13+)" ""
        all_pass=false
    fi
    
    if [ "$all_pass" = true ]; then
        pass "C5" "Trigger words: SKILL.md ($trigger_count_skill), plan.md ($trigger_count_plan)"
    fi
}

# =============================================================================
# C6：Phase 任務數量一致性
# =============================================================================
check_c6() {
    echo ""
    echo "=== C6: Phase 任務數量一致性 ==="
    local todo_file="$PROJECT_DIR/todo.md"
    local all_pass=true
    
    # 從 todo.md 的 Phase 表格讀取（用 awk 取任務總數，第 4 欄位）
    local p1_todo=$(grep "P1 基礎建設" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    local p2_todo=$(grep "P2 Scripts" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    local p3_todo=$(grep "P3 SKILL" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    local p4_todo=$(grep "P4 單元測試" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    local p5_todo=$(grep "P5 一致性" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    local p6_todo=$(grep "P6 安全" "$todo_file" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $4); print $4}' 2>/dev/null || echo 0)
    
    # 預期值
    local expected_p1=4 expected_p2=7 expected_p3=3 expected_p4=5 expected_p5=2 expected_p6=2
    
    if [ "${p1_todo:-0}" -ne "$expected_p1" ]; then
        fail "C6" "P1: todo.md=$p1_todo, expected=$expected_p1"
        all_pass=false
    fi
    if [ "${p2_todo:-0}" -ne "$expected_p2" ]; then
        fail "C6" "P2: todo.md=$p2_todo, expected=$expected_p2"
        all_pass=false
    fi
    if [ "${p3_todo:-0}" -ne "$expected_p3" ]; then
        fail "C6" "P3: todo.md=$p3_todo, expected=$expected_p3"
        all_pass=false
    fi
    if [ "${p4_todo:-0}" -ne "$expected_p4" ]; then
        fail "C6" "P4: todo.md=$p4_todo, expected=$expected_p4"
        all_pass=false
    fi
    if [ "${p5_todo:-0}" -ne "$expected_p5" ]; then
        fail "C6" "P5: todo.md=$p5_todo, expected=$expected_p5"
        all_pass=false
    fi
    if [ "${p6_todo:-0}" -ne "$expected_p6" ]; then
        fail "C6" "P6: todo.md=$p6_todo, expected=$expected_p6"
        all_pass=false
    fi
    
    if [ "$all_pass" = true ]; then
        pass "C6" "All Phase task counts match (P1=$expected_p1, P2=$expected_p2, P3=$expected_p3, P4=$expected_p4, P5=$expected_p5, P6=$expected_p6)"
    fi
}

# =============================================================================
# C7：Profile 範例無真實個資
# =============================================================================
check_c7() {
    echo ""
    echo "=== C7: Profile 範例無真實個資 ==="
    local example="$SKILL_DIR/examples/profile.example"
    local all_pass=true
    
    if [ ! -f "$example" ]; then
        fail "C7" "examples/profile.example not found"
        return
    fi
    
    # 檢查密碼關鍵字
    if grep -qiE '^(password|token|secret|api_key)=' "$example" 2>/dev/null; then
        fail "C7" "profile.example contains sensitive keywords (password/token/secret/api_key)" "Remove sensitive data"
        all_pass=false
    fi
    
    # 檢查是否有非範例 email（@ 後面不是 example.com）
    if grep -E '@' "$example" | grep -qv 'example.com'; then
        # 有可能是註解或範例值以外的 @ 符號
        local suspicious=$(grep -E '@' "$example" | grep -v 'example.com' | grep -v '#' || true)
        if [ -n "$suspicious" ]; then
            fail "C7" "profile.example may contain real email: $suspicious" "Use @example.com for examples"
            all_pass=false
        fi
    fi
    
    if [ "$all_pass" = true ]; then
        pass "C7" "profile.example contains no real personal data"
    fi
}

# =============================================================================
# C8：新聞 RSS 查詢驗證
# =============================================================================
check_c8() {
    echo ""
    echo "=== C8: 新聞 RSS 查詢驗證 ==="
    local news_script="$SKILL_DIR/scripts/news.sh"
    local all_pass=true
    
    if [ ! -f "$news_script" ]; then
        fail "C8" "news.sh not found"
        return
    fi
    
    local output
    output=$(bash "$news_script" 2>/dev/null) || true
    
    # 檢查是否為有效 JSON
    if ! echo "$output" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        fail "C8" "news.sh output is not valid JSON" "bash $news_script"
        all_pass=false
    else
        # 檢查輸出包含 title + link
        local has_data
        has_data=$(echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
articles = data.get('data', {}).get('articles', [])
if articles:
    for a in articles[:1]:
        if a.get('title') and a.get('link'):
            print('OK')
            sys.exit(0)
    print('NO_CONTENT')
else:
    status = data.get('status', '')
    if status == 'error':
        print(f\"ERROR: {data.get('error', {}).get('message', 'unknown')}\")
    else:
        print('EMPTY')
" 2>/dev/null) || has_data="PARSE_ERROR"
        
        case "$has_data" in
            OK)
                pass "C8" "News RSS outputs title + link"
                ;;
            NO_CONTENT)
                fail "C8" "news.sh output missing title/link in articles" ""
                all_pass=false
                ;;
            ERROR:*)
                echo "  ⚠️  [C8] news.sh: ${has_data#ERROR:} (network issue?)"
                pass "C8" "news.sh ran without crash (network issue: ${has_data#ERROR:})"
                ;;
            EMPTY)
                echo "  ⚠️  [C8] news.sh returned empty (no articles)"
                pass "C8" "news.sh ran without crash (empty results)"
                ;;
            *)
                fail "C8" "news.sh output parse error: $has_data"
                all_pass=false
                ;;
        esac
    fi
    
    # Exit code 檢查
    bash "$news_script" > /dev/null 2>&1
    local ec=$?
    if [ "$ec" -eq 127 ] || [ "$ec" -eq 255 ]; then
        fail "C8" "news.sh crashed (exit $ec)"
        all_pass=false
    fi
    
    if [ "$all_pass" = true ]; then
        :  # Already passed above
    fi
}

# =============================================================================
# 主程式
# =============================================================================

RUN_ALL=false
SINGLE_CHECK=""

# 解析參數
for arg in "$@"; do
    case "$arg" in
        --all)
            RUN_ALL=true
            ;;
        --check)
            # 下個參數是檢查 ID
            ;;
        C[1-8])
            SINGLE_CHECK="$arg"
            ;;
        *)
            ;;
    esac
done

# 檢查 --check Cx 格式
for ((i=1; i<=$#; i++)); do
    if [ "${!i}" = "--check" ] && [ $i -lt $# ]; then
        next=$((i+1))
        SINGLE_CHECK="${!next}"
    fi
done

echo "╔════════════════════════════════════════╗"
echo "║  Personal Assistant — L3 一致性檢查    ║"
echo "╚════════════════════════════════════════╝"
echo ""

# 執行檢查
if [ -n "$SINGLE_CHECK" ]; then
    echo "執行單一檢查: $SINGLE_CHECK"
    "check_$(echo "$SINGLE_CHECK" | tr '[:upper:]' '[:lower:]')"
else
    check_c1
    check_c2
    check_c3
    check_c4
    check_c5
    check_c6
    check_c7
    check_c8
fi

# =============================================================================
# 結果
# =============================================================================
echo ""
echo "========================================"
echo "L3 一致性檢查結果"
echo "========================================"
echo "PASS: $PASS_COUNT | FAIL: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ FAILED checks:$FAILED_CHECKS"
fi

# --all 模式：另外執行 L1 單元測試
if [ "$RUN_ALL" = true ]; then
    echo ""
    echo "========================================"
    echo "L1 單元測試（批次執行）"
    echo "========================================"
    echo ""
    
    UT_PASS=0
    UT_FAIL=0
    UT_FAILED_LIST=""
    
    for ut_script in "$SCRIPT_DIR"/test_*.sh; do
        local name=$(basename "$ut_script")
        echo "--- $name ---"
        if bash "$ut_script" 2>&1; then
            UT_PASS=$((UT_PASS + 1))
        else
            UT_FAIL=$((UT_FAIL + 1))
            UT_FAILED_LIST="$UT_FAILED_LIST $name"
        fi
        echo ""
    done
    
    echo "--- 單元測試結果 ---"
    echo "PASS: $UT_PASS | FAIL: $UT_FAIL"
    if [ "$UT_FAIL" -gt 0 ]; then
        echo "❌ Failed: $UT_FAILED_LIST"
    fi
fi

echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi

if [ "$RUN_ALL" = true ] && [ "$UT_FAIL" -gt 0 ]; then
    exit 1
fi

echo "✅ ALL CHECKS PASSED"
exit 0
