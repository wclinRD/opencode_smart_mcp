#!/bin/bash
# Personal Assistant - Apple Notes Reader
# 讀取 Apple Notes 最近筆記
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="notes"
LAYER=3  # 批次 3（系統整合層）

log_info "$SOURCE_NAME" "開始讀取 Apple Notes..."

# 讀取設定
TIMEOUT_SEC=$(get_timeout)
[[ -z "$TIMEOUT_SEC" ]] && TIMEOUT_SEC=15  # Notes 通常需要更長一點時間
NOTES_MAX=5  # 預設取最近 5 則

log_info "$SOURCE_NAME" "逾時設定: ${TIMEOUT_SEC} 秒，最多取 ${NOTES_MAX} 則"

# 使用 Python 協調
python3 << PYTHON_EOF
import subprocess
import json
import datetime
import sys

def log_msg(msg):
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    print(f"[{ts}] [INFO] [notes.py] {msg}", file=sys.stderr)

def run_applescript(script, timeout_sec=15):
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

def parse_applescript_date(date_str):
    try:
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

# ============================================================================
# Notes AppleScript 容易超時，這裡嘗試多種方式
# ============================================================================

log_msg("嘗試讀取最近的 Notes...")

# 方式1：比較簡單的查詢 - 只取最近的幾筆
# 注意：Notes 的 AppleScript 架構
# - application "Notes"
#   - folders (文件夾)
#     - notes (筆記)

# 先嚐試一個非常簡單的查詢：是否能連上 Notes app
test_script = '''
tell application "Notes"
    return "OK"
end tell
'''

returncode, stdout, stderr = run_applescript(test_script, 5)

if returncode == -1:
    log_msg("❌ Notes AppleScript 連線逾時，可能是權限問題或 app 未啟動")
    # 輸出錯誤
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    result = {
        "source": "notes",
        "status": "error",
        "layer": 3,
        "timestamp": ts,
        "data": {"notes": [], "summary": {"total_notes": 0}},
        "error": {"code": "E-TIMEOUT", "message": "Notes 讀取逾時，請檢查 macOS 權限設定（系統設定 → 隱私權與安全性 → 備忘錄）"}
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(0)

if returncode != 0:
    log_msg(f"❌ Notes 無法連線: {stderr}")
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    result = {
        "source": "notes",
        "status": "error",
        "layer": 3,
        "timestamp": ts,
        "data": {"notes": [], "summary": {"total_notes": 0}},
        "error": {"code": "E-AUTH", "message": f"無法存取 Notes: {stderr}"}
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(0)

log_msg("✅ Notes app 可連線")

# 繼續嘗試取得筆記
# 方式2：取得所有資料夾名稱（先試試看）
log_msg("取得 Notes 資料夾列表...")

folders_script = '''
tell application "Notes"
    try
        set folderNames to name of every folder
        return folderNames
    on error errMsg
        return "ERROR: " & errMsg
    end try
end tell
'''

returncode, stdout, stderr = run_applescript(folders_script, $TIMEOUT_SEC)

folder_names = []
if returncode == 0 and stdout and not stdout.startswith("ERROR:"):
    parts = [c.strip() for c in stdout.split(",") if c.strip()]
    folder_names = parts
    log_msg(f"發現 {len(folder_names)} 個資料夾: {folder_names[:5]}..." if len(folder_names) > 5 else 
            f"發現 {len(folder_names)} 個資料夾: {folder_names}")
else:
    log_msg(f"無法取得資料夾列表，使用預設方式")
    folder_names = []  # 空的話後面用 alternative 方法

# ============================================================================
# 方式3：逐個資料夾查詢，或嘗試 alternative 方法
# ============================================================================
all_notes = []
failed_folders = []

# 最大筆數
max_notes = $NOTES_MAX

if folder_names:
    # 有資料夾列表，逐個查詢
    for folder_name in folder_names:
        if len(all_notes) >= max_notes:
            break
            
        log_msg(f"查詢資料夾: {folder_name}")
        
        folder_name_escaped = folder_name.replace('"', '\\"')
        
        # 查詢這個資料夾的筆記，按修改日期排序
        query_script = f'''
tell application "Notes"
    try
        set targetFolder to folder "{folder_name_escaped}"
        set allNotesInFolder to every note of targetFolder
        
        -- 最多取幾筆
        set noteList to {{}}
        set noteCount to 0
        set maxNotes to {max_notes}
        
        repeat with n in allNotesInFolder
            if noteCount ≥ maxNotes then exit repeat
            
            set nName to name of n
            set nBody to body of n
            set nCreation to creation date of n
            set nModification to modification date of n
            
            -- 轉換為字串
            set creationStr to nCreation as string
            set modStr to nModification as string
            
            if (count of noteList) is 0 then
                set noteList to {{nName, modStr, creationStr, "{folder_name_escaped}"}}
            else
                set noteList to noteList & {{nName, modStr, creationStr, "{folder_name_escaped}"}}
            end if
            
            set noteCount to noteCount + 1
        end repeat
        
        return noteList
    on error errMsg
        return "ERROR: " & errMsg
    end try
end tell
'''
        
        # 注意：這個查詢可能比較慢，用大一點的 timeout
        returncode, stdout, stderr = run_applescript(query_script, $TIMEOUT_SEC)
        
        if returncode == -1:
            log_msg(f"  ⚠️  {folder_name} 讀取逾時，跳過")
            failed_folders.append({"name": folder_name, "error": "timeout"})
            continue
            
        if returncode != 0 or stdout.startswith("ERROR:"):
            log_msg(f"  ⚠️  {folder_name} 讀取失敗: {stderr or stdout}")
            failed_folders.append({"name": folder_name, "error": "error"})
            continue
        
        # 解析筆記
        # AppleScript list of lists 輸出格式比較複雜
        # 這裡用簡單的方式處理
        if stdout:
            log_msg(f"  有筆記資料，嘗試解析...")
            
            # 替代方案：用不同的 AppleScript 格式
            # 或是簡單記錄有這個功能但需要更進一步處理
            
            # 這裡先用一個簡單的方式：嘗試用不同的 AppleScript 取得純文字格式
            simple_script = f'''
tell application "Notes"
    try
        set targetFolder to folder "{folder_name_escaped}"
        set allNotes to every note of targetFolder
        set output to ""
        set count to 0
        
        repeat with n in allNotes
            if count ≥ {max_notes} then exit repeat
            
            set nName to name of n
            set nMod to modification date of n as string
            
            if output is not "" then set output to output & "|||"
            set output to output & nName & ";;;" & nMod & ";;;" & "{folder_name_escaped}"
            
            set count to count + 1
        end repeat
        
        return output
    on error
        return ""
    end try
end tell
'''
            rc2, out2, err2 = run_applescript(simple_script, $TIMEOUT_SEC)
            
            if rc2 == 0 and out2:
                notes_raw = out2.split("|||")
                for note_raw in notes_raw:
                    if note_raw.strip() and len(all_notes) < max_notes:
                        parts = note_raw.split(";;;")
                        if len(parts) >= 2:
                            all_notes.append({
                                "title": parts[0].strip(),
                                "modification_date_raw": parts[1].strip(),
                                "modification_date": parse_applescript_date(parts[1].strip()),
                                "folder": parts[2].strip() if len(parts) > 2 else folder_name,
                                "creation_date": None,
                                "body_preview": ""
                            })
                
                log_msg(f"  找到 {len(notes_raw)} 則筆記")
else:
    # 沒有資料夾列表，嘗試 alternative 方式 - 預設資料夾
    log_msg("嘗試直接讀取預設資料夾...")
    
    default_script = f'''
tell application "Notes"
    try
        set output to ""
        set count to 0
        
        -- 嘗試從預設的 notes 直接取
        repeat with n in notes
            if count ≥ {max_notes} then exit repeat
            
            set nName to name of n
            set nMod to modification date of n as string
            
            if output is not "" then set output to output & "|||"
            set output to output & nName & ";;;" & nMod
            
            set count to count + 1
        end repeat
        
        return output
    on error errMsg
        return "ERROR: " & errMsg
    end try
end tell
'''
    
    returncode, stdout, stderr = run_applescript(default_script, $TIMEOUT_SEC)
    
    if returncode == 0 and stdout and not stdout.startswith("ERROR:"):
        notes_raw = stdout.split("|||")
        for note_raw in notes_raw:
            if note_raw.strip() and len(all_notes) < max_notes:
                parts = note_raw.split(";;;")
                if len(parts) >= 2:
                    all_notes.append({
                        "title": parts[0].strip(),
                        "modification_date_raw": parts[1].strip(),
                        "modification_date": parse_applescript_date(parts[1].strip()),
                        "folder": "default",
                        "creation_date": None,
                        "body_preview": ""
                    })
        
        log_msg(f"找到 {len(all_notes)} 則筆記")

# ============================================================================
# 排序筆記（依修改日期）
# ============================================================================
try:
    def sort_key(n):
        mod = n.get("modification_date", "")
        if mod and len(mod) > 10:
            return "0_" + mod
        return "1_" + n.get("title", "")
    
    all_notes.sort(key=sort_key, reverse=True)
    
    # 限制數量
    all_notes = all_notes[:max_notes]
except:
    pass

# ============================================================================
# 輸出結果
# ============================================================================
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

log_msg(f"總計: {len(all_notes)} 則筆記")

status = "ok"
error_data = None

if len(all_notes) == 0 and len(failed_folders) > 0:
    status = "partial"
    error_data = {"code": "E-PARTIAL", "message": f"{len(failed_folders)} 個資料夾讀取失敗"}

data = {
    "notes": all_notes,
    "summary": {
        "total_notes": len(all_notes),
        "max_notes_requested": max_notes,
        "failed_folders": failed_folders
    }
}

result = {
    "source": "notes",
    "status": status,
    "layer": 3,
    "timestamp": ts,
    "data": data,
    "error": error_data
}

print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

log_info "$SOURCE_NAME" "Apple Notes 讀取完成"
