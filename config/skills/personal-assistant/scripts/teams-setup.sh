#!/bin/bash
# Personal Assistant - Teams OAuth 設定工具
# 第一次使用時執行，建立獨立的 Microsoft 認證
#
# 流程：
#   1. 產生 PKCE code_verifier + code_challenge
#   2. 打開瀏覽器讓使用者登入 Microsoft
#   3. 使用者貼回 redirect URL
#   4. 交換 code 為 access_token + refresh_token
#   5. 儲存到 ~/.config/personal-assistant/teams-tokens.json
#
# 使用：bash teams-setup.sh

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/profile.sh"

SOURCE_NAME="teams-setup"
TOKEN_DIR="$HOME/.config/personal-assistant"
TOKEN_FILE="$TOKEN_DIR/teams-tokens.json"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   Microsoft Teams OAuth 設定                 ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# 先檢查是否已有 tokens
if [[ -f "$TOKEN_FILE" ]]; then
    echo "✅ 已有 tokens：$TOKEN_FILE"
    echo "   如果要重新設定，請先刪除該檔案"
    echo ""
    read -p "按 Enter 重新設定，或 Ctrl+C 取消..."
fi

echo "步驟 1/3：準備 PKCE 認證..."
echo ""

# 產生 PKCE code 與 auth URL（一次完成，避免重複）
AUTH_DATA=$(python3 << 'PYTHON_EOF'
import secrets, hashlib, base64, json, os, sys, urllib.parse

# 設定（單一定義點）
CLIENT_ID = "REDACTED"
TENANT_ID = "REDACTED"
REDIRECT_URI = "http://localhost/oauth-callback"

# PKCE
cv = base64.urlsafe_b64encode(secrets.token_bytes(96)).rstrip(b'=').decode('ascii')
sha = hashlib.sha256(cv.encode('ascii')).digest()
cc = base64.urlsafe_b64encode(sha).rstrip(b'=').decode('ascii')

# 儲存 verifier
verifier_path = os.path.expanduser("~/.config/personal-assistant/teams-code-verifier.json")
os.makedirs(os.path.dirname(verifier_path), exist_ok=True)
with open(verifier_path, "w") as f:
    json.dump({"code_verifier": cv}, f)
os.chmod(verifier_path, 0o600)

# Auth URL
scope = "https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/User.Read https://graph.microsoft.com/User.ReadBasic.All offline_access"
params = {
    "client_id": CLIENT_ID,
    "response_type": "code",
    "redirect_uri": REDIRECT_URI,
    "scope": scope,
    "code_challenge": cc,
    "code_challenge_method": "S256",
    "response_mode": "query",
}
auth_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"

print(json.dumps({
    "auth_url": auth_url,
    "client_id": CLIENT_ID,
    "tenant_id": TENANT_ID,
    "redirect_uri": REDIRECT_URI,
}))
PYTHON_EOF
)

AUTH_URL=$(echo "$AUTH_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth_url'])")

echo "步驟 2/3：開啟瀏覽器進行 Microsoft 登入..."
echo ""
echo "   瀏覽器已自動開啟，請："
echo "   1. 用您的公司 Email（如 user@company.com）登入"
echo "   2. 同意權限要求（Chat.ReadWrite 等）"
echo "   3. 登入後瀏覽器會導向一個空白頁面"
echo "   4. 複製該頁面的完整網址（URL）"
echo ""

# 自動開啟瀏覽器
if command -v open &>/dev/null; then
    open "$AUTH_URL"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$AUTH_URL"
elif command -v python3 &>/dev/null; then
    python3 -c "import webbrowser; webbrowser.open('$AUTH_URL')"
fi

echo "   如果瀏覽器沒有自動開啟，請手動複製以下網址："
echo "   $AUTH_URL"
echo ""

# 讀取使用者貼回的 URL
echo "步驟 3/3：貼上登入後的完整 URL"
echo ""
read -p "   請貼上完整的 redirect URL（包含 ?code=...）：" REDIRECT_URL

if [[ -z "$REDIRECT_URL" ]]; then
    echo "❌ 未輸入 URL"
    exit 1
fi

echo ""
echo "正在交換 token..."

# 從 AUTH_DATA 讀取設定參數
CLIENT_ID_VAL=$(echo "$AUTH_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")
TENANT_ID_VAL=$(echo "$AUTH_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['tenant_id'])")
REDIRECT_URI_VAL=$(echo "$AUTH_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['redirect_uri'])")

python3 << PYTHON_EOF
import json, os, sys, urllib.request, urllib.parse
from urllib.parse import urlparse, parse_qs

CLIENT_ID = """$CLIENT_ID_VAL"""
TENANT_ID = """$TENANT_ID_VAL"""
REDIRECT_URI = """$REDIRECT_URI_VAL"""
REDIRECT_URL = """$REDIRECT_URL"""
TOKEN_DIR = os.path.expanduser("$TOKEN_DIR")
VERIFIER_PATH = os.path.join(TOKEN_DIR, "teams-code-verifier.json")

# 從 URL 取出 code
parsed = urlparse(REDIRECT_URL)
params = parse_qs(parsed.query)
code = params.get("code", [None])[0]

if not code:
    print("❌ 無法從 URL 中解析出授權碼 (code)")
    print(f"   解析的 URL: {REDIRECT_URL[:80]}...")
    sys.exit(1)

# 讀取 code_verifier
if not os.path.isfile(VERIFIER_PATH):
    print("❌ 找不到 code_verifier 檔案")
    sys.exit(1)

with open(VERIFIER_PATH) as f:
    v_data = json.load(f)
code_verifier = v_data.get("code_verifier", "")

if not code_verifier:
    print("❌ code_verifier 為空")
    sys.exit(1)

token_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
payload = {
    "grant_type": "authorization_code",
    "client_id": CLIENT_ID,
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "code_verifier": code_verifier,
}

body = urllib.parse.urlencode(payload).encode("utf-8")
req = urllib.request.Request(
    token_url,
    data=body,
    method="POST",
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    if result.get("access_token"):
        # 從 access_token 解碼 account email
        account = "unknown@tenant"
        try:
            import base64
            parts = result["access_token"].split(".")
            if len(parts) >= 2:
                payload_b64 = parts[1]
                padding = 4 - len(payload_b64) % 4
                if padding != 4:
                    payload_b64 += "=" * padding
                decoded = json.loads(base64.urlsafe_b64decode(payload_b64))
                account = decoded.get("unique_name",
                           decoded.get("preferred_username",
                           decoded.get("upn", account)))
        except Exception:
            pass

        tokens = {
            "client_id": CLIENT_ID,
            "tenant_id": TENANT_ID,
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token", ""),
            "expiry": int(__import__("time").time() * 1000) + (result.get("expires_in", 3600) * 1000),
            "account": account,
            "scope": result.get("scope", ""),
        }

        token_file = os.path.join(TOKEN_DIR, "teams-tokens.json")
        with open(token_file, "w") as f:
            json.dump(tokens, f, indent=2)
        os.chmod(token_file, 0o600)

        # 清理 verifier
        os.remove(VERIFIER_PATH)

        print(f'✅ token 交換成功！')
        print(f'   儲存位置: {token_file}')
        print(f'   access_token: {result["access_token"][:30]}...')
        print(f'   refresh_token: {"✅ 已取得" if result.get("refresh_token") else "❌ 無"}')
        print(f'   有效期限: {result.get("expires_in", 0)} 秒')

        # 顯示 scope（從 JWT decode）
        try:
            import base64
            _parts = result["access_token"].split(".")
            if len(_parts) >= 2:
                _b64 = _parts[1]
                _pad = 4 - len(_b64) % 4
                if _pad != 4:
                    _b64 += "=" * _pad
                _dec = json.loads(base64.urlsafe_b64decode(_b64))
                _scopes = _dec.get("scp", _dec.get("roles", "?"))
                print(f'   權限 (scope): {_scopes}')
        except Exception:
            pass
    else:
        error_desc = result.get("error_description", result.get("error", "未知錯誤"))
        print(f'❌ token 交換失敗: {error_desc}')

except urllib.error.HTTPError as e:
    error_body = e.read().decode("utf-8")
    print(f'❌ HTTP {e.code}: {error_body}')
except Exception as e:
    print(f'❌ 錯誤: {e}')
PYTHON_EOF

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   Teams 認證設定完成！                        ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "執行 teams.sh 測試："
echo "  bash $SCRIPT_DIR/teams.sh"
echo ""
