#!/usr/bin/env python3
"""
Telegram 群組搜尋工具 - 使用 Telethon
搜尋 @tvzby 等群組中的 M3U8/IPTV/台灣 直播源相關訊息

使用方式：
  1. 先設定環境變數或直接輸入：
     TELEGRAM_API_ID=12345 TELEGRAM_API_HASH=abc... python3 search_telegram.py
  2. 首次執行需要輸入電話號碼和驗證碼
"""

import os
import sys
import re
from telethon import TelegramClient

# 從環境變數或直接輸入
API_ID = os.environ.get("TELEGRAM_API_ID") or input("請輸入 API ID: ").strip()
API_HASH = os.environ.get("TELEGRAM_API_HASH") or input("請輸入 API Hash: ").strip()
PHONE = os.environ.get("TELEGRAM_PHONE", "")
CODE = os.environ.get("TELEGRAM_CODE", "")

# 注意：部分串流需要特定 User-Agent + Referer 才能存取
# 例如 大愛 (wanfudaluye.com) 需要 Mozilla/5.0 (Windows) + Referer: https://www.daai.tv/
# 測試時若遇到 403，先換不同 UA + Referer 再試
# 群組/頻道列表
TARGET_GROUPS = [
    # === 已知活躍群組 ===
    "tvzby",           # 直播源等影視資源分享交流群 (活躍，上萬人)
    "dailyiptvm3u",    # IPTV Channels (17.7K)
    # === 台灣 IPTV ===
    "taiwantvshare",   # 台灣電視分享
    "iptv_tw_free",    # 台灣免費IPTV
    "freetaiwaniptv",  # 台灣IPTV
    "tw_iptv",         # Taiwan IPTV
    "m3u8taiwan",      # Taiwan M3U8
    # === 新聞頻道 ===
    "iptv_news",       # IPTV News channels
    "livetvnews",      # Live TV news
    "m3u_news",        # M3U news channels
    "taiwanmedia",     # Taiwan media sharing
    # === 一般 IPTV 大群（可能有台灣內容）===
    "iptvchat",        # IPTV general chat
    "iptvm3u",         # M3U playlist sharing
    "freem3u",         # Free M3U sharing
    "m3ulist",         # M3U channel lists
    "iptvlist",        # IPTV channel lists
    "iptvfree",        # Free IPTV channels
    "livetv",          # Live TV channels
    "iptvm3ulist",     # IPTV M3U list
    "m3u8iptv",        # M3U8 IPTV
    "iptvworld",       # IPTV worldwide
    # === 台灣電視/新聞英文名 ===
    "tvbs",            # TVBS
    "setn",            # 三立
    "ebc",             # 東森
    "cts",             # 華視
]

# 搜尋關鍵字 — 聚焦新聞頻道
# 注意：頻道可能用繁體/簡體/英文命名，三種都要搜
# 按搜尋優先順序排列：最新熱門關鍵字在前
KEYWORDS = [
    # === 新聞直播 ===
    "新聞直播", "新聞台", "live新聞",
    "新闻直播", "新闻台",
    "live news taiwan", "taiwan live news",
    # === 繁體新聞頻道 ===
    "tvbs", "TVBS", "民視", "三立", "東森", "中天",
    "寰宇新聞", "非凡新聞", "華視新聞", "台視新聞", "中視新聞",
    "公視新聞", "大愛",
    # === 簡體新聞頻道 ===
    "民视", "华视", "台视", "东森", "中天", "三立", "大爱",
    "寰宇新闻", "非凡新闻", "公视新闻",
    # === 英文簡稱 ===
    "FTV", "CTS", "TTV", "CTV",
    "SETN", "EBC", "CTI",
    "TVBS", "tvbs",
    # === 一般搜尋 ===
    "新聞", "新闻",
    "台灣", "taiwan",
    "m3u8", "m3u",
    "iptv", "直播源",
    "channel", "taiwan channel",
    "taiwan live", "taiwan tv",
    "free iptv taiwan", "taiwan m3u8",
]

async def main():
    client = TelegramClient("telegram_session", API_ID, API_HASH)

    code_callback = (lambda: CODE) if CODE else None
    await client.start(phone=PHONE, code_callback=code_callback)
    me = await client.get_me()
    print(f"✅ 已登入: {me.phone or me.username or str(me.id)}")

    for group_name in TARGET_GROUPS:
        print(f"\n{'='*60}")
        print(f"🔍 搜尋群組: @{group_name}")
        print(f"{'='*60}")

        try:
            entity = await client.get_entity(group_name)
            total = 0
            found_urls = set()

            # 對每個關鍵字分別搜尋
            for kw in KEYWORDS:
                try:
                    async for msg in client.iter_messages(entity, search=kw, limit=200):
                        total += 1
                        text = msg.text or ""
                        # 抓出 M3U8 / M3U 網址
                        urls = re.findall(r'https?://[^\s<>"\']+\.(?:m3u8?|txt)', text, re.I)
                        # 也抓一般網址（可能指向貼文或分享連結）
                        urls += re.findall(r'https?://[^\s<>"\']+', text)

                        for url in urls:
                            if url not in found_urls:
                                found_urls.add(url)
                                print(f"\n📺 [{kw}] {msg.date.strftime('%Y-%m-%d %H:%M')}")
                                print(f"   {url}")
                                if len(text) > 200:
                                    print(f"   摘要: {text[:200]}...")
                                else:
                                    print(f"   {text}")

                except Exception as e:
                    print(f"   ⚠️ 搜尋 '{kw}' 錯誤: {e}")
                    continue

            print(f"\n📊 @{group_name}: 掃描 {total} 則訊息, 找到 {len(found_urls)} 個網址")

        except Exception as e:
            print(f"❌ 無法存取 @{group_name}: {e}")
            print("   (可能群組不存在、私密、或需要先加入)")

    await client.disconnect()
    print("\n✅ 搜尋完成")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
