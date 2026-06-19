#!/bin/bash
# Pre-format hook: Auto-format edited TypeScript/JavaScript files with Prettier
#
# Usage in smart_hook:
#   smart_hook({
#     command: "add",
#     event: "postTool",
#     match: { tool: "smart_fast_apply" },
#     action: {
#       type: "bash",
#       command: "bash examples/hooks/pre-format.sh {file}"
#     },
#     description: "Auto-format edited files with Prettier"
#   })

FILE="$1"

# Only format supported file types
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.html|*.md)
    ;;
  *)
    # Skip unsupported files silently
    exit 0
    ;;
esac

# Check if Prettier is available
if ! command -v npx &> /dev/null; then
  echo "[hook] npx not found, skipping Prettier format"
  exit 0
fi

echo "[hook] Formatting $FILE with Prettier..."
npx --yes prettier --write --ignore-unknown "$FILE" 2>&1 || echo "[hook] Prettier format skipped (no config or error)"
