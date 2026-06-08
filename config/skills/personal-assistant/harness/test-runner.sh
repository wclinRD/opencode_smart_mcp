#!/bin/bash
# Personal Assistant — 測試批次器
# 執行全部測試並回報結果。
#
# Usage:
#   bash harness/test-runner.sh              # 全部測試（L1+L2+L3）
#   bash harness/test-runner.sh --l1         # 只跑 L1 單元測試
#   bash harness/test-runner.sh --l2         # 只跑 L2 整合測試
#   bash harness/test-runner.sh --l3         # 只跑 L3 一致性檢查
#   bash harness/test-runner.sh --summary    # 只顯示摘要

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

RUN_L1=false
RUN_L2=false
RUN_L3=false
SUMMARY_ONLY=false

# 解析參數
if [ $# -eq 0 ]; then
    # 無參數 = 全部執行
    RUN_L1=true
    RUN_L2=true
    RUN_L3=true
else
    for arg in "$@"; do
        case "$arg" in
            --l1) RUN_L1=true ;;
            --l2) RUN_L2=true ;;
            --l3) RUN_L3=true ;;
            --summary) SUMMARY_ONLY=true ;;
        esac
    done
fi

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  Personal Assistant — Test Runner      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# =============================================================================
# L1 單元測試
# =============================================================================
run_l1() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${CYAN}L1 單元測試${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    local tests=(
        "test_stock.sh:UT-1 股市查詢"
        "test_calendar.sh:UT-2 行事曆"
        "test_system.sh:UT-3 系統狀態"
        "test_reminders.sh:UT-4 提醒事項"
        "test_notes.sh:UT-5 Apple Notes"
    )
    
    local total=0
    local passed=0
    local failed=0
    local failed_list=""
    
    for entry in "${tests[@]}"; do
        local script="${entry%%:*}"
        local desc="${entry##*:}"
        local path="$SKILL_DIR/tests/$script"
        
        total=$((total + 1))
        
        echo -e "  [${YELLOW}RUN${NC}] $desc ($script)"
        
        set +e
        bash "$path" 2>&1 | while IFS= read -r line; do
            echo "    $line"
        done
        local ec=$?
        set -e
        
        if [ "$ec" -eq 0 ]; then
            echo -e "  ${GREEN}✅ $desc PASS${NC}"
            passed=$((passed + 1))
        else
            echo -e "  ${RED}❌ $desc FAIL (exit $ec)${NC}"
            failed=$((failed + 1))
            failed_list="$failed_list $script"
        fi
        echo ""
    done
    
    echo "  ──────────────────────────────────"
    echo -e "  L1 結果: ${GREEN}$passed PASS${NC}, ${RED}$failed FAIL${NC} / $total"
    if [ -n "$failed_list" ]; then
        echo -e "  ${RED}Failed:$failed_list${NC}"
    fi
    echo ""
    
    L1_PASS=$passed
    L1_FAIL=$failed
    L1_TOTAL=$total
}

# =============================================================================
# L2 整合測試
# =============================================================================
run_l2() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${CYAN}L2 整合測試${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    local integration_script="$SKILL_DIR/tests/test_integration.sh"
    
    if [ ! -f "$integration_script" ]; then
        echo -e "  ${RED}❌ test_integration.sh not found${NC}"
        L2_PASS=0
        L2_FAIL=1
        L2_TOTAL=1
        return
    fi
    
    source "$integration_script"
    
    local test_funcs=(
        "test_it1_checkin:IT-1 checkin (full)"
        "test_it2_glance_weather:IT-2 glance 天氣"
        "test_it3_glance_stock:IT-3 glance 股市"
        "test_it4_glance_mail:IT-4 glance 郵件"
        "test_it5_glance_calendar:IT-5 glance 行事曆"
        "test_it6_glance_reminders:IT-6 glance 提醒"
        "test_it7_glance_system:IT-7 glance 系統"
        "test_it8_search:IT-8 search [manual]"
        "test_it9_summarize:IT-9 summarize [manual]"
        "test_it10_prepare:IT-10 prepare [manual]"
        "test_it11_remind:IT-11 remind [manual]"
        "test_it12_setup:IT-12 setup [manual]"
        "test_it13_glance_news:IT-13 glance 新聞"
        "test_it14_summarize_news:IT-14 summarize 新聞 [manual]"
        "test_it15_checkin_performance:IT-15 checkin 效能"
    )
    
    local total=0
    local passed=0
    local failed=0
    local failed_list=""
    
    for entry in "${test_funcs[@]}"; do
        local func="${entry%%:*}"
        local desc="${entry##*:}"
        
        total=$((total + 1))
        
        echo -e "  [${YELLOW}RUN${NC}] $desc"
        
        set +e
        $func 2>&1 | while IFS= read -r line; do
            echo "    $line"
        done
        local ec=${PIPESTATUS[0]}
        set -e
        
        if [ "$ec" -eq 0 ]; then
            echo -e "  ${GREEN}✅ $desc PASS${NC}"
            passed=$((passed + 1))
        else
            echo -e "  ${RED}❌ $desc FAIL (exit $ec)${NC}"
            failed=$((failed + 1))
            failed_list="$failed_list $func"
        fi
        echo ""
    done
    
    echo "  ──────────────────────────────────"
    echo -e "  L2 結果: ${GREEN}$passed PASS${NC}, ${RED}$failed FAIL${NC} / $total"
    if [ -n "$failed_list" ]; then
        echo -e "  ${RED}Failed:$failed_list${NC}"
    fi
    echo ""
    
    L2_PASS=$passed
    L2_FAIL=$failed
    L2_TOTAL=$total
}

# =============================================================================
# L3 一致性檢查
# =============================================================================
run_l3() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${CYAN}L3 一致性檢查 (C1-C8)${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    if bash "$SKILL_DIR/tests/check-consistency.sh" 2>&1 | while IFS= read -r line; do
        echo "    $line"
    done; then
        L3_PASS=8
        L3_FAIL=0
        L3_TOTAL=8
    else
        L3_PASS=0
        L3_FAIL=8
        L3_TOTAL=8
    fi
    
    echo ""
    echo -e "  L3 結果: ${GREEN}$L3_PASS PASS${NC}, ${RED}$L3_FAIL FAIL${NC} / $L3_TOTAL"
    echo ""
}

# =============================================================================
# 摘要
# =============================================================================
show_summary() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${CYAN}測試摘要${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "  ${CYAN}L1 單元測試${NC}:   ${GREEN}$L1_PASS PASS${NC}, ${RED}$L1_FAIL FAIL${NC} / $L1_TOTAL"
    echo -e "  ${CYAN}L2 整合測試${NC}:   ${GREEN}$L2_PASS PASS${NC}, ${RED}$L2_FAIL FAIL${NC} / $L2_TOTAL"
    echo -e "  ${CYAN}L3 一致性檢查${NC}: ${GREEN}$L3_PASS PASS${NC}, ${RED}$L3_FAIL FAIL${NC} / $L3_TOTAL"
    echo ""
    
    local total_pass=$((L1_PASS + L2_PASS + L3_PASS))
    local total_fail=$((L1_FAIL + L2_FAIL + L3_FAIL))
    local total_all=$((L1_TOTAL + L2_TOTAL + L3_TOTAL))
    
    echo -e "  ${CYAN}總計${NC}: ${GREEN}$total_pass PASS${NC}, ${RED}$total_fail FAIL${NC} / $total_all"
    echo ""
    
    if [ "$total_fail" -eq 0 ]; then
        echo -e "  ${GREEN}✅ ALL TESTS PASSED${NC}"
        return 0
    else
        echo -e "  ${RED}❌ SOME TESTS FAILED${NC}"
        return 1
    fi
}

# =============================================================================
# 主流程
# =============================================================================

L1_PASS=0 L1_FAIL=0 L1_TOTAL=0
L2_PASS=0 L2_FAIL=0 L2_TOTAL=0
L3_PASS=0 L3_FAIL=0 L3_TOTAL=0

if [ "$SUMMARY_ONLY" = true ]; then
    :
elif [ "$RUN_L1" = true ]; then
    run_l1
fi

if [ "$SUMMARY_ONLY" = true ]; then
    :
elif [ "$RUN_L2" = true ]; then
    run_l2
fi

if [ "$SUMMARY_ONLY" = true ]; then
    :
elif [ "$RUN_L3" = true ]; then
    run_l3
fi

# 如果沒有指定任何項目但跑了檢查，還是有數據可以摘要
if [ "$RUN_L1" = false ] && [ "$RUN_L2" = false ] && [ "$RUN_L3" = false ] && [ "$SUMMARY_ONLY" = false ]; then
    # 全部跑
    run_l1
    run_l2
    run_l3
fi

show_summary
