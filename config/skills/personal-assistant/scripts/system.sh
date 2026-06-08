#!/bin/bash
# Personal Assistant - System Status Checker
# 收集系統狀態：磁碟、電池、網路、記憶體
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="system"
LAYER=1  # 批次 1（系統層）

# =============================================================================
# 主程式 - 使用一個 Python 腳本完成所有工作
# =============================================================================

log_info "$SOURCE_NAME" "開始收集系統狀態..."

# 收集所有資訊，然後用 Python 組合 JSON
vm_stat_output=$(vm_stat 2>/dev/null || echo "")
df_output=$(df -h / 2>/dev/null || echo "")
batt_output=$(pmset -g batt 2>/dev/null || echo "")
ping_output=$(ping -c 1 -t 3 8.8.8.8 2>/dev/null || echo "no ping")

# 本地 IP
local_ip=$(ifconfig | grep -E 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1 || echo "unknown")

# 外部 IP
external_ip="offline"
if [[ -n "$ping_output" && "$ping_output" != "no ping" ]]; then
    external_ip=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "unknown")
fi

# 延遲
latency=""
if [[ -n "$ping_output" && "$ping_output" != "no ping" ]]; then
    latency=$(echo "$ping_output" | grep -oE 'time=[0-9.]+' | sed 's/time=//' | head -1)
fi

log_info "$SOURCE_NAME" "系統狀態收集完成"

# 用 Python 處理所有解析
python3 << PYTHON_EOF
import json
import datetime
import re
import sys

# 輸入資料
vm_stat_text = '''$vm_stat_output'''
df_text = '''$df_output'''
batt_text = '''$batt_output'''
ping_result = '''$ping_output'''
local_ip_val = '''$local_ip'''
external_ip_val = '''$external_ip'''
latency_val = '''$latency'''

# ============================================================================
# 1. 磁碟解析
# ============================================================================
disk_info = {"status": "error", "message": "無法讀取磁碟資訊"}
if df_text and "Filesystem" in df_text:
    lines = df_text.strip().split("\n")
    if len(lines) >= 2:
        # 第二行是資料
        parts = lines[1].split()
        if len(parts) >= 5:
            disk_info = {
                "total": parts[1],
                "used": parts[2],
                "available": parts[3],
                "usage_percent": parts[4]
            }

# ============================================================================
# 2. 電池解析
# ============================================================================
battery_info = {"status": "no_battery", "message": "無電池"}
if batt_text and "Battery" in batt_text or "AC Power" in batt_text:
    percent = "0%"
    m = re.search(r'(\d+)%;', batt_text)
    if m:
        percent = m.group(1) + "%"
    
    # 電源來源
    power_source = "unknown"
    m = re.search(r"drawing from '([^']+)'", batt_text)
    if m:
        power_source = m.group(1)
    
    # 狀態
    status = "unknown"
    if "charging" in batt_text:
        status = "charging"
    elif "discharging" in batt_text:
        status = "discharging"
    elif "AC Power" in batt_text:
        status = "connected"
    
    # 剩餘時間
    remaining = "calculating"
    m = re.search(r'(\d+:\d+) remaining', batt_text)
    if m:
        remaining = m.group(1)
    
    battery_info = {
        "percent": percent,
        "power_source": power_source,
        "status": status,
        "remaining": remaining
    }

# ============================================================================
# 3. 網路解析
# ============================================================================
connected = ping_result != "no ping" and "1 packets received" in ping_result

network_info = {
    "connected": connected,
    "latency_ms": latency_val,
    "local_ip": local_ip_val,
    "external_ip": external_ip_val
}

# ============================================================================
# 4. 記憶體解析
# ============================================================================
memory_info = {"status": "error", "message": "無法讀取記憶體"}
if vm_stat_text and "page size" in vm_stat_text:
    # Page size
    page_size = 16384
    m = re.search(r"page size of (\d+)", vm_stat_text)
    if m:
        page_size = int(m.group(1))
    
    def get_pages(name):
        # 嘗試多種 pattern
        pattern = r"Pages " + re.escape(name) + r":\s+(\d+)"
        m = re.search(pattern, vm_stat_text.replace(".", ""))
        return int(m.group(1)) if m else 0
    
    free = get_pages("free")
    active = get_pages("active")
    inactive = get_pages("inactive")
    wired = get_pages("wired down")
    speculative = get_pages("speculative")
    
    def gb(pages):
        return round(pages * page_size / 1024 / 1024 / 1024, 1)
    
    used = active + inactive + wired
    total = free + used + speculative
    usage_pct = int(used * 100 / total) if total > 0 else 0
    
    memory_info = {
        "free_gb": gb(free),
        "active_gb": gb(active),
        "inactive_gb": gb(inactive),
        "wired_gb": gb(wired),
        "speculative_gb": gb(speculative),
        "used_gb": gb(used),
        "total_gb": gb(total),
        "usage_percent": usage_pct
    }

# ============================================================================
# 組合最終結果
# ============================================================================
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

result = {
    "source": "system",
    "status": "ok",
    "layer": 1,
    "timestamp": ts,
    "data": {
        "disk": disk_info,
        "battery": battery_info,
        "network": network_info,
        "memory": memory_info
    },
    "error": None
}

print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF
