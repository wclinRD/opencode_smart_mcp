---
name: mail-checker
description: 讀取 Apple Mail 今日郵件並匯入提醒事項。支援多帳號（iCloud、Gmail、SMI 等），可自動將重要郵件寫入 Apple Reminders（含 message:// 郵件連結 + Zoom 會議連結 + 內容摘要）。
license: MIT
compatibility: opencode
metadata:
  audience: macos_users
  workflow: email-automation
  requires: Apple Mail.app, Apple Reminders.app
---

# mail-checker

## 功能

透過 macOS AppleScript 操作 Apple Mail，讀取今日郵件並整合到 Apple 提醒事項。

**三種模式:**

1. **list** — 列出所有帳號今日郵件摘要（每帳號顯示主旨 + 寄件人 + 時間）
2. **read <account>** — 指定帳號詳細閱讀（含完整郵件列表、寄件人、時間）
3. **remind** — 自動掃描重要郵件，寫入 Apple Reminders「SMI」列表（含內容摘要 + 會議連結 + 郵件連結 + 到期日）

## 使用時機

當使用者說出以下內容時觸發：

- 「今天郵件」/「今日郵件」/「檢查郵件」
- 「SMI 有什麼新郵件」/「看 Gmail 郵件」
- 「把重要郵件記到提醒事項」/「匯入提醒」/「remind me」
- 「查一下哪個帳號有信」
- 任何與 Apple Mail 收信、讀信、整理郵件相關的請求

## 使用方法

腳本位址與 skill 同目錄：

```bash
bash <skill_dir>/check-email.sh list          # 列出所有帳號今日郵件
bash <skill_dir>/check-email.sh read <名稱>   # 讀取指定帳號郵件 (e.g. SMI, Gmail)
bash <skill_dir>/check-email.sh remind        # 重要郵件寫入 Apple Reminders
```

`remind` 內部會呼叫同目錄的 `remind.applescript`，自動完成：
- 掃描 SMI 與 Gmail.US 帳號的重要郵件
- 從 Zoom 邀請信中提取會議連結
- 從 GitHub 通知中提取審查連結
- 設定正確到期日
- 使用 `message://%3C...%3E` 格式的郵件連結

## 注意事項

- 需要 `osascript` (macOS 內建)，不需額外安裝
- Apple Mail.app 必須正在執行
- 首次執行可能需要授予「輔助使用」權限（系統設定 → 隱私權 → 輔助使用）
- 提醒事項寫入 **SMI** 列表（需預先建立）
- `remind` 會清除 SMI 列表後重建，請勿放入其他非郵件提醒
