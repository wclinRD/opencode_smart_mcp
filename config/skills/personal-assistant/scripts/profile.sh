#!/bin/bash
# Personal Assistant Profile Reader
# 提供 read_profile() 和 log_message() 給所有 scripts 使用
# 使用方式: source "$(dirname "$0")/profile.sh"
#
# 設定檔位置優先順序：
# 1. ~/.config/personal-assistant/profile   (正式位置，安全)
# 2. $SKILL_DIR/profile                       (便攜位置，開發用)
# 3. 自動從範本建立並提示使用者編輯

# 注意：不使用 set -u 以相容 associative array 和選擇性變數
set -e
set -o pipefail

# =============================================================================
# 路徑設定（雙位置支援）
# =============================================================================

# 取得 script 所在目錄（無論從哪裡呼叫）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# 設定檔位置（兩個位置都支援）
# 位置 1：正式位置（~/.config/，安全，不會被 git 提交）
CONFIG_DIR="$HOME/.config/personal-assistant"
PROFILE_FILE_1="$CONFIG_DIR/profile"

# 位置 2：便攜位置（skill 目錄內，方便開發/重新安裝）
PROFILE_FILE_2="$SKILL_DIR/profile"

# 範本位置
PROFILE_TEMPLATE="$SKILL_DIR/examples/profile.example"

# 日誌目錄（永遠放在 ~/.config/）
LOG_DIR="$CONFIG_DIR/log"

# 確保目錄存在
mkdir -p "$LOG_DIR"

# 預設使用的設定檔（稍後決定）
PROFILE_FILE=""

# =============================================================================
# 預設值定義（使用 function 避免 bash 3 associative array 問題）
# =============================================================================

get_default_value() {
    local key="$1"
    case "$key" in
        "city") echo "Taipei" ;;
        "stocks_tw") echo "2330,2454,2317" ;;
        "stocks_us") echo "AAPL,TSLA,MSFT,NVDA" ;;
        "accounts") echo "" ;;
        "calendars") echo "" ;;
        "news_feeds") echo "ltn,cna,bbc_world" ;;
        "news_max_per_feed") echo "5" ;;
        "news_max_total") echo "15" ;;
        "checkin_layers") echo "all" ;;
        "log_level") echo "INFO" ;;
        "timeout_seconds") echo "10" ;;
        # Teams 設定
        "teams_msg_hours") echo "24" ;;
        "teams_max_chats") echo "10" ;;
        "teams_max_msg_per_chat") echo "20" ;;
        "teams_max_workers") echo "5" ;;
        *) echo "" ;;
    esac
}

# =============================================================================
# 設定檔快取（使用一般變數 + grep 方式）
# =============================================================================

PROFILE_LOADED=0
PROFILE_CONTENT=""
PROFILE_LOG_LEVEL="INFO"

# =============================================================================
# 統一 JSON 輸出格式函式
# =============================================================================

output_json_ok() {
    local source="$1"
    local layer="$2"
    local data="$3"
    local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    cat <<EOF
{
  "source": "$source",
  "status": "ok",
  "layer": $layer,
  "timestamp": "$ts",
  "data": $data,
  "error": null
}
EOF
}

output_json_error() {
    local source="$1"
    local layer="$2"
    local code="$3"
    local msg="$4"
    local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    msg=$(echo "$msg" | sed 's/"/\\"/g')
    
    cat <<EOF
{
  "source": "$source",
  "status": "error",
  "layer": $layer,
  "timestamp": "$ts",
  "data": null,
  "error": {
    "code": "$code",
    "message": "$msg"
  }
}
EOF
}

json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    echo "$s"
}

# =============================================================================
# 日誌函數（T9 三層 Logging）
# =============================================================================

_write_log() {
    local level="$1"
    local source="$2"
    local message="$3"
    local timestamp=$(date '+%Y-%m-%dT%H:%M:%S')
    
    # L0: Console 輸出（stderr 避免與 stdout 資料混合）
    echo "[$timestamp] [$level] [$source] $message" >&2
    
    # L1: Session log
    local log_line="[$timestamp] [$level] [$source] $message"
    echo "$log_line" >> "$LOG_DIR/session.log" 2>/dev/null || true
    
    # L2: Debug log（僅 DEBUG 或 ERROR）
    if [[ "$level" == "DEBUG" || "$level" == "ERROR" ]]; then
        echo "$log_line" >> "$LOG_DIR/debug.log" 2>/dev/null || true
    fi
}

log_info() { _write_log "INFO" "$1" "$2"; }
log_warn() { _write_log "WARN" "$1" "$2"; }
log_error() { _write_log "ERROR" "$1" "$2"; }

log_debug() {
    if [[ "${PROFILE_LOG_LEVEL:-INFO}" == "DEBUG" ]]; then
        _write_log "DEBUG" "$1" "$2"
    fi
}

# =============================================================================
# 自動建立設定檔（重新安裝時自動處理）
# =============================================================================

auto_create_profile() {
    local target_file=""
    local template_available=false
    
    # 優先：檢查範本是否存在
    if [[ -f "$PROFILE_TEMPLATE" ]]; then
        template_available=true
    fi
    
    # 決定要建立在哪裡
    # 預設建立在正式位置 (~/.config/personal-assistant/)
    # 但如果該目錄不存在且 skill 目錄可寫，則建立在 skill 目錄內
    
    mkdir -p "$CONFIG_DIR" 2>/dev/null || true
    
    if [[ -w "$CONFIG_DIR" ]]; then
        # 可以寫入正式位置
        target_file="$PROFILE_FILE_1"
        log_info "profile.sh" "選擇正式位置: $target_file"
    elif [[ -w "$SKILL_DIR" ]]; then
        # 無法寫入正式位置，改用 skill 目錄
        target_file="$PROFILE_FILE_2"
        log_info "profile.sh" "選擇便攜位置: $target_file"
    else
        # 都無法寫入，記錄警告
        log_warn "profile.sh" "無法建立設定檔（無寫入權限）"
        log_warn "profile.sh" "請手動建立: cp $PROFILE_TEMPLATE $PROFILE_FILE_1 && chmod 600 $PROFILE_FILE_1"
        return 1
    fi
    
    # 建立設定檔
    if [[ "$template_available" == true ]]; then
        log_info "profile.sh" "從範本建立設定檔: $PROFILE_TEMPLATE -> $target_file"
        
        # 複製範本
        if cp "$PROFILE_TEMPLATE" "$target_file" 2>/dev/null; then
            # 設定權限
            chmod 600 "$target_file" 2>/dev/null || true
            
            log_info "profile.sh" "========================================"
            log_info "profile.sh" "✅ 設定檔已自動建立！"
            log_info "profile.sh" "位置: $target_file"
            log_info "profile.sh" "權限: chmod 600（僅你可讀）"
            log_info "profile.sh" "========================================"
            log_info "profile.sh" "📝 請編輯此檔案設定個人資訊："
            log_info "profile.sh" ""
            log_info "profile.sh" "   城市: city=Taipei"
            log_info "profile.sh" "   台股: stocks_tw=2330,2454,2317"
            log_info "profile.sh" "   美股: stocks_us=AAPL,TSLA,MSFT,NVDA"
            log_info "profile.sh" "   郵件帳號: accounts=iCloud,Gmail"
            log_info "profile.sh" "   新聞來源: news_feeds=ltn,cna,bbc_world"
            log_info "profile.sh" ""
            log_info "profile.sh" "   編輯指令: open -e \"$target_file\""
            log_info "profile.sh" "========================================"
            
            return 0
        else
            log_warn "profile.sh" "複製範本失敗"
        fi
    else
        # 沒有範本，嘗試建立最小版本
        log_warn "profile.sh" "範本不存在: $PROFILE_TEMPLATE"
        log_info "profile.sh" "建立最小版本設定檔..."
        
        # 建立最小版本
        cat > "$target_file" << 'MINI_PROFILE'
# Personal Assistant Profile (自動建立的最小版本)
# 請參考 examples/profile.example 設定更多選項

city=Taipei
stocks_tw=2330,2454,2317
stocks_us=AAPL,TSLA,MSFT,NVDA
news_feeds=ltn,cna,bbc_world
news_max_per_feed=5
news_max_total=15
timeout_seconds=10
MINI_PROFILE
        
        chmod 600 "$target_file" 2>/dev/null || true
        
        log_info "profile.sh" "已建立最小版本設定檔: $target_file"
        return 0
    fi
    
    return 1
}

# =============================================================================
# 決定使用哪個設定檔
# =============================================================================

determine_profile_file() {
    # 優先順序 1: 正式位置
    if [[ -f "$PROFILE_FILE_1" ]]; then
        PROFILE_FILE="$PROFILE_FILE_1"
        log_debug "profile.sh" "使用正式位置: $PROFILE_FILE"
        return 0
    fi
    
    # 優先順序 2: 便攜位置
    if [[ -f "$PROFILE_FILE_2" ]]; then
        PROFILE_FILE="$PROFILE_FILE_2"
        log_debug "profile.sh" "使用便攜位置: $PROFILE_FILE"
        return 0
    fi
    
    # 都沒有，需要自動建立
    log_warn "profile.sh" "========================================"
    log_warn "profile.sh" "⚠️  找不到設定檔"
    log_warn "profile.sh" "位置 1: $PROFILE_FILE_1"
    log_warn "profile.sh" "位置 2: $PROFILE_FILE_2"
    log_warn "profile.sh" "========================================"
    log_info "profile.sh" "🔧  開始自動建立設定檔..."
    
    if auto_create_profile; then
        # 建立成功，再次決定位置
        if [[ -f "$PROFILE_FILE_1" ]]; then
            PROFILE_FILE="$PROFILE_FILE_1"
        elif [[ -f "$PROFILE_FILE_2" ]]; then
            PROFILE_FILE="$PROFILE_FILE_2"
        fi
        return 0
    fi
    
    # 建立失敗，使用預設值（沒有實體檔案）
    log_warn "profile.sh" "使用預設值執行（建議稍後手動建立設定檔）"
    PROFILE_FILE=""
    return 1
}

# =============================================================================
# 載入設定檔
# =============================================================================

load_profile() {
    # 避免重複載入
    if [[ $PROFILE_LOADED -eq 1 ]]; then
        return 0
    fi
    
    # 先設定預設的 log_level
    PROFILE_LOG_LEVEL="INFO"
    
    # 決定設定檔位置（如果尚未決定）
    if [[ -z "$PROFILE_FILE" ]]; then
        determine_profile_file || true
    fi
    
    # 檢查是否有實體設定檔
    if [[ -z "$PROFILE_FILE" ]] || [[ ! -f "$PROFILE_FILE" ]]; then
        log_info "profile.sh" "沒有實體設定檔，使用內建預設值"
        PROFILE_LOADED=1
        PROFILE_CONTENT=""
        return 0
    fi
    
    # 讀取設定檔
    log_debug "profile.sh" "載入設定檔: $PROFILE_FILE"
    
    # 檢查權限（安全檢查）
    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS: 檢查是否只有 owner 可讀
        local perms=$(stat -f "%Lp" "$PROFILE_FILE" 2>/dev/null || echo "")
        if [[ -n "$perms" && "$perms" != "600" && "$perms" != "600" ]]; then
            # 權限不是 600，警告但繼續使用
            log_warn "profile.sh" "⚠️  建議設定檔權限設為 600（chmod 600 $PROFILE_FILE）"
        fi
    fi
    
    # 讀取整個檔案內容到變數
    PROFILE_CONTENT=$(cat "$PROFILE_FILE")
    PROFILE_LOADED=1
    
    # 先找 log_level
    local ll=$(echo "$PROFILE_CONTENT" | grep '^[[:space:]]*log_level[[:space:]]*=' | tail -1 | cut -d= -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [[ -n "$ll" ]]; then
        PROFILE_LOG_LEVEL="$ll"
    fi
    
    log_info "profile.sh" "設定檔載入完成: $PROFILE_FILE"
}

# =============================================================================
# 讀取設定函式
# =============================================================================

# 讀取設定值，不存在則回傳預設值
read_profile() {
    local key="$1"
    
    # 確保已載入
    load_profile
    
    # 如果有設定檔內容，從中搜尋
    if [[ -n "$PROFILE_CONTENT" ]]; then
        # 找到最後一個符合的 key=value（重複時後者覆蓋前者）
        local line=$(echo "$PROFILE_CONTENT" | grep "^[[:space:]]*${key}[[:space:]]*=" | tail -1)
        if [[ -n "$line" ]]; then
            local value=$(echo "$line" | cut -d= -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            log_debug "profile.sh" "讀取設定: $key=$value"
            echo "$value"
            return 0
        fi
    fi
    
    # 使用預設值
    local default=$(get_default_value "$key")
    if [[ -n "$default" ]] || [[ "$key" == "accounts" ]] || [[ "$key" == "calendars" ]]; then
        log_debug "profile.sh" "使用預設值: $key=$default"
        echo "$default"
        return 0
    fi
    
    # 完全未知的 key
    log_warn "profile.sh" "未知的 key: $key"
    echo ""
    return 1
}

# 讀取多值設定（逗號分隔）
read_profile_array() {
    local key="$1"
    local value=$(read_profile "$key")
    
    if [[ -z "$value" ]]; then
        echo ""
        return 0
    fi
    
    local IFS=','
    local parts=($value)
    local result=()
    
    for part in "${parts[@]}"; do
        part=$(echo "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [[ -n "$part" ]]; then
            result+=("$part")
        fi
    done
    
    echo "${result[@]}"
}

# =============================================================================
# 工具函式
# =============================================================================

should_run_layer() {
    local layer="$1"
    local layers=$(read_profile "checkin_layers")
    
    if [[ "$layers" == "all" ]]; then
        return 0
    fi
    
    local IFS=','
    local parts=($layers)
    for part in "${parts[@]}"; do
        part=$(echo "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [[ "$part" == "$layer" ]]; then
            return 0
        fi
    done
    
    return 1
}

get_timeout() {
    read_profile "timeout_seconds"
}

# =============================================================================
# 初始化（當被 source 時自動執行）
# =============================================================================

# 確保 log 檔案存在
touch "$LOG_DIR/session.log" 2>/dev/null || true
touch "$LOG_DIR/debug.log" 2>/dev/null || true

# 載入設定
load_profile

log_debug "profile.sh" "profile.sh 已載入，SKILL_DIR=$SKILL_DIR"
