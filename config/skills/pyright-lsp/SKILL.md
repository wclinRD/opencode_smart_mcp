---
name: pyright-lsp
description: Run pyright type checking on Python files — static type analysis, diagnostics, and error detection. Use when working with Python code, fixing type errors, adding type annotations, or checking code quality.
compatibility: opencode
metadata:
  lsp-server: pyright
  language: Python
  version: 1.1.409
---

# Pyright LSP — Python Type Checking

Pyright is a fast Python type checker written in TypeScript.
It's installed via Homebrew and available as both CLI (`pyright`) and LSP server (`pyright-langserver`).

## CLI Usage

Run type checking on your project:

```bash
# Check entire project
pyright

# Check specific files
pyright src/main.py
pyright src/**/*.py

# Create pyright config
pyright --createconfig
```

## Configuration

Create `pyrightconfig.json` in project root:

```json
{
  "include": ["src"],
  "exclude": ["**/node_modules", "**/__pycache__"],
  "typeCheckingMode": "basic",
  "reportMissingImports": true,
  "reportMissingTypeStubs": false,
  "pythonVersion": "3.11",
  "pythonPlatform": "Darwin"
}
```

Or use `pyproject.toml`:

```toml
[tool.pyright]
include = ["src"]
typeCheckingMode = "basic"
reportMissingImports = true
```

## Type Checking Modes

| Mode | Description |
|------|-------------|
| `off` | No type checking |
| `basic` | Check function signatures and assignments |
| `strict` | Full type checking with all reports enabled |

## Common Report Settings

```json
{
  "reportOptionalMemberAccess": "warning",
  "reportOptionalCall": "warning",
  "reportOptionalIterable": "warning",
  "reportOptionalContextManager": "warning",
  "reportUnusedImport": "error",
  "reportUnusedClass": "warning",
  "reportUnusedFunction": "warning",
  "reportUnusedVariable": "warning",
  "reportGeneralTypeIssues": "error"
}
```

## LSP Server (for editors)

Pyright includes an LSP server for IDE integration:

```bash
# Start LSP server in stdio mode (for editor integration)
pyright-langserver --stdio
```

OpenCode does not have native LSP support. Use the CLI `pyright` command for type checking.

## Integration Tips

- Run `pyright` before commits to catch type errors
- Use `# type: ignore` comments to suppress specific errors
- Create `.pyrightconfig.json` for project-wide settings
- Use `--level` flag to filter by severity: `error`, `warning`, `information`
