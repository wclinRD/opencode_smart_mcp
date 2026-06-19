#!/bin/bash
# Pre-commit lint hook: Run ESLint on staged files before git commit
#
# Usage in smart_hook (as preTool hook on smart_git_commit):
#   smart_hook({
#     command: "add",
#     event: "preTool",
#     match: { tool: "smart_git_commit" },
#     action: {
#       type: "bash",
#       command: "bash examples/hooks/pre-commit-lint.sh"
#     },
#     description: "Lint staged files before commit"
#   })
#
# The hook runs ESLint on staged files. If lint errors are found,
# the commit is blocked (exit code 1 → hook error).
#
# To allow the commit despite lint warnings, return exit 0
# when only warnings (not errors) are present.

echo "[hook] Running ESLint on staged files..."

# Get staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|jsx|ts|tsx|mjs|cjs)$' || true)

if [ -z "$STAGED_FILES" ]; then
  echo "[hook] No staged JS/TS files to lint"
  exit 0
fi

# Check if ESLint is configured
if [ ! -f ".eslintrc" ] && [ ! -f ".eslintrc.json" ] && [ ! -f ".eslintrc.js" ] && [ ! -f ".eslintrc.yaml" ] && [ ! -f ".eslintrc.yml" ]; then
  echo "[hook] No ESLint config found, skipping"
  exit 0
fi

# Run ESLint on staged files
echo "[hook] Linting: $STAGED_FILES"
npx --yes eslint --max-warnings=0 $STAGED_FILES 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "[hook] ⚠️  Lint errors found. Fix them before committing, or bypass with smart_config({set:{mode:'interactive'}})"
fi

exit $EXIT_CODE
