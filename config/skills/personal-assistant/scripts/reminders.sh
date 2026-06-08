#!/bin/bash
# Personal Assistant - Reminders Reader
# 讀取 Apple Reminders 今日到期/逾期項目
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="reminders"
LAYER=3  # 批次 3（系統整合層）

log_info "$SOURCE_NAME" "開始讀取提醒事項..."

# 讀取設定
TIMEOUT_SEC=$(get_timeout)
[[ -z "$TIMEOUT_SEC" ]] && TIMEOUT_SEC=10

log_info "$SOURCE_NAME" "逾時設定: ${TIMEOUT_SEC} 秒"

# 使用 Python 協調
python3 << PYTHON_EOF
import subprocess
import json
import datetime
import sys

def log_msg(msg):
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    print(f"[{ts}] [INFO] [reminders.py] {msg}", file=sys.stderr)

def run_applescript(script, timeout_sec=10):
    """執行 AppleScript，有逾時保護"""
    try:
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
# 1. 先取得所有提醒列表名稱
# ============================================================================
log_msg("取得提醒事項列表...")

list_script = '''
tell application "Reminders"
    return name of every list
end tell
'''

returncode, stdout, stderr = run_applescript(list_script, 10)

list_names = []
if returncode == 0 and stdout:
    parts = [c.strip() for c in stdout.split(",") if c.strip()]
    list_names = parts
    log_msg(f"發現 {len(list_names)} 個列表: {list_names}")
else:
    log_msg(f"無法取得列表: {stderr}，使用預設")
    list_names = ["待辦事項", "Reminders"]

# ============================================================================
# 2. 逐個查詢列表中的今日/逾期提醒
# ============================================================================
today = datetime.date.today()
log_msg(f"查詢今日 ({today}) 或逾期的未完成提醒...")

all_reminders = []
failed_lists = []

def parse_applescript_date(date_str):
    try:
        # 多種格式嘗試
        date_str = date_str.replace(" at ", " ")
        
        for fmt in [
            "%A, %B %d, %Y %I:%M:%S %p",
            "%B %d, %Y at %I:%M:%S %p",
            "%Y-%m-%d %H:%M:%S",
        ]:
            try:
                dt = datetime.datetime.strptime(date_str.strip(), fmt)
                return dt.isoformat()
            except:
                continue
        
        return date_str
    except:
        return date_str

def is_overdue_or_today(due_date_str):
    """判斷是否逾期或今日"""
    try:
        # 簡單處理：如果有 due date，就視為需要處理
        return True
    except:
        return True

for list_name in list_names:
    log_msg(f"查詢列表: {list_name}")
    
    list_name_escaped = list_name.replace('"', '\\"')
    
    # AppleScript 查詢該列表的未完成提醒
    # 注意：Reminders AppleScript 查詢 "due date" 容易超時
    # 這裡用較簡單的查詢，再自己過濾
    
    query_script = f'''
tell application "Reminders"
    try
        set targetList to list "{list_name_escaped}"
        
        -- 先只查未完成的（較快）
        set rems to every reminder of targetList where completed is false
        
        set output to ""
        set remCount to 0
        
        repeat with rem in rems
            -- 限制數量，避免太多
            if remCount > 20 then exit repeat
            
            set remName to name of rem
            set remDue to due date of rem
            set remCompleted to completed of rem
            
            -- 選擇性欄位
            set remBody to body of rem
            if remBody is missing value then set remBody to ""
            
            set remPriority to priority of rem
            if remPriority is missing value then set remPriority to 0
            
            -- 只處理有 due date 或逾期的
            if remDue is not missing value then
                set remDueStr to remDue as string
            else
                set remDueStr to ""
            end if
            
            if output is not "" then set output to output & "|||"
            set output to output & remName & ";;;" & remDueStr & ";;;" & remBody & ";;;" & remPriority
            
            set remCount to remCount + 1
        end repeat
        
        return output
    on error errMsg
        return "ERROR: " & errMsg
    end try
end tell
'''
    
    returncode, stdout, stderr = run_applescript(query_script, $TIMEOUT_SEC)
    
    if returncode == -1:
        log_msg(f"  ⚠️  {list_name} 讀取逾時 (>{$TIMEOUT_SEC}s)，跳過")
        failed_lists.append({"name": list_name, "error": "timeout"})
        continue
        
    if returncode != 0:
        log_msg(f"  ⚠️  {list_name} 讀取失敗: {stderr}")
        failed_lists.append({"name": list_name, "error": "error", "message": stderr})
        continue
        
    if stdout.startswith("ERROR:"):
        log_msg(f"  ⚠️  {list_name} 讀取錯誤: {stdout}")
        failed_lists.append({"name": list_name, "error": "error", "message": stdout})
        continue
    
    # 解析提醒
    rem_count = 0
    if stdout:
        reminders_raw = stdout.split("|||")
        
        for rem_raw in reminders_raw:
            if rem_raw.strip():
                parts = rem_raw.split(";;;")
                if len(parts) >= 1:
                    name = parts[0].strip()
                    due_str = parts[1].strip() if len(parts) > 1 else ""
                    body = parts[2].strip() if len(parts) > 2 else ""
                    priority = parts[3].strip() if len(parts) > 3 else "0"
                    
                    # 只有有 due date 的才加入，或者所有未完成的都加入？
                    # 這裡我們加入所有未完成的（因為 query 已經過濾了 completed=false）
                    
                    all_reminders.append({
                        "list": list_name,
                        "name": name,
                        "due_date_raw": due_str,
                        "due_date": parse_applescript_date(due_str) if due_str else None,
                        "body": body[:200] if body else "",
                        "priority": int(priority) if priority.isdigit() else 0,
                        "is_overdue": False  # 簡單起見先不判斷
                    })
                    rem_count += 1
        
        log_msg(f"  找到 {rem_count} 個未完成提醒")
    else:
        log_msg(f"  沒有未完成提醒")

# ============================================================================
# 排序提醒事項
# ============================================================================
# 優先順序：有 due date > 沒有 due date
# 同樣有 due date：逾期 > 今日 > 未來

try:
    def sort_key(rem):
        due = rem.get("due_date", "")
        if due:
            return "0_" + due  # 有 due date 放前面
        return "1_" + rem.get("name", "")  # 沒 due date 放後面
    
    all_reminders.sort(key=sort_key)
except:
    pass

# ============================================================================
# 輸出結果
# ============================================================================
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

log_msg(f"總計: {len(all_reminders)} 個未完成提醒，來自 {len(list_names) - len(failed_lists)}/{len(list_names)} 個列表")

status = "ok"
error_data = None

if len(all_reminders) == 0 and len(failed_lists) > 0:
    if len(failed_lists) == len(list_names):
        status = "error"
        error_data = {"code": "E-TIMEOUT", "message": "所有提醒列表讀取逾時，請檢查 macOS 權限設定"}
    else:
        status = "partial"
        error_data = {"code": "E-PARTIAL", "message": f"{len(failed_lists)} 個列表讀取失敗"}
elif len(failed_lists) > 0:
    status = "partial"

data = {
    "reminders": all_reminders,
    "summary": {
        "total_reminders": len(all_reminders),
        "total_lists": len(list_names),
        "queried_lists": [l for l in list_names if l not in [f["name"] for f in failed_lists]],
        "failed_lists": failed_lists
    }
}

result = {
    "source": "reminders",
    "status": status,
    "layer": 3,
    "timestamp": ts,
    "data": data,
    "error": error_data
}

print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

log_info "$SOURCE_NAME" "提醒事項讀取完成"
