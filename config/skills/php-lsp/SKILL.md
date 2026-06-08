---
name: php-lsp
description: Run PHP syntax checks and use intelephense LSP for PHP code — syntax validation, linting, and code intelligence. Use when working with PHP code, fixing syntax errors, or checking PHP code quality.
compatibility: opencode
metadata:
  lsp-server: intelephense
  language: PHP
  version: 1.18.3
---

# PHP LSP — PHP Syntax Checking & Code Intelligence

PHP comes with a built-in syntax linter (`php -l`). For deeper code intelligence, use intelephense (Node.js LSP server, installed globally via npm).

## CLI Usage

### PHP Built-in Linter

```bash
# Check syntax of a single file
php -l src/index.php

# Check all PHP files in project
find . -name "*.php" -exec php -l {} \;

# Check with no output on success (exit code only)
php -l src/index.php > /dev/null 2>&1
```

The linter returns exit code 0 on success, non-zero on error.

### Intelephense

Intelephense is an LSP server (not a CLI checker). For editor integration:

```bash
# Start LSP server (stdio mode for editor integration)
intelephense --stdio
```

## Configuration

Create `intelephense.json` in project root:

```json
{
  "intelephense.files.maxSize": 5000000,
  "intelephense.files.exclude": [
    "**/.git/**",
    "**/node_modules/**",
    "**/vendor/**"
  ],
  "intelephense.format.enable": true,
  "intelephense.php.version": "8.4",
  "intelephense.completion.insertUseDeclaration": true,
  "intelephense.diagnostics.enable": true,
  "intelephense.diagnostics.undefinedTypes": true,
  "intelephense.diagnostics.undefinedFunctions": true,
  "intelephense.diagnostics.undefinedConstants": true,
  "intelephense.diagnostics.undefinedClassConstants": true,
  "intelephense.diagnostics.undefinedMethods": true,
  "intelephense.diagnostics.undefinedProperties": true,
  "intelephense.diagnostics.undefinedVariables": true,
  "intelephense.diagnostics.typeErrors": true
}
```

Or use `composer.json`:

```json
{
  "extra": {
    "intelephense": {
      "files.exclude": ["**/vendor/**"],
      "php.version": "8.4",
      "diagnostics": {
        "undefinedTypes": true,
        "undefinedFunctions": true,
        "typeErrors": true
      }
    }
  }
}
```

## PHP Lint vs Intelephense

| Tool | Purpose |
|------|---------|
| `php -l` | Fast syntax check (compilation errors only) |
| intelephense | Full LSP: type checking, autocomplete, refactoring, diagnostics |

## Common `php -l` Error Messages

```
Parse error: syntax error, unexpected '}' in src/file.php on line 42
   → Check for unmatched braces, missing semicolons, or stray characters

Parse error: syntax error, unexpected T_STRING, expecting ',' or ';'
   → Missing semicolon or concatenation operator before this line

Fatal error: Cannot redeclare functionName()
   → Function defined twice (file included multiple times)
```

## Integration Tips

- Run `php -l` before commits to catch syntax errors
- Use `composer validate` to check `composer.json` validity
- Combine both tools: `php -l` for fast feedback, intelephense for deep analysis (via editor)
- Add `vendor/` to intelephense exclude list to avoid indexing huge directories

OpenCode does not have native LSP support. Use the CLI `php -l` command for quick syntax checking.
