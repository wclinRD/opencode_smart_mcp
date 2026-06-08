#!/bin/bash
# Personal Assistant - Microsoft Teams Chat Summary
# 透過 Microsoft Graph API 讀取 Teams 聊天訊息並輸出統一 JSON
# 使用 Obsidian obsidian-ms-outlook plugin 的既有認證
#
# 輸出：統一 JSON 格式 (CON-4)
#
# 依賴：
#   - Obsidian plugin: obsidian-ms-outlook（提供 OAuth tokens）
#   - 網路連線（Graph API）
#   - Python 3（urllib 內建，不需額外套件）

set -e
set -o pipefail

# Source 共用函式庫
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="teams"
LAYER=3  # 批次 3（系統整合層）

# 從 profile 讀取 teams 設定，export 給 Python 環境變數
export TEAMS_MSG_HOURS="${TEAMS_MSG_HOURS:-$(read_profile "teams_msg_hours")}"
export TEAMS_MAX_CHATS="${TEAMS_MAX_CHATS:-$(read_profile "teams_max_chats")}"
export TEAMS_MAX_MSG_PER_CHAT="${TEAMS_MAX_MSG_PER_CHAT:-$(read_profile "teams_max_msg_per_chat")}"
export TEAMS_MAX_WORKERS="${TEAMS_MAX_WORKERS:-$(read_profile "teams_max_workers")}"
export TEAMS_OBSIDIAN_TOKEN_PATH="${TEAMS_OBSIDIAN_TOKEN_PATH:-$(read_profile "teams_obsidian_token_path")}"

log_info "$SOURCE_NAME" "開始收集 Teams 討論..."

python3 << 'PYTHON_EOF'
import json, sys, os, datetime, time, re
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser

# ============================================================================
# 設定
# ============================================================================

# Token 檔案路徑（優先順序）
# 1. 獨立認證（teams-setup.sh 產生的）
# 2. Obsidian plugin（可透過環境變數覆寫路徑）
PERSONAL_TOKEN_DIR = os.path.expanduser("~/.config/personal-assistant")
PERSONAL_TOKEN_PATH = os.path.join(PERSONAL_TOKEN_DIR, "teams-tokens.json")

# Obsidian token 路徑：可透過環境變數 TEAMS_OBSIDIAN_TOKEN_PATH 覆寫
# 預設自動偵測常用位置
OBSIDIAN_TOKEN_PATH = os.environ.get(
    "TEAMS_OBSIDIAN_TOKEN_PATH",
    ""
)

if not OBSIDIAN_TOKEN_PATH:
    for _p in [
        os.path.expanduser(
            "~/Library/Application Support/Obsidian/.obsidian/plugins/"
            "obsidian-ms-outlook/data.json"
        ),
        os.path.expanduser(
            "~/Library/CloudStorage/CloudMounter-pCloud/"
            "AppData/Obsidian/.obsidian/plugins/obsidian-ms-outlook/data.json"
        ),
    ]:
        if os.path.isfile(_p):
            OBSIDIAN_TOKEN_PATH = _p
            break

# 訊息時間範圍（小時），可從環境變數覆寫
MSG_HOURS = int(os.environ.get("TEAMS_MSG_HOURS", "24"))

# 每聊天室最多訊息
MAX_MSG_PER_CHAT = int(os.environ.get("TEAMS_MAX_MSG_PER_CHAT", "20"))

# 最多聊天室
MAX_CHATS = int(os.environ.get("TEAMS_MAX_CHATS", "10"))

# 平行處理的執行緒數
MAX_WORKERS = int(os.environ.get("TEAMS_MAX_WORKERS", "5"))

# Graph API base
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# HTTP header 常數
_USER_AGENT = "PersonalAssistant-Teams/1.0"
_HEADER_JSON = {"Content-Type": "application/json"}
_HEADER_FORM = {"Content-Type": "application/x-www-form-urlencoded"}


# ============================================================================
# 工具函式
# ============================================================================

def log_msg(msg):
    """寫入 stderr（不干擾 stdout JSON）"""
    ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    print(f"[{ts}] [INFO] [teams.py] {msg}", file=sys.stderr)


class _HTMLStripper(HTMLParser):
    """輕量 HTML 標籤移除"""
    def __init__(self):
        super().__init__()
        self._text_parts = []
    def handle_data(self, data):
        self._text_parts.append(data)
    def get_text(self):
        return ''.join(self._text_parts)


def strip_html(html_content):
    """移除 HTML 標籤，回傳純文字"""
    if not html_content:
        return ""
    stripper = _HTMLStripper()
    try:
        stripper.feed(html_content)
        text = stripper.get_text()
    except Exception:
        # fallback: regex
        text = re.sub(r'<[^>]+>', '', html_content)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def http_request(url, method="GET", headers=None, data=None, timeout=15):
    """HTTP request 封裝，回傳 (status, body_json, error)"""
    if headers is None:
        headers = {}
    # 預設 User-Agent
    headers.setdefault("User-Agent", _USER_AGENT)
    try:
        if data is not None:
            if isinstance(data, dict):
                data = urlencode(data).encode("utf-8")
            req = Request(url, data=data, headers=headers, method=method)
        else:
            req = Request(url, headers=headers, method=method)

        with urlopen(req, timeout=timeout) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
            return status, json.loads(body), None
    except HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
            error_msg = err_body.get("error", {}).get("message", str(e))
        except Exception:
            error_msg = str(e)
        return e.code, None, error_msg
    except URLError as e:
        return 0, None, f"網路錯誤: {e.reason}"
    except Exception as e:
        return 0, None, str(e)


def utc_now_iso():
    """回傳 UTC ISO 8601 時間字串（timezone-aware）"""
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def is_token_expired(tokens):
    """檢查 token 是否已過期（預留 5 分鐘緩衝）"""
    now_ms = int(time.time() * 1000)
    expiry = tokens.get("expiry", 0)
    return expiry <= now_ms + 300000


# ============================================================================
# Token 管理
# ============================================================================

def read_tokens():
    """從檔案讀取 OAuth tokens，優先獨立認證，次之 Obsidian plugin
    回傳 (tokens, source_name, error)
    """
    sources = []

    # 來源 1: 獨立認證（teams-setup.sh 產生的）
    if os.path.isfile(PERSONAL_TOKEN_PATH):
        try:
            with open(PERSONAL_TOKEN_PATH, "r") as f:
                tokens = json.load(f)
            if tokens.get("client_id") and tokens.get("refresh_token"):
                log_msg(f"從獨立認證讀取 tokens（帳號: {tokens.get('account', '?')}）")
                sources.append(("personal", tokens))
        except Exception as e:
            log_msg(f"讀取獨立 token 失敗: {e}")

    # 來源 2: Obsidian plugin（路徑有值才嘗試）
    if OBSIDIAN_TOKEN_PATH and os.path.isfile(OBSIDIAN_TOKEN_PATH):
        try:
            with open(OBSIDIAN_TOKEN_PATH, "r") as f:
                data = json.load(f)
            tokens = {
                "client_id": data.get("clientId", ""),
                "tenant_id": data.get("tenantId", ""),
                "access_token": data.get("accessToken", ""),
                "refresh_token": data.get("refreshToken", ""),
                "expiry": data.get("expiry", 0),
                "account": data.get("account", ""),
            }
            if tokens["client_id"] and tokens["refresh_token"]:
                log_msg(f"從 Obsidian plugin 讀取 tokens（帳號: {tokens['account']}）")
                sources.append(("obsidian-plugin", tokens))
        except Exception as e:
            log_msg(f"讀取 Obsidian token 失敗: {e}")

    if not sources:
        return None, None, "找不到 tokens。請執行設定:\n  bash teams-setup.sh\n\n或者在 Obsidian 中完成 ms-outlook 登入後再試。"

    return sources[0][1], sources[0][0], None


def save_personal_tokens(tokens):
    """將 tokens 儲存到 personal-assistant 設定目錄（獨立認證格式）"""
    try:
        os.makedirs(PERSONAL_TOKEN_DIR, exist_ok=True)
        save_data = {k: tokens.get(k) for k in [
            "client_id", "tenant_id", "access_token", "refresh_token",
            "expiry", "account"
        ]}
        # 避免無意義寫入：檢查內容是否相同
        if os.path.isfile(PERSONAL_TOKEN_PATH):
            try:
                with open(PERSONAL_TOKEN_PATH, "r") as f:
                    existing = json.load(f)
                # 只比較 refresh_token 和 access_token
                if (existing.get("access_token") == save_data.get("access_token")
                        and existing.get("refresh_token") == save_data.get("refresh_token")):
                    log_msg("tokens 無變更，跳過寫入")
                    return
            except Exception:
                pass
        with open(PERSONAL_TOKEN_PATH, "w") as f:
            json.dump(save_data, f, indent=2)
        os.chmod(PERSONAL_TOKEN_PATH, 0o600)
        log_msg("tokens 已儲存至獨立認證檔案")
    except Exception as e:
        log_msg(f"寫入 token 檔案失敗（非致命）: {e}")


def refresh_access_token(tokens):
    """使用 refresh_token 換取新 access_token"""
    token_url = f"https://login.microsoftonline.com/{tokens['tenant_id']}/oauth2/v2.0/token"

    payload = {
        "grant_type": "refresh_token",
        "client_id": tokens["client_id"],
        "refresh_token": tokens["refresh_token"],
        "scope": "https://graph.microsoft.com/.default offline_access",
    }

    log_msg("重新整理 access token...")
    status, data, error = http_request(
        token_url,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=payload,
    )

    if error:
        log_msg(f"refresh token 失敗: {error}")
        return None, f"重新整理 token 失敗: {error}"

    if status == 200 and data.get("access_token"):
        new_tokens = dict(tokens)
        new_tokens["access_token"] = data["access_token"]
        new_tokens["expiry"] = int(time.time() * 1000) + (data.get("expires_in", 3600) * 1000)
        if data.get("refresh_token"):
            new_tokens["refresh_token"] = data["refresh_token"]
        log_msg("access token 已重新整理")
        return new_tokens, None
    else:
        error_desc = data.get("error_description", "未知錯誤") if data else "無回應"
        log_msg(f"refresh token 失敗: {error_desc}")
        return None, f"重新整理 token 失敗: {error_desc}"


def get_valid_token(tokens, source_name="personal"):
    """取得有效 access token，過期則自動 refresh
    source_name: "personal" 或 "obsidian-plugin"
    """
    if not is_token_expired(tokens):
        return tokens, None

    log_msg("token 已過期，重新整理...")
    new_tokens, error = refresh_access_token(tokens)
    if error:
        return None, error

    # 只有獨立認證來源才儲存到 personal token 檔案
    # （Obsidian plugin 來源不應 overwrite 個人 token）
    if source_name == "personal":
        save_personal_tokens(new_tokens)

    return new_tokens, None


# ============================================================================
# Graph API 呼叫
# ============================================================================

def list_chats(access_token):
    """列出使用者參與的聊天"""
    url = (f"{GRAPH_BASE}/me/chats?"
           f"$top={MAX_CHATS}"
           f"&$expand=lastMessagePreview")
    headers = {"Authorization": f"Bearer {access_token}"}

    status, data, error = http_request(url, headers=headers)
    if error:
        return None, error

    chats = data.get("value", [])
    chats.sort(key=lambda c: c.get("lastUpdatedDateTime", ""), reverse=True)
    log_msg(f"取得 {len(chats)} 個聊天室")
    return chats, None


def get_chat_messages(access_token, chat_id, hours=24, top=20):
    """取得聊天室近期訊息"""
    since = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(hours=hours)).isoformat()
    url = (
        f"{GRAPH_BASE}/me/chats/{chat_id}/messages"
        f"?$top={top}"
        f"&$orderBy=createdDateTime+desc"
    )
    headers = {"Authorization": f"Bearer {access_token}"}

    status, data, error = http_request(url, headers=headers)
    if error:
        return [], error

    messages = data.get("value", [])
    filtered = [m for m in messages
                if m.get("createdDateTime", "") and m["createdDateTime"] >= since]
    return filtered, None


def get_chat_members(access_token, chat_id):
    """取得聊天室成員（僅取名稱）"""
    url = f"{GRAPH_BASE}/me/chats/{chat_id}/members"
    headers = {"Authorization": f"Bearer {access_token}"}

    status, data, error = http_request(url, headers=headers)
    if error:
        log_msg(f"  取得成員失敗（非致命）: {error}")
        return []

    seen = set()
    members = []
    for m in data.get("value", []):
        name = (m.get("displayName") or m.get("email") or "Unknown")
        if name not in seen:
            seen.add(name)
            members.append(name)
    return members


def process_one_chat(access_token, chat):
    """處理單一聊天室（供 threading 使用）"""
    chat_info = extract_chat_info(chat)
    chat_id = chat_info["id"]

    log_msg(f"處理聊天室: {chat_info['topic']} ({chat_info['chat_type']})")

    # 成員
    members = get_chat_members(access_token, chat_id)
    chat_info["members"] = members[:10]

    # 訊息
    messages, msg_error = get_chat_messages(
        access_token, chat_id,
        hours=MSG_HOURS, top=MAX_MSG_PER_CHAT
    )

    if msg_error:
        log_msg(f"  取得訊息失敗: {msg_error}")
        chat_info["messages"] = []
        chat_info["message_error"] = msg_error
        chat_info["message_count"] = 0
        chat_info["digest"] = None
    else:
        formatted = [format_message(m) for m in messages]
        chat_info["messages"] = formatted
        chat_info["message_count"] = len(formatted)
        chat_info["message_error"] = None
        chat_info["digest"] = build_chat_digest(formatted, chat_info)
        pc = chat_info["digest"]["participant_count"] if chat_info["digest"] else 0
        log_msg(f"  取得 {len(formatted)} 則訊息, {pc} 人參與")

    return chat_info


# ============================================================================
# 訊息處理
# ============================================================================

def format_message(msg):
    """將 Graph API message 轉為簡潔格式"""
    body_content = msg.get("body", {}).get("content", "")
    content_type = msg.get("body", {}).get("contentType", "text")

    if content_type == "html":
        body_content = strip_html(body_content)

    preview = body_content[:200] if body_content else "(無內容)"

    msg_type = msg.get("messageType", "message")
    if msg_type in ("unknownFutureValue", "systemEventMessage"):
        event_detail = msg.get("eventDetail", {})
        if event_detail and isinstance(event_detail, dict):
            event_type = event_detail.get("@odata.type", "system")
            event_label = event_type.split(".")[-1] if "." in event_type else "system"
            sender = f"(系統: {event_label})"
        else:
            sender = "(系統通知)"
    else:
        sender = _extract_sender(msg.get("from"))

    return {
        "id": msg.get("id", ""),
        "sender": sender,
        "timestamp": msg.get("createdDateTime", ""),
        "body_preview": preview,
        "body_length": len(body_content),
        "message_type": "system" if msg_type in ("unknownFutureValue", "systemEventMessage") else msg_type,
        "is_reply": msg.get("replyToId") is not None,
    }


def _extract_sender(from_user):
    """從 from 欄位提取寄件者名稱"""
    if not from_user or not isinstance(from_user, dict):
        return "Unknown"
    for key in ("user", "application", "device"):
        identity = from_user.get(key)
        if identity and isinstance(identity, dict):
            dn = identity.get("displayName")
            if dn:
                return dn
    return from_user.get("displayName", "Unknown")


def extract_chat_info(chat):
    """從 chat object 提取摘要資訊"""
    chat_type = chat.get("chatType", "unknown")
    topic = chat.get("topic", "")

    try:
        if chat_type == "oneOnOne":
            preview = chat.get("lastMessagePreview")
            if preview and isinstance(preview, dict):
                from_user = preview.get("from")
                if from_user and isinstance(from_user, dict):
                    identity = from_user.get("user") or {}
                    if isinstance(identity, dict):
                        topic = identity.get("displayName", topic)
        elif chat_type == "meeting":
            meeting = chat.get("meeting")
            if meeting and isinstance(meeting, dict):
                topic = topic or meeting.get("subject", "會議聊天")
    except Exception:
        pass

    if not topic:
        chat_id = chat.get("id", "")
        topic = f"Chat-{chat_id[-8:]}" if len(chat_id) > 8 else chat_id

    return {
        "id": chat.get("id", ""),
        "topic": topic,
        "chat_type": chat_type,
        "created_at": chat.get("createdDateTime", ""),
        "last_updated": chat.get("lastUpdatedDateTime", ""),
    }


# ============================================================================
# 對話摘要分析（輔助 metadata，真正的語意摘要交給 LLM）
# ============================================================================

def _calc_time_span(messages):
    """計算訊息時間範圍"""
    timestamps = [m["timestamp"] for m in messages if m.get("timestamp")]
    if len(timestamps) < 2:
        return {"first": timestamps[0] if timestamps else None, "last": None, "duration_minutes": 0}

    first, last = min(timestamps), max(timestamps)
    try:
        from datetime import datetime
        fmt = "%Y-%m-%dT%H:%M:%S"
        t1 = datetime.strptime(first[:19], fmt)
        t2 = datetime.strptime(last[:19], fmt)
        duration = int((t2 - t1).total_seconds() / 60)
    except Exception:
        duration = 0
    return {"first": first, "last": last, "duration_minutes": duration}


def build_chat_digest(messages, chat_info):
    """從訊息建立輔助摘要（metadata only，語意摘要由 LLM 負責）

    回傳 digest 包含：
      - participants: 誰發言、各幾則
      - time_span: 時間範圍
      - system_event_count: 系統事件數量
      - has_content: 是否有人類討論（非純系統事件）
    """
    if not messages:
        return None

    # 訊息類型
    system_count = sum(1 for m in messages if m.get("message_type") == "system")
    user_count = len(messages) - system_count

    # 發言統計
    participant_msgs = {}
    for m in messages:
        if m["message_type"] != "system":
            s = m["sender"]
            participant_msgs[s] = participant_msgs.get(s, 0) + 1
    active_sorted = sorted(participant_msgs.items(), key=lambda x: -x[1])
    active_participants = [{"name": n, "msg_count": c} for n, c in active_sorted]

    has_content = len(active_participants) > 0
    time_span = _calc_time_span(messages)

    return {
        "participant_count": len(active_participants),
        "participants": active_participants,
        "time_span": time_span,
        "system_event_count": system_count,
        "has_content": has_content,
    }


# ============================================================================
# 主程式
# ============================================================================

def main():
    log_msg(f"Teams 聊天摘要開始 (時間範圍: {MSG_HOURS}小時, 最多 {MAX_CHATS} 聊天室)")

    # Step 1: 讀取 tokens
    tokens, source_name, error = read_tokens()
    if error:
        return {
            "source": "teams",
            "status": "error",
            "layer": 3,
            "data": None,
            "error": {"code": "E-AUTH", "message": error}
        }

    # Step 2: 取得有效 token
    tokens, error = get_valid_token(tokens, source_name)
    if error:
        return {
            "source": "teams",
            "status": "error",
            "layer": 3,
            "data": None,
            "error": {
                "code": "E-AUTH",
                "message": (f"{error}\n\n請在 Obsidian 中重新登入 obsidian-ms-outlook:\n"
                            "1. 打開 Obsidian\n"
                            "2. 設定 → obsidian-ms-outlook\n"
                            "3. 重新登入 Microsoft 帳號")
            }
        }

    access_token = tokens["access_token"]

    # Step 3: 列出聊天室
    chats, error = list_chats(access_token)
    if error:
        return {
            "source": "teams",
            "status": "error",
            "layer": 3,
            "data": None,
            "error": {"code": "E-NETWORK", "message": f"列出聊天室失敗: {error}"}
        }

    if not chats:
        return {
            "source": "teams",
            "status": "ok",
            "layer": 3,
            "timestamp": utc_now_iso(),
            "data": {
                "chats": [],
                "summary": {"total_chats": 0, "total_messages": 0}
            },
            "error": None
        }

    # Step 4: 平行處理每個聊天室
    chat_results = {}
    total_messages = 0
    max_workers = min(MAX_WORKERS, len(chats))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(process_one_chat, access_token, chat): chat
            for chat in chats
        }
        for future in as_completed(future_map):
            chat = future_map[future]
            chat_id = chat.get("id", "")
            try:
                chat_info = future.result()
                chat_results[chat_id] = chat_info
                total_messages += chat_info.get("message_count", 0)
            except Exception as e:
                log_msg(f"  聊天室處理異常: {e}")
                chat_results[chat_id] = {
                    "id": chat_id,
                    "topic": chat.get("topic", "?") or "處理失敗",
                    "chat_type": chat.get("chatType", "unknown"),
                    "members": [],
                    "messages": [],
                    "message_count": 0,
                    "message_error": str(e),
                }

    # 重新依 lastUpdatedDateTime 排序（保持輸出穩定）
    chat_results_list = []
    for chat in chats:
        cid = chat.get("id", "")
        if cid in chat_results:
            chat_results_list.append(chat_results[cid])

    # Step 5: 計算總體摘要
    ts = utc_now_iso()
    all_active = set()
    chats_with_content = 0
    for c in chat_results_list:
        if c.get("digest"):
            if c["digest"]["has_content"]:
                chats_with_content += 1
            for p in c["digest"]["participants"]:
                all_active.add(p["name"])

    data = {
        "chats": chat_results_list,
        "summary": {
            "total_chats": len(chats),
            "total_with_messages": sum(1 for c in chat_results_list if c["message_count"] > 0),
            "total_messages": total_messages,
            "chats_with_discussion": chats_with_content,
            "total_participants": len(all_active),
            "time_range_hours": MSG_HOURS,
        }
    }

    result = {
        "source": "teams",
        "status": "ok",
        "layer": 3,
        "timestamp": ts,
        "tenant_id": tokens.get("tenant_id", ""),
        "data": data,
        "error": None
    }

    log_msg(f"完成: {len(chats)} 聊天室, {total_messages} 則訊息")
    return result


# ============================================================================
# 執行
# ============================================================================

if __name__ == "__main__":
    result = main()
    print(json.dumps(result, indent=2, ensure_ascii=False))
PYTHON_EOF

# 記錄完成狀態
if [ $? -eq 0 ]; then
    log_info "$SOURCE_NAME" "Teams 討論收集完成"
else
    log_error "$SOURCE_NAME" "Teams 討論收集失敗"
fi
