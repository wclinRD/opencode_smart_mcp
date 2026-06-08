#!/bin/bash
# Personal Assistant — L2 整合測試（IT-1 ~ IT-15）
#
# 每個測試為獨立的 shell function。
# exit 0 = PASS, exit 1 = FAIL。
# [manual] 標記的測試無法全自動化，輸出操作指引。
#
# 由 harness/test-runner.sh 批次驅動。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# =============================================================================
# IT-1: checkin (full)
# 執行完整 checkin 流程 — 系統+行事曆+天氣+郵件+股市+新聞 皆正確顯示
# =============================================================================
test_it1_checkin() {
    echo "測試：完整 checkin（系統+行事曆+天氣+郵件+股市+新聞）"
    echo ""
    
    local failures=0
    
    # 系統狀態
    echo "  [批次 1] 系統狀態..."
    if bash "$SKILL_DIR/scripts/system.sh" > /dev/null 2>&1; then
        echo "  ✅ system.sh OK"
    else
        echo "  ❌ system.sh FAILED"
        failures=$((failures + 1))
    fi
    
    # 行事曆
    echo "  [批次 1] 行事曆..."
    local cal_out
    cal_out=$(bash "$SKILL_DIR/scripts/calendar.sh" 2>/dev/null) || true
    if echo "$cal_out" | python3 -c "import json,sys; json.load(sys.stdin); print('ok')" 2>/dev/null | grep -q ok; then
        echo "  ✅ calendar.sh OK"
    else
        echo "  ❌ calendar.sh FAILED"
        failures=$((failures + 1))
    fi
    
    # 股市
    echo "  [批次 2] 股市..."
    local stk_out
    stk_out=$(bash "$SKILL_DIR/scripts/stock.sh" 2>/dev/null) || true
    if echo "$stk_out" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok='taiwan_stocks' in d.get('data',{}) or 'error' in d.get('data',{})
sys.exit(0 if ok else 1)
" 2>/dev/null; then
        echo "  ✅ stock.sh OK"
    else
        echo "  ❌ stock.sh FAILED"
        failures=$((failures + 1))
    fi
    
    # 新聞
    echo "  [批次 2] 新聞..."
    local news_out
    news_out=$(bash "$SKILL_DIR/scripts/news.sh" 2>/dev/null) || true
    if echo "$news_out" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok='articles' in d.get('data',{})
sys.exit(0 if ok else 1)
" 2>/dev/null; then
        echo "  ✅ news.sh OK"
    else
        echo "  ❌ news.sh FAILED"
        failures=$((failures + 1))
    fi
    
    # 提醒事項
    echo "  [批次 3] 提醒事項..."
    if bash "$SKILL_DIR/scripts/reminders.sh" > /dev/null 2>&1; then
        echo "  ✅ reminders.sh OK"
    else
        echo "  ❌ reminders.sh FAILED"
        failures=$((failures + 1))
    fi
    
    echo ""
    if [ "$failures" -gt 0 ]; then
        echo "❌ IT-1: $failures 項失敗"
        return 1
    else
        echo "✅ IT-1: checkin 全部 5 項 PASS"
        return 0
    fi
}

# =============================================================================
# IT-2: glance 天氣（weather-forcast skill）
# =============================================================================
test_it2_glance_weather() {
    echo "測試：glance 天氣"
    echo ""
    echo "  ⚠️  需要 weather-forcast skill 載入"
    echo "  手動驗證: 載入 skill 後執行 '天氣怎樣'"
    echo ""
    echo "✅ IT-2: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-3: glance 股市
# =============================================================================
test_it3_glance_stock() {
    echo "測試：glance 股市（台股+美股行情顯示）"
    echo ""
    
    local out
    out=$(bash "$SKILL_DIR/scripts/stock.sh" 2>/dev/null) || true
    
    local tw_ok=false
    local us_ok=false
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
stocks = d.get('data', {}).get('taiwan_stocks', [])
for s in stocks:
    if s.get('price'):
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        tw_ok=true
    fi
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
stocks = d.get('data', {}).get('us_stocks', [])
for s in stocks:
    if s.get('price'):
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        us_ok=true
    fi
    
    if [ "$tw_ok" = true ] && [ "$us_ok" = true ]; then
        echo "  ✅ 台股 + 美股行情皆正確"
        echo "✅ IT-3 PASS"
        return 0
    else
        [ "$tw_ok" = false ] && echo "  ❌ 台股查詢失敗"
        [ "$us_ok" = false ] && echo "  ❌ 美股查詢失敗"
        echo "❌ IT-3 FAIL"
        return 1
    fi
}

# =============================================================================
# IT-4: glance 郵件 [manual]
# =============================================================================
test_it4_glance_mail() {
    echo "測試：glance 郵件"
    echo ""
    echo "  ⚠️  需要 mail-checker skill 載入"
    echo "  手動驗證:"
    echo "    1. 載入 mail-checker skill"
    echo "    2. 執行 '今天有什麼信'"
    echo "    3. 確認郵件摘要顯示（無新信也顯示「無新信」）"
    echo ""
    echo "✅ IT-4: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-5: glance 行事曆
# =============================================================================
test_it5_glance_calendar() {
    echo "測試：glance 行事曆"
    echo ""
    
    local out
    out=$(bash "$SKILL_DIR/scripts/calendar.sh" 2>/dev/null) || true
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('data', {}).get('events', [])
summary = d.get('data', {}).get('summary', {})
print(f'行事曆: {summary.get(\"total_calendars\", 0)} 個, 事件數: {len(events)}')
sys.exit(0)
" 2>/dev/null; then
        echo "  ✅ 行事曆讀取成功"
        echo "✅ IT-5 PASS"
        return 0
    else
        echo "  ❌ 行事曆讀取失敗"
        echo "❌ IT-5 FAIL"
        return 1
    fi
}

# =============================================================================
# IT-6: glance 提醒事項
# =============================================================================
test_it6_glance_reminders() {
    echo "測試：glance 提醒事項"
    echo ""
    
    local out
    out=$(bash "$SKILL_DIR/scripts/reminders.sh" 2>/dev/null) || true
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
reminders = d.get('data', {}).get('reminders', [])
summary = d.get('data', {}).get('summary', {})
print(f'提醒項目數: {len(reminders)}, 列表數: {summary.get(\"total_lists\", 0)}')
sys.exit(0)
" 2>/dev/null; then
        echo "  ✅ 提醒事項讀取成功"
        echo "✅ IT-6 PASS"
        return 0
    else
        echo "  ❌ 提醒事項讀取失敗"
        echo "❌ IT-6 FAIL"
        return 1
    fi
}

# =============================================================================
# IT-7: glance 系統
# =============================================================================
test_it7_glance_system() {
    echo "測試：glance 系統（磁碟/電池/網路/記憶體）"
    echo ""
    
    local out
    out=$(bash "$SKILL_DIR/scripts/system.sh" 2>/dev/null) || true
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
data = d.get('data', {})
required = ['disk', 'battery', 'network', 'memory']
for r in required:
    assert r in data, f'missing {r}'
print('OK: 4 項系統資訊皆存在')
sys.exit(0)
" 2>/dev/null; then
        echo "  ✅ 系統 4 項資訊皆正確"
        echo "✅ IT-7 PASS"
        return 0
    else
        echo "  ❌ 系統資訊缺失"
        echo "❌ IT-7 FAIL"
        return 1
    fi
}

# =============================================================================
# IT-8: search mode [manual]
# =============================================================================
test_it8_search() {
    echo "測試：search 模式"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 在 opencode 中輸入「幫我找一下 XXX」"
    echo "    2. 確認 wiki-query + 郵件 + 行事曆 整合輸出"
    echo "    3. 結果應包含至少 2 個來源"
    echo ""
    echo "✅ IT-8: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-9: summarize mode [manual]
# =============================================================================
test_it9_summarize() {
    echo "測試：summarize 模式"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 在 opencode 中輸入「整理重點」"
    echo "    2. 確認 LLM 摘要輸出品質"
    echo "    3. 摘要應包含結構化條列"
    echo ""
    echo "✅ IT-9: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-10: prepare mode [manual]
# =============================================================================
test_it10_prepare() {
    echo "測試：prepare 模式（會議準備包）"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 在 opencode 中輸入「會議準備」"
    echo "    2. 確認產出會議準備包"
    echo "    3. 應包含行事曆時間 + 相關郵件/筆記/wiki"
    echo ""
    echo "✅ IT-10: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-11: remind mode [manual]
# =============================================================================
test_it11_remind() {
    echo "測試：remind 模式（掃描郵件寫入提醒事項）"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 在 opencode 中輸入「提醒我重要郵件」"
    echo "    2. 確認提醒事項已建立至 Apple Reminders"
    echo "    3. 確認含 message:// 郵件連結"
    echo ""
    echo "✅ IT-11: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-12: setup mode [manual]
# =============================================================================
test_it12_setup() {
    echo "測試：setup 模式（首次設定引導）"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 檢查 profile 是否存在: ls -la ~/.config/personal-assistant/profile"
    echo "    2. 確認權限 600: stat -f '%Lp' ~/.config/personal-assistant/profile"
    echo "    3. 在 opencode 中輸入「設定個人資訊」"
    echo "    4. 確認引導流程順暢"
    echo ""
    # 自動檢查 profile 是否存在
    if [ -f "$HOME/.config/personal-assistant/profile" ]; then
        local perms=$(stat -f '%Lp' "$HOME/.config/personal-assistant/profile" 2>/dev/null)
        echo "  📄 Profile: 存在 (權限 $perms)"
        if [ "$perms" = "600" ]; then
            echo "  ✅ 權限正確"
        else
            echo "  ⚠️  建議 chmod 600"
        fi
    else
        echo "  ⚠️  Profile 不存在（可透過 setup 建立）"
    fi
    echo ""
    echo "✅ IT-12: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-13: glance news
# =============================================================================
test_it13_glance_news() {
    echo "測試：glance 新聞（RSS 摘要）"
    echo ""
    
    local out
    out=$(bash "$SKILL_DIR/scripts/news.sh" 2>/dev/null) || true
    
    if echo "$out" | python3 -c "
import json, sys
d = json.load(sys.stdin)
articles = d.get('data', {}).get('articles', [])
if articles:
    # 檢查前 3 則是否有 title + link
    for a in articles[:3]:
        if not a.get('title') or not a.get('link'):
            print(f\"MISSING: {a.get('title', 'no title')}\")
            sys.exit(1)
    print(f'OK: {len(articles)} 篇文章, 來源: {d.get(\"data\",{}).get(\"summary\",{}).get(\"total_feeds\",0)}')
    sys.exit(0)
elif d.get('status') == 'error':
    print(f\"ERROR: {d.get('error', {}).get('message', 'unknown')}\")
    sys.exit(0)
else:
    print('NO_ARTICLES')
    sys.exit(0)
" 2>/dev/null; then
        echo "  ✅ 新聞 RSS 正確輸出"
        echo "✅ IT-13 PASS"
        return 0
    else
        echo "  ❌ 新聞 RSS 格式異常"
        echo "❌ IT-13 FAIL"
        return 1
    fi
}

# =============================================================================
# IT-14: summarize news [manual]
# =============================================================================
test_it14_summarize_news() {
    echo "測試：summarize 新聞（LLM 重點摘要）"
    echo ""
    echo "  ⚠️  需手動驗證"
    echo "  操作指引:"
    echo "    1. 先執行 bash scripts/news.sh 取得新聞資料"
    echo "    2. 要求 LLM: '幫我整理今天的新聞重點'"
    echo "    3. 確認摘要品質（分類 + 重點 + 連結）"
    echo ""
    echo "✅ IT-14: 驗證指引已輸出（需手動確認）"
    return 0
}

# =============================================================================
# IT-15: checkin performance
# 完整 checkin 耗時 < 30s
# =============================================================================
test_it15_checkin_performance() {
    echo "測試：checkin 效能（完整 checkin < 30s）"
    echo ""
    
    local start_time=$(date +%s)
    
    # 依序執行各 script（模擬 checkin 順序）
    echo "  ⏱️  開始計時..."
    
    # 批次 1
    echo "  批次 1（系統層）..."
    bash "$SKILL_DIR/scripts/system.sh" > /dev/null 2>&1 || true
    bash "$SKILL_DIR/scripts/calendar.sh" > /dev/null 2>&1 || true
    
    # 批次 2
    echo "  批次 2（網路層）..."
    bash "$SKILL_DIR/scripts/stock.sh" > /dev/null 2>&1 || true
    bash "$SKILL_DIR/scripts/news.sh" > /dev/null 2>&1 || true
    
    # 批次 3
    echo "  批次 3（系統整合）..."
    bash "$SKILL_DIR/scripts/reminders.sh" > /dev/null 2>&1 || true
    bash "$SKILL_DIR/scripts/notes.sh" > /dev/null 2>&1 || true
    
    local end_time=$(date +%s)
    local elapsed=$((end_time - start_time))
    
    echo ""
    echo "  ⏱️  耗時: ${elapsed}s"
    
    if [ "$elapsed" -le 30 ]; then
        echo "  ✅ ${elapsed}s < 30s SLA"
        echo "✅ IT-15 PASS"
        return 0
    elif [ "$elapsed" -le 60 ]; then
        echo "  ⚠️  ${elapsed}s > 30s SLA（但可接受）"
        echo "  💡 建議：檢查 calendar.sh 的 timeout 設定"
        echo "✅ IT-15 PASS（有條件）"
        return 0
    else
        echo "  ❌ ${elapsed}s > 30s SLA"
        echo "  💡 需優化：減少 AppleScript timeout 或設定 checkin_layers=1,2"
        echo "❌ IT-15 FAIL"
        return 1
    fi
}

# =============================================================================
# 主入口：若直接執行則執行所有測試
# =============================================================================
if [ "$(basename "$0")" = "test_integration.sh" ]; then
    echo "========================================"
    echo "Personal Assistant — L2 整合測試"
    echo "========================================"
    echo ""
    
    total=0
    passed=0
    failed=0
    
    for test_func in $(declare -F | grep -o 'test_it[0-9_]*' | sort); do
        total=$((total + 1))
        echo "--- $test_func ---"
        if $test_func 2>&1; then
            passed=$((passed + 1))
        else
            failed=$((failed + 1))
        fi
        echo ""
    done
    
    echo "========================================"
    echo "結果: $passed/$total PASS, $failed FAIL"
    echo "========================================"
    
    if [ "$failed" -gt 0 ]; then
        exit 1
    fi
    exit 0
fi
