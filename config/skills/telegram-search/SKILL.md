---
name: telegram-search
description: 使用 Telethon 搜尋 Telegram 群組/頻道歷史訊息，尋找 IPTV/M3U8 串流網址。需要使用者的 Telegram API ID/Hash + 手機驗證。
---

# Telegram Search Skill

使用 Telethon (MTProto) 搜尋 Telegram 群組/頻道的歷史訊息，自動擷取 M3U8/M3U 等直播串流網址。

## 事前準備

使用者需提供：
1. **API ID + API Hash** — 到 https://my.telegram.org/apps 登入取得
2. **Telegram 手機號碼** — 含國碼（如 +886...）
3. **首次需輸入驗證碼** — Telegram 會傳送到手機/App

## 使用方式

### 方法一：直接執行（互動輸入）

```bash
python3 search_telegram.py
```

### 方法二：環境變數（推薦腳本使用）

```bash
TELEGRAM_API_ID=12345 \
TELEGRAM_API_HASH=abc... \
TELEGRAM_PHONE=+886912345678 \
python3 search_telegram.py
```

首次執行需要再輸入驗證碼（環境變數 `TELEGRAM_CODE`）。

## Script 功能

- 自動登入 Telegram
- 對 `TARGET_GROUPS` 清單中的每個群組/頻道逐一搜尋
- 使用 `KEYWORDS` 清單搜尋相關訊息
- 自動擷取訊息中的所有網址（含 M3U8/M3U）
- 去重複顯示結果

## 自訂搜尋目標

編輯 `search_telegram.py` 中的 `TARGET_GROUPS` 和 `KEYWORDS` 變數：

```python
TARGET_GROUPS = [
    "tvzby",           # 直播源等影視資源分享交流群
    "dailyiptvm3u",    # IPTV Channels
]

KEYWORDS = [
    "m3u8", "m3u", "台灣", "taiwan",
    "直播源", "iptv", "電視", "新聞",
]
```

## 注意事項

- Telethon 會在本機建立 session 檔案儲存登入狀態（`telegram_session.session`）
- 首次使用後 session 會保留，下次不需重複驗證
- 用完建議刪除 session 檔案以保護帳號安全
