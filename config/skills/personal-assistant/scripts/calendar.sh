#!/bin/bash
# Personal Assistant - Calendar Reader
# 讀取 macOS Calendar 今日事件
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="calendar"
LAYER=1  # 批次 1（系統層）

log_info "$SOURCE_NAME" "開始讀取行事曆..."

# 讀取行事曆設定
CALENDARS=$(read_profile "calendars")
TIMEOUT_SEC=$(get_timeout)
[[ -z "$TIMEOUT_SEC" ]] && TIMEOUT_SEC=10

log_info "$SOURCE_NAME" "行事曆設定: ${CALENDARS:-(自動發現所有)}"
log_info "$SOURCE_NAME" "逾時設定: ${TIMEOUT_SEC} 秒"

# 使用 Python 協調，處理逾時和錯誤
python3 << PYTHON_EOF
import subprocess
import json
import datetime
import sys
import re
import os

def log_msg(msg):
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    print(f"[{ts}] [INFO] [calendar.py] {msg}", file=sys.stderr)

def run_applescript(script, timeout_sec=10):
    """執行 AppleScript，有逾時保護"""
    try:
        # 使用 osascript
        proc = subprocess.Popen(
            ['osascript', '-e', script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        try:
            stdout, stderr = proc.communicate(timeout=timeout_sec)
            return proc.returncode, stdout.strip(), stderr.strip()
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return -1, "", f"Timeout after {timeout_sec} seconds"
            
    except Exception as e:
        return -2, "", str(e)

# ============================================================================
# 1. 先取得所有行事曆名稱
# ============================================================================
log_msg("取得行事曆清單...")

list_script = '''
tell application "Calendar"
    return name of every calendar
end tell
'''

returncode, stdout, stderr = run_applescript(list_script, 10)

calendar_names = []
if returncode == 0 and stdout:
    # 輸出格式: "cal1, cal2, cal3"
    parts = [c.strip() for c in stdout.split(",") if c.strip()]
    calendar_names = parts
    log_msg(f"發現 {len(calendar_names)} 個行事曆: {calendar_names[:5]}..." if len(calendar_names) > 5 else 
            f"發現 {len(calendar_names)} 個行事曆: {calendar_names}")
else:
    log_msg(f"無法取得行事曆清單: {stderr}")
    # 使用預設值
    calendar_names = ["icloud 行事曆", "行事曆"]

# 從 profile 過濾（如果有設定）
profile_calendars_str = '''$CALENDARS'''
if profile_calendars_str and profile_calendars_str.strip():
    profile_calendars = [c.strip() for c in profile_calendars_str.split(",") if c.strip()]
    if profile_calendars:
        # 只查詢有設定的行事曆
        log_msg(f"使用設定的行事曆清單: {profile_calendars}")
        calendar_names = profile_calendars

# ============================================================================
# 2. 逐個查詢行事曆的今日事件
# ============================================================================
today = datetime.date.today()
log_msg(f"查詢今日 ({today}) 的事件...")

all_events = []
failed_calendars = []

for cal_name in calendar_names:
    log_msg(f"查詢行事曆: {cal_name}")
    
    # AppleScript 需要特別處理名稱中的引號
    cal_name_escaped = cal_name.replace('"', '\\"')
    
    # 查詢今日事件的 AppleScript
    query_script = f'''
tell application "Calendar"
    set today to current date
    set startOfDay to today - (time of today)
    set endOfDay to startOfDay + 24 * 60 * 60
    
    set eventList to {{}}
    
    try
        set targetCal to calendar "{cal_name_escaped}"
        set calEvents to (every event of targetCal where start date ≥ startOfDay and start date ≤ endOfDay)
        
        repeat with evt in calEvents
            set evtSummary to summary of evt
            set evtStart to start date of evt
            set evtEnd to end date of evt
            
            -- 處理地點
            set evtLoc to location of evt
            if evtLoc is missing value then set evtLoc to ""
            
            -- 處理備註
            set evtDesc to description of evt
            if evtDesc is missing value then set evtDesc to ""
            
            set end of eventList to {{evtSummary, evtStart, evtEnd, evtLoc, evtDesc}}
        end repeat
        
        return eventList
    on error errMsg
        return "ERROR: " & errMsg
    end try
end tell
'''
    
    returncode, stdout, stderr = run_applescript(query_script, $TIMEOUT_SEC)
    
    if returncode == -1:
        # Timeout
        log_msg(f"  ⚠️  {cal_name} 讀取逾時 (>{$TIMEOUT_SEC}s)，跳過")
        failed_calendars.append({"name": cal_name, "error": "timeout", "message": f"逾時 {$TIMEOUT_SEC} 秒"})
        continue
        
    if returncode != 0:
        log_msg(f"  ⚠️  {cal_name} 讀取失敗: {stderr}")
        failed_calendars.append({"name": cal_name, "error": "error", "message": stderr})
        continue
        
    if stdout.startswith("ERROR:"):
        log_msg(f"  ⚠️  {cal_name} 讀取錯誤: {stdout}")
        failed_calendars.append({"name": cal_name, "error": "error", "message": stdout})
        continue
    
    # 解析事件列表
    # AppleScript 輸出 list of lists: {{summary, start, end, location, desc}, {...}}
    # 實際輸出格式可能是: summary, startDate, endDate, , desc
    # 或者比較複雜的格式
    
    if stdout:
        log_msg(f"  原始輸出: {stdout[:200]}..." if len(stdout) > 200 else f"  原始輸出: {stdout}")
        
        # 解析 AppleScript 的 date 格式
        # 典型格式: "Friday, May 22, 2026 at 10:00:00 AM" 或 "2026年5月22日 上午10:00:00"
        
        def parse_applescript_date(date_str):
            try:
                # 移除 "at" 前後的空格，標準化
                date_str = date_str.replace(" at ", " ")
                
                # 嘗試多種格式解析
                import locale
                
                # 先試英文格式
                for fmt in [
                    "%A, %B %d, %Y %I:%M:%S %p",  # "Friday, May 22, 2026 10:00:00 AM"
                    "%B %d, %Y at %I:%M:%S %p",    # "May 22, 2026 at 10:00:00 AM"
                    "%Y-%m-%d %H:%M:%S",            # ISO 格式
                ]:
                    try:
                        dt = datetime.datetime.strptime(date_str.strip(), fmt)
                        return dt.isoformat()
                    except:
                        continue
                
                return date_str  # 失敗時回傳原始字串
            except:
                return date_str
        
        # 簡化處理：把 stdout 當作事件列表
        # AppleScript list of lists 輸出到 stdout 時會變成用逗號分隔的複雜格式
        # 這裡用比較簡單的方式：檢查是否有事件
        
        # 如果有內容但不是空的，試著解析
        event_count = 0
        
        # 方法1: 檢查是否有明確的事件格式
        # AppleScript {{A, B, C}, {D, E, F}} 會輸出成類似 A, B, C, D, E, F
        # 或者 "事件1, date1, date2, , 事件2, date3..." 這樣的格式
        
        # 比較保險的方式：如果 stdout 非空白且非 "{}"，則視為有事件
        # 然後我們用另一個方式來查詢（或者簡單記錄）
        
        if stdout and stdout != "{}" and not stdout.startswith("missing value"):
            # 有事件，嘗試用另一個方式取得詳細資訊
            # 或者簡單計數
            log_msg(f"  ✅ 有事件資料")
            
            # 為了正確解析，我們逐個事件查詢或者用不同的 AppleScript
            # 這裡先用簡化方式：記錄有事件，但詳細資訊可能需要個別處理
            
            # 簡化：建立單一事件（如果看起來只有一個）
            # 或者嘗試用更好的方式
            
            # 替代方案：用不同的 AppleScript 格式
            # 這裡先做一個簡單的處理，視情況未來擴充
            
            # 檢查是否是多個事件的列表
            # AppleScript 可能輸出成: summary1, date1a, date1b, location1, desc1, summary2, ...
            
            # 太複雜了，讓我們用一個更簡單的 AppleScript 來取得每個行事曆的事件數
            # 然後如果有事件，再用 JSON 格式輸出
            
            # 替代方案：重寫 AppleScript，讓它直接輸出比較容易解析的格式
            # 像是用 pipe 分隔欄位，換行分隔事件
            
            simple_script = f'''
tell application "Calendar"
    set today to current date
    set startOfDay to today - (time of today)
    set endOfDay to startOfDay + 24 * 60 * 60
    
    set output to ""
    
    try
        set targetCal to calendar "{cal_name_escaped}"
        set calEvents to (every event of targetCal where start date ≥ startOfDay and start date ≤ endOfDay)
        
        repeat with i from 1 to count of calEvents
            set evt to item i of calEvents
            set evtSummary to summary of evt
            set evtStart to start date of evt as string
            set evtEnd to end date of evt as string
            
            set evtLoc to location of evt
            if evtLoc is missing value then set evtLoc to ""
            
            set evtDesc to description of evt
            if evtDesc is missing value then set evtDesc to ""
            
            if i > 1 then set output to output & "|||"
            set output to output & evtSummary & ";;;" & evtStart & ";;;" & evtEnd & ";;;" & evtLoc & ";;;" & evtDesc
        end repeat
        
        return output
    on error
        return ""
    end try
end tell
'''
            rc, out, err = run_applescript(simple_script, $TIMEOUT_SEC)
            
            if rc == 0 and out:
                # 格式: summary;;;start;;;end;;;location;;;desc|||summary2;;;...
                events_raw = out.split("|||")
                
                for evt_raw in events_raw:
                    if evt_raw.strip():
                        parts = evt_raw.split(";;;")
                        if len(parts) >= 3:
                            summary = parts[0].strip()
                            start_str = parts[1].strip()
                            end_str = parts[2].strip()
                            location = parts[3].strip() if len(parts) > 3 else ""
                            description = parts[4].strip() if len(parts) > 4 else ""
                            
                            all_events.append({
                                "calendar": cal_name,
                                "summary": summary,
                                "start_raw": start_str,
                                "start": parse_applescript_date(start_str),
                                "end_raw": end_str,
                                "end": parse_applescript_date(end_str),
                                "location": location,
                                "description": description[:200] if description else ""
                            })
                            event_count += 1
            else:
                # 還是失敗，簡單記錄
                log_msg(f"  ⚠️  無法解析事件: {out}")
        
        log_msg(f"  找到 {event_count} 個事件")
    else:
        log_msg(f"  沒有今日事件")

# ============================================================================
# 輸出結果
# ============================================================================
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

# 排序事件（依開始時間）
try:
    def sort_key(evt):
        s = evt.get("start", "")
        if s and len(s) > 10:  # 看起來是 ISO 格式
            return s
        return evt.get("start_raw", "9999-12-31")
    
    all_events.sort(key=sort_key)
except:
    pass

log_msg(f"總計: {len(all_events)} 個事件來自 {len(calendar_names) - len(failed_calendars)}/{len(calendar_names)} 個行事曆")

status = "ok"
error_data = None

if len(all_events) == 0 and len(failed_calendars) > 0:
    if len(failed_calendars) == len(calendar_names):
        status = "error"
        error_data = {"code": "E-TIMEOUT", "message": "所有行事曆讀取逾時或失敗，請檢查 macOS 權限設定"}
    else:
        status = "partial"
        error_data = {"code": "E-PARTIAL", "message": f"{len(failed_calendars)} 個行事曆讀取失敗"}
elif len(failed_calendars) > 0:
    status = "partial"

data = {
    "events": all_events,
    "summary": {
        "total_events": len(all_events),
        "total_calendars": len(calendar_names),
        "queried_calendars": [c for c in calendar_names if c not in [f["name"] for f in failed_calendars]],
        "failed_calendars": failed_calendars
    },
    "date": str(today)
}

result = {
    "source": "calendar",
    "status": status,
    "layer": 1,
    "timestamp": ts,
    "data": data,
    "error": error_data
}

print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

log_info "$SOURCE_NAME" "行事曆讀取完成"
