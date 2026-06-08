#!/usr/bin/env bash
# check-email.sh — List / read / remind from Apple Mail via AppleScript.
#
# Usage:
#   bash scripts/check-email.sh list              # today's emails from all accounts
#   bash scripts/check-email.sh read <account>    # today's emails from one account
#   bash scripts/check-email.sh remind            # push important emails → Reminders
#
# All commands run from repo root or via scripts/check-email.sh.

set -u

# ─── helpers ─────────────────────────────────────────────────────────────

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
bold()   { printf '\033[1m%s\033[0m' "$1"; }

die() { echo "$(red '✗') $*" >&2; exit 1; }
info() { echo "$(bold '→') $*"; }

# ─── list: all accounts ──────────────────────────────────────────────────

list_all() {
  info "讀取所有帳號今日郵件…"

  osascript -e '
  tell application "Mail"
    set todayDate to current date
    set time of todayDate to 0
    set allAccounts to name of every account
    set output to ""

    repeat with acctName in allAccounts
      try
        set acct to account acctName
        set mbxName to "INBOX"

        -- Some accounts use Chinese mailbox names (e.g. SMI → "收件匣")
        try
          set testMbx to mailbox mbxName of acct
          set mbxName to mbxName
        on error
          set mbxName to "收件匣"
        end try

        set mbx to mailbox mbxName of acct
        set todayMsgs to (every message of mbx whose date received >= todayDate)
        set msgCount to length of todayMsgs

        if msgCount > 0 then
          set output to output & "=== " & acctName & " (" & msgCount & " 封) ===" & linefeed
          repeat with msg in todayMsgs
            set output to output & "  [" & (date received of msg) & "] " & (subject of msg) & linefeed
            set output to output & "      " & (sender of msg) & linefeed
          end repeat
          set output to output & linefeed
        end if
      end try
    end repeat

    if output is "" then
      return "今日所有帳號均無新郵件。"
    else
      return output
    end if
  end tell
  ' 2>&1
}

# ─── read: one account ───────────────────────────────────────────────────

read_account() {
  local acctName="${1:-}"
  printf '\033[1m→\033[0m 讀取「%s」今日郵件…\n' "$acctName"

  osascript -e '
  tell application "Mail"
    set todayDate to current date
    set time of todayDate to 0
    set acctName to "'"${acctName:-}"'"
    set output to ""

    try
      set acct to account acctName

      -- Try English inbox name first, fall back to Chinese
      try
        set mbx to mailbox "INBOX" of acct
      on error
        try
          set mbx to mailbox "收件匣" of acct
        on error
          set output to output & "錯誤: 找不到收件匣" & linefeed
          return output
        end try
      end try

      set todayMsgs to (every message of mbx whose date received >= todayDate)
      set msgCount to length of todayMsgs

      if msgCount = 0 then
        set output to output & acctName & " 今日無新郵件。" & linefeed
      else
        set output to output & "=== " & acctName & " (今日 " & msgCount & " 封) ===" & linefeed & linefeed
        repeat with i from 1 to msgCount
          set msg to item i of todayMsgs
          set subj to subject of msg
          set sndr to sender of msg
          set dt to date received of msg
          set output to output & "[" & i & "] " & subj & linefeed
          set output to output & "    寄件人: " & sndr & linefeed
          set output to output & "    時間: " & dt & linefeed & linefeed
        end repeat
      end if
    on error errMsg
      set output to output & "錯誤: " & errMsg & linefeed
    end try

    return output
  end tell
  ' 2>&1
}

# ─── remind: push important → Reminders ──────────────────────────────────

do_remind() {
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"

  info "掃描重要郵件並寫入提醒事項…"

  local result
  result=$(osascript "$script_dir/remind.applescript" 2>&1) || die "remind.applescript 執行失敗"

  echo "  $(green '✓') $result"
}

# ─── usage ───────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
用法: bash scripts/check-email.sh <command> [args]

指令:
  list                        列出所有帳號今日郵件摘要
  read <account>              讀取指定帳號今日郵件完整列表
  remind                      自動掃描重要郵件 → 寫入 Apple 提醒事項

範例:
  bash scripts/check-email.sh list
  bash scripts/check-email.sh read SMI
  bash scripts/check-email.sh remind
EOF
  exit 0
}

# ─── main ────────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
  list)
    list_all
    ;;
  read)
    [ $# -eq 0 ] && die "請指定帳號名稱，例如: $0 read SMI"
    read_account "$1"
    ;;
  remind)
    do_remind
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    die "未知指令: $CMD。使用 $0 help 查看說明"
    ;;
esac
