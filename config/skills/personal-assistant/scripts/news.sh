#!/bin/bash
# Personal Assistant - News RSS Fetcher
# 抓取新聞 RSS feeds 並輸出統一 JSON 格式
# 輸出：統一 JSON 格式 (CON-4)

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="news"
LAYER=2  # 批次 2（網路層）

log_info "$SOURCE_NAME" "開始收集新聞..."

# 讀取設定
NEWS_FEEDS=$(read_profile "news_feeds")
MAX_PER_FEED=$(read_profile "news_max_per_feed")
MAX_TOTAL=$(read_profile "news_max_total")

# 預設值
[[ -z "$MAX_PER_FEED" ]] && MAX_PER_FEED=5
[[ -z "$MAX_TOTAL" ]] && MAX_TOTAL=15

log_info "$SOURCE_NAME" "新聞來源: $NEWS_FEEDS"
log_info "$SOURCE_NAME" "每來源上限: $MAX_PER_FEED, 總量上限: $MAX_TOTAL"

# 用 Python 處理 RSS
python3 << PYTHON_EOF
import feedparser
import json
import sys
import datetime
import time
import warnings

# 抑制警告
warnings.filterwarnings("ignore")

def log_msg(msg):
    """寫入 stderr"""
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    print(f"[{ts}] [INFO] [news.py] {msg}", file=sys.stderr)

# RSS Feed 設定
FEED_CONFIG = {
    # 自由時報
    "ltn": {
        "name": "自由時報",
        "category": "國內",
        "url": "https://news.ltn.com.tw/rss/all.xml",
        "language": "zh-TW"
    },
    "ltn_politics": {
        "name": "自由時報-政治",
        "category": "政治",
        "url": "https://news.ltn.com.tw/rss/politics.xml",
        "language": "zh-TW"
    },
    "ltn_business": {
        "name": "自由時報-財經",
        "category": "財經",
        "url": "https://news.ltn.com.tw/rss/business.xml",
        "language": "zh-TW"
    },
    "ltn_world": {
        "name": "自由時報-國際",
        "category": "國際",
        "url": "https://news.ltn.com.tw/rss/world.xml",
        "language": "zh-TW"
    },
    "ltn_society": {
        "name": "自由時報-社會",
        "category": "社會",
        "url": "https://news.ltn.com.tw/rss/society.xml",
        "language": "zh-TW"
    },
    "ltn_life": {
        "name": "自由時報-生活",
        "category": "生活",
        "url": "https://news.ltn.com.tw/rss/life.xml",
        "language": "zh-TW"
    },
    
    # BBC 新聞
    "bbc_world": {
        "name": "BBC 世界新聞",
        "category": "國際",
        "url": "http://feeds.bbci.co.uk/news/world/rss.xml",
        "language": "en"
    },
    "bbc_business": {
        "name": "BBC 財經新聞",
        "category": "財經",
        "url": "http://feeds.bbci.co.uk/news/business/rss.xml",
        "language": "en"
    },
    "bbc_tech": {
        "name": "BBC 科技新聞",
        "category": "科技",
        "url": "http://feeds.bbci.co.uk/news/technology/rss.xml",
        "language": "en"
    },
    
    # 科技新報 (TechNews) - 待確認 RSS
    # "technews": {
    #     "name": "科技新報",
    #     "category": "科技",
    #     "url": "待確認",
    #     "language": "zh-TW"
    # },
    
    # iThome - 待確認 RSS
    # "ithome": {
    #     "name": "iThome",
    #     "category": "科技",
    #     "url": "待確認",
    #     "language": "zh-TW"
    # },
    
    # 鉅亨網 (cnyes) - 待確認 RSS
    # "cnyes": {
    #     "name": "鉅亨網",
    #     "category": "財經",
    #     "url": "待確認",
    #     "language": "zh-TW"
    # },
    
    # 中央社 (CNA) - 預設 RSS 失效，需要 RSSHub 或替代方案
    # "cna": {
    #     "name": "中央社",
    #     "category": "國內",
    #     "url": "待確認",
    #     "language": "zh-TW"
    # }
}

# 別名對應（讓 profile 可以用簡短名稱）
FEED_ALIASES = {
    "cna": "ltn",          # CNA 失效，改用 ltn
    "technews": "ltn_business",  # 暫時用財經替代
    "ithome": "bbc_tech",  # 暫時用 BBC Tech 替代
    "cnyes": "ltn_business"  # 暫時用自由時報財經替代
}

def fetch_feed(feed_id, config, max_items):
    """抓取單一 RSS feed"""
    results = []
    feed_name = config.get("name", feed_id)
    url = config.get("url")
    
    log_msg(f"抓取 {feed_name}...")
    
    try:
        # 設定 timeout (使用 feedparser 內部機制)
        import socket
        socket.setdefaulttimeout(10)
        
        feed = feedparser.parse(url)
        
        # 檢查狀態
        status = feed.get("status", 0)
        if status and status >= 400:
            log_msg(f"  ⚠️  {feed_name} HTTP 狀態: {status}")
            return [], f"HTTP {status}"
        
        if feed.bozo and feed.bozo_exception:
            log_msg(f"  ⚠️  {feed_name} 解析警告: {feed.bozo_exception}")
        
        entries = feed.entries
        log_msg(f"  ✅ 取得 {len(entries)} 篇文章")
        
        # 處理每篇文章
        for i, entry in enumerate(entries[:max_items]):
            try:
                # 基本資訊
                title = entry.get("title", "無標題").strip()
                link = entry.get("link", "")
                description = entry.get("description", entry.get("summary", "")).strip()
                
                # 去除 HTML tags（簡單處理）
                import re
                description = re.sub(r'<[^>]+>', '', description)
                description = re.sub(r'\s+', ' ', description).strip()
                
                # 發布時間
                published = entry.get("published", entry.get("updated", ""))
                
                # 解析時間（如果可能）
                published_parsed = entry.get("published_parsed", entry.get("updated_parsed"))
                pub_timestamp = None
                if published_parsed:
                    try:
                        pub_timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', published_parsed)
                    except:
                        pass
                
                results.append({
                    "feed_id": feed_id,
                    "feed_name": feed_name,
                    "category": config.get("category", "未分類"),
                    "language": config.get("language", "zh-TW"),
                    "title": title,
                    "link": link,
                    "description": description[:500] if description else "",  # 限制長度
                    "published_raw": published,
                    "published": pub_timestamp,
                    "index_in_feed": i
                })
            except Exception as e:
                log_msg(f"  處理文章時錯誤: {e}")
                continue
        
        return results, None
        
    except Exception as e:
        log_msg(f"  ❌ {feed_name} 抓取失敗: {e}")
        return [], str(e)

# ============================================================================
# 主程式
# ============================================================================

# 從環境變數取得設定
feeds_str = '''$NEWS_FEEDS'''
max_per_feed = int('''$MAX_PER_FEED''')
max_total = int('''$MAX_TOTAL''')

# 解析 feed 清單
feed_ids = [f.strip() for f in feeds_str.split(",") if f.strip()]

# 預設 feeds
if not feed_ids:
    feed_ids = ["ltn", "ltn_business", "bbc_world"]

log_msg(f"準備抓取 feeds: {feed_ids}")
log_msg(f"設定: 每 feed 最多 {max_per_feed} 篇，總共最多 {max_total} 篇")

# 抓取所有 feeds
all_articles = []
feed_errors = {}

for feed_id in feed_ids:
    # 處理別名
    actual_feed_id = FEED_ALIASES.get(feed_id, feed_id)
    
    if actual_feed_id not in FEED_CONFIG:
        log_msg(f"⚠️  未知的 feed: {feed_id} (別名對應: {actual_feed_id})，跳過")
        continue
    
    config = FEED_CONFIG[actual_feed_id]
    articles, error = fetch_feed(feed_id, config, max_per_feed)
    
    all_articles.extend(articles)
    if error:
        feed_errors[feed_id] = error

# 排序（依發布時間，如果有的話）
try:
    def sort_key(article):
        pub = article.get("published")
        if pub:
            return pub
        return "9999-12-31T23:59:59Z"
    
    all_articles.sort(key=sort_key, reverse=True)
except:
    pass

# 應用總量上限
if len(all_articles) > max_total:
    log_msg(f"文章數量 {len(all_articles)} 超過上限 {max_total}，截斷")
    all_articles = all_articles[:max_total]

# 統計
success_count = len(all_articles)
total_feeds = len(feed_ids)
failed_feeds = len(feed_errors)

log_msg(f"抓取完成: 共 {success_count} 篇文章，{failed_feeds}/{total_feeds} 個 feeds 失敗")

# 組合最終 JSON
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

# 決定 status
status = "ok"
error_data = None

if success_count == 0:
    status = "error"
    error_data = {"code": "E-NETWORK", "message": "所有新聞來源抓取失敗"}
elif failed_feeds > 0:
    status = "partial"
    error_data = {"code": "E-PARTIAL", "message": f"{failed_feeds} 個來源抓取失敗"}

data = {
    "articles": all_articles,
    "summary": {
        "total_articles": success_count,
        "total_feeds": total_feeds,
        "failed_feeds": failed_feeds,
        "feed_errors": feed_errors,
        "max_per_feed": max_per_feed,
        "max_total": max_total
    }
}

result = {
    "source": "news",
    "status": status,
    "layer": 2,
    "timestamp": ts,
    "data": data,
    "error": error_data
}

# 輸出到 stdout
print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

# 紀錄完成
log_info "$SOURCE_NAME" "新聞收集完成"
