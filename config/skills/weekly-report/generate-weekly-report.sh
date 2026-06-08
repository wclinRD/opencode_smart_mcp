#!/usr/bin/env bash
# generate-weekly-report.sh — 產生週報並寫入 Obsidian wiki
#
# Usage:
#   bash <script> new [week_number]      # 建立新週報（預設本週）
#   bash <script> fill <file_path>       # 補充已存在的週報
#   bash <script> template [week_number] # 僅產空白模板
#
# Data sources:
#   - SMI 郵件 (Apple Mail via osascript)
#   - wiki log.md / hot.md
#   - 會議記錄 (20-工作/24-會議記錄/)

set -euo pipefail

# ─── helpers ──────────────────────────────────────────────────────────

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
bold()   { printf '\033[1m%s\033[0m' "$1"; }

die()    { echo "$(red '✗') $*" >&2; exit 1; }
info()   { echo "$(bold '→') $*"; }
ok()     { echo "  $(green '✓') $*"; }
warn()   { echo "  $(yellow '⚠') $*"; }

# ─── config ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 讀取 Obsidian vault 路徑
OBSIDIAN_CONFIG="$HOME/.obsidian-wiki/config"
if [ -f "$OBSIDIAN_CONFIG" ]; then
  # shellcheck source=/dev/null
  source "$OBSIDIAN_CONFIG"
fi
VAULT="${OBSIDIAN_VAULT_PATH:-}"
if [ -z "$VAULT" ] || [ ! -d "$VAULT" ]; then
  die "找不到 Obsidian vault (OBSIDIAN_VAULT_PATH=$VAULT)，請檢查 ~/.obsidian-wiki/config"
fi

# 使用者 Email（用於 Apple Mail 過濾自己的信件）
# 可透過環境變數 SMI_EMAIL 設定，或寫入 ~/.config/opencode/skills/weekly-report/config
SMI_EMAIL="${SMI_EMAIL:-}"

WEEKLY_DIR="$VAULT/70-日誌/72-週-月回顧"

# ─── date helpers ─────────────────────────────────────────────────────

# 計算週報期間：上週四 ~ 本週三
# 參數: $1 = 參考日期 (預設今天)
# 輸出全局變數: PERIOD_START, PERIOD_END, PERIOD_START_DISPLAY, PERIOD_END_DISPLAY, PERIOD_YEAR
calculate_period() {
  local ref_date="${1:-$(date +%Y-%m-%d)}"

  if ! date -j -f "%Y-%m-%d" "$ref_date" "+%s" >/dev/null 2>&1; then
    die "不支援的 date 指令或日期格式: $ref_date"
  fi

  local dow
  dow=$(date -j -f "%Y-%m-%d" "$ref_date" "+%u")  # 1=Mon ... 7=Sun

  # 往回找最近的星期三 (dow=3)
  local days_to_wed=$(( (dow - 3 + 7) % 7 ))
  local ref_ts
  ref_ts=$(date -j -f "%Y-%m-%d" "$ref_date" "+%s")

  local wed_ts=$((ref_ts - days_to_wed * 86400))
  local thu_ts=$((wed_ts - 6 * 86400))

  PERIOD_START=$(date -j -f "%s" "$thu_ts" "+%Y-%m-%d")
  PERIOD_END=$(date -j -f "%s" "$wed_ts" "+%Y-%m-%d")
  PERIOD_START_DISPLAY=$(date -j -f "%s" "$thu_ts" "+%m/%d (%a)")
  PERIOD_END_DISPLAY=$(date -j -f "%s" "$wed_ts" "+%m/%d (%a)")
  PERIOD_YEAR=$(date -j -f "%s" "$wed_ts" "+%Y")
}

# ─── AppleScript: SMI 郵件掃描 ───────────────────────────────────────

fetch_smi_emails() {
  local start_date="$1"
  local end_date="$2"

  osascript 2>/dev/null -e '
  tell application "Mail"
    set startDate to (current date)
    set year of startDate to '$((10#${start_date:0:4}))'
    set month of startDate to '$((10#${start_date:5:2}))'
    set day of startDate to '$((10#${start_date:8:2}))'
    set time of startDate to 0

    set endDate to (current date)
    set year of endDate to '$((10#${end_date:0:4}))'
    set month of endDate to '$((10#${end_date:5:2}))'
    set day of endDate to '$((10#${end_date:8:2}))'
    set time of endDate to 23 * 3600 + 59 * 60 + 59

    try
      set acct to account "SMI"
      try
        set mbx to mailbox "INBOX" of acct
      on error
        set mbx to mailbox "收件匣" of acct
      end try
    on error
      return "__NO_SMI_ACCOUNT__"
    end try

    set msgs to (every message of mbx whose date received ≥ startDate and date received ≤ endDate)
    set output to ""
    set addedSubjects to {}
    set userEmail to "'"$SMI_EMAIL"'"

    -- 優先找使用者發出的郵件
    repeat with msg in msgs
      set sndr to sender of msg
      if sndr contains userEmail then
        set subj to subject of msg
        set dt to date received of msg
        set msgId to message id of msg
        set msgLink to "message://%3C" & msgId & "%3E"
        set alreadyAdded to false
        repeat with asubj in addedSubjects
          if asubj = subj then
            set alreadyAdded to true
            exit repeat
          end if
        end repeat
        if not alreadyAdded then
          set addedSubjects to addedSubjects & subj
          set output to output & "● [發信] [" & dt & "] " & subj & " [📧](" & msgLink & ")" & linefeed
        end if
      end if
    end repeat

    -- 再找使用者有參與的郵件（在收件人/副本中）
    repeat with msg in msgs
      set sndr to sender of msg
      if sndr does not contain userEmail then
        set subj to subject of msg
        set dt to date received of msg
        set msgId to message id of msg
        set msgLink to "message://%3C" & msgId & "%3E"
        -- 檢查主旨是否已在上面清單中
        set alreadyAdded to false
        repeat with asubj in addedSubjects
          if asubj = subj then
            set alreadyAdded to true
            exit repeat
          end if
        end repeat
        if not alreadyAdded then
          -- 用關鍵字過濾重要郵件
          set keywords to {"UFS5a", "SM2755", "SM2758", "FPGA", "ONFI", "M2", "LDPC", "Randomizer", "PLATS", "Analog IP", "formal release", "physical synthesis", "regression", "floorplan", "HFCRP", "workstation"}
          set matched to false
          repeat with kw in keywords
            if subj contains kw then
              set matched to true
              exit repeat
            end if
          end repeat
          if matched then
            set addedSubjects to addedSubjects & subj
            set output to output & "○ [參與] [" & dt & "] " & subj & " [📧](" & msgLink & ")  _" & sndr & "_" & linefeed
          end if
        end if
      end if
    end repeat

    if output is "" then
      return "__NO_EMAILS__"
    end if
    return output
  end tell
  ' 2>&1
}

# ─── 郵件分組 ─────────────────────────────────────────────────────────

# 將原始郵件列表按專案分組輸出
group_smi_emails() {
  local raw="$1"
  [ -z "$raw" ] && return

  local output=""
  local unmatched=""

  # 定義分組: label|pattern1|pattern2|...
  # 順序越前面優先度越高，UFS5a 細分放前面，general 放最後
  local groups=(
    "🔵 UFS5a - Analog IP|Analog IP"
    "🔵 UFS5a - PLATS/Randomizer|PLATS|Randomizer"
    "🔵 UFS5a - LDPC|LDPC"
    "🔵 UFS5a - Ver/Release|ZA0|Ver 0\\.|formal release"
    "🔵 UFS5a - Physical Synthesis|physical synthesis|FP2 SVN|FP2 timing"
    "🔵 UFS5a - Floorplan|Floorplan"
    "🔵 UFS5a - 其他|UFS5a|UFS5A|UFS5"
    "🟢 M2 SF5 / ONFI|ONFI|M2 SF5|M2 SF5A"
    "🟡 SM2755|SM2755"
    "🟡 SM2758|SM2758"
    "🟠 SM2752P - BIWIN DVT|BIWIN"
    "🟠 SM2752P - TWSC DVT|TWSC"
    "🟠 SM2752P - 其他|SM2752P|CS DVT|DVT"
    "📊 Regression|Regression"
    "🔴 系統通知|SUSPEND|sf11068|防火牆|WAF|薪資|RDFTP"
    "⚪ Samsung 5LPE|Samsung 5LPE|Samsung 8LPU"
    "⚪ 其他會議/通知|meeting|Meeting|header file|FPGA|Synopsys|Memory|SDK|pythonAPP"
  )

  # 先用空行分隔「發信」和「參與」區塊
  local sent_lines=""
  local particip_lines=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^● ]]; then
      sent_lines+="$line"$'\n'
    elif [[ "$line" =~ ^○ ]]; then
      particip_lines+="$line"$'\n'
    fi
  done <<< "$raw"

  # 處理「發信」- 獨立一區
  if [ -n "$sent_lines" ]; then
    output+="### ✉️ 你發出的郵件
"
    output+="$sent_lines"
    output+="
"
  fi

  # 處理「參與」- 按專案分組
  if [ -n "$particip_lines" ]; then
    output+="### 👀 參與的討論
"
    local accumulated=""
    local remaining="$particip_lines"

    for group in "${groups[@]}"; do
      local label="${group%%|*}"
      local patterns="${group#*|}"

      local matches=""
      local rest=""

      while IFS= read -r line; do
        [ -z "$line" ] && continue
        local matched=false
        local IFS='|'
        for pat in $patterns; do
          unset IFS
          if [[ "$line" =~ $pat ]]; then
            matched=true
            break
          fi
          IFS='|'
        done
        unset IFS

        if $matched; then
          matches+="$line"$'\n'
        else
          rest+="$line"$'\n'
        fi
      done <<< "$remaining"

      if [ -n "$matches" ]; then
        # 計算行數
        local count=0
        while IFS= read -r; do ((count++)); done <<< "$matches"
        output+="
  **${label}** (${count})
"
        while IFS= read -r line; do
          [ -z "$line" ] && continue
          output+="  ${line}
"
        done <<< "$matches"
      fi

      remaining="$rest"
    done

    # 未分類的
    if [ -n "$remaining" ]; then
      local count=0
      while IFS= read -r; do ((count++)); done <<< "$remaining"
      output+="
  **⚪ 其他** (${count})
"
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        output+="  ${line}
"
      done <<< "$remaining"
    fi
  fi

  echo "$output"
}

# ─── 郵件摘要（精簡版：只顯示分組計數）──────────────────────────────

group_smi_emails_summary() {
  local raw="$1"
  [ -z "$raw" ] && return

  local particip_lines=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^○ ]]; then
      particip_lines+="$line"$'\n'
    fi
  done <<< "$raw"

  [ -z "$particip_lines" ] && return

  local groups=(
    "🔵 UFS5a - Analog IP|Analog IP"
    "🔵 UFS5a - PLATS/Randomizer|PLATS|Randomizer"
    "🔵 UFS5a - LDPC|LDPC"
    "🔵 UFS5a - Ver/Release|ZA0|Ver 0\\.|formal release"
    "🔵 UFS5a - Physical Synthesis|physical synthesis|FP2 SVN|FP2 timing"
    "🔵 UFS5a - Floorplan|Floorplan"
    "🔵 UFS5a - 其他|UFS5a|UFS5A|UFS5"
    "🟢 M2 SF5 / ONFI|ONFI|M2 SF5|M2 SF5A"
    "🟡 SM2755|SM2755"
    "🟡 SM2758|SM2758"
    "🟠 SM2752P - BIWIN DVT|BIWIN"
    "🟠 SM2752P - TWSC DVT|TWSC"
    "🟠 SM2752P - 其他|SM2752P|CS DVT|DVT"
    "📊 Regression|Regression"
    "🔴 系統通知|SUSPEND|sf11068|防火牆|WAF|薪資|RDFTP"
    "⚪ Samsung 5LPE|Samsung 5LPE|Samsung 8LPU"
    "⚪ 其他會議/通知|meeting|Meeting|header file|FPGA|Synopsys|Memory|SDK|pythonAPP"
  )

  local output=""
  local remaining="$particip_lines"

  for group in "${groups[@]}"; do
    local label="${group%%|*}"
    local patterns="${group#*|}"

    local matches=""
    local rest=""

    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local matched=false
      local IFS='|'
      for pat in $patterns; do
        unset IFS
        if [[ "$line" =~ $pat ]]; then
          matched=true
          break
        fi
        IFS='|'
      done
      unset IFS

      if $matched; then
        matches+="$line"$'\n'
      else
        rest+="$line"$'\n'
      fi
    done <<< "$remaining"

    if [ -n "$matches" ]; then
      local count=0
      while IFS= read -r; do ((count++)); done <<< "$matches"
      output+="  ${label} ........ **${count}** threads
"
    fi

    remaining="$rest"
  done

  # 未分類
  if [ -n "$remaining" ]; then
    local count=0
    while IFS= read -r; do ((count++)); done <<< "$remaining"
    output+="  ⚪ 其他 ........ **${count}** threads
"
  fi

  echo "$output"
}

# ─── 郵件摘要（每組自帶可折疊 callout）─────────────────────────────

group_smi_emails_per_group() {
  local raw="$1"
  [ -z "$raw" ] && return

  local sent_lines=""
  local particip_lines=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^● ]]; then
      sent_lines+="$line"$'\n'
    elif [[ "$line" =~ ^○ ]]; then
      particip_lines+="$line"$'\n'
    fi
  done <<< "$raw"

  local output=""

  # 發信的郵件 — 直接展開（通常很少）
  if [ -n "$sent_lines" ]; then
    output+="### ✉️ 你發出的郵件
"
    while IFS= read -r line; do
      output+="${line}
" 
    done <<< "$sent_lines"
    output+="
"
  fi

  # 參與的討論 — 每組各自 callout
  if [ -z "$particip_lines" ]; then
    echo "$output"
    return
  fi

  # 如果有參與內容，加標題（除非已經有發信區塊在前面）
  if [ -n "$output" ]; then
    output+="
"
  fi
  output+="### 👀 參與的討論

"

  local groups=(
    "🔵 UFS5a - Analog IP|Analog IP"
    "🔵 UFS5a - PLATS/Randomizer|PLATS|Randomizer"
    "🔵 UFS5a - LDPC|LDPC"
    "🔵 UFS5a - Ver/Release|ZA0|Ver 0\\.|formal release"
    "🔵 UFS5a - Physical Synthesis|physical synthesis|FP2 SVN|FP2 timing"
    "🔵 UFS5a - Floorplan|Floorplan"
    "🔵 UFS5a - 其他|UFS5a|UFS5A|UFS5"
    "🟢 M2 SF5 / ONFI|ONFI|M2 SF5|M2 SF5A"
    "🟡 SM2755|SM2755"
    "🟡 SM2758|SM2758"
    "🟠 SM2752P - BIWIN DVT|BIWIN"
    "🟠 SM2752P - TWSC DVT|TWSC"
    "🟠 SM2752P - 其他|SM2752P|CS DVT|DVT"
    "📊 Regression|Regression"
    "🔴 系統通知|SUSPEND|sf11068|防火牆|WAF|薪資|RDFTP"
    "⚪ Samsung 5LPE|Samsung 5LPE|Samsung 8LPU"
    "⚪ 其他會議/通知|meeting|Meeting|header file|FPGA|Synopsys|Memory|SDK|pythonAPP"
  )

  local remaining="$particip_lines"

  for group in "${groups[@]}"; do
    local label="${group%%|*}"
    local patterns="${group#*|}"

    local matches=""
    local rest=""

    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local matched=false
      local IFS='|'
      for pat in $patterns; do
        unset IFS
        if [[ "$line" =~ $pat ]]; then
          matched=true
          break
        fi
        IFS='|'
      done
      unset IFS

      if $matched; then
        matches+="$line"$'\n'
      else
        rest+="$line"$'\n'
      fi
    done <<< "$remaining"

    if [ -n "$matches" ]; then
      local count=0
      while IFS= read -r; do ((count++)); done <<< "$matches"
      output+="
  **${label}** (${count})
"
      output+="  > [!summary]- 展開查看 (${count} 封)
"
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        output+="  > ${line}
"
      done <<< "$matches"
      output+="
"
    fi

    remaining="$rest"
  done

  # 未分類
  if [ -n "$remaining" ]; then
    local count=0
    while IFS= read -r; do ((count++)); done <<< "$remaining"
    output+="
  **⚪ 其他** (${count})
"
    output+="  > [!summary]- 展開查看 (${count} 封)
"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      output+="  > ${line}
"
    done <<< "$remaining"
    output+="
"
  fi

  echo "$output"
}

# ─── 主題提取：從郵件標題自動產生本週重點標籤 ─────────────────────

extract_topics() {
  local raw="$1"
  [ -z "$raw" ] && return

  # 用 perl 從每行提取主旨，做潔淨處理
  # 先排除系統通知類郵件（LSF SUSPEND、防火牆警告等）
  local filtered
  filtered=$(echo "$raw" | grep -v "SUSPEND\|sf11068\|防火牆\|WAF" || true)
  [ -z "$filtered" ] && return

  local subjects
  subjects=$(echo "$filtered" | perl -CS -Mutf8 -lne '
    # 移除前綴 ● ○ 標記 + [發信]/[參與] + [日期]
    s/^[●○]\s*\[.*?\]\s*\[.*?\]\s+//;
    # 再移除可能殘留的 [發信]/[參與]
    s/^\[.*?\]\s+//;
    # 移除 Re:/RE:/回覆:/FW:/Fwd: 前綴
    s/^(Re|RE|回覆|FW|Fwd|FWD):\s*//;
    # 移除所有開頭的 [tag] 模式（如 [UFS5a] [TWSC][SM2752P] 等專案標籤）
    s/^(\[[^\]]*\]\s*)+//;
    # 移除內文中的 ticket ID 模式（如 Q52R-207028, Q52P-207071 等）
    s/\s*[A-Z][A-Z0-9]+[-_][0-9]+//g;
    # 移除郵件連結標記 [📧](...)
    s/\s*\[📧\]\(.*?\)\s*$//;
    # 移除寄件人標記 _name <email>_
    s/\s*_\s*.*\s*_\s*$//;
    # 移除純數字結尾或日期模式
    s/\s*\d{4}\s*$//;
    # 只剩主旨
    print if length($_) > 5;
  ')

  [ -z "$subjects" ] && return

  # 提取關鍵詞：去掉常見停用詞，計算頻率，取 top 6
  local topics
  topics=$(echo "$subjects" | tr '[:space:]' '\n' | \
    # 去除空白行和短詞
    grep -v '^\s*$' | \
    grep -v '^.$' | grep -v '^..$' | \
    # 去掉數字、單字母、含特殊符號的詞
    grep -vE '^[0-9]+$' | \
    grep -vE '^[0-9]{4}' | \
    grep -vE '\[|\]|#|@|\(|\)' | \
    grep -vE '^[A-Z]+[-_][0-9A-Z]+' | \
    # 停用詞
    grep -viE '^(the|a|an|for|of|to|in|on|and|or|with|from|by|at|is|it|be|this|that|re|fw|fwd|all|any|can|will|not|yes|no|has|had|have|do|does|but|so|if|as|than|then|now|just|also|very|some|here|there|when|where|what|which|how|much|many|each|every|both|few|own|same|such|only|other|into|over|after|before|between|under|again|once|more|most|too|well)$' | \
    grep -viE '^(re|fw|fwd|regards|hello|hi|dear|team|update|status|result|info|test|data|report|meeting|release|version|request|check|review|done|ok|help|need|please|thanks)$' | \
    grep -viE '^(您好|你好|感謝|謝謝|請問|麻煩|請教|大家|郵件|主旨|回覆|轉寄|日期|時間|星期|上午|下午|晚上|凌晨|清晨|中午)$' | \
    sort | uniq -c | sort -rn | head -8 | \
    awk '{print $2}' | tr '\n' ' ')

  if [ -n "$topics" ]; then
    # 格式化為 Obsidian tag 樣式
    local formatted=""
    for t in $topics; do
      formatted+="\`#${t}\` "
    done
    echo "$formatted"
  fi
}

# ─── git log: 取代 hot.md 的開發進度 ────────────────────────────────

fetch_git_log() {
  local start_date="$1"
  local end_date="$2"
  local output=""

  # 掃描常見專案目錄中的 git repos
  local scan_dirs=(
    "$HOME"
    "$HOME/Developer"
    "$HOME/Projects"
    "$VAULT"
  )
  local already_seen=""

  for scan_dir in "${scan_dirs[@]}"; do
    [ ! -d "$scan_dir" ] && continue
    while IFS= read -r gitdir; do
      local repo_dir
      repo_dir=$(dirname "$gitdir")
      # 跳過 vim plugins 等系統目錄
      [[ "$repo_dir" == *"/plugged/"* ]] && continue
      [[ "$repo_dir" == *"/.vim/"* ]] && continue
      [[ "$repo_dir" == *"/Carthage/"* ]] && continue
      [[ "$repo_dir" == *"/Pods/"* ]] && continue
      [[ "$repo_dir" == *"/node_modules/"* ]] && continue
      # 跳過已處理的
      [[ "$already_seen" == *"$repo_dir"* ]] && continue
      already_seen+="$repo_dir|"

      local user
      user=$(git -C "$repo_dir" config user.name 2>/dev/null || echo "")
      local commits
      if [ -n "$user" ]; then
        commits=$(git -C "$repo_dir" log --oneline --since="$start_date" --until="$end_date" --author="$user" 2>/dev/null | head -20 || true)
      else
        commits=$(git -C "$repo_dir" log --oneline --since="$start_date" --until="$end_date" 2>/dev/null | head -10 || true)
      fi
      if [ -n "$commits" ]; then
        local repo_name
        repo_name=$(basename "$repo_dir")
        output+="  **${repo_name}**
"
        while IFS= read -r line; do
          [ -z "$line" ] && continue
          output+="  - \`${line}\`
"
        done <<< "$commits"
        output+="
"
      fi
    done < <(find "$scan_dir" -maxdepth 3 -name ".git" -type d 2>/dev/null)
  done

  echo "$output"
}

# ─── 下週計劃建議：從 reminders + 郵件自動產生 ─────────────────────

suggest_next_plan() {
  local reminder_content="$1"
  local smi_content="$2"
  local output=""

  # 從 reminders 取未完成項目
  if [ -n "$reminder_content" ]; then
    while IFS= read -r line; do
      if [[ "$line" =~ ^.*⏳ ]]; then
        output+="- [ ] ${line#*⏳ } (待辦事項)
"
      fi
    done <<< "$reminder_content"
  fi

  # 從郵件找含明確 action 字眼的主旨
  if [ -n "$smi_content" ]; then
    local action_items
    action_items=$(echo "$smi_content" | perl -lne '
      s/^[●○]\s*(\S+)\s*//;
      s/^\[.*?\]\s*//;
      s/^Re:\s*//i; s/^RE:\s*//; s/^回覆:\s*//;
      # 只匹配有明確行動需求的字眼，避開 Regular 回報
      if (/action\s*item|next\s*step|schedule\s*meeting|due\s*date|deadline|proposal|draft|action required/) {
        print "  - [ ] $_ (郵件)";
      } elsif (/預計.*完成|預定.*release|排程|提案|申請.*帳號/) {
        print "  - [ ] $_ (郵件)";
      }
    ' | head -5 || true)
    if [ -n "$action_items" ]; then
      output+="$action_items
"
    fi
  fi

  [ -z "$output" ] && echo "" && return
  echo "$output"
}

fetch_wiki_log() {
  local log_file="$VAULT/log.md"
  if [ ! -f "$log_file" ]; then
    echo ""
    return
  fi

  local year="${1:-$(date +%Y)}"
  local month="${2:-$(date +%m)}"

  # 從 log.md 擷取本月的 capture entries
  grep "\[$year-$month" "$log_file" 2>/dev/null || true
}

# ─── wiki: 讀取 hot.md ──────────────────────────────────────────────

fetch_wiki_hot() {
  local hot_file="$VAULT/hot.md"
  if [ ! -f "$hot_file" ]; then
    echo ""
    return
  fi

  # 讀取 Current Focus section
  awk '/^## Current Focus/,/^## /' "$hot_file" 2>/dev/null | grep "^- " || true
}

# ─── wiki: 讀取本週會議記錄 ─────────────────────────────────────────

fetch_meeting_notes() {
  local week_start="$1"
  local week_end="$2"
  local meeting_dir="$VAULT/20-工作/24-會議記錄"
  local output=""

  if [ ! -d "$meeting_dir" ]; then
    echo ""
    return
  fi

  # 找所有子目錄中的 md 檔
  find "$meeting_dir" -name "*.md" -maxdepth 3 2>/dev/null | while read -r f; do
    local fname
    fname=$(basename "$f" .md)

    # 檔名含日期判斷是否在本週
    local fdate
    fdate=$(echo "$fname" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
    if [ -n "$fdate" ]; then
      if [[ "$fdate" > "$week_start" ]] || [[ "$fdate" == "$week_start" ]]; then
        if [[ "$fdate" < "$week_end" ]] || [[ "$fdate" == "$week_end" ]]; then
          # 讀取標題
          local title
          title=$(head -1 "$f" | sed 's/^# //' | tr -d '\n')
          echo "- $title ($fdate)"
        fi
      fi
    fi
  done
}

# ─── Apple Calendar: 讀取本週行程 ───────────────────────────────────
# 使用 Swift/EventKit 取代 AppleScript（macOS 26+ AppleScript
# iterate events 會 hang），bundled 在同目錄

_CALENDAR_SCRIPT="$SCRIPT_DIR/calendar-range.swift"

fetch_calendar_events() {
  local start_date="$1"
  local end_date="$2"
  if [ -f "$_CALENDAR_SCRIPT" ]; then
    swift "$_CALENDAR_SCRIPT" "$start_date" "$end_date" 2>/dev/null || echo "__NO_EVENTS__"
  else
    warn "找不到 calendar-range.swift，跳過行事曆讀取"
    echo "__NO_EVENTS__"
  fi
}

# ─── Apple Reminders: 讀取待辦事項 ─────────────────────────────────

fetch_reminders() {
  local list_name="${1:-SMI}"

  osascript 2>/dev/null -e '
  tell application "Reminders"
    set output to ""
    try
      set targetList to list "'"$list_name"'"
      set allItems to every reminder of targetList
      set incompleteCount to 0
      set completeCount to 0

      set incompleteItems to {}
      set completeItems to {}

      repeat with r in allItems
        if completed of r is false then
          set incompleteCount to incompleteCount + 1
          set n to name of r
          set end of incompleteItems to n
        else
          set completeCount to completeCount + 1
          set n to name of r
          set cd to completion date of r
          if cd is missing value then set cd to ""
          set end of completeItems to "  - ✅ " & n
        end if
      end repeat

      if incompleteCount > 0 then
        set output to output & "  **未完成 (" & incompleteCount & ")**" & linefeed
        repeat with itemName in incompleteItems
          set output to output & "  - ⏳ " & itemName & linefeed
        end repeat
        set output to output & linefeed
      end if

      if completeCount > 0 then
        set output to output & "  **已完成 (" & completeCount & ")**" & linefeed
        repeat with itemText in completeItems
          set output to output & itemText & linefeed
        end repeat
        set output to output & linefeed
      end if
    end try

    if output is "" then
      return "__NO_REMINDERS__"
    end if
    return output
  end tell
  ' 2>&1
}

# ─── Obsidian vault: 掃描本週新增/修改筆記 ────────────────────────

fetch_obsidian_notes() {
  local start_date="$1"
  local end_date="$2"
  local vault="$VAULT"

  if [ ! -d "$vault" ]; then
    echo ""
    return
  fi

  # 用 find + 日期比對找出本週修改的 md 檔
  local output=""
  
  # 先列出 log.md 中的 capture 記錄（這是最直接的筆記產出記錄）
  if [ -f "$vault/log.md" ]; then
    local log_entries
    log_entries=$(grep "\[$PERIOD_YEAR" "$vault/log.md" 2>/dev/null | grep -E "CAPTURE|SKILL_CREATE|SKILL_MIGRATE|WEEKLY_REPORT" || true)
    # 按日期範圍過濾，只留本週的
    if [ -n "$log_entries" ]; then
      local filtered=""
      while IFS= read -r entry; do
        local entry_date
        entry_date=$(echo "$entry" | grep -oE '\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]' | tr -d '[]' || true)
        if [ -n "$entry_date" ]; then
          if [[ "$entry_date" > "$start_date" ]] || [[ "$entry_date" == "$start_date" ]]; then
            if [[ "$entry_date" < "$end_date" ]] || [[ "$entry_date" == "$end_date" ]]; then
              filtered+="$entry"$'\n'
            fi
          fi
        fi
      done <<< "$log_entries"
      log_entries="$filtered"
    fi
    if [ -n "$log_entries" ]; then
      output+="  **📋 log.md 記錄**
"
      while IFS= read -r entry; do
        output+="  - ${entry}
"
      done <<< "$log_entries"
      output+="
"
    fi
  fi

  # 找出本週新建的 md 文件（排除 72-週-月回顧 自己）
  local new_notes
  new_notes=$(find "$vault" -name "*.md" -type f 2>/dev/null | grep -v "72-週-月回顧" | while read -r f; do
    local fdate
    fdate=$(stat -f "%SB" -t "%Y-%m-%d" "$f" 2>/dev/null)
    if [ -n "$fdate" ]; then
      if [[ "$fdate" > "$start_date" ]] || [[ "$fdate" == "$start_date" ]]; then
        if [[ "$fdate" < "$end_date" ]] || [[ "$fdate" == "$end_date" ]]; then
          local fname
          fname=$(basename "$f" .md)
          # 跳過 daily note 格式的檔案 (2026-05-21.md)
          if ! echo "$fname" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
            echo "$fname ($fdate)"
          fi
        fi
      fi
    fi
  done | sort -t '(' -k2 || true)

  if [ -n "$new_notes" ]; then
    output+="  **📝 新增/修改筆記**
"
    while IFS= read -r note; do
      [ -z "$note" ] && continue
      output+="  - ${note}
"
    done <<< "$new_notes"
    output+="
"
  fi

  if [ -z "$output" ]; then
    echo ""
    return
  fi

  echo "$output"
}

# ─── 筆記時間軸表格（含 log capture + 新增/修改筆記，附 [[wikilink]]）─

format_notes_timeline() {
  local start_date="$1"
  local end_date="$2"
  local vault="$VAULT"

  if [ ! -d "$vault" ]; then
    echo ""
    return
  fi

  local rows=""

  # 1) log.md 中的 CAPTURE/SKILL/WEEKLY_REPORT 記錄
  if [ -f "$vault/log.md" ]; then
    local log_entries
    log_entries=$(grep "\[$PERIOD_YEAR" "$vault/log.md" 2>/dev/null | grep -E "CAPTURE|SKILL_CREATE|SKILL_MIGRATE|WEEKLY_REPORT" || true)
    # 按日期範圍過濾，只留本週的
    if [ -n "$log_entries" ]; then
      local filtered=""
      while IFS= read -r entry; do
        local entry_date
        entry_date=$(echo "$entry" | grep -oE '\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]' | tr -d '[]' || true)
        if [ -n "$entry_date" ]; then
          if [[ "$entry_date" > "$start_date" ]] || [[ "$entry_date" == "$start_date" ]]; then
            if [[ "$entry_date" < "$end_date" ]] || [[ "$entry_date" == "$end_date" ]]; then
              filtered+="$entry"$'\n'
            fi
          fi
        fi
      done <<< "$log_entries"
      log_entries="$filtered"
    fi
    if [ -n "$log_entries" ]; then
      rows=$(echo "$log_entries" | while IFS= read -r entry; do
        local date type icon content
        # 格式: [2026-05-15] CAPTURE type=synthesis page="path" title="Title"
        date=$(echo "$entry" | grep -oE '\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]' | tr -d '[]' || true)
        date="${date:5:5}"  # 轉為 MM-DD
        [ -z "$date" ] && continue

        if echo "$entry" | grep -q "CAPTURE"; then
          icon="💡"
          local page title
          page=$(echo "$entry" | grep -oE 'page="[^"]*"' | sed 's/page="//;s/"$//' || true)
          title=$(echo "$entry" | grep -oE 'title="[^"]*"' | sed 's/title="//;s/"$//' || true)
          if [ -n "$page" ]; then
            content="Capture: [[${page}|${title}]]"
          elif [ -n "$title" ]; then
            content="Capture: ${title}"
          else
            content="$(echo "$entry" | sed 's/^.*CAPTURE\s*//')"
          fi
        elif echo "$entry" | grep -q "SKILL_CREATE"; then
          icon="🔧"
          content="$(echo "$entry" | sed 's/^.*SKILL_CREATE\s*//')"
        elif echo "$entry" | grep -q "SKILL_MIGRATE"; then
          icon="🔧"
          content="$(echo "$entry" | sed 's/^.*SKILL_MIGRATE\s*//')"
        elif echo "$entry" | grep -q "WEEKLY_REPORT"; then
          icon="📊"
          content="$(echo "$entry" | sed 's/^.*WEEKLY_REPORT\s*//')"
        else
          icon="📝"
          content="$(echo "$entry" | sed 's/^\[[^]]*\]\s*//')"
        fi

        [ -n "$date" ] && [ -n "$content" ] && echo "${date}|${icon}|${content}"
      done)
    fi
  fi

  # 2) 新增/修改筆記
  local new_rows
  new_rows=$(find "$vault" -name "*.md" -type f 2>/dev/null | grep -v "72-週-月回顧" | while read -r f; do
    local fdate
    fdate=$(stat -f "%SB" -t "%Y-%m-%d" "$f" 2>/dev/null)
    if [ -n "$fdate" ]; then
      if [[ "$fdate" > "$start_date" ]] || [[ "$fdate" == "$start_date" ]]; then
        if [[ "$fdate" < "$end_date" ]] || [[ "$fdate" == "$end_date" ]]; then
          local fname
          fname=$(basename "$f" .md)
          # 跳過 daily note 格式的檔案
          if ! echo "$fname" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
            local short_date="${fdate:5:5}"
            echo "${short_date}|📄|[[${fname}]]"
          fi
        fi
      fi
    fi
  done)

  if [ -n "$new_rows" ]; then
    if [ -n "$rows" ]; then
      rows="${rows}"$'\n'"${new_rows}"
    else
      rows="$new_rows"
    fi
  fi

  if [ -z "$rows" ]; then
    echo ""
    return
  fi

  # 排序：依日期排序
  rows=$(echo "$rows" | sort -t'|' -k1)

  local output=""
  output+="| 日期 | 類型 | 內容 |
|------|------|------|
"
  while IFS='|' read -r d icon c; do
    [ -z "$d" ] && continue
    output+="| ${d} | ${icon} | ${c} |
"
  done <<< "$rows"

  echo "$output"
}

# ─── Teams: 透過 personal-assistant 的 teams.sh ──────────────────────

_TEAMS_SCRIPT="$HOME/.config/opencode/skills/personal-assistant/scripts/teams.sh"

fetch_teams() {
  [ ! -f "$_TEAMS_SCRIPT" ] && return

  # 覆蓋時間範圍為 168 小時（7 天 = 一週）
  # teams.sh JSON 輸出到 stdout，log 到 stderr，直接 capture stdout
  TEAMS_MSG_HOURS=168 bash "$_TEAMS_SCRIPT" 2>/dev/null || true
}

format_teams_for_report() {
  local json_file="$1"
  [ -z "$json_file" ] && return
  [ ! -f "$json_file" ] && return

  python3 -c '
import json, sys, re, os
from urllib.parse import quote

def make_chat_link(chat_id):
    if not chat_id:
        return ""
    tid = TENANT_ID
    return "https://teams.microsoft.com/l/chat/0/0?users=27b4efa1-"+quote(chat_id)+"&tenantId="+quote(tid)

def load_tenant_id():
    return "REDACTED"

def preview(text, max_len=80):
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len].rsplit(" ", 1)[0] + "…"

def has_mention(text):
    if not text:
        return False
    return bool(re.search(r"@\w+", text))

def llm_summarize(chat_name, participants, messages):
    """Call 9router LLM to summarize action items and conclusions from messages."""
    if not messages:
        return {"action_items": [], "conclusions": []}
    try:
        import requests as req
        names = " / ".join(p.get("name", "?") for p in participants) if participants else ""
        msgs_text = "\n".join(
            "{}: {}".format(m.get("sender", "?"), m.get("body_preview", ""))
            for m in messages
        )
        prompt = (
            "Chat: {}\n".format(chat_name) +
            ("Participants: {}\n".format(names) if names else "") +
            "Messages:\n" + msgs_text

        )
        resp = req.post(
            "http://127.0.0.1:20128/v1/chat/completions",
            headers={"Authorization": "Bearer REDACTED"},
            json={
                "model": "kr/qwen3-coder-next",
                "messages": [
                    {"role": "system", "content":
                        "You are a technical team assistant. Extract action items (待辦事項) "
                        "and key conclusions (重點結論) from Teams chat messages. "
                        "Action items are tasks needing completion, include owner if mentioned. "
                        "Conclusions are decisions, agreements, or important findings. "
                        "Respond ONLY with valid JSON: "
                        "{\"action_items\": [{\"item\": \"...\", \"owner\": \"...\", \"deadline\": \"...\"}], "
                        "\"conclusions\": [\"...\", \"...\"]}. "
                        "Use Traditional Chinese. Empty arrays if none. "
                        "Keep each item concise (under 100 chars)."
                    },
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 1000,
                "stream": False,
                "temperature": 0.3
            },
            timeout=30
        )
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        # Extract JSON from response (handle markdown code blocks)
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group(0))
            return {
                "action_items": result.get("action_items", []),
                "conclusions": result.get("conclusions", [])
            }
    except Exception:
        pass
    return {"action_items": [], "conclusions": []}

def is_filepath(text):
    if not text:
        return False
    if re.search(r"\\\\", text):
        return True
    if re.search(r"/[^/]+/[^/]+", text):
        return True
    if re.match(r"[A-Za-z]:\\", text):
        return True
    return False

def extract_meeting_urls(body):
    results = []
    if not body:
        return results
    # Zoom
    for m in re.finditer(r"https?://[^\s]*zoom\.(us|com)/[^\s]*j/[^\s]+", body, re.IGNORECASE):
        url = m.group(0).rstrip(".,;!?)>")
        results.append(("Zoom", url))
    # Teams
    for m in re.finditer(r"https?://[^\s]*teams\.microsoft\.com/[^\s]+", body, re.IGNORECASE):
        url = m.group(0).rstrip(".,;!?)>")
        results.append(("Teams", url))
    # Google Meet
    for m in re.finditer(r"https?://[^\s]*meet\.google\.com/[^\s]+", body, re.IGNORECASE):
        url = m.group(0).rstrip(".,;!?)>")
        results.append(("Google Meet", url))
    # Webex
    for m in re.finditer(r"https?://[^\s]*webex\.com/[^\s]+", body, re.IGNORECASE):
        url = m.group(0).rstrip(".,;!?)>")
        results.append(("Webex", url))
    return results

with open(sys.argv[1]) as f:
    data = json.load(f)
if data.get("status") != "ok":
    sys.exit(0)

TENANT_ID = data.get("tenant_id") or load_tenant_id()

chats = data.get("data", {}).get("chats", [])
if not chats:
    sys.exit(0)

# 跨群聊彙總：收集所有待辦事項
for c in chats:
    msg_count = c.get("message_count", 0)
    if msg_count == 0:
        continue
    chat_id = c.get("id", "")
    topic = c.get("topic", "?")
    digest = c.get("digest") or {}
    participants = digest.get("participants", [])
    ts = digest.get("time_span", {})
    first = (ts.get("first", "") or "")[:10]
    last = (ts.get("last", "") or "")[:10]
    chat_link = make_chat_link(chat_id)

    # 收集非系統訊息
    msgs = c.get("messages", [])
    user_msgs = [m for m in msgs
                 if m.get("message_type") != "system"
                 and m.get("body_preview")]
    filtered = []
    for m in user_msgs:
        pv_raw = m.get("body_preview", "")
        if pv_raw and pv_raw != "(無內容)" and pv_raw.strip():
            filtered.append(m)

    if not filtered:
        # 無使用者內容，一行帶過
        link_part = "[📢 {}]({})".format(topic, chat_link) if chat_link else "**{}**".format(topic)
        print("  - {} ({} 則訊息) — 僅系統訊息".format(link_part, msg_count))
        print()
        continue

    # LLM 消化：待辦事項 + 重點結論
    summary = llm_summarize(topic, participants, filtered)
    action_items = summary.get("action_items", [])
    conclusions = summary.get("conclusions", [])

    # 提取連結
    all_links = []
    link_seen = set()
    for m in filtered:
        body = m.get("body_preview", "")
        # 會議網址
        for label, url in extract_meeting_urls(body):
            key = url.lower()
            if key not in link_seen:
                link_seen.add(key)
                all_links.append(("meeting", label, url))
        # 圖片 URL（不在會議內）
        for m2 in re.finditer(r"https?://[^\s<>\"<>]+\.(png|jpg|jpeg|gif|svg|webp)(\?[^\s]*)?", body, re.IGNORECASE):
            url = m2.group(0)
            key = url.lower()
            if key not in link_seen:
                link_seen.add(key)
                fname = url.split("/")[-1].split("?")[0]
                all_links.append(("image", fname, url))
        # 檔案路徑（保留原始文字，不做轉換）
        if is_filepath(body):
            fp_key = body.strip().lower()
            if fp_key not in link_seen:
                link_seen.add(fp_key)
                fname = body.replace("\\", "/").split("/")[-1]
                all_links.append(("file", fname, body.strip()))

    # ── 輸出 ──

    # 聊天名稱（可點選）
    header = topic
    if chat_link:
        header = "[📢 **{}**]({})".format(topic, chat_link)
    else:
        header = "**{}**".format(topic)

    time_info = ""
    if first and last and first != last:
        time_info = "  📅 {} ~ {}".format(first, last)
    print("  {} ({} 則訊息){}".format(header, msg_count, time_info))

    # 參與者
    if participants:
        names = [p["name"] for p in participants]
        # 清理多餘空白
        names = [re.sub(r"\s+", " ", n) for n in names]
        print("  👥 {}".format(" / ".join(names)))

    # 待辦事項（LLM 消化，最多 8 項）
    if action_items:
        print("  📋 **待辦事項:**")
        for ai in action_items[:8]:
            parts = [ai.get("item", "")]
            if ai.get("owner"):
                parts.append("（{}）".format(ai["owner"]))
            if ai.get("deadline"):
                parts.append("[{}]".format(ai["deadline"]))
            print("    - {}".format(" ".join(parts)))

    # 重點結論（LLM 消化，最多 8 項）
    if conclusions:
        print("  🔑 **重點結論:**")
        for c in conclusions[:8]:
            print("    - {}".format(c))

    # 連結區（有才顯示，去重）
    if all_links:
        print("  🔗 **連結:**")
        for link_type, label, url in all_links:
            if link_type == "meeting":
                print("    - 🎥 [{}]({})".format(label, url))
            elif link_type == "image":
                print("    - 🖼️ [{}]({})".format(label, url))
            elif link_type == "file":
                print("    - 📁 `{}` — {}".format(url, label))

    # 聊天記錄（收合）— 用 Obsidian callout 語法
    if filtered:
        print("  > [!summary]- 💬 聊天記錄（{} 則, 點擊展開）".format(len(filtered)))
        for m in filtered:
            pv = preview(m.get("body_preview", ""), 150)
            sender = m.get("sender", "?")
            prefix = "📌" if has_mention(m.get("body_preview", "")) else "  "
            print("  > {} {}: {}".format(prefix, sender, pv))
    print()
' "$json_file" 2>/dev/null || true
}

# ─── 產生週報內容 ────────────────────────────────────────────────────

generate_report() {
  local ref_date="$1"
  local mode="${2:-full}"  # full or template

  calculate_period "$ref_date"

  info "週報日期範圍: $PERIOD_START ($PERIOD_START_DISPLAY) ~ $PERIOD_END ($PERIOD_END_DISPLAY)"

  local wed_mmdd
  wed_mmdd=$(date -j -f "%Y-%m-%d" "$PERIOD_END" "+%m%d")
  local report_file="$WEEKLY_DIR/${PERIOD_YEAR}-週記-${wed_mmdd}.md"

  # ── 收集資料 ──

  local smi_content=""
  local calendar_content=""
  local reminder_content=""
  local notes_content=""
  local log_content=""
  local hot_content=""
  local meeting_content=""
  local topics_content=""
  local git_content=""
  local notes_timeline=""
  local teams_content=""
  local next_plan=""

  if [ "$mode" != "template" ]; then
    # SMI 郵件
    info "掃描 SMI 郵件 ($PERIOD_START ~ $PERIOD_END)…"
    smi_content=$(fetch_smi_emails "$PERIOD_START" "$PERIOD_END") || true
    if [ "$smi_content" = "__NO_SMI_ACCOUNT__" ]; then
      smi_content=""
      warn "找不到 SMI 郵件帳號，跳過郵件掃描"
    elif [ "$smi_content" = "__NO_EMAILS__" ]; then
      smi_content=""
      warn "此期間無相關郵件"
    fi

    # 主題摘要（從郵件標題提取）
    if [ -n "$smi_content" ]; then
      topics_content=$(extract_topics "$smi_content") || true
    fi

    # Apple Calendar
    info "讀取行事曆 ($PERIOD_START ~ $PERIOD_END)…"
    calendar_content=$(fetch_calendar_events "$PERIOD_START" "$PERIOD_END") || true
    if [ "$calendar_content" = "__NO_EVENTS__" ]; then
      calendar_content=""
    fi

    # Apple Reminders
    info "讀取待辦事項…"
    reminder_content=$(fetch_reminders "SMI") || true
    if [ "$reminder_content" = "__NO_REMINDERS__" ]; then
      reminder_content=""
    fi

    # Obsidian 筆記
    info "掃描筆記產出…"
    notes_content=$(fetch_obsidian_notes "$PERIOD_START" "$PERIOD_END") || true

    # 筆記時間軸表格（取代舊的 bullet list）
    notes_timeline=$(format_notes_timeline "$PERIOD_START" "$PERIOD_END") || true

    # wiki log
    log_content=$(fetch_wiki_log "${PERIOD_YEAR}" "${PERIOD_START:5:2}") || true

    # wiki hot (保留作為補充)
    hot_content=$(fetch_wiki_hot) || true

    # 會議記錄
    meeting_content=$(fetch_meeting_notes "$PERIOD_START" "$PERIOD_END") || true

    # git log 開發進度
    info "讀取 git log…"
    git_content=$(fetch_git_log "$PERIOD_START" "$PERIOD_END") || true

    # Teams 討論
    info "讀取 Teams 討論 ($PERIOD_START ~ $PERIOD_END)…"
    local teams_tmp
    teams_tmp=$(mktemp)
    fetch_teams > "$teams_tmp" 2>/dev/null || true
    teams_content=$(format_teams_for_report "$teams_tmp") || true
    rm -f "$teams_tmp"

    # 下週計劃建議
    next_plan=$(suggest_next_plan "$reminder_content" "$smi_content") || true
  fi

  # ── 組裝週報 ──

  local report_content=""
  report_content="---
title: \"${PERIOD_START} ~ ${PERIOD_END}\"
date: $(date +%Y-%m-%d)
type: weekly-report
tags: [weekly-report, work]
status: draft
---

# 📆 週記 — ${PERIOD_START} ~ ${PERIOD_END}

**${PERIOD_START_DISPLAY} → ${PERIOD_END_DISPLAY}**

---

## 📋 一週總覽

"

  # ── 總覽摘要 ──
  local email_count=0
  if [ -n "$smi_content" ]; then
    email_count=$(echo "$smi_content" | grep -c "^[●○]" || echo 0)
  fi
  local meeting_count=0
  if [ -n "$meeting_content" ]; then
    meeting_count=$(echo "$meeting_content" | grep -c "^\-" || echo 0)
  fi
  local note_count=0
  if [ -n "$notes_timeline" ]; then
    note_count=$(echo "$notes_timeline" | grep -c "^|" || true)
    # 減去 header row
    note_count=$((note_count - 1))
    [ "$note_count" -lt 0 ] && note_count=0
  fi
  local git_count=0
  if [ -n "$git_content" ]; then
    git_count=$(echo "$git_content" | grep -c "^  - " || echo 0)
  fi
  local teams_count=0
  if [ -n "$teams_content" ]; then
    teams_count=$(echo "$teams_content" | grep -c "^\*\*.*\*\* (" || echo 0)
  fi

  report_content+="| 類別 | 數量 |
|------|------|
| 📧 郵件討論串 | ${email_count} |
| 💬 Teams 聊天 | ${teams_count} |
| 📅 會議/行程 | ${meeting_count} |
| 📝 筆記產出 | ${note_count} |
| 💻 Git commits | ${git_count} |

"

  # ── 出勤 ──
  local start_display
  start_display=$(date -j -f "%Y-%m-%d" "$PERIOD_START" "+%m/%d(%a)")
  local end_display
  end_display=$(date -j -f "%Y-%m-%d" "$PERIOD_END" "+%m/%d(%a)")
  report_content+="**出勤：** ${start_display} ~ ${end_display}
"

  # ── 🎯 本週重點摘要（自動從郵件標題提取）──
  if [ -n "$topics_content" ]; then
    report_content+="
**🏷️ 本週焦點：** ${topics_content}
"
  fi

  # ── 📧 郵件摘要 ──
  report_content+="
## 📧 郵件摘要

"
  if [ -n "$smi_content" ]; then
    # 使用 per-group 格式：各分組自帶可折疊 callout
    local per_group
    per_group=$(group_smi_emails_per_group "$smi_content")
    if [ -n "$per_group" ]; then
      # 確認有「你發出的郵件」以外的內容才加參與標題
      if echo "$per_group" | grep -q "\[!summary\]"; then
        report_content+="${per_group}
"
      else
        report_content+="${per_group}
"
      fi
    fi
  else
    report_content+="_（本週無相關郵件）_
"
  fi

  # ── 📅 行程與會議 ──
  report_content+="
## 📅 行程與會議

"
  if [ -n "$calendar_content" ]; then
    report_content+="${calendar_content}
"
  fi
  if [ -n "$meeting_content" ]; then
    report_content+="### 📄 會議記錄
"
    while IFS= read -r line; do
      report_content+="${line}
"
    done <<< "$meeting_content"
    report_content+="
"
  fi
  if [ -z "$calendar_content" ] && [ -z "$meeting_content" ]; then
    report_content+="_（本週無行程記錄）_
"
  fi

  # ── ✅ 待辦事項 ──
  report_content+="
## ✅ 待辦事項

"
  if [ -n "$reminder_content" ]; then
    report_content+="${reminder_content}
"
  else
    report_content+="_（Apple Reminders 無資料）_
"
  fi

  # ── 📝 筆記與產出 ──
  report_content+="
## 📝 筆記與產出

"
  if [ -n "$notes_timeline" ]; then
    report_content+="${notes_timeline}
"
  else
    report_content+="_（本週無筆記記錄）_
"
  fi

  # ── 💻 開發進度（git log）──
  report_content+="
## 💻 開發進度

"
  if [ -n "$git_content" ]; then
    report_content+="${git_content}
"
  elif [ -n "$hot_content" ]; then
    # 降級到 hot.md
    while IFS= read -r line; do
      report_content+="- ${line}
"
    done <<< "$hot_content"
    report_content+="
"
  else
    report_content+="_（本週無開發記錄）_
"
  fi

  # ── 💬 Teams 討論 ──
  report_content+="
## 💬 Teams 討論

"
  if [ -n "$teams_content" ]; then
    report_content+="${teams_content}
"
  else
    report_content+="_（本週無 Teams 記錄）_
"
  fi

  # ── 📋 下週計劃 ──
  report_content+="
## 📋 下週計劃

"
  if [ -n "$next_plan" ]; then
    report_content+="${next_plan}
"
  fi
  # 保留手動填寫空間
  report_content+="- [ ] （手動填寫）
- [ ] （手動填寫）

---

*🛠️ 由 weekly-report skill 自動產生 • $(date '+%Y-%m-%d %H:%M')*
"

  # ── 寫入檔案 ──

  if [ -f "$report_file" ]; then
    warn "週報已存在: $report_file"
    echo "  使用 fill 模式更新，或手動編輯"
    echo "$report_file"
    return
  fi

  echo "$report_content" > "$report_file"
  ok "週報已寫入: $report_file"
}

# ─── fill: 補充已存在週報 ────────────────────────────────────────────

fill_report() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    die "檔案不存在: $filepath"
  fi

  info "補充週報: $filepath"

  # 從檔名猜測日期：{year}-週記-{MMDD}.md → 用 MMDD 推算週三
  local fname
  fname=$(basename "$filepath")
  local year
  year=$(echo "$fname" | grep -oE '^[0-9]{4}' || date +%Y)
  local mmdd
  mmdd=$(echo "$fname" | grep -oE '[0-9]{4}' | tail -1 || date +%m%d)

  local guess_date="${year}-${mmdd:0:2}-${mmdd:2:2}"
  if ! date -j -f "%Y-%m-%d" "$guess_date" "+%s" >/dev/null 2>&1; then
    guess_date=$(date +%Y-%m-%d)
  fi

  calculate_period "$guess_date"
  info "偵測週範圍: $PERIOD_START ~ $PERIOD_END"

  # 掃描郵件
  local smi_content
  info "掃描 SMI 郵件 ($PERIOD_START ~ $PERIOD_END)…"
  smi_content=$(fetch_smi_emails "$PERIOD_START" "$PERIOD_END") || true
  if [ -n "$smi_content" ] && [ "$smi_content" != "__NO_EMAILS__" ] && [ "$smi_content" != "__NO_SMI_ACCOUNT__" ]; then
    echo "" >> "$filepath"
    echo "### 郵件參與（自動補充）" >> "$filepath"
    echo "" >> "$filepath"
    echo "$smi_content" >> "$filepath"
    ok "已補充郵件資料"
  else
    warn "無新郵件資料可補充"
  fi

  # Teams 討論
  info "讀取 Teams 討論 ($PERIOD_START ~ $PERIOD_END)…"
  local teams_tmp teams_content
  teams_tmp=$(mktemp)
  fetch_teams > "$teams_tmp" 2>/dev/null || true
  teams_content=$(format_teams_for_report "$teams_tmp") || true
  rm -f "$teams_tmp"
  if [ -n "$teams_content" ]; then
    echo "" >> "$filepath"
    echo "### 💬 Teams 討論（自動補充）" >> "$filepath"
    echo "" >> "$filepath"
    echo "$teams_content" >> "$filepath"
    ok "已補充 Teams 討論"
  else
    warn "無 Teams 資料可補充"
  fi

  # 更新狀態
  sed -i '' 's/status: draft/status: completed/' "$filepath" 2>/dev/null || true
  ok "週報狀態標記為 completed"
}

# ─── usage ────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
 用法: bash <script_dir>/generate-weekly-report.sh <command> [args]

日期週期: 自動計算上週四 ~ 本週三

指令:
  new [date]                 建立新週報（預設今天，可指定日期）
  fill <file_path>           補充已存在的週報
  template [date]            僅產生空白模板

範例:
  bash generate-weekly-report.sh new
  bash generate-weekly-report.sh new 2026-05-01
  bash generate-weekly-report.sh fill "/path/to/週記.md"
  bash generate-weekly-report.sh template 2026-05-20
EOF
  exit 0
}

# ─── main ─────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift 2>/dev/null || true

# 確保目錄存在
mkdir -p "$WEEKLY_DIR"

case "$CMD" in
  new)
    REF_DATE="${1:-$(date +%Y-%m-%d)}"
    generate_report "$REF_DATE" "full"
    ;;
  fill)
    [ $# -eq 0 ] && die "請指定週報檔案路徑"
    fill_report "$1"
    ;;
  template)
    REF_DATE="${1:-$(date +%Y-%m-%d)}"
    generate_report "$REF_DATE" "template"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    die "未知指令: $CMD。使用 $0 help 查看說明"
    ;;
esac
