#!/bin/bash
# Personal Assistant - Stock Query
# 查詢台股與美股行情（使用 yfinance）
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="stock"
LAYER=2  # 批次 2（網路層）

log_info "$SOURCE_NAME" "開始查詢股市行情..."

# 讀取設定
STOCKS_TW=$(read_profile "stocks_tw")
STOCKS_US=$(read_profile "stocks_us")

log_info "$SOURCE_NAME" "台股清單: $STOCKS_TW"
log_info "$SOURCE_NAME" "美股清單: $STOCKS_US"

# 用 Python 查詢並輸出 JSON
python3 << PYTHON_EOF
import yfinance as yf
import json
import sys
import datetime
import warnings

# 抑制 urllib3 警告
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", message="NotOpenSSLWarning")

def get_stock_info(symbol, market="TW"):
    """查詢單一股票資訊"""
    result = {
        "symbol": symbol,
        "market": market,
        "name": None,
        "currency": "TWD" if market == "TW" else "USD",
        "price": None,
        "change": None,
        "change_percent": None,
        "open": None,
        "high": None,
        "low": None,
        "previous_close": None,
        "volume": None,
        "error": None
    }
    
    try:
        # 完整代號（台股自動加 .TW）
        full_symbol = symbol
        if market == "TW" and not symbol.endswith(".TW"):
            full_symbol = f"{symbol}.TW"
        
        # 方法1: 使用 Ticker.info
        ticker = yf.Ticker(full_symbol)
        info = ticker.info
        
        # 從 info 取資料
        result["name"] = info.get("longName") or info.get("shortName") or symbol
        
        # 嘗試各種可能的價格欄位
        price_keys = ["currentPrice", "regularMarketPrice", "price"]
        for key in price_keys:
            if info.get(key):
                result["price"] = info[key]
                break
        
        result["open"] = info.get("open")
        result["high"] = info.get("dayHigh")
        result["low"] = info.get("dayLow")
        result["previous_close"] = info.get("previousClose")
        result["volume"] = info.get("volume")
        
        # 計算變動
        if result["price"] and result["previous_close"] and result["previous_close"] > 0:
            result["change"] = round(result["price"] - result["previous_close"], 2)
            result["change_percent"] = round((result["change"] / result["previous_close"]) * 100, 2)
        
        # 如果 info 缺少關鍵資訊，嘗試用 download
        if not result["price"] or not result["previous_close"]:
            log_msg(f"  [{symbol}] info 不完整，嘗試 download...")
            
            # 下載最近 2 天的資料
            data = yf.download(full_symbol, period="3d", progress=False, timeout=10)
            
            if len(data) > 0:
                # 處理可能的 MultiIndex columns
                if hasattr(data.columns, 'levels') and len(data.columns.levels) > 1:
                    # MultiIndex: 取第一個 ticker 的資料
                    ticker_symbols = data.columns.levels[1] if len(data.columns.levels) > 1 else [full_symbol]
                    use_ticker = ticker_symbols[0] if ticker_symbols else full_symbol
                    
                    last_row = data.iloc[-1]
                    prev_row = data.iloc[-2] if len(data) > 1 else last_row
                    
                    result["price"] = float(last_row[('Close', use_ticker)]) if ('Close', use_ticker) in last_row.index else None
                    result["open"] = float(last_row[('Open', use_ticker)]) if ('Open', use_ticker) in last_row.index else None
                    result["high"] = float(last_row[('High', use_ticker)]) if ('High', use_ticker) in last_row.index else None
                    result["low"] = float(last_row[('Low', use_ticker)]) if ('Low', use_ticker) in last_row.index else None
                    result["volume"] = int(last_row[('Volume', use_ticker)]) if ('Volume', use_ticker) in last_row.index else None
                    
                    if len(data) > 1:
                        result["previous_close"] = float(prev_row[('Close', use_ticker)]) if ('Close', use_ticker) in prev_row.index else result["price"]
                else:
                    # 一般 columns
                    last_row = data.iloc[-1]
                    prev_row = data.iloc[-2] if len(data) > 1 else last_row
                    
                    result["price"] = float(last_row.get('Close', last_row.get('close', 0)))
                    result["open"] = float(last_row.get('Open', last_row.get('open', 0)))
                    result["high"] = float(last_row.get('High', last_row.get('high', 0)))
                    result["low"] = float(last_row.get('Low', last_row.get('low', 0)))
                    result["volume"] = int(last_row.get('Volume', last_row.get('volume', 0)))
                    
                    if len(data) > 1:
                        result["previous_close"] = float(prev_row.get('Close', prev_row.get('close', result["price"])))
                
                # 重新計算變動
                if result["price"] and result["previous_close"] and result["previous_close"] > 0:
                    result["change"] = round(result["price"] - result["previous_close"], 2)
                    result["change_percent"] = round((result["change"] / result["previous_close"]) * 100, 2)
        
        # 檢查是否有價格
        if not result["price"]:
            result["error"] = "無法取得價格資訊"
            log_msg(f"  [{symbol}] 無法取得價格")
        
    except Exception as e:
        result["error"] = str(e)
        log_msg(f"  [{symbol}] 錯誤: {e}")
    
    return result


def log_msg(msg):
    """寫入 stderr（避免干擾 stdout 的 JSON 輸出）"""
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    print(f"[{ts}] [INFO] [stock.py] {msg}", file=sys.stderr)


# 主程式
if __name__ == "__main__":
    # 從環境變數或預設值取得股票清單
    stocks_tw_str = '''$STOCKS_TW'''
    stocks_us_str = '''$STOCKS_US'''
    
    # 解析清單
    stocks_tw = [s.strip() for s in stocks_tw_str.split(",") if s.strip()]
    stocks_us = [s.strip() for s in stocks_us_str.split(",") if s.strip()]
    
    # 使用預設值（如果清單為空）
    if not stocks_tw:
        stocks_tw = ["2330", "2454", "2317"]
    if not stocks_us:
        stocks_us = ["AAPL", "TSLA", "MSFT", "NVDA"]
    
    log_msg(f"查詢台股: {stocks_tw}")
    log_msg(f"查詢美股: {stocks_us}")
    
    # 查詢所有股票
    tw_results = []
    us_results = []
    
    for symbol in stocks_tw:
        log_msg(f"查詢台股 {symbol}...")
        info = get_stock_info(symbol, "TW")
        tw_results.append(info)
    
    for symbol in stocks_us:
        log_msg(f"查詢美股 {symbol}...")
        info = get_stock_info(symbol, "US")
        us_results.append(info)
    
    # 計算統計
    tw_count_ok = sum(1 for r in tw_results if not r["error"])
    us_count_ok = sum(1 for r in us_results if not r["error"])
    
    log_msg(f"查詢完成: 台股 {tw_count_ok}/{len(tw_results)} 成功, 美股 {us_count_ok}/{len(us_results)} 成功")
    
    # 組合最終 JSON
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    
    # 決定 status
    total = len(tw_results) + len(us_results)
    ok_count = tw_count_ok + us_count_ok
    
    status = "ok"
    error_msg = None
    
    if ok_count == 0:
        status = "error"
        error_msg = "所有股票查詢失敗"
    elif ok_count < total:
        status = "partial"
    
    data = {
        "taiwan_stocks": tw_results,
        "us_stocks": us_results,
        "summary": {
            "taiwan": {"total": len(tw_results), "success": tw_count_ok},
            "us": {"total": len(us_results), "success": us_count_ok}
        }
    }
    
    result = {
        "source": "stock",
        "status": status,
        "layer": 2,
        "timestamp": ts,
        "data": data,
        "error": {"code": "E-PARTIAL", "message": "部分股票查詢失敗"} if status == "partial" else 
                 ({"code": "E-NETWORK", "message": error_msg} if error_msg else None)
    }
    
    # 輸出到 stdout
    print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

# 紀錄完成
log_info "$SOURCE_NAME" "股市查詢完成"
